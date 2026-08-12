from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable

from app.domain import (
    dataset_store,
    cost_versions_storage,
    douano_product_ignore_storage,
    douano_product_mapping_storage,
    douano_margin_snapshot_storage,
    douano_unmapped_rule_storage,
    lot_costs_storage,
    postgres_storage,
    product_model_storage,
)
from app.domain.actual_lot_cost_resolver import ActualLotCostResolver
from app.domain.cost_resolution_postgres_reader import (
    PostgresCostResolutionSnapshotReader,
)
from app.domain.cost_resolution_types import ActualLotCostResolution
from app.domain.planning_actual_cost_resolver import ReadOnlyCostResolutionService


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


def _variable_cost_breakdown(
    *,
    cost_total: Any,
    quantity: Any,
    components: dict[str, Any] | None,
) -> dict[str, float]:
    total = _num(cost_total)
    qty = _num(quantity)
    fixed_unit = _num((components or {}).get("indirecte_kosten"))
    excise_unit = _num((components or {}).get("accijns"))
    fixed_total = min(total, max(0.0, fixed_unit * qty)) if fixed_unit and qty else 0.0
    excise_total = max(0.0, excise_unit * qty) if excise_unit and qty else 0.0
    variable_with_excise = max(0.0, total - fixed_total)
    variable_without_excise = max(0.0, variable_with_excise - excise_total)
    return {
        "fixed_total_ex": fixed_total,
        "excise_total_ex": excise_total,
        "variable_cost_ex": variable_without_excise,
        "variable_cost_with_excise_ex": variable_with_excise,
    }


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
    sku_id: str
    year: int


def _build_activation_index(activations: list[dict[str, Any]]) -> dict[_ActivationKey, list[dict[str, Any]]]:
    index: dict[_ActivationKey, list[dict[str, Any]]] = {}
    for row in activations:
        if not isinstance(row, dict):
            continue
        sku_id = str(row.get("sku_id", "") or "").strip()
        year = int(row.get("jaar", 0) or 0)
        if not sku_id or year <= 0:
            continue
        key = _ActivationKey(sku_id=sku_id, year=year)
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
) -> dict[tuple[str, str], float]:
    # Canonical: resolve from normalized cost lines table (`cost_version_sku_rows`).
    # Avoid reading `resultaat_snapshot` here to prevent hidden fallback logic.
    _ = versions_by_id
    version_list = [str(v or "").strip() for v in version_ids if str(v or "").strip()]
    return cost_versions_storage.load_cost_row_index_for_versions(version_list)


def _build_snapshot_components_index(
    version_ids: Iterable[str],
) -> dict[tuple[str, str], dict[str, float]]:
    version_list = [str(v or "").strip() for v in version_ids if str(v or "").strip()]
    return cost_versions_storage.load_cost_row_components_index_for_versions(version_list)


def _build_packaging_component_cost_index() -> dict[tuple[int, str], float]:
    """Active component prices for sellable merchandise SKUs.

    These are explicit cost sources from `packaging-component-prices`, not a fallback:
    a sellable packaging component such as a glass uses its active component price.
    """
    rows = dataset_store.load_dataset("packaging-component-prices")
    index: dict[tuple[int, str], float] = {}
    if not isinstance(rows, list):
        return index
    for row in rows:
        if not isinstance(row, dict):
            continue
        component_id = str(row.get("verpakkingsonderdeel_id", "") or row.get("component_id", "") or "").strip()
        if not component_id:
            continue
        try:
            year = int(row.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            year = 0
        if year <= 0:
            continue
        price = _num(row.get("prijs_per_stuk") or row.get("price_per_unit"))
        index[(year, component_id)] = price
    return index


def _build_sku_composition_index() -> dict[str, list[dict[str, Any]]]:
    """Component recipe per sellable SKU.

    This is an explicit cost source for composed sellables such as tastings:
    the parent SKU cost is the sum of the configured component SKUs/articles.
    """
    product_model_storage.ensure_schema()
    index: dict[str, list[dict[str, Any]]] = {}
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT parent_sku_id, component_sku_id, component_article_id, quantity
                FROM sku_composition_lines
                WHERE parent_sku_id <> ''
                ORDER BY parent_sku_id, updated_at, id
                """
            )
            for parent_sku_id, component_sku_id, component_article_id, quantity in cur.fetchall() or []:
                parent = str(parent_sku_id or "").strip()
                if not parent:
                    continue
                index.setdefault(parent, []).append(
                    {
                        "component_sku_id": str(component_sku_id or "").strip(),
                        "component_article_id": str(component_article_id or "").strip(),
                        "quantity": _num(quantity),
                    }
                )
    return index


def _cost_version_label(versions_by_id: dict[str, dict[str, Any]], version_id: str) -> str:
    version = versions_by_id.get(str(version_id or "").strip())
    if not isinstance(version, dict):
        return ""
    try:
        number = int(version.get("versie_nummer", 0) or 0)
    except (TypeError, ValueError):
        number = 0
    return f"v{number}" if number > 0 else ""


def _lot_exact_key(value: Any) -> str:
    """Canonical exact LOT comparison key.

    Douano LOT values are the source of truth for sales rows. This key is only
    for exact matching after harmless formatting differences; it deliberately
    keeps the letter O and digit 0 distinct.
    """
    return "".join(ch for ch in str(value or "").strip().upper() if ch.isalnum())


def _lot_near_key(value: Any) -> str:
    """Diagnostic near-match key for human correction suggestions.

    This may collapse O/0 so we can surface likely mistakes such as PO3010 vs
    P03010, but it must not be treated as an exact business match.
    """
    return _lot_exact_key(value).replace("O", "0")


def _version_lot_number(version: dict[str, Any]) -> str:
    candidates: list[Any] = []
    for container_key in ("inkoop", "invoer"):
        container = version.get(container_key)
        if isinstance(container, dict):
            candidates.extend([container.get("lotnummer"), container.get("lot_number"), container.get("lot_nummer")])
    invoer = version.get("invoer")
    if isinstance(invoer, dict):
        inkoop = invoer.get("inkoop")
        if isinstance(inkoop, dict):
            candidates.extend([inkoop.get("lotnummer"), inkoop.get("lot_number"), inkoop.get("lot_nummer")])
            facturen = inkoop.get("facturen")
            if isinstance(facturen, list):
                for factuur in facturen:
                    if isinstance(factuur, dict):
                        candidates.extend([factuur.get("lotnummer"), factuur.get("lot_number"), factuur.get("lot_nummer")])
    for candidate in candidates:
        text = str(candidate or "").strip()
        if text:
            return text
    return ""


def _find_version_lot_cost(
    *,
    lot_number: str,
    sku_id: str,
    as_of: date,
    versions_by_id: dict[str, dict[str, Any]],
    snapshot_cost_index: dict[tuple[str, str], float],
) -> tuple[float | None, str]:
    lot_key = _lot_exact_key(lot_number)
    if not lot_key or not sku_id:
        return None, ""
    matches: list[tuple[int, str, float]] = []
    for version_id, version in versions_by_id.items():
        if not isinstance(version, dict):
            continue
        if str(version.get("status", "") or "").strip().lower() != "definitief":
            continue
        try:
            year = int(version.get("jaar", (version.get("basisgegevens", {}) or {}).get("jaar", 0)) or 0)
        except (TypeError, ValueError):
            year = 0
        if year and year != int(as_of.year):
            continue
        if _lot_exact_key(_version_lot_number(version)) != lot_key:
            continue
        cost = snapshot_cost_index.get((str(version_id or "").strip(), sku_id))
        if cost is None:
            continue
        try:
            version_number = int(version.get("versie_nummer", 0) or 0)
        except (TypeError, ValueError):
            version_number = 0
        matches.append((version_number, str(version_id or "").strip(), float(cost)))
    if not matches:
        return None, ""
    matches.sort(key=lambda row: (row[0], row[1]), reverse=True)
    _, version_id, cost = matches[0]
    return cost, version_id


def _find_version_lot_near_match(
    *,
    lot_number: str,
    sku_id: str,
    as_of: date,
    versions_by_id: dict[str, dict[str, Any]],
    snapshot_cost_index: dict[tuple[str, str], float],
) -> tuple[str, str]:
    lot_key = _lot_exact_key(lot_number)
    near_key = _lot_near_key(lot_number)
    if not lot_key or not near_key or not sku_id:
        return "", ""
    matches: list[tuple[int, str, str]] = []
    for version_id, version in versions_by_id.items():
        if not isinstance(version, dict):
            continue
        if str(version.get("status", "") or "").strip().lower() != "definitief":
            continue
        try:
            year = int(version.get("jaar", (version.get("basisgegevens", {}) or {}).get("jaar", 0)) or 0)
        except (TypeError, ValueError):
            year = 0
        if year and year != int(as_of.year):
            continue
        version_lot = _version_lot_number(version)
        version_lot_key = _lot_exact_key(version_lot)
        if not version_lot_key or version_lot_key == lot_key or _lot_near_key(version_lot) != near_key:
            continue
        if snapshot_cost_index.get((str(version_id or "").strip(), sku_id)) is None:
            continue
        try:
            version_number = int(version.get("versie_nummer", 0) or 0)
        except (TypeError, ValueError):
            version_number = 0
        matches.append((version_number, str(version_id or "").strip(), str(version_lot or "").strip()))
    if not matches:
        return "", ""
    matches.sort(key=lambda row: (row[0], row[1]), reverse=True)
    _, version_id, version_lot = matches[0]
    return version_id, version_lot


def _build_version_lot_context(
    versions_by_id: dict[str, dict[str, Any]],
    snapshot_cost_index: dict[tuple[str, str], float],
) -> dict[str, Any]:
    exact: dict[tuple[int, str, str], tuple[float, str, int]] = {}
    near: dict[tuple[int, str, str], tuple[str, str, int]] = {}
    sku_costs_by_version: dict[str, list[tuple[str, float]]] = {}
    for (cost_version_id, sku_id), cost in snapshot_cost_index.items():
        if cost_version_id and sku_id:
            sku_costs_by_version.setdefault(str(cost_version_id), []).append((str(sku_id), float(cost or 0.0)))
    for version_id, version in versions_by_id.items():
        if not isinstance(version, dict):
            continue
        if str(version.get("status", "") or "").strip().lower() != "definitief":
            continue
        try:
            year = int(version.get("jaar", (version.get("basisgegevens", {}) or {}).get("jaar", 0)) or 0)
        except (TypeError, ValueError):
            year = 0
        if year <= 0:
            continue
        lot_number = _version_lot_number(version)
        lot_key = _lot_exact_key(lot_number)
        near_key = _lot_near_key(lot_number)
        if not lot_key:
            continue
        try:
            version_number = int(version.get("versie_nummer", 0) or 0)
        except (TypeError, ValueError):
            version_number = 0
        version_id_text = str(version_id or "").strip()
        for sku_id, cost in sku_costs_by_version.get(version_id_text, []):
            exact_key = (year, str(sku_id), lot_key)
            if exact_key not in exact or version_number >= exact[exact_key][2]:
                exact[exact_key] = (cost, version_id_text, version_number)
            near_key_tuple = (year, str(sku_id), near_key)
            if near_key and (near_key_tuple not in near or version_number >= near[near_key_tuple][2]):
                near[near_key_tuple] = (version_id_text, str(lot_number or "").strip(), version_number)
    return {"version_lot_exact": exact, "version_lot_near": near}


def _pick_scoped_record(
    records: list[dict[str, Any]],
    *,
    sku_id: str,
    sku_code: str,
) -> dict[str, Any] | None:
    if not records:
        return None
    sku_id_text = str(sku_id or "").strip()
    sku_code_text = str(sku_code or "").strip()

    def score(row: dict[str, Any]) -> tuple[int, str]:
        row_sku_id = str(row.get("sku_id", "") or "").strip()
        row_sku_code = str(row.get("sku_code", "") or "").strip()
        specificity = 0
        if sku_id_text and row_sku_id == sku_id_text:
            specificity = 3
        elif sku_code_text and row_sku_code == sku_code_text:
            specificity = 2
        elif not row_sku_id and not row_sku_code:
            specificity = 1
        return specificity, str(row.get("_sort", "") or "")

    ranked = sorted(records, key=score, reverse=True)
    return ranked[0] if ranked and score(ranked[0])[0] > 0 else None


def _build_cost_resolution_context(
    sales_refs: list[dict[str, Any]],
    *,
    versions_by_id: dict[str, dict[str, Any]],
    snapshot_cost_index: dict[tuple[str, str], float],
) -> dict[str, Any]:
    context = _build_version_lot_context(versions_by_id, snapshot_cost_index)
    context["complete"] = False
    txs = sorted({str(tx or "").strip() for ref in sales_refs for tx in (ref.get("transaction_numbers") or []) if str(tx or "").strip()})
    sku_codes = sorted({str(ref.get("sku_code", "") or "").strip() for ref in sales_refs if str(ref.get("sku_code", "") or "").strip()})
    sales_lots: dict[tuple[str, str], dict[str, Any]] = {}

    try:
        lot_costs_storage.ensure_schema()
        if txs and sku_codes:
            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT lot_number, quantity, stock_value_per_unit, excise_per_unit, transaction_number, sku_code, updated_at
                        FROM sales_lot_allocations
                        WHERE transaction_number = ANY(%s) AND sku_code = ANY(%s)
                        """,
                        (txs, sku_codes),
                    )
                    for lot_number, quantity, stock_value, excise, transaction_number, sku_code, updated_at in cur.fetchall() or []:
                        key = (str(transaction_number or "").strip(), str(sku_code or "").strip())
                        row = {
                            "lot_number": str(lot_number or "").strip(),
                            "quantity": float(quantity or 0),
                            "stock_value_per_unit": float(stock_value or 0),
                            "excise_per_unit": float(excise or 0),
                            "transaction_number": str(transaction_number or "").strip(),
                            "_score": (
                                1 if str(lot_number or "").strip() else 0,
                                abs(float(quantity or 0)),
                                str(updated_at or ""),
                            ),
                        }
                        if key not in sales_lots or row["_score"] > sales_lots[key].get("_score", (0, 0, "")):
                            sales_lots[key] = row

        alias_by_lot: dict[str, list[dict[str, Any]]] = {}
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, sku_id, sku_code, douano_lot_number, internal_lot_number, reason, payload, updated_at
                    FROM lot_alias_mappings
                    """
                )
                for rid, row_sku_id, row_sku_code, douano, internal, reason, payload, updated_at in cur.fetchall() or []:
                    record = {
                        **(payload if isinstance(payload, dict) else {}),
                        "id": str(rid or "").strip(),
                        "sku_id": str(row_sku_id or "").strip(),
                        "sku_code": str(row_sku_code or "").strip(),
                        "douano_lot_number": str(douano or "").strip(),
                        "internal_lot_number": str(internal or "").strip(),
                        "reason": str(reason or "").strip(),
                        "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") and updated_at else "",
                        "_sort": str(updated_at or ""),
                    }
                    alias_by_lot.setdefault(str(douano or "").strip().lower(), []).append(record)

        lot_cost_by_lot: dict[str, list[dict[str, Any]]] = {}
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, lot_number, sku_id, sku_code, supplier, purchase_price_ex_excise, excise_per_unit,
                           packaging_cost_per_unit, other_direct_cost_per_unit, source_type, source_ref, source_date, updated_at
                    FROM lot_cost_records
                    """
                )
                for (
                    rid,
                    lot_number,
                    row_sku_id,
                    row_sku_code,
                    supplier,
                    purchase_ex,
                    excise,
                    packaging,
                    other_direct,
                    source_type,
                    source_ref,
                    source_date,
                    updated_at,
                ) in cur.fetchall() or []:
                    record = {
                        "id": str(rid or "").strip(),
                        "lot_number": str(lot_number or "").strip(),
                        "sku_id": str(row_sku_id or "").strip(),
                        "sku_code": str(row_sku_code or "").strip(),
                        "supplier": str(supplier or "").strip(),
                        "purchase_price_ex_excise": float(purchase_ex or 0),
                        "excise_per_unit": float(excise or 0),
                        "packaging_cost_per_unit": float(packaging or 0),
                        "other_direct_cost_per_unit": float(other_direct or 0),
                        "source_type": str(source_type or "").strip(),
                        "source_ref": str(source_ref or "").strip(),
                        "_sort": f"{source_date or ''}|{updated_at or ''}",
                    }
                    lot_cost_by_lot.setdefault(str(lot_number or "").strip().lower(), []).append(record)
    except Exception:
        return context

    context.update(
        {
            "complete": True,
            "sales_lots": sales_lots,
            "alias_by_lot": alias_by_lot,
            "lot_cost_by_lot": lot_cost_by_lot,
        }
    )
    return context


