from __future__ import annotations

import copy
import json
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import (
    break_even_commercial_context_service,
    break_even_planning_service,
)


def _generation(**overrides) -> dict:
    row = {
        "id": "generation-2026",
        "operational_year": 2026,
        "status": "active",
        "readiness_status": "ready",
        "validation_hash": "generation-validation",
    }
    row.update(overrides)
    return row


def _run(**overrides) -> dict:
    row = {
        "id": "run-2026",
        "generation_id": "generation-2026",
        "status": "active",
        "readiness_status": "ready",
        "manifest_hash": "manifest-2026",
        "validation_hash": "run-validation",
    }
    row.update(overrides)
    return row


def _plan_payload() -> dict:
    period_allocations = [
        {
            "period": "2026-01",
            "revenue": "100",
            "variable_cost": "40",
            "contribution": "60",
            "liters": "30",
            "units": "10",
        },
        {
            "period": "2026-02",
            "revenue": "200",
            "variable_cost": "80",
            "contribution": "120",
            "liters": "60",
            "units": "20",
        },
    ]
    period_allocations.extend(
        {
            "period": f"2026-{month:02d}",
            "revenue": "0",
            "variable_cost": "0",
            "contribution": "0",
            "liters": "0",
            "units": "0",
        }
        for month in range(3, 13)
    )
    return {
        "targets": {
            "revenue": "300",
            "variable_cost": "120",
            "contribution": "180",
            "liters": "90",
            "units": "30",
        },
        "period_allocations": period_allocations,
        "sku_allocations": [
            {
                "sku_id": "sku-blond",
                "revenue": "200",
                "variable_cost": "80",
                "contribution": "120",
                "liters": "60",
                "units": "20",
            },
            {
                "sku_id": "sku-triple",
                "revenue": "100",
                "variable_cost": "40",
                "contribution": "60",
                "liters": "30",
                "units": "10",
            },
        ],
    }


def _plan_row(**overrides) -> dict:
    payload = _plan_payload()
    contract = (
        break_even_commercial_context_service
        .commercial_yearset_service.validate_plan_contract(
            source="new_year_preparation",
            payload=payload,
        )
    )
    plan_contract_hash = contract["contract_hash"]
    row = {
        "id": "plan-2026",
        "source_plan_id": "recovery-2026",
        "plan_contract_hash": plan_contract_hash,
        "frozen_plan": {
            "source": "new_year_preparation",
            "source_record_id": "recovery-2026",
            "payload": copy.deepcopy(payload),
        },
        "initial_forecast": {
            "basis": "frozen_plan",
            "plan_contract_hash": plan_contract_hash,
            "forecast": copy.deepcopy(payload),
        },
        "readiness_status": "ready",
        "blocker_codes": [],
    }
    row.update(overrides)
    return row


def _candidate(sku_id: str, **overrides) -> dict:
    row = {
        "sku_id": sku_id,
        "scope_classification": "carried_forward",
        "primary_cost": "10",
        "packaging_cost": "1",
        "overhead_cost": "4",
        "excise_cost": "2",
        "cost_price": "17",
        "liters_per_unit": "7.92",
        "cost_required": True,
        "readiness_status": "ready",
        "sku_code": sku_id.upper(),
        "sku_name": f"Product {sku_id}",
    }
    row.update(overrides)
    return row


def _context(**overrides) -> dict:
    result = break_even_commercial_context_service.build_break_even_commercial_context(
        generation=_generation(),
        run=_run(),
        plan_row=_plan_row(),
        candidate_rows=[
            _candidate("sku-blond"),
            _candidate("sku-triple", cost_price="19"),
        ],
        **overrides,
    )
    if result["status"] != "ready":
        raise AssertionError(result)
    return result


