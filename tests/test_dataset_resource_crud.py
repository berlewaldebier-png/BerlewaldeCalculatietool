from __future__ import annotations

from contextlib import nullcontext
from copy import deepcopy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.domain import dataset_store
from app.api import utils as api_utils


class DatasetResourceCrudTests(unittest.TestCase):
    def test_patch_requires_current_etag(self) -> None:
        state = [{"id": "retail", "label": "Retail", "active": True}]

        def fake_load(_: str) -> list[dict[str, object]]:
            return deepcopy(state)

        def fake_save(_: str, data: object) -> bool:
            state.clear()
            state.extend(deepcopy(data))  # type: ignore[arg-type]
            return True

        with patch("app.domain.dataset_store.load_dataset", side_effect=fake_load), patch(
            "app.domain.dataset_store.save_dataset", side_effect=fake_save
        ), patch("app.domain.dataset_store.postgres_storage.transaction", return_value=nullcontext()):
            current = dataset_store.get_dataset_item("channels", "retail")
            with self.assertRaises(dataset_store.DatasetPreconditionRequiredError):
                dataset_store.patch_dataset_item("channels", "retail", {"label": "Retail NL"}, expected_etag=None)
            updated = dataset_store.patch_dataset_item(
                "channels",
                "retail",
                {"label": "Retail NL"},
                expected_etag=str(current["etag"]),
            )

        self.assertEqual(updated["item"]["label"], "Retail NL")
        self.assertEqual(state[0]["label"], "Retail NL")

    def test_stale_etag_rejects_lost_update(self) -> None:
        state = [{"id": "retail", "label": "Retail", "active": True}]
        stale_etag = dataset_store.compute_dataset_etag({"id": "retail", "label": "Old", "active": True})

        with patch("app.domain.dataset_store.load_dataset", return_value=deepcopy(state)), patch(
            "app.domain.dataset_store.save_dataset", side_effect=AssertionError("stale write should not save")
        ), patch("app.domain.dataset_store.postgres_storage.transaction", return_value=nullcontext()):
            with self.assertRaises(dataset_store.DatasetConflictError):
                dataset_store.replace_dataset_item(
                    "channels",
                    "retail",
                    {"id": "retail", "label": "Retail NL", "active": True},
                    expected_etag=stale_etag,
                )

    def test_create_rejects_duplicate_id(self) -> None:
        with patch("app.domain.dataset_store.load_dataset", return_value=[{"id": "retail"}]), patch(
            "app.domain.dataset_store.save_dataset", side_effect=AssertionError("duplicate should not save")
        ), patch("app.domain.dataset_store.postgres_storage.transaction", return_value=nullcontext()):
            with self.assertRaises(dataset_store.DatasetConflictError):
                dataset_store.create_dataset_item("channels", {"id": "retail"})

    def test_bulk_put_gate_blocks_list_datasets_in_production(self) -> None:
        with patch.dict("os.environ", {"CALCULATIETOOL_ENV": "production"}):
            self.assertTrue(api_utils._production_bulk_put_disabled("cost-pools"))
            self.assertFalse(api_utils._production_bulk_put_disabled("vaste-kosten"))
            self.assertFalse(api_utils._production_bulk_put_disabled("packaging-component-prices"))


if __name__ == "__main__":
    unittest.main()
