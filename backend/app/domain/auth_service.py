from __future__ import annotations

import base64
import hmac
import hashlib
import json
import logging
import os
import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any
from uuid import uuid4

import httpx
import jwt

from app.domain import postgres_storage


logger = logging.getLogger(__name__)
PBKDF2_ITERATIONS = 390_000
PASSWORD_RESET_CODE_LENGTH = 6
PASSWORD_RESET_CODE_EXPIRES_MINUTES = 10
PASSWORD_RESET_MAX_ATTEMPTS = 5
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
    if not secret:
        secret = os.getenv("AUTH_SECRET", "").strip()
    if secret:
        return secret
    if _is_local_environment():
        # Local-only convenience; T/Prod must provide an explicit secret.
        return "local-dev-secret-change-me"
    raise RuntimeError("CALCULATIETOOL_AUTH_SECRET ontbreekt voor niet-local omgeving.")


def _normalize_email(email: str | None) -> str | None:
    if email is None:
        return None
    normalized = str(email or "").strip()
    if not normalized:
        return None
    return normalized.lower()


def _b64url_encode(raw: bytes) -> str:
    """Kept for backwards compatibility with legacy code if needed."""
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(text: str) -> bytes:
    """Kept for backwards compatibility with legacy code if needed."""
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode((text + padding).encode("ascii"))


def issue_session_token(*, username: str, display_name: str, role: str, expires_in_seconds: int = 60 * 60 * 12) -> str:
    """Issue a properly signed JWT session token using PyJWT."""
    payload = {
        "username": username,
        "display_name": display_name,
        "role": role,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(seconds=int(expires_in_seconds)),
    }
    return jwt.encode(payload, _auth_secret(), algorithm="HS256")


def verify_session_token(token: str) -> dict[str, Any] | None:
    """Verify and decode JWT session token."""
    try:
        raw = str(token or "").strip()
        if not raw:
            return None
        
        payload = jwt.decode(raw, _auth_secret(), algorithms=["HS256"])
        
        username = str(payload.get("username", "") or "").strip()
        display_name = str(payload.get("display_name", "") or "").strip()
        role = str(payload.get("role", "") or "").strip()
        
        if not username or not display_name or not role:
            return None
        
        return {"username": username, "display_name": display_name, "role": role}
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
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


def issue_password_reset_token(*, email: str, expires_in_seconds: int = 60 * 60) -> str:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        raise ValueError("Emailadres is verplicht.")

    payload = {
        "purpose": "password_reset",
        "email": normalized_email,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(seconds=int(expires_in_seconds)),
    }
    return jwt.encode(payload, _auth_secret(), algorithm="HS256")


def verify_password_reset_token(token: str) -> str | None:
    try:
        raw = str(token or "").strip()
        if not raw:
            return None

        payload = jwt.decode(raw, _auth_secret(), algorithms=["HS256"])
        if payload.get("purpose") != "password_reset":
            return None

        return _normalize_email(str(payload.get("email", "") or ""))
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception:
        return None


def _microsoft_mail_config() -> dict[str, str]:
    return {
        "tenant_id": os.getenv("MICROSOFT_TENANT_ID", "").strip(),
        "client_id": os.getenv("MICROSOFT_CLIENT_ID", "").strip(),
        "client_secret": os.getenv("MICROSOFT_CLIENT_SECRET", "").strip(),
        "mail_from": os.getenv("MICROSOFT_MAIL_FROM", "").strip(),
    }


def _microsoft_mail_configured() -> bool:
    config = _microsoft_mail_config()
    return all(config.values())