def _build_sales_lot_context(sales_refs: list[dict[str, Any]]) -> dict[str, Any]:
    """Load only external transaction/SKU LOT facts; canonical mapping lives in RF-013B."""

    txs = sorted(
        {
            str(tx or "").strip()
            for ref in sales_refs
            for tx in (ref.get("transaction_numbers") or [])
            if str(tx or "").strip()
        }
    )
    sku_codes = sorted(
        {
            str(ref.get("sku_code", "") or "").strip()
            for ref in sales_refs
            if str(ref.get("sku_code", "") or "").strip()
        }
    )
    sales_lot_candidates: dict[tuple[str, str], list[dict[str, Any]]] = {}
    try:
        if txs and sku_codes:
            with postgres_storage.connect() as conn:
                rows = conn.execute(
                    """
                    SELECT lot_number, quantity, transaction_number, sku_code, updated_at
                    FROM sales_lot_allocations
                    WHERE transaction_number = ANY(%s)
                      AND sku_code = ANY(%s)
                    """,
                    (txs, sku_codes),
                ).fetchall()
            for lot_number, quantity, transaction_number, sku_code, updated_at in rows:
                key = (
                    str(transaction_number or "").strip(),
                    str(sku_code or "").strip(),
                )
                candidate = {
                    "lot_number": str(lot_number or "").strip(),
                    "quantity": float(quantity or 0),
                    "transaction_number": key[0],
                    "_score": (
                        1 if str(lot_number or "").strip() else 0,
                        abs(float(quantity or 0)),
                        str(updated_at or ""),
                    ),
                }
                sales_lot_candidates.setdefault(key, []).append(candidate)
    except Exception:
        return {"complete": False, "sales_lots": {}, "sales_lot_conflicts": {}}

    sales_lots: dict[tuple[str, str], dict[str, Any]] = {}
    sales_lot_conflicts: dict[tuple[str, str], tuple[str, ...]] = {}
    for key, candidates in sales_lot_candidates.items():
        distinct_lots = tuple(
            sorted(
                {
                    str(row.get("lot_number", "") or "").strip()
                    for row in candidates
                    if str(row.get("lot_number", "") or "").strip()
                }
            )
        )
        if len(distinct_lots) > 1:
            sales_lot_conflicts[key] = distinct_lots
            continue
        sales_lots[key] = max(
            candidates,
            key=lambda row: row.get("_score", (0, 0, "")),
        )
    return {
        "complete": True,
        "sales_lots": sales_lots,
        "sales_lot_conflicts": sales_lot_conflicts,
    }


def _resolve_cost_per_unit(
    *,
    sku_id: str,
    as_of: date,
    activations_index: dict[_ActivationKey, list[dict[str, Any]]],
    versions_by_id: dict[str, dict[str, Any]],
    snapshot_cost_index: dict[tuple[str, str], float],
) -> tuple[float | None, str]:
    """Return (cost_per_unit, kostprijsversie_id)."""
    year = int(as_of.year)
    key = _ActivationKey(sku_id=sku_id, year=year)
    activation = _pick_activation(activations_index.get(key, []), as_of)
    if not activation:
        return None, ""
    version_id = str(activation.get("kostprijsversie_id", "") or "").strip()
    if not version_id:
        return None, ""

    cost = snapshot_cost_index.get((version_id, sku_id))
    if cost is None:
        return None, version_id
    return float(cost), version_id


def _resolve_composed_sku_cost(
    *,
    sku_id: str,
    as_of: date,
    activations_index: dict[_ActivationKey, list[dict[str, Any]]],
    versions_by_id: dict[str, dict[str, Any]],
    snapshot_cost_index: dict[tuple[str, str], float],
    sku_info_index: dict[str, dict[str, str]],
    packaging_component_cost_index: dict[tuple[int, str], float],
    sku_composition_index: dict[str, list[dict[str, Any]]],
    visited: set[str] | None = None,
) -> tuple[float | None, list[str]]:
    """Resolve a composed SKU only when every configured component has a cost."""
    sku_key = str(sku_id or "").strip()
    if not sku_key:
        return None, ["sku"]
    seen = set(visited or set())
    if sku_key in seen:
        return None, [sku_key]
    lines = sku_composition_index.get(sku_key, [])
    if not lines:
        return None, [sku_key]
    seen.add(sku_key)

    total = 0.0
    missing: list[str] = []
    for line in lines:
        qty = max(0.0, _num(line.get("quantity")))
        component_sku_id = str(line.get("component_sku_id", "") or "").strip()
        component_article_id = str(line.get("component_article_id", "") or "").strip()
        if qty <= 0:
            continue
        component_cost: float | None = None

        if component_sku_id:
            component_cost, _version_id = _resolve_cost_per_unit(
                sku_id=component_sku_id,
                as_of=as_of,
                activations_index=activations_index,
                versions_by_id=versions_by_id,
                snapshot_cost_index=snapshot_cost_index,
            )
            if component_cost is None:
                sku_meta = sku_info_index.get(component_sku_id, {})
                article_id = str(sku_meta.get("article_id", "") or "").strip()
                if article_id:
                    component_cost = packaging_component_cost_index.get((int(as_of.year), article_id))
            if component_cost is None and component_sku_id in sku_composition_index:
                component_cost, nested_missing = _resolve_composed_sku_cost(
                    sku_id=component_sku_id,
                    as_of=as_of,
                    activations_index=activations_index,
                    versions_by_id=versions_by_id,
                    snapshot_cost_index=snapshot_cost_index,
                    sku_info_index=sku_info_index,
                    packaging_component_cost_index=packaging_component_cost_index,
                    sku_composition_index=sku_composition_index,
                    visited=seen,
                )
                missing.extend(nested_missing)
            if component_cost is None:
                missing.append(component_sku_id)
                continue
            total += qty * float(component_cost)
            continue

        if component_article_id:
            component_cost = packaging_component_cost_index.get((int(as_of.year), component_article_id))
            if component_cost is None:
                missing.append(component_article_id)
                continue
            total += qty * float(component_cost)

    if missing:
        return None, missing
    return total, []


def _resolve_authoritative_cost_for_sale(
    *,
    transaction_number: str,
    transaction_numbers: list[str] | None,
    douano_sku: str,
    sku_id: str,
    as_of: date,
    quantity: Any,
    actual_resolver: ActualLotCostResolver,
    versions_by_id: dict[str, dict[str, Any]],
    resolution_context: dict[str, Any] | None = None,
    lot_required: bool,
    cost_requirement: str = "required",
    internal_lot_number_override: str = "",
) -> dict[str, Any]:
    """Resolve one realized line through RF-013B authority, never through a LOT fallback."""

    qty = _num(quantity)
    tx_candidates = [
        str(tx or "").strip()
        for tx in (transaction_numbers or [])
        if str(tx or "").strip()
    ]
    if transaction_number and transaction_number not in tx_candidates:
        tx_candidates.insert(0, transaction_number)
    context = resolution_context or {}
    lot: dict[str, Any] | None = None
    lot_candidates: list[dict[str, Any]] = []
    conflicting_lot_set: set[str] = set()
    sales_lot_conflicts = context.get("sales_lot_conflicts")
    if isinstance(sales_lot_conflicts, dict):
        for tx in tx_candidates:
            conflict = sales_lot_conflicts.get((tx, douano_sku))
            if conflict:
                conflicting_lot_set.update(
                    str(value).strip() for value in conflict if str(value).strip()
                )
    sales_lots = context.get("sales_lots")
    if isinstance(sales_lots, dict):
        for tx in tx_candidates:
            candidate = sales_lots.get((tx, douano_sku))
            if isinstance(candidate, dict):
                lot_candidates.append(candidate)
                candidate_lot = str(candidate.get("lot_number", "") or "").strip()
                if candidate_lot:
                    conflicting_lot_set.add(candidate_lot)
    conflicting_lots = tuple(sorted(conflicting_lot_set))
    if len(conflicting_lots) <= 1 and lot_candidates:
        lot = max(
            lot_candidates,
            key=lambda row: row.get("_score", (0, 0, "")),
        )
    if (
        lot is None
        and len(conflicting_lots) <= 1
        and not bool(context.get("complete", False))
        and tx_candidates
    ):
        lot = lot_costs_storage.find_sales_lot_any(
            transaction_numbers=tx_candidates,
            sku_code=douano_sku,
        )

    external_lot = str((lot or {}).get("lot_number", "") or "").strip()
    maintained_internal_lot = str(internal_lot_number_override or "").strip()
    requested_lot = external_lot or maintained_internal_lot
    if len(conflicting_lots) > 1 and lot_required and cost_requirement == "required":
        result = ActualLotCostResolution(
            status="multiple_lots_per_sales_line",
            source="unresolved",
            warnings=("multiple_exact_lots_require_explicit_line_allocation",),
            candidate_lot_ids=conflicting_lots,
        )
    else:
        result = actual_resolver.resolve_actual_lot_cost(
            sku_id,
            requested_lot,
            cost_requirement=(
                "ignored"
                if cost_requirement == "ignored"
                else "not_required"
                if cost_requirement == "not_required"
                else "required"
            ),
            lot_requirement="required" if lot_required else "not_required",
            planning_year=int(as_of.year),
        )
    resolved = result.status in {
        "resolved_exact_lot",
        "resolved_non_lot_sku_cost",
        "no_cost_required",
        "ignored",
    }
    unit = result.cost_price_ex
    component_breakdown = result.components
    resolved_internal_lot = str(result.resolved_lot_id or "").strip()
    if resolved_internal_lot == external_lot:
        resolved_internal_lot = ""
    return {
        "cost_price_ex": float(unit) if unit is not None else None,
        "cost_total_ex": qty * float(unit) if unit is not None else 0.0,
        "cost_source": result.source,
        "actual_resolution_status": result.status,
        "lot_number": external_lot,
        "lot_internal_number": resolved_internal_lot,
        "lot_alias_id": str(result.lot_mapping_id or ""),
        "lot_transaction_number": str(
            (lot or {}).get("transaction_number", "") or ""
        ).strip(),
        "lot_cost_id": "",
        "lot_supplier": "",
        "lot_cost_missing": bool(lot_required and not resolved),
        "kostprijsversie_id": str(result.cost_version_id or ""),
        "kostprijsversie_label": _cost_version_label(
            versions_by_id,
            str(result.cost_version_id or ""),
        ),
        "cost_row_id": str(result.cost_row_id or ""),
        "cost_components": (
            {
                "inkoop": float(component_breakdown.purchase_ex),
                "verpakkingskosten": float(component_breakdown.packaging_ex),
                "indirecte_kosten": float(component_breakdown.indirect_ex),
                "accijns": float(component_breakdown.excise_ex),
                "kostprijs": float(component_breakdown.cost_price_ex),
            }
            if component_breakdown is not None
            else {}
        ),
        "missing_cost": not resolved,
        "resolution_warnings": list(result.warnings),
        "candidate_mapping_ids": list(result.candidate_mapping_ids),
        "candidate_lot_ids": list(result.candidate_lot_ids),
        "candidate_version_ids": list(result.candidate_version_ids),
        "candidate_cost_row_ids": list(result.candidate_cost_row_ids),
        "candidate_lot_cost_record_ids": list(
            result.candidate_lot_cost_record_ids
        ),
        "resolution_policy_version": "rf-012c3-v1",
    }


