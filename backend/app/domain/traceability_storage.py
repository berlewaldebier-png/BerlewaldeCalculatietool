from __future__ import annotations

import json
from dataclasses import dataclass
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
                    CREATE TABLE IF NOT EXISTS trace_lots (
                        id TEXT PRIMARY KEY,
                        kind TEXT NOT NULL DEFAULT 'lot',
                        article_id TEXT NOT NULL DEFAULT '',
                        sku_id TEXT NOT NULL DEFAULT '',
                        quantity NUMERIC NOT NULL DEFAULT 0,
                        uom TEXT NOT NULL DEFAULT 'stuk',
                        received_at TIMESTAMPTZ,
                        supplier TEXT NOT NULL DEFAULT '',
                        external_ref TEXT NOT NULL DEFAULT '',
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS ix_trace_lots_kind ON trace_lots(kind);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_trace_lots_article ON trace_lots(article_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_trace_lots_sku ON trace_lots(sku_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_trace_lots_received ON trace_lots(received_at);")

                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS trace_batches (
                        id TEXT PRIMARY KEY,
                        kind TEXT NOT NULL DEFAULT 'batch',
                        sku_id TEXT NOT NULL DEFAULT '',
                        quantity NUMERIC NOT NULL DEFAULT 0,
                        uom TEXT NOT NULL DEFAULT 'stuk',
                        produced_at TIMESTAMPTZ,
                        external_ref TEXT NOT NULL DEFAULT '',
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS ix_trace_batches_kind ON trace_batches(kind);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_trace_batches_sku ON trace_batches(sku_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_trace_batches_produced ON trace_batches(produced_at);")

                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS trace_batch_consumptions (
                        id TEXT PRIMARY KEY,
                        batch_id TEXT NOT NULL,
                        component_lot_id TEXT NOT NULL DEFAULT '',
                        component_batch_id TEXT NOT NULL DEFAULT '',
                        component_article_id TEXT NOT NULL DEFAULT '',
                        component_sku_id TEXT NOT NULL DEFAULT '',
                        quantity NUMERIC NOT NULL DEFAULT 0,
                        uom TEXT NOT NULL DEFAULT 'stuk',
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        FOREIGN KEY (batch_id) REFERENCES trace_batches(id) ON DELETE CASCADE
                    );
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS ix_trace_cons_batch ON trace_batch_consumptions(batch_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_trace_cons_lot ON trace_batch_consumptions(component_lot_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_trace_cons_batch_in ON trace_batch_consumptions(component_batch_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_trace_cons_article ON trace_batch_consumptions(component_article_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_trace_cons_sku ON trace_batch_consumptions(component_sku_id);")
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


@dataclass(frozen=True)
class TraceabilityDatasets:
    lots: str = "trace-lots"
    batches: str = "trace-batches"
    consumptions: str = "trace-batch-consumptions"


DATASETS = TraceabilityDatasets()


def _row_payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def load_lots(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, kind, article_id, sku_id, quantity, uom, received_at, supplier, external_ref, payload, updated_at
                FROM trace_lots
                ORDER BY received_at DESC NULLS LAST, updated_at DESC, id ASC
                """
            )
            rows = cur.fetchall() or []
    if not rows:
        return default_value
    out: list[dict[str, Any]] = []
    for (
        rid,
        kind,
        article_id,
        sku_id,
        quantity,
        uom,
        received_at,
        supplier,
        external_ref,
        payload,
        updated_at,
    ) in rows:
        data = _row_payload(payload)
        out.append(
            {
                **data,
                "id": str(rid),
                "kind": str(kind or "lot"),
                "article_id": str(article_id or ""),
                "sku_id": str(sku_id or ""),
                "quantity": float(quantity or 0),
                "uom": str(uom or "stuk"),
                "received_at": received_at.isoformat() if hasattr(received_at, "isoformat") and received_at else "",
                "supplier": str(supplier or ""),
                "external_ref": str(external_ref or ""),
                "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") and updated_at else "",
            }
        )
    return out


def save_lots(data: Any, *, overwrite: bool = True) -> bool:
    ensure_schema()
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'trace-lots': verwacht list.")
    now = datetime.now(UTC)
    rows: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    incoming_ids: list[str] = []
    params: list[tuple[Any, ...]] = []
    for row in rows:
        rid = str(row.get("id", "") or "").strip() or str(uuid4())
        kind = str(row.get("kind", "lot") or "lot").strip().lower()
        article_id = str(row.get("article_id", "") or "").strip()
        sku_id = str(row.get("sku_id", "") or "").strip()
        try:
            quantity = float(row.get("quantity", 0) or 0.0)
        except (TypeError, ValueError):
            quantity = 0.0
        uom = str(row.get("uom", "stuk") or "stuk").strip().lower()
        received_at_raw = str(row.get("received_at", "") or "").strip()
        received_at = None
        if received_at_raw:
            try:
                received_at = datetime.fromisoformat(received_at_raw.replace("Z", "+00:00"))
            except Exception:
                received_at = None
        supplier = str(row.get("supplier", "") or "").strip()
        external_ref = str(row.get("external_ref", "") or "").strip()
        payload = dict(row)
        incoming_ids.append(rid)
        params.append(
            (
                rid,
                kind,
                article_id,
                sku_id,
                float(quantity),
                uom,
                received_at,
                supplier,
                external_ref,
                json.dumps(payload),
                now,
            )
        )

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if overwrite:
                if incoming_ids:
                    cur.execute("DELETE FROM trace_lots WHERE id <> ALL(%s)", (incoming_ids,))
                else:
                    cur.execute("DELETE FROM trace_lots")
            if params:
                cur.executemany(
                    """
                    INSERT INTO trace_lots (
                        id, kind, article_id, sku_id, quantity, uom, received_at, supplier, external_ref, payload, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        kind = EXCLUDED.kind,
                        article_id = EXCLUDED.article_id,
                        sku_id = EXCLUDED.sku_id,
                        quantity = EXCLUDED.quantity,
                        uom = EXCLUDED.uom,
                        received_at = EXCLUDED.received_at,
                        supplier = EXCLUDED.supplier,
                        external_ref = EXCLUDED.external_ref,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    params,
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return True


def load_batches(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, kind, sku_id, quantity, uom, produced_at, external_ref, payload, updated_at
                FROM trace_batches
                ORDER BY produced_at DESC NULLS LAST, updated_at DESC, id ASC
                """
            )
            rows = cur.fetchall() or []
    if not rows:
        return default_value
    out: list[dict[str, Any]] = []
    for rid, kind, sku_id, quantity, uom, produced_at, external_ref, payload, updated_at in rows:
        data = _row_payload(payload)
        out.append(
            {
                **data,
                "id": str(rid),
                "kind": str(kind or "batch"),
                "sku_id": str(sku_id or ""),
                "quantity": float(quantity or 0),
                "uom": str(uom or "stuk"),
                "produced_at": produced_at.isoformat() if hasattr(produced_at, "isoformat") and produced_at else "",
                "external_ref": str(external_ref or ""),
                "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") and updated_at else "",
            }
        )
    return out


def save_batches(data: Any, *, overwrite: bool = True) -> bool:
    ensure_schema()
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'trace-batches': verwacht list.")
    now = datetime.now(UTC)
    rows: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    incoming_ids: list[str] = []
    params: list[tuple[Any, ...]] = []
    for row in rows:
        rid = str(row.get("id", "") or "").strip() or str(uuid4())
        kind = str(row.get("kind", "batch") or "batch").strip().lower()
        sku_id = str(row.get("sku_id", "") or "").strip()
        try:
            quantity = float(row.get("quantity", 0) or 0.0)
        except (TypeError, ValueError):
            quantity = 0.0
        uom = str(row.get("uom", "stuk") or "stuk").strip().lower()
        produced_at_raw = str(row.get("produced_at", "") or "").strip()
        produced_at = None
        if produced_at_raw:
            try:
                produced_at = datetime.fromisoformat(produced_at_raw.replace("Z", "+00:00"))
            except Exception:
                produced_at = None
        external_ref = str(row.get("external_ref", "") or "").strip()
        payload = dict(row)
        incoming_ids.append(rid)
        params.append((rid, kind, sku_id, float(quantity), uom, produced_at, external_ref, json.dumps(payload), now))

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if overwrite:
                if incoming_ids:
                    cur.execute("DELETE FROM trace_batches WHERE id <> ALL(%s)", (incoming_ids,))
                else:
                    cur.execute("DELETE FROM trace_batches")
            if params:
                cur.executemany(
                    """
                    INSERT INTO trace_batches (
                        id, kind, sku_id, quantity, uom, produced_at, external_ref, payload, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        kind = EXCLUDED.kind,
                        sku_id = EXCLUDED.sku_id,
                        quantity = EXCLUDED.quantity,
                        uom = EXCLUDED.uom,
                        produced_at = EXCLUDED.produced_at,
                        external_ref = EXCLUDED.external_ref,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    params,
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return True


def load_consumptions(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, batch_id, component_lot_id, component_batch_id, component_article_id, component_sku_id, quantity, uom, payload, updated_at
                FROM trace_batch_consumptions
                ORDER BY updated_at DESC, id ASC
                """
            )
            rows = cur.fetchall() or []
    if not rows:
        return default_value
    out: list[dict[str, Any]] = []
    for rid, batch_id, lot_id, batch_in_id, article_id, sku_id, quantity, uom, payload, updated_at in rows:
        data = _row_payload(payload)
        out.append(
            {
                **data,
                "id": str(rid),
                "batch_id": str(batch_id or ""),
                "component_lot_id": str(lot_id or ""),
                "component_batch_id": str(batch_in_id or ""),
                "component_article_id": str(article_id or ""),
                "component_sku_id": str(sku_id or ""),
                "quantity": float(quantity or 0),
                "uom": str(uom or "stuk"),
                "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") and updated_at else "",
            }
        )
    return out


def save_consumptions(data: Any, *, overwrite: bool = True) -> bool:
    ensure_schema()
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'trace-batch-consumptions': verwacht list.")
    now = datetime.now(UTC)
    rows: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    incoming_ids: list[str] = []
    params: list[tuple[Any, ...]] = []
    for row in rows:
        rid = str(row.get("id", "") or "").strip() or str(uuid4())
        batch_id = str(row.get("batch_id", "") or "").strip()
        component_lot_id = str(row.get("component_lot_id", "") or "").strip()
        component_batch_id = str(row.get("component_batch_id", "") or "").strip()
        component_article_id = str(row.get("component_article_id", "") or "").strip()
        component_sku_id = str(row.get("component_sku_id", "") or "").strip()
        try:
            quantity = float(row.get("quantity", 0) or 0.0)
        except (TypeError, ValueError):
            quantity = 0.0
        uom = str(row.get("uom", "stuk") or "stuk").strip().lower()
        payload = dict(row)
        incoming_ids.append(rid)
        params.append(
            (
                rid,
                batch_id,
                component_lot_id,
                component_batch_id,
                component_article_id,
                component_sku_id,
                float(quantity),
                uom,
                json.dumps(payload),
                now,
            )
        )

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if overwrite:
                if incoming_ids:
                    cur.execute("DELETE FROM trace_batch_consumptions WHERE id <> ALL(%s)", (incoming_ids,))
                else:
                    cur.execute("DELETE FROM trace_batch_consumptions")
            if params:
                cur.executemany(
                    """
                    INSERT INTO trace_batch_consumptions (
                        id, batch_id, component_lot_id, component_batch_id, component_article_id, component_sku_id, quantity, uom, payload, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        batch_id = EXCLUDED.batch_id,
                        component_lot_id = EXCLUDED.component_lot_id,
                        component_batch_id = EXCLUDED.component_batch_id,
                        component_article_id = EXCLUDED.component_article_id,
                        component_sku_id = EXCLUDED.component_sku_id,
                        quantity = EXCLUDED.quantity,
                        uom = EXCLUDED.uom,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    params,
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return True

