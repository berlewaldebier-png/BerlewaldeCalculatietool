from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

from app.domain import postgres_storage, yearset_reconciliation_service


LINEAGE_REVIEW_VERSION = "rf-013c2-v1"
_MONEY_TOLERANCE = Decimal("0.01")


def _text(value: Any) -> str:
    return str(value or "").strip()


def _decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value if value not in (None, "") else 0))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


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


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return _text(value).casefold() in {"1", "true", "yes", "ja", "active", "actief"}


def _stable(value: Any) -> str:
    def normalize(item: Any) -> Any:
        if isinstance(item, Decimal):
            return format(item.quantize(Decimal("0.000001")), "f")
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
        f"{LINEAGE_REVIEW_VERSION}:{domain}:".encode("utf-8")
        + _stable(value).encode("utf-8")
    )
    return f"sha256:{hashlib.sha256(raw).hexdigest()}"


def _cost_is_balanced_and_positive(row: dict[str, Any]) -> tuple[bool, bool]:
    primary = _decimal(row.get("primary"))
    packaging = _decimal(row.get("packaging"))
    overhead = _decimal(row.get("overhead"))
    excise = _decimal(row.get("excise"))
    cost = _decimal(row.get("cost"))
    balanced = abs(primary + packaging + overhead + excise - cost) <= _MONEY_TOLERANCE
    positive = cost > 0 and all(
        value >= 0 for value in (primary, packaging, overhead, excise)
    )
    return balanced, positive


