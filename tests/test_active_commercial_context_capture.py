from __future__ import annotations

import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.capture_active_commercial_context import validate_capture_target  # noqa: E402


class ActiveCommercialContextCaptureSafetyTests(unittest.TestCase):
    def test_loopback_local_target_is_accepted_without_private_opt_in(self) -> None:
        validate_capture_target(
            "127.0.0.1",
            "local",
            allow_private_development_host=False,
        )

    def test_private_target_requires_explicit_opt_in(self) -> None:
        with self.assertRaises(SystemExit):
            validate_capture_target(
                "10.10.1.10",
                "local",
                allow_private_development_host=False,
            )

    def test_private_target_is_accepted_only_for_explicit_development(self) -> None:
        validate_capture_target(
            "10.10.1.10",
            "development",
            allow_private_development_host=True,
        )

    def test_production_is_rejected_even_with_private_opt_in(self) -> None:
        with self.assertRaises(SystemExit):
            validate_capture_target(
                "10.10.1.10",
                "production",
                allow_private_development_host=True,
            )

    def test_unverified_hostname_is_rejected_even_with_opt_in(self) -> None:
        with self.assertRaises(SystemExit):
            validate_capture_target(
                "database.internal",
                "development",
                allow_private_development_host=True,
            )


if __name__ == "__main__":
    unittest.main()
