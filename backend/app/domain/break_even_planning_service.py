from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from app.domain import (
    break_even_commercial_context_service,
    break_even_planning_storage,
    cost_versions_storage,
    dataset_store,
    douano_margin_snapshot_storage,
    douano_sales_mix_service,
    erp_dashboard_service,
    fixed_costs_storage,
    lot_costs_storage,
    postgres_storage,
    production_storage,
)


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _text(value: Any) -> str:
    return str(value or "").strip()


def _now() -> str:
    return datetime.now(UTC).isoformat()


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


def _year_incidental_cost_total(year: int) -> float:
    rows = postgres_storage.load_dataset("incidentele-kosten", [])
    if not isinstance(rows, list):
        return 0.0
    year_value = int(year or 0)
    total = 0.0
    for row in rows:
        if not isinstance(row, dict):
            continue
        if bool(row.get("ignore", row.get("negeren", False))):
            continue
        if int(row.get("jaar", row.get("year", 0)) or 0) != year_value:
            continue
        total += _num(row.get("bedrag", row.get("amount", 0)))
    return total


def _production_year_defaults(year: int) -> dict[str, Any]:
    rows = production_storage.load_productie()
    row = rows.get(str(int(year or 0)), {}) if isinstance(rows, dict) else {}
    row = row if isinstance(row, dict) else {}
    return {
        "purchase_liters": _num(row.get("hoeveelheid_inkoop_l")),
        "production_liters": _num(row.get("hoeveelheid_productie_l")),
        "sales_liters": _num(row.get("sales_l")),
        "normal_purchase_liters": _num(row.get("normal_inkoop_l")),
        "normal_production_liters": _num(row.get("normal_productie_l")),
        "normal_sales_liters": _num(row.get("normal_sales_l")),
        "batch_size_liters": _num(row.get("batchgrootte_eigen_productie_l")),
        "source": "production_years",
    }


def _extract_purchase_liters_from_cost_versions(year: int) -> dict[str, Any]:
    """Sum explicitly captured purchase liters from cost versions/invoices.

    Source of truth for this field is the invoice input stored in cost versions:
    `invoer.inkoop.facturen[].factuurregels[].liters`. Older records may have
    the total on the invoice/header, so those are included only when no row
    liters are present for that invoice.
    """
    year_value = int(year or 0)
    total = 0.0
    invoices_count = 0
    versions_count = 0
    rows_count = 0
    rows_with_liters = 0
    try:
        versions = cost_versions_storage.load_dataset([])
    except Exception:
        versions = []
    if not isinstance(versions, list):
        versions = []

    for version in versions:
        if not isinstance(version, dict):
            continue
        if int(version.get("jaar", 0) or 0) != year_value:
            continue
        source = _text(version.get("cost_source"))
        version_type = _text(version.get("type")).lower()
        if source not in {"purchase_invoice", "initial_calculation"} and version_type not in {"inkoop", "historisch"}:
            continue

        invoer = version.get("invoer") if isinstance(version.get("invoer"), dict) else {}
        inkoop = invoer.get("inkoop") if isinstance(invoer.get("inkoop"), dict) else {}
        facturen = inkoop.get("facturen") if isinstance(inkoop.get("facturen"), list) else []
        if not facturen:
            legacy_facturen = version.get("facturen") if isinstance(version.get("facturen"), list) else []
            facturen = legacy_facturen
        if not facturen:
            continue

        versions_count += 1
        for factuur in facturen:
            if not isinstance(factuur, dict):
                continue
            invoices_count += 1
            factuurregels = factuur.get("factuurregels") if isinstance(factuur.get("factuurregels"), list) else []
            invoice_liters = 0.0
            for regel in factuurregels:
                if not isinstance(regel, dict):
                    continue
                rows_count += 1
                liters = _num(
                    regel.get("liters", regel.get("liter", regel.get("totale_inhoud_liter", regel.get("inhoud_liter", 0))))
                )
                if liters > 0:
                    rows_with_liters += 1
                    invoice_liters += liters
            if invoice_liters <= 0:
                invoice_liters = _num(
                    factuur.get(
                        "liters",
                        factuur.get("totaal_liters", factuur.get("totale_liters", factuur.get("totale_inhoud_liter", 0))),
                    )
                )
            total += invoice_liters

    return {
        "value": total,
        "source": "cost_versions_purchase_invoice_liters" if total > 0 else "cost_versions_purchase_invoice_liters_empty",
        "versions": versions_count,
        "invoices": invoices_count,
        "rows": rows_count,
        "rows_with_liters": rows_with_liters,
    }


