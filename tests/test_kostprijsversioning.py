from __future__ import annotations

import unittest
from copy import deepcopy
from pathlib import Path
import sys
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from backend.app.domain import dataset_store
from utils import storage


def _sample_version(
    version_id: str,
    *,
    bier_id: str = "bier-1",
    jaar: int = 2026,
    status: str = "definitief",
    is_actief: bool = False,
    kostprijs: float = 1.23,
    basisproducten: list[dict] | None = None,
    samengestelde_producten: list[dict] | None = None,
) -> dict:
    return storage.normalize_berekening_record(
        {
            "id": version_id,
            "bier_id": bier_id,
            "status": status,
            "is_actief": is_actief,
            "effectief_vanaf": "2026-04-01T00:00:00",
            "basisgegevens": {
                "jaar": jaar,
                "biernaam": "Testbier",
                "stijl": "IPA",
                "alcoholpercentage": 6.5,
                "belastingsoort": "Accijns",
                "tarief_accijns": "Hoog",
                "btw_tarief": "21%",
            },
            "soort_berekening": {"type": "Eigen productie"},
            "resultaat_snapshot": {
                "integrale_kostprijs_per_liter": kostprijs,
                "variabele_kosten_per_liter": 1.0,
                "directe_vaste_kosten_per_liter": 0.23,
                "producten": {
                    "basisproducten": basisproducten or [],
                    "samengestelde_producten": samengestelde_producten or [],
                },
            },
            "created_at": f"2026-04-0{1 if version_id.endswith('1') else 2}T10:00:00",
            "updated_at": f"2026-04-0{1 if version_id.endswith('1') else 2}T10:00:00",
            "finalized_at": f"2026-04-0{1 if version_id.endswith('1') else 2}T10:00:00",
        }
    )


