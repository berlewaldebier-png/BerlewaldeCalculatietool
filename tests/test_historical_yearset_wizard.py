from __future__ import annotations

import copy
from datetime import UTC, datetime, timedelta
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import historical_yearset_wizard_service


SNAPSHOT_AT = datetime(2026, 7, 13, 14, 28, 12, tzinfo=UTC)


def _canonical(sku_id: str = "sku-blond", **overrides) -> dict:
    row = {
        "sku_id": sku_id,
        "sku_code": "BLOND-24X33",
        "sku_name": "Berlewalde Blond - Doos 24 x 33cl",
        "beer_name": "Berlewalde Blond",
        "subject_type": "bundle",
        "cost_required": True,
        "primary_cost": 10,
        "packaging_cost": 1,
        "overhead_cost": 4,
        "excise_cost": 2,
        "cost_price": 17,
        "list_price": 42.5,
        "provenance_kind": "source_anchor",
    }
    row.update(overrides)
    return row


def _recipe_snapshot() -> dict:
    ingredient_source = {
        "id": "ingredient-malt",
        "ingredient": "Mout",
        "omschrijving": "Pilsmout",
        "hoeveelheid": 100,
        "eenheid": "KG",
        "prijs": 250,
        "benodigd_in_recept": 50,
    }
    ingredient_target = {**ingredient_source, "prijs": 265}
    return {
        "beer_id": "beer-blond",
        "source_version_id": "source-version-blond",
        "target_version_id": "target-version-blond",
        "source": {
            "basisgegevens": {"biernaam": "Berlewalde Blond", "stijl": "Blond", "alcoholpercentage": 6, "tarief_accijns": "Hoog"},
            "invoer": {"ingredienten": {"regels": [ingredient_source]}},
        },
        "target": {
            "basisgegevens": {"biernaam": "Berlewalde Blond", "stijl": "Blond", "alcoholpercentage": 6, "tarief_accijns": "Hoog"},
            "invoer": {"ingredienten": {"regels": [ingredient_target]}},
        },
    }


def _engine_row(sku_id: str = "sku-blond", **overrides) -> dict:
    row = {
        "sku_id": sku_id,
        "source_version_id": "source-version-blond",
        "product_label": "Blond doos",
        "source_primary": 9,
        "source_packaging": 1,
        "source_overhead": 3,
        "source_excise": 2,
        "source_cost": 15,
        "scenario_primary": 10,
        "target_packaging": 1,
        "target_overhead": 4,
        "target_excise": 2,
        "target_cost": 17,
    }
    row.update(overrides)
    return row


def _dossier(items: list[dict] | None = None) -> dict:
    return {
        "version": "rf-012d1-v1",
        "status": "ready",
        "read_only": True,
        "operational_year": 2026,
        "binding": {"generation_id": "generation-2026", "run_id": "run-2026"},
        "summary": {"sku_count": len(items or [_canonical()])},
        "plan": {"targets": {}, "period_allocations": []},
        "sku_items": copy.deepcopy(items or [_canonical()]),
        "channels": [],
        "audit": {"generation": {"source_year": 2025}},
    }


def _build(*, dossier=None, rows=None, production_at=None) -> dict:
    return historical_yearset_wizard_service.build_historical_yearset_wizard(
        dossier=copy.deepcopy(dossier or _dossier()),
        engine_batches=[
            {
                "source_year": 2025,
                "target_year": 2026,
                "created_at": SNAPSHOT_AT.isoformat(),
                "rows": copy.deepcopy(rows or [_engine_row()]),
            }
        ],
        engine_updated_at=SNAPSHOT_AT,
        source_close={"id": "close-2025", "status": "closed", "closed_at": "2026-01-01T00:00:00+00:00"},
        production={"updated_at": (production_at or SNAPSHOT_AT).isoformat()},
        tariffs={"updated_at": SNAPSHOT_AT.isoformat()},
        source_fixed_cost_rows=[{
            "id": "fixed-source-1", "description": "Huur", "cost_type": "indirect",
            "cost_pool": "productie", "domain_code": "production", "allocation_driver": "liter",
            "allocation_scope": "all", "annual_amount": 100, "updated_at": SNAPSHOT_AT.isoformat(),
        }],
        fixed_cost_rows=[{
            "id": "fixed-target-1", "description": "Huur", "cost_type": "indirect",
            "cost_pool": "productie", "domain_code": "production", "allocation_driver": "liter",
            "allocation_scope": "all", "annual_amount": 106, "updated_at": SNAPSHOT_AT.isoformat(),
        }],
        source_packaging_price_rows=[{"id": "pack-source-1", "component_id": "bottle", "price_per_unit": 1}],
        packaging_price_rows=[{"id": "pack-target-1", "component_id": "bottle", "price_per_unit": 1.06}],
        packaging_updated_at=SNAPSHOT_AT,
        recipe_snapshots=[_recipe_snapshot()],
    )


