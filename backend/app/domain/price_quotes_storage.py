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
        # Ensure master registry exists before we add FK constraints.
        from app.domain import product_registry_storage
        product_registry_storage.ensure_schema()
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
                    CREATE TABLE IF NOT EXISTS price_quote_lines (
                        id TEXT PRIMARY KEY,
                        quote_id TEXT NOT NULL REFERENCES price_quotes(id) ON DELETE CASCADE,
                        line_kind TEXT NOT NULL,
                        bier_id TEXT NOT NULL DEFAULT '',
                        kostprijsversie_id TEXT NOT NULL DEFAULT '',
                        product_id TEXT NOT NULL DEFAULT '',
                        product_type TEXT NOT NULL DEFAULT '',
                        verpakking_label TEXT NOT NULL DEFAULT '',
                        liters NUMERIC NOT NULL DEFAULT 0,
                        aantal NUMERIC NOT NULL DEFAULT 0,
                        korting_pct NUMERIC NOT NULL DEFAULT 0,
                        included BOOLEAN NOT NULL DEFAULT TRUE,
                        cost_at_quote NUMERIC NOT NULL DEFAULT 0,
                        sales_price_at_quote NUMERIC NOT NULL DEFAULT 0,
                        revenue_at_quote NUMERIC NOT NULL DEFAULT 0,
                        margin_at_quote NUMERIC NOT NULL DEFAULT 0,
                        target_margin_pct_at_quote NUMERIC NOT NULL DEFAULT 0,
                        channel_at_quote TEXT NOT NULL DEFAULT '',
                        sort_index INTEGER NOT NULL DEFAULT 0
                    );
                    """
                )
                # Sell-out was removed; drop legacy columns if they exist (dev-only data can be discarded).
                cur.execute("ALTER TABLE price_quote_lines DROP COLUMN IF EXISTS sell_out_price_at_quote;")
                cur.execute("ALTER TABLE price_quote_lines DROP COLUMN IF EXISTS sell_out_factor_at_quote;")
                # Enforce product_id integrity against the master registry.
                # NOT VALID keeps existing legacy rows from blocking startup; new rows are checked.
                cur.execute(
                    """
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_constraint WHERE conname = 'fk_price_quote_lines_product'
                        ) THEN
                            ALTER TABLE price_quote_lines
                            ADD CONSTRAINT fk_price_quote_lines_product
                            FOREIGN KEY (product_id) REFERENCES products_master(id) ON DELETE RESTRICT
                            NOT VALID;
                        END IF;
                    END $$;
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_price_quote_lines_quote ON price_quote_lines(quote_id)"
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS price_quote_staffels (
                        id TEXT PRIMARY KEY,
                        quote_id TEXT NOT NULL REFERENCES price_quotes(id) ON DELETE CASCADE,
                        product_id TEXT NOT NULL DEFAULT '',
                        product_type TEXT NOT NULL DEFAULT '',
                        liters NUMERIC NOT NULL DEFAULT 0,
                        korting_pct NUMERIC NOT NULL DEFAULT 0,
                        sort_index INTEGER NOT NULL DEFAULT 0
                    );
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_price_quote_staffels_quote ON price_quote_staffels(quote_id)"
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


def _strip_detail_sections(row: dict[str, Any]) -> dict[str, Any]:
    """Keep top-level quote fields in payload; store line items in normalized tables."""
    cleaned = dict(row)
    cleaned.pop("product_rows", None)
    cleaned.pop("beer_rows", None)
    cleaned.pop("staffels", None)
    return cleaned


