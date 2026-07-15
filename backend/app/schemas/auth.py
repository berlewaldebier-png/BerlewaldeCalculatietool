from __future__ import annotations

from pydantic import BaseModel, Field


class AuthStatus(BaseModel):
    enabled: bool
    mode: str
    postgres_configured: bool
    storage_provider: str
    user_count: int
    has_admin: bool


class AuthUser(BaseModel):
    id: str
    username: str
    display_name: str
    email: str | None = None
    role: str
    is_active: bool
    created_at: str
    updated_at: str


class BootstrapAdminRequest(BaseModel):
    username: str = Field(min_length=3)
    password: str = Field(min_length=1)
    display_name: str = Field(min_length=2)
    email: str | None = None


class BootstrapAdminResponse(BaseModel):
    created: bool
    reason: str
    username: str


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class LoginResponse(BaseModel):
    authenticated: bool
    username: str
    display_name: str
    role: str
    capabilities: list[str] = Field(default_factory=list)


class MeResponse(BaseModel):
    authenticated: bool
    username: str
    display_name: str
    role: str
    capabilities: list[str] = Field(default_factory=list)


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=3)
    password: str = Field(min_length=1)
    display_name: str = Field(min_length=2)
    email: str | None = None
    role: str = Field(default="user")


class CreateUserResponse(BaseModel):
    created: bool
    username: str


class PasswordForgotRequest(BaseModel):
    email: str = Field(min_length=1)


class PasswordForgotResponse(BaseModel):
    requested: bool
    code_sent: bool = False
    debug_code: str | None = None


class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=1)
    code: str = Field(min_length=1)
    password: str = Field(min_length=1)
    password_confirm: str = Field(min_length=1)


class PasswordResetResponse(BaseModel):
    reset: bool


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1)
    password: str = Field(min_length=1)
    password_confirm: str = Field(min_length=1)


class PasswordChangeResponse(BaseModel):
    changed: bool


class UpdateUserRequest(BaseModel):
    display_name: str | None = None
    email: str | None = None
    role: str | None = None
    is_active: bool | None = None
