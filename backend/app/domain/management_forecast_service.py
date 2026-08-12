from __future__ import annotations

from calendar import monthrange
import copy
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Iterable
from uuid import uuid4

from app.domain import break_even_planning_service, management_forecast_storage


TARGET_KEYS = ("revenue", "variable_cost", "contribution", "liters", "units")
MONEY_KEYS = ("revenue", "variable_cost", "contribution")
SCALE = Decimal("0.000001")
MONEY_TOLERANCE = Decimal("0.01")
QUANTITY_TOLERANCE = Decimal("0.001")


class ManagementForecastValidationError(ValueError):
    pass


def _text(value: Any) -> str:
    return str(value or "").strip()


def _mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _array(value: Any) -> list[dict[str, Any]]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _decimal(
    value: Any, *, label: str, allow_negative: bool = False
) -> Decimal:
    try:
        number = Decimal(str(value or 0))
    except (InvalidOperation, ValueError) as exc:
        raise ManagementForecastValidationError(
            f"{label} is geen geldig getal."
        ) from exc
    if not number.is_finite() or (number < 0 and not allow_negative):
        raise ManagementForecastValidationError(
            f"{label} moet {'een eindig' if allow_negative else 'een niet-negatief eindig'} getal zijn."
        )
    return number.quantize(SCALE, rounding=ROUND_HALF_UP)


def _float(value: Decimal) -> float:
    return float(value.quantize(SCALE, rounding=ROUND_HALF_UP))


def _period_is_closed(period: str, *, cutoff: str, as_of_date: str) -> bool:
    if not cutoff or period > cutoff:
        return False
    if period < cutoff:
        return True
    try:
        current = date.fromisoformat(as_of_date[:10])
        year_value, month_value = (int(part) for part in period.split("-"))
    except (TypeError, ValueError):
        return False
    return (
        current.year == year_value
        and current.month == month_value
        and current.day == monthrange(current.year, current.month)[1]
    )


def _binding_from_read_model(read_model: dict[str, Any]) -> dict[str, Any]:
    sources = _mapping(read_model.get("sources"))
    binding = {
        "generation_id": _text(sources.get("commercial_generation_id")),
        "run_id": _text(sources.get("commercial_run_id")),
        "plan_id": _text(sources.get("plan_snapshot_id")),
        "plan_contract_hash": _text(sources.get("plan_contract_hash")),
        "operational_year": int(read_model.get("year") or 0),
    }
    if (
        _text(sources.get("consumer_mode")) != "active_generation"
        or not all(_text(binding[key]) for key in (
            "generation_id", "run_id", "plan_id", "plan_contract_hash"
        ))
        or binding["operational_year"] <= 0
    ):
        raise management_forecast_storage.ManagementForecastBlocked(
            "Management Forecast vereist een actieve, gereconcilieerde commerciële jaarset met een bevroren Plan."
        )
    return binding


def _timeline_workspace(read_model: dict[str, Any]) -> list[dict[str, Any]]:
    sources = _mapping(read_model.get("sources"))
    cutoff = _text(sources.get("forecast_cutoff_period"))
    as_of_date = _text(sources.get("actual_as_of_date"))
    rows: list[dict[str, Any]] = []
    for raw in _array(read_model.get("timeline")):
        period = _text(raw.get("period"))[:7]
        if len(period) != 7:
            continue
        row: dict[str, Any] = {
            "period": period,
            "closed": _period_is_closed(
                period, cutoff=cutoff, as_of_date=as_of_date
            ),
            "current_partial": bool(period == cutoff) and not _period_is_closed(
                period, cutoff=cutoff, as_of_date=as_of_date
            ),
        }
        for scope in ("plan", "actual", "forecast"):
            for key in TARGET_KEYS:
                row[f"{scope}_{key}"] = float(raw.get(f"{scope}_{key}") or 0)
        rows.append(row)
    return rows


def read_workspace() -> dict[str, Any]:
    read_model = break_even_planning_service.build_analysis_read_model(
        year=0, basis="invoice"
    )
    binding = _binding_from_read_model(read_model)
    sources = _mapping(read_model.get("sources"))
    history = management_forecast_storage.list_revisions(
        generation_id=binding["generation_id"]
    )
    current = next(
        (row for row in history if _text(row.get("status")) == "active"),
        None,
    )
    return {
        "version": 1,
        "status": "closed" if _text(sources.get("reforecast_source")) == "year_close_snapshot" else "ready",
        "binding": binding,
        "basis": "invoice",
        "actual_as_of_date": _text(sources.get("actual_as_of_date")),
        "actual_cutoff_period": _text(sources.get("forecast_cutoff_period")),
        "forecast_source": _text(sources.get("reforecast_source")),
        "current_revision": current,
        "history": history,
        "periods": _timeline_workspace(read_model),
        "policy": {
            "actual_source": "douano_sales_line_cost_snapshots:invoice",
            "closed_periods": "exact_actual",
            "current_period": "actual_floor_plus_management_expectation",
            "future_periods": "management_expectation",
            "order_backlog": "not_inferred",
            "contribution": "revenue_minus_variable_cost",
        },
    }


