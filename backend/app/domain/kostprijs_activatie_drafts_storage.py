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
                    CREATE TABLE IF NOT EXISTS kostprijs_activatie_drafts (
                        id TEXT PRIMARY KEY,
                        payload JSONB NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_kostprijs_activatie_drafts_updated_at ON kostprijs_activatie_drafts(updated_at)"
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True

        # One-time best-effort migration from legacy `app_datasets` payload.
        try:
            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM kostprijs_activatie_drafts")
                    count_row = cur.fetchone()
                    existing = int((count_row[0] if count_row else 0) or 0)
            if existing == 0:
                legacy = postgres_storage.load_app_dataset_payload("kostprijs-activatie-drafts")
                if isinstance(legacy, list) and legacy:
                    save_dataset(legacy, overwrite=True)
                    postgres_storage.delete_app_dataset_row("kostprijs-activatie-drafts")
        except Exception:
            # Migration is best-effort; schema must still be usable for new writes.
            pass


def load_dataset(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT payload FROM kostprijs_activatie_drafts ORDER BY updated_at DESC, id DESC"
            )
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
        raise ValueError("Ongeldig payload voor 'kostprijs-activatie-drafts': verwacht list.")

    rows: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if not overwrite:
                cur.execute("SELECT COUNT(*) FROM kostprijs_activatie_drafts")
                count_row = cur.fetchone()
                existing = int((count_row[0] if count_row else 0) or 0)
                if existing > 0:
                    return True

            if not rows and overwrite:
                cur.execute("DELETE FROM kostprijs_activatie_drafts")
            else:
                ids: list[str] = []
                params: list[tuple[Any, ...]] = []
                for row in rows:
                    draft_id = str(row.get("id", "") or "").strip()
                    if not draft_id:
                        raise ValueError("Kostprijs-activatie concept mist verplicht veld 'id'.")
                    ids.append(draft_id)
                    params.append((draft_id, json.dumps(row, ensure_ascii=False), now))

                if overwrite:
                    placeholders = ", ".join(["%s"] * len(ids))
                    cur.execute(
                        f"DELETE FROM kostprijs_activatie_drafts WHERE id NOT IN ({placeholders})",
                        tuple(ids),
                    )

                cur.executemany(
                    """
                    INSERT INTO kostprijs_activatie_drafts (id, payload, updated_at)
                    VALUES (%s, %s::jsonb, %s)
                    ON CONFLICT (id)
                    DO UPDATE SET
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    params,
                )
        if not postgres_storage.in_transaction():
            conn.commit()

    try:
        postgres_storage.delete_app_dataset_row("kostprijs-activatie-drafts")
    except Exception:
        pass
    return True

