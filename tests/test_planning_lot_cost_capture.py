from __future__ import annotations

import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.capture_active_commercial_context import validate_capture_target  # noqa: E402
from scripts.planning_lot_cost_snapshot import build_private_manifest, fingerprint  # noqa: E402


class PlanningLotCostCaptureSafetyTests(unittest.TestCase):
    def test_private_target_requires_explicit_development_opt_in(self) -> None:
        with self.assertRaises(SystemExit):
            validate_capture_target(
                "10.10.1.10",
                "development",
                allow_private_development_host=False,
            )

    def test_fingerprints_are_domain_separated(self) -> None:
        self.assertNotEqual(fingerprint(["same"], "planning"), fingerprint(["same"], "actual"))

    def test_private_manifest_does_not_emit_identifiers_or_commercial_values(self) -> None:
        manifest = build_private_manifest(
            {
                "activations": [
                    {
                        "id": "private-activation",
                        "sku_id": "private-sku",
                        "jaar": 2026,
                        "kostprijsversie_id": "private-version",
                        "effectief_vanaf": "2026-01-01T00:00:00Z",
                    }
                ],
                "activationEvents": [],
                "versions": [],
                "costRows": [],
                "actualSnapshots": [
                    {
                        "sku_id": "private-sku",
                        "cost_price_ex": 123.45,
                        "cost_status": "resolved_lot_cost",
                    }
                ],
            },
            baseline_commit="abc",
            captured_at="2026-07-20",
        )
        rendered = str(manifest)
        self.assertNotIn("private-sku", rendered)
        self.assertNotIn("private-version", rendered)
        self.assertNotIn("123.45", rendered)


if __name__ == "__main__":
    unittest.main()