def read_lineage_evidence(
    connection: Any,
    *,
    source_year: int,
    target_year: int,
    sku_ids: Iterable[str],
) -> dict[str, Any]:
    ids = sorted({_text(value) for value in sku_ids if _text(value)})
    if not ids:
        return {"skus": {}, "plans": [], "drafts": []}

    skus: dict[str, dict[str, Any]] = {}
    for row in connection.execute(
        """
        SELECT s.id, s.name, s.kind, s.beer_id, s.format_article_id,
               s.article_id, s.payload, cs.subject_type, cs.subject_id
        FROM skus s
        LEFT JOIN canonical_sku_subjects cs ON cs.sku_id = s.id
        WHERE s.id = ANY(%s)
        ORDER BY s.id
        """,
        (ids,),
    ).fetchall():
        payload = _payload(row[6])
        sku_id = _text(row[0])
        skus[sku_id] = {
            "sku_id": sku_id,
            "display_name": _text(row[1]) or sku_id,
            "sku_kind": _text(row[2]),
            "beer_id": _text(row[3]),
            "format_article_id": _text(row[4]),
            "article_id": _text(row[5]),
            "historical": _truthy(payload.get("historical")),
            "cost_status": _text(payload.get("cost_status")),
            "cost_origin": _text(payload.get("cost_origin")),
            "cost_parent_sku_id": _text(payload.get("cost_parent_sku_id")),
            "subject_type": _text(row[7]),
            "subject_id": _text(row[8]),
            "activations": [],
            "anchors": [],
            "cost_rows": [],
            "prices": [],
            "bom_line_ids": [],
            "same_subject_format_sku_ids": [],
        }

    for row in connection.execute(
        """
        SELECT id, sku_id, jaar, kostprijsversie_id, effectief_vanaf,
               effectief_tot
        FROM kostprijs_sku_activations
        WHERE sku_id = ANY(%s)
        ORDER BY sku_id, jaar, effectief_vanaf, id
        """,
        (ids,),
    ).fetchall():
        sku = skus.get(_text(row[1]))
        if sku is not None:
            sku["activations"].append(
                {
                    "activation_id": _text(row[0]),
                    "year": int(row[2] or 0),
                    "cost_version_id": _text(row[3]),
                    "effective_from": _text(row[4]),
                    "open": row[5] is None,
                }
            )

    for row in connection.execute(
        """
        SELECT id, sku_id, planning_year, activation_id, cost_version_id,
               cost_row_id, anchor_kind
        FROM planning_cost_anchors
        WHERE sku_id = ANY(%s)
        ORDER BY sku_id, planning_year, id
        """,
        (ids,),
    ).fetchall():
        sku = skus.get(_text(row[1]))
        if sku is not None:
            sku["anchors"].append(
                {
                    "anchor_id": _text(row[0]),
                    "year": int(row[2] or 0),
                    "activation_id": _text(row[3]),
                    "cost_version_id": _text(row[4]),
                    "cost_row_id": _text(row[5]),
                    "anchor_kind": _text(row[6]),
                }
            )

    for row in connection.execute(
        """
        SELECT id, version_id, sku_id, inkoop, verpakkingskosten,
               indirecte_kosten, accijns, kostprijs
        FROM cost_version_sku_rows
        WHERE sku_id = ANY(%s)
        ORDER BY sku_id, version_id, id
        """,
        (ids,),
    ).fetchall():
        sku = skus.get(_text(row[2]))
        if sku is not None:
            sku["cost_rows"].append(
                {
                    "cost_row_id": _text(row[0]),
                    "cost_version_id": _text(row[1]),
                    "primary": row[3],
                    "packaging": row[4],
                    "overhead": row[5],
                    "excise": row[6],
                    "cost": row[7],
                }
            )

    for row in connection.execute(
        """
        SELECT id, jaar, payload
        FROM sales_pricing_records
        WHERE payload->>'sku_id' = ANY(%s)
        ORDER BY payload->>'sku_id', jaar, id
        """,
        (ids,),
    ).fetchall():
        payload = _payload(row[2])
        sku = skus.get(_text(payload.get("sku_id")))
        if sku is not None:
            sell_in = _payload(payload.get("sell_in_prices"))
            channels = _payload(payload.get("kanaalprijzen"))
            raw = (
                sell_in.get("list")
                if sell_in.get("list") not in (None, "")
                else channels.get("list")
            )
            sku["prices"].append(
                {
                    "pricing_id": _text(row[0]),
                    "year": int(row[1] or 0),
                    "positive": _decimal(raw) > 0,
                }
            )

    format_ids = sorted(
        {
            _text(sku.get("format_article_id") or sku.get("article_id"))
            for sku in skus.values()
            if _text(sku.get("format_article_id") or sku.get("article_id"))
        }
    )
    if format_ids:
        for row in connection.execute(
            """
            SELECT id, parent_article_id
            FROM bom_lines
            WHERE parent_article_id = ANY(%s)
            ORDER BY parent_article_id, id
            """,
            (format_ids,),
        ).fetchall():
            for sku in skus.values():
                format_id = _text(
                    sku.get("format_article_id") or sku.get("article_id")
                )
                if format_id == _text(row[1]):
                    sku["bom_line_ids"].append(_text(row[0]))

    for sku in skus.values():
        beer_id = _text(sku.get("beer_id"))
        format_id = _text(sku.get("format_article_id"))
        if not beer_id or not format_id:
            continue
        sku["same_subject_format_sku_ids"] = [
            _text(row[0])
            for row in connection.execute(
                """
                SELECT id
                FROM skus
                WHERE beer_id = %s AND format_article_id = %s
                ORDER BY id
                """,
                (beer_id, format_id),
            ).fetchall()
        ]

    plans = [
        {
            "plan_id": _text(row[0]),
            "year": int(row[1] or 0),
            "source": _text(row[2]),
            "status": _text(row[3]),
            "payload": _payload(row[4]),
        }
        for row in connection.execute(
            """
            SELECT id, jaar, source, status, payload
            FROM break_even_plan_snapshots
            WHERE jaar IN (%s, %s)
            ORDER BY jaar, id
            """,
            (int(source_year), int(target_year)),
        ).fetchall()
    ]
    drafts = [
        _payload(row[0])
        for row in connection.execute(
            "SELECT payload FROM new_year_drafts ORDER BY id"
        ).fetchall()
    ]
    return {"skus": skus, "plans": plans, "drafts": drafts}


def _exact_target_anchor_chains(
    sku: dict[str, Any], *, target_year: int
) -> list[dict[str, Any]]:
    activations = {
        row["activation_id"]: row
        for row in sku.get("activations", [])
        if int(row.get("year", 0) or 0) == target_year and bool(row.get("open"))
    }
    rows = {
        row["cost_row_id"]: row for row in sku.get("cost_rows", [])
    }
    chains: list[dict[str, Any]] = []
    for anchor in sku.get("anchors", []):
        if int(anchor.get("year", 0) or 0) != target_year:
            continue
        activation = activations.get(_text(anchor.get("activation_id")))
        cost_row = rows.get(_text(anchor.get("cost_row_id")))
        if not activation or not cost_row:
            continue
        if _text(activation.get("cost_version_id")) != _text(
            anchor.get("cost_version_id")
        ):
            continue
        if _text(cost_row.get("cost_version_id")) != _text(
            anchor.get("cost_version_id")
        ):
            continue
        balanced, positive = _cost_is_balanced_and_positive(cost_row)
        chains.append(
            {
                "anchor_id": _text(anchor.get("anchor_id")),
                "activation_id": _text(activation.get("activation_id")),
                "cost_version_id": _text(anchor.get("cost_version_id")),
                "cost_row_id": _text(cost_row.get("cost_row_id")),
                "anchor_kind": _text(anchor.get("anchor_kind")),
                "balanced": balanced,
                "positive": positive,
            }
        )
    return chains