class HistoricalYearsetWizardProjectionTests(unittest.TestCase):
    def test_duplicate_presentation_rows_collapse_to_one_exact_stable_sku(self) -> None:
        result = _build(rows=[_engine_row(), _engine_row(product_label="Blond kaartregel 2")])

        self.assertEqual(result["status"], "ready")
        self.assertTrue(result["read_only"])
        self.assertEqual((result["source_year"], result["target_year"]), (2025, 2026))
        self.assertEqual(len(result["steps"]), 14)
        snapshot = result["cost_snapshot"]
        self.assertEqual(snapshot["raw_row_count"], 2)
        self.assertEqual(snapshot["unique_sku_count"], 1)
        self.assertEqual(snapshot["duplicate_reference_count"], 1)
        self.assertEqual(snapshot["canonical_exact_match_count"], 1)
        self.assertEqual(snapshot["rows"][0]["target"]["cost_price"], 17.0)

    def test_conflicting_duplicate_financial_rows_fail_closed(self) -> None:
        result = _build(rows=[_engine_row(), _engine_row(target_cost=18)])

        self.assertEqual(result["status"], "missing")
        self.assertIn("historical_wizard_duplicate_cost_conflict", result["reason_codes"])

    def test_material_difference_from_finalized_dossier_fails_closed(self) -> None:
        result = _build(dossier=_dossier([_canonical(cost_price=18)]))

        self.assertEqual(result["status"], "missing")
        self.assertIn("historical_wizard_cost_snapshot_mismatch", result["reason_codes"])

    def test_only_exact_target_anchor_and_non_cost_catalog_rows_may_lack_legacy_batch(self) -> None:
        items = [
            _canonical(),
            _canonical(
                "sku-recovered",
                provenance_kind="recovered_from_exact_target_anchor",
                cost_price=12,
            ),
            _canonical(
                "sku-rounding",
                provenance_kind="catalog_reference",
                cost_required=False,
                primary_cost=None,
                packaging_cost=None,
                overhead_cost=None,
                excise_cost=None,
                cost_price=None,
                list_price=0.01,
            ),
        ]

        result = _build(dossier=_dossier(items))

        self.assertEqual(result["status"], "ready")
        snapshot = result["cost_snapshot"]
        self.assertEqual(snapshot["canonical_without_legacy_count"], 2)
        self.assertEqual(snapshot["allowed_without_legacy_count"], 2)
        self.assertEqual(
            {row["fidelity"] for row in snapshot["rows"]},
            {"exact", "exact_anchor", "not_applicable"},
        )

    def test_later_production_state_is_labeled_reconstructed(self) -> None:
        result = _build(production_at=SNAPSHOT_AT + timedelta(days=5))

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["production"]["fidelity"], "reconstructed")
        self.assertEqual(result["tariffs"]["fidelity"], "exact")
        self.assertEqual(result["fixed_costs"]["fidelity"], "exact")
        self.assertEqual(result["packaging_prices"]["fidelity"], "exact")

    def test_inflation_and_recipe_inputs_are_compared_without_mutating_history(self) -> None:
        result = _build()

        self.assertEqual(result["inflation"]["value_pct"], 6.0)
        self.assertEqual(result["inflation"]["fidelity"], "derived_exact")
        self.assertTrue(result["fixed_costs"]["rows"][0]["matches_inflation"])
        self.assertTrue(result["packaging_prices"]["rows"][0]["matches_inflation"])
        self.assertEqual(result["recipes"]["fidelity"], "exact")
        recipe = result["recipes"]["rows"][0]
        self.assertEqual(recipe["beer_name"], "Berlewalde Blond")
        self.assertEqual(recipe["source_recipe_total"], 125.0)
        self.assertEqual(recipe["target_recipe_total"], 132.5)
        self.assertTrue(recipe["ingredients"][0]["matches_inflation"])


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

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.statements.append(normalized)
        if normalized == "SET TRANSACTION READ ONLY":
            return _Result()
        if "FROM commercial_yearsets y" in normalized:
            return _Result(one=("active", "active"))
        if "dataset_name = 'kostprijs-target-engine-rows'" in normalized:
            return _Result(
                one=(
                    [{"source_year": 2025, "target_year": 2026, "created_at": SNAPSHOT_AT.isoformat(), "rows": [_engine_row()]}],
                    SNAPSHOT_AT,
                )
            )
        if "FROM year_close_snapshots" in normalized:
            return _Result(one=("close-2025", "closed", SNAPSHOT_AT))
        if "FROM production_years" in normalized or "FROM tarieven_heffingen_years" in normalized:
            return _Result(one=None)
        if "FROM fixed_cost_lines" in normalized or "jsonb_array_elements" in normalized or "FROM cost_versions target" in normalized:
            return _Result(all_rows=[])
        raise AssertionError(f"Unexpected read: {normalized} {params}")


