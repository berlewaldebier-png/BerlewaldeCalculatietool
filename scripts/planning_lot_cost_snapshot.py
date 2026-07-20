from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from decimal import Decimal
import hashlib
import json
from typing import Any, Iterable


def text(value: Any) -> str:
    return str(value or "").strip()


def stable_json(value: Any) -> str:
    def normalize(item: Any) -> Any:
        if isinstance(item, Decimal):
            return float(item)
        if isinstance(item, dict):
            return {str(key): normalize(item[key]) for key in sorted(item)}
        if isinstance(item, (list, tuple)):
            return [normalize(child) for child in item]
        if hasattr(item, "isoformat"):
            return item.isoformat()
        return item

    return json.dumps(normalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def fingerprint(value: Any, domain: str) -> str:
    digest = hashlib.sha256(
        f"rf010b:{domain}:".encode("utf-8") + stable_json(value).encode("utf-8")
    ).hexdigest()
    return f"sha256:{digest}"


def _moment(row: dict[str, Any]) -> tuple[str, str]:
    raw = text(row.get("effectief_vanaf") or row.get("created_at"))
    try:
        normalized = datetime.fromisoformat(raw.replace("Z", "+00:00")).isoformat()
    except ValueError:
        normalized = raw
    return normalized, text(row.get("id"))


def _key(row: dict[str, Any]) -> tuple[str, int] | None:
    sku_id = text(row.get("sku_id"))
    try:
        year = int(row.get("jaar", 0) or 0)
    except (TypeError, ValueError):
        year = 0
    return (sku_id, year) if sku_id and year > 0 else None


def select_approved_planning_anchors(
    activations: Iterable[dict[str, Any]],
    events: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Model the approved RF-010B rule without changing a production resolver.

    The earliest observable activation is the anchor. A later event only replaces it
    when it is explicitly classified and approved as a rebaseline.
    """
    activation_groups: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    event_groups: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for row in activations:
        key = _key(row)
        if key:
            activation_groups[key].append(row)
    for row in events:
        key = _key(row)
        if key:
            event_groups[key].append(row)

    result: list[dict[str, Any]] = []
    for sku_id, year in sorted(set(activation_groups) | set(event_groups)):
        candidates: list[dict[str, Any]] = []
        candidates.extend(activation_groups.get((sku_id, year), []))
        candidates.extend(event_groups.get((sku_id, year), []))
        candidates = [row for row in candidates if text(row.get("kostprijsversie_id"))]
        if not candidates:
            continue
        first = min(candidates, key=_moment)
        approved_rebaselines = [
            row
            for row in event_groups.get((sku_id, year), [])
            if text(row.get("action")).casefold() == "explicit_rebaseline"
            and bool((row.get("metadata") or {}).get("approved"))
            and text(row.get("kostprijsversie_id"))
        ]
        selected = max(approved_rebaselines, key=_moment) if approved_rebaselines else first
        source = "explicit_approved_rebaseline" if approved_rebaselines else "first_observable_activation"
        result.append(
            {
                "skuId": sku_id,
                "year": year,
                "costVersionId": text(selected.get("kostprijsversie_id")),
                "effectiveAt": _moment(selected)[0],
                "source": source,
                "historyProven": bool(event_groups.get((sku_id, year)))
                or len(activation_groups.get((sku_id, year), [])) > 1,
            }
        )
    return result


def select_observed_latest_activations(
    activations: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for row in activations:
        key = _key(row)
        if key and text(row.get("kostprijsversie_id")):
            grouped[key].append(row)
    result: list[dict[str, Any]] = []
    for (sku_id, year), rows in sorted(grouped.items()):
        selected = max(rows, key=_moment)
        result.append(
            {
                "skuId": sku_id,
                "year": year,
                "costVersionId": text(selected.get("kostprijsversie_id")),
                "effectiveAt": _moment(selected)[0],
            }
        )
    return result


def exact_lot_ambiguities(
    versions: Iterable[dict[str, Any]],
    cost_rows: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    sku_ids_by_version: dict[str, set[str]] = defaultdict(set)
    for row in cost_rows:
        version_id = text(row.get("version_id"))
        sku_id = text(row.get("sku_id"))
        if version_id and sku_id:
            sku_ids_by_version[version_id].add(sku_id)
    grouped: dict[tuple[int, str, str], list[str]] = defaultdict(list)
    for version in versions:
        version_id = text(version.get("id"))
        lot_key = text(version.get("lot_exact_key"))
        try:
            year = int(version.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            year = 0
        if not version_id or not lot_key or year <= 0:
            continue
        for sku_id in sku_ids_by_version.get(version_id, set()):
            grouped[(year, sku_id, lot_key)].append(version_id)
    return [
        {"year": key[0], "skuId": key[1], "lotKey": key[2], "versionIds": sorted(set(version_ids))}
        for key, version_ids in sorted(grouped.items())
        if len(set(version_ids)) > 1
    ]


def build_report(payload: dict[str, Any]) -> dict[str, Any]:
    activations = list(payload.get("activations") or [])
    events = list(payload.get("activationEvents") or [])
    versions = list(payload.get("versions") or [])
    cost_rows = list(payload.get("costRows") or [])
    approved = select_approved_planning_anchors(activations, events)
    observed = select_observed_latest_activations(activations)
    cost_row_by_key = {
        (text(row.get("version_id")), text(row.get("sku_id"))): row
        for row in cost_rows
        if text(row.get("version_id")) and text(row.get("sku_id"))
    }

    def add_cost_row(selection: dict[str, Any]) -> dict[str, Any]:
        row = cost_row_by_key.get((selection.get("costVersionId", ""), selection.get("skuId", "")))
        if not row:
            return {**selection, "costRowId": "", "componentBreakdown": None}
        component_fields = {
            key: row.get(key)
            for key in (
                "inkoop",
                "verpakkingskosten",
                "indirecte_kosten",
                "accijns",
                "kostprijs",
                "componentFingerprint",
            )
            if key in row
        }
        return {
            **selection,
            "costRowId": text(row.get("id")),
            "componentBreakdown": component_fields,
        }

    approved = [add_cost_row(row) for row in approved]
    observed = [add_cost_row(row) for row in observed]
    observed_by_key = {(row["skuId"], row["year"]): row for row in observed}
    deviations = []
    for row in approved:
        current = observed_by_key.get((row["skuId"], row["year"]))
        if current and current["costVersionId"] != row["costVersionId"]:
            deviations.append(
                {
                    "skuId": row["skuId"],
                    "year": row["year"],
                    "approvedVersionId": row["costVersionId"],
                    "observedVersionId": current["costVersionId"],
                    "reason": "latest_activation_replaces_first_planning_anchor",
                }
            )
    ambiguities = exact_lot_ambiguities(versions, cost_rows)
    ambiguity_keys = {
        (row["year"], row["skuId"], row["lotKey"]) for row in ambiguities
    }
    actual_selections: list[dict[str, Any]] = []
    for row in payload.get("actualSnapshots") or []:
        sku_id = text(row.get("sku_id"))
        version_id = text(row.get("kostprijsversie_id"))
        lot_key = text(row.get("lotKey") or row.get("lot_number"))
        try:
            year = int(row.get("year", 0) or 0)
        except (TypeError, ValueError):
            year = 0
        cost_row = cost_row_by_key.get((version_id, sku_id))
        status = text(row.get("cost_status")) or "unknown"
        warning = "ambiguous_exact_lot" if (year, sku_id, lot_key) in ambiguity_keys else (
            status if status in {
                "fallback_active_sku_cost",
                "lot_unmatched_fallback",
                "lot_near_match_fallback",
                "missing_cost",
                "missing_lot_cost",
                "unmapped_sku",
            } else ""
        )
        component_fields = {
            key: cost_row.get(key)
            for key in (
                "inkoop",
                "verpakkingskosten",
                "indirecte_kosten",
                "accijns",
                "kostprijs",
                "componentFingerprint",
            )
            if cost_row is not None and key in cost_row
        }
        actual_selections.append(
            {
                "actualId": text(row.get("id")),
                "year": year,
                "skuId": sku_id,
                "lotKey": lot_key,
                "costVersionId": version_id,
                "costRowId": text((cost_row or {}).get("id")),
                "componentBreakdown": component_fields or None,
                "source": text(row.get("cost_source")) or "unknown",
                "reason": status,
                "warning": warning,
            }
        )
    statuses = Counter(row["reason"] for row in actual_selections)
    sources = Counter(row["source"] for row in actual_selections)
    return {
        "approvedPlanningAnchors": approved,
        "observedLatestActivations": observed,
        "planningDeviations": deviations,
        "exactLotAmbiguities": ambiguities,
        "actualCostSelections": actual_selections,
        "actualSnapshotStatusCounts": dict(sorted(statuses.items())),
        "actualSnapshotSourceCounts": dict(sorted(sources.items())),
    }


def build_private_manifest(payload: dict[str, Any], *, baseline_commit: str, captured_at: str) -> dict[str, Any]:
    report = build_report(payload)
    status_counts = report["actualSnapshotStatusCounts"]
    history_evidence_count = sum(
        1 for row in report["approvedPlanningAnchors"] if row.get("historyProven")
    )
    lot_fallback_statuses = {
        "fallback_active_sku_cost",
        "lot_unmatched_fallback",
        "lot_near_match_fallback",
    }
    missing_statuses = {"missing_cost", "missing_lot_cost"}
    activation_key_counts = Counter(
        _key(row) for row in payload.get("activations") or [] if _key(row) is not None
    )
    event_key_counts = Counter(
        _key(row) for row in payload.get("activationEvents") or [] if _key(row) is not None
    )
    event_versions_by_key: dict[tuple[str, int], set[str]] = defaultdict(set)
    for event in payload.get("activationEvents") or []:
        event_key = _key(event)
        version_id = text(event.get("kostprijsversie_id"))
        if event_key is not None and version_id:
            event_versions_by_key[event_key].add(version_id)
    return {
        "schemaVersion": 1,
        "fixtureSet": "RF-010B-planning-lot-private-fingerprints",
        "baselineCommit": baseline_commit,
        "capturedAt": captured_at,
        "source": {
            "environment": "private-development",
            "identifiers": "pseudonymous in-memory only",
            "commercialValues": "not committed",
            "committedValues": "aggregate reason counts and SHA-256 fingerprints only",
        },
        "approval": {"status": "pending-human-approval", "approvedBy": None, "approvedAt": None},
        "audit": {
            "counts": {
                "planningAnchors": len(report["approvedPlanningAnchors"]),
                "activationRows": len(payload.get("activations") or []),
                "activationEvents": len(payload.get("activationEvents") or []),
                "skuYearsWithMultipleActivationRows": sum(
                    1 for count in activation_key_counts.values() if count > 1
                ),
                "skuYearsWithMultipleActivationEvents": sum(
                    1 for count in event_key_counts.values() if count > 1
                ),
                "skuYearsWithMultipleEventVersions": sum(
                    1 for versions in event_versions_by_key.values() if len(versions) > 1
                ),
                "anchorsWithActivationHistoryEvidence": history_evidence_count,
                "anchorsWithoutActivationHistoryEvidence": len(report["approvedPlanningAnchors"])
                - history_evidence_count,
                "planningDeviations": len(report["planningDeviations"]),
                "exactLotAmbiguities": len(report["exactLotAmbiguities"]),
                "actualSnapshots": len(payload.get("actualSnapshots") or []),
                "actualLotFallbackSnapshots": sum(
                    count for status, count in status_counts.items() if status in lot_fallback_statuses
                ),
                "actualPlanningBaselineSnapshots": status_counts.get("resolved_active_sku_cost", 0),
                "actualMissingCostSnapshots": sum(
                    count for status, count in status_counts.items() if status in missing_statuses
                ),
            },
            "actualSnapshotStatusCounts": status_counts,
            "actualSnapshotSourceCounts": report["actualSnapshotSourceCounts"],
        },
        "fingerprints": {
            "approvedPlanningAnchors": fingerprint(report["approvedPlanningAnchors"], "approved-anchors"),
            "observedLatestActivations": fingerprint(report["observedLatestActivations"], "observed-latest"),
            "planningDeviations": fingerprint(report["planningDeviations"], "planning-deviations"),
            "exactLotAmbiguities": fingerprint(report["exactLotAmbiguities"], "lot-ambiguities"),
            "actualCostSelections": fingerprint(report["actualCostSelections"], "actual-selections"),
            "report": fingerprint(report, "report"),
        },
    }
