from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import (  # noqa: E402
    yearset_blocker_lineage_service,
    yearset_recovery_service,
)
from scripts.rf013c_rehearse_yearset_reconciliation import (  # noqa: E402
    APPROVED_2026_PLAN_REVENUE_EX_VAT,
    EXPECTED_RF013C1_NON_POSITIVE_SELL_IN_SKU_ID,
    EXPECTED_RF013C2_HUMAN_COST_SKU_IDS,
    EXPECTED_RF013C2_REPRODUCIBLE_COST_SKU_IDS,
    validate_lineage_review,
    validate_recovered_result,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read-only preview of the explicitly approved RF-013C3 recovery. "
            "This command never persists the decision or builds a candidate."
        )
    )
    parser.add_argument("--source-year", type=int, default=2025)
    parser.add_argument("--target-year", type=int, default=2026)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if os.getenv("CALCULATIETOOL_ENV", "").strip().lower() in {
        "prod",
        "production",
    }:
        raise SystemExit("The RF-013C3 preview refuses a production environment.")
    lineage = yearset_blocker_lineage_service.review_current_lineage(
        source_year=int(args.source_year),
        target_year=int(args.target_year),
    )
    lineage_differences = validate_lineage_review(lineage)
    if lineage_differences:
        safe_diagnostic = {
            "differences": lineage_differences,
            "summary": lineage.get("summary", {}),
            "costItems": [
                {
                    "skuId": row.get("sku_id", ""),
                    "classification": row.get("classification", ""),
                    "automatic": bool(
                        row.get("automatic_reproduction_eligible")
                    ),
                    "requiresHumanDecision": bool(
                        row.get("requires_human_decision")
                    ),
                    "evidenceCounts": {
                        key: value
                        for key, value in (row.get("evidence", {}) or {}).items()
                        if key
                        in {
                            "activation_count",
                            "target_open_activation_count",
                            "anchor_count",
                            "target_anchor_count",
                            "cost_row_count",
                            "exact_target_anchor_chain_count",
                            "valid_target_anchor_chain_count",
                        }
                    },
                }
                for row in lineage.get("cost_items", [])
                if isinstance(row, dict)
            ],
            "sellInItems": [
                {
                    "skuId": row.get("sku_id", ""),
                    "classification": row.get("classification", ""),
                }
                for row in lineage.get("sell_in_items", [])
                if isinstance(row, dict)
            ],
            "planClassification": (
                lineage.get("plan", {}) or {}
            ).get("classification", ""),
            "writeAuthorized": bool(lineage.get("write_authorized")),
            "dataRewritten": bool(lineage.get("data_rewritten")),
        }
        print(
            json.dumps(
                safe_diagnostic,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
        )
        raise SystemExit(
            "Current lineage differs from the approved RF-013C2 baseline: "
            + ", ".join(lineage_differences)
        )
    request = {
        "source_year": int(args.source_year),
        "target_year": int(args.target_year),
        "expected_lineage_review_hash": str(lineage["lineage_review_hash"]),
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
    preview = yearset_recovery_service.preview(request)
    differences = validate_recovered_result(preview)
    if differences:
        raise SystemExit(
            "Recovery preview differs from the approved RF-013C3 contract: "
            + ", ".join(differences)
        )
    safe_result = {
        "version": preview["version"],
        "sourceYear": preview["source_year"],
        "targetYear": preview["target_year"],
        "decisionHash": preview["decision_hash"],
        "baseManifestHash": preview["base_manifest_hash"],
        "candidateManifestHash": preview["candidate_manifest_hash"],
        "ready": preview["ready"],
        "summary": preview["candidate_summary"],
        "blockerCounts": preview["candidate_blocker_counts"],
        "planReconstructionProof": preview["plan_reconstruction_proof"],
        "excludedSkuIds": preview["excluded_sku_ids"],
        "exactTargetAnchorSkuIds": preview["exact_target_anchor_sku_ids"],
        "pricingOverrideSkuIds": preview["pricing_override_sku_ids"],
        "persisted": preview["persisted"],
        "legacyTargetUntouched": preview["legacy_target_untouched"],
        "consumerMode": preview["consumer_mode"],
        "dataRewritten": preview["data_rewritten"],
    }
    print(json.dumps(safe_result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
