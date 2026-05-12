from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from app.domain import (
    cost_versions_storage,
    dataset_store,
    douano_product_ignore_storage,
    douano_product_mapping_storage,
    postgres_storage,
)
from app.domain.douano_margin_service import (  # re-use canonical helpers
    _ActivationKey,
    _build_activation_index,
    _parse_date,
    _pick_activation,
)


def _year_bounds(year: int) -> tuple[str, str] | tuple[None, None]:
    y = int(year or 0)
    if y <= 0:
        return None, None
    return f"{y:04d}-01-01", f"{(y + 1):04d}-01-01"


@dataclass(frozen=True)
class SalesSkuRow:
    sku_id: str
    units: float
    net_revenue_ex: float
    first_date: str
    last_date: str
    cost_total_ex: float
    fixed_total_ex: float
    missing_cost_lines: int


def _resolve_cost_components_per_unit(
    *,
    sku_id: str,
    as_of: date,
    activations_index: dict[_ActivationKey, list[dict[str, Any]]],
    components_index: dict[tuple[str, str], dict[str, float]],
) -> tuple[dict[str, float] | None, str]:
    """Return (components_per_unit, kostprijsversie_id)."""
    year = int(as_of.year)
    key = _ActivationKey(sku_id=sku_id, year=year)
    activation = _pick_activation(activations_index.get(key, []), as_of)
    if not activation:
        return None, ""
    version_id = str(activation.get("kostprijsversie_id", "") or "").strip()
    if not version_id:
        return None, ""
    row = components_index.get((version_id, sku_id))
    if row is None:
        return None, version_id
    return row, version_id


