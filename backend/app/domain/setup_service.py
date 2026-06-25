from __future__ import annotations

from typing import Any

from app.domain import (
    cost_versions_storage,
    dataset_store,
    douano_margin_snapshot_storage,
    kostprijs_activation_storage,
    lot_costs_storage,
    postgres_storage,
)


def _check(
    *,
    check_id: str,
    label: str,
    done: bool,
    current: int,
    total: int,
    missing: list[dict[str, Any]] | None = None,
    group: str = "setup",
    description: str = "",
    href: str = "",
) -> dict[str, Any]:
    return {
        "id": check_id,
        "label": label,
        "done": bool(done),
        "current": int(current or 0),
        "total": int(total or 0),
        "missing": missing or [],
        "group": group,
        "description": description,
        "href": href,
    }


def _safe_count(table: str, where: str = "", params: tuple[Any, ...] = ()) -> int:
    try:
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT to_regclass(%s)", (table,))
                if not (cur.fetchone() or [None])[0]:
                    return 0
                sql = f"SELECT COUNT(*) FROM {table}"
                if where:
                    sql += f" WHERE {where}"
                cur.execute(sql, params)
                return int((cur.fetchone() or [0])[0] or 0)
    except Exception:
        return 0


def _safe_rows(sql: str, params: tuple[Any, ...] = (), limit: int = 100) -> list[dict[str, Any]]:
    try:
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                names = [desc[0] for desc in cur.description or []]
                rows = cur.fetchmany(max(1, min(int(limit or 100), 500))) or []
        return [dict(zip(names, row)) for row in rows]
    except Exception:
        return []


def _safe_scalar(sql: str, params: tuple[Any, ...] = (), default: int = 0) -> int:
    try:
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return int((cur.fetchone() or [default])[0] or default)
    except Exception:
        return int(default)


def _sync_ok(resource: str) -> bool:
    return bool(
        _safe_scalar(
            """
            SELECT COUNT(*)
            FROM douano_sync_state
            WHERE resource = %s
              AND last_success_at IS NOT NULL
              AND COALESCE(last_error, '') = ''
            """,
            (resource,),
        )
    )


def _known_production_years() -> list[int]:
    productie = dataset_store.load_dataset("productie")
    years: set[int] = set()
    if isinstance(productie, dict):
        for key in productie.keys():
            try:
                year = int(key)
            except (TypeError, ValueError):
                continue
            if year > 0:
                years.add(year)
    elif isinstance(productie, list):
        for row in productie:
            if not isinstance(row, dict):
                continue
            try:
                year = int(row.get("jaar") or row.get("year") or 0)
            except (TypeError, ValueError):
                continue
            if year > 0:
                years.add(year)
    return sorted(years)


def _dataset_year_rows(name: str, year: int) -> list[dict[str, Any]]:
    rows = dataset_store.load_dataset(name)
    if isinstance(rows, dict):
        value = rows.get(str(int(year)), [])
        return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []
    if isinstance(rows, list):
        out: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                row_year = int(float(row.get("jaar") or 0))
            except (TypeError, ValueError):
                row_year = 0
            if row_year == int(year):
                out.append(row)
        return out
    return []


def _reset_remaining_counts() -> dict[str, int]:
    bieren = dataset_store.load_dataset("bieren")
    return {
        "bieren": len([row for row in bieren if isinstance(row, dict)]) if isinstance(bieren, list) else 0,
        "product_families": _safe_count("product_families"),
        "skus": _safe_count("skus"),
        "articles": _safe_count("articles"),
        "bom_lines": _safe_count("bom_lines"),
        "douano_product_mapping": _safe_count("douano_product_mapping"),
        "douano_product_ignore": _safe_count("douano_product_ignore"),
        "cost_versions": _safe_count("cost_versions"),
        "cost_version_sku_rows": _safe_count("cost_version_sku_rows"),
        "kostprijs_sku_activations": _safe_count("kostprijs_sku_activations"),
        "sales_lot_excel_rows": _safe_count(
            "sales_lot_allocations",
            "import_batch_id <> 'douano_stock_history' OR payload->>'lot_source' = 'excel_enrichment'",
        ),
        "opening_lot_records": _safe_count(
            "lot_cost_records",
            "source_type IN ('opening_lot', 'excel', 'excel_import') OR source_ref ILIKE '%%Opening LOT%%'",
        ),
        "sku_family_links": _safe_count("sku_family_links"),
        "sku_composition_lines": _safe_count("sku_composition_lines"),
        "purchase_lots": _safe_count("purchase_lots"),
        "purchase_lot_sku_costs": _safe_count("purchase_lot_sku_costs"),
    }


def _active_activation_sku_ids(year: int) -> set[str]:
    rows = dataset_store.load_dataset("kostprijsproductactiveringen")
    out: set[str] = set()
    if not isinstance(rows, list):
        return out
    for row in rows:
        if not isinstance(row, dict):
            continue
        if int(float(row.get("jaar") or 0)) != int(year):
            continue
        if str(row.get("effectief_tot") or "").strip():
            continue
        sku_id = str(row.get("sku_id") or "").strip()
        if sku_id:
            out.add(sku_id)
    return out


