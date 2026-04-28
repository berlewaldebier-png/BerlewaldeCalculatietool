from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable

from app.domain import (
    dataset_store,
    douano_product_ignore_storage,
    douano_product_mapping_storage,
    douano_margin_snapshot_storage,
    postgres_storage,
)


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except Exception:
        return None


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _snapshot_row_cost(row: dict[str, Any]) -> float:
    explicit = _num(row.get("kostprijs"))
    if explicit > 0:
        return explicit
    primaire = _num(row.get("primaire_kosten") or row.get("variabele_kosten"))
    verpakking = _num(row.get("verpakkingskosten"))
    vaste = _num(row.get("vaste_kosten") or row.get("vaste_directe_kosten"))
    accijns = _num(row.get("accijns"))
    return primaire + verpakking + vaste + accijns


@dataclass(frozen=True)
class _ActivationKey:
    bier_id: str
    product_id: str
    year: int


def _build_activation_index(activations: list[dict[str, Any]]) -> dict[_ActivationKey, list[dict[str, Any]]]:
    index: dict[_ActivationKey, list[dict[str, Any]]] = {}
    for row in activations:
        if not isinstance(row, dict):
            continue
        bier_id = str(row.get("bier_id", "") or "").strip()
        product_id = str(row.get("product_id", "") or "").strip()
        year = int(row.get("jaar", 0) or 0)
        if not bier_id or not product_id or year <= 0:
            continue
        key = _ActivationKey(bier_id=bier_id, product_id=product_id, year=year)
        index.setdefault(key, []).append(row)
    return index


def _pick_activation(rows: list[dict[str, Any]], as_of: date) -> dict[str, Any] | None:
    if not rows:
        return None
    best: dict[str, Any] | None = None
    best_from: date | None = None
    for row in rows:
        eff = _parse_date(row.get("effectief_vanaf")) or date.min
        if eff > as_of:
            continue
        if best is None or eff >= (best_from or date.min):
            best = row
            best_from = eff
    return best


def _build_snapshot_cost_index(
    versions_by_id: dict[str, dict[str, Any]],
    version_ids: Iterable[str],
) -> dict[tuple[str, str, str], float]:
    out: dict[tuple[str, str, str], float] = {}
    for version_id in set([str(v or "").strip() for v in version_ids if str(v or "").strip()]):
        version = versions_by_id.get(version_id)
        if not isinstance(version, dict):
            continue
        snapshot = version.get("resultaat_snapshot")
        if not isinstance(snapshot, dict):
            continue
        producten = snapshot.get("producten")
        if not isinstance(producten, dict):
            continue

        basis = producten.get("basisproducten", [])
        if isinstance(basis, list):
            for row in basis:
                if not isinstance(row, dict):
                    continue
                product_id = str(row.get("product_id", "") or "").strip()
                if not product_id:
                    continue
                out[(version_id, "basis", product_id)] = _snapshot_row_cost(row)

        sam = producten.get("samengestelde_producten", [])
        if isinstance(sam, list):
            for row in sam:
                if not isinstance(row, dict):
                    continue
                product_id = str(row.get("product_id", "") or "").strip()
                if not product_id:
                    continue
                out[(version_id, "samengesteld", product_id)] = _snapshot_row_cost(row)
    return out


def _resolve_cost_per_unit(
    *,
    bier_id: str,
    product_id: str,
    as_of: date,
    activations_index: dict[_ActivationKey, list[dict[str, Any]]],
    versions_by_id: dict[str, dict[str, Any]],
    snapshot_cost_index: dict[tuple[str, str, str], float],
) -> tuple[float | None, str, str]:
    """Return (cost_per_unit, kostprijsversie_id, product_type)."""
    year = int(as_of.year)
    key = _ActivationKey(bier_id=bier_id, product_id=product_id, year=year)
    activation = _pick_activation(activations_index.get(key, []), as_of)
    if not activation:
        return None, "", ""
    version_id = str(activation.get("kostprijsversie_id", "") or "").strip()
    if not version_id:
        return None, "", ""
    product_type = str(activation.get("product_type", "") or "").strip().lower()
    if product_type not in {"basis", "samengesteld"}:
        product_type = ""

    # Prefer activation product_type, but fall back to either list in snapshot if missing.
    if product_type:
        cost = snapshot_cost_index.get((version_id, product_type, product_id))
        if cost is None:
            return None, version_id, product_type
        return float(cost), version_id, product_type

    cost_basis = snapshot_cost_index.get((version_id, "basis", product_id))
    if cost_basis is not None:
        return float(cost_basis), version_id, "basis"
    cost_sam = snapshot_cost_index.get((version_id, "samengesteld", product_id))
    if cost_sam is not None:
        return float(cost_sam), version_id, "samengesteld"
    return None, version_id, ""