def _cost_lineage_item(
    *,
    sku_id: str,
    plan_entry: dict[str, Any],
    sku: dict[str, Any],
    target_year: int,
) -> dict[str, Any]:
    chains = _exact_target_anchor_chains(sku, target_year=target_year)
    scope = _text(plan_entry.get("scope_classification"))
    valid_chains = [
        row for row in chains if bool(row["balanced"]) and bool(row["positive"])
    ]
    if scope == "target_operational_addition" and len(valid_chains) == 1:
        classification = "reproducible_from_exact_target_anchor"
        automatic = True
        next_action = (
            "Gebruik in een apart goedgekeurd schrijfslice exact deze bestaande "
            "targetjaar-anchor en kostregel; herbereken of schat geen bedrag."
        )
    elif (
        scope == "sellable_without_anchor"
        and not sku.get("activations")
        and not sku.get("anchors")
        and not sku.get("cost_rows")
    ):
        classification = "human_scope_and_cost_decision_required"
        automatic = False
        next_action = (
            "Bevestig eerst of deze historische prijsprojectie werkelijk een "
            "actieve verkoop-SKU is. Zo ja: registreer een kostprijs via de "
            "goedgekeurde workflow; zo nee: keur apart een scopecorrectie goed."
        )
    else:
        classification = "authority_conflict_investigation_required"
        automatic = False
        next_action = (
            "Onderzoek de onvolledige of meervoudige authority-keten; gebruik "
            "geen kandidaat totdat één stabiele keten bewezen is."
        )
    return {
        "sku_id": sku_id,
        "display_name": _text(sku.get("display_name")) or sku_id,
        "subject_type": _text(sku.get("subject_type")),
        "subject_id": _text(sku.get("subject_id")),
        "scope_classification": scope,
        "classification": classification,
        "automatic_reproduction_eligible": automatic,
        "requires_human_decision": not automatic,
        "next_action": next_action,
        "evidence": {
            "historical_projection": bool(sku.get("historical")),
            "cost_status": _text(sku.get("cost_status")),
            "cost_origin_present": bool(_text(sku.get("cost_origin"))),
            "cost_parent_present": bool(_text(sku.get("cost_parent_sku_id"))),
            "activation_count": len(sku.get("activations", [])),
            "target_open_activation_count": sum(
                int(row.get("year", 0) or 0) == target_year
                and bool(row.get("open"))
                for row in sku.get("activations", [])
            ),
            "anchor_count": len(sku.get("anchors", [])),
            "target_anchor_count": sum(
                int(row.get("year", 0) or 0) == target_year
                for row in sku.get("anchors", [])
            ),
            "cost_row_count": len(sku.get("cost_rows", [])),
            "exact_target_anchor_chain_count": len(chains),
            "valid_target_anchor_chain_count": len(valid_chains),
            "exact_target_anchor_chain": valid_chains[0] if len(valid_chains) == 1 else {},
            "pricing_years": sorted(
                {
                    int(row.get("year", 0) or 0)
                    for row in sku.get("prices", [])
                    if int(row.get("year", 0) or 0) > 0
                }
            ),
            "bom_line_count": len(sku.get("bom_line_ids", [])),
            "same_subject_format_sku_count": len(
                sku.get("same_subject_format_sku_ids", [])
            ),
        },
    }