def _resolve_cost_for_sale(
    *,
    transaction_number: str,
    transaction_numbers: list[str] | None = None,
    douano_sku: str,
    sku_id: str,
    as_of: date,
    quantity: Any,
    activations_index: dict[_ActivationKey, list[dict[str, Any]]],
    versions_by_id: dict[str, dict[str, Any]],
    snapshot_cost_index: dict[tuple[str, str], float],
    snapshot_components_index: dict[tuple[str, str], dict[str, float]],
    resolution_context: dict[str, Any] | None = None,
    sku_info_index: dict[str, dict[str, str]] | None = None,
    packaging_component_cost_index: dict[tuple[int, str], float] | None = None,
    sku_composition_index: dict[str, list[dict[str, Any]]] | None = None,
    internal_lot_number_override: str = "",
) -> dict[str, Any]:
    """Resolve actual LOT cost first, then planning cost as fallback."""
    qty = _num(quantity)
    tx_candidates = [str(tx or "").strip() for tx in (transaction_numbers or []) if str(tx or "").strip()]
    if transaction_number and transaction_number not in tx_candidates:
        tx_candidates.insert(0, transaction_number)
    context = resolution_context or {}
    context_complete = bool(context.get("complete", False))
    lot = None
    sales_lots = context.get("sales_lots")
    if isinstance(sales_lots, dict):
        for tx in tx_candidates:
            lot = sales_lots.get((tx, douano_sku))
            if lot:
                break
    if lot is None:
        lot = (
            lot_costs_storage.find_sales_lot_any(transaction_numbers=tx_candidates, sku_code=douano_sku)
            if tx_candidates
            else None
        )
    lot_number = str((lot or {}).get("lot_number", "") or "").strip()
    lot_alias = None
    alias_by_lot = context.get("alias_by_lot")
    if lot_number and isinstance(alias_by_lot, dict):
        lot_alias = _pick_scoped_record(alias_by_lot.get(lot_number.lower(), []), sku_id=sku_id, sku_code=douano_sku)
    if lot_number and lot_alias is None and not context_complete:
        lot_alias = lot_costs_storage.find_lot_alias(douano_lot_number=lot_number, sku_code=douano_sku, sku_id=sku_id)
    alias_lot_number = str((lot_alias or {}).get("internal_lot_number", "") or "").strip()
    manual_internal_lot_number = str(internal_lot_number_override or "").strip()
    if not alias_lot_number and manual_internal_lot_number:
        alias_lot_number = manual_internal_lot_number
    lot_cost = None
    lot_cost_by_lot = context.get("lot_cost_by_lot")
    if lot_number and isinstance(lot_cost_by_lot, dict):
        lot_cost = _pick_scoped_record(lot_cost_by_lot.get(lot_number.lower(), []), sku_id=sku_id, sku_code=douano_sku)
    if lot_number and lot_cost is None and not context_complete:
        lot_cost = lot_costs_storage.find_lot_cost(lot_number=lot_number, sku_code=douano_sku, sku_id=sku_id)
    lot_cost_lot_number = lot_number
    lot_cost_via_alias = False
    if lot_cost is None and alias_lot_number:
        if isinstance(lot_cost_by_lot, dict):
            lot_cost = _pick_scoped_record(lot_cost_by_lot.get(alias_lot_number.lower(), []), sku_id=sku_id, sku_code=douano_sku)
        if lot_cost is None and not context_complete:
            lot_cost = lot_costs_storage.find_lot_cost(lot_number=alias_lot_number, sku_code=douano_sku, sku_id=sku_id)
        lot_cost_lot_number = alias_lot_number
        lot_cost_via_alias = lot_cost is not None

    version_lot_cost: float | None = None
    version_lot_id = ""
    version_lot_exact = context.get("version_lot_exact")
    if lot_number and isinstance(version_lot_exact, dict):
        version_match = version_lot_exact.get((int(as_of.year), sku_id, _lot_exact_key(lot_number)))
        if version_match:
            version_lot_cost, version_lot_id, _version_number = version_match
    if version_lot_cost is None:
        version_lot_cost, version_lot_id = _find_version_lot_cost(
            lot_number=lot_number,
            sku_id=sku_id,
            as_of=as_of,
            versions_by_id=versions_by_id,
            snapshot_cost_index=snapshot_cost_index,
        )
    version_lot_via_alias = False
    if version_lot_cost is None and alias_lot_number:
        if isinstance(version_lot_exact, dict):
            version_match = version_lot_exact.get((int(as_of.year), sku_id, _lot_exact_key(alias_lot_number)))
            if version_match:
                version_lot_cost, version_lot_id, _version_number = version_match
        if version_lot_cost is None:
            version_lot_cost, version_lot_id = _find_version_lot_cost(
                lot_number=alias_lot_number,
                sku_id=sku_id,
                as_of=as_of,
                versions_by_id=versions_by_id,
                snapshot_cost_index=snapshot_cost_index,
            )
        version_lot_via_alias = version_lot_cost is not None
    near_lot_version_id = ""
    near_lot_number = ""
    version_lot_near = context.get("version_lot_near")
    if lot_number and isinstance(version_lot_near, dict):
        near_match = version_lot_near.get((int(as_of.year), sku_id, _lot_near_key(lot_number)))
        if near_match and _lot_exact_key(near_match[1]) != _lot_exact_key(lot_number):
            near_lot_version_id, near_lot_number, _version_number = near_match
    if not near_lot_version_id:
        near_lot_version_id, near_lot_number = _find_version_lot_near_match(
            lot_number=lot_number,
            sku_id=sku_id,
            as_of=as_of,
            versions_by_id=versions_by_id,
            snapshot_cost_index=snapshot_cost_index,
        )

    cost_unit, kostprijsversie_id = _resolve_cost_per_unit(
        sku_id=sku_id,
        as_of=as_of,
        activations_index=activations_index,
        versions_by_id=versions_by_id,
        snapshot_cost_index=snapshot_cost_index,
    )
    if cost_unit is None and sku_info_index is not None and packaging_component_cost_index is not None:
        sku_meta = sku_info_index.get(sku_id, {})
        if str(sku_meta.get("kind", "") or "").strip().lower() == "article":
            article_id = str(sku_meta.get("article_id", "") or "").strip()
            if article_id:
                component_price = packaging_component_cost_index.get((int(as_of.year), article_id))
                if component_price is not None:
                    return {
                        "cost_price_ex": float(component_price),
                        "cost_total_ex": qty * float(component_price),
                        "cost_source": "packaging_component_price",
                        "lot_number": lot_number,
                        "lot_internal_number": alias_lot_number,
                        "lot_alias_id": str((lot_alias or {}).get("id", "") or ""),
                        "lot_transaction_number": str((lot or {}).get("transaction_number", "") or "").strip(),
                        "lot_cost_id": "",
                        "lot_supplier": "",
                        "lot_cost_missing": False,
                        "kostprijsversie_id": "",
                        "kostprijsversie_label": "",
                        "missing_cost": False,
                    }

    if (
        cost_unit is None
        and sku_info_index is not None
        and packaging_component_cost_index is not None
        and sku_composition_index is not None
        and sku_id in sku_composition_index
    ):
        composed_unit, missing_components = _resolve_composed_sku_cost(
            sku_id=sku_id,
            as_of=as_of,
            activations_index=activations_index,
            versions_by_id=versions_by_id,
            snapshot_cost_index=snapshot_cost_index,
            sku_info_index=sku_info_index,
            packaging_component_cost_index=packaging_component_cost_index,
            sku_composition_index=sku_composition_index,
        )
        if composed_unit is not None:
            return {
                "cost_price_ex": float(composed_unit),
                "cost_total_ex": qty * float(composed_unit),
                "cost_source": "sku_composition",
                "lot_number": lot_number,
                "lot_internal_number": alias_lot_number,
                "lot_alias_id": str((lot_alias or {}).get("id", "") or ""),
                "lot_transaction_number": str((lot or {}).get("transaction_number", "") or "").strip(),
                "lot_cost_id": "",
                "lot_supplier": "",
                "lot_cost_missing": False,
                "kostprijsversie_id": "",
                "kostprijsversie_label": "",
                "missing_cost": False,
            }

    if lot_cost is not None:
        components = snapshot_components_index.get((kostprijsversie_id, sku_id), {}) if kostprijsversie_id else {}
        lot_direct = (
            float(lot_cost.get("purchase_price_ex_excise", 0.0) or 0.0)
            + float(lot_cost.get("excise_per_unit", 0.0) or 0.0)
            + float(lot_cost.get("packaging_cost_per_unit", 0.0) or 0.0)
            + float(lot_cost.get("other_direct_cost_per_unit", 0.0) or 0.0)
        )
        sku_packaging = float(components.get("verpakkingskosten", 0.0) or 0.0)
        sku_overhead = float(components.get("indirecte_kosten", 0.0) or 0.0)
        unit = lot_direct + sku_packaging + sku_overhead
        return {
            "cost_price_ex": unit,
            "cost_total_ex": qty * unit,
            "cost_source": "manual_internal_lot" if lot_cost_via_alias and manual_internal_lot_number and not lot_number else "lot_alias" if lot_cost_via_alias else "lot",
            "lot_number": lot_number,
            "lot_internal_number": lot_cost_lot_number if lot_cost_via_alias else "",
            "lot_alias_id": str((lot_alias or {}).get("id", "") or "") or ("manual_internal_lot" if manual_internal_lot_number and not lot_number else ""),
            "lot_transaction_number": str((lot or {}).get("transaction_number", "") or "").strip(),
            "lot_cost_id": str(lot_cost.get("id", "") or ""),
            "lot_supplier": str(lot_cost.get("supplier", "") or ""),
            "lot_cost_missing": False,
            "kostprijsversie_id": kostprijsversie_id,
            "kostprijsversie_label": _cost_version_label(versions_by_id, kostprijsversie_id),
            "missing_cost": False,
        }

    if version_lot_cost is not None and version_lot_id:
        return {
            "cost_price_ex": float(version_lot_cost),
            "cost_total_ex": qty * float(version_lot_cost),
            "cost_source": "cost_version_manual_internal_lot" if version_lot_via_alias and manual_internal_lot_number and not lot_number else "cost_version_lot_alias" if version_lot_via_alias else "cost_version_lot",
            "lot_number": lot_number,
            "lot_internal_number": alias_lot_number if version_lot_via_alias else "",
            "lot_alias_id": str((lot_alias or {}).get("id", "") or "") or ("manual_internal_lot" if manual_internal_lot_number and not lot_number else ""),
            "lot_transaction_number": str((lot or {}).get("transaction_number", "") or "").strip(),
            "lot_cost_id": "",
            "lot_supplier": "",
            "lot_cost_missing": False,
            "kostprijsversie_id": version_lot_id,
            "kostprijsversie_label": _cost_version_label(versions_by_id, version_lot_id),
            "missing_cost": False,
        }

    return {
        "cost_price_ex": float(cost_unit) if cost_unit is not None else None,
        "cost_total_ex": qty * float(cost_unit) if cost_unit is not None else 0.0,
        "cost_source": "baseline" if cost_unit is not None else "",
        "lot_number": lot_number,
        "lot_internal_number": alias_lot_number,
        "lot_alias_id": str((lot_alias or {}).get("id", "") or ""),
        "lot_transaction_number": str((lot or {}).get("transaction_number", "") or "").strip(),
        "lot_cost_id": "",
        "lot_supplier": "",
        "lot_cost_missing": bool(lot_number and lot_cost is None and version_lot_cost is None),
        "lot_near_match_version_id": near_lot_version_id,
        "lot_near_match_version_label": _cost_version_label(versions_by_id, near_lot_version_id),
        "lot_near_match_number": near_lot_number,
        "kostprijsversie_id": kostprijsversie_id,
        "kostprijsversie_label": _cost_version_label(versions_by_id, kostprijsversie_id),
        "missing_cost": cost_unit is None,
    }