class HistoricalYearsetWizardReaderTests(unittest.TestCase):
    def test_reader_starts_read_only_and_never_initializes_schema(self) -> None:
        connection = _ReadOnlyConnection()
        with patch.object(
            historical_yearset_wizard_service.yearset_dossier_service,
            "read_yearset_dossier",
            return_value=_dossier(),
        ), patch.object(
            historical_yearset_wizard_service.postgres_storage,
            "connect",
            return_value=connection,
        ):
            result = historical_yearset_wizard_service.read_historical_yearset_wizard(2026)

        self.assertEqual(result["status"], "ready")
        self.assertEqual(connection.statements[0], "SET TRANSACTION READ ONLY")
        joined = " ".join(connection.statements).upper()
        for forbidden in ("CREATE ", "ALTER ", "DROP ", "INSERT ", "UPDATE ", "DELETE ", "TRUNCATE "):
            self.assertNotIn(forbidden, joined)


class HistoricalYearsetWizardFrontendContractTests(unittest.TestCase):
    def test_historical_view_reuses_fourteen_step_source_and_has_no_mutation_form(self) -> None:
        live = (PROJECT_ROOT / "frontend/src/components/NieuwJaarWizard.tsx").read_text(encoding="utf-8")
        historical = (PROJECT_ROOT / "frontend/src/components/HistoricalYearsetWizard.tsx").read_text(encoding="utf-8")
        dossier = (PROJECT_ROOT / "frontend/src/components/YearsetDossier.tsx").read_text(encoding="utf-8")
        steps = (PROJECT_ROOT / "frontend/src/components/nieuw-jaar/nieuwJaarWizardSteps.ts").read_text(encoding="utf-8")

        self.assertIn("buildNieuwJaarWizardSteps", live)
        self.assertIn("buildNieuwJaarWizardSteps", historical)
        self.assertEqual(steps.count('id: "'), 14)
        self.assertIn("Jaarsetoverzicht", dossier)
        self.assertIn("Wizardweergave", dossier)
        self.assertIn("historical-wizard", historical)
        self.assertIn("readOnly", historical)
        self.assertIn("Vorige", historical)
        self.assertIn("Volgende", historical)
        self.assertIn("InflationSummary", historical)
        self.assertIn("Bron + inflatie", historical)
        self.assertIn("RecipeHistory", historical)
        self.assertIn("StrategyGroups", historical)
        self.assertIn("row.source.cost_price", historical)
        self.assertNotIn("{sourceYear}: {formatMoney", historical)
        self.assertNotIn("<form", historical)
        self.assertNotIn("onSubmit=", historical)
        self.assertNotIn('method: "POST"', historical)
        self.assertNotIn('method: "PUT"', historical)
        self.assertNotIn('method: "DELETE"', historical)


if __name__ == "__main__":
    unittest.main()
