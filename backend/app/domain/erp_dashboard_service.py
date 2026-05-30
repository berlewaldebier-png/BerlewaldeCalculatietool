from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Iterable

from app.domain import (
    dataset_store,
    douano_margin_service,
    douano_product_ignore_storage,
    douano_product_mapping_storage,
    postgres_storage,
)


@dataclass(frozen=True)
class _DateRange:
    since: date
    until: date


def _parse_date(value: str, fallback: date) -> date:
    text = str(value or "").strip()
    if not text:
        return fallback
    try:
        return date.fromisoformat(text)
    except Exception:
        return fallback


def _default_range_today_month() -> _DateRange:
    today = date.today()
    since = date(today.year, today.month, 1)
    # Inclusive range in the service; SQL uses < until_plus_one.
    return _DateRange(since=since, until=today)


def _default_range_current_year_ytd() -> _DateRange:
    today = date.today()
    since = date(today.year, 1, 1)
    return _DateRange(since=since, until=today)


def _date_buckets(since: date, until: date, max_points: int = 12) -> list[date]:
    if until < since:
        return [since]
    days = (until - since).days + 1
    if days <= max_points:
        return [since + timedelta(days=i) for i in range(days)]
    step = max(1, round(days / max_points))
    out: list[date] = []
    current = since
    while current <= until:
        out.append(current)
        current = current + timedelta(days=step)
    if out and out[-1] != until:
        out.append(until)
    return out


def _load_break_even_target(*, year: int) -> dict[str, Any]:
    """
    Break-even is computed client-side today.
    For the dashboard read-model we expose only the active config for the year (if any).
    """
    configs = dataset_store.load_dataset("break-even-configuraties")
    rows = [row for row in (configs if isinstance(configs, list) else []) if isinstance(row, dict)]
    active = [
        row
        for row in rows
        if int(row.get("jaar", 0) or 0) == int(year or 0) and bool(row.get("is_active_for_quotes"))
    ]
    picked = active[0] if active else (rows[0] if rows else {})
    return {"year": int(year or 0), "active_config": picked or None}


def _has_any_douano_orders() -> bool:
    postgres_storage.ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT EXISTS (SELECT 1 FROM douano_sales_orders LIMIT 1)")
            row = cur.fetchone()
    return bool(row and row[0])


def _has_any_douano_invoices() -> bool:
    postgres_storage.ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT EXISTS (SELECT 1 FROM douano_sales_invoices LIMIT 1)")
            row = cur.fetchone()
    return bool(row and row[0])


