from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.domain import auth_service
from app.schemas.auth import (
    AuthStatus,
    AuthUser,
    BootstrapAdminRequest,
    BootstrapAdminResponse,
)


router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status", response_model=AuthStatus)
def get_auth_status() -> AuthStatus:
    return AuthStatus(**auth_service.auth_status())


@router.get("/users", response_model=list[AuthUser])
def get_auth_users() -> list[AuthUser]:
    return [AuthUser(**user) for user in auth_service.list_users()]


@router.post("/bootstrap-admin", response_model=BootstrapAdminResponse)
def post_bootstrap_admin(payload: BootstrapAdminRequest) -> BootstrapAdminResponse:
    try:
        result = auth_service.bootstrap_admin(
            username=payload.username,
            password=payload.password,
            display_name=payload.display_name,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return BootstrapAdminResponse(**result)
