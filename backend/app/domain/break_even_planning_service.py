from __future__ import annotations

from datetime import date
from typing import Any

from app.domain import (
    break_even_planning_storage,
    cost_versions_storage,
    dataset_store,
    douano_margin_snapshot_storage,
    erp_dashboard_service,
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


def _money_ratio(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


def _year_bounds(year: int) -> tuple[str, str] | tuple[None, None]:
    y = int(year or 0)
    if y <= 0:
        return None, None
    return f"{y:04d}-01-01", f"{(y + 1):04d}-01-01"


def _plan_targets_payload(raw: dict[str, Any] | None, *, fixed_cost_total: float) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    revenue = _num(source.get("revenue"))
    contribution = _num(source.get("contribution"))
    liters = _num(source.get("liters"))
    units = _num(source.get("units"))
    price_change_pct = _num(source.get("price_change_pct"))
    volume_change_pct = _num(source.get("volume_change_pct"))
    mix_assumption = _text(source.get("mix_assumption"))
    return {
        "revenue": revenue,
        "contribution": contribution,
        "liters": liters,
        "units": units,
        "fixed_costs": fixed_cost_total,
        "operating_result": contribution - fixed_cost_total if contribution else 0.0,
        "contribution_ratio": _money_ratio(contribution, revenue),
        "price_change_pct": price_change_pct,
        "volume_change_pct": volume_change_pct,
        "mix_assumption": mix_assumption,
        "source": "explicit_user_input" if any([revenue, contribution, liters, units, price_change_pct, volume_change_pct, mix_assumption]) else "not_provided",
    }


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


def _latest_active_plan(year: int) -> dict[str, Any] | None:
    plans = break_even_planning_storage.list_plan_snapshots(year=int(year or 0), include_archived=False)
    active = [plan for plan in plans if _text(plan.get("status")) == "active"]
    return active[0] if active else None


def _sku_category(row: dict[str, Any], labels: dict[str, dict[str, str]]) -> str:
    sku_id = _text(row.get("sku_id"))
    label = labels.get(sku_id, {})
    haystack = f"{label.get('sku_name', '')} {label.get('sku_code', '')} {row.get('sku_name', '')} {row.get('sku_code', '')} {sku_id}".lower()
    if "geschenk" in haystack or "gift" in haystack:
        return "giftset"
    if "proeverij" in haystack or "rondleiding" in haystack:
        return "service"
    if "glas" in haystack or "merch" in haystack:
        return "merchandise"
    return "beer"


def _category_treatment(category: str) -> str:
    if category == "giftset":
        return "Omzet als product; liters en mix via onderliggende samenstelling zodra bekend."
    if category == "service":
        return "Service-omzet; bierverbruik alleen als variabele kost wanneer geconfigureerd."
    if category == "merchandise":
        return "Contributie telt mee; geen bierliters."
    return "Omzet, contributie, liters en mix."


def _contribution_row(row: dict[str, Any], labels: dict[str, dict[str, str]]) -> dict[str, Any]:
    sku_id = _text(row.get("sku_id"))
    label = labels.get(sku_id, {"sku_id": sku_id, "sku_code": "", "sku_name": sku_id})
    revenue = _num(row.get("net_revenue_ex"))
    variable = _num(row.get("cost_total_ex")) - _num(row.get("fixed_total_ex"))
    contribution = revenue - variable
    category = _sku_category(row, labels)
    units = _num(row.get("units"))
    return {
        "sku_id": sku_id,
        "sku_code": _text(label.get("sku_code")) or _text(row.get("sku_code")),
        "sku_name": _text(label.get("sku_name")) or _text(row.get("sku_name")) or sku_id,
        "category": category,
        "units": units,
        "revenue": revenue,
        "variable_cost": variable,
        "purchase": _num(row.get("inkoop_total_ex")),
        "packaging": _num(row.get("packaging_total_ex")),
        "excise": _num(row.get("excise_total_ex")),
        "fixed_allocation": _num(row.get("fixed_total_ex")),
        "contribution": contribution,
        "allocated_margin": contribution - _num(row.get("fixed_total_ex")),
        "contribution_ratio": _money_ratio(contribution, revenue),
        "missing_cost_lines": int(row.get("missing_cost_lines", 0) or 0),
    }


def _category_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        category = _text(row.get("category")) or "beer"
        bucket = buckets.setdefault(
            category,
            {
                "category": category,
                "rows": 0,
                "revenue": 0.0,
                "variable_cost": 0.0,
                "contribution": 0.0,
                "fixed_allocation": 0.0,
                "allocated_margin": 0.0,
                "units": 0.0,
                "treatment": _category_treatment(category),
            },
        )
        bucket["rows"] += 1
        bucket["revenue"] += _num(row.get("revenue"))
        bucket["variable_cost"] += _num(row.get("variable_cost"))
        bucket["contribution"] += _num(row.get("contribution"))
        bucket["fixed_allocation"] += _num(row.get("fixed_allocation"))
        bucket["allocated_margin"] += _num(row.get("allocated_margin"))
        bucket["units"] += _num(row.get("units"))
    order = {"beer": 0, "giftset": 1, "service": 2, "merchandise": 3}
    return sorted(buckets.values(), key=lambda item: (order.get(_text(item.get("category")), 99), _text(item.get("category"))))


def _period_timeline(periods: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, float | str]] = {}
    for row in periods:
        period = _text(row.get("period"))
        if not period:
            continue
        bucket = buckets.setdefault(period, {"period": period, "revenue": 0.0, "variable_cost": 0.0, "contribution": 0.0, "fixed_allocation": 0.0})
        revenue = _num(row.get("revenue")) or _num(row.get("net_revenue_ex"))
        fixed_allocation = _num(row.get("fixed_alloc")) or _num(row.get("fixed_total_ex"))
        variable_cost = _num(row.get("variable_cost"))
        if variable_cost == 0:
            variable_cost = _num(row.get("cost_total_ex")) - fixed_allocation
        contribution = _num(row.get("contribution"))
        if contribution == 0:
            contribution = revenue - variable_cost
        bucket["revenue"] = _num(bucket.get("revenue")) + revenue
        bucket["variable_cost"] = _num(bucket.get("variable_cost")) + variable_cost
        bucket["contribution"] = _num(bucket.get("contribution")) + contribution
        bucket["fixed_allocation"] = _num(bucket.get("fixed_allocation")) + fixed_allocation
    running_revenue = 0.0
    running_variable_cost = 0.0
    running_contribution = 0.0
    timeline: list[dict[str, Any]] = []
    for period in sorted(buckets):
        bucket = buckets[period]
        running_revenue += _num(bucket.get("revenue"))
        running_variable_cost += _num(bucket.get("variable_cost"))
        running_contribution += _num(bucket.get("contribution"))
        timeline.append({**bucket, "running_revenue": running_revenue, "running_variable_cost": running_variable_cost, "running_contribution": running_contribution})
    return timeline


def _variance_bridge_rows(
    *,
    plan_contribution: float,
    plan_fixed_costs: float,
    reforecast_contribution: float,
    reforecast_fixed_costs: float,
) -> list[dict[str, Any]]:
    plan_result = plan_contribution - plan_fixed_costs if plan_contribution else 0.0
    contribution_variance = reforecast_contribution - plan_contribution if plan_contribution else 0.0
    fixed_cost_variance = plan_fixed_costs - reforecast_fixed_costs if plan_fixed_costs or reforecast_fixed_costs else 0.0
    reforecast_result = reforecast_contribution - reforecast_fixed_costs
    return [
        {"key": "plan", "label": "Gepland resultaat", "value": plan_result, "kind": "result"},
        {
            "key": "contribution",
            "label": "Contributieverschil",
            "value": contribution_variance,
            "kind": "positive" if contribution_variance >= 0 else "negative",
        },
        {
            "key": "fixed_cost",
            "label": "Vastekostenverschil",
            "value": fixed_cost_variance,
            "kind": "positive" if fixed_cost_variance >= 0 else "negative",
        },
        {"key": "result", "label": "Reforecast resultaat", "value": reforecast_result, "kind": "result"},
    ]


def _plan_actual_rows(plan_payload: dict[str, Any], contribution_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    plan_rows = plan_payload.get("planning_rows") if isinstance(plan_payload.get("planning_rows"), list) else []
    plan_by_sku: dict[str, dict[str, Any]] = {
        _text(row.get("sku_id")): row
        for row in plan_rows
        if isinstance(row, dict) and _text(row.get("sku_id"))
    }
    actual_by_sku: dict[str, dict[str, Any]] = {
        _text(row.get("sku_id")): row
        for row in contribution_rows
        if isinstance(row, dict) and _text(row.get("sku_id"))
    }
    sku_ids = sorted(set(plan_by_sku) | set(actual_by_sku))
    rows: list[dict[str, Any]] = []
    for sku_id in sku_ids:
        plan = plan_by_sku.get(sku_id, {})
        actual = actual_by_sku.get(sku_id, {})
        sku_name = _text(actual.get("sku_name")) or _text(plan.get("sku_name")) or sku_id
        sku_code = _text(actual.get("sku_code")) or _text(plan.get("sku_code"))
        plan_variable_cost = _num(plan.get("planned_variable_cost_unit"))
        if plan_variable_cost <= 0:
            plan_variable_cost = _num(plan.get("inkoop")) + _num(plan.get("verpakkingskosten")) + _num(plan.get("accijns"))
        has_plan = bool(plan)
        has_actual = bool(actual)
        if has_plan and has_actual:
            status = "ok"
        elif has_plan:
            status = "plan_only"
        else:
            status = "actual_only"
        rows.append(
            {
                "sku_id": sku_id,
                "sku_code": sku_code,
                "sku_name": sku_name,
                "category": _text(actual.get("category")) or _text(plan.get("category")) or _sku_category({"sku_id": sku_id}, {sku_id: {"sku_name": sku_name, "sku_code": sku_code}}),
                "planned_units": _num(plan.get("planned_units")),
                "planned_liters": _num(plan.get("planned_liters")),
                "planned_variable_cost_unit": plan_variable_cost,
                "planned_fixed_allocation_unit": _num(plan.get("abc_overhead")),
                "planned_cost_unit": _num(plan.get("kostprijs")) or plan_variable_cost + _num(plan.get("abc_overhead")),
                "actual_units": _num(actual.get("units")),
                "actual_revenue": _num(actual.get("revenue")),
                "actual_contribution": _num(actual.get("contribution")),
                "reforecast_units": _num(actual.get("units")),
                "reforecast_contribution": _num(actual.get("contribution")),
                "status": status,
            }
        )
    rows.sort(key=lambda row: (_text(row.get("sku_name")), _text(row.get("sku_code")), _text(row.get("sku_id"))))
    return rows


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


def build_plan_payload(*, year: int, scenario_name: str = "Basis", targets: dict[str, Any] | None = None) -> dict[str, Any]:
    year_value = int(year or 0)
    rows = _active_planning_rows(year_value)
    fixed_total = _year_fixed_cost_total(year_value)
    missing = [row for row in rows if row.get("status") != "ok"]
    target_payload = _plan_targets_payload(targets, fixed_cost_total=fixed_total)
    return {
        "kind": "break_even_plan",
        "year": year_value,
        "scenario_name": _text(scenario_name) or "Basis",
        "fixed_cost_total": fixed_total,
        "targets": target_payload,
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


def build_first_use_backfill_plan_payload(
    *,
    year: int,
    scenario_name: str = "First-use backfill",
    plan_revenue: float,
    fixed_cost_total: float,
    basis: str = "invoice",
) -> dict[str, Any]:
    year_value = int(year or 0)
    if year_value <= 0:
        raise ValueError("Jaar is verplicht.")
    plan_revenue_value = _num(plan_revenue)
    fixed_cost_value = _num(fixed_cost_total)
    if plan_revenue_value <= 0:
        raise ValueError("Planomzet is verplicht.")
    if fixed_cost_value < 0:
        raise ValueError("Vaste kosten mogen niet negatief zijn.")

    sales = _sales_totals(year_value, basis)
    labels = _sku_labels()
    actual_rows = [_contribution_row(row, labels) for row in sales.get("rows", []) if isinstance(row, dict)]
    actual_totals = sales.get("totals") if isinstance(sales.get("totals"), dict) else {}
    actual_revenue = _num(actual_totals.get("revenue"))
    actual_variable = _num(actual_totals.get("variable_cost"))
    actual_contribution = _num(actual_totals.get("contribution"))
    if actual_revenue <= 0:
        raise ValueError("Geen werkelijke omzet gevonden om first-use backfill op te baseren.")

    revenue_scale = plan_revenue_value / actual_revenue
    variable_ratio = _money_ratio(actual_variable, actual_revenue)
    contribution_ratio = _money_ratio(actual_contribution, actual_revenue)
    plan_variable = plan_revenue_value * variable_ratio
    plan_contribution = plan_revenue_value - plan_variable

    planning_rows: list[dict[str, Any]] = []
    for row in actual_rows:
        actual_units = _num(row.get("units"))
        planned_units = actual_units * revenue_scale
        planned_revenue = _num(row.get("revenue")) * revenue_scale
        planned_variable = _num(row.get("variable_cost")) * revenue_scale
        planned_contribution = planned_revenue - planned_variable
        planning_rows.append(
            {
                "sku_id": _text(row.get("sku_id")),
                "sku_code": _text(row.get("sku_code")),
                "sku_name": _text(row.get("sku_name")),
                "category": _text(row.get("category")),
                "source": "actual_mix_scaled_to_plan_revenue",
                "actual_units": actual_units,
                "actual_revenue": _num(row.get("revenue")),
                "actual_variable_cost": _num(row.get("variable_cost")),
                "actual_contribution": _num(row.get("contribution")),
                "planned_units": planned_units,
                "planned_revenue": planned_revenue,
                "planned_variable_cost": planned_variable,
                "planned_contribution": planned_contribution,
                "planned_variable_cost_unit": _money_ratio(planned_variable, planned_units),
                "planned_revenue_unit": _money_ratio(planned_revenue, planned_units),
                "planned_contribution_unit": _money_ratio(planned_contribution, planned_units),
            }
        )

    targets = _plan_targets_payload(
        {
            "revenue": plan_revenue_value,
            "contribution": plan_contribution,
            "units": sum(_num(row.get("planned_units")) for row in planning_rows),
            "mix_assumption": f"{year_value} first-use backfill: actual mix scaled to planned revenue.",
        },
        fixed_cost_total=fixed_cost_value,
    )
    targets["variable_cost"] = plan_variable
    targets["variable_cost_ratio"] = variable_ratio

    return {
        "kind": "break_even_plan",
        "year": year_value,
        "scenario_name": _text(scenario_name) or "First-use backfill",
        "fixed_cost_total": fixed_cost_value,
        "targets": targets,
        "planning_rows": planning_rows,
        "summary": {
            "sku_count": len(planning_rows),
            "missing_cost_line_count": int((actual_totals or {}).get("missing_cost_lines", 0) or 0),
            "actual_revenue": actual_revenue,
            "actual_variable_cost": actual_variable,
            "actual_contribution": actual_contribution,
            "actual_variable_cost_ratio": variable_ratio,
            "actual_contribution_ratio": contribution_ratio,
            "plan_variable_cost": plan_variable,
            "plan_contribution": plan_contribution,
            "revenue_scale": revenue_scale,
        },
        "model": {
            "planning_scope": "First-use backfill reconstructs the historical plan from explicit plan revenue/fixed costs and actual mix.",
            "actual_scope": "Actuals remain immutable Omzet en Marge snapshots.",
            "backfill_policy": "Only explicit plan revenue and fixed costs are user input. Variable cost ratio and mix are derived from actual processed snapshots.",
        },
    }


def create_first_use_backfill_plan(
    *,
    year: int,
    plan_revenue: float,
    fixed_cost_total: float,
    scenario_name: str = "First-use backfill",
    basis: str = "invoice",
    replace_active: bool = False,
) -> dict[str, Any]:
    payload = build_first_use_backfill_plan_payload(
        year=int(year or 0),
        scenario_name=scenario_name,
        plan_revenue=plan_revenue,
        fixed_cost_total=fixed_cost_total,
        basis=basis,
    )
    return break_even_planning_storage.create_plan_snapshot(
        year=int(year or 0),
        scenario_name=scenario_name,
        source="first_use_backfill",
        payload=payload,
        replace_active=replace_active,
    )


def create_plan_from_active_costs(
    *,
    year: int,
    scenario_name: str = "Basis",
    replace_active: bool = False,
    targets: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = build_plan_payload(year=int(year or 0), scenario_name=scenario_name, targets=targets)
    return break_even_planning_storage.create_plan_snapshot(
        year=int(year or 0),
        scenario_name=scenario_name,
        source="planning",
        payload=payload,
        replace_active=replace_active,
    )


def _sales_totals(year: int, basis: str) -> dict[str, Any]:
    year_start, year_end = _year_bounds(int(year or 0))
    basis_norm = _text(basis).lower() or "invoice"
    source_type = "invoice" if basis_norm == "invoice" else "order"
    if not year_start or not year_end:
        return {"raw": {}, "rows": [], "period_totals": [], "totals": {}}

    douano_margin_snapshot_storage.ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT sku_id, douano_sku, kostprijsversie_id, quantity, net_revenue_ex, cost_total_ex,
                       cost_source, cost_status, line_date, payload
                FROM douano_sales_line_cost_snapshots
                WHERE source_type = %s
                  AND line_date >= %s::date
                  AND line_date < %s::date
                  AND NOT ignored
                ORDER BY line_date ASC NULLS LAST, source_line_id ASC
                """,
                (source_type, year_start, year_end),
            )
            snapshot_rows = cur.fetchall() or []

    version_ids = sorted({_text(row[2]) for row in snapshot_rows if _text(row[2])})
    component_index = cost_versions_storage.load_cost_row_components_index_for_versions(version_ids)

    rows_by_key: dict[str, dict[str, Any]] = {}
    period_totals: dict[str, dict[str, float]] = {}
    total_revenue = 0.0
    total_cost = 0.0
    total_fixed_alloc = 0.0
    missing_cost_lines = 0

    for sku_id_raw, sku_code_raw, version_id_raw, qty_raw, revenue_raw, cost_raw, cost_source_raw, cost_status_raw, line_date_raw, payload_raw in snapshot_rows:
        sku_id = _text(sku_id_raw)
        sku_code = _text(sku_code_raw)
        version_id = _text(version_id_raw)
        payload = payload_raw if isinstance(payload_raw, dict) else {}
        product_name = _text(payload.get("douano_product_name")) or "Niet-SKU omzet"
        cost_status = _text(cost_status_raw)
        cost_source = _text(cost_source_raw)
        qty = _num(qty_raw)
        revenue = _num(revenue_raw)
        cost = _num(cost_raw)
        components = component_index.get((version_id, sku_id)) if version_id and sku_id else None
        fixed_unit = _num((components or {}).get("indirecte_kosten"))
        fixed_alloc = min(cost, max(0.0, fixed_unit * qty)) if fixed_unit and qty else 0.0
        missing = cost_status in {"unmapped_sku", "missing_cost", "missing_lot_cost", "lot_near_match_fallback", "lot_unmatched_fallback"} or cost_source == ""
        if cost_source == "no_cost_required":
            missing = False
        if missing:
            missing_cost_lines += 1

        row_key = sku_id or f"non-sku:{cost_source or cost_status or product_name}".lower().replace(" ", "-")
        bucket = rows_by_key.setdefault(
            row_key,
            {
                "sku_id": row_key,
                "sku_code": sku_code,
                "sku_name": product_name if not sku_id else "",
                "units": 0.0,
                "net_revenue_ex": 0.0,
                "inkoop_total_ex": 0.0,
                "packaging_total_ex": 0.0,
                "excise_total_ex": 0.0,
                "cost_total_ex": 0.0,
                "fixed_total_ex": 0.0,
                "missing_cost_lines": 0,
            },
        )
        if sku_code and not _text(bucket.get("sku_code")):
            bucket["sku_code"] = sku_code
        if product_name and not _text(bucket.get("sku_name")):
            bucket["sku_name"] = product_name
        bucket["units"] += qty
        bucket["net_revenue_ex"] += revenue
        bucket["cost_total_ex"] += cost
        bucket["fixed_total_ex"] += fixed_alloc
        if missing:
            bucket["missing_cost_lines"] = int(bucket["missing_cost_lines"] or 0) + 1

        if components:
            bucket["inkoop_total_ex"] += qty * _num(components.get("inkoop"))
            bucket["packaging_total_ex"] += qty * _num(components.get("verpakkingskosten"))
            bucket["excise_total_ex"] += qty * _num(components.get("accijns"))
        else:
            bucket["inkoop_total_ex"] += max(0.0, cost - fixed_alloc)

        period = _text(line_date_raw)[:7]
        if period:
            period_bucket = period_totals.setdefault(period, {"revenue": 0.0, "variable_cost": 0.0, "fixed_alloc": 0.0, "contribution": 0.0})
            period_bucket["revenue"] += revenue
            period_bucket["variable_cost"] += cost - fixed_alloc
            period_bucket["fixed_alloc"] += fixed_alloc
            period_bucket["contribution"] += revenue - (cost - fixed_alloc)

        total_revenue += revenue
        total_cost += cost
        total_fixed_alloc += fixed_alloc

    rows = list(rows_by_key.values())
    rows.sort(key=lambda row: _num(row.get("net_revenue_ex")), reverse=True)
    contribution = total_revenue - (total_cost - total_fixed_alloc)
    return {
        "raw": {"source": "douano_sales_line_cost_snapshots", "source_type": source_type},
        "rows": rows,
        "period_totals": [{"period": key, **value} for key, value in sorted(period_totals.items())],
        "totals": {
            "revenue": total_revenue,
            "cost": total_cost,
            "variable_cost": total_cost - total_fixed_alloc,
            "fixed_alloc": total_fixed_alloc,
            "contribution": contribution,
            "missing_cost_lines": missing_cost_lines,
            "unmapped_revenue": 0.0,
        },
    }


def _dashboard_revenue_reconciliation(*, year: int, basis: str, break_even_revenue: float) -> dict[str, Any]:
    dashboard = erp_dashboard_service.get_erp_dashboard(year=int(year or 0), basis=basis)
    kpis = dashboard.get("kpis") if isinstance(dashboard, dict) else {}
    dashboard_revenue = _num((kpis or {}).get("total_revenue_ex")) if isinstance(kpis, dict) else 0.0
    return {
        "source": "erp_dashboard",
        "basis": _text((dashboard.get("range") or {}).get("basis")) if isinstance(dashboard, dict) else _text(basis),
        "since": _text((dashboard.get("range") or {}).get("since")) if isinstance(dashboard, dict) else "",
        "until": _text((dashboard.get("range") or {}).get("until")) if isinstance(dashboard, dict) else "",
        "dashboard_revenue": dashboard_revenue,
        "break_even_revenue": break_even_revenue,
        "contribution_revenue": break_even_revenue,
        "difference": dashboard_revenue - break_even_revenue,
        "status": "match" if abs(dashboard_revenue - break_even_revenue) < 0.01 else "difference",
        "policy": "Dashboard > Omzet over tijd is SSOT for actual revenue. Break-even contribution rows require SKU/cost mapping and may differ until all revenue categories are classified.",
    }


def _sales_processing_diagnostics(*, year: int) -> dict[str, Any]:
    start_date, end_date = _year_bounds(year)
    if not start_date or not end_date:
        return {}

    douano_margin_snapshot_storage.ensure_schema()
    bad_statuses = (
        "unmapped_sku",
        "missing_cost",
        "missing_lot_cost",
        "lot_near_match_fallback",
        "lot_unmatched_fallback",
    )
    cause_sql = """
        CASE
            WHEN NOT mapped OR cost_status = 'unmapped_sku' THEN 'Productkoppeling ontbreekt'
            WHEN cost_status IN ('lot_near_match_fallback', 'lot_unmatched_fallback') THEN 'LOT alias nodig'
            WHEN missing_cost OR cost_price_ex IS NULL OR cost_status IN ('missing_cost', 'missing_lot_cost') THEN 'Kostprijsbron ontbreekt'
            ELSE 'Controle nodig'
        END
    """
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    COUNT(*)::int AS total,
                    COALESCE(SUM(CASE WHEN COALESCE(NULLIF(sku_id, ''), '') <> '' THEN 1 ELSE 0 END), 0)::int AS sku_total,
                    COALESCE(SUM(CASE WHEN COALESCE(NULLIF(sku_id, ''), '') <> '' AND NOT (
                        missing_cost OR cost_price_ex IS NULL OR cost_status = ANY(%s::text[])
                    ) THEN 1 ELSE 0 END), 0)::int AS sku_with_cost_source,
                    COALESCE(SUM(CASE WHEN COALESCE(NULLIF(sku_id, ''), '') = '' THEN 1 ELSE 0 END), 0)::int AS non_sku_total,
                    COALESCE(SUM(CASE WHEN COALESCE(NULLIF(sku_id, ''), '') = '' AND cost_status = 'no_cost_required' THEN 1 ELSE 0 END), 0)::int AS non_sku_categorized,
                    COALESCE(SUM(CASE WHEN (
                        NOT mapped OR missing_cost OR cost_price_ex IS NULL OR cost_status = ANY(%s::text[])
                    ) THEN 1 ELSE 0 END), 0)::int AS missing
                FROM douano_sales_line_cost_snapshots
                WHERE line_date >= %s::date
                  AND line_date < %s::date
                  AND NOT ignored
                """,
                (list(bad_statuses), list(bad_statuses), start_date, end_date),
            )
            total, sku_total, sku_with_cost, non_sku_total, non_sku_categorized, missing = cur.fetchone() or (0, 0, 0, 0, 0, 0)
            cur.execute(
                f"""
                SELECT {cause_sql} AS cause, COUNT(*)::int AS rows
                FROM douano_sales_line_cost_snapshots
                WHERE line_date >= %s::date
                  AND line_date < %s::date
                  AND NOT ignored
                  AND (
                      NOT mapped
                      OR missing_cost
                      OR cost_price_ex IS NULL
                      OR cost_status = ANY(%s::text[])
                  )
                GROUP BY {cause_sql}
                ORDER BY rows DESC, cause
                """,
                (start_date, end_date, list(bad_statuses)),
            )
            causes = [{"cause": _text(row[0]), "rows": int(row[1] or 0)} for row in (cur.fetchall() or [])]
            cur.execute(
                f"""
                SELECT
                    COALESCE(payload->>'transaction_number', '') AS transaction_number,
                    COALESCE(payload->>'douano_product_name', '') AS product_name,
                    douano_sku,
                    lot_number,
                    cost_status,
                    {cause_sql} AS cause
                FROM douano_sales_line_cost_snapshots
                WHERE line_date >= %s::date
                  AND line_date < %s::date
                  AND NOT ignored
                  AND (
                      NOT mapped
                      OR missing_cost
                      OR cost_price_ex IS NULL
                      OR cost_status = ANY(%s::text[])
                  )
                ORDER BY line_date DESC NULLS LAST, source_type, source_line_id
                LIMIT 8
                """,
                (start_date, end_date, list(bad_statuses)),
            )
            rows = [
                {
                    "transaction_number": _text(row[0]),
                    "product_name": _text(row[1]),
                    "sku_code": _text(row[2]),
                    "lot_number": _text(row[3]),
                    "cost_status": _text(row[4]),
                    "cause": _text(row[5]),
                }
                for row in (cur.fetchall() or [])
            ]

    processed = max(0, int(total or 0) - int(missing or 0))
    return {
        "year": int(year or 0),
        "total": int(total or 0),
        "processed": processed,
        "missing": int(missing or 0),
        "sku_total": int(sku_total or 0),
        "sku_with_cost_source": int(sku_with_cost or 0),
        "non_sku_total": int(non_sku_total or 0),
        "non_sku_categorized": int(non_sku_categorized or 0),
        "causes": causes,
        "examples": rows,
        "policy": "Break-even uses processed rows for contribution. Unprocessed rows stay visible until product mapping, LOT alias, cost source or explicit no-cost categorization is fixed.",
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
    totals = sales.get("totals") if isinstance(sales.get("totals"), dict) else {}
    revenue = _num(totals.get("revenue"))
    variable = _num(totals.get("variable_cost"))
    contribution = _num(totals.get("contribution"))
    months = len(sales.get("period_totals") or [])
    annualization_factor = 12 / months if months else 0.0
    monthly = contribution / months if months else 0.0
    reforecast_revenue = revenue * annualization_factor if annualization_factor else revenue
    reforecast_variable = variable * annualization_factor if annualization_factor else variable
    reforecast_contribution = contribution * annualization_factor if annualization_factor else contribution
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
            "months_elapsed": months,
            "annualization_factor": annualization_factor,
            "revenue": reforecast_revenue,
            "variable_cost": reforecast_variable,
            "contribution": reforecast_contribution,
            "fixed_costs": fixed_total,
            "result": reforecast_contribution - fixed_total,
            "monthly_contribution_average": monthly,
            "estimated_months_to_break_even": estimated_months_to_break_even,
            "break_even_revenue_estimate": fixed_total / (contribution / revenue) if contribution > 0 and revenue > 0 else 0.0,
        },
    }
    return break_even_planning_storage.create_reforecast_snapshot(
        year=year_value,
        plan_snapshot_id=plan_snapshot_id,
        as_of_date=as_of_date or date.today().isoformat(),
        basis=basis_value,
        payload=payload,
    )


def build_analysis_read_model(*, year: int, basis: str = "invoice") -> dict[str, Any]:
    """
    Return the read contract for the next break-even screen.

    This function is intentionally read-only. It does not create or refresh snapshots.
    Missing planning inputs are reported as warnings instead of being guessed.
    """
    year_value = int(year or 0)
    if year_value <= 0:
        raise ValueError("Jaar is verplicht.")
    basis_value = _text(basis) or "invoice"
    plan_snapshot = _latest_active_plan(year_value)
    plan_payload = plan_snapshot.get("payload") if isinstance(plan_snapshot, dict) else {}
    plan_payload = plan_payload if isinstance(plan_payload, dict) else {}
    sales = _sales_totals(year_value, basis_value)
    labels = _sku_labels()
    source_rows = [row for row in sales.get("rows", []) if isinstance(row, dict)]
    contribution_rows = [_contribution_row(row, labels) for row in source_rows]
    contribution_rows.sort(key=lambda row: _num(row.get("contribution")), reverse=True)
    category_rows = _category_rows(contribution_rows)
    timeline = _period_timeline([row for row in sales.get("period_totals", []) if isinstance(row, dict)])
    plan_actual_rows = _plan_actual_rows(plan_payload, contribution_rows)
    sales_processing = _sales_processing_diagnostics(year=year_value)
    reforecast_snapshot = break_even_planning_storage.latest_reforecast_snapshot(year=year_value, basis=basis_value)
    reforecast_payload = reforecast_snapshot.get("payload") if isinstance(reforecast_snapshot, dict) else {}
    reforecast_payload = reforecast_payload if isinstance(reforecast_payload, dict) else {}
    explicit_reforecast = reforecast_payload.get("reforecast") if isinstance(reforecast_payload.get("reforecast"), dict) else {}

    fixed_cost_total = _num(plan_payload.get("fixed_cost_total")) if plan_payload else 0.0
    if fixed_cost_total <= 0:
        fixed_cost_total = _year_fixed_cost_total(year_value)

    totals = sales.get("totals") if isinstance(sales.get("totals"), dict) else {}
    contribution_revenue = _num(totals.get("revenue"))
    revenue_reconciliation = _dashboard_revenue_reconciliation(
        year=year_value,
        basis=basis_value,
        break_even_revenue=contribution_revenue,
    )
    dashboard_revenue = _num(revenue_reconciliation.get("dashboard_revenue"))
    actual_revenue = dashboard_revenue if dashboard_revenue > 0 else contribution_revenue
    actual_total_cost = _num(totals.get("cost"))
    actual_variable = _num(totals.get("variable_cost"))
    actual_contribution = _num(totals.get("contribution"))
    contribution_ratio = _money_ratio(actual_contribution, actual_revenue)
    break_even_revenue = fixed_cost_total / contribution_ratio if contribution_ratio > 0 else 0.0
    break_even_variable = break_even_revenue * _money_ratio(actual_variable, actual_revenue)
    break_even_result = break_even_revenue - break_even_variable - fixed_cost_total

    plan_targets = plan_payload.get("targets") if isinstance(plan_payload.get("targets"), dict) else {}
    plan_revenue = _num(plan_targets.get("revenue"))
    plan_variable = _num(plan_targets.get("variable_cost"))
    plan_contribution = _num(plan_targets.get("contribution"))
    plan_fixed_costs = _num(plan_payload.get("fixed_cost_total"))
    plan_result = plan_contribution - plan_fixed_costs if plan_contribution else 0.0
    reforecast_revenue = _num(explicit_reforecast.get("revenue")) or actual_revenue
    reforecast_variable = _num(explicit_reforecast.get("variable_cost")) or actual_variable
    reforecast_contribution = _num(explicit_reforecast.get("contribution")) or actual_contribution
    reforecast_fixed_costs = _num(explicit_reforecast.get("fixed_costs")) or fixed_cost_total
    reforecast_result = _num(explicit_reforecast.get("result")) if explicit_reforecast else reforecast_contribution - reforecast_fixed_costs
    variance_bridge = _variance_bridge_rows(
        plan_contribution=plan_contribution,
        plan_fixed_costs=plan_fixed_costs,
        reforecast_contribution=reforecast_contribution,
        reforecast_fixed_costs=reforecast_fixed_costs,
    )
    warnings: list[dict[str, str]] = []
    if not plan_snapshot:
        warnings.append({"code": "missing_plan_snapshot", "message": "Geen actief break-even plan gevonden; planwaarden blijven leeg."})
    if plan_revenue <= 0:
        warnings.append({"code": "missing_plan_revenue", "message": "Actief plan bevat nog geen frozen plan-omzet."})
    if plan_contribution <= 0:
        warnings.append({"code": "missing_plan_contribution", "message": "Actief plan bevat nog geen frozen plan-contributie."})
    missing_cost_lines = int(totals.get("missing_cost_lines", 0) or 0)
    if missing_cost_lines:
        warnings.append({"code": "missing_cost_lines", "message": f"{missing_cost_lines} verkoopregels missen nog een kostprijsbron."})
    if revenue_reconciliation.get("status") == "difference":
        warnings.append({
            "code": "revenue_reconciliation_difference",
            "message": "Dashboard omzet wijkt af van break-even contributie-omzet. Dashboard omzet is leidend; controleer categorieen/mapping voor de contributielaag.",
        })

    return {
        "kind": "break_even_analysis_read_model",
        "version": 1,
        "year": year_value,
        "basis": basis_value,
        "generated_at": date.today().isoformat(),
        "sources": {
            "plan_snapshot_id": _text((plan_snapshot or {}).get("id")),
            "plan_source": "active_plan_snapshot" if plan_snapshot else "missing",
            "actual_source": "douano_sales_line_cost_snapshots",
            "reforecast_snapshot_id": _text((reforecast_snapshot or {}).get("id")),
            "reforecast_source": "reforecast_snapshot" if reforecast_snapshot else "actual_ytd_temporary",
            "fixed_cost_source": "active_plan_snapshot" if _num(plan_payload.get("fixed_cost_total")) > 0 else "fixed_costs_by_year",
            "actual_revenue_source": "douano_sales_line_cost_snapshots",
            "contribution_source": "douano_sales_line_cost_snapshots",
        },
        "dashboard": {
            "plan": {
                "revenue": plan_revenue,
                "variable_cost": plan_variable,
                "total_cost": plan_variable + plan_fixed_costs if plan_variable or plan_fixed_costs else 0.0,
                "contribution": plan_contribution,
                "fixed_costs": plan_fixed_costs,
                "result": plan_result,
            },
            "actual": {
                "revenue": actual_revenue,
                "variable_cost": actual_variable,
                "total_cost": actual_total_cost,
                "contribution": actual_contribution,
                "fixed_costs": fixed_cost_total,
                "result": actual_contribution - fixed_cost_total,
            },
            "reforecast": {
                "revenue": reforecast_revenue,
                "variable_cost": reforecast_variable,
                "total_cost": reforecast_variable + reforecast_fixed_costs if reforecast_variable or reforecast_fixed_costs else 0.0,
                "contribution": reforecast_contribution,
                "fixed_costs": reforecast_fixed_costs,
                "result": reforecast_result,
            },
        },
        "pnl": {
            "revenue": actual_revenue,
            "variable_cost": actual_variable,
            "contribution": actual_contribution,
            "fixed_costs": fixed_cost_total,
            "operating_result": actual_contribution - fixed_cost_total,
        },
        "break_even": {
            "revenue": break_even_revenue,
            "variable_cost": break_even_variable,
            "contribution": break_even_revenue - break_even_variable,
            "fixed_costs": fixed_cost_total,
            "result_check": break_even_result,
            "contribution_ratio": contribution_ratio,
        },
        "contribution": {
            "rows": contribution_rows,
            "categories": category_rows,
        },
        "timeline": timeline,
        "variance_bridge": variance_bridge,
        "revenue_reconciliation": revenue_reconciliation,
        "plan_actual": {
            "rows": plan_actual_rows,
            "model_note": "Per-SKU planvolume is nog niet beschikbaar. Deze regels tonen daarom plan-kostprijs per SKU naast actual/reforecast verkopen.",
        },
        "data_quality": {
            "missing_cost_lines": missing_cost_lines,
            "unmapped_revenue": _num(totals.get("unmapped_revenue")),
            "sales_processing": sales_processing,
            "warnings": warnings,
        },
        "model_notes": {
            "read_only": True,
            "plan_policy": "Plan targets are never guessed. Missing targets are returned as warnings.",
            "actual_policy": "Actuals are read from existing Omzet en Marge line cost snapshots; this endpoint does not refresh snapshots.",
            "reforecast_policy": "Reforecast uses the latest explicit reforecast snapshot when available; otherwise it is temporarily equal to actual YTD.",
        },
    }


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
