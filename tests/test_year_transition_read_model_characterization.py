from __future__ import annotations

import unittest
from contextlib import AbstractContextManager
from pathlib import Path
import sys
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.domain import cost_versions_storage


class _FakeCursor(AbstractContextManager):
    def __init__(self, historical_payload: dict) -> None:
        self._rows: list[tuple] = []
        self._historical_payload = historical_payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def execute(self, query: str, _params=None):
        normalized = " ".join(query.split()).lower()
        if "from cost_versions" in normalized:
            self._rows = [
                (
                    "version-2025-composed",
                    2025,
                    "definitief",
                    "beer-001",
                    1,
                    None,
                    None,
                    None,
                    self._historical_payload,
                )
            ]
        elif "from cost_version_sku_rows" in normalized:
            self._rows = [
                (
                    "cost-row-composed",
                    "version-2025-composed",
                    "sku-composed",
                    "Synthetic box",
                    1.0,
                    0.5,
                    0.25,
                    0.25,
                    2.0,
                    0,
                )
            ]
        elif "select id, beer_id, format_article_id, article_id, name, code from skus" in normalized:
            self._rows = [
                (
                    "sku-composed",
                    "beer-001",
                    "",
                    "article-composed",
                    "Synthetic box",
                    "SYN-BOX",
                )
            ]
        else:
            raise AssertionError(f"Unexpected characterization query: {normalized}")
        return self

    def fetchall(self):
        return list(self._rows)


class _FakeConnection(AbstractContextManager):
    def __init__(self, historical_payload: dict) -> None:
        self._historical_payload = historical_payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def cursor(self):
        return _FakeCursor(self._historical_payload)


class YearTransitionReadModelCharacterizationTests(unittest.TestCase):
    def test_normalized_rows_currently_replace_original_product_categories(self) -> None:
        historical_payload = {
            "type": "eigen_productie",
            "basisgegevens": {"jaar": 2025, "biernaam": "Synthetic beer"},
            "resultaat_snapshot": {
                "producten": {
                    "basisproducten": [
                        {
                            "sku_id": "sku-basis",
                            "product_id": "article-basis",
                            "product_type": "basis",
                            "kostprijs": 1.0,
                        }
                    ],
                    "samengestelde_producten": [
                        {
                            "sku_id": "sku-composed",
                            "product_id": "article-composed",
                            "product_type": "samengesteld",
                            "kostprijs": 2.0,
                        }
                    ],
                }
            },
        }
        with patch.object(cost_versions_storage, "ensure_schema"), patch.object(
            cost_versions_storage.postgres_storage,
            "connect",
            return_value=_FakeConnection(historical_payload),
        ):
            loaded = cost_versions_storage.load_dataset(default_value=[])

        self.assertEqual(len(loaded), 1)
        version = loaded[0]
        products = version["resultaat_snapshot"]["producten"]

        # RF-010C characterizes this current, undesirable read projection. The persisted
        # payload started with separate basis/composed rows, but the public read model
        # replaces both sections with normalized cost rows classified as basis.
        self.assertEqual(
            [row["sku_id"] for row in products["basisproducten"]],
            ["sku-composed"],
        )
        self.assertEqual(products["samengestelde_producten"], [])
        self.assertEqual(
            [row["sku_id"] for row in version["cost_lines"]],
            ["sku-composed"],
        )
        self.assertEqual(products["basisproducten"][0]["product_type"], "article")
        self.assertEqual(
            [row["sku_id"] for row in historical_payload["resultaat_snapshot"]["producten"]["basisproducten"]],
            ["sku-basis"],
        )
        self.assertEqual(
            [row["sku_id"] for row in historical_payload["resultaat_snapshot"]["producten"]["samengestelde_producten"]],
            ["sku-composed"],
            "The read projection must not mutate the historical payload object in memory",
        )


if __name__ == "__main__":
    unittest.main()