def get_company_margin_summary(
    *,
    since: str = "",
    year: int = 0,
    limit: int = 500,
    basis: str = "order",
) -> list[dict[str, Any]]:
    """Compute company margin summary live.

    basis:
      - order: based on douano_sales_order_lines (order_date)
      - invoice: based on douano_sales_invoice_lines (invoice_date)
    """
    basis_norm = str(basis or "order").strip().lower()
    if basis_norm == "invoice":
        return _get_company_margin_summary_invoices(since=since, year=year, limit=limit)

    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    from app.domain import douano_unmapped_rule_storage
    douano_unmapped_rule_storage.ensure_schema()
    postgres_storage.ensure_schema()
    douano_margin_snapshot_storage.ensure_schema()
    cost_versions_storage.ensure_schema()

    since_text = (since or "").strip()
    year_start, year_end = _year_bounds(year)
    lim = max(1, min(int(limit or 500), 5000))

    where_parts: list[str] = []
    params_list: list[Any] = []
    if since_text:
        where_parts.append("l.order_date >= %s::date")
        params_list.append(since_text)
    if year_start:
        where_parts.append("l.order_date >= %s::date AND l.order_date < %s::date")
        params_list.extend([year_start, year_end])
    where = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    params_list.append(lim)
    params: tuple[Any, ...] = tuple(params_list)
    # Ensure distance cache schema exists so we can enrich rows with KM.
    from app.domain import company_distance_storage
    company_distance_storage.ensure_schema()

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    l.company_id,
                    c.name,
                    c.public_name,
                    COUNT(DISTINCT l.sales_order_id)::int AS documents,
                    COUNT(*)::int AS lines,
                    COALESCE(SUM(l.gross_revenue_ex), 0) AS omzet_ex,
                    COALESCE(SUM(l.discount_ex), 0) AS korting_ex,
                    COALESCE(SUM(l.charges_total_ex), 0) AS charges_ex,
                    COALESCE(SUM(l.net_revenue_ex), 0) AS netto_omzet_ex,
                    COALESCE(SUM(l.quantity), 0) AS total_quantity,
                    COALESCE(SUM(CASE WHEN ig.douano_product_id IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS ignored_lines,
                    COALESCE(SUM(CASE WHEN ig.douano_product_id IS NULL AND m.douano_product_id IS NULL AND r.rule_id IS NULL THEN 1 ELSE 0 END), 0)::int AS unmapped_lines,
                    COALESCE(dc.distance_km_one_way, 0) AS distance_km_one_way,
                    COALESCE(SUM(snap.cost_total_ex), 0) AS snapshot_cost_total,
                    COALESCE(SUM(GREATEST(0, COALESCE(snap.cost_total_ex, 0) - LEAST(COALESCE(snap.cost_total_ex, 0), GREATEST(0, COALESCE(csr.indirecte_kosten, 0) * COALESCE(snap.quantity, 0))) - GREATEST(0, COALESCE(csr.accijns, 0) * COALESCE(snap.quantity, 0)))), 0) AS variable_cost_ex,
                    COALESCE(SUM(GREATEST(0, COALESCE(snap.cost_total_ex, 0) - LEAST(COALESCE(snap.cost_total_ex, 0), GREATEST(0, COALESCE(csr.indirecte_kosten, 0) * COALESCE(snap.quantity, 0))))), 0) AS variable_cost_with_excise_ex,
                    COALESCE(SUM(CASE WHEN COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS mapped_lines,
                    COALESCE(SUM(CASE WHEN COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) IS NOT NULL AND (snap.source_line_id IS NULL OR snap.missing_cost) THEN 1 ELSE 0 END), 0)::int AS missing_cost_lines
                FROM douano_sales_order_lines l
                LEFT JOIN douano_companies c ON c.company_id = l.company_id
                LEFT JOIN company_distance_cache dc
                  ON dc.company_id = l.company_id
                 AND dc.status = 'ok'
                LEFT JOIN douano_sales_line_cost_snapshots snap
                  ON snap.source_type = 'order'
                 AND snap.source_line_id = l.line_id
                LEFT JOIN (
                    SELECT version_id, sku_id, MAX(indirecte_kosten) AS indirecte_kosten, MAX(accijns) AS accijns
                    FROM cost_version_sku_rows
                    GROUP BY version_id, sku_id
                ) csr
                  ON csr.version_id = snap.kostprijsversie_id
                 AND csr.sku_id = snap.sku_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                LEFT JOIN douano_unmapped_rules r
                  ON l.douano_product_id = 0
                 AND r.match_type = 'product0_description'
                 AND r.douano_product_id = 0
                 AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig')
                {where}
                GROUP BY l.company_id, c.name, c.public_name, dc.distance_km_one_way
                ORDER BY netto_omzet_ex DESC
                LIMIT %s
                """,
                params,
            )
            rows = cur.fetchall() or []

    out: list[dict[str, Any]] = []
    for company_id, name, public_name, documents, lines, omzet, korting, charges, netto, total_quantity, ignored_lines, unmapped_lines, distance_km_one_way, snapshot_cost_total, variable_cost_ex, variable_cost_with_excise_ex, mapped_lines, missing_cost_lines in rows:
        cid = int(company_id or 0)
        cost_total = float(snapshot_cost_total or 0.0)
        margin = float(netto or 0.0) - cost_total
        docs = int(documents or 0)
        km_one_way = float(distance_km_one_way or 0.0)
        km_total = float(docs) * km_one_way * 2.0
        out.append(
            {
                "company_id": cid,
                "company_name": str(public_name or name or ""),
                "documents": docs,
                "lines": int(lines or 0),
                "omzet_ex": float(omzet or 0.0),
                "korting_ex": float(korting or 0.0),
                "charges_ex": float(charges or 0.0),
                "netto_omzet_ex": float(netto or 0.0),
                "kostprijs_ex": cost_total,
                "variabel_ex": float(variable_cost_ex or 0.0),
                "variabel_accijns_ex": float(variable_cost_with_excise_ex or 0.0),
                "brutomarge_ex": margin,
                "distance_km_one_way": km_one_way,
                "km_total": km_total,
                "unmapped_lines": int(unmapped_lines or 0),
                "ignored_lines": int(ignored_lines or 0),
                "mapped_lines": int(mapped_lines or 0),
                "missing_cost_lines": int(missing_cost_lines or 0),
            }
        )
    return out


def _get_company_margin_summary_invoices(*, since: str = "", year: int = 0, limit: int = 500) -> list[dict[str, Any]]:
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    from app.domain import douano_unmapped_rule_storage
    douano_unmapped_rule_storage.ensure_schema()
    postgres_storage.ensure_schema()
    douano_margin_snapshot_storage.ensure_schema()
    cost_versions_storage.ensure_schema()

    since_text = (since or "").strip()
    year_start, year_end = _year_bounds(year)
    lim = max(1, min(int(limit or 500), 5000))

    where_parts: list[str] = []
    params_list: list[Any] = []
    if since_text:
        where_parts.append("l.invoice_date >= %s::date")
        params_list.append(since_text)
    if year_start:
        where_parts.append("l.invoice_date >= %s::date AND l.invoice_date < %s::date")
        params_list.extend([year_start, year_end])
    where = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    params_list.append(lim)
    params: tuple[Any, ...] = tuple(params_list)

    from app.domain import company_distance_storage
    company_distance_storage.ensure_schema()

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    l.company_id,
                    c.name,
                    c.public_name,
                    COUNT(DISTINCT l.sales_invoice_id)::int AS documents,
                    COUNT(*)::int AS lines,
                    COALESCE(SUM(l.gross_revenue_ex), 0) AS omzet_ex,
                    COALESCE(SUM(l.discount_ex), 0) AS korting_ex,
                    COALESCE(SUM(l.charges_total_ex), 0) AS charges_ex,
                    COALESCE(SUM(l.net_revenue_ex), 0) AS netto_omzet_ex,
                    COALESCE(SUM(l.quantity), 0) AS total_quantity,
                    COALESCE(SUM(CASE WHEN ig.douano_product_id IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS ignored_lines,
                    COALESCE(SUM(CASE WHEN ig.douano_product_id IS NULL AND m.douano_product_id IS NULL AND r.rule_id IS NULL THEN 1 ELSE 0 END), 0)::int AS unmapped_lines,
                    COALESCE(dc.distance_km_one_way, 0) AS distance_km_one_way,
                    COALESCE(SUM(snap.cost_total_ex), 0) AS snapshot_cost_total,
                    COALESCE(SUM(GREATEST(0, COALESCE(snap.cost_total_ex, 0) - LEAST(COALESCE(snap.cost_total_ex, 0), GREATEST(0, COALESCE(csr.indirecte_kosten, 0) * COALESCE(snap.quantity, 0))) - GREATEST(0, COALESCE(csr.accijns, 0) * COALESCE(snap.quantity, 0)))), 0) AS variable_cost_ex,
                    COALESCE(SUM(GREATEST(0, COALESCE(snap.cost_total_ex, 0) - LEAST(COALESCE(snap.cost_total_ex, 0), GREATEST(0, COALESCE(csr.indirecte_kosten, 0) * COALESCE(snap.quantity, 0))))), 0) AS variable_cost_with_excise_ex,
                    COALESCE(SUM(CASE WHEN COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS mapped_lines,
                    COALESCE(SUM(CASE WHEN COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) IS NOT NULL AND (snap.source_line_id IS NULL OR snap.missing_cost) THEN 1 ELSE 0 END), 0)::int AS missing_cost_lines
                FROM douano_sales_invoice_lines l
                LEFT JOIN douano_companies c ON c.company_id = l.company_id
                LEFT JOIN company_distance_cache dc
                  ON dc.company_id = l.company_id
                 AND dc.status = 'ok'
                LEFT JOIN douano_sales_line_cost_snapshots snap
                  ON snap.source_type = 'invoice'
                 AND snap.source_line_id = l.line_id
                LEFT JOIN (
                    SELECT version_id, sku_id, MAX(indirecte_kosten) AS indirecte_kosten, MAX(accijns) AS accijns
                    FROM cost_version_sku_rows
                    GROUP BY version_id, sku_id
                ) csr
                  ON csr.version_id = snap.kostprijsversie_id
                 AND csr.sku_id = snap.sku_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                LEFT JOIN douano_unmapped_rules r
                  ON l.douano_product_id = 0
                 AND r.match_type = 'product0_description'
                 AND r.douano_product_id = 0
                 AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig')
                {where}
                GROUP BY l.company_id, c.name, c.public_name, dc.distance_km_one_way
                ORDER BY netto_omzet_ex DESC
                LIMIT %s
                """,
                params,
            )
            rows = cur.fetchall() or []

    out: list[dict[str, Any]] = []
    for company_id, name, public_name, documents, lines, omzet, korting, charges, netto, _total_qty, ignored_lines, unmapped_lines, distance_km_one_way, snapshot_cost_total, variable_cost_ex, variable_cost_with_excise_ex, mapped_lines, missing_cost_lines in rows:
        cid = int(company_id or 0)
        cost_total = float(snapshot_cost_total or 0.0)
        margin = float(netto or 0.0) - cost_total
        docs = int(documents or 0)
        km_one_way = float(distance_km_one_way or 0.0)
        km_total = float(docs) * km_one_way * 2.0
        out.append(
            {
                "company_id": cid,
                "company_name": str(public_name or name or ""),
                "documents": docs,
                "lines": int(lines or 0),
                "omzet_ex": float(omzet or 0.0),
                "korting_ex": float(korting or 0.0),
                "charges_ex": float(charges or 0.0),
                "netto_omzet_ex": float(netto or 0.0),
                "kostprijs_ex": cost_total,
                "variabel_ex": float(variable_cost_ex or 0.0),
                "variabel_accijns_ex": float(variable_cost_with_excise_ex or 0.0),
                "brutomarge_ex": margin,
                "distance_km_one_way": km_one_way,
                "km_total": km_total,
                "unmapped_lines": int(unmapped_lines or 0),
                "ignored_lines": int(ignored_lines or 0),
                "mapped_lines": int(mapped_lines or 0),
                "missing_cost_lines": int(missing_cost_lines or 0),
            }
        )
    return out


def _year_bounds(year: int) -> tuple[str, str]:
    y = int(year or 0)
    if y <= 0:
        return "", ""
    start = f"{y:04d}-01-01"
    end = f"{y + 1:04d}-01-01"
    return start, end


def list_company_unmapped_products(*, company_id: int, since: str = "", limit: int = 50) -> list[dict[str, Any]]:
    """Return unmapped products (excluding ignored) for a company, ranked by net revenue."""
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    from app.domain import douano_unmapped_rule_storage
    from app.domain import douano_sync_storage
    douano_unmapped_rule_storage.ensure_schema()
    douano_sync_storage.ensure_schema()
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
                WITH agg AS (
                    SELECT
                        l.douano_product_id,
                        CASE
                            WHEN l.douano_product_id = 0 THEN COALESCE(NULLIF(MAX(NULLIF(l.line_description, '')), ''), 'Overig')
                            ELSE COALESCE(NULLIF(MAX(NULLIF(p.name, '')), ''), NULLIF(MAX(NULLIF(l.line_product_name, '')), ''), '')
                        END AS display_name,
                        COALESCE(p.sku, '') AS sku,
                        COALESCE(p.gtin, '') AS gtin,
                        COUNT(*)::int AS lines,
                        COALESCE(SUM(l.quantity), 0) AS quantity,
                        COALESCE(SUM(l.net_revenue_ex), 0) AS net_revenue_ex
                    FROM douano_sales_order_lines l
                    LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                    LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_unmapped_rules r
                      ON (
                        (l.douano_product_id <> 0 AND r.match_type = 'douano_product_id' AND r.douano_product_id = l.douano_product_id AND r.line_description = '')
                        OR (l.douano_product_id = 0 AND r.match_type = 'product0_description' AND r.douano_product_id = 0 AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig'))
                      )
                    WHERE l.company_id = %s
                      AND ig.douano_product_id IS NULL
                      AND m.douano_product_id IS NULL
                      AND r.rule_id IS NULL
                      {where_since}
                    GROUP BY l.douano_product_id, p.sku, p.gtin
                )
                SELECT
                    agg.douano_product_id,
                    agg.display_name,
                    agg.sku,
                    agg.gtin,
                    agg.lines,
                    agg.quantity,
                    agg.net_revenue_ex,
                    ex.transaction_number AS example_ref,
                    ex.order_date AS example_date
                FROM agg
                LEFT JOIN LATERAL (
                    SELECT o.transaction_number, l.order_date
                    FROM douano_sales_order_lines l
                    JOIN douano_sales_orders o ON o.sales_order_id = l.sales_order_id
                    WHERE l.company_id = %s
                      AND l.douano_product_id = agg.douano_product_id
                      AND (agg.douano_product_id <> 0 OR COALESCE(NULLIF(l.line_description, ''), 'Overig') = agg.display_name)
                      {where_since}
                    ORDER BY l.order_date DESC, l.sales_order_id DESC
                    LIMIT 1
                ) ex ON TRUE
                ORDER BY agg.net_revenue_ex DESC
                LIMIT %s
                """,
                (cid, since_text, cid, since_text, lim) if since_text else (cid, cid, lim),
            )
            rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for douano_product_id, name, sku, gtin, lines, quantity, net_revenue_ex, example_ref, example_date in rows:
        out.append(
            {
                "douano_product_id": int(douano_product_id or 0),
                "name": str(name or ""),
                "sku": str(sku or ""),
                "gtin": str(gtin or ""),
                "lines": int(lines or 0),
                "quantity": float(quantity or 0),
                "net_revenue_ex": float(net_revenue_ex or 0),
                "example_ref": str(example_ref or ""),
                "example_date": example_date.isoformat() if example_date else "",
            }
        )
    return out


def list_company_lines(
    *,
    company_id: int,
    since: str = "",
    year: int = 0,
    only_unmapped: bool = False,
    only_missing_cost: bool = False,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """List order lines for a company from stored cost snapshots.

    This legacy endpoint intentionally avoids live cost resolution. The normal
    page flow uses summary/order/invoice snapshot routes, and this path should
    not become a hidden per-row LOT lookup again.
    """
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    postgres_storage.ensure_schema()
    douano_margin_snapshot_storage.ensure_schema()
    cost_versions_storage.ensure_schema()
    cid = int(company_id or 0)
    if cid <= 0:
        return []

    lim = max(1, min(int(limit or 500), 5000))
    since_text = (since or "").strip()
    year_start, year_end = _year_bounds(year)

    clauses: list[str] = ["l.company_id = %s"]
    params: list[Any] = [cid]
    if since_text:
        clauses.append("l.order_date >= %s::date")
        params.append(since_text)
    if year_start:
        clauses.append("l.order_date >= %s::date AND l.order_date < %s::date")
        params.extend([year_start, year_end])

    if only_unmapped:
        clauses.append(
            "ig.douano_product_id IS NULL "
            "AND COALESCE(NULLIF(snap.sku_id, ''), NULLIF(m.sku_id, '')) IS NULL"
        )
    if only_missing_cost:
        clauses.append("COALESCE(snap.missing_cost, FALSE) = TRUE")

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
                    COALESCE(NULLIF(snap.sku_id, ''), NULLIF(m.sku_id, '')) AS sku_id,
                    COALESCE(NULLIF(snap.bier_id, ''), '') AS bier_id,
                    COALESCE(NULLIF(snap.product_id, ''), '') AS product_id,
                    ig.douano_product_id IS NOT NULL AS ignored,
                    snap.source_line_id IS NOT NULL AS has_snapshot,
                    snap.cost_price_ex,
                    COALESCE(snap.cost_total_ex, 0) AS cost_total_ex,
                    GREATEST(0, COALESCE(snap.cost_total_ex, 0) - LEAST(COALESCE(snap.cost_total_ex, 0), GREATEST(0, COALESCE(csr.indirecte_kosten, 0) * COALESCE(snap.quantity, 0))) - GREATEST(0, COALESCE(csr.accijns, 0) * COALESCE(snap.quantity, 0))) AS variable_cost_ex,
                    GREATEST(0, COALESCE(snap.cost_total_ex, 0) - LEAST(COALESCE(snap.cost_total_ex, 0), GREATEST(0, COALESCE(csr.indirecte_kosten, 0) * COALESCE(snap.quantity, 0)))) AS variable_cost_with_excise_ex,
                    COALESCE(snap.margin_ex, 0) AS margin_ex,
                    COALESCE(snap.missing_cost, FALSE) AS missing_cost,
                    COALESCE(snap.mapped, FALSE) AS snapshot_mapped,
                    COALESCE(snap.cost_source, '') AS cost_source,
                    COALESCE(snap.cost_status, '') AS cost_status,
                    COALESCE(snap.kostprijsversie_id, '') AS kostprijsversie_id,
                    COALESCE(snap.kostprijsversie_label, '') AS kostprijsversie_label,
                    COALESCE(snap.lot_number, '') AS lot_number,
                    COALESCE(snap.lot_internal_number, '') AS lot_internal_number,
                    COALESCE(snap.lot_transaction_number, '') AS lot_transaction_number,
                    COALESCE(snap.payload, '{{}}'::jsonb) AS snapshot_payload
                FROM douano_sales_order_lines l
                LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                LEFT JOIN douano_sales_line_cost_snapshots snap
                  ON snap.source_type = 'order'
                 AND snap.source_line_id = l.line_id
                LEFT JOIN (
                    SELECT version_id, sku_id, MAX(indirecte_kosten) AS indirecte_kosten, MAX(accijns) AS accijns
                    FROM cost_version_sku_rows
                    GROUP BY version_id, sku_id
                ) csr
                  ON csr.version_id = snap.kostprijsversie_id
                 AND csr.sku_id = snap.sku_id
                WHERE {where}
                ORDER BY l.order_date DESC, l.line_id DESC
                LIMIT %s
                """,
                (*params, lim),
            )
            rows = cur.fetchall() or []

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
        sku_id,
        bier_id,
        product_id,
        ignored,
        has_snapshot,
        cost_price_ex,
        cost_total_ex,
        variable_cost_ex,
        variable_cost_with_excise_ex,
        margin_ex,
        missing_cost,
        snapshot_mapped,
        cost_source,
        cost_status,
        kostprijsversie_id,
        kostprijsversie_label,
        lot_number,
        lot_internal_number,
        lot_transaction_number,
        snapshot_payload,
    ) in rows:
        sku_id_text = str(sku_id or "")
        payload = snapshot_payload if isinstance(snapshot_payload, dict) else {}

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
                "sku_id": sku_id_text,
                "bier_id": str(bier_id or ""),
                "product_id": str(product_id or ""),
                "ignored": bool(ignored),
                "cost_price_ex": float(cost_price_ex) if cost_price_ex is not None else None,
                "cost_total_ex": float(cost_total_ex or 0),
                "variabel_ex": float(variable_cost_ex or 0),
                "variabel_accijns_ex": float(variable_cost_with_excise_ex or 0),
                "margin_ex": float(margin_ex or 0),
                "missing_cost": bool(missing_cost),
                "mapped": bool(snapshot_mapped) or bool(sku_id_text),
                "snapshot_present": bool(has_snapshot),
                "cost_source": str(cost_source or ""),
                "cost_status": str(cost_status or ""),
                "kostprijsversie_id": str(kostprijsversie_id or ""),
                "kostprijsversie_label": str(kostprijsversie_label or ""),
                "lot_number": str(lot_number or ""),
                "lot_internal_number": str(lot_internal_number or ""),
                "lot_transaction_number": str(lot_transaction_number or ""),
                "lot_supplier": str(payload.get("lot_supplier", "") or ""),
                "lot_cost_missing": bool(payload.get("lot_cost_missing", False)),
                "lot_near_match_version_id": str(payload.get("lot_near_match_version_id", "") or ""),
                "lot_near_match_version_label": str(payload.get("lot_near_match_version_label", "") or ""),
                "lot_near_match_number": str(payload.get("lot_near_match_number", "") or ""),
                "resolution_warnings": list(payload.get("resolution_warnings", []) or []),
                "candidate_mapping_ids": list(payload.get("candidate_mapping_ids", []) or []),
                "candidate_lot_ids": list(payload.get("candidate_lot_ids", []) or []),
                "candidate_version_ids": list(payload.get("candidate_version_ids", []) or []),
                "candidate_cost_row_ids": list(payload.get("candidate_cost_row_ids", []) or []),
                "candidate_lot_cost_record_ids": list(payload.get("candidate_lot_cost_record_ids", []) or []),
                "resolution_policy_version": str(payload.get("resolution_policy_version", "") or ""),
            }
        )
    return out


