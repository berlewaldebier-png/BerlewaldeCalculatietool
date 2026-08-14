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

from app.domain import active_recommended_price_service
from app.domain import active_sales_strategy_service


def _sku(
    sku_id: str,
    name: str,
    *,
    cost_price: float | None = 10,
    list_price: float | None = 15,
    target_price_id: str = "price-target",
    scope: str = "carried_forward",
    subject_type: str = "beer",
) -> dict:
    return {
        "sku_id": sku_id,
        "sku_code": sku_id.upper(),
        "sku_name": name,
        "beer_name": "Berlewalde Blond" if subject_type == "beer" else "",
        "canonical_beer_id": "beer-blond" if subject_type == "beer" else "",
        "subject_type": subject_type,
        "subject_id": "beer-blond" if subject_type == "beer" else sku_id,
        "sku_kind": "composite",
        "scope_classification": scope,
        "cost_price": cost_price,
        "cost_required": scope != "catalog_reference_only",
        "cost_readiness_status": "ready" if cost_price else "not_required",
        "cost_blocker_codes": [],
        "list_price": list_price,
        "price_readiness_status": "ready" if list_price else "blocked",
        "price_blocker_codes": [],
        "source": {"target_price_id": target_price_id},
    }


def _dossier(rows: list[dict], *, channels: list[dict] | None = None) -> dict:
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
        "channels": channels
        if channels is not None
        else [
            {
                "channel_code": "horeca",
                "advice_markup_pct": 190,
                "readiness_status": "ready",
                "blocker_codes": [],
                "source_hash": "channel-hash",
            }
        ],
        "reason_codes": [],
    }


def _live_price(record_id: str, sku_id: str, price: float) -> dict:
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


def _live_advice(markup: float = 190) -> dict:
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "year": 2026,
        "channel_code": "horeca",
        "advice_markup_pct": markup,
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-02T00:00:00+00:00",
    }


def _sales_projection(dossier: dict, rows: list[dict]) -> dict:
    return active_sales_strategy_service.build_active_sales_strategy(
        dossier,
        live_price_rows=rows,
        can_edit=False,
    )


