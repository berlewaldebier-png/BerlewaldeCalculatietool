from __future__ import annotations

import logging
import os
import secrets
import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
import urllib.parse
from typing import Any
from xml.sax.saxutils import escape as _xml_escape

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse, StreamingResponse

from app.domain.douano_client import parse_json_payload as _client_parse_json_payload
from app.domain.douano_client import probe_url as _probe_url
from app.domain.douano_client import request as _douano_request
from app.domain.auth_dependencies import require_admin, require_user
from app.domain import douano_oauth_storage
from app.domain import douano_sync_storage
from app.domain import douano_product_mapping_storage
from app.domain import postgres_storage
from app.domain import douano_product_ignore_storage
from app.domain import dataset_store
from app.domain import douano_margin_service
from app.domain import douano_unmapped_rule_storage
from app.domain import lot_costs_storage
from app.domain import douano_unmapped_service
from app.domain import break_even_planning_service
from app.domain import break_even_planning_storage


router = APIRouter(prefix="/integrations", tags=["integrations"], dependencies=[Depends(require_user)])
logger = logging.getLogger(__name__)


def _xlsx_cell(value: Any, row_idx: int, col_idx: int) -> str:
    letters = ""
    n = col_idx
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    ref = f"{letters}{row_idx}"
    text = _xml_escape(str(value if value is not None else ""))
    return f'<c r="{ref}" t="inlineStr"><is><t>{text}</t></is></c>'


def _xlsx_example_response(*, filename: str, sheet_name: str, headers: list[str], example_row: list[Any]) -> StreamingResponse:
    rows = [headers, example_row]
    sheet_rows = []
    for row_idx, row in enumerate(rows, start=1):
        cells = "".join(_xlsx_cell(value, row_idx, col_idx) for col_idx, value in enumerate(row, start=1))
        sheet_rows.append(f'<row r="{row_idx}">{cells}</row>')
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{''.join(sheet_rows)}</sheetData>"
        "</worksheet>"
    )
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{_xml_escape(sheet_name)}" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        "</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        "</Relationships>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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


async def _refresh_douano_tokens(tokens: dict[str, Any]) -> dict[str, Any]:
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
    status, _, raw = await _douano_request(tokens={"access_token": ""}, method="POST", url=token_url, form=form)
    if status <= 0:
        raise HTTPException(status_code=400, detail="Douano token refresh mislukt.")
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


def _parse_json_payload(raw: str) -> dict[str, Any]:
    try:
        return _client_parse_json_payload(raw)
    except ValueError as exc:
        logger.exception("Douano response JSON parsing failed")
        raise HTTPException(status_code=502, detail="Douano response is geen geldige JSON.") from exc


def _parse_exporter_payload(raw: str) -> Any:
    try:
        return json.loads(raw or "")
    except ValueError as exc:
        snippet = raw.strip().replace("\r", " ").replace("\n", " ")
        if len(snippet) > 500:
            snippet = snippet[:500] + "..."
        logger.exception("Douano exporter response JSON parsing failed")
        raise HTTPException(
            status_code=502,
            detail=f"Douano exporter response is geen geldige JSON: {snippet}",
        ) from exc


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


