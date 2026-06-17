from __future__ import annotations

from datetime import date
from typing import Any

from app.domain import (
    break_even_planning_storage,
    cost_versions_storage,
    dataset_store,
    douano_sales_mix_service,
    fixed_costs_storage,
    postgres_storage,
)


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _text(value: Any) -> str:
    return str(value or "").strip()


def _year_fixed_cost_total(year: int) -> float:
    grouped = fixed_costs_storage.load_grouped_by_year()
    rows = grouped.get(str(int(year or 0)), [])
    return sum(_num(row.get("bedrag_per_jaar")) for row in rows if isinstance(row, dict))


def _sku_labels() -> dict[str, dict[str, str]]:
    postgres_storage.ensure_schema()
    labels: dict[str, dict[str, str]] = {}
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute("SELECT id, code, name FROM skus")
            except Exception:
                return labels
            for sku_id, code, name in cur.fetchall() or []:
                sid = _text(sku_id)
                if sid:
                    labels[sid] = {"sku_id": sid, "sku_code": _text(code), "sku_name": _text(name)}
    return labels


def _active_planning_rows(year: int) -> list[dict[str, Any]]:
    activations = dataset_store.load_dataset("kostprijsproductactiveringen")
    active = [
        row
        for row in (activations if isinstance(activations, list) else [])
        if isinstance(row, dict)
        and int(row.get("jaar", 0) or 0) == int(year or 0)
        and not _text(row.get("effectief_tot"))
        and _text(row.get("sku_id"))
        and _text(row.get("kostprijsversie_id"))
    ]
    version_ids = sorted({_text(row.get("kostprijsversie_id")) for row in active})
    component_index = cost_versions_storage.load_cost_row_components_index_for_versions(version_ids)
    labels = _sku_labels()

    rows: list[dict[str, Any]] = []
    for activation in active:
        sku_id = _text(activation.get("sku_id"))
        version_id = _text(activation.get("kostprijsversie_id"))
        components = component_index.get((version_id, sku_id))
        info = labels.get(sku_id, {"sku_id": sku_id, "sku_code": "", "sku_name": ""})
        rows.append(
            {
                **info,
                "kostprijsversie_id": version_id,
                "effectief_vanaf": _text(activation.get("effectief_vanaf")),
                "inkoop": _num((components or {}).get("inkoop")),
                "verpakkingskosten": _num((components or {}).get("verpakkingskosten")),
                "abc_overhead": _num((components or {}).get("indirecte_kosten")),
                "accijns": _num((components or {}).get("accijns")),
                "kostprijs": _num((components or {}).get("kostprijs")),
                "status": "ok" if components else "missing_cost_line",
            }
        )
    rows.sort(key=lambda row: (_text(row.get("sku_name")), _text(row.get("sku_code")), _text(row.get("sku_id"))))
    return rows


def build_plan_payload(*, year: int, scenario_name: str = "Basis") -> dict[str, Any]:
    year_value = int(year or 0)
    rows = _active_planning_rows(year_value)
    fixed_total = _year_fixed_cost_total(year_value)
    missing = [row for row in rows if row.get("status") != "ok"]
    return {
        "kind": "break_even_plan",
        "year": year_value,
        "scenario_name": _text(scenario_name) or "Basis",
        "fixed_cost_total": fixed_total,
        "planning_rows": rows,
        "summary": {
            "sku_count": len(rows),
            "missing_cost_line_count": len(missing),
            "avg_kostprijs": sum(_num(row.get("kostprijs")) for row in rows) / len(rows) if rows else 0.0,
        },
        "model": {
            "planning_scope": "Frozen yearly planning costs for break-even, offers, pricing and yearly preparation.",
            "actual_scope": "Actual LOT purchase costs stay in lot_cost_records and sales_lot_allocations for Omzet en Marge.",
        },
    }


def create_plan_from_active_costs(
    *,
    year: int,
    scenario_name: str = "Basis",
    replace_active: bool = False,
) -> dict[str, Any]:
    payload = build_plan_payload(year=int(year or 0), scenario_name=scenario_name)
    return break_even_planning_storage.create_plan_snapshot(
        year=int(year or 0),
        scenario_name=scenario_name,
        source="planning",
        payload=payload,
        replace_active=replace_active,
    )


def _sales_totals(year: int, basis: str) -> dict[str, Any]:
    summary = douano_sales_mix_service.get_sales_by_sku_summary(year=int(year or 0), basis=basis)
    items = summary.get("items") if isinstance(summary, dict) else []
    periods = summary.get("periods") if isinstance(summary, dict) else []
    rows = [row for row in (items if isinstance(items, list) else []) if isinstance(row, dict)]
    period_rows = [row for row in (periods if isinstance(periods, list) else []) if isinstance(row, dict)]
    revenue = sum(_num(row.get("net_revenue_ex")) for row in rows)
    cost = sum(_num(row.get("cost_total_ex")) for row in rows)
    fixed_alloc = sum(_num(row.get("fixed_total_ex")) for row in rows)
    contribution = revenue - (cost - fixed_alloc)
    period_totals: dict[str, dict[str, float]] = {}
    for row in period_rows:
        period = _text(row.get("period"))
        if not period:
            continue
        bucket = period_totals.setdefault(period, {"revenue": 0.0, "variable_cost": 0.0, "fixed_alloc": 0.0, "contribution": 0.0})
        row_cost = _num(row.get("cost_total_ex"))
        row_fixed = _num(row.get("fixed_total_ex"))
        bucket["revenue"] += _num(row.get("net_revenue_ex"))
        bucket["variable_cost"] += row_cost - row_fixed
        bucket["fixed_alloc"] += row_fixed
        bucket["contribution"] += _num(row.get("net_revenue_ex")) - (row_cost - row_fixed)
    return {
        "raw": summary,
        "rows": rows,
        "period_totals": [{"period": key, **value} for key, value in sorted(period_totals.items())],
        "totals": {
            "revenue": revenue,
            "cost": cost,
            "variable_cost": cost - fixed_alloc,
            "fixed_alloc": fixed_alloc,
            "contribution": contribution,
            "missing_cost_lines": int((summary.get("meta") or {}).get("missing_cost_lines", 0) if isinstance(summary, dict) else 0),
            "unmapped_revenue": _num(((summary.get("unmapped") or {}) if isinstance(summary, dict) else {}).get("total_net_revenue_ex")),
        },
    }