def list_company_orders(
    *,
    company_id: int,
    since: str = "",
    year: int = 0,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """List sales orders for a company with totals + counts.

    Totals are based on douano_sales_order_lines (gross/net) and include mapping diagnostics.
    """
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    from app.domain import douano_unmapped_rule_storage
    douano_unmapped_rule_storage.ensure_schema()
    postgres_storage.ensure_schema()
    douano_margin_snapshot_storage.ensure_schema()
    cost_versions_storage.ensure_schema()
    cid = int(company_id or 0)
    if cid <= 0:
        return []
    lim = max(1, min(int(limit or 200), 2000))
    since_text = (since or "").strip()
    year_start, year_end = _year_bounds(year)
    where = ""
    params_list: list[Any] = [cid]
    if since_text:
        where += " AND l.order_date >= %s::date"
        params_list.append(since_text)
    if year_start:
        where += " AND l.order_date >= %s::date AND l.order_date < %s::date"
        params_list.extend([year_start, year_end])
    params_list.append(lim)
    params: tuple[Any, ...] = tuple(params_list)

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
                    COALESCE(SUM(CASE WHEN ig.douano_product_id IS NULL AND m.douano_product_id IS NULL AND r.rule_id IS NULL THEN 1 ELSE 0 END), 0)::int AS unmapped_lines,
                    COALESCE(SUM(snap.cost_total_ex), 0) AS snapshot_cost_total,
                    COALESCE(SUM(GREATEST(0, COALESCE(snap.cost_total_ex, 0) - LEAST(COALESCE(snap.cost_total_ex, 0), GREATEST(0, COALESCE(csr.indirecte_kosten, 0) * COALESCE(snap.quantity, 0))) - GREATEST(0, COALESCE(csr.accijns, 0) * COALESCE(snap.quantity, 0)))), 0) AS variable_cost_ex,
                    COALESCE(SUM(GREATEST(0, COALESCE(snap.cost_total_ex, 0) - LEAST(COALESCE(snap.cost_total_ex, 0), GREATEST(0, COALESCE(csr.indirecte_kosten, 0) * COALESCE(snap.quantity, 0))))), 0) AS variable_cost_with_excise_ex,
                    COALESCE(SUM(CASE WHEN COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) IS NOT NULL AND (snap.source_line_id IS NULL OR snap.missing_cost) THEN 1 ELSE 0 END), 0)::int AS missing_cost_lines
                FROM douano_sales_orders o
                JOIN douano_sales_order_lines l ON l.sales_order_id = o.sales_order_id
                LEFT JOIN douano_sales_line_cost_snapshots snap
                  ON snap.source_type = 'order'
                 AND snap.source_line_id = l.line_id
                LEFT JOIN (
                    SELECT version_id, sku_id, MAX(indirecte_kosten) AS indirecte_kosten, MAX(accijns) AS accijns
                    FROM cost_version_sku_rows
                    GROUP BY version_id, sku_id
                ) csr
                  ON csr.version_id = snap.kostprijsversie_id
                 AND csr.sku_id = snap.sku_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                LEFT JOIN douano_unmapped_rules r
                  ON l.douano_product_id = 0
                 AND r.match_type = 'product0_description'
                 AND r.douano_product_id = 0
                 AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig')
                WHERE o.company_id = %s
                {where}
                GROUP BY o.sales_order_id, o.order_date, o.transaction_number, o.status
                ORDER BY o.order_date DESC, o.sales_order_id DESC
                LIMIT %s
                """,
                params,
            )
            rows = cur.fetchall() or []

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
        snapshot_cost_total,
        variable_cost_ex,
        variable_cost_with_excise_ex,
        missing_cost_lines,
    ) in rows:
        oid = int(sales_order_id or 0)
        cost_total = float(snapshot_cost_total or 0.0)
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
                "variabel_ex": float(variable_cost_ex or 0.0),
                "variabel_accijns_ex": float(variable_cost_with_excise_ex or 0.0),
                "brutomarge_ex": margin,
                "ignored_lines": int(ignored_lines or 0),
                "unmapped_lines": int(unmapped_lines or 0),
                "missing_cost_lines": int(missing_cost_lines or 0),
            }
        )
    return out


def list_company_invoices(
    *,
    company_id: int,
    since: str = "",
    year: int = 0,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """List sales invoices for a company with totals + counts (invoice_date basis)."""
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    from app.domain import douano_unmapped_rule_storage
    douano_unmapped_rule_storage.ensure_schema()
    postgres_storage.ensure_schema()
    douano_margin_snapshot_storage.ensure_schema()
    cost_versions_storage.ensure_schema()
    cid = int(company_id or 0)
    if cid <= 0:
        return []
    lim = max(1, min(int(limit or 200), 2000))
    since_text = (since or "").strip()
    year_start, year_end = _year_bounds(year)
    where = ""
    params_list: list[Any] = [cid]
    if since_text:
        where += " AND l.invoice_date >= %s::date"
        params_list.append(since_text)
    if year_start:
        where += " AND l.invoice_date >= %s::date AND l.invoice_date < %s::date"
        params_list.extend([year_start, year_end])
    params_list.append(lim)
    params: tuple[Any, ...] = tuple(params_list)

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    i.sales_invoice_id,
                    i.invoice_date,
                    i.invoice_number,
                    i.transaction_type,
                    i.is_sent,
                    COUNT(l.line_id)::int AS lines,
                    COALESCE(SUM(l.gross_revenue_ex), 0) AS omzet_ex,
                    COALESCE(SUM(l.discount_ex), 0) AS korting_ex,
                    COALESCE(SUM(l.charges_total_ex), 0) AS charges_ex,
                    COALESCE(SUM(l.net_revenue_ex), 0) AS netto_omzet_ex,
                    COALESCE(SUM(CASE WHEN ig.douano_product_id IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS ignored_lines,
                    COALESCE(SUM(CASE WHEN ig.douano_product_id IS NULL AND m.douano_product_id IS NULL AND r.rule_id IS NULL THEN 1 ELSE 0 END), 0)::int AS unmapped_lines,
                    COALESCE(SUM(snap.cost_total_ex), 0) AS snapshot_cost_total,
                    COALESCE(SUM(GREATEST(0, COALESCE(snap.cost_total_ex, 0) - LEAST(COALESCE(snap.cost_total_ex, 0), GREATEST(0, COALESCE(csr.indirecte_kosten, 0) * COALESCE(snap.quantity, 0))) - GREATEST(0, COALESCE(csr.accijns, 0) * COALESCE(snap.quantity, 0)))), 0) AS variable_cost_ex,
                    COALESCE(SUM(GREATEST(0, COALESCE(snap.cost_total_ex, 0) - LEAST(COALESCE(snap.cost_total_ex, 0), GREATEST(0, COALESCE(csr.indirecte_kosten, 0) * COALESCE(snap.quantity, 0))))), 0) AS variable_cost_with_excise_ex,
                    COALESCE(SUM(CASE WHEN COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) IS NOT NULL AND (snap.source_line_id IS NULL OR snap.missing_cost) THEN 1 ELSE 0 END), 0)::int AS missing_cost_lines
                FROM douano_sales_invoices i
                JOIN douano_sales_invoice_lines l ON l.sales_invoice_id = i.sales_invoice_id
                LEFT JOIN douano_sales_line_cost_snapshots snap
                  ON snap.source_type = 'invoice'
                 AND snap.source_line_id = l.line_id
                LEFT JOIN (
                    SELECT version_id, sku_id, MAX(indirecte_kosten) AS indirecte_kosten, MAX(accijns) AS accijns
                    FROM cost_version_sku_rows
                    GROUP BY version_id, sku_id
                ) csr
                  ON csr.version_id = snap.kostprijsversie_id
                 AND csr.sku_id = snap.sku_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                LEFT JOIN douano_unmapped_rules r
                  ON l.douano_product_id = 0
                 AND r.match_type = 'product0_description'
                 AND r.douano_product_id = 0
                 AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig')
                WHERE i.company_id = %s
                {where}
                GROUP BY i.sales_invoice_id, i.invoice_date, i.invoice_number, i.transaction_type, i.is_sent
                ORDER BY i.invoice_date DESC, i.sales_invoice_id DESC
                LIMIT %s
                """,
                params,
            )
            rows = cur.fetchall() or []

    out: list[dict[str, Any]] = []
    for (
        sales_invoice_id,
        invoice_date,
        invoice_number,
        transaction_type,
        is_sent,
        lines,
        omzet_ex,
        korting_ex,
        charges_ex,
        netto_omzet_ex,
        ignored_lines,
        unmapped_lines,
        snapshot_cost_total,
        variable_cost_ex,
        variable_cost_with_excise_ex,
        missing_cost_lines,
    ) in rows:
        inv_id = int(sales_invoice_id or 0)
        cost_total = float(snapshot_cost_total or 0.0)
        margin = float(netto_omzet_ex or 0.0) - cost_total
        out.append(
            {
                "sales_invoice_id": inv_id,
                "invoice_date": str(invoice_date or ""),
                "invoice_number": str(invoice_number or ""),
                "transaction_type": str(transaction_type or ""),
                "is_sent": bool(is_sent),
                "lines": int(lines or 0),
                "omzet_ex": float(omzet_ex or 0),
                "korting_ex": float(korting_ex or 0),
                "charges_ex": float(charges_ex or 0),
                "netto_omzet_ex": float(netto_omzet_ex or 0),
                "kostprijs_ex": cost_total,
                "variabel_ex": float(variable_cost_ex or 0.0),
                "variabel_accijns_ex": float(variable_cost_with_excise_ex or 0.0),
                "brutomarge_ex": float(netto_omzet_ex or 0.0) - cost_total,
                "ignored_lines": int(ignored_lines or 0),
                "unmapped_lines": int(unmapped_lines or 0),
                "missing_cost_lines": int(missing_cost_lines or 0),
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
    from app.domain import douano_unmapped_rule_storage
    from app.domain import douano_sync_storage
    douano_unmapped_rule_storage.ensure_schema()
    douano_sync_storage.ensure_schema()
    postgres_storage.ensure_schema()
    oid = int(sales_order_id or 0)
    if oid <= 0:
        return []
    lim = max(1, min(int(limit or 2000), 5000))

    clauses: list[str] = ["l.sales_order_id = %s"]
    params: list[Any] = [oid]
    if only_unmapped:
        clauses.append("ig.douano_product_id IS NULL AND m.douano_product_id IS NULL AND r.rule_id IS NULL")
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
                    o.transaction_number,
                    l.douano_product_id,
                    COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), '') AS product_name,
                    p.sku,
                    l.quantity,
                    l.unit_price_ex,
                    l.discount_ex,
                    l.charges_total_ex,
                    l.net_revenue_ex,
                    m.sku_id,
                    ig.douano_product_id IS NOT NULL AS ignored
                FROM douano_sales_order_lines l
                JOIN douano_sales_orders o ON o.sales_order_id = l.sales_order_id
                LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                LEFT JOIN douano_unmapped_rules r
                  ON (
                    (l.douano_product_id <> 0 AND r.match_type = 'douano_product_id' AND r.douano_product_id = l.douano_product_id AND r.line_description = '')
                    OR (l.douano_product_id = 0 AND r.match_type = 'product0_description' AND r.douano_product_id = 0 AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig'))
                  )
                WHERE {where}
                ORDER BY l.line_id ASC
                LIMIT %s
                """,
                (*params, lim),
            )
            rows = cur.fetchall() or []

    frozen_snapshots = douano_margin_snapshot_storage.load_line_snapshots(
        source_type="order",
        source_line_ids=[int(row[0] or 0) for row in rows],
    )

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
    snapshot_components_index = _build_snapshot_components_index(used_version_ids)
    skus_payload = postgres_storage.load_dataset("skus", [])
    sku_info: dict[str, dict[str, str]] = {}
    if isinstance(skus_payload, list):
        for sku_row in skus_payload:
            if not isinstance(sku_row, dict):
                continue
            sid = str(sku_row.get("id", "") or "").strip()
            if not sid:
                continue
            sku_info[sid] = {
                "beer_id": str(sku_row.get("beer_id", "") or ""),
                "format_article_id": str(sku_row.get("format_article_id", "") or ""),
                "article_id": str(sku_row.get("article_id", "") or ""),
                "kind": str(sku_row.get("kind", "") or ""),
                "product_group": str(
                    sku_row.get("product_group", "")
                    or ((sku_row.get("payload") if isinstance(sku_row.get("payload"), dict) else {}) or {}).get("product_group", "")
                    or ""
                ),
            }
    packaging_component_cost_index = _build_packaging_component_cost_index()
    sku_composition_index = _build_sku_composition_index()

    resolution_context = _build_cost_resolution_context(
        [
            {"transaction_numbers": [str(transaction_number or "")], "sku_code": str(sku or "")}
            for (
                _line_id,
                _sales_order_id,
                _company_id,
                _order_date_raw,
                transaction_number,
                _douano_product_id,
                _product_name,
                sku,
                _quantity,
                _unit_price_ex,
                _discount_ex,
                _charges_total_ex,
                _net_revenue_ex,
                _sku_id,
                _ignored,
            ) in rows
        ],
        versions_by_id=versions_by_id,
        snapshot_cost_index=snapshot_cost_index,
    )
    authoritative_actual = ReadOnlyCostResolutionService(
        PostgresCostResolutionSnapshotReader()
    ).actual

    out: list[dict[str, Any]] = []
    for (
        line_id,
        _sales_order_id,
        company_id,
        order_date_raw,
        transaction_number,
        douano_product_id,
        product_name,
        sku,
        quantity,
        unit_price_ex,
        discount_ex,
        charges_total_ex,
        net_revenue_ex,
        sku_id,
        ignored,
    ) in rows:
        order_date = _parse_date(order_date_raw)
        frozen = frozen_snapshots.get(int(line_id or 0))
        sku_id_text = str((frozen or {}).get("sku_id", "") or sku_id or "")
        info = sku_info.get(sku_id_text, {})
        bier_id_text = str((frozen or {}).get("bier_id", "") or info.get("beer_id", "") or "")
        product_id_text = str((frozen or {}).get("product_id", "") or info.get("format_article_id", "") or "")
        sku_kind = str(info.get("kind", "") or "").strip().lower()
        sku_product_group = str(info.get("product_group", "") or "").strip().lower()
        lot_required = bool(sku_id_text) and sku_kind == "beer_format" and sku_product_group != "giftset"
        cost_unit: float | None = None
        cost_total = 0.0
        margin = 0.0
        missing_cost = False
        kostprijsversie_id = ""

        if frozen is not None:
            resolved_cost = frozen
            cost_unit = frozen.get("cost_price_ex")
            kostprijsversie_id = str(frozen.get("kostprijsversie_id", "") or "")
            missing_cost = bool(frozen.get("missing_cost"))
            cost_total = float(frozen.get("cost_total_ex", 0.0) or 0.0)
            margin = float(frozen.get("margin_ex", 0.0) or 0.0)
        elif sku_id_text and order_date is not None:
            resolved_cost = _resolve_authoritative_cost_for_sale(
                transaction_number=str(transaction_number or ""),
                transaction_numbers=None,
                douano_sku=str(sku or ""),
                sku_id=sku_id_text,
                as_of=order_date,
                quantity=quantity,
                actual_resolver=authoritative_actual,
                versions_by_id=versions_by_id,
                resolution_context=resolution_context,
                lot_required=lot_required,
            )
            cost_unit = resolved_cost.get("cost_price_ex")
            kostprijsversie_id = str(resolved_cost.get("kostprijsversie_id", "") or "")
            missing_cost = bool(resolved_cost.get("missing_cost"))
            cost_total = float(resolved_cost.get("cost_total_ex", 0.0) or 0.0)
            margin = float(net_revenue_ex or 0.0) - cost_total
        else:
            resolved_cost = {}

        if only_missing_cost and not missing_cost:
            continue
        cost_components = (
            resolved_cost.get("cost_components")
            if isinstance(resolved_cost.get("cost_components"), dict)
            else snapshot_components_index.get((kostprijsversie_id, sku_id_text), {})
            if kostprijsversie_id and sku_id_text
            else {}
        )
        variable_breakdown = _variable_cost_breakdown(
            cost_total=cost_total,
            quantity=quantity,
            components=cost_components,
        )

        item = {
            "line_id": int(line_id or 0),
            "sales_order_id": int(_sales_order_id or 0),
            "company_id": int(company_id or 0),
            "order_date": str(order_date_raw or ""),
            "transaction_number": str(transaction_number or ""),
            "douano_product_id": int(douano_product_id or 0),
            "douano_product_name": str(product_name or ""),
            "douano_sku": str(sku or ""),
            "quantity": float(quantity or 0),
            "unit_price_ex": float(unit_price_ex or 0),
            "discount_ex": float(discount_ex or 0),
            "charges_ex": float(charges_total_ex or 0),
            "net_revenue_ex": float(net_revenue_ex or 0),
            "sku_id": sku_id_text,
            "bier_id": bier_id_text,
            "product_id": product_id_text,
            "ignored": bool((frozen or {}).get("ignored", ignored)),
            "cost_price_ex": float(cost_unit or 0) if cost_unit is not None else None,
            "cost_total_ex": float(cost_total),
            "variabel_ex": float(variable_breakdown["variable_cost_ex"]),
            "variabel_accijns_ex": float(variable_breakdown["variable_cost_with_excise_ex"]),
            "margin_ex": float(margin),
            "missing_cost": bool(missing_cost),
            "mapped": bool((frozen or {}).get("mapped", bool(sku_id_text))),
            "lot_required": lot_required,
            "kostprijsversie_id": kostprijsversie_id,
            "kostprijsversie_label": str(resolved_cost.get("kostprijsversie_label", "") or ""),
            "cost_source": str(resolved_cost.get("cost_source", "") or ""),
            "lot_number": str(resolved_cost.get("lot_number", "") or ""),
            "lot_internal_number": str(resolved_cost.get("lot_internal_number", "") or ""),
            "lot_transaction_number": str(resolved_cost.get("lot_transaction_number", "") or ""),
            "lot_supplier": str(resolved_cost.get("lot_supplier", "") or ""),
            "lot_cost_missing": bool(resolved_cost.get("lot_cost_missing", False)),
            "lot_near_match_version_id": str(resolved_cost.get("lot_near_match_version_id", "") or ""),
            "lot_near_match_version_label": str(resolved_cost.get("lot_near_match_version_label", "") or ""),
            "lot_near_match_number": str(resolved_cost.get("lot_near_match_number", "") or ""),
            "resolution_warnings": list(resolved_cost.get("resolution_warnings", []) or []),
            "candidate_version_ids": list(resolved_cost.get("candidate_version_ids", []) or []),
        }
        item["cost_status"] = str((frozen or {}).get("cost_status", "") or _snapshot_cost_status(item))
        out.append(item)
    return out


def list_invoice_lines(
    *,
    sales_invoice_id: int,
    only_unmapped: bool = False,
    only_missing_cost: bool = False,
    limit: int = 2000,
) -> list[dict[str, Any]]:
    """List invoice lines for a sales invoice, with mapping + cost resolution."""
    douano_product_mapping_storage.ensure_schema()
    douano_product_ignore_storage.ensure_schema()
    from app.domain import douano_unmapped_rule_storage
    from app.domain import douano_sync_storage
    douano_unmapped_rule_storage.ensure_schema()
    douano_sync_storage.ensure_schema()
    postgres_storage.ensure_schema()
    iid = int(sales_invoice_id or 0)
    if iid <= 0:
        return []
    lim = max(1, min(int(limit or 2000), 5000))

    clauses: list[str] = ["l.sales_invoice_id = %s"]
    params: list[Any] = [iid]
    if only_unmapped:
        clauses.append("ig.douano_product_id IS NULL AND m.douano_product_id IS NULL AND r.rule_id IS NULL")
    if only_missing_cost:
        clauses.append("m.douano_product_id IS NOT NULL")
    where = " AND ".join(clauses)

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    l.line_id,
                    l.sales_invoice_id,
                    l.company_id,
                    l.invoice_date,
                    COALESCE((SELECT array_agg(tx.value) FROM jsonb_array_elements_text(i.invoiced_transaction_numbers) AS tx(value)), ARRAY[]::text[]) AS transaction_numbers,
                    l.douano_product_id,
                    COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), '') AS product_name,
                    p.sku,
                    l.quantity,
                    l.unit_price_ex,
                    l.discount_ex,
                    l.charges_total_ex,
                    l.net_revenue_ex,
                    m.sku_id,
                    ig.douano_product_id IS NOT NULL AS ignored
                FROM douano_sales_invoice_lines l
                JOIN douano_sales_invoices i ON i.sales_invoice_id = l.sales_invoice_id
                LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                LEFT JOIN douano_unmapped_rules r
                  ON (
                    (l.douano_product_id <> 0 AND r.match_type = 'douano_product_id' AND r.douano_product_id = l.douano_product_id AND r.line_description = '')
                    OR (l.douano_product_id = 0 AND r.match_type = 'product0_description' AND r.douano_product_id = 0 AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig'))
                  )
                WHERE {where}
                ORDER BY l.line_id ASC
                LIMIT %s
                """,
                (*params, lim),
            )
            rows = cur.fetchall() or []

    frozen_snapshots = douano_margin_snapshot_storage.load_line_snapshots(
        source_type="invoice",
        source_line_ids=[int(row[0] or 0) for row in rows],
    )

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
    snapshot_components_index = _build_snapshot_components_index(used_version_ids)
    skus_payload = postgres_storage.load_dataset("skus", [])
    sku_info: dict[str, dict[str, str]] = {}
    if isinstance(skus_payload, list):
        for sku_row in skus_payload:
            if not isinstance(sku_row, dict):
                continue
            sid = str(sku_row.get("id", "") or "").strip()
            if not sid:
                continue
            sku_info[sid] = {
                "beer_id": str(sku_row.get("beer_id", "") or ""),
                "format_article_id": str(sku_row.get("format_article_id", "") or ""),
                "article_id": str(sku_row.get("article_id", "") or ""),
                "kind": str(sku_row.get("kind", "") or ""),
                "product_group": str(
                    sku_row.get("product_group", "")
                    or ((sku_row.get("payload") if isinstance(sku_row.get("payload"), dict) else {}) or {}).get("product_group", "")
                    or ""
                ),
            }
    packaging_component_cost_index = _build_packaging_component_cost_index()
    sku_composition_index = _build_sku_composition_index()

    resolution_context = _build_cost_resolution_context(
        [
            {"transaction_numbers": [str(tx or "") for tx in (transaction_numbers or [])], "sku_code": str(sku or "")}
            for (
                _line_id,
                _sales_invoice_id,
                _company_id,
                _invoice_date_raw,
                transaction_numbers,
                _douano_product_id,
                _product_name,
                sku,
                _quantity,
                _unit_price_ex,
                _discount_ex,
                _charges_total_ex,
                _net_revenue_ex,
                _sku_id,
                _ignored,
            ) in rows
        ],
        versions_by_id=versions_by_id,
        snapshot_cost_index=snapshot_cost_index,
    )
    authoritative_actual = ReadOnlyCostResolutionService(
        PostgresCostResolutionSnapshotReader()
    ).actual

    out: list[dict[str, Any]] = []
    for (
        line_id,
        _sales_invoice_id,
        company_id,
        invoice_date_raw,
        transaction_numbers,
        douano_product_id,
        product_name,
        sku,
        quantity,
        unit_price_ex,
        discount_ex,
        charges_total_ex,
        net_revenue_ex,
        sku_id,
        ignored,
    ) in rows:
        tx_candidates = [str(tx or "") for tx in (transaction_numbers or []) if str(tx or "")]
        transaction_number = tx_candidates[0] if tx_candidates else ""
        invoice_date = _parse_date(invoice_date_raw)
        frozen = frozen_snapshots.get(int(line_id or 0))
        sku_id_text = str((frozen or {}).get("sku_id", "") or sku_id or "")
        info = sku_info.get(sku_id_text, {})
        bier_id_text = str((frozen or {}).get("bier_id", "") or info.get("beer_id", "") or "")
        product_id_text = str((frozen or {}).get("product_id", "") or info.get("format_article_id", "") or "")
        sku_kind = str(info.get("kind", "") or "").strip().lower()
        sku_product_group = str(info.get("product_group", "") or "").strip().lower()
        lot_required = bool(sku_id_text) and sku_kind == "beer_format" and sku_product_group != "giftset"
        cost_unit: float | None = None
        cost_total = 0.0
        margin = 0.0
        missing_cost = False
        kostprijsversie_id = ""

        if frozen is not None:
            resolved_cost = frozen
            cost_unit = frozen.get("cost_price_ex")
            kostprijsversie_id = str(frozen.get("kostprijsversie_id", "") or "")
            missing_cost = bool(frozen.get("missing_cost"))
            cost_total = float(frozen.get("cost_total_ex", 0.0) or 0.0)
            margin = float(frozen.get("margin_ex", 0.0) or 0.0)
        elif sku_id_text and invoice_date is not None:
            resolved_cost = _resolve_authoritative_cost_for_sale(
                transaction_number=transaction_number,
                transaction_numbers=tx_candidates,
                douano_sku=str(sku or ""),
                sku_id=sku_id_text,
                as_of=invoice_date,
                quantity=quantity,
                actual_resolver=authoritative_actual,
                versions_by_id=versions_by_id,
                resolution_context=resolution_context,
                lot_required=lot_required,
            )
            cost_unit = resolved_cost.get("cost_price_ex")
            kostprijsversie_id = str(resolved_cost.get("kostprijsversie_id", "") or "")
            missing_cost = bool(resolved_cost.get("missing_cost"))
            cost_total = float(resolved_cost.get("cost_total_ex", 0.0) or 0.0)
            margin = float(net_revenue_ex or 0.0) - cost_total
        else:
            resolved_cost = {}

        if only_missing_cost and not missing_cost:
            continue
        cost_components = (
            resolved_cost.get("cost_components")
            if isinstance(resolved_cost.get("cost_components"), dict)
            else snapshot_components_index.get((kostprijsversie_id, sku_id_text), {})
            if kostprijsversie_id and sku_id_text
            else {}
        )
        variable_breakdown = _variable_cost_breakdown(
            cost_total=cost_total,
            quantity=quantity,
            components=cost_components,
        )

        item = {
            "line_id": int(line_id or 0),
            "sales_invoice_id": int(_sales_invoice_id or 0),
            "company_id": int(company_id or 0),
            "invoice_date": str(invoice_date_raw or ""),
            "transaction_number": str(transaction_number or ""),
            "douano_product_id": int(douano_product_id or 0),
            "douano_product_name": str(product_name or ""),
            "douano_sku": str(sku or ""),
            "quantity": float(quantity or 0),
            "unit_price_ex": float(unit_price_ex or 0),
            "discount_ex": float(discount_ex or 0),
            "charges_ex": float(charges_total_ex or 0),
            "net_revenue_ex": float(net_revenue_ex or 0),
            "sku_id": sku_id_text,
            "bier_id": bier_id_text,
            "product_id": product_id_text,
            "ignored": bool((frozen or {}).get("ignored", ignored)),
            "cost_price_ex": float(cost_unit or 0) if cost_unit is not None else None,
            "cost_total_ex": float(cost_total),
            "variabel_ex": float(variable_breakdown["variable_cost_ex"]),
            "variabel_accijns_ex": float(variable_breakdown["variable_cost_with_excise_ex"]),
            "margin_ex": float(margin),
            "missing_cost": bool(missing_cost),
            "mapped": bool((frozen or {}).get("mapped", bool(sku_id_text))),
            "lot_required": lot_required,
            "kostprijsversie_id": kostprijsversie_id,
            "kostprijsversie_label": str(resolved_cost.get("kostprijsversie_label", "") or ""),
            "cost_source": str(resolved_cost.get("cost_source", "") or ""),
            "lot_number": str(resolved_cost.get("lot_number", "") or ""),
            "lot_internal_number": str(resolved_cost.get("lot_internal_number", "") or ""),
            "lot_transaction_number": str(resolved_cost.get("lot_transaction_number", "") or ""),
            "lot_supplier": str(resolved_cost.get("lot_supplier", "") or ""),
            "lot_cost_missing": bool(resolved_cost.get("lot_cost_missing", False)),
            "lot_near_match_version_id": str(resolved_cost.get("lot_near_match_version_id", "") or ""),
            "lot_near_match_version_label": str(resolved_cost.get("lot_near_match_version_label", "") or ""),
            "lot_near_match_number": str(resolved_cost.get("lot_near_match_number", "") or ""),
            "resolution_warnings": list(resolved_cost.get("resolution_warnings", []) or []),
            "candidate_version_ids": list(resolved_cost.get("candidate_version_ids", []) or []),
        }
        item["cost_status"] = str((frozen or {}).get("cost_status", "") or _snapshot_cost_status(item))
        out.append(item)
    return out