class ActiveRecommendedPriceProjectionTests(unittest.TestCase):
    def test_current_channel_markup_and_current_sell_in_drive_ready_advice(self) -> None:
        dossier = _dossier([_sku("sku-blond", "Blond - Doos 24 x 33cl")])
        result = active_recommended_price_service.build_active_recommended_prices(
            dossier,
            _sales_projection(
                dossier, [_live_price("price-target", "sku-blond", 16.25)]
            ),
            live_advice_rows=[_live_advice(200)],
            configured_channels=[
                {"code": "horeca", "naam": "Horeca", "volgorde": 1}
            ],
            vat_by_sku={"sku-blond": "21%"},
            can_edit=True,
        )

        self.assertEqual(result["status"], "ready")
        channel = result["channels"][0]
        self.assertEqual(channel["activation_advice_markup_pct"], 190.0)
        self.assertEqual(channel["advice_markup_pct"], 200.0)
        self.assertEqual(channel["markup_state"], "ready")
        self.assertTrue(channel["editable"])
        item = result["groups"][0]["items"][0]
        self.assertEqual(item["list_price"], 16.25)
        self.assertEqual(item["vat_pct"], 21.0)
        self.assertEqual(item["advice_state"], "ready")

    def test_every_active_sku_remains_visible_with_typed_missing_states(self) -> None:
        dossier = _dossier(
            [
                _sku("ready", "Ready", target_price_id="ready-price"),
                _sku("missing-sell-in", "Geen sell-in", list_price=None, target_price_id=""),
                _sku("missing-vat", "Geen btw", target_price_id="vat-price"),
                _sku(
                    "not-applicable",
                    "Afronding",
                    cost_price=None,
                    list_price=None,
                    target_price_id="",
                    scope="catalog_reference_only",
                    subject_type="service",
                ),
            ]
        )
        sales = _sales_projection(
            dossier,
            [
                _live_price("ready-price", "ready", 15),
                _live_price("vat-price", "missing-vat", 20),
            ],
        )
        result = active_recommended_price_service.build_active_recommended_prices(
            dossier,
            sales,
            live_advice_rows=[_live_advice()],
            configured_channels=[{"code": "horeca", "naam": "Horeca"}],
            vat_by_sku={"ready": "21%", "missing-sell-in": "21%"},
        )

        items = {
            item["sku_id"]: item
            for group in result["groups"]
            for item in group["items"]
        }
        self.assertEqual(set(items), {"ready", "missing-sell-in", "missing-vat", "not-applicable"})
        self.assertEqual(items["ready"]["advice_state"], "ready")
        self.assertEqual(items["missing-sell-in"]["advice_state"], "missing_sell_in")
        self.assertEqual(items["missing-vat"]["advice_state"], "missing_vat")
        self.assertEqual(items["not-applicable"]["advice_state"], "not_applicable")
        self.assertEqual(result["summary"]["sku_count"], 4)

    def test_missing_live_channel_does_not_fall_back_to_activation_snapshot(self) -> None:
        dossier = _dossier([_sku("sku-blond", "Blond")])
        result = active_recommended_price_service.build_active_recommended_prices(
            dossier,
            _sales_projection(
                dossier, [_live_price("price-target", "sku-blond", 15)]
            ),
            live_advice_rows=[],
            configured_channels=[{"code": "horeca", "naam": "Horeca"}],
            vat_by_sku={"sku-blond": "21%"},
            can_edit=True,
        )

        channel = result["channels"][0]
        self.assertIsNone(channel["advice_markup_pct"])
        self.assertEqual(channel["activation_advice_markup_pct"], 190.0)
        self.assertEqual(channel["markup_state"], "missing")
        self.assertTrue(channel["editable"])

    def test_sales_binding_mismatch_fails_closed(self) -> None:
        dossier = _dossier([_sku("sku-blond", "Blond")])
        sales = _sales_projection(
            dossier, [_live_price("price-target", "sku-blond", 15)]
        )
        sales["binding"]["run_id"] = "another-run"
        result = active_recommended_price_service.build_active_recommended_prices(
            dossier,
            sales,
            live_advice_rows=[_live_advice()],
            configured_channels=[],
            vat_by_sku={},
        )
        self.assertEqual(result["status"], "missing")
        self.assertIn("active_sales_strategy_binding_mismatch", result["reason_codes"])


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
            live = _live_price("price-target", "sku-blond", 16)
            return _Result(
                all_rows=[
                    (
                        live["id"],
                        live["record_type"],
                        live["year"],
                        live["payload"],
                        live["updated_at"],
                    )
                ]
            )
        if "FROM advice_channel_pricing" in normalized:
            live = _live_advice()
            return _Result(
                all_rows=[
                    (
                        live["id"],
                        live["year"],
                        live["channel_code"],
                        live["advice_markup_pct"],
                        live["created_at"],
                        live["updated_at"],
                    )
                ]
            )
        if "FROM app_datasets" in normalized:
            return _Result(one=([{"code": "horeca", "naam": "Horeca"}],))
        if "FROM commercial_yearset_candidate_skus" in normalized:
            return _Result(all_rows=[("sku-blond", "21%")])
        raise AssertionError(f"Unexpected SQL: {normalized}")


class ActiveRecommendedPriceReaderTests(unittest.TestCase):
    def test_reader_is_strictly_read_only_and_never_initializes_schema(self) -> None:
        dossier = _dossier([_sku("sku-blond", "Blond")])
        connection = _ReadConnection()

        @contextmanager
        def connect():
            yield connection

        with (
            patch.object(
                active_recommended_price_service.yearset_dossier_service,
                "read_active_yearset_dossier",
                return_value=dossier,
            ),
            patch.object(active_recommended_price_service.postgres_storage, "connect", connect),
            patch.object(
                active_recommended_price_service.postgres_storage,
                "ensure_schema",
                side_effect=AssertionError("read path may not initialize schema"),
            ),
        ):
            result = active_recommended_price_service.read_active_recommended_prices()

        self.assertEqual(connection.statements[0], "SET TRANSACTION READ ONLY")
        self.assertEqual(result["groups"][0]["items"][0]["advice_state"], "ready")


class _WriteConnection:
    def __init__(self, selected=None):
        self.selected = selected
        self.statements: list[str] = []
        self.write_params: list[tuple] = []

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
        if "FROM commercial_yearset_candidate_channels" in normalized:
            return _Result(one=(190, "ready", []))
        if "FROM advice_channel_pricing" in normalized:
            return _Result(one=self.selected)
        if normalized.startswith("UPDATE advice_channel_pricing") or normalized.startswith(
            "INSERT INTO advice_channel_pricing"
        ):
            self.write_params.append(tuple(params))
            return _Result()
        raise AssertionError(f"Unexpected SQL: {normalized}")


