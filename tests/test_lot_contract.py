from __future__ import annotations

import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.domain import douano_margin_service, lot_costs_storage


class LotContractTests(unittest.TestCase):
    def test_lot_exact_key_keeps_letter_o_and_digit_zero_distinct(self) -> None:
        douano_lot = "PO3010"
        internal_lot = "P03010"

        self.assertNotEqual(
            lot_costs_storage._lot_exact_key(douano_lot),
            lot_costs_storage._lot_exact_key(internal_lot),
        )
        self.assertNotEqual(
            douano_margin_service._lot_exact_key(douano_lot),
            douano_margin_service._lot_exact_key(internal_lot),
        )


    def test_lot_near_key_is_only_for_diagnostics(self) -> None:
        douano_lot = "PO3010"
        internal_lot = "P03010"

        self.assertEqual(
            lot_costs_storage._lot_near_key(douano_lot),
            lot_costs_storage._lot_near_key(internal_lot),
        )
        self.assertEqual(
            douano_margin_service._lot_near_key(douano_lot),
            douano_margin_service._lot_near_key(internal_lot),
        )
        self.assertNotEqual(
            lot_costs_storage._lot_exact_key(douano_lot),
            lot_costs_storage._lot_near_key(internal_lot),
        )


    def test_snapshot_backfill_uses_keyset_pagination(self) -> None:
        names = douano_margin_service.backfill_line_snapshots.__code__.co_names

        self.assertNotIn("offset", {str(name).lower() for name in names})


    def test_legacy_company_lines_route_stays_snapshot_only(self) -> None:
        names = douano_margin_service.list_company_lines.__code__.co_names

        self.assertNotIn("_resolve_cost_per_unit", names)
        self.assertNotIn("_resolve_cost_for_sale", names)


if __name__ == "__main__":
    unittest.main()
