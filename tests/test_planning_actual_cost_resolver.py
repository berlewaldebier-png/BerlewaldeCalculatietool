from __future__ import annotations

from copy import deepcopy
from datetime import date
import json
import sys
import time
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import douano_margin_service  # noqa: E402
from app.domain.planning_actual_cost_resolver import (  # noqa: E402
    ActualLotCostResolver,
    CostResolutionSnapshot,
    CostSelectionShadowInput,
    PlanningCostResolver,
    ReadOnlyCostResolutionService,
    compare_cost_selection_shadow,
)


FIXTURE_PATH = (
    PROJECT_ROOT
    / "frontend"
    / "scripts"
    / "fixtures"
    / "planning-lot-cost.synthetic.golden.json"
)


class _Reader:
    def __init__(self, snapshot: CostResolutionSnapshot):
        self.snapshot = snapshot
        self.calls = 0

    def read_cost_resolution_snapshot(self) -> CostResolutionSnapshot:
        self.calls += 1
        return self.snapshot


class PlanningActualCostResolverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        cls.input = cls.fixture["input"]

    def setUp(self) -> None:
        self.snapshot = self._snapshot()
        self.planning = PlanningCostResolver(self.snapshot)
        self.actual = ActualLotCostResolver(self.snapshot, self.planning)

    def _snapshot(self, **overrides: object) -> CostResolutionSnapshot:
        values = {
            "activations": deepcopy(self.input["activations"]),
            "activation_events": deepcopy(self.input["activationEvents"]),
            "cost_versions": deepcopy(self.input["versions"]),
            "cost_rows": [],
            "lot_aliases": [],
            "skus": deepcopy(self.input["skus"]),
            "direct_lot_cost_records": [],
        }
        values.update(overrides)
        return CostResolutionSnapshot.from_records(**values)  # type: ignore[arg-type]

    def _canonical_snapshot(self) -> CostResolutionSnapshot:
        versions = [{**row, "cost_lines": []} for row in deepcopy(self.input["versions"])]
        rows = []
        row_id_by_scope: dict[tuple[str, str], str] = {}
        for version in self.input["versions"]:
            for index, source in enumerate(version.get("cost_lines", [])):
                row_id = f"row:{version['id']}:{source['sku_id']}:{index}"
                row_id_by_scope[(version["id"], source["sku_id"])] = row_id
                rows.append(
                    {
                        **source,
                        "id": row_id,
                        "version_id": version["id"],
                    }
                )
        return CostResolutionSnapshot.from_records(
            activations=(),
            activation_events=(),
            cost_versions=versions,
            cost_rows=rows,
            planning_anchors=[
                {
                    "id": "anchor-case-2026",
                    "sku_id": "sku-case-24",
                    "planning_year": 2026,
                    "cost_version_id": "version-jan",
                    "cost_row_id": row_id_by_scope[("version-jan", "sku-case-24")],
                    "anchor_kind": "first_activation",
                }
            ],
            lot_lineage=[
                {
                    "id": "lineage-jan",
                    "sku_id": "sku-case-24",
                    "lot_exact_key": "LOTJAN",
                    "lot_number": "LOT-JAN",
                    "cost_version_id": "version-jan",
                    "cost_row_id": row_id_by_scope[("version-jan", "sku-case-24")],
                    "resolution_status": "resolved",
                },
                {
                    "id": "lineage-may",
                    "sku_id": "sku-case-24",
                    "lot_exact_key": "LOTMAY",
                    "lot_number": "LOT-MAY",
                    "cost_version_id": "version-may",
                    "cost_row_id": row_id_by_scope[("version-may", "sku-case-24")],
                    "resolution_status": "resolved",
                },
                {
                    "id": "lineage-ambiguous",
                    "sku_id": "sku-case-24",
                    "lot_exact_key": "DUPLOT",
                    "resolution_status": "ambiguous",
                    "candidate_version_ids": ["version-ambiguous-a", "version-ambiguous-b"],
                    "candidate_cost_row_ids": [
                        row_id_by_scope[("version-ambiguous-a", "sku-case-24")],
                        row_id_by_scope[("version-ambiguous-b", "sku-case-24")],
                    ],
                },
            ],
            skus=deepcopy(self.input["skus"]),
            authority_mode="canonical",
        )

    def _current_actual(self, *, transaction: str, lot: str | None) -> dict:
        versions_by_id = {row["id"]: row for row in self.input["versions"]}
        cost_index = {
            (version["id"], row["sku_id"]): float(row["kostprijs"])
            for version in self.input["versions"]
            for row in version.get("cost_lines", [])
        }
        component_index = {
            (version["id"], row["sku_id"]): {
                "inkoop": float(row.get("inkoop", 0) or 0),
                "verpakkingskosten": float(row.get("verpakkingskosten", 0) or 0),
                "indirecte_kosten": float(row.get("indirecte_kosten", 0) or 0),
                "accijns": float(row.get("accijns", 0) or 0),
                "kostprijs": float(row.get("kostprijs", 0) or 0),
            }
            for version in self.input["versions"]
            for row in version.get("cost_lines", [])
        }
        return douano_margin_service._resolve_cost_for_sale(
            transaction_number=transaction,
            douano_sku="EXT-CASE-24",
            sku_id="sku-case-24",
            as_of=date(2026, 7, 1),
            quantity=1,
            activations_index=douano_margin_service._build_activation_index(
                self.input["activations"]
            ),
            versions_by_id=versions_by_id,
            snapshot_cost_index=cost_index,
            snapshot_components_index=component_index,
            resolution_context={
                **douano_margin_service._build_version_lot_context(
                    versions_by_id,
                    cost_index,
                ),
                "complete": True,
                "sales_lots": {
                    (transaction, "EXT-CASE-24"): {
                        "lot_number": lot or "",
                        "transaction_number": transaction,
                    }
                },
                "alias_by_lot": {},
                "lot_cost_by_lot": {},
            },
        )

    def test_first_approved_activation_is_stable_planning_anchor(self) -> None:
        purchased = self.planning.resolve_planning_cost("sku-case-24", 2026)
        own = self.planning.resolve_planning_cost("sku-own-case", 2026)
        new_format = self.planning.resolve_planning_cost("sku-fust", 2026)
        next_year = self.planning.resolve_planning_cost("sku-case-24", 2027)

        self.assertEqual(purchased.status, "resolved")
        self.assertEqual(purchased.source, "first_observable_activation")
        self.assertEqual(purchased.cost_version_id, "version-jan")
        self.assertEqual(purchased.cost_price_ex, 14)
        self.assertEqual(purchased.components.purchase_ex, 10)  # type: ignore[union-attr]
        self.assertEqual(own.cost_version_id, "version-own-first")
        self.assertEqual(new_format.cost_version_id, "version-new-format")
        self.assertEqual(next_year.cost_version_id, "version-next-year")

    def test_only_explicit_approved_rebaseline_replaces_first_anchor(self) -> None:
        result = self.planning.resolve_planning_cost("sku-rebaseline", 2026)
        self.assertEqual(result.status, "resolved")
        self.assertEqual(result.source, "explicit_approved_rebaseline")
        self.assertEqual(result.cost_version_id, "version-rebaseline-approved")
        self.assertEqual(result.cost_price_ex, 31)

    def test_textual_rebaseline_approval_is_not_treated_as_boolean_approval(self) -> None:
        events = deepcopy(self.input["activationEvents"])
        for row in events:
            if row["id"] == "evt-rebase-approved":
                row["metadata"]["approved"] = "false"
        result = PlanningCostResolver(
            self._snapshot(activation_events=events)
        ).resolve_planning_cost("sku-rebaseline", 2026)
        self.assertEqual(result.source, "first_observable_activation")
        self.assertEqual(result.cost_version_id, "version-rebaseline-first")

    def test_equal_moment_conflict_is_ambiguous_instead_of_id_tiebreak(self) -> None:
        events = deepcopy(self.input["activationEvents"])
        events.append(
            {
                "id": "evt-conflict",
                "sku_id": "sku-case-24",
                "jaar": 2026,
                "kostprijsversie_id": "version-may",
                "effectief_vanaf": "2026-01-10T00:00:00Z",
                "action": "activate",
                "metadata": {},
            }
        )
        resolver = PlanningCostResolver(self._snapshot(activation_events=events))
        result = resolver.resolve_planning_cost("sku-case-24", 2026)
        self.assertEqual(result.status, "ambiguous_anchor")
        self.assertEqual(
            result.candidate_version_ids,
            ("version-jan", "version-may"),
        )
        self.assertIsNone(result.cost_price_ex)

    def test_duplicate_canonical_cost_row_is_blocking(self) -> None:
        rows = [
            {
                "id": "row-a",
                "version_id": "version-jan",
                "sku_id": "sku-case-24",
                "kostprijs": 14,
            },
            {
                "id": "row-b",
                "version_id": "version-jan",
                "sku_id": "sku-case-24",
                "kostprijs": 14,
            },
        ]
        versions = [
            {**row, "cost_lines": []}
            for row in deepcopy(self.input["versions"])
        ]
        resolver = PlanningCostResolver(
            self._snapshot(cost_versions=versions, cost_rows=rows)
        )
        result = resolver.resolve_planning_cost("sku-case-24", 2026)
        self.assertEqual(result.status, "ambiguous_cost_row")
        self.assertEqual(result.candidate_cost_row_ids, ("row-a", "row-b"))

    def test_explicit_canonical_cost_row_precedes_embedded_compatibility_row(self) -> None:
        canonical = {
            "id": "canonical-row",
            "version_id": "version-jan",
            "sku_id": "sku-case-24",
            "inkoop": 11,
            "verpakkingskosten": 1,
            "indirecte_kosten": 2,
            "accijns": 1,
            "kostprijs": 15,
        }
        result = PlanningCostResolver(
            self._snapshot(cost_rows=[canonical])
        ).resolve_planning_cost("sku-case-24", 2026)
        self.assertEqual(result.status, "resolved")
        self.assertEqual(result.cost_row_id, "canonical-row")
        self.assertEqual(result.cost_price_ex, 15)

    def test_exact_lot_wins_without_order_date_selection(self) -> None:
        january = self.actual.resolve_actual_lot_cost("sku-case-24", "LOT-JAN")
        may = self.actual.resolve_actual_lot_cost("sku-case-24", "lot may")

        self.assertEqual(january.status, "resolved_exact_lot")
        self.assertEqual(january.source, "exact_lot")
        self.assertEqual(january.cost_version_id, "version-jan")
        self.assertEqual(january.cost_price_ex, 14)
        self.assertEqual(may.cost_version_id, "version-may")
        self.assertEqual(may.cost_price_ex, 17)

    def test_explicit_alias_can_resolve_exact_internal_lot(self) -> None:
        alias = {
            "id": "alias-jan",
            "sku_id": "sku-case-24",
            "douano_lot_number": "SUPPLIER-JAN",
            "internal_lot_number": "LOT-JAN",
        }
        resolver = ActualLotCostResolver(self._snapshot(lot_aliases=[alias]))
        result = resolver.resolve_actual_lot_cost("sku-case-24", "SUPPLIER-JAN")
        self.assertEqual(result.status, "resolved_exact_lot")
        self.assertEqual(result.source, "exact_lot_alias")
        self.assertEqual(result.lot_mapping_id, "alias-jan")
        self.assertEqual(result.cost_version_id, "version-jan")

    def test_sku_code_scoped_alias_is_projected_through_canonical_sku(self) -> None:
        skus = deepcopy(self.input["skus"])
        skus[0]["code"] = "CASE-24"
        alias = {
            "id": "alias-code-jan",
            "sku_code": "case-24",
            "douano_lot_number": "SUPPLIER-CODE-JAN",
            "internal_lot_number": "LOT-JAN",
        }
        resolver = ActualLotCostResolver(
            self._snapshot(lot_aliases=[alias], skus=skus)
        )
        result = resolver.resolve_actual_lot_cost("sku-case-24", "SUPPLIER-CODE-JAN")
        self.assertEqual(result.status, "resolved_exact_lot")
        self.assertEqual(result.lot_mapping_id, "alias-code-jan")
        self.assertEqual(result.cost_version_id, "version-jan")

    def test_conflicting_aliases_are_blocking(self) -> None:
        aliases = [
            {
                "id": "alias-a",
                "sku_id": "sku-case-24",
                "douano_lot_number": "RAW",
                "internal_lot_number": "LOT-JAN",
            },
            {
                "id": "alias-b",
                "sku_id": "sku-case-24",
                "douano_lot_number": "RAW",
                "internal_lot_number": "LOT-MAY",
            },
        ]
        result = ActualLotCostResolver(
            self._snapshot(lot_aliases=aliases)
        ).resolve_actual_lot_cost("sku-case-24", "RAW")
        self.assertEqual(result.status, "ambiguous_lot_mapping")
        self.assertEqual(result.candidate_mapping_ids, ("alias-a", "alias-b"))
        self.assertIsNone(result.cost_price_ex)

    def test_direct_lot_record_without_canonical_lineage_is_visible_but_not_repriced(self) -> None:
        direct_record = {
            "id": "direct-lot-record",
            "sku_id": "sku-case-24",
            "lot_number": "DIRECT-LOT",
            "purchase_price_ex_excise": 99,
        }
        result = ActualLotCostResolver(
            self._snapshot(direct_lot_cost_records=[direct_record])
        ).resolve_actual_lot_cost("sku-case-24", "DIRECT-LOT")
        self.assertEqual(result.status, "missing_canonical_lot_lineage")
        self.assertEqual(result.source, "direct_lot_record_unlinked")
        self.assertEqual(
            result.candidate_lot_cost_record_ids,
            ("direct-lot-record",),
        )
        self.assertIsNone(result.cost_price_ex)

    def test_missing_unknown_near_and_ambiguous_lot_never_use_planning_fallback(self) -> None:
        missing = self.actual.resolve_actual_lot_cost("sku-case-24", "")
        unknown = self.actual.resolve_actual_lot_cost("sku-case-24", "UNKNOWN")
        near = self.actual.resolve_actual_lot_cost("sku-case-24", "L0T-JAN")
        ambiguous = self.actual.resolve_actual_lot_cost("sku-case-24", "DUP-LOT")

        self.assertEqual(missing.status, "missing_lot")
        self.assertEqual(unknown.status, "unknown_lot")
        self.assertEqual(near.status, "unknown_lot")
        self.assertIn("near_lot_match_requires_explicit_mapping", near.warnings)
        self.assertEqual(ambiguous.status, "ambiguous_exact_lot")
        self.assertEqual(
            ambiguous.candidate_version_ids,
            ("version-ambiguous-a", "version-ambiguous-b"),
        )
        for result in (missing, unknown, near, ambiguous):
            self.assertIsNone(result.cost_price_ex)
            self.assertNotEqual(result.source, "planning_anchor")

    def test_lot_and_cost_requirement_are_independent_explicit_policies(self) -> None:
        non_lot = self.actual.resolve_actual_lot_cost(
            "sku-case-24",
            "",
            lot_requirement="not_required",
            planning_year=2026,
        )
        rounding = self.actual.resolve_actual_lot_cost(
            "",
            "",
            cost_requirement="not_required",
        )
        ignored = self.actual.resolve_actual_lot_cost(
            "",
            "",
            cost_requirement="ignored",
        )

        self.assertEqual(non_lot.status, "resolved_non_lot_sku_cost")
        self.assertEqual(non_lot.cost_version_id, "version-jan")
        self.assertEqual(non_lot.cost_price_ex, 14)
        self.assertEqual(rounding.status, "no_cost_required")
        self.assertIsNone(rounding.cost_price_ex)
        self.assertEqual(ignored.status, "ignored")

    def test_non_lot_cost_requires_explicit_year(self) -> None:
        result = self.actual.resolve_actual_lot_cost(
            "sku-case-24",
            "",
            lot_requirement="not_required",
        )
        self.assertEqual(result.status, "missing_planning_year")
        self.assertIsNone(result.cost_price_ex)

    def test_shadow_exposes_current_planning_and_actual_fallback_differences(self) -> None:
        exact_current = self._current_actual(transaction="TX-JAN", lot="LOT-JAN")
        missing_current = self._current_actual(transaction="TX-NO-LOT", lot=None)
        ambiguous_current = self._current_actual(transaction="TX-DUP", lot="DUP-LOT")
        differences = compare_cost_selection_shadow(
            planning_resolver=self.planning,
            actual_resolver=self.actual,
            current=[
                CostSelectionShadowInput(
                    consumer="price_proposal",
                    mode="planning",
                    sku_id="sku-case-24",
                    year=2026,
                    current_status="resolved",
                    current_cost_version_id="version-may",
                ),
                CostSelectionShadowInput(
                    consumer="break_even",
                    mode="planning",
                    sku_id="sku-case-24",
                    year=2026,
                    current_status="resolved",
                    current_cost_version_id="version-may",
                ),
                CostSelectionShadowInput(
                    consumer="omzet_en_marge",
                    mode="actual",
                    sku_id="sku-case-24",
                    lot_id="LOT-JAN",
                    current_status="resolved_exact_lot",
                    current_cost_version_id=exact_current["kostprijsversie_id"],
                ),
                CostSelectionShadowInput(
                    consumer="omzet_en_marge",
                    mode="actual",
                    sku_id="sku-case-24",
                    lot_id="",
                    current_status="fallback_active_sku_cost",
                    current_cost_version_id=missing_current["kostprijsversie_id"],
                ),
                CostSelectionShadowInput(
                    consumer="omzet_en_marge",
                    mode="actual",
                    sku_id="sku-case-24",
                    lot_id="DUP-LOT",
                    current_status="resolved_exact_lot",
                    current_cost_version_id=ambiguous_current["kostprijsversie_id"],
                ),
            ],
        )
        reasons = [row.reason for row in differences]
        self.assertEqual(
            reasons.count("current_latest_activation_differs_from_planning_anchor"),
            2,
        )
        self.assertEqual(
            reasons.count("current_actual_fallback_masks_unresolved_lot"),
            2,
        )
        self.assertFalse(
            any(
                row.lot_id == "LOT-JAN" and row.field in {"status", "cost_version"}
                for row in differences
            )
        )

    def test_reader_is_called_once_and_resolver_is_read_only(self) -> None:
        original = deepcopy(self.input)
        reader = _Reader(self.snapshot)
        service = ReadOnlyCostResolutionService(reader)

        service.planning.resolve_planning_cost("sku-case-24", 2026)
        service.actual.resolve_actual_lot_cost("sku-case-24", "LOT-JAN")

        self.assertEqual(reader.calls, 1)
        self.assertEqual(self.input, original)

    def test_canonical_mode_uses_only_persisted_anchor_and_lot_lineage(self) -> None:
        snapshot = self._canonical_snapshot()
        planning = PlanningCostResolver(snapshot)
        actual = ActualLotCostResolver(snapshot, planning)

        anchor = planning.resolve_planning_cost("sku-case-24", 2026)
        january = actual.resolve_actual_lot_cost("sku-case-24", "LOT-JAN")
        may = actual.resolve_actual_lot_cost("sku-case-24", "LOT-MAY")

        self.assertEqual(anchor.source, "canonical_first_activation_anchor")
        self.assertEqual(anchor.cost_version_id, "version-jan")
        self.assertEqual(january.source, "canonical_exact_lot")
        self.assertEqual(january.cost_price_ex, 14)
        self.assertEqual(may.cost_version_id, "version-may")
        self.assertEqual(may.cost_price_ex, 17)

    def test_canonical_ambiguity_and_unknown_lot_fail_closed(self) -> None:
        actual = ActualLotCostResolver(self._canonical_snapshot())

        ambiguous = actual.resolve_actual_lot_cost("sku-case-24", "DUP-LOT")
        unknown = actual.resolve_actual_lot_cost("sku-case-24", "NOT-REGISTERED")

        self.assertEqual(ambiguous.status, "ambiguous_exact_lot")
        self.assertEqual(
            ambiguous.candidate_version_ids,
            ("version-ambiguous-a", "version-ambiguous-b"),
        )
        self.assertIsNone(ambiguous.cost_price_ex)
        self.assertEqual(unknown.status, "unknown_lot")
        self.assertIsNone(unknown.cost_price_ex)

    def test_canonical_non_lot_cost_uses_the_persisted_anchor(self) -> None:
        actual = ActualLotCostResolver(self._canonical_snapshot())
        result = actual.resolve_actual_lot_cost(
            "sku-case-24",
            "",
            lot_requirement="not_required",
            planning_year=2026,
        )

        self.assertEqual(result.status, "resolved_non_lot_sku_cost")
        self.assertEqual(result.source, "planning_anchor_for_non_lot_sku")
        self.assertEqual(result.cost_version_id, "version-jan")
        self.assertEqual(result.cost_price_ex, 14)

    def test_margin_adapter_does_not_turn_unknown_lot_into_planning_cost(self) -> None:
        snapshot = self._canonical_snapshot()
        resolver = ActualLotCostResolver(snapshot, PlanningCostResolver(snapshot))
        versions = {str(row["id"]): row for row in snapshot.cost_versions}
        result = douano_margin_service._resolve_authoritative_cost_for_sale(
            transaction_number="TX-UNKNOWN",
            transaction_numbers=None,
            douano_sku="EXT-CASE-24",
            sku_id="sku-case-24",
            as_of=date(2026, 7, 1),
            quantity=2,
            actual_resolver=resolver,
            versions_by_id=versions,
            resolution_context={
                "complete": True,
                "sales_lots": {
                    ("TX-UNKNOWN", "EXT-CASE-24"): {
                        "lot_number": "NOT-REGISTERED",
                        "transaction_number": "TX-UNKNOWN",
                    }
                },
            },
            lot_required=True,
        )

        self.assertEqual(result["actual_resolution_status"], "unknown_lot")
        self.assertTrue(result["missing_cost"])
        self.assertIsNone(result["cost_price_ex"])
        self.assertEqual(result["kostprijsversie_id"], "")
        self.assertEqual(result["resolution_policy_version"], "rf-012c3-v1")

    def test_margin_adapter_returns_components_from_the_canonical_cost_row(self) -> None:
        snapshot = self._canonical_snapshot()
        resolver = ActualLotCostResolver(snapshot, PlanningCostResolver(snapshot))
        result = douano_margin_service._resolve_authoritative_cost_for_sale(
            transaction_number="TX-MAY",
            transaction_numbers=None,
            douano_sku="EXT-CASE-24",
            sku_id="sku-case-24",
            as_of=date(2026, 7, 1),
            quantity=2,
            actual_resolver=resolver,
            versions_by_id={str(row["id"]): row for row in snapshot.cost_versions},
            resolution_context={
                "complete": True,
                "sales_lots": {
                    ("TX-MAY", "EXT-CASE-24"): {
                        "lot_number": "LOT-MAY",
                        "transaction_number": "TX-MAY",
                    }
                },
            },
            lot_required=True,
        )

        self.assertEqual(result["actual_resolution_status"], "resolved_exact_lot")
        self.assertEqual(result["cost_price_ex"], 17)
        self.assertEqual(result["cost_components"]["kostprijs"], 17)
        self.assertIn("accijns", result["cost_components"])

    def test_indexed_resolution_is_bounded_for_development_shaped_volume(self) -> None:
        activations = []
        events = []
        versions = []
        for index in range(2000):
            sku_id = f"sku-{index}"
            version_id = f"version-{index}"
            activations.append(
                {
                    "id": f"activation-{index}",
                    "sku_id": sku_id,
                    "jaar": 2026,
                    "kostprijsversie_id": version_id,
                    "effectief_vanaf": "2026-01-01T00:00:00Z",
                }
            )
            events.append(
                {
                    "id": f"event-{index}",
                    "sku_id": sku_id,
                    "jaar": 2026,
                    "kostprijsversie_id": version_id,
                    "effectief_vanaf": "2026-01-01T00:00:00Z",
                    "action": "activate",
                }
            )
            versions.append(
                {
                    "id": version_id,
                    "jaar": 2026,
                    "lot_exact_key": f"LOT{index}",
                    "cost_lines": [{"sku_id": sku_id, "kostprijs": index + 1}],
                }
            )
        started = time.perf_counter()
        snapshot = CostResolutionSnapshot.from_records(
            activations=activations,
            activation_events=events,
            cost_versions=versions,
        )
        planning = PlanningCostResolver(snapshot)
        actual = ActualLotCostResolver(snapshot, planning)
        result = actual.resolve_actual_lot_cost("sku-1999", "LOT-1999")
        elapsed = time.perf_counter() - started

        self.assertEqual(result.status, "resolved_exact_lot")
        self.assertEqual(result.cost_price_ex, 2000)
        self.assertLess(elapsed, 2.0)


if __name__ == "__main__":
    unittest.main()
