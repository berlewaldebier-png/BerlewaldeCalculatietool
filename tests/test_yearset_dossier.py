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

from app.domain import yearset_dossier_service


def _generation(**overrides) -> dict:
    row = {
        "id": "generation-2026",
        "operational_year": 2026,
        "revision": 1,
        "status": "active",
        "readiness_status": "ready",
        "source_year": 2025,
        "source_generation_id": "",
        "cost_source_year": 2026,
        "pricing_source_year": 2026,
        "advice_source_year": 2026,
        "validation_hash": "generation-validation",
        "created_at": "2026-07-30T10:00:00+00:00",
        "activated_at": "2026-07-30T12:00:00+00:00",
        "activated_by": "admin",
        "superseded_at": "",
    }
    row.update(overrides)
    return row


def _run(**overrides) -> dict:
    row = {
        "id": "run-2026",
        "generation_id": "generation-2026",
        "planner_version": "rf-013c3-v1",
        "status": "active",
        "readiness_status": "ready",
        "source_snapshot_hash": "source-snapshot",
        "target_input_hash": "target-input",
        "manifest_hash": "manifest-2026",
        "validation_hash": "run-validation",
        "sku_count": 2,
        "required_cost_count": 1,
        "ready_cost_count": 1,
        "price_count": 1,
        "ready_price_count": 1,
        "blocker_counts": {},
        "created_by": "admin",
        "created_at": "2026-07-30T10:00:00+00:00",
        "approved_by": "management",
        "approved_at": "2026-07-30T11:00:00+00:00",
        "activated_by": "admin",
        "activated_at": "2026-07-30T12:00:00+00:00",
    }
    row.update(overrides)
    return row


def _plan_payload() -> dict:
    periods = [
        {
            "period": f"2026-{month:02d}",
            "revenue": str(220000 / 12),
            "variable_cost": str(88000 / 12),
            "contribution": str(132000 / 12),
            "liters": str(3000 / 12),
            "units": str(6000 / 12),
        }
        for month in range(1, 13)
    ]
    return {
        "targets": {
            "revenue": "220000",
            "variable_cost": "88000",
            "contribution": "132000",
            "liters": "3000",
            "units": "6000",
        },
        "period_allocations": periods,
        "sku_allocations": [
            {
                "sku_id": "sku-blond-box",
                "revenue": "220000",
                "variable_cost": "88000",
                "contribution": "132000",
                "liters": "3000",
                "units": "6000",
            }
        ],
    }


def _plan_row(**overrides) -> dict:
    payload = _plan_payload()
    contract = yearset_dossier_service.commercial_yearset_service.validate_plan_contract(
        source="new_year_preparation",
        payload=payload,
    )
    row = {
        "id": "plan-2026",
        "source_plan_id": "source-plan-2026",
        "plan_contract_hash": contract["contract_hash"],
        "frozen_plan": {
            "source": "new_year_preparation",
            "source_record_id": "source-plan-2026",
            "payload": copy.deepcopy(payload),
        },
        "initial_forecast": {
            "basis": "frozen_plan",
            "plan_contract_hash": contract["contract_hash"],
            "forecast": copy.deepcopy(payload),
        },
        "readiness_status": "ready",
        "blocker_codes": [],
        "source_hash": "plan-source-hash",
    }
    row.update(overrides)
    return row


def _sku(sku_id: str, **overrides) -> dict:
    row = {
        "sku_id": sku_id,
        "sku_code": sku_id.upper(),
        "sku_name": f"Product {sku_id}",
        "beer_name": "Berlewalde Blond",
        "canonical_beer_id": "beer-blond",
        "scope_classification": "carried_forward",
        "subject_type": "beer",
        "subject_id": "beer-blond",
        "sku_kind": "beer_format",
        "calculation_method": "year_transition",
        "cost_method": "inkoop",
        "provenance_kind": "source_anchor",
        "provenance_source_year": 2025,
        "primary_cost": "10",
        "packaging_cost": "1",
        "overhead_cost": "4",
        "excise_cost": "2",
        "cost_price": "17",
        "liters_per_unit": "7.92",
        "cost_required": True,
        "readiness_status": "ready",
        "blocker_codes": [],
        "source_anchor_id": "anchor-blond",
        "source_cost_version_id": "cost-version-2025",
        "source_cost_row_id": "cost-row-2025",
        "reserved_target_cost_row_id": "cost-row-2026",
        "target_hash": "cost-hash",
    }
    row.update(overrides)
    return row


