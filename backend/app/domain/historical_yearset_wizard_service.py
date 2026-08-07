from __future__ import annotations

import copy
import json
from collections import Counter
from datetime import UTC, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Iterable

from app.domain import postgres_storage, yearset_dossier_service


CONTRACT_VERSION = "rf-012d1a-v2"
_MONEY_TOLERANCE = Decimal("0.000001")
_SNAPSHOT_WINDOW_SECONDS = 300

_STEPS = (
    ("basis", "Basisgegevens"),
    ("init", "Jaarset"),
    ("productie", "Plan"),
    ("tarieven", "Tarieven"),
    ("vaste-kosten", "Vaste kosten"),
    ("verpakking", "Verpakking"),
    ("inkoop-scenario", "Inkoop scenario"),
    ("recepten", "Recepten"),
    ("kostprijs", "Kostprijs"),
    ("verkoopstrategie", "Verkoopstrategie"),
    ("adviesprijzen", "Adviesprijzen"),
    ("preview", "Preview"),
    ("plan-hercontrole", "Plan opnieuw"),
    ("afronden", "Afronden"),
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _iso(value: Any) -> str:
    return _text(value.isoformat() if hasattr(value, "isoformat") else value)


def _mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return copy.deepcopy(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return {}
        return copy.deepcopy(parsed) if isinstance(parsed, dict) else {}
    return {}


def _array(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    return [
        copy.deepcopy(row)
        for row in (value if isinstance(value, list) else [])
        if isinstance(row, dict)
    ]


def _decimal(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    try:
        parsed = Decimal(str(value))
    except Exception:
        return Decimal("0")
    return parsed if parsed.is_finite() else Decimal("0")


def _number(value: Any) -> float:
    return float(_decimal(value))


def _optional_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = Decimal(str(value))
    except Exception:
        return None
    return float(parsed) if parsed.is_finite() else None


def _money_round(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _percentage_delta(source: Any, target: Any) -> Decimal | None:
    source_value = _decimal(source)
    if source_value == 0:
        return None
    return ((_decimal(target) / source_value) - Decimal("1")) * Decimal("100")


def _fixed_cost_key(row: dict[str, Any]) -> tuple[str, ...]:
    # The active wizard copies rows by their business label; allocation metadata can
    # deliberately change in the target year and must not break the monetary comparison.
    return (_text(row.get("description")).casefold(),)


def _inflation_candidate(
    *,
    source_fixed_rows: Iterable[dict[str, Any]],
    target_fixed_rows: Iterable[dict[str, Any]],
    source_packaging_rows: Iterable[dict[str, Any]],
    target_packaging_rows: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    source_fixed = {_fixed_cost_key(row): row for row in source_fixed_rows}
    fixed_pairs = [
        (source_fixed[_fixed_cost_key(row)].get("annual_amount"), row.get("annual_amount"))
        for row in target_fixed_rows
        if _fixed_cost_key(row) in source_fixed
        and _decimal(source_fixed[_fixed_cost_key(row)].get("annual_amount")) != 0
    ]
    source_packaging = {
        _text(row.get("component_id")): row
        for row in source_packaging_rows
        if _text(row.get("component_id"))
    }
    packaging_pairs = [
        (
            source_packaging[_text(row.get("component_id"))].get("price_per_unit"),
            row.get("price_per_unit"),
        )
        for row in target_packaging_rows
        if _text(row.get("component_id")) in source_packaging
        and _decimal(source_packaging[_text(row.get("component_id"))].get("price_per_unit")) != 0
    ]
    candidates = [
        float(delta.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
        for source, target in [*fixed_pairs, *packaging_pairs]
        if (delta := _percentage_delta(source, target)) is not None
        and Decimal("-100") <= delta <= Decimal("100")
    ]
    if not candidates:
        return {
            "value_pct": None,
            "fidelity": "not_retained",
            "source": "niet afzonderlijk bewaard",
            "detail": "De oorspronkelijke inflatiewaarde en voldoende vergelijkbare bron-/doelwaarden ontbreken.",
            "fixed_cost_matches": 0,
            "fixed_cost_comparable": len(fixed_pairs),
            "packaging_matches": 0,
            "packaging_comparable": len(packaging_pairs),
        }

    value_pct, _ = Counter(candidates).most_common(1)[0]
    multiplier = Decimal("1") + (Decimal(str(value_pct)) / Decimal("100"))

    def matches(pair: tuple[Any, Any]) -> bool:
        source, target = pair
        return abs(_money_round(_decimal(source) * multiplier) - _decimal(target)) <= _MONEY_TOLERANCE

    fixed_matches = sum(1 for pair in fixed_pairs if matches(pair))
    packaging_matches = sum(1 for pair in packaging_pairs if matches(pair))
    comparable = len(fixed_pairs) + len(packaging_pairs)
    matched = fixed_matches + packaging_matches
    if matched < 2 or matched * 2 < comparable:
        return {
            "value_pct": None,
            "fidelity": "not_retained",
            "source": "niet betrouwbaar afleidbaar",
            "detail": "De bewaarde bron-/doelwaarden ondersteunen geen eenduidig inflatiepercentage.",
            "fixed_cost_matches": fixed_matches,
            "fixed_cost_comparable": len(fixed_pairs),
            "packaging_matches": packaging_matches,
            "packaging_comparable": len(packaging_pairs),
        }
    return {
        "value_pct": value_pct,
        "fidelity": "derived_exact",
        "source": "bewaarde bron- en doeljaarwaarden",
        "detail": (
            f"De oorspronkelijke invoer is niet los bewaard. {value_pct:.1f}% is exact afgeleid uit "
            f"{fixed_matches} vaste-kostenregels en {packaging_matches} verpakkingsprijzen na afronding op centen."
        ),
        "fixed_cost_matches": fixed_matches,
        "fixed_cost_comparable": len(fixed_pairs),
        "packaging_matches": packaging_matches,
        "packaging_comparable": len(packaging_pairs),
    }


def _parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = _text(value)
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _snapshot_fidelity(updated_at: Any, snapshot_at: Any) -> str:
    updated = _parse_timestamp(updated_at)
    snapshot = _parse_timestamp(snapshot_at)
    if not updated or not snapshot:
        return "not_retained"
    if abs((updated - snapshot).total_seconds()) <= _SNAPSHOT_WINDOW_SECONDS:
        return "exact"
    return "reconstructed"


def _financial_signature(row: dict[str, Any]) -> tuple[Decimal, ...]:
    return (
        _decimal(row.get("scenario_primary", row.get("target_primary"))),
        _decimal(row.get("target_packaging")),
        _decimal(row.get("target_overhead")),
        _decimal(row.get("target_excise")),
        _decimal(row.get("target_cost")),
    )


def _canonical_signature(row: dict[str, Any]) -> tuple[Decimal, ...]:
    return (
        _decimal(row.get("primary_cost")),
        _decimal(row.get("packaging_cost")),
        _decimal(row.get("overhead_cost")),
        _decimal(row.get("excise_cost")),
        _decimal(row.get("cost_price")),
    )


def _signatures_match(left: tuple[Decimal, ...], right: tuple[Decimal, ...]) -> bool:
    return all(abs(a - b) <= _MONEY_TOLERANCE for a, b in zip(left, right, strict=True))


def _missing(target_year: int, reason_code: str) -> dict[str, Any]:
    return {
        "version": CONTRACT_VERSION,
        "status": "missing",
        "read_only": True,
        "source_year": 0,
        "target_year": int(target_year or 0),
        "binding": None,
        "steps": [],
        "source_close": None,
        "production": None,
        "tariffs": None,
        "inflation": {
            "value_pct": None,
            "fidelity": "not_retained",
            "source": "niet afzonderlijk bewaard",
            "detail": "Onvoldoende historische gegevens.",
            "fixed_cost_matches": 0,
            "fixed_cost_comparable": 0,
            "packaging_matches": 0,
            "packaging_comparable": 0,
        },
        "fixed_costs": {"fidelity": "not_retained", "updated_at": "", "rows": []},
        "packaging_prices": {"fidelity": "not_retained", "updated_at": "", "rows": []},
        "recipes": {"fidelity": "not_retained", "rows": []},
        "cost_snapshot": None,
        "reason_codes": [reason_code],
    }


def _step(
    step_id: str,
    label: str,
    fidelity: str,
    source: str,
    detail: str,
) -> dict[str, Any]:
    return {
        "id": step_id,
        "label": label,
        "fidelity": fidelity,
        "source": source,
        "detail": detail,
    }


def _expected_inflated(value: Any, inflation: dict[str, Any]) -> float | None:
    percentage = inflation.get("value_pct")
    if percentage is None or value is None or value == "":
        return None
    multiplier = Decimal("1") + (Decimal(str(percentage)) / Decimal("100"))
    return float(_money_round(_decimal(value) * multiplier))


def _fixed_cost_comparison(
    *,
    source_rows: Iterable[dict[str, Any]],
    target_rows: Iterable[dict[str, Any]],
    inflation: dict[str, Any],
) -> list[dict[str, Any]]:
    source_by_key = {_fixed_cost_key(row): row for row in source_rows}
    compared: list[dict[str, Any]] = []
    for target in target_rows:
        row = copy.deepcopy(target)
        source = source_by_key.get(_fixed_cost_key(target))
        source_amount = _optional_number((source or {}).get("annual_amount"))
        target_amount = _number(target.get("annual_amount"))
        expected = _expected_inflated(source_amount, inflation)
        row.update(
            {
                "source_annual_amount": source_amount,
                "expected_inflated_amount": expected,
                "delta_amount": target_amount - (source_amount or 0),
                "matches_inflation": (
                    expected is not None
                    and abs(_decimal(expected) - _decimal(target_amount)) <= _MONEY_TOLERANCE
                ),
            }
        )
        compared.append(row)
    return compared


def _packaging_comparison(
    *,
    source_rows: Iterable[dict[str, Any]],
    target_rows: Iterable[dict[str, Any]],
    inflation: dict[str, Any],
) -> list[dict[str, Any]]:
    source_by_component = {
        _text(row.get("component_id")): row
        for row in source_rows
        if _text(row.get("component_id"))
    }
    compared: list[dict[str, Any]] = []
    for target in target_rows:
        row = copy.deepcopy(target)
        source = source_by_component.get(_text(target.get("component_id")))
        source_price = _optional_number((source or {}).get("price_per_unit"))
        target_price = _number(target.get("price_per_unit"))
        expected = _expected_inflated(source_price, inflation)
        row.update(
            {
                "source_price_per_unit": source_price,
                "expected_inflated_price": expected,
                "delta_price": target_price - (source_price or 0),
                "matches_inflation": (
                    expected is not None
                    and abs(_decimal(expected) - _decimal(target_price)) <= _MONEY_TOLERANCE
                ),
            }
        )
        compared.append(row)
    return compared


def _ingredient_rules(version: dict[str, Any]) -> list[dict[str, Any]]:
    inputs = _mapping(version.get("invoer"))
    ingredients = _mapping(inputs.get("ingredienten"))
    return _array(ingredients.get("regels"))


def _ingredient_key(row: dict[str, Any]) -> tuple[str, ...]:
    row_id = _text(row.get("id"))
    if row_id:
        return ("id", row_id)
    return (
        "fields",
        _text(row.get("ingredient")).casefold(),
        _text(row.get("omschrijving")).casefold(),
        _text(row.get("eenheid")).casefold(),
    )


def _recipe_cost(row: dict[str, Any] | None) -> float | None:
    if not row:
        return None
    quantity = _decimal(row.get("hoeveelheid"))
    if quantity <= 0:
        return 0.0
    return float((_decimal(row.get("prijs")) / quantity) * _decimal(row.get("benodigd_in_recept")))


def _recipe_comparisons(
    *,
    recipe_snapshots: Iterable[dict[str, Any]],
    inflation: dict[str, Any],
) -> list[dict[str, Any]]:
    recipes: list[dict[str, Any]] = []
    for snapshot in recipe_snapshots:
        source_version = _mapping(snapshot.get("source"))
        target_version = _mapping(snapshot.get("target"))
        source_basis = _mapping(source_version.get("basisgegevens"))
        target_basis = _mapping(target_version.get("basisgegevens"))
        source_rules = _ingredient_rules(source_version)
        target_rules = _ingredient_rules(target_version)
        source_by_key = {_ingredient_key(row): row for row in source_rules}
        target_by_key = {_ingredient_key(row): row for row in target_rules}
        keys = list(dict.fromkeys([*source_by_key, *target_by_key]))
        ingredients: list[dict[str, Any]] = []
        for key in keys:
            source = source_by_key.get(key)
            target = target_by_key.get(key)
            identity = target or source or {}
            source_price = _optional_number((source or {}).get("prijs"))
            target_price = _optional_number((target or {}).get("prijs"))
            expected = _expected_inflated(source_price, inflation)
            ingredients.append(
                {
                    "id": _text(identity.get("id")) or "::".join(key),
                    "ingredient": _text(identity.get("ingredient")),
                    "description": _text(identity.get("omschrijving")),
                    "quantity": _optional_number(identity.get("hoeveelheid")),
                    "unit": _text(identity.get("eenheid")),
                    "needed_in_recipe": _optional_number(identity.get("benodigd_in_recept")),
                    "source_price": source_price,
                    "expected_inflated_price": expected,
                    "target_price": target_price,
                    "source_recipe_cost": _recipe_cost(source),
                    "target_recipe_cost": _recipe_cost(target),
                    "matches_inflation": (
                        expected is not None
                        and target_price is not None
                        and abs(_decimal(expected) - _decimal(target_price)) <= _MONEY_TOLERANCE
                    ),
                }
            )
        recipes.append(
            {
                "beer_id": _text(snapshot.get("beer_id")),
                "beer_name": _text(target_basis.get("biernaam")) or _text(source_basis.get("biernaam")),
                "style": _text(target_basis.get("stijl")) or _text(source_basis.get("stijl")),
                "source_version_id": _text(snapshot.get("source_version_id")),
                "target_version_id": _text(snapshot.get("target_version_id")),
                "source_alcohol_pct": _optional_number(source_basis.get("alcoholpercentage")),
                "target_alcohol_pct": _optional_number(target_basis.get("alcoholpercentage")),
                "source_excise_rate": _text(source_basis.get("tarief_accijns")),
                "target_excise_rate": _text(target_basis.get("tarief_accijns")),
                "ingredients": ingredients,
                "source_recipe_total": sum(
                    value for value in (_recipe_cost(row) for row in source_rules) if value is not None
                ),
                "target_recipe_total": sum(
                    value for value in (_recipe_cost(row) for row in target_rules) if value is not None
                ),
            }
        )
    return sorted(recipes, key=lambda row: (row["beer_name"].casefold(), row["beer_id"]))


def _cost_snapshot(
    *,
    dossier_items: Iterable[dict[str, Any]],
    engine_rows: Iterable[dict[str, Any]],
    snapshot_at: str,
) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    raw_rows = [copy.deepcopy(row) for row in engine_rows]
    for row in raw_rows:
        sku_id = _text(row.get("sku_id"))
        if sku_id:
            grouped.setdefault(sku_id, []).append(row)

    duplicate_skus = 0
    duplicate_references = 0
    conflicting_duplicate_skus = 0
    legacy_by_sku: dict[str, dict[str, Any]] = {}
    for sku_id, rows in grouped.items():
        if len(rows) > 1:
            duplicate_skus += 1
            duplicate_references += len(rows) - 1
        signatures = {_financial_signature(row) for row in rows}
        if len(signatures) > 1:
            conflicting_duplicate_skus += 1
            continue
        legacy_by_sku[sku_id] = rows[0]

    cost_rows: list[dict[str, Any]] = []
    exact_matches = 0
    material_mismatches = 0
    canonical_without_legacy = 0
    allowed_without_legacy = 0
    for canonical in dossier_items:
        sku_id = _text(canonical.get("sku_id"))
        legacy = legacy_by_sku.get(sku_id)
        provenance = _text(canonical.get("provenance_kind"))
        cost_required = bool(canonical.get("cost_required"))
        if legacy:
            matches = _signatures_match(
                _financial_signature(legacy), _canonical_signature(canonical)
            )
            exact_matches += int(matches)
            material_mismatches += int(not matches)
            fidelity = "exact" if matches else "mismatch"
            source_values = {
                "primary_cost": _number(legacy.get("source_primary")),
                "packaging_cost": _number(legacy.get("source_packaging")),
                "overhead_cost": _number(legacy.get("source_overhead")),
                "excise_cost": _number(legacy.get("source_excise")),
                "cost_price": _number(legacy.get("source_cost")),
            }
            target_values = {
                "primary_cost": _number(legacy.get("scenario_primary", legacy.get("target_primary"))),
                "packaging_cost": _number(legacy.get("target_packaging")),
                "overhead_cost": _number(legacy.get("target_overhead")),
                "excise_cost": _number(legacy.get("target_excise")),
                "cost_price": _number(legacy.get("target_cost")),
            }
            reference_count = len(grouped.get(sku_id, []))
            source_kind = "stored_wizard_calculation"
        else:
            canonical_without_legacy += 1
            allowed = provenance == "recovered_from_exact_target_anchor" or not cost_required
            allowed_without_legacy += int(allowed)
            fidelity = "exact_anchor" if provenance == "recovered_from_exact_target_anchor" else "not_applicable" if not cost_required else "not_retained"
            source_values = None
            target_values = {
                "primary_cost": _optional_number(canonical.get("primary_cost")),
                "packaging_cost": _optional_number(canonical.get("packaging_cost")),
                "overhead_cost": _optional_number(canonical.get("overhead_cost")),
                "excise_cost": _optional_number(canonical.get("excise_cost")),
                "cost_price": _optional_number(canonical.get("cost_price")),
            }
            reference_count = 0
            source_kind = provenance or "not_retained"

        cost_rows.append(
            {
                "sku_id": sku_id,
                "sku_code": _text(canonical.get("sku_code")),
                "sku_name": _text(canonical.get("sku_name")) or sku_id,
                "beer_name": _text(canonical.get("beer_name")),
                "product_type": _text(canonical.get("subject_type")),
                "product_label": _text((legacy or {}).get("product_label"))
                or _text(canonical.get("sku_name"))
                or sku_id,
                "cost_required": cost_required,
                "fidelity": fidelity,
                "source_kind": source_kind,
                "reference_count": reference_count,
                "source": source_values,
                "target": target_values,
                "list_price": _optional_number(canonical.get("list_price")),
                "provenance_kind": provenance,
            }
        )

    return {
        "snapshot_at": snapshot_at,
        "raw_row_count": len(raw_rows),
        "unique_sku_count": len(grouped),
        "duplicate_sku_count": duplicate_skus,
        "duplicate_reference_count": duplicate_references,
        "conflicting_duplicate_sku_count": conflicting_duplicate_skus,
        "canonical_row_count": len(cost_rows),
        "canonical_exact_match_count": exact_matches,
        "canonical_material_mismatch_count": material_mismatches,
        "canonical_without_legacy_count": canonical_without_legacy,
        "allowed_without_legacy_count": allowed_without_legacy,
        "rows": sorted(
            cost_rows,
            key=lambda row: (
                row["beer_name"].casefold(),
                row["sku_name"].casefold(),
                row["sku_id"],
            ),
        ),
    }


def build_historical_yearset_wizard(
    *,
    dossier: dict[str, Any],
    engine_batches: Iterable[dict[str, Any]],
    engine_updated_at: Any,
    source_close: dict[str, Any] | None,
    production: dict[str, Any] | None,
    tariffs: dict[str, Any] | None,
    source_fixed_cost_rows: Iterable[dict[str, Any]],
    fixed_cost_rows: Iterable[dict[str, Any]],
    source_packaging_price_rows: Iterable[dict[str, Any]],
    packaging_price_rows: Iterable[dict[str, Any]],
    packaging_updated_at: Any,
    recipe_snapshots: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """Build the historical wizard projection without recalculating or writing."""

    target_year = int(dossier.get("operational_year") or 0)
    if dossier.get("status") != "ready" or not dossier.get("read_only"):
        return _missing(target_year, "finalized_yearset_dossier_unavailable")
    audit = _mapping(dossier.get("audit"))
    generation_audit = _mapping(audit.get("generation"))
    source_year = int(generation_audit.get("source_year") or 0)
    matching_batches = [
        copy.deepcopy(batch)
        for batch in engine_batches
        if int(batch.get("source_year") or 0) == source_year
        and int(batch.get("target_year") or 0) == target_year
        and isinstance(batch.get("rows"), list)
    ]
    if len(matching_batches) != 1:
        return _missing(target_year, "historical_wizard_engine_batch_ambiguous")

    batch = matching_batches[0]
    snapshot_at = _iso(batch.get("created_at") or engine_updated_at)
    cost_snapshot = _cost_snapshot(
        dossier_items=dossier.get("sku_items", []),
        engine_rows=_array(batch.get("rows")),
        snapshot_at=snapshot_at,
    )
    if cost_snapshot["conflicting_duplicate_sku_count"]:
        return _missing(target_year, "historical_wizard_duplicate_cost_conflict")
    if cost_snapshot["canonical_material_mismatch_count"]:
        return _missing(target_year, "historical_wizard_cost_snapshot_mismatch")
    if (
        cost_snapshot["canonical_without_legacy_count"]
        != cost_snapshot["allowed_without_legacy_count"]
    ):
        return _missing(target_year, "historical_wizard_cost_lineage_incomplete")

    production_row = copy.deepcopy(production) if production else None
    if production_row:
        production_row["fidelity"] = _snapshot_fidelity(
            production_row.get("updated_at"), snapshot_at
        )
    tariff_row = copy.deepcopy(tariffs) if tariffs else None
    if tariff_row:
        tariff_row["fidelity"] = _snapshot_fidelity(
            tariff_row.get("updated_at"), snapshot_at
        )

    source_fixed_rows = [copy.deepcopy(row) for row in source_fixed_cost_rows]
    fixed_rows = [copy.deepcopy(row) for row in fixed_cost_rows]
    fixed_updated_at = max(
        (_iso(row.get("updated_at")) for row in fixed_rows), default=""
    )
    fixed_fidelity = (
        _snapshot_fidelity(fixed_updated_at, snapshot_at)
        if fixed_rows
        else "not_retained"
    )
    source_packaging_rows = [copy.deepcopy(row) for row in source_packaging_price_rows]
    packaging_rows = [copy.deepcopy(row) for row in packaging_price_rows]
    packaging_fidelity = (
        _snapshot_fidelity(packaging_updated_at, snapshot_at)
        if packaging_rows
        else "not_retained"
    )
    inflation = _inflation_candidate(
        source_fixed_rows=source_fixed_rows,
        target_fixed_rows=fixed_rows,
        source_packaging_rows=source_packaging_rows,
        target_packaging_rows=packaging_rows,
    )
    compared_fixed_rows = _fixed_cost_comparison(
        source_rows=source_fixed_rows,
        target_rows=fixed_rows,
        inflation=inflation,
    )
    compared_packaging_rows = _packaging_comparison(
        source_rows=source_packaging_rows,
        target_rows=packaging_rows,
        inflation=inflation,
    )
    engine_source_version_ids = {
        _text(row.get("source_version_id"))
        for row in _array(batch.get("rows"))
        if _text(row.get("source_version_id"))
    }
    verified_recipe_snapshots = [
        copy.deepcopy(snapshot)
        for snapshot in recipe_snapshots
        if _text(snapshot.get("source_version_id")) in engine_source_version_ids
    ]
    recipe_rows = _recipe_comparisons(
        recipe_snapshots=verified_recipe_snapshots,
        inflation=inflation,
    )
    recipes_fidelity = "exact" if recipe_rows else "not_retained"

    fidelity_by_step = {
        "basis": ("exact", "commerciële generatie", "Bron- en doeljaar zijn vastgelegd in de geactiveerde generatie."),
        "init": ("reconstructed", "definitief resultaat", "De oorspronkelijke checkboxstanden zijn niet bewaard; het gerealiseerde resultaat per gegevensbron is wel zichtbaar."),
        "productie": ("exact", "bevroren Plan", "De definitieve Planwaarden en maandverdeling zijn contractueel bevroren."),
        "tarieven": ((tariff_row or {}).get("fidelity", "not_retained"), "tarieven doeljaar", "De doeljaartarieven worden alleen als exact gemarkeerd wanneer hun bewaartijd bij de wizardbatch hoort."),
        "vaste-kosten": (inflation.get("fidelity", fixed_fidelity), "bewaarde bron- en doeljaarwaarden", "De inflatie-invoer is afgeleid en wordt naast de exacte bron- en doeljaarbedragen getoond; handmatige afwijkingen blijven zichtbaar."),
        "verpakking": (inflation.get("fidelity", packaging_fidelity), "bewaarde verpakkingsprijzen", "Bronjaar, bron + afgeleide inflatie en de werkelijk opgeslagen doeljaarprijs worden apart getoond."),
        "inkoop-scenario": ("exact", "bewaarde wizardberekening", "De per SKU gebruikte bron- en scenario-inkoopwaarden zijn in de berekeningsbatch bewaard."),
        "recepten": (recipes_fidelity, "definitieve kostprijsversies", "Bron- en doelrecept zijn via de expliciete jaarovergang aan elkaar gekoppeld; verschillen met de afgeleide inflatie blijven zichtbaar."),
        "kostprijs": ("exact", "bewaarde wizardberekening", "De oorspronkelijke presentatieregels zijn per stabiele SKU gecontroleerd tegen het actieve dossier."),
        "verkoopstrategie": ("exact", "actieve commerciële generatie", "De definitieve sell-inprijzen zijn aan dezelfde generatie gebonden."),
        "adviesprijzen": ("exact", "actieve commerciële generatie", "De definitieve kanaalopslagen zijn aan dezelfde generatie gebonden."),
        "preview": ("derived_exact", "bevroren kostprijs- en prijsbronnen", "De preview combineert uitsluitend de exacte, bevroren waarden en rekent geen kostprijzen opnieuw uit."),
        "plan-hercontrole": ("exact", "bevroren Plan", "Het definitieve Plan wordt opnieuw getoond; actuele forecastlogica wordt niet uitgevoerd."),
        "afronden": ("exact", "audittrail generatie en run", "Goedkeuring en activatie zijn onveranderlijk herleidbaar."),
    }
    steps = [
        _step(step_id, label, *fidelity_by_step[step_id])
        for step_id, label in _STEPS
    ]

    return {
        "version": CONTRACT_VERSION,
        "status": "ready",
        "read_only": True,
        "source_year": source_year,
        "target_year": target_year,
        "binding": copy.deepcopy(dossier.get("binding")),
        "steps": steps,
        "source_close": copy.deepcopy(source_close) if source_close else None,
        "production": production_row,
        "tariffs": tariff_row,
        "inflation": inflation,
        "fixed_costs": {
            "fidelity": fixed_fidelity,
            "updated_at": fixed_updated_at,
            "rows": compared_fixed_rows,
        },
        "packaging_prices": {
            "fidelity": packaging_fidelity,
            "updated_at": _iso(packaging_updated_at),
            "rows": compared_packaging_rows,
        },
        "recipes": {"fidelity": recipes_fidelity, "rows": recipe_rows},
        "cost_snapshot": cost_snapshot,
        "reason_codes": [],
    }


def read_historical_yearset_wizard(operational_year: int) -> dict[str, Any]:
    """Read a finalized yearset and its retained wizard evidence without writes."""

    target_year = int(operational_year or 0)
    dossier = yearset_dossier_service.read_yearset_dossier(target_year)
    if dossier.get("status") != "ready":
        return _missing(target_year, "finalized_yearset_dossier_unavailable")
    source_year = int(
        _mapping(_mapping(dossier.get("audit")).get("generation")).get("source_year")
        or 0
    )
    binding = _mapping(dossier.get("binding"))

    with postgres_storage.connect() as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        status_row = conn.execute(
            """
            SELECT y.status, r.status
            FROM commercial_yearsets y
            JOIN commercial_yearset_reconciliation_runs r
              ON r.generation_id = y.id
            WHERE y.id = %s AND r.id = %s
            """,
            (_text(binding.get("generation_id")), _text(binding.get("run_id"))),
        ).fetchone()
        if not status_row or _text(status_row[0]) not in {"active", "superseded"} or _text(status_row[1]) not in {"active", "superseded"}:
            return _missing(target_year, "historical_wizard_binding_not_finalized")

        engine_row = conn.execute(
            """
            SELECT payload, updated_at
            FROM app_datasets
            WHERE dataset_name = 'kostprijs-target-engine-rows'
            """
        ).fetchone()
        engine_batches = _array(engine_row[0]) if engine_row else []
        engine_updated_at = engine_row[1] if engine_row else None

        close_row = conn.execute(
            """
            SELECT id, status, closed_at
            FROM year_close_snapshots
            WHERE jaar = %s AND status = 'closed'
            ORDER BY closed_at DESC, id DESC
            LIMIT 1
            """,
            (source_year,),
        ).fetchone()
        source_close = (
            {
                "id": _text(close_row[0]),
                "status": _text(close_row[1]),
                "closed_at": _iso(close_row[2]),
            }
            if close_row
            else None
        )

        production_row = conn.execute(
            """
            SELECT normal_inkoop_l, normal_productie_l, normal_contract_brew_l,
                   normal_shipments, normal_orderlines, normal_sales_l, sales_l,
                   hoeveelheid_inkoop_l, hoeveelheid_productie_l,
                   batchgrootte_eigen_productie_l, updated_at
            FROM production_years
            WHERE jaar = %s
            """,
            (target_year,),
        ).fetchone()
        production = None
        if production_row:
            production = {
                "normal_inkoop_l": _number(production_row[0]),
                "normal_productie_l": _number(production_row[1]),
                "normal_contract_brew_l": _number(production_row[2]),
                "normal_shipments": _number(production_row[3]),
                "normal_orderlines": _number(production_row[4]),
                "normal_sales_l": _number(production_row[5]),
                "sales_l": _number(production_row[6]),
                "hoeveelheid_inkoop_l": _number(production_row[7]),
                "hoeveelheid_productie_l": _number(production_row[8]),
                "batchgrootte_eigen_productie_l": _number(production_row[9]),
                "updated_at": _iso(production_row[10]),
            }

        tariff_row = conn.execute(
            """
            SELECT tarief_hoog, tarief_laag, verbruikersbelasting, updated_at
            FROM tarieven_heffingen_years
            WHERE jaar = %s
            """,
            (target_year,),
        ).fetchone()
        tariffs = None
        if tariff_row:
            tariffs = {
                "tarief_hoog": _number(tariff_row[0]),
                "tarief_laag": _number(tariff_row[1]),
                "verbruikersbelasting": _number(tariff_row[2]),
                "updated_at": _iso(tariff_row[3]),
            }

        fixed_data = conn.execute(
            """
            SELECT jaar, id, omschrijving, kostensoort_code, cost_pool, domain_code,
                   allocation_driver, allocation_scope,
                   include_in_inventory_cost, include_in_quote_handling,
                   basis_code, stand_code, bedrag_per_jaar, herverdeel_pct,
                   updated_at
            FROM fixed_cost_lines
            WHERE jaar IN (%s, %s)
            ORDER BY jaar, kostensoort_code, omschrijving, id
            """,
            (source_year, target_year),
        ).fetchall()
        all_fixed_cost_rows = [
            {
                "year": int(row[0] or 0),
                "id": _text(row[1]),
                "description": _text(row[2]),
                "cost_type": _text(row[3]),
                "cost_pool": _text(row[4]),
                "domain_code": _text(row[5]),
                "allocation_driver": _text(row[6]),
                "allocation_scope": _text(row[7]),
                "include_in_inventory_cost": bool(row[8]),
                "include_in_quote_handling": bool(row[9]),
                "basis_code": _text(row[10]),
                "stand_code": _text(row[11]),
                "annual_amount": _number(row[12]),
                "redistribution_pct": _number(row[13]),
                "updated_at": _iso(row[14]),
            }
            for row in fixed_data
        ]
        source_fixed_cost_rows = [row for row in all_fixed_cost_rows if row["year"] == source_year]
        fixed_cost_rows = [row for row in all_fixed_cost_rows if row["year"] == target_year]

        packaging_data = conn.execute(
            """
            SELECT item->>'id', item->>'verpakkingsonderdeel_id',
                   COALESCE(a.name, item->>'verpakkingsonderdeel_id'),
                   item->>'prijs_per_stuk', d.updated_at,
                   COALESCE(NULLIF(item->>'jaar', ''), '0')::int
            FROM app_datasets d
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(d.payload) = 'array'
                     THEN d.payload ELSE '[]'::jsonb END
            ) item
            LEFT JOIN articles a ON a.id = item->>'verpakkingsonderdeel_id'
            WHERE d.dataset_name = 'packaging-component-prices'
              AND COALESCE(NULLIF(item->>'jaar', ''), '0')::int IN (%s, %s)
            ORDER BY COALESCE(NULLIF(item->>'jaar', ''), '0')::int,
                     COALESCE(a.name, item->>'verpakkingsonderdeel_id'), item->>'id'
            """,
            (source_year, target_year),
        ).fetchall()
        all_packaging_price_rows = [
            {
                "id": _text(row[0]),
                "component_id": _text(row[1]),
                "component_name": _text(row[2]) or _text(row[1]),
                "price_per_unit": _number(row[3]),
                "year": int(row[5] or 0),
            }
            for row in packaging_data
        ]
        source_packaging_price_rows = [row for row in all_packaging_price_rows if row["year"] == source_year]
        packaging_price_rows = [row for row in all_packaging_price_rows if row["year"] == target_year]
        packaging_updated_at = packaging_data[0][4] if packaging_data else None

        recipe_data = conn.execute(
            """
            SELECT target.id, target.bier_id, target.payload,
                   source.id, source.payload
            FROM cost_versions target
            JOIN cost_versions source
              ON source.id = target.payload->'jaarovergang'->>'bron_berekening_id'
            WHERE target.jaar = %s
              AND target.status = 'definitief'
              AND target.payload->'jaarovergang'->>'aangemaakt_via' = 'kostprijs_activatie'
              AND jsonb_typeof(target.payload->'invoer'->'ingredienten'->'regels') = 'array'
              AND jsonb_array_length(target.payload->'invoer'->'ingredienten'->'regels') > 0
            ORDER BY COALESCE(target.payload->'basisgegevens'->>'biernaam', target.bier_id), target.id
            """,
            (target_year,),
        ).fetchall()
        recipe_snapshots = [
            {
                "target_version_id": _text(row[0]),
                "beer_id": _text(row[1]),
                "target": _mapping(row[2]),
                "source_version_id": _text(row[3]),
                "source": _mapping(row[4]),
            }
            for row in recipe_data
        ]

    return build_historical_yearset_wizard(
        dossier=dossier,
        engine_batches=engine_batches,
        engine_updated_at=engine_updated_at,
        source_close=source_close,
        production=production,
        tariffs=tariffs,
        source_fixed_cost_rows=source_fixed_cost_rows,
        fixed_cost_rows=fixed_cost_rows,
        source_packaging_price_rows=source_packaging_price_rows,
        packaging_price_rows=packaging_price_rows,
        packaging_updated_at=packaging_updated_at,
        recipe_snapshots=recipe_snapshots,
    )
