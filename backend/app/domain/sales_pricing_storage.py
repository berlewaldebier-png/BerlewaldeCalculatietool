from __future__ import annotations

import json
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
                    CREATE TABLE IF NOT EXISTS sales_pricing_records (
                        id TEXT PRIMARY KEY,
                        record_type TEXT NOT NULL,
                        jaar INTEGER NOT NULL DEFAULT 0,
                        bier_id TEXT NOT NULL DEFAULT '',
                        product_id TEXT NOT NULL DEFAULT '',
                        verpakking TEXT NOT NULL DEFAULT '',
                        payload JSONB NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_sales_pricing_records_year
                    ON sales_pricing_records (jaar);
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_sales_pricing_records_type
                    ON sales_pricing_records (record_type);
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_sales_pricing_records_bier
                    ON sales_pricing_records (bier_id);
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_sales_pricing_records_product
                    ON sales_pricing_records (product_id);
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()

        _SCHEMA_READY = True

        # One-time best-effort migration from legacy `app_datasets` payload.
        try:
            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM sales_pricing_records")
                    count_row = cur.fetchone()
                    existing = int((count_row[0] if count_row else 0) or 0)
            if existing == 0:
                legacy = postgres_storage.load_app_dataset_payload("verkoopprijzen")
                if isinstance(legacy, list) and legacy:
                    save_dataset(legacy, overwrite=True)
                    postgres_storage.delete_app_dataset_row("verkoopprijzen")
        except Exception:
            # Migration is best-effort; schema must still be usable for new writes.
            pass


def load_dataset(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT payload FROM sales_pricing_records")
            rows = cur.fetchall()
    if not rows:
        return default_value
    out: list[dict[str, Any]] = []
    for (payload,) in rows:
        if isinstance(payload, str):
            payload = json.loads(payload)
        if isinstance(payload, dict):
            out.append(payload)
    return out


def save_dataset(data: Any, *, overwrite: bool = True) -> bool:
    ensure_schema()
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'verkoopprijzen': verwacht list.")

    records: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if overwrite:
                cur.execute("DELETE FROM sales_pricing_records")
            if records:
                params: list[tuple[Any, ...]] = []
                for row in records:
                    record_id = str(row.get("id", "") or "").strip()
                    if not record_id:
                        raise ValueError("Verkoopprijzen-record mist verplicht veld 'id'.")
                    record_type = str(row.get("record_type", "") or "").strip()
                    try:
                        jaar = int(row.get("jaar", 0) or 0)
                    except (TypeError, ValueError):
                        jaar = 0
                    bier_id = str(row.get("bier_id", "") or "")
                    product_id = str(row.get("product_id", "") or "")
                    verpakking = str(row.get("verpakking", "") or "")
                    params.append(
                        (
                            record_id,
                            record_type,
                            jaar,
                            bier_id,
                            product_id,
                            verpakking,
                            json.dumps(row, ensure_ascii=False),
                            now,
                        )
                    )
                cur.executemany(
                    """
                    INSERT INTO sales_pricing_records (id, record_type, jaar, bier_id, product_id, verpakking, payload, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id)
                    DO UPDATE SET
                        record_type = EXCLUDED.record_type,
                        jaar = EXCLUDED.jaar,
                        bier_id = EXCLUDED.bier_id,
                        product_id = EXCLUDED.product_id,
                        verpakking = EXCLUDED.verpakking,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    params,
                )
        if not postgres_storage.in_transaction():
            conn.commit()

    # Ensure we don't keep a stale legacy row around.
    try:
        postgres_storage.delete_app_dataset_row("verkoopprijzen")
    except Exception:
        pass
    return True