def _snapshot_cost_status(line: dict[str, Any]) -> str:
    if bool(line.get("ignored")):
        return "ignored"
    if str(line.get("cost_source", "") or "").strip().lower() == "no_cost_required":
        return "no_cost_required"
    if not bool(line.get("mapped")):
        return "unmapped_sku"
    authoritative_status = str(
        line.get("actual_resolution_status", "") or ""
    ).strip()
    if authoritative_status:
        return authoritative_status
    if bool(line.get("missing_cost")):
        return "missing_lot_cost" if str(line.get("lot_number", "") or "").strip() else "missing_cost"
    source = str(line.get("cost_source", "") or "").strip().lower()
    if source in {"lot", "cost_version_lot"}:
        return "resolved_lot_cost"
    if source in {"lot_alias", "cost_version_lot_alias", "manual_internal_lot", "cost_version_manual_internal_lot"}:
        return "resolved_lot_alias"
    if source == "sku_composition":
        return "resolved_sku_composition"
    if source == "baseline":
        if not bool(line.get("lot_required")):
            return "resolved_active_sku_cost"
        if str(line.get("lot_number", "") or "").strip():
            if str(line.get("lot_near_match_number", "") or "").strip():
                return "lot_near_match_fallback"
            return "lot_unmatched_fallback"
        return "fallback_active_sku_cost"
    return "resolved"


def _persist_line_snapshot(*, source_type: str, line: dict[str, Any]) -> bool:
    record = _line_snapshot_record(source_type=source_type, line=line)
    if not record:
        return False
    douano_margin_snapshot_storage.upsert_line_snapshot(**record)
    return True


def _line_snapshot_record(*, source_type: str, line: dict[str, Any]) -> dict[str, Any] | None:
    line_id = int(line.get("line_id", 0) or 0)
    if line_id <= 0:
        return None
    date_key = "invoice_date" if source_type == "invoice" else "order_date"
    margin_ex = line.get("margin_ex")
    if margin_ex is None:
        margin_ex = float(line.get("net_revenue_ex", 0.0) or 0.0) - float(line.get("cost_total_ex", 0.0) or 0.0)
    return {
        "source_type": source_type,
        "source_line_id": line_id,
        "company_id": int(line.get("company_id", 0) or 0),
        "line_date": str(line.get(date_key, "") or ""),
        "douano_product_id": int(line.get("douano_product_id", 0) or 0),
        "douano_sku": str(line.get("douano_sku", "") or ""),
        "sku_id": str(line.get("sku_id", "") or ""),
        "bier_id": str(line.get("bier_id", "") or ""),
        "product_id": str(line.get("product_id", "") or ""),
        "lot_number": str(line.get("lot_number", "") or ""),
        "lot_internal_number": str(line.get("lot_internal_number", "") or ""),
        "lot_transaction_number": str(line.get("lot_transaction_number", "") or ""),
        "cost_source": str(line.get("cost_source", "") or ""),
        "cost_status": _snapshot_cost_status(line),
        "kostprijsversie_id": str(line.get("kostprijsversie_id", "") or ""),
        "kostprijsversie_label": str(line.get("kostprijsversie_label", "") or ""),
        "quantity": float(line.get("quantity", 0.0) or 0.0),
        "net_revenue_ex": float(line.get("net_revenue_ex", 0.0) or 0.0),
        "cost_price_ex": line.get("cost_price_ex", None),
        "cost_total_ex": float(line.get("cost_total_ex", 0.0) or 0.0),
        "margin_ex": float(margin_ex or 0.0),
        "missing_cost": bool(line.get("missing_cost")),
        "mapped": bool(line.get("mapped")),
        "ignored": bool(line.get("ignored")),
        "payload": {
            "transaction_number": str(line.get("transaction_number", "") or ""),
            "douano_product_name": str(line.get("douano_product_name", "") or ""),
            "lot_supplier": str(line.get("lot_supplier", "") or ""),
            "lot_cost_missing": bool(line.get("lot_cost_missing", False)),
            "lot_near_match_version_id": str(line.get("lot_near_match_version_id", "") or ""),
            "lot_near_match_version_label": str(line.get("lot_near_match_version_label", "") or ""),
            "lot_near_match_number": str(line.get("lot_near_match_number", "") or ""),
            "actual_resolution_status": str(line.get("actual_resolution_status", "") or ""),
            "cost_row_id": str(line.get("cost_row_id", "") or ""),
            "cost_components": (
                dict(line.get("cost_components") or {})
                if isinstance(line.get("cost_components"), dict)
                else {}
            ),
            "resolution_warnings": list(line.get("resolution_warnings", []) or []),
            "candidate_mapping_ids": list(line.get("candidate_mapping_ids", []) or []),
            "candidate_lot_ids": list(line.get("candidate_lot_ids", []) or []),
            "candidate_version_ids": list(line.get("candidate_version_ids", []) or []),
            "candidate_cost_row_ids": list(line.get("candidate_cost_row_ids", []) or []),
            "candidate_lot_cost_record_ids": list(line.get("candidate_lot_cost_record_ids", []) or []),
            "resolution_policy_version": str(line.get("resolution_policy_version", "") or ""),
        },
    }


