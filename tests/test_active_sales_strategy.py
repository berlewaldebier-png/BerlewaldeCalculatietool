from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import json
import sys
import unittest
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.domain import active_sales_strategy_service


def _sku(
    sku_id: str,
    name: str,
    *,
    beer_name: str = "Berlewalde Blond",
    beer_id: str = "beer-blond",
    subject_type: str = "beer",
    scope: str = "carried_forward",
    cost_price: float | None = 10.0,
    list_price: float | None = 15.0,
    target_price_id: str = "",
) -> dict:
    return {
        "sku_id": sku_id,
        "sku_code": sku_id.upper(),
        "sku_name": name,
        "beer_name": beer_name,
        "canonical_beer_id": beer_id if beer_name else "",
        "subject_type": subject_type,
        "subject_id": beer_id or sku_id,
        "sku_kind": "composite",
        "scope_classification": scope,
        "cost_price": cost_price,
        "cost_required": scope != "catalog_reference_only",
        "cost_readiness_status": "ready" if cost_price else "not_required",
        "cost_blocker_codes": [],
        "list_price": list_price,
        "source": {"target_price_id": target_price_id},
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


def _live(record_id: str, sku_id: str, price: float) -> dict:
    return {
        "id": record_id,
        "record_type": "verkoopstrategie_product",
        "year": 2026,
        "payload": {
            "id": record_id,
            "record_type": "verkoopstrategie_product",
            "jaar": 2026,
            "sku_id": sku_id,
            "sell_in_prices": {"list": price},
        },
        "updated_at": "2026-01-01T00:00:00+00:00",
    }


class ActiveSalesStrategyProjectionTests(unittest.TestCase):
    def test_target_record_is_current_and_activation_price_remains_snapshot(self) -> None:
        result = active_sales_strategy_service.build_active_sales_strategy(
            _dossier(
                [
                    _sku(
                        "sku-blond",
                        "Berlewalde Blond - Doos 24 x 33cl",
                        list_price=15,
                        target_price_id="price-target",
                    )
                ]
            ),
            live_price_rows=[_live("price-target", "sku-blond", 16.25)],
            can_edit=True,
        )

        item = result["groups"][0]["items"][0]
        self.assertEqual(item["activation_list_price"], 15.0)
        self.assertEqual(item["list_price"], 16.25)
        self.assertEqual(item["price_source"], "target_record")
        self.assertEqual(item["price_state"], "ready")
        self.assertTrue(item["editable"])

    def test_each_generation_sku_is_shown_once_and_shared_items_are_not_cloned(self) -> None:
        rows = [
            _sku("sku-blond", "Blond - Doos 24 x 33cl", target_price_id="price-blond"),
            _sku(
                "sku-bundle",
                "Alles onder de boom",
                beer_name="",
                beer_id="bundle-1",
                subject_type="bundle",
                target_price_id="price-bundle",
            ),
        ]
        result = active_sales_strategy_service.build_active_sales_strategy(
            _dossier(rows),
            live_price_rows=[
                _live("price-blond", "sku-blond", 15),
                _live("price-bundle", "sku-bundle", 25),
            ],
        )

        flattened = [
            item["sku_id"]
            for group in result["groups"]
            for item in group["items"]
        ]
        self.assertEqual(flattened.count("sku-bundle"), 1)
        self.assertEqual(result["summary"]["sku_count"], 2)
        self.assertIn("Samengestelde producten", [group["label"] for group in result["groups"]])

    def test_missing_non_positive_ambiguous_and_not_applicable_stay_visible(self) -> None:
        rows = [
            _sku("missing", "Ontbrekend", list_price=None),
            _sku("zero", "Nul", target_price_id="price-zero"),
            _sku("ambiguous", "Dubbel"),
            _sku(
                "catalogue",
                "Catalogusreferentie",
                beer_name="",
                beer_id="article-1",
                subject_type="article",
                scope="catalog_reference_only",
                cost_price=None,
                list_price=None,
            ),
        ]
        result = active_sales_strategy_service.build_active_sales_strategy(
            _dossier(rows),
            live_price_rows=[
                _live("price-zero", "zero", 0),
                _live("price-a", "ambiguous", 1),
                _live("price-b", "ambiguous", 2),
                _live("old-price", "outside-generation", 9),
            ],
            can_edit=True,
        )
        states = {
            item["sku_id"]: item["price_state"]
            for group in result["groups"]
            for item in group["items"]
        }
        self.assertEqual(states["missing"], "missing")
        self.assertEqual(states["zero"], "non_positive")
        self.assertEqual(states["ambiguous"], "ambiguous")
        self.assertEqual(states["catalogue"], "not_applicable")
        self.assertEqual(result["summary"]["compatibility_only_price_count"], 1)

    def test_duplicate_generation_sku_fails_closed(self) -> None:
        row = _sku("duplicate", "Dubbele SKU")
        result = active_sales_strategy_service.build_active_sales_strategy(
            _dossier([row, dict(row)]), live_price_rows=[]
        )
        self.assertEqual(result["status"], "missing")
        self.assertIn("active_generation_duplicate_sku", result["reason_codes"])

    def test_current_sell_in_overlay_replaces_active_snapshot_but_not_candidate_input(self) -> None:
        candidate = {
            "sku_id": "sku-blond",
            "price_id": "candidate-price",
            "target_pricing_id": "price-target",
            "list_price": 15,
            "price_readiness_status": "ready",
            "price_blocker_codes": [],
        }
        result = active_sales_strategy_service.overlay_current_sell_in_prices(
            [candidate], [_live("price-target", "sku-blond", 16.25)]
        )

        self.assertEqual(candidate["list_price"], 15)
        self.assertEqual(result[0]["list_price"], 16.25)
        self.assertEqual(result[0]["price_id"], "price-target")
        self.assertEqual(result[0]["price_readiness_status"], "ready")

    def test_current_sell_in_overlay_fails_closed_on_missing_target(self) -> None:
        result = active_sales_strategy_service.overlay_current_sell_in_prices(
            [
                {
                    "sku_id": "sku-blond",
                    "price_id": "candidate-price",
                    "target_pricing_id": "missing-target",
                    "list_price": 15,
                    "price_readiness_status": "ready",
                    "price_blocker_codes": [],
                }
            ],
            [],
        )
        self.assertIsNone(result[0]["list_price"])
        self.assertEqual(result[0]["price_readiness_status"], "blocked")
        self.assertIn("active_price_target_record_missing", result[0]["price_blocker_codes"])


class _Result:
    def __init__(self, *, one=None, all_rows=None):
        self._one = one
        self._all = list(all_rows or [])

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._all


class _ReadConnection:
    def __init__(self):
        self.statements: list[str] = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.statements.append(normalized)
        if normalized == "SET TRANSACTION READ ONLY":
            return _Result()
        if "FROM sales_pricing_records" in normalized:
            return _Result(
                all_rows=[
                    (
                        "price-target",
                        "verkoopstrategie_product",
                        2026,
                        _live("price-target", "sku-blond", 16)["payload"],
                        "2026-01-01T00:00:00+00:00",
                    )
                ]
            )
        raise AssertionError(f"Unexpected SQL: {normalized}")


class ActiveSalesStrategyReaderTests(unittest.TestCase):
    def test_reader_is_strictly_read_only_and_never_initializes_schema(self) -> None:
        connection = _ReadConnection()

        @contextmanager
        def connect():
            yield connection

        with (
            patch.object(
                active_sales_strategy_service.yearset_dossier_service,
                "read_active_yearset_dossier",
                return_value=_dossier(
                    [
                        _sku(
                            "sku-blond",
                            "Blond - Doos 24 x 33cl",
                            target_price_id="price-target",
                        )
                    ]
                ),
            ),
            patch.object(active_sales_strategy_service.postgres_storage, "connect", connect),
            patch.object(
                active_sales_strategy_service.postgres_storage,
                "ensure_schema",
                side_effect=AssertionError("read path may not initialize schema"),
            ),
        ):
            result = active_sales_strategy_service.read_active_sales_strategy()

        self.assertEqual(connection.statements[0], "SET TRANSACTION READ ONLY")
        self.assertEqual(result["groups"][0]["items"][0]["list_price"], 16.0)


class _WriteConnection:
    def __init__(self, payload: dict | None, *, target_price_id: str = "price-target"):
        self.payload = payload
        self.target_price_id = target_price_id
        self.statements: list[str] = []
        self.insert_params = None

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.statements.append(normalized)
        if "pg_advisory_xact_lock" in normalized:
            return _Result(one=(None,))
        if "FROM commercial_yearsets g" in normalized:
            return _Result(
                one=(
                    "generation-2026",
                    2026,
                    "active",
                    "ready",
                    "run-2026",
                    "active",
                    "ready",
                    "manifest-2026",
                )
            )
        if "FROM commercial_yearset_candidate_skus s" in normalized:
            return _Result(
                one=(
                    "beer-blond",
                    "beer",
                    "beer-blond",
                    "carried_forward",
                    10,
                    self.target_price_id,
                    "Blond - Doos 24 x 33cl",
                )
            )
        if "FROM sales_pricing_records" in normalized and "WHERE id =" in normalized:
            return _Result(
                one=(
                    "price-target",
                    "verkoopstrategie_product",
                    2026,
                    "beer-blond",
                    "sku-blond",
                    "Blond - Doos 24 x 33cl",
                    self.payload,
                    "2026-01-01T00:00:00+00:00",
                )
            )
        if "FROM sales_pricing_records" in normalized and "payload->>'sku_id'" in normalized:
            return _Result(all_rows=[])
        if "INSERT INTO sales_pricing_records" in normalized:
            self.insert_params = params
            return _Result()
        raise AssertionError(f"Unexpected SQL: {normalized}")


class ActiveSalesStrategyWriterTests(unittest.TestCase):
    def test_writer_updates_only_exact_target_and_preserves_unknown_payload(self) -> None:
        payload = _live("price-target", "sku-blond", 15)["payload"]
        payload["unknown_compatibility_field"] = {"keep": True}
        connection = _WriteConnection(payload)

        @contextmanager
        def transaction():
            yield connection

        with (
            patch.object(active_sales_strategy_service.postgres_storage, "transaction", transaction),
            patch.object(
                active_sales_strategy_service,
                "read_active_sales_strategy",
                return_value={"status": "ready", "saved": True},
            ),
        ):
            result = active_sales_strategy_service.update_active_sales_strategy(
                generation_id="generation-2026",
                run_id="run-2026",
                manifest_hash="manifest-2026",
                changes=[
                    {
                        "sku_id": "sku-blond",
                        "list_price": 16.25,
                        "pricing_record_id": "price-target",
                        "expected_record_hash": active_sales_strategy_service._payload_hash(payload),
                    }
                ],
                actor="admin",
            )

        saved_payload = json.loads(connection.insert_params[-1])
        self.assertEqual(saved_payload["sell_in_prices"]["list"], 16.25)
        self.assertEqual(saved_payload["unknown_compatibility_field"], {"keep": True})
        self.assertFalse(any("DELETE FROM" in sql for sql in connection.statements))
        self.assertFalse(any("commercial_yearset_candidate_prices SET" in sql for sql in connection.statements))
        self.assertEqual(result, {"status": "ready", "saved": True})

    def test_writer_creates_one_deterministic_record_for_missing_price(self) -> None:
        connection = _WriteConnection(None, target_price_id="")

        @contextmanager
        def transaction():
            yield connection

        with (
            patch.object(active_sales_strategy_service.postgres_storage, "transaction", transaction),
            patch.object(
                active_sales_strategy_service,
                "read_active_sales_strategy",
                return_value={"status": "ready", "saved": True},
            ),
        ):
            active_sales_strategy_service.update_active_sales_strategy(
                generation_id="generation-2026",
                run_id="run-2026",
                manifest_hash="manifest-2026",
                changes=[
                    {
                        "sku_id": "sku-blond",
                        "list_price": 16.25,
                        "pricing_record_id": "",
                        "expected_record_hash": "",
                    }
                ],
                actor="admin",
            )

        expected_id = active_sales_strategy_service._new_record_id(2026, "sku-blond")
        saved_payload = json.loads(connection.insert_params[-1])
        self.assertEqual(connection.insert_params[0], expected_id)
        self.assertEqual(saved_payload["id"], expected_id)
        self.assertEqual(saved_payload["sku_id"], "sku-blond")
        self.assertEqual(saved_payload["sell_in_prices"]["list"], 16.25)
        self.assertEqual(
            sum("INSERT INTO sales_pricing_records" in sql for sql in connection.statements),
            1,
        )
        self.assertFalse(any("DELETE FROM" in sql for sql in connection.statements))

    def test_writer_rejects_stale_price_hash_without_writing(self) -> None:
        payload = _live("price-target", "sku-blond", 15)["payload"]
        connection = _WriteConnection(payload)

        @contextmanager
        def transaction():
            yield connection

        with patch.object(
            active_sales_strategy_service.postgres_storage, "transaction", transaction
        ):
            with self.assertRaises(active_sales_strategy_service.ActiveSalesStrategyConflict):
                active_sales_strategy_service.update_active_sales_strategy(
                    generation_id="generation-2026",
                    run_id="run-2026",
                    manifest_hash="manifest-2026",
                    changes=[
                        {
                            "sku_id": "sku-blond",
                            "list_price": 16,
                            "pricing_record_id": "price-target",
                            "expected_record_hash": "stale",
                        }
                    ],
                    actor="admin",
                )
        self.assertIsNone(connection.insert_params)


class ActiveSalesStrategyFrontendContractTests(unittest.TestCase):
    def test_runtime_screen_uses_active_projection_while_wizard_keeps_draft_workspace(self) -> None:
        page = (
            PROJECT_ROOT / "frontend/src/app/(app)/verkoopstrategie/page.tsx"
        ).read_text(encoding="utf-8")
        screen = (
            PROJECT_ROOT / "frontend/src/features/sales-strategy/SalesStrategyScreen.tsx"
        ).read_text(encoding="utf-8")
        wizard = (
            PROJECT_ROOT / "frontend/src/components/nieuw-jaar/steps/VerkoopstrategieDraftStep.tsx"
        ).read_text(encoding="utf-8")
        workspace = (
            PROJECT_ROOT / "frontend/src/features/sales-strategy/ActiveSalesStrategyWorkspace.tsx"
        ).read_text(encoding="utf-8")

        self.assertIn("/meta/commercial-yearsets/active/sales-strategy", page)
        self.assertIn("<ActiveSalesStrategyWorkspace", screen)
        self.assertIn('record_type: "verkoopstrategie_product"', wizard)
        self.assertIn("setDraftVerkoopstrategieTarget", wizard)
        self.assertNotIn("/commercial-yearsets/active/sales-strategy", wizard)
        self.assertIn("expected_record_hash", workspace)
        self.assertNotIn("reconcileDatasetItems", workspace)


if __name__ == "__main__":
    unittest.main()