def get_sales_by_sku_summary(
    *,
    year: int,
    basis: str = "invoice",
    limit: int = 5000,
    include_unmapped_top: int = 50,
) -> dict[str, Any]:
    """
    Return realized sales totals grouped by sku_id for the given year.

    SSOT:
      - realized quantities + revenue from Douano sales lines (invoice/order)
      - sku mapping via douano_product_mapping
      - cost per unit resolved deterministically via kostprijsproductactiveringen (as-of line date)
        and canonical cost rows (cost_version_sku_rows)
    """
    basis_norm = str(basis or "invoice").strip().lower()
    table = "douano_sales_invoice_lines" if basis_norm == "invoice" else "douano_sales_order_lines"
    date_col = "invoice_date" if basis_norm == "invoice" else "order_date"

    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    postgres_storage.ensure_schema()

    year_start, year_end = _year_bounds(int(year or 0))
    if not year_start or not year_end:
        return {"year": int(year or 0), "basis": basis_norm, "items": [], "unmapped": {"items": []}}

    lim = max(1, min(int(limit or 5000), 20000))
    top_unmapped = max(0, min(int(include_unmapped_top or 50), 500))

    # Load datasets once for cost resolution.
    activations = dataset_store.load_dataset("kostprijsproductactiveringen")
    activation_index = _build_activation_index(activations if isinstance(activations, list) else [])
    used_version_ids = [
        str(row.get("kostprijsversie_id", "") or "")
        for row in (activations if isinstance(activations, list) else [])
        if isinstance(row, dict)
    ]
    components_index = cost_versions_storage.load_cost_row_components_index_for_versions(used_version_ids)

    # Query: aggregate by (date, sku_id) to keep cost resolution bounded.
    mapped_daily: list[tuple[Any, str, float, float]] = []
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    l.{date_col} AS line_date,
                    m.sku_id,
                    SUM(COALESCE(l.quantity, 0)) AS qty,
                    SUM(COALESCE(l.net_revenue_ex, 0)) AS net_revenue_ex
                FROM {table} l
                JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                WHERE ig.douano_product_id IS NULL
                  AND l.{date_col} >= %s::date
                  AND l.{date_col} < %s::date
                GROUP BY l.{date_col}, m.sku_id
                ORDER BY l.{date_col} ASC
                """,
                (year_start, year_end),
            )
            mapped_daily = cur.fetchall() or []

    buckets: dict[str, dict[str, Any]] = {}
    missing_cost_lines = 0

    # Cache per (sku_id, date) to avoid repeated activation lookups for same day.
    cost_cache: dict[tuple[str, date], dict[str, float] | None] = {}

    for line_date_raw, sku_id_raw, qty_raw, net_revenue_raw in mapped_daily:
        sku_id = str(sku_id_raw or "").strip()
        if not sku_id:
            continue
        line_date = _parse_date(line_date_raw)
        if line_date is None:
            continue

        qty = float(qty_raw or 0.0)
        revenue = float(net_revenue_raw or 0.0)

        key = (sku_id, line_date)
        components = cost_cache.get(key)
        if key not in cost_cache:
            components, _ = _resolve_cost_components_per_unit(
                sku_id=sku_id,
                as_of=line_date,
                activations_index=activation_index,
                components_index=components_index,
            )
            cost_cache[key] = components

        bucket = buckets.setdefault(
            sku_id,
            {
                "sku_id": sku_id,
                "units": 0.0,
                "net_revenue_ex": 0.0,
                "first_date": "",
                "last_date": "",
                "cost_total_ex": 0.0,
                "fixed_total_ex": 0.0,
                "missing_cost_lines": 0,
            },
        )

        bucket["units"] = float(bucket["units"] or 0.0) + qty
        bucket["net_revenue_ex"] = float(bucket["net_revenue_ex"] or 0.0) + revenue

        iso = line_date.isoformat()
        if not bucket["first_date"] or iso < str(bucket["first_date"]):
            bucket["first_date"] = iso
        if not bucket["last_date"] or iso > str(bucket["last_date"]):
            bucket["last_date"] = iso

        if components is None:
            bucket["missing_cost_lines"] = int(bucket["missing_cost_lines"] or 0) + 1
            missing_cost_lines += 1
            continue

        kostprijs = float(components.get("kostprijs", 0.0) or 0.0)
        fixed_alloc = float(components.get("indirecte_kosten", 0.0) or 0.0)
        bucket["cost_total_ex"] = float(bucket["cost_total_ex"] or 0.0) + qty * kostprijs
        bucket["fixed_total_ex"] = float(bucket["fixed_total_ex"] or 0.0) + qty * fixed_alloc

    items = list(buckets.values())
    items.sort(key=lambda r: float(r.get("net_revenue_ex", 0.0) or 0.0), reverse=True)
    items = items[:lim]

    unmapped = {"total_units": 0.0, "total_net_revenue_ex": 0.0, "items": []}
    if top_unmapped > 0:
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT
                        l.douano_product_id,
                        SUM(COALESCE(l.quantity, 0)) AS qty,
                        SUM(COALESCE(l.net_revenue_ex, 0)) AS net_revenue_ex,
                        COALESCE(p.name, '') AS product_name,
                        COALESCE(p.sku, '') AS product_sku
                    FROM {table} l
                    LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                    WHERE ig.douano_product_id IS NULL
                      AND m.douano_product_id IS NULL
                      AND l.{date_col} >= %s::date
                      AND l.{date_col} < %s::date
                    GROUP BY l.douano_product_id, p.name, p.sku
                    ORDER BY net_revenue_ex DESC
                    LIMIT %s
                    """,
                    (year_start, year_end, top_unmapped),
                )
                rows = cur.fetchall() or []

        for douano_product_id, qty, net_rev, name, sku in rows:
            unmapped["total_units"] = float(unmapped["total_units"] or 0.0) + float(qty or 0.0)
            unmapped["total_net_revenue_ex"] = float(unmapped["total_net_revenue_ex"] or 0.0) + float(net_rev or 0.0)
            unmapped["items"].append(
                {
                    "douano_product_id": int(douano_product_id or 0),
                    "product_name": str(name or ""),
                    "product_sku": str(sku or ""),
                    "units": float(qty or 0.0),
                    "net_revenue_ex": float(net_rev or 0.0),
                }
            )

    return {
        "year": int(year or 0),
        "basis": basis_norm,
        "items": items,
        "meta": {"missing_cost_lines": int(missing_cost_lines)},
        "unmapped": unmapped,
    }

