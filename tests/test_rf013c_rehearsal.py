from __future__ import annotations

import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.rf013c_rehearse_yearset_reconciliation import (  # noqa: E402
    ALLOWED_NEW_TABLES,
    EXPECTED_RF013C1_AREA_COUNTS,
    EXPECTED_RF013C1_COST_DEPENDENT_PRICE_SKU_IDS,
    EXPECTED_RF013C1_COST_SKU_IDS,
    EXPECTED_RF013C1_NON_POSITIVE_SELL_IN_SKU_ID,
    EXPECTED_RF013C2_HUMAN_COST_SKU_IDS,
    EXPECTED_RF013C2_REPRODUCIBLE_COST_SKU_IDS,
    EXPECTED_RF013C2_SUMMARY,
    EXPECTED_RESTORED_BLOCKERS,
    EXPECTED_RESTORED_SUMMARY,
    RF013C_TABLES,
    validate_blocker_worklist,
    validate_lineage_review,
    validate_restored_result,
)


class Rf013cRehearsalSafetyTests(unittest.TestCase):
    def test_only_exact_six_reconciliation_tables_are_added_by_rf013c(self) -> None:
        self.assertEqual(
            RF013C_TABLES,
            {
                "commercial_yearset_candidate_channels",
                "commercial_yearset_candidate_plan",
                "commercial_yearset_candidate_prices",
                "commercial_yearset_candidate_skus",
                "commercial_yearset_reconciliation_events",
                "commercial_yearset_reconciliation_runs",
            },
        )
        self.assertEqual(len(ALLOWED_NEW_TABLES), 16)

    def test_restored_characterization_requires_exact_known_gaps(self) -> None:
        result = {
            "ready": False,
            "summary": EXPECTED_RESTORED_SUMMARY,
            "blocker_counts": EXPECTED_RESTORED_BLOCKERS,
            "consumer_mode": "compatibility_only",
            "data_rewritten": False,
        }
        self.assertEqual(validate_restored_result(result), [])

        changed = {**result, "summary": {**EXPECTED_RESTORED_SUMMARY, "sku_count": 82}}
        self.assertIn("restored_summary", validate_restored_result(changed))

    def test_blocker_worklist_requires_exact_known_gap_identities(self) -> None:
        work_items = [
            {
                "area": "cost",
                "blocker_code": "target_cost_input_missing",
                "subject": {"sku_id": sku_id},
            }
            for sku_id in sorted(EXPECTED_RF013C1_COST_SKU_IDS)
        ]
        work_items.extend(
            {
                "area": "sell_in",
                "blocker_code": "target_sell_in_cost_unresolved",
                "subject": {"sku_id": sku_id},
            }
            for sku_id in sorted(EXPECTED_RF013C1_COST_DEPENDENT_PRICE_SKU_IDS)
        )
        work_items.append(
            {
                "area": "sell_in",
                "blocker_code": "target_sell_in_non_positive",
                "subject": {
                    "sku_id": EXPECTED_RF013C1_NON_POSITIVE_SELL_IN_SKU_ID
                },
            }
        )
        work_items.extend(
            {
                "area": "plan",
                "blocker_code": code,
                "subject": {"target_year": 2026},
            }
            for code in (
                "plan_contribution_missing",
                "plan_liters_missing",
                "plan_period_allocation_missing",
                "plan_revenue_missing",
                "plan_units_missing",
            )
        )
        result = {
            "version": "rf-013c1-v1",
            "ready": False,
            "blocker_counts": EXPECTED_RESTORED_BLOCKERS,
            "area_counts": EXPECTED_RF013C1_AREA_COUNTS,
            "consumer_mode": "compatibility_only",
            "data_rewritten": False,
            "work_items": work_items,
        }

        self.assertEqual(validate_blocker_worklist(result), [])
        changed = {
            **result,
            "work_items": [
                *work_items[:-1],
                {
                    **work_items[-1],
                    "subject": {"sku_id": "unexpected-sku"},
                },
            ],
        }
        self.assertIn(
            "worklist_item_count",
            validate_blocker_worklist({**changed, "work_items": work_items[:-1]}),
        )

    def test_lineage_review_requires_exact_known_gap_classifications(self) -> None:
        cost_items = [
            {
                "sku_id": sku_id,
                "classification": "reproducible_from_exact_target_anchor",
                "automatic_reproduction_eligible": True,
                "requires_human_decision": False,
            }
            for sku_id in sorted(EXPECTED_RF013C2_REPRODUCIBLE_COST_SKU_IDS)
        ]
        cost_items.extend(
            {
                "sku_id": sku_id,
                "classification": "human_scope_and_cost_decision_required",
                "automatic_reproduction_eligible": False,
                "requires_human_decision": True,
            }
            for sku_id in sorted(EXPECTED_RF013C2_HUMAN_COST_SKU_IDS)
        )
        result = {
            "version": "rf-013c2-v1",
            "summary": EXPECTED_RF013C2_SUMMARY,
            "ready_for_reconciliation_rebuild": False,
            "write_authorized": False,
            "consumer_mode": "compatibility_only",
            "data_rewritten": False,
            "cost_items": cost_items,
            "sell_in_items": [
                {
                    "sku_id": EXPECTED_RF013C1_NON_POSITIVE_SELL_IN_SKU_ID,
                    "classification": "human_pricing_policy_required",
                }
            ],
            "plan": {
                "classification": "human_plan_input_required",
                "blocker_codes": [
                    "plan_contribution_missing",
                    "plan_liters_missing",
                    "plan_period_allocation_missing",
                    "plan_revenue_missing",
                    "plan_units_missing",
                ],
            },
        }

        self.assertEqual(validate_lineage_review(result), [])
        self.assertIn(
            "lineage_unexpected_ready",
            validate_lineage_review(
                {**result, "ready_for_reconciliation_rebuild": True}
            ),
        )


if __name__ == "__main__":
    unittest.main()