def _plan_lineage(
    *,
    target_year: int,
    blocker_codes: list[str],
    evidence: dict[str, Any],
) -> dict[str, Any]:
    target_plans = [
        row
        for row in evidence.get("plans", [])
        if int(row.get("year", 0) or 0) == target_year
        and _text(row.get("status")) == "active"
    ]
    target_plan = target_plans[0] if len(target_plans) == 1 else {}
    payload = _payload(target_plan.get("payload"))
    targets = _payload(payload.get("targets"))
    positive = {
        key: _decimal(targets.get(key)) > 0
        for key in ("revenue", "contribution", "liters", "units")
    }
    periods = _array(
        payload.get("period_allocations", payload.get("periodAllocations"))
    )
    retained_drafts = [
        row
        for row in evidence.get("drafts", [])
        if int(row.get("target_year", 0) or 0) == target_year
    ]
    source_plans = [
        {
            "plan_id": _text(row.get("plan_id")),
            "year": int(row.get("year", 0) or 0),
            "source": _text(row.get("source")),
            "status": _text(row.get("status")),
        }
        for row in evidence.get("plans", [])
        if int(row.get("year", 0) or 0) < target_year
    ]
    return {
        "classification": "human_plan_input_required",
        "automatic_reproduction_eligible": False,
        "requires_human_decision": True,
        "blocker_codes": sorted({_text(code) for code in blocker_codes if _text(code)}),
        "next_action": (
            "Management vult een nieuw expliciet doeljaarplan en periodeverdeling "
            "in. Gebruik actuals, Forecast of first-use backfill niet automatisch "
            "als vervanging van het bevroren Plan."
        ),
        "evidence": {
            "active_target_plan_count": len(target_plans),
            "target_plan_id": _text(target_plan.get("plan_id")),
            "target_plan_source": _text(target_plan.get("source")),
            "retained_target_draft_count": len(retained_drafts),
            "positive_target_fields": positive,
            "period_allocation_count": len(periods),
            "source_plan_candidates": source_plans,
        },
    }


