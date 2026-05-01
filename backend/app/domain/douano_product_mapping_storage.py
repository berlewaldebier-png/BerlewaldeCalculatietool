from __future__ import annotations

from datetime import UTC, datetime
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
                    CREATE TABLE IF NOT EXISTS douano_product_mapping (
                        douano_product_id BIGINT PRIMARY KEY,
                        sku_id TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_douano_product_mapping_sku ON douano_product_mapping(sku_id)"
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def upsert_mapping(*, douano_product_id: int, sku_id: str) -> dict[str, Any]:
    ensure_schema()
    pid = int(douano_product_id or 0)
    if pid <= 0:
        raise ValueError("douano_product_id ontbreekt")
    sku = str(sku_id or "").strip()
    if not sku:
        raise ValueError("sku_id is verplicht")
    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO douano_product_mapping(douano_product_id, sku_id, updated_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (douano_product_id)
                DO UPDATE SET
                    sku_id = EXCLUDED.sku_id,
                    updated_at = EXCLUDED.updated_at
                """,
                (pid, sku, now),
            )
        if not postgres_storage.in_transaction():
            conn.commit()
    return {"douano_product_id": pid, "sku_id": sku, "updated_at": now.isoformat()}


def delete_mapping(*, douano_product_id: int) -> bool:
    ensure_schema()
    pid = int(douano_product_id or 0)
    if pid <= 0:
        return False
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM douano_product_mapping WHERE douano_product_id = %s", (pid,))
            deleted = int(getattr(cur, "rowcount", 0) or 0) > 0
        if not postgres_storage.in_transaction():
            conn.commit()
    return deleted


def list_mappings(*, limit: int = 2000) -> list[dict[str, Any]]:
    ensure_schema()
    lim = max(1, min(int(limit or 2000), 10000))
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT douano_product_id, sku_id, created_at, updated_at
                FROM douano_product_mapping
                ORDER BY updated_at DESC
                LIMIT %s
                """,
                (lim,),
            )
            rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for douano_product_id, sku_id, created_at, updated_at in rows:
        out.append(
            {
                "douano_product_id": int(douano_product_id or 0),
                "sku_id": str(sku_id or ""),
                "created_at": created_at.isoformat() if created_at else "",
                "updated_at": updated_at.isoformat() if updated_at else "",
            }
        )
    return out

