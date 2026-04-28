from __future__ import annotations

import json
import os
import secrets
from datetime import UTC, datetime, timedelta
import urllib.parse
import urllib.request
import urllib.error
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse

from app.domain.auth_dependencies import require_user
from app.domain import douano_oauth_storage
from app.domain import douano_sync_storage
from app.domain import douano_product_mapping_storage
from app.domain import douano_product_ignore_storage
from app.domain import dataset_store
from app.domain import douano_margin_service


router = APIRouter(prefix="/integrations", tags=["integrations"], dependencies=[Depends(require_user)])


def _douano_base_url() -> str:
    base = os.getenv("DOUANO_BASE_URL", "").strip().rstrip("/")
    if not base:
        raise RuntimeError("DOUANO_BASE_URL ontbreekt.")
    return base


def _douano_client_id() -> str:
    val = os.getenv("DOUANO_CLIENT_ID", "").strip()
    if not val:
        raise RuntimeError("DOUANO_CLIENT_ID ontbreekt.")
    return val


def _douano_client_secret() -> str:
    val = os.getenv("DOUANO_CLIENT_SECRET", "").strip()
    if not val:
        raise RuntimeError("DOUANO_CLIENT_SECRET ontbreekt.")
    return val


def _douano_redirect_uri() -> str:
    val = os.getenv("DOUANO_REDIRECT_URI", "").strip()
    if not val:
        raise RuntimeError("DOUANO_REDIRECT_URI ontbreekt.")
    return val


def _post_connect_redirect() -> str:
    return os.getenv("DOUANO_POST_CONNECT_REDIRECT", "http://localhost:3000/beheer").strip() or "http://localhost:3000/beheer"


def _douano_scopes() -> str:
    # Optional; Douano docs/postman define scopes. Empty means "default".
    return os.getenv("DOUANO_SCOPES", "").strip()


def _douano_authorize_url() -> str:
    # Allow overriding exact endpoint since SaaS setups sometimes differ.
    url = os.getenv("DOUANO_AUTHORIZE_URL", "").strip().rstrip("/")
    if url:
        return url
    path = os.getenv("DOUANO_AUTHORIZE_PATH", "/authorize").strip() or "/authorize"
    if not path.startswith("/"):
        path = "/" + path
    return f"{_douano_base_url()}{path}"


def _douano_token_url() -> str:
    url = os.getenv("DOUANO_TOKEN_URL", "").strip().rstrip("/")
    if url:
        return url
    path = os.getenv("DOUANO_TOKEN_PATH", "/oauth/token").strip() or "/oauth/token"
    if not path.startswith("/"):
        path = "/" + path
    return f"{_douano_base_url()}{path}"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        return None


def _probe_url(url: str, method: str) -> dict[str, Any]:
    opener = urllib.request.build_opener(_NoRedirect())
    req = urllib.request.Request(
        url,
        data=(b"x=1" if method.upper() == "POST" else None),
        method=method.upper(),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "calculatietool/0.1 (+http://localhost)",
        },
    )
    try:
        with opener.open(req, timeout=10) as resp:
            return {
                "ok": True,
                "status": getattr(resp, "status", None),
                "url": getattr(resp, "url", url),
                "server": resp.headers.get("Server", ""),
                "allow": resp.headers.get("Allow", ""),
                "location": resp.headers.get("Location", ""),
            }
    except urllib.error.HTTPError as exc:
        headers = getattr(exc, "headers", None)
        return {
            "ok": False,
            "status": getattr(exc, "code", None),
            "url": getattr(exc, "geturl", lambda: url)() or url,
            "server": (headers.get("Server", "") if headers else ""),
            "allow": (headers.get("Allow", "") if headers else ""),
            "location": (headers.get("Location", "") if headers else ""),
        }
    except Exception as exc:
        return {"ok": False, "status": None, "url": url, "error": str(exc)}


