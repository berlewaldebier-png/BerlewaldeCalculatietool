from __future__ import annotations

import sys
import unittest
from copy import deepcopy
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.api.routes import integrations  # noqa: E402
from app.domain import break_even_planning_service, dataset_store, lot_costs_storage  # noqa: E402


class DouanoWorkflowFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_nth_raw_write_failure_leaves_prior_write_and_rerun_converges(self) -> None:
        items = [
            {"id": 101, "entity_version": 1, "name": "First"},
            {"id": 202, "entity_version": 1, "name": "Second"},
        ]
        raw_state: dict[int, dict[str, Any]] = {}
        sync_states: list[dict[str, Any]] = []
        fail_external_id = 202

        def upsert_raw_object(**kwargs: Any) -> None:
            external_id = int(kwargs["external_id"])
            if external_id == fail_external_id:
                raise RuntimeError("injected second raw write")
            raw_state[external_id] = deepcopy(kwargs["payload"])

        normalized = Mock(return_value=2)

        with patch.object(integrations, "_require_douano_tokens", return_value={"access_token": "test"}), patch.object(
            integrations,
            "_fetch_paged_resource",
            new=AsyncMock(return_value=(items, {"stop_reason": "empty_page"})),
        ), patch.object(
            integrations.douano_sync_storage,
            "upsert_raw_object",
            side_effect=upsert_raw_object,
        ), patch.object(
            integrations.douano_sync_storage,
            "upsert_companies",
            normalized,
        ), patch.object(
            integrations.douano_sync_storage,
            "set_sync_state",
            side_effect=lambda **kwargs: sync_states.append(deepcopy(kwargs)),
        ):
            with self.assertRaises(HTTPException) as raised:
                await integrations.post_douano_sync_companies(max_pages=10, _={})

            self.assertEqual(raised.exception.status_code, 500)
            self.assertEqual(set(raw_state), {101})
            normalized.assert_not_called()
            self.assertFalse(sync_states[-1]["success"])

            fail_external_id = 0
            result = await integrations.post_douano_sync_companies(max_pages=10, _={})

        self.assertEqual(set(raw_state), {101, 202})
        self.assertEqual(result["fetched"], 2)
        self.assertTrue(sync_states[-1]["success"])

    async def test_paging_failure_occurs_before_any_raw_write(self) -> None:
        raw_write = Mock()
        sync_states: list[dict[str, Any]] = []
        fetch_failure = HTTPException(status_code=503, detail="injected page two failure")

        with patch.object(integrations, "_require_douano_tokens", return_value={"access_token": "test"}), patch.object(
            integrations,
            "_fetch_paged_resource",
            new=AsyncMock(side_effect=fetch_failure),
        ), patch.object(
            integrations.douano_sync_storage,
            "upsert_raw_object",
            raw_write,
        ), patch.object(
            integrations.douano_sync_storage,
            "set_sync_state",
            side_effect=lambda **kwargs: sync_states.append(deepcopy(kwargs)),
        ):
            with self.assertRaises(HTTPException) as raised:
                await integrations.post_douano_sync_companies(max_pages=10, _={})

        self.assertEqual(raised.exception.status_code, 503)
        raw_write.assert_not_called()
        self.assertFalse(sync_states[-1]["success"])
        self.assertIn("page two failure", sync_states[-1]["error"])

    async def test_snapshot_failure_keeps_normalized_orders_and_rerun_completes(self) -> None:
        items = [
            {
                "id": 301,
                "entity_version": 4,
                "date": "2026-07-01",
                "ordered_items": [],
                "returned_items": [],
                "miscellaneous_items": [],
            }
        ]
        raw_state: dict[int, dict[str, Any]] = {}
        normalized_state: dict[int, dict[str, Any]] = {}
        sync_states: list[dict[str, Any]] = []
        fail_snapshot = True

        def upsert_raw_object(**kwargs: Any) -> None:
            raw_state[int(kwargs["external_id"])] = deepcopy(kwargs["payload"])

        def upsert_orders(rows: list[dict[str, Any]]) -> dict[str, int]:
            for row in rows:
                normalized_state[int(row["id"])] = deepcopy(row)
            return {"orders": len(rows), "lines": 0}

        def backfill(**_: Any) -> dict[str, int]:
            if fail_snapshot:
                raise RuntimeError("injected snapshot failure")
            return {"computed": 1}

        with patch.object(integrations, "_require_douano_tokens", return_value={"access_token": "test"}), patch.object(
            integrations,
            "_fetch_paged_resource",
            new=AsyncMock(return_value=(items, {"stop_reason": "empty_page"})),
        ), patch.object(
            integrations.douano_sync_storage,
            "upsert_raw_object",
            side_effect=upsert_raw_object,
        ), patch.object(
            integrations.douano_sync_storage,
            "upsert_sales_orders",
            side_effect=upsert_orders,
        ), patch.object(
            integrations.douano_margin_service,
            "backfill_line_snapshots",
            side_effect=backfill,
        ), patch.object(
            integrations.douano_sync_storage,
            "set_sync_state",
            side_effect=lambda **kwargs: sync_states.append(deepcopy(kwargs)),
        ):
            with self.assertRaises(HTTPException) as raised:
                await integrations.post_douano_sync_sales_orders(
                    max_pages=10,
                    since_date="",
                    recompute_snapshots=True,
                    snapshot_limit=100,
                    _={},
                )

            self.assertEqual(raised.exception.status_code, 500)
            self.assertEqual(set(raw_state), {301})
            self.assertEqual(set(normalized_state), {301})
            self.assertFalse(sync_states[-1]["success"])

            fail_snapshot = False
            result = await integrations.post_douano_sync_sales_orders(
                max_pages=10,
                since_date="",
                recompute_snapshots=True,
                snapshot_limit=100,
                _={},
            )

        self.assertEqual(result["snapshot_backfill"], {"computed": 1})
        self.assertTrue(sync_states[-1]["success"])
        self.assertEqual(set(raw_state), {301})
        self.assertEqual(set(normalized_state), {301})


