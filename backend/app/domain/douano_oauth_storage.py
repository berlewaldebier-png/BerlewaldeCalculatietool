from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from threading import Lock
from typing import Any

from app.domain import postgres_storage


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()


def ensure_schema() -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    with _SCHEMA_LOCK:
        if _SCHEMA_READY:
            return
        postgres_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS douano_oauth_tokens (
                        provider TEXT PRIMARY KEY,
                        base_url TEXT NOT NULL,
                        access_token TEXT NOT NULL,
                        refresh_token TEXT NOT NULL,
                        token_type TEXT NOT NULL DEFAULT '',
                        scope TEXT NOT NULL DEFAULT '',
                        expires_at TIMESTAMPTZ NOT NULL,
                        raw_payload JSONB NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def upsert_tokens(
    *,
    provider: str,
    base_url: str,
    access_token: str,
    refresh_token: str,
    token_type: str = "",
    scope: str = "",
    expires_in_seconds: int = 0,
    raw_payload: dict[str, Any] | None = None,
) -> None:
    ensure_schema()
    prov = str(provider or "").strip().lower()
    if not prov:
        raise ValueError("provider ontbreekt")
    if not access_token or not refresh_token:
        raise ValueError("tokens ontbreken")

    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=max(0, int(expires_in_seconds or 0)))
    payload = raw_payload if isinstance(raw_payload, dict) else {}

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO douano_oauth_tokens (
                    provider,
                    base_url,
                    access_token,
                    refresh_token,
                    token_type,
                    scope,
                    expires_at,
                    raw_payload,
                    updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                ON CONFLICT (provider)
                DO UPDATE SET
                    base_url = EXCLUDED.base_url,
                    access_token = EXCLUDED.access_token,
                    refresh_token = EXCLUDED.refresh_token,
                    token_type = EXCLUDED.token_type,
                    scope = EXCLUDED.scope,
                    expires_at = EXCLUDED.expires_at,
                    raw_payload = EXCLUDED.raw_payload,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    prov,
                    str(base_url or "").strip(),
                    str(access_token),
                    str(refresh_token),
                    str(token_type or ""),
                    str(scope or ""),
                    expires_at,
                    json.dumps(payload, ensure_ascii=True),
                    now,
                ),
            )
        if not postgres_storage.in_transaction():
            conn.commit()


def get_tokens(provider: str = "douano") -> dict[str, Any] | None:
    ensure_schema()
    prov = str(provider or "").strip().lower()
    if not prov:
        return None
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT base_url, access_token, refresh_token, token_type, scope, expires_at, raw_payload, created_at, updated_at
                FROM douano_oauth_tokens
                WHERE provider = %s
                """,
                (prov,),
            )
            row = cur.fetchone()
    if not row:
        return None
    base_url, access_token, refresh_token, token_type, scope, expires_at, raw, created_at, updated_at = row
    raw_payload: Any = raw
    if isinstance(raw_payload, str):
        try:
            raw_payload = json.loads(raw_payload)
        except Exception:
            raw_payload = {}
    return {
        "provider": prov,
        "base_url": str(base_url or ""),
        "access_token": str(access_token or ""),
        "refresh_token": str(refresh_token or ""),
        "token_type": str(token_type or ""),
        "scope": str(scope or ""),
        "expires_at": expires_at.isoformat() if hasattr(expires_at, "isoformat") and expires_at else "",
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") and created_at else "",
        "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") and updated_at else "",
        "raw_payload": raw_payload if isinstance(raw_payload, dict) else {},
    }