def _require_douano_tokens() -> dict[str, Any]:
    tokens = douano_oauth_storage.get_tokens("douano") or {}
    if not tokens:
        raise HTTPException(status_code=400, detail="Douano is niet gekoppeld.")
    access = str(tokens.get("access_token", "") or "")
    if not access:
        raise HTTPException(status_code=400, detail="Douano access_token ontbreekt.")
    return tokens


def _douano_api_base_url(tokens: dict[str, Any]) -> str:
    # Default: reuse OAuth base_url; allow override for setups where API host differs.
    explicit = os.getenv("DOUANO_API_BASE_URL", "").strip().rstrip("/")
    if explicit:
        return explicit
    return str(tokens.get("base_url", "") or "").strip().rstrip("/") or _douano_base_url()


def _parse_iso_ts(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        # Stored as ISO string via douano_oauth_storage.get_tokens()
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None


def _refresh_douano_tokens(tokens: dict[str, Any]) -> dict[str, Any]:
    refresh_token = str(tokens.get("refresh_token", "") or "")
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Douano refresh_token ontbreekt; opnieuw koppelen.")

    token_url = _douano_token_url()
    form = {
        "grant_type": "refresh_token",
        "client_id": _douano_client_id(),
        "client_secret": _douano_client_secret(),
        "refresh_token": refresh_token,
    }
    status, _, raw = _douano_request(tokens={"access_token": ""}, method="POST", url=token_url, form=form)
    if status >= 400:
        snippet = raw.strip().replace("\r", " ").replace("\n", " ")
        if len(snippet) > 500:
            snippet = snippet[:500] + "…"
        raise HTTPException(status_code=400, detail=f"Douano token refresh mislukt ({status}): {snippet}")

    parsed = _parse_json_payload(raw)
    access_token = str(parsed.get("access_token", "") or "")
    new_refresh_token = str(parsed.get("refresh_token", "") or refresh_token)
    token_type = str(parsed.get("token_type", "") or "")
    scope = str(parsed.get("scope", "") or "")
    try:
        expires_in = int(parsed.get("expires_in", 0) or 0)
    except (TypeError, ValueError):
        expires_in = 0

    if not access_token:
        raise HTTPException(status_code=400, detail="Douano token refresh response mist access_token; opnieuw koppelen.")

    douano_oauth_storage.upsert_tokens(
        provider="douano",
        base_url=_douano_base_url(),
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type=token_type,
        scope=scope,
        expires_in_seconds=expires_in,
        raw_payload=parsed if isinstance(parsed, dict) else {},
    )
    refreshed = douano_oauth_storage.get_tokens("douano") or {}
    return refreshed if refreshed else tokens


def _douano_request(
    *,
    tokens: dict[str, Any],
    method: str,
    url: str,
    form: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], str]:
    opener = urllib.request.build_opener(_NoRedirect())
    body = None
    headers = {
        "Accept": "application/json",
        "User-Agent": "calculatietool/0.1 (+http://localhost)",
    }
    access = str(tokens.get("access_token", "") or "").strip()
    if access:
        headers["Authorization"] = f"Bearer {access}"
    if form is not None:
        body = urllib.parse.urlencode(form).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=body, method=method.upper(), headers=headers)
    try:
        with opener.open(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return int(getattr(resp, "status", 200) or 200), dict(resp.headers.items()), raw
    except urllib.error.HTTPError as exc:
        try:
            raw = exc.read().decode("utf-8", errors="replace")
        except Exception:
            raw = ""
        hdrs = getattr(exc, "headers", None)
        return int(getattr(exc, "code", 0) or 0), (dict(hdrs.items()) if hdrs else {}), raw
    except Exception as exc:
        return 0, {}, str(exc)


def _parse_json_payload(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw or "")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Douano response is geen JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="Douano response ongeldig (verwacht object).")
    return parsed


def _extract_result_list(payload: dict[str, Any]) -> tuple[int, list[dict[str, Any]]]:
    result = payload.get("result")
    if not isinstance(result, dict):
        return 0, []
    current_page = int(result.get("current_page", 0) or 0)
    data = result.get("data", [])
    if not isinstance(data, list):
        return current_page, []
    cleaned: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    return current_page, cleaned


