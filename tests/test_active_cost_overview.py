from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.domain import active_cost_overview_service


def _sku(
    sku_id: str,
    name: str,
    *,
    beer_name: str = "Berlewalde het Juweel",
    subject_id: str = "beer-juweel",
    subject_type: str = "beer",
    cost_price: float | None = 24.0,
    cost_required: bool = True,
    readiness: str = "ready",
    provenance: str = "recalculated_from_source_year",
) -> dict:
    return {
        "sku_id": sku_id,
        "sku_code": sku_id.upper(),
        "sku_name": name,
        "beer_name": beer_name,
        "canonical_beer_id": subject_id if beer_name else "",
        "subject_id": subject_id,
        "subject_type": subject_type,
        "scope_classification": "carried_forward",
        "calculation_method": "year_transition",
        "cost_method": "inkoop",
        "provenance_kind": provenance,
        "provenance_source_year": 2025,
        "primary_cost": 10,
        "packaging_cost": 1,
        "overhead_cost": 4,
        "excise_cost": 2,
        "cost_price": cost_price,
        "cost_required": cost_required,
        "cost_readiness_status": readiness,
        "cost_blocker_codes": [],
    }


def _dossier(rows: list[dict]) -> dict:
    return {
        "version": "rf-012d1-v1",
        "status": "ready",
        "read_only": True,
        "operational_year": 2026,
        "binding": {
            "generation_id": "generation-2026",
            "generation_status": "active",
            "run_id": "run-2026",
            "manifest_hash": "manifest-2026",
            "validation_hash": "validation-2026",
        },
        "sku_items": rows,
        "reason_codes": [],
    }


class ActiveCostOverviewProjectionTests(unittest.TestCase):
    def test_groups_each_physical_sku_once_and_prioritizes_box_then_keg(self) -> None:
        rows = [
            _sku("juweel-bottle", "Berlewalde het Juweel - Fles 33cl"),
            _sku("juweel-keg", "Berlewalde het Juweel - Fust 20L"),
            _sku("juweel-box", "Berlewalde het Juweel - Doos 24 * 33cl"),
            _sku(
                "tripel-box",
                "Berlewalde Tripel - Doos 24 * 33cl",
                beer_name="Berlewalde Tripel",
                subject_id="beer-tripel",
                cost_price=31.25,
            ),
        ]

        result = active_cost_overview_service.build_active_cost_overview(
            _dossier(rows), legacy_activation_sku_ids=[row["sku_id"] for row in rows]
        )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["summary"]["sku_count"], 4)
        juweel = next(group for group in result["groups"] if group["label"] == "Berlewalde het Juweel")
        self.assertEqual(
            [row["sku_id"] for row in juweel["items"]],
            ["juweel-box", "juweel-keg", "juweel-bottle"],
        )
        self.assertEqual(result["shadow_parity"]["status"], "match")

    def test_keeps_missing_not_applicable_and_not_activated_distinct(self) -> None:
        rows = [
            _sku("missing", "Juweel - Doos 24 * 33cl", cost_price=0, readiness="blocked"),
            _sku(
                "rounding",
                "Afrondingsverschil",
                beer_name="",
                subject_id="rounding",
                subject_type="service",
                cost_price=None,
                cost_required=False,
                readiness="not_required",
            ),
            {**_sku("not-active", "Juweel - Fust 20L"), "in_active_generation": False},
        ]

        result = active_cost_overview_service.build_active_cost_overview(_dossier(rows))
        states = {
            row["sku_id"]: row["cost_state"]
            for group in result["groups"]
            for row in group["items"]
        }

        self.assertEqual(states["missing"], "missing_cost")
        self.assertEqual(states["rounding"], "not_applicable")
        self.assertEqual(states["not-active"], "not_activated")
        self.assertEqual(result["summary"]["missing_cost_count"], 1)
        self.assertEqual(result["summary"]["not_applicable_count"], 1)
        self.assertEqual(result["summary"]["not_activated_count"], 1)

    def test_weizen_recalculation_provenance_is_preserved(self) -> None:
        result = active_cost_overview_service.build_active_cost_overview(
            _dossier(
                [
                    _sku(
                        "weizen-box",
                        "Berlewalde Weizen - Doos 24 * 33cl",
                        beer_name="Berlewalde Weizen",
                        subject_id="beer-weizen",
                    )
                ]
            )
        )

        row = result["groups"][0]["items"][0]
        self.assertEqual(row["provenance_kind"], "recalculated_from_source_year")
        self.assertEqual(row["provenance_source_year"], 2025)
        self.assertEqual(row["cost_method"], "inkoop")

    def test_duplicate_sku_fails_closed_instead_of_cloning_a_cross_reference(self) -> None:
        row = _sku("shared-bundle", "Alles onder de boom")
        result = active_cost_overview_service.build_active_cost_overview(_dossier([row, dict(row)]))

        self.assertEqual(result["status"], "missing")
        self.assertIn("active_generation_duplicate_sku", result["reason_codes"])
        self.assertEqual(result["groups"], [])

    def test_non_active_or_missing_dossier_is_not_exposed_as_current(self) -> None:
        superseded = _dossier([_sku("sku", "Product")])
        superseded["binding"]["generation_status"] = "superseded"

        result = active_cost_overview_service.build_active_cost_overview(superseded)

        self.assertEqual(result["status"], "missing")
        self.assertIn("commercial_yearset_not_active", result["reason_codes"])


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _Connection:
    def __init__(self):
        self.statements: list[str] = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.statements.append(normalized)
        if normalized == "SET TRANSACTION READ ONLY":
            return _Result([])
        if "FROM kostprijs_sku_activations" in normalized:
            self.assert_year = params[0]
            return _Result([("juweel-box",)])
        raise AssertionError(f"Unexpected SQL: {normalized}")