def _derive_sales_liters_from_snapshots(year: int, basis: str) -> dict[str, Any]:
    year_value = int(year or 0)
    year_start, year_end = _year_bounds(year_value)
    basis_norm = _text(basis).lower() or "invoice"
    source_type = "invoice" if basis_norm == "invoice" else "order"
    if not year_start or not year_end:
        return {"value": 0.0, "source": "sales_line_snapshots_empty"}

    active_rows = _active_planning_rows(year_value)
    cost_by_sku_id = {_text(row.get("sku_id")): row for row in active_rows if _text(row.get("sku_id"))}
    cost_by_sku_code = {_text(row.get("sku_code")).lower(): row for row in active_rows if _text(row.get("sku_code"))}
    content_by_sku_id: dict[str, float] = {}
    movements = lot_costs_storage.list_stock_movements_for_year(year_value)
    for movement in movements:
        sku_id = _text(movement.get("sku_id"))
        sku_code = _text(movement.get("sku_code"))
        cost_row = cost_by_sku_id.get(sku_id) or cost_by_sku_code.get(sku_code.lower())
        resolved_sku_id = _text((cost_row or {}).get("sku_id")) or sku_id
        content_liter = _num(movement.get("content_liter"))
        if resolved_sku_id and content_liter > 0:
            content_by_sku_id[resolved_sku_id] = content_liter

    sales_summary = douano_sales_mix_service.get_sales_by_sku_summary(
        year=year_value,
        basis=source_type,
        limit=20000,
    )
    items = sales_summary.get("items") if isinstance(sales_summary, dict) else []
    total = 0.0
    rows = 0
    rows_with_liters = 0
    missing_content_rows = 0
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        rows += 1
        sku_id = _text(item.get("sku_id"))
        units = _num(item.get("units"))
        content_liter = content_by_sku_id.get(sku_id, 0.0)
        if content_liter > 0:
            rows_with_liters += 1
            total += units * content_liter
        elif units:
            missing_content_rows += 1

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  COUNT(*)::int AS snapshot_rows
                FROM douano_sales_line_cost_snapshots snap
                WHERE snap.source_type = %s
                  AND snap.line_date >= %s::date
                  AND snap.line_date < %s::date
                  AND NOT snap.ignored
                """,
                (source_type, year_start, year_end),
            )
            row = cur.fetchone() or (0,)

    return {
        "value": total,
        "source": "omzet_en_marge_units_inventory_content_liters",
        "basis": source_type,
        "rows": rows,
        "rows_with_liters": rows_with_liters,
        "snapshot_rows": int((row[0] if isinstance(row, (tuple, list)) else 0) or 0),
        "missing_content_rows": missing_content_rows,
    }


def _year_inventory_snapshot(year: int, basis: str) -> dict[str, Any]:
    """Build year-close inventory from full Douano stock movements.

    Quantities come from the dedicated stock_movements source. Valuation comes
    from the active source-year costprice rows, so composed SKUs use the same
    cost components shown in Nieuw jaar voorbereiden > Kostprijs.
    """
    year_value = int(year or 0)
    year_start, year_end = _year_bounds(year_value)
    if not year_start or not year_end:
        return {"status": "blocking", "source": "invalid_year", "rows": [], "totals": {}}

    lot_costs_storage.ensure_schema()
    active_rows = _active_planning_rows(year_value)
    cost_by_sku_id = {_text(row.get("sku_id")): row for row in active_rows if _text(row.get("sku_id"))}
    cost_by_sku_code = {_text(row.get("sku_code")).lower(): row for row in active_rows if _text(row.get("sku_code"))}
    sales_summary = douano_sales_mix_service.get_sales_by_sku_summary(
        year=year_value,
        basis=basis,
        limit=20000,
    )
    sales_by_sku_id = {
        _text(row.get("sku_id")): _num(row.get("units"))
        for row in sales_summary.get("items", [])
        if isinstance(row, dict) and _text(row.get("sku_id"))
    }
    movements = lot_costs_storage.list_stock_movements_for_year(year_value)
    rows_by_sku: dict[str, dict[str, Any]] = {}
    excluded_movements = 0

    def ensure_row(sku_id: str, sku_code: str = "", product_name: str = "", cost_row: dict[str, Any] | None = None) -> dict[str, Any]:
        key = sku_id or f"sku_code:{sku_code}"
        row = rows_by_sku.setdefault(
            key,
            {
                "sku_id": sku_id,
                "sku_code": sku_code,
                "product_name": product_name or sku_code or sku_id,
                "cost_source": "missing",
                "primary_cost_per_unit": 0.0,
                "excise_per_unit": 0.0,
                "begin_quantity": 0.0,
                "end_quantity": 0.0,
                "purchased_or_produced_quantity": 0.0,
                "purchase_quantity": 0.0,
                "production_quantity": 0.0,
                "sold_quantity": 0.0,
                "sold_quantity_source": "omzet_en_marge",
                "unpack_quantity": 0.0,
                "repack_quantity": 0.0,
                "unpack_repack_quantity": 0.0,
                "correction_other_quantity": 0.0,
                "content_liter": 0.0,
                "status": "warning",
                "warnings": [],
                "other_movement_quantity": 0.0,
            },
        )
        if cost_row:
            row["primary_cost_per_unit"] = _num(cost_row.get("inkoop"))
            row["excise_per_unit"] = _num(cost_row.get("accijns"))
            row["cost_source"] = "active_costprice_components"
        if sku_id and not row.get("sku_id"):
            row["sku_id"] = sku_id
        if sku_code and not row.get("sku_code"):
            row["sku_code"] = sku_code
        if product_name and (not row.get("product_name") or row.get("product_name") in {sku_id, sku_code}):
            row["product_name"] = product_name
        return row

    for active_row in active_rows:
        sku_id = _text(active_row.get("sku_id"))
        if not sku_id:
            continue
        ensure_row(
            sku_id,
            _text(active_row.get("sku_code")),
            _text(active_row.get("sku_name")) or sku_id,
            active_row,
        )

    for movement in movements:
        sku_id = _text(movement.get("sku_id"))
        sku_code = _text(movement.get("sku_code"))
        cost_row = cost_by_sku_id.get(sku_id) or cost_by_sku_code.get(sku_code.lower())
        if not cost_row:
            excluded_movements += 1
            continue
        if sku_id and sku_id not in rows_by_sku:
            excluded_movements += 1
            continue
        row = ensure_row(
            _text(cost_row.get("sku_id")) or sku_id,
            _text(cost_row.get("sku_code")) or sku_code,
            _text(movement.get("sku_name")) or _text(movement.get("product_name")) or sku_code,
            cost_row,
        )
        qty = _num(movement.get("quantity"))
        tx_type = _text(movement.get("transaction_type")).lower()
        document_type = _text(movement.get("stock_document_type")).lower()
        note = _text(movement.get("note")).lower()
        row["end_quantity"] += qty
        if (
            tx_type == "voorraad"
            and document_type == "toevoeging"
            and (note.startswith("beginvoorraad") or _text(movement.get("movement_date")) == year_start)
        ):
            row["begin_quantity"] += abs(qty)
        if tx_type == "inkoop":
            row["purchase_quantity"] += max(qty, 0.0)
        if tx_type == "afvullen":
            row["production_quantity"] += max(qty, 0.0)
        if tx_type in {"inkoop", "productie", "afvullen"}:
            row["purchased_or_produced_quantity"] += max(qty, 0.0)
        if tx_type == "uitpakking":
            row["unpack_quantity"] += qty
        if tx_type == "herverpakking":
            row["repack_quantity"] += qty
        if tx_type in {"uitpakking", "herverpakking"}:
            row["unpack_repack_quantity"] += qty
        if _num(movement.get("content_liter")) > 0:
            row["content_liter"] = _num(movement.get("content_liter"))
        if not row.get("lot_number") and _text(movement.get("lot_number")):
            row["lot_number"] = _text(movement.get("lot_number"))

    for row in rows_by_sku.values():
        sku_id = _text(row.get("sku_id"))
        row["sold_quantity"] = sales_by_sku_id.get(sku_id, 0.0)
        row["sold_quantity_source"] = "omzet_en_marge"
        row["other_movement_quantity"] = (
            _num(row.get("end_quantity"))
            - _num(row.get("begin_quantity"))
            - _num(row.get("purchased_or_produced_quantity"))
            + _num(row.get("sold_quantity"))
            - _num(row.get("unpack_repack_quantity"))
        )
        row["correction_other_quantity"] = row["other_movement_quantity"]

    out_rows: list[dict[str, Any]] = []
    for row in rows_by_sku.values():
        primary = _num(row.get("primary_cost_per_unit"))
        excise = _num(row.get("excise_per_unit"))
        begin_qty = _num(row.get("begin_quantity"))
        end_qty = _num(row.get("end_quantity"))
        warnings: list[str] = list(row.get("warnings") or [])
        if primary <= 0 and (begin_qty > 0 or end_qty > 0):
            warnings.append("missing_active_costprice_primary_component")
        if not _text(row.get("sku_id")) and (begin_qty > 0 or end_qty != 0):
            warnings.append("missing_internal_sku_mapping")
        if end_qty < 0:
            warnings.append("negative_stock_position")
        row["begin_value_primary"] = begin_qty * primary
        row["begin_value_with_excise"] = begin_qty * (primary + excise)
        row["end_value_primary"] = end_qty * primary
        row["end_value_with_excise"] = end_qty * (primary + excise)
        row["begin_liters"] = begin_qty * _num(row.get("content_liter"))
        row["end_liters"] = end_qty * _num(row.get("content_liter"))
        row["purchase_liters"] = _num(row.get("purchase_quantity")) * _num(row.get("content_liter"))
        row["production_liters"] = _num(row.get("production_quantity")) * _num(row.get("content_liter"))
        row["sold_liters"] = _num(row.get("sold_quantity")) * _num(row.get("content_liter"))
        row["unpack_liters"] = _num(row.get("unpack_quantity")) * _num(row.get("content_liter"))
        row["repack_liters"] = _num(row.get("repack_quantity")) * _num(row.get("content_liter"))
        row["unpack_repack_liters"] = _num(row.get("unpack_repack_quantity")) * _num(row.get("content_liter"))
        row["correction_liters"] = _num(row.get("correction_other_quantity")) * _num(row.get("content_liter"))
        row["warnings"] = warnings
        row["status"] = "warning" if warnings else "ok"
        out_rows.append(row)

    out_rows.sort(key=lambda item: (_text(item.get("product_name")).lower(), _text(item.get("sku_id"))))
    totals = {
        "begin_quantity": sum(_num(row.get("begin_quantity")) for row in out_rows),
        "end_quantity": sum(_num(row.get("end_quantity")) for row in out_rows),
        "begin_liters": sum(_num(row.get("begin_liters")) for row in out_rows),
        "end_liters": sum(_num(row.get("end_liters")) for row in out_rows),
        "begin_value_primary": sum(_num(row.get("begin_value_primary")) for row in out_rows),
        "begin_value_with_excise": sum(_num(row.get("begin_value_with_excise")) for row in out_rows),
        "end_value_primary": sum(_num(row.get("end_value_primary")) for row in out_rows),
        "end_value_with_excise": sum(_num(row.get("end_value_with_excise")) for row in out_rows),
        "purchased_or_produced_quantity": sum(_num(row.get("purchased_or_produced_quantity")) for row in out_rows),
        "purchase_quantity": sum(_num(row.get("purchase_quantity")) for row in out_rows),
        "production_quantity": sum(_num(row.get("production_quantity")) for row in out_rows),
        "sold_quantity": sum(_num(row.get("sold_quantity")) for row in out_rows),
        "unpack_quantity": sum(_num(row.get("unpack_quantity")) for row in out_rows),
        "repack_quantity": sum(_num(row.get("repack_quantity")) for row in out_rows),
        "unpack_repack_quantity": sum(_num(row.get("unpack_repack_quantity")) for row in out_rows),
        "correction_other_quantity": sum(_num(row.get("correction_other_quantity")) for row in out_rows),
        "other_movement_quantity": sum(_num(row.get("other_movement_quantity")) for row in out_rows),
        "purchase_liters": sum(_num(row.get("purchase_liters")) for row in out_rows),
        "production_liters": sum(_num(row.get("production_liters")) for row in out_rows),
        "sold_liters": sum(_num(row.get("sold_liters")) for row in out_rows),
        "unpack_liters": sum(_num(row.get("unpack_liters")) for row in out_rows),
        "repack_liters": sum(_num(row.get("repack_liters")) for row in out_rows),
        "unpack_repack_liters": sum(_num(row.get("unpack_repack_liters")) for row in out_rows),
        "correction_liters": sum(_num(row.get("correction_liters")) for row in out_rows),
    }
    totals["stock_bridge_liters"] = (
        _num(totals.get("begin_liters"))
        + _num(totals.get("purchase_liters"))
        + _num(totals.get("production_liters"))
        - _num(totals.get("sold_liters"))
        + _num(totals.get("unpack_repack_liters"))
        + _num(totals.get("correction_liters"))
    )
    warning_count = sum(1 for row in out_rows if row.get("status") != "ok")
    if not movements:
        warning_count += 1
    return {
        "status": "warning" if warning_count else "ok",
        "source": "douano_stock_movements_plus_omzet_en_marge_sales",
        "source_note": "Alle actieve kostprijs-SKU's van het bronjaar worden getoond; voorraadbewegingen komen uit volledige Douano stock-history movements, verkoop komt uit Omzet & Marge.",
        "start_date": f"{year_value:04d}-01-01",
        "end_date": f"{year_value:04d}-12-31",
        "rows": out_rows,
        "totals": totals,
        "warnings": warning_count,
        "movement_count": len(movements),
        "excluded_movement_count": excluded_movements,
    }


def _manual_or_default(manual: dict[str, Any], key: str, default_value: float, default_source: str) -> dict[str, Any]:
    if key in manual and manual.get(key) is not None:
        return {"value": _num(manual.get(key)), "source": "manual_year_close_input"}
    return {"value": _num(default_value), "source": default_source}


def _year_close_dashboard(*, sales: dict[str, Any], fixed_cost_total: float, incidental_cost_total: float) -> dict[str, Any]:
    totals = sales.get("totals") if isinstance(sales.get("totals"), dict) else {}
    revenue = _num(totals.get("revenue"))
    variable_cost = _num(totals.get("variable_cost"))
    contribution = _num(totals.get("contribution"))
    fixed_costs = _num(fixed_cost_total)
    incidental_costs = _num(incidental_cost_total)
    controllable_costs = fixed_costs + incidental_costs
    result = contribution - controllable_costs
    contribution_ratio = _money_ratio(contribution, revenue)
    break_even_revenue = controllable_costs / contribution_ratio if contribution_ratio > 0 else 0.0
    return {
        "revenue": revenue,
        "variable_cost": variable_cost,
        "contribution": contribution,
        "fixed_costs": fixed_costs,
        "incidental_costs": incidental_costs,
        "controllable_costs": controllable_costs,
        "result": result,
        "contribution_ratio": contribution_ratio,
        "break_even_revenue": break_even_revenue,
        "basis": "closed_year_actuals",
    }


def _inventory_sold_liters(inventory: dict[str, Any]) -> dict[str, Any]:
    rows = inventory.get("rows") if isinstance(inventory.get("rows"), list) else []
    total = 0.0
    rows_count = 0
    rows_with_liters = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        sold_quantity = _num(row.get("sold_quantity"))
        content_liter = _num(row.get("content_liter"))
        if sold_quantity:
            rows_count += 1
        if sold_quantity and content_liter > 0:
            rows_with_liters += 1
            total += sold_quantity * content_liter
    return {
        "value": total,
        "source": "inventory_rows_omzet_en_marge_sales_liters",
        "rows": rows_count,
        "rows_with_liters": rows_with_liters,
    }


def _plan_baseline_for_year(year: int) -> dict[str, Any]:
    plan = _latest_active_plan(int(year or 0))
    payload = plan.get("payload") if isinstance(plan, dict) else {}
    payload = payload if isinstance(payload, dict) else {}
    targets = payload.get("targets") if isinstance(payload.get("targets"), dict) else {}

    revenue = _num(targets.get("revenue"))
    variable_cost = _num(targets.get("variable_cost"))
    contribution = _num(targets.get("contribution")) or revenue - variable_cost
    fixed_costs = _num(payload.get("fixed_cost_total") or targets.get("fixed_cost_total") or targets.get("fixed_costs"))
    incidental_costs = _num(targets.get("incidental_costs"))
    result = contribution - fixed_costs - incidental_costs if revenue or contribution or fixed_costs else 0.0
    contribution_ratio = _money_ratio(contribution, revenue)
    break_even_revenue = (fixed_costs + incidental_costs) / contribution_ratio if contribution_ratio > 0 else 0.0

    return {
        "available": bool(plan),
        "source": _text((plan or {}).get("source")) or "missing",
        "snapshot_id": _text((plan or {}).get("id")),
        "scenario_name": _text((plan or {}).get("scenario_name")),
        "revenue": revenue,
        "variable_cost": variable_cost,
        "contribution": contribution,
        "fixed_costs": fixed_costs,
        "incidental_costs": incidental_costs,
        "result": result,
        "break_even_revenue": break_even_revenue,
        "contribution_ratio": contribution_ratio,
    }


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
    variable = _num(row.get("variabel_accijns_ex")) or (_num(row.get("cost_total_ex")) - _num(row.get("fixed_total_ex")))
    variable_without_excise = _num(row.get("variabel_ex")) or max(0.0, variable - _num(row.get("excise_total_ex")))
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
        "variabel_ex": variable_without_excise,
        "variabel_accijns_ex": variable,
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
                "planned_fixed_allocation_unit": (
                    _num(plan.get("planned_fixed_allocation_unit"))
                    or _num(plan.get("abc_overhead"))
                ),
                "planned_cost_unit": (
                    _num(plan.get("planned_cost_unit"))
                    or _num(plan.get("kostprijs"))
                    or plan_variable_cost
                    + _num(plan.get("planned_fixed_allocation_unit"))
                    + _num(plan.get("abc_overhead"))
                ),
                "actual_units": _num(actual.get("units")),
                "actual_revenue": _num(actual.get("revenue")),
                "actual_contribution": _num(actual.get("contribution")),
                "reforecast_units": _num(actual.get("units"))
                + max(
                    0.0,
                    _num(plan.get("planned_units"))
                    - _num(actual.get("units")),
                ),
                "reforecast_contribution": _num(actual.get("contribution"))
                + max(
                    0.0,
                    _num(plan.get("planned_contribution"))
                    - _num(actual.get("contribution")),
                ),
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
    plan_variable_cost: float | None = None,
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
    explicit_plan_variable = _num(plan_variable_cost)
    plan_variable = explicit_plan_variable if explicit_plan_variable > 0 else plan_revenue_value * variable_ratio
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
    targets["variable_cost_source"] = "explicit_user_input" if explicit_plan_variable > 0 else "actual_ratio_scaled_to_plan_revenue"

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
            "plan_variable_cost_source": targets["variable_cost_source"],
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
    plan_variable_cost: float | None = None,
    scenario_name: str = "First-use backfill",
    basis: str = "invoice",
    replace_active: bool = False,
) -> dict[str, Any]:
    payload = build_first_use_backfill_plan_payload(
        year=int(year or 0),
        scenario_name=scenario_name,
        plan_revenue=plan_revenue,
        fixed_cost_total=fixed_cost_total,
        plan_variable_cost=plan_variable_cost,
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
    total_excise = 0.0
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
        excise_unit = _num((components or {}).get("accijns"))
        fixed_alloc = min(cost, max(0.0, fixed_unit * qty)) if fixed_unit and qty else 0.0
        excise_alloc = max(0.0, excise_unit * qty) if excise_unit and qty else 0.0
        variable_with_excise = max(0.0, cost - fixed_alloc)
        variable_without_excise = max(0.0, variable_with_excise - excise_alloc)
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
                "variabel_ex": 0.0,
                "variabel_accijns_ex": 0.0,
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
        bucket["variabel_ex"] += variable_without_excise
        bucket["variabel_accijns_ex"] += variable_with_excise
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
            period_bucket = period_totals.setdefault(period, {"revenue": 0.0, "variable_cost": 0.0, "variabel_ex": 0.0, "variabel_accijns_ex": 0.0, "fixed_alloc": 0.0, "contribution": 0.0})
            period_bucket["revenue"] += revenue
            period_bucket["variable_cost"] += variable_with_excise
            period_bucket["variabel_ex"] += variable_without_excise
            period_bucket["variabel_accijns_ex"] += variable_with_excise
            period_bucket["fixed_alloc"] += fixed_alloc
            period_bucket["contribution"] += revenue - variable_with_excise

        total_revenue += revenue
        total_cost += cost
        total_fixed_alloc += fixed_alloc
        total_excise += excise_alloc

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
            "variabel_ex": max(0.0, total_cost - total_fixed_alloc - total_excise),
            "variabel_accijns_ex": total_cost - total_fixed_alloc,
            "fixed_alloc": total_fixed_alloc,
            "excise": total_excise,
            "contribution": contribution,
            "missing_cost_lines": missing_cost_lines,
            "unmapped_revenue": 0.0,
        },
    }


def _sales_variable_cost_control_rows(year: int, basis: str) -> list[dict[str, Any]]:
    year_start, year_end = _year_bounds(int(year or 0))
    basis_norm = _text(basis).lower() or "invoice"
    source_type = "invoice" if basis_norm == "invoice" else "order"
    if not year_start or not year_end:
        return []

    douano_margin_snapshot_storage.ensure_schema()
    cost_versions_storage.ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if source_type == "invoice":
                cur.execute(
                    """
                    SELECT
                        COALESCE(i.invoice_number, '') AS document_number,
                        COALESCE(i.invoice_date::text, snap.line_date::text, '') AS document_date,
                        COALESCE(c.public_name, c.name, '') AS company_name,
                        COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), snap.payload->>'douano_product_name', '') AS product_name,
                        COALESCE(p.sku, snap.douano_sku, '') AS douano_sku,
                        COALESCE(snap.sku_id, '') AS sku_id,
                        COALESCE(snap.lot_number, '') AS lot_number,
                        COALESCE(snap.lot_internal_number, '') AS lot_internal_number,
                        COALESCE(snap.lot_transaction_number, '') AS lot_transaction_number,
                        COALESCE(snap.kostprijsversie_label, snap.kostprijsversie_id, '') AS cost_version,
                        COALESCE(snap.quantity, 0) AS quantity,
                        COALESCE(snap.net_revenue_ex, 0) AS net_revenue_ex,
                        COALESCE(snap.cost_total_ex, 0) AS cost_total_ex,
                        COALESCE(csr.inkoop, 0) AS unit_purchase,
                        COALESCE(csr.verpakkingskosten, 0) AS unit_packaging,
                        COALESCE(csr.indirecte_kosten, 0) AS unit_abc,
                        COALESCE(csr.accijns, 0) AS unit_excise,
                        COALESCE(snap.cost_status, '') AS cost_status,
                        COALESCE(snap.cost_source, '') AS cost_source
                    FROM douano_sales_line_cost_snapshots snap
                    LEFT JOIN douano_sales_invoice_lines l
                      ON snap.source_type = 'invoice'
                     AND snap.source_line_id = l.line_id
                    LEFT JOIN douano_sales_invoices i ON i.sales_invoice_id = l.sales_invoice_id
                    LEFT JOIN douano_companies c ON c.company_id = snap.company_id
                    LEFT JOIN douano_products p ON p.product_id = snap.douano_product_id
                    LEFT JOIN (
                        SELECT
                            version_id,
                            sku_id,
                            MAX(inkoop) AS inkoop,
                            MAX(verpakkingskosten) AS verpakkingskosten,
                            MAX(indirecte_kosten) AS indirecte_kosten,
                            MAX(accijns) AS accijns
                        FROM cost_version_sku_rows
                        GROUP BY version_id, sku_id
                    ) csr
                      ON csr.version_id = snap.kostprijsversie_id
                     AND csr.sku_id = snap.sku_id
                    WHERE snap.source_type = 'invoice'
                      AND snap.line_date >= %s::date
                      AND snap.line_date < %s::date
                      AND NOT snap.ignored
                    ORDER BY i.invoice_date ASC NULLS LAST, i.invoice_number ASC NULLS LAST, snap.source_line_id ASC
                    """,
                    (year_start, year_end),
                )
            else:
                cur.execute(
                    """
                    SELECT
                        COALESCE(o.transaction_number, '') AS document_number,
                        COALESCE(o.order_date::text, snap.line_date::text, '') AS document_date,
                        COALESCE(c.public_name, c.name, '') AS company_name,
                        COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), snap.payload->>'douano_product_name', '') AS product_name,
                        COALESCE(p.sku, snap.douano_sku, '') AS douano_sku,
                        COALESCE(snap.sku_id, '') AS sku_id,
                        COALESCE(snap.lot_number, '') AS lot_number,
                        COALESCE(snap.lot_internal_number, '') AS lot_internal_number,
                        COALESCE(snap.lot_transaction_number, '') AS lot_transaction_number,
                        COALESCE(snap.kostprijsversie_label, snap.kostprijsversie_id, '') AS cost_version,
                        COALESCE(snap.quantity, 0) AS quantity,
                        COALESCE(snap.net_revenue_ex, 0) AS net_revenue_ex,
                        COALESCE(snap.cost_total_ex, 0) AS cost_total_ex,
                        COALESCE(csr.inkoop, 0) AS unit_purchase,
                        COALESCE(csr.verpakkingskosten, 0) AS unit_packaging,
                        COALESCE(csr.indirecte_kosten, 0) AS unit_abc,
                        COALESCE(csr.accijns, 0) AS unit_excise,
                        COALESCE(snap.cost_status, '') AS cost_status,
                        COALESCE(snap.cost_source, '') AS cost_source
                    FROM douano_sales_line_cost_snapshots snap
                    LEFT JOIN douano_sales_order_lines l
                      ON snap.source_type = 'order'
                     AND snap.source_line_id = l.line_id
                    LEFT JOIN douano_sales_orders o ON o.sales_order_id = l.sales_order_id
                    LEFT JOIN douano_companies c ON c.company_id = snap.company_id
                    LEFT JOIN douano_products p ON p.product_id = snap.douano_product_id
                    LEFT JOIN (
                        SELECT
                            version_id,
                            sku_id,
                            MAX(inkoop) AS inkoop,
                            MAX(verpakkingskosten) AS verpakkingskosten,
                            MAX(indirecte_kosten) AS indirecte_kosten,
                            MAX(accijns) AS accijns
                        FROM cost_version_sku_rows
                        GROUP BY version_id, sku_id
                    ) csr
                      ON csr.version_id = snap.kostprijsversie_id
                     AND csr.sku_id = snap.sku_id
                    WHERE snap.source_type = 'order'
                      AND snap.line_date >= %s::date
                      AND snap.line_date < %s::date
                      AND NOT snap.ignored
                    ORDER BY o.order_date ASC NULLS LAST, o.transaction_number ASC NULLS LAST, snap.source_line_id ASC
                    """,
                    (year_start, year_end),
                )
            rows = cur.fetchall() or []

    out: list[dict[str, Any]] = []
    for row in rows:
        (
            document_number,
            document_date,
            company_name,
            product_name,
            douano_sku,
            sku_id,
            lot_number,
            lot_internal_number,
            lot_transaction_number,
            cost_version,
            quantity,
            net_revenue_ex,
            cost_total_ex,
            unit_purchase,
            unit_packaging,
            unit_abc,
            unit_excise,
            cost_status,
            cost_source,
        ) = row
        qty = _num(quantity)
        cost_total = _num(cost_total_ex)
        abc = max(0.0, _num(unit_abc) * qty) if qty else 0.0
        excise = max(0.0, _num(unit_excise) * qty) if qty else 0.0
        packaging = max(0.0, _num(unit_packaging) * qty) if qty else 0.0
        variable_with_excise = max(0.0, cost_total - min(cost_total, abc))
        variable_without_excise = max(0.0, variable_with_excise - excise)
        purchase = max(0.0, cost_total - packaging - abc - excise)
        out.append(
            {
                "document_number": _text(document_number),
                "document_date": _text(document_date),
                "company_name": _text(company_name),
                "product_name": _text(product_name),
                "douano_sku": _text(douano_sku),
                "sku_id": _text(sku_id),
                "lot_number": _text(lot_number),
                "lot_internal_number": _text(lot_internal_number),
                "lot_transaction_number": _text(lot_transaction_number),
                "cost_version": _text(cost_version),
                "quantity": qty,
                "net_revenue_ex": _num(net_revenue_ex),
                "purchase_total_ex": purchase,
                "packaging_total_ex": packaging,
                "abc_total_ex": abc,
                "excise_total_ex": excise,
                "cost_total_ex": cost_total,
                "variabel_ex": variable_without_excise,
                "variabel_accijns_ex": variable_with_excise,
                "cost_status": _text(cost_status),
                "cost_source": _text(cost_source),
            }
        )
    return out


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


def build_analysis_read_model(*, year: int = 0, basis: str = "invoice") -> dict[str, Any]:
    """
    Return the read contract for the next break-even screen.

    This function is intentionally read-only. It does not create or refresh snapshots.
    Missing planning inputs are reported as warnings instead of being guessed.
    """
    commercial_context = (
        break_even_commercial_context_service.read_break_even_commercial_context()
    )
    binding = (
        commercial_context.get("binding")
        if isinstance(commercial_context.get("binding"), dict)
        else {}
    )
    active_year = int(binding.get("operational_year", 0) or 0)
    year_value = int(year or 0)
    if year_value <= 0:
        if commercial_context.get("status") != "ready" or active_year <= 0:
            raise ValueError(
                "Geen actieve commerciële jaarset beschikbaar voor Break-even."
            )
        year_value = active_year
    if (
        active_year > 0
        and active_year == year_value
        and commercial_context.get("status") != "ready"
    ):
        reason_codes = commercial_context.get("reason_codes")
        reason = ", ".join(
            _text(code)
            for code in (
                reason_codes if isinstance(reason_codes, list) else []
            )
            if _text(code)
        )
        suffix = f" ({reason})" if reason else ""
        raise ValueError(
            "De actieve commerciële jaarset is niet veilig leesbaar voor "
            f"Break-even{suffix}."
        )
    basis_value = _text(basis) or "invoice"
    uses_active_context = bool(
        commercial_context.get("status") == "ready"
        and active_year == year_value
    )
    plan_snapshot = None if uses_active_context else _latest_active_plan(year_value)
    if uses_active_context:
        plan_payload = {
            "targets": (
                commercial_context.get("plan", {}).get("targets", {})
                if isinstance(commercial_context.get("plan"), dict)
                else {}
            ),
            "period_allocations": (
                commercial_context.get("plan", {}).get(
                    "period_allocations", []
                )
                if isinstance(commercial_context.get("plan"), dict)
                else []
            ),
            "sku_allocations": (
                commercial_context.get("plan", {}).get(
                    "sku_allocations", []
                )
                if isinstance(commercial_context.get("plan"), dict)
                else []
            ),
            "planning_rows": (
                commercial_context.get("planning_rows", [])
                if isinstance(commercial_context.get("planning_rows"), list)
                else []
            ),
        }
    else:
        plan_payload = (
            plan_snapshot.get("payload")
            if isinstance(plan_snapshot, dict)
            else {}
        )
        plan_payload = plan_payload if isinstance(plan_payload, dict) else {}
    year_close_snapshot = break_even_planning_storage.get_year_close_snapshot(year=year_value)
    year_close_payload = year_close_snapshot.get("payload") if isinstance(year_close_snapshot, dict) else {}
    year_close_payload = year_close_payload if isinstance(year_close_payload, dict) else {}
    sales = _sales_totals(year_value, basis_value)
    if isinstance(year_close_payload.get("actuals"), dict):
        sales = year_close_payload["actuals"]
    labels = _sku_labels()
    source_rows = [row for row in sales.get("rows", []) if isinstance(row, dict)]
    contribution_rows = [_contribution_row(row, labels) for row in source_rows]
    contribution_rows.sort(key=lambda row: _num(row.get("contribution")), reverse=True)
    category_rows = _category_rows(contribution_rows)
    plan_actual_rows = _plan_actual_rows(plan_payload, contribution_rows)
    sales_processing = _sales_processing_diagnostics(year=year_value)
    reforecast_snapshot = (
        None
        if uses_active_context
        else break_even_planning_storage.latest_reforecast_snapshot(
            year=year_value, basis=basis_value
        )
    )
    reforecast_payload = reforecast_snapshot.get("payload") if isinstance(reforecast_snapshot, dict) else {}
    reforecast_payload = reforecast_payload if isinstance(reforecast_payload, dict) else {}
    explicit_reforecast = reforecast_payload.get("reforecast") if isinstance(reforecast_payload.get("reforecast"), dict) else {}

    fixed_cost_total = (
        _num(year_close_payload.get("fixed_cost_total"))
        if year_close_payload
        else _year_fixed_cost_total(year_value)
    )
    incidental_cost_total = (
        _num(year_close_payload.get("incidental_cost_total"))
        if year_close_payload
        else _year_incidental_cost_total(year_value)
    )
    controllable_cost_total = fixed_cost_total + incidental_cost_total

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
    actual_absorbed_fixed_costs = _num(totals.get("fixed_alloc"))
    actual_contribution = _num(totals.get("contribution"))
    contribution_ratio = _money_ratio(actual_contribution, actual_revenue)
    break_even_revenue = controllable_cost_total / contribution_ratio if contribution_ratio > 0 else 0.0
    break_even_variable = break_even_revenue * _money_ratio(actual_variable, actual_revenue)
    break_even_result = break_even_revenue - break_even_variable - controllable_cost_total

    plan_targets = plan_payload.get("targets") if isinstance(plan_payload.get("targets"), dict) else {}
    plan_revenue = _num(plan_targets.get("revenue"))
    plan_variable = _num(plan_targets.get("variable_cost"))
    plan_contribution = _num(plan_targets.get("contribution"))
    plan_fixed_costs = (
        fixed_cost_total
        if uses_active_context
        else _num(plan_payload.get("fixed_cost_total"))
    )
    plan_result = plan_contribution - plan_fixed_costs if plan_contribution else 0.0
    is_closed_year = bool(year_close_payload)
    if uses_active_context:
        forecast_projection = (
            break_even_commercial_context_service.project_plan_forecast(
                commercial_context,
                actual_totals={
                    "revenue": actual_revenue,
                    "variable_cost": actual_variable,
                    "contribution": actual_contribution,
                    "units": sum(
                        _num(row.get("units"))
                        for row in contribution_rows
                    ),
                    "liters": 0.0,
                },
                actual_periods=[
                    row
                    for row in sales.get("period_totals", [])
                    if isinstance(row, dict)
                ],
                closed_year=is_closed_year,
            )
        )
        forecast_targets = forecast_projection["forecast_targets"]
        reforecast_revenue = _num(forecast_targets.get("revenue"))
        reforecast_variable = _num(
            forecast_targets.get("variable_cost")
        )
        reforecast_contribution = _num(
            forecast_targets.get("contribution")
        )
        reforecast_fixed_costs = fixed_cost_total
        reforecast_absorbed_fixed_costs = fixed_cost_total
        reforecast_total_cost = reforecast_variable + fixed_cost_total
        reforecast_source = _text(
            forecast_projection.get("forecast_source")
        )
        forecast_cutoff_period = _text(
            forecast_projection.get("actual_cutoff_period")
        )
        timeline = forecast_projection.get("timeline", [])
    else:
        reforecast_revenue = actual_revenue if is_closed_year else (_num(explicit_reforecast.get("revenue")) or actual_revenue)
        reforecast_variable = actual_variable if is_closed_year else (_num(explicit_reforecast.get("variable_cost")) or actual_variable)
        reforecast_contribution = actual_contribution if is_closed_year else (_num(explicit_reforecast.get("contribution")) or actual_contribution)
        reforecast_fixed_costs = fixed_cost_total
        reforecast_absorbed_fixed_costs = actual_absorbed_fixed_costs if is_closed_year else (_num(explicit_reforecast.get("absorbed_fixed_costs")) if explicit_reforecast else actual_absorbed_fixed_costs)
        reforecast_total_cost = actual_total_cost if is_closed_year else (_num(explicit_reforecast.get("total_cost")) if explicit_reforecast else actual_total_cost)
        if explicit_reforecast and reforecast_total_cost <= 0:
            reforecast_total_cost = reforecast_variable + reforecast_absorbed_fixed_costs
        reforecast_source = (
            "year_close_snapshot"
            if is_closed_year
            else (
                "reforecast_snapshot"
                if reforecast_snapshot
                else "actual_ytd_temporary"
            )
        )
        forecast_cutoff_period = ""
        timeline = _period_timeline(
            [
                row
                for row in sales.get("period_totals", [])
                if isinstance(row, dict)
            ]
        )
    reforecast_result = reforecast_contribution - reforecast_fixed_costs - incidental_cost_total
    variance_bridge = _variance_bridge_rows(
        plan_contribution=plan_contribution,
        plan_fixed_costs=plan_fixed_costs,
        reforecast_contribution=reforecast_contribution,
        reforecast_fixed_costs=reforecast_fixed_costs + incidental_cost_total,
    )
    warnings: list[dict[str, str]] = []
    if not uses_active_context and not plan_snapshot:
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
            "consumer_mode": (
                "active_generation"
                if uses_active_context
                else "legacy_compatibility"
            ),
            "commercial_generation_id": (
                _text(binding.get("generation_id"))
                if uses_active_context
                else ""
            ),
            "commercial_run_id": (
                _text(binding.get("run_id"))
                if uses_active_context
                else ""
            ),
            "commercial_manifest_hash": (
                _text(binding.get("manifest_hash"))
                if uses_active_context
                else ""
            ),
            "commercial_validation_hash": (
                _text(binding.get("validation_hash"))
                if uses_active_context
                else ""
            ),
            "plan_contract_hash": (
                _text(binding.get("plan_contract_hash"))
                if uses_active_context
                else ""
            ),
            "plan_snapshot_id": (
                _text(binding.get("plan_id"))
                if uses_active_context
                else _text((plan_snapshot or {}).get("id"))
            ),
            "plan_source": (
                "active_commercial_generation_frozen_plan"
                if uses_active_context
                else ("active_plan_snapshot" if plan_snapshot else "missing")
            ),
            "actual_source": "year_close_snapshot" if is_closed_year else "douano_sales_line_cost_snapshots",
            "year_close_snapshot_id": _text((year_close_snapshot or {}).get("id")),
            "reforecast_snapshot_id": (
                _text(
                    (
                        commercial_context.get("forecast_revision") or {}
                    ).get("id")
                )
                if uses_active_context
                else _text((reforecast_snapshot or {}).get("id"))
            ),
            "reforecast_source": reforecast_source,
            "forecast_cutoff_period": forecast_cutoff_period,
            "fixed_cost_source": "year_close_snapshot" if is_closed_year else "fixed_costs_by_year",
            "actual_revenue_source": "year_close_snapshot" if is_closed_year else "douano_sales_line_cost_snapshots",
            "contribution_source": "year_close_snapshot" if is_closed_year else "douano_sales_line_cost_snapshots",
        },
        "dashboard": {
            "plan": {
                "revenue": plan_revenue,
                "variable_cost": plan_variable,
                "total_cost": plan_variable + plan_fixed_costs if plan_variable or plan_fixed_costs else 0.0,
                "absorbed_fixed_costs": plan_fixed_costs,
                "contribution": plan_contribution,
                "fixed_costs": plan_fixed_costs,
                "incidental_costs": 0.0,
                "result": plan_result,
            },
            "actual": {
                "revenue": actual_revenue,
                "variable_cost": actual_variable,
                "total_cost": actual_total_cost,
                "absorbed_fixed_costs": actual_absorbed_fixed_costs,
                "contribution": actual_contribution,
                "fixed_costs": fixed_cost_total,
                "incidental_costs": incidental_cost_total,
                "result": actual_contribution - fixed_cost_total - incidental_cost_total,
            },
            "reforecast": {
                "revenue": reforecast_revenue,
                "variable_cost": reforecast_variable,
                "total_cost": reforecast_total_cost,
                "absorbed_fixed_costs": reforecast_absorbed_fixed_costs,
                "contribution": reforecast_contribution,
                "fixed_costs": reforecast_fixed_costs,
                "incidental_costs": incidental_cost_total,
                "result": reforecast_result,
            },
        },
        "pnl": {
            "revenue": actual_revenue,
            "variable_cost": actual_variable,
            "contribution": actual_contribution,
            "fixed_costs": fixed_cost_total,
            "incidental_costs": incidental_cost_total,
            "operating_result": actual_contribution - fixed_cost_total - incidental_cost_total,
        },
        "break_even": {
            "revenue": break_even_revenue,
            "variable_cost": break_even_variable,
            "contribution": break_even_revenue - break_even_variable,
            "fixed_costs": controllable_cost_total,
            "abc_fixed_costs": fixed_cost_total,
            "incidental_costs": incidental_cost_total,
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
            "model_note": (
                "Planvolume en SKU-verdeling komen uit het immutable frozen "
                "Plan van de actieve commerciële jaarset. Actuals blijven "
                "transactiesnapshots; Forecast vult alleen het resterende "
                "positieve SKU-plan aan."
                if uses_active_context
                else "Per-SKU planvolume is nog niet beschikbaar. Deze regels tonen daarom plan-kostprijs per SKU naast actual/reforecast verkopen."
            ),
        },
        "data_quality": {
            "missing_cost_lines": missing_cost_lines,
            "unmapped_revenue": _num(totals.get("unmapped_revenue")),
            "sales_processing": sales_processing,
            "warnings": warnings,
        },
        "model_notes": {
            "read_only": True,
            "plan_policy": (
                "Plan is the immutable frozen Plan bound to the active commercial generation."
                if uses_active_context
                else "Plan targets are never guessed. Missing targets are returned as warnings."
            ),
            "actual_policy": "Actuals are read from existing Omzet en Marge line cost snapshots; this endpoint does not refresh snapshots.",
            "reforecast_policy": (
                "Forecast uses realized periods plus the approved remaining Plan; only an exact generation-bound revision may replace it."
                if uses_active_context
                else "Reforecast uses the latest explicit reforecast snapshot when available; otherwise it is temporarily equal to actual YTD."
            ),
            "year_close_policy": "When a year-close snapshot exists, closed-year actual and reforecast values are read from that immutable snapshot.",
        },
    }


def build_year_close_payload(
    *,
    year: int,
    basis: str = "invoice",
    override_reason: str = "",
    manual_inputs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    year_value = int(year or 0)
    basis_value = _text(basis) or "invoice"
    manual = manual_inputs if isinstance(manual_inputs, dict) else {}
    sales = _sales_totals(year_value, basis_value)
    sales["variable_cost_rows"] = _sales_variable_cost_control_rows(year_value, basis_value)
    inventory = _year_inventory_snapshot(year_value, basis_value)
    inventory_totals = inventory.get("totals") if isinstance(inventory.get("totals"), dict) else {}
    production_defaults = _production_year_defaults(year_value)
    purchase_liters_from_versions = _extract_purchase_liters_from_cost_versions(year_value)
    sales_liters_from_snapshots = _derive_sales_liters_from_snapshots(year_value, basis_value)
    sales_liters_from_inventory = _inventory_sold_liters(inventory)
    fixed_cost_default = _year_fixed_cost_total(year_value)
    incidental_cost_default = _year_incidental_cost_total(year_value)
    fixed_cost = _manual_or_default(manual, "fixed_cost_total", fixed_cost_default, "fixed_costs_by_year")
    incidental_cost = _manual_or_default(manual, "incidental_cost_total", incidental_cost_default, "incidental_costs_by_year")
    purchase_liters = {
        "value": _num(inventory_totals.get("purchase_liters")),
        "source": "inventory_bridge_stock_movements_purchase_liters",
    }
    production_liters = {
        "value": _num(inventory_totals.get("production_liters")),
        "source": "inventory_bridge_stock_movements_afvullen_liters",
    }
    sales_liters = {
        "value": _num(sales_liters_from_inventory.get("value")),
        "source": _text(sales_liters_from_inventory.get("source")),
    }
    dashboard = _year_close_dashboard(
        sales=sales,
        fixed_cost_total=_num(fixed_cost.get("value")),
        incidental_cost_total=_num(incidental_cost.get("value")),
    )
    plan_baseline = _plan_baseline_for_year(year_value)
    checks = {
        "missing_cost_lines": int((sales.get("totals") or {}).get("missing_cost_lines") or 0),
        "unmapped_revenue": _num((sales.get("totals") or {}).get("unmapped_revenue")),
        "fixed_cost_total": _num(fixed_cost.get("value")),
        "incidental_cost_total": _num(incidental_cost.get("value")),
        "sales_liters": _num(sales_liters.get("value")),
    }
    critical_errors = []
    if int(checks["missing_cost_lines"] or 0) > 0:
        critical_errors.append(
            {
                "code": "missing_cost_lines",
                "message": f"{checks['missing_cost_lines']} verkoopregels missen nog een kostprijsbron.",
            }
        )
    if _num(checks["unmapped_revenue"]) > 0:
        critical_errors.append(
            {
                "code": "unmapped_revenue",
                "message": "Er is nog ongekoppelde omzet.",
            }
        )
    return {
        "kind": "year_close",
        "version": 2,
        "year": year_value,
        "basis": basis_value,
        "fixed_cost_total": _num(fixed_cost.get("value")),
        "incidental_cost_total": _num(incidental_cost.get("value")),
        "manual_inputs": {
            key: manual.get(key)
            for key in (
                "fixed_cost_total",
                "incidental_cost_total",
                "fixed_cost_rows",
                "incidental_cost_rows",
                "purchase_liters",
                "production_liters",
                "sales_liters",
                "inventory_note",
            )
            if key in manual
        },
        "sources": {
            "actual_sales": "douano_sales_line_cost_snapshots",
            "revenue": "douano_sales_line_cost_snapshots",
            "fixed_costs": _text(fixed_cost.get("source")),
            "incidental_costs": _text(incidental_cost.get("source")),
            "purchase_liters": _text(purchase_liters.get("source")),
            "production_liters": _text(production_liters.get("source")),
            "sales_liters": _text(sales_liters.get("source")),
        },
        "drivers": {
            "purchase_liters": purchase_liters,
            "production_liters": production_liters,
            "sales_liters": sales_liters,
            "purchase_liters_diagnostics": purchase_liters_from_versions,
            "purchase_liters_inventory_diagnostics": {
                "value": _num(inventory_totals.get("purchase_liters")),
                "source": "inventory_bridge_stock_movements_purchase_liters",
            },
            "production_liters_inventory_diagnostics": {
                "value": _num(inventory_totals.get("production_liters")),
                "source": "inventory_bridge_stock_movements_afvullen_liters",
            },
            "sales_liters_diagnostics": sales_liters_from_snapshots,
            "sales_liters_inventory_diagnostics": sales_liters_from_inventory,
            "planned_purchase_liters": {
                "value": _num(production_defaults.get("purchase_liters")),
                "source": "production_years_plan",
            },
            "planned_production_liters": {
                "value": _num(production_defaults.get("production_liters")),
                "source": "production_years_plan",
            },
            "planned_sales_liters": {
                "value": _num(production_defaults.get("sales_liters")),
                "source": "production_years_plan",
            },
            "normal_purchase_liters": {
                "value": _num(production_defaults.get("normal_purchase_liters")),
                "source": "production_years",
            },
            "normal_production_liters": {
                "value": _num(production_defaults.get("normal_production_liters")),
                "source": "production_years",
            },
            "normal_sales_liters": {
                "value": _num(production_defaults.get("normal_sales_liters")),
                "source": "production_years",
            },
        },
        "costs": {
            "fixed_cost_total": fixed_cost,
            "incidental_cost_total": incidental_cost,
            "fixed_cost_rows": manual.get("fixed_cost_rows") if isinstance(manual.get("fixed_cost_rows"), list) else [],
            "incidental_cost_rows": manual.get("incidental_cost_rows") if isinstance(manual.get("incidental_cost_rows"), list) else [],
        },
        "dashboard": {
            "plan": plan_baseline,
            "actual": dashboard,
            "reforecast": dict(dashboard),
            "note": "Voor een afgesloten jaar zijn huidig en einde jaar gelijk aan de vastgelegde realisatie.",
        },
        "plan_baseline": plan_baseline,
        "inventory": {
            **inventory,
            "note": _text(manual.get("inventory_note")),
        },
        "actuals": sales,
        "checks": checks,
        "critical_errors": critical_errors,
        "override": {
            "used": bool(_text(override_reason)),
            "reason": _text(override_reason),
        },
    }


def close_year(
    *,
    year: int,
    basis: str = "invoice",
    overwrite: bool = False,
    override_reason: str = "",
    manual_inputs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    year_value = int(year or 0)
    payload = build_year_close_payload(
        year=year_value,
        basis=basis,
        override_reason=override_reason,
        manual_inputs=manual_inputs,
    )
    critical_errors = payload.get("critical_errors") if isinstance(payload.get("critical_errors"), list) else []
    if critical_errors and not _text(override_reason):
        messages = "; ".join(_text(row.get("message")) for row in critical_errors if isinstance(row, dict))
        raise ValueError(f"Jaarafsluiting geblokkeerd: {messages} Geef een override-reden om bewust af te sluiten.")
    item = break_even_planning_storage.close_year_snapshot(year=year_value, payload=payload, overwrite=overwrite)
    drivers = payload.get("drivers") if isinstance(payload.get("drivers"), dict) else {}
    production_storage.update_realised_liters_for_year(
        jaar=year_value,
        realised_inkoop_l=_num((drivers.get("purchase_liters") or {}).get("value") if isinstance(drivers.get("purchase_liters"), dict) else 0),
        realised_productie_l=_num((drivers.get("production_liters") or {}).get("value") if isinstance(drivers.get("production_liters"), dict) else 0),
        realised_sales_l=_num((drivers.get("sales_liters") or {}).get("value") if isinstance(drivers.get("sales_liters"), dict) else 0),
    )
    return item


def _year_close_metric_summary(payload: dict[str, Any]) -> dict[str, float]:
    actuals = payload.get("actuals") if isinstance(payload.get("actuals"), dict) else {}
    totals = actuals.get("totals") if isinstance(actuals.get("totals"), dict) else {}
    drivers = payload.get("drivers") if isinstance(payload.get("drivers"), dict) else {}
    inventory = payload.get("inventory") if isinstance(payload.get("inventory"), dict) else {}
    inventory_totals = inventory.get("totals") if isinstance(inventory.get("totals"), dict) else {}
    return {
        "revenue": _num(totals.get("revenue")),
        "variable_cost": _num(totals.get("variable_cost")),
        "contribution": _num(totals.get("contribution")),
        "fixed_cost_total": _num(payload.get("fixed_cost_total")),
        "incidental_cost_total": _num(payload.get("incidental_cost_total")),
        "result": _num((payload.get("dashboard") or {}).get("result") if isinstance(payload.get("dashboard"), dict) else 0),
        "purchase_liters": _num((drivers.get("purchase_liters") or {}).get("value") if isinstance(drivers.get("purchase_liters"), dict) else 0),
        "production_liters": _num((drivers.get("production_liters") or {}).get("value") if isinstance(drivers.get("production_liters"), dict) else 0),
        "sales_liters": _num((drivers.get("sales_liters") or {}).get("value") if isinstance(drivers.get("sales_liters"), dict) else 0),
        "inventory_rows": float(len(inventory.get("rows") if isinstance(inventory.get("rows"), list) else [])),
        "inventory_end_liters": _num(inventory_totals.get("end_liters")),
        "inventory_end_value_primary": _num(inventory_totals.get("end_value_primary")),
        "inventory_end_value_with_excise": _num(inventory_totals.get("end_value_with_excise")),
    }


def _year_close_impact(old_payload: dict[str, Any], new_payload: dict[str, Any]) -> list[dict[str, Any]]:
    labels = {
        "revenue": "Omzet",
        "variable_cost": "Variabele kosten",
        "contribution": "Contributie",
        "fixed_cost_total": "Vaste kosten",
        "incidental_cost_total": "Incidentele kosten",
        "result": "Resultaat",
        "purchase_liters": "Inkoop in L",
        "production_liters": "Productie in L",
        "sales_liters": "Sales in L",
        "inventory_rows": "Voorraadregels",
        "inventory_end_liters": "Eindvoorraad in L",
        "inventory_end_value_primary": "Eindvoorraad waarde",
        "inventory_end_value_with_excise": "Eindvoorraad waarde incl. accijns",
    }
    old_values = _year_close_metric_summary(old_payload)
    new_values = _year_close_metric_summary(new_payload)
    return [
        {
            "key": key,
            "label": label,
            "old": old_values.get(key, 0.0),
            "new": new_values.get(key, 0.0),
            "delta": new_values.get(key, 0.0) - old_values.get(key, 0.0),
        }
        for key, label in labels.items()
    ]


def preview_year_close_refresh(*, year: int, basis: str = "invoice") -> dict[str, Any]:
    year_value = int(year or 0)
    existing = break_even_planning_storage.get_year_close_snapshot(year=year_value)
    if not existing:
        raise ValueError("Jaar is nog niet afgesloten. Er is geen snapshot om te verversen.")
    existing_payload = existing.get("payload") if isinstance(existing.get("payload"), dict) else {}
    manual_inputs = existing_payload.get("manual_inputs") if isinstance(existing_payload.get("manual_inputs"), dict) else {}
    fresh_payload = build_year_close_payload(
        year=year_value,
        basis=basis or _text(existing_payload.get("basis")) or "invoice",
        override_reason=_text(existing_payload.get("override_reason")),
        manual_inputs=manual_inputs,
    )
    return {
        "year": year_value,
        "current": existing,
        "preview": fresh_payload,
        "impact": _year_close_impact(existing_payload, fresh_payload),
        "manual_inputs_reused": manual_inputs,
    }


def refresh_year_close(
    *,
    year: int,
    basis: str = "invoice",
    reason: str = "",
) -> dict[str, Any]:
    year_value = int(year or 0)
    existing = break_even_planning_storage.get_year_close_snapshot(year=year_value)
    if not existing:
        raise ValueError("Jaar is nog niet afgesloten. Er is geen snapshot om te verversen.")
    existing_payload = existing.get("payload") if isinstance(existing.get("payload"), dict) else {}
    manual_inputs = dict(existing_payload.get("manual_inputs") if isinstance(existing_payload.get("manual_inputs"), dict) else {})
    previous_audit = existing_payload.get("refresh_history") if isinstance(existing_payload.get("refresh_history"), list) else []
    refresh_note = _text(reason) or "Jaarafsluiting expliciet ververst vanuit gesloten snapshot."
    payload = build_year_close_payload(
        year=year_value,
        basis=basis or _text(existing_payload.get("basis")) or "invoice",
        override_reason=_text(existing_payload.get("override_reason")),
        manual_inputs=manual_inputs,
    )
    critical_errors = payload.get("critical_errors") if isinstance(payload.get("critical_errors"), list) else []
    if critical_errors and not _text(existing_payload.get("override_reason")):
        messages = "; ".join(_text(row.get("message")) for row in critical_errors if isinstance(row, dict))
        raise ValueError(f"Jaarafsluiting refresh geblokkeerd: {messages} Geef eerst een override-reden door opnieuw af te sluiten.")
    payload["refresh_history"] = [
        *previous_audit,
        {
            "refreshed_at": _now(),
            "reason": refresh_note,
            "previous_snapshot_id": _text(existing.get("id")),
            "previous_closed_at": _text(existing.get("closed_at")),
            "impact": _year_close_impact(existing_payload, payload),
        },
    ]
    item = break_even_planning_storage.close_year_snapshot(year=year_value, payload=payload, overwrite=True)
    drivers = payload.get("drivers") if isinstance(payload.get("drivers"), dict) else {}
    production_storage.update_realised_liters_for_year(
        jaar=year_value,
        realised_inkoop_l=_num((drivers.get("purchase_liters") or {}).get("value") if isinstance(drivers.get("purchase_liters"), dict) else 0),
        realised_productie_l=_num((drivers.get("production_liters") or {}).get("value") if isinstance(drivers.get("production_liters"), dict) else 0),
        realised_sales_l=_num((drivers.get("sales_liters") or {}).get("value") if isinstance(drivers.get("sales_liters"), dict) else 0),
    )
    return item


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
