from __future__ import annotations

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import uuid4

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
                    CREATE TABLE IF NOT EXISTS skus (
                        id TEXT PRIMARY KEY,
                        beer_id TEXT NOT NULL DEFAULT '',
                        format_article_id TEXT NOT NULL DEFAULT '',
                        code TEXT NOT NULL DEFAULT '',
                        name TEXT NOT NULL DEFAULT '',
                        active BOOLEAN NOT NULL DEFAULT TRUE,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT skus_beer_format_ux UNIQUE (beer_id, format_article_id)
                    );
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS ix_skus_beer ON skus(beer_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_skus_format ON skus(format_article_id);")
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def load_dataset(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, beer_id, format_article_id, code, name, active, payload, updated_at
                FROM skus
                ORDER BY active DESC, name ASC, id ASC
                """
            )
            rows = cur.fetchall() or []
    if not rows:
        return default_value
    out: list[dict[str, Any]] = []
    for rid, beer_id, format_article_id, code, name, active, payload, updated_at in rows:
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            payload = {}
        out.append(
            {
                **payload,
                "id": str(rid),
                "beer_id": str(beer_id or ""),
                "format_article_id": str(format_article_id or ""),
                "code": str(code or ""),
                "name": str(name or ""),
                "naam": str(name or ""),
                "active": bool(active),
                "actief": bool(active),
                "updated_at": updated_at.isoformat() if updated_at else "",
            }
        )
    return out


def save_dataset(data: Any, *, overwrite: bool = True) -> bool:
    ensure_schema()
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'skus': verwacht list.")
    now = datetime.now(UTC)
    rows: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    incoming_ids: list[str] = []
    params: list[tuple[Any, ...]] = []
    for row in rows:
        rid = str(row.get("id", "") or "").strip() or str(uuid4())
        beer_id = str(row.get("beer_id", "") or "").strip()
        format_article_id = str(row.get("format_article_id", "") or "").strip()
        code = str(row.get("code", "") or "").strip()
        name = str(row.get("name", row.get("naam", "")) or "").strip()
        active = bool(row.get("active", row.get("actief", True)))
        payload = {k: v for (k, v) in row.items() if k not in {"naam"}}
        incoming_ids.append(rid)
        params.append((rid, beer_id, format_article_id, code, name, active, json.dumps(payload), now))

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if overwrite:
                if incoming_ids:
                    cur.execute("DELETE FROM skus WHERE id <> ALL(%s)", (incoming_ids,))
                else:
                    cur.execute("DELETE FROM skus")
            if params:
                cur.executemany(
                    """
                    INSERT INTO skus (id, beer_id, format_article_id, code, name, active, payload, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        beer_id = EXCLUDED.beer_id,
                        format_article_id = EXCLUDED.format_article_id,
                        code = EXCLUDED.code,
                        name = EXCLUDED.name,
                        active = EXCLUDED.active,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    params,
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return True