def has_active_costprices(year: int | None = None) -> bool:
    rows = dataset_store.load_dataset("kostprijsproductactiveringen")
    if not isinstance(rows, list):
        return False
    for row in rows:
        if not isinstance(row, dict):
            continue
        if year is not None and int(float(row.get("jaar") or 0)) != int(year):
            continue
        if str(row.get("effectief_tot") or "").strip():
            continue
        if str(row.get("sku_id") or "").strip() and str(row.get("kostprijsversie_id") or "").strip():
            return True
    return False


def build_setup_status(year: int) -> dict[str, Any]:
    lot_costs_storage.ensure_schema()
    cost_versions_storage.ensure_schema()

    start_date = f"{int(year)}-01-01"
    end_date = f"{int(year) + 1}-01-01"

    bieren = dataset_store.load_dataset("bieren")
    style_count = len([row for row in bieren if isinstance(row, dict)]) if isinstance(bieren, list) else 0

    skus = postgres_storage.load_dataset("skus", [])
    skus = skus if isinstance(skus, list) else []
    internal_sku_ids = {
        str(row.get("id") or "").strip()
        for row in skus
        if isinstance(row, dict) and str(row.get("id") or "").strip()
    }
    active_sku_ids = _active_activation_sku_ids(year)

    douano_products_total = _safe_count("douano_products")
    sales_invoices_year = _safe_count(
        "douano_sales_invoices",
        "invoice_date >= %s::date AND invoice_date < %s::date",
        (start_date, end_date),
    )
    sales_invoice_lines_year = _safe_count(
        "douano_sales_invoice_lines",
        "invoice_date >= %s::date AND invoice_date < %s::date",
        (start_date, end_date),
    )
    mappings_total = _safe_count("douano_product_mapping")
    ignored_total = _safe_count("douano_product_ignore")

    mapped_missing_internal = _safe_rows(
        """
        SELECT m.douano_product_id, m.sku_id, COALESCE(p.name, p.sku, '') AS douano_name
        FROM douano_product_mapping m
        LEFT JOIN douano_products p ON p.product_id = m.douano_product_id
        LEFT JOIN skus s ON s.id = m.sku_id
        WHERE s.id IS NULL
        ORDER BY m.douano_product_id
        LIMIT %s
        """,
        (100,),
    )
    mapped_missing_cost = _safe_rows(
        """
        SELECT m.douano_product_id, m.sku_id, COALESCE(p.name, p.sku, '') AS douano_name
        FROM douano_product_mapping m
        LEFT JOIN douano_products p ON p.product_id = m.douano_product_id
        LEFT JOIN skus s ON s.id = m.sku_id
        LEFT JOIN (
            SELECT sku_id
            FROM kostprijs_sku_activations
            WHERE jaar = %s AND COALESCE(effectief_tot::text, '') = ''
            GROUP BY sku_id
        ) a ON a.sku_id = m.sku_id
        WHERE s.id IS NOT NULL AND a.sku_id IS NULL
        ORDER BY m.douano_product_id
        LIMIT %s
        """,
        (int(year), 100),
    )
    if not mapped_missing_cost:
        mapped_sku_rows = _safe_rows(
            """
            SELECT m.douano_product_id, m.sku_id, COALESCE(p.name, p.sku, '') AS douano_name
            FROM douano_product_mapping m
            LEFT JOIN douano_products p ON p.product_id = m.douano_product_id
            ORDER BY m.douano_product_id
            LIMIT %s
            """,
            (10000,),
            limit=500,
        )
        mapped_missing_cost = [
            row for row in mapped_sku_rows if str(row.get("sku_id") or "").strip() not in active_sku_ids
        ][:100]

    sales_lot_total = _safe_count("sales_lot_allocations")
    sales_lot_required_where = """
        a.movement_date >= %s::date
        AND a.movement_date < %s::date
        AND LOWER(COALESCE(s.kind, '')) = 'beer_format'
    """
    sales_lot_required_from = """
        sales_lot_allocations a
        LEFT JOIN douano_products p ON LOWER(p.sku) = LOWER(a.sku_code)
        LEFT JOIN douano_product_mapping m ON m.douano_product_id = p.product_id
        LEFT JOIN skus s ON s.id = m.sku_id
    """
    sales_lot_required_total = _safe_scalar(
        f"SELECT COUNT(*) FROM {sales_lot_required_from} WHERE {sales_lot_required_where}",
        (start_date, end_date),
    )
    sales_lot_required_with_lot = _safe_scalar(
        f"""
        SELECT COUNT(*)
        FROM {sales_lot_required_from}
        WHERE {sales_lot_required_where}
          AND COALESCE(NULLIF(a.lot_number, ''), '') <> ''
        """,
        (start_date, end_date),
    )
    sales_lot_required_without_lot = max(0, sales_lot_required_total - sales_lot_required_with_lot)
    lot_cost_total = _safe_count("lot_cost_records")

    lot_missing_cost = _safe_rows(
        f"""
        SELECT a.sku_code, a.lot_number, COUNT(*) AS regels
        FROM {sales_lot_required_from}
        LEFT JOIN lot_alias_mappings alias
          ON LOWER(alias.douano_lot_number) = LOWER(a.lot_number)
         AND (
            (COALESCE(alias.sku_id, '') <> '' AND alias.sku_id = s.id)
            OR (COALESCE(alias.sku_code, '') <> '' AND LOWER(alias.sku_code) = LOWER(a.sku_code))
            OR (COALESCE(alias.sku_id, '') = '' AND COALESCE(alias.sku_code, '') = '')
         )
        LEFT JOIN lot_cost_records c
          ON LOWER(c.lot_number) = LOWER(COALESCE(NULLIF(alias.internal_lot_number, ''), a.lot_number))
         AND (c.sku_code = '' OR c.sku_code = a.sku_code OR c.sku_id = s.id)
        WHERE {sales_lot_required_where}
          AND COALESCE(NULLIF(a.lot_number, ''), '') <> ''
          AND c.id IS NULL
        GROUP BY a.sku_code, a.lot_number
        ORDER BY regels DESC, a.sku_code, a.lot_number
        LIMIT %s
        """,
        (start_date, end_date, 100),
    )
    lot_pairs_total = _safe_scalar(
        f"""
        SELECT COUNT(*)
        FROM (
            SELECT DISTINCT sku_code, lot_number
            FROM {sales_lot_required_from}
            WHERE {sales_lot_required_where}
              AND COALESCE(NULLIF(a.lot_number, ''), '') <> ''
        ) pairs
        """,
        (start_date, end_date),
    )
    lot_missing_cost_total = _safe_scalar(
        f"""
        SELECT COUNT(*)
        FROM (
            SELECT DISTINCT a.sku_code, a.lot_number
            FROM {sales_lot_required_from}
            LEFT JOIN lot_alias_mappings alias
              ON LOWER(alias.douano_lot_number) = LOWER(a.lot_number)
             AND (
                (COALESCE(alias.sku_id, '') <> '' AND alias.sku_id = s.id)
                OR (COALESCE(alias.sku_code, '') <> '' AND LOWER(alias.sku_code) = LOWER(a.sku_code))
                OR (COALESCE(alias.sku_id, '') = '' AND COALESCE(alias.sku_code, '') = '')
             )
            LEFT JOIN lot_cost_records c
              ON LOWER(c.lot_number) = LOWER(COALESCE(NULLIF(alias.internal_lot_number, ''), a.lot_number))
             AND (c.sku_code = '' OR c.sku_code = a.sku_code OR c.sku_id = s.id)
            WHERE {sales_lot_required_where}
              AND COALESCE(NULLIF(a.lot_number, ''), '') <> ''
              AND c.id IS NULL
        ) missing
        """,
        (start_date, end_date),
    )
    lot_pairs_with_cost = max(0, lot_pairs_total - lot_missing_cost_total)
    lot_reconciliation_rows = lot_costs_storage.list_lot_reconciliation(year=int(year), limit=5000)
    if lot_reconciliation_rows:
        lot_pairs_total = len(lot_reconciliation_rows)
        lot_missing_reconciliation = [
            row
            for row in lot_reconciliation_rows
            if str(row.get("status", "") or "") not in {"direct", "mapped"}
        ]
        lot_missing_cost_total = len(lot_missing_reconciliation)
        lot_pairs_with_cost = max(0, lot_pairs_total - lot_missing_cost_total)
        lot_missing_cost = [
            {
                "sku_code": row.get("sku_code", ""),
                "lot_number": row.get("douano_lot_number", ""),
                "interne_lot": row.get("internal_lot_number", "") or row.get("suggested_internal_lot_number", ""),
                "status": row.get("status", ""),
                "regels": row.get("rows", 0),
            }
            for row in lot_missing_reconciliation[:100]
        ]

    douano_margin_snapshot_storage.ensure_schema()
    snapshot_bad_statuses = (
        "unmapped_sku",
        "missing_cost",
        "missing_lot_cost",
        "lot_near_match_fallback",
        "lot_unmatched_fallback",
    )
    snapshot_total = _safe_scalar(
        """
        SELECT COUNT(*)
        FROM douano_sales_line_cost_snapshots
        WHERE line_date >= %s::date
          AND line_date < %s::date
          AND NOT ignored
        """,
        (start_date, end_date),
    )
    snapshot_missing_rows = _safe_rows(
        """
        SELECT
            source_type,
            source_line_id,
            line_date,
            COALESCE(payload->>'transaction_number', '') AS transaction_number,
            COALESCE(payload->>'douano_product_name', '') AS product_name,
            douano_product_id,
            douano_sku AS sku_code,
            sku_id,
            lot_number,
            lot_internal_number AS interne_lot,
            cost_status,
            cost_source,
            CASE
                WHEN NOT mapped OR cost_status = 'unmapped_sku' THEN 'Productkoppeling ontbreekt'
                WHEN cost_status IN ('lot_near_match_fallback', 'lot_unmatched_fallback') THEN 'LOT alias nodig'
                WHEN missing_cost OR cost_price_ex IS NULL OR cost_status IN ('missing_cost', 'missing_lot_cost') THEN 'Kostprijsbron ontbreekt'
                ELSE 'Controle nodig'
            END AS oorzaak
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
        LIMIT %s
        """,
        (start_date, end_date, list(snapshot_bad_statuses), 100),
    )
    snapshot_missing_total = _safe_scalar(
        """
        SELECT COUNT(*)
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
        """,
        (start_date, end_date, list(snapshot_bad_statuses)),
    )
    snapshot_with_cost_source = max(0, snapshot_total - snapshot_missing_total)
    snapshot_sku_total = _safe_scalar(
        """
        SELECT COUNT(*)
        FROM douano_sales_line_cost_snapshots
        WHERE line_date >= %s::date
          AND line_date < %s::date
          AND NOT ignored
          AND COALESCE(NULLIF(sku_id, ''), '') <> ''
        """,
        (start_date, end_date),
    )
    snapshot_sku_missing_total = _safe_scalar(
        """
        SELECT COUNT(*)
        FROM douano_sales_line_cost_snapshots
        WHERE line_date >= %s::date
          AND line_date < %s::date
          AND NOT ignored
          AND COALESCE(NULLIF(sku_id, ''), '') <> ''
          AND (
              missing_cost
              OR cost_price_ex IS NULL
              OR cost_status = ANY(%s::text[])
          )
        """,
        (start_date, end_date, list(snapshot_bad_statuses)),
    )
    snapshot_sku_with_cost_source = max(0, snapshot_sku_total - snapshot_sku_missing_total)
    snapshot_non_sku_total = _safe_scalar(
        """
        SELECT COUNT(*)
        FROM douano_sales_line_cost_snapshots
        WHERE line_date >= %s::date
          AND line_date < %s::date
          AND NOT ignored
          AND COALESCE(NULLIF(sku_id, ''), '') = ''
        """,
        (start_date, end_date),
    )
    snapshot_non_sku_categorized = _safe_scalar(
        """
        SELECT COUNT(*)
        FROM douano_sales_line_cost_snapshots
        WHERE line_date >= %s::date
          AND line_date < %s::date
          AND NOT ignored
          AND COALESCE(NULLIF(sku_id, ''), '') = ''
          AND cost_status = 'no_cost_required'
        """,
        (start_date, end_date),
    )

    sold_products_total = _safe_scalar(
        """
        SELECT COUNT(*)
        FROM (
            SELECT DISTINCT douano_product_id
            FROM douano_sales_invoice_lines
            WHERE invoice_date >= %s::date
              AND invoice_date < %s::date
              AND douano_product_id > 0
        ) sold
        """,
        (start_date, end_date),
    )
    sold_products_mapped = _safe_scalar(
        """
        SELECT COUNT(*)
        FROM (
            SELECT DISTINCT l.douano_product_id
            FROM douano_sales_invoice_lines l
            JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
            WHERE l.invoice_date >= %s::date
              AND l.invoice_date < %s::date
              AND l.douano_product_id > 0
        ) mapped
        """,
        (start_date, end_date),
    )
    sold_products_missing_mapping = _safe_rows(
        """
        SELECT
            l.douano_product_id,
            COALESCE(p.sku, '') AS sku,
            COALESCE(p.name, l.line_product_name, '') AS douano_name,
            COUNT(*) AS regels
        FROM douano_sales_invoice_lines l
        LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
        LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
        WHERE l.invoice_date >= %s::date
          AND l.invoice_date < %s::date
          AND l.douano_product_id > 0
          AND m.douano_product_id IS NULL
        GROUP BY l.douano_product_id, p.sku, p.name, l.line_product_name
        ORDER BY regels DESC, p.sku, l.douano_product_id
        LIMIT %s
        """,
        (start_date, end_date, 100),
    )

    sold_skus_total = _safe_scalar(
        """
        SELECT COUNT(*)
        FROM (
            SELECT DISTINCT m.sku_id
            FROM douano_sales_invoice_lines l
            JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
            JOIN skus s ON s.id = m.sku_id
            WHERE l.invoice_date >= %s::date
              AND l.invoice_date < %s::date
              AND l.douano_product_id > 0
              AND COALESCE(m.sku_id, '') <> ''
        ) sold_skus
        """,
        (start_date, end_date),
    )
    sold_skus_missing_cost = _safe_rows(
        """
        SELECT
            m.sku_id,
            COALESCE(s.name, a.name, p.name, l.line_product_name, '') AS product_name,
            COALESCE(p.sku, '') AS douano_sku,
            COUNT(*) AS regels
        FROM douano_sales_invoice_lines l
        JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
        JOIN skus s ON s.id = m.sku_id
        LEFT JOIN articles a ON a.id = COALESCE(NULLIF(s.article_id, ''), NULLIF(s.format_article_id, ''))
        LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
        LEFT JOIN (
            SELECT sku_id
            FROM kostprijs_sku_activations
            WHERE jaar = %s AND COALESCE(effectief_tot::text, '') = ''
            GROUP BY sku_id
        ) act ON act.sku_id = m.sku_id
        WHERE l.invoice_date >= %s::date
          AND l.invoice_date < %s::date
          AND l.douano_product_id > 0
          AND act.sku_id IS NULL
        GROUP BY m.sku_id, s.name, a.name, p.name, p.sku, l.line_product_name
        ORDER BY regels DESC, product_name, m.sku_id
        LIMIT %s
        """,
        (int(year), start_date, end_date, 100),
    )
    sold_skus_with_cost = max(0, sold_skus_total - len(sold_skus_missing_cost))

    fixed_cost_rows = _dataset_year_rows("vaste-kosten", year)
    fixed_cost_total = sum(float(row.get("bedrag_per_jaar") or 0) for row in fixed_cost_rows)
    tariffs_rows = _dataset_year_rows("tarieven-heffingen", year)
    tariffs_complete = any(
        float(row.get("tarief_hoog") or 0) > 0
        or float(row.get("tarief_laag") or 0) > 0
        or float(row.get("verbruikersbelasting") or 0) > 0
        for row in tariffs_rows
    )

    checks = [
        _check(
            check_id="product_families",
            label="Stijlen/productfamilies ingericht",
            done=style_count > 0,
            current=style_count,
            total=max(1, style_count),
            group="setup",
            description="Een stijl bestaat voor de eerste kostprijs, zodat de wizard een SKU ergens aan kan koppelen.",
            href="/producten-verpakking",
        ),
        _check(
            check_id="douano_products",
            label="Douano producten gesynchroniseerd",
            done=_sync_ok("products") and douano_products_total > 0,
            current=douano_products_total,
            total=max(1, douano_products_total),
            group="readiness",
            description="Catalogus/SKU-bron uit Douano is opgehaald.",
            href="/beheer/api",
        ),
        _check(
            check_id="sales_invoices",
            label=f"Facturen gesynchroniseerd ({year})",
            done=_sync_ok("sales_invoices") and sales_invoice_lines_year > 0,
            current=sales_invoice_lines_year,
            total=max(1, sales_invoice_lines_year),
            missing=[] if sales_invoice_lines_year else [{"actie": "Synchroniseer sales invoices in Beheer > API-integratie."}],
            group="readiness",
            description="Omzet en marge rekenen op factuurregels uit Douano.",
            href="/beheer/api",
        ),
        _check(
            check_id="stock_history_sync",
            label="Stock-history LOTs gesynchroniseerd",
            done=_sync_ok("stock_history_lots") and sales_lot_total > 0,
            current=sales_lot_total,
            total=max(1, sales_lot_total),
            missing=[] if sales_lot_total else [{"actie": "Synchroniseer stock-history LOTs of verrijk ontbrekende LOTs via Excel."}],
            group="readiness",
            description="LOT-koppeling komt primair uit de Douano stock-history endpoint.",
            href="/beheer/api",
        ),
        _check(
            check_id="internal_skus",
            label="Interne SKU's aangemaakt",
            done=len(internal_sku_ids) > 0,
            current=len(internal_sku_ids),
            total=max(1, sold_products_total or douano_products_total or len(internal_sku_ids)),
            group="setup",
            description="Interne verkoopbare SKU's worden via kostprijswizard of nieuw samenstellen gemaakt.",
            href="/nieuwe-kostprijsberekening",
        ),
        _check(
            check_id="product_mappings",
            label=f"Verkochte Douano producten gekoppeld ({year})",
            done=sold_products_total > 0 and sold_products_mapped >= sold_products_total and not mapped_missing_internal,
            current=sold_products_mapped,
            total=sold_products_total,
            missing=[*sold_products_missing_mapping, *mapped_missing_internal],
            group="readiness",
            description="Alle verkochte Douano producten moeten naar een interne SKU wijzen voor marge/break-even.",
            href="/beheer/productkoppelingen",
        ),
        _check(
            check_id="fixed_costs",
            label=f"Vaste kosten compleet ({year})",
            done=bool(fixed_cost_rows) and fixed_cost_total > 0,
            current=len(fixed_cost_rows),
            total=max(1, len(fixed_cost_rows)),
            missing=[] if fixed_cost_rows and fixed_cost_total > 0 else [{"actie": "Vul vaste kosten voor dit jaar in."}],
            group="readiness",
            description="Break-even gebruikt vaste kosten als basisdrempel.",
            href="/vaste-kosten",
        ),
        _check(
            check_id="tariffs",
            label=f"Tarieven en heffingen compleet ({year})",
            done=tariffs_complete,
            current=len(tariffs_rows) if tariffs_complete else 0,
            total=max(1, len(tariffs_rows) or 1),
            missing=[] if tariffs_complete else [{"actie": "Vul accijns/verbruikersbelasting voor dit jaar in."}],
            group="readiness",
            description="Accijns blijft SKU/jaar-parameter en hoort voor activeren compleet te zijn.",
            href="/tarieven-heffingen",
        ),
        _check(
            check_id="active_costprices",
            label=f"Actieve kostprijzen bestaan ({year})",
            done=mappings_total > 0 and not mapped_missing_cost,
            current=max(0, mappings_total - len(mapped_missing_cost)),
            total=mappings_total,
            missing=mapped_missing_cost,
            group="setup",
            description="Sellable SKU's tellen pas mee als er een actieve kostprijs voor het jaar is.",
            href="/instellingen/kostprijsbeheer",
        ),
        _check(
            check_id="sold_skus_active_costs",
            label=f"Verkochte SKU's hebben actieve kostprijs ({year})",
            done=sold_skus_total > 0 and not sold_skus_missing_cost,
            current=sold_skus_with_cost,
            total=sold_skus_total,
            missing=sold_skus_missing_cost,
            group="readiness",
            description="Deze kaart kijkt alleen naar SKU's die echt in Omzet & Marge voorkomen. Giftsets tellen mee via hun actieve giftset-kostprijs.",
            href="/omzet-en-marge",
        ),
        _check(
            check_id="stock_history_lots",
            label="LOT-plichtige verkoopregels hebben LOT",
            done=sales_lot_required_total > 0 and sales_lot_required_without_lot == 0,
            current=sales_lot_required_with_lot,
            total=sales_lot_required_total,
            missing=_safe_rows(
                f"""
                SELECT a.transaction_number, a.sku_code, a.product_name, a.quantity
                FROM {sales_lot_required_from}
                WHERE {sales_lot_required_where}
                  AND COALESCE(NULLIF(a.lot_number, ''), '') = ''
                ORDER BY movement_date DESC NULLS LAST, transaction_number
                LIMIT %s
                """,
                (start_date, end_date, 100),
            ),
            group="readiness",
            description="Alleen bier-SKU's zijn LOT-plichtig. Geschenkverpakkingen gebruiken de actieve samengestelde SKU-kostprijs.",
            href="/beheer/api",
        ),
        _check(
            check_id="sales_rows_cost_source",
            label="Verkoopregels zijn verwerkt",
            done=snapshot_total > 0 and snapshot_missing_total == 0,
            current=snapshot_with_cost_source,
            total=snapshot_total,
            missing=snapshot_missing_rows,
            group="readiness",
            description="Iedere verkoopregel moet verklaarbaar zijn: SKU's met kostprijsbron, of niet-SKU regels expliciet gecategoriseerd.",
            href="/omzet-en-marge",
        ),
    ]

    quality_gate_ids = {
        "douano_products",
        "sales_invoices",
        "stock_history_sync",
        "product_mappings",
        "stock_history_lots",
        "sales_rows_cost_source",
    }
    can_complete = all(bool(check.get("done")) for check in checks if str(check.get("id", "")) in quality_gate_ids)
    return {
        "year": int(year),
        "can_complete": can_complete,
        "mode": "ready" if can_complete else "setup_required",
        "summary": {
            "douano_products": douano_products_total,
            "sales_invoices": sales_invoices_year,
            "sales_invoice_lines": sales_invoice_lines_year,
            "internal_skus": len(internal_sku_ids),
            "product_families": style_count,
            "product_mappings": mappings_total,
            "ignored_products": ignored_total,
            "sold_products": sold_products_total,
            "sold_products_mapped": sold_products_mapped,
            "active_cost_skus": len(active_sku_ids),
            "sales_lot_rows": sales_lot_total,
            "sales_lot_without_lot": sales_lot_required_without_lot,
            "sales_lot_required_rows": sales_lot_required_total,
            "lot_cost_records": lot_cost_total,
            "lot_pairs": lot_pairs_total,
            "lot_pairs_missing_cost": lot_missing_cost_total,
            "sales_rows_with_cost_source": snapshot_with_cost_source,
            "sales_rows_cost_source_total": snapshot_total,
            "sales_rows_missing_cost_source": snapshot_missing_total,
            "sales_rows_sku_with_cost_source": snapshot_sku_with_cost_source,
            "sales_rows_sku_total": snapshot_sku_total,
            "sales_rows_non_sku_categorized": snapshot_non_sku_categorized,
            "sales_rows_non_sku_total": snapshot_non_sku_total,
            "sales_rows_processed": snapshot_with_cost_source,
            "sales_rows_total": snapshot_total,
            "sold_skus": sold_skus_total,
            "sold_skus_missing_cost": len(sold_skus_missing_cost),
            "fixed_cost_lines": len(fixed_cost_rows),
            "fixed_cost_total": fixed_cost_total,
            "tariff_years": len(tariffs_rows),
            "production_years": _known_production_years(),
        },
        "checks": checks,
    }

    skus = postgres_storage.load_dataset("skus", [])
    skus = skus if isinstance(skus, list) else []
    internal_sku_ids = {
        str(row.get("id") or "").strip()
        for row in skus
        if isinstance(row, dict) and str(row.get("id") or "").strip()
    }
    active_sku_ids = _active_activation_sku_ids(year)

    douano_products_total = _safe_count("douano_products")
    mappings_total = _safe_count("douano_product_mapping")
    ignored_total = _safe_count("douano_product_ignore")
    mapped_or_ignored = min(douano_products_total, mappings_total + ignored_total)

    mapped_missing_internal = _safe_rows(
        """
        SELECT m.douano_product_id, m.sku_id, COALESCE(p.name, p.sku, '') AS douano_name
        FROM douano_product_mapping m
        LEFT JOIN douano_products p ON p.product_id = m.douano_product_id
        LEFT JOIN skus s ON s.id = m.sku_id
        WHERE s.id IS NULL
        ORDER BY m.douano_product_id
        LIMIT %s
        """,
        (100,),
    )

    mapped_missing_cost = _safe_rows(
        """
        SELECT m.douano_product_id, m.sku_id, COALESCE(p.name, p.sku, '') AS douano_name
        FROM douano_product_mapping m
        LEFT JOIN douano_products p ON p.product_id = m.douano_product_id
        LEFT JOIN skus s ON s.id = m.sku_id
        LEFT JOIN (
            SELECT sku_id
            FROM kostprijs_sku_activations
            WHERE jaar = %s AND COALESCE(effectief_tot::text, '') = ''
            GROUP BY sku_id
        ) a ON a.sku_id = m.sku_id
        WHERE s.id IS NOT NULL AND a.sku_id IS NULL
        ORDER BY m.douano_product_id
        LIMIT %s
        """,
        (int(year), 100),
    )
    if not mapped_missing_cost:
        # Dataset fallback for installations still using dataset activations.
        mapped_sku_rows = _safe_rows(
            """
            SELECT m.douano_product_id, m.sku_id, COALESCE(p.name, p.sku, '') AS douano_name
            FROM douano_product_mapping m
            LEFT JOIN douano_products p ON p.product_id = m.douano_product_id
            ORDER BY m.douano_product_id
            LIMIT %s
            """,
            (10000,),
            limit=500,
        )
        mapped_missing_cost = [
            row for row in mapped_sku_rows if str(row.get("sku_id") or "").strip() not in active_sku_ids
        ][:100]

    sales_lot_total = _safe_count("sales_lot_allocations")
    sales_lot_with_lot = _safe_count("sales_lot_allocations", "COALESCE(NULLIF(lot_number, ''), '') <> ''")
    sales_lot_without_lot = max(0, sales_lot_total - sales_lot_with_lot)
    lot_cost_total = _safe_count("lot_cost_records")

    lot_missing_cost = _safe_rows(
        """
        SELECT a.sku_code, a.lot_number, COUNT(*) AS regels
        FROM sales_lot_allocations a
        LEFT JOIN lot_cost_records c
          ON LOWER(c.lot_number) = LOWER(a.lot_number)
         AND (c.sku_code = '' OR c.sku_code = a.sku_code)
        WHERE COALESCE(NULLIF(a.lot_number, ''), '') <> ''
          AND c.id IS NULL
        GROUP BY a.sku_code, a.lot_number
        ORDER BY regels DESC, a.sku_code, a.lot_number
        LIMIT %s
        """,
        (100,),
    )
    lot_pairs_total = _safe_scalar(
        """
        SELECT COUNT(*)
        FROM (
            SELECT DISTINCT sku_code, lot_number
            FROM sales_lot_allocations
            WHERE COALESCE(NULLIF(lot_number, ''), '') <> ''
        ) pairs
        """
    )
    lot_pairs_with_cost = max(0, lot_pairs_total - len(lot_missing_cost))

    unmapped_products = _safe_rows(
        """
        SELECT p.product_id AS douano_product_id, COALESCE(p.name, p.sku, '') AS douano_name, p.sku
        FROM douano_products p
        LEFT JOIN douano_product_mapping m ON m.douano_product_id = p.product_id
        LEFT JOIN douano_product_ignore i ON i.douano_product_id = p.product_id
        WHERE m.douano_product_id IS NULL AND i.douano_product_id IS NULL
        ORDER BY p.sku, p.product_id
        LIMIT %s
        """,
        (100,),
    )

    checks = [
        {
            "id": "douano_products",
            "label": "Douano producten geïmporteerd",
            "done": douano_products_total > 0,
            "current": douano_products_total,
            "total": max(1, douano_products_total),
            "missing": [],
        },
        {
            "id": "internal_skus",
            "label": "Interne SKU's aangemaakt",
            "done": len(internal_sku_ids) > 0,
            "current": len(internal_sku_ids),
            "total": max(1, douano_products_total or len(internal_sku_ids)),
            "missing": [],
        },
        {
            "id": "product_mappings",
            "label": "Douano producten gekoppeld of genegeerd",
            "done": douano_products_total > 0 and mapped_or_ignored >= douano_products_total and not mapped_missing_internal,
            "current": mapped_or_ignored,
            "total": douano_products_total,
            "missing": [*unmapped_products, *mapped_missing_internal],
        },
        {
            "id": "active_costprices",
            "label": f"Actieve baseline kostprijzen ({year})",
            "done": mappings_total > 0 and not mapped_missing_cost,
            "current": max(0, mappings_total - len(mapped_missing_cost)),
            "total": mappings_total,
            "missing": mapped_missing_cost,
        },
        {
            "id": "stock_history_lots",
            "label": "Verkoopregels met LOT",
            "done": sales_lot_total > 0 and sales_lot_without_lot == 0,
            "current": sales_lot_with_lot,
            "total": sales_lot_total,
            "missing": _safe_rows(
                """
                SELECT transaction_number, sku_code, product_name, quantity
                FROM sales_lot_allocations
                WHERE COALESCE(NULLIF(lot_number, ''), '') = ''
                ORDER BY movement_date DESC NULLS LAST, transaction_number
                LIMIT %s
                """,
                (100,),
            ),
        },
        {
            "id": "lot_costs",
            "label": "SKU + LOT heeft directe kostprijs",
            "done": lot_pairs_total > 0 and not lot_missing_cost,
            "current": lot_pairs_with_cost,
            "total": lot_pairs_total,
            "missing": lot_missing_cost,
        },
    ]

    can_complete = all(bool(check.get("done")) for check in checks)
    return {
        "year": int(year),
        "can_complete": can_complete,
        "mode": "ready" if can_complete else "setup_required",
        "summary": {
            "douano_products": douano_products_total,
            "internal_skus": len(internal_sku_ids),
            "product_mappings": mappings_total,
            "ignored_products": ignored_total,
            "active_cost_skus": len(active_sku_ids),
            "sales_lot_rows": sales_lot_total,
            "lot_cost_records": lot_cost_total,
        },
        "checks": checks,
    }


