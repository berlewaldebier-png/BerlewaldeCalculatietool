from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import (  # noqa: E402
    commercial_yearset_storage,
    postgres_storage,
    yearset_reconciliation_service,
    yearset_reconciliation_storage,
)
from tests.postgres_disposable import (  # noqa: E402
    DisposablePostgresDatabase,
    integration_tests_enabled,
)


def _plan_payload() -> dict:
    targets = {
        "revenue": 1000,
        "variable_cost": 400,
        "contribution": 600,
        "liters": 330,
        "units": 1000,
    }
    return {
        "targets": targets,
        "period_allocations": [{"period": "2026-01", **targets}],
        "sku_allocations": [{"sku_id": "sku-source", **targets}],
    }


def _engine_row(
    sku_id: str,
    *,
    source_version_id: str = "",
    target_primary: str = "10",
    label: str = "",
) -> dict:
    return {
        "sku_id": sku_id,
        "source_version_id": source_version_id,
        "source_cost": "20",
        "source_primary": "9",
        "source_packaging": "1",
        "source_overhead": "6",
        "source_excise": "4",
        "scenario_primary": target_primary,
        "target_packaging": "1",
        "target_overhead": "6",
        "target_excise": "4",
        "target_cost": str(int(target_primary) + 11),
        "engine_version": "synthetic-engine-v1",
        "source_year": 2025,
        "target_year": 2026,
        "display_label": label,
    }


def _snapshot() -> dict:
    return {
        "source_year": 2025,
        "target_year": 2026,
        "skus": [
            {
                "id": "sku-source",
                "kind": "composite",
                "beer_id": "beer-1",
                "format_article_id": "article-case",
                "active": True,
                "content_liter": "7.92",
            },
            {
                "id": "sku-new",
                "kind": "base",
                "beer_id": "beer-1",
                "format_article_id": "article-bottle",
                "active": True,
                "content_liter": "0.33",
            },
            {
                "id": "sku-reference",
                "kind": "article",
                "article_id": "article-reference",
                "active": True,
                "content_liter": "0",
            },
        ],
        "subjects": [
            {
                "sku_id": "sku-source",
                "subject_type": "beer",
                "subject_id": "beer-1",
                "beer_id": "beer-1",
                "format_article_id": "article-case",
            },
            {
                "sku_id": "sku-new",
                "subject_type": "beer",
                "subject_id": "beer-1",
                "beer_id": "beer-1",
                "format_article_id": "article-bottle",
            },
            {
                "sku_id": "sku-reference",
                "subject_type": "article",
                "subject_id": "article-reference",
                "format_article_id": "article-reference",
            },
        ],
        "source_anchors": [
            {
                "anchor_id": "anchor-source",
                "sku_id": "sku-source",
                "cost_version_id": "version-source",
                "cost_row_id": "cost-row-source",
                "primary": "9",
                "packaging": "1",
                "overhead": "6",
                "excise": "4",
                "cost_price": "20",
            }
        ],
        "target_activation_sku_ids": ["sku-new"],
        "source_prices": [
            {
                "id": "source-price",
                "sku_id": "sku-source",
                "payload": {"sell_in_prices": {"list": "35"}},
            }
        ],
        "target_prices": [
            {
                "id": "target-price-source",
                "sku_id": "sku-source",
                "payload": {"sell_in_prices": {"list": "38"}},
            },
            {
                "id": "target-price-new",
                "sku_id": "sku-new",
                "payload": {"sell_in_prices": {"list": "4"}},
            },
        ],
        "engine_batches": [
            {
                "source_year": 2025,
                "target_year": 2026,
                "rows": [
                    _engine_row(
                        "sku-source",
                        source_version_id="version-source",
                        label="Berlewalde Blond - Doos 24 x 33cl",
                    ),
                    _engine_row("sku-new", target_primary="1"),
                ],
            }
        ],
        "channels": [{"code": "HORECA", "active": True}],
        "advice_rows": [{"channel_code": "horeca", "opslag_pct": "190"}],
        "plan_rows": [
            {
                "id": "plan-2026",
                "source": "new_year_preparation",
                "payload": _plan_payload(),
            }
        ],
        "bom_lines": [],
        "mappings": [],
        "source_year_close_id": "close-2025",
    }


