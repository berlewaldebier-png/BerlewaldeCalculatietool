from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime
from threading import Lock
from typing import Any
from uuid import uuid4

from app.domain import postgres_storage


PBKDF2_ITERATIONS = 390_000
TEMP_ADMIN_USERNAME = "admin"
TEMP_ADMIN_PASSWORD = "admin"
_schema_ready = False
_schema_lock = Lock()
SESSION_COOKIE_NAME = "calculatietool_session"


def environment_name() -> str:
    return os.getenv("CALCULATIETOOL_ENV", "local").strip().lower() or "local"


def _is_local_environment() -> bool:
    return environment_name() in {"local", "dev", "development"}


def _auth_secret() -> str:
    secret = os.getenv("CALCULATIETOOL_AUTH_SECRET", "").strip()
    if secret:
        return secret
    if _is_local_environment():
        # Local-only convenience; T/Prod must provide an explicit secret.
        return "local-dev-secret-change-me"
    raise RuntimeError("CALCULATIETOOL_AUTH_SECRET ontbreekt voor niet-local omgeving.")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode((text + padding).encode("ascii"))


def issue_session_token(*, username: str, display_name: str, role: str, expires_in_seconds: int = 60 * 60 * 12) -> str:
    now = int(datetime.utcnow().timestamp())
    payload = {
        "v": 1,
        "username": username,
        "display_name": display_name,
        "role": role,
        "iat": now,
        "exp": now + int(expires_in_seconds),
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    body = _b64url_encode(payload_bytes)
    sig = hmac.new(_auth_secret().encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64url_encode(sig)}"


def verify_session_token(token: str) -> dict[str, Any] | None:
    raw = str(token or "").strip()
    if "." not in raw:
        return None
    body, sig_text = raw.split(".", 1)
    try:
        expected = hmac.new(_auth_secret().encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
        provided = _b64url_decode(sig_text)
        if not hmac.compare_digest(expected, provided):
            return None
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
        if not isinstance(payload, dict):
            return None
        exp = int(payload.get("exp", 0) or 0)
        now = int(datetime.utcnow().timestamp())
        if exp <= 0 or now >= exp:
            return None
        username = str(payload.get("username", "") or "").strip()
        display_name = str(payload.get("display_name", "") or "").strip()
        role = str(payload.get("role", "") or "").strip()
        if not username or not display_name or not role:
            return None
        return {"username": username, "display_name": display_name, "role": role}
    except Exception:
        return None


def auth_enabled() -> bool:
    return os.getenv("CALCULATIETOOL_AUTH_ENABLED", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def auth_mode() -> str:
    return os.getenv("CALCULATIETOOL_AUTH_MODE", "prepared").strip().lower() or "prepared"


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, encoded_hash: str) -> bool:
    try:
        algorithm, raw_iterations, salt, expected = encoded_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            int(raw_iterations),
        ).hex()
        return hmac.compare_digest(digest, expected)
    except Exception:
        return False


def ensure_schema() -> None:
    global _schema_ready
    if not postgres_storage.database_url():
        return

    if _schema_ready:
        return

    with _schema_lock:
        if _schema_ready:
            return
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS app_users (
                        id TEXT PRIMARY KEY,
                        username TEXT NOT NULL UNIQUE,
                        display_name TEXT NOT NULL,
                        role TEXT NOT NULL,
                        password_hash TEXT NOT NULL,
                        is_active BOOLEAN NOT NULL DEFAULT TRUE,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            conn.commit()
        _schema_ready = True


def list_users() -> list[dict[str, Any]]:
    ensure_schema()
    if not postgres_storage.database_url():
        return []

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, username, display_name, role, is_active, created_at, updated_at
                FROM app_users
                ORDER BY username
                """
            )
            rows = cur.fetchall()

    users: list[dict[str, Any]] = []
    for row in rows:
        users.append(
            {
                "id": row[0],
                "username": row[1],
                "display_name": row[2],
                "role": row[3],
                "is_active": row[4],
                "created_at": row[5].isoformat() if hasattr(row[5], "isoformat") else str(row[5]),
                "updated_at": row[6].isoformat() if hasattr(row[6], "isoformat") else str(row[6]),
            }
        )
    return users


def authenticate_user(username: str, password: str) -> dict[str, Any] | None:
    normalized_username = username.strip()
    ensure_schema()
    if not postgres_storage.database_url():
        return None

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT username, display_name, role, password_hash, is_active
                FROM app_users
                WHERE LOWER(username) = LOWER(%s)
                """,
                (normalized_username,),
            )
            row = cur.fetchone()

    if not row:
        return None

    db_username, display_name, role, password_hash, is_active = row
    if not is_active or not verify_password(password, password_hash):
        return None

    return {
        "authenticated": True,
        "username": db_username,
        "display_name": display_name,
        "role": role,
    }


def authenticate_local_temp_admin(username: str, password: str) -> dict[str, Any] | None:
    """
    Local-only convenience: allow admin/admin for localhost dev without bootstrapping users.
    Never enabled in T/Prod.
    """
    if not _is_local_environment():
        return None
    if str(username or "").strip().lower() != TEMP_ADMIN_USERNAME:
        return None
    if str(password or "") != TEMP_ADMIN_PASSWORD:
        return None
    return {"authenticated": True, "username": "admin", "display_name": "Beheerder", "role": "admin"}


def has_any_admin() -> bool:
    return any(user.get("role") == "admin" for user in list_users())


def require_bootstrap_token(provided: str) -> None:
    if _is_local_environment():
        return
    expected = os.getenv("CALCULATIETOOL_BOOTSTRAP_TOKEN", "").strip()
    if not expected:
        raise RuntimeError("CALCULATIETOOL_BOOTSTRAP_TOKEN ontbreekt.")
    if not hmac.compare_digest(str(provided or "").strip(), expected):
        raise RuntimeError("Ongeldige bootstrap token.")


def create_user(*, username: str, password: str, display_name: str, role: str = "user") -> dict[str, Any]:
    ensure_schema()
    if not postgres_storage.database_url():
        raise RuntimeError("PostgreSQL-configuratie ontbreekt.")
    normalized = username.strip()
    if len(normalized) < 3:
        raise ValueError("Username moet minimaal 3 tekens zijn.")
    if len(password) < 10 and not _is_local_environment():
        raise ValueError("Wachtwoord moet minimaal 10 tekens zijn.")
    if role not in {"admin", "user"}:
        raise ValueError("Ongeldige rol.")
    now = datetime.utcnow()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM app_users WHERE username = %s", (normalized,))
            existing = cur.fetchone()
            if existing:
                raise ValueError("Username bestaat al.")
            cur.execute(
                """
                INSERT INTO app_users (id, username, display_name, role, password_hash, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (str(uuid4()), normalized, display_name, role, _hash_password(password), True, now, now),
            )
        conn.commit()
    return {"created": True, "username": normalized}


def bootstrap_admin(username: str, password: str, display_name: str) -> dict[str, Any]:
    ensure_schema()
    if not postgres_storage.database_url():
        raise RuntimeError("PostgreSQL-configuratie ontbreekt voor users bootstrap.")
    if len(password) < 10 and not _is_local_environment():
        raise RuntimeError("Wachtwoord moet minimaal 10 tekens zijn.")

    now = datetime.utcnow()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM app_users WHERE username = %s", (username,))
            existing = cur.fetchone()
            if existing:
                return {"created": False, "reason": "exists", "username": username}

            cur.execute(
                """
                INSERT INTO app_users (
                    id, username, display_name, role, password_hash, is_active, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid4()),
                    username,
                    display_name,
                    "admin",
                    _hash_password(password),
                    True,
                    now,
                    now,
                ),
            )
        conn.commit()
    return {"created": True, "reason": "created", "username": username}


def auth_status() -> dict[str, Any]:
    users = list_users()
    return {
        "environment": environment_name(),
        "enabled": auth_enabled(),
        "mode": auth_mode(),
        "postgres_configured": bool(postgres_storage.database_url()),
        "storage_provider": postgres_storage.storage_provider(),
        "user_count": len(users),
        "has_admin": any(user.get("role") == "admin" for user in users),
    }