def _fetch_paged_resource(
    *,
    tokens: dict[str, Any],
    path: str,
    query: dict[str, str] | None = None,
    max_pages: int = 10,
) -> list[dict[str, Any]]:
    # Refresh tokens proactively when expired/near-expired.
    expires_at = _parse_iso_ts(tokens.get("expires_at"))
    if expires_at is not None:
        now = datetime.now(UTC)
        if expires_at <= now + timedelta(seconds=60):
            tokens = _refresh_douano_tokens(tokens)

    base = _douano_api_base_url(tokens)
    q = dict(query or {})
    items: list[dict[str, Any]] = []
    for page in range(1, max(1, int(max_pages)) + 1):
        q_with_page = {**q, "page": str(page)}
        url = f"{base}{path}?{urllib.parse.urlencode(q_with_page)}" if q_with_page else f"{base}{path}"
        status, _, raw = _douano_request(tokens=tokens, method="GET", url=url)
        if status == 401:
            # Try a single refresh+retry; if rights are missing this still stays 401/403.
            tokens = _refresh_douano_tokens(tokens)
            status, _, raw = _douano_request(tokens=tokens, method="GET", url=url)
        if status >= 400:
            snippet = raw.strip().replace("\r", " ").replace("\n", " ")
            if len(snippet) > 300:
                snippet = snippet[:300] + "…"
            raise HTTPException(
                status_code=502,
                detail=f"Douano fetch faalde ({status}) voor {path}: {snippet}",
            )
        payload = _parse_json_payload(raw)
        _, page_items = _extract_result_list(payload)
        if not page_items:
            break
        items.extend(page_items)
    return items


def _set_state_cookie(response: Response, state: str) -> None:
    response.set_cookie(
        "douano_oauth_state",
        state,
        httponly=True,
        samesite="lax",
        secure=False,  # local dev
        path="/",
        max_age=60 * 10,
    )


@router.get("/douano/connect")
def get_douano_connect() -> RedirectResponse:
    state = secrets.token_urlsafe(24)
    params: dict[str, str] = {
        "response_type": "code",
        "client_id": _douano_client_id(),
        "redirect_uri": _douano_redirect_uri(),
        "state": state,
    }
    scopes = _douano_scopes()
    if scopes:
        params["scope"] = scopes
    url = f"{_douano_authorize_url()}?{urllib.parse.urlencode(params)}"
    resp = RedirectResponse(url=url, status_code=302)
    _set_state_cookie(resp, state)
    return resp


@router.get("/douano/probe")
def get_douano_probe() -> dict[str, Any]:
    base = _douano_base_url()
    candidates = [
        _douano_token_url(),
        f"{base}/oauth/token",
        f"{base}/oauth/token/",
        f"{base}/api/oauth/token",
        f"{base}/api/oauth/token/",
    ]
    seen: set[str] = set()
    uniq: list[str] = []
    for u in candidates:
        u2 = (u or "").strip()
        if not u2 or u2 in seen:
            continue
        seen.add(u2)
        uniq.append(u2)

    results: list[dict[str, Any]] = []
    for u in uniq:
        results.append({"url": u, "options": _probe_url(u, "OPTIONS"), "post": _probe_url(u, "POST"), "get": _probe_url(u, "GET")})

    return {
        "base_url": base,
        "authorize_url": _douano_authorize_url(),
        "token_url": _douano_token_url(),
        "candidates": results,
        "hint": "Kies de token endpoint die POST accepteert (status 200/400/401). 405 betekent fout endpoint/method.",
    }


