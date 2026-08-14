from __future__ import annotations

import json
from datetime import UTC, date, datetime
from threading import Lock
from typing import Any

from app.domain import postgres_storage

_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()
RECOMPUTABLE_COST_STATUSES = (
    "",
    "unmapped_sku",
    "missing_cost",
    "missing_lot_cost",
    "fallback_active_sku_cost",
    "lot_unmatched_fallback",
    "lot_near_match_fallback",
    "missing_sku",
    "missing_planning_year",
    "missing_planning_anchor",
    "ambiguous_planning_anchor",
    "missing_lot",
    "unknown_lot",
    "ambiguous_lot_mapping",
    "multiple_lots_per_sales_line",
    "ambiguous_exact_lot",
    "missing_canonical_lot_lineage",
    "ambiguous_direct_lot_cost",
    "missing_cost_version",
    "missing_cost_row",
    "ambiguous_cost_row",
    "invalid_cost",
)


def is_recomputable_cost_status(value: Any) -> bool:
    return str(value or "").strip() in RECOMPUTABLE_COST_STATUSES


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
                    CREATE TABLE IF NOT EXISTS douano_sales_line_cost_snapshots (
                        id TEXT PRIMARY KEY,
                        source_type TEXT NOT NULL,
                        source_line_id BIGINT NOT NULL,
                        computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        company_id BIGINT NOT NULL DEFAULT 0,
                        line_date DATE,
                        douano_product_id BIGINT NOT NULL DEFAULT 0,
                        douano_sku TEXT NOT NULL DEFAULT '',
                        sku_id TEXT NOT NULL DEFAULT '',
                        bier_id TEXT NOT NULL DEFAULT '',
                        product_id TEXT NOT NULL DEFAULT '',
                        lot_number TEXT NOT NULL DEFAULT '',
                        lot_internal_number TEXT NOT NULL DEFAULT '',
                        lot_transaction_number TEXT NOT NULL DEFAULT '',
                        cost_source TEXT NOT NULL DEFAULT '',
                        cost_status TEXT NOT NULL DEFAULT '',
                        kostprijsversie_id TEXT NOT NULL DEFAULT '',
                        kostprijsversie_label TEXT NOT NULL DEFAULT '',
                        quantity NUMERIC NOT NULL DEFAULT 0,
                        net_revenue_ex NUMERIC NOT NULL DEFAULT 0,
                        cost_price_ex NUMERIC,
                        cost_total_ex NUMERIC NOT NULL DEFAULT 0,
                        margin_ex NUMERIC NOT NULL DEFAULT 0,
                        missing_cost BOOLEAN NOT NULL DEFAULT FALSE,
                        mapped BOOLEAN NOT NULL DEFAULT FALSE,
                        ignored BOOLEAN NOT NULL DEFAULT FALSE,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        UNIQUE (source_type, source_line_id)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_douano_cost_snapshots_source
                    ON douano_sales_line_cost_snapshots(source_type, source_line_id)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_douano_cost_snapshots_company_date
                    ON douano_sales_line_cost_snapshots(source_type, company_id, line_date)
                    """
                )
                cur.execute(
                    """
                    DO $$
                    BEGIN
                        IF to_regclass('public.douano_sales_line_cost_snapshot') IS NOT NULL THEN
                            EXECUTE $migrate$
                                INSERT INTO douano_sales_line_cost_snapshots(
                                    id, source_type, source_line_id, computed_at,
                                    bier_id, product_id, kostprijsversie_id,
                                    cost_price_ex, cost_total_ex, margin_ex,
                                    mapped, missing_cost, payload
                                )
                                SELECT
                                    'order:' || line_id::text,
                                    'order',
                                    line_id,
                                    computed_at,
                                    bier_id,
                                    product_id,
                                    kostprijsversie_id,
                                    cost_price_ex,
                                    cost_total_ex,
                                    margin_ex,
                                    TRUE,
                                    cost_price_ex IS NULL,
                                    jsonb_build_object('migrated_from', 'douano_sales_line_cost_snapshot')
                                FROM douano_sales_line_cost_snapshot
                                ON CONFLICT (source_type, source_line_id) DO NOTHING
                            $migrate$;
                        END IF;
                    END $$;
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
    upsert_line_snapshot(
        source_type="order",
        source_line_id=int(line_id or 0),
        company_id=0,
        line_date="",
        douano_product_id=0,
        douano_sku="",
        sku_id="",
        bier_id=str(bier_id or ""),
        product_id=str(product_id or ""),
        lot_number="",
        lot_internal_number="",
        lot_transaction_number="",
        cost_source="",
        cost_status="resolved" if cost_price_ex is not None else "missing_cost",
        kostprijsversie_id=str(kostprijsversie_id or ""),
        kostprijsversie_label="",
        quantity=0.0,
        net_revenue_ex=0.0,
        cost_price_ex=cost_price_ex,
        cost_total_ex=float(cost_total_ex or 0.0),
        margin_ex=float(margin_ex or 0.0),
        missing_cost=cost_price_ex is None,
        mapped=True,
        ignored=False,
        payload={"legacy_api": "upsert_snapshot"},
    )


def upsert_line_snapshot(
    *,
    source_type: str,
    source_line_id: int,
    company_id: int,
    line_date: str,
    douano_product_id: int,
    douano_sku: str,
    sku_id: str,
    bier_id: str,
    product_id: str,
    lot_number: str,
    lot_internal_number: str,
    lot_transaction_number: str,
    cost_source: str,
    cost_status: str,
    kostprijsversie_id: str,
    kostprijsversie_label: str,
    quantity: float,
    net_revenue_ex: float,
    cost_price_ex: float | None,
    cost_total_ex: float,
    margin_ex: float,
    missing_cost: bool,
    mapped: bool,
    ignored: bool,
    payload: dict[str, Any] | None = None,
) -> None:
    ensure_schema()
    source = str(source_type or "").strip().lower()
    if source not in {"order", "invoice"}:
        raise ValueError("source_type must be 'order' or 'invoice'.")
    lid = int(source_line_id or 0)
    if lid <= 0:
        return
    record_id = f"{source}:{lid}"
    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO douano_sales_line_cost_snapshots(
                    id, source_type, source_line_id, computed_at, company_id, line_date,
                    douano_product_id, douano_sku, sku_id, bier_id, product_id,
                    lot_number, lot_internal_number, lot_transaction_number,
                    cost_source, cost_status, kostprijsversie_id, kostprijsversie_label,
                    quantity, net_revenue_ex, cost_price_ex, cost_total_ex, margin_ex,
                    missing_cost, mapped, ignored, payload
                )
                VALUES (
                    %s, %s, %s, %s, %s, NULLIF(%s, '')::date,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s::jsonb
                )
                ON CONFLICT (source_type, source_line_id)
                DO UPDATE SET
                    computed_at = EXCLUDED.computed_at,
                    company_id = EXCLUDED.company_id,
                    line_date = EXCLUDED.line_date,
                    douano_product_id = EXCLUDED.douano_product_id,
                    douano_sku = EXCLUDED.douano_sku,
                    sku_id = EXCLUDED.sku_id,
                    bier_id = EXCLUDED.bier_id,
                    product_id = EXCLUDED.product_id,
                    lot_number = EXCLUDED.lot_number,
                    lot_internal_number = EXCLUDED.lot_internal_number,
                    lot_transaction_number = EXCLUDED.lot_transaction_number,
                    cost_source = EXCLUDED.cost_source,
                    cost_status = EXCLUDED.cost_status,
                    kostprijsversie_id = EXCLUDED.kostprijsversie_id,
                    kostprijsversie_label = EXCLUDED.kostprijsversie_label,
                    quantity = EXCLUDED.quantity,
                    net_revenue_ex = EXCLUDED.net_revenue_ex,
                    cost_price_ex = EXCLUDED.cost_price_ex,
                    cost_total_ex = EXCLUDED.cost_total_ex,
                    margin_ex = EXCLUDED.margin_ex,
                    missing_cost = EXCLUDED.missing_cost,
                    mapped = EXCLUDED.mapped,
                    ignored = EXCLUDED.ignored,
                    payload = EXCLUDED.payload
                """,
                (
                    record_id,
                    source,
                    lid,
                    now,
                    int(company_id or 0),
                    str(line_date or ""),
                    int(douano_product_id or 0),
                    str(douano_sku or ""),
                    str(sku_id or ""),
                    str(bier_id or ""),
                    str(product_id or ""),
                    str(lot_number or ""),
                    str(lot_internal_number or ""),
                    str(lot_transaction_number or ""),
                    str(cost_source or ""),
                    str(cost_status or ""),
                    str(kostprijsversie_id or ""),
                    str(kostprijsversie_label or ""),
                    float(quantity or 0.0),
                    float(net_revenue_ex or 0.0),
                    cost_price_ex,
                    float(cost_total_ex or 0.0),
                    float(margin_ex or 0.0),
                    bool(missing_cost),
                    bool(mapped),
                    bool(ignored),
                    json.dumps(payload if isinstance(payload, dict) else {}),
                ),
            )
        if not postgres_storage.in_transaction():
            conn.commit()


def upsert_line_snapshots(
    records: list[dict[str, Any]],
    *,
    preserve_finalized: bool = False,
    recompute_from_year: int = 0,
) -> int:
    ensure_schema()
    cleaned = [row for row in records if isinstance(row, dict) and int(row.get("source_line_id", 0) or 0) > 0]
    if preserve_finalized and int(recompute_from_year or 0) > 0:
        cutoff = date(int(recompute_from_year), 1, 1)
        protected: list[dict[str, Any]] = []
        for row in cleaned:
            raw_line_date = row.get("line_date")
            if isinstance(raw_line_date, datetime):
                line_date = raw_line_date.date()
            elif isinstance(raw_line_date, date):
                line_date = raw_line_date
            else:
                try:
                    line_date = date.fromisoformat(str(raw_line_date or "")[:10])
                except ValueError:
                    line_date = None
            if line_date is not None and line_date >= cutoff:
                protected.append(row)
        cleaned = protected
    if not cleaned:
        return 0
    now = datetime.now(UTC)
    values: list[tuple[Any, ...]] = []
    for row in cleaned:
        source = str(row.get("source_type", "") or "").strip().lower()
        if source not in {"order", "invoice"}:
            continue
        lid = int(row.get("source_line_id", 0) or 0)
        values.append(
            (
                f"{source}:{lid}",
                source,
                lid,
                now,
                int(row.get("company_id", 0) or 0),
                str(row.get("line_date", "") or ""),
                int(row.get("douano_product_id", 0) or 0),
                str(row.get("douano_sku", "") or ""),
                str(row.get("sku_id", "") or ""),
                str(row.get("bier_id", "") or ""),
                str(row.get("product_id", "") or ""),
                str(row.get("lot_number", "") or ""),
                str(row.get("lot_internal_number", "") or ""),
                str(row.get("lot_transaction_number", "") or ""),
                str(row.get("cost_source", "") or ""),
                str(row.get("cost_status", "") or ""),
                str(row.get("kostprijsversie_id", "") or ""),
                str(row.get("kostprijsversie_label", "") or ""),
                float(row.get("quantity", 0.0) or 0.0),
                float(row.get("net_revenue_ex", 0.0) or 0.0),
                row.get("cost_price_ex", None),
                float(row.get("cost_total_ex", 0.0) or 0.0),
                float(row.get("margin_ex", 0.0) or 0.0),
                bool(row.get("missing_cost", False)),
                bool(row.get("mapped", False)),
                bool(row.get("ignored", False)),
                json.dumps(row.get("payload") if isinstance(row.get("payload"), dict) else {}),
            )
        )
    if not values:
        return 0
    update_guard = ""
    if preserve_finalized:
        escaped = ", ".join(
            "'" + value.replace("'", "''") + "'"
            for value in RECOMPUTABLE_COST_STATUSES
        )
        year_guard = ""
        if int(recompute_from_year or 0) > 0:
            year_guard = (
                "douano_sales_line_cost_snapshots.line_date >= "
                f"DATE '{int(recompute_from_year)}-01-01' AND "
            )
        update_guard = (
            " WHERE "
            + year_guard
            + "douano_sales_line_cost_snapshots.cost_status IN ("
            + escaped
            + ")"
        )
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                f"""
                INSERT INTO douano_sales_line_cost_snapshots(
                    id, source_type, source_line_id, computed_at, company_id, line_date,
                    douano_product_id, douano_sku, sku_id, bier_id, product_id,
                    lot_number, lot_internal_number, lot_transaction_number,
                    cost_source, cost_status, kostprijsversie_id, kostprijsversie_label,
                    quantity, net_revenue_ex, cost_price_ex, cost_total_ex, margin_ex,
                    missing_cost, mapped, ignored, payload
                )
                VALUES (
                    %s, %s, %s, %s, %s, NULLIF(%s, '')::date,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s::jsonb
                )
                ON CONFLICT (source_type, source_line_id)
                DO UPDATE SET
                    computed_at = EXCLUDED.computed_at,
                    company_id = EXCLUDED.company_id,
                    line_date = EXCLUDED.line_date,
                    douano_product_id = EXCLUDED.douano_product_id,
                    douano_sku = EXCLUDED.douano_sku,
                    sku_id = EXCLUDED.sku_id,
                    bier_id = EXCLUDED.bier_id,
                    product_id = EXCLUDED.product_id,
                    lot_number = EXCLUDED.lot_number,
                    lot_internal_number = EXCLUDED.lot_internal_number,
                    lot_transaction_number = EXCLUDED.lot_transaction_number,
                    cost_source = EXCLUDED.cost_source,
                    cost_status = EXCLUDED.cost_status,
                    kostprijsversie_id = EXCLUDED.kostprijsversie_id,
                    kostprijsversie_label = EXCLUDED.kostprijsversie_label,
                    quantity = EXCLUDED.quantity,
                    net_revenue_ex = EXCLUDED.net_revenue_ex,
                    cost_price_ex = EXCLUDED.cost_price_ex,
                    cost_total_ex = EXCLUDED.cost_total_ex,
                    margin_ex = EXCLUDED.margin_ex,
                    missing_cost = EXCLUDED.missing_cost,
                    mapped = EXCLUDED.mapped,
                    ignored = EXCLUDED.ignored,
                    payload = EXCLUDED.payload
                {update_guard}
                """,
                values,
            )
            written = max(0, int(cur.rowcount or 0))
        if not postgres_storage.in_transaction():
            conn.commit()
    return written


def get_snapshot(line_id: int) -> dict[str, Any] | None:
    ensure_schema()
    lid = int(line_id or 0)
    if lid <= 0:
        return None
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT source_line_id, computed_at, bier_id, product_id, kostprijsversie_id, cost_price_ex, cost_total_ex, margin_ex
                FROM douano_sales_line_cost_snapshots
                WHERE source_type = 'order' AND source_line_id = %s
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


def load_line_snapshots(
    *,
    source_type: str,
    source_line_ids: list[int],
) -> dict[int, dict[str, Any]]:
    """Load frozen actual-cost selections for a detail view; never recompute them."""

    source = str(source_type or "").strip().lower()
    if source not in {"order", "invoice"}:
        raise ValueError("source_type must be 'order' or 'invoice'.")
    line_ids = sorted({int(value or 0) for value in source_line_ids if int(value or 0) > 0})
    if not line_ids:
        return {}
    with postgres_storage.connect() as conn:
        rows = conn.execute(
            """
            SELECT source_line_id, cost_price_ex, cost_total_ex, margin_ex,
                   missing_cost, mapped, ignored, cost_source, cost_status,
                   kostprijsversie_id, kostprijsversie_label, lot_number,
                   lot_internal_number, lot_transaction_number, bier_id,
                   product_id, sku_id, payload
            FROM douano_sales_line_cost_snapshots
            WHERE source_type = %s
              AND source_line_id = ANY(%s::bigint[])
            """,
            (source, line_ids),
        ).fetchall()
    result: dict[int, dict[str, Any]] = {}
    for row in rows:
        payload = row[17] if isinstance(row[17], dict) else {}
        line_id = int(row[0] or 0)
        result[line_id] = {
            **payload,
            "cost_price_ex": float(row[1]) if row[1] is not None else None,
            "cost_total_ex": float(row[2] or 0),
            "margin_ex": float(row[3] or 0),
            "missing_cost": bool(row[4]),
            "mapped": bool(row[5]),
            "ignored": bool(row[6]),
            "cost_source": str(row[7] or ""),
            "cost_status": str(row[8] or ""),
            "kostprijsversie_id": str(row[9] or ""),
            "kostprijsversie_label": str(row[10] or ""),
            "lot_number": str(row[11] or ""),
            "lot_internal_number": str(row[12] or ""),
            "lot_transaction_number": str(row[13] or ""),
            "bier_id": str(row[14] or ""),
            "product_id": str(row[15] or ""),
            "sku_id": str(row[16] or ""),
        }
    return result

