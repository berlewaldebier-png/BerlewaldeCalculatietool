from __future__ import annotations

import json
from decimal import Decimal
from typing import Any, Iterable

from app.domain import active_sales_strategy_service, postgres_storage


CONTRACT_VERSION = "rf-012c1-v1"
_OPERATIONAL_GENERATION_STATUSES = {"active", "superseded"}
_OPERATIONAL_RUN_STATUSES = {"active", "superseded"}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = Decimal(str(value))
    except Exception:
        return None
    return float(parsed) if parsed.is_finite() else None


def _codes(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            value = [value]
    if not isinstance(value, list):
        return []
    return sorted({_text(item) for item in value if _text(item)})


def _missing(reason_code: str, *, generation_id: str = "") -> dict[str, Any]:
    return {
        "version": CONTRACT_VERSION,
        "status": "missing",
        "consumer_mode": "active_generation",
        "binding": None,
        "items": [],
        "summary": {
            "candidate_sku_count": 0,
            "quote_ready_count": 0,
            "excluded_count": 0,
            "exclusion_counts": {reason_code: 1},
        },
        "reason_codes": [reason_code],
        "requested_generation_id": _text(generation_id),
    }


def build_quote_commercial_context(
    *,
    generation: dict[str, Any] | None,
    run: dict[str, Any] | None,
    rows: Iterable[dict[str, Any]],
    requested_generation_id: str = "",
) -> dict[str, Any]:
    """Project an activated RF-013C candidate into the RF-012C1 quote contract."""

    if not generation:
        return _missing(
            "active_commercial_generation_missing"
            if not _text(requested_generation_id)
            else "requested_commercial_generation_missing",
            generation_id=requested_generation_id,
        )
    if _text(generation.get("status")) not in _OPERATIONAL_GENERATION_STATUSES:
        return _missing(
            "requested_commercial_generation_not_operational",
            generation_id=_text(generation.get("id")),
        )
    if _text(generation.get("readiness_status")) != "ready":
        return _missing(
            "commercial_generation_not_ready",
            generation_id=_text(generation.get("id")),
        )
    if not run:
        return _missing(
            "commercial_reconciliation_run_missing",
            generation_id=_text(generation.get("id")),
        )
    if _text(run.get("status")) not in _OPERATIONAL_RUN_STATUSES:
        return _missing(
            "commercial_reconciliation_run_not_operational",
            generation_id=_text(generation.get("id")),
        )
    if _text(run.get("readiness_status")) != "ready":
        return _missing(
            "commercial_reconciliation_run_not_ready",
            generation_id=_text(generation.get("id")),
        )

    items: list[dict[str, Any]] = []
    exclusion_counts: dict[str, int] = {}
    for raw in rows:
        cost_status = _text(raw.get("cost_readiness_status"))
        price_status = _text(raw.get("price_readiness_status"))
        scope = _text(raw.get("scope_classification"))
        cost_required = bool(raw.get("cost_required"))
        cost_price = _number(raw.get("cost_price"))
        list_price = _number(raw.get("list_price"))
        reason_codes = [
            *_codes(raw.get("cost_blocker_codes")),
            *_codes(raw.get("price_blocker_codes")),
        ]
        if scope == "catalog_reference_only":
            reason_codes.append("quote_catalog_reference_only")
        if cost_status not in {"ready", "not_required"}:
            reason_codes.append("quote_cost_not_ready")
        if cost_required and (cost_price is None or cost_price <= 0):
            reason_codes.append("quote_cost_non_positive")
        if not _text(raw.get("price_id")):
            reason_codes.append("quote_sell_in_missing")
        elif price_status != "ready":
            reason_codes.append("quote_sell_in_not_ready")
        if list_price is None or list_price <= 0:
            reason_codes.append("quote_sell_in_non_positive")

        reason_codes = sorted(set(reason_codes))
        quote_status = "ready" if not reason_codes else "excluded"
        if quote_status == "excluded":
            for code in reason_codes:
                exclusion_counts[code] = exclusion_counts.get(code, 0) + 1

        items.append(
            {
                "sku_id": _text(raw.get("sku_id")),
                "scope_classification": scope,
                "subject_type": _text(raw.get("subject_type")),
                "subject_id": _text(raw.get("subject_id")),
                "canonical_beer_id": _text(raw.get("canonical_beer_id")),
                "format_article_id": _text(raw.get("format_article_id")),
                "sku_kind": _text(raw.get("sku_kind")),
                "source_anchor_id": _text(raw.get("source_anchor_id")),
                "source_cost_version_id": _text(
                    raw.get("source_cost_version_id")
                ),
                "source_cost_row_id": _text(raw.get("source_cost_row_id")),
                "cost_version_id": _text(raw.get("reserved_target_version_id")),
                "cost_row_id": _text(raw.get("reserved_target_cost_row_id")),
                "calculation_method": _text(raw.get("calculation_method")),
                "provenance_kind": _text(raw.get("provenance_kind")),
                "provenance_source_year": int(
                    raw.get("provenance_source_year") or 0
                ),
                "primary_cost": _number(raw.get("primary_cost")),
                "packaging_cost": _number(raw.get("packaging_cost")),
                "overhead_cost": _number(raw.get("overhead_cost")),
                "excise_cost": _number(raw.get("excise_cost")),
                "cost_price": cost_price,
                "liters_per_unit": _number(raw.get("liters_per_unit")),
                "cost_required": cost_required,
                "cost_readiness_status": cost_status,
                "price_id": _text(raw.get("price_id")),
                "source_pricing_id": _text(raw.get("source_pricing_id")),
                "target_pricing_id": _text(raw.get("target_pricing_id")),
                "list_price": list_price,
                "price_readiness_status": price_status or "missing",
                "quote_readiness_status": quote_status,
                "reason_codes": reason_codes,
            }
        )

    items.sort(key=lambda item: item["sku_id"])
    quote_ready_count = sum(
        1 for item in items if item["quote_readiness_status"] == "ready"
    )
    binding = {
        "mode": "active_generation",
        "version": CONTRACT_VERSION,
        "generation_id": _text(generation.get("id")),
        "run_id": _text(run.get("id")),
        "operational_year": int(generation.get("operational_year") or 0),
        "manifest_hash": _text(run.get("manifest_hash")),
        "validation_hash": _text(run.get("validation_hash"))
        or _text(generation.get("validation_hash")),
    }
    return {
        "version": CONTRACT_VERSION,
        "status": "ready",
        "consumer_mode": "active_generation",
        "binding": binding,
        "items": items,
        "summary": {
            "candidate_sku_count": len(items),
            "quote_ready_count": quote_ready_count,
            "excluded_count": len(items) - quote_ready_count,
            "exclusion_counts": dict(sorted(exclusion_counts.items())),
        },
        "reason_codes": [],
        "requested_generation_id": _text(requested_generation_id),
    }


def read_quote_commercial_context(
    *, generation_id: str = ""
) -> dict[str, Any]:
    """Read only activated/superseded authority rows; never initialize or mutate schema."""

    clean_generation_id = _text(generation_id)
    with postgres_storage.connect() as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        if clean_generation_id:
            generation_row = conn.execute(
                """
                SELECT id, operational_year, status, readiness_status, validation_hash
                FROM commercial_yearsets
                WHERE id = %s
                  AND status IN ('active', 'superseded')
                """,
                (clean_generation_id,),
            ).fetchone()
        else:
            generation_row = conn.execute(
                """
                SELECT id, operational_year, status, readiness_status, validation_hash
                FROM commercial_yearsets
                WHERE status = 'active'
                """
            ).fetchone()

        if not generation_row:
            return build_quote_commercial_context(
                generation=None,
                run=None,
                rows=[],
                requested_generation_id=clean_generation_id,
            )
        generation = {
            "id": _text(generation_row[0]),
            "operational_year": int(generation_row[1] or 0),
            "status": _text(generation_row[2]),
            "readiness_status": _text(generation_row[3]),
            "validation_hash": _text(generation_row[4]),
        }
        run_row = conn.execute(
            """
            SELECT id, generation_id, status, readiness_status,
                   manifest_hash, validation_hash
            FROM commercial_yearset_reconciliation_runs
            WHERE generation_id = %s
              AND status IN ('active', 'superseded')
            """,
            (generation["id"],),
        ).fetchone()
        if not run_row:
            return build_quote_commercial_context(
                generation=generation,
                run=None,
                rows=[],
                requested_generation_id=clean_generation_id,
            )
        run = {
            "id": _text(run_row[0]),
            "generation_id": _text(run_row[1]),
            "status": _text(run_row[2]),
            "readiness_status": _text(run_row[3]),
            "manifest_hash": _text(run_row[4]),
            "validation_hash": _text(run_row[5]),
        }
        candidate_rows = conn.execute(
            """
            SELECT
                s.sku_id, s.scope_classification, s.subject_type, s.subject_id,
                s.canonical_beer_id, s.format_article_id, s.sku_kind,
                s.source_anchor_id, s.source_cost_version_id, s.source_cost_row_id,
                s.reserved_target_version_id, s.reserved_target_cost_row_id,
                s.calculation_method, s.provenance_kind, s.provenance_source_year,
                s.primary_cost, s.packaging_cost, s.overhead_cost, s.excise_cost,
                s.cost_price, s.liters_per_unit, s.cost_required,
                s.readiness_status, s.blocker_codes,
                p.id, p.source_pricing_id, p.target_pricing_id, p.list_price,
                p.readiness_status, p.blocker_codes
            FROM commercial_yearset_candidate_skus s
            LEFT JOIN commercial_yearset_candidate_prices p
              ON p.run_id = s.run_id AND p.sku_id = s.sku_id
            WHERE s.run_id = %s
            ORDER BY s.sku_id
            """,
            (run["id"],),
        ).fetchall()

        live_price_rows = []
        if generation["status"] == "active":
            live_price_rows = conn.execute(
                """
                SELECT id, record_type, jaar, payload, updated_at
                FROM sales_pricing_records
                WHERE jaar = %s
                  AND record_type = 'verkoopstrategie_product'
                ORDER BY id
                """,
                (generation["operational_year"],),
            ).fetchall()

    columns = (
        "sku_id",
        "scope_classification",
        "subject_type",
        "subject_id",
        "canonical_beer_id",
        "format_article_id",
        "sku_kind",
        "source_anchor_id",
        "source_cost_version_id",
        "source_cost_row_id",
        "reserved_target_version_id",
        "reserved_target_cost_row_id",
        "calculation_method",
        "provenance_kind",
        "provenance_source_year",
        "primary_cost",
        "packaging_cost",
        "overhead_cost",
        "excise_cost",
        "cost_price",
        "liters_per_unit",
        "cost_required",
        "cost_readiness_status",
        "cost_blocker_codes",
        "price_id",
        "source_pricing_id",
        "target_pricing_id",
        "list_price",
        "price_readiness_status",
        "price_blocker_codes",
    )
    projected_rows = [
        dict(zip(columns, row, strict=True)) for row in candidate_rows
    ]
    if generation["status"] == "active":
        live_columns = ("id", "record_type", "year", "payload", "updated_at")
        projected_rows = active_sales_strategy_service.overlay_current_sell_in_prices(
            projected_rows,
            [dict(zip(live_columns, row, strict=True)) for row in live_price_rows],
        )
    return build_quote_commercial_context(
        generation=generation,
        run=run,
        rows=projected_rows,
        requested_generation_id=clean_generation_id,
    )