class BreakEvenCommercialContextProjectionTests(unittest.TestCase):
    def test_active_generation_exposes_immutable_plan_and_cost_rows(self) -> None:
        result = _context()

        self.assertEqual(result["binding"]["generation_id"], "generation-2026")
        self.assertEqual(result["binding"]["operational_year"], 2026)
        self.assertEqual(result["binding"]["plan_id"], "plan-2026")
        self.assertTrue(result["plan"]["immutable"])
        self.assertEqual(result["plan"]["targets"]["revenue"], 300.0)
        self.assertEqual(len(result["plan"]["period_allocations"]), 12)
        self.assertEqual(len(result["planning_rows"]), 2)
        blond = next(
            row
            for row in result["planning_rows"]
            if row["sku_id"] == "sku-blond"
        )
        self.assertEqual(blond["planned_units"], 20.0)
        self.assertEqual(blond["sku_name"], "Product sku-blond")
        self.assertEqual(blond["planned_variable_cost_unit"], 13.0)
        self.assertEqual(blond["planned_fixed_allocation_unit"], 4.0)
        self.assertEqual(blond["planned_cost_unit"], 17.0)

    def test_initial_forecast_mismatch_fails_closed(self) -> None:
        plan = _plan_row()
        plan["initial_forecast"]["forecast"]["targets"]["revenue"] = "999"

        result = (
            break_even_commercial_context_service.build_break_even_commercial_context(
                generation=_generation(),
                run=_run(),
                plan_row=plan,
                candidate_rows=[_candidate("sku-blond")],
            )
        )

        self.assertEqual(result["status"], "missing")
        self.assertIn(
            "active_commercial_initial_forecast_mismatch",
            result["reason_codes"],
        )

    def test_tampered_plan_hash_fails_closed(self) -> None:
        plan = _plan_row(plan_contract_hash="tampered-plan-hash")
        plan["initial_forecast"]["plan_contract_hash"] = "tampered-plan-hash"

        result = (
            break_even_commercial_context_service
            .build_break_even_commercial_context(
                generation=_generation(),
                run=_run(),
                plan_row=plan,
                candidate_rows=[_candidate("sku-blond")],
            )
        )

        self.assertEqual(result["status"], "missing")
        self.assertIn(
            "active_commercial_plan_hash_mismatch",
            result["reason_codes"],
        )

    def test_incomplete_year_periods_fail_closed(self) -> None:
        plan = _plan_row()
        plan["frozen_plan"]["payload"]["period_allocations"].pop()
        plan["initial_forecast"]["forecast"] = copy.deepcopy(
            plan["frozen_plan"]["payload"]
        )
        contract = (
            break_even_commercial_context_service
            .commercial_yearset_service.validate_plan_contract(
                source="new_year_preparation",
                payload=plan["frozen_plan"]["payload"],
            )
        )
        plan["plan_contract_hash"] = contract["contract_hash"]
        plan["initial_forecast"]["plan_contract_hash"] = contract[
            "contract_hash"
        ]

        result = (
            break_even_commercial_context_service
            .build_break_even_commercial_context(
                generation=_generation(),
                run=_run(),
                plan_row=plan,
                candidate_rows=[_candidate("sku-blond")],
            )
        )

        self.assertEqual(result["status"], "missing")
        self.assertIn(
            "active_commercial_plan_periods_incomplete",
            result["reason_codes"],
        )

    def test_legacy_or_other_generation_revision_is_not_applied(self) -> None:
        result = _context(
            forecast_revision_row={
                "id": "legacy-revision",
                "as_of_date": "2026-06-30",
                "basis": "invoice",
                "payload": {
                    "forecast_revision": {
                        "targets": {
                            "revenue": 999,
                            "variable_cost": 100,
                            "contribution": 899,
                        }
                    }
                },
            }
        )

        self.assertIsNone(result["forecast_revision"])

    def test_exact_generation_bound_revision_is_available(self) -> None:
        result = _context(
            forecast_revision_row={
                "id": "revision-1",
                "as_of_date": "2026-06-30",
                "basis": "invoice",
                "payload": {
                    "commercial_context": {
                        "generation_id": "generation-2026",
                        "run_id": "run-2026",
                        "plan_contract_hash": _plan_row()[
                            "plan_contract_hash"
                        ],
                    },
                    "forecast_revision": {
                        "targets": {
                            "revenue": 320,
                            "variable_cost": 125,
                            "contribution": 195,
                            "liters": 95,
                            "units": 32,
                        },
                        "reason": "Management revision",
                    },
                },
            }
        )

        self.assertEqual(result["forecast_revision"]["id"], "revision-1")
        self.assertEqual(result["forecast_revision"]["targets"]["revenue"], 320.0)


