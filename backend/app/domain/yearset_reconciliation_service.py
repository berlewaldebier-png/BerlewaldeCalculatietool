from __future__ import annotations

import copy
import hashlib
import json
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable
from uuid import NAMESPACE_URL, uuid5

from app.domain import (
    adviesprijzen_storage,
    articles_storage,
    bom_storage,
    break_even_planning_storage,
    commercial_yearset_service,
    commercial_yearset_storage,
    cost_authority_storage,
    cost_versions_storage,
    douano_product_mapping_storage,
    kostprijs_activation_storage,
    postgres_storage,
    sales_pricing_storage,
    skus_storage,
    yearset_reconciliation_storage,
)


PLANNER_VERSION = "rf-013c-v1"
_MONEY_TOLERANCE = Decimal("0.01")
_LOCK_TABLES = (
    "advice_channel_pricing",
    "app_datasets",
    "articles",
    "bom_lines",
    "break_even_plan_snapshots",
    "canonical_sku_subjects",
    "commercial_yearsets",
    "cost_version_sku_rows",
    "douano_product_mapping",
    "kostprijs_sku_activations",
    "planning_cost_anchors",
    "sales_pricing_records",
    "skus",
    "year_close_snapshots",
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value if value not in (None, "") else 0))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _plain_decimal(value: Decimal | Any) -> str:
    return format(_decimal(value).quantize(Decimal("0.000001")), "f")


def _stable(value: Any) -> str:
    def normalize(item: Any) -> Any:
        if isinstance(item, Decimal):
            return _plain_decimal(item)
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
    raw = f"{PLANNER_VERSION}:{domain}:".encode("utf-8") + _stable(value).encode(
        "utf-8"
    )
    return f"sha256:{hashlib.sha256(raw).hexdigest()}"


def _stable_id(scope: str, *values: Any) -> str:
    return str(
        uuid5(
            NAMESPACE_URL,
            ":".join([PLANNER_VERSION, scope, *[_text(value) for value in values]]),
        )
    )


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


def _truthy(value: Any, fallback: bool = True) -> bool:
    if value is None:
        return fallback
    if isinstance(value, bool):
        return value
    return _text(value).lower() not in {"0", "false", "no", "nee", "inactive", "inactief"}


def _engine_financial_signature(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "sku_id": _text(row.get("sku_id")),
        "source_version_id": _text(row.get("source_version_id")),
        "source_cost": _plain_decimal(row.get("source_cost")),
        "source_primary": _plain_decimal(row.get("source_primary")),
        "source_packaging": _plain_decimal(row.get("source_packaging")),
        "source_overhead": _plain_decimal(row.get("source_overhead")),
        "source_excise": _plain_decimal(row.get("source_excise")),
        "target_primary": _plain_decimal(
            row.get("scenario_primary", row.get("target_primary"))
        ),
        "target_packaging": _plain_decimal(row.get("target_packaging")),
        "target_overhead": _plain_decimal(row.get("target_overhead")),
        "target_excise": _plain_decimal(row.get("target_excise")),
        "target_cost": _plain_decimal(row.get("target_cost")),
        "engine_version": _text(row.get("engine_version")),
        "source_year": int(row.get("source_year", 0) or 0),
        "target_year": int(row.get("target_year", 0) or 0),
    }


def _components_from_engine(row: dict[str, Any]) -> dict[str, Decimal]:
    return {
        "primary": _decimal(row.get("scenario_primary", row.get("target_primary"))),
        "packaging": _decimal(row.get("target_packaging")),
        "overhead": _decimal(row.get("target_overhead")),
        "excise": _decimal(row.get("target_excise")),
        "cost_price": _decimal(row.get("target_cost")),
    }


def _components_from_anchor(row: dict[str, Any] | None) -> dict[str, Decimal] | None:
    if not row:
        return None
    return {
        "primary": _decimal(row.get("primary")),
        "packaging": _decimal(row.get("packaging")),
        "overhead": _decimal(row.get("overhead")),
        "excise": _decimal(row.get("excise")),
        "cost_price": _decimal(row.get("cost_price")),
    }


def _changed_fields(
    source: dict[str, Decimal] | None, target: dict[str, Decimal] | None
) -> list[str]:
    if source is None or target is None:
        return ["components"] if source != target else []
    fields: list[str] = []
    for key, label in (
        ("primary", "components.primary"),
        ("packaging", "components.packaging"),
        ("overhead", "components.overhead"),
        ("excise", "components.excise"),
        ("cost_price", "components.cost_price"),
    ):
        if abs(source[key] - target[key]) > _MONEY_TOLERANCE:
            fields.append(label)
    return fields