def _build_snapshot_run_context() -> dict[str, Any]:
    authority_snapshot = (
        PostgresCostResolutionSnapshotReader().read_cost_resolution_snapshot()
    )
    actual_cost_resolver = ActualLotCostResolver(authority_snapshot)
    with postgres_storage.connect() as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        active_year_rows = conn.execute(
            """
            SELECT operational_year
            FROM commercial_yearsets
            WHERE status = 'active'
            ORDER BY activated_at DESC NULLS LAST, id
            """
        ).fetchall()
        conn.rollback()
    if len(active_year_rows) != 1:
        raise RuntimeError(
            "Er moet exact één actieve commerciële jaarset zijn; actual-cost snapshots worden niet herberekend."
        )
    active_commercial_year = int(active_year_rows[0][0] or 0)
    if active_commercial_year <= 0:
        raise RuntimeError(
            "De actieve commerciële jaarset heeft geen geldig jaar; actual-cost snapshots worden niet herberekend."
        )
    versions_by_id = {
        str(row.get("id", "") or ""): dict(row)
        for row in authority_snapshot.cost_versions
        if str(row.get("id", "") or "").strip()
    }
    skus_payload = list(authority_snapshot.skus)
    sku_info: dict[str, dict[str, str]] = {}
    if isinstance(skus_payload, list):
        for sku_row in skus_payload:
            if not isinstance(sku_row, dict):
                continue
            sid = str(sku_row.get("id", "") or "").strip()
            if not sid:
                continue
            sku_info[sid] = {
                "beer_id": str(sku_row.get("beer_id", "") or ""),
                "format_article_id": str(sku_row.get("format_article_id", "") or ""),
                "article_id": str(sku_row.get("article_id", "") or ""),
                "kind": str(sku_row.get("kind", "") or ""),
                "product_group": str(
                    sku_row.get("product_group", "")
                    or ((sku_row.get("payload") if isinstance(sku_row.get("payload"), dict) else {}) or {}).get("product_group", "")
                    or ""
                ),
            }
    douano_unmapped_rule_storage.ensure_schema()
    unmapped_rules_by_product_id: dict[int, dict[str, Any]] = {}
    unmapped_rules_by_description: dict[str, dict[str, Any]] = {}

    def _rule_priority(rule: dict[str, Any] | None) -> int:
        action = str((rule or {}).get("action", "") or "").strip()
        if action == "no_cost_required":
            return 30
        if action == "map_to_sku":
            return 20
        if action == "categorize":
            return 10
        return 0

    for rule in douano_unmapped_rule_storage.list_rules(limit=50000):
        if str(rule.get("action", "") or "").strip() not in {"no_cost_required", "categorize", "map_to_sku"}:
            continue
        match_type = str(rule.get("match_type", "") or "").strip()
        if match_type == "douano_product_id":
            product_id = int(rule.get("douano_product_id", 0) or 0)
            if product_id > 0 and _rule_priority(rule) >= _rule_priority(unmapped_rules_by_product_id.get(product_id)):
                unmapped_rules_by_product_id[product_id] = rule
        elif match_type == "product0_description":
            desc_key = str(rule.get("line_description", "") or "").strip().lower()
            if desc_key and _rule_priority(rule) >= _rule_priority(unmapped_rules_by_description.get(desc_key)):
                unmapped_rules_by_description[desc_key] = rule
    return {
        "actual_cost_resolver": actual_cost_resolver,
        "active_commercial_year": active_commercial_year,
        "versions_by_id": versions_by_id,
        "sku_info": sku_info,
        "unmapped_rules_by_product_id": unmapped_rules_by_product_id,
        "unmapped_rules_by_description": unmapped_rules_by_description,
    }


def _resolve_snapshot_batch(
    *,
    source_type: str,
    rows: list[tuple[Any, ...]],
    run_context: dict[str, Any],
) -> list[dict[str, Any]]:
    if not rows:
        return []
    sales_refs: list[dict[str, Any]] = []
    for row in rows:
        if source_type == "invoice":
            transaction_numbers = [str(tx or "") for tx in (row[4] or []) if str(tx or "")]
            sku = str(row[7] or "")
        else:
            transaction_numbers = [str(row[4] or "")] if str(row[4] or "") else []
            sku = str(row[7] or "")
        sales_refs.append({"transaction_numbers": transaction_numbers, "sku_code": sku})
    resolution_context = _build_sales_lot_context(sales_refs)

    out: list[dict[str, Any]] = []
    sku_info: dict[str, dict[str, str]] = run_context["sku_info"]
    rules_by_product_id: dict[int, dict[str, Any]] = run_context.get("unmapped_rules_by_product_id", {})
    rules_by_description: dict[str, dict[str, Any]] = run_context.get("unmapped_rules_by_description", {})
    for row in rows:
        (
            line_id,
            document_id,
            company_id,
            line_date_raw,
            transaction_data,
            douano_product_id,
            product_name,
            sku,
            quantity,
            unit_price_ex,
            discount_ex,
            charges_total_ex,
            net_revenue_ex,
            sku_id,
            ignored,
        ) = row
        tx_candidates = (
            [str(tx or "") for tx in (transaction_data or []) if str(tx or "")]
            if source_type == "invoice"
            else ([str(transaction_data or "")] if str(transaction_data or "") else [])
        )
        transaction_number = tx_candidates[0] if tx_candidates else ""
        line_date = _parse_date(line_date_raw)
        product_name_text = str(product_name or "")
        rule = rules_by_product_id.get(int(douano_product_id or 0))
        if rule is None:
            rule = rules_by_description.get(product_name_text.strip().lower())
        rule_action = str((rule or {}).get("action", "") or "").strip()
        no_cost_required = rule_action == "no_cost_required"
        rule_internal_lot_number = str((rule or {}).get("internal_lot_number", "") or "").strip()
        sku_id_text = str(sku_id or "")
        info = sku_info.get(sku_id_text, {})
        bier_id_text = str(info.get("beer_id", "") or "")
        product_id_text = str(info.get("format_article_id", "") or "")
        sku_kind = str(info.get("kind", "") or "").strip().lower()
        sku_product_group = str(info.get("product_group", "") or "").strip().lower()
        lot_required = bool(sku_id_text) and sku_kind == "beer_format" and sku_product_group != "giftset"
        resolved_cost: dict[str, Any] = {}
        cost_unit: float | None = None
        cost_total = 0.0
        margin = 0.0
        missing_cost = False
        kostprijsversie_id = ""
        if line_date is not None and (bool(ignored) or no_cost_required or sku_id_text):
            resolved_cost = _resolve_authoritative_cost_for_sale(
                transaction_number=transaction_number,
                transaction_numbers=tx_candidates,
                douano_sku=str(sku or ""),
                sku_id=sku_id_text,
                as_of=line_date,
                quantity=quantity,
                actual_resolver=run_context["actual_cost_resolver"],
                versions_by_id=run_context["versions_by_id"],
                resolution_context=resolution_context,
                lot_required=lot_required,
                cost_requirement=(
                    "ignored"
                    if bool(ignored)
                    else "not_required"
                    if no_cost_required
                    else "required"
                ),
                internal_lot_number_override=rule_internal_lot_number,
            )
            cost_unit = resolved_cost.get("cost_price_ex")
            kostprijsversie_id = str(resolved_cost.get("kostprijsversie_id", "") or "")
            missing_cost = bool(resolved_cost.get("missing_cost"))
            cost_total = float(resolved_cost.get("cost_total_ex", 0.0) or 0.0)
            margin = float(net_revenue_ex or 0.0) - cost_total

        line: dict[str, Any] = {
            "line_id": int(line_id or 0),
            "company_id": int(company_id or 0),
            "transaction_number": str(transaction_number or ""),
            "douano_product_id": int(douano_product_id or 0),
            "douano_product_name": product_name_text,
            "douano_sku": str(sku or ""),
            "quantity": float(quantity or 0),
            "unit_price_ex": float(unit_price_ex or 0),
            "discount_ex": float(discount_ex or 0),
            "charges_ex": float(charges_total_ex or 0),
            "net_revenue_ex": float(net_revenue_ex or 0),
            "sku_id": sku_id_text,
            "bier_id": bier_id_text,
            "product_id": product_id_text,
            "ignored": bool(ignored),
            "cost_price_ex": float(cost_unit or 0) if cost_unit is not None else None,
            "cost_total_ex": float(cost_total),
            "margin_ex": float(margin),
            "missing_cost": bool(missing_cost),
            "mapped": bool(sku_id_text) or no_cost_required,
            "lot_required": lot_required,
            "kostprijsversie_id": kostprijsversie_id,
            "kostprijsversie_label": str(resolved_cost.get("kostprijsversie_label", "") or ""),
            "cost_source": str(resolved_cost.get("cost_source", "") or ""),
            "lot_number": str(resolved_cost.get("lot_number", "") or ""),
            "lot_internal_number": str(resolved_cost.get("lot_internal_number", "") or ""),
            "lot_transaction_number": str(resolved_cost.get("lot_transaction_number", "") or ""),
            "lot_supplier": str(resolved_cost.get("lot_supplier", "") or ""),
            "lot_cost_missing": bool(resolved_cost.get("lot_cost_missing", False)),
            "lot_near_match_version_id": str(resolved_cost.get("lot_near_match_version_id", "") or ""),
            "lot_near_match_version_label": str(resolved_cost.get("lot_near_match_version_label", "") or ""),
            "lot_near_match_number": str(resolved_cost.get("lot_near_match_number", "") or ""),
            "actual_resolution_status": str(resolved_cost.get("actual_resolution_status", "") or ""),
            "cost_row_id": str(resolved_cost.get("cost_row_id", "") or ""),
            "cost_components": (
                dict(resolved_cost.get("cost_components") or {})
                if isinstance(resolved_cost.get("cost_components"), dict)
                else {}
            ),
            "resolution_warnings": list(resolved_cost.get("resolution_warnings", []) or []),
            "candidate_mapping_ids": list(resolved_cost.get("candidate_mapping_ids", []) or []),
            "candidate_lot_ids": list(resolved_cost.get("candidate_lot_ids", []) or []),
            "candidate_version_ids": list(resolved_cost.get("candidate_version_ids", []) or []),
            "candidate_cost_row_ids": list(resolved_cost.get("candidate_cost_row_ids", []) or []),
            "candidate_lot_cost_record_ids": list(resolved_cost.get("candidate_lot_cost_record_ids", []) or []),
            "resolution_policy_version": str(resolved_cost.get("resolution_policy_version", "") or ""),
        }
        if source_type == "invoice":
            line["sales_invoice_id"] = int(document_id or 0)
            line["invoice_date"] = str(line_date_raw or "")
        else:
            line["sales_order_id"] = int(document_id or 0)
            line["order_date"] = str(line_date_raw or "")
        out.append(line)
    return out


def backfill_line_snapshots(
    *,
    since: str = "",
    until: str = "",
    company_id: int = 0,
    limit: int = 5000,
    basis: str = "both",
) -> dict[str, Any]:
    """Compute and store cost snapshots for sales lines.

    Page loads read these snapshots. Expensive LOT/cost matching is intentionally
    kept in this explicit backfill/sync path and in line-detail screens.
    """
    douano_margin_snapshot_storage.ensure_schema()
    source_basis = str(basis or "both").strip().lower()
    if source_basis not in {"order", "invoice", "both"}:
        raise ValueError("basis must be 'order', 'invoice', or 'both'.")
    since_text = (since or "").strip()
    until_text = (until or "").strip()
    lim = max(1, min(int(limit or 5000), 50000))
    batch_size = 1000
    run_context = _build_snapshot_run_context()

    computed = 0
    missing = 0
    documents: set[tuple[str, int]] = set()

    if source_basis in {"order", "both"}:
        base_clauses: list[str] = []
        base_params: list[Any] = []
        if company_id:
            base_clauses.append("l.company_id = %s")
            base_params.append(int(company_id))
        if since_text:
            base_clauses.append("l.order_date >= %s::date")
            base_params.append(since_text)
        if until_text:
            base_clauses.append("l.order_date < %s::date")
            base_params.append(until_text)
        processed = 0
        last_line_id = 0
        while processed < lim:
            page_limit = min(batch_size, lim - processed)
            clauses = list(base_clauses)
            params = list(base_params)
            if last_line_id:
                clauses.append("l.line_id < %s")
                params.append(last_line_id)
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        f"""
                        SELECT
                            l.line_id,
                            l.sales_order_id,
                            l.company_id,
                            l.order_date,
                            o.transaction_number,
                            l.douano_product_id,
                            COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), '') AS product_name,
                            p.sku,
                            l.quantity,
                            l.unit_price_ex,
                            l.discount_ex,
                            l.charges_total_ex,
                            l.net_revenue_ex,
                            COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) AS sku_id,
                            ig.douano_product_id IS NOT NULL AS ignored
                        FROM douano_sales_order_lines l
                        JOIN douano_sales_orders o ON o.sales_order_id = l.sales_order_id
                        LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                        LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                        LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                        LEFT JOIN douano_unmapped_rules r
                          ON l.douano_product_id = 0
                         AND r.match_type = 'product0_description'
                         AND r.douano_product_id = 0
                         AND r.action = 'map_to_sku'
                         AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig')
                        {where}
                        ORDER BY l.line_id DESC
                        LIMIT %s
                        """,
                        (*params, page_limit),
                    )
                    rows = cur.fetchall() or []
            if not rows:
                break
            last_line_id = int(rows[-1][0] or 0)
            lines = _resolve_snapshot_batch(source_type="order", rows=list(rows), run_context=run_context)
            records = [
                record for line in lines
                if (record := _line_snapshot_record(source_type="order", line=line)) is not None
            ]
            computed += douano_margin_snapshot_storage.upsert_line_snapshots(
                records,
                preserve_finalized=True,
                recompute_from_year=int(run_context["active_commercial_year"]),
            )
            for line in lines:
                documents.add(("order", int(line.get("sales_order_id", 0) or 0)))
                if line.get("missing_cost"):
                    missing += 1
            if len(rows) < page_limit:
                break
            processed += len(rows)

    if source_basis in {"invoice", "both"}:
        base_clauses = []
        base_params = []
        if company_id:
            base_clauses.append("l.company_id = %s")
            base_params.append(int(company_id))
        if since_text:
            base_clauses.append("l.invoice_date >= %s::date")
            base_params.append(since_text)
        if until_text:
            base_clauses.append("l.invoice_date < %s::date")
            base_params.append(until_text)
        processed = 0
        last_line_id = 0
        while processed < lim:
            page_limit = min(batch_size, lim - processed)
            clauses = list(base_clauses)
            params = list(base_params)
            if last_line_id:
                clauses.append("l.line_id < %s")
                params.append(last_line_id)
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        f"""
                        SELECT
                            l.line_id,
                            l.sales_invoice_id,
                            l.company_id,
                            l.invoice_date,
                            COALESCE((SELECT array_agg(tx.value) FROM jsonb_array_elements_text(i.invoiced_transaction_numbers) AS tx(value)), ARRAY[]::text[]) AS transaction_numbers,
                            l.douano_product_id,
                            COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), '') AS product_name,
                            p.sku,
                            l.quantity,
                            l.unit_price_ex,
                            l.discount_ex,
                            l.charges_total_ex,
                            l.net_revenue_ex,
                            COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) AS sku_id,
                            ig.douano_product_id IS NOT NULL AS ignored
                        FROM douano_sales_invoice_lines l
                        JOIN douano_sales_invoices i ON i.sales_invoice_id = l.sales_invoice_id
                        LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                        LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                        LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                        LEFT JOIN douano_unmapped_rules r
                          ON l.douano_product_id = 0
                         AND r.match_type = 'product0_description'
                         AND r.douano_product_id = 0
                         AND r.action = 'map_to_sku'
                         AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig')
                        {where}
                        ORDER BY l.line_id DESC
                        LIMIT %s
                        """,
                        (*params, page_limit),
                    )
                    rows = cur.fetchall() or []
            if not rows:
                break
            last_line_id = int(rows[-1][0] or 0)
            lines = _resolve_snapshot_batch(source_type="invoice", rows=list(rows), run_context=run_context)
            records = [
                record for line in lines
                if (record := _line_snapshot_record(source_type="invoice", line=line)) is not None
            ]
            computed += douano_margin_snapshot_storage.upsert_line_snapshots(
                records,
                preserve_finalized=True,
                recompute_from_year=int(run_context["active_commercial_year"]),
            )
            for line in lines:
                documents.add(("invoice", int(line.get("sales_invoice_id", 0) or 0)))
                if line.get("missing_cost"):
                    missing += 1
            if len(rows) < page_limit:
                break
            processed += len(rows)

    return {
        "computed": computed,
        "missing_cost": missing,
        "documents": len(documents),
        "basis": source_basis,
        "since": since_text,
        "until": until_text,
    }


