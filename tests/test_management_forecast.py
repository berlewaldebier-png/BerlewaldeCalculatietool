from __future__ import annotations

import copy
from datetime import date
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import management_forecast_service, management_forecast_storage


def _workspace() -> dict:
    periods = []
    for month in range(1, 13):
        period = f"2026-{month:02d}"
        actual_revenue = 80.0 if month <= 6 else 20.0 if month == 7 else 0.0
        actual_variable = actual_revenue * 0.4
        forecast_revenue = actual_revenue if month <= 6 else 100.0
        periods.append(
            {
                "period": period,
                "closed": month <= 6,
                "current_partial": month == 7,
                "actual_revenue": actual_revenue,
                "actual_variable_cost": actual_variable,
                "actual_contribution": actual_revenue - actual_variable,
                "actual_liters": actual_revenue / 2,
                "actual_units": actual_revenue / 4,
                "forecast_revenue": forecast_revenue,
                "forecast_variable_cost": forecast_revenue * 0.4,
                "forecast_contribution": forecast_revenue * 0.6,
                "forecast_liters": forecast_revenue / 2,
                "forecast_units": forecast_revenue / 4,
            }
        )
    return {
        "status": "ready",
        "binding": {
            "generation_id": "generation-2026",
            "run_id": "run-2026",
            "plan_id": "plan-2026",
            "plan_contract_hash": "12345678-plan-hash",
            "operational_year": 2026,
        },
        "actual_as_of_date": "2026-07-15",
        "actual_cutoff_period": "2026-07",
        "current_revision": None,
        "periods": periods,
    }


def _request_rows(workspace: dict) -> list[dict]:
    return [
        {
            "period": row["period"],
            "revenue": row["forecast_revenue"],
            "variable_cost": row["forecast_variable_cost"],
            "contribution": row["forecast_contribution"],
            "liters": row["forecast_liters"],
            "units": row["forecast_units"],
        }
        for row in workspace["periods"]
    ]


class ManagementForecastValidationTests(unittest.TestCase):
    def test_exact_twelve_month_forecast_derives_annual_targets(self) -> None:
        workspace = _workspace()
        rows, totals = management_forecast_service._normalize_periods(
            _request_rows(workspace), workspace=workspace
        )

        self.assertEqual(len(rows), 12)
        self.assertEqual(totals["revenue"], 1080.0)
        self.assertEqual(totals["variable_cost"], 432.0)
        self.assertEqual(totals["contribution"], 648.0)

    def test_completed_month_cannot_diverge_from_actual(self) -> None:
        workspace = _workspace()
        rows = _request_rows(workspace)
        rows[0]["revenue"] += 1
        rows[0]["contribution"] += 1

        with self.assertRaisesRegex(
            management_forecast_service.ManagementForecastValidationError,
            "verstreken",
        ):
            management_forecast_service._normalize_periods(
                rows, workspace=workspace
            )

    def test_partial_month_cannot_be_lower_than_invoiced_actual(self) -> None:
        workspace = _workspace()
        rows = _request_rows(workspace)
        rows[6].update(
            revenue=10,
            variable_cost=4,
            contribution=6,
            liters=5,
            units=2.5,
        )

        with self.assertRaisesRegex(
            management_forecast_service.ManagementForecastValidationError,
            "reeds gefactureerde Actual",
        ):
            management_forecast_service._normalize_periods(
                rows, workspace=workspace
            )

    def test_contribution_is_an_enforced_identity(self) -> None:
        workspace = _workspace()
        rows = _request_rows(workspace)
        rows[8]["contribution"] = 999

        with self.assertRaisesRegex(
            management_forecast_service.ManagementForecastValidationError,
            "omzet minus variabele kosten",
        ):
            management_forecast_service._normalize_periods(
                rows, workspace=workspace
            )

    def test_negative_contribution_is_allowed_when_costs_exceed_revenue(self) -> None:
        workspace = _workspace()
        rows = _request_rows(workspace)
        rows[8].update(revenue=25, variable_cost=40, contribution=-15)

        normalized, totals = management_forecast_service._normalize_periods(
            rows, workspace=workspace
        )

        self.assertEqual(normalized[8]["contribution"], -15.0)
        self.assertEqual(
            totals["contribution"],
            totals["revenue"] - totals["variable_cost"],
        )

    def test_partial_month_contribution_may_fall_while_cumulative_inputs_grow(self) -> None:
        workspace = _workspace()
        rows = _request_rows(workspace)
        rows[6].update(revenue=100, variable_cost=95, contribution=5)

        normalized, _ = management_forecast_service._normalize_periods(
            rows, workspace=workspace
        )

        self.assertEqual(normalized[6]["contribution"], 5.0)

    def test_closed_credit_month_remains_exact_instead_of_becoming_zero(self) -> None:
        workspace = _workspace()
        workspace["periods"][0].update(
            actual_revenue=-10,
            actual_variable_cost=-4,
            actual_contribution=-6,
            actual_liters=-5,
            actual_units=-2,
            forecast_revenue=-10,
            forecast_variable_cost=-4,
            forecast_contribution=-6,
            forecast_liters=-5,
            forecast_units=-2,
        )

        normalized, _ = management_forecast_service._normalize_periods(
            _request_rows(workspace), workspace=workspace
        )

        self.assertEqual(normalized[0]["revenue"], -10.0)
        self.assertEqual(normalized[0]["contribution"], -6.0)

    def test_last_day_of_cutoff_month_is_closed(self) -> None:
        self.assertFalse(
            management_forecast_service._period_is_closed(
                "2026-07", cutoff="2026-07", as_of_date="2026-07-30"
            )
        )
        self.assertTrue(
            management_forecast_service._period_is_closed(
                "2026-07", cutoff="2026-07", as_of_date="2026-07-31"
            )
        )


