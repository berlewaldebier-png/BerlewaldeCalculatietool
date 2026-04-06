from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response

from app.domain import auth_service
from app.domain.auth_dependencies import require_admin
from app.schemas.auth import (
    AuthStatus,
    AuthUser,
    BootstrapAdminRequest,
    BootstrapAdminResponse,
    CreateUserRequest,
    CreateUserResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
)


router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status", response_model=AuthStatus)
def get_auth_status() -> AuthStatus:
    return AuthStatus(**auth_service.auth_status())


@router.get("/users", response_model=list[AuthUser])
def get_auth_users(_: dict = Depends(require_admin)) -> list[AuthUser]:
    return [AuthUser(**user) for user in auth_service.list_users()]


@router.post("/bootstrap-admin", response_model=BootstrapAdminResponse)
def post_bootstrap_admin(
    payload: BootstrapAdminRequest,
    x_bootstrap_token: str | None = Header(default=None, alias="X-Bootstrap-Token"),
) -> BootstrapAdminResponse:
    try:
        auth_service.require_bootstrap_token(x_bootstrap_token or "")
        if auth_service.has_any_admin() and auth_service.environment_name() != "local":
            return BootstrapAdminResponse(created=False, reason="already_bootstrapped", username=payload.username)
        result = auth_service.bootstrap_admin(
            username=payload.username,
            password=payload.password,
            display_name=payload.display_name,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return BootstrapAdminResponse(**result)


@router.post("/login", response_model=LoginResponse)
def post_login(payload: LoginRequest, response: Response, request: Request) -> LoginResponse:
    authenticated = auth_service.authenticate_local_temp_admin(payload.username, payload.password)
    if not authenticated:
        authenticated = auth_service.authenticate_user(
            username=payload.username,
            password=payload.password,
        )
    if not authenticated:
        raise HTTPException(status_code=401, detail="Ongeldige gebruikersnaam of wachtwoord.")
    token = auth_service.issue_session_token(
        username=authenticated["username"],
        display_name=authenticated["display_name"],
        role=authenticated["role"],
    )
    response.set_cookie(
        auth_service.SESSION_COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=auth_service.environment_name() not in {"local", "dev", "development"},
        path="/",
        max_age=60 * 60 * 12,
    )
    return LoginResponse(**authenticated)


@router.post("/logout")
def post_logout(response: Response) -> dict[str, bool]:
    response.delete_cookie(auth_service.SESSION_COOKIE_NAME, path="/")
    return {"logged_out": True}


@router.get("/me", response_model=MeResponse)
def get_me(request: Request) -> MeResponse:
    token = request.cookies.get(auth_service.SESSION_COOKIE_NAME, "")
    session = auth_service.verify_session_token(token)
    if not session:
        raise HTTPException(status_code=401, detail="Niet ingelogd.")
    return MeResponse(authenticated=True, **session)


@router.post("/users", response_model=CreateUserResponse)
def post_create_user(
    payload: CreateUserRequest,
    _: dict = Depends(require_admin),
) -> CreateUserResponse:
    try:
        result = auth_service.create_user(
            username=payload.username,
            password=payload.password,
            display_name=payload.display_name,
            role=payload.role,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CreateUserResponse(created=True, username=str(result.get("username", "") or payload.username))