class YearsetReconciliationPlanTests(unittest.TestCase):
    def test_complete_manifest_is_ready_and_preserves_one_row_per_stable_sku(self) -> None:
        plan = yearset_reconciliation_service.build_reconciliation_plan(_snapshot())

        self.assertTrue(plan["ready"])
        self.assertEqual(plan["blocker_counts"], {})
        self.assertEqual(plan["summary"]["sku_count"], 3)
        self.assertEqual(plan["summary"]["required_cost_count"], 2)
        self.assertEqual(plan["summary"]["ready_cost_count"], 2)
        self.assertEqual(plan["summary"]["not_required_cost_count"], 1)
        self.assertEqual(
            {row["sku_id"] for row in plan["sku_entries"]},
            {"sku-source", "sku-new", "sku-reference"},
        )

    def test_initial_forecast_is_an_exact_detached_copy_of_the_frozen_plan(self) -> None:
        plan = yearset_reconciliation_service.build_reconciliation_plan(_snapshot())
        entry = plan["plan_entry"]

        self.assertEqual(
            entry["initial_forecast"]["forecast"],
            entry["frozen_plan"]["payload"],
        )
        entry["initial_forecast"]["forecast"]["targets"]["revenue"] = 999
        self.assertEqual(entry["frozen_plan"]["payload"]["targets"]["revenue"], 1000)

    def test_identical_ui_fanout_rows_collapse_without_using_labels_as_identity(self) -> None:
        snapshot = _snapshot()
        rows = snapshot["engine_batches"][0]["rows"]
        rows.append(
            _engine_row(
                "sku-source",
                source_version_id="version-source",
                label="An intentionally different presentation label",
            )
        )

        plan = yearset_reconciliation_service.build_reconciliation_plan(snapshot)

        self.assertTrue(plan["ready"])
        self.assertEqual(plan["summary"]["ui_engine_rows"], 3)
        self.assertEqual(plan["summary"]["canonical_engine_skus"], 2)
        self.assertEqual(
            len([row for row in plan["sku_entries"] if row["sku_id"] == "sku-source"]),
            1,
        )

    def test_conflicting_financial_rows_for_one_sku_block_the_candidate(self) -> None:
        snapshot = _snapshot()
        snapshot["engine_batches"][0]["rows"].append(
            _engine_row(
                "sku-source",
                source_version_id="version-source",
                target_primary="11",
            )
        )

        plan = yearset_reconciliation_service.build_reconciliation_plan(snapshot)

        self.assertFalse(plan["ready"])
        self.assertEqual(plan["blocker_counts"]["target_engine_duplicate_conflict"], 1)
        source = next(
            row for row in plan["sku_entries"] if row["sku_id"] == "sku-source"
        )
        self.assertIn("target_cost_input_missing", source["blocker_codes"])

    def test_required_cost_without_target_input_is_visible_and_blocks_activation(self) -> None:
        snapshot = _snapshot()
        snapshot["engine_batches"][0]["rows"] = [
            row
            for row in snapshot["engine_batches"][0]["rows"]
            if row["sku_id"] != "sku-new"
        ]

        plan = yearset_reconciliation_service.build_reconciliation_plan(snapshot)

        self.assertFalse(plan["ready"])
        self.assertEqual(plan["blocker_counts"]["target_cost_input_missing"], 1)
        missing = next(
            row for row in plan["sku_entries"] if row["sku_id"] == "sku-new"
        )
        self.assertEqual(missing["scope_classification"], "target_operational_addition")
        self.assertEqual(missing["readiness_status"], "blocked")

    def test_non_positive_sell_in_is_never_silently_accepted(self) -> None:
        snapshot = _snapshot()
        snapshot["target_prices"][0]["payload"]["sell_in_prices"]["list"] = "0"

        plan = yearset_reconciliation_service.build_reconciliation_plan(snapshot)

        self.assertFalse(plan["ready"])
        self.assertEqual(plan["blocker_counts"]["target_sell_in_non_positive"], 1)

    def test_catalog_reference_does_not_require_a_positive_cost(self) -> None:
        snapshot = _snapshot()
        snapshot["engine_batches"][0]["rows"].append(
            {
                **_engine_row("sku-reference", target_primary="0"),
                "target_packaging": "0",
                "target_overhead": "0",
                "target_excise": "0",
                "target_cost": "0",
            }
        )

        plan = yearset_reconciliation_service.build_reconciliation_plan(snapshot)

        self.assertTrue(plan["ready"])
        reference = next(
            row for row in plan["sku_entries"] if row["sku_id"] == "sku-reference"
        )
        self.assertFalse(reference["cost_required"])
        self.assertEqual(reference["readiness_status"], "not_required")

    def test_incomplete_plan_blocks_both_plan_and_initial_forecast(self) -> None:
        snapshot = _snapshot()
        snapshot["plan_rows"][0]["payload"] = {}

        plan = yearset_reconciliation_service.build_reconciliation_plan(snapshot)

        self.assertFalse(plan["ready"])
        self.assertIn("plan_revenue_missing", plan["blocker_counts"])
        self.assertIn("plan_period_allocation_missing", plan["blocker_counts"])
        self.assertEqual(plan["plan_entry"]["initial_forecast"], {})

    def test_multiple_closed_source_snapshots_block_deterministic_lineage(self) -> None:
        snapshot = _snapshot()
        snapshot["source_year_close_ids"] = ["close-2025-a", "close-2025-b"]
        snapshot["source_year_close_id"] = ""

        plan = yearset_reconciliation_service.build_reconciliation_plan(snapshot)

        self.assertFalse(plan["ready"])
        self.assertEqual(plan["blocker_counts"]["source_year_close_ambiguous"], 1)
        self.assertEqual(
            plan["validation"]["source_records"]["year_close_snapshot_id"],
            "",
        )

    def test_manifest_hash_is_stable_when_input_row_order_changes(self) -> None:
        first_snapshot = _snapshot()
        second_snapshot = copy.deepcopy(first_snapshot)
        for key in (
            "skus",
            "subjects",
            "source_prices",
            "target_prices",
            "channels",
            "advice_rows",
        ):
            second_snapshot[key].reverse()
        second_snapshot["engine_batches"][0]["rows"].reverse()

        first = yearset_reconciliation_service.build_reconciliation_plan(first_snapshot)
        second = yearset_reconciliation_service.build_reconciliation_plan(second_snapshot)

        self.assertEqual(first["manifest_hash"], second["manifest_hash"])
        self.assertEqual(first["validation_hash"], second["validation_hash"])