def _price(**overrides) -> dict:
    row = {
        "sku_id": "sku-blond-box",
        "source_pricing_id": "price-2025",
        "target_pricing_id": "price-2026",
        "list_price": "42.50",
        "readiness_status": "ready",
        "blocker_codes": [],
        "source_hash": "price-source-hash",
        "target_hash": "price-target-hash",
    }
    row.update(overrides)
    return row


def _dossier(**overrides) -> dict:
    params = {
        "operational_year": 2026,
        "generation": _generation(),
        "run": _run(),
        "plan_row": _plan_row(),
        "sku_rows": [
            _sku("sku-blond-box"),
            _sku(
                "sku-rounding",
                beer_name="",
                subject_type="service",
                subject_id="rounding",
                sku_kind="article",
                cost_required=False,
                readiness_status="not_required",
                primary_cost=None,
                packaging_cost=None,
                overhead_cost=None,
                excise_cost=None,
                cost_price=None,
            ),
        ],
        "price_rows": [_price()],
        "channel_rows": [
            {
                "channel_code": "horeca",
                "advice_markup_pct": "190",
                "readiness_status": "ready",
                "blocker_codes": [],
                "source_hash": "channel-hash",
            }
        ],
        "generation_events": [],
        "run_events": [],
    }
    params.update(overrides)
    return yearset_dossier_service.build_yearset_dossier(**params)


class YearsetDossierProjectionTests(unittest.TestCase):
    def test_finalized_dossier_exposes_exact_frozen_plan_and_sku_values(self) -> None:
        result = _dossier()

        self.assertEqual(result["status"], "ready")
        self.assertTrue(result["read_only"])
        self.assertEqual(result["operational_year"], 2026)
        self.assertEqual(result["plan"]["targets"]["revenue"], 220000.0)
        self.assertEqual(len(result["plan"]["period_allocations"]), 12)
        self.assertEqual(result["summary"]["sku_count"], 2)
        self.assertEqual(result["summary"]["ready_cost_count"], 1)
        blond = next(
            item
            for item in result["sku_items"]
            if item["sku_id"] == "sku-blond-box"
        )
        self.assertEqual(blond["cost_price"], 17.0)
        self.assertEqual(blond["subject_id"], "beer-blond")
        self.assertEqual(blond["list_price"], 42.5)
        self.assertEqual(blond["planned_revenue"], 220000.0)
        rounding = next(
            item
            for item in result["sku_items"]
            if item["sku_id"] == "sku-rounding"
        )
        self.assertIsNone(rounding["cost_price"])
        self.assertFalse(rounding["cost_required"])

    def test_superseded_generation_remains_a_read_only_historical_dossier(self) -> None:
        result = _dossier(
            generation=_generation(status="superseded"),
            run=_run(status="superseded"),
        )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["binding"]["generation_status"], "superseded")
        self.assertTrue(result["plan"]["immutable"])

    def test_candidate_generation_is_not_exposed_as_finalized(self) -> None:
        result = _dossier(generation=_generation(status="candidate"))

        self.assertEqual(result["status"], "missing")
        self.assertIn("commercial_yearset_not_finalized", result["reason_codes"])

    def test_tampered_plan_hash_fails_closed(self) -> None:
        plan = _plan_row(plan_contract_hash="tampered")
        plan["initial_forecast"]["plan_contract_hash"] = "tampered"

        result = _dossier(plan_row=plan)

        self.assertEqual(result["status"], "missing")
        self.assertIn("commercial_yearset_plan_hash_mismatch", result["reason_codes"])

    def test_candidate_count_mismatch_fails_closed(self) -> None:
        result = _dossier(run=_run(sku_count=3))

        self.assertEqual(result["status"], "missing")
        self.assertIn("commercial_yearset_sku_count_mismatch", result["reason_codes"])


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
        if "FROM commercial_yearsets" in normalized and "events" not in normalized:
            row = _generation()
            return _Result(
                one=(
                    row["id"], row["operational_year"], row["revision"],
                    row["status"], row["readiness_status"], row["source_year"],
                    row["source_generation_id"], row["cost_source_year"],
                    row["pricing_source_year"], row["advice_source_year"],
                    row["validation_hash"], row["created_at"],
                    row["activated_at"], row["activated_by"], row["superseded_at"],
                )
            )
        if "FROM commercial_yearset_reconciliation_runs" in normalized:
            row = _run()
            return _Result(one=tuple(row[key] for key in (
                "id", "generation_id", "planner_version", "status",
                "readiness_status", "source_snapshot_hash", "target_input_hash",
                "manifest_hash", "validation_hash", "sku_count",
                "required_cost_count", "ready_cost_count", "price_count",
                "ready_price_count", "blocker_counts", "created_by", "created_at",
                "approved_by", "approved_at", "activated_by", "activated_at",
            )))
        if "FROM commercial_yearset_candidate_plan" in normalized:
            row = _plan_row()
            return _Result(one=(
                row["id"], row["source_plan_id"], row["plan_contract_hash"],
                json.dumps(row["frozen_plan"]), json.dumps(row["initial_forecast"]),
                row["readiness_status"], json.dumps(row["blocker_codes"]),
                row["source_hash"],
            ))
        if "FROM commercial_yearset_candidate_skus" in normalized:
            rows = [_sku("sku-blond-box"), _sku(
                "sku-rounding", beer_name="", subject_type="service",
                subject_id="rounding", sku_kind="article", cost_required=False,
                readiness_status="not_required", primary_cost=None,
                packaging_cost=None, overhead_cost=None, excise_cost=None,
                cost_price=None,
            )]
            keys = (
                "sku_id", "sku_code", "sku_name", "beer_name", "canonical_beer_id",
                "scope_classification", "subject_type", "subject_id", "sku_kind",
                "calculation_method", "cost_method", "provenance_kind", "provenance_source_year",
                "primary_cost", "packaging_cost", "overhead_cost", "excise_cost",
                "cost_price", "liters_per_unit", "cost_required",
                "readiness_status", "blocker_codes", "source_anchor_id",
                "source_cost_version_id", "source_cost_row_id",
                "reserved_target_cost_row_id", "target_hash",
            )
            return _Result(all_rows=[tuple(row[key] for key in keys) for row in rows])
        if "FROM commercial_yearset_candidate_prices" in normalized:
            row = _price()
            return _Result(all_rows=[tuple(row[key] for key in (
                "sku_id", "source_pricing_id", "target_pricing_id", "list_price",
                "readiness_status", "blocker_codes", "source_hash", "target_hash",
            ))])
        if "FROM commercial_yearset_candidate_channels" in normalized:
            return _Result(all_rows=[("horeca", "190", "ready", [], "channel-hash")])
        if "FROM commercial_yearset_events" in normalized:
            return _Result(all_rows=[("activated", "admin", "", "2026-07-30T12:00:00+00:00")])
        if "FROM commercial_yearset_reconciliation_events" in normalized:
            return _Result(all_rows=[("activated", "admin", "", "2026-07-30T12:00:00+00:00")])
        raise AssertionError(f"Unexpected SQL: {normalized}")