def build_lineage_review(
    *,
    plan: dict[str, Any],
    worklist: dict[str, Any],
    evidence: dict[str, Any],
) -> dict[str, Any]:
    target_year = int(plan.get("target_year", 0) or 0)
    sku_entries = {
        _text(row.get("sku_id")): row
        for row in plan.get("sku_entries", [])
        if isinstance(row, dict) and _text(row.get("sku_id"))
    }
    cost_sku_ids = sorted(
        {
            _text((row.get("subject") or {}).get("sku_id"))
            for row in worklist.get("work_items", [])
            if isinstance(row, dict)
            and _text(row.get("blocker_code")) == "target_cost_input_missing"
            and _text((row.get("subject") or {}).get("sku_id"))
        }
    )
    cost_items = [
        _cost_lineage_item(
            sku_id=sku_id,
            plan_entry=sku_entries.get(sku_id, {}),
            sku=(evidence.get("skus", {}) or {}).get(sku_id, {}),
            target_year=target_year,
        )
        for sku_id in cost_sku_ids
    ]
    cost_by_sku = {row["sku_id"]: row for row in cost_items}

    sell_in_items: list[dict[str, Any]] = []
    for row in worklist.get("work_items", []):
        if not isinstance(row, dict) or _text(row.get("area")) != "sell_in":
            continue
        code = _text(row.get("blocker_code"))
        sku_id = _text((row.get("subject") or {}).get("sku_id"))
        sku = (evidence.get("skus", {}) or {}).get(sku_id, {})
        if code == "target_sell_in_cost_unresolved":
            dependency = cost_by_sku.get(sku_id, {})
            sell_in_items.append(
                {
                    "sku_id": sku_id,
                    "display_name": _text(sku.get("display_name")) or sku_id,
                    "blocker_code": code,
                    "classification": "dependent_on_cost_lineage_decision",
                    "automatic_reproduction_eligible": False,
                    "requires_human_decision": bool(
                        dependency.get("requires_human_decision", True)
                    ),
                    "depends_on_cost_classification": _text(
                        dependency.get("classification")
                    ),
                    "next_action": (
                        "Los eerst de gekoppelde kostprijs- en scopedecisie op; "
                        "deze sell-inregel wordt daarna opnieuw gevalideerd."
                    ),
                }
            )
        elif code == "target_sell_in_non_positive":
            prices = [
                price
                for price in sku.get("prices", [])
                if int(price.get("year", 0) or 0) in {
                    int(plan.get("source_year", 0) or 0),
                    target_year,
                }
            ]
            sell_in_items.append(
                {
                    "sku_id": sku_id,
                    "display_name": _text(sku.get("display_name")) or sku_id,
                    "blocker_code": code,
                    "classification": "human_pricing_policy_required",
                    "automatic_reproduction_eligible": False,
                    "requires_human_decision": True,
                    "next_action": (
                        "Bevestig of dit artikel verkoopbaar is met een positieve "
                        "sell-inprijs of bewust gratis/niet-verkoopbaar is; kopieer "
                        "geen nulprijs automatisch."
                    ),
                    "evidence": {
                        "pricing_records": [
                            {
                                "pricing_id": _text(price.get("pricing_id")),
                                "year": int(price.get("year", 0) or 0),
                                "positive": bool(price.get("positive")),
                            }
                            for price in prices
                        ]
                    },
                }
            )

    plan_blockers = [
        _text(row.get("blocker_code"))
        for row in worklist.get("work_items", [])
        if isinstance(row, dict) and _text(row.get("area")) == "plan"
    ]
    plan_item = _plan_lineage(
        target_year=target_year,
        blocker_codes=plan_blockers,
        evidence=evidence,
    )
    summary = {
        "cost_blockers": len(cost_items),
        "cost_automatically_reproducible": sum(
            bool(row.get("automatic_reproduction_eligible")) for row in cost_items
        ),
        "cost_human_decision_required": sum(
            bool(row.get("requires_human_decision")) for row in cost_items
        ),
        "sell_in_dependencies": sum(
            row.get("classification") == "dependent_on_cost_lineage_decision"
            for row in sell_in_items
        ),
        "pricing_policy_decisions": sum(
            row.get("classification") == "human_pricing_policy_required"
            for row in sell_in_items
        ),
        "plan_input_blockers": len(plan_blockers),
    }
    identity_payload = {
        "version": LINEAGE_REVIEW_VERSION,
        "manifest_hash": _text(plan.get("manifest_hash")),
        "cost_items": [
            {
                key: value
                for key, value in row.items()
                if key not in {"display_name", "next_action"}
            }
            for row in cost_items
        ],
        "sell_in_items": [
            {
                key: value
                for key, value in row.items()
                if key not in {"display_name", "next_action"}
            }
            for row in sell_in_items
        ],
        "plan": {
            key: value
            for key, value in plan_item.items()
            if key != "next_action"
        },
        "summary": summary,
    }
    return {
        "version": LINEAGE_REVIEW_VERSION,
        "source_year": int(plan.get("source_year", 0) or 0),
        "target_year": target_year,
        "manifest_hash": _text(plan.get("manifest_hash")),
        "validation_hash": _text(plan.get("validation_hash")),
        "lineage_review_hash": _hash(identity_payload, "lineage-review"),
        "summary": summary,
        "cost_items": cost_items,
        "sell_in_items": sell_in_items,
        "plan": plan_item,
        "ready_for_reconciliation_rebuild": not (
            summary["cost_human_decision_required"]
            or summary["pricing_policy_decisions"]
            or summary["plan_input_blockers"]
        ),
        "write_authorized": False,
        "consumer_mode": "compatibility_only",
        "data_rewritten": False,
    }


def review_current_lineage(*, source_year: int, target_year: int) -> dict[str, Any]:
    source = int(source_year or 0)
    target = int(target_year or 0)
    if source <= 0 or target <= source:
        raise ValueError("Gebruik expliciet 0 < source_year < target_year.")
    with postgres_storage.connect() as connection:
        try:
            connection.rollback()
        except Exception:
            pass
        with connection.transaction():
            connection.execute(
                "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
            )
            plan = yearset_reconciliation_service.build_reconciliation_plan(
                yearset_reconciliation_service.read_reconciliation_snapshot(
                    connection,
                    source_year=source,
                    target_year=target,
                )
            )
            worklist_without_labels = (
                yearset_reconciliation_service.build_blocker_worklist(plan)
            )
            sku_ids = {
                _text((row.get("subject") or {}).get("sku_id"))
                for row in worklist_without_labels.get("work_items", [])
                if isinstance(row, dict)
                and _text((row.get("subject") or {}).get("sku_id"))
            }
            evidence = read_lineage_evidence(
                connection,
                source_year=source,
                target_year=target,
                sku_ids=sku_ids,
            )
            labels = {
                sku_id: _text(row.get("display_name"))
                for sku_id, row in evidence.get("skus", {}).items()
            }
            worklist = yearset_reconciliation_service.build_blocker_worklist(
                plan,
                sku_labels=labels,
            )
            return build_lineage_review(
                plan=plan,
                worklist=worklist,
                evidence=evidence,
            )