class KostprijsVersioningTests(unittest.TestCase):
    def test_normalize_berekening_backfills_snapshot_product_identity(self) -> None:
        with patch(
            "utils.storage.load_basisproducten",
            return_value=[{"id": "basis-fles-33", "omschrijving": "Fles 33cl"}],
        ), patch(
            "utils.storage.load_samengestelde_producten",
            return_value=[{"id": "sam-doos-24", "omschrijving": "24*33cl"}],
        ):
            normalized = storage.normalize_berekening_record(
                {
                    "id": "v-old",
                    "bier_id": "bier-1",
                    "status": "definitief",
                    "basisgegevens": {"jaar": 2026, "biernaam": "Testbier"},
                    "soort_berekening": {"type": "Inkoop"},
                    "resultaat_snapshot": {
                        "integrale_kostprijs_per_liter": 1.0,
                        "producten": {
                            "basisproducten": [{"verpakking": "Fles 33cl", "kostprijs": 1.1}],
                            "samengestelde_producten": [{"verpakking": "24*33cl", "kostprijs": 27.9}],
                        },
                    },
                }
            )

        basis_row = normalized["resultaat_snapshot"]["producten"]["basisproducten"][0]
        samengesteld_row = normalized["resultaat_snapshot"]["producten"]["samengestelde_producten"][0]
        self.assertEqual(basis_row["product_id"], "basis-fles-33")
        self.assertEqual(basis_row["product_type"], "basis")
        self.assertEqual(samengesteld_row["product_id"], "sam-doos-24")
        self.assertEqual(samengesteld_row["product_type"], "samengesteld")

    def test_sync_backfills_product_activations_from_existing_definitive_versions(self) -> None:
        records = [
            {
                "id": "v1",
                "bier_id": "bier-1",
                "status": "definitief",
                "basisgegevens": {"jaar": 2026, "biernaam": "Testbier"},
                "soort_berekening": {"type": "Inkoop"},
                "resultaat_snapshot": {
                    "integrale_kostprijs_per_liter": 1.0,
                    "producten": {
                        "basisproducten": [{"verpakking": "Fles 33cl", "kostprijs": 1.1}],
                        "samengestelde_producten": [{"verpakking": "24*33cl", "kostprijs": 27.9}],
                    },
                },
            }
        ]
        with patch(
            "utils.storage.load_basisproducten",
            return_value=[{"id": "basis-fles-33", "omschrijving": "Fles 33cl"}],
        ), patch(
            "utils.storage.load_samengestelde_producten",
            return_value=[{"id": "sam-doos-24", "omschrijving": "24*33cl"}],
        ):
            normalized_records, activations = storage._normalize_and_sync_kostprijsversie_state(records, [])

        activation_map = {
            (row["product_type"], row["product_id"]): row["kostprijsversie_id"]
            for row in activations
        }
        self.assertEqual(activation_map[("basis", "basis-fles-33")], "v1")
        self.assertEqual(activation_map[("samengesteld", "sam-doos-24")], "v1")
        self.assertTrue(normalized_records[0]["is_actief"])
        self.assertEqual(
            next(
                row["effectief_vanaf"]
                for row in activations
                if row["product_type"] == "basis" and row["product_id"] == "basis-fles-33"
            ),
            normalized_records[0]["finalized_at"],
        )

    def test_normalize_definitieve_version_backfills_finalized_at(self) -> None:
        normalized = storage.normalize_berekening_record(
            {
                "id": "v-legacy",
                "bier_id": "bier-1",
                "status": "definitief",
                "basisgegevens": {"jaar": 2026, "biernaam": "Testbier"},
                "soort_berekening": {"type": "Eigen productie"},
                "resultaat_snapshot": {
                    "integrale_kostprijs_per_liter": 1.0,
                    "producten": {"basisproducten": [], "samengestelde_producten": []},
                },
                "created_at": "2026-03-28T09:00:00",
                "updated_at": "2026-03-29T14:30:00",
                "finalized_at": "",
            }
        )

        self.assertEqual(normalized["finalized_at"], "2026-03-29T14:30:00")

    def test_load_bieren_rejects_wrapped_records(self) -> None:
        wrapped = [
            {
                "Count": 2,
                "value": [
                    {"id": "bier-1", "biernaam": "IPA", "stijl": "IPA"},
                    {"id": "bier-2", "biernaam": "Stout", "stijl": "Stout"},
                ],
            }
        ]

        class _FakePostgres:
            @staticmethod
            def uses_postgres() -> bool:
                return True

            @staticmethod
            def load_dataset(name: str, default: object) -> object:
                return wrapped

        with patch("utils.storage._get_postgres_storage_module", return_value=_FakePostgres):
            with self.assertRaises(RuntimeError):
                storage.load_bieren()

    def test_save_kostprijsversies_filters_empty_placeholder_rows(self) -> None:
        payloads: dict[str, list[dict]] = {}

        def fake_save(dataset_name: str, payload: list[dict]) -> bool:
            payloads[dataset_name] = deepcopy(payload)
            return True

        meaningful = _sample_version("v-meaningful")
        placeholder = storage.create_empty_berekening()

        with patch("utils.storage._save_postgres_dataset", side_effect=fake_save), patch(
            "utils.storage._load_postgres_dataset", return_value=[]
        ), patch("utils.storage.load_kostprijsproductactiveringen", return_value=[]), patch(
            "utils.storage.load_prijsvoorstellen", return_value=[]
        ):
            saved = storage.save_kostprijsversies([placeholder, meaningful])

        self.assertTrue(saved)
        self.assertEqual(len(payloads["kostprijsversies"]), 2)
        self.assertEqual(
            {row["id"] for row in payloads["kostprijsversies"]},
            {placeholder["id"], meaningful["id"]},
        )

    def test_dataset_store_rejects_wrapped_payloads_nested_in_list(self) -> None:
        with self.assertRaises(ValueError):
            dataset_store.validate_dataset_write(
                "bieren",
                [
                    {
                        "Count": 1,
                        "value": [{"id": "bier-1"}],
                    }
                ],
            )

    def test_dataset_store_migrates_wrapped_payloads(self) -> None:
        wrapped = [{"Count": 2, "value": [{"id": "bier-1"}, {"id": "bier-2"}]}]
        saved: dict[str, object] = {}

        def fake_load(name: str, default: object) -> object:
            if name == "bieren":
                return deepcopy(wrapped)
            return None

        def fake_save(name: str, payload: object, overwrite: bool = False) -> bool:
            saved[name] = deepcopy(payload)
            return True

        with patch("backend.app.domain.dataset_store.postgres_storage.load_dataset", side_effect=fake_load), patch(
            "backend.app.domain.dataset_store.postgres_storage.save_dataset", side_effect=fake_save
        ), patch("backend.app.domain.dataset_store.postgres_storage.uses_postgres", return_value=True):
            report = dataset_store.migrate_wrapped_payloads(dataset_names=["bieren"], dry_run=False)

        self.assertTrue(report["datasets"]["bieren"]["changed"])
        self.assertEqual(saved["bieren"], [{"id": "bier-1"}, {"id": "bier-2"}])

    def test_save_kostprijsversies_blocks_deleting_definitive_versions(self) -> None:
        existing = _sample_version("v-def", status="definitief")

        def fake_load(name: str) -> list[dict] | None:
            if name == "kostprijsversies":
                return [deepcopy(existing)]
            return []

        with patch("utils.storage._load_postgres_dataset", side_effect=fake_load), patch(
            "utils.storage.load_kostprijsproductactiveringen", return_value=[]
        ), patch("utils.storage.load_prijsvoorstellen", return_value=[]), patch(
            "utils.storage._save_postgres_dataset",
            side_effect=AssertionError("Should not write when delete is blocked"),
        ):
            with self.assertRaises(ValueError):
                storage.save_kostprijsversies([])

    def test_save_kostprijsversies_blocks_deleting_referenced_concepts(self) -> None:
        existing = _sample_version("v-concept", status="concept")

        def fake_load(name: str) -> list[dict] | None:
            if name == "kostprijsversies":
                return [deepcopy(existing)]
            return []

        activations = [
            storage.normalize_kostprijsproduct_activering_record(
                {
                    "id": "act-1",
                    "bier_id": "bier-1",
                    "jaar": 2026,
                    "product_id": "basis-fles-33",
                    "product_type": "basis",
                    "kostprijsversie_id": "v-concept",
                    "effectief_vanaf": "2026-01-01T00:00:00",
                }
            )
        ]

        with patch("utils.storage._load_postgres_dataset", side_effect=fake_load), patch(
            "utils.storage.load_kostprijsproductactiveringen", return_value=deepcopy(activations)
        ), patch("utils.storage.load_prijsvoorstellen", return_value=[]), patch(
            "utils.storage._save_postgres_dataset",
            side_effect=AssertionError("Should not write when delete is blocked"),
        ):
            with self.assertRaises(ValueError):
                storage.save_kostprijsversies([])

    def test_packaging_component_price_versions_migrate_from_projection(self) -> None:
        legacy_rows = [
            {
                "id": "price-1",
                "verpakkingsonderdeel_id": "dop",
                "jaar": 2026,
                "prijs_per_stuk": 0.05,
            }
        ]

        saved_payloads: dict[str, list[dict]] = {}

        def fake_load(dataset_name: str) -> list[dict] | None:
            if dataset_name == "packaging-component-price-versions":
                return []
            if dataset_name == "packaging-component-prices":
                return deepcopy(legacy_rows)
            return None

        def fake_save(dataset_name: str, payload: list[dict]) -> bool:
            saved_payloads[dataset_name] = deepcopy(payload)
            return True

        with patch("utils.storage._load_postgres_dataset", side_effect=fake_load), patch(
            "utils.storage._save_postgres_dataset",
            side_effect=fake_save,
        ):
            versions = storage.load_packaging_component_price_versions()

        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0]["versie_nummer"], 1)
        self.assertTrue(versions[0]["is_actief"])
        self.assertEqual(saved_payloads, {})

    def test_save_packaging_component_prices_creates_new_version_on_change(self) -> None:
        current_versions = [
            storage.normalize_packaging_component_price_version_record(
                {
                    "id": "v1",
                    "verpakkingsonderdeel_id": "dop",
                    "jaar": 2026,
                    "prijs_per_stuk": 0.05,
                    "versie_nummer": 1,
                    "is_actief": True,
                    "created_at": "2026-04-01T10:00:00",
                    "updated_at": "2026-04-01T10:00:00",
                    "effectief_vanaf": "2026-04-01T10:00:00",
                }
            )
        ]
        saved_payloads: dict[str, list[dict]] = {}

        def fake_load(dataset_name: str) -> list[dict] | None:
            if dataset_name == "packaging-component-price-versions":
                return deepcopy(current_versions)
            if dataset_name == "packaging-component-prices":
                return storage._build_active_packaging_component_price_projection(current_versions)
            return None

        def fake_save(dataset_name: str, payload: list[dict]) -> bool:
            saved_payloads[dataset_name] = deepcopy(payload)
            return True

        with patch("utils.storage._load_postgres_dataset", side_effect=fake_load), patch(
            "utils.storage.load_packaging_component_masters",
            return_value=[{"id": "dop", "omschrijving": "Dop"}],
        ), patch(
            "utils.storage._save_postgres_dataset",
            side_effect=fake_save,
        ):
            saved = storage.save_packaging_component_prices(
                [
                    {
                        "verpakkingsonderdeel_id": "dop",
                        "jaar": 2026,
                        "prijs_per_stuk": 0.06,
                    }
                ]
            )

        self.assertTrue(saved)
        versions = saved_payloads["packaging-component-price-versions"]
        self.assertEqual(len(versions), 2)
        active_versions = [row for row in versions if row["is_actief"]]
        self.assertEqual(len(active_versions), 1)
        self.assertEqual(active_versions[0]["prijs_per_stuk"], 0.06)
        self.assertEqual(active_versions[0]["versie_nummer"], 2)

    def test_multiple_versions_same_year_get_numbered(self) -> None:
        rows = [
            _sample_version("v1", is_actief=False),
            _sample_version("v2", is_actief=True),
        ]

        rows = storage._assign_kostprijsversie_numbers(rows)

        self.assertEqual([row["versie_nummer"] for row in rows], [1, 2])

    def test_sync_assigns_active_products_per_product_group(self) -> None:
        state = [
            _sample_version(
                "v1",
                is_actief=False,
                samengestelde_producten=[
                    {
                        "product_id": "doos-24",
                        "verpakking": "Doos 24x33cl",
                        "kostprijs": 71.98,
                    }
                ],
            ),
            _sample_version(
                "v2",
                is_actief=False,
                basisproducten=[
                    {
                        "product_id": "fust-20l",
                        "verpakking": "Fust 20L",
                        "kostprijs": 88.0,
                    }
                ],
            ),
        ]
        with patch("utils.storage.load_basisproducten", return_value=[]), patch(
            "utils.storage.load_samengestelde_producten",
            return_value=[],
        ):
            normalized_rows, activations = storage._normalize_and_sync_kostprijsversie_state(state, [])

        activation_map = {
            (row["product_id"], row["kostprijsversie_id"])
            for row in activations
        }
        self.assertIn(("doos-24", "v1"), activation_map)
        self.assertIn(("fust-20l", "v2"), activation_map)
        self.assertTrue(next(row for row in normalized_rows if row["id"] == "v1")["is_actief"])
        self.assertTrue(next(row for row in normalized_rows if row["id"] == "v2")["is_actief"])

    def test_activate_new_version_updates_only_products_present_in_that_version(self) -> None:
        state = [
            _sample_version(
                "v1",
                is_actief=True,
                samengestelde_producten=[
                    {
                        "product_id": "doos-24",
                        "verpakking": "Doos 24x33cl",
                        "kostprijs": 71.98,
                    }
                ],
            ),
            _sample_version(
                "v2",
                is_actief=False,
                basisproducten=[
                    {
                        "product_id": "fust-20l",
                        "verpakking": "Fust 20L",
                        "kostprijs": 88.0,
                    }
                ],
            ),
        ]
        activations = [
            storage.normalize_kostprijsproduct_activering_record(
                {
                    "bier_id": "bier-1",
                    "jaar": 2026,
                    "product_id": "doos-24",
                    "product_type": "samengesteld",
                    "kostprijsversie_id": "v1",
                    "effectief_vanaf": "2026-04-01T10:00:00",
                }
            )
        ]

        def fake_load() -> list[dict]:
            return deepcopy(state)

        def fake_load_activations() -> list[dict]:
            return deepcopy(activations)

        def fake_save_versions(data: list[dict]) -> bool:
            state.clear()
            state.extend(deepcopy(data))
            return True

        def fake_save_activations(data: list[dict]) -> bool:
            activations.clear()
            activations.extend(deepcopy(data))
            return True

        with patch("utils.storage.load_kostprijsversies", side_effect=fake_load), patch(
            "utils.storage.load_kostprijsproductactiveringen", side_effect=fake_load_activations
        ), patch("utils.storage.load_basisproducten", return_value=[]), patch(
            "utils.storage.load_samengestelde_producten",
            return_value=[],
        ), patch(
            "utils.storage._save_postgres_dataset",
            side_effect=lambda dataset_name, payload: (
                fake_save_versions(payload)
                if dataset_name == "kostprijsversies"
                else fake_save_activations(payload)
            ),
        ), patch("utils.storage._save_json_value", return_value=True):
            activated = storage.activate_kostprijsversie("v2")

        self.assertIsNotNone(activated)
        activation_lookup = {
            row["product_id"]: row["kostprijsversie_id"]
            for row in activations
        }
        self.assertEqual(activation_lookup["doos-24"], "v1")
        self.assertEqual(activation_lookup["fust-20l"], "v2")

    def test_activate_specific_products_only_updates_requested_product(self) -> None:
        state = [
            _sample_version(
                "v1",
                basisproducten=[
                    {
                        "product_id": "fles-33",
                        "product_type": "basis",
                        "verpakking": "Fles 33cl",
                        "kostprijs": 1.8,
                    },
                    {
                        "product_id": "fust-20l",
                        "product_type": "basis",
                        "verpakking": "Fust 20L",
                        "kostprijs": 72.0,
                    },
                ],
            )
        ]
        activations = [
            storage.normalize_kostprijsproduct_activering_record(
                {
                    "bier_id": "bier-1",
                    "jaar": 2026,
                    "product_id": "fles-33",
                    "product_type": "basis",
                    "kostprijsversie_id": "old-version",
                    "effectief_vanaf": "2026-04-01T10:00:00",
                }
            ),
            storage.normalize_kostprijsproduct_activering_record(
                {
                    "bier_id": "bier-1",
                    "jaar": 2026,
                    "product_id": "fust-20l",
                    "product_type": "basis",
                    "kostprijsversie_id": "old-version",
                    "effectief_vanaf": "2026-04-01T10:00:00",
                }
            ),
        ]

        with patch("utils.storage.load_kostprijsversies", return_value=deepcopy(state)), patch(
            "utils.storage.load_kostprijsproductactiveringen",
            return_value=deepcopy(activations),
        ), patch("utils.storage.load_basisproducten", return_value=[]), patch(
            "utils.storage.load_samengestelde_producten",
            return_value=[],
        ), patch("utils.storage._save_postgres_dataset", return_value=True), patch(
            "utils.storage._save_json_value",
            return_value=True,
        ):
            activated = storage.activate_kostprijsversie_products("v1", ["fust-20l"])

        self.assertIsNotNone(activated)

    def test_quote_rows_store_kostprijsversie_id(self) -> None:
        normalized = storage.normalize_prijsvoorstel_record(
            {
                "id": "quote-1",
                "jaar": 2026,
                "kostprijsversie_ids": ["v1"],
                "product_rows": [
                    {
                        "id": "line-1",
                        "bier_id": "bier-1",
                        "kostprijsversie_id": "v1",
                        "product_id": "prod-1",
                        "product_type": "basis",
                    }
                ],
                "beer_rows": [
                    {
                        "id": "line-2",
                        "bier_id": "bier-1",
                        "kostprijsversie_id": "v1",
                    }
                ],
            }
        )

        self.assertEqual(normalized["kostprijsversie_ids"], ["v1"])
        self.assertEqual(normalized["product_rows"][0]["kostprijsversie_id"], "v1")
        self.assertEqual(normalized["beer_rows"][0]["kostprijsversie_id"], "v1")

    def test_historical_quote_reference_stays_stable_after_activation(self) -> None:
        quote = storage.normalize_prijsvoorstel_record(
            {
                "id": "quote-1",
                "jaar": 2026,
                "kostprijsversie_ids": ["v1"],
                "product_rows": [
                    {
                        "id": "line-1",
                        "bier_id": "bier-1",
                        "kostprijsversie_id": "v1",
                        "product_id": "prod-1",
                        "product_type": "basis",
                    }
                ],
            }
        )

        state = [
            _sample_version("v1", is_actief=True),
            _sample_version("v2", is_actief=False, kostprijs=1.55),
        ]

        with patch("utils.storage.load_basisproducten", return_value=[]), patch(
            "utils.storage.load_samengestelde_producten",
            return_value=[],
        ), patch("utils.storage.load_kostprijsproductactiveringen", return_value=[]), patch(
            "utils.storage._save_postgres_dataset",
            return_value=True,
        ), patch("utils.storage._save_json_value", return_value=True):
            storage.save_kostprijsversies(state)

        self.assertEqual(quote["product_rows"][0]["kostprijsversie_id"], "v1")
        self.assertEqual(state[0]["id"], "v1")

    def test_cleanup_prunes_empty_factuurconcept_and_dangling_source_refs(self) -> None:
        source = _sample_version("v1", is_actief=True)
        draft = storage.normalize_berekening_record(
            {
                **deepcopy(source),
                "id": "draft-1",
                "status": "concept",
                "is_actief": False,
                "versie_nummer": 0,
                "calculation_variant": "factuur",
                "brontype": "factuur",
                "bron_berekening_id": "missing-source",
                "bron_id": "",
                "invoer": {
                    "inkoop": {
                        "facturen": [
                            {
                                "id": "f-1",
                                "factuurnummer": "",
                                "factuurdatum": "",
                                "verzendkosten": 0,
                                "overige_kosten": 0,
                                "factuurregels": [],
                            }
                        ]
                    }
                },
            }
        )
        hercalc = storage.normalize_berekening_record(
            {
                **deepcopy(source),
                "id": "v2",
                "status": "concept",
                "is_actief": False,
                "brontype": "hercalculatie",
                "bron_id": "missing-source",
            }
        )

        cleaned, changed = storage._cleanup_kostprijsversie_references([source, draft, hercalc])

        self.assertTrue(changed)
        self.assertEqual([row["id"] for row in cleaned], ["v1", "v2"])
        self.assertEqual(next(row for row in cleaned if row["id"] == "v2")["bron_id"], "")

    def test_load_kostprijsversies_has_no_write_side_effects(self) -> None:
        record = _sample_version("v1", is_actief=True)
        with patch(
            "utils.storage._load_postgres_dataset",
            side_effect=lambda name: [record] if name == "kostprijsversies" else [],
        ), patch(
            "utils.storage._normalize_and_sync_kostprijsversie_state",
            return_value=([record], []),
        ), patch(
            "utils.storage._save_postgres_dataset",
            side_effect=AssertionError("read path may not write"),
        ):
            loaded = storage.load_kostprijsversies()
        self.assertEqual([row["id"] for row in loaded], ["v1"])

    def test_load_packaging_component_price_versions_has_no_write_side_effects(self) -> None:
        version = {
            "id": "price-v1",
            "verpakkingsonderdeel_id": "component-1",
            "jaar": 2026,
            "prijs_per_stuk": 0.12,
            "versie_nummer": 1,
            "effectief_vanaf": "2026-04-01T00:00:00",
            "is_actief": True,
            "created_at": "2026-04-01T00:00:00",
            "updated_at": "2026-04-01T00:00:00",
        }
        with patch(
            "utils.storage._load_postgres_dataset",
            side_effect=lambda name: [version] if name == "packaging-component-price-versions" else [],
        ), patch(
            "utils.storage._save_postgres_dataset",
            side_effect=AssertionError("read path may not write"),
        ):
            loaded = storage.load_packaging_component_price_versions()
        self.assertEqual([row["id"] for row in loaded], ["price-v1"])

    def test_save_kostprijsproductactiveringen_filters_invalid_refs(self) -> None:
        captured: dict[str, list[dict]] = {}

        def fake_save(dataset_name: str, data: list[dict]) -> bool:
            captured[dataset_name] = data
            return True

        with patch("utils.storage.load_bieren", return_value=[{"id": "bier-1"}]), patch(
            "utils.storage.load_kostprijsversies",
            return_value=[{"id": "v1"}],
        ), patch(
            "utils.storage.load_basisproducten",
            return_value=[{"id": "basis-1"}],
        ), patch(
            "utils.storage.load_samengestelde_producten",
            return_value=[],
        ), patch("utils.storage._save_postgres_dataset", side_effect=fake_save):
            saved = storage.save_kostprijsproductactiveringen(
                [
                    {
                        "bier_id": "bier-1",
                        "jaar": 2026,
                        "product_id": "basis-1",
                        "product_type": "basis",
                        "kostprijsversie_id": "v1",
                    },
                    {
                        "bier_id": "bier-missing",
                        "jaar": 2026,
                        "product_id": "basis-1",
                        "product_type": "basis",
                        "kostprijsversie_id": "v1",
                    },
                ]
            )

        self.assertTrue(saved)
        self.assertEqual(len(captured["kostprijsproductactiveringen"]), 1)
        self.assertEqual(captured["kostprijsproductactiveringen"][0]["bier_id"], "bier-1")

    def test_save_prijsvoorstellen_filters_invalid_refs(self) -> None:
        captured: dict[str, list[dict]] = {}

        def fake_save(dataset_name: str, data: list[dict]) -> bool:
            captured[dataset_name] = data
            return True

        quote = {
            "id": "quote-1",
            "bier_id": "bier-missing",
            "selected_bier_ids": ["bier-1", "bier-missing"],
            "kostprijsversie_ids": ["v1", "v-missing"],
            "product_rows": [
                {
                    "id": "line-1",
                    "bier_id": "bier-1",
                    "kostprijsversie_id": "v1",
                    "product_id": "basis-1",
                    "product_type": "basis",
                },
                {
                    "id": "line-2",
                    "bier_id": "bier-missing",
                    "kostprijsversie_id": "v-missing",
                    "product_id": "basis-missing",
                    "product_type": "basis",
                },
            ],
        }

        with patch("utils.storage.load_bieren", return_value=[{"id": "bier-1"}]), patch(
            "utils.storage.load_kostprijsversies",
            return_value=[{"id": "v1"}],
        ), patch(
            "utils.storage.load_basisproducten",
            return_value=[{"id": "basis-1"}],
        ), patch(
            "utils.storage.load_samengestelde_producten",
            return_value=[],
        ), patch("utils.storage._save_postgres_dataset", side_effect=fake_save):
            saved = storage.save_prijsvoorstellen([quote])

        self.assertTrue(saved)
        saved_quote = captured["prijsvoorstellen"][0]
        self.assertEqual(saved_quote["bier_id"], "")
        self.assertEqual(saved_quote["selected_bier_ids"], ["bier-1"])
        self.assertEqual(saved_quote["kostprijsversie_ids"], ["v1"])
        self.assertEqual(len(saved_quote["product_rows"]), 1)

    def test_dataset_store_routes_legacy_product_saves_to_canonical_storage(self) -> None:
        with patch("backend.app.domain.dataset_store.require_postgres"), patch(
            "backend.app.domain.dataset_store.save_basisproducten",
            return_value=True,
        ) as save_basisproducten:
            saved = dataset_store.save_dataset("basisproducten", [{"id": "basis-1"}])

        self.assertTrue(saved)
        save_basisproducten.assert_called_once()


if __name__ == "__main__":
    unittest.main()
