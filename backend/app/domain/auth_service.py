from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime
from typing import Any
from uuid import uuid4

from app.domain import postgres_storage


PBKDF2_ITERATIONS = 390_000


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
    if not postgres_storage.database_url():
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


def bootstrap_admin(username: str, password: str, display_name: str) -> dict[str, Any]:
    ensure_schema()
    if not postgres_storage.database_url():
        raise RuntimeError("PostgreSQL-configuratie ontbreekt voor users bootstrap.")

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
        "enabled": auth_enabled(),
        "mode": auth_mode(),
        "postgres_configured": bool(postgres_storage.database_url()),
        "storage_provider": postgres_storage.storage_provider(),
        "user_count": len(users),
        "has_admin": any(user.get("role") == "admin" for user in users),
    }