def _iter_order_lines(
    *,
    since: date,
    until: date,
    sku_id: str = "",
) -> Iterable[tuple[int, date, int, str, str, str, float, float, str, str, str]]:
    """
    Yield (line_id, order_date, company_id, company_name, order_number, status, quantity, net_revenue_ex, sku_id, product_group, packaging_type).
    Ignores ignored lines. Unmapped lines have sku_id = '' and thus no cost.
    """
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    postgres_storage.ensure_schema()
    since_iso = since.isoformat()
    until_plus_one = (until + timedelta(days=1)).isoformat()
    sku_filter = str(sku_id or "").strip()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    l.line_id,
                    l.order_date,
                    l.company_id,
                    COALESCE(c.public_name, c.name, '') AS company_name,
                    COALESCE(o.transaction_number, '') AS order_number,
                    COALESCE(o.status, '') AS status,
                    COALESCE(l.quantity, 0) AS quantity,
                    COALESCE(l.net_revenue_ex, 0) AS net_revenue_ex,
                    COALESCE(m.sku_id, '') AS sku_id,
                    COALESCE(m.product_group, '') AS product_group,
                    COALESCE(m.packaging_type, '') AS packaging_type
                FROM douano_sales_order_lines l
                JOIN douano_sales_orders o ON o.sales_order_id = l.sales_order_id
                LEFT JOIN douano_companies c ON c.company_id = l.company_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                WHERE ig.douano_product_id IS NULL
                  AND l.order_date >= %s::date
                  AND l.order_date < %s::date
                  AND (%s = '' OR m.sku_id = %s)
                ORDER BY l.order_date ASC, l.line_id ASC
                """,
                (since_iso, until_plus_one, sku_filter, sku_filter),
            )
            rows = cur.fetchall() or []
    for (
        line_id,
        order_date_raw,
        company_id,
        company_name,
        order_number,
        status,
        quantity,
        net_revenue_ex,
        sku_id,
        product_group,
        packaging_type,
    ) in rows:
        order_date = douano_margin_service._parse_date(order_date_raw)  # type: ignore[attr-defined]
        if order_date is None:
            continue
        yield (
            int(line_id or 0),
            order_date,
            int(company_id or 0),
            str(company_name or ""),
            str(order_number or ""),
            str(status or ""),
            float(quantity or 0.0),
            float(net_revenue_ex or 0.0),
            str(sku_id or ""),
            str(product_group or ""),
            str(packaging_type or ""),
        )


def _iter_invoice_lines(
    *,
    since: date,
    until: date,
    sku_id: str = "",
) -> Iterable[tuple[int, date, int, str, str, str, float, float, str, str, str]]:
    """
    Yield (line_id, invoice_date, company_id, company_name, invoice_number, status, quantity, net_revenue_ex, sku_id, product_group, packaging_type).
    Ignores ignored lines. Unmapped lines have sku_id = '' and thus no cost.
    """
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    from app.domain import douano_unmapped_rule_storage
    douano_unmapped_rule_storage.ensure_schema()
    postgres_storage.ensure_schema()
    since_iso = since.isoformat()
    until_plus_one = (until + timedelta(days=1)).isoformat()
    sku_filter = str(sku_id or "").strip()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    l.line_id,
                    l.invoice_date,
                    l.company_id,
                    COALESCE(c.public_name, c.name, '') AS company_name,
                    COALESCE(i.invoice_number, '') AS invoice_number,
                    COALESCE(i.transaction_type, '') AS status,
                    COALESCE(l.quantity, 0) AS quantity,
                    COALESCE(l.net_revenue_ex, 0) AS net_revenue_ex,
                    COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, ''), '') AS sku_id,
                    COALESCE(m.product_group, '') AS product_group,
                    COALESCE(m.packaging_type, '') AS packaging_type
                FROM douano_sales_invoice_lines l
                JOIN douano_sales_invoices i ON i.sales_invoice_id = l.sales_invoice_id
                LEFT JOIN douano_companies c ON c.company_id = l.company_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                LEFT JOIN douano_unmapped_rules r
                  ON l.douano_product_id = 0
                 AND r.match_type = 'product0_description'
                 AND r.douano_product_id = 0
                 AND r.action = 'map_to_sku'
                 AND r.line_description = COALESCE(NULLIF(l.line_description, ''), 'Overig')
                WHERE ig.douano_product_id IS NULL
                  AND l.invoice_date >= %s::date
                  AND l.invoice_date < %s::date
                  AND (
                    %s = ''
                    OR COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, ''), '') = %s
                  )
                ORDER BY l.invoice_date ASC, l.line_id ASC
                """,
                (since_iso, until_plus_one, sku_filter, sku_filter),
            )
            rows = cur.fetchall() or []
    for (
        line_id,
        invoice_date_raw,
        company_id,
        company_name,
        invoice_number,
        status,
        quantity,
        net_revenue_ex,
        sku_id,
        product_group,
        packaging_type,
    ) in rows:
        invoice_date = douano_margin_service._parse_date(invoice_date_raw)  # type: ignore[attr-defined]
        if invoice_date is None:
            continue
        yield (
            int(line_id or 0),
            invoice_date,
            int(company_id or 0),
            str(company_name or ""),
            str(invoice_number or ""),
            str(status or ""),
            float(quantity or 0.0),
            float(net_revenue_ex or 0.0),
            str(sku_id or ""),
            str(product_group or ""),
            str(packaging_type or ""),
        )


