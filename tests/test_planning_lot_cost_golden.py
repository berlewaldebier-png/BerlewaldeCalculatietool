from __future__ import annotations

from datetime import date
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import break_even_planning_service, douano_margin_service  # noqa: E402
from scripts.planning_lot_cost_snapshot import build_report  # noqa: E402


FIXTURE_PATH = (
    PROJECT_ROOT
    / "frontend"
    / "scripts"
    / "fixtures"
    / "planning-lot-cost.synthetic.golden.json"
)


class PlanningLotCostGoldenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        cls.input = cls.fixture["input"]
        cls.expected = cls.fixture["expected"]
        cls.versions_by_id = {row["id"]: row for row in cls.input["versions"]}
        cls.cost_index = {
            (version["id"], row["sku_id"]): float(row["kostprijs"])
            for version in cls.input["versions"]
            for row in version.get("cost_lines", [])
        }
        cls.component_index = {
            (version["id"], row["sku_id"]): {
                "inkoop": float(row.get("inkoop", 0) or 0),
                "verpakkingskosten": float(row.get("verpakkingskosten", 0) or 0),
                "indirecte_kosten": float(row.get("indirecte_kosten", 0) or 0),
                "accijns": float(row.get("accijns", 0) or 0),
                "kostprijs": float(row.get("kostprijs", 0) or 0),
            }
            for version in cls.input["versions"]
            for row in version.get("cost_lines", [])
        }
        cls.activation_index = douano_margin_service._build_activation_index(cls.input["activations"])
        cls.version_lot_context = douano_margin_service._build_version_lot_context(
            cls.versions_by_id,
            cls.cost_index,
        )

    def _resolve(self, *, transaction: str, lot: str | None) -> dict:
        context = {
            **self.version_lot_context,
            "complete": True,
            "sales_lots": {
                (transaction, "EXT-CASE-24"): {
                    "lot_number": lot or "",
                    "transaction_number": transaction,
                }
            },
            "alias_by_lot": {},
            "lot_cost_by_lot": {},
        }
        return douano_margin_service._resolve_cost_for_sale(
            transaction_number=transaction,
            douano_sku="EXT-CASE-24",
            sku_id="sku-case-24",
            as_of=date(2026, 7, 1),
            quantity=2,
            activations_index=self.activation_index,
            versions_by_id=self.versions_by_id,
            snapshot_cost_index=self.cost_index,
            snapshot_components_index=self.component_index,
            resolution_context=context,
        )

    def _status(self, resolved: dict) -> str:
        return douano_margin_service._snapshot_cost_status(
            {**resolved, "mapped": True, "ignored": False, "lot_required": True}
        )

    def test_lot_requirement_and_cost_requirement_are_independent(self) -> None:
        non_lot_with_cost = douano_margin_service._snapshot_cost_status(
            {
                "mapped": True,
                "ignored": False,
                "missing_cost": False,
                "cost_source": "baseline",
                "lot_required": False,
                "lot_number": "",
            }
        )
        rounding_without_cost = douano_margin_service._snapshot_cost_status(
            {
                "mapped": True,
                "ignored": False,
                "missing_cost": False,
                "cost_source": "no_cost_required",
                "lot_required": False,
                "lot_number": "",
            }
        )
        explicitly_ignored = douano_margin_service._snapshot_cost_status(
            {
                "mapped": False,
                "ignored": True,
                "missing_cost": False,
                "cost_source": "",
                "lot_required": False,
                "lot_number": "",
            }
        )

        self.assertEqual(non_lot_with_cost, "resolved_active_sku_cost")
        self.assertEqual(rounding_without_cost, "no_cost_required")
        self.assertEqual(explicitly_ignored, "ignored")

    def test_approved_anchor_is_first_activation_but_current_latest_selection_deviates(self) -> None:
        report = build_report(
            {
                "activations": self.input["activations"],
                "activationEvents": self.input["activationEvents"],
                "versions": self.input["versions"],
                "costRows": [
                    {"version_id": version["id"], **row}
                    for version in self.input["versions"]
                    for row in version.get("cost_lines", [])
                ],
                "actualSnapshots": self.input["actualSnapshots"],
            }
        )
        approved = {
            (row["skuId"], row["year"]): row["costVersionId"]
            for row in report["approvedPlanningAnchors"]
        }
        self.assertEqual(
            approved[("sku-case-24", 2026)],
            self.expected["approvedPurchasedPlanningVersion"],
        )
        purchased_anchor = next(
            row
            for row in report["approvedPlanningAnchors"]
            if row["skuId"] == "sku-case-24" and row["year"] == 2026
        )
        self.assertEqual(purchased_anchor["costRowId"], "")
        self.assertEqual(purchased_anchor["componentBreakdown"]["kostprijs"], 14)
        self.assertEqual(approved[("sku-fust", 2026)], "version-new-format")
        self.assertEqual(approved[("sku-own-case", 2026)], "version-own-first")
        self.assertEqual(approved[("sku-case-24", 2027)], "version-next-year")
        self.assertEqual(approved[("sku-rebaseline", 2026)], "version-rebaseline-approved")
        reasons = {
            (row["skuId"], row["year"]): row["reason"]
            for row in report["planningDeviations"]
        }
        self.assertEqual(
            reasons[("sku-case-24", 2026)],
            "latest_activation_replaces_first_planning_anchor",
        )
        self.assertEqual(
            reasons[("sku-own-case", 2026)],
            "latest_activation_replaces_first_planning_anchor",
        )
        exact_actual = next(
            row for row in report["actualCostSelections"] if row["actualId"] == "snapshot-exact"
        )
        self.assertEqual(exact_actual["costVersionId"], "version-jan")
        self.assertEqual(exact_actual["componentBreakdown"]["kostprijs"], 14)
        self.assertEqual(exact_actual["source"], "cost_version_lot")
        self.assertEqual(exact_actual["warning"], "")

    def test_break_even_currently_reads_only_the_open_latest_activation(self) -> None:
        activations = [
            row
            for row in self.input["activations"]
            if row["sku_id"] == "sku-case-24" and row["jaar"] == 2026
        ]
        with (
            patch.object(break_even_planning_service.dataset_store, "load_dataset", return_value=activations),
            patch.object(
                break_even_planning_service.cost_versions_storage,
                "load_cost_row_components_index_for_versions",
                return_value=self.component_index,
            ),
            patch.object(
                break_even_planning_service,
                "_sku_labels",
                return_value={"sku-case-24": {"sku_id": "sku-case-24", "sku_code": "CASE-24", "sku_name": "Synthetic"}},
            ),
        ):
            rows = break_even_planning_service._active_planning_rows(2026)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["kostprijsversie_id"], self.expected["observedBreakEvenVersion"])
        self.assertEqual(rows[0]["kostprijs"], self.expected["observedNewQuoteCost"])

    def test_exact_lot_wins_across_later_activation_and_order_date(self) -> None:
        january = self._resolve(transaction="TX-JAN", lot="LOT-JAN")
        may = self._resolve(transaction="TX-MAY", lot="LOT-MAY")
        self.assertEqual(january["kostprijsversie_id"], self.expected["exactJanuaryLotVersion"])
        self.assertEqual(january["cost_price_ex"], 14)
        self.assertEqual(self._status(january), "resolved_lot_cost")
        self.assertEqual(may["kostprijsversie_id"], self.expected["exactMayLotVersion"])
        self.assertEqual(may["cost_price_ex"], 17)

    def test_missing_unknown_and_near_lot_use_visible_latest_activation_fallbacks(self) -> None:
        missing = self._resolve(transaction="TX-NO-LOT", lot=None)
        unknown = self._resolve(transaction="TX-UNKNOWN", lot="UNKNOWN")
        near = self._resolve(transaction="TX-NEAR", lot="L0T-JAN")
        self.assertEqual(missing["kostprijsversie_id"], self.expected["missingLotFallbackVersion"])
        self.assertEqual(self._status(missing), "fallback_active_sku_cost")
        self.assertEqual(unknown["kostprijsversie_id"], "version-may")
        self.assertEqual(self._status(unknown), self.expected["unknownLotFallbackStatus"])
        self.assertEqual(near["kostprijsversie_id"], "version-may")
        self.assertEqual(self._status(near), "lot_near_match_fallback")
        self.assertEqual(near["lot_near_match_version_id"], "version-jan")

    def test_ambiguous_exact_lot_is_silently_resolved_to_highest_version_today(self) -> None:
        ambiguous = self._resolve(transaction="TX-DUP", lot="DUP-LOT")
        self.assertEqual(
            ambiguous["kostprijsversie_id"],
            self.expected["ambiguousLotObservedVersion"],
        )
        self.assertEqual(ambiguous["cost_price_ex"], 19)
        report = build_report(
            {
                "activations": self.input["activations"],
                "activationEvents": self.input["activationEvents"],
                "versions": self.input["versions"],
                "costRows": [
                    {"version_id": version["id"], **row}
                    for version in self.input["versions"]
                    for row in version.get("cost_lines", [])
                ],
            }
        )
        self.assertEqual(len(report["exactLotAmbiguities"]), 1)

    def test_reopened_historical_quote_keeps_its_saved_cost_reference(self) -> None:
        quote = dict(self.fixture["historicalQuote"])
        self.assertEqual(quote["costVersionId"], "version-jan")
        self.assertEqual(quote["costPriceEx"], 14)


if __name__ == "__main__":
    unittest.main()
