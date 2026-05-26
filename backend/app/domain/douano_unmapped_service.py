from __future__ import annotations

from typing import Any, Literal

from app.domain import (
    douano_product_ignore_storage,
    douano_product_mapping_storage,
    douano_sync_storage,
    douano_unmapped_rule_storage,
    postgres_storage,
)


Basis = Literal["invoice", "order"]
Status = Literal["open", "resolved", "all"]


def _year_range(year: int) -> tuple[str, str]:
    y = int(year or 0)
    if y <= 0:
        return "", ""
    start = f"{y:04d}-01-01"
    end = f"{y + 1:04d}-01-01"
    return start, end


def list_unmapped_groups(
    *,
    basis: Basis,
    year: int,
    since: str = "",
    limit: int = 200,
    status: Status = "open",
) -> dict[str, Any]:
    """Return grouped 'unmapped' items that can be solved via rules or mappings.

    Groups are either:
    - (douano_product_id != 0): key = douano_product_id
    - (douano_product_id == 0): key = line_description (exact)
    """
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    douano_unmapped_rule_storage.ensure_schema()
    douano_sync_storage.ensure_schema()
    postgres_storage.ensure_schema()

    basis_norm: Basis = "order" if str(basis or "").strip().lower() == "order" else "invoice"
    topn = max(1, min(int(limit or 200), 1000))
    since_text = str(since or "").strip()
    year_start, year_end = _year_range(int(year or 0))
    if not year_start or not year_end:
        return {"year": int(year or 0), "basis": basis_norm, "items": []}

    if since_text:
        # If caller uses since, we still clamp by year range for predictable "year view".
        year_start = max(year_start, since_text)

    table = "douano_sales_invoice_lines" if basis_norm == "invoice" else "douano_sales_order_lines"
    date_col = "invoice_date" if basis_norm == "invoice" else "order_date"
    header_table = "douano_sales_invoices" if basis_norm == "invoice" else "douano_sales_orders"
    header_join_col = "sales_invoice_id" if basis_norm == "invoice" else "sales_order_id"
    header_ref_col = "invoice_number" if basis_norm == "invoice" else "transaction_number"

    status_norm: Status = status if status in {"open", "resolved", "all"} else "open"

    status_clause = ""
    if status_norm == "open":
        status_clause = "AND r.rule_id IS NULL"
    elif status_norm == "resolved":
        status_clause = "AND r.rule_id IS NOT NULL"

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                WITH base AS (
                    SELECT
                        l.{header_join_col} AS ref_id,
                        l.{date_col} AS ref_date,
                        l.douano_product_id,
                        COALESCE(NULLIF(l.line_product_name, ''), NULLIF(p.name, ''), '') AS line_product_name,
                        COALESCE(p.sku, '') AS product_sku,
                        COALESCE(NULLIF(l.line_description, ''), 'Overig') AS line_description,
                        COALESCE(l.quantity, 0) AS quantity,
                        COALESCE(l.net_revenue_ex, 0) AS net_revenue_ex
                    FROM {table} l
                    LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                    WHERE m.douano_product_id IS NULL
                      AND ig.douano_product_id IS NULL
                      AND l.{date_col} >= %s::date
                      AND l.{date_col} < %s::date
                ),
                grouped AS (
                    SELECT
                        CASE WHEN b.douano_product_id = 0 THEN 'product0_description' ELSE 'douano_product_id' END AS match_type,
                        CASE WHEN b.douano_product_id = 0 THEN 0 ELSE b.douano_product_id END AS douano_product_id,
                        CASE WHEN b.douano_product_id = 0 THEN b.line_description ELSE '' END AS line_description,
                        CASE
                            WHEN b.douano_product_id = 0 THEN b.line_description
                            ELSE COALESCE(NULLIF(MAX(NULLIF(b.line_product_name, '')), ''), CONCAT('Product ', b.douano_product_id::text))
                        END AS display_name,
                        COALESCE(NULLIF(MAX(NULLIF(b.product_sku, '')), ''), '') AS product_sku,
                        COUNT(*)::int AS lines,
                        SUM(b.quantity) AS quantity,
                        SUM(b.net_revenue_ex) AS net_revenue_ex
                    FROM base b
                    GROUP BY
                        match_type,
                        CASE WHEN b.douano_product_id = 0 THEN 0 ELSE b.douano_product_id END,
                        CASE WHEN b.douano_product_id = 0 THEN b.line_description ELSE '' END
                ),
                with_rules AS (
                    SELECT
                        g.*,
                        r.rule_id,
                        COALESCE(r.action, '') AS action,
                        COALESCE(r.category, '') AS category,
                        COALESCE(r.include_revenue, TRUE) AS include_revenue,
                        COALESCE(r.include_liters, FALSE) AS include_liters,
                        COALESCE(r.include_break_even, TRUE) AS include_break_even
                    FROM grouped g
                    LEFT JOIN douano_unmapped_rules r
                      ON r.match_type = g.match_type
                     AND r.douano_product_id = g.douano_product_id
                     AND r.line_description = g.line_description
                    WHERE 1=1
                      {status_clause}
                      AND COALESCE(r.action, '') <> 'ignore'
                )
                SELECT
                    w.match_type,
                    w.douano_product_id,
                    w.line_description,
                    w.display_name,
                    w.product_sku,
                    w.lines,
                    w.quantity,
                    w.net_revenue_ex,
                    w.rule_id,
                    w.action,
                    w.category,
                    w.include_revenue,
                    w.include_liters,
                    w.include_break_even,
                    ex.ref,
                    ex.ref_date
                FROM with_rules w
                LEFT JOIN LATERAL (
                    SELECT
                        h.{header_ref_col} AS ref,
                        b.ref_date AS ref_date
                    FROM base b
                    JOIN {header_table} h ON h.{header_join_col} = b.ref_id
                    WHERE (
                        (w.match_type = 'douano_product_id' AND b.douano_product_id = w.douano_product_id)
                        OR (w.match_type = 'product0_description' AND b.douano_product_id = 0 AND b.line_description = w.line_description)
                    )
                    ORDER BY b.ref_date DESC, b.ref_id DESC
                    LIMIT 1
                ) ex ON TRUE
                ORDER BY w.net_revenue_ex DESC
                LIMIT %s
                """,
                (year_start, year_end, topn),
            )
            rows = cur.fetchall() or []

    items: list[dict[str, Any]] = []
    for (
        match_type,
        douano_product_id,
        line_description,
        display_name,
        product_sku,
        lines,
        quantity,
        net_revenue_ex,
        rule_id,
        action,
        category,
        include_revenue,
        include_liters,
        include_break_even,
        example_ref,
        example_date,
    ) in rows:
        items.append(
            {
                "match_type": str(match_type or ""),
                "douano_product_id": int(douano_product_id or 0),
                "line_description": str(line_description or ""),
                "display_name": str(display_name or ""),
                "product_sku": str(product_sku or ""),
                "lines": int(lines or 0),
                "quantity": float(quantity or 0.0),
                "net_revenue_ex": float(net_revenue_ex or 0.0),
                "rule": (
                    None
                    if not rule_id
                    else {
                        "rule_id": int(rule_id or 0),
                        "action": str(action or ""),
                        "category": str(category or ""),
                        "include_revenue": bool(include_revenue),
                        "include_liters": bool(include_liters),
                        "include_break_even": bool(include_break_even),
                    }
                ),
                "example_ref": str(example_ref or ""),
                "example_date": example_date.isoformat() if example_date else "",
            }
        )

    return {"year": int(year or 0), "basis": basis_norm, "items": items}


def list_unmapped_group_lines(
    *,
    basis: Basis,
    year: int,
    match_type: str,
    douano_product_id: int = 0,
    line_description: str = "",
    limit: int = 500,
) -> dict[str, Any]:
    """Return raw lines for a single unmapped group, so users can inspect occurrences."""
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    douano_sync_storage.ensure_schema()
    postgres_storage.ensure_schema()

    basis_norm: Basis = "order" if str(basis or "").strip().lower() == "order" else "invoice"
    lim = max(1, min(int(limit or 500), 5000))
    year_start, year_end = _year_range(int(year or 0))
    if not year_start or not year_end:
        return {"year": int(year or 0), "basis": basis_norm, "items": []}

    mt = str(match_type or "").strip()
    pid = int(douano_product_id or 0)
    desc = str(line_description or "").strip()
    if mt == "douano_product_id":
        if pid <= 0:
            raise ValueError("douano_product_id ontbreekt")
    elif mt == "product0_description":
        if pid != 0 or not desc:
            raise ValueError("line_description ontbreekt")
    else:
        raise ValueError("Ongeldige match_type")

    table = "douano_sales_invoice_lines" if basis_norm == "invoice" else "douano_sales_order_lines"
    date_col = "invoice_date" if basis_norm == "invoice" else "order_date"
    header_table = "douano_sales_invoices" if basis_norm == "invoice" else "douano_sales_orders"
    header_join_col = "sales_invoice_id" if basis_norm == "invoice" else "sales_order_id"
    header_ref_col = "invoice_number" if basis_norm == "invoice" else "transaction_number"

    where_group = "l.douano_product_id = %s" if mt == "douano_product_id" else "l.douano_product_id = 0 AND COALESCE(NULLIF(l.line_description, ''), 'Overig') = %s"
    group_param = pid if mt == "douano_product_id" else desc

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    l.line_id,
                    l.{header_join_col} AS ref_id,
                    l.{date_col} AS ref_date,
                    h.{header_ref_col} AS ref,
                    l.douano_product_id,
                    COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), '') AS product_name,
                    COALESCE(p.sku, '') AS product_sku,
                    COALESCE(NULLIF(l.line_description, ''), 'Overig') AS line_description,
                    l.quantity,
                    l.unit_price_ex,
                    l.discount_ex,
                    l.charges_total_ex,
                    l.net_revenue_ex
                FROM {table} l
                JOIN {header_table} h ON h.{header_join_col} = l.{header_join_col}
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                WHERE m.douano_product_id IS NULL
                  AND ig.douano_product_id IS NULL
                  AND l.{date_col} >= %s::date
                  AND l.{date_col} < %s::date
                  AND {where_group}
                ORDER BY l.{date_col} DESC, l.{header_join_col} DESC, l.line_id DESC
                LIMIT %s
                """,
                (year_start, year_end, group_param, lim),
            )
            rows = cur.fetchall() or []

    out: list[dict[str, Any]] = []
    for (
        line_id,
        ref_id,
        ref_date,
        ref,
        douano_product_id,
        product_name,
        product_sku,
        line_description,
        quantity,
        unit_price_ex,
        discount_ex,
        charges_total_ex,
        net_revenue_ex,
    ) in rows:
        out.append(
            {
                "line_id": int(line_id or 0),
                "ref_id": int(ref_id or 0),
                "ref": str(ref or ""),
                "ref_date": ref_date.isoformat() if ref_date else "",
                "douano_product_id": int(douano_product_id or 0),
                "product_name": str(product_name or ""),
                "product_sku": str(product_sku or ""),
                "line_description": str(line_description or ""),
                "quantity": float(quantity or 0.0),
                "unit_price_ex": float(unit_price_ex or 0.0),
                "discount_ex": float(discount_ex or 0.0),
                "charges_total_ex": float(charges_total_ex or 0.0),
                "net_revenue_ex": float(net_revenue_ex or 0.0),
            }
        )

    return {"year": int(year or 0), "basis": basis_norm, "items": out}
