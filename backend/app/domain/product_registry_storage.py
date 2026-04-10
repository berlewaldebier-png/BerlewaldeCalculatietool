from __future__ import annotations

import json
from threading import Lock
from typing import Any

from app.domain import postgres_storage
from app.utils.storage import build_model_a_canonical_datasets

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
                    CREATE TABLE IF NOT EXISTS products_master (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL DEFAULT '',
                        kind TEXT NOT NULL DEFAULT '',
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                # Existing dev DBs may already have an older `products_master` without these columns.
                # We prefer additive migrations here so seed import can run without manual DB resets.
                cur.execute(
                    "ALTER TABLE products_master ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''"
                )
                cur.execute(
                    "ALTER TABLE products_master ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT ''"
                )
                cur.execute(
                    "ALTER TABLE products_master ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb"
                )
                cur.execute(
                    "ALTER TABLE products_master ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_products_master_kind ON products_master(kind);"
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def rebuild_registry(*, validate_constraints: bool = True) -> dict[str, Any]:
    """
    Build the `products_master` registry from canonical Model-A products.

    This table is the single source of truth for "which product ids exist".
    Other table-backed stores may reference it via FK constraints.
    """
    ensure_schema()

    canonical = build_model_a_canonical_datasets()
    products = canonical.get("products", [])
    if not isinstance(products, list):
        products = []

    rows: list[dict[str, Any]] = [p for p in products if isinstance(p, dict)]

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM products_master")
            if rows:
                params: list[tuple[Any, ...]] = []
                for row in rows:
                    pid = str(row.get("id", "") or "").strip()
                    if not pid:
                        continue
                    name = str(row.get("name", "") or "")
                    kind = str(row.get("kind", "") or "")
                    payload = row
                    if isinstance(payload, str):
                        try:
                            payload = json.loads(payload)
                        except Exception:
                            payload = {"raw": payload}
                    params.append((pid, name, kind, json.dumps(payload)))
                if params:
                    cur.executemany(
                        """
                        INSERT INTO products_master (id, name, kind, payload)
                        VALUES (%s, %s, %s, %s::jsonb)
                        """,
                        params,
                    )
        if not postgres_storage.in_transaction():
            conn.commit()

    # `validate_constraints` is reserved for future integrity checks.
    return {"ok": True, "count": len(rows), "validate_constraints": bool(validate_constraints)}