def _normalize_periods(
    rows: Iterable[dict[str, Any]], *, workspace: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, float]]:
    binding = _mapping(workspace.get("binding"))
    year = int(binding.get("operational_year") or 0)
    expected_periods = {f"{year}-{month:02d}" for month in range(1, 13)}
    actual_index = {
        _text(row.get("period")): row
        for row in _array(workspace.get("periods"))
    }
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in rows:
        period = _text(raw.get("period"))
        if period in seen:
            raise ManagementForecastValidationError(
                f"Periode {period} komt meer dan een keer voor."
            )
        seen.add(period)
        actual_row = actual_index.get(period, {})
        closed = bool(actual_row.get("closed"))
        values = {
            key: _decimal(
                raw.get(key),
                label=f"{period} {key}",
                allow_negative=closed or key == "contribution",
            )
            for key in TARGET_KEYS
        }
        derived = values["revenue"] - values["variable_cost"]
        if abs(values["contribution"] - derived) > MONEY_TOLERANCE:
            raise ManagementForecastValidationError(
                f"{period}: contributie moet gelijk zijn aan omzet minus variabele kosten."
            )
        values["contribution"] = derived.quantize(SCALE, rounding=ROUND_HALF_UP)

        for key in TARGET_KEYS:
            actual = _decimal(
                actual_row.get(f"actual_{key}"),
                label=f"{period} Actual {key}",
                allow_negative=True,
            )
            tolerance = MONEY_TOLERANCE if key in MONEY_KEYS else QUANTITY_TOLERANCE
            if actual_row.get("closed") and abs(values[key] - actual) > tolerance:
                raise ManagementForecastValidationError(
                    f"{period} is verstreken; Forecast {key} moet exact gelijk blijven aan Actual."
                )
            if (
                key != "contribution"
                and actual_row.get("current_partial")
                and values[key] + tolerance < actual
            ):
                raise ManagementForecastValidationError(
                    f"{period} loopt nog; Forecast {key} mag niet lager zijn dan de reeds gefactureerde Actual."
                )
        normalized.append(
            {"period": period, **{key: _float(value) for key, value in values.items()}}
        )

    if seen != expected_periods:
        missing = ", ".join(sorted(expected_periods - seen)) or "geen"
        unexpected = ", ".join(sorted(seen - expected_periods)) or "geen"
        raise ManagementForecastValidationError(
            f"Forecast moet exact 12 maanden van {year} bevatten (ontbreekt: {missing}; onverwacht: {unexpected})."
        )
    normalized.sort(key=lambda row: row["period"])
    totals = {
        key: _float(sum(Decimal(str(row[key])) for row in normalized))
        for key in TARGET_KEYS
    }
    return normalized, totals


def _content_hash(
    *, binding: dict[str, Any], as_of_date: str,
    annual_targets: dict[str, float], period_allocations: list[dict[str, Any]]
) -> str:
    return management_forecast_storage.compute_content_hash(
        binding=binding,
        as_of_date=as_of_date,
        annual_targets=annual_targets,
        period_allocations=period_allocations,
    )


def create_revision(
    *, binding: dict[str, Any], expected_active_revision_id: str,
    reason: str, period_allocations: list[dict[str, Any]],
    actor: str, actor_role: str,
) -> dict[str, Any]:
    if len(_text(reason)) < 10:
        raise ManagementForecastValidationError(
            "De reden voor een Forecast-revisie moet minimaal 10 tekens bevatten."
        )
    workspace = read_workspace()
    current_binding = _mapping(workspace.get("binding"))
    if binding != current_binding:
        raise management_forecast_storage.ManagementForecastConflict(
            "De actieve jaarset- of Plan-binding is gewijzigd. Vernieuw de pagina."
        )
    current = _mapping(workspace.get("current_revision"))
    if _text(current.get("id")) != _text(expected_active_revision_id):
        raise management_forecast_storage.ManagementForecastConflict(
            "Er is inmiddels een andere Forecast-revisie actief. Vernieuw de pagina."
        )
    if workspace.get("status") == "closed":
        raise management_forecast_storage.ManagementForecastBlocked(
            "Het jaar is afgesloten; Forecast is gelijk aan definitieve Actual."
        )
    normalized, totals = _normalize_periods(
        period_allocations, workspace=workspace
    )
    as_of_date = _text(workspace.get("actual_as_of_date")) or date.today().isoformat()
    content_hash = _content_hash(
        binding=current_binding,
        as_of_date=as_of_date,
        annual_targets=totals,
        period_allocations=normalized,
    )
    saved = management_forecast_storage.create_revision(
        revision_id=str(uuid4()),
        generation_id=_text(current_binding.get("generation_id")),
        run_id=_text(current_binding.get("run_id")),
        plan_id=_text(current_binding.get("plan_id")),
        plan_contract_hash=_text(current_binding.get("plan_contract_hash")),
        operational_year=int(current_binding.get("operational_year") or 0),
        as_of_date=as_of_date,
        annual_targets=totals,
        period_allocations=normalized,
        reason=_text(reason),
        actor=_text(actor),
        actor_role=_text(actor_role),
        content_hash=content_hash,
        expected_active_revision_id=_text(expected_active_revision_id),
    )
    saved_periods = {
        _text(row.get("period")): row for row in normalized
    }
    refreshed_workspace = copy.deepcopy(workspace)
    refreshed_workspace["forecast_source"] = (
        "active_generation_forecast_revision"
    )
    refreshed_workspace["current_revision"] = copy.deepcopy(saved)
    refreshed_workspace["history"] = [
        copy.deepcopy(saved),
        *[
            {
                **copy.deepcopy(row),
                "status": (
                    "superseded"
                    if _text(row.get("status")) == "active"
                    else _text(row.get("status"))
                ),
            }
            for row in _array(workspace.get("history"))
            if _text(row.get("id")) != _text(saved.get("id"))
        ],
    ]
    for row in _array(refreshed_workspace.get("periods")):
        saved_period = saved_periods.get(_text(row.get("period")))
        if not saved_period:
            continue
        for key in TARGET_KEYS:
            row[f"forecast_{key}"] = saved_period[key]
    return {"saved": saved, "workspace": refreshed_workspace}
