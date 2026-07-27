from __future__ import annotations

import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.rf013c_rehearse_yearset_reconciliation import (  # noqa: E402
    ALLOWED_NEW_TABLES,
    EXPECTED_RESTORED_BLOCKERS,
    EXPECTED_RESTORED_SUMMARY,
    RF013C_TABLES,
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


if __name__ == "__main__":
    unittest.main()