def _canonical_blockers(values: Iterable[str]) -> list[str]:
    return sorted({_text(value) for value in values if _text(value)})


def build_reconciliation_plan(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Build one immutable candidate from stable IDs; labels never establish identity."""

    source_year = int(snapshot.get("source_year", 0) or 0)
    target_year = int(snapshot.get("target_year", 0) or 0)
    global_blockers: list[str] = []
    if source_year <= 0 or target_year <= source_year:
        global_blockers.append("invalid_year_transition")

    skus = {
        _text(row.get("id")): row
        for row in snapshot.get("skus", [])
        if isinstance(row, dict) and _text(row.get("id"))
    }
    subjects = {
        _text(row.get("sku_id")): row
        for row in snapshot.get("subjects", [])
        if isinstance(row, dict) and _text(row.get("sku_id"))
    }
    source_anchors = {
        _text(row.get("sku_id")): row
        for row in snapshot.get("source_anchors", [])
        if isinstance(row, dict) and _text(row.get("sku_id"))
    }
    target_activation_ids = {
        _text(value) for value in snapshot.get("target_activation_sku_ids", []) if _text(value)
    }
    source_prices_by_sku = _unique_rows_by_sku(
        snapshot.get("source_prices", []), "source_pricing_duplicate", global_blockers
    )
    target_prices_by_sku = _unique_rows_by_sku(
        snapshot.get("target_prices", []), "target_pricing_duplicate", global_blockers
    )
    price_sku_ids = set(source_prices_by_sku) | set(target_prices_by_sku)

    engine_batches = [
        row
        for row in snapshot.get("engine_batches", [])
        if isinstance(row, dict)
        and int(row.get("source_year", 0) or 0) == source_year
        and int(row.get("target_year", 0) or 0) == target_year
    ]
    if not engine_batches:
        global_blockers.append("target_engine_batch_missing")
        engine_rows: list[dict[str, Any]] = []
    elif len(engine_batches) > 1:
        global_blockers.append("target_engine_batch_ambiguous")
        engine_rows = []
    else:
        engine_rows = [
            row
            for row in _array(engine_batches[0].get("rows"))
            if isinstance(row, dict)
        ]
    engine_by_sku: dict[str, dict[str, Any]] = {}
    for sku_id, rows in _group_rows(engine_rows, "sku_id").items():
        signatures = {_stable(_engine_financial_signature(row)) for row in rows}
        if len(signatures) == 1:
            engine_by_sku[sku_id] = sorted(rows, key=_stable)[0]
        else:
            global_blockers.append("target_engine_duplicate_conflict")

    active_sku_ids = sorted(
        sku_id
        for sku_id, row in skus.items()
        if _truthy(row.get("active"), True)
    )
    if not active_sku_ids:
        global_blockers.append("canonical_sku_scope_missing")

    bom_by_parent: dict[str, list[dict[str, Any]]] = {}
    for row in snapshot.get("bom_lines", []):
        if not isinstance(row, dict):
            continue
        bom_by_parent.setdefault(_text(row.get("parent_article_id")), []).append(row)
    mappings_by_sku: dict[str, list[dict[str, Any]]] = {}
    for row in snapshot.get("mappings", []):
        if not isinstance(row, dict):
            continue
        mappings_by_sku.setdefault(_text(row.get("sku_id")), []).append(row)

    target_input_hash = _hash(
        {
            "engine_batches": engine_batches,
            "target_prices": snapshot.get("target_prices", []),
            "channels": snapshot.get("channels", []),
            "advice_rows": snapshot.get("advice_rows", []),
            "plan_rows": snapshot.get("plan_rows", []),
        },
        "target-input",
    )
    source_year_close_ids = sorted(
        {
            _text(value)
            for value in snapshot.get("source_year_close_ids", [])
            if _text(value)
        }
    )
    if not source_year_close_ids and _text(snapshot.get("source_year_close_id")):
        source_year_close_ids = [_text(snapshot.get("source_year_close_id"))]
    source_snapshot_hash = _hash(
        {
            "skus": snapshot.get("skus", []),
            "subjects": snapshot.get("subjects", []),
            "source_anchors": snapshot.get("source_anchors", []),
            "source_prices": snapshot.get("source_prices", []),
            "bom_lines": snapshot.get("bom_lines", []),
            "mappings": snapshot.get("mappings", []),
            "source_year_close_ids": source_year_close_ids,
        },
        "source-snapshot",
    )

    sku_entries: list[dict[str, Any]] = []
    for sku_id in active_sku_ids:
        sku = skus[sku_id]
        subject = subjects.get(sku_id)
        anchor = source_anchors.get(sku_id)
        has_target_activation = sku_id in target_activation_ids
        is_sellable = sku_id in price_sku_ids
        if anchor:
            scope = "carried_forward"
        elif has_target_activation:
            scope = "target_operational_addition"
        elif is_sellable:
            scope = "sellable_without_anchor"
        else:
            scope = "catalog_reference_only"
        cost_required = scope != "catalog_reference_only"
        blockers: list[str] = []
        if not subject:
            blockers.append("canonical_sku_subject_missing")
        target_input = engine_by_sku.get(sku_id)
        target_components = (
            _components_from_engine(target_input) if target_input else None
        )
        if cost_required and not target_input:
            blockers.append("target_cost_input_missing")
        if target_input and cost_required:
            if int(target_input.get("source_year", 0) or 0) != source_year:
                blockers.append("target_input_source_year_mismatch")
            if int(target_input.get("target_year", 0) or 0) != target_year:
                blockers.append("target_input_target_year_mismatch")
            if anchor and _text(target_input.get("source_version_id")) != _text(
                anchor.get("cost_version_id")
            ):
                blockers.append("source_cost_lineage_mismatch")
            if not anchor and scope == "sellable_without_anchor":
                blockers.append("source_planning_anchor_missing")
            assert target_components is not None
            summed = (
                target_components["primary"]
                + target_components["packaging"]
                + target_components["overhead"]
                + target_components["excise"]
            )
            if abs(summed - target_components["cost_price"]) > _MONEY_TOLERANCE:
                blockers.append("target_cost_component_balance_mismatch")
            if target_components["cost_price"] <= 0:
                blockers.append("target_cost_non_positive")
            if any(target_components[key] < 0 for key in target_components):
                blockers.append("target_cost_component_negative")

        format_article_id = _text(
            sku.get("format_article_id") or sku.get("article_id")
        )
        liters = _decimal(sku.get("content_liter"))
        if cost_required and _text((subject or {}).get("subject_type")) == "beer" and liters <= 0:
            blockers.append("target_liters_missing")
        source_components = _components_from_anchor(anchor)
        source_hash = _hash(anchor or {"sku_id": sku_id}, "source-cost")
        target_hash = _hash(
            _engine_financial_signature(target_input)
            if target_input
            else {"sku_id": sku_id, "missing": True},
            "target-cost",
        )
        seed = _hash(
            {
                "source_snapshot_hash": source_snapshot_hash,
                "target_input_hash": target_input_hash,
                "sku_id": sku_id,
            },
            "candidate-row-seed",
        )
        readiness = (
            "not_required"
            if not cost_required and not blockers
            else "ready"
            if not blockers
            else "blocked"
        )
        provenance = (
            "recalculated_from_source_year"
            if anchor
            else "introduced_in_target_year"
            if has_target_activation
            else "unresolved_sellable_lineage"
            if is_sellable
            else "catalog_reference"
        )
        sku_entries.append(
            {
                "id": _stable_id("candidate-sku", seed),
                "sku_id": sku_id,
                "scope_classification": scope,
                "subject_type": _text((subject or {}).get("subject_type")) or "article",
                "subject_id": _text((subject or {}).get("subject_id")) or sku_id,
                "canonical_beer_id": _text((subject or {}).get("beer_id")),
                "format_article_id": format_article_id,
                "sku_kind": _text(sku.get("kind")),
                "structure_fingerprint": _hash(
                    {
                        "sku": {
                            "id": sku_id,
                            "kind": _text(sku.get("kind")),
                            "beer_id": _text(sku.get("beer_id")),
                            "format_article_id": format_article_id,
                            "article_id": _text(sku.get("article_id")),
                            "cost_origin": _text(sku.get("cost_origin")),
                            "cost_parent_sku_id": _text(sku.get("cost_parent_sku_id")),
                            "cost_parent_quantity": _plain_decimal(
                                sku.get("cost_parent_quantity")
                            ),
                        },
                        "bom": bom_by_parent.get(format_article_id, []),
                    },
                    "sku-structure",
                ),
                "mapping_fingerprint": _hash(
                    mappings_by_sku.get(sku_id, []), "external-mapping"
                ),
                "source_anchor_id": _text((anchor or {}).get("anchor_id")),
                "source_cost_version_id": _text(
                    (anchor or {}).get("cost_version_id")
                ),
                "source_cost_row_id": _text((anchor or {}).get("cost_row_id")),
                "reserved_target_version_id": _stable_id(
                    "candidate-cost-version", seed
                ),
                "reserved_target_cost_row_id": _stable_id(
                    "candidate-cost-row", seed
                ),
                "calculation_method": _text(
                    (target_input or {}).get("engine_version")
                )
                or "unresolved",
                "provenance_kind": provenance,
                "provenance_source_year": source_year if anchor else target_year,
                "target_components": target_components,
                "liters_per_unit": liters if liters > 0 else None,
                "cost_required": cost_required,
                "readiness_status": readiness,
                "changed_fields": _changed_fields(
                    source_components, target_components
                ),
                "blocker_codes": _canonical_blockers(blockers),
                "source_hash": source_hash,
                "target_hash": target_hash,
            }
        )

    sku_entry_by_id = {row["sku_id"]: row for row in sku_entries}
    price_entries: list[dict[str, Any]] = []
    for sku_id in sorted(price_sku_ids):
        source_price = source_prices_by_sku.get(sku_id)
        target_price = target_prices_by_sku.get(sku_id)
        blockers: list[str] = []
        if sku_id not in skus:
            blockers.append("pricing_unknown_sku")
        if not target_price:
            blockers.append("target_sell_in_missing")
            list_price: Decimal | None = None
        else:
            price_payload = _payload(target_price.get("payload"))
            sell_in = _payload(price_payload.get("sell_in_prices"))
            channels = _payload(price_payload.get("kanaalprijzen"))
            raw_price = (
                sell_in.get("list")
                if sell_in.get("list") not in (None, "")
                else channels.get("list")
            )
            list_price = _decimal(raw_price)
            if list_price <= 0:
                blockers.append("target_sell_in_non_positive")
        candidate_cost = sku_entry_by_id.get(sku_id)
        if not candidate_cost or candidate_cost["readiness_status"] not in {
            "ready",
            "not_required",
        }:
            blockers.append("target_sell_in_cost_unresolved")
        price_entries.append(
            {
                "id": _stable_id(
                    "candidate-price", target_input_hash, sku_id
                ),
                "sku_id": sku_id,
                "source_pricing_id": _text((source_price or {}).get("id")),
                "target_pricing_id": _text((target_price or {}).get("id")),
                "list_price": list_price,
                "readiness_status": "ready" if not blockers else "blocked",
                "blocker_codes": _canonical_blockers(blockers),
                "source_hash": _hash(source_price or {}, "source-price"),
                "target_hash": _hash(target_price or {}, "target-price"),
            }
        )

    channel_entries: list[dict[str, Any]] = []
    active_channels = sorted(
        {
            _text(row.get("code") or row.get("id")).lower()
            for row in snapshot.get("channels", [])
            if isinstance(row, dict)
            and _text(row.get("code") or row.get("id"))
            and _truthy(row.get("active", row.get("actief")), True)
        }
    )
    advice_by_channel = _group_rows(snapshot.get("advice_rows", []), "channel_code")
    if not active_channels:
        global_blockers.append("active_channel_policy_missing")
    for code in active_channels:
        rows = advice_by_channel.get(code, [])
        blockers: list[str] = []
        markup: Decimal | None = None
        if not rows:
            blockers.append("target_advice_channel_missing")
        elif len(rows) > 1:
            blockers.append("target_advice_channel_duplicate")
        else:
            markup = _decimal(rows[0].get("opslag_pct"))
            if markup < 0:
                blockers.append("target_advice_markup_negative")
        channel_entries.append(
            {
                "id": _stable_id("candidate-channel", target_input_hash, code),
                "channel_code": code,
                "advice_markup_pct": markup,
                "readiness_status": "ready" if not blockers else "blocked",
                "blocker_codes": blockers,
                "source_hash": _hash(rows, "target-advice-channel"),
            }
        )

    plan_rows = [
        row for row in snapshot.get("plan_rows", []) if isinstance(row, dict)
    ]
    plan_blockers: list[str] = []
    if not plan_rows:
        plan_blockers.append("active_plan_missing")
        source_plan = {}
    elif len(plan_rows) > 1:
        plan_blockers.append("active_plan_ambiguous")
        source_plan = {}
    else:
        source_plan = plan_rows[0]
    source_plan_payload = _payload(source_plan.get("payload"))
    plan_contract = commercial_yearset_service.validate_plan_contract(
        source=_text(source_plan.get("source")),
        payload=source_plan_payload,
    )
    plan_blockers.extend(_text(code) for code in plan_contract.get("blockers", []))
    frozen_plan = (
        {
            "source": _text(source_plan.get("source")),
            "source_record_id": _text(source_plan.get("id")),
            "payload": source_plan_payload,
        }
        if source_plan
        else {}
    )
    initial_forecast = (
        {
            "basis": "frozen_plan",
            "plan_contract_hash": _text(plan_contract.get("contract_hash")),
            "forecast": copy.deepcopy(source_plan_payload),
        }
        if not plan_blockers
        else {}
    )
    plan_entry = {
        "id": _stable_id("candidate-plan", target_input_hash, target_year),
        "source_plan_id": _text(source_plan.get("id")),
        "plan_contract_hash": _text(plan_contract.get("contract_hash")),
        "frozen_plan": frozen_plan,
        "initial_forecast": initial_forecast,
        "readiness_status": "ready" if not plan_blockers else "blocked",
        "blocker_codes": _canonical_blockers(plan_blockers),
        "source_hash": _hash(source_plan, "frozen-plan-source"),
    }
    if not source_year_close_ids:
        global_blockers.append("source_year_close_missing")
    elif len(source_year_close_ids) > 1:
        global_blockers.append("source_year_close_ambiguous")

    all_blockers = [
        *global_blockers,
        *[
            code
            for row in sku_entries
            for code in row.get("blocker_codes", [])
        ],
        *[
            code
            for row in price_entries
            for code in row.get("blocker_codes", [])
        ],
        *[
            code
            for row in channel_entries
            for code in row.get("blocker_codes", [])
        ],
        *plan_entry["blocker_codes"],
    ]
    blocker_counts: dict[str, int] = {}
    for code in all_blockers:
        blocker_counts[code] = blocker_counts.get(code, 0) + 1

    summary = {
        "sku_count": len(sku_entries),
        "required_cost_count": sum(bool(row["cost_required"]) for row in sku_entries),
        "ready_cost_count": sum(
            row["readiness_status"] == "ready" for row in sku_entries
        ),
        "not_required_cost_count": sum(
            row["readiness_status"] == "not_required" for row in sku_entries
        ),
        "price_count": len(price_entries),
        "ready_price_count": sum(
            row["readiness_status"] == "ready" for row in price_entries
        ),
        "channel_count": len(channel_entries),
        "ready_channel_count": sum(
            row["readiness_status"] == "ready" for row in channel_entries
        ),
        "ui_engine_rows": len(engine_rows),
        "canonical_engine_skus": len(engine_by_sku),
    }
    manifest_payload = {
        "planner_version": PLANNER_VERSION,
        "source_year": source_year,
        "target_year": target_year,
        "source_snapshot_hash": source_snapshot_hash,
        "target_input_hash": target_input_hash,
        "sku_entries": sku_entries,
        "price_entries": price_entries,
        "channel_entries": channel_entries,
        "plan_entry": plan_entry,
        "blocker_counts": blocker_counts,
        "summary": summary,
    }
    manifest_hash = _hash(manifest_payload, "candidate-manifest")
    validation = {
        "version": PLANNER_VERSION,
        "ready": not blocker_counts,
        "source_year": source_year,
        "operational_year": target_year,
        "manifest_hash": manifest_hash,
        "blockers": sorted(blocker_counts),
        "blocker_counts": dict(sorted(blocker_counts.items())),
        "counts": summary,
        "fingerprints": {
            "source": source_snapshot_hash,
            "target_input": target_input_hash,
            "manifest": manifest_hash,
        },
        "source_records": {
            "year_close_snapshot_id": (
                source_year_close_ids[0] if len(source_year_close_ids) == 1 else ""
            ),
            "break_even_plan_id": _text(source_plan.get("id")),
        },
    }
    validation_hash = _hash(validation, "candidate-validation")
    run_id = _stable_id("reconciliation-run", source_year, target_year, manifest_hash)
    return {
        **manifest_payload,
        "run_id": run_id,
        "manifest_hash": manifest_hash,
        "validation": validation,
        "validation_hash": validation_hash,
        "ready": not blocker_counts,
    }


def _group_rows(rows: Iterable[Any], field: str) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = _text(row.get(field)).lower() if field == "channel_code" else _text(row.get(field))
        if key:
            grouped.setdefault(key, []).append(row)
    return grouped


def _unique_rows_by_sku(
    rows: Iterable[Any], duplicate_code: str, global_blockers: list[str]
) -> dict[str, dict[str, Any]]:
    grouped = _group_rows(rows, "sku_id")
    result: dict[str, dict[str, Any]] = {}
    for sku_id, matches in grouped.items():
        if len(matches) == 1:
            result[sku_id] = matches[0]
        else:
            global_blockers.append(duplicate_code)
    return result


def ensure_dependencies() -> None:
    postgres_storage.ensure_schema()
    articles_storage.ensure_schema()
    skus_storage.ensure_schema()
    bom_storage.ensure_schema()
    cost_versions_storage.ensure_schema()
    kostprijs_activation_storage.ensure_schema()
    sales_pricing_storage.ensure_schema()
    adviesprijzen_storage.ensure_schema()
    break_even_planning_storage.ensure_schema()
    douano_product_mapping_storage.ensure_schema()
    cost_authority_storage.ensure_schema()
    commercial_yearset_storage.ensure_schema()
    yearset_reconciliation_storage.ensure_schema()


def _lock_snapshot(conn: Any) -> None:
    conn.execute(
        "SELECT pg_advisory_xact_lock(hashtext(%s))",
        ("calculatietool:yearset-reconciliation-snapshot:v1",),
    )
    for table in _LOCK_TABLES:
        conn.execute(f"LOCK TABLE {table} IN SHARE MODE")


def read_reconciliation_snapshot(
    conn: Any, *, source_year: int, target_year: int
) -> dict[str, Any]:
    skus = [
        {
            "id": _text(row[0]),
            "kind": _text(row[1]),
            "beer_id": _text(row[2]),
            "format_article_id": _text(row[3]),
            "article_id": _text(row[4]),
            "active": bool(row[5]),
            "payload": _payload(row[6]),
            "cost_origin": _text(row[7]),
            "cost_parent_sku_id": _text(row[8]),
            "cost_parent_quantity": _plain_decimal(row[9]),
            "content_liter": _plain_decimal(row[10]),
        }
        for row in conn.execute(
            """
            SELECT s.id, s.kind, s.beer_id, s.format_article_id, s.article_id,
                   s.active, s.payload, s.cost_origin, s.cost_parent_sku_id,
                   s.cost_parent_quantity, COALESCE(a.content_liter, 0)
            FROM skus s
            LEFT JOIN articles a
              ON a.id = COALESCE(NULLIF(s.format_article_id, ''), NULLIF(s.article_id, ''))
            ORDER BY s.id
            """
        ).fetchall()
    ]
    subjects = [
        {
            "sku_id": _text(row[0]),
            "subject_type": _text(row[1]),
            "subject_id": _text(row[2]),
            "beer_id": _text(row[3]),
            "format_article_id": _text(row[4]),
        }
        for row in conn.execute(
            """
            SELECT sku_id, subject_type, subject_id, beer_id, format_article_id
            FROM canonical_sku_subjects
            ORDER BY sku_id
            """
        ).fetchall()
    ]
    source_anchors = [
        {
            "anchor_id": _text(row[0]),
            "sku_id": _text(row[1]),
            "cost_version_id": _text(row[2]),
            "cost_row_id": _text(row[3]),
            "primary": _plain_decimal(row[4]),
            "packaging": _plain_decimal(row[5]),
            "overhead": _plain_decimal(row[6]),
            "excise": _plain_decimal(row[7]),
            "cost_price": _plain_decimal(row[8]),
        }
        for row in conn.execute(
            """
            SELECT a.id, a.sku_id, a.cost_version_id, a.cost_row_id,
                   r.inkoop, r.verpakkingskosten, r.indirecte_kosten,
                   r.accijns, r.kostprijs
            FROM planning_cost_anchors a
            JOIN cost_version_sku_rows r ON r.id = a.cost_row_id
            WHERE a.planning_year = %s
            ORDER BY a.sku_id
            """,
            (int(source_year),),
        ).fetchall()
    ]
    target_activation_sku_ids = [
        _text(row[0])
        for row in conn.execute(
            """
            SELECT DISTINCT sku_id
            FROM kostprijs_sku_activations
            WHERE jaar = %s AND effectief_tot IS NULL
            ORDER BY sku_id
            """,
            (int(target_year),),
        ).fetchall()
    ]

    def pricing(year: int) -> list[dict[str, Any]]:
        return [
            {
                "id": _text(row[0]),
                "sku_id": _text(_payload(row[1]).get("sku_id")),
                "record_type": _text(row[2]),
                "payload": _payload(row[1]),
            }
            for row in conn.execute(
                """
                SELECT id, payload, record_type
                FROM sales_pricing_records
                WHERE jaar = %s
                ORDER BY record_type, id
                """,
                (int(year),),
            ).fetchall()
            if _text(_payload(row[1]).get("sku_id"))
        ]

    app_rows = {
        _text(row[0]): row[1]
        for row in conn.execute(
            """
            SELECT dataset_name, payload
            FROM app_datasets
            WHERE dataset_name IN ('kostprijs-target-engine-rows', 'channels')
            ORDER BY dataset_name
            """
        ).fetchall()
    }
    bom_lines = [
        {
            "id": _text(row[0]),
            "parent_article_id": _text(row[1]),
            "component_article_id": _text(row[2]),
            "component_sku_id": _text(row[3]),
            "quantity": _plain_decimal(row[4]),
            "uom": _text(row[5]),
            "scrap_pct": _plain_decimal(row[6]),
        }
        for row in conn.execute(
            """
            SELECT id, parent_article_id, component_article_id, component_sku_id,
                   quantity, uom, scrap_pct
            FROM bom_lines
            ORDER BY parent_article_id, id
            """
        ).fetchall()
    ]
    mappings = [
        {"external_id": _text(row[0]), "sku_id": _text(row[1])}
        for row in conn.execute(
            """
            SELECT douano_product_id, sku_id
            FROM douano_product_mapping
            ORDER BY sku_id, douano_product_id
            """
        ).fetchall()
    ]
    advice_rows = [
        {
            "id": _text(row[0]),
            "channel_code": _text(row[1]).lower(),
            "opslag_pct": _plain_decimal(row[2]),
        }
        for row in conn.execute(
            """
            SELECT id::text, channel_code, opslag_pct
            FROM advice_channel_pricing
            WHERE jaar = %s
            ORDER BY channel_code, id
            """,
            (int(target_year),),
        ).fetchall()
    ]
    plan_rows = [
        {
            "id": _text(row[0]),
            "source": _text(row[1]),
            "payload": _payload(row[2]),
        }
        for row in conn.execute(
            """
            SELECT id, source, payload
            FROM break_even_plan_snapshots
            WHERE jaar = %s AND status = 'active'
            ORDER BY created_at, id
            """,
            (int(target_year),),
        ).fetchall()
    ]
    year_close_ids = [
        _text(row[0])
        for row in conn.execute(
        """
        SELECT id
        FROM year_close_snapshots
        WHERE jaar = %s AND status = 'closed'
        ORDER BY created_at, id
        """,
        (int(source_year),),
        ).fetchall()
    ]
    return {
        "source_year": int(source_year),
        "target_year": int(target_year),
        "skus": skus,
        "subjects": subjects,
        "source_anchors": source_anchors,
        "target_activation_sku_ids": target_activation_sku_ids,
        "source_prices": pricing(source_year),
        "target_prices": pricing(target_year),
        "engine_batches": _array(app_rows.get("kostprijs-target-engine-rows")),
        "channels": _array(app_rows.get("channels")),
        "advice_rows": advice_rows,
        "plan_rows": plan_rows,
        "bom_lines": bom_lines,
        "mappings": mappings,
        "source_year_close_ids": year_close_ids,
    }


def build_current_plan(
    *, source_year: int, target_year: int, connection: Any | None = None
) -> dict[str, Any]:
    ensure_dependencies()
    if connection is not None:
        return build_reconciliation_plan(
            read_reconciliation_snapshot(
                connection,
                source_year=int(source_year),
                target_year=int(target_year),
            )
        )
    with postgres_storage.transaction() as conn:
        _lock_snapshot(conn)
        return build_reconciliation_plan(
            read_reconciliation_snapshot(
                conn, source_year=int(source_year), target_year=int(target_year)
            )
        )


def _public_plan(plan: dict[str, Any], *, dry_run: bool) -> dict[str, Any]:
    return {
        "version": PLANNER_VERSION,
        "dry_run": bool(dry_run),
        "ready": bool(plan.get("ready")),
        "manifest_hash": _text(plan.get("manifest_hash")),
        "validation_hash": _text(plan.get("validation_hash")),
        "source_snapshot_hash": _text(plan.get("source_snapshot_hash")),
        "target_input_hash": _text(plan.get("target_input_hash")),
        "summary": plan.get("summary", {}),
        "blocker_counts": plan.get("blocker_counts", {}),
        "consumer_mode": "compatibility_only",
        "data_rewritten": False,
    }


def reconcile(
    *,
    source_year: int,
    target_year: int,
    actor: str,
    dry_run: bool = True,
    expected_manifest_hash: str = "",
) -> dict[str, Any]:
    source = int(source_year or 0)
    target = int(target_year or 0)
    if source <= 0 or target <= source:
        raise ValueError("Gebruik expliciet 0 < source_year < target_year.")
    ensure_dependencies()
    with postgres_storage.transaction() as conn:
        _lock_snapshot(conn)
        plan = build_reconciliation_plan(
            read_reconciliation_snapshot(
                conn, source_year=source, target_year=target
            )
        )
        public = _public_plan(plan, dry_run=dry_run)
        if dry_run:
            return public
        if _text(expected_manifest_hash) != _text(plan.get("manifest_hash")):
            raise yearset_reconciliation_storage.YearsetReconciliationConflict(
                "De aangeboden manifesthash wijkt af van de actuele dry-run."
            )
        active = commercial_yearset_storage.get_active_generation(for_update=True)
        source_generation_id = (
            _text(active.get("id"))
            if active and int(active.get("operational_year", 0) or 0) == source
            else ""
        )
        source_records = plan["validation"].get("source_records", {})
        generation = commercial_yearset_storage.create_candidate(
            operational_year=target,
            source_year=source,
            source_generation_id=source_generation_id,
            validation=plan["validation"],
            validation_hash=_text(plan.get("validation_hash")),
            actor=_text(actor),
            idempotency_key=f"{PLANNER_VERSION}:{source}:{target}:{plan['manifest_hash']}",
            break_even_plan_id=_text(source_records.get("break_even_plan_id")),
            forecast_snapshot_id="",
            year_close_snapshot_id=_text(source_records.get("year_close_snapshot_id")),
            compatibility={
                "authority_version": PLANNER_VERSION,
                "consumer_mode": "compatibility_only",
                "data_rewritten": False,
                "candidate_rows_table_backed": True,
            },
        )
        run = yearset_reconciliation_storage.create_candidate(
            plan=plan,
            generation=generation,
            actor=_text(actor),
        )
        return {**public, "run": run, "generation": generation}


def approve(
    run_id: str,
    *,
    expected_manifest_hash: str,
    actor: str,
    actor_role: str,
    reason: str,
) -> dict[str, Any]:
    ensure_dependencies()
    with postgres_storage.transaction() as conn:
        _lock_snapshot(conn)
        run = yearset_reconciliation_storage.get_run(run_id)
        if not run:
            raise yearset_reconciliation_storage.YearsetReconciliationBlocked(
                "Reconciliatiekandidaat bestaat niet."
            )
        current = build_reconciliation_plan(
            read_reconciliation_snapshot(
                conn,
                source_year=int(run["source_year"]),
                target_year=int(run["target_year"]),
            )
        )
        if _text(current.get("manifest_hash")) != _text(run.get("manifest_hash")):
            raise yearset_reconciliation_storage.YearsetReconciliationConflict(
                "Bron- of targetgegevens zijn na kandidaatcreatie gewijzigd."
            )
        return yearset_reconciliation_storage.approve(
            run_id,
            expected_manifest_hash=expected_manifest_hash,
            actor=actor,
            actor_role=actor_role,
            reason=reason,
        )


def activate(
    run_id: str,
    *,
    expected_manifest_hash: str,
    expected_active_generation_id: str | None,
    actor: str,
    actor_role: str,
    reason: str,
    action: str = "activate",
) -> dict[str, Any]:
    if _text(actor_role) != "admin":
        raise PermissionError("Alleen de Administrator mag een jaarset activeren.")
    ensure_dependencies()
    with postgres_storage.transaction() as conn:
        _lock_snapshot(conn)
        run = yearset_reconciliation_storage.get_run(run_id)
        if not run:
            raise yearset_reconciliation_storage.YearsetReconciliationBlocked(
                "Reconciliatiekandidaat bestaat niet."
            )
        if run.get("status") not in {"approved", "superseded"}:
            raise yearset_reconciliation_storage.YearsetReconciliationBlocked(
                "Alleen een goedgekeurde kandidaat kan worden geactiveerd."
            )
        if _text(run.get("manifest_hash")) != _text(expected_manifest_hash):
            raise yearset_reconciliation_storage.YearsetReconciliationConflict(
                "De aangeboden manifesthash is verouderd."
            )
        current = build_reconciliation_plan(
            read_reconciliation_snapshot(
                conn,
                source_year=int(run["source_year"]),
                target_year=int(run["target_year"]),
            )
        )
        if _text(current.get("manifest_hash")) != _text(run.get("manifest_hash")):
            raise yearset_reconciliation_storage.YearsetReconciliationConflict(
                "Bron- of targetgegevens zijn na goedkeuring gewijzigd."
            )
        if not bool(current.get("ready")):
            raise yearset_reconciliation_storage.YearsetReconciliationBlocked(
                "De kandidaat bevat nog blokkerende verschillen."
            )
        previous = commercial_yearset_storage.get_active_generation(for_update=True)
        generation = commercial_yearset_storage.activate_generation(
            generation_id=_text(run.get("generation_id")),
            actor=_text(actor),
            expected_validation_hash=_text(run.get("validation_hash")),
            expected_active_generation_id=expected_active_generation_id,
            reason=_text(reason),
            action=action,
        )
        updated_run = yearset_reconciliation_storage.mark_activated(
            run_id,
            actor=actor,
            previous_generation_id=_text((previous or {}).get("id")),
            action=action,
        )
        return {"generation": generation, "run": updated_run}


def aggregate_overview(*, target_year: int = 0) -> dict[str, Any]:
    return {
        **yearset_reconciliation_storage.aggregate_overview(
            target_year=int(target_year)
        ),
        "runs": yearset_reconciliation_storage.list_runs(target_year=int(target_year)),
    }