def reset_setup_rebuildable_data(*, dry_run: bool = True) -> dict[str, Any]:
    lot_costs_storage.ensure_schema()
    report: dict[str, Any] = {"dry_run": bool(dry_run), "deleted": {}}

    skus = postgres_storage.load_dataset("skus", [])
    skus = skus if isinstance(skus, list) else []
    articles = postgres_storage.load_dataset("articles", [])
    articles = articles if isinstance(articles, list) else []
    bom_lines = postgres_storage.load_dataset("bom-lines", [])
    bom_lines = bom_lines if isinstance(bom_lines, list) else []
    bieren = dataset_store.load_dataset("bieren")
    bieren_count = len([row for row in bieren if isinstance(row, dict)]) if isinstance(bieren, list) else 0

    deleted_article_ids = {
        article_id
        for row in skus
        if isinstance(row, dict)
        for article_id in {
            str(row.get("article_id") or "").strip(),
            str(row.get("format_article_id") or "").strip(),
        }
        if article_id
    }
    deleted_sku_ids = {
        str(row.get("id") or "").strip()
        for row in skus
        if isinstance(row, dict) and str(row.get("id") or "").strip()
    }
    keep_articles = [
        row
        for row in articles
        if not (
            isinstance(row, dict)
            and (
                str(row.get("id") or "").strip() in deleted_article_ids
                or str(row.get("kind") or "").strip().lower() in {"bundle", "sellable", "product", "format"}
            )
        )
    ]
    keep_bom = [
        row
        for row in bom_lines
        if not (
            isinstance(row, dict)
            and (
                str(row.get("parent_article_id") or "").strip() in deleted_article_ids
                or str(row.get("component_sku_id") or "").strip() in deleted_sku_ids
            )
        )
    ]

    report["deleted"]["skus"] = len(skus)
    report["deleted"]["articles"] = len(articles) - len(keep_articles)
    report["deleted"]["bom-lines"] = len(bom_lines) - len(keep_bom)
    report["deleted"]["bieren"] = bieren_count

    if dry_run:
        report["deleted"]["product_families"] = _safe_count("product_families")
        report["deleted"]["douano_product_mapping"] = _safe_count("douano_product_mapping")
        report["deleted"]["douano_product_ignore"] = _safe_count("douano_product_ignore")
        report["deleted"]["costprice_versions"] = _safe_count("cost_versions") + len(dataset_store.load_dataset("kostprijsversies") or [])
        report["deleted"]["stock_history_excel_rows"] = _safe_count("sales_lot_allocations", "import_batch_id <> 'douano_stock_history'")
        report["deleted"]["opening_lot_records"] = _safe_count("lot_cost_records", "source_type IN ('opening_lot', 'excel', 'excel_import')")
        return report

    with postgres_storage.connect() as conn:
        try:
            with conn.cursor() as cur:
                def delete_table(table: str, where: str = "", params: tuple[Any, ...] = ()) -> int:
                    cur.execute("SELECT to_regclass(%s)", (table,))
                    if not (cur.fetchone() or [None])[0]:
                        return 0
                    sql = f"DELETE FROM {table}"
                    if where:
                        sql += f" WHERE {where}"
                    cur.execute(sql, params)
                    return int(cur.rowcount or 0)

                # FK-safe order: delete every known dependent row before SKUs/articles.
                report["deleted"]["kostprijs_sku_activation_events"] = delete_table("kostprijs_sku_activation_events")
                report["deleted"]["kostprijs_sku_activations"] = delete_table("kostprijs_sku_activations")
                report["deleted"]["cost_version_sku_rows"] = delete_table("cost_version_sku_rows")
                report["deleted"]["cost_versions"] = delete_table("cost_versions")
                report["deleted"]["sales_pricing_records"] = delete_table("sales_pricing_records")
                report["deleted"]["sku_family_links"] = delete_table("sku_family_links")
                report["deleted"]["sku_composition_lines"] = delete_table("sku_composition_lines")
                report["deleted"]["product_families"] = delete_table("product_families")
                report["deleted"]["douano_product_mapping"] = delete_table("douano_product_mapping")
                report["deleted"]["douano_product_ignore"] = delete_table("douano_product_ignore")
                report["deleted"]["break_even_plan_snapshots"] = delete_table("break_even_plan_snapshots")
                report["deleted"]["break_even_reforecast_snapshots"] = delete_table("break_even_reforecast_snapshots")
                report["deleted"]["year_close_snapshots"] = delete_table("year_close_snapshots")
                report["deleted"]["stock_history_excel_rows"] = delete_table(
                    "sales_lot_allocations",
                    "import_batch_id <> 'douano_stock_history' OR payload->>'lot_source' = 'excel_enrichment'",
                )
                report["deleted"]["opening_lot_records"] = delete_table(
                    "lot_cost_records",
                    "source_type IN ('opening_lot', 'excel', 'excel_import') OR source_ref ILIKE '%%Opening LOT%%'",
                )
                report["deleted"]["purchase_lot_sku_costs"] = delete_table("purchase_lot_sku_costs")
                report["deleted"]["purchase_lots"] = delete_table("purchase_lots")
                report["deleted"]["bom-lines"] = delete_table("bom_lines")
                report["deleted"]["skus"] = delete_table("skus")
                report["deleted"]["articles"] = delete_table("articles")
                cur.execute(
                    """
                    DELETE FROM app_datasets
                    WHERE dataset_name IN (
                        'sku-style-links',
                        'bieren',
                        'kostprijsproductactiveringen',
                        'kostprijsversies',
                        'berekeningen',
                        'verkoopprijzen'
                    )
                    """
                )
                report["deleted"]["app_dataset_rows"] = int(cur.rowcount or 0)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    report["remaining"] = _reset_remaining_counts()
    return report
