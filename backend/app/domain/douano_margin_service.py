from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable

from app.domain import dataset_store, douano_product_mapping_storage, postgres_storage


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
                    COALESCE(SUM(CASE WHEN m.douano_product_id IS NULL THEN 1 ELSE 0 END), 0)::int AS unmapped_lines
                FROM douano_sales_order_lines l
                LEFT JOIN douano_companies c ON c.company_id = l.company_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
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
    for company_id, name, public_name, lines, omzet, korting, charges, netto, total_quantity, unmapped_lines in rows:
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
                "mapped_lines": int(cost_bucket.get("mapped_lines", 0) or 0),
                "missing_cost_lines": int(cost_bucket.get("missing_cost_lines", 0) or 0),
            }
        )
    return out

