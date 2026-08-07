from __future__ import annotations

import copy
import json
from decimal import Decimal
from typing import Any, Iterable

from app.domain import commercial_yearset_service, postgres_storage


CONTRACT_VERSION = "rf-012d1-v1"
_FINAL_GENERATION_STATUSES = {"active", "superseded"}
_TARGET_KEYS = ("revenue", "variable_cost", "contribution", "liters", "units")


def _text(value: Any) -> str:
    return str(value or "").strip()


def _iso(value: Any) -> str:
    return _text(value.isoformat() if hasattr(value, "isoformat") else value)


def _mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return copy.deepcopy(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return {}
        return copy.deepcopy(parsed) if isinstance(parsed, dict) else {}
    return {}


def _array(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    return [
        copy.deepcopy(row)
        for row in (value if isinstance(value, list) else [])
        if isinstance(row, dict)
    ]


def _codes(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            value = [value]
    return sorted({_text(item) for item in value or [] if _text(item)})


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = Decimal(str(value))
    except Exception:
        return None
    return float(parsed) if parsed.is_finite() else None


def _target_values(value: Any) -> dict[str, float]:
    source = _mapping(value)
    return {
        key: float(_number(source.get(key)) or 0.0)
        for key in _TARGET_KEYS
    }


def _missing(
    operational_year: int,
    reason_code: str,
    *,
    binding: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "version": CONTRACT_VERSION,
        "status": "missing",
        "read_only": True,
        "operational_year": int(operational_year or 0),
        "binding": copy.deepcopy(binding) if binding else None,
        "summary": None,
        "plan": None,
        "sku_items": [],
        "channels": [],
        "audit": None,
        "reason_codes": [reason_code],
    }


def _normalized_periods(value: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in _array(value):
        period = _text(row.get("period"))[:7]
        if not period:
            continue
        rows.append(
            {
                "period": period,
                **{
                    key: float(_number(row.get(key)) or 0.0)
                    for key in _TARGET_KEYS
                },
            }
        )
    return sorted(rows, key=lambda row: row["period"])


def _normalized_allocations(value: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in _array(value):
        sku_id = _text(row.get("sku_id"))
        if not sku_id:
            continue
        rows.append(
            {
                "sku_id": sku_id,
                **{
                    key: float(_number(row.get(key)) or 0.0)
                    for key in _TARGET_KEYS
                },
            }
        )
    return sorted(rows, key=lambda row: row["sku_id"])


def _sku_items(
    sku_rows: Iterable[dict[str, Any]],
    price_rows: Iterable[dict[str, Any]],
    allocations: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    prices = {
        _text(row.get("sku_id")): row
        for row in price_rows
        if _text(row.get("sku_id"))
    }
    plan = {
        _text(row.get("sku_id")): row
        for row in allocations
        if _text(row.get("sku_id"))
    }
    result: list[dict[str, Any]] = []
    for raw in sku_rows:
        sku_id = _text(raw.get("sku_id"))
        if not sku_id:
            continue
        price = prices.get(sku_id, {})
        allocation = plan.get(sku_id, {})
        result.append(
            {
                "sku_id": sku_id,
                "sku_code": _text(raw.get("sku_code")),
                "sku_name": _text(raw.get("sku_name")) or sku_id,
                "beer_name": _text(raw.get("beer_name")),
                "canonical_beer_id": _text(raw.get("canonical_beer_id")),
                "sku_kind": _text(raw.get("sku_kind")),
                "subject_type": _text(raw.get("subject_type")),
                "subject_id": _text(raw.get("subject_id")),
                "scope_classification": _text(
                    raw.get("scope_classification")
                ),
                "calculation_method": _text(raw.get("calculation_method")),
                "cost_method": _text(raw.get("cost_method")),
                "provenance_kind": _text(raw.get("provenance_kind")),
                "provenance_source_year": int(
                    raw.get("provenance_source_year") or 0
                ),
                "primary_cost": _number(raw.get("primary_cost")),
                "packaging_cost": _number(raw.get("packaging_cost")),
                "overhead_cost": _number(raw.get("overhead_cost")),
                "excise_cost": _number(raw.get("excise_cost")),
                "cost_price": _number(raw.get("cost_price")),
                "liters_per_unit": _number(raw.get("liters_per_unit")),
                "cost_required": bool(raw.get("cost_required")),
                "cost_readiness_status": _text(raw.get("readiness_status")),
                "cost_blocker_codes": _codes(raw.get("blocker_codes")),
                "list_price": _number(price.get("list_price")),
                "price_readiness_status": _text(price.get("readiness_status"))
                or "not_applicable",
                "price_blocker_codes": _codes(price.get("blocker_codes")),
                "planned_revenue": float(
                    _number(allocation.get("revenue")) or 0.0
                ),
                "planned_units": float(
                    _number(allocation.get("units")) or 0.0
                ),
                "planned_liters": float(
                    _number(allocation.get("liters")) or 0.0
                ),
                "source": {
                    "anchor_id": _text(raw.get("source_anchor_id")),
                    "cost_version_id": _text(
                        raw.get("source_cost_version_id")
                    ),
                    "cost_row_id": _text(raw.get("source_cost_row_id")),
                    "target_cost_row_id": _text(
                        raw.get("reserved_target_cost_row_id")
                    ),
                    "target_price_id": _text(price.get("target_pricing_id")),
                    "cost_hash": _text(raw.get("target_hash")),
                    "price_hash": _text(price.get("target_hash")),
                },
            }
        )
    return sorted(
        result,
        key=lambda row: (
            row["beer_name"].casefold(),
            row["sku_name"].casefold(),
            row["sku_id"],
        ),
    )


def build_yearset_dossier(
    *,
    operational_year: int,
    generation: dict[str, Any] | None,
    run: dict[str, Any] | None,
    plan_row: dict[str, Any] | None,
    sku_rows: Iterable[dict[str, Any]],
    price_rows: Iterable[dict[str, Any]],
    channel_rows: Iterable[dict[str, Any]],
    generation_events: Iterable[dict[str, Any]] = (),
    run_events: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    """Project one finalized commercial generation without changing it."""

    year = int(operational_year or 0)
    if not generation:
        return _missing(year, "finalized_commercial_yearset_missing")
    binding = {
        "generation_id": _text(generation.get("id")),
        "operational_year": int(generation.get("operational_year") or 0),
        "generation_status": _text(generation.get("status")),
        "generation_revision": int(generation.get("revision") or 0),
        "generation_validation_hash": _text(
            generation.get("validation_hash")
        ),
    }
    if binding["operational_year"] != year:
        return _missing(year, "commercial_yearset_year_mismatch", binding=binding)
    if binding["generation_status"] not in _FINAL_GENERATION_STATUSES:
        return _missing(
            year, "commercial_yearset_not_finalized", binding=binding
        )
    if _text(generation.get("readiness_status")) != "ready":
        return _missing(
            year, "commercial_yearset_not_ready", binding=binding
        )
    if not run:
        return _missing(
            year, "commercial_yearset_reconciliation_missing", binding=binding
        )
    binding.update(
        {
            "run_id": _text(run.get("id")),
            "run_status": _text(run.get("status")),
            "manifest_hash": _text(run.get("manifest_hash")),
            "validation_hash": _text(run.get("validation_hash")),
        }
    )
    if _text(run.get("generation_id")) != binding["generation_id"]:
        return _missing(
            year, "commercial_yearset_run_mismatch", binding=binding
        )
    if binding["run_status"] not in _FINAL_GENERATION_STATUSES:
        return _missing(
            year, "commercial_yearset_run_not_finalized", binding=binding
        )
    if _text(run.get("readiness_status")) != "ready":
        return _missing(
            year, "commercial_yearset_run_not_ready", binding=binding
        )
    if not plan_row:
        return _missing(year, "commercial_yearset_plan_missing", binding=binding)
    if _text(plan_row.get("readiness_status")) != "ready" or _codes(
        plan_row.get("blocker_codes")
    ):
        return _missing(year, "commercial_yearset_plan_not_ready", binding=binding)

    frozen_plan = _mapping(plan_row.get("frozen_plan"))
    plan_payload = _mapping(frozen_plan.get("payload"))
    initial_forecast = _mapping(plan_row.get("initial_forecast"))
    plan_hash = _text(plan_row.get("plan_contract_hash"))
    binding.update(
        {
            "plan_id": _text(plan_row.get("id")),
            "plan_contract_hash": plan_hash,
        }
    )
    validated = commercial_yearset_service.validate_plan_contract(
        source=_text(frozen_plan.get("source")),
        payload=plan_payload,
    )
    if not validated.get("ready"):
        return _missing(
            year, "commercial_yearset_plan_contract_invalid", binding=binding
        )
    if _text(validated.get("contract_hash")) != plan_hash:
        return _missing(
            year, "commercial_yearset_plan_hash_mismatch", binding=binding
        )
    if _mapping(initial_forecast.get("forecast")) != plan_payload:
        return _missing(
            year, "commercial_yearset_initial_forecast_mismatch", binding=binding
        )
    if _text(initial_forecast.get("plan_contract_hash")) != plan_hash:
        return _missing(
            year,
            "commercial_yearset_initial_forecast_hash_mismatch",
            binding=binding,
        )

    sku_source = [copy.deepcopy(row) for row in sku_rows]
    price_source = [copy.deepcopy(row) for row in price_rows]
    expected_skus = int(run.get("sku_count") or 0)
    expected_prices = int(run.get("price_count") or 0)
    if len(sku_source) != expected_skus:
        return _missing(
            year, "commercial_yearset_sku_count_mismatch", binding=binding
        )
    if len(price_source) != expected_prices:
        return _missing(
            year, "commercial_yearset_price_count_mismatch", binding=binding
        )

    periods = _normalized_periods(plan_payload.get("period_allocations"))
    expected_periods = {f"{year}-{month:02d}" for month in range(1, 13)}
    if {row["period"] for row in periods} != expected_periods:
        return _missing(
            year, "commercial_yearset_plan_periods_incomplete", binding=binding
        )
    allocations = _normalized_allocations(plan_payload.get("sku_allocations"))
    items = _sku_items(sku_source, price_source, allocations)
    channels = sorted(
        [
            {
                "channel_code": _text(row.get("channel_code")),
                "advice_markup_pct": _number(row.get("advice_markup_pct")),
                "readiness_status": _text(row.get("readiness_status")),
                "blocker_codes": _codes(row.get("blocker_codes")),
                "source_hash": _text(row.get("source_hash")),
            }
            for row in channel_rows
            if _text(row.get("channel_code"))
        ],
        key=lambda row: row["channel_code"],
    )
    required = [row for row in items if row["cost_required"]]
    ready_required = [
        row
        for row in required
        if row["cost_readiness_status"] == "ready"
        and row["cost_price"] is not None
        and row["cost_price"] > 0
    ]
    return {
        "version": CONTRACT_VERSION,
        "status": "ready",
        "read_only": True,
        "operational_year": year,
        "binding": binding,
        "summary": {
            "sku_count": len(items),
            "required_cost_count": len(required),
            "ready_cost_count": len(ready_required),
            "price_count": len(price_source),
            "channel_count": len(channels),
            "plan_sku_count": len(allocations),
        },
        "plan": {
            "source": _text(frozen_plan.get("source")),
            "source_record_id": _text(frozen_plan.get("source_record_id")),
            "immutable": True,
            "targets": _target_values(plan_payload.get("targets")),
            "period_allocations": periods,
            "sku_allocations": allocations,
        },
        "sku_items": items,
        "channels": channels,
        "audit": {
            "generation": {
                "source_year": int(generation.get("source_year") or 0),
                "source_generation_id": _text(
                    generation.get("source_generation_id")
                ),
                "cost_source_year": int(
                    generation.get("cost_source_year") or 0
                ),
                "pricing_source_year": int(
                    generation.get("pricing_source_year") or 0
                ),
                "advice_source_year": int(
                    generation.get("advice_source_year") or 0
                ),
                "created_at": _iso(generation.get("created_at")),
                "activated_at": _iso(generation.get("activated_at")),
                "activated_by": _text(generation.get("activated_by")),
                "superseded_at": _iso(generation.get("superseded_at")),
            },
            "reconciliation": {
                "planner_version": _text(run.get("planner_version")),
                "source_snapshot_hash": _text(
                    run.get("source_snapshot_hash")
                ),
                "target_input_hash": _text(run.get("target_input_hash")),
                "created_by": _text(run.get("created_by")),
                "created_at": _iso(run.get("created_at")),
                "approved_by": _text(run.get("approved_by")),
                "approved_at": _iso(run.get("approved_at")),
                "activated_by": _text(run.get("activated_by")),
                "activated_at": _iso(run.get("activated_at")),
            },
            "generation_events": [copy.deepcopy(row) for row in generation_events],
            "reconciliation_events": [copy.deepcopy(row) for row in run_events],
        },
        "reason_codes": [],
    }


def _read_yearset_dossier(
    operational_year: int | None,
) -> dict[str, Any]:
    """Read one finalized yearset in one read-only transaction."""

    requested_year = int(operational_year or 0)
    with postgres_storage.connect() as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        if operational_year is None:
            generation_data = conn.execute(
                """
                SELECT id, operational_year, revision, status, readiness_status,
                       source_year, source_generation_id, cost_source_year,
                       pricing_source_year, advice_source_year, validation_hash,
                       created_at, activated_at, activated_by, superseded_at
                FROM commercial_yearsets
                WHERE status = 'active'
                LIMIT 1
                """
            ).fetchone()
        else:
            generation_data = conn.execute(
                """
                SELECT id, operational_year, revision, status, readiness_status,
                       source_year, source_generation_id, cost_source_year,
                       pricing_source_year, advice_source_year, validation_hash,
                       created_at, activated_at, activated_by, superseded_at
                FROM commercial_yearsets
                WHERE operational_year = %s
                  AND status IN ('active', 'superseded')
                ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END,
                         revision DESC, created_at DESC
                LIMIT 1
                """,
                (requested_year,),
            ).fetchone()
        if not generation_data:
            return _missing(
                requested_year,
                "active_commercial_yearset_missing"
                if operational_year is None
                else "finalized_commercial_yearset_missing",
            )
        generation_columns = (
            "id",
            "operational_year",
            "revision",
            "status",
            "readiness_status",
            "source_year",
            "source_generation_id",
            "cost_source_year",
            "pricing_source_year",
            "advice_source_year",
            "validation_hash",
            "created_at",
            "activated_at",
            "activated_by",
            "superseded_at",
        )
        generation = dict(zip(generation_columns, generation_data, strict=True))
        year = int(generation.get("operational_year") or requested_year)
        run_data = conn.execute(
            """
            SELECT id, generation_id, planner_version, status, readiness_status,
                   source_snapshot_hash, target_input_hash, manifest_hash,
                   validation_hash, sku_count, required_cost_count,
                   ready_cost_count, price_count, ready_price_count,
                   blocker_counts, created_by, created_at, approved_by,
                   approved_at, activated_by, activated_at
            FROM commercial_yearset_reconciliation_runs
            WHERE generation_id = %s
              AND status IN ('active', 'superseded')
            """,
            (_text(generation["id"]),),
        ).fetchone()
        if not run_data:
            return build_yearset_dossier(
                operational_year=year,
                generation=generation,
                run=None,
                plan_row=None,
                sku_rows=[],
                price_rows=[],
                channel_rows=[],
            )
        run_columns = (
            "id",
            "generation_id",
            "planner_version",
            "status",
            "readiness_status",
            "source_snapshot_hash",
            "target_input_hash",
            "manifest_hash",
            "validation_hash",
            "sku_count",
            "required_cost_count",
            "ready_cost_count",
            "price_count",
            "ready_price_count",
            "blocker_counts",
            "created_by",
            "created_at",
            "approved_by",
            "approved_at",
            "activated_by",
            "activated_at",
        )
        run = dict(zip(run_columns, run_data, strict=True))
        plan_data = conn.execute(
            """
            SELECT id, source_plan_id, plan_contract_hash, frozen_plan,
                   initial_forecast, readiness_status, blocker_codes, source_hash
            FROM commercial_yearset_candidate_plan
            WHERE run_id = %s
            """,
            (_text(run["id"]),),
        ).fetchone()
        plan_row = None
        if plan_data:
            plan_columns = (
                "id",
                "source_plan_id",
                "plan_contract_hash",
                "frozen_plan",
                "initial_forecast",
                "readiness_status",
                "blocker_codes",
                "source_hash",
            )
            plan_row = dict(zip(plan_columns, plan_data, strict=True))
        sku_data = conn.execute(
            """
            SELECT s.sku_id, k.code, k.name, b.name, s.canonical_beer_id,
                   s.scope_classification, s.subject_type, s.subject_id,
                   s.sku_kind, s.calculation_method,
                   COALESCE(
                       NULLIF(source_v.payload->>'type', ''),
                       NULLIF(source_v.payload->'soort_berekening'->>'type', ''),
                       ''
                   ),
                   s.provenance_kind,
                   s.provenance_source_year, s.primary_cost,
                   s.packaging_cost, s.overhead_cost, s.excise_cost,
                   s.cost_price, s.liters_per_unit, s.cost_required,
                   s.readiness_status, s.blocker_codes, s.source_anchor_id,
                   s.source_cost_version_id, s.source_cost_row_id,
                   s.reserved_target_cost_row_id, s.target_hash
            FROM commercial_yearset_candidate_skus s
            LEFT JOIN skus k ON k.id = s.sku_id
            LEFT JOIN canonical_beers b ON b.id = s.canonical_beer_id
            LEFT JOIN cost_versions source_v ON source_v.id = s.source_cost_version_id
            WHERE s.run_id = %s
            ORDER BY COALESCE(b.name, ''), COALESCE(k.name, ''), s.sku_id
            """,
            (_text(run["id"]),),
        ).fetchall()
        sku_columns = (
            "sku_id",
            "sku_code",
            "sku_name",
            "beer_name",
            "canonical_beer_id",
            "scope_classification",
            "subject_type",
            "subject_id",
            "sku_kind",
            "calculation_method",
            "cost_method",
            "provenance_kind",
            "provenance_source_year",
            "primary_cost",
            "packaging_cost",
            "overhead_cost",
            "excise_cost",
            "cost_price",
            "liters_per_unit",
            "cost_required",
            "readiness_status",
            "blocker_codes",
            "source_anchor_id",
            "source_cost_version_id",
            "source_cost_row_id",
            "reserved_target_cost_row_id",
            "target_hash",
        )
        price_data = conn.execute(
            """
            SELECT sku_id, source_pricing_id, target_pricing_id, list_price,
                   readiness_status, blocker_codes, source_hash, target_hash
            FROM commercial_yearset_candidate_prices
            WHERE run_id = %s
            ORDER BY sku_id
            """,
            (_text(run["id"]),),
        ).fetchall()
        price_columns = (
            "sku_id",
            "source_pricing_id",
            "target_pricing_id",
            "list_price",
            "readiness_status",
            "blocker_codes",
            "source_hash",
            "target_hash",
        )
        channel_data = conn.execute(
            """
            SELECT channel_code, advice_markup_pct, readiness_status,
                   blocker_codes, source_hash
            FROM commercial_yearset_candidate_channels
            WHERE run_id = %s
            ORDER BY channel_code
            """,
            (_text(run["id"]),),
        ).fetchall()
        channel_columns = (
            "channel_code",
            "advice_markup_pct",
            "readiness_status",
            "blocker_codes",
            "source_hash",
        )
        generation_event_data = conn.execute(
            """
            SELECT event_type, actor, reason, occurred_at
            FROM commercial_yearset_events
            WHERE generation_id = %s
            ORDER BY event_sequence
            """,
            (_text(generation["id"]),),
        ).fetchall()
        run_event_data = conn.execute(
            """
            SELECT event_type, actor, reason, occurred_at
            FROM commercial_yearset_reconciliation_events
            WHERE run_id = %s
            ORDER BY event_sequence
            """,
            (_text(run["id"]),),
        ).fetchall()

    event_columns = ("event_type", "actor", "reason", "occurred_at")

    def events(rows: Iterable[Any]) -> list[dict[str, Any]]:
        return [
            {
                **dict(zip(event_columns, row, strict=True)),
                "occurred_at": _iso(row[3]),
            }
            for row in rows
        ]

    return build_yearset_dossier(
        operational_year=year,
        generation=generation,
        run=run,
        plan_row=plan_row,
        sku_rows=[dict(zip(sku_columns, row, strict=True)) for row in sku_data],
        price_rows=[
            dict(zip(price_columns, row, strict=True)) for row in price_data
        ],
        channel_rows=[
            dict(zip(channel_columns, row, strict=True)) for row in channel_data
        ],
        generation_events=events(generation_event_data),
        run_events=events(run_event_data),
    )


def read_yearset_dossier(operational_year: int) -> dict[str, Any]:
    return _read_yearset_dossier(int(operational_year or 0))


def read_active_yearset_dossier() -> dict[str, Any]:
    """Read the one active commercial yearset without a fallback-year guess."""

    return _read_yearset_dossier(None)