@router.get("/douano/debug")
def get_douano_debug(
    path: str = Query("/api", description="Path on Douano host, e.g. /api/public/v1/core/companies"),
    query: str = Query("", description="Raw query string without ?, e.g. filter_by_is_customer=true"),
) -> dict[str, Any]:
    tokens = _require_douano_tokens()
    base = _douano_api_base_url(tokens)
    p = (path or "").strip()
    if not p.startswith("/"):
        p = "/" + p
    url = f"{base}{p}"
    if query.strip():
        url = f"{url}?{query.strip().lstrip('?')}"
    status, headers, raw = _douano_request(tokens=tokens, method="GET", url=url)
    snippet = raw.strip().replace("\r", " ").replace("\n", " ")
    if len(snippet) > 800:
        snippet = snippet[:800] + "…"
    return {
        "api_base_url": base,
        "url": url,
        "status": status,
        "content_type": headers.get("Content-Type", ""),
        "server": headers.get("Server", ""),
        "body_snippet": snippet,
        "hint": "404 betekent meestal verkeerd pad/host. 401 betekent token ok maar scope/permissions missen. 200 + HTML betekent webpagina i.p.v. API.",
    }


@router.get("/douano/discover-companies")
def get_douano_discover_companies() -> dict[str, Any]:
    tokens = _require_douano_tokens()
    base = _douano_api_base_url(tokens)

    candidates = [
        "/api/public/v1/core/companies",
        "/api/public/v1/companies",
        "/api/v1/core/companies",
        "/api/v1/companies",
        "/api/core/companies",
        "/api/companies",
        "/public/v1/core/companies",
        "/public/v1/companies",
        "/v1/core/companies",
        "/v1/companies",
        "/core/companies",
        "/companies",
    ]
    query = "filter_by_is_customer=true&filter_by_is_active=true"

    results: list[dict[str, Any]] = []
    first_non_404 = ""
    for p in candidates:
        url = f"{base}{p}?{query}"
        status, headers, raw = _douano_request(tokens=tokens, method="GET", url=url)
        ct = headers.get("Content-Type", "")
        short = raw.strip().replace("\r", " ").replace("\n", " ")
        if len(short) > 220:
            short = short[:220] + "…"
        results.append({"path": p, "status": status, "content_type": ct, "body_snippet": short})
        if not first_non_404 and status and status != 404:
            first_non_404 = p

    return {
        "api_base_url": base,
        "query": query,
        "best_guess_path": first_non_404,
        "results": results,
        "note": "Als alles 404 is, dan zit de companies resource op een ander prefix of aparte API host. Stel dan DOUANO_API_BASE_URL in.",
    }


@router.get("/douano/callback")
def get_douano_callback(
    request: Request,
    code: str = Query("", description="Authorization code from Douano"),
    state: str = Query("", description="State from /connect"),
) -> RedirectResponse:
    if not code:
        raise HTTPException(status_code=400, detail="Douano callback mist code.")
    expected_state = str(request.cookies.get("douano_oauth_state", "") or "")
    if not expected_state or not state or state != expected_state:
        raise HTTPException(status_code=400, detail="Douano callback state mismatch.")

    token_url = _douano_token_url()
    form = {
        "grant_type": "authorization_code",
        "client_id": _douano_client_id(),
        "client_secret": _douano_client_secret(),
        "redirect_uri": _douano_redirect_uri(),
        "code": code,
    }
    body = urllib.parse.urlencode(form).encode("utf-8")
    req = urllib.request.Request(
        token_url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            # Some providers behave oddly without a UA. Keep it explicit for debugging.
            "User-Agent": "calculatietool/0.1 (+http://localhost)",
        },
    )
    try:
        opener = urllib.request.build_opener(_NoRedirect())
        with opener.open(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # Include response body + Allow header when present; 405 usually means wrong method/endpoint.
        try:
            body_text = exc.read().decode("utf-8", errors="replace")
        except Exception:
            body_text = ""
        allow = ""
        location = ""
        final_url = ""
        try:
            allow = str(exc.headers.get("Allow", "") or "")
            location = str(exc.headers.get("Location", "") or "")
        except Exception:
            allow = ""
            location = ""
        try:
            final_url = str(exc.geturl() or "")
        except Exception:
            final_url = ""
        msg = f"HTTP {getattr(exc, 'code', '?')} {getattr(exc, 'reason', '')}".strip()
        extra = []
        if final_url:
            extra.append(f"URL={final_url}")
        if location:
            extra.append(f"Location={location}")
        if allow:
            extra.append(f"Allow={allow}")
        if body_text:
            # Keep it short; Douano can return HTML.
            snippet = body_text.strip().replace("\r", " ").replace("\n", " ")
            if len(snippet) > 500:
                snippet = snippet[:500] + "…"
            extra.append(f"Body={snippet}")
        detail = f"Douano token exchange mislukt: {msg}"
        if extra:
            detail += f" ({'; '.join(extra)})"
        raise HTTPException(status_code=400, detail=detail) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Douano token exchange mislukt: {exc}") from exc

    try:
        parsed = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Douano token response is geen JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="Douano token response ongeldig.")

    access_token = str(parsed.get("access_token", "") or "")
    refresh_token = str(parsed.get("refresh_token", "") or "")
    token_type = str(parsed.get("token_type", "") or "")
    scope = str(parsed.get("scope", "") or "")
    try:
        expires_in = int(parsed.get("expires_in", 0) or 0)
    except (TypeError, ValueError):
        expires_in = 0

    if not access_token or not refresh_token:
        raise HTTPException(status_code=400, detail="Douano token response mist access_token of refresh_token.")

    douano_oauth_storage.upsert_tokens(
        provider="douano",
        base_url=_douano_base_url(),
        access_token=access_token,
        refresh_token=refresh_token,
        token_type=token_type,
        scope=scope,
        expires_in_seconds=expires_in,
        raw_payload=parsed,
    )

    # Clear state cookie to prevent reuse.
    redirect_to = _post_connect_redirect()
    out = RedirectResponse(url=redirect_to, status_code=302)
    out.delete_cookie("douano_oauth_state", path="/")
    return out


