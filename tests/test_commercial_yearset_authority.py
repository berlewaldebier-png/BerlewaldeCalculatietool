from __future__ import annotations

import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import commercial_yearset_service, commercial_yearset_storage  # noqa: E402
from app.api.routes import meta as meta_routes  # noqa: E402
from tests.postgres_disposable import (  # noqa: E402
    DisposablePostgresDatabase,
    integration_tests_enabled,
)


def _complete_plan_payload() -> dict:
    targets = {
        "revenue": 100,
        "variable_cost": 40,
        "contribution": 60,
        "liters": 10,
        "units": 20,
    }
    return {
        "targets": targets,
        "period_allocations": [{"period": "2099-01", **targets}],
        "sku_allocations": [{"sku_id": "synthetic-sku", **targets}],
    }


def _complete_snapshot() -> dict:
    plan = commercial_yearset_service.validate_plan_contract(
        source="new_year_preparation",
        payload=_complete_plan_payload(),
    )
    forecast = commercial_yearset_service.validate_initial_forecast(
        plan_contract_hash=plan["contract_hash"],
        forecasts=[
            {
                "id": "forecast-1",
                "basis": "frozen_plan",
                "payload": {
                    "source": "new_year_preparation",
                    **_complete_plan_payload(),
                },
            }
        ],
    )
    return {
        "operational_year": 2099,
        "source_year": 2098,
        "production_exists": True,
        "activation_count": 1,
        "distinct_activation_skus": 1,
        "unknown_activation_skus": 0,
        "missing_cost_rows": 0,
        "duplicate_cost_rows": 0,
        "non_positive_cost_rows": 0,
        "missing_beer_format_or_liters": 0,
        "source_activation_count": 1,
        "missing_source_skus": 0,
        "membership_hash": "sha256:membership",
        "pricing_scope_hash": "sha256:pricing",
        "channel_policy_hash": "sha256:channels",
        "advice_scope_hash": "sha256:advice",
        "pricing_count": 1,
        "active_channel_count": 1,
        "missing_advice_channel_count": 0,
        "plan_count": 1,
        "plan_id": "plan-1",
        "plan_contract": plan,
        "forecast_contract": forecast,
        "year_close_snapshot_id": "close-2098",
    }


class CommercialYearsetReadinessTests(unittest.TestCase):
    def test_complete_contract_is_ready_and_hash_is_deterministic(self) -> None:
        first = commercial_yearset_service.evaluate_readiness(_complete_snapshot())
        second = commercial_yearset_service.evaluate_readiness(_complete_snapshot())

        self.assertTrue(first["ready"])
        self.assertEqual(first["blockers"], [])
        self.assertEqual(first["validation_hash"], second["validation_hash"])
        self.assertRegex(first["validation_hash"], r"^sha256:[0-9a-f]{64}$")

    def test_missing_cost_rows_and_plan_allocations_block_activation(self) -> None:
        snapshot = _complete_snapshot()
        snapshot["missing_cost_rows"] = 35
        snapshot["plan_contract"] = commercial_yearset_service.validate_plan_contract(
            source="new_year_preparation",
            payload={
                "targets": {
                    "revenue": 100,
                    "variable_cost": 40,
                    "contribution": 60,
                    "liters": 10,
                    "units": 20,
                }
            },
        )
        report = commercial_yearset_service.evaluate_readiness(snapshot)

        self.assertFalse(report["ready"])
        self.assertIn("canonical_cost_row_missing", report["blockers"])
        self.assertIn("plan_period_allocation_missing", report["blockers"])
        self.assertIn("plan_sku_allocation_missing", report["blockers"])

    def test_initial_forecast_must_be_an_exact_frozen_plan_copy(self) -> None:
        plan = commercial_yearset_service.validate_plan_contract(
            source="new_year_preparation",
            payload=_complete_plan_payload(),
        )
        changed = _complete_plan_payload()
        changed["targets"]["revenue"] = 101
        forecast = commercial_yearset_service.validate_initial_forecast(
            plan_contract_hash=plan["contract_hash"],
            forecasts=[
                {
                    "id": "forecast-changed",
                    "basis": "frozen_plan",
                    "payload": {"source": "new_year_preparation", **changed},
                }
            ],
        )

        self.assertFalse(forecast["ready"])
        self.assertIn("initial_forecast_plan_mismatch", forecast["blockers"])

    def test_source_membership_and_explicit_source_year_are_mandatory(self) -> None:
        snapshot = _complete_snapshot()
        snapshot["source_year"] = 0
        snapshot["source_activation_count"] = 0
        snapshot["year_close_snapshot_id"] = ""
        snapshot["missing_source_skus"] = 2
        report = commercial_yearset_service.evaluate_readiness(snapshot)

        self.assertIn("source_year_missing", report["blockers"])
        self.assertIn("source_year_close_missing", report["blockers"])
        self.assertIn("source_sku_membership_missing", report["blockers"])

    def test_active_channel_policy_is_required(self) -> None:
        snapshot = _complete_snapshot()
        snapshot["active_channel_count"] = 0
        report = commercial_yearset_service.evaluate_readiness(snapshot)

        self.assertIn("active_channel_policy_missing", report["blockers"])

    def test_allocation_order_does_not_change_frozen_contract(self) -> None:
        payload = _complete_plan_payload()
        payload["period_allocations"] = [
            {
                "period": "2099-01",
                "revenue": 40,
                "variable_cost": 16,
                "contribution": 24,
                "liters": 4,
                "units": 8,
            },
            {
                "period": "2099-02",
                "revenue": 60,
                "variable_cost": 24,
                "contribution": 36,
                "liters": 6,
                "units": 12,
            },
        ]
        first = commercial_yearset_service.validate_plan_contract(
            source="new_year_preparation",
            payload=payload,
        )
        payload["period_allocations"].reverse()
        second = commercial_yearset_service.validate_plan_contract(
            source="new_year_preparation",
            payload=payload,
        )

        self.assertEqual(first["contract_hash"], second["contract_hash"])


