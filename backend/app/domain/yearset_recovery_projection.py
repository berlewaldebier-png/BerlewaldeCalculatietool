from __future__ import annotations

import copy
import hashlib
import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Iterable
from uuid import NAMESPACE_URL, uuid5


RECOVERY_VERSION = "rf-013c3-v1"
ALLOCATION_POLICY = "closed_source_actual_mix_scaled_to_approved_revenue"
_SIX = Decimal("0.000001")
_CENT = Decimal("0.01")


class YearsetRecoveryValidationError(ValueError):
    pass


def _text(value: Any) -> str:
    return str(value or "").strip()


def _decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value if value not in (None, "") else 0))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _plain(value: Any) -> str:
    return format(_decimal(value).quantize(_SIX, rounding=ROUND_HALF_UP), "f")


def _payload(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return {}
    return value if isinstance(value, dict) else {}


def _array(value: Any) -> list[Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    return value if isinstance(value, list) else []


def _stable(value: Any) -> str:
    def normalize(item: Any) -> Any:
        if isinstance(item, Decimal):
            return _plain(item)
        if isinstance(item, dict):
            return {str(key): normalize(item[key]) for key in sorted(item)}
        if isinstance(item, (list, tuple, set)):
            rows = [normalize(child) for child in item]
            return sorted(rows, key=lambda row: json.dumps(row, sort_keys=True))
        if hasattr(item, "isoformat"):
            return item.isoformat()
        return item

    return json.dumps(
        normalize(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _hash(value: Any, domain: str) -> str:
    raw = (
        f"{RECOVERY_VERSION}:{domain}:".encode("utf-8")
        + _stable(value).encode("utf-8")
    )
    return f"sha256:{hashlib.sha256(raw).hexdigest()}"


def _stable_id(scope: str, *values: Any) -> str:
    return str(
        uuid5(
            NAMESPACE_URL,
            ":".join([RECOVERY_VERSION, scope, *[_text(value) for value in values]]),
        )
    )


def _exact_set(values: Iterable[Any]) -> set[str]:
    return {_text(value) for value in values if _text(value)}


def _scaled_rows(
    rows: list[dict[str, Any]],
    *,
    target_total: Decimal,
    source_key: str,
    target_key: str,
) -> list[dict[str, Any]]:
    if not rows:
        raise YearsetRecoveryValidationError(
            f"Geen bronregels beschikbaar voor allocatie '{target_key}'."
        )
    source_total = sum((_decimal(row.get(source_key)) for row in rows), Decimal("0"))
    if source_total == 0:
        raise YearsetRecoveryValidationError(
            f"Brontotaal voor allocatie '{target_key}' is nul."
        )
    ordered = sorted(rows, key=lambda row: _text(row.get("_key")))
    allocated = Decimal("0")
    result: list[dict[str, Any]] = []
    for index, row in enumerate(ordered):
        if index == len(ordered) - 1:
            value = target_total - allocated
        else:
            value = (
                target_total * _decimal(row.get(source_key)) / source_total
            ).quantize(_SIX, rounding=ROUND_HALF_UP)
            allocated += value
        result.append({**row, target_key: value})
    return result


def _apply_allocations(
    rows: list[dict[str, Any]],
    *,
    targets: dict[str, Decimal],
) -> list[dict[str, Any]]:
    current = copy.deepcopy(rows)
    for key in ("revenue", "variable_cost", "contribution", "liters", "units"):
        current = _scaled_rows(
            current,
            target_total=targets[key],
            source_key=f"source_{key}",
            target_key=key,
        )
    return current


def _source_actuals(snapshot: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    closes = [
        row
        for row in snapshot.get("source_year_closes", [])
        if isinstance(row, dict)
    ]
    if len(closes) != 1:
        raise YearsetRecoveryValidationError(
            "Voor planherstel is exact één afgesloten bronjaar-dossier verplicht."
        )
    close = closes[0]
    payload = _payload(close.get("payload"))
    actuals = _payload(payload.get("actuals"))
    dashboard = _payload(_payload(payload.get("dashboard")).get("actual"))
    inventory = _payload(payload.get("inventory"))
    inventory_totals = _payload(inventory.get("totals"))
    if not actuals or not dashboard or not inventory_totals:
        raise YearsetRecoveryValidationError(
            "Het afgesloten bronjaar mist actual-, dashboard- of voorraadgegevens."
        )
    return payload, {
        "revenue": _decimal(dashboard.get("revenue")),
        "variable_cost": _decimal(dashboard.get("variable_cost")),
        "contribution": _decimal(dashboard.get("contribution")),
        "liters": _decimal(inventory_totals.get("sold_liters")),
        "units": sum(
            (
                _decimal(row.get("units"))
                for row in _array(actuals.get("rows"))
                if isinstance(row, dict)
            ),
            Decimal("0"),
        ),
    }


def _build_plan(
    snapshot: dict[str, Any],
    *,
    approved_revenue: Decimal,
    included_sku_ids: set[str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    close_payload, source_totals = _source_actuals(snapshot)
    if approved_revenue <= 0 or source_totals["revenue"] <= 0:
        raise YearsetRecoveryValidationError(
            "Goedgekeurde omzet en bronjaaromzet moeten positief zijn."
        )
    multiplier = approved_revenue / source_totals["revenue"]
    production = _payload(snapshot.get("target_production"))
    target_liters = _decimal(
        production.get("normal_sales_l", production.get("sales_l"))
    )
    expected_liters = source_totals["liters"] * multiplier
    if target_liters <= 0:
        raise YearsetRecoveryValidationError(
            "De opgeslagen normale salesliters voor het doeljaar ontbreken."
        )
    if abs(target_liters - expected_liters) > _CENT:
        raise YearsetRecoveryValidationError(
            "De opgeslagen doeljaarliters volgen niet dezelfde factor als de "
            "goedgekeurde omzet; handmatige review is verplicht."
        )

    targets = {
        "revenue": approved_revenue,
        "variable_cost": source_totals["variable_cost"] * multiplier,
        "contribution": source_totals["contribution"] * multiplier,
        "liters": target_liters,
        "units": source_totals["units"] * multiplier,
    }
    if abs(
        targets["revenue"]
        - targets["variable_cost"]
        - targets["contribution"]
    ) > _CENT:
        raise YearsetRecoveryValidationError(
            "De gereconstrueerde Plan-totalen zijn financieel niet in balans."
        )

    skus = {
        _text(row.get("id")): row
        for row in snapshot.get("skus", [])
        if isinstance(row, dict) and _text(row.get("id"))
    }
    source_actuals = _payload(close_payload.get("actuals"))
    annual_by_sku: dict[str, dict[str, Any]] = {}
    for row in _array(source_actuals.get("rows")):
        if not isinstance(row, dict):
            continue
        sku_id = _text(row.get("sku_id"))
        if sku_id not in included_sku_ids:
            continue
        revenue = _decimal(row.get("net_revenue_ex"))
        variable = _decimal(
            row.get("variabel_accijns_ex", row.get("variable_cost"))
        )
        aggregate = annual_by_sku.setdefault(
            sku_id,
            {
                "_key": sku_id,
                "sku_id": sku_id,
                "source_revenue": Decimal("0"),
                "source_variable_cost": Decimal("0"),
                "source_contribution": Decimal("0"),
                "source_units": Decimal("0"),
                "source_liters": Decimal("0"),
            },
        )
        aggregate["source_revenue"] += revenue
        aggregate["source_variable_cost"] += variable
        aggregate["source_contribution"] += revenue - variable
        aggregate["source_units"] += _decimal(row.get("units"))
    inventory = _payload(close_payload.get("inventory"))
    for row in _array(inventory.get("rows")):
        if not isinstance(row, dict):
            continue
        sku_id = _text(row.get("sku_id"))
        if sku_id in annual_by_sku:
            annual_by_sku[sku_id]["source_liters"] += _decimal(
                row.get("sold_liters")
            )
    annual_rows = [
        row
        for row in annual_by_sku.values()
        if any(
            _decimal(row.get(f"source_{key}")) != 0
            for key in ("revenue", "variable_cost", "contribution", "liters", "units")
        )
    ]
    sku_allocations = _apply_allocations(annual_rows, targets=targets)

    content_by_sku = {
        sku_id: _decimal(row.get("content_liter"))
        for sku_id, row in skus.items()
    }
    period_by_key: dict[str, dict[str, Any]] = {}
    for row in _array(source_actuals.get("variable_cost_rows")):
        if not isinstance(row, dict):
            continue
        sku_id = _text(row.get("sku_id"))
        if sku_id not in included_sku_ids:
            continue
        source_period = _text(row.get("document_date"))[:7]
        if len(source_period) != 7:
            continue
        target_period = f"{int(snapshot.get('target_year', 0) or 0)}-{source_period[5:7]}"
        period = period_by_key.setdefault(
            target_period,
            {
                "_key": target_period,
                "period": target_period,
                "source_revenue": Decimal("0"),
                "source_variable_cost": Decimal("0"),
                "source_contribution": Decimal("0"),
                "source_liters": Decimal("0"),
                "source_units": Decimal("0"),
            },
        )
        revenue = _decimal(row.get("net_revenue_ex"))
        variable = _decimal(
            row.get("variabel_accijns_ex", row.get("variable_cost"))
        )
        quantity = _decimal(row.get("quantity"))
        period["source_revenue"] += revenue
        period["source_variable_cost"] += variable
        period["source_contribution"] += revenue - variable
        period["source_units"] += quantity
        period["source_liters"] += quantity * content_by_sku.get(
            sku_id, Decimal("0")
        )
    period_allocations = _apply_allocations(
        list(period_by_key.values()),
        targets=targets,
    )

    clean_targets = {key: _plain(value) for key, value in targets.items()}
    clean_periods = [
        {
            "period": _text(row.get("period")),
            **{key: _plain(row.get(key)) for key in clean_targets},
        }
        for row in period_allocations
    ]
    clean_skus = [
        {
            "sku_id": _text(row.get("sku_id")),
            **{key: _plain(row.get(key)) for key in clean_targets},
        }
        for row in sku_allocations
    ]
    plan_payload = {
        "targets": clean_targets,
        "period_allocations": clean_periods,
        "sku_allocations": clean_skus,
        "reconstruction": {
            "version": RECOVERY_VERSION,
            "allocation_policy": ALLOCATION_POLICY,
            "source_year_close_id": _text(
                snapshot.get("source_year_closes", [{}])[0].get("id")
            ),
            "approved_revenue_ex_vat": _plain(approved_revenue),
            "source_revenue": _plain(source_totals["revenue"]),
            "source_sales_liters": _plain(source_totals["liters"]),
            "target_sales_liters": _plain(target_liters),
            "revenue_multiplier": _plain(multiplier),
            "target_production_driver_hash": _hash(
                production, "target-production-drivers"
            ),
        },
    }
    proof = {
        "source_totals": {key: _plain(value) for key, value in source_totals.items()},
        "target_totals": clean_targets,
        "multiplier": _plain(multiplier),
        "period_count": len(clean_periods),
        "sku_allocation_count": len(clean_skus),
        "driver_match": True,
    }
    return plan_payload, proof


def build_recovery_decision(
    *,
    snapshot: dict[str, Any],
    base_plan: dict[str, Any],
    lineage_review: dict[str, Any],
    request: dict[str, Any],
) -> dict[str, Any]:
    source_year = int(request.get("source_year", 0) or 0)
    target_year = int(request.get("target_year", 0) or 0)
    if source_year != int(snapshot.get("source_year", 0) or 0) or target_year != int(
        snapshot.get("target_year", 0) or 0
    ):
        raise YearsetRecoveryValidationError(
            "Herstelbesluit en actuele jaarovergang komen niet overeen."
        )
    if _text(request.get("expected_lineage_review_hash")) != _text(
        lineage_review.get("lineage_review_hash")
    ):
        raise YearsetRecoveryValidationError(
            "De blocker-lineage is gewijzigd; maak eerst een nieuwe preview."
        )
    if _text(request.get("allocation_policy")) != ALLOCATION_POLICY:
        raise YearsetRecoveryValidationError(
            f"Alleen allocatiebeleid '{ALLOCATION_POLICY}' is in RF-013C3 toegestaan."
        )

    automatic_ids = {
        _text(row.get("sku_id"))
        for row in lineage_review.get("cost_items", [])
        if isinstance(row, dict)
        and _text(row.get("classification"))
        == "reproducible_from_exact_target_anchor"
        and bool(row.get("automatic_reproduction_eligible"))
    }
    requested_automatic_rows = [
        _text(value)
        for value in request.get("exact_target_anchor_sku_ids", [])
        if _text(value)
    ]
    requested_automatic = set(requested_automatic_rows)
    if (
        requested_automatic != automatic_ids
        or len(requested_automatic_rows) != len(requested_automatic)
    ):
        raise YearsetRecoveryValidationError(
            "De expliciet goedgekeurde target-anchors zijn niet exact gelijk aan "
            "de actuele reproduceerbare blocker-set."
        )

    human_scope_ids = {
        _text(row.get("sku_id"))
        for row in lineage_review.get("cost_items", [])
        if isinstance(row, dict)
        and _text(row.get("classification"))
        == "human_scope_and_cost_decision_required"
    }
    scope_rows = [
        row for row in request.get("scope_decisions", []) if isinstance(row, dict)
    ]
    excluded_ids = {
        _text(row.get("sku_id"))
        for row in scope_rows
        if _text(row.get("decision")) == "historical_only_for_target_year"
        and _text(row.get("reason"))
    }
    if excluded_ids != human_scope_ids or len(scope_rows) != len(excluded_ids):
        raise YearsetRecoveryValidationError(
            "Iedere actuele menselijke kost/scopebeslissing moet exact één "
            "gemotiveerde targetjaar-uitsluiting hebben."
        )

    pricing_required_ids = {
        _text(row.get("sku_id"))
        for row in lineage_review.get("sell_in_items", [])
        if isinstance(row, dict)
        and _text(row.get("classification")) == "human_pricing_policy_required"
    }
    pricing_rows = [
        row for row in request.get("pricing_decisions", []) if isinstance(row, dict)
    ]
    pricing_ids = {_text(row.get("sku_id")) for row in pricing_rows}
    if pricing_ids != pricing_required_ids or len(pricing_rows) != len(pricing_ids):
        raise YearsetRecoveryValidationError(
            "Iedere actuele prijsbeleidbeslissing moet exact één prijsregel hebben."
        )
    pricing_overrides: list[dict[str, Any]] = []
    for row in pricing_rows:
        price = _decimal(row.get("sell_in_ex_vat"))
        if (
            price <= 0
            or _text(row.get("currency")).upper() != "EUR"
            or _text(row.get("vat_basis")) != "exclusive"
            or not _text(row.get("reason"))
        ):
            raise YearsetRecoveryValidationError(
                "Een prijsbesluit vereist een positieve EUR sell-in exclusief btw "
                "en een reden."
            )
        pricing_overrides.append(
            {
                "sku_id": _text(row.get("sku_id")),
                "sell_in_ex_vat": _plain(price),
                "currency": "EUR",
                "vat_basis": "exclusive",
                "reason": _text(row.get("reason")),
            }
        )

    plan_lineage = _payload(lineage_review.get("plan"))
    if _text(plan_lineage.get("classification")) != "human_plan_input_required":
        raise YearsetRecoveryValidationError(
            "De actuele Plan-lineage vraagt niet om de expliciete RF-013C3-invoer."
        )
    if not _text(request.get("reason")):
        raise YearsetRecoveryValidationError(
            "Een overkoepelende reden voor het herstelbesluit is verplicht."
        )

    all_active_ids = {
        _text(row.get("id"))
        for row in snapshot.get("skus", [])
        if isinstance(row, dict)
        and _text(row.get("id"))
        and bool(row.get("active", True))
    }
    included_ids = all_active_ids - excluded_ids
    plan_payload, plan_proof = _build_plan(
        snapshot,
        approved_revenue=_decimal(request.get("approved_plan_revenue_ex_vat")),
        included_sku_ids=included_ids,
    )
    exact_authority_groups: dict[str, list[dict[str, Any]]] = {}
    for row in snapshot.get("target_authorities", []):
        if not isinstance(row, dict) or not _text(row.get("sku_id")):
            continue
        exact_authority_groups.setdefault(_text(row.get("sku_id")), []).append(row)
    anchor_decisions: list[dict[str, Any]] = []
    for sku_id in sorted(automatic_ids):
        authorities = exact_authority_groups.get(sku_id, [])
        if len(authorities) != 1:
            raise YearsetRecoveryValidationError(
                f"Voor SKU '{sku_id}' is niet exact een target-authority aanwezig."
            )
        authority = authorities[0]
        required_authority_keys = (
            "anchor_id",
            "activation_id",
            "cost_version_id",
            "cost_row_id",
            "authority_hash",
        )
        if any(
            not _text(authority.get(key)) for key in required_authority_keys
        ):
            raise YearsetRecoveryValidationError(
                f"De target-authority voor SKU '{sku_id}' is onvolledig."
            )
        anchor_decisions.append(
            {
                "sku_id": sku_id,
                "anchor_id": _text(authority.get("anchor_id")),
                "activation_id": _text(authority.get("activation_id")),
                "cost_version_id": _text(authority.get("cost_version_id")),
                "cost_row_id": _text(authority.get("cost_row_id")),
                "authority_hash": _text(authority.get("authority_hash")),
            }
        )

    payload = {
        "version": RECOVERY_VERSION,
        "source_year": source_year,
        "target_year": target_year,
        "excluded_sku_ids": sorted(excluded_ids),
        "scope_decisions": sorted(scope_rows, key=_stable),
        "exact_target_anchor_decisions": anchor_decisions,
        "pricing_overrides": sorted(pricing_overrides, key=_stable),
        "plan_row": {
            "id": _stable_id(
                "recovered-plan",
                source_year,
                target_year,
                _text(base_plan.get("manifest_hash")),
                _plain(request.get("approved_plan_revenue_ex_vat")),
            ),
            "source": "new_year_preparation",
            "payload": plan_payload,
        },
        "plan_proof": plan_proof,
        "allocation_policy": ALLOCATION_POLICY,
        "owner_decision_reason": _text(request.get("reason")),
    }
    decision_identity = {
        "lineage_review_hash": _text(lineage_review.get("lineage_review_hash")),
        "base_manifest_hash": _text(base_plan.get("manifest_hash")),
        "payload": payload,
    }
    decision_hash = _hash(decision_identity, "approved-recovery-decision")
    return {
        "id": _stable_id("approved-recovery-input", target_year, decision_hash),
        "version": RECOVERY_VERSION,
        "source_year": source_year,
        "target_year": target_year,
        "lineage_review_hash": _text(lineage_review.get("lineage_review_hash")),
        "base_manifest_hash": _text(base_plan.get("manifest_hash")),
        "decision_hash": decision_hash,
        "payload": payload,
    }


def apply_recovery_input(
    snapshot: dict[str, Any],
    recovery: dict[str, Any],
    *,
    base_manifest_hash: str,
) -> dict[str, Any]:
    patched = copy.deepcopy(snapshot)
    patched.pop("approved_recovery_input", None)
    record_payload = _payload(recovery.get("payload"))
    if _text(recovery.get("base_manifest_hash")) != _text(base_manifest_hash):
        patched["recovery_blockers"] = ["approved_recovery_input_stale"]
        return patched
    if (
        int(recovery.get("source_year", 0) or 0)
        != int(snapshot.get("source_year", 0) or 0)
        or int(recovery.get("target_year", 0) or 0)
        != int(snapshot.get("target_year", 0) or 0)
    ):
        patched["recovery_blockers"] = ["approved_recovery_year_scope_mismatch"]
        return patched

    excluded = _exact_set(record_payload.get("excluded_sku_ids", []))
    anchor_rows = [
        row
        for row in record_payload.get("exact_target_anchor_decisions", [])
        if isinstance(row, dict)
    ]
    authority_groups: dict[str, list[dict[str, Any]]] = {}
    for row in snapshot.get("target_authorities", []):
        if not isinstance(row, dict) or not _text(row.get("sku_id")):
            continue
        authority_groups.setdefault(_text(row.get("sku_id")), []).append(row)
    recovery_engine_rows: list[dict[str, Any]] = []
    for decision in anchor_rows:
        sku_id = _text(decision.get("sku_id"))
        authorities = authority_groups.get(sku_id, [])
        authority = authorities[0] if len(authorities) == 1 else None
        keys = (
            "anchor_id",
            "activation_id",
            "cost_version_id",
            "cost_row_id",
            "authority_hash",
        )
        if not authority or any(
            _text(authority.get(key)) != _text(decision.get(key)) for key in keys
        ):
            patched.setdefault("recovery_blockers", []).append(
                "approved_exact_target_authority_changed"
            )
            continue
        recovery_engine_rows.append(
            {
                "sku_id": sku_id,
                "source_version_id": "",
                "source_cost": "0.000000",
                "source_primary": "0.000000",
                "source_packaging": "0.000000",
                "source_overhead": "0.000000",
                "source_excise": "0.000000",
                "scenario_primary": _plain(authority.get("primary")),
                "target_packaging": _plain(authority.get("packaging")),
                "target_overhead": _plain(authority.get("overhead")),
                "target_excise": _plain(authority.get("excise")),
                "target_cost": _plain(authority.get("cost_price")),
                "engine_version": "exact_target_anchor_recovery",
                "source_year": int(snapshot.get("source_year", 0) or 0),
                "target_year": int(snapshot.get("target_year", 0) or 0),
                "recovery_authority": {
                    key: _text(authority.get(key)) for key in keys
                },
            }
        )

    batches = [
        row for row in patched.get("engine_batches", []) if isinstance(row, dict)
    ]
    matching = [
        row
        for row in batches
        if int(row.get("source_year", 0) or 0)
        == int(snapshot.get("source_year", 0) or 0)
        and int(row.get("target_year", 0) or 0)
        == int(snapshot.get("target_year", 0) or 0)
    ]
    if len(matching) == 1:
        existing = [
            row for row in _array(matching[0].get("rows")) if isinstance(row, dict)
        ]
        existing_ids = {_text(row.get("sku_id")) for row in existing}
        matching[0]["rows"] = [
            *existing,
            *[
                row
                for row in recovery_engine_rows
                if _text(row.get("sku_id")) not in existing_ids
            ],
        ]
    else:
        patched.setdefault("recovery_blockers", []).append(
            "approved_recovery_engine_batch_unavailable"
        )

    price_overrides = {
        _text(row.get("sku_id")): row
        for row in record_payload.get("pricing_overrides", [])
        if isinstance(row, dict) and _text(row.get("sku_id"))
    }
    target_prices = [
        row for row in patched.get("target_prices", []) if isinstance(row, dict)
    ]
    for sku_id, override in price_overrides.items():
        matches = [row for row in target_prices if _text(row.get("sku_id")) == sku_id]
        if len(matches) != 1:
            patched.setdefault("recovery_blockers", []).append(
                "approved_pricing_target_changed"
            )
            continue
        price_payload = _payload(matches[0].get("payload"))
        sell_in = _payload(price_payload.get("sell_in_prices"))
        price_payload["sell_in_prices"] = {
            **sell_in,
            "list": _plain(override.get("sell_in_ex_vat")),
        }
        matches[0]["payload"] = price_payload
        matches[0]["recovery_decision_hash"] = _text(recovery.get("decision_hash"))

    patched["excluded_sku_ids"] = sorted(excluded)
    patched["plan_rows"] = [copy.deepcopy(record_payload.get("plan_row", {}))]
    patched["recovery_metadata"] = {
        "version": RECOVERY_VERSION,
        "decision_id": _text(recovery.get("id")),
        "decision_hash": _text(recovery.get("decision_hash")),
        "lineage_review_hash": _text(recovery.get("lineage_review_hash")),
        "excluded_sku_ids": sorted(excluded),
        "exact_target_anchor_sku_ids": sorted(
            _text(row.get("sku_id")) for row in anchor_rows
        ),
        "pricing_override_sku_ids": sorted(price_overrides),
        "allocation_policy": _text(record_payload.get("allocation_policy")),
        "legacy_target_untouched": True,
    }
    return patched