@unittest.skipUnless(
    integration_tests_enabled(),
    "requires explicit loopback disposable PostgreSQL opt-in",
)
class YearsetReconciliationPostgresTests(unittest.TestCase):
    def _ready_target_addition_snapshot(self) -> dict:
        snapshot = _snapshot()
        snapshot["source_anchors"] = []
        snapshot["target_activation_sku_ids"] = ["sku-source", "sku-new"]
        snapshot["subjects"] = [
            {
                "sku_id": row["id"],
                "subject_type": "article",
                "subject_id": row.get("article_id")
                or row.get("format_article_id")
                or row["id"],
                "format_article_id": row.get("format_article_id", ""),
            }
            for row in snapshot["skus"]
        ]
        return snapshot

    @staticmethod
    def _seed_skus(snapshot: dict) -> None:
        with postgres_storage.transaction() as conn:
            for row in snapshot["skus"]:
                conn.execute(
                    """
                    INSERT INTO skus(
                        id, kind, article_id, name, active, payload
                    )
                    VALUES (%s, %s, %s, %s, TRUE, '{}'::jsonb)
                    """,
                    (
                        row["id"],
                        row["kind"],
                        row.get("article_id")
                        or row.get("format_article_id")
                        or row["id"],
                        row["id"],
                    ),
                )

    def test_ready_candidate_requires_management_then_admin_and_moves_one_pointer(
        self,
    ) -> None:
        with DisposablePostgresDatabase() as database:
            yearset_reconciliation_service.ensure_dependencies()
            snapshot = self._ready_target_addition_snapshot()
            self._seed_skus(snapshot)

            with patch(
                "app.domain.yearset_reconciliation_service._lock_snapshot"
            ), patch(
                "app.domain.yearset_reconciliation_service.read_reconciliation_snapshot",
                return_value=snapshot,
            ):
                dry_run = yearset_reconciliation_service.reconcile(
                    source_year=2025,
                    target_year=2026,
                    actor="admin-user",
                    dry_run=True,
                )
                created = yearset_reconciliation_service.reconcile(
                    source_year=2025,
                    target_year=2026,
                    actor="admin-user",
                    dry_run=False,
                    expected_manifest_hash=dry_run["manifest_hash"],
                )
                with self.assertRaises(PermissionError):
                    yearset_reconciliation_service.approve(
                        created["run"]["id"],
                        expected_manifest_hash=dry_run["manifest_hash"],
                        actor="admin-user",
                        actor_role="admin",
                        reason="wrong separation",
                    )
                approved = yearset_reconciliation_service.approve(
                    created["run"]["id"],
                    expected_manifest_hash=dry_run["manifest_hash"],
                    actor="management-user",
                    actor_role="management",
                    reason="reviewed exact manifest",
                )
                with self.assertRaises(PermissionError):
                    yearset_reconciliation_service.activate(
                        created["run"]["id"],
                        expected_manifest_hash=dry_run["manifest_hash"],
                        expected_active_generation_id="",
                        actor="management-user",
                        actor_role="management",
                        reason="wrong separation",
                    )
                activated = yearset_reconciliation_service.activate(
                    created["run"]["id"],
                    expected_manifest_hash=dry_run["manifest_hash"],
                    expected_active_generation_id="",
                    actor="admin-user",
                    actor_role="admin",
                    reason="approved candidate",
                )

            self.assertTrue(dry_run["ready"])
            self.assertEqual(approved["status"], "approved")
            self.assertEqual(activated["run"]["status"], "active")
            self.assertEqual(
                commercial_yearset_storage.get_active_generation()["id"],
                created["generation"]["id"],
            )
            with database.connect() as conn:
                self.assertEqual(
                    int(
                        conn.execute(
                            """
                            SELECT COUNT(*)::int
                            FROM commercial_yearset_reconciliation_runs
                            """
                        ).fetchone()[0]
                    ),
                    1,
                )
                self.assertEqual(
                    int(
                        conn.execute(
                            """
                            SELECT COUNT(*)::int
                            FROM commercial_yearset_candidate_skus
                            """
                        ).fetchone()[0]
                    ),
                    3,
                )
            self.assertEqual(
                yearset_reconciliation_storage.get_run(created["run"]["id"])[
                    "activated_by"
                ],
                "admin-user",
            )

    def test_failed_candidate_stage_rolls_back_the_generation_and_run(self) -> None:
        with DisposablePostgresDatabase() as database:
            yearset_reconciliation_service.ensure_dependencies()
            snapshot = self._ready_target_addition_snapshot()
            self._seed_skus(snapshot)

            with patch(
                "app.domain.yearset_reconciliation_service._lock_snapshot"
            ), patch(
                "app.domain.yearset_reconciliation_service.read_reconciliation_snapshot",
                return_value=snapshot,
            ):
                dry_run = yearset_reconciliation_service.reconcile(
                    source_year=2025,
                    target_year=2026,
                    actor="admin-user",
                    dry_run=True,
                )
                with self.assertRaises(
                    yearset_reconciliation_storage.YearsetReconciliationConflict
                ):
                    yearset_reconciliation_service.reconcile(
                        source_year=2025,
                        target_year=2026,
                        actor="admin-user",
                        dry_run=False,
                        expected_manifest_hash="sha256:stale",
                    )
                with patch(
                    "app.domain.yearset_reconciliation_service."
                    "yearset_reconciliation_storage.create_candidate",
                    side_effect=RuntimeError("synthetic candidate-row failure"),
                ):
                    with self.assertRaisesRegex(
                        RuntimeError, "synthetic candidate-row failure"
                    ):
                        yearset_reconciliation_service.reconcile(
                            source_year=2025,
                            target_year=2026,
                            actor="admin-user",
                            dry_run=False,
                            expected_manifest_hash=dry_run["manifest_hash"],
                        )

            with database.connect() as conn:
                self.assertEqual(
                    int(
                        conn.execute(
                            "SELECT COUNT(*)::int FROM commercial_yearsets"
                        ).fetchone()[0]
                    ),
                    0,
                )
                self.assertEqual(
                    int(
                        conn.execute(
                            """
                            SELECT COUNT(*)::int
                            FROM commercial_yearset_reconciliation_runs
                            """
                        ).fetchone()[0]
                    ),
                    0,
                )

    def test_source_change_after_candidate_blocks_approval(self) -> None:
        with DisposablePostgresDatabase():
            yearset_reconciliation_service.ensure_dependencies()
            snapshot = self._ready_target_addition_snapshot()
            self._seed_skus(snapshot)

            with patch(
                "app.domain.yearset_reconciliation_service._lock_snapshot"
            ), patch(
                "app.domain.yearset_reconciliation_service.read_reconciliation_snapshot",
                return_value=snapshot,
            ):
                dry_run = yearset_reconciliation_service.reconcile(
                    source_year=2025,
                    target_year=2026,
                    actor="admin-user",
                    dry_run=True,
                )
                created = yearset_reconciliation_service.reconcile(
                    source_year=2025,
                    target_year=2026,
                    actor="admin-user",
                    dry_run=False,
                    expected_manifest_hash=dry_run["manifest_hash"],
                )

            changed = copy.deepcopy(snapshot)
            changed["bom_lines"] = [
                {
                    "parent_article_id": "article-case",
                    "component_sku_id": "sku-new",
                    "quantity": 24,
                }
            ]
            with patch(
                "app.domain.yearset_reconciliation_service._lock_snapshot"
            ), patch(
                "app.domain.yearset_reconciliation_service.read_reconciliation_snapshot",
                return_value=changed,
            ):
                with self.assertRaises(
                    yearset_reconciliation_storage.YearsetReconciliationConflict
                ):
                    yearset_reconciliation_service.approve(
                        created["run"]["id"],
                        expected_manifest_hash=dry_run["manifest_hash"],
                        actor="management-user",
                        actor_role="management",
                        reason="stale review",
                    )

            self.assertEqual(
                yearset_reconciliation_storage.get_run(created["run"]["id"])[
                    "status"
                ],
                "candidate",
            )