class BreakEvenPlanForecastProjectionTests(unittest.TestCase):
    def test_without_actuals_initial_forecast_exactly_equals_plan(self) -> None:
        context = _context()
        frozen = copy.deepcopy(context["plan"])

        result = break_even_commercial_context_service.project_plan_forecast(
            context,
            actual_totals={},
            actual_periods=[],
        )

        self.assertEqual(
            result["forecast_source"],
            "active_generation_initial_forecast",
        )
        self.assertEqual(result["forecast_targets"], result["plan_targets"])
        self.assertEqual(context["plan"], frozen)

    def test_actual_period_replaces_plan_period_and_future_plan_remains(self) -> None:
        result = break_even_commercial_context_service.project_plan_forecast(
            _context(),
            actual_totals={
                "revenue": 110,
                "variable_cost": 45,
                "contribution": 65,
            },
            actual_periods=[
                {
                    "period": "2026-01",
                    "revenue": 110,
                    "variable_cost": 45,
                    "contribution": 65,
                }
            ],
        )

        self.assertEqual(
            result["forecast_source"],
            "active_generation_actual_plus_remaining_plan",
        )
        self.assertEqual(result["actual_cutoff_period"], "2026-01")
        self.assertEqual(result["forecast_targets"]["revenue"], 310.0)
        self.assertEqual(result["forecast_targets"]["variable_cost"], 125.0)
        self.assertEqual(result["forecast_targets"]["contribution"], 185.0)
        self.assertEqual(
            result["timeline"][-1]["running_forecast_revenue"],
            310.0,
        )
        self.assertEqual(
            result["timeline"][-1]["running_plan_revenue"],
            300.0,
        )

    def test_year_close_forecast_equals_final_actual(self) -> None:
        result = break_even_commercial_context_service.project_plan_forecast(
            _context(),
            actual_totals={
                "revenue": 280,
                "variable_cost": 115,
                "contribution": 165,
            },
            actual_periods=[
                {
                    "period": "2026-12",
                    "revenue": 280,
                    "variable_cost": 115,
                    "contribution": 165,
                }
            ],
            closed_year=True,
        )

        self.assertEqual(result["forecast_source"], "year_close_snapshot")
        self.assertEqual(result["forecast_targets"]["revenue"], 280.0)
        self.assertEqual(result["forecast_targets"]["contribution"], 165.0)


class BreakEvenAnalysisConsumerTests(unittest.TestCase):
    def test_active_year_uses_generation_plan_without_legacy_plan_reader(self) -> None:
        context = _context()
        empty_sales = {
            "rows": [],
            "period_totals": [],
            "totals": {
                "revenue": 0,
                "cost": 0,
                "variable_cost": 0,
                "fixed_alloc": 0,
                "contribution": 0,
                "missing_cost_lines": 0,
            },
        }
        with (
            patch.object(
                break_even_planning_service
                .break_even_commercial_context_service,
                "read_break_even_commercial_context",
                return_value=context,
            ),
            patch.object(
                break_even_planning_service,
                "_latest_active_plan",
                side_effect=AssertionError("legacy Plan reader must not run"),
            ),
            patch.object(
                break_even_planning_service,
                "_sales_totals",
                return_value=empty_sales,
            ),
            patch.object(
                break_even_planning_service,
                "_sku_labels",
                return_value={},
            ),
            patch.object(
                break_even_planning_service,
                "_sales_processing_diagnostics",
                return_value={},
            ),
            patch.object(
                break_even_planning_service,
                "_year_fixed_cost_total",
                return_value=50.0,
            ),
            patch.object(
                break_even_planning_service,
                "_year_incidental_cost_total",
                return_value=0.0,
            ),
            patch.object(
                break_even_planning_service,
                "_dashboard_revenue_reconciliation",
                return_value={
                    "dashboard_revenue": 0,
                    "break_even_revenue": 0,
                    "status": "match",
                },
            ),
            patch.object(
                break_even_planning_service.break_even_planning_storage,
                "get_year_close_snapshot",
                return_value=None,
            ),
            patch.object(
                break_even_planning_service.break_even_planning_storage,
                "latest_reforecast_snapshot",
                side_effect=AssertionError(
                    "legacy Forecast reader must not run"
                ),
            ),
        ):
            result = break_even_planning_service.build_analysis_read_model(
                year=0,
                basis="invoice",
            )

        self.assertEqual(result["year"], 2026)
        self.assertEqual(
            result["sources"]["plan_source"],
            "active_commercial_generation_frozen_plan",
        )
        self.assertEqual(result["dashboard"]["plan"]["revenue"], 300.0)
        self.assertEqual(result["dashboard"]["reforecast"]["revenue"], 300.0)
        self.assertEqual(
            result["sources"]["reforecast_source"],
            "active_generation_initial_forecast",
        )
        blond = next(
            row
            for row in result["plan_actual"]["rows"]
            if row["sku_id"] == "sku-blond"
        )
        self.assertEqual(blond["planned_variable_cost_unit"], 13.0)
        self.assertEqual(blond["planned_fixed_allocation_unit"], 4.0)
        self.assertEqual(blond["planned_cost_unit"], 17.0)
        self.assertFalse(
            any(
                warning["code"].startswith("missing_plan")
                for warning in result["data_quality"]["warnings"]
            )
        )

    def test_active_year_does_not_fall_back_when_generation_is_invalid(
        self,
    ) -> None:
        invalid_context = {
            "status": "missing",
            "binding": {
                "operational_year": 2026,
                "generation_id": "generation-2026",
            },
            "reason_codes": ["active_commercial_plan_hash_mismatch"],
        }
        with (
            patch.object(
                break_even_planning_service
                .break_even_commercial_context_service,
                "read_break_even_commercial_context",
                return_value=invalid_context,
            ),
            patch.object(
                break_even_planning_service,
                "_latest_active_plan",
                side_effect=AssertionError(
                    "active year must not use the legacy Plan reader"
                ),
            ),
        ):
            with self.assertRaisesRegex(
                ValueError,
                "active_commercial_plan_hash_mismatch",
            ):
                break_even_planning_service.build_analysis_read_model(
                    year=2026,
                    basis="invoice",
                )