def _extract_exporter_list(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    candidates = [
        payload.get("data"),
        payload.get("items"),
        payload.get("result"),
        payload.get("results"),
    ]
    result = payload.get("result")
    if isinstance(result, dict):
        candidates.extend([result.get("data"), result.get("items")])
    for candidate in candidates:
        if isinstance(candidate, list):
            return [row for row in candidate if isinstance(row, dict)]
    return []


async def _fetch_paged_resource(
    *,
    tokens: dict[str, Any],
    path: str,
    query: dict[str, str] | None = None,
    max_pages: int = 10,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    # Refresh tokens proactively when expired/near-expired.
    expires_at = _parse_iso_ts(tokens.get("expires_at"))
    if expires_at is not None:
        now = datetime.now(UTC)
        if expires_at <= now + timedelta(seconds=60):
            tokens = _refresh_douano_tokens(tokens)

    base = _douano_api_base_url(tokens)
    q = dict(query or {})
    items: list[dict[str, Any]] = []
    pages_fetched = 0
    stop_reason = "max_pages"
    for page in range(1, max(1, int(max_pages)) + 1):
        pages_fetched = page
        q_with_page = {**q, "page": str(page)}
        url = f"{base}{path}?{urllib.parse.urlencode(q_with_page)}" if q_with_page else f"{base}{path}"
        status, _, raw = await _douano_request(tokens=tokens, method="GET", url=url)
        if status == 401:
            # Try a single refresh+retry; if rights are missing this still stays 401/403.
            tokens = await _refresh_douano_tokens(tokens)
            status, _, raw = await _douano_request(tokens=tokens, method="GET", url=url)
        if status <= 0:
            raise HTTPException(status_code=502, detail="Douano request faalde.")
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
            stop_reason = "empty_page"
            break
        items.extend(page_items)
    meta = {
        "path": path,
        "query": q,
        "max_pages_requested": int(max_pages),
        "last_page_fetched": int(pages_fetched),
        "stop_reason": str(stop_reason),
        "max_pages_reached": bool(stop_reason == "max_pages" and pages_fetched >= int(max_pages)),
    }
    return items, meta


async def _fetch_exporter_resource(
    *,
    tokens: dict[str, Any],
    data_collector: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    expires_at = _parse_iso_ts(tokens.get("expires_at"))
    if expires_at is not None:
        now = datetime.now(UTC)
        if expires_at <= now + timedelta(seconds=60):
            tokens = await _refresh_douano_tokens(tokens)

    base = _douano_api_base_url(tokens)
    path = f"/api/public/v1/exporter/{urllib.parse.quote(data_collector.strip())}"
    url = f"{base}{path}"
    status, _, raw = await _douano_request(tokens=tokens, method="GET", url=url)
    if status == 401:
        tokens = await _refresh_douano_tokens(tokens)
        status, _, raw = await _douano_request(tokens=tokens, method="GET", url=url)
    if status <= 0:
        raise HTTPException(status_code=502, detail="Douano exporter request faalde.")
    if status >= 400:
        snippet = raw.strip().replace("\r", " ").replace("\n", " ")
        if len(snippet) > 300:
            snippet = snippet[:300] + "..."
        raise HTTPException(status_code=502, detail=f"Douano exporter fetch faalde ({status}) voor {path}: {snippet}")
    payload = _parse_exporter_payload(raw)
    items = _extract_exporter_list(payload)
    return items, {"path": path, "data_collector": data_collector, "response_shape": type(payload).__name__}


def _set_state_cookie(response: Response, state: str) -> None:
    env = os.getenv("CALCULATIETOOL_ENV", "local").strip().lower()
    response.set_cookie(
        "douano_oauth_state",
        state,
        httponly=True,
        samesite="lax",
        secure=env not in {"local", "dev", "development"},
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
async def get_douano_probe() -> dict[str, Any]:
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
        results.append(
            {
                "url": u,
                "options": await _probe_url(u, "OPTIONS"),
                "post": await _probe_url(u, "POST"),
                "get": await _probe_url(u, "GET"),
            }
        )

    return {
        "base_url": base,
        "authorize_url": _douano_authorize_url(),
        "token_url": _douano_token_url(),
        "candidates": results,
        "hint": "Kies de token endpoint die POST accepteert (status 200/400/401). 405 betekent fout endpoint/method.",
    }


@router.get("/douano/debug")
async def get_douano_debug(
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
    status, headers, raw = await _douano_request(tokens=tokens, method="GET", url=url)
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
async def get_douano_discover_companies() -> dict[str, Any]:
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
        status, headers, raw = await _douano_request(tokens=tokens, method="GET", url=url)
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
async def get_douano_callback(
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
    status, headers, raw = await _douano_request(tokens={"access_token": ""}, method="POST", url=token_url, form=form)
    if status <= 0:
        raise HTTPException(status_code=400, detail="Douano token exchange mislukt.")
    if status >= 400:
        extra = []
        location = headers.get("Location", "")
        allow = headers.get("Allow", "")
        if location:
            extra.append(f"Location={location}")
        if allow:
            extra.append(f"Allow={allow}")
        snippet = raw.strip().replace("\r", " ").replace("\n", " ")
        if len(snippet) > 500:
            snippet = snippet[:500] + "…"
        if snippet:
            extra.append(f"Body={snippet}")
        detail = f"Douano token exchange mislukt: HTTP {status}"
        if extra:
            detail += f" ({'; '.join(extra)})"
        raise HTTPException(status_code=400, detail=detail)

    try:
        parsed = _client_parse_json_payload(raw)
    except ValueError as exc:
        logger.exception("Douano token response JSON parsing failed")
        raise HTTPException(status_code=400, detail="Douano token response is geen geldige JSON.") from exc

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
async def post_douano_sync_companies(
    max_pages: int = Query(10, ge=1, le=200),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    tokens = _require_douano_tokens()
    try:
        items, fetch_meta = await _fetch_paged_resource(tokens=tokens, path="/api/public/v1/core/companies", max_pages=max_pages)
        for row in items:
            douano_sync_storage.upsert_raw_object(
                resource="companies",
                external_id=int(row.get("id", 0) or 0),
                entity_version=int(row.get("entity_version", 0) or 0),
                payload=row,
            )
        normalized = douano_sync_storage.upsert_companies(items)
        stats = {"fetched": len(items), "upserted": normalized, "fetch": fetch_meta}
        douano_sync_storage.set_sync_state(resource="companies", success=True, since_date=None, stats=stats, error="")
        return {"resource": "companies", **stats}
    except HTTPException as exc:
        douano_sync_storage.set_sync_state(resource="companies", success=False, since_date=None, stats={"fetch": {"path": "/api/public/v1/core/companies"}}, error=str(exc.detail))
        raise
    except Exception as exc:
        douano_sync_storage.set_sync_state(resource="companies", success=False, since_date=None, stats={}, error=str(exc))
        raise HTTPException(status_code=500, detail="Companies sync faalde.") from exc


@router.post("/douano/sync/products")
async def post_douano_sync_products(
    max_pages: int = Query(10, ge=1, le=200),
    is_sellable: bool = Query(True, description="Wanneer true: filter_by_is_sellable=true"),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    tokens = _require_douano_tokens()
    query: dict[str, str] = {}
    if is_sellable:
        query["filter_by_is_sellable"] = "true"
    try:
        items, fetch_meta = await _fetch_paged_resource(tokens=tokens, path="/api/public/v1/core/products", query=query, max_pages=max_pages)
        for row in items:
            douano_sync_storage.upsert_raw_object(
                resource="products",
                external_id=int(row.get("id", 0) or 0),
                entity_version=int(row.get("entity_version", 0) or 0),
                payload=row,
            )
        normalized = douano_sync_storage.upsert_products(items)
        deleted = 0
        # Strict behaviour: for sellable-only syncs we remove products that no longer match the filter,
        # unless they are explicitly mapped in Productkoppeling (used elsewhere).
        #
        # Only do this when we are confident the fetch reached the end (empty_page), otherwise
        # a low max_pages could incorrectly delete products.
        if is_sellable and isinstance(fetch_meta, dict):
            stop_reason = str(fetch_meta.get("stop_reason", "") or "")
            max_pages_reached = bool(fetch_meta.get("max_pages_reached", False))
            if stop_reason == "empty_page" and not max_pages_reached:
                from app.domain import douano_product_mapping_storage

                douano_product_mapping_storage.ensure_schema()
                keep_ids = {int(row.get("id", 0) or 0) for row in items if isinstance(row, dict)}
                deleted = douano_sync_storage.delete_products_not_in(keep_ids, keep_mapped=True)
        stats = {"fetched": len(items), "upserted": normalized, "deleted": int(deleted), "fetch": fetch_meta}
        douano_sync_storage.set_sync_state(resource="products", success=True, since_date=None, stats=stats, error="")
        return {"resource": "products", **stats}
    except HTTPException as exc:
        douano_sync_storage.set_sync_state(resource="products", success=False, since_date=None, stats={"fetch": {"path": "/api/public/v1/core/products", "query": query}}, error=str(exc.detail))
        raise
    except Exception as exc:
        douano_sync_storage.set_sync_state(resource="products", success=False, since_date=None, stats={}, error=str(exc))
        raise HTTPException(status_code=500, detail="Products sync faalde.") from exc


@router.post("/douano/sync/sales-orders")
async def post_douano_sync_sales_orders(
    max_pages: int = Query(200, ge=1, le=500),
    since_date: str = Query("", description="Optioneel: filter orders client-side op date >= since_date (YYYY-MM-DD)."),
    recompute_snapshots: bool = Query(True, description="Herbereken opgeslagen omzet/marge kostprijssnapshots na orders-sync."),
    snapshot_limit: int = Query(50000, ge=1, le=50000),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    tokens = _require_douano_tokens()
    try:
        items, fetch_meta = await _fetch_paged_resource(tokens=tokens, path="/api/public/v1/trade/sales-orders", max_pages=max_pages)
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

        # Completeness-ish stats for quick validation in UI.
        dates = [str(row.get("date", "") or "").strip() for row in filtered if isinstance(row, dict)]
        date_values = [d for d in dates if d]
        min_date = min(date_values) if date_values else ""
        max_date = max(date_values) if date_values else ""
        ordered_count = 0
        returned_count = 0
        misc_count = 0
        for row in filtered:
            if not isinstance(row, dict):
                continue
            if isinstance(row.get("ordered_items"), list):
                ordered_count += len(row.get("ordered_items") or [])
            if isinstance(row.get("returned_items"), list):
                returned_count += len(row.get("returned_items") or [])
            if isinstance(row.get("miscellaneous_items"), list):
                misc_count += len(row.get("miscellaneous_items") or [])

        out_stats = {
            "fetched": len(filtered),
            **stats,
            "fetch": fetch_meta,
            "filters": {"since_date": since},
            "scope": {"ordered_items": True, "returned_items": True, "miscellaneous_items": True},
            "min_order_date": min_date,
            "max_order_date": max_date,
            "ordered_items_count": int(ordered_count),
            "returned_items_count": int(returned_count),
            "misc_items_count": int(misc_count),
        }
        if recompute_snapshots:
            out_stats["snapshot_backfill"] = douano_margin_service.backfill_line_snapshots(
                since=since or min_date,
                basis="order",
                limit=int(snapshot_limit),
            )
        douano_sync_storage.set_sync_state(resource="sales_orders", success=True, since_date=since or None, stats=out_stats, error="")
        return {"resource": "sales_orders", **out_stats}
    except HTTPException as exc:
        douano_sync_storage.set_sync_state(resource="sales_orders", success=False, since_date=since_date.strip() or None, stats={"fetch": {"path": "/api/public/v1/trade/sales-orders", "max_pages_requested": int(max_pages)}}, error=str(exc.detail))
        raise
    except Exception as exc:
        douano_sync_storage.set_sync_state(resource="sales_orders", success=False, since_date=since_date.strip() or None, stats={}, error=str(exc))
        raise HTTPException(status_code=500, detail="Sales-orders sync faalde.") from exc


@router.post("/douano/sync/sales-invoices")
async def post_douano_sync_sales_invoices(
    max_pages: int = Query(200, ge=1, le=500),
    since_date: str = Query("", description="Optioneel: filter invoices client-side op date >= since_date (YYYY-MM-DD)."),
    recompute_snapshots: bool = Query(True, description="Herbereken opgeslagen omzet/marge kostprijssnapshots na invoices-sync."),
    snapshot_limit: int = Query(50000, ge=1, le=50000),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    tokens = _require_douano_tokens()
    try:
        items, fetch_meta = await _fetch_paged_resource(tokens=tokens, path="/api/public/v1/trade/sales-invoices", max_pages=max_pages)
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
                resource="sales_invoices",
                external_id=int(row.get("id", 0) or 0),
                entity_version=int(row.get("entity_version", 0) or 0),
                payload=row,
            )
        stats = douano_sync_storage.upsert_sales_invoices(filtered)

        dates = [str(row.get("date", "") or "").strip() for row in filtered if isinstance(row, dict)]
        date_values = [d for d in dates if d]
        min_date = min(date_values) if date_values else ""
        max_date = max(date_values) if date_values else ""
        line_count = 0
        invoiced_numbers_count = 0
        for row in filtered:
            if not isinstance(row, dict):
                continue
            if isinstance(row.get("invoice_line_items"), list):
                line_count += len(row.get("invoice_line_items") or [])
            if isinstance(row.get("invoiced_transaction_numbers"), list):
                invoiced_numbers_count += len(row.get("invoiced_transaction_numbers") or [])

        out_stats = {
            "fetched": len(filtered),
            **stats,
            "fetch": fetch_meta,
            "filters": {"since_date": since},
            "min_invoice_date": min_date,
            "max_invoice_date": max_date,
            "invoice_line_items_count": int(line_count),
            "invoiced_transaction_numbers_count": int(invoiced_numbers_count),
        }
        if recompute_snapshots:
            out_stats["snapshot_backfill"] = douano_margin_service.backfill_line_snapshots(
                since=since or min_date,
                basis="invoice",
                limit=int(snapshot_limit),
            )
        douano_sync_storage.set_sync_state(
            resource="sales_invoices",
            success=True,
            since_date=since or None,
            stats=out_stats,
            error="",
        )
        return {"resource": "sales_invoices", **out_stats}
    except HTTPException as exc:
        douano_sync_storage.set_sync_state(
            resource="sales_invoices",
            success=False,
            since_date=since_date.strip() or None,
            stats={"fetch": {"path": "/api/public/v1/trade/sales-invoices", "max_pages_requested": int(max_pages)}},
            error=str(exc.detail),
        )
        raise
    except Exception as exc:
        douano_sync_storage.set_sync_state(resource="sales_invoices", success=False, since_date=since_date.strip() or None, stats={}, error=str(exc))
        raise HTTPException(status_code=500, detail="Sales-invoices sync faalde.") from exc


@router.post("/douano/sync/stock-history-lots")
async def post_douano_sync_stock_history_lots(
    data_collector: str = Query("stock_history_data"),
    recompute_snapshots: bool = Query(True, description="Herbereken opgeslagen omzet/marge kostprijssnapshots na LOT-sync."),
    snapshot_limit: int = Query(50000, ge=1, le=50000),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    tokens = _require_douano_tokens()
    resource = "stock_history_lots"
    try:
        items, fetch_meta = await _fetch_exporter_resource(tokens=tokens, data_collector=data_collector)
        stats = lot_costs_storage.upsert_douano_sales_lot_rows(items, source_ref=data_collector)
        out_stats = {
            **stats,
            "fetch": fetch_meta,
            "filters": {
                "transaction_type": "Verkoop",
                "stock_document_type": "Verzending",
                "cause": "Verwijderd",
            },
        }
        if recompute_snapshots:
            out_stats["snapshot_backfill"] = douano_margin_service.backfill_line_snapshots(
                basis="both",
                limit=int(snapshot_limit),
            )
        douano_sync_storage.set_sync_state(resource=resource, success=True, since_date=None, stats=out_stats, error="")
        return {"resource": resource, **out_stats}
    except HTTPException as exc:
        douano_sync_storage.set_sync_state(
            resource=resource,
            success=False,
            since_date=None,
            stats={"fetch": {"path": f"/api/public/v1/exporter/{data_collector}", "data_collector": data_collector}},
            error=str(exc.detail),
        )
        raise
    except Exception as exc:
        douano_sync_storage.set_sync_state(resource=resource, success=False, since_date=None, stats={}, error=str(exc))
        raise HTTPException(status_code=500, detail="Stock-history LOT sync faalde.") from exc


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
    year: int = Query(0, ge=0, le=2100, description="Optioneel: filter op order jaar (0 = alles)."),
    basis: str = Query("invoice", description="Basis voor rapportage: invoice (factuurdatum) of order (orderdatum)."),
    limit: int = Query(500, ge=1, le=5000),
) -> dict[str, Any]:
    return {
        "items": douano_margin_service.get_company_margin_summary(
            since=since,
            year=int(year or 0),
            limit=int(limit),
            basis=basis,
        )
    }


@router.get("/douano/sales-by-sku")
def get_douano_sales_by_sku(
    year: int = Query(..., ge=2000, le=2100, description="Rapportagejaar op basis van invoice_date (of order_date)."),
    basis: str = Query("invoice", description="Basis voor rapportage: invoice (factuurdatum) of order (orderdatum)."),
    limit: int = Query(5000, ge=1, le=20000),
) -> dict[str, Any]:
    from app.domain import douano_sales_mix_service

    return {
        "result": douano_sales_mix_service.get_sales_by_sku_summary(
            year=int(year or 0),
            basis=basis,
            limit=int(limit),
        )
    }


@router.get("/douano/company-lines")
def get_douano_company_lines(
    company_id: int = Query(..., ge=1),
    since: str = Query("", description="Optioneel: filter op order_date >= since (YYYY-MM-DD)"),
    year: int = Query(0, ge=0, le=2100, description="Optioneel: filter op order jaar (0 = alles)."),
    only_unmapped: bool = Query(False),
    only_missing_cost: bool = Query(False),
    limit: int = Query(500, ge=1, le=5000),
) -> dict[str, Any]:
    return {
        "items": douano_margin_service.list_company_lines(
            company_id=int(company_id),
            since=since,
            year=int(year or 0),
            only_unmapped=bool(only_unmapped),
            only_missing_cost=bool(only_missing_cost),
            limit=int(limit),
        )
    }


@router.get("/douano/company-orders")
def get_douano_company_orders(
    company_id: int = Query(..., ge=1),
    since: str = Query("", description="Optioneel: filter op order_date >= since (YYYY-MM-DD)"),
    year: int = Query(0, ge=0, le=2100, description="Optioneel: filter op order jaar (0 = alles)."),
    limit: int = Query(200, ge=1, le=2000),
) -> dict[str, Any]:
    return {
        "items": douano_margin_service.list_company_orders(
            company_id=int(company_id),
            since=since,
            year=int(year or 0),
            limit=int(limit),
        )
    }


@router.get("/douano/company-invoices")
def get_douano_company_invoices(
    company_id: int = Query(..., ge=1),
    since: str = Query("", description="Optioneel: filter op invoice_date >= since (YYYY-MM-DD)"),
    year: int = Query(0, ge=0, le=2100, description="Optioneel: filter op invoice jaar (0 = alles)."),
    limit: int = Query(200, ge=1, le=2000),
) -> dict[str, Any]:
    return {
        "items": douano_margin_service.list_company_invoices(
            company_id=int(company_id),
            since=since,
            year=int(year or 0),
            limit=int(limit),
        )
    }


@router.get("/douano/order-lines")
def get_douano_order_lines(
    sales_order_id: int = Query(..., ge=1),
    only_unmapped: bool = Query(False),
    only_missing_cost: bool = Query(False),
    limit: int = Query(2000, ge=1, le=5000),
) -> dict[str, Any]:
    return {
        "items": douano_margin_service.list_order_lines(
            sales_order_id=int(sales_order_id),
            only_unmapped=bool(only_unmapped),
            only_missing_cost=bool(only_missing_cost),
            limit=int(limit),
        )
    }


@router.get("/douano/invoice-lines")
def get_douano_invoice_lines(
    sales_invoice_id: int = Query(..., ge=1),
    only_unmapped: bool = Query(False),
    only_missing_cost: bool = Query(False),
    limit: int = Query(2000, ge=1, le=5000),
) -> dict[str, Any]:
    return {
        "items": douano_margin_service.list_invoice_lines(
            sales_invoice_id=int(sales_invoice_id),
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


@router.get("/douano/unmapped-groups")
def get_douano_unmapped_groups(
    year: int = Query(..., ge=1),
    basis: str = Query("invoice", description="invoice of order"),
    since: str = Query("", description="Optioneel: since (YYYY-MM-DD)"),
    limit: int = Query(200, ge=1, le=1000),
    status: str = Query("open", description="open|resolved|all"),
    include_zero_revenue: bool = Query(False, description="Toon ook groepen met netto omzet = 0"),
) -> dict[str, Any]:
    return {
        "result": douano_unmapped_service.list_unmapped_groups(
            basis="order" if str(basis or "").strip().lower() == "order" else "invoice",
            year=int(year),
            since=since,
            limit=int(limit),
            status=str(status or "open").strip().lower() or "open",
            include_zero_revenue=bool(include_zero_revenue),
        )
    }


@router.get("/douano/unmapped-group-lines")
def get_douano_unmapped_group_lines(
    year: int = Query(..., ge=1),
    basis: str = Query("invoice", description="invoice of order"),
    match_type: str = Query(..., description="douano_product_id|product0_description"),
    douano_product_id: int = Query(0, ge=0),
    line_description: str = Query("", description="alleen voor product0_description"),
    limit: int = Query(500, ge=1, le=5000),
) -> dict[str, Any]:
    return {
        "result": douano_unmapped_service.list_unmapped_group_lines(
            basis="order" if str(basis or "").strip().lower() == "order" else "invoice",
            year=int(year),
            match_type=str(match_type or ""),
            douano_product_id=int(douano_product_id or 0),
            line_description=line_description,
            limit=int(limit),
        )
    }


@router.put("/douano/unmapped-rules")
def put_douano_unmapped_rule(payload: dict[str, Any], _: dict = Depends(require_admin)) -> dict[str, Any]:
    action = str(payload.get("action", "") or "").strip()
    if action == "delete":
        deleted = douano_unmapped_rule_storage.delete_rule(
            match_type=str(payload.get("match_type", "") or ""),
            douano_product_id=int(payload.get("douano_product_id", 0) or 0),
            line_description=str(payload.get("line_description", "") or ""),
        )
        return {"result": {"deleted": bool(deleted)}}

    try:
        record = douano_unmapped_rule_storage.upsert_rule(
            match_type=str(payload.get("match_type", "") or ""),
            douano_product_id=int(payload.get("douano_product_id", 0) or 0),
            line_description=str(payload.get("line_description", "") or ""),
            action=str(payload.get("action", "") or ""),
            sku_id=str(payload.get("sku_id", "") or ""),
            category=str(payload.get("category", "") or ""),
            include_revenue=bool(payload.get("include_revenue", True)),
            include_liters=bool(payload.get("include_liters", False)),
            include_break_even=bool(payload.get("include_break_even", True)),
            note=str(payload.get("note", "") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"result": record}


@router.get("/douano/unmapped-rules")
def get_douano_unmapped_rules(
    action: str = Query("", description="Optioneel: filter op action (categorize|ignore|map_to_sku)"),
    match_type: str = Query("", description="Optioneel: filter op match_type (douano_product_id|product0_description)"),
    limit: int = Query(10000, ge=1, le=50000),
) -> dict[str, Any]:
    """List stored unmapped rules.

    Used to show which 'Ongekoppelde regels' have been solved via action=map_to_sku.
    """
    items = douano_unmapped_rule_storage.list_rules(limit=int(limit))
    act = str(action or "").strip()
    mt = str(match_type or "").strip()
    if act:
        items = [r for r in items if str(r.get("action", "") or "").strip() == act]
    if mt:
        items = [r for r in items if str(r.get("match_type", "") or "").strip() == mt]
    return {"items": items}


@router.post("/douano/backfill-line-snapshots")
def post_douano_backfill_line_snapshots(
    since: str = Query("", description="Optioneel: filter op order_date >= since (YYYY-MM-DD)"),
    company_id: int = Query(0, ge=0, description="Optioneel: alleen deze company_id backfillen"),
    limit: int = Query(5000, ge=1, le=50000),
    basis: str = Query("both", pattern="^(order|invoice|both)$"),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    return {
        "result": douano_margin_service.backfill_line_snapshots(
            since=since,
            company_id=int(company_id or 0),
            limit=int(limit),
            basis=basis,
        )
    }


@router.get("/douano/product-mappings")
def get_douano_product_mappings(limit: int = Query(2000, ge=1, le=10000)) -> dict[str, Any]:
    return {"items": douano_product_mapping_storage.list_mappings(limit=int(limit))}


@router.post("/douano/create-service-sku")
def post_douano_create_service_sku(payload: dict[str, Any], _: dict = Depends(require_admin)) -> dict[str, Any]:
    """Create a service SKU (kind=article) and map a Douano product to it.

    This supports pass-through/service lines like "Verzending" and "Proeverij" that should:
    - be mapped (so omzet & marge totals reconcile),
    - but not be forced into beer/packaging cost combos.

    The created SKU is a canonical (articles + skus) record:
    - article.kind = sellable
    - article.sellable_subtype = dienst
    - sku.kind = article
    - sku.payload.product_group = dienst
    """
    try:
        douano_product_id = int(payload.get("douano_product_id", 0) or 0)
        name = str(payload.get("name", "") or "").strip()
        uom = str(payload.get("uom", "") or "").strip().lower() or "stuk"
        if douano_product_id <= 0:
            raise ValueError("douano_product_id ontbreekt")
        if not name:
            raise ValueError("name is verplicht")

        def _slugify(value: str) -> str:
            slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in str(value or "")).strip("-")
            while "--" in slug:
                slug = slug.replace("--", "-")
            return slug

        with postgres_storage.transaction():
            articles = dataset_store.load_dataset("articles")
            skus = dataset_store.load_dataset("skus")
            if not isinstance(articles, list):
                articles = []
            if not isinstance(skus, list):
                skus = []

            # If already mapped to a SKU, return it (idempotent).
            existing_mappings = douano_product_mapping_storage.list_mappings(limit=20000)
            for row in existing_mappings:
                if int(row.get("douano_product_id", 0) or 0) == douano_product_id:
                    sku_id = str(row.get("sku_id", "") or "").strip()
                    if sku_id:
                        return {"created": False, "sku_id": sku_id, "mapping": row}

            articles_by_id = {str(r.get("id", "") or ""): r for r in articles if isinstance(r, dict) and str(r.get("id", "") or "")}

            # Prefer reusing an existing dienst article by name (case-insensitive).
            existing_article_id = ""
            for row in articles:
                if not isinstance(row, dict):
                    continue
                if str(row.get("sellable_subtype", "") or "").strip().lower() != "dienst":
                    continue
                row_name = str(row.get("name", row.get("naam", "")) or "").strip().lower()
                if row_name and row_name == name.lower():
                    existing_article_id = str(row.get("id", "") or "").strip()
                    break

            article_id = existing_article_id
            if not article_id:
                base_slug = _slugify(name) or "dienst"
                candidate = f"service-{base_slug}"
                article_id = candidate
                suffix = 2
                while article_id in articles_by_id:
                    article_id = f"{candidate}-{suffix}"
                    suffix += 1

            sku_id = f"sku-{article_id}".lower()

            # Upsert Article row.
            if article_id not in articles_by_id:
                code = f"SVC-{_slugify(name)[:12]}".upper()
                articles.append(
                    {
                        "id": article_id,
                        "code": code[:20],
                        "name": name,
                        "kind": "sellable",
                        "uom": uom,
                        "content_liter": 0.0,
                        "active": True,
                        "sellable_subtype": "dienst",
                    }
                )

            # Upsert SKU row (kind=article).
            skus_by_id = {str(r.get("id", "") or ""): r for r in skus if isinstance(r, dict) and str(r.get("id", "") or "")}
            if sku_id not in skus_by_id:
                skus.append(
                    {
                        "id": sku_id,
                        "kind": "article",
                        "beer_id": "",
                        "format_article_id": "",
                        "article_id": article_id,
                        "code": f"SVC-{_slugify(name)[:12]}".upper()[:20],
                        "name": name,
                        "active": True,
                        # Classification: service lines.
                        "product_group": "dienst",
                        "alcohol_category": "",
                        "packaging_type": "",
                        # Convenience: allow filtering in UI without needing articles join.
                        "sellable_subtype": "dienst",
                    }
                )

            # Persist canonical datasets (table-backed) with full payload.
            dataset_store.save_dataset("articles", articles)
            dataset_store.save_dataset("skus", skus)

            mapping = douano_product_mapping_storage.upsert_mapping(
                douano_product_id=douano_product_id,
                sku_id=sku_id,
                product_group="dienst",
                alcohol_category="",
                packaging_type="",
            )

        return {"created": True, "sku_id": sku_id, "article_id": article_id, "mapping": mapping}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/douano/product-mappings/{douano_product_id}")
def put_douano_product_mapping(
    douano_product_id: int,
    payload: dict[str, Any],
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        sku_id = str(payload.get("sku_id", "") or "").strip()
        product_group = str(payload.get("product_group", "") or "").strip()
        alcohol_category = str(payload.get("alcohol_category", "") or "").strip()
        packaging_type = str(payload.get("packaging_type", "") or "").strip()
        if not sku_id:
            # Backwards compatible: allow (bier_id, product_id) and resolve to SKU.
            beer_id = str(payload.get("bier_id", "") or "").strip()
            product_id = str(payload.get("product_id", "") or "").strip()
            if beer_id and product_id:
                skus = dataset_store.load_dataset("skus")
                if isinstance(skus, list):
                    for row in skus:
                        if not isinstance(row, dict):
                            continue
                        if str(row.get("beer_id", "") or "").strip() == beer_id and str(row.get("format_article_id", "") or "").strip() == product_id:
                            sku_id = str(row.get("id", "") or "").strip()
                            break
        record = douano_product_mapping_storage.upsert_mapping(
            douano_product_id=int(douano_product_id or 0),
            sku_id=sku_id,
            product_group=product_group,
            alcohol_category=alcohol_category,
            packaging_type=packaging_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"record": record}


@router.delete("/douano/product-mappings/{douano_product_id}")
def delete_douano_product_mapping(
    douano_product_id: int,
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    deleted = douano_product_mapping_storage.delete_mapping(douano_product_id=int(douano_product_id or 0))
    return {"deleted": bool(deleted)}


@router.get("/douano/product-ignored")
def get_douano_product_ignored(limit: int = Query(10000, ge=1, le=50000)) -> dict[str, Any]:
    return {"items": douano_product_ignore_storage.list_ignored(limit=int(limit))}


@router.get("/break-even/plans")
def get_break_even_plans(
    year: int = Query(0),
    include_archived: bool = Query(False),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return {"items": break_even_planning_storage.list_plan_snapshots(year=int(year), include_archived=bool(include_archived))}
    except Exception as exc:
        logger.exception("Break-even plan listing failed")
        raise HTTPException(status_code=500, detail="Break-even plannen konden niet worden geladen.") from exc


@router.post("/break-even/plans")
def post_break_even_plan(
    payload: dict[str, Any] = Body(default={}),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        year = int(payload.get("year", payload.get("jaar", 0)) or 0)
        scenario_name = str(payload.get("scenario_name", payload.get("naam", "Basis")) or "Basis")
        replace_active = bool(payload.get("replace_active", False))
        return {
            "item": break_even_planning_service.create_plan_from_active_costs(
                year=year,
                scenario_name=scenario_name,
                replace_active=replace_active,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Break-even plan creation failed")
        raise HTTPException(status_code=500, detail="Break-even plan kon niet worden opgeslagen.") from exc


@router.post("/break-even/reforecast")
def post_break_even_reforecast(
    payload: dict[str, Any] = Body(default={}),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return {
            "item": break_even_planning_service.create_reforecast(
                year=int(payload.get("year", payload.get("jaar", 0)) or 0),
                plan_snapshot_id=str(payload.get("plan_snapshot_id", "") or ""),
                as_of_date=str(payload.get("as_of_date", "") or ""),
                basis=str(payload.get("basis", "invoice") or "invoice"),
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Break-even reforecast failed")
        raise HTTPException(status_code=500, detail="Break-even prognose kon niet worden geactualiseerd.") from exc


@router.post("/break-even/close-year")
def post_break_even_close_year(
    payload: dict[str, Any] = Body(default={}),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return {
            "item": break_even_planning_service.close_year(
                year=int(payload.get("year", payload.get("jaar", 0)) or 0),
                basis=str(payload.get("basis", "invoice") or "invoice"),
                overwrite=bool(payload.get("overwrite", False)),
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Break-even year close failed")
        raise HTTPException(status_code=500, detail="Jaar kon niet worden afgesloten.") from exc


@router.get("/break-even/year-close-preview")
def get_break_even_year_close_preview(
    year: int = Query(...),
    basis: str = Query("invoice"),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return {"preview": break_even_planning_service.build_year_close_payload(year=int(year), basis=str(basis or "invoice"))}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Break-even year close preview failed")
        raise HTTPException(status_code=500, detail="Jaarafsluiting preview kon niet worden geladen.") from exc


@router.get("/break-even/model-review")
def get_break_even_model_review(_: dict = Depends(require_admin)) -> dict[str, Any]:
    try:
        return {"result": break_even_planning_service.model_review()}
    except Exception as exc:
        logger.exception("Break-even model review failed")
        raise HTTPException(status_code=500, detail="Datamodel review kon niet worden geladen.") from exc


@router.get("/lot-costs")
def get_lot_costs(limit: int = Query(2000, ge=1, le=10000)) -> dict[str, Any]:
    return {"items": lot_costs_storage.list_lot_cost_records(limit=int(limit))}


@router.get("/lot-costs/internal-summary")
def get_internal_lot_summary(
    year: int = Query(0, ge=0),
    limit: int = Query(5000, ge=1, le=50000),
) -> dict[str, Any]:
    return {"items": lot_costs_storage.list_internal_lot_summary(year=int(year or 0), limit=int(limit))}


@router.put("/lot-costs/aliases")
def put_lot_alias(payload: dict[str, Any], _: dict = Depends(require_admin)) -> dict[str, Any]:
    try:
        return {"record": lot_costs_storage.upsert_lot_alias(payload)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/lot-costs/aliases/{alias_id}")
def delete_lot_alias(alias_id: str, _: dict = Depends(require_admin)) -> dict[str, Any]:
    return {"deleted": lot_costs_storage.delete_lot_alias(alias_id)}


@router.post("/lot-costs")
def post_lot_cost(payload: dict[str, Any], _: dict = Depends(require_admin)) -> dict[str, Any]:
    try:
        return {"record": lot_costs_storage.upsert_lot_cost_record(payload)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/lot-costs/stock-history/preview")
async def post_stock_history_preview(
    request: Request,
    filename: str = Query("voorraadhistoriek.xlsx"),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        content = await request.body()
        if not content:
            raise HTTPException(status_code=400, detail="Bestand ontbreekt.")
        return lot_costs_storage.preview_stock_history_import(content, filename)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/lot-costs/stock-history/confirm")
async def post_stock_history_confirm(
    request: Request,
    filename: str = Query("voorraadhistoriek.xlsx"),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        content = await request.body()
        if not content:
            raise HTTPException(status_code=400, detail="Bestand ontbreekt.")
        return lot_costs_storage.confirm_stock_history_import(content, filename)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/lot-costs/stock-history/enrich-missing")
async def post_stock_history_enrich_missing(
    request: Request,
    filename: str = Query("lot-verrijking.xlsx"),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        content = await request.body()
        if not content:
            raise HTTPException(status_code=400, detail="Bestand ontbreekt.")
        return lot_costs_storage.enrich_missing_sales_lots_from_excel(content, filename)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/lot-costs/stock-history/example")
def get_stock_history_example(_: dict = Depends(require_admin)) -> StreamingResponse:
    return _xlsx_example_response(
        filename="voorraadhistoriek-voorbeeld.xlsx",
        sheet_name="Voorraadhistoriek",
        headers=lot_costs_storage.STOCK_HISTORY_COLUMNS,
        example_row=["2025-01-15", "202500123", "301002", "Berlewalde Blond 24 x 33cl", "LOT-2025-001", "Voorbeeld klant", 10],
    )


@router.get("/lot-costs/stock-history/imports")
def get_stock_history_imports(
    limit: int = Query(100, ge=1, le=1000),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    return {"items": lot_costs_storage.list_stock_history_imports(limit=int(limit))}


@router.delete("/lot-costs/stock-history/imports/{import_batch_id}")
def delete_stock_history_import(import_batch_id: str, _: dict = Depends(require_admin)) -> dict[str, Any]:
    try:
        deleted = lot_costs_storage.delete_stock_history_import(import_batch_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deleted": deleted}


@router.get("/lot-costs/opening-lots/example")
def get_opening_lots_example(_: dict = Depends(require_admin)) -> StreamingResponse:
    return _xlsx_example_response(
        filename="opening-lot-voorbeeld.xlsx",
        sheet_name="Opening LOT",
        headers=lot_costs_storage.OPENING_LOT_COLUMNS,
        example_row=["Wentersch", "wenterschBlond", "301002", "Berlewalde Blond 24 x 33cl", "2024-12-31", 120, 24.0, 1.0, "Ja"],
    )


@router.post("/lot-costs/opening-lots/preview")
async def post_opening_lots_preview(
    request: Request,
    filename: str = Query("opening-lots.xlsx"),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        content = await request.body()
        if not content:
            raise HTTPException(status_code=400, detail="Bestand ontbreekt.")
        return lot_costs_storage.preview_opening_lot_import(content, filename)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/lot-costs/opening-lots/confirm")
async def post_opening_lots_confirm(
    request: Request,
    filename: str = Query("opening-lots.xlsx"),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        content = await request.body()
        if not content:
            raise HTTPException(status_code=400, detail="Bestand ontbreekt.")
        return lot_costs_storage.confirm_opening_lot_import(content, filename)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/douano/product-ignored/{douano_product_id}")
def put_douano_product_ignored(
    douano_product_id: int,
    payload: dict[str, Any],
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        record = douano_product_ignore_storage.upsert_ignore(
            douano_product_id=int(douano_product_id or 0),
            reason=str(payload.get("reason", "") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"record": record}


@router.delete("/douano/product-ignored/{douano_product_id}")
def delete_douano_product_ignored(
    douano_product_id: int,
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    deleted = douano_product_ignore_storage.delete_ignore(douano_product_id=int(douano_product_id or 0))
    return {"deleted": bool(deleted)}


@router.get("/douano/cost-combos")
def get_douano_cost_combos(
    year: int = Query(0, ge=0, le=2100, description="Optioneel: filter op jaar (0 = alle jaren)."),
) -> dict[str, Any]:
    """Return unique SKU combos with human labels.

    This endpoint is used for manual mapping: Douano product -> (bier_id, product_id).

    - Mapping is year-independent, so by default (year=0) we return combos across all years.
    - The list includes:
      - active activations (kostprijsproductactiveringen)
      - definitive cost version snapshots (kostprijsversies.resultaat_snapshot)
    """
    activations = dataset_store.load_dataset("kostprijsproductactiveringen")
    versions = dataset_store.load_dataset("kostprijsversies")
    skus = dataset_store.load_dataset("skus")
    articles = dataset_store.load_dataset("articles")
    article_name_by_id: dict[str, str] = {}
    if isinstance(articles, list):
        for row in articles:
            if not isinstance(row, dict):
                continue
            rid = str(row.get("id", "") or "").strip()
            if not rid:
                continue
            article_name_by_id[rid] = str(row.get("name", row.get("naam", "")) or "").strip() or rid
    sku_by_id: dict[str, dict[str, str]] = {}
    if isinstance(skus, list):
        for row in skus:
            if not isinstance(row, dict):
                continue
            sid = str(row.get("id", "") or "").strip()
            if not sid:
                continue
            sku_by_id[sid.lower()] = {
                "kind": str(row.get("kind", "") or "").strip().lower(),
                "name": str(row.get("name", row.get("naam", "")) or "").strip() or sid,
                "beer_id": str(row.get("beer_id", "") or "").strip(),
                "format_article_id": str(row.get("format_article_id", "") or "").strip(),
                "article_id": str(row.get("article_id", "") or "").strip(),
            }

    items: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _format_slug(format_article_id: str) -> str:
        fmt = str(format_article_id or "").strip().lower()
        if fmt.startswith("fmt-"):
            fmt = fmt[len("fmt-") :]
        return fmt

    def _append_combo(*, sku_id: str) -> None:
        sku_text = str(sku_id or "").strip()
        if not sku_text:
            return
        sku_norm = sku_text.lower()
        meta = sku_by_id.get(sku_norm, {})
        kind = str(meta.get("kind", "") or "").strip().lower()
        beer_id = str(meta.get("beer_id", "") or "").strip()
        format_article_id = str(meta.get("format_article_id", "") or "").strip()
        article_id = str(meta.get("article_id", "") or "").strip()

        # Deduplicate by logical scope where possible (beer×format, or article_id).
        scope_key = sku_norm
        if kind == "beer_format" and beer_id and format_article_id:
            scope_key = f"beer_format|{beer_id}|{format_article_id}"
        elif kind == "article" and article_id:
            scope_key = f"article|{article_id}"

        if scope_key in seen:
            return
        seen.add(scope_key)

        display_name = meta.get("name", sku_text)
        product_name = ""
        if kind == "beer_format":
            fmt_id = str(meta.get("format_article_id", "") or "").strip()
            if fmt_id:
                product_name = article_name_by_id.get(fmt_id, "") or fmt_id
        elif kind == "article":
            aid = str(meta.get("article_id", "") or "").strip()
            if aid:
                product_name = article_name_by_id.get(aid, "") or aid
        # For beer_format and article SKUs the display_name already includes the format/article name.
        # Only append a product_name for unknown kinds where the display name may be generic.
        label_main = display_name
        if not kind and product_name and product_name not in display_name:
            label_main = f"{display_name} — {product_name}"
        items.append(
            {
                "sku_id": sku_text,
                "beer_id": meta.get("beer_id", ""),
                "format_article_id": meta.get("format_article_id", ""),
                "label": f"{label_main} ({sku_norm})",
                "naam": display_name,
            }
        )

    if isinstance(activations, list):
        for row in activations:
            if not isinstance(row, dict):
                continue
            activation_year = int(row.get("jaar", 0) or 0)
            if int(year) and activation_year != int(year):
                continue
            _append_combo(sku_id=str(row.get("sku_id", "") or ""))

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
                _append_combo(sku_id=str(row.get("sku_id", "") or ""))
            for row in producten.get("samengestelde_producten", []) if isinstance(producten.get("samengestelde_producten", []), list) else []:
                if not isinstance(row, dict):
                    continue
                _append_combo(sku_id=str(row.get("sku_id", "") or ""))

    items.sort(key=lambda item: str(item.get("label", "") or "").lower())
    return {"items": items}

