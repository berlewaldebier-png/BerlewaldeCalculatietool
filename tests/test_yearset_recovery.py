from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import (  # noqa: E402
    yearset_reconciliation_service,
    yearset_recovery_projection,
    yearset_recovery_service,
    yearset_recovery_storage,
)
from tests.postgres_disposable import (  # noqa: E402
    DisposablePostgresDatabase,
    integration_tests_enabled,
)


def _engine_row(sku_id: str, version_id: str, cost: str) -> dict:
    primary = str(int(cost) - 3)
    return {
        "sku_id": sku_id,
        "source_version_id": version_id,
        "source_cost": cost,
        "source_primary": primary,
        "source_packaging": "1",
        "source_overhead": "1",
        "source_excise": "1",
        "scenario_primary": primary,
        "target_packaging": "1",
        "target_overhead": "1",
        "target_excise": "1",
        "target_cost": cost,
        "engine_version": "synthetic-engine",
        "source_year": 2025,
        "target_year": 2026,
    }


def _snapshot() -> dict:
    skus = [
        {
            "id": "sku-source",
            "kind": "composite",
            "beer_id": "beer-1",
            "format_article_id": "format-case",
            "active": True,
            "content_liter": "7.92",
        },
        {
            "id": "sku-exact",
            "kind": "base",
            "beer_id": "beer-2",
            "format_article_id": "format-bottle",
            "active": True,
            "content_liter": "0.33",
        },
        {
            "id": "sku-historical",
            "kind": "composite",
            "beer_id": "beer-3",
            "format_article_id": "format-75cl-case",
            "active": True,
            "content_liter": "4.50",
        },
        {
            "id": "sku-biervilt",
            "kind": "article",
            "article_id": "article-biervilt",
            "active": True,
            "content_liter": "0",
        },
    ]
    subjects = [
        {
            "sku_id": row["id"],
            "subject_type": "beer" if row.get("beer_id") else "article",
            "subject_id": row.get("beer_id") or row.get("article_id"),
            "beer_id": row.get("beer_id", ""),
            "format_article_id": row.get("format_article_id")
            or row.get("article_id"),
        }
        for row in skus
    ]
    anchors = [
        {
            "anchor_id": f"anchor-{sku_id}",
            "sku_id": sku_id,
            "cost_version_id": f"version-{sku_id}",
            "cost_row_id": f"row-{sku_id}",
            "primary": primary,
            "packaging": "1",
            "overhead": "1",
            "excise": "1",
            "cost_price": cost,
        }
        for sku_id, primary, cost in (
            ("sku-source", "17", "20"),
            ("sku-biervilt", "1", "4"),
        )
    ]
    close_payload = {
        "dashboard": {
            "actual": {
                "revenue": "100",
                "variable_cost": "40",
                "contribution": "60",
            }
        },
        "inventory": {
            "totals": {"sold_liters": "10"},
            "rows": [{"sku_id": "sku-source", "sold_liters": "10"}],
        },
        "actuals": {
            "rows": [
                {
                    "sku_id": "sku-source",
                    "net_revenue_ex": "100",
                    "variabel_accijns_ex": "40",
                    "units": "25",
                }
            ],
            "variable_cost_rows": [
                {
                    "sku_id": "sku-source",
                    "document_date": "2025-01-15",
                    "net_revenue_ex": "40",
                    "variabel_accijns_ex": "16",
                    "quantity": "10",
                },
                {
                    "sku_id": "sku-source",
                    "document_date": "2025-02-15",
                    "net_revenue_ex": "60",
                    "variabel_accijns_ex": "24",
                    "quantity": "15",
                },
            ],
        },
    }
    return {
        "source_year": 2025,
        "target_year": 2026,
        "skus": skus,
        "subjects": subjects,
        "source_anchors": anchors,
        "target_activation_sku_ids": ["sku-exact"],
        "target_authorities": [
            {
                "sku_id": "sku-exact",
                "anchor_id": "anchor-exact-2026",
                "activation_id": "activation-exact-2026",
                "cost_version_id": "version-exact-2026",
                "cost_row_id": "row-exact-2026",
                "primary": "2",
                "packaging": "1",
                "overhead": "1",
                "excise": "1",
                "cost_price": "5",
                "authority_hash": "sha256:exact-authority",
            }
        ],
        "source_prices": [],
        "target_prices": [
            {
                "id": f"price-{sku_id}",
                "sku_id": sku_id,
                "payload": {"sell_in_prices": {"list": price}},
            }
            for sku_id, price in (
                ("sku-source", "30"),
                ("sku-exact", "8"),
                ("sku-historical", "12"),
                ("sku-biervilt", "0"),
            )
        ],
        "engine_batches": [
            {
                "source_year": 2025,
                "target_year": 2026,
                "rows": [
                    _engine_row("sku-source", "version-sku-source", "20"),
                    _engine_row("sku-biervilt", "version-sku-biervilt", "4"),
                ],
            }
        ],
        "channels": [{"code": "horeca", "active": True}],
        "advice_rows": [{"channel_code": "horeca", "opslag_pct": "190"}],
        "plan_rows": [
            {
                "id": "incomplete-plan-2026",
                "source": "new_year_preparation",
                "payload": {"targets": {}},
            }
        ],
        "bom_lines": [],
        "mappings": [],
        "source_year_close_ids": ["close-2025"],
        "source_year_closes": [
            {"id": "close-2025", "payload": close_payload}
        ],
        "target_production": {"normal_sales_l": "22"},
    }