class CommercialYearsetLegacyRollbackTests(unittest.TestCase):
    def test_active_authority_blocks_both_destructive_legacy_rollbacks(self) -> None:
        with patch(
            "app.api.routes.meta.commercial_yearset_storage.get_active_generation",
            return_value={"id": "active-generation"},
        ), patch(
            "app.api.routes.meta.dataset_store.rollback_yearset"
        ) as rollback_yearset, patch(
            "app.api.routes.meta.dataset_store.rollback_year"
        ) as rollback_year:
            with self.assertRaises(HTTPException) as yearset_error:
                meta_routes.post_rollback_yearset(
                    year=2099,
                    dry_run=False,
                    _={"role": "administrator"},
                )
            with self.assertRaises(HTTPException) as year_error:
                meta_routes.post_rollback_year(
                    year=2099,
                    dry_run=False,
                    _={"role": "administrator"},
                )

        self.assertEqual(yearset_error.exception.status_code, 409)
        self.assertEqual(year_error.exception.status_code, 409)
        rollback_yearset.assert_not_called()
        rollback_year.assert_not_called()


@unittest.skipUnless(
    integration_tests_enabled(),
    "requires explicit loopback disposable PostgreSQL opt-in",
)
class CommercialYearsetPostgresTests(unittest.TestCase):
    @staticmethod
    def _candidate(
        *,
        year: int,
        key: str,
        validation_hash: str,
        ready: bool = True,
    ) -> dict:
        return commercial_yearset_storage.create_candidate(
            operational_year=year,
            source_year=year - 1,
            validation={
                "version": "rf-013a-test",
                "ready": ready,
                "blockers": [] if ready else ["synthetic_blocker"],
            },
            validation_hash=validation_hash,
            actor="rf013a-test",
            idempotency_key=key,
        )

    def test_candidate_creation_is_idempotent_and_additive(self) -> None:
        with DisposablePostgresDatabase() as database:
            first = self._candidate(
                year=2099,
                key="rf013a-idempotent",
                validation_hash="sha256:idempotent",
            )
            second = self._candidate(
                year=2099,
                key="rf013a-idempotent",
                validation_hash="sha256:idempotent",
            )
            with database.connect() as conn:
                count = int(
                    conn.execute(
                        "SELECT COUNT(*)::int FROM commercial_yearsets"
                    ).fetchone()[0]
                )

            self.assertTrue(first["created"])
            self.assertFalse(second["created"])
            self.assertEqual(first["id"], second["id"])
            self.assertEqual(count, 1)

    def test_blocked_candidate_cannot_replace_current_authority(self) -> None:
        with DisposablePostgresDatabase():
            ready = self._candidate(
                year=2098,
                key="rf013a-ready",
                validation_hash="sha256:ready",
            )
            commercial_yearset_storage.activate_generation(
                generation_id=ready["id"],
                actor="rf013a-test",
                expected_validation_hash="sha256:ready",
                expected_active_generation_id="",
            )
            blocked = self._candidate(
                year=2099,
                key="rf013a-blocked",
                validation_hash="sha256:blocked",
                ready=False,
            )

            with self.assertRaises(
                commercial_yearset_storage.CommercialYearsetBlocked
            ):
                commercial_yearset_storage.activate_generation(
                    generation_id=blocked["id"],
                    actor="rf013a-test",
                    expected_validation_hash="sha256:blocked",
                    expected_active_generation_id=ready["id"],
                )

            self.assertEqual(
                commercial_yearset_storage.get_active_generation()["id"],
                ready["id"],
            )

    def test_activation_and_rollback_only_move_the_pointer(self) -> None:
        with DisposablePostgresDatabase() as database:
            first = self._candidate(
                year=2098,
                key="rf013a-first",
                validation_hash="sha256:first",
            )
            second = self._candidate(
                year=2099,
                key="rf013a-second",
                validation_hash="sha256:second",
            )
            commercial_yearset_storage.activate_generation(
                generation_id=first["id"],
                actor="rf013a-test",
                expected_validation_hash="sha256:first",
                expected_active_generation_id="",
            )
            commercial_yearset_storage.activate_generation(
                generation_id=second["id"],
                actor="rf013a-test",
                expected_validation_hash="sha256:second",
                expected_active_generation_id=first["id"],
            )
            rolled_back = commercial_yearset_storage.activate_generation(
                generation_id=first["id"],
                actor="rf013a-test",
                expected_validation_hash="sha256:first",
                expected_active_generation_id=second["id"],
                action="rollback",
                reason="synthetic rollback",
            )
            with database.connect() as conn:
                generation_count = int(
                    conn.execute(
                        "SELECT COUNT(*)::int FROM commercial_yearsets"
                    ).fetchone()[0]
                )
                active_count = int(
                    conn.execute(
                        """
                        SELECT COUNT(*)::int
                        FROM commercial_yearsets
                        WHERE status = 'active'
                        """
                    ).fetchone()[0]
                )

            self.assertEqual(rolled_back["id"], first["id"])
            self.assertEqual(generation_count, 2)
            self.assertEqual(active_count, 1)
            events = commercial_yearset_storage.list_events()
            self.assertEqual(
                [row["event_type"] for row in events],
                [
                    "candidate_created",
                    "candidate_created",
                    "activated",
                    "superseded",
                    "activated",
                    "superseded",
                    "rollback_activated",
                ],
            )
            self.assertEqual(
                [row["sequence"] for row in events],
                sorted(row["sequence"] for row in events),
            )
            self.assertTrue(all(row["occurred_at"] for row in events))
            self.assertTrue(all(row["actor"] == "rf013a-test" for row in events))

    def test_fallback_is_explicit_until_an_authority_is_active(self) -> None:
        with DisposablePostgresDatabase():
            legacy = commercial_yearset_service.authority_overview(
                fallback_year=2099
            )
            candidate = self._candidate(
                year=2099,
                key="rf013a-authority-context",
                validation_hash="sha256:authority-context",
            )
            commercial_yearset_storage.activate_generation(
                generation_id=candidate["id"],
                actor="rf013a-test",
                expected_validation_hash="sha256:authority-context",
                expected_active_generation_id="",
            )
            authoritative = commercial_yearset_service.authority_overview(
                fallback_year=2098
            )

            self.assertEqual(
                legacy["context"]["authority"],
                "legacy_explicit_fallback",
            )
            self.assertTrue(legacy["context"]["fallback_used"])
            self.assertIn(
                "active_commercial_yearset_missing",
                [warning["code"] for warning in legacy["context"]["warnings"]],
            )
            self.assertEqual(
                authoritative["context"]["authority"],
                "commercial_yearset",
            )
            self.assertEqual(authoritative["context"]["operational_year"], 2099)
            self.assertFalse(authoritative["context"]["fallback_used"])

    def test_concurrent_compare_and_swap_allows_only_one_winner(self) -> None:
        with DisposablePostgresDatabase():
            current = self._candidate(
                year=2097,
                key="rf013a-current",
                validation_hash="sha256:current",
            )
            commercial_yearset_storage.activate_generation(
                generation_id=current["id"],
                actor="rf013a-test",
                expected_validation_hash="sha256:current",
                expected_active_generation_id="",
            )
            left = self._candidate(
                year=2098,
                key="rf013a-left",
                validation_hash="sha256:left",
            )
            right = self._candidate(
                year=2099,
                key="rf013a-right",
                validation_hash="sha256:right",
            )

            def activate(candidate: dict, validation_hash: str) -> str:
                try:
                    commercial_yearset_storage.activate_generation(
                        generation_id=candidate["id"],
                        actor="rf013a-test",
                        expected_validation_hash=validation_hash,
                        expected_active_generation_id=current["id"],
                    )
                    return "activated"
                except commercial_yearset_storage.CommercialYearsetConflict:
                    return "conflict"

            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = [
                    executor.submit(activate, left, "sha256:left"),
                    executor.submit(activate, right, "sha256:right"),
                ]
                results = sorted(future.result(timeout=20) for future in futures)

            self.assertEqual(results, ["activated", "conflict"])
            self.assertEqual(
                commercial_yearset_storage.audit_authority()["active_count"],
                1,
            )


if __name__ == "__main__":
    unittest.main()
