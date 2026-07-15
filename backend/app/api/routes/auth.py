from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response

from app.domain import auth_policy, auth_service
from app.domain.auth_dependencies import (
    get_current_session,
    require_users_manage,
    require_users_view,
)
from app.rate_limits import limiter
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
    PasswordForgotRequest,
    PasswordForgotResponse,
    PasswordChangeRequest,
    PasswordChangeResponse,
    PasswordResetRequest,
    PasswordResetResponse,
    UpdateUserRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status", response_model=AuthStatus)
def get_auth_status() -> AuthStatus:
    return AuthStatus(**auth_service.auth_status())


@router.post("/login", response_model=LoginResponse)
@limiter.limit("5/minute")
def post_login(request: Request, payload: LoginRequest, response: Response) -> LoginResponse:
    """Login with username and password. Rate limited to 5 attempts per minute."""
    try:
        authenticated = auth_service.authenticate_local_temp_admin(payload.username, payload.password)
        if not authenticated:
            authenticated = auth_service.authenticate_user(
                username=payload.username,
                password=payload.password,
            )
        if not authenticated:
            logger.warning(f"Failed login attempt for username: {payload.username}")
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
        response.delete_cookie(auth_service.LOGGED_OUT_COOKIE_NAME, path="/")
        logger.info(f"Successful login for user: {authenticated['username']}")
        return LoginResponse(
            **authenticated,
            capabilities=list(auth_policy.capabilities_for_role(authenticated["role"])),
        )
    except HTTPException:
        raise
    except RuntimeError as exc:
        logger.exception("Configuration error during login")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error during login")
        raise HTTPException(status_code=500, detail="Internal server error") from exc


@router.post("/forgot-password", response_model=PasswordForgotResponse)
@limiter.limit("5/minute")
def post_forgot_password(request: Request, payload: PasswordForgotRequest) -> PasswordForgotResponse:
    """Initiate password reset by email."""
    try:
        return PasswordForgotResponse(**auth_service.request_password_reset(payload.email))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/reset-password", response_model=PasswordResetResponse)
@limiter.limit("5/minute")
def post_reset_password(request: Request, payload: PasswordResetRequest) -> PasswordResetResponse:
    """Reset a forgotten password using a one-time email code."""
    try:
        auth_service.reset_password(
            email=payload.email,
            code=payload.code,
            new_password=payload.password,
            password_confirm=payload.password_confirm,
        )
        return PasswordResetResponse(reset=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error during password reset")
        raise HTTPException(status_code=500, detail="Internal server error") from exc


@router.post("/change-password", response_model=PasswordChangeResponse)
@limiter.limit("5/minute")
def post_change_password(request: Request, payload: PasswordChangeRequest) -> PasswordChangeResponse:
    """Change password for the currently authenticated user."""
    token = request.cookies.get(auth_service.SESSION_COOKIE_NAME, "")
    session = auth_service.verify_session_token(token)
    if not session:
        raise HTTPException(status_code=401, detail="Niet ingelogd.")
    try:
        auth_service.change_password(
            username=str(session.get("username", "") or ""),
            current_password=payload.current_password,
            new_password=payload.password,
            password_confirm=payload.password_confirm,
        )
        return PasswordChangeResponse(changed=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error during password change")
        raise HTTPException(status_code=500, detail="Internal server error") from exc


@router.post("/logout")
def post_logout(response: Response) -> dict[str, bool]:
    """Logout the current user."""
    secure = auth_service.environment_name() not in {"local", "dev", "development"}
    response.delete_cookie(
        auth_service.SESSION_COOKIE_NAME,
        path="/",
        secure=secure,
        httponly=True,
        samesite="lax",
    )
    if not auth_service.auth_enabled() and auth_service.auth_bypass_allowed():
        response.set_cookie(
            key=auth_service.LOGGED_OUT_COOKIE_NAME,
            value="1",
            httponly=True,
            secure=secure,
            samesite="lax",
            path="/",
            max_age=60 * 60 * 24 * 365,
        )
    return {"logged_out": True}


@router.get("/me", response_model=MeResponse)
def get_me(request: Request) -> MeResponse:
    """Get current user information."""
    session = get_current_session(request)
    return MeResponse(authenticated=True, **session)


@router.get("/users", response_model=list[AuthUser])
def get_auth_users(_: dict = Depends(require_users_view)) -> list[AuthUser]:
    """Get list of all users."""
    return [AuthUser(**user) for user in auth_service.list_users()]


@router.post("/bootstrap-admin", response_model=BootstrapAdminResponse)
def post_bootstrap_admin(
    payload: BootstrapAdminRequest,
    x_bootstrap_token: str | None = Header(default=None, alias="X-Bootstrap-Token"),
) -> BootstrapAdminResponse:
    """Bootstrap the first admin user."""
    try:
        auth_service.require_bootstrap_token(x_bootstrap_token or "")
        if auth_service.has_any_admin() and auth_service.environment_name() != "local":
            return BootstrapAdminResponse(created=False, reason="already_bootstrapped", username=payload.username)
        result = auth_service.bootstrap_admin(
            username=payload.username,
            password=payload.password,
            display_name=payload.display_name,
            email=payload.email,
        )
        logger.info(f"Bootstrap admin created: {payload.username}")
    except RuntimeError as exc:
        logger.error(f"Bootstrap admin error: {exc}")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return BootstrapAdminResponse(**result)


@router.post("/users", response_model=CreateUserResponse)
def post_create_user(
    payload: CreateUserRequest,
    _: dict = Depends(require_users_manage),
) -> CreateUserResponse:
    """Create a new user."""
    try:
        result = auth_service.create_user(
            username=payload.username,
            password=payload.password,
            display_name=payload.display_name,
            email=payload.email,
            role=payload.role,
        )
        logger.info(f"New user created: {payload.username}")
    except ValueError as exc:
        logger.warning(f"Error creating user {payload.username}: {exc}")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CreateUserResponse(created=True, username=str(result.get("username", "") or payload.username))


@router.put("/users/{username}", response_model=dict[str, bool])
def put_update_user(
    username: str,
    payload: UpdateUserRequest,
    _: dict = Depends(require_users_manage),
) -> dict[str, bool]:
    """Update user profile, role, or active status."""
    try:
        provided_fields = getattr(payload, "model_fields_set", None)
        if provided_fields is None:
            provided_fields = getattr(payload, "__fields_set__", set())
        auth_service.update_user(
            username=username,
            display_name=payload.display_name,
            email=payload.email,
            email_provided="email" in provided_fields,
            role=payload.role,
            is_active=payload.is_active,
        )
        logger.info(f"User updated: {username}")
        return {"updated": True}
    except ValueError as exc:
        logger.warning(f"Error updating user {username}: {exc}")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(f"Error updating user {username}")
        raise HTTPException(status_code=500, detail="Internal server error") from exc
