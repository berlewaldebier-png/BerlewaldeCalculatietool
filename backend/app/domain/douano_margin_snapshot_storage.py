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
                    CREATE TABLE IF NOT EXISTS douano_sales_line_cost_snapshot (
                        line_id BIGINT PRIMARY KEY,
                        computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        bier_id TEXT NOT NULL DEFAULT '',
                        product_id TEXT NOT NULL DEFAULT '',
                        kostprijsversie_id TEXT NOT NULL DEFAULT '',
                        cost_price_ex NUMERIC,
                        cost_total_ex NUMERIC NOT NULL DEFAULT 0,
                        margin_ex NUMERIC NOT NULL DEFAULT 0
                    )
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def upsert_snapshot(
    *,
    line_id: int,
    bier_id: str,
    product_id: str,
    kostprijsversie_id: str,
    cost_price_ex: float | None,
    cost_total_ex: float,
    margin_ex: float,
) -> None:
    ensure_schema()
    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO douano_sales_line_cost_snapshot(
                    line_id, computed_at, bier_id, product_id, kostprijsversie_id, cost_price_ex, cost_total_ex, margin_ex
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (line_id)
                DO UPDATE SET
                    computed_at = EXCLUDED.computed_at,
                    bier_id = EXCLUDED.bier_id,
                    product_id = EXCLUDED.product_id,
                    kostprijsversie_id = EXCLUDED.kostprijsversie_id,
                    cost_price_ex = EXCLUDED.cost_price_ex,
                    cost_total_ex = EXCLUDED.cost_total_ex,
                    margin_ex = EXCLUDED.margin_ex
                """,
                (
                    int(line_id or 0),
                    now,
                    str(bier_id or ""),
                    str(product_id or ""),
                    str(kostprijsversie_id or ""),
                    cost_price_ex,
                    float(cost_total_ex or 0.0),
                    float(margin_ex or 0.0),
                ),
            )
        if not postgres_storage.in_transaction():
            conn.commit()


def get_snapshot(line_id: int) -> dict[str, Any] | None:
    ensure_schema()
    lid = int(line_id or 0)
    if lid <= 0:
        return None
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT line_id, computed_at, bier_id, product_id, kostprijsversie_id, cost_price_ex, cost_total_ex, margin_ex
                FROM douano_sales_line_cost_snapshot
                WHERE line_id = %s
                """,
                (lid,),
            )
            row = cur.fetchone()
    if not row:
        return None
    line_id, computed_at, bier_id, product_id, version_id, cost_price_ex, cost_total_ex, margin_ex = row
    return {
        "line_id": int(line_id or 0),
        "computed_at": computed_at.isoformat() if computed_at else "",
        "bier_id": str(bier_id or ""),
        "product_id": str(product_id or ""),
        "kostprijsversie_id": str(version_id or ""),
        "cost_price_ex": float(cost_price_ex) if cost_price_ex is not None else None,
        "cost_total_ex": float(cost_total_ex or 0.0),
        "margin_ex": float(margin_ex or 0.0),
    }