class ManagementForecastWriteTests(unittest.TestCase):
    def test_short_audit_reason_fails_before_workspace_read(self) -> None:
        with patch.object(
            management_forecast_service, "read_workspace"
        ) as reader:
            with self.assertRaisesRegex(
                management_forecast_service.ManagementForecastValidationError,
                "minimaal 10 tekens",
            ):
                management_forecast_service.create_revision(
                    binding={},
                    expected_active_revision_id="",
                    reason="te kort",
                    period_allocations=[],
                    actor="hans",
                    actor_role="management",
                )
        reader.assert_not_called()

    def test_stale_binding_fails_before_storage_write(self) -> None:
        workspace = _workspace()
        stale = copy.deepcopy(workspace["binding"])
        stale["plan_contract_hash"] = "stale-plan-hash"
        with (
            patch.object(
                management_forecast_service,
                "read_workspace",
                return_value=workspace,
            ),
            patch.object(
                management_forecast_service.management_forecast_storage,
                "create_revision",
            ) as writer,
        ):
            with self.assertRaises(
                management_forecast_storage.ManagementForecastConflict
            ):
                management_forecast_service.create_revision(
                    binding=stale,
                    expected_active_revision_id="",
                    reason="Nieuwe omzetverwachting",
                    period_allocations=_request_rows(workspace),
                    actor="hans",
                    actor_role="management",
                )
        writer.assert_not_called()

    def test_write_is_audited_and_bound_to_current_authority(self) -> None:
        workspace = _workspace()
        saved = {
            "id": "revision-1",
            "generation_id": "generation-2026",
            "status": "active",
            "revision_number": 1,
        }
        with (
            patch.object(
                management_forecast_service,
                "read_workspace",
                return_value=workspace,
            ),
            patch.object(
                management_forecast_service.management_forecast_storage,
                "create_revision",
                return_value=saved,
            ) as writer,
        ):
            result = management_forecast_service.create_revision(
                binding=workspace["binding"],
                expected_active_revision_id="",
                reason="Nieuwe omzetverwachting na voorraadherstel",
                period_allocations=_request_rows(workspace),
                actor="hans",
                actor_role="management",
            )

        kwargs = writer.call_args.kwargs
        self.assertEqual(kwargs["generation_id"], "generation-2026")
        self.assertEqual(kwargs["plan_contract_hash"], "12345678-plan-hash")
        self.assertEqual(kwargs["actor"], "hans")
        self.assertEqual(kwargs["actor_role"], "management")
        self.assertEqual(kwargs["as_of_date"], "2026-07-15")
        self.assertEqual(result["saved"]["id"], "revision-1")
        self.assertEqual(result["workspace"]["current_revision"]["id"], "revision-1")
        self.assertEqual(
            result["workspace"]["forecast_source"],
            "active_generation_forecast_revision",
        )


class ManagementForecastSchemaContractTests(unittest.TestCase):
    def test_schema_is_additive_append_only_and_restricts_parent_deletion(self) -> None:
        source = (BACKEND_ROOT / "app" / "domain" / "management_forecast_storage.py").read_text(
            encoding="utf-8"
        )

        self.assertIn("CREATE TABLE IF NOT EXISTS commercial_forecast_revisions", source)
        self.assertGreaterEqual(source.count("ON DELETE RESTRICT"), 4)
        self.assertNotIn("DELETE FROM COMMERCIAL_FORECAST_REVISIONS", source.upper())
        self.assertIn("SET status = 'superseded'", source)
        self.assertIn("WHERE status = 'active'", source)


class ManagementForecastFrontendContractTests(unittest.TestCase):
    def test_editor_reuses_the_server_read_model_and_loads_history_lazily(self) -> None:
        panel = (
            PROJECT_ROOT
            / "frontend"
            / "src"
            / "components"
            / "break-even-next"
            / "ManagementForecastPanel.tsx"
        ).read_text(encoding="utf-8")
        screen = (
            PROJECT_ROOT
            / "frontend"
            / "src"
            / "components"
            / "break-even-next"
            / "BreakEvenNextMockup.tsx"
        ).read_text(encoding="utf-8")

        self.assertIn("initialWorkspaceFromReadModel", panel)
        self.assertIn("if (!enabled || initialWorkspace) return", panel)
        self.assertIn("async function loadHistory()", panel)
        self.assertIn("initialReadModel={readModel}", screen)
        self.assertNotIn("Math.max(0, next.revenue - next.variable_cost)", panel)


if __name__ == "__main__":
    unittest.main()