def backfill_line_snapshots_for_year(
    *,
    year: int,
    limit: int = 50000,
    basis: str = "both",
) -> dict[str, Any]:
    year_value = int(year or 0)
    if year_value <= 0:
        return {"computed": 0, "missing_cost": 0, "documents": 0, "basis": str(basis or "both"), "year": year_value}
    result = backfill_line_snapshots(
        since=f"{year_value}-01-01",
        until=f"{year_value + 1}-01-01",
        basis=basis,
        limit=limit,
    )
    result["year"] = year_value
    return result


def backfill_line_snapshots_for_lots(
    *,
    lot_numbers: Iterable[str],
    limit: int = 50000,
    basis: str = "both",
) -> dict[str, Any]:
    """Recompute stored margin snapshots for sales rows that use Douano LOTs.

    This is intentionally narrower than a full backfill. It is used after an
    internal LOT correction: Douano LOTs on sales rows are the source of truth,
    and changing the internal LOT only changes how those existing sales rows
    resolve their cost version.
    """
    douano_margin_snapshot_storage.ensure_schema()
    lot_costs_storage.ensure_schema()
    source_basis = str(basis or "both").strip().lower()
    if source_basis not in {"order", "invoice", "both"}:
        raise ValueError("basis must be 'order', 'invoice', or 'both'.")
    lots = sorted({str(lot or "").strip() for lot in lot_numbers if str(lot or "").strip()})
    if not lots:
        return {"computed": 0, "missing_cost": 0, "documents": 0, "basis": source_basis, "lots": []}
    lot_keys = [lot.lower() for lot in lots]
    lim = max(1, min(int(limit or 50000), 50000))
    run_context = _build_snapshot_run_context()

    computed = 0
    missing = 0
    documents: set[tuple[str, int]] = set()

    if source_basis in {"order", "both"}:
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        l.line_id,
                        l.sales_order_id,
                        l.company_id,
                        l.order_date,
                        o.transaction_number,
                        l.douano_product_id,
                        COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), '') AS product_name,
                        p.sku,
                        l.quantity,
                        l.unit_price_ex,
                        l.discount_ex,
                        l.charges_total_ex,
                        l.net_revenue_ex,
                        COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) AS sku_id,
                        ig.douano_product_id IS NOT NULL AS ignored
                    FROM douano_sales_order_lines l
                    JOIN douano_sales_orders o ON o.sales_order_id = l.sales_order_id
                    LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                    LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_unmapped_rules r
                      ON l.douano_product_id = 0
                     AND r.match_type = 'product0_description'
                     AND r.douano_product_id = 0
                     AND r.action = 'map_to_sku'
                     AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig')
                    WHERE EXISTS (
                        SELECT 1
                        FROM sales_lot_allocations a
                        WHERE a.transaction_number = o.transaction_number
                          AND LOWER(a.sku_code) = LOWER(COALESCE(p.sku, ''))
                          AND LOWER(a.lot_number) = ANY(%s::text[])
                    )
                    ORDER BY l.line_id DESC
                    LIMIT %s
                    """,
                    (lot_keys, lim),
                )
                rows = cur.fetchall() or []
        lines = _resolve_snapshot_batch(source_type="order", rows=list(rows), run_context=run_context)
        records = [
            record for line in lines
            if (record := _line_snapshot_record(source_type="order", line=line)) is not None
        ]
        computed += douano_margin_snapshot_storage.upsert_line_snapshots(records)
        for line in lines:
            documents.add(("order", int(line.get("sales_order_id", 0) or 0)))
            if line.get("missing_cost"):
                missing += 1

    if source_basis in {"invoice", "both"}:
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        l.line_id,
                        l.sales_invoice_id,
                        l.company_id,
                        l.invoice_date,
                        COALESCE((SELECT array_agg(tx.value) FROM jsonb_array_elements_text(i.invoiced_transaction_numbers) AS tx(value)), ARRAY[]::text[]) AS transaction_numbers,
                        l.douano_product_id,
                        COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), '') AS product_name,
                        p.sku,
                        l.quantity,
                        l.unit_price_ex,
                        l.discount_ex,
                        l.charges_total_ex,
                        l.net_revenue_ex,
                        COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) AS sku_id,
                        ig.douano_product_id IS NOT NULL AS ignored
                    FROM douano_sales_invoice_lines l
                    JOIN douano_sales_invoices i ON i.sales_invoice_id = l.sales_invoice_id
                    LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                    LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_unmapped_rules r
                      ON l.douano_product_id = 0
                     AND r.match_type = 'product0_description'
                     AND r.douano_product_id = 0
                     AND r.action = 'map_to_sku'
                     AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig')
                    WHERE EXISTS (
                        SELECT 1
                        FROM sales_lot_allocations a
                        JOIN jsonb_array_elements_text(i.invoiced_transaction_numbers) tx(value)
                          ON tx.value = a.transaction_number
                        WHERE LOWER(a.sku_code) = LOWER(COALESCE(p.sku, ''))
                          AND LOWER(a.lot_number) = ANY(%s::text[])
                    )
                    ORDER BY l.line_id DESC
                    LIMIT %s
                    """,
                    (lot_keys, lim),
                )
                rows = cur.fetchall() or []
        lines = _resolve_snapshot_batch(source_type="invoice", rows=list(rows), run_context=run_context)
        records = [
            record for line in lines
            if (record := _line_snapshot_record(source_type="invoice", line=line)) is not None
        ]
        computed += douano_margin_snapshot_storage.upsert_line_snapshots(records)
        for line in lines:
            documents.add(("invoice", int(line.get("sales_invoice_id", 0) or 0)))
            if line.get("missing_cost"):
                missing += 1

    return {
        "computed": computed,
        "missing_cost": missing,
        "documents": len(documents),
        "basis": source_basis,
        "lots": lots,
    }


def backfill_line_snapshots_for_douano_products(
    *,
    douano_product_ids: Iterable[int],
    limit: int = 50000,
    basis: str = "both",
) -> dict[str, Any]:
    """Recompute snapshots for sales rows whose product mapping/ignore state changed."""
    douano_margin_snapshot_storage.ensure_schema()
    source_basis = str(basis or "both").strip().lower()
    if source_basis not in {"order", "invoice", "both"}:
        raise ValueError("basis must be 'order', 'invoice', or 'both'.")
    product_ids = sorted({int(pid or 0) for pid in douano_product_ids if int(pid or 0) > 0})
    if not product_ids:
        return {"computed": 0, "missing_cost": 0, "documents": 0, "basis": source_basis, "douano_product_ids": []}
    lim = max(1, min(int(limit or 50000), 50000))
    run_context = _build_snapshot_run_context()

    computed = 0
    missing = 0
    documents: set[tuple[str, int]] = set()

    if source_basis in {"order", "both"}:
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        l.line_id,
                        l.sales_order_id,
                        l.company_id,
                        l.order_date,
                        o.transaction_number,
                        l.douano_product_id,
                        COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), '') AS product_name,
                        p.sku,
                        l.quantity,
                        l.unit_price_ex,
                        l.discount_ex,
                        l.charges_total_ex,
                        l.net_revenue_ex,
                        COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) AS sku_id,
                        ig.douano_product_id IS NOT NULL AS ignored
                    FROM douano_sales_order_lines l
                    JOIN douano_sales_orders o ON o.sales_order_id = l.sales_order_id
                    LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                    LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_unmapped_rules r
                      ON l.douano_product_id = 0
                     AND r.match_type = 'product0_description'
                     AND r.douano_product_id = 0
                     AND r.action = 'map_to_sku'
                     AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig')
                    WHERE l.douano_product_id = ANY(%s::bigint[])
                    ORDER BY l.line_id DESC
                    LIMIT %s
                    """,
                    (product_ids, lim),
                )
                rows = cur.fetchall() or []
        lines = _resolve_snapshot_batch(source_type="order", rows=list(rows), run_context=run_context)
        records = [
            record for line in lines
            if (record := _line_snapshot_record(source_type="order", line=line)) is not None
        ]
        computed += douano_margin_snapshot_storage.upsert_line_snapshots(records)
        for line in lines:
            documents.add(("order", int(line.get("sales_order_id", 0) or 0)))
            if line.get("missing_cost"):
                missing += 1

    if source_basis in {"invoice", "both"}:
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        l.line_id,
                        l.sales_invoice_id,
                        l.company_id,
                        l.invoice_date,
                        COALESCE((SELECT array_agg(tx.value) FROM jsonb_array_elements_text(i.invoiced_transaction_numbers) AS tx(value)), ARRAY[]::text[]) AS transaction_numbers,
                        l.douano_product_id,
                        COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), '') AS product_name,
                        p.sku,
                        l.quantity,
                        l.unit_price_ex,
                        l.discount_ex,
                        l.charges_total_ex,
                        l.net_revenue_ex,
                        COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) AS sku_id,
                        ig.douano_product_id IS NOT NULL AS ignored
                    FROM douano_sales_invoice_lines l
                    JOIN douano_sales_invoices i ON i.sales_invoice_id = l.sales_invoice_id
                    LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                    LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_unmapped_rules r
                      ON l.douano_product_id = 0
                     AND r.match_type = 'product0_description'
                     AND r.douano_product_id = 0
                     AND r.action = 'map_to_sku'
                     AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig')
                    WHERE l.douano_product_id = ANY(%s::bigint[])
                    ORDER BY l.line_id DESC
                    LIMIT %s
                    """,
                    (product_ids, lim),
                )
                rows = cur.fetchall() or []
        lines = _resolve_snapshot_batch(source_type="invoice", rows=list(rows), run_context=run_context)
        records = [
            record for line in lines
            if (record := _line_snapshot_record(source_type="invoice", line=line)) is not None
        ]
        computed += douano_margin_snapshot_storage.upsert_line_snapshots(records)
        for line in lines:
            documents.add(("invoice", int(line.get("sales_invoice_id", 0) or 0)))
            if line.get("missing_cost"):
                missing += 1

    return {
        "computed": computed,
        "missing_cost": missing,
        "documents": len(documents),
        "basis": source_basis,
        "douano_product_ids": product_ids,
    }


def backfill_line_snapshots_for_unmapped_rule(
    *,
    match_type: str,
    douano_product_id: int = 0,
    line_description: str = "",
    limit: int = 50000,
    basis: str = "both",
) -> dict[str, Any]:
    """Recompute snapshots affected by an unmapped-rule change.

    Normal Douano products are handled by product id. Product-0 miscellaneous
    lines are matched by their stored line description.
    """
    mt = str(match_type or "").strip()
    pid = int(douano_product_id or 0)
    if mt == "douano_product_id" and pid > 0:
        return backfill_line_snapshots_for_douano_products(
            douano_product_ids=[pid],
            limit=limit,
            basis=basis,
        )
    if mt != "product0_description":
        return {"computed": 0, "missing_cost": 0, "documents": 0, "basis": str(basis or "both"), "match_type": mt}

    description = str(line_description or "").strip() or "Overig"
    source_basis = str(basis or "both").strip().lower()
    if source_basis not in {"order", "invoice", "both"}:
        raise ValueError("basis must be 'order', 'invoice', or 'both'.")
    lim = max(1, min(int(limit or 50000), 50000))
    run_context = _build_snapshot_run_context()
    computed = 0
    missing = 0
    documents: set[tuple[str, int]] = set()

    if source_basis in {"order", "both"}:
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        l.line_id,
                        l.sales_order_id,
                        l.company_id,
                        l.order_date,
                        o.transaction_number,
                        l.douano_product_id,
                        COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), '') AS product_name,
                        p.sku,
                        l.quantity,
                        l.unit_price_ex,
                        l.discount_ex,
                        l.charges_total_ex,
                        l.net_revenue_ex,
                        COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) AS sku_id,
                        ig.douano_product_id IS NOT NULL AS ignored
                    FROM douano_sales_order_lines l
                    JOIN douano_sales_orders o ON o.sales_order_id = l.sales_order_id
                    LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                    LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_unmapped_rules r
                      ON l.douano_product_id = 0
                     AND r.match_type = 'product0_description'
                     AND r.douano_product_id = 0
                     AND r.action = 'map_to_sku'
                     AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig')
                    WHERE l.douano_product_id = 0
                      AND COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig') = %s
                    ORDER BY l.line_id DESC
                    LIMIT %s
                    """,
                    (description, lim),
                )
                rows = cur.fetchall() or []
        lines = _resolve_snapshot_batch(source_type="order", rows=list(rows), run_context=run_context)
        records = [
            record for line in lines
            if (record := _line_snapshot_record(source_type="order", line=line)) is not None
        ]
        computed += douano_margin_snapshot_storage.upsert_line_snapshots(records)
        for line in lines:
            documents.add(("order", int(line.get("sales_order_id", 0) or 0)))
            if line.get("missing_cost"):
                missing += 1

    if source_basis in {"invoice", "both"}:
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        l.line_id,
                        l.sales_invoice_id,
                        l.company_id,
                        l.invoice_date,
                        COALESCE((SELECT array_agg(tx.value) FROM jsonb_array_elements_text(i.invoiced_transaction_numbers) AS tx(value)), ARRAY[]::text[]) AS transaction_numbers,
                        l.douano_product_id,
                        COALESCE(NULLIF(p.name, ''), NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), '') AS product_name,
                        p.sku,
                        l.quantity,
                        l.unit_price_ex,
                        l.discount_ex,
                        l.charges_total_ex,
                        l.net_revenue_ex,
                        COALESCE(NULLIF(m.sku_id, ''), NULLIF(r.sku_id, '')) AS sku_id,
                        ig.douano_product_id IS NOT NULL AS ignored
                    FROM douano_sales_invoice_lines l
                    JOIN douano_sales_invoices i ON i.sales_invoice_id = l.sales_invoice_id
                    LEFT JOIN douano_products p ON p.product_id = l.douano_product_id
                    LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_product_ignore ig ON ig.douano_product_id = l.douano_product_id
                    LEFT JOIN douano_unmapped_rules r
                      ON l.douano_product_id = 0
                     AND r.match_type = 'product0_description'
                     AND r.douano_product_id = 0
                     AND r.action = 'map_to_sku'
                     AND r.line_description = COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig')
                    WHERE l.douano_product_id = 0
                      AND COALESCE(NULLIF(l.line_product_name, ''), NULLIF(l.line_description, ''), 'Overig') = %s
                    ORDER BY l.line_id DESC
                    LIMIT %s
                    """,
                    (description, lim),
                )
                rows = cur.fetchall() or []
        lines = _resolve_snapshot_batch(source_type="invoice", rows=list(rows), run_context=run_context)
        records = [
            record for line in lines
            if (record := _line_snapshot_record(source_type="invoice", line=line)) is not None
        ]
        computed += douano_margin_snapshot_storage.upsert_line_snapshots(records)
        for line in lines:
            documents.add(("invoice", int(line.get("sales_invoice_id", 0) or 0)))
            if line.get("missing_cost"):
                missing += 1

    return {
        "computed": computed,
        "missing_cost": missing,
        "documents": len(documents),
        "basis": source_basis,
        "match_type": mt,
        "line_description": description,
    }