def get_company_margin_summary(*, since: str = "", limit: int = 500) -> list[dict[str, Any]]:
    """Compute company margin summary live by joining:
    douano_sales_order_lines -> douano_product_mapping -> (activations + definitive snapshots).
    """
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    postgres_storage.ensure_schema()

    since_text = (since or "").strip()
    lim = max(1, min(int(limit or 500), 5000))

    where = "WHERE l.order_date >= %s::date" if since_text else ""
    params: tuple[Any, ...] = (since_text, lim) if since_text else (lim,)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    l.company_id,
                    c.name,
                    c.public_name,
                    COUNT(*)::int AS lines,
                    COALESCE(SUM(l.gross_revenue_ex), 0) AS omzet_ex,
                    COALESCE(SUM(l.discount_ex), 0) AS korting_ex,
                    COALESCE(SUM(l.charges_total_ex), 0) AS charges_ex,
                    COALESCE(SUM(l.net_revenue_ex), 0) AS netto_omzet_ex,
                    COALESCE(SUM(l.quantity), 0) AS total_quantity,
                    COALESCE(SUM(CASE WHEN ig.douano_product_id IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS ignored_lines,
                    COALESCE(SUM(CASE WHEN ig.douano_product_id IS NULL AND m.douano_product_id IS NULL THEN 1 ELSE 0 END), 0)::int AS unmapped_lines
                FROM douano_sales_order_lines l
                LEFT JOIN douano_companies c ON c.company_id = l.company_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                {where}
                GROUP BY l.company_id, c.name, c.public_name
                ORDER BY netto_omzet_ex DESC
                LIMIT %s
                """,
                params,
            )
            rows = cur.fetchall() or []

    # Load datasets once.
    activations = dataset_store.load_dataset("kostprijsproductactiveringen")
    versions = dataset_store.load_dataset("kostprijsversies")
    activation_index = _build_activation_index(activations if isinstance(activations, list) else [])
    versions_by_id: dict[str, dict[str, Any]] = {
        str(v.get("id", "") or ""): v for v in (versions if isinstance(versions, list) else []) if isinstance(v, dict)
    }

    # Build snapshot index only for version_ids used in activations to keep it bounded.
    used_version_ids = [
        str(row.get("kostprijsversie_id", "") or "")
        for row in (activations if isinstance(activations, list) else [])
        if isinstance(row, dict)
    ]
    snapshot_cost_index = _build_snapshot_cost_index(versions_by_id, used_version_ids)

    # Compute cost totals per company by scanning mapped lines only.
    cost_by_company: dict[int, dict[str, Any]] = {}
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if since_text:
                cur.execute(
                    """
                    SELECT l.company_id, l.order_date, l.douano_product_id, l.quantity, l.net_revenue_ex, m.bier_id, m.product_id
                    FROM douano_sales_order_lines l
                    JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    WHERE l.order_date >= %s::date
                    """,
                    (since_text,),
                )
            else:
                cur.execute(
                    """
                    SELECT l.company_id, l.order_date, l.douano_product_id, l.quantity, l.net_revenue_ex, m.bier_id, m.product_id
                    FROM douano_sales_order_lines l
                    JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    """
                )
            mapped_rows = cur.fetchall() or []

    for company_id, order_date_raw, douano_product_id, quantity, net_revenue, bier_id, product_id in mapped_rows:
        company_id_int = int(company_id or 0)
        order_date = _parse_date(order_date_raw)
        if order_date is None:
            continue
        cost_unit, version_id, product_type = _resolve_cost_per_unit(
            bier_id=str(bier_id or ""),
            product_id=str(product_id or ""),
            as_of=order_date,
            activations_index=activation_index,
            versions_by_id=versions_by_id,
            snapshot_cost_index=snapshot_cost_index,
        )
        bucket = cost_by_company.setdefault(
            company_id_int,
            {"cost_total_ex": 0.0, "mapped_lines": 0, "missing_cost_lines": 0},
        )
        bucket["mapped_lines"] = int(bucket.get("mapped_lines", 0) or 0) + 1
        if cost_unit is None:
            bucket["missing_cost_lines"] = int(bucket.get("missing_cost_lines", 0) or 0) + 1
            continue
        bucket["cost_total_ex"] = float(bucket.get("cost_total_ex", 0.0) or 0.0) + _num(quantity) * float(cost_unit)

    out: list[dict[str, Any]] = []
    for company_id, name, public_name, lines, omzet, korting, charges, netto, total_quantity, ignored_lines, unmapped_lines in rows:
        cid = int(company_id or 0)
        cost_bucket = cost_by_company.get(cid, {"cost_total_ex": 0.0, "mapped_lines": 0, "missing_cost_lines": 0})
        cost_total = float(cost_bucket.get("cost_total_ex", 0.0) or 0.0)
        margin = float(netto or 0.0) - cost_total
        out.append(
            {
                "company_id": cid,
                "company_name": str(public_name or name or ""),
                "lines": int(lines or 0),
                "omzet_ex": float(omzet or 0.0),
                "korting_ex": float(korting or 0.0),
                "charges_ex": float(charges or 0.0),
                "netto_omzet_ex": float(netto or 0.0),
                "kostprijs_ex": cost_total,
                "brutomarge_ex": margin,
                "unmapped_lines": int(unmapped_lines or 0),
                "ignored_lines": int(ignored_lines or 0),
                "mapped_lines": int(cost_bucket.get("mapped_lines", 0) or 0),
                "missing_cost_lines": int(cost_bucket.get("missing_cost_lines", 0) or 0),
            }
        )
    return out


def list_company_unmapped_products(*, company_id: int, since: str = "", limit: int = 50) -> list[dict[str, Any]]:
    """Return unmapped products (excluding ignored) for a company, ranked by net revenue."""
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    postgres_storage.ensure_schema()
    cid = int(company_id or 0)
    if cid <= 0:
        return []
    lim = max(1, min(int(limit or 50), 1000))
    since_text = (since or "").strip()
    where_since = "AND l.order_date >= %s::date" if since_text else ""
    params: tuple[Any, ...] = (cid, since_text, lim) if since_text else (cid, lim)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    l.douano_product_id,
                    p.name,
                    p.sku,
                    p.gtin,
                    COUNT(*)::int AS lines,
                    COALESCE(SUM(l.quantity), 0) AS quantity,
                    COALESCE(SUM(l.net_revenue_ex), 0) AS net_revenue_ex
                FROM douano_sales_order_lines l
                LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                WHERE l.company_id = %s
                  AND ig.douano_product_id IS NULL
                  AND m.douano_product_id IS NULL
                  {where_since}
                GROUP BY l.douano_product_id, p.name, p.sku, p.gtin
                ORDER BY net_revenue_ex DESC
                LIMIT %s
                """,
                params,
            )
            rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for douano_product_id, name, sku, gtin, lines, quantity, net_revenue_ex in rows:
        out.append(
            {
                "douano_product_id": int(douano_product_id or 0),
                "name": str(name or ""),
                "sku": str(sku or ""),
                "gtin": str(gtin or ""),
                "lines": int(lines or 0),
                "quantity": float(quantity or 0),
                "net_revenue_ex": float(net_revenue_ex or 0),
            }
        )
    return out


def list_company_lines(
    *,
    company_id: int,
    since: str = "",
    only_unmapped: bool = False,
    only_missing_cost: bool = False,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """List order lines for a company with mapping + cost resolution."""
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    postgres_storage.ensure_schema()
    cid = int(company_id or 0)
    if cid <= 0:
        return []

    lim = max(1, min(int(limit or 500), 5000))
    since_text = (since or "").strip()

    clauses: list[str] = ["l.company_id = %s"]
    params: list[Any] = [cid]
    if since_text:
        clauses.append("l.order_date >= %s::date")
        params.append(since_text)

    if only_unmapped:
        clauses.append("ig.douano_product_id IS NULL AND m.douano_product_id IS NULL")
    if only_missing_cost:
        # We'll apply after resolving cost, but we can prefilter to mapped lines to reduce work.
        clauses.append("m.douano_product_id IS NOT NULL")

    where = " AND ".join(clauses)

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    l.line_id,
                    l.sales_order_id,
                    l.order_date,
                    l.douano_product_id,
                    p.name,
                    p.sku,
                    l.quantity,
                    l.unit_price_ex,
                    l.discount_ex,
                    l.charges_total_ex,
                    l.net_revenue_ex,
                    m.bier_id,
                    m.product_id,
                    ig.douano_product_id IS NOT NULL AS ignored
                FROM douano_sales_order_lines l
                LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                WHERE {where}
                ORDER BY l.order_date DESC, l.line_id DESC
                LIMIT %s
                """,
                (*params, lim),
            )
            rows = cur.fetchall() or []

    activations = dataset_store.load_dataset("kostprijsproductactiveringen")
    versions = dataset_store.load_dataset("kostprijsversies")
    activation_index = _build_activation_index(activations if isinstance(activations, list) else [])
    versions_by_id: dict[str, dict[str, Any]] = {
        str(v.get("id", "") or ""): v for v in (versions if isinstance(versions, list) else []) if isinstance(v, dict)
    }
    used_version_ids = [
        str(row.get("kostprijsversie_id", "") or "")
        for row in (activations if isinstance(activations, list) else [])
        if isinstance(row, dict)
    ]
    snapshot_cost_index = _build_snapshot_cost_index(versions_by_id, used_version_ids)

    out: list[dict[str, Any]] = []
    for (
        line_id,
        sales_order_id,
        order_date_raw,
        douano_product_id,
        product_name,
        sku,
        quantity,
        unit_price_ex,
        discount_ex,
        charges_total_ex,
        net_revenue_ex,
        bier_id,
        product_id,
        ignored,
    ) in rows:
        order_date = _parse_date(order_date_raw)
        bier_id_text = str(bier_id or "")
        product_id_text = str(product_id or "")
        cost_unit: float | None = None
        cost_total = 0.0
        margin = 0.0
        missing_cost = False
        kostprijsversie_id = ""
        if bier_id_text and product_id_text and order_date is not None:
            cost_unit, kostprijsversie_id, _ = _resolve_cost_per_unit(
                bier_id=bier_id_text,
                product_id=product_id_text,
                as_of=order_date,
                activations_index=activation_index,
                versions_by_id=versions_by_id,
                snapshot_cost_index=snapshot_cost_index,
            )
            if cost_unit is None:
                missing_cost = True
            else:
                cost_total = _num(quantity) * float(cost_unit)
                margin = float(net_revenue_ex or 0.0) - cost_total

        if only_missing_cost and not missing_cost:
            continue

        out.append(
            {
                "line_id": int(line_id or 0),
                "sales_order_id": int(sales_order_id or 0),
                "order_date": str(order_date_raw or ""),
                "douano_product_id": int(douano_product_id or 0),
                "douano_product_name": str(product_name or ""),
                "douano_sku": str(sku or ""),
                "quantity": float(quantity or 0),
                "unit_price_ex": float(unit_price_ex or 0),
                "discount_ex": float(discount_ex or 0),
                "charges_ex": float(charges_total_ex or 0),
                "net_revenue_ex": float(net_revenue_ex or 0),
                "bier_id": bier_id_text,
                "product_id": product_id_text,
                "ignored": bool(ignored),
                "cost_price_ex": float(cost_unit or 0) if cost_unit is not None else None,
                "cost_total_ex": float(cost_total),
                "margin_ex": float(margin),
                "missing_cost": bool(missing_cost),
                "mapped": bool(bier_id_text and product_id_text),
                "kostprijsversie_id": kostprijsversie_id,
            }
        )
    return out


def list_company_orders(
    *,
    company_id: int,
    since: str = "",
    limit: int = 200,
) -> list[dict[str, Any]]:
    """List sales orders for a company with totals + counts.

    Totals are based on douano_sales_order_lines (gross/net) and include mapping diagnostics.
    """
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    postgres_storage.ensure_schema()
    cid = int(company_id or 0)
    if cid <= 0:
        return []
    lim = max(1, min(int(limit or 200), 2000))
    since_text = (since or "").strip()
    where_since = "AND l.order_date >= %s::date" if since_text else ""
    params: tuple[Any, ...] = (cid, since_text, lim) if since_text else (cid, lim)

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    o.sales_order_id,
                    o.order_date,
                    o.transaction_number,
                    o.status,
                    COUNT(l.line_id)::int AS lines,
                    COALESCE(SUM(l.gross_revenue_ex), 0) AS omzet_ex,
                    COALESCE(SUM(l.discount_ex), 0) AS korting_ex,
                    COALESCE(SUM(l.charges_total_ex), 0) AS charges_ex,
                    COALESCE(SUM(l.net_revenue_ex), 0) AS netto_omzet_ex,
                    COALESCE(SUM(CASE WHEN ig.douano_product_id IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS ignored_lines,
                    COALESCE(SUM(CASE WHEN ig.douano_product_id IS NULL AND m.douano_product_id IS NULL THEN 1 ELSE 0 END), 0)::int AS unmapped_lines
                FROM douano_sales_orders o
                JOIN douano_sales_order_lines l ON l.sales_order_id = o.sales_order_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                WHERE o.company_id = %s
                {where_since}
                GROUP BY o.sales_order_id, o.order_date, o.transaction_number, o.status
                ORDER BY o.order_date DESC, o.sales_order_id DESC
                LIMIT %s
                """,
                params,
            )
            rows = cur.fetchall() or []

    # Load datasets once for cost resolution.
    activations = dataset_store.load_dataset("kostprijsproductactiveringen")
    versions = dataset_store.load_dataset("kostprijsversies")
    activation_index = _build_activation_index(activations if isinstance(activations, list) else [])
    versions_by_id: dict[str, dict[str, Any]] = {
        str(v.get("id", "") or ""): v for v in (versions if isinstance(versions, list) else []) if isinstance(v, dict)
    }
    used_version_ids = [
        str(row.get("kostprijsversie_id", "") or "")
        for row in (activations if isinstance(activations, list) else [])
        if isinstance(row, dict)
    ]
    snapshot_cost_index = _build_snapshot_cost_index(versions_by_id, used_version_ids)

    # Compute cost totals per order by scanning mapped lines for just these orders.
    order_ids = [int(r[0] or 0) for r in rows if int(r[0] or 0) > 0]
    cost_by_order: dict[int, dict[str, Any]] = {}
    if order_ids:
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        l.sales_order_id,
                        l.order_date,
                        l.quantity,
                        l.net_revenue_ex,
                        m.bier_id,
                        m.product_id
                    FROM douano_sales_order_lines l
                    JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                    WHERE ig.douano_product_id IS NULL
                      AND l.sales_order_id = ANY(%s)
                    """,
                    (order_ids,),
                )
                mapped_rows = cur.fetchall() or []

        for sales_order_id, order_date_raw, quantity, net_revenue_ex, bier_id, product_id in mapped_rows:
            order_id = int(sales_order_id or 0)
            order_date = _parse_date(order_date_raw)
            if order_id <= 0 or order_date is None:
                continue
            cost_unit, _, _ = _resolve_cost_per_unit(
                bier_id=str(bier_id or ""),
                product_id=str(product_id or ""),
                as_of=order_date,
                activations_index=activation_index,
                versions_by_id=versions_by_id,
                snapshot_cost_index=snapshot_cost_index,
            )
            bucket = cost_by_order.setdefault(
                order_id,
                {"cost_total_ex": 0.0, "mapped_lines": 0, "missing_cost_lines": 0},
            )
            bucket["mapped_lines"] = int(bucket.get("mapped_lines", 0) or 0) + 1
            if cost_unit is None:
                bucket["missing_cost_lines"] = int(bucket.get("missing_cost_lines", 0) or 0) + 1
                continue
            bucket["cost_total_ex"] = float(bucket.get("cost_total_ex", 0.0) or 0.0) + _num(quantity) * float(cost_unit)

    out: list[dict[str, Any]] = []
    for (
        sales_order_id,
        order_date,
        transaction_number,
        status,
        lines,
        omzet_ex,
        korting_ex,
        charges_ex,
        netto_omzet_ex,
        ignored_lines,
        unmapped_lines,
    ) in rows:
        oid = int(sales_order_id or 0)
        cost_bucket = cost_by_order.get(oid, {"cost_total_ex": 0.0, "mapped_lines": 0, "missing_cost_lines": 0})
        cost_total = float(cost_bucket.get("cost_total_ex", 0.0) or 0.0)
        margin = float(netto_omzet_ex or 0.0) - cost_total
        out.append(
            {
                "sales_order_id": oid,
                "order_date": str(order_date or ""),
                "transaction_number": str(transaction_number or ""),
                "status": str(status or ""),
                "lines": int(lines or 0),
                "omzet_ex": float(omzet_ex or 0),
                "korting_ex": float(korting_ex or 0),
                "charges_ex": float(charges_ex or 0),
                "netto_omzet_ex": float(netto_omzet_ex or 0),
                "kostprijs_ex": cost_total,
                "brutomarge_ex": margin,
                "ignored_lines": int(ignored_lines or 0),
                "unmapped_lines": int(unmapped_lines or 0),
                "missing_cost_lines": int(cost_bucket.get("missing_cost_lines", 0) or 0),
            }
        )
    return out


def list_order_lines(
    *,
    sales_order_id: int,
    only_unmapped: bool = False,
    only_missing_cost: bool = False,
    limit: int = 2000,
) -> list[dict[str, Any]]:
    """List order lines for a sales order, with mapping + cost resolution."""
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    postgres_storage.ensure_schema()
    oid = int(sales_order_id or 0)
    if oid <= 0:
        return []
    lim = max(1, min(int(limit or 2000), 5000))

    clauses: list[str] = ["l.sales_order_id = %s"]
    params: list[Any] = [oid]
    if only_unmapped:
        clauses.append("ig.douano_product_id IS NULL AND m.douano_product_id IS NULL")
    if only_missing_cost:
        clauses.append("m.douano_product_id IS NOT NULL")
    where = " AND ".join(clauses)

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    l.line_id,
                    l.sales_order_id,
                    l.company_id,
                    l.order_date,
                    l.douano_product_id,
                    p.name,
                    p.sku,
                    l.quantity,
                    l.unit_price_ex,
                    l.discount_ex,
                    l.charges_total_ex,
                    l.net_revenue_ex,
                    m.bier_id,
                    m.product_id,
                    ig.douano_product_id IS NOT NULL AS ignored
                FROM douano_sales_order_lines l
                LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                WHERE {where}
                ORDER BY l.line_id ASC
                LIMIT %s
                """,
                (*params, lim),
            )
            rows = cur.fetchall() or []

    activations = dataset_store.load_dataset("kostprijsproductactiveringen")
    versions = dataset_store.load_dataset("kostprijsversies")
    activation_index = _build_activation_index(activations if isinstance(activations, list) else [])
    versions_by_id: dict[str, dict[str, Any]] = {
        str(v.get("id", "") or ""): v for v in (versions if isinstance(versions, list) else []) if isinstance(v, dict)
    }
    used_version_ids = [
        str(row.get("kostprijsversie_id", "") or "")
        for row in (activations if isinstance(activations, list) else [])
        if isinstance(row, dict)
    ]
    snapshot_cost_index = _build_snapshot_cost_index(versions_by_id, used_version_ids)

    out: list[dict[str, Any]] = []
    for (
        line_id,
        _sales_order_id,
        company_id,
        order_date_raw,
        douano_product_id,
        product_name,
        sku,
        quantity,
        unit_price_ex,
        discount_ex,
        charges_total_ex,
        net_revenue_ex,
        bier_id,
        product_id,
        ignored,
    ) in rows:
        order_date = _parse_date(order_date_raw)
        bier_id_text = str(bier_id or "")
        product_id_text = str(product_id or "")
        cost_unit: float | None = None
        cost_total = 0.0
        margin = 0.0
        missing_cost = False
        kostprijsversie_id = ""

        if bier_id_text and product_id_text and order_date is not None:
            cost_unit, kostprijsversie_id, _ = _resolve_cost_per_unit(
                bier_id=bier_id_text,
                product_id=product_id_text,
                as_of=order_date,
                activations_index=activation_index,
                versions_by_id=versions_by_id,
                snapshot_cost_index=snapshot_cost_index,
            )
            if cost_unit is None:
                missing_cost = True
            else:
                cost_total = _num(quantity) * float(cost_unit)
                margin = float(net_revenue_ex or 0.0) - cost_total

        if only_missing_cost and not missing_cost:
            continue

        out.append(
            {
                "line_id": int(line_id or 0),
                "sales_order_id": int(_sales_order_id or 0),
                "company_id": int(company_id or 0),
                "order_date": str(order_date_raw or ""),
                "douano_product_id": int(douano_product_id or 0),
                "douano_product_name": str(product_name or ""),
                "douano_sku": str(sku or ""),
                "quantity": float(quantity or 0),
                "unit_price_ex": float(unit_price_ex or 0),
                "discount_ex": float(discount_ex or 0),
                "charges_ex": float(charges_total_ex or 0),
                "net_revenue_ex": float(net_revenue_ex or 0),
                "bier_id": bier_id_text,
                "product_id": product_id_text,
                "ignored": bool(ignored),
                "cost_price_ex": float(cost_unit or 0) if cost_unit is not None else None,
                "cost_total_ex": float(cost_total),
                "margin_ex": float(margin),
                "missing_cost": bool(missing_cost),
                "mapped": bool(bier_id_text and product_id_text),
                "kostprijsversie_id": kostprijsversie_id,
            }
        )
    return out