def _lineage(base_plan: dict) -> dict:
    return {
        "lineage_review_hash": "sha256:lineage-review",
        "cost_items": [
            {
                "sku_id": "sku-exact",
                "classification": "reproducible_from_exact_target_anchor",
                "automatic_reproduction_eligible": True,
            },
            {
                "sku_id": "sku-historical",
                "classification": "human_scope_and_cost_decision_required",
                "automatic_reproduction_eligible": False,
            },
        ],
        "sell_in_items": [
            {
                "sku_id": "sku-historical",
                "classification": "dependent_on_cost_lineage_decision",
            },
            {
                "sku_id": "sku-biervilt",
                "classification": "human_pricing_policy_required",
            },
        ],
        "plan": {"classification": "human_plan_input_required"},
        "manifest_hash": base_plan["manifest_hash"],
    }


def _request() -> dict:
    return {
        "source_year": 2025,
        "target_year": 2026,
        "expected_lineage_review_hash": "sha256:lineage-review",
        "exact_target_anchor_sku_ids": ["sku-exact"],
        "scope_decisions": [
            {
                "sku_id": "sku-historical",
                "decision": "historical_only_for_target_year",
                "reason": "Niet gepland voor 2026; historische SKU blijft behouden.",
            }
        ],
        "pricing_decisions": [
            {
                "sku_id": "sku-biervilt",
                "sell_in_ex_vat": "0.01",
                "currency": "EUR",
                "vat_basis": "exclusive",
                "reason": "Door Management goedgekeurde minimale sell-inprijs.",
            }
        ],
        "approved_plan_revenue_ex_vat": "220",
        "allocation_policy": (
            "closed_source_actual_mix_scaled_to_approved_revenue"
        ),
        "reason": "Goedgekeurde reconstructie van jaarset 2026.",
    }