class ActiveCostOverviewReaderTests(unittest.TestCase):
    def test_reader_uses_read_only_shadow_query_and_never_initializes_schema(self) -> None:
        connection = _Connection()

        @contextmanager
        def connect():
            yield connection

        with (
            patch.object(
                active_cost_overview_service.yearset_dossier_service,
                "read_active_yearset_dossier",
                return_value=_dossier([_sku("juweel-box", "Juweel - Doos 24 * 33cl")]),
            ),
            patch.object(active_cost_overview_service.postgres_storage, "connect", connect),
            patch.object(
                active_cost_overview_service.postgres_storage,
                "ensure_schema",
                side_effect=AssertionError("read path may not initialize schema"),
            ),
        ):
            result = active_cost_overview_service.read_active_cost_overview()

        self.assertEqual(connection.statements[0], "SET TRANSACTION READ ONLY")
        self.assertEqual(connection.assert_year, 2026)
        self.assertEqual(result["shadow_parity"]["status"], "match")


class ActiveCostOverviewFrontendContractTests(unittest.TestCase):
    def test_kostprijs_beheren_uses_the_read_only_active_generation_component(self) -> None:
        workspace = (
            PROJECT_ROOT / "frontend/src/components/KostprijsBeheerWorkspace.tsx"
        ).read_text(encoding="utf-8")
        component = (
            PROJECT_ROOT
            / "frontend/src/components/kostprijsbeheer/ActiveCommercialCostOverview.tsx"
        ).read_text(encoding="utf-8")

        self.assertIn("<ActiveCommercialCostOverview", workspace)
        self.assertNotIn("<ActiveKostprijzenSection", workspace)
        self.assertNotIn("buildActiveRows({", workspace)
        self.assertIn("/meta/commercial-yearsets/active/cost-overview", component)
        self.assertIn('aria-expanded={isOpen}', component)
        self.assertIn("Jaarset bekijken", component)
        self.assertNotIn('method: "POST"', component)


if __name__ == "__main__":
    unittest.main()