class _Result:
    def __init__(self, *, one=None, all_rows=None):
        self._one = one
        self._all = list(all_rows or [])

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._all


class _ReadOnlyConnection:
    def __init__(self):
        self.statements: list[str] = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.statements.append(normalized)
        if normalized == "SET TRANSACTION READ ONLY":
            return _Result()
        if "FROM commercial_yearsets" in normalized:
            return _Result(
                one=(
                    "generation-2026",
                    2026,
                    "active",
                    "ready",
                    "generation-validation",
                )
            )
        if "FROM commercial_yearset_reconciliation_runs" in normalized:
            return _Result(
                one=(
                    "run-2026",
                    "generation-2026",
                    "active",
                    "ready",
                    "manifest-2026",
                    "run-validation",
                )
            )
        if "FROM commercial_yearset_candidate_plan" in normalized:
            plan = _plan_row()
            return _Result(
                one=(
                    plan["id"],
                    plan["source_plan_id"],
                    plan["plan_contract_hash"],
                    json.dumps(plan["frozen_plan"]),
                    json.dumps(plan["initial_forecast"]),
                    plan["readiness_status"],
                    json.dumps(plan["blocker_codes"]),
                    "source-hash",
                )
            )
        if "FROM commercial_yearset_candidate_skus" in normalized:
            row = _candidate("sku-blond")
            return _Result(
                all_rows=[
                    (
                        row["sku_id"],
                        row["scope_classification"],
                        row["primary_cost"],
                        row["packaging_cost"],
                        row["overhead_cost"],
                        row["excise_cost"],
                        row["cost_price"],
                        row["liters_per_unit"],
                        row["cost_required"],
                        row["readiness_status"],
                        row["sku_code"],
                        row["sku_name"],
                    )
                ]
            )
        if "FROM break_even_reforecast_snapshots" in normalized:
            return _Result(one=None)
        raise AssertionError(f"Unexpected SQL: {normalized}")


class BreakEvenCommercialContextReaderTests(unittest.TestCase):
    def test_reader_starts_read_only_and_never_initializes_schema(self) -> None:
        connection = _ReadOnlyConnection()

        @contextmanager
        def connect():
            yield connection

        with (
            patch.object(
                break_even_commercial_context_service.postgres_storage,
                "connect",
                connect,
            ),
            patch.object(
                break_even_commercial_context_service.postgres_storage,
                "ensure_schema",
                side_effect=AssertionError("read path may not initialize schema"),
            ),
        ):
            result = (
                break_even_commercial_context_service
                .read_break_even_commercial_context()
            )

        self.assertEqual(connection.statements[0], "SET TRANSACTION READ ONLY")
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["binding"]["generation_id"], "generation-2026")


if __name__ == "__main__":
    unittest.main()