class YearsetDossierReaderTests(unittest.TestCase):
    def test_reader_starts_read_only_and_never_initializes_schema(self) -> None:
        connection = _ReadOnlyConnection()

        @contextmanager
        def connect():
            yield connection

        with (
            patch.object(yearset_dossier_service.postgres_storage, "connect", connect),
            patch.object(
                yearset_dossier_service.postgres_storage,
                "ensure_schema",
                side_effect=AssertionError("read path may not initialize schema"),
            ),
        ):
            result = yearset_dossier_service.read_yearset_dossier(2026)

        self.assertEqual(connection.statements[0], "SET TRANSACTION READ ONLY")
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["binding"]["generation_id"], "generation-2026")

    def test_active_reader_selects_the_active_generation_without_year_fallback(self) -> None:
        connection = _ReadOnlyConnection()

        @contextmanager
        def connect():
            yield connection

        with patch.object(yearset_dossier_service.postgres_storage, "connect", connect):
            result = yearset_dossier_service.read_active_yearset_dossier()

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["operational_year"], 2026)
        self.assertIn("WHERE status = 'active'", connection.statements[1])
        self.assertNotIn("operational_year =", connection.statements[1])


class YearsetDossierFrontendContractTests(unittest.TestCase):
    def test_open_dossier_and_prepare_next_year_are_separate_actions(self) -> None:
        panel = (PROJECT_ROOT / "frontend" / "src" / "components" / "JaarsetsPanel.tsx").read_text(encoding="utf-8")
        page = (PROJECT_ROOT / "frontend" / "src" / "app" / "(app)" / "beheer" / "jaarsets" / "[year]" / "page.tsx").read_text(encoding="utf-8")

        self.assertIn('title="Open jaarsetdossier"', panel)
        self.assertIn('href={`/beheer/jaarsets/${row.year}`', panel)
        self.assertIn('title="Nieuw jaar voorbereiden"', panel)
        self.assertIn('/nieuw-jaar-voorbereiden?source_year=', panel)
        self.assertIn("<YearsetDossier", page)


if __name__ == "__main__":
    unittest.main()
