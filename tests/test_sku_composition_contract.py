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

from app.api.routes import data as data_routes
from app.schemas.sku_composition import UpsertBundleRequest


class SkuCompositionContractTests(unittest.TestCase):
    def test_flow_compose_001_persists_article_sku_and_bom_shape(self) -> None:
        datasets: dict[str, list[dict[str, object]]] = {
            "articles": [
                {"id": "giftbox-zwaar", "name": "Geschenkdoos Zwaar", "kind": "packaging_component"},
            ],
            "skus": [
                {"id": "sku-juweel-fles-33cl", "name": "Juweel Fles 33cl", "active": True},
                {"id": "sku-blond-fles-33cl", "name": "Blond Fles 33cl", "active": True},
                {"id": "sku-glas-33cl", "name": "Berlewalde Glas 33cl", "active": True},
            ],
            "bom-lines": [],
        }
        saved: dict[str, list[dict[str, object]]] = {}

        def fake_load(name: str) -> list[dict[str, object]]:
            return deepcopy(datasets.get(name, []))

        def fake_save(name: str, rows: object) -> bool:
            copied = deepcopy(rows)
            self.assertIsInstance(copied, list)
            saved[name] = copied  # type: ignore[assignment]
            datasets[name] = copied  # type: ignore[assignment]
            return True

        payload = UpsertBundleRequest(
            name="Zwaar onder de boom",
            uom="pakket",
            totals_liters=0.99,
            sellable_kind="product",
            bundle_context="giftset",
            product_group="giftset",
            alcohol_category="normaal",
            packaging_type="geschenkdoos",
            composition=[
                {"component_sku_id": "sku-juweel-fles-33cl", "qty": 2},
                {"component_sku_id": "sku-blond-fles-33cl", "qty": 1},
                {"component_sku_id": "sku-glas-33cl", "qty": 1},
            ],
            packaging=[
                {"kind": "packaging_component", "component_id": "giftbox-zwaar", "qty": 1},
            ],
        )

        with patch.object(data_routes.dataset_store, "load_dataset", side_effect=fake_load), patch.object(
            data_routes.dataset_store, "save_dataset", side_effect=fake_save
        ), patch.object(data_routes.postgres_storage, "transaction", return_value=nullcontext()), patch.object(
            data_routes.product_model_storage, "replace_sku_composition_lines", return_value=4
        ) as replace_projection:
            response = data_routes.post_upsert_bundle(payload, {})

        self.assertEqual(response.article_id, "bundle-zwaar-onder-de-boom")
        self.assertEqual(response.sku_id, "sku-bundle-zwaar-onder-de-boom")

        article = next(row for row in saved["articles"] if row.get("id") == response.article_id)
        self.assertEqual(article["kind"], "bundle")
        self.assertEqual(article["pricing_method"], "cost_plus")

        sku = next(row for row in saved["skus"] if row.get("id") == response.sku_id)
        self.assertEqual(sku["article_id"], response.article_id)
        self.assertEqual(sku["kind"], "article")

        bom = [row for row in saved["bom-lines"] if row.get("parent_article_id") == response.article_id]
        self.assertEqual(len(bom), 4)
        self.assertEqual(
            [(row.get("component_sku_id"), row.get("quantity")) for row in bom[:3]],
            [
                ("sku-juweel-fles-33cl", 2.0),
                ("sku-blond-fles-33cl", 1.0),
                ("sku-glas-33cl", 1.0),
            ],
        )
        self.assertEqual(bom[3].get("component_article_id"), "giftbox-zwaar")
        self.assertEqual(bom[3].get("quantity"), 1.0)
        replace_projection.assert_called_once()
        projected = replace_projection.call_args.kwargs
        self.assertEqual(projected["parent_sku_id"], response.sku_id)
        self.assertEqual(projected["lines"], bom)


if __name__ == "__main__":
    unittest.main()
