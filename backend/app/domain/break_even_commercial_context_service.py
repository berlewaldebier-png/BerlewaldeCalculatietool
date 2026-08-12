from __future__ import annotations

import copy
import json
from calendar import monthrange
from datetime import date
from decimal import Decimal
from typing import Any, Iterable

from app.domain import (
    commercial_yearset_service,
    management_forecast_storage,
    postgres_storage,
)


CONTRACT_VERSION = "rf-012c2-v1"
_TARGET_KEYS = ("revenue", "variable_cost", "contribution", "liters", "units")
_FINANCIAL_KEYS = ("revenue", "variable_cost", "contribution")


def _text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    try:
        parsed = Decimal(str(value))
    except Exception:
        return 0.0
    return float(parsed) if parsed.is_finite() else 0.0


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
    return sorted({_text(code) for code in value or [] if _text(code)})


def _target_values(value: Any) -> dict[str, float]:
    source = _mapping(value)
    return {key: _number(source.get(key)) for key in _TARGET_KEYS}


def _missing(
    reason_code: str,
    *,
    binding: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "version": CONTRACT_VERSION,
        "status": "missing",
        "consumer_mode": "active_generation",
        "binding": copy.deepcopy(binding) if binding else None,
        "plan": None,
        "planning_rows": [],
        "forecast_revision": None,
        "reason_codes": [reason_code],
    }


