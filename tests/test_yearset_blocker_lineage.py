from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import yearset_blocker_lineage_service  # noqa: E402


def _plan() -> dict:
    return {
        "source_year": 2025,
        "target_year": 2026,
        "manifest_hash": "sha256:manifest",
        "validation_hash": "sha256:validation",
        "sku_entries": [
            {
                "sku_id": "sku-exact",
                "scope_classification": "target_operational_addition",
            },
            {
                "sku_id": "sku-human",
                "scope_classification": "sellable_without_anchor",
            },
        ],
    }


def _worklist() -> dict:
    return {
        "work_items": [
            {
                "area": "cost",
                "blocker_code": "target_cost_input_missing",
                "subject": {"sku_id": "sku-exact"},
            },
            {
                "area": "cost",
                "blocker_code": "target_cost_input_missing",
                "subject": {"sku_id": "sku-human"},
            },
            {
                "area": "sell_in",
                "blocker_code": "target_sell_in_cost_unresolved",
                "subject": {"sku_id": "sku-human"},
            },
            {
                "area": "sell_in",
                "blocker_code": "target_sell_in_non_positive",
                "subject": {"sku_id": "sku-free"},
            },
            *[
                {
                    "area": "plan",
                    "blocker_code": code,
                    "subject": {"year": 2026},
                }
                for code in (
                    "target_plan_revenue_non_positive",
                    "target_plan_contribution_non_positive",
                    "target_plan_liters_non_positive",
                    "target_plan_units_non_positive",
                    "target_plan_period_allocations_missing",
                )
            ],
        ]
    }


def _evidence() -> dict:
    return {
        "skus": {
            "sku-exact": {
                "display_name": "Berlewalde het Juweel - Fles 33cl",
                "subject_type": "beer",
                "subject_id": "beer-juweel",
                "activations": [
                    {
                        "activation_id": "activation-1",
                        "year": 2026,
                        "cost_version_id": "version-1",
                        "open": True,
                    }
                ],
                "anchors": [
                    {
                        "anchor_id": "anchor-1",
                        "year": 2026,
                        "activation_id": "activation-1",
                        "cost_version_id": "version-1",
                        "cost_row_id": "row-1",
                        "anchor_kind": "first_activation",
                    }
                ],
                "cost_rows": [
                    {
                        "cost_row_id": "row-1",
                        "cost_version_id": "version-1",
                        "primary": "10",
                        "packaging": "2",
                        "overhead": "3",
                        "excise": "4",
                        "cost": "19",
                    }
                ],
                "prices": [],
                "bom_line_ids": [],
                "same_subject_format_sku_ids": ["sku-exact"],
            },
            "sku-human": {
                "display_name": "Berlewalde Dubbel - Fles 75cl",
                "subject_type": "beer",
                "subject_id": "beer-dubbel",
                "historical": True,
                "cost_status": "historie_v0",
                "activations": [],
                "anchors": [],
                "cost_rows": [],
                "prices": [],
                "bom_line_ids": ["bom-1"],
                "same_subject_format_sku_ids": ["sku-human"],
            },
            "sku-free": {
                "display_name": "Berlewalde Biervilt",
                "prices": [
                    {
                        "pricing_id": "price-2025",
                        "year": 2025,
                        "positive": False,
                    },
                    {
                        "pricing_id": "price-2026",
                        "year": 2026,
                        "positive": False,
                    },
                ],
            },
        },
        "plans": [
            {
                "plan_id": "plan-2025",
                "year": 2025,
                "source": "first_use_backfill",
                "status": "closed",
                "payload": {"targets": {}},
            },
            {
                "plan_id": "plan-2026",
                "year": 2026,
                "source": "new_year_preparation",
                "status": "active",
                "payload": {"targets": {}},
            },
        ],
        "drafts": [],
    }


