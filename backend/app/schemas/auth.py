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
    role: str
    is_active: bool
    created_at: str
    updated_at: str


class BootstrapAdminRequest(BaseModel):
    username: str = Field(min_length=3)
    password: str = Field(min_length=1)
    display_name: str = Field(min_length=2)


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


class MeResponse(BaseModel):
    authenticated: bool
    username: str
    display_name: str
    role: str


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=3)
    password: str = Field(min_length=1)
    display_name: str = Field(min_length=2)
    role: str = Field(default="user")


class CreateUserResponse(BaseModel):
    created: bool
    username: str