def _get_graph_access_token(config: dict[str, str]) -> str:
    token_url = f"https://login.microsoftonline.com/{config['tenant_id']}/oauth2/v2.0/token"
    response = httpx.post(
        token_url,
        data={
            "client_id": config["client_id"],
            "client_secret": config["client_secret"],
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=15.0,
    )
    response.raise_for_status()
    payload = response.json()
    token = str(payload.get("access_token", "") or "")
    if not token:
        raise RuntimeError("Microsoft Graph access token ontbreekt.")
    return token


def _send_password_reset_email(*, email: str, display_name: str, code: str) -> None:
    config = _microsoft_mail_config()
    missing = [key for key, value in config.items() if not value]
    if missing:
        raise RuntimeError(f"Microsoft mail configuratie ontbreekt: {', '.join(missing)}")

    access_token = _get_graph_access_token(config)
    sender = urllib.parse.quote(config["mail_from"])
    send_url = f"https://graph.microsoft.com/v1.0/users/{sender}/sendMail"
    recipient_name = display_name.strip() or email
    message = {
        "message": {
            "subject": "CalculatieTool wachtwoord resetcode",
            "body": {
                "contentType": "Text",
                "content": (
                    f"Hallo {recipient_name},\n\n"
                    f"Je resetcode voor CalculatieTool is: {code}\n\n"
                    f"Deze code is {PASSWORD_RESET_CODE_EXPIRES_MINUTES} minuten geldig. "
                    "Heb je dit niet aangevraagd? Dan kun je deze mail negeren."
                ),
            },
            "toRecipients": [
                {
                    "emailAddress": {
                        "address": email,
                    }
                }
            ],
        },
        "saveToSentItems": "false",
    }
    response = httpx.post(
        send_url,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json=message,
        timeout=15.0,
    )
    response.raise_for_status()


def _generate_password_reset_code() -> str:
    return f"{secrets.randbelow(10 ** PASSWORD_RESET_CODE_LENGTH):0{PASSWORD_RESET_CODE_LENGTH}d}"


def _hash_reset_code(code: str, salt: str) -> str:
    normalized = str(code or "").strip()
    return hashlib.sha256(f"{salt}:{normalized}".encode("utf-8")).hexdigest()


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def request_password_reset(email: str) -> dict[str, Any]:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        raise ValueError("Emailadres is verplicht.")

    ensure_schema()
    user = _get_user_by_email(normalized_email)
    if not user or not bool(user.get("is_active")):
        return {"requested": True, "code_sent": False, "debug_code": None}

    code = _generate_password_reset_code()
    salt = secrets.token_hex(16)
    code_hash = _hash_reset_code(code, salt)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=PASSWORD_RESET_CODE_EXPIRES_MINUTES)

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE app_password_reset_codes
                SET used_at = %s
                WHERE user_id = %s AND used_at IS NULL
                """,
                (now, user["id"]),
            )
            cur.execute(
                """
                INSERT INTO app_password_reset_codes (
                    id, user_id, email, code_hash, salt, attempts, expires_at, used_at, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, %s)
                """,
                (str(uuid4()), user["id"], normalized_email, code_hash, salt, 0, expires_at, now),
            )
        conn.commit()

    mail_configured = _microsoft_mail_configured()
    if mail_configured:
        try:
            _send_password_reset_email(
                email=normalized_email,
                display_name=str(user.get("display_name", "") or ""),
                code=code,
            )
            return {"requested": True, "code_sent": True, "debug_code": None}
        except Exception as exc:
            logger.exception("Password reset email failed")
            raise RuntimeError("Resetmail versturen is niet gelukt.") from exc

    if _is_local_environment():
        return {"requested": True, "code_sent": False, "debug_code": code}

    raise RuntimeError("Resetmail versturen is niet gelukt.")


def reset_password(email: str, code: str, new_password: str, password_confirm: str) -> bool:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        raise ValueError("Emailadres is verplicht.")
    if str(new_password or "") != str(password_confirm or ""):
        raise ValueError("Wachtwoorden komen niet overeen.")
    if len(new_password) < 10 and not _is_local_environment():
        raise ValueError("Wachtwoord moet minimaal 10 tekens zijn.")

    ensure_schema()
    user = _get_user_by_email(normalized_email)
    if not user or not bool(user.get("is_active")):
        raise ValueError("Gebruiker niet gevonden.")

    now = datetime.now(timezone.utc)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code_hash, salt, attempts, expires_at, used_at
                FROM app_password_reset_codes
                WHERE user_id = %s AND LOWER(email) = LOWER(%s)
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (user["id"], normalized_email),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("Ongeldige of verlopen resetcode.")

            reset_id, expected_hash, salt, attempts, expires_at, used_at = row
            if used_at is not None or _as_utc(expires_at) <= now:
                raise ValueError("Ongeldige of verlopen resetcode.")
            if int(attempts or 0) >= PASSWORD_RESET_MAX_ATTEMPTS:
                raise ValueError("Te veel pogingen. Vraag een nieuwe resetcode aan.")

            provided_hash = _hash_reset_code(code, str(salt or ""))
            if not hmac.compare_digest(str(expected_hash or ""), provided_hash):
                cur.execute(
                    """
                    UPDATE app_password_reset_codes
                    SET attempts = attempts + 1
                    WHERE id = %s
                    """,
                    (reset_id,),
                )
                conn.commit()
                raise ValueError("Ongeldige of verlopen resetcode.")

            cur.execute(
                "UPDATE app_users SET password_hash = %s, updated_at = %s WHERE id = %s",
                (_hash_password(new_password), now, user["id"]),
            )
            cur.execute(
                """
                UPDATE app_password_reset_codes
                SET used_at = %s
                WHERE id = %s
                """,
                (now, reset_id),
            )
        conn.commit()

    return True


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
                        email TEXT,
                        role TEXT NOT NULL,
                        password_hash TEXT NOT NULL,
                        is_active BOOLEAN NOT NULL DEFAULT TRUE,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute(
                    "ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email TEXT"
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS app_password_reset_codes (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
                        email TEXT NOT NULL,
                        code_hash TEXT NOT NULL,
                        salt TEXT NOT NULL,
                        attempts INTEGER NOT NULL DEFAULT 0,
                        expires_at TIMESTAMPTZ NOT NULL,
                        used_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_app_password_reset_codes_user_created
                    ON app_password_reset_codes(user_id, created_at DESC)
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
                SELECT id, username, display_name, email, role, is_active, created_at, updated_at
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
                "email": str(row[3] or "") or None,
                "role": row[4],
                "is_active": row[5],
                "created_at": row[6].isoformat() if hasattr(row[6], "isoformat") else str(row[6]),
                "updated_at": row[7].isoformat() if hasattr(row[7], "isoformat") else str(row[7]),
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


def _get_user_by_email(email: str) -> dict[str, Any] | None:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        return None

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, display_name, role, password_hash, is_active, email"
                " FROM app_users WHERE LOWER(email) = LOWER(%s)",
                (normalized_email,),
            )
            row = cur.fetchone()

    if not row:
        return None

    return {
        "id": row[0],
        "username": row[1],
        "display_name": row[2],
        "role": row[3],
        "password_hash": row[4],
        "is_active": row[5],
        "email": row[6],
    }


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


def create_user(*, username: str, password: str, display_name: str, email: str | None = None, role: str = "user") -> dict[str, Any]:
    ensure_schema()
    if not postgres_storage.database_url():
        raise RuntimeError("PostgreSQL-configuratie ontbreekt.")
    normalized = username.strip()
    normalized_email = _normalize_email(email)
    if len(normalized) < 3:
        raise ValueError("Username moet minimaal 3 tekens zijn.")
    if len(password) < 10 and not _is_local_environment():
        raise ValueError("Wachtwoord moet minimaal 10 tekens zijn.")
    if normalized_email and "@" not in normalized_email:
        raise ValueError("Emailadres ongeldig.")
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
                INSERT INTO app_users (id, username, display_name, email, role, password_hash, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid4()),
                    normalized,
                    display_name,
                    normalized_email,
                    role,
                    _hash_password(password),
                    True,
                    now,
                    now,
                ),
            )
        conn.commit()
    return {"created": True, "username": normalized}


def bootstrap_admin(username: str, password: str, display_name: str, email: str | None = None) -> dict[str, Any]:
    ensure_schema()
    if not postgres_storage.database_url():
        raise RuntimeError("PostgreSQL-configuratie ontbreekt voor users bootstrap.")
    if len(password) < 10 and not _is_local_environment():
        raise RuntimeError("Wachtwoord moet minimaal 10 tekens zijn.")
    normalized_email = _normalize_email(email)
    if normalized_email and "@" not in normalized_email:
        raise RuntimeError("Emailadres ongeldig.")

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
                    id, username, display_name, email, role, password_hash, is_active, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid4()),
                    username,
                    display_name,
                    normalized_email,
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


def update_user(
    *,
    username: str,
    email: str | None = None,
    email_provided: bool = False,
    display_name: str | None = None,
    role: str | None = None,
    is_active: bool | None = None,
) -> dict[str, Any]:
    normalized_username = username.strip()
    normalized_email = _normalize_email(email) if email_provided else None
    if normalized_email and "@" not in normalized_email:
        raise ValueError("Emailadres ongeldig.")

    normalized_display_name = display_name.strip() if display_name is not None else None
    if display_name is not None and len(normalized_display_name) < 2:
        raise ValueError("Naam moet minimaal 2 tekens zijn.")
    if role is not None and role not in {"admin", "user"}:
        raise ValueError("Ongeldige rol.")

    now = datetime.utcnow()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM app_users WHERE LOWER(username) = LOWER(%s)",
                (normalized_username,),
            )
            user_row = cur.fetchone()
            if not user_row:
                raise ValueError("Gebruiker niet gevonden.")

            user_id = user_row[0]

            # Build dynamic update query
            updates = []
            params = []

            if normalized_display_name is not None:
                updates.append("display_name = %s")
                params.append(normalized_display_name)

            if email_provided:
                updates.append("email = %s")
                params.append(normalized_email)

            if role is not None:
                updates.append("role = %s")
                params.append(role)

            if is_active is not None:
                updates.append("is_active = %s")
                params.append(is_active)

            if updates:
                updates.append("updated_at = %s")
                params.append(now)
                params.append(user_id)

                query = f"UPDATE app_users SET {', '.join(updates)} WHERE id = %s"
                cur.execute(query, params)

        conn.commit()

    return {"updated": True, "username": normalized_username}