class YearsetRecoveryProjectionTests(unittest.TestCase):
    def test_approved_projection_is_ready_balanced_and_keeps_legacy_input_untouched(
        self,
    ) -> None:
        snapshot = _snapshot()
        original = copy.deepcopy(snapshot)
        base = yearset_reconciliation_service.build_reconciliation_plan(snapshot)
        decision = yearset_recovery_projection.build_recovery_decision(
            snapshot=snapshot,
            base_plan=base,
            lineage_review=_lineage(base),
            request=_request(),
        )

        candidate = yearset_reconciliation_service.build_reconciliation_plan(
            {**snapshot, "approved_recovery_input": decision}
        )

        self.assertTrue(candidate["ready"], candidate["blocker_counts"])
        self.assertEqual(snapshot, original)
        self.assertEqual(
            {row["sku_id"] for row in candidate["sku_entries"]},
            {"sku-source", "sku-exact", "sku-biervilt"},
        )
        exact = next(
            row for row in candidate["sku_entries"] if row["sku_id"] == "sku-exact"
        )
        self.assertEqual(exact["source_anchor_id"], "anchor-exact-2026")
        self.assertEqual(
            exact["provenance_kind"], "recovered_from_exact_target_anchor"
        )
        biervilt = next(
            row
            for row in candidate["price_entries"]
            if row["sku_id"] == "sku-biervilt"
        )
        self.assertEqual(str(biervilt["list_price"]), "0.010000")
        targets = candidate["plan_entry"]["frozen_plan"]["payload"]["targets"]
        self.assertEqual(targets["revenue"], "220.000000")
        self.assertEqual(targets["variable_cost"], "88.000000")
        self.assertEqual(targets["contribution"], "132.000000")
        self.assertEqual(
            candidate["plan_entry"]["initial_forecast"]["forecast"],
            candidate["plan_entry"]["frozen_plan"]["payload"],
        )
        self.assertTrue(
            candidate["recovery_metadata"]["legacy_target_untouched"]
        )

    def test_exact_decision_sets_must_match_the_current_lineage(self) -> None:
        snapshot = _snapshot()
        base = yearset_reconciliation_service.build_reconciliation_plan(snapshot)
        request = _request()
        request["exact_target_anchor_sku_ids"] = []

        with self.assertRaisesRegex(
            yearset_recovery_projection.YearsetRecoveryValidationError,
            "target-anchors",
        ):
            yearset_recovery_projection.build_recovery_decision(
                snapshot=snapshot,
                base_plan=base,
                lineage_review=_lineage(base),
                request=request,
            )

    def test_changed_exact_authority_blocks_instead_of_silently_recalculating(
        self,
    ) -> None:
        snapshot = _snapshot()
        base = yearset_reconciliation_service.build_reconciliation_plan(snapshot)
        decision = yearset_recovery_projection.build_recovery_decision(
            snapshot=snapshot,
            base_plan=base,
            lineage_review=_lineage(base),
            request=_request(),
        )
        changed = copy.deepcopy(snapshot)
        changed["target_authorities"][0]["cost_row_id"] = "different-row"

        candidate = yearset_reconciliation_service.build_reconciliation_plan(
            {**changed, "approved_recovery_input": decision}
        )

        self.assertFalse(candidate["ready"])
        self.assertIn(
            "approved_exact_target_authority_changed",
            candidate["blocker_counts"],
        )

    def test_duplicate_exact_authority_blocks_after_approval(self) -> None:
        snapshot = _snapshot()
        base = yearset_reconciliation_service.build_reconciliation_plan(snapshot)
        decision = yearset_recovery_projection.build_recovery_decision(
            snapshot=snapshot,
            base_plan=base,
            lineage_review=_lineage(base),
            request=_request(),
        )
        changed = copy.deepcopy(snapshot)
        duplicate = copy.deepcopy(changed["target_authorities"][0])
        duplicate["anchor_id"] = "second-anchor"
        changed["target_authorities"].append(duplicate)

        candidate = yearset_reconciliation_service.build_reconciliation_plan(
            {**changed, "approved_recovery_input": decision}
        )

        self.assertFalse(candidate["ready"])
        self.assertIn(
            "approved_exact_target_authority_changed",
            candidate["blocker_counts"],
        )

    def test_only_management_may_approve_the_recovery_input(self) -> None:
        with self.assertRaisesRegex(PermissionError, "Management"):
            yearset_recovery_service.approve(
                _request(),
                actor="admin-user",
                actor_role="admin",
            )


@unittest.skipUnless(
    integration_tests_enabled(),
    "requires explicit loopback disposable PostgreSQL opt-in",
)
class YearsetRecoveryPostgresTests(unittest.TestCase):
    def test_approved_inputs_are_additive_and_previous_decisions_are_retained(
        self,
    ) -> None:
        with DisposablePostgresDatabase() as database:
            yearset_recovery_storage.ensure_schema()
            first = yearset_recovery_storage.approve_input(
                input_id="recovery-1",
                source_year=2025,
                target_year=2026,
                lineage_review_hash="sha256:lineage-1",
                base_manifest_hash="sha256:manifest-1",
                decision_hash="sha256:decision-1",
                payload={"approved_plan_revenue_ex_vat": "220000"},
                actor="management-user",
                actor_role="management",
                reason="first reviewed recovery",
            )
            second = yearset_recovery_storage.approve_input(
                input_id="recovery-2",
                source_year=2025,
                target_year=2026,
                lineage_review_hash="sha256:lineage-2",
                base_manifest_hash="sha256:manifest-2",
                decision_hash="sha256:decision-2",
                payload={"approved_plan_revenue_ex_vat": "220000"},
                actor="management-user",
                actor_role="management",
                reason="replacement after a new exact preview",
            )

            self.assertTrue(first["created"])
            self.assertTrue(second["created"])
            rows = yearset_recovery_storage.list_inputs(target_year=2026)
            self.assertEqual(len(rows), 2)
            self.assertEqual(
                {row["status"] for row in rows}, {"approved", "superseded"}
            )
            superseded = next(
                row for row in rows if row["status"] == "superseded"
            )
            self.assertEqual(superseded["superseded_by"], "recovery-2")
            self.assertEqual(
                yearset_recovery_storage.get_approved_input(
                    source_year=2025,
                    target_year=2026,
                )["id"],
                "recovery-2",
            )
            with database.connect() as connection:
                self.assertEqual(
                    int(
                        connection.execute(
                            """
                            SELECT COUNT(*)::int
                            FROM commercial_yearset_recovery_inputs
                            """
                        ).fetchone()[0]
                    ),
                    2,
                )


if __name__ == "__main__":
    unittest.main()
