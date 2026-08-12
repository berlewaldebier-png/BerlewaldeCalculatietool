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

from app.domain import cost_history_service


def _sku(
    sku_id: str,
    *,
    source_anchor_id: str = "source-anchor",
    source_version_id: str = "version-source",
    source_row_id: str = "row-source",
    cost_required: bool = True,
) -> dict:
    return {
        "sku_id": sku_id,
        "sku_code": sku_id.upper(),
        "sku_name": f"Product {sku_id}",
        "beer_name": "Berlewalde Blond",
        "subject_type": "beer",
        "cost_method": "inkoop",
        "provenance_kind": "recalculated_from_source_year",
        "provenance_source_year": 2025,
        "primary_cost": 10,
        "packaging_cost": 1,
        "overhead_cost": 4,
        "excise_cost": 2,
        "cost_price": 17 if cost_required else None,
        "cost_required": cost_required,
        "cost_readiness_status": "ready" if cost_required else "not_required",
        "cost_blocker_codes": [],
        "source": {
            "anchor_id": source_anchor_id,
            "cost_version_id": source_version_id,
            "cost_row_id": source_row_id,
        },
    }


def _dossier(rows: list[dict]) -> dict:
    return {
        "status": "ready",
        "read_only": True,
        "operational_year": 2026,
        "binding": {
            "generation_id": "generation-2026",
            "generation_status": "active",
            "run_id": "run-2026",
            "manifest_hash": "manifest",
            "validation_hash": "validation",
        },
        "audit": {"generation": {"activated_at": "2026-01-01T00:00:00+00:00"}},
        "sku_items": rows,
        "reason_codes": [],
    }


def _anchor(
    sku_id: str,
    *,
    anchor_id: str,
    version_id: str,
    row_id: str,
    planning_year: int = 2025,
) -> dict:
    return {
        "anchor_id": anchor_id,
        "sku_id": sku_id,
        "planning_year": planning_year,
        "activation_id": "activation",
        "cost_version_id": version_id,
        "cost_row_id": row_id,
        "anchor_kind": "first_activation",
        "effective_at": f"{planning_year}-01-01T00:00:00+00:00",
        "inkoop": 10,
        "verpakkingskosten": 1,
        "indirecte_kosten": 4,
        "accijns": 2,
        "kostprijs": 17,
    }


def _version(sku_id: str, row_id: str, version_id: str, *, year: int, cost_source: str) -> dict:
    return {
        "cost_row_id": row_id,
        "cost_version_id": version_id,
        "sku_id": sku_id,
        "source_year": year,
        "version_number": 1,
        "version_status": "definitief",
        "cost_method": "inkoop",
        "cost_source": cost_source,
        "source_ref": "INV-1",
        "supplier": "Leverancier",
        "effective_at": f"{year}-05-01T00:00:00+00:00",
        "inkoop": 10,
        "verpakkingskosten": 1,
        "indirecte_kosten": 4,
        "accijns": 2,
        "kostprijs": 17,
    }


