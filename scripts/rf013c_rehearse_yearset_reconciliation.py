from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from scripts.disposable_postgres_guard import (  # noqa: E402
    DISPOSABLE_DATABASE_OPT_IN,
    assert_disposable_database_url,
    database_url_from_environment,
)
from scripts.rf013a_rehearse_authority import (  # noqa: E402
    ALLOWED_NEW_TABLES as RF013A_TABLES,
    _schema_by_table,
    compare_additive_rehearsal,
)
from scripts.rf013b_rehearse_authority import (  # noqa: E402
    ALLOWED_NEW_TABLES as RF013B_TABLES,
)
from scripts.rf013p_data_baseline import (  # noqa: E402
    PRIVATE_OUTPUT_ROOT,
    capture_from_connection_info,
    compare_manifests,
)


RF013C_TABLES = {
    "commercial_yearset_candidate_channels",
    "commercial_yearset_candidate_plan",
    "commercial_yearset_candidate_prices",
    "commercial_yearset_candidate_skus",
    "commercial_yearset_reconciliation_events",
    "commercial_yearset_reconciliation_runs",
}
RF013C3_TABLES = {"commercial_yearset_recovery_inputs"}
ALLOWED_NEW_TABLES = (
    RF013A_TABLES | RF013B_TABLES | RF013C_TABLES | RF013C3_TABLES
)

EXPECTED_RESTORED_SUMMARY = {
    "sku_count": 83,
    "required_cost_count": 81,
    "ready_cost_count": 74,
    "not_required_cost_count": 2,
    "price_count": 51,
    "ready_price_count": 46,
    "channel_count": 4,
    "ready_channel_count": 4,
    "ui_engine_rows": 103,
    "canonical_engine_skus": 74,
}
EXPECTED_RESTORED_BLOCKERS = {
    "plan_contribution_missing": 1,
    "plan_liters_missing": 1,
    "plan_period_allocation_missing": 1,
    "plan_revenue_missing": 1,
    "plan_units_missing": 1,
    "target_cost_input_missing": 7,
    "target_sell_in_cost_unresolved": 4,
    "target_sell_in_non_positive": 1,
}
EXPECTED_RF013C1_AREA_COUNTS = {
    "cost": 7,
    "plan": 5,
    "sell_in": 5,
}
EXPECTED_RF013C1_COST_SKU_IDS = {
    "sku-080354e8-b262-48a3-8a11-fa0158227265-fmt-fmt-doos-6-75cl",
    "sku-080354e8-b262-48a3-8a11-fa0158227265-fmt-fmt-fles-75cl",
    "sku-f0805dd9-37e9-4330-8432-a03471816080-fmt-fmt-doos-6-75cl",
    "sku-f0805dd9-37e9-4330-8432-a03471816080-fmt-fmt-fles-75cl",
    "sku-bundle-berlewalde-het-juweel-doos-12-33cl",
    "sku-b32e6422-40b2-43c8-ad20-ce46a97ed572-fmt-doos-24-33cl",
    "sku-b32e6422-40b2-43c8-ad20-ce46a97ed572-fmt-fles-33cl",
}
EXPECTED_RF013C1_COST_DEPENDENT_PRICE_SKU_IDS = {
    "sku-080354e8-b262-48a3-8a11-fa0158227265-fmt-fmt-doos-6-75cl",
    "sku-080354e8-b262-48a3-8a11-fa0158227265-fmt-fmt-fles-75cl",
    "sku-f0805dd9-37e9-4330-8432-a03471816080-fmt-fmt-doos-6-75cl",
    "sku-f0805dd9-37e9-4330-8432-a03471816080-fmt-fmt-fles-75cl",
}
EXPECTED_RF013C1_NON_POSITIVE_SELL_IN_SKU_ID = (
    "sku-13a6eb1f-92de-4d84-bef6-b035c81b2cf8"
)
EXPECTED_RF013C2_SUMMARY = {
    "cost_blockers": 7,
    "cost_automatically_reproducible": 3,
    "cost_human_decision_required": 4,
    "sell_in_dependencies": 4,
    "pricing_policy_decisions": 1,
    "plan_input_blockers": 5,
}
EXPECTED_RF013C2_REPRODUCIBLE_COST_SKU_IDS = {
    "sku-bundle-berlewalde-het-juweel-doos-12-33cl",
    "sku-b32e6422-40b2-43c8-ad20-ce46a97ed572-fmt-doos-24-33cl",
    "sku-b32e6422-40b2-43c8-ad20-ce46a97ed572-fmt-fles-33cl",
}
EXPECTED_RF013C2_HUMAN_COST_SKU_IDS = (
    EXPECTED_RF013C1_COST_SKU_IDS - EXPECTED_RF013C2_REPRODUCIBLE_COST_SKU_IDS
)
EXPECTED_RF013C3_RECOVERED_SUMMARY = {
    "sku_count": 79,
    "required_cost_count": 77,
    "ready_cost_count": 77,
    "not_required_cost_count": 2,
    "price_count": 47,
    "ready_price_count": 47,
    "channel_count": 4,
    "ready_channel_count": 4,
    "ui_engine_rows": 106,
    "canonical_engine_skus": 77,
}
APPROVED_2026_PLAN_REVENUE_EX_VAT = "220000"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Rehearse additive RF-013A/B/C authority creation on an explicitly "
            "disposable RF-013P restore. Existing schema and data must remain exact."
        )
    )
    parser.add_argument("--source-year", required=True, type=int)
    parser.add_argument("--target-year", required=True, type=int)
    parser.add_argument("--expected-baseline", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--acknowledge-disposable-write",
        action="store_true",
        help="Required acknowledgement for additive authority/candidate writes.",
    )
    return parser.parse_args()


