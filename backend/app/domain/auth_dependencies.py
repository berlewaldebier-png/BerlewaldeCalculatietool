from __future__ import annotations

from fastapi import HTTPException, Request

from app.domain import auth_service


def get_current_session(request: Request) -> dict:
    token = request.cookies.get(auth_service.SESSION_COOKIE_NAME, "")
    session = auth_service.verify_session_token(token)
    if not session:
        raise HTTPException(status_code=401, detail="Niet ingelogd.")
    return session


def require_user(request: Request) -> dict:
    return get_current_session(request)


def require_admin(request: Request) -> dict:
    session = get_current_session(request)
    if str(session.get("role", "") or "") != "admin":
        raise HTTPException(status_code=403, detail="Geen rechten.")
    return session