def create_reforecast(
    *,
    year: int,
    plan_snapshot_id: str = "",
    as_of_date: str = "",
    basis: str = "invoice",
) -> dict[str, Any]:
    year_value = int(year or 0)
    basis_value = _text(basis) or "invoice"
    sales = _sales_totals(year_value, basis_value)
    fixed_total = _year_fixed_cost_total(year_value)
    contribution = _num((sales.get("totals") or {}).get("contribution"))
    months = len(sales.get("period_totals") or [])
    monthly = contribution / months if months else 0.0
    estimated_months_to_break_even = fixed_total / monthly if monthly > 0 else 0.0
    payload = {
        "kind": "break_even_reforecast",
        "year": year_value,
        "basis": basis_value,
        "as_of_date": as_of_date or date.today().isoformat(),
        "plan_snapshot_id": _text(plan_snapshot_id),
        "fixed_cost_total": fixed_total,
        "actuals": sales,
        "reforecast": {
            "monthly_contribution_average": monthly,
            "estimated_months_to_break_even": estimated_months_to_break_even,
            "break_even_revenue_estimate": fixed_total / (contribution / _num((sales.get("totals") or {}).get("revenue"))) if contribution > 0 and _num((sales.get("totals") or {}).get("revenue")) > 0 else 0.0,
        },
    }
    return break_even_planning_storage.create_reforecast_snapshot(
        year=year_value,
        plan_snapshot_id=plan_snapshot_id,
        as_of_date=as_of_date or date.today().isoformat(),
        basis=basis_value,
        payload=payload,
    )


def build_year_close_payload(*, year: int, basis: str = "invoice") -> dict[str, Any]:
    year_value = int(year or 0)
    basis_value = _text(basis) or "invoice"
    sales = _sales_totals(year_value, basis_value)
    return {
        "kind": "year_close",
        "year": year_value,
        "basis": basis_value,
        "fixed_cost_total": _year_fixed_cost_total(year_value),
        "actuals": sales,
        "checks": {
            "missing_cost_lines": int((sales.get("totals") or {}).get("missing_cost_lines") or 0),
            "unmapped_revenue": _num((sales.get("totals") or {}).get("unmapped_revenue")),
        },
    }


def close_year(*, year: int, basis: str = "invoice", overwrite: bool = False) -> dict[str, Any]:
    year_value = int(year or 0)
    payload = build_year_close_payload(year=year_value, basis=basis)
    return break_even_planning_storage.close_year_snapshot(year=year_value, payload=payload, overwrite=overwrite)


def model_review() -> dict[str, Any]:
    storage_audit = break_even_planning_storage.audit_model()
    return {
        **storage_audit,
        "theory_check": {
            "planning_vs_actual": "OK: planning cost rows are separate from actual LOT margin rows.",
            "cost_formula_actual": "Omzet en Marge should resolve LOT purchase cost + active SKU accijns + packaging + ABC overhead.",
            "snapshot_policy": "OK: prediction/reforecast/year-close are immutable snapshot records.",
            "year_iteration": "OK: next-year preparation can use closed-year actuals without mutating prior predictions.",
        },
        "datamodel_review": {
            "primary_keys": [
                "break_even_plan_snapshots.id",
                "break_even_reforecast_snapshots.id",
                "year_close_snapshots.id",
                "cost_versions.id",
                "cost_version_sku_rows.id",
                "kostprijs_sku_activations.id",
                "lot_cost_records.id",
                "sales_lot_allocations.id",
            ],
            "foreign_keys": [
                "cost_version_sku_rows.version_id -> cost_versions.id",
                "cost_version_sku_rows.sku_id -> skus.id (NOT VALID for legacy dev data)",
                "kostprijs_sku_activations.kostprijsversie_id -> cost_versions.id (NOT VALID for legacy dev data)",
                "kostprijs_sku_activations.sku_id -> skus.id (NOT VALID for legacy dev data)",
                "break_even_reforecast_snapshots.plan_snapshot_id -> break_even_plan_snapshots.id (ON DELETE SET NULL, NOT VALID for legacy dev data)",
            ],
            "normalization": "SKU-level reusable cost components stay normalized; immutable analytical snapshots use JSON payloads by design.",
            "known_tradeoffs": [
                "Snapshots store denormalized reporting payloads intentionally so historical analyses are reproducible.",
                "Legacy FK constraints are NOT VALID until current dev data is cleaned.",
            ],
            "antipatterns": [],
        },
    }
