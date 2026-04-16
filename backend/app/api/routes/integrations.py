from __future__ import annotations

import json
import os
import secrets
import urllib.parse
import urllib.request
import urllib.error
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse

from app.domain.auth_dependencies import require_user
from app.domain import douano_oauth_storage


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
        "token_type": tokens.get("token_type", ""),
        "scope": tokens.get("scope", ""),
        "expires_at": tokens.get("expires_at", ""),
        "created_at": tokens.get("created_at", ""),
        "updated_at": tokens.get("updated_at", ""),
    }