class CostHistoryProjectionTests(unittest.TestCase):
    def test_distinguishes_active_anchor_variants_and_unresolved_evidence(self) -> None:
        source = _sku("source-sku")
        target = _sku(
            "target-sku",
            source_anchor_id="",
            source_version_id="",
            source_row_id="",
        )
        no_cost = _sku(
            "rounding",
            source_anchor_id="",
            source_version_id="",
            source_row_id="",
            cost_required=False,
        )
        result = cost_history_service.build_cost_history(
            _dossier([source, target, no_cost]),
            authority_anchors=[
                _anchor(
                    "source-sku",
                    anchor_id="source-anchor",
                    version_id="version-source",
                    row_id="row-source",
                )
            ],
            target_anchors=[
                _anchor(
                    "target-sku",
                    anchor_id="target-anchor",
                    version_id="version-target",
                    row_id="row-target",
                    planning_year=2026,
                )
            ],
            version_rows=[
                _version("source-sku", "row-source", "version-source", year=2025, cost_source="initial_calculation"),
                _version("source-sku", "row-may", "version-may", year=2026, cost_source="purchase_invoice"),
                _version("target-sku", "row-target", "version-target", year=2026, cost_source="initial_calculation"),
            ],
            canonical_lots=[
                {
                    "lineage_id": "lineage-may",
                    "sku_id": "source-sku",
                    "cost_version_id": "version-may",
                    "cost_row_id": "row-may",
                    "lot_number": "LOT-MAY",
                    "resolution_status": "resolved",
                    "source_type": "purchase_invoice",
                    "source_ref": "INV-MAY",
                }
            ],
            declared_lots=[
                {"cost_version_id": "version-may", "lot_number": "LOT-MAY"}
            ],
            direct_lot_evidence=[
                {
                    "evidence_id": "direct-opening",
                    "sku_id": "source-sku",
                    "lot_number": "OPEN-1",
                    "source_type": "opening_stock",
                }
            ],
        )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["summary"]["sku_count"], 3)
        self.assertEqual(result["summary"]["source_anchor_verified_count"], 1)
        self.assertEqual(result["summary"]["target_anchor_verified_count"], 1)
        self.assertEqual(result["summary"]["not_applicable_count"], 1)
        self.assertEqual(result["summary"]["additional_variant_count"], 1)
        self.assertEqual(result["summary"]["canonical_lot_count"], 1)
        self.assertEqual(result["summary"]["direct_lot_evidence_count"], 1)
        history = next(row for row in result["histories"] if row["sku_id"] == "source-sku")
        self.assertEqual(history["active_anchor"]["authority_status"], "source_anchor_verified")
        self.assertEqual(
            [row["relation_to_anchor"] for row in history["cost_versions"]],
            ["anchor_source", "registered_variant"],
        )
        self.assertIsNone(history["unresolved_evidence"][0]["components"])

    def test_mismatched_source_anchor_fails_closed(self) -> None:
        result = cost_history_service.build_cost_history(
            _dossier([_sku("source-sku")]),
            authority_anchors=[
                _anchor(
                    "source-sku",
                    anchor_id="source-anchor",
                    version_id="wrong-version",
                    row_id="wrong-row",
                )
            ],
        )

        self.assertEqual(result["status"], "missing")
        self.assertIn("planning_anchor_binding_mismatch", result["reason_codes"])

    def test_duplicate_cost_row_identity_fails_closed(self) -> None:
        row = _version("source-sku", "row-source", "version-source", year=2025, cost_source="initial_calculation")
        result = cost_history_service.build_cost_history(
            _dossier([_sku("source-sku")]),
            authority_anchors=[
                _anchor(
                    "source-sku",
                    anchor_id="source-anchor",
                    version_id="version-source",
                    row_id="row-source",
                )
            ],
            version_rows=[row, dict(row)],
        )

        self.assertEqual(result["status"], "missing")
        self.assertIn("duplicate_or_missing_cost_row_identity", result["reason_codes"])

    def test_component_mismatch_remains_visible_without_changing_active_anchor(self) -> None:
        historical = _version(
            "source-sku",
            "row-mismatch",
            "version-mismatch",
            year=2026,
            cost_source="purchase_invoice",
        )
        historical["kostprijs"] = 25
        result = cost_history_service.build_cost_history(
            _dossier([_sku("source-sku")]),
            authority_anchors=[
                _anchor(
                    "source-sku",
                    anchor_id="source-anchor",
                    version_id="version-source",
                    row_id="row-source",
                )
            ],
            version_rows=[historical],
        )

        history = result["histories"][0]
        self.assertEqual(history["active_anchor"]["components"]["cost_price"], 17.0)
        self.assertEqual(history["cost_versions"][0]["component_state"], "component_mismatch")
        self.assertEqual(history["cost_versions"][0]["components"]["cost_price"], 25.0)


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class _Connection:
    def __init__(self):
        self.statements: list[str] = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.statements.append(normalized)
        if normalized == "SET TRANSACTION READ ONLY":
            return _Result([])
        if normalized == "SELECT id FROM commercial_yearsets WHERE status = 'active'":
            return _Result([("generation-2026",)])
        return _Result([])


class CostHistoryReaderTests(unittest.TestCase):
    def test_reader_starts_read_only_and_never_initializes_schema(self) -> None:
        connection = _Connection()

        @contextmanager
        def connect():
            yield connection

        with (
            patch.object(
                cost_history_service.yearset_dossier_service,
                "read_active_yearset_dossier",
                return_value=_dossier(
                    [
                        _sku(
                            "rounding",
                            source_anchor_id="",
                            source_version_id="",
                            source_row_id="",
                            cost_required=False,
                        )
                    ]
                ),
            ),
            patch.object(cost_history_service.postgres_storage, "connect", connect),
            patch.object(
                cost_history_service.postgres_storage,
                "ensure_schema",
                side_effect=AssertionError("read path may not initialize schema"),
            ),
        ):
            result = cost_history_service.read_active_cost_history()

        self.assertEqual(result["status"], "ready")
        self.assertEqual(connection.statements[0], "SET TRANSACTION READ ONLY")
        self.assertTrue(all(not statement.startswith(("INSERT ", "UPDATE ", "DELETE ", "ALTER ", "CREATE ")) for statement in connection.statements))


class CostHistoryFrontendContractTests(unittest.TestCase):
    def test_history_is_lazy_read_only_and_has_accessible_disclosures(self) -> None:
        component = (
            PROJECT_ROOT
            / "frontend/src/components/kostprijsbeheer/ActiveCommercialCostOverview.tsx"
        ).read_text(encoding="utf-8")
        history_component = (
            PROJECT_ROOT
            / "frontend/src/components/kostprijsbeheer/CostHistoryPanel.tsx"
        ).read_text(encoding="utf-8")
        combined = component + history_component

        self.assertIn("/meta/commercial-yearsets/active/cost-history", combined)
        self.assertIn("Alle varianten / historie", combined)
        self.assertIn('aria-expanded={historyOpen}', component)
        self.assertIn("Actief planningsanker", history_component)
        self.assertIn("Geen bedrag: canonieke kostversielijn ontbreekt", history_component)
        self.assertNotIn('method: "POST"', combined)


if __name__ == "__main__":
    unittest.main()
