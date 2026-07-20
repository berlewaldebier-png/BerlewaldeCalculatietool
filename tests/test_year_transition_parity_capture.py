from __future__ import annotations

import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts import capture_year_transition_sku_parity


class YearTransitionParityCaptureSafetyTests(unittest.TestCase):
    def test_capture_requires_explicit_pseudonymous_structure_acknowledgement(self) -> None:
        argv = [
            "capture_year_transition_sku_parity.py",
            "--source-year",
            "2025",
            "--target-year",
            "2026",
        ]
        environment = {
            "CALCULATIETOOL_ENV": "local",
            "CALCULATIETOOL_POSTGRES_HOST": "127.0.0.1",
        }
        with patch.object(sys, "argv", argv), patch.dict(os.environ, environment, clear=False):
            with self.assertRaises(SystemExit) as raised:
                capture_year_transition_sku_parity.main()

        self.assertIn("acknowledge-pseudonymous-structure", str(raised.exception))

    def test_capture_rejects_non_forward_year_transition_before_connecting(self) -> None:
        argv = [
            "capture_year_transition_sku_parity.py",
            "--source-year",
            "2026",
            "--target-year",
            "2026",
            "--acknowledge-pseudonymous-structure",
        ]
        with patch.object(sys, "argv", argv):
            with self.assertRaises(SystemExit) as raised:
                capture_year_transition_sku_parity.main()

        self.assertIn("target-year > source-year", str(raised.exception))

    def test_fingerprints_are_domain_separated_and_do_not_embed_raw_values(self) -> None:
        label = "commercially-sensitive-label"
        first = capture_year_transition_sku_parity.fingerprint(label, "label")
        second = capture_year_transition_sku_parity.fingerprint(label, "bom")

        self.assertRegex(first, r"^sha256:[0-9a-f]{64}$")
        self.assertNotEqual(first, second)
        self.assertNotIn(label, first)


if __name__ == "__main__":
    unittest.main()