@router.get("/douano/status")
def get_douano_status() -> dict[str, Any]:
    tokens = douano_oauth_storage.get_tokens("douano")
    if not tokens:
        return {"connected": False}

    # Never expose raw tokens in UI responses.
    return {
        "connected": True,
        "provider": tokens.get("provider", "douano"),
        "base_url": tokens.get("base_url", ""),
        "api_base_url": os.getenv("DOUANO_API_BASE_URL", "").strip() or "",
        "token_type": tokens.get("token_type", ""),
        "scope": tokens.get("scope", ""),
        "expires_at": tokens.get("expires_at", ""),
        "created_at": tokens.get("created_at", ""),
        "updated_at": tokens.get("updated_at", ""),
    }


@router.get("/douano/sync-status")
def get_douano_sync_status() -> dict[str, Any]:
    return {"items": douano_sync_storage.list_sync_state()}


@router.post("/douano/sync/companies")
def post_douano_sync_companies(
    max_pages: int = Query(10, ge=1, le=200),
) -> dict[str, Any]:
    tokens = _require_douano_tokens()
    try:
        items = _fetch_paged_resource(tokens=tokens, path="/api/public/v1/core/companies", max_pages=max_pages)
        for row in items:
            douano_sync_storage.upsert_raw_object(
                resource="companies",
                external_id=int(row.get("id", 0) or 0),
                entity_version=int(row.get("entity_version", 0) or 0),
                payload=row,
            )
        normalized = douano_sync_storage.upsert_companies(items)
        stats = {"fetched": len(items), "upserted": normalized}
        douano_sync_storage.set_sync_state(resource="companies", success=True, since_date=None, stats=stats, error="")
        return {"resource": "companies", **stats}
    except HTTPException as exc:
        douano_sync_storage.set_sync_state(resource="companies", success=False, since_date=None, stats={}, error=str(exc.detail))
        raise
    except Exception as exc:
        douano_sync_storage.set_sync_state(resource="companies", success=False, since_date=None, stats={}, error=str(exc))
        raise HTTPException(status_code=500, detail=f"Companies sync faalde: {exc}") from exc


