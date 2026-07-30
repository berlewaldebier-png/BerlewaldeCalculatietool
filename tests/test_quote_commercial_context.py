from __future__ import annotations

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

from app.domain import quote_commercial_context_service


def _generation(*, status: str = "active") -> dict:
    return {
        "id": "generation-2026",
        "operational_year": 2026,
        "status": status,
        "readiness_status": "ready",
        "validation_hash": "generation-validation",
    }


def _run(*, status: str = "active") -> dict:
    return {
        "id": "run-2026",
        "generation_id": "generation-2026",
        "status": status,
        "readiness_status": "ready",
        "manifest_hash": "manifest-2026",
        "validation_hash": "run-validation",
    }


def _row(sku_id: str, **overrides) -> dict:
    row = {
        "sku_id": sku_id,
        "scope_classification": "carried_forward",
        "subject_type": "beer",
        "subject_id": "beer-blond",
        "canonical_beer_id": "beer-blond",
        "format_article_id": "format-case",
        "sku_kind": "composite",
        "source_anchor_id": "anchor-2025",
        "source_cost_version_id": "cost-version-2025",
        "source_cost_row_id": "cost-row-2025",
        "reserved_target_version_id": "cost-version-2026",
        "reserved_target_cost_row_id": "cost-row-2026",
        "calculation_method": "cost-engine-v1",
        "provenance_kind": "recalculated_from_source_year",
        "provenance_source_year": 2025,
        "primary_cost": "10",
        "packaging_cost": "1",
        "overhead_cost": "9",
        "excise_cost": "4",
        "cost_price": "24",
        "liters_per_unit": "7.92",
        "cost_required": True,
        "cost_readiness_status": "ready",
        "cost_blocker_codes": [],
        "price_id": "price-2026",
        "source_pricing_id": "price-2025",
        "target_pricing_id": "price-target-2026",
        "list_price": "38",
        "price_readiness_status": "ready",
        "price_blocker_codes": [],
    }
    row.update(overrides)
    return row


class QuoteCommercialContextProjectionTests(unittest.TestCase):
    def test_active_generation_exposes_exact_cost_price_and_binding(self) -> None:
        result = quote_commercial_context_service.build_quote_commercial_context(
            generation=_generation(),
            run=_run(),
            rows=[_row("sku-blond-case")],
        )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["binding"]["generation_id"], "generation-2026")
        self.assertEqual(result["binding"]["run_id"], "run-2026")
        self.assertEqual(result["binding"]["operational_year"], 2026)
        self.assertEqual(result["binding"]["manifest_hash"], "manifest-2026")
        self.assertEqual(result["summary"]["quote_ready_count"], 1)
        item = result["items"][0]
        self.assertEqual(item["sku_id"], "sku-blond-case")
        self.assertEqual(item["cost_price"], 24.0)
        self.assertEqual(item["list_price"], 38.0)
        self.assertEqual(item["cost_version_id"], "cost-version-2026")
        self.assertEqual(item["quote_readiness_status"], "ready")

    def test_exclusion_keeps_typed_reasons_instead_of_silently_dropping_sku(
        self,
    ) -> None:
        result = quote_commercial_context_service.build_quote_commercial_context(
            generation=_generation(),
            run=_run(),
            rows=[
                _row(
                    "sku-catalog",
                    scope_classification="catalog_reference_only",
                    cost_required=False,
                    cost_readiness_status="not_required",
                    cost_price=None,
                    price_id="",
                    list_price=None,
                    price_readiness_status="",
                )
            ],
        )

        item = result["items"][0]
        self.assertEqual(item["quote_readiness_status"], "excluded")
        self.assertIn("quote_catalog_reference_only", item["reason_codes"])
        self.assertIn("quote_sell_in_missing", item["reason_codes"])
        self.assertEqual(result["summary"]["excluded_count"], 1)
        self.assertEqual(
            result["summary"]["exclusion_counts"]["quote_catalog_reference_only"],
            1,
        )

    def test_non_operational_generation_fails_closed(self) -> None:
        result = quote_commercial_context_service.build_quote_commercial_context(
            generation=_generation(status="candidate"),
            run=_run(status="approved"),
            rows=[_row("sku-blond-case")],
            requested_generation_id="generation-2026",
        )

        self.assertEqual(result["status"], "missing")
        self.assertEqual(result["items"], [])
        self.assertIn(
            "requested_commercial_generation_not_operational",
            result["reason_codes"],
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
        if "FROM commercial_yearset_candidate_skus" in normalized:
            row = _row("sku-blond-case")
            ordered = (
                row["sku_id"],
                row["scope_classification"],
                row["subject_type"],
                row["subject_id"],
                row["canonical_beer_id"],
                row["format_article_id"],
                row["sku_kind"],
                row["source_anchor_id"],
                row["source_cost_version_id"],
                row["source_cost_row_id"],
                row["reserved_target_version_id"],
                row["reserved_target_cost_row_id"],
                row["calculation_method"],
                row["provenance_kind"],
                row["provenance_source_year"],
                row["primary_cost"],
                row["packaging_cost"],
                row["overhead_cost"],
                row["excise_cost"],
                row["cost_price"],
                row["liters_per_unit"],
                row["cost_required"],
                row["cost_readiness_status"],
                json.dumps(row["cost_blocker_codes"]),
                row["price_id"],
                row["source_pricing_id"],
                row["target_pricing_id"],
                row["list_price"],
                row["price_readiness_status"],
                json.dumps(row["price_blocker_codes"]),
            )
            return _Result(all_rows=[ordered])
        raise AssertionError(f"Unexpected SQL: {normalized}")


class QuoteCommercialContextReaderTests(unittest.TestCase):
    def test_reader_starts_read_only_and_does_not_initialize_schema(self) -> None:
        connection = _ReadOnlyConnection()

        @contextmanager
        def connect():
            yield connection

        with (
            patch.object(
                quote_commercial_context_service.postgres_storage,
                "connect",
                connect,
            ),
            patch.object(
                quote_commercial_context_service.postgres_storage,
                "ensure_schema",
                side_effect=AssertionError("read path may not initialize schema"),
            ),
        ):
            result = (
                quote_commercial_context_service.read_quote_commercial_context()
            )

        self.assertEqual(connection.statements[0], "SET TRANSACTION READ ONLY")
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["summary"]["quote_ready_count"], 1)


if __name__ == "__main__":
    unittest.main()
