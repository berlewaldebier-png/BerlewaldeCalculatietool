from __future__ import annotations

from contextlib import contextmanager
from datetime import date
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import douano_margin_snapshot_storage  # noqa: E402
from app.domain import douano_margin_service  # noqa: E402


class _Cursor:
    def __init__(self) -> None:
        self.query = ""
        self.values: list[tuple[object, ...]] = []
        self.rowcount = 0

    def __enter__(self) -> _Cursor:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def executemany(self, query: str, values: list[tuple[object, ...]]) -> None:
        self.query = query
        self.values = values
        self.rowcount = 0 if "cost_status IN" in query else len(values)


class _Connection:
    def __init__(self) -> None:
        self.cursor_value = _Cursor()
        self.commits = 0

    def cursor(self) -> _Cursor:
        return self.cursor_value

    def commit(self) -> None:
        self.commits += 1


class ActualCostSnapshotPolicyTests(unittest.TestCase):
    @staticmethod
    def _record() -> dict[str, object]:
        return {
            "source_type": "invoice",
            "source_line_id": 42,
            "cost_status": "resolved_exact_lot",
            "cost_source": "canonical_exact_lot",
            "mapped": True,
            "line_date": "2026-07-01",
        }

    def _run(self, *, preserve_finalized: bool) -> tuple[int, _Connection]:
        connection = _Connection()

        @contextmanager
        def connect():
            yield connection

        with (
            patch.object(douano_margin_snapshot_storage, "ensure_schema"),
            patch.object(
                douano_margin_snapshot_storage.postgres_storage,
                "connect",
                connect,
            ),
            patch.object(
                douano_margin_snapshot_storage.postgres_storage,
                "in_transaction",
                return_value=False,
            ),
        ):
            written = douano_margin_snapshot_storage.upsert_line_snapshots(
                [self._record()],
                preserve_finalized=preserve_finalized,
                recompute_from_year=2026,
            )
        return written, connection

    def test_regular_sync_guard_preserves_finalized_snapshots(self) -> None:
        written, connection = self._run(preserve_finalized=True)

        self.assertEqual(written, 0)
        self.assertIn("missing_lot", connection.cursor_value.query)
        self.assertIn("lot_unmatched_fallback", connection.cursor_value.query)
        self.assertNotIn("resolved_exact_lot'", connection.cursor_value.query)
        self.assertIn("DATE '2026-01-01'", connection.cursor_value.query)

    def test_explicit_correction_path_can_replace_a_snapshot(self) -> None:
        written, connection = self._run(preserve_finalized=False)

        self.assertEqual(written, 1)
        self.assertNotIn(
            "WHERE douano_sales_line_cost_snapshots.cost_status",
            connection.cursor_value.query,
        )

    def test_regular_sync_does_not_insert_a_missing_historical_snapshot(self) -> None:
        record = self._record()
        record["line_date"] = "2025-12-31"
        connection = _Connection()

        @contextmanager
        def connect():
            yield connection

        with (
            patch.object(douano_margin_snapshot_storage, "ensure_schema"),
            patch.object(
                douano_margin_snapshot_storage.postgres_storage,
                "connect",
                connect,
            ),
        ):
            written = douano_margin_snapshot_storage.upsert_line_snapshots(
                [record],
                preserve_finalized=True,
                recompute_from_year=2026,
            )

        self.assertEqual(written, 0)
        self.assertEqual(connection.commits, 0)
        self.assertEqual(connection.cursor_value.values, [])

    def test_multiple_lots_on_one_sales_line_fail_closed(self) -> None:
        class _Resolver:
            def resolve_actual_lot_cost(self, *_args: object, **_kwargs: object) -> object:
                raise AssertionError("Resolver must not pick one of multiple LOTs.")

        result = douano_margin_service._resolve_authoritative_cost_for_sale(
            transaction_number="TX-1",
            transaction_numbers=["TX-1", "TX-2"],
            douano_sku="SKU-1",
            sku_id="sku-id",
            as_of=date(2026, 7, 1),
            quantity=12,
            actual_resolver=_Resolver(),  # type: ignore[arg-type]
            versions_by_id={},
            resolution_context={
                "complete": True,
                "sales_lots": {
                    ("TX-1", "SKU-1"): {"lot_number": "LOT-A"},
                    ("TX-2", "SKU-1"): {"lot_number": "LOT-B"},
                },
                "sales_lot_conflicts": {},
            },
            lot_required=True,
        )

        self.assertTrue(result["missing_cost"])
        self.assertEqual(
            result["actual_resolution_status"],
            "multiple_lots_per_sales_line",
        )
        self.assertEqual(result["candidate_lot_ids"], ["LOT-A", "LOT-B"])


if __name__ == "__main__":
    unittest.main()