@router.post("/douano/sync/products")
def post_douano_sync_products(
    max_pages: int = Query(10, ge=1, le=200),
    is_sellable: bool = Query(True, description="Wanneer true: filter_by_is_sellable=true"),
) -> dict[str, Any]:
    tokens = _require_douano_tokens()
    query: dict[str, str] = {}
    if is_sellable:
        query["filter_by_is_sellable"] = "true"
    try:
        items = _fetch_paged_resource(tokens=tokens, path="/api/public/v1/core/products", query=query, max_pages=max_pages)
        for row in items:
            douano_sync_storage.upsert_raw_object(
                resource="products",
                external_id=int(row.get("id", 0) or 0),
                entity_version=int(row.get("entity_version", 0) or 0),
                payload=row,
            )
        normalized = douano_sync_storage.upsert_products(items)
        stats = {"fetched": len(items), "upserted": normalized}
        douano_sync_storage.set_sync_state(resource="products", success=True, since_date=None, stats=stats, error="")
        return {"resource": "products", **stats}
    except HTTPException as exc:
        douano_sync_storage.set_sync_state(resource="products", success=False, since_date=None, stats={}, error=str(exc.detail))
        raise
    except Exception as exc:
        douano_sync_storage.set_sync_state(resource="products", success=False, since_date=None, stats={}, error=str(exc))
        raise HTTPException(status_code=500, detail=f"Products sync faalde: {exc}") from exc


@router.post("/douano/sync/sales-orders")
def post_douano_sync_sales_orders(
    max_pages: int = Query(10, ge=1, le=500),
    since_date: str = Query("", description="Optioneel: filter orders client-side op date >= since_date (YYYY-MM-DD)."),
) -> dict[str, Any]:
    tokens = _require_douano_tokens()
    try:
        items = _fetch_paged_resource(tokens=tokens, path="/api/public/v1/trade/sales-orders", max_pages=max_pages)
        filtered: list[dict[str, Any]] = []
        since = since_date.strip()
        for row in items:
            if not since:
                filtered.append(row)
                continue
            date_text = str(row.get("date", "") or "").strip()
            if date_text and date_text >= since:
                filtered.append(row)

        for row in filtered:
            douano_sync_storage.upsert_raw_object(
                resource="sales_orders",
                external_id=int(row.get("id", 0) or 0),
                entity_version=int(row.get("entity_version", 0) or 0),
                payload=row,
            )
        stats = douano_sync_storage.upsert_sales_orders(filtered)
        out_stats = {"fetched": len(filtered), **stats}
        douano_sync_storage.set_sync_state(resource="sales_orders", success=True, since_date=since or None, stats=out_stats, error="")
        return {"resource": "sales_orders", **out_stats}
    except HTTPException as exc:
        douano_sync_storage.set_sync_state(resource="sales_orders", success=False, since_date=since_date.strip() or None, stats={}, error=str(exc.detail))
        raise
    except Exception as exc:
        douano_sync_storage.set_sync_state(resource="sales_orders", success=False, since_date=since_date.strip() or None, stats={}, error=str(exc))
        raise HTTPException(status_code=500, detail=f"Sales-orders sync faalde: {exc}") from exc


@router.get("/douano/companies")
def get_douano_companies(
    only_customers: bool = Query(False),
    limit: int = Query(200, ge=1, le=2000),
) -> dict[str, Any]:
    return {"items": douano_sync_storage.list_companies(only_customers=only_customers, limit=int(limit))}


@router.get("/douano/products")
def get_douano_products(
    q: str = Query("", description="Zoek op name/sku/gtin (case-insensitive)"),
    limit: int = Query(200, ge=1, le=2000),
) -> dict[str, Any]:
    return {"items": douano_sync_storage.list_products(q=q, limit=int(limit))}


@router.get("/douano/revenue-summary")
def get_douano_revenue_summary(
    since: str = Query("", description="Optioneel: filter op order_date >= since (YYYY-MM-DD)"),
    limit: int = Query(500, ge=1, le=5000),
) -> dict[str, Any]:
    return {"items": douano_sync_storage.list_company_revenue_summary(since=since, limit=int(limit))}