def _private_output(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    try:
        resolved.relative_to(PRIVATE_OUTPUT_ROOT)
    except ValueError as exc:
        raise ValueError(
            f"RF-013C output must stay under ignored {PRIVATE_OUTPUT_ROOT}."
        ) from exc
    if resolved.suffix.lower() != ".json":
        raise ValueError("RF-013C rehearsal output must use .json.")
    return resolved


def validate_restored_result(result: dict[str, Any]) -> list[str]:
    differences: list[str] = []
    if bool(result.get("ready")):
        differences.append("unexpected_ready_candidate")
    if dict(result.get("summary") or {}) != EXPECTED_RESTORED_SUMMARY:
        differences.append("restored_summary")
    if dict(result.get("blocker_counts") or {}) != EXPECTED_RESTORED_BLOCKERS:
        differences.append("restored_blockers")
    if str(result.get("consumer_mode") or "") != "compatibility_only":
        differences.append("consumer_mode")
    if bool(result.get("data_rewritten")):
        differences.append("data_rewritten")
    return differences


def validate_blocker_worklist(result: dict[str, Any]) -> list[str]:
    differences: list[str] = []
    if str(result.get("version") or "") != "rf-013c1-v1":
        differences.append("worklist_version")
    if bool(result.get("ready")):
        differences.append("worklist_unexpected_ready")
    if dict(result.get("blocker_counts") or {}) != EXPECTED_RESTORED_BLOCKERS:
        differences.append("worklist_blocker_counts")
    if dict(result.get("area_counts") or {}) != EXPECTED_RF013C1_AREA_COUNTS:
        differences.append("worklist_area_counts")
    if str(result.get("consumer_mode") or "") != "compatibility_only":
        differences.append("worklist_consumer_mode")
    if bool(result.get("data_rewritten")):
        differences.append("worklist_data_rewritten")

    rows = [
        row for row in result.get("work_items", []) if isinstance(row, dict)
    ]
    if len(rows) != sum(EXPECTED_RF013C1_AREA_COUNTS.values()):
        differences.append("worklist_item_count")
    cost_sku_ids = {
        str((row.get("subject") or {}).get("sku_id") or "")
        for row in rows
        if row.get("blocker_code") == "target_cost_input_missing"
    }
    if cost_sku_ids != EXPECTED_RF013C1_COST_SKU_IDS:
        differences.append("worklist_cost_sku_ids")
    cost_dependent_price_sku_ids = {
        str((row.get("subject") or {}).get("sku_id") or "")
        for row in rows
        if row.get("blocker_code") == "target_sell_in_cost_unresolved"
    }
    if (
        cost_dependent_price_sku_ids
        != EXPECTED_RF013C1_COST_DEPENDENT_PRICE_SKU_IDS
    ):
        differences.append("worklist_cost_dependent_price_sku_ids")
    non_positive_sku_ids = {
        str((row.get("subject") or {}).get("sku_id") or "")
        for row in rows
        if row.get("blocker_code") == "target_sell_in_non_positive"
    }
    if non_positive_sku_ids != {EXPECTED_RF013C1_NON_POSITIVE_SELL_IN_SKU_ID}:
        differences.append("worklist_non_positive_sell_in_sku_id")
    return differences


def validate_lineage_review(result: dict[str, Any]) -> list[str]:
    differences: list[str] = []
    if str(result.get("version") or "") != "rf-013c2-v1":
        differences.append("lineage_version")
    if dict(result.get("summary") or {}) != EXPECTED_RF013C2_SUMMARY:
        differences.append("lineage_summary")
    if bool(result.get("ready_for_reconciliation_rebuild")):
        differences.append("lineage_unexpected_ready")
    if bool(result.get("write_authorized")):
        differences.append("lineage_write_authorized")
    if str(result.get("consumer_mode") or "") != "compatibility_only":
        differences.append("lineage_consumer_mode")
    if bool(result.get("data_rewritten")):
        differences.append("lineage_data_rewritten")

    cost_rows = [
        row for row in result.get("cost_items", []) if isinstance(row, dict)
    ]
    reproducible = {
        str(row.get("sku_id") or "")
        for row in cost_rows
        if row.get("classification") == "reproducible_from_exact_target_anchor"
        and bool(row.get("automatic_reproduction_eligible"))
    }
    if reproducible != EXPECTED_RF013C2_REPRODUCIBLE_COST_SKU_IDS:
        differences.append("lineage_reproducible_cost_sku_ids")
    human_cost = {
        str(row.get("sku_id") or "")
        for row in cost_rows
        if row.get("classification") == "human_scope_and_cost_decision_required"
        and bool(row.get("requires_human_decision"))
    }
    if human_cost != EXPECTED_RF013C2_HUMAN_COST_SKU_IDS:
        differences.append("lineage_human_cost_sku_ids")

    pricing_policy = {
        str(row.get("sku_id") or "")
        for row in result.get("sell_in_items", [])
        if isinstance(row, dict)
        and row.get("classification") == "human_pricing_policy_required"
    }
    if pricing_policy != {EXPECTED_RF013C1_NON_POSITIVE_SELL_IN_SKU_ID}:
        differences.append("lineage_pricing_policy_sku_id")
    plan = result.get("plan") or {}
    if plan.get("classification") != "human_plan_input_required":
        differences.append("lineage_plan_classification")
    if len(plan.get("blocker_codes") or []) != 5:
        differences.append("lineage_plan_blocker_count")
    return differences


def validate_recovered_result(result: dict[str, Any]) -> list[str]:
    differences: list[str] = []
    if not bool(result.get("ready")):
        differences.append("recovered_candidate_not_ready")
    if dict(result.get("candidate_summary") or result.get("summary") or {}) != (
        EXPECTED_RF013C3_RECOVERED_SUMMARY
    ):
        differences.append("recovered_summary")
    blocker_counts = result.get("candidate_blocker_counts")
    if blocker_counts is None:
        blocker_counts = result.get("blocker_counts")
    if dict(blocker_counts or {}):
        differences.append("recovered_blockers")
    if str(result.get("consumer_mode") or "") != "compatibility_only":
        differences.append("recovered_consumer_mode")
    if not bool(result.get("legacy_target_untouched")):
        differences.append("legacy_target_touched")
    if bool(result.get("data_rewritten")):
        differences.append("recovered_data_rewritten")
    return differences


def main() -> None:
    args = parse_args()
    if not args.acknowledge_disposable_write:
        raise SystemExit("Pass --acknowledge-disposable-write.")
    if os.getenv(DISPOSABLE_DATABASE_OPT_IN, "").strip() != "1":
        raise SystemExit(
            f"Set {DISPOSABLE_DATABASE_OPT_IN}=1 before running the rehearsal."
        )
    if os.getenv("CALCULATIETOOL_ENV", "").strip().lower() not in {
        "local",
        "dev",
        "development",
        "test",
    }:
        raise SystemExit("RF-013C requires an explicit non-production environment.")
    if args.source_year <= 0 or args.target_year <= args.source_year:
        raise SystemExit("Use an explicit forward source/target year pair.")

    database_url = database_url_from_environment()
    target = assert_disposable_database_url(database_url)
    if target.host not in {"127.0.0.1", "::1", "localhost"}:
        raise SystemExit("RF-013C requires a loopback PostgreSQL target.")

    expected = json.loads(args.expected_baseline.read_text(encoding="utf-8"))
    years = [args.source_year, args.target_year]
    before = capture_from_connection_info(database_url, years=years)
    baseline_differences = compare_manifests(before, expected)
    if baseline_differences:
        raise SystemExit(
            "Restored database differs from RF-013P baseline: "
            + ", ".join(baseline_differences)
        )
    before_schema = _schema_by_table(database_url)

    from app.domain import (  # noqa: E402
        commercial_yearset_storage,
        cost_authority_service,
        yearset_blocker_lineage_service,
        yearset_recovery_service,
        yearset_reconciliation_service,
        yearset_reconciliation_storage,
    )

    authority_dry_run = cost_authority_service.backfill_legacy_authority(
        actor="rf013c-disposable-rehearsal",
        dry_run=True,
    )
    cost_authority_service.backfill_legacy_authority(
        actor="rf013c-disposable-rehearsal",
        dry_run=False,
        expected_manifest_hash=str(authority_dry_run["manifest_hash"]),
    )

    first_dry_run = yearset_reconciliation_service.reconcile(
        source_year=args.source_year,
        target_year=args.target_year,
        actor="rf013c-disposable-rehearsal",
        dry_run=True,
    )
    second_dry_run = yearset_reconciliation_service.reconcile(
        source_year=args.source_year,
        target_year=args.target_year,
        actor="rf013c-disposable-rehearsal",
        dry_run=True,
    )
    if first_dry_run["manifest_hash"] != second_dry_run["manifest_hash"]:
        raise SystemExit("RF-013C dry-run manifest is not deterministic.")
    restored_differences = validate_restored_result(first_dry_run)
    if restored_differences:
        raise SystemExit(
            "RF-013C restored characterization changed unexpectedly: "
            + ", ".join(restored_differences)
        )

    applied = yearset_reconciliation_service.reconcile(
        source_year=args.source_year,
        target_year=args.target_year,
        actor="rf013c-disposable-rehearsal",
        dry_run=False,
        expected_manifest_hash=str(first_dry_run["manifest_hash"]),
    )
    repeated = yearset_reconciliation_service.reconcile(
        source_year=args.source_year,
        target_year=args.target_year,
        actor="rf013c-disposable-rehearsal",
        dry_run=False,
        expected_manifest_hash=str(first_dry_run["manifest_hash"]),
    )
    if applied["run"]["id"] != repeated["run"]["id"]:
        raise SystemExit("RF-013C repeat unexpectedly created a second run.")
    if applied["generation"]["id"] != repeated["generation"]["id"]:
        raise SystemExit("RF-013C repeat unexpectedly created a second generation.")
    if bool(repeated["run"].get("created")):
        raise SystemExit("RF-013C repeat reported a new candidate run.")
    if bool(repeated["generation"].get("created")):
        raise SystemExit("RF-013C repeat reported a new commercial generation.")
    if commercial_yearset_storage.get_active_generation():
        raise SystemExit("RF-013C rehearsal unexpectedly activated a yearset.")

    run = yearset_reconciliation_storage.get_run(applied["run"]["id"]) or {}
    if run.get("readiness_status") != "blocked":
        raise SystemExit("Known restored gaps must retain a blocked candidate.")
    try:
        yearset_reconciliation_storage.approve(
            str(run.get("id") or ""),
            expected_manifest_hash=str(run.get("manifest_hash") or ""),
            actor="rf013c-management-rehearsal",
            actor_role="management",
            reason="rehearsal must remain blocked",
        )
    except yearset_reconciliation_storage.YearsetReconciliationBlocked:
        pass
    else:
        raise SystemExit("Blocked RF-013C candidate was unexpectedly approved.")

    worklist = yearset_reconciliation_service.review_current_blockers(
        source_year=args.source_year,
        target_year=args.target_year,
    )
    worklist_differences = validate_blocker_worklist(worklist)
    if worklist_differences:
        raise SystemExit(
            "RF-013C1 worklist changed unexpectedly: "
            + ", ".join(worklist_differences)
        )

    lineage_review = yearset_blocker_lineage_service.review_current_lineage(
        source_year=args.source_year,
        target_year=args.target_year,
    )
    lineage_differences = validate_lineage_review(lineage_review)
    if lineage_differences:
        raise SystemExit(
            "RF-013C2 lineage classification changed unexpectedly: "
            + ", ".join(lineage_differences)
        )

    recovery_request = {
        "source_year": args.source_year,
        "target_year": args.target_year,
        "expected_lineage_review_hash": str(
            lineage_review["lineage_review_hash"]
        ),
        "exact_target_anchor_sku_ids": sorted(
            EXPECTED_RF013C2_REPRODUCIBLE_COST_SKU_IDS
        ),
        "scope_decisions": [
            {
                "sku_id": sku_id,
                "decision": "historical_only_for_target_year",
                "reason": (
                    "Historische 75cl-SKU blijft bewaard, maar is niet actief "
                    "of gepland voor 2026."
                ),
            }
            for sku_id in sorted(EXPECTED_RF013C2_HUMAN_COST_SKU_IDS)
        ],
        "pricing_decisions": [
            {
                "sku_id": EXPECTED_RF013C1_NON_POSITIVE_SELL_IN_SKU_ID,
                "sell_in_ex_vat": "0.01",
                "currency": "EUR",
                "vat_basis": "exclusive",
                "reason": "Door de eigenaar goedgekeurde sell-inprijs.",
            }
        ],
        "approved_plan_revenue_ex_vat": APPROVED_2026_PLAN_REVENUE_EX_VAT,
        "allocation_policy": (
            "closed_source_actual_mix_scaled_to_approved_revenue"
        ),
        "reason": (
            "Goedgekeurde reconstructie op basis van het gesloten bronjaar en "
            "de opgeslagen doeljaardrivers."
        ),
    }
    recovery_preview = yearset_recovery_service.preview(recovery_request)
    recovered_differences = validate_recovered_result(recovery_preview)
    if recovered_differences:
        raise SystemExit(
            "RF-013C3 recovery preview changed unexpectedly: "
            + ", ".join(recovered_differences)
        )
    recovery_request["expected_decision_hash"] = str(
        recovery_preview["decision_hash"]
    )
    recovery_approval = yearset_recovery_service.approve(
        recovery_request,
        actor="rf013c-management-rehearsal",
        actor_role="management",
    )
    recovered_differences = validate_recovered_result(recovery_approval)
    if recovered_differences:
        raise SystemExit(
            "RF-013C3 approved recovery changed unexpectedly: "
            + ", ".join(recovered_differences)
        )

    recovered_dry_run = yearset_reconciliation_service.reconcile(
        source_year=args.source_year,
        target_year=args.target_year,
        actor="rf013c-disposable-rehearsal",
        dry_run=True,
    )
    recovered_differences = validate_recovered_result(recovered_dry_run)
    if recovered_differences:
        raise SystemExit(
            "RF-013C3 rebuilt candidate changed unexpectedly: "
            + ", ".join(recovered_differences)
        )
    recovered_candidate = yearset_reconciliation_service.reconcile(
        source_year=args.source_year,
        target_year=args.target_year,
        actor="rf013c-disposable-rehearsal",
        dry_run=False,
        expected_manifest_hash=str(recovered_dry_run["manifest_hash"]),
    )
    approved_candidate = yearset_reconciliation_service.approve(
        recovered_candidate["run"]["id"],
        expected_manifest_hash=str(recovered_dry_run["manifest_hash"]),
        actor="rf013c-management-rehearsal",
        actor_role="management",
        reason="Exacte herstelinvoer en kandidaat gereviewd.",
    )
    activated_candidate = yearset_reconciliation_service.activate(
        recovered_candidate["run"]["id"],
        expected_manifest_hash=str(recovered_dry_run["manifest_hash"]),
        expected_active_generation_id="",
        actor="rf013c-admin-rehearsal",
        actor_role="admin",
        reason="Wegwerpdatabase-rehearsal van de atomische pointerwissel.",
    )
    if approved_candidate.get("status") != "approved":
        raise SystemExit("RF-013C3 recovered candidate was not approved.")
    if activated_candidate["run"].get("status") != "active":
        raise SystemExit("RF-013C3 recovered candidate was not activated.")

    after = capture_from_connection_info(database_url, years=years)
    after_schema = _schema_by_table(database_url)
    differences = compare_additive_rehearsal(
        before,
        after,
        before_schema=before_schema,
        after_schema=after_schema,
        allowed_new_tables=ALLOWED_NEW_TABLES,
    )
    if differences:
        raise SystemExit(
            "RF-013C changed protected pre-existing state: " + ", ".join(differences)
        )

    output = _private_output(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "version": "rf-013c-v1",
        "databaseClassification": "disposable-loopback-rf013p-restore",
        "sourceYear": args.source_year,
        "targetYear": args.target_year,
        "baselineMatched": True,
        "preexistingDataAndSchemaUnchanged": True,
        "idempotentDryRun": True,
        "idempotentCandidateWrite": True,
        "blockedApprovalRejected": True,
        "activeGenerationCount": 1,
        "consumerMode": "compatibility_only",
        "dataRewritten": False,
        "allowedNewTables": sorted(ALLOWED_NEW_TABLES),
        "manifestHash": str(first_dry_run["manifest_hash"]),
        "summary": dict(first_dry_run["summary"]),
        "blockerCounts": dict(first_dry_run["blocker_counts"]),
        "amountFreeBlockerWorklist": {
            "version": str(worklist["version"]),
            "areaCounts": dict(worklist["area_counts"]),
            "itemCount": len(worklist["work_items"]),
            "exactGapIdentitiesConfirmed": True,
            "dataRewritten": bool(worklist["data_rewritten"]),
        },
        "amountFreeLineageReview": {
            "version": str(lineage_review["version"]),
            "lineageReviewHash": str(lineage_review["lineage_review_hash"]),
            "summary": dict(lineage_review["summary"]),
            "readyForReconciliationRebuild": bool(
                lineage_review["ready_for_reconciliation_rebuild"]
            ),
            "writeAuthorized": bool(lineage_review["write_authorized"]),
            "dataRewritten": bool(lineage_review["data_rewritten"]),
        },
        "candidate": {
            "generationId": str(applied["generation"]["id"]),
            "runId": str(applied["run"]["id"]),
            "status": str(run.get("status") or ""),
            "readinessStatus": str(run.get("readiness_status") or ""),
        },
        "approvedRecovery": {
            "version": str(recovery_preview["version"]),
            "decisionHash": str(recovery_preview["decision_hash"]),
            "planReconstructionProof": dict(
                recovery_preview["plan_reconstruction_proof"]
            ),
            "summary": dict(recovery_preview["candidate_summary"]),
            "legacyTargetUntouched": bool(
                recovery_preview["legacy_target_untouched"]
            ),
            "dataRewritten": bool(recovery_preview["data_rewritten"]),
        },
        "activatedRecoveredCandidate": {
            "generationId": str(recovered_candidate["generation"]["id"]),
            "runId": str(recovered_candidate["run"]["id"]),
            "status": str(activated_candidate["run"].get("status") or ""),
        },
    }
    output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        "RF-013C rehearsal passed: RF-013P baseline matched, A/B/C remained "
        "strictly additive, known gaps blocked the first candidate, exact blocker "
        "lineage was classified, the approved recovery produced a ready candidate, "
        "Management approved it, Administrator moved one pointer atomically, and "
        "legacy consumers and historical rows were untouched."
    )


if __name__ == "__main__":
    main()
