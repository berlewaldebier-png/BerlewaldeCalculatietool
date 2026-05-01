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
                    CREATE TABLE IF NOT EXISTS bom_lines (
                        id TEXT PRIMARY KEY,
                        parent_article_id TEXT NOT NULL,
                        component_article_id TEXT NOT NULL,
                        quantity NUMERIC NOT NULL DEFAULT 0,
                        uom TEXT NOT NULL DEFAULT 'stuk',
                        scrap_pct NUMERIC NOT NULL DEFAULT 0,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS ix_bom_parent ON bom_lines(parent_article_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_bom_component ON bom_lines(component_article_id);")
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def load_dataset(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, parent_article_id, component_article_id, quantity, uom, scrap_pct, payload, updated_at
                FROM bom_lines
                ORDER BY parent_article_id ASC, updated_at ASC, id ASC
                """
            )
            rows = cur.fetchall() or []
    if not rows:
        return default_value
    out: list[dict[str, Any]] = []
    for rid, parent_id, component_id, quantity, uom, scrap_pct, payload, updated_at in rows:
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            payload = {}
        out.append(
            {
                **payload,
                "id": str(rid),
                "parent_article_id": str(parent_id or ""),
                "component_article_id": str(component_id or ""),
                "quantity": float(quantity or 0),
                "uom": str(uom or "stuk"),
                "scrap_pct": float(scrap_pct or 0),
                "updated_at": updated_at.isoformat() if updated_at else "",
            }
        )
    return out


def save_dataset(data: Any, *, overwrite: bool = True) -> bool:
    ensure_schema()
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'bom-lines': verwacht list.")
    now = datetime.now(UTC)
    rows: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    incoming_ids: list[str] = []
    params: list[tuple[Any, ...]] = []
    for row in rows:
        rid = str(row.get("id", "") or "").strip() or str(uuid4())
        parent_id = str(row.get("parent_article_id", "") or "").strip()
        component_id = str(row.get("component_article_id", "") or "").strip()
        try:
            quantity = float(row.get("quantity", 0) or 0.0)
        except (TypeError, ValueError):
            quantity = 0.0
        uom = str(row.get("uom", "stuk") or "stuk").strip().lower()
        try:
            scrap_pct = float(row.get("scrap_pct", 0) or 0.0)
        except (TypeError, ValueError):
            scrap_pct = 0.0
        payload = dict(row)
        incoming_ids.append(rid)
        params.append((rid, parent_id, component_id, float(quantity), uom, float(scrap_pct), json.dumps(payload), now))

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if overwrite:
                if incoming_ids:
                    cur.execute("DELETE FROM bom_lines WHERE id <> ALL(%s)", (incoming_ids,))
                else:
                    cur.execute("DELETE FROM bom_lines")
            if params:
                cur.executemany(
                    """
                    INSERT INTO bom_lines (id, parent_article_id, component_article_id, quantity, uom, scrap_pct, payload, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        parent_article_id = EXCLUDED.parent_article_id,
                        component_article_id = EXCLUDED.component_article_id,
                        quantity = EXCLUDED.quantity,
                        uom = EXCLUDED.uom,
                        scrap_pct = EXCLUDED.scrap_pct,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    params,
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return True

