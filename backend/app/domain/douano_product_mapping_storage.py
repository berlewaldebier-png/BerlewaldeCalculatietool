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
                        product_group TEXT NOT NULL DEFAULT '',
                        alcohol_category TEXT NOT NULL DEFAULT '',
                        packaging_type TEXT NOT NULL DEFAULT '',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                # Existing installs may have an older schema; add column safely.
                cur.execute(
                    "ALTER TABLE douano_product_mapping ADD COLUMN IF NOT EXISTS product_group TEXT NOT NULL DEFAULT ''"
                )
                cur.execute(
                    "ALTER TABLE douano_product_mapping ADD COLUMN IF NOT EXISTS alcohol_category TEXT NOT NULL DEFAULT ''"
                )
                cur.execute(
                    "ALTER TABLE douano_product_mapping ADD COLUMN IF NOT EXISTS packaging_type TEXT NOT NULL DEFAULT ''"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_douano_product_mapping_sku ON douano_product_mapping(sku_id)"
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def upsert_mapping(
    *,
    douano_product_id: int,
    sku_id: str,
    product_group: str = "",
    alcohol_category: str = "",
    packaging_type: str = "",
) -> dict[str, Any]:
    ensure_schema()
    pid = int(douano_product_id or 0)
    if pid <= 0:
        raise ValueError("douano_product_id ontbreekt")
    sku = str(sku_id or "").strip()
    if not sku:
        raise ValueError("sku_id is verplicht")
    group = str(product_group or "").strip()
    alcohol = str(alcohol_category or "").strip()
    packaging = str(packaging_type or "").strip()
    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO douano_product_mapping(douano_product_id, sku_id, product_group, alcohol_category, packaging_type, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (douano_product_id)
                DO UPDATE SET
                    sku_id = EXCLUDED.sku_id,
                    product_group = EXCLUDED.product_group,
                    alcohol_category = EXCLUDED.alcohol_category,
                    packaging_type = EXCLUDED.packaging_type,
                    updated_at = EXCLUDED.updated_at
                """,
                (pid, sku, group, alcohol, packaging, now),
            )
        if not postgres_storage.in_transaction():
            conn.commit()
    return {
        "douano_product_id": pid,
        "sku_id": sku,
        "product_group": group,
        "alcohol_category": alcohol,
        "packaging_type": packaging,
        "updated_at": now.isoformat(),
    }


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
                SELECT douano_product_id, sku_id, product_group, alcohol_category, packaging_type, created_at, updated_at
                FROM douano_product_mapping
                ORDER BY updated_at DESC
                LIMIT %s
                """,
                (lim,),
            )
            rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for douano_product_id, sku_id, product_group, alcohol_category, packaging_type, created_at, updated_at in rows:
        out.append(
            {
                "douano_product_id": int(douano_product_id or 0),
                "sku_id": str(sku_id or ""),
                "product_group": str(product_group or ""),
                "alcohol_category": str(alcohol_category or ""),
                "packaging_type": str(packaging_type or ""),
                "created_at": created_at.isoformat() if created_at else "",
                "updated_at": updated_at.isoformat() if updated_at else "",
            }
        )
    return out


def update_classification_by_sku_id(
    *,
    sku_id: str,
    product_group: str = "",
    alcohol_category: str = "",
    packaging_type: str = "",
) -> dict[str, Any]:
    """Update classification fields for all mappings that point to `sku_id`.

    Productkoppeling (douano_product_mapping) is treated as the source of truth for
    classification used by ERP/margin/dashboard services.

    Returns a small report including the list of updated douano_product_id's.
    """
    ensure_schema()
    sku = str(sku_id or "").strip()
    if not sku:
        raise ValueError("sku_id is verplicht")

    group = str(product_group or "").strip()
    alcohol = str(alcohol_category or "").strip()
    packaging = str(packaging_type or "").strip()
    now = datetime.now(UTC)

    updated_ids: list[int] = []
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE douano_product_mapping
                SET product_group = %s,
                    alcohol_category = %s,
                    packaging_type = %s,
                    updated_at = %s
                WHERE sku_id = %s
                RETURNING douano_product_id
                """,
                (group, alcohol, packaging, now, sku),
            )
            rows = cur.fetchall() or []
            updated_ids = [int(pid or 0) for (pid,) in rows if int(pid or 0) > 0]
        if not postgres_storage.in_transaction():
            conn.commit()

    return {
        "sku_id": sku,
        "updated": len(updated_ids),
        "douano_product_ids": updated_ids,
        "updated_at": now.isoformat(),
    }


def delete_mappings_for_sku_id(*, sku_id: str) -> dict[str, Any]:
    """Delete product-mapping rows for a given sku_id (dev/admin only helper)."""
    ensure_schema()
    sku = str(sku_id or "").strip()
    if not sku:
        raise ValueError("sku_id is verplicht")

    deleted_ids: list[int] = []
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM douano_product_mapping
                WHERE sku_id = %s
                RETURNING douano_product_id
                """,
                (sku,),
            )
            rows = cur.fetchall() or []
            deleted_ids = [int(pid or 0) for (pid,) in rows if int(pid or 0) > 0]
        if not postgres_storage.in_transaction():
            conn.commit()

    return {"sku_id": sku, "deleted": len(deleted_ids), "douano_product_ids": deleted_ids}