@router.get("/douano/margin-summary")
def get_douano_margin_summary(
    since: str = Query("", description="Optioneel: filter op order_date >= since (YYYY-MM-DD)"),
    limit: int = Query(500, ge=1, le=5000),
) -> dict[str, Any]:
    return {"items": douano_margin_service.get_company_margin_summary(since=since, limit=int(limit))}


@router.get("/douano/company-lines")
def get_douano_company_lines(
    company_id: int = Query(..., ge=1),
    since: str = Query("", description="Optioneel: filter op order_date >= since (YYYY-MM-DD)"),
    only_unmapped: bool = Query(False),
    only_missing_cost: bool = Query(False),
    limit: int = Query(500, ge=1, le=5000),
) -> dict[str, Any]:
    return {
        "items": douano_margin_service.list_company_lines(
            company_id=int(company_id),
            since=since,
            only_unmapped=bool(only_unmapped),
            only_missing_cost=bool(only_missing_cost),
            limit=int(limit),
        )
    }


@router.get("/douano/company-unmapped-products")
def get_douano_company_unmapped_products(
    company_id: int = Query(..., ge=1),
    since: str = Query("", description="Optioneel: filter op order_date >= since (YYYY-MM-DD)"),
    limit: int = Query(100, ge=1, le=1000),
) -> dict[str, Any]:
    return {
        "items": douano_margin_service.list_company_unmapped_products(
            company_id=int(company_id),
            since=since,
            limit=int(limit),
        )
    }


@router.post("/douano/backfill-line-snapshots")
def post_douano_backfill_line_snapshots(
    since: str = Query("", description="Optioneel: filter op order_date >= since (YYYY-MM-DD)"),
    company_id: int = Query(0, ge=0, description="Optioneel: alleen deze company_id backfillen"),
    limit: int = Query(5000, ge=1, le=50000),
) -> dict[str, Any]:
    return {
        "result": douano_margin_service.backfill_line_snapshots(
            since=since,
            company_id=int(company_id or 0),
            limit=int(limit),
        )
    }


@router.get("/douano/product-mappings")
def get_douano_product_mappings(limit: int = Query(2000, ge=1, le=10000)) -> dict[str, Any]:
    return {"items": douano_product_mapping_storage.list_mappings(limit=int(limit))}


