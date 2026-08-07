from __future__ import annotations

from typing import Any, Iterable

from app.domain import postgres_storage, yearset_dossier_service


CONTRACT_VERSION = "rf-012d2-v1"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed and parsed not in {float("inf"), float("-inf")} else None


def _missing(reason_codes: Iterable[str]) -> dict[str, Any]:
    return {
        "version": CONTRACT_VERSION,
        "status": "missing",
        "read_only": True,
        "binding": None,
        "groups": [],
        "summary": {
            "sku_count": 0,
            "group_count": 0,
            "ready_count": 0,
            "missing_cost_count": 0,
            "not_activated_count": 0,
            "not_applicable_count": 0,
        },
        "shadow_parity": None,
        "reason_codes": sorted({_text(code) for code in reason_codes if _text(code)}),
    }


def _cost_state(row: dict[str, Any]) -> str:
    # `in_active_generation` is an explicit extension seam for a later catalogue
    # projection. Every current dossier row is part of the active generation.
    if row.get("in_active_generation", True) is False:
        return "not_activated"
    if not bool(row.get("cost_required")):
        return "not_applicable"
    cost = _number(row.get("cost_price"))
    if _text(row.get("cost_readiness_status")) != "ready" or cost is None or cost <= 0:
        return "missing_cost"
    return "ready"


def _display_priority(row: dict[str, Any]) -> int:
    label = _text(row.get("sku_name")).casefold().replace("×", "x").replace("*", "x")
    compact = "".join(label.split())
    if "doos24x33cl" in compact:
        return 0
    if any(token in label for token in ("fust", "keg", "vat")):
        return 1
    return 2


def _group_identity(row: dict[str, Any]) -> tuple[str, str, str, int]:
    beer_name = _text(row.get("beer_name"))
    canonical_beer_id = _text(row.get("canonical_beer_id"))
    subject_id = _text(row.get("subject_id"))
    subject_type = _text(row.get("subject_type")).lower()
    if beer_name:
        return (
            f"beer:{canonical_beer_id or beer_name.casefold()}",
            beer_name,
            "beer",
            0,
        )
    labels = {
        "bundle": "Samengestelde producten",
        "service": "Diensten",
        "article": "Overige artikelen",
    }
    label = labels.get(subject_type, "Overige producten")
    return (f"other:{subject_type or 'other'}", label, subject_type or "other", 1)


def build_active_cost_overview(
    dossier: dict[str, Any],
    *,
    legacy_activation_sku_ids: Iterable[str] = (),
) -> dict[str, Any]:
    """Project the active immutable commercial generation for Kostprijs beheren."""

    if dossier.get("status") != "ready" or not isinstance(dossier.get("binding"), dict):
        return _missing(dossier.get("reason_codes") or ["active_commercial_yearset_missing"])
    binding = dict(dossier["binding"])
    if _text(binding.get("generation_status")) != "active":
        return _missing(["commercial_yearset_not_active"])

    raw_rows = [row for row in dossier.get("sku_items", []) if isinstance(row, dict)]
    sku_ids = [_text(row.get("sku_id")) for row in raw_rows]
    if any(not sku_id for sku_id in sku_ids):
        return _missing(["active_generation_sku_identity_missing"])
    if len(sku_ids) != len(set(sku_ids)):
        return _missing(["active_generation_duplicate_sku"])

    grouped: dict[str, dict[str, Any]] = {}
    state_counts = {
        "ready": 0,
        "missing_cost": 0,
        "not_activated": 0,
        "not_applicable": 0,
    }
    for raw in raw_rows:
        group_key, group_label, group_kind, group_priority = _group_identity(raw)
        state = _cost_state(raw)
        state_counts[state] += 1
        row = {
            "sku_id": _text(raw.get("sku_id")),
            "sku_code": _text(raw.get("sku_code")),
            "sku_name": _text(raw.get("sku_name")) or _text(raw.get("sku_id")),
            "beer_name": _text(raw.get("beer_name")),
            "subject_type": _text(raw.get("subject_type")),
            "scope_classification": _text(raw.get("scope_classification")),
            "calculation_method": _text(raw.get("calculation_method")),
            "cost_method": _text(raw.get("cost_method")),
            "provenance_kind": _text(raw.get("provenance_kind")),
            "provenance_source_year": int(raw.get("provenance_source_year") or 0),
            "primary_cost": _number(raw.get("primary_cost")),
            "packaging_cost": _number(raw.get("packaging_cost")),
            "overhead_cost": _number(raw.get("overhead_cost")),
            "excise_cost": _number(raw.get("excise_cost")),
            "cost_price": _number(raw.get("cost_price")),
            "cost_state": state,
            "cost_blocker_codes": sorted(
                {_text(code) for code in raw.get("cost_blocker_codes", []) if _text(code)}
            ),
            "display_priority": _display_priority(raw),
        }
        group = grouped.setdefault(
            group_key,
            {
                "key": group_key,
                "label": group_label,
                "kind": group_kind,
                "priority": group_priority,
                "items": [],
            },
        )
        group["items"].append(row)

    groups = list(grouped.values())
    for group in groups:
        group["items"].sort(
            key=lambda row: (
                int(row["display_priority"]),
                _text(row["sku_name"]).casefold(),
                _text(row["sku_id"]),
            )
        )
    groups.sort(key=lambda group: (int(group["priority"]), _text(group["label"]).casefold(), group["key"]))

    generation_ids = set(sku_ids)
    legacy_ids = {_text(sku_id) for sku_id in legacy_activation_sku_ids if _text(sku_id)}
    shared_ids = generation_ids.intersection(legacy_ids)
    shadow_parity = {
        "status": "match" if generation_ids == legacy_ids else "different",
        "generation_sku_count": len(generation_ids),
        "legacy_activation_sku_count": len(legacy_ids),
        "shared_sku_count": len(shared_ids),
        "only_generation_count": len(generation_ids - legacy_ids),
        "only_legacy_count": len(legacy_ids - generation_ids),
    }
    return {
        "version": CONTRACT_VERSION,
        "status": "ready",
        "read_only": True,
        "binding": {
            "generation_id": _text(binding.get("generation_id")),
            "run_id": _text(binding.get("run_id")),
            "operational_year": int(dossier.get("operational_year") or 0),
            "manifest_hash": _text(binding.get("manifest_hash")),
            "validation_hash": _text(binding.get("validation_hash")),
        },
        "groups": groups,
        "summary": {
            "sku_count": len(sku_ids),
            "group_count": len(groups),
            "ready_count": state_counts["ready"],
            "missing_cost_count": state_counts["missing_cost"],
            "not_activated_count": state_counts["not_activated"],
            "not_applicable_count": state_counts["not_applicable"],
        },
        "shadow_parity": shadow_parity,
        "reason_codes": [],
    }


def read_active_cost_overview() -> dict[str, Any]:
    """Read the active generation and compare its SKU scope to the legacy reader."""

    dossier = yearset_dossier_service.read_active_yearset_dossier()
    if dossier.get("status") != "ready":
        return build_active_cost_overview(dossier)
    year = int(dossier.get("operational_year") or 0)
    with postgres_storage.connect() as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        legacy_rows = conn.execute(
            """
            SELECT DISTINCT sku_id
            FROM kostprijs_sku_activations
            WHERE jaar = %s AND effectief_tot IS NULL
            ORDER BY sku_id
            """,
            (year,),
        ).fetchall()
    return build_active_cost_overview(
        dossier,
        legacy_activation_sku_ids=[_text(row[0]) for row in legacy_rows],
    )
