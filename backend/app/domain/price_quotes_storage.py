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
                        created_at TIMESTAMPTZ NULL,
                        updated_at TIMESTAMPTZ NULL,
                        finalized_at TIMESTAMPTZ NULL,
                        payload JSONB NOT NULL,
                        updated_at_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                # Legacy dev DBs may still have these timestamps as TEXT; normalize to TIMESTAMPTZ.
                # Important: columns must allow NULL because legacy rows used ''.
                cur.execute(
                    """
                    DO $$
                    BEGIN
                      IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'price_quotes'
                          AND column_name = 'created_at'
                          AND data_type = 'text'
                      ) THEN
                        ALTER TABLE price_quotes ALTER COLUMN created_at DROP DEFAULT;
                        ALTER TABLE price_quotes ALTER COLUMN created_at DROP NOT NULL;
                        ALTER TABLE price_quotes
                          ALTER COLUMN created_at TYPE TIMESTAMPTZ
                          USING NULLIF(created_at::text,'')::timestamptz;
                      END IF;

                      IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'price_quotes'
                          AND column_name = 'updated_at'
                          AND data_type = 'text'
                      ) THEN
                        ALTER TABLE price_quotes ALTER COLUMN updated_at DROP DEFAULT;
                        ALTER TABLE price_quotes ALTER COLUMN updated_at DROP NOT NULL;
                        ALTER TABLE price_quotes
                          ALTER COLUMN updated_at TYPE TIMESTAMPTZ
                          USING NULLIF(updated_at::text,'')::timestamptz;
                      END IF;

                      IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'price_quotes'
                          AND column_name = 'finalized_at'
                          AND data_type = 'text'
                      ) THEN
                        ALTER TABLE price_quotes ALTER COLUMN finalized_at DROP DEFAULT;
                        ALTER TABLE price_quotes ALTER COLUMN finalized_at DROP NOT NULL;
                        ALTER TABLE price_quotes
                          ALTER COLUMN finalized_at TYPE TIMESTAMPTZ
                          USING NULLIF(finalized_at::text,'')::timestamptz;
                      END IF;
                    END $$;
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

                # Phase: variants/scenarios (sub-offertes) + 2 periods (intro + standaard).
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS price_quote_variants (
                        id TEXT PRIMARY KEY,
                        quote_id TEXT NOT NULL REFERENCES price_quotes(id) ON DELETE CASCADE,
                        name TEXT NOT NULL DEFAULT '',
                        channel_code TEXT NOT NULL DEFAULT '',
                        return_pct NUMERIC NOT NULL DEFAULT 0,
                        sort_index INTEGER NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ NULL,
                        updated_at TIMESTAMPTZ NULL
                    );
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_price_quote_variants_quote ON price_quote_variants(quote_id)"
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS price_quote_variant_periods (
                        id TEXT PRIMARY KEY,
                        variant_id TEXT NOT NULL REFERENCES price_quote_variants(id) ON DELETE CASCADE,
                        period_index INTEGER NOT NULL,
                        label TEXT NOT NULL DEFAULT '',
                        start_date TEXT NOT NULL DEFAULT '',
                        end_date TEXT NOT NULL DEFAULT '',
                        UNIQUE(variant_id, period_index)
                    );
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_price_quote_variant_periods_variant ON price_quote_variant_periods(variant_id)"
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS price_quote_variant_lines (
                        id TEXT PRIMARY KEY,
                        variant_id TEXT NOT NULL REFERENCES price_quote_variants(id) ON DELETE CASCADE,
                        line_kind TEXT NOT NULL,
                        bier_id TEXT NOT NULL DEFAULT '',
                        kostprijsversie_id TEXT NOT NULL DEFAULT '',
                        product_id TEXT NOT NULL DEFAULT '',
                        product_type TEXT NOT NULL DEFAULT '',
                        verpakking_label TEXT NOT NULL DEFAULT '',
                        liters NUMERIC NOT NULL DEFAULT 0,
                        aantal NUMERIC NOT NULL DEFAULT 0,
                        included BOOLEAN NOT NULL DEFAULT TRUE,
                        korting_pct_p1 NUMERIC NOT NULL DEFAULT 0,
                        korting_pct_p2 NUMERIC NOT NULL DEFAULT 0,
                        sell_in_price_override_p1 NUMERIC NOT NULL DEFAULT 0,
                        sell_in_price_override_p2 NUMERIC NOT NULL DEFAULT 0,
                        sort_index INTEGER NOT NULL DEFAULT 0
                    );
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_price_quote_variant_lines_variant ON price_quote_variant_lines(variant_id)"
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS price_quote_variant_staffels (
                        id TEXT PRIMARY KEY,
                        variant_id TEXT NOT NULL REFERENCES price_quote_variants(id) ON DELETE CASCADE,
                        product_id TEXT NOT NULL DEFAULT '',
                        product_type TEXT NOT NULL DEFAULT '',
                        liters NUMERIC NOT NULL DEFAULT 0,
                        korting_pct NUMERIC NOT NULL DEFAULT 0,
                        sort_index INTEGER NOT NULL DEFAULT 0
                    );
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_price_quote_variant_staffels_variant ON price_quote_variant_staffels(variant_id)"
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
            cur.execute(
                """
                SELECT
                    id,
                    jaar,
                    status,
                    verloopt_op,
                    created_at,
                    updated_at,
                    finalized_at,
                    payload
                FROM price_quotes
                ORDER BY updated_at_ts ASC, id
                """
            )
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
            cur.execute(
                """
                SELECT
                    id, quote_id, name, channel_code, return_pct, sort_index, created_at, updated_at
                FROM price_quote_variants
                ORDER BY quote_id, sort_index, id
                """
            )
            variant_rows = cur.fetchall()
            cur.execute(
                """
                SELECT
                    id, variant_id, period_index, label, start_date, end_date
                FROM price_quote_variant_periods
                ORDER BY variant_id, period_index, id
                """
            )
            variant_period_rows = cur.fetchall()
            cur.execute(
                """
                SELECT
                    id, variant_id, line_kind, bier_id, kostprijsversie_id, product_id, product_type,
                    verpakking_label, liters, aantal, included,
                    korting_pct_p1, korting_pct_p2,
                    sell_in_price_override_p1, sell_in_price_override_p2,
                    sort_index
                FROM price_quote_variant_lines
                ORDER BY variant_id, sort_index, id
                """
            )
            variant_line_rows = cur.fetchall()
            cur.execute(
                """
                SELECT
                    id, variant_id, product_id, product_type, liters, korting_pct, sort_index
                FROM price_quote_variant_staffels
                ORDER BY variant_id, sort_index, id
                """
            )
            variant_staffel_rows = cur.fetchall()

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

    variants_by_quote: dict[str, list[dict[str, Any]]] = {}
    periods_by_variant: dict[str, list[dict[str, Any]]] = {}
    for period_id, variant_id, period_index, label, start_date, end_date in variant_period_rows:
        periods_by_variant.setdefault(str(variant_id), []).append(
            {
                "id": str(period_id),
                "period_index": int(period_index or 0),
                "label": str(label or ""),
                "start_date": str(start_date or ""),
                "end_date": str(end_date or ""),
            }
        )

    product_lines_by_variant: dict[str, list[dict[str, Any]]] = {}
    beer_lines_by_variant: dict[str, list[dict[str, Any]]] = {}
    for (
        line_id,
        variant_id,
        line_kind,
        bier_id,
        kostprijsversie_id,
        product_id,
        product_type,
        verpakking_label,
        liters,
        aantal,
        included,
        korting_pct_p1,
        korting_pct_p2,
        sell_in_price_override_p1,
        sell_in_price_override_p2,
        _sort_index,
    ) in variant_line_rows:
        payload: dict[str, Any] = {
            "id": str(line_id),
            "bier_id": str(bier_id or ""),
            "kostprijsversie_id": str(kostprijsversie_id or ""),
            "product_id": str(product_id or ""),
            "product_type": str(product_type or ""),
            "verpakking_label": str(verpakking_label or ""),
            "liters": float(liters or 0),
            "aantal": float(aantal or 0),
            "included": bool(included),
            "korting_pct_p1": float(korting_pct_p1 or 0),
            "korting_pct_p2": float(korting_pct_p2 or 0),
            "sell_in_price_override_p1": float(sell_in_price_override_p1 or 0),
            "sell_in_price_override_p2": float(sell_in_price_override_p2 or 0),
        }
        if str(line_kind or "") == "beer":
            beer_lines_by_variant.setdefault(str(variant_id), []).append(payload)
        else:
            product_lines_by_variant.setdefault(str(variant_id), []).append(payload)

    staffels_by_variant: dict[str, list[dict[str, Any]]] = {}
    for staffel_id, variant_id, product_id, product_type, liters, korting_pct, _sort_index in variant_staffel_rows:
        staffels_by_variant.setdefault(str(variant_id), []).append(
            {
                "id": str(staffel_id),
                "product_id": str(product_id or ""),
                "product_type": str(product_type or ""),
                "liters": float(liters or 0),
                "korting_pct": float(korting_pct or 0),
            }
        )

    for (
        variant_id,
        quote_id,
        name,
        channel_code,
        return_pct,
        sort_index,
        created_at,
        updated_at,
    ) in variant_rows:
        vid = str(variant_id)
        variants_by_quote.setdefault(str(quote_id), []).append(
            {
                "id": vid,
                "name": str(name or ""),
                "channel_code": str(channel_code or ""),
                "return_pct": float(return_pct or 0),
                "sort_index": int(sort_index or 0),
                "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") and created_at else "",
                "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") and updated_at else "",
                "periods": periods_by_variant.get(vid, []),
                "product_rows": product_lines_by_variant.get(vid, []),
                "beer_rows": beer_lines_by_variant.get(vid, []),
                "staffels": staffels_by_variant.get(vid, []),
            }
        )

    out: list[dict[str, Any]] = []
    for (
        quote_id,
        jaar,
        status,
        verloopt_op,
        created_at,
        updated_at,
        finalized_at,
        payload,
    ) in quote_rows:
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            continue
        # Columns are canonical; payload is a view cache. Always override payload with column values.
        merged = dict(payload)
        merged["id"] = str(quote_id)
        merged["jaar"] = int(jaar or 0)
        merged["status"] = str(status or "")
        merged["verloopt_op"] = str(verloopt_op or "")
        merged["created_at"] = created_at.isoformat() if hasattr(created_at, "isoformat") and created_at else ""
        merged["updated_at"] = updated_at.isoformat() if hasattr(updated_at, "isoformat") and updated_at else ""
        merged["finalized_at"] = finalized_at.isoformat() if hasattr(finalized_at, "isoformat") and finalized_at else ""
        # Reattach detail sections.
        # Preserve the legacy record shape: product_rows + beer_rows are separate arrays.
        merged["product_rows"] = product_lines_by_quote.get(str(quote_id), [])
        merged["beer_rows"] = beer_lines_by_quote.get(str(quote_id), [])
        merged["staffels"] = staffels_by_quote.get(str(quote_id), [])
        merged["variants"] = variants_by_quote.get(str(quote_id), [])
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
            if records:
                years_in_payload: set[int] = set()
                quote_ids_by_year: dict[int, set[str]] = {}
                params: list[tuple[Any, ...]] = []
                for row in records:
                    record_id = str(row.get("id", "") or "").strip()
                    if not record_id:
                        raise ValueError("Prijsvoorstel mist verplicht veld 'id'.")
                    try:
                        jaar = int(row.get("jaar", 0) or 0)
                    except (TypeError, ValueError):
                        jaar = 0
                    years_in_payload.add(jaar)
                    quote_ids_by_year.setdefault(jaar, set()).add(record_id)
                    status = str(row.get("status", "") or "").strip().lower()
                    verloopt_op = str(row.get("verloopt_op", "") or "")
                    created_at = str(row.get("created_at", "") or "")
                    updated_at = str(row.get("updated_at", "") or "")
                    finalized_at = str(row.get("finalized_at", "") or "")
                    # Payload is a view cache; force canonical column values into it.
                    payload_obj = _strip_detail_sections(row)
                    payload_obj["id"] = record_id
                    payload_obj["jaar"] = jaar
                    payload_obj["status"] = status
                    payload_obj["verloopt_op"] = verloopt_op
                    payload_obj["created_at"] = created_at
                    payload_obj["updated_at"] = updated_at
                    payload_obj["finalized_at"] = finalized_at
                    params.append(
                        (
                            record_id,
                            jaar,
                            status,
                            verloopt_op,
                            created_at,
                            updated_at,
                            finalized_at,
                            json.dumps(payload_obj, ensure_ascii=False),
                            now,
                        )
                    )

                # Replace-by-scope (overwrite): only delete stale quotes for the years present in this payload.
                # This prevents wiping other years when saving a single year from the UI.
                if overwrite:
                    for jaar in sorted(years_in_payload):
                        ids = sorted(quote_ids_by_year.get(jaar, set()))
                        if not ids:
                            cur.execute("DELETE FROM price_quotes WHERE jaar = %s", (jaar,))
                            continue
                        placeholders = ", ".join(["%s"] * len(ids))
                        cur.execute(
                            f"DELETE FROM price_quotes WHERE jaar = %s AND id NOT IN ({placeholders})",
                            (jaar, *ids),
                        )
                cur.executemany(
                    """
                    INSERT INTO price_quotes
                        (id, jaar, status, verloopt_op, created_at, updated_at, finalized_at, payload, updated_at_ts)
                    VALUES (
                        %s, %s, %s, %s,
                        NULLIF(%s,'')::timestamptz,
                        NULLIF(%s,'')::timestamptz,
                        NULLIF(%s,'')::timestamptz,
                        %s::jsonb, %s
                    )
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
                variant_params: list[tuple[Any, ...]] = []
                variant_period_params: list[tuple[Any, ...]] = []
                variant_line_params: list[tuple[Any, ...]] = []
                variant_staffel_params: list[tuple[Any, ...]] = []

                # Replace-by-scope for quote details: per quote, clear old lines/staffels then insert the new truth.
                # This avoids global deletes while keeping id semantics stable.
                for row in records:
                    quote_id = str(row.get("id", "") or "").strip()
                    if not quote_id:
                        continue
                    cur.execute("DELETE FROM price_quote_lines WHERE quote_id = %s", (quote_id,))
                    cur.execute("DELETE FROM price_quote_staffels WHERE quote_id = %s", (quote_id,))
                    cur.execute("DELETE FROM price_quote_variants WHERE quote_id = %s", (quote_id,))

                for row in records:
                    quote_id = str(row.get("id", "") or "").strip()
                    if not quote_id:
                        continue

                    variants_payload = row.get("variants")
                    if isinstance(variants_payload, list) and any(isinstance(v, dict) for v in variants_payload):
                        # Persist variants provided by the UI.
                        for i, variant in enumerate([v for v in variants_payload if isinstance(v, dict)]):
                            variant_id = str(variant.get("id", "") or "").strip() or f"{quote_id}:v{i+1}"
                            channel_code = str(
                                variant.get("channel_code", "")
                                or row.get("pricing_channel", "")
                                or row.get("kanaal", "")
                                or ""
                            ).strip().lower()
                            name = str(variant.get("name", "") or "").strip() or f"Scenario {i+1}"
                            return_pct = float(variant.get("return_pct", 0) or 0)
                            sort_index = int(variant.get("sort_index", i) or i)
                            variant_params.append((variant_id, quote_id, name, channel_code, return_pct, sort_index, now, now))

                            periods_payload = variant.get("periods")
                            if isinstance(periods_payload, list) and any(isinstance(p, dict) for p in periods_payload):
                                for p in [x for x in periods_payload if isinstance(x, dict)]:
                                    try:
                                        period_index = int(p.get("period_index", 0) or 0)
                                    except (TypeError, ValueError):
                                        period_index = 0
                                    if period_index not in (1, 2):
                                        continue
                                    period_id = str(p.get("id", "") or "").strip() or f"{variant_id}:p{period_index}"
                                    variant_period_params.append(
                                        (
                                            period_id,
                                            variant_id,
                                            period_index,
                                            str(p.get("label", "") or ""),
                                            str(p.get("start_date", "") or ""),
                                            str(p.get("end_date", "") or ""),
                                        )
                                    )
                            else:
                                variant_period_params.append((f"{variant_id}:p1", variant_id, 1, "Introductie", "", ""))
                                variant_period_params.append((f"{variant_id}:p2", variant_id, 2, "Standaard", "", ""))

                            sort_index_lines = 0
                            for item in variant.get("product_rows", []) if isinstance(variant.get("product_rows", []), list) else []:
                                if not isinstance(item, dict):
                                    continue
                                base_id = str(item.get("id", "") or "").strip()
                                if not base_id:
                                    continue
                                line_id = f"{variant_id}:{base_id}"
                                korting_single = float(item.get("korting_pct", 0) or 0)
                                variant_line_params.append(
                                    (
                                        line_id,
                                        variant_id,
                                        "product",
                                        str(item.get("bier_id", "") or ""),
                                        str(item.get("kostprijsversie_id", "") or ""),
                                        str(item.get("product_id", "") or ""),
                                        str(item.get("product_type", "") or ""),
                                        str(item.get("verpakking_label", "") or ""),
                                        float(item.get("liters", 0) or 0),
                                        float(item.get("aantal", 0) or 0),
                                        bool(item.get("included", True)),
                                        float(item.get("korting_pct_p1", korting_single) or 0),
                                        float(item.get("korting_pct_p2", korting_single) or 0),
                                        float(item.get("sell_in_price_override_p1", 0) or 0),
                                        float(item.get("sell_in_price_override_p2", 0) or 0),
                                        int(item.get("sort_index", sort_index_lines) or sort_index_lines),
                                    )
                                )
                                sort_index_lines += 1
                            for item in variant.get("beer_rows", []) if isinstance(variant.get("beer_rows", []), list) else []:
                                if not isinstance(item, dict):
                                    continue
                                base_id = str(item.get("id", "") or "").strip()
                                if not base_id:
                                    continue
                                line_id = f"{variant_id}:{base_id}"
                                korting_single = float(item.get("korting_pct", 0) or 0)
                                variant_line_params.append(
                                    (
                                        line_id,
                                        variant_id,
                                        "beer",
                                        str(item.get("bier_id", "") or ""),
                                        str(item.get("kostprijsversie_id", "") or ""),
                                        str(item.get("product_id", "") or ""),
                                        str(item.get("product_type", "") or ""),
                                        str(item.get("verpakking_label", "") or ""),
                                        float(item.get("liters", 0) or 0),
                                        0.0,
                                        bool(item.get("included", True)),
                                        float(item.get("korting_pct_p1", korting_single) or 0),
                                        float(item.get("korting_pct_p2", korting_single) or 0),
                                        float(item.get("sell_in_price_override_p1", 0) or 0),
                                        float(item.get("sell_in_price_override_p2", 0) or 0),
                                        int(item.get("sort_index", sort_index_lines) or sort_index_lines),
                                    )
                                )
                                sort_index_lines += 1
                            staffel_index = 0
                            for item in variant.get("staffels", []) if isinstance(variant.get("staffels", []), list) else []:
                                if not isinstance(item, dict):
                                    continue
                                base_id = str(item.get("id", "") or "").strip()
                                if not base_id:
                                    continue
                                staffel_id = f"{variant_id}:{base_id}"
                                variant_staffel_params.append(
                                    (
                                        staffel_id,
                                        variant_id,
                                        str(item.get("product_id", "") or ""),
                                        str(item.get("product_type", "") or ""),
                                        float(item.get("liters", 0) or 0),
                                        float(item.get("korting_pct", 0) or 0),
                                        int(item.get("sort_index", staffel_index) or staffel_index),
                                    )
                                )
                                staffel_index += 1
                        continue

                    # Default: deterministic single-variant seed (Scenario A).
                    variant_id = f"{quote_id}:v1"
                    channel_code = str(row.get("pricing_channel", "") or row.get("kanaal", "") or "").strip().lower()
                    variant_params.append((variant_id, quote_id, "Scenario A", channel_code, 0.0, 0, now, now))
                    variant_period_params.append((f"{variant_id}:p1", variant_id, 1, "Introductie", "", ""))
                    variant_period_params.append((f"{variant_id}:p2", variant_id, 2, "Standaard", "", ""))

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
                        korting = float(item.get("korting_pct", 0) or 0)
                        variant_line_params.append(
                            (
                                f"{variant_id}:{line_id}",
                                variant_id,
                                "product",
                                str(item.get("bier_id", "") or ""),
                                str(item.get("kostprijsversie_id", "") or ""),
                                str(item.get("product_id", "") or ""),
                                str(item.get("product_type", "") or ""),
                                str(item.get("verpakking_label", "") or ""),
                                float(item.get("liters", 0) or 0),
                                float(item.get("aantal", 0) or 0),
                                bool(item.get("included", True)),
                                korting,
                                korting,
                                0.0,
                                0.0,
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
                        korting = float(item.get("korting_pct", 0) or 0)
                        variant_line_params.append(
                            (
                                f"{variant_id}:{line_id}",
                                variant_id,
                                "beer",
                                str(item.get("bier_id", "") or ""),
                                str(item.get("kostprijsversie_id", "") or ""),
                                str(item.get("product_id", "") or ""),
                                str(item.get("product_type", "") or ""),
                                str(item.get("verpakking_label", "") or ""),
                                float(item.get("liters", 0) or 0),
                                0.0,
                                bool(item.get("included", True)),
                                korting,
                                korting,
                                0.0,
                                0.0,
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
                        variant_staffel_params.append(
                            (
                                f"{variant_id}:{staffel_id}",
                                variant_id,
                                str(item.get("product_id", "") or ""),
                                str(item.get("product_type", "") or ""),
                                float(item.get("liters", 0) or 0),
                                float(item.get("korting_pct", 0) or 0),
                                int(staffel_index),
                            )
                        )
                        staffel_index += 1

                if variant_params:
                    cur.executemany(
                        """
                        INSERT INTO price_quote_variants
                            (id, quote_id, name, channel_code, return_pct, sort_index, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        variant_params,
                    )
                if variant_period_params:
                    cur.executemany(
                        """
                        INSERT INTO price_quote_variant_periods
                            (id, variant_id, period_index, label, start_date, end_date)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        variant_period_params,
                    )
                if variant_line_params:
                    cur.executemany(
                        """
                        INSERT INTO price_quote_variant_lines (
                            id, variant_id, line_kind, bier_id, kostprijsversie_id, product_id, product_type,
                            verpakking_label, liters, aantal, included,
                            korting_pct_p1, korting_pct_p2, sell_in_price_override_p1, sell_in_price_override_p2,
                            sort_index
                        )
                        VALUES (
                            %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            %s
                        )
                        """,
                        variant_line_params,
                    )
                if variant_staffel_params:
                    cur.executemany(
                        """
                        INSERT INTO price_quote_variant_staffels (
                            id, variant_id, product_id, product_type, liters, korting_pct, sort_index
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        variant_staffel_params,
                    )

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
            elif overwrite:
                # Overwrite with an empty list means "clear all quotes".
                cur.execute("DELETE FROM price_quotes")
        if not postgres_storage.in_transaction():
            conn.commit()

    # Ensure we don't keep a stale legacy row around.
    try:
        postgres_storage.delete_app_dataset_row("prijsvoorstellen")
    except Exception:
        pass
    return True
