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
                    CREATE TABLE IF NOT EXISTS price_quotes (
                        id TEXT PRIMARY KEY,
                        jaar INTEGER NOT NULL DEFAULT 0,
                        status TEXT NOT NULL DEFAULT '',
                        verloopt_op TEXT NOT NULL DEFAULT '',
                        created_at TEXT NOT NULL DEFAULT '',
                        updated_at TEXT NOT NULL DEFAULT '',
                        finalized_at TEXT NOT NULL DEFAULT '',
                        payload JSONB NOT NULL,
                        updated_at_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_price_quotes_year
                    ON price_quotes (jaar);
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_price_quotes_status
                    ON price_quotes (status);
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_price_quotes_expires
                    ON price_quotes (verloopt_op);
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()

        _SCHEMA_READY = True

        # One-time best-effort migration from legacy `app_datasets` payload.
        try:
            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM price_quotes")
                    count_row = cur.fetchone()
                    existing = int((count_row[0] if count_row else 0) or 0)
            if existing == 0:
                legacy = postgres_storage.load_app_dataset_payload("prijsvoorstellen")
                if isinstance(legacy, list) and legacy:
                    save_dataset(legacy, overwrite=True)
                    postgres_storage.delete_app_dataset_row("prijsvoorstellen")
        except Exception:
            # Migration is best-effort; schema must still be usable for new writes.
            pass


def load_dataset(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT payload FROM price_quotes")
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
        raise ValueError("Ongeldig payload voor 'prijsvoorstellen': verwacht list.")

    records: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if not overwrite:
                cur.execute("SELECT COUNT(*) FROM price_quotes")
                count_row = cur.fetchone()
                existing = int((count_row[0] if count_row else 0) or 0)
                if existing > 0:
                    return True
            else:
                cur.execute("DELETE FROM price_quotes")
            if records:
                params: list[tuple[Any, ...]] = []
                for row in records:
                    record_id = str(row.get("id", "") or "").strip()
                    if not record_id:
                        raise ValueError("Prijsvoorstel mist verplicht veld 'id'.")
                    try:
                        jaar = int(row.get("jaar", 0) or 0)
                    except (TypeError, ValueError):
                        jaar = 0
                    status = str(row.get("status", "") or "").strip().lower()
                    verloopt_op = str(row.get("verloopt_op", "") or "")
                    created_at = str(row.get("created_at", "") or "")
                    updated_at = str(row.get("updated_at", "") or "")
                    finalized_at = str(row.get("finalized_at", "") or "")
                    params.append(
                        (
                            record_id,
                            jaar,
                            status,
                            verloopt_op,
                            created_at,
                            updated_at,
                            finalized_at,
                            json.dumps(row, ensure_ascii=False),
                            now,
                        )
                    )
                cur.executemany(
                    """
                    INSERT INTO price_quotes
                        (id, jaar, status, verloopt_op, created_at, updated_at, finalized_at, payload, updated_at_ts)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id)
                    DO UPDATE SET
                        jaar = EXCLUDED.jaar,
                        status = EXCLUDED.status,
                        verloopt_op = EXCLUDED.verloopt_op,
                        created_at = EXCLUDED.created_at,
                        updated_at = EXCLUDED.updated_at,
                        finalized_at = EXCLUDED.finalized_at,
                        payload = EXCLUDED.payload,
                        updated_at_ts = EXCLUDED.updated_at_ts
                    """,
                    params,
                )
        if not postgres_storage.in_transaction():
            conn.commit()

    # Ensure we don't keep a stale legacy row around.
    try:
        postgres_storage.delete_app_dataset_row("prijsvoorstellen")
    except Exception:
        pass
    return True