def load_dataset(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, payload FROM price_quotes ORDER BY updated_at_ts ASC")
            quote_rows = cur.fetchall()
            cur.execute(
                """
                SELECT
                    id, quote_id, line_kind, bier_id, kostprijsversie_id, product_id, product_type,
                    verpakking_label, liters, aantal, korting_pct, included,
                    cost_at_quote, sales_price_at_quote, revenue_at_quote, margin_at_quote,
                    target_margin_pct_at_quote, channel_at_quote, sort_index
                FROM price_quote_lines
                ORDER BY quote_id, sort_index, id
                """
            )
            line_rows = cur.fetchall()
            cur.execute(
                """
                SELECT id, quote_id, product_id, product_type, liters, korting_pct, sort_index
                FROM price_quote_staffels
                ORDER BY quote_id, sort_index, id
                """
            )
            staffel_rows = cur.fetchall()

    if not quote_rows:
        return default_value

    product_lines_by_quote: dict[str, list[dict[str, Any]]] = {}
    beer_lines_by_quote: dict[str, list[dict[str, Any]]] = {}
    for (
        line_id,
        quote_id,
        line_kind,
        bier_id,
        kostprijsversie_id,
        product_id,
        product_type,
        verpakking_label,
        liters,
        aantal,
        korting_pct,
        included,
        cost_at_quote,
        sales_price_at_quote,
        revenue_at_quote,
        margin_at_quote,
        target_margin_pct_at_quote,
        channel_at_quote,
        _sort_index,
    ) in line_rows:
        payload: dict[str, Any] = {
            "id": str(line_id),
            "bier_id": str(bier_id or ""),
            "kostprijsversie_id": str(kostprijsversie_id or ""),
            "product_id": str(product_id or ""),
            "product_type": str(product_type or ""),
            "verpakking_label": str(verpakking_label or ""),
            "liters": float(liters or 0),
            "aantal": float(aantal or 0),
            "korting_pct": float(korting_pct or 0),
            "included": bool(included),
            "cost_at_quote": float(cost_at_quote or 0),
            "sales_price_at_quote": float(sales_price_at_quote or 0),
            "revenue_at_quote": float(revenue_at_quote or 0),
            "margin_at_quote": float(margin_at_quote or 0),
            "target_margin_pct_at_quote": float(target_margin_pct_at_quote or 0),
            "channel_at_quote": str(channel_at_quote or ""),
        }
        if str(line_kind or "") == "beer":
            beer_lines_by_quote.setdefault(str(quote_id), []).append(payload)
        else:
            # default to product rows
            product_lines_by_quote.setdefault(str(quote_id), []).append(payload)

    staffels_by_quote: dict[str, list[dict[str, Any]]] = {}
    for staffel_id, quote_id, product_id, product_type, liters, korting_pct, _sort_index in staffel_rows:
        staffels_by_quote.setdefault(str(quote_id), []).append(
            {
                "id": str(staffel_id),
                "product_id": str(product_id or ""),
                "product_type": str(product_type or ""),
                "liters": float(liters or 0),
                "korting_pct": float(korting_pct or 0),
            }
        )

    out: list[dict[str, Any]] = []
    for quote_id, payload in quote_rows:
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            continue
        merged = dict(payload)
        # Reattach detail sections.
        # Preserve the legacy record shape: product_rows + beer_rows are separate arrays.
        merged["product_rows"] = product_lines_by_quote.get(str(quote_id), [])
        merged["beer_rows"] = beer_lines_by_quote.get(str(quote_id), [])
        merged["staffels"] = staffels_by_quote.get(str(quote_id), [])
        out.append(merged)

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
                cur.execute("DELETE FROM price_quote_lines")
                cur.execute("DELETE FROM price_quote_staffels")
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
                            json.dumps(_strip_detail_sections(row), ensure_ascii=False),
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
                line_params: list[tuple[Any, ...]] = []
                staffel_params: list[tuple[Any, ...]] = []
                for row in records:
                    quote_id = str(row.get("id", "") or "").strip()
                    if not quote_id:
                        continue
                    sort_index = 0
                    for item in row.get("product_rows", []) if isinstance(row.get("product_rows", []), list) else []:
                        if not isinstance(item, dict):
                            continue
                        line_id = str(item.get("id", "") or "").strip()
                        if not line_id:
                            continue
                        line_params.append(
                            (
                                line_id,
                                quote_id,
                                "product",
                                str(item.get("bier_id", "") or ""),
                                str(item.get("kostprijsversie_id", "") or ""),
                                str(item.get("product_id", "") or ""),
                                str(item.get("product_type", "") or ""),
                                str(item.get("verpakking_label", "") or ""),
                                float(item.get("liters", 0) or 0),
                                float(item.get("aantal", 0) or 0),
                                float(item.get("korting_pct", 0) or 0),
                                bool(item.get("included", True)),
                                float(item.get("cost_at_quote", 0) or 0),
                                float(item.get("sales_price_at_quote", 0) or 0),
                                float(item.get("revenue_at_quote", 0) or 0),
                                float(item.get("margin_at_quote", 0) or 0),
                                float(item.get("target_margin_pct_at_quote", 0) or 0),
                                str(item.get("channel_at_quote", "") or ""),
                                int(sort_index),
                            )
                        )
                        sort_index += 1
                    for item in row.get("beer_rows", []) if isinstance(row.get("beer_rows", []), list) else []:
                        if not isinstance(item, dict):
                            continue
                        line_id = str(item.get("id", "") or "").strip()
                        if not line_id:
                            continue
                        line_params.append(
                            (
                                line_id,
                                quote_id,
                                "beer",
                                str(item.get("bier_id", "") or ""),
                                str(item.get("kostprijsversie_id", "") or ""),
                                str(item.get("product_id", "") or ""),
                                str(item.get("product_type", "") or ""),
                                str(item.get("verpakking_label", "") or ""),
                                float(item.get("liters", 0) or 0),
                                0.0,
                                float(item.get("korting_pct", 0) or 0),
                                bool(item.get("included", True)),
                                float(item.get("cost_at_quote", 0) or 0),
                                float(item.get("sales_price_at_quote", 0) or 0),
                                float(item.get("revenue_at_quote", 0) or 0),
                                float(item.get("margin_at_quote", 0) or 0),
                                float(item.get("target_margin_pct_at_quote", 0) or 0),
                                str(item.get("channel_at_quote", "") or ""),
                                int(sort_index),
                            )
                        )
                        sort_index += 1
                    staffel_index = 0
                    for item in row.get("staffels", []) if isinstance(row.get("staffels", []), list) else []:
                        if not isinstance(item, dict):
                            continue
                        staffel_id = str(item.get("id", "") or "").strip()
                        if not staffel_id:
                            continue
                        staffel_params.append(
                            (
                                staffel_id,
                                quote_id,
                                str(item.get("product_id", "") or ""),
                                str(item.get("product_type", "") or ""),
                                float(item.get("liters", 0) or 0),
                                float(item.get("korting_pct", 0) or 0),
                                int(staffel_index),
                            )
                        )
                        staffel_index += 1

                if line_params:
                    cur.executemany(
                        """
                        INSERT INTO price_quote_lines (
                            id, quote_id, line_kind, bier_id, kostprijsversie_id, product_id, product_type,
                            verpakking_label, liters, aantal, korting_pct, included,
                            cost_at_quote, sales_price_at_quote, revenue_at_quote, margin_at_quote,
                            target_margin_pct_at_quote, channel_at_quote, sort_index
                        )
                        VALUES (
                            %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s, %s
                        )
                        """,
                        line_params,
                    )
                if staffel_params:
                    cur.executemany(
                        """
                        INSERT INTO price_quote_staffels (id, quote_id, product_id, product_type, liters, korting_pct, sort_index)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        staffel_params,
                    )
        if not postgres_storage.in_transaction():
            conn.commit()

    # Ensure we don't keep a stale legacy row around.
    try:
        postgres_storage.delete_app_dataset_row("prijsvoorstellen")
    except Exception:
        pass
    return True