def get_erp_dashboard(
    *,
    since: str = "",
    until: str = "",
    basis: str = "invoice",
    year: int = 0,
    sku_id: str = "",
) -> dict[str, Any]:
    """
    ERP performance dashboard read-model.

    Notes:
    - Source of truth for revenue: Douano order lines (net revenue ex).
    - Cost is derived from active kostprijsversies via kostprijsproductactiveringen (same logic as douano_margin_service).
    - Break-even computation is currently handled client-side; we expose the active config as context.
    """
    basis = str(basis or "invoice").strip().lower() or "invoice"
    if basis not in ("order", "invoice"):
        basis = "invoice"

    since_text = str(since or "").strip()
    until_text = str(until or "").strip()
    year_int = int(year or 0)
    has_explicit_filters = bool(year_int > 0 or since_text or until_text)

    default = _default_range_current_year_ytd()
    range_since = _parse_date(since, default.since)
    range_until = _parse_date(until, default.until)

    if year_int > 0 and not since_text and not until_text:
        range_since = date(year_int, 1, 1)
        range_until = date(year_int, 12, 31)

    sku_filter = str(sku_id or "").strip()
    if range_until < range_since:
        range_until = range_since

    # Available years for the filter dropdown.
    postgres_storage.ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT EXTRACT(YEAR FROM {col})::int AS y
                FROM {table}
                WHERE {col} IS NOT NULL
                ORDER BY y ASC
                """.format(
                    table="douano_sales_invoices" if basis == "invoice" else "douano_sales_orders",
                    col="invoice_date" if basis == "invoice" else "order_date",
                )
            )
            years_rows = cur.fetchall() or []
    available_years = [int(r[0] or 0) for r in years_rows if int(r[0] or 0) > 0]

    has_any = _has_any_douano_invoices() if basis == "invoice" else _has_any_douano_orders()
    if not has_any:
        year = int(range_since.year)
        return {
            "range": {"basis": basis, "since": range_since.isoformat(), "until": range_until.isoformat()},
            "available_years": available_years,
            "empty_reason": "Geen Douano orders gevonden. Synchroniseer eerst orders via Beheer → API.",
            "kpis": None,
            "trends": {"revenue": [], "orders": []},
            "tables": {
                "top_customers": [],
                "latest_orders": [],
                "under_break_even": [],
                "product_groups": [],
                "packaging_types": [],
            },
            "break_even": _load_break_even_target(year=year),
            "alerts": [],
        }

    # Load datasets once for cost resolution (same approach as douano_margin_service).
    activations = dataset_store.load_dataset("kostprijsproductactiveringen")
    versions = dataset_store.load_dataset("kostprijsversies")
    activation_index = douano_margin_service._build_activation_index(  # type: ignore[attr-defined]
        activations if isinstance(activations, list) else []
    )
    versions_by_id: dict[str, dict[str, Any]] = {
        str(v.get("id", "") or ""): v for v in (versions if isinstance(versions, list) else []) if isinstance(v, dict)
    }
    used_version_ids = [
        str(row.get("kostprijsversie_id", "") or "")
        for row in (activations if isinstance(activations, list) else [])
        if isinstance(row, dict)
    ]
    snapshot_cost_index = douano_margin_service._build_snapshot_cost_index(  # type: ignore[attr-defined]
        versions_by_id, used_version_ids
    )

    # Aggregate.
    revenue_total = 0.0
    cost_total = 0.0
    missing_cost_lines = 0
    mapped_lines = 0

    # Product group aggregates (retroactive via mapping table).
    groups: dict[str, dict[str, float]] = {}

    # Packaging type aggregates (order line quantities by uitlevervorm).
    packaging_types: dict[str, float] = {}

    # Per-order totals for latest + under break-even.
    by_order: dict[str, dict[str, Any]] = {}

    lines_iter = (
        _iter_invoice_lines(since=range_since, until=range_until, sku_id=sku_filter)
        if basis == "invoice"
        else _iter_order_lines(since=range_since, until=range_until, sku_id=sku_filter)
    )

    for (
        line_id,
        order_date,
        company_id,
        company_name,
        order_number,
        status,
        quantity,
        net_revenue_ex,
        sku_id,
        product_group,
        packaging_type,
    ) in lines_iter:
        revenue_total += float(net_revenue_ex or 0.0)

        pack_key = ""
        if not str(sku_id or "").strip():
            pack_key = "Niet gekoppeld"
        else:
            pack_key = str(packaging_type or "").strip() or "Geen verpakkingstype"
        packaging_types[pack_key] = float(packaging_types.get(pack_key, 0.0) or 0.0) + float(quantity or 0.0)

        cost_unit = None
        line_cost_total = 0.0
        if str(sku_id or "").strip():
            mapped_lines += 1
            cost_unit, _ = douano_margin_service._resolve_cost_per_unit(  # type: ignore[attr-defined]
                sku_id=str(sku_id or ""),
                as_of=order_date,
                activations_index=activation_index,
                versions_by_id=versions_by_id,
                snapshot_cost_index=snapshot_cost_index,
            )
            line_cost_total = float(quantity or 0.0) * float(cost_unit) if cost_unit is not None else 0.0
            if cost_unit is None:
                missing_cost_lines += 1
            else:
                cost_total += line_cost_total

            # Group aggregation only when cost is known (avoid inflated margins).
            if cost_unit is not None:
                group_key = str(product_group or "").strip() or "Onbekend"
                bucket = groups.setdefault(group_key, {"revenue": 0.0, "cost": 0.0, "margin": 0.0})
                bucket["revenue"] += float(net_revenue_ex or 0.0)
                bucket["cost"] += float(line_cost_total or 0.0)
                bucket["margin"] += float(net_revenue_ex or 0.0) - float(line_cost_total or 0.0)

        order_key = f"{order_date.isoformat()}::{order_number or line_id}"
        bucket = by_order.setdefault(
            order_key,
            {
                "order_number": order_number,
                "order_date": order_date.isoformat(),
                "status": status,
                "company_id": company_id,
                "company_name": company_name,
                "revenue_ex": 0.0,
                "cost_ex": 0.0,
                "missing_cost_lines": 0,
            },
        )
        bucket["revenue_ex"] = float(bucket["revenue_ex"] or 0.0) + float(net_revenue_ex or 0.0)
        if str(sku_id or "").strip():
            if cost_unit is None:
                bucket["missing_cost_lines"] = int(bucket["missing_cost_lines"] or 0) + 1
            else:
                bucket["cost_ex"] = float(bucket["cost_ex"] or 0.0) + line_cost_total

    order_rows = list(by_order.values())
    order_rows.sort(key=lambda r: (str(r.get("order_date", "")), str(r.get("order_number", ""))), reverse=True)
    latest_orders = order_rows[:5]

    under_break_even = []
    for row in order_rows:
        margin = float(row.get("revenue_ex", 0.0) or 0.0) - float(row.get("cost_ex", 0.0) or 0.0)
        if margin < 0:
            under_break_even.append(
                {
                    "order_number": row.get("order_number", "") or "-",
                    "company_name": row.get("company_name", "") or "-",
                    "margin_ex": margin,
                }
            )
        if len(under_break_even) >= 5:
            break

    total_margin = revenue_total - cost_total
    margin_pct = (total_margin / revenue_total * 100.0) if revenue_total > 0 else 0.0
    total_orders = len(order_rows)
    aov = (revenue_total / total_orders) if total_orders > 0 else 0.0

    # Top customers: reuse margin-summary (already includes cost logic); order basis.
    # Keep limit bounded for dashboard.
    customers = douano_margin_service.get_company_margin_summary(  # type: ignore[attr-defined]
        since=range_since.isoformat(),
        year=int(range_since.year),
        limit=200,
        basis="order",
    )
    top_customers = [
        {
            "company_id": int(row.get("company_id", 0) or 0),
            "company_name": str(row.get("company_name", "") or ""),
            "revenue_ex": float(row.get("netto_omzet_ex", 0.0) or 0.0),
            "margin_ex": float(row.get("brutomarge_ex", 0.0) or 0.0),
            "margin_pct": (float(row.get("brutomarge_ex", 0.0) or 0.0) / float(row.get("netto_omzet_ex", 0.0) or 0.0) * 100.0)
            if float(row.get("netto_omzet_ex", 0.0) or 0.0) > 0
            else 0.0,
        }
        for row in (customers[:5] if isinstance(customers, list) else [])
        if isinstance(row, dict)
    ]

    # Trends: full-year monthly series + a forecast line (based on realized-to-date and historical seasonality).
    chart_year = int(range_since.year)
    year_start = date(chart_year, 1, 1)
    year_end = date(chart_year, 12, 31)
    month_starts = [date(chart_year, month, 1) for month in range(1, 13)]

    revenue_trend: list[dict[str, Any]] = [{"date": d.isoformat(), "revenue_ex": 0.0, "forecast_ex": None} for d in month_starts]
    orders_trend: list[dict[str, Any]] = [{"date": d.isoformat(), "orders": 0, "aov_ex": 0.0, "forecast_orders": None} for d in month_starts]
    revenue_by_month = {row["date"]: row for row in revenue_trend}
    orders_by_month = {row["date"]: row for row in orders_trend}
    month_order_keys: dict[str, set[str]] = {row["date"]: set() for row in orders_trend}

    def month_key(d: date) -> str:
        return date(d.year, d.month, 1).isoformat()

    today = date.today()
    as_of = min(today, year_end) if chart_year == today.year else year_end
    ytd_revenue = 0.0

    year_lines_iter = (
        _iter_invoice_lines(since=year_start, until=year_end, sku_id=sku_filter)
        if basis == "invoice"
        else _iter_order_lines(since=year_start, until=year_end, sku_id=sku_filter)
    )
    for (
        line_id,
        line_date,
        _company_id,
        _company_name,
        order_number,
        _status,
        _quantity,
        net_revenue_ex,
        _sku_id,
        _product_group,
        _packaging_type,
    ) in year_lines_iter:
        key = month_key(line_date)
        if key in revenue_by_month:
            revenue_by_month[key]["revenue_ex"] = float(revenue_by_month[key]["revenue_ex"] or 0.0) + float(net_revenue_ex or 0.0)
            order_key = str(order_number or "").strip() or str(line_id)
            month_order_keys[key].add(order_key)
        if chart_year == today.year and line_date <= as_of:
            ytd_revenue += float(net_revenue_ex or 0.0)

    for key, row in orders_by_month.items():
        order_count = len(month_order_keys.get(key, set()))
        row["orders"] = int(order_count)
        revenue = float(revenue_by_month[key]["revenue_ex"] or 0.0)
        row["aov_ex"] = (revenue / order_count) if order_count > 0 else 0.0

    # Determine month weights from historical years (same basis + sku filter), fallback to uniform.
    month_weights: list[float] = [1.0 / 12.0 for _ in range(12)]
    historical_years = [int(y) for y in (available_years or []) if int(y) > 0 and int(y) != chart_year]
    historical_years = sorted(historical_years)[-4:]
    if historical_years:
        sums = [0.0 for _ in range(12)]
        counts = [0 for _ in range(12)]
        for y in historical_years:
            start = date(y, 1, 1)
            end = date(y, 12, 31)
            totals_by_month = [0.0 for _ in range(12)]
            it = (
                _iter_invoice_lines(since=start, until=end, sku_id=sku_filter)
                if basis == "invoice"
                else _iter_order_lines(since=start, until=end, sku_id=sku_filter)
            )
            for (_lid, d, _cid, _cname, _on, _st, _qty, rev, _sku, _pg, _pt) in it:
                totals_by_month[int(d.month) - 1] += float(rev or 0.0)
            total_year = sum(totals_by_month)
            if total_year <= 0:
                continue
            for idx in range(12):
                sums[idx] += totals_by_month[idx] / total_year
                counts[idx] += 1
        averaged = [(sums[i] / counts[i]) if counts[i] > 0 else 0.0 for i in range(12)]
        if sum(averaged) > 0:
            month_weights = averaged

    # Forecast total-year revenue from ytd using historical cumulative share at end of current month.
    if chart_year == today.year:
        ytd_month = int(as_of.month)
        ytd_share = sum(month_weights[:ytd_month])
        projected_total = (ytd_revenue / ytd_share) if ytd_share > 0 else 0.0
        if projected_total > 0:
            # Orders forecast: run-rate on orders YTD distributed with the same seasonality weights.
            ytd_orders = sum(int(orders_by_month[date(chart_year, m, 1).isoformat()]["orders"] or 0) for m in range(1, ytd_month + 1))
            projected_orders_total = (float(ytd_orders) / ytd_share) if ytd_share > 0 else 0.0
            for idx, month_start in enumerate(month_starts):
                if idx + 1 <= ytd_month:
                    continue
                key = month_start.isoformat()
                revenue_by_month[key]["forecast_ex"] = float(projected_total) * float(month_weights[idx] or 0.0)
                orders_by_month[key]["forecast_orders"] = float(projected_orders_total) * float(month_weights[idx] or 0.0) if projected_orders_total > 0 else None

    year = int(range_since.year)
    alerts: list[dict[str, Any]] = []
    if missing_cost_lines > 0:
        alerts.append(
            {
                "key": "missing-cost",
                "title": "Ontbrekende kostprijs",
                "description": f"{missing_cost_lines} orderregels missen een kostprijs (mapping/activatie).",
                "tone": "warning",
                "count": int(missing_cost_lines),
                "href": "/beheer/productkoppeling",
            }
        )

    product_groups = []
    for key, bucket in groups.items():
        revenue = float(bucket.get("revenue", 0.0) or 0.0)
        margin = float(bucket.get("margin", 0.0) or 0.0)
        product_groups.append(
            {
                "group": str(key),
                "margin_ex": margin,
                "margin_pct": (margin / revenue * 100.0) if revenue > 0 else 0.0,
            }
        )
    product_groups.sort(key=lambda r: float(r.get("margin_pct", 0.0) or 0.0), reverse=True)

    packaging_types_rows = [
        {"packaging_type": str(key), "qty": float(qty or 0.0)}
        for key, qty in packaging_types.items()
        if str(key or "").strip()
    ]
    packaging_types_rows.sort(key=lambda r: float(r.get("qty", 0.0) or 0.0), reverse=True)

    return {
        "range": {"basis": basis, "since": range_since.isoformat(), "until": range_until.isoformat()},
        "available_years": available_years,
        "kpis": {
            "total_revenue_ex": revenue_total,
            "total_orders": int(total_orders),
            "average_order_value_ex": aov,
            "total_cost_ex": cost_total,
            "total_margin_ex": total_margin,
            "margin_pct": margin_pct,
            "mapped_lines": int(mapped_lines),
            "missing_cost_lines": int(missing_cost_lines),
        },
        "trends": {"revenue": revenue_trend, "orders": orders_trend},
        "tables": {
            "top_customers": top_customers,
            "latest_orders": latest_orders,
            "under_break_even": under_break_even,
            "product_groups": product_groups[:5],
            "packaging_types": packaging_types_rows,
        },
        "break_even": _load_break_even_target(year=year),
        "alerts": alerts,
    }