@router.put("/douano/product-mappings/{douano_product_id}")
def put_douano_product_mapping(douano_product_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        record = douano_product_mapping_storage.upsert_mapping(
            douano_product_id=int(douano_product_id or 0),
            bier_id=str(payload.get("bier_id", "") or ""),
            product_id=str(payload.get("product_id", "") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"record": record}


@router.delete("/douano/product-mappings/{douano_product_id}")
def delete_douano_product_mapping(douano_product_id: int) -> dict[str, Any]:
    deleted = douano_product_mapping_storage.delete_mapping(douano_product_id=int(douano_product_id or 0))
    return {"deleted": bool(deleted)}


@router.get("/douano/product-ignored")
def get_douano_product_ignored(limit: int = Query(10000, ge=1, le=50000)) -> dict[str, Any]:
    return {"items": douano_product_ignore_storage.list_ignored(limit=int(limit))}


@router.put("/douano/product-ignored/{douano_product_id}")
def put_douano_product_ignored(douano_product_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        record = douano_product_ignore_storage.upsert_ignore(
            douano_product_id=int(douano_product_id or 0),
            reason=str(payload.get("reason", "") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"record": record}


@router.delete("/douano/product-ignored/{douano_product_id}")
def delete_douano_product_ignored(douano_product_id: int) -> dict[str, Any]:
    deleted = douano_product_ignore_storage.delete_ignore(douano_product_id=int(douano_product_id or 0))
    return {"deleted": bool(deleted)}


@router.get("/douano/cost-combos")
def get_douano_cost_combos(
    year: int = Query(0, ge=0, le=2100, description="Optioneel: filter op jaar (0 = alle jaren)."),
) -> dict[str, Any]:
    """Return unique (bier_id, product_id) combos with human labels.

    This endpoint is used for manual mapping: Douano product -> (bier_id, product_id).

    - Mapping is year-independent, so by default (year=0) we return combos across all years.
    - The list includes:
      - active activations (kostprijsproductactiveringen)
      - definitive cost version snapshots (kostprijsversies.resultaat_snapshot)
    """
    activations = dataset_store.load_dataset("kostprijsproductactiveringen")
    versions = dataset_store.load_dataset("kostprijsversies")
    bieren = dataset_store.load_dataset("bieren")
    basisproducten = dataset_store.load_dataset("basisproducten")
    samengestelde = dataset_store.load_dataset("samengestelde-producten")

    bieren_by_id: dict[str, str] = {}
    if isinstance(bieren, list):
        for row in bieren:
            if not isinstance(row, dict):
                continue
            bid = str(row.get("id", "") or "")
            naam = str(row.get("naam", row.get("biernaam", "")) or "")
            if bid:
                bieren_by_id[bid] = naam or bid

    product_by_ref: dict[tuple[str, str], str] = {}
    for source, kind in ((basisproducten, "basis"), (samengestelde, "samengesteld")):
        if not isinstance(source, list):
            continue
        for row in source:
            if not isinstance(row, dict):
                continue
            pid = str(row.get("id", "") or "")
            oms = str(row.get("omschrijving", "") or "").strip()
            naam = str(row.get("naam", "") or "").strip()
            label = oms or naam or pid
            if pid:
                product_by_ref[(kind, pid)] = label

    items: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _append_combo(*, bier_id: str, product_id: str, product_type: str) -> None:
        if not bier_id or not product_id:
            return
        key = f"{bier_id}::{product_id}"
        if key in seen:
            return
        seen.add(key)
        bier_naam = bieren_by_id.get(bier_id, bier_id)
        normalized_type = str(product_type or "").strip().lower()
        if normalized_type not in {"basis", "samengesteld"}:
            normalized_type = "onbekend"
        product_naam = (
            product_by_ref.get((normalized_type, product_id))
            or product_by_ref.get(("basis", product_id))
            or product_by_ref.get(("samengesteld", product_id))
            or f"[{normalized_type}] {product_id}"
        )
        items.append(
            {
                "bier_id": bier_id,
                "product_id": product_id,
                "product_type": normalized_type,
                "label": f"{bier_naam} — {product_naam}",
                "bier_naam": bier_naam,
                "product_naam": product_naam,
            }
        )

    if isinstance(activations, list):
        for row in activations:
            if not isinstance(row, dict):
                continue
            activation_year = int(row.get("jaar", 0) or 0)
            if int(year) and activation_year != int(year):
                continue
            _append_combo(
                bier_id=str(row.get("bier_id", "") or ""),
                product_id=str(row.get("product_id", "") or ""),
                product_type=str(row.get("product_type", "") or ""),
            )

    if isinstance(versions, list):
        for version in versions:
            if not isinstance(version, dict):
                continue
            if str(version.get("status", "") or "").strip().lower() != "definitief":
                continue
            version_year = int(version.get("jaar", (version.get("basisgegevens", {}) or {}).get("jaar", 0)) or 0)
            if int(year) and version_year != int(year):
                continue
            bier_id = str(version.get("bier_id", "") or "")
            producten = ((version.get("resultaat_snapshot", {}) or {}).get("producten", {}) or {})
            if not isinstance(producten, dict):
                continue
            for row in producten.get("basisproducten", []) if isinstance(producten.get("basisproducten", []), list) else []:
                if not isinstance(row, dict):
                    continue
                _append_combo(bier_id=bier_id, product_id=str(row.get("product_id", "") or ""), product_type="basis")
            for row in producten.get("samengestelde_producten", []) if isinstance(producten.get("samengestelde_producten", []), list) else []:
                if not isinstance(row, dict):
                    continue
                _append_combo(bier_id=bier_id, product_id=str(row.get("product_id", "") or ""), product_type="samengesteld")

    items.sort(key=lambda item: str(item.get("label", "") or "").lower())
    return {"items": items}