class LotWorkflowFailureTests(unittest.TestCase):
    def test_opening_import_nth_row_failure_leaves_prior_row_and_rerun_converges(self) -> None:
        items = [
            {"id": "opening-1", "status": "ok", "lot_number": "LOT-1", "sku_code": "SKU-1"},
            {"id": "opening-2", "status": "ok", "lot_number": "LOT-2", "sku_code": "SKU-2"},
        ]
        state: dict[str, dict[str, Any]] = {}
        fail_id = "opening-2"

        def upsert(item: dict[str, Any]) -> dict[str, Any]:
            if item["id"] == fail_id:
                raise RuntimeError("injected second LOT row")
            state[str(item["id"])] = deepcopy(item)
            return item

        with patch.object(lot_costs_storage, "_load_opening_lot_rows", return_value=[]), patch.object(
            lot_costs_storage,
            "_normalize_opening_lot_rows",
            return_value=(items, {"rows": 2, "ok": 2, "check": 0}),
        ), patch.object(lot_costs_storage, "upsert_lot_cost_record", side_effect=upsert):
            with self.assertRaisesRegex(RuntimeError, "second LOT row"):
                lot_costs_storage.confirm_opening_lot_import(b"fixture", "opening.csv")

            self.assertEqual(set(state), {"opening-1"})
            fail_id = ""
            result = lot_costs_storage.confirm_opening_lot_import(b"fixture", "opening.csv")

        self.assertEqual(result["summary"]["saved"], 2)
        self.assertEqual(set(state), {"opening-1", "opening-2"})


class NewYearDraftConcurrencyTests(unittest.TestCase):
    def test_same_owner_and_year_is_last_write_wins_with_frozen_fingerprints(self) -> None:
        state: list[dict[str, Any]] = []

        def load_dataset(_: str, default: Any) -> Any:
            return deepcopy(state) if state else deepcopy(default)

        def save_dataset(_: str, rows: Any, *, overwrite: bool = True) -> bool:
            self.assertTrue(overwrite)
            state.clear()
            state.extend(deepcopy(rows))
            return True

        with patch.object(dataset_store, "require_postgres"), patch.object(
            dataset_store.postgres_storage,
            "load_dataset",
            side_effect=load_dataset,
        ), patch.object(
            dataset_store.postgres_storage,
            "save_dataset",
            side_effect=save_dataset,
        ), patch.object(
            dataset_store,
            "_compute_source_fingerprints",
            return_value={"productie": "frozen-source"},
        ):
            first = dataset_store.upsert_new_year_draft(
                owner="alice",
                source_year=2026,
                target_year=2027,
                payload={"tab": "first"},
            )
            second = dataset_store.upsert_new_year_draft(
                owner="alice",
                source_year=2026,
                target_year=2027,
                payload={"tab": "second"},
            )

        self.assertEqual(len(state), 1)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(second["payload"], {"tab": "second"})
        self.assertEqual(second["source_fingerprints"], {"productie": "frozen-source"})
        self.assertEqual(first["source_fingerprints_at"], second["source_fingerprints_at"])


class YearCloseValidationTests(unittest.TestCase):
    def test_critical_error_without_override_stops_before_snapshot_write(self) -> None:
        snapshot_write = Mock()
        with patch.object(
            break_even_planning_service,
            "build_year_close_payload",
            return_value={
                "critical_errors": [{"message": "Voorraadcontrole ontbreekt"}],
                "drivers": {},
            },
        ), patch.object(
            break_even_planning_service.break_even_planning_storage,
            "close_year_snapshot",
            snapshot_write,
        ):
            with self.assertRaisesRegex(ValueError, "Voorraadcontrole ontbreekt"):
                break_even_planning_service.close_year(year=2026)

        snapshot_write.assert_not_called()


if __name__ == "__main__":
    unittest.main()