def backfill_line_snapshots(
    *,
    since: str = "",
    company_id: int = 0,
    limit: int = 5000,
) -> dict[str, Any]:
    """Compute and store cost snapshots for mapped lines.

    This is optional; the UI primarily uses live joins. Use for performance or auditing.
    """
    douano_margin_snapshot_storage.ensure_schema()
    clauses: list[str] = []
    params: list[Any] = []
    since_text = (since or "").strip()
    if company_id:
        clauses.append("company_id = %s")
        params.append(int(company_id))
    if since_text:
        clauses.append("order_date >= %s::date")
        params.append(since_text)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    lim = max(1, min(int(limit or 5000), 50000))
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT DISTINCT company_id
                FROM douano_sales_order_lines
                {where}
                LIMIT %s
                """,
                (*params, lim),
            )
            rows = cur.fetchall() or []

    computed = 0
    missing = 0
    companies = sorted({int(cid[0] or 0) for cid in rows if int(cid[0] or 0) > 0})
    for cid in companies:
        lines = list_company_lines(company_id=cid, since=since_text, limit=lim)
        for line in lines:
            if not line.get("mapped") or line.get("ignored"):
                continue
            computed += 1
            if line.get("missing_cost"):
                missing += 1
            douano_margin_snapshot_storage.upsert_snapshot(
                line_id=int(line.get("line_id", 0) or 0),
                bier_id=str(line.get("bier_id", "") or ""),
                product_id=str(line.get("product_id", "") or ""),
                kostprijsversie_id=str(line.get("kostprijsversie_id", "") or ""),
                cost_price_ex=line.get("cost_price_ex", None),
                cost_total_ex=float(line.get("cost_total_ex", 0) or 0),
                margin_ex=float(line.get("margin_ex", 0) or 0),
            )

    return {"computed": computed, "missing_cost": missing, "companies": len(companies)}