class ActiveRecommendedPriceWriterTests(unittest.TestCase):
    def _selected(self):
        return (
            "11111111-1111-1111-1111-111111111111",
            2026,
            "horeca",
            190,
            "2026-01-01T00:00:00+00:00",
            "2026-01-02T00:00:00+00:00",
        )

    def _hash(self) -> str:
        selected = self._selected()
        return active_recommended_price_service._channel_row_hash(
            {
                "id": selected[0],
                "year": selected[1],
                "channel_code": selected[2],
                "advice_markup_pct": selected[3],
                "created_at": selected[4],
                "updated_at": selected[5],
            }
        )

    def test_writer_updates_only_exact_channel_without_delete(self) -> None:
        connection = _WriteConnection(self._selected())

        @contextmanager
        def transaction():
            yield connection

        with (
            patch.object(active_recommended_price_service.postgres_storage, "transaction", transaction),
            patch.object(
                active_recommended_price_service,
                "read_active_recommended_prices",
                return_value={"status": "ready", "saved": True},
            ),
        ):
            result = active_recommended_price_service.update_active_recommended_prices(
                generation_id="generation-2026",
                run_id="run-2026",
                manifest_hash="manifest-2026",
                changes=[
                    {
                        "channel_code": "horeca",
                        "advice_markup_pct": 195,
                        "pricing_record_id": self._selected()[0],
                        "expected_record_hash": self._hash(),
                    }
                ],
                actor="admin",
            )

        self.assertEqual(result, {"status": "ready", "saved": True})
        self.assertEqual(connection.write_params[0][0], 195.0)
        self.assertFalse(any("DELETE FROM" in sql for sql in connection.statements))
        self.assertFalse(any("commercial_yearset_candidate_channels SET" in sql for sql in connection.statements))

    def test_writer_creates_deterministic_missing_channel_row(self) -> None:
        connection = _WriteConnection(None)

        @contextmanager
        def transaction():
            yield connection

        with (
            patch.object(active_recommended_price_service.postgres_storage, "transaction", transaction),
            patch.object(
                active_recommended_price_service,
                "read_active_recommended_prices",
                return_value={"status": "ready"},
            ),
        ):
            active_recommended_price_service.update_active_recommended_prices(
                generation_id="generation-2026",
                run_id="run-2026",
                manifest_hash="manifest-2026",
                changes=[
                    {
                        "channel_code": "horeca",
                        "advice_markup_pct": 190,
                        "pricing_record_id": "",
                        "expected_record_hash": "",
                    }
                ],
                actor="admin",
            )

        self.assertEqual(
            connection.write_params[0][0],
            active_recommended_price_service._new_record_id(2026, "horeca"),
        )
        self.assertFalse(any("DELETE FROM" in sql for sql in connection.statements))

    def test_writer_rejects_stale_hash_before_write(self) -> None:
        connection = _WriteConnection(self._selected())

        @contextmanager
        def transaction():
            yield connection

        with patch.object(
            active_recommended_price_service.postgres_storage, "transaction", transaction
        ):
            with self.assertRaises(
                active_recommended_price_service.ActiveRecommendedPriceConflict
            ):
                active_recommended_price_service.update_active_recommended_prices(
                    generation_id="generation-2026",
                    run_id="run-2026",
                    manifest_hash="manifest-2026",
                    changes=[
                        {
                            "channel_code": "horeca",
                            "advice_markup_pct": 195,
                            "pricing_record_id": self._selected()[0],
                            "expected_record_hash": "stale",
                        }
                    ],
                    actor="admin",
                )
        self.assertEqual(connection.write_params, [])


class ActiveRecommendedPriceFrontendContractTests(unittest.TestCase):
    def test_runtime_screen_uses_active_projection_while_wizard_stays_separate(self) -> None:
        page = (PROJECT_ROOT / "frontend/src/app/(app)/adviesprijzen/page.tsx").read_text(
            encoding="utf-8"
        )
        workspace = (PROJECT_ROOT / "frontend/src/components/AdviesprijzenWorkspace.tsx").read_text(
            encoding="utf-8"
        )
        wizard = (
            PROJECT_ROOT / "frontend/src/components/nieuw-jaar/steps/AdviesprijzenTargetsStep.tsx"
        ).read_text(encoding="utf-8")

        self.assertIn("/meta/commercial-yearsets/active/recommended-prices", page)
        self.assertNotIn("RECOMMENDED_PRICE_DATASET_KEYS", page)
        self.assertIn("expected_record_hash", workspace)
        self.assertNotIn("useCentralSkuIndex", workspace)
        self.assertNotIn("reconcileDatasetItems", workspace)
        self.assertIn("setDraftAdviesprijzenTarget", wizard)
        self.assertNotIn("/commercial-yearsets/active/recommended-prices", wizard)


if __name__ == "__main__":
    unittest.main()