class YearsetBlockerLineageTests(unittest.TestCase):
    def test_exact_target_authority_is_reproducible_without_inventing_amounts(
        self,
    ) -> None:
        review = yearset_blocker_lineage_service.build_lineage_review(
            plan=_plan(),
            worklist=_worklist(),
            evidence=_evidence(),
        )

        exact = next(
            row for row in review["cost_items"] if row["sku_id"] == "sku-exact"
        )
        self.assertEqual(
            exact["classification"], "reproducible_from_exact_target_anchor"
        )
        self.assertTrue(exact["automatic_reproduction_eligible"])
        self.assertEqual(
            exact["evidence"]["exact_target_anchor_chain"]["anchor_id"],
            "anchor-1",
        )

    def test_historical_sellable_sku_without_authority_requires_human_decision(
        self,
    ) -> None:
        review = yearset_blocker_lineage_service.build_lineage_review(
            plan=_plan(),
            worklist=_worklist(),
            evidence=_evidence(),
        )

        missing = next(
            row for row in review["cost_items"] if row["sku_id"] == "sku-human"
        )
        self.assertEqual(
            missing["classification"], "human_scope_and_cost_decision_required"
        )
        self.assertFalse(missing["automatic_reproduction_eligible"])
        self.assertTrue(missing["requires_human_decision"])

    def test_multiple_valid_authority_chains_are_never_selected_automatically(
        self,
    ) -> None:
        evidence = _evidence()
        duplicate_activation = copy.deepcopy(
            evidence["skus"]["sku-exact"]["activations"][0]
        )
        duplicate_activation["activation_id"] = "activation-2"
        duplicate_anchor = copy.deepcopy(evidence["skus"]["sku-exact"]["anchors"][0])
        duplicate_anchor.update(
            {
                "anchor_id": "anchor-2",
                "activation_id": "activation-2",
            }
        )
        evidence["skus"]["sku-exact"]["activations"].append(duplicate_activation)
        evidence["skus"]["sku-exact"]["anchors"].append(duplicate_anchor)

        review = yearset_blocker_lineage_service.build_lineage_review(
            plan=_plan(),
            worklist=_worklist(),
            evidence=evidence,
        )

        exact = next(
            row for row in review["cost_items"] if row["sku_id"] == "sku-exact"
        )
        self.assertEqual(
            exact["classification"], "authority_conflict_investigation_required"
        )
        self.assertFalse(exact["automatic_reproduction_eligible"])

    def test_plan_and_zero_sell_in_are_explicit_human_policy_decisions(self) -> None:
        review = yearset_blocker_lineage_service.build_lineage_review(
            plan=_plan(),
            worklist=_worklist(),
            evidence=_evidence(),
        )

        self.assertEqual(
            review["plan"]["classification"], "human_plan_input_required"
        )
        self.assertEqual(review["summary"]["plan_input_blockers"], 5)
        zero_price = next(
            row
            for row in review["sell_in_items"]
            if row["sku_id"] == "sku-free"
        )
        self.assertEqual(
            zero_price["classification"], "human_pricing_policy_required"
        )
        self.assertFalse(review["ready_for_reconciliation_rebuild"])
        self.assertFalse(review["write_authorized"])
        self.assertFalse(review["data_rewritten"])

    def test_projection_is_amount_free_and_labels_do_not_change_identity(self) -> None:
        first_evidence = _evidence()
        second_evidence = copy.deepcopy(first_evidence)
        second_evidence["skus"]["sku-exact"]["display_name"] = "Nieuwe UI-naam"

        first = yearset_blocker_lineage_service.build_lineage_review(
            plan=_plan(), worklist=_worklist(), evidence=first_evidence
        )
        second = yearset_blocker_lineage_service.build_lineage_review(
            plan=_plan(), worklist=_worklist(), evidence=second_evidence
        )
        self.assertEqual(
            first["lineage_review_hash"], second["lineage_review_hash"]
        )

        forbidden = {
            "primary",
            "packaging",
            "overhead",
            "excise",
            "cost",
            "primary_cost",
            "packaging_cost",
            "overhead_cost",
            "excise_cost",
            "cost_price",
            "list_price",
            "sell_in",
            "frozen_plan",
            "initial_forecast",
        }

        def assert_amount_free(value: object) -> None:
            if isinstance(value, dict):
                self.assertTrue(forbidden.isdisjoint(value))
                for child in value.values():
                    assert_amount_free(child)
            elif isinstance(value, list):
                for child in value:
                    assert_amount_free(child)

        assert_amount_free(first)

    def test_review_uses_read_only_transaction_without_schema_initialization(
        self,
    ) -> None:
        connection = MagicMock()
        connection_manager = MagicMock()
        connection_manager.__enter__.return_value = connection
        connection.transaction.return_value.__enter__.return_value = connection
        plan = _plan()
        worklist = _worklist()

        with (
            patch.object(
                yearset_blocker_lineage_service.postgres_storage,
                "connect",
                return_value=connection_manager,
            ),
            patch.object(
                yearset_blocker_lineage_service.yearset_reconciliation_service,
                "read_reconciliation_snapshot",
                return_value={},
            ),
            patch.object(
                yearset_blocker_lineage_service.yearset_reconciliation_service,
                "build_reconciliation_plan",
                return_value=plan,
            ),
            patch.object(
                yearset_blocker_lineage_service.yearset_reconciliation_service,
                "build_blocker_worklist",
                side_effect=[worklist, worklist],
            ),
            patch.object(
                yearset_blocker_lineage_service,
                "read_lineage_evidence",
                return_value=_evidence(),
            ),
            patch.object(
                yearset_blocker_lineage_service.yearset_reconciliation_service,
                "ensure_dependencies",
            ) as ensure_dependencies,
        ):
            review = yearset_blocker_lineage_service.review_current_lineage(
                source_year=2025,
                target_year=2026,
            )

        ensure_dependencies.assert_not_called()
        connection.execute.assert_called_once_with(
            "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
        )
        self.assertFalse(review["data_rewritten"])


if __name__ == "__main__":
    unittest.main()
