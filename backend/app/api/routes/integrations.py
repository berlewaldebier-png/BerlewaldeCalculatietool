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
    url = f"{_douano_base_url()}/authorize?{urllib.parse.urlencode(params)}"
    resp = RedirectResponse(url=url, status_code=302)
    _set_state_cookie(resp, state)
    return resp


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

    token_url = f"{_douano_base_url()}/oauth/token"
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
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # Include response body + Allow header when present; 405 usually means wrong method/endpoint.
        try:
            body_text = exc.read().decode("utf-8", errors="replace")
        except Exception:
            body_text = ""
        allow = ""
        try:
            allow = str(exc.headers.get("Allow", "") or "")
        except Exception:
            allow = ""
        msg = f"HTTP {getattr(exc, 'code', '?')} {getattr(exc, 'reason', '')}".strip()
        extra = []
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
    return {"connected": bool(tokens), "tokens": tokens or {}}