def _planning_rows(
    allocations: Iterable[dict[str, Any]],
    candidate_rows: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidates = {
        _text(row.get("sku_id")): row
        for row in candidate_rows
        if _text(row.get("sku_id"))
    }
    rows: list[dict[str, Any]] = []
    for allocation in allocations:
        sku_id = _text(allocation.get("sku_id"))
        if not sku_id:
            continue
        candidate = candidates.get(sku_id, {})
        primary = _number(candidate.get("primary_cost"))
        packaging = _number(candidate.get("packaging_cost"))
        overhead = _number(candidate.get("overhead_cost"))
        excise = _number(candidate.get("excise_cost"))
        rows.append(
            {
                "sku_id": sku_id,
                "sku_code": _text(candidate.get("sku_code")),
                "sku_name": _text(candidate.get("sku_name")) or sku_id,
                "planned_revenue": _number(allocation.get("revenue")),
                "planned_variable_cost": _number(
                    allocation.get("variable_cost")
                ),
                "planned_contribution": _number(
                    allocation.get("contribution")
                ),
                "planned_liters": _number(allocation.get("liters")),
                "planned_units": _number(allocation.get("units")),
                "liters_per_unit": _number(
                    candidate.get("liters_per_unit")
                ),
                "planned_variable_cost_unit": primary + packaging + excise,
                "planned_fixed_allocation_unit": overhead,
                "planned_cost_unit": _number(candidate.get("cost_price")),
                "scope_classification": _text(
                    candidate.get("scope_classification")
                ),
                "cost_readiness_status": _text(
                    candidate.get("readiness_status")
                ),
            }
        )
    rows.sort(key=lambda row: row["sku_id"])
    return rows


def _matching_forecast_revision(
    raw: dict[str, Any] | None,
    *,
    generation_id: str,
    run_id: str,
    plan_id: str,
    plan_contract_hash: str,
    operational_year: int,
) -> dict[str, Any] | None:
    if not raw:
        return None
    # RF-012C2B authority: a revision is directly bound to the active
    # commercial generation, reconciliation run and immutable Plan hash.
    if _text(raw.get("generation_id")):
        if (
            _text(raw.get("generation_id")) != generation_id
            or _text(raw.get("run_id")) != run_id
            or _text(raw.get("plan_id")) != plan_id
            or _text(raw.get("plan_contract_hash")) != plan_contract_hash
            or int(raw.get("operational_year") or 0) != operational_year
            or _text(raw.get("status")) != "active"
        ):
            return None
        targets = _target_values(raw.get("annual_targets"))
        periods = _array(raw.get("period_allocations"))
        binding = {
            "generation_id": generation_id,
            "run_id": run_id,
            "plan_id": plan_id,
            "plan_contract_hash": plan_contract_hash,
            "operational_year": operational_year,
        }
        if (
            len(periods) != 12
            or _text(raw.get("content_hash"))
            != management_forecast_storage.compute_content_hash(
                binding=binding,
                as_of_date=_text(raw.get("as_of_date")),
                annual_targets=targets,
                period_allocations=periods,
            )
        ):
            return None
        return {
            "id": _text(raw.get("id")),
            "revision_number": int(raw.get("revision_number") or 0),
            "as_of_date": _text(raw.get("as_of_date")),
            "basis": _text(raw.get("basis")) or "invoice",
            "targets": targets,
            "period_allocations": periods,
            "reason": _text(raw.get("reason")),
            "created_by": _text(raw.get("created_by")),
            "created_role": _text(raw.get("created_role")),
            "created_at": _text(raw.get("created_at")),
        }

    # Read compatibility for characterization fixtures from RF-012C2. New
    # writes never use the legacy JSON snapshot shape.
    payload = _mapping(raw.get("payload"))
    binding = _mapping(payload.get("commercial_context"))
    revision = _mapping(payload.get("forecast_revision"))
    if (
        _text(binding.get("generation_id")) != generation_id
        or _text(binding.get("run_id")) != run_id
        or _text(binding.get("plan_contract_hash")) != plan_contract_hash
        or not revision
    ):
        return None
    targets = _target_values(revision.get("targets"))
    if targets["revenue"] <= 0 or targets["contribution"] <= 0:
        return None
    return {
        "id": _text(raw.get("id")),
        "as_of_date": _text(raw.get("as_of_date")),
        "basis": _text(raw.get("basis")) or "invoice",
        "targets": targets,
        "period_allocations": _array(revision.get("period_allocations")),
        "reason": _text(revision.get("reason")),
    }


def build_break_even_commercial_context(
    *,
    generation: dict[str, Any] | None,
    run: dict[str, Any] | None,
    plan_row: dict[str, Any] | None,
    candidate_rows: Iterable[dict[str, Any]],
    forecast_revision_row: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Project the active RF-013 generation into the RF-012C2 planning contract."""

    if not generation:
        return _missing("active_commercial_generation_missing")
    binding = {
        "mode": "active_generation",
        "version": CONTRACT_VERSION,
        "generation_id": _text(generation.get("id")),
        "operational_year": int(generation.get("operational_year") or 0),
        "validation_hash": _text(generation.get("validation_hash")),
    }
    if _text(generation.get("status")) != "active":
        return _missing(
            "active_commercial_generation_not_operational",
            binding=binding,
        )
    if _text(generation.get("readiness_status")) != "ready":
        return _missing(
            "active_commercial_generation_not_ready",
            binding=binding,
        )
    if not run:
        return _missing(
            "active_commercial_reconciliation_run_missing",
            binding=binding,
        )
    binding.update(
        {
            "run_id": _text(run.get("id")),
            "manifest_hash": _text(run.get("manifest_hash")),
            "validation_hash": _text(run.get("validation_hash"))
            or binding["validation_hash"],
        }
    )
    if _text(run.get("generation_id")) != binding["generation_id"]:
        return _missing(
            "active_commercial_reconciliation_generation_mismatch",
            binding=binding,
        )
    if _text(run.get("status")) != "active":
        return _missing(
            "active_commercial_reconciliation_run_not_operational",
            binding=binding,
        )
    if _text(run.get("readiness_status")) != "ready":
        return _missing(
            "active_commercial_reconciliation_run_not_ready",
            binding=binding,
        )
    if not plan_row:
        return _missing("active_commercial_plan_missing", binding=binding)
    binding.update(
        {
            "plan_id": _text(plan_row.get("id")),
            "plan_contract_hash": _text(
                plan_row.get("plan_contract_hash")
            ),
        }
    )
    if _text(plan_row.get("readiness_status")) != "ready":
        return _missing(
            "active_commercial_plan_not_ready",
            binding=binding,
        )
    if _codes(plan_row.get("blocker_codes")):
        return _missing(
            "active_commercial_plan_has_blockers",
            binding=binding,
        )

    frozen_plan = _mapping(plan_row.get("frozen_plan"))
    plan_payload = _mapping(frozen_plan.get("payload"))
    initial_forecast = _mapping(plan_row.get("initial_forecast"))
    initial_forecast_payload = _mapping(initial_forecast.get("forecast"))
    plan_contract_hash = _text(plan_row.get("plan_contract_hash"))
    if not plan_payload:
        return _missing(
            "active_commercial_plan_payload_missing",
            binding=binding,
        )
    validated_plan = commercial_yearset_service.validate_plan_contract(
        source=_text(frozen_plan.get("source")),
        payload=plan_payload,
    )
    if not validated_plan.get("ready"):
        return _missing(
            "active_commercial_plan_contract_invalid",
            binding=binding,
        )
    if _text(validated_plan.get("contract_hash")) != plan_contract_hash:
        return _missing(
            "active_commercial_plan_hash_mismatch",
            binding=binding,
        )
    if initial_forecast_payload != plan_payload:
        return _missing(
            "active_commercial_initial_forecast_mismatch",
            binding=binding,
        )
    if _text(initial_forecast.get("plan_contract_hash")) != plan_contract_hash:
        return _missing(
            "active_commercial_initial_forecast_hash_mismatch",
            binding=binding,
        )

    targets = _target_values(plan_payload.get("targets"))
    period_allocations = _array(plan_payload.get("period_allocations"))
    sku_allocations = _array(plan_payload.get("sku_allocations"))
    expected_periods = {
        f"{binding['operational_year']}-{month:02d}"
        for month in range(1, 13)
    }
    actual_periods = {
        _text(row.get("period"))[:7]
        for row in period_allocations
        if _text(row.get("period"))
    }
    if (
        targets["revenue"] <= 0
        or targets["contribution"] <= 0
        or not period_allocations
        or not sku_allocations
    ):
        return _missing(
            "active_commercial_plan_contract_incomplete",
            binding=binding,
        )
    if len(period_allocations) != 12 or actual_periods != expected_periods:
        return _missing(
            "active_commercial_plan_periods_incomplete",
            binding=binding,
        )

    generation_id = _text(generation.get("id"))
    run_id = _text(run.get("id"))
    return {
        "version": CONTRACT_VERSION,
        "status": "ready",
        "consumer_mode": "active_generation",
        "binding": binding,
        "plan": {
            "source": _text(frozen_plan.get("source")),
            "source_record_id": _text(frozen_plan.get("source_record_id")),
            "targets": targets,
            "period_allocations": period_allocations,
            "sku_allocations": sku_allocations,
            "immutable": True,
        },
        "planning_rows": _planning_rows(sku_allocations, candidate_rows),
        "forecast_revision": _matching_forecast_revision(
            forecast_revision_row,
            generation_id=generation_id,
            run_id=run_id,
            plan_id=_text(plan_row.get("id")),
            plan_contract_hash=plan_contract_hash,
            operational_year=int(binding.get("operational_year") or 0),
        ),
        "reason_codes": [],
    }


def _period_values(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, float]]:
    result: dict[str, dict[str, float]] = {}
    for row in rows:
        period = _text(row.get("period"))[:7]
        if len(period) != 7:
            continue
        result[period] = {
            key: _number(row.get(key))
            for key in _TARGET_KEYS
        }
    return result


def _timeline(
    *,
    plan_periods: list[dict[str, Any]],
    actual_periods: list[dict[str, Any]],
    forecast_periods: list[dict[str, Any]],
    actual_cutoff_period: str,
) -> list[dict[str, Any]]:
    plan = _period_values(plan_periods)
    actual = _period_values(actual_periods)
    forecast = _period_values(forecast_periods)
    periods = sorted(set(plan) | set(actual) | set(forecast))
    running = {
        f"{scope}_{key}": 0.0
        for scope in ("plan", "actual", "forecast")
        for key in _TARGET_KEYS
    }
    result: list[dict[str, Any]] = []
    for period in periods:
        plan_row = plan.get(period, {})
        actual_row = actual.get(period, {})
        forecast_row = forecast.get(period, {})
        values = {
            f"{scope}_{key}": _number(row.get(key))
            for scope, row in (
                ("plan", plan_row),
                ("actual", actual_row),
                ("forecast", forecast_row),
            )
            for key in _TARGET_KEYS
        }
        for key, value in values.items():
            running[key] += value
        result.append(
            {
                "period": period,
                "actual_available": bool(
                    actual_cutoff_period and period <= actual_cutoff_period
                ),
                "revenue": values["actual_revenue"],
                "variable_cost": values["actual_variable_cost"],
                "contribution": values["actual_contribution"],
                "fixed_allocation": 0.0,
                "running_revenue": running["actual_revenue"],
                "running_variable_cost": running["actual_variable_cost"],
                "running_contribution": running["actual_contribution"],
                **values,
                **{f"running_{key}": value for key, value in running.items()},
            }
        )
    return result


def _period_elapsed_fraction(
    period: str,
    *,
    actual_cutoff_period: str,
    actual_as_of_date: str,
) -> float:
    if not actual_cutoff_period:
        return 0.0
    if period < actual_cutoff_period:
        return 1.0
    if period > actual_cutoff_period:
        return 0.0
    try:
        as_of = date.fromisoformat(actual_as_of_date[:10])
        year_value, month_value = (int(part) for part in period.split("-"))
    except (TypeError, ValueError):
        return 1.0
    if as_of.year != year_value or as_of.month != month_value:
        return 1.0
    return min(
        1.0,
        max(0.0, as_of.day / monthrange(as_of.year, as_of.month)[1]),
    )


def _scaled_period(row: dict[str, Any], factor: float) -> dict[str, Any]:
    return {
        "period": _text(row.get("period"))[:7],
        **{
            key: _number(row.get(key)) * factor
            for key in _TARGET_KEYS
        },
    }


def _sum_targets(rows: Iterable[dict[str, Any]]) -> dict[str, float]:
    return {
        key: sum(_number(row.get(key)) for row in rows)
        for key in _TARGET_KEYS
    }


def _merge_periods(
    *groups: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for group in groups:
        for row in group:
            period = _text(row.get("period"))[:7]
            if len(period) != 7:
                continue
            bucket = merged.setdefault(
                period,
                {"period": period, **{key: 0.0 for key in _TARGET_KEYS}},
            )
            for key in _TARGET_KEYS:
                bucket[key] += _number(row.get(key))
    return [merged[key] for key in sorted(merged)]


def project_plan_forecast(
    context: dict[str, Any],
    *,
    actual_totals: dict[str, Any],
    actual_periods: Iterable[dict[str, Any]],
    actual_as_of_date: str = "",
    closed_year: bool = False,
) -> dict[str, Any]:
    """
    Keep Plan immutable and derive Forecast from realized periods plus remaining Plan.

    Actual-to-date replaces only the elapsed Plan portion. The unelapsed part of
    the current month and all future Plan periods remain in Forecast. A matching
    explicit revision may replace Forecast, while year close always wins.
    """

    plan = _mapping(context.get("plan"))
    plan_targets = _target_values(plan.get("targets"))
    plan_periods = _array(plan.get("period_allocations"))
    actual_period_rows = _array(list(actual_periods))
    actual_period_index = _period_values(actual_period_rows)
    actual_cutoff = max(actual_period_index, default="")
    actual = {
        "revenue": _number(actual_totals.get("revenue")),
        "variable_cost": _number(actual_totals.get("variable_cost")),
        "contribution": _number(actual_totals.get("contribution")),
        "liters": _number(actual_totals.get("liters")),
        "units": _number(actual_totals.get("units")),
    }
    plan_to_date_periods: list[dict[str, Any]] = []
    remaining_periods: list[dict[str, Any]] = []
    for row in plan_periods:
        period = _text(row.get("period"))[:7]
        elapsed = _period_elapsed_fraction(
            period,
            actual_cutoff_period=actual_cutoff,
            actual_as_of_date=actual_as_of_date,
        )
        plan_to_date_periods.append(_scaled_period(row, elapsed))
        remaining_periods.append(_scaled_period(row, 1.0 - elapsed))
    plan_to_date = _sum_targets(plan_to_date_periods)
    remaining = _sum_targets(remaining_periods)

    if closed_year:
        forecast_targets = copy.deepcopy(actual)
        forecast_periods = actual_period_rows
        plan_to_date = copy.deepcopy(plan_targets)
        remaining = {key: 0.0 for key in _TARGET_KEYS}
        source = "year_close_snapshot"
    else:
        forecast_targets = {
            key: actual[key] + remaining[key]
            for key in _TARGET_KEYS
        }
        forecast_periods = _merge_periods(
            actual_period_rows,
            remaining_periods,
        )
        source = (
            "active_generation_initial_forecast"
            if not actual_cutoff and not any(actual[key] for key in _FINANCIAL_KEYS)
            else "active_generation_actual_plus_remaining_plan"
        )

        revision = _mapping(context.get("forecast_revision"))
        revision_targets = _target_values(revision.get("targets"))
        revision_periods = _array(revision.get("period_allocations"))
        if revision and revision_periods:
            forecast_targets = revision_targets
            if revision_periods:
                forecast_periods = revision_periods
            source = "active_generation_forecast_revision"

    if source == "active_generation_initial_forecast":
        forecast_targets = copy.deepcopy(plan_targets)
        forecast_periods = copy.deepcopy(plan_periods)

    return {
        "plan_targets": copy.deepcopy(plan_targets),
        "forecast_targets": forecast_targets,
        "plan_to_date_targets": plan_to_date,
        "remaining_plan_targets": remaining,
        "forecast_source": source,
        "actual_cutoff_period": actual_cutoff,
        "actual_as_of_date": _text(actual_as_of_date)[:10],
        "timeline": _timeline(
            plan_periods=plan_periods,
            actual_periods=actual_period_rows,
            forecast_periods=forecast_periods,
            actual_cutoff_period=actual_cutoff,
        ),
    }


def project_abc_occupancy(
    forecast_projection: dict[str, Any],
    *,
    fixed_cost_total: Any,
    actual_absorbed_fixed_costs: Any,
) -> dict[str, Any]:
    """Compare applied ABC with the same frozen-Plan capacity horizon."""

    fixed_costs = _number(fixed_cost_total)
    actual_absorbed = _number(actual_absorbed_fixed_costs)
    plan_targets = _target_values(
        forecast_projection.get("plan_targets")
    )
    plan_to_date = _target_values(
        forecast_projection.get("plan_to_date_targets")
    )
    driver = next(
        (
            key
            for key in ("liters", "units", "revenue")
            if plan_targets[key] > 0
        ),
        "",
    )
    progress = (
        min(1.0, max(0.0, plan_to_date[driver] / plan_targets[driver]))
        if driver
        else 0.0
    )
    planned_absorbed_to_date = fixed_costs * progress
    closed_year = (
        _text(forecast_projection.get("forecast_source"))
        == "year_close_snapshot"
    )
    forecast_absorbed = (
        actual_absorbed
        if closed_year
        else actual_absorbed + fixed_costs - planned_absorbed_to_date
    )
    return {
        "driver": driver or "unavailable",
        "plan_driver_total": plan_targets.get(driver, 0.0),
        "plan_driver_to_date": plan_to_date.get(driver, 0.0),
        "plan_progress_ratio": progress,
        "plan_absorbed_fixed_costs": fixed_costs,
        "planned_absorbed_fixed_costs_to_date": planned_absorbed_to_date,
        "actual_absorbed_fixed_costs": actual_absorbed,
        "forecast_absorbed_fixed_costs": forecast_absorbed,
        "plan_occupancy_variance": 0.0,
        "actual_occupancy_variance": actual_absorbed - fixed_costs,
        "forecast_occupancy_variance": forecast_absorbed - fixed_costs,
    }


def read_break_even_commercial_context() -> dict[str, Any]:
    """Read active RF-013 authority only; never initialize schema or mutate data."""

    with postgres_storage.connect() as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        generation_row = conn.execute(
            """
            SELECT id, operational_year, status, readiness_status, validation_hash
            FROM commercial_yearsets
            WHERE status = 'active'
            """
        ).fetchone()
        if not generation_row:
            return _missing("active_commercial_generation_missing")
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
              AND status = 'active'
            """,
            (generation["id"],),
        ).fetchone()
        if not run_row:
            return build_break_even_commercial_context(
                generation=generation,
                run=None,
                plan_row=None,
                candidate_rows=[],
            )
        run = {
            "id": _text(run_row[0]),
            "generation_id": _text(run_row[1]),
            "status": _text(run_row[2]),
            "readiness_status": _text(run_row[3]),
            "manifest_hash": _text(run_row[4]),
            "validation_hash": _text(run_row[5]),
        }
        plan_data = conn.execute(
            """
            SELECT id, source_plan_id, plan_contract_hash, frozen_plan,
                   initial_forecast, readiness_status, blocker_codes, source_hash
            FROM commercial_yearset_candidate_plan
            WHERE run_id = %s
            """,
            (run["id"],),
        ).fetchone()
        plan_row = (
            {
                "id": _text(plan_data[0]),
                "source_plan_id": _text(plan_data[1]),
                "plan_contract_hash": _text(plan_data[2]),
                "frozen_plan": plan_data[3],
                "initial_forecast": plan_data[4],
                "readiness_status": _text(plan_data[5]),
                "blocker_codes": plan_data[6],
                "source_hash": _text(plan_data[7]),
            }
            if plan_data
            else None
        )
        sku_data = conn.execute(
            """
            SELECT s.sku_id, s.scope_classification, s.primary_cost,
                   s.packaging_cost, s.overhead_cost, s.excise_cost,
                   s.cost_price, s.liters_per_unit, s.cost_required,
                   s.readiness_status, k.code, k.name
            FROM commercial_yearset_candidate_skus s
            LEFT JOIN skus k ON k.id = s.sku_id
            WHERE s.run_id = %s
            ORDER BY s.sku_id
            """,
            (run["id"],),
        ).fetchall()
        revision_data = conn.execute(
            """
            SELECT id, generation_id, run_id, plan_id,
                   plan_contract_hash, operational_year, revision_number,
                   status, as_of_date, basis, annual_targets,
                   period_allocations, reason, created_by, created_role,
                   created_at, supersedes_revision_id, content_hash
            FROM commercial_forecast_revisions
            WHERE generation_id = %s
              AND run_id = %s
              AND plan_id = %s
              AND plan_contract_hash = %s
              AND status = 'active'
            """,
            (
                generation["id"],
                run["id"],
                _text((plan_row or {}).get("id")),
                _text((plan_row or {}).get("plan_contract_hash")),
            ),
        ).fetchone()

    sku_columns = (
        "sku_id",
        "scope_classification",
        "primary_cost",
        "packaging_cost",
        "overhead_cost",
        "excise_cost",
        "cost_price",
        "liters_per_unit",
        "cost_required",
        "readiness_status",
        "sku_code",
        "sku_name",
    )
    revision_columns = (
        "id", "generation_id", "run_id", "plan_id",
        "plan_contract_hash", "operational_year", "revision_number",
        "status", "as_of_date", "basis", "annual_targets",
        "period_allocations", "reason", "created_by", "created_role",
        "created_at", "supersedes_revision_id", "content_hash",
    )
    revision_row = (
        dict(zip(revision_columns, revision_data, strict=True))
        if revision_data
        else None
    )
    return build_break_even_commercial_context(
        generation=generation,
        run=run,
        plan_row=plan_row,
        candidate_rows=[
            dict(zip(sku_columns, row, strict=True))
            for row in sku_data
        ],
        forecast_revision_row=revision_row,
    )
