from __future__ import annotations

import json
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from threading import Barrier
from typing import Any
from unittest.mock import Mock, patch

from fastapi import HTTPException


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.api.routes import data as data_routes  # noqa: E402
from app.api.routes import meta  # noqa: E402
from app.domain import (  # noqa: E402
    break_even_planning_service,
    break_even_planning_storage,
    company_distance_storage,
    cost_versions_storage,
    dataset_store,
    douano_sync_storage,
    kostprijs_activation_storage,
    lot_costs_storage,
    postgres_storage,
    quote_drafts_storage,
    skus_storage,
)
from app.domain.ors_client import Coordinate  # noqa: E402
from tests.postgres_disposable import (  # noqa: E402
    DisposablePostgresDatabase,
    integration_tests_enabled,
)


def _quote_payload(*, status: str = "concept", marker: str = "fixture") -> dict[str, Any]:
    return {
        "kind": "offerte-draft",
        "schemaVersion": 1,
        "draft": {
            "year": 2026,
            "basis": {
                "klantNaam": "RF-004 klant",
                "contactpersoon": "Test",
                "kanaal": "horeca",
                "offerteNaam": marker,
                "geldigTot": "2026-12-31",
            },
            "scenarios": {"A": {"marker": marker}},
            "ui": {"activeScenario": "A"},
            "meta": {"status": status},
        },
    }


def _seed_cost_activation_prerequisites(database: DisposablePostgresDatabase) -> None:
    skus_storage.ensure_schema()
    cost_versions_storage.ensure_schema()
    kostprijs_activation_storage.ensure_schema()
    with database.connect() as conn:
        conn.execute(
            """
            INSERT INTO skus (id, kind, article_id)
            VALUES
                ('rf004-sku-1', 'article', 'rf004-article-1'),
                ('rf004-sku-2', 'article', 'rf004-article-2')
            """
        )
        conn.execute(
            """
            INSERT INTO cost_versions (id, jaar, status, bier_id, versie_nummer, payload)
            VALUES
                ('rf004-version-1', 2026, 'definitief', 'rf004-beer', 1, '{}'::jsonb),
                ('rf004-version-2', 2026, 'definitief', 'rf004-beer', 2, '{}'::jsonb)
            """
        )


def _insert_marker(stage: str) -> None:
    with postgres_storage.connect() as conn:
        conn.execute(
            "INSERT INTO rf004_new_year_markers(stage) VALUES (%s) ON CONFLICT (stage) DO NOTHING",
            (stage,),
        )


class _FakeOrsClient:
    def __init__(
        self,
        *,
        customer_geocodes: list[Coordinate | None | Exception],
        distances: list[float | None | Exception] | None = None,
    ) -> None:
        self.customer_geocodes = list(customer_geocodes)
        self.distances = list(distances or [])
        self.geocode_calls: list[str] = []
        self.distance_calls = 0

    def is_configured(self) -> bool:
        return True

    async def geocode(self, query: str, **_: Any) -> Coordinate | None:
        if not postgres_storage.in_transaction():
            raise AssertionError("ORS geocode no longer runs inside the current transaction")
        self.geocode_calls.append(query)
        if len(self.geocode_calls) == 1:
            return Coordinate(lat=52.0, lng=6.3)
        action = self.customer_geocodes.pop(0)
        if isinstance(action, Exception):
            raise action
        return action

    async def driving_distance_km_one_way(self, *_: Any) -> float | None:
        if not postgres_storage.in_transaction():
            raise AssertionError("ORS directions no longer run inside the current transaction")
        self.distance_calls += 1
        action = self.distances.pop(0)
        if isinstance(action, Exception):
            raise action
        return action


@unittest.skipUnless(
    integration_tests_enabled(),
    "requires explicit loopback disposable PostgreSQL opt-in",
)
class WorkflowPostgresCharacterizationTests(unittest.IsolatedAsyncioTestCase):
    def test_cost_activation_is_idempotent_per_version_and_preserves_history_on_change(self) -> None:
        with DisposablePostgresDatabase() as database:
            _seed_cost_activation_prerequisites(database)
            first = {
                "sku_id": "rf004-sku-1",
                "jaar": 2026,
                "kostprijsversie_id": "rf004-version-1",
            }
            kostprijs_activation_storage.activate_activations([first])
            kostprijs_activation_storage.activate_activations([first])

            with database.connect() as conn:
                active_after_retry = int(
                    conn.execute(
                        "SELECT COUNT(*) FROM kostprijs_sku_activations WHERE effectief_tot IS NULL"
                    ).fetchone()[0]
                )
                events_after_retry = int(
                    conn.execute("SELECT COUNT(*) FROM kostprijs_sku_activation_events").fetchone()[0]
                )

            self.assertEqual(active_after_retry, 1)
            self.assertEqual(events_after_retry, 1)

            kostprijs_activation_storage.activate_activations(
                [{**first, "kostprijsversie_id": "rf004-version-2"}]
            )
            with database.connect() as conn:
                active_rows = conn.execute(
                    """
                    SELECT kostprijsversie_id FROM kostprijs_sku_activations
                    WHERE effectief_tot IS NULL
                    """
                ).fetchall()
                closed_count = int(
                    conn.execute(
                        "SELECT COUNT(*) FROM kostprijs_sku_activations WHERE effectief_tot IS NOT NULL"
                    ).fetchone()[0]
                )
                event_count = int(
                    conn.execute("SELECT COUNT(*) FROM kostprijs_sku_activation_events").fetchone()[0]
                )

            self.assertEqual(active_rows, [("rf004-version-2",)])
            self.assertEqual(closed_count, 1)
            self.assertEqual(event_count, 2)

    def test_cost_activation_batch_rolls_back_when_later_fk_write_fails(self) -> None:
        with DisposablePostgresDatabase() as database:
            _seed_cost_activation_prerequisites(database)
            with self.assertRaises(Exception) as raised:
                kostprijs_activation_storage.activate_activations(
                    [
                        {
                            "sku_id": "rf004-sku-1",
                            "jaar": 2026,
                            "kostprijsversie_id": "rf004-version-1",
                        },
                        {
                            "sku_id": "rf004-sku-2",
                            "jaar": 2026,
                            "kostprijsversie_id": "rf004-missing-version",
                        },
                    ]
                )

            with database.connect() as conn:
                activation_count = int(
                    conn.execute("SELECT COUNT(*) FROM kostprijs_sku_activations").fetchone()[0]
                )
                event_count = int(
                    conn.execute("SELECT COUNT(*) FROM kostprijs_sku_activation_events").fetchone()[0]
                )
            self.assertEqual(getattr(raised.exception, "sqlstate", ""), "23503")
            self.assertEqual(activation_count, 0)
            self.assertEqual(event_count, 0)

    def test_cost_route_snapshot_failure_leaves_activation_and_retry_is_idempotent(self) -> None:
        with DisposablePostgresDatabase() as database:
            _seed_cost_activation_prerequisites(database)

            def activate(_: str, **__: Any) -> dict[str, Any]:
                kostprijs_activation_storage.activate_activations(
                    [
                        {
                            "sku_id": "rf004-sku-1",
                            "jaar": 2026,
                            "kostprijsversie_id": "rf004-version-1",
                        }
                    ]
                )
                return {"id": "rf004-version-1", "jaar": 2026, "status": "definitief"}

            with patch.object(dataset_store, "activate_cost_version", side_effect=activate), patch.object(
                data_routes.douano_margin_service,
                "backfill_line_snapshots_for_year",
                side_effect=RuntimeError("injected snapshot failure"),
            ):
                with self.assertRaises(HTTPException) as raised:
                    data_routes.post_activate_kostprijsversie("rf004-version-1", data={}, _={})
            self.assertEqual(raised.exception.status_code, 500)

            with database.connect() as conn:
                active_after_failure = int(
                    conn.execute(
                        "SELECT COUNT(*) FROM kostprijs_sku_activations WHERE effectief_tot IS NULL"
                    ).fetchone()[0]
                )

            with patch.object(dataset_store, "activate_cost_version", side_effect=activate), patch.object(
                data_routes.douano_margin_service,
                "backfill_line_snapshots_for_year",
                return_value={"computed": 0},
            ):
                result = data_routes.post_activate_kostprijsversie("rf004-version-1", data={}, _={})

            with database.connect() as conn:
                active_after_retry = int(
                    conn.execute(
                        "SELECT COUNT(*) FROM kostprijs_sku_activations WHERE effectief_tot IS NULL"
                    ).fetchone()[0]
                )
                event_count = int(
                    conn.execute("SELECT COUNT(*) FROM kostprijs_sku_activation_events").fetchone()[0]
                )

            self.assertEqual(active_after_failure, 1)
            self.assertTrue(result["activated"])
            self.assertEqual(active_after_retry, 1)
            self.assertEqual(event_count, 1)

    def test_quote_duplicate_submit_creates_distinct_drafts_and_numbers(self) -> None:
        with DisposablePostgresDatabase():
            first = quote_drafts_storage.save_draft(_quote_payload(marker="same-submit"))
            second = quote_drafts_storage.save_draft(_quote_payload(marker="same-submit"))

            self.assertNotEqual(first["id"], second["id"])
            self.assertEqual(first["quote_number"], "OFF-2026-0001")
            self.assertEqual(second["quote_number"], "OFF-2026-0002")
            self.assertEqual(first["draft_version"], 1)
            self.assertEqual(second["draft_version"], 1)

    def test_final_quote_rejects_update_but_delete_remains_allowed(self) -> None:
        with DisposablePostgresDatabase():
            final = quote_drafts_storage.save_draft(
                _quote_payload(status="definitief", marker="final")
            )
            with self.assertRaisesRegex(ValueError, "definitief"):
                quote_drafts_storage.save_draft(
                    _quote_payload(status="concept", marker="edit-final"),
                    draft_id=str(final["id"]),
                )

            deleted = quote_drafts_storage.delete_draft(str(final["id"]))
            self.assertEqual(deleted, {"deleted": 1})
            self.assertIsNone(quote_drafts_storage.get_draft(str(final["id"])))

    def test_concurrent_quote_create_exposes_max_plus_one_unique_conflict(self) -> None:
        with DisposablePostgresDatabase() as database:
            quote_drafts_storage.ensure_schema()
            barrier = Barrier(2)
            original_next = quote_drafts_storage._next_quote_number_seq

            def synchronized_next(cur: Any, *, year: int) -> int:
                value = original_next(cur, year=year)
                barrier.wait(timeout=15)
                return value

            def create(marker: str) -> dict[str, Any]:
                return quote_drafts_storage.save_draft(_quote_payload(marker=marker))

            successes: list[dict[str, Any]] = []
            failures: list[BaseException] = []
            with patch.object(
                quote_drafts_storage,
                "_next_quote_number_seq",
                side_effect=synchronized_next,
            ), ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(create, marker) for marker in ("concurrent-a", "concurrent-b")]
                for future in futures:
                    try:
                        successes.append(future.result(timeout=30))
                    except BaseException as exc:  # noqa: BLE001 - exact DB failure is the contract
                        failures.append(exc)

            with database.connect() as conn:
                count = int(conn.execute("SELECT COUNT(*) FROM quote_drafts").fetchone()[0])

            self.assertEqual(len(successes), 1)
            self.assertEqual(len(failures), 1)
            self.assertEqual(getattr(failures[0], "sqlstate", ""), "23505")
            self.assertEqual(count, 1)

    def test_douano_older_raw_version_overwrites_newer_version(self) -> None:
        with DisposablePostgresDatabase() as database:
            douano_sync_storage.upsert_raw_object(
                resource="products",
                external_id=501,
                entity_version=5,
                payload={"id": 501, "entity_version": 5, "name": "newer"},
            )
            douano_sync_storage.upsert_raw_object(
                resource="products",
                external_id=501,
                entity_version=3,
                payload={"id": 501, "entity_version": 3, "name": "older"},
            )

            with database.connect() as conn:
                version, payload = conn.execute(
                    """
                    SELECT entity_version, payload FROM douano_raw_objects
                    WHERE resource = 'products' AND external_id = 501
                    """
                ).fetchone()

            self.assertEqual(version, 3)
            self.assertEqual(payload["name"], "older")

    def test_douano_order_rerun_does_not_remove_missing_child_line(self) -> None:
        with DisposablePostgresDatabase() as database:
            base = {
                "id": 601,
                "entity_version": 1,
                "date": "2026-07-01",
                "transaction_number": "SO-601",
                "status": "open",
                "company": {"id": 1},
                "returned_items": [],
                "miscellaneous_items": [],
            }
            line_one = {"id": 6101, "product": {"id": 1, "name": "One"}, "quantity": 1, "price": 10}
            line_two = {"id": 6102, "product": {"id": 2, "name": "Two"}, "quantity": 1, "price": 20}
            douano_sync_storage.upsert_sales_orders([{**base, "ordered_items": [line_one, line_two]}])
            douano_sync_storage.upsert_sales_orders([{**base, "entity_version": 2, "ordered_items": [line_one]}])

            with database.connect() as conn:
                line_ids = [
                    int(row[0])
                    for row in conn.execute(
                        "SELECT line_id FROM douano_sales_order_lines WHERE sales_order_id = 601 ORDER BY line_id"
                    ).fetchall()
                ]

            self.assertEqual(line_ids, [6101, 6102])

    def test_lot_projection_failure_is_suppressed_and_primary_retry_is_idempotent(self) -> None:
        with DisposablePostgresDatabase() as database, patch.object(
            lot_costs_storage.product_model_storage,
            "upsert_purchase_lot_cost",
            side_effect=RuntimeError("injected projection failure"),
        ):
            payload = {
                "source_type": "purchase_invoice",
                "source_ref": "INV-RF004",
                "supplier": "Supplier",
                "lot_number": "LOT-RF004",
                "sku_code": "SKU-RF004",
                "purchase_price_input": 12.5,
            }
            first = lot_costs_storage.upsert_lot_cost_record(payload)
            second = lot_costs_storage.upsert_lot_cost_record(payload)

            with database.connect() as conn:
                count = int(conn.execute("SELECT COUNT(*) FROM lot_cost_records").fetchone()[0])

            self.assertEqual(first["id"], second["id"])
            self.assertEqual(count, 1)

    def test_repeated_stock_file_creates_a_new_import_batch(self) -> None:
        with DisposablePostgresDatabase() as database:
            item = {
                "transaction_number": "TX-RF004",
                "sku_code": "SKU-RF004",
                "lot_number": "LOT-RF004",
                "movement_date": None,
                "product_name": "Product",
                "company_name": "Customer",
                "quantity": 2,
                "stock_value_per_unit": 3,
                "excise_per_unit": 0,
                "movement_type": "sale",
                "movement_reason": "removed",
                "payload": {},
            }
            summary = {
                "rows": 1,
                "matched": 1,
                "unmatched": 0,
                "missing_lot": 0,
                "missing_sku": 0,
                "missing_transaction": 0,
            }
            with patch.object(lot_costs_storage, "_load_stock_history_rows", return_value=[]), patch.object(
                lot_costs_storage,
                "_match_stock_rows",
                return_value=([item], summary),
            ):
                first = lot_costs_storage.confirm_stock_history_import(b"fixture", "same-file.csv")
                second = lot_costs_storage.confirm_stock_history_import(b"fixture", "same-file.csv")

            with database.connect() as conn:
                count = int(conn.execute("SELECT COUNT(*) FROM sales_lot_allocations").fetchone()[0])

            self.assertNotEqual(
                first["summary"]["import_batch_id"],
                second["summary"]["import_batch_id"],
            )
            self.assertEqual(count, 2)

    def test_year_close_snapshot_survives_later_production_failure_and_requires_overwrite_retry(self) -> None:
        with DisposablePostgresDatabase() as database:
            break_even_planning_storage.ensure_schema()
            payload = {
                "critical_errors": [],
                "drivers": {
                    "purchase_liters": {"value": 100},
                    "production_liters": {"value": 90},
                    "sales_liters": {"value": 80},
                },
            }
            with patch.object(
                break_even_planning_service,
                "build_year_close_payload",
                return_value=payload,
            ), patch.object(
                break_even_planning_service.production_storage,
                "update_realised_liters_for_year",
                side_effect=RuntimeError("injected production update failure"),
            ):
                with self.assertRaisesRegex(RuntimeError, "production update failure"):
                    break_even_planning_service.close_year(year=2026)

            persisted = break_even_planning_storage.get_year_close_snapshot(year=2026)
            self.assertIsNotNone(persisted)
            self.assertEqual(persisted["status"], "closed")

            production_update = Mock()
            with patch.object(
                break_even_planning_service,
                "build_year_close_payload",
                return_value=payload,
            ), patch.object(
                break_even_planning_service.production_storage,
                "update_realised_liters_for_year",
                production_update,
            ):
                with self.assertRaisesRegex(ValueError, "al afgesloten"):
                    break_even_planning_service.close_year(year=2026, overwrite=False)
                production_update.assert_not_called()

                retried = break_even_planning_service.close_year(year=2026, overwrite=True)

            with database.connect() as conn:
                count = int(conn.execute("SELECT COUNT(*) FROM year_close_snapshots").fetchone()[0])
            self.assertEqual(retried["id"], persisted["id"])
            self.assertEqual(count, 1)
            production_update.assert_called_once()

    def test_new_year_failure_rolls_back_all_target_markers(self) -> None:
        with DisposablePostgresDatabase() as database:
            postgres_storage.ensure_schema()
            with database.connect() as conn:
                conn.execute("CREATE TABLE rf004_new_year_markers(stage TEXT PRIMARY KEY)")

            def prepare(**_: Any) -> dict[str, Any]:
                _insert_marker("seed")
                return {"results": {"seed": True}}

            def persist(**_: Any) -> None:
                _insert_marker("engine")
                raise RuntimeError("injected engine failure")

            with patch.object(dataset_store, "require_postgres"), patch.object(
                dataset_store,
                "_costprice_engine_rows_from_payload",
                return_value=[{"sku_id": "rf004"}],
            ), patch.object(
                dataset_store,
                "load_new_year_draft",
                return_value={"source_fingerprints": {"source": "same"}},
            ), patch.object(
                dataset_store,
                "_compute_source_fingerprints",
                return_value={"source": "same"},
            ), patch.object(dataset_store, "prepare_new_year", side_effect=prepare), patch.object(
                dataset_store,
                "_persist_costprice_engine_rows",
                side_effect=persist,
            ):
                with self.assertRaisesRegex(RuntimeError, "engine failure"):
                    dataset_store.commit_new_year(
                        source_year=2026,
                        target_year=2027,
                        owner="alice",
                        payload={"data": {}},
                    )

            with database.connect() as conn:
                count = int(conn.execute("SELECT COUNT(*) FROM rf004_new_year_markers").fetchone()[0])
            self.assertEqual(count, 0)

    def test_new_year_success_commits_while_failed_draft_delete_is_reported(self) -> None:
        with DisposablePostgresDatabase() as database:
            postgres_storage.ensure_schema()
            with database.connect() as conn:
                conn.execute("CREATE TABLE rf004_new_year_markers(stage TEXT PRIMARY KEY)")

            def prepare(**_: Any) -> dict[str, Any]:
                _insert_marker("seed")
                return {"results": {"seed": True}}

            def persist(**_: Any) -> None:
                _insert_marker("engine")

            with patch.object(dataset_store, "require_postgres"), patch.object(
                dataset_store,
                "_costprice_engine_rows_from_payload",
                return_value=[{"sku_id": "rf004"}],
            ), patch.object(
                dataset_store,
                "load_new_year_draft",
                return_value={"source_fingerprints": {"source": "same"}},
            ), patch.object(
                dataset_store,
                "_compute_source_fingerprints",
                return_value={"source": "same"},
            ), patch.object(dataset_store, "prepare_new_year", side_effect=prepare), patch.object(
                dataset_store,
                "_persist_costprice_engine_rows",
                side_effect=persist,
            ), patch.object(
                dataset_store,
                "delete_new_year_draft",
                side_effect=RuntimeError("injected draft delete failure"),
            ):
                result = dataset_store.commit_new_year(
                    source_year=2026,
                    target_year=2027,
                    owner="alice",
                    payload={"data": {}},
                )

            with database.connect() as conn:
                stages = [
                    str(row[0])
                    for row in conn.execute(
                        "SELECT stage FROM rf004_new_year_markers ORDER BY stage"
                    ).fetchall()
                ]
            self.assertEqual(stages, ["engine", "seed"])
            self.assertFalse(result["results"]["draft_deleted"])

    def test_new_year_source_conflict_stops_before_transaction_unless_forced(self) -> None:
        with DisposablePostgresDatabase():
            prepare = Mock(return_value={"results": {}})
            with patch.object(dataset_store, "require_postgres"), patch.object(
                dataset_store,
                "_costprice_engine_rows_from_payload",
                return_value=[{"sku_id": "rf004"}],
            ), patch.object(
                dataset_store,
                "load_new_year_draft",
                return_value={"source_fingerprints": {"source": "old"}},
            ), patch.object(
                dataset_store,
                "_compute_source_fingerprints",
                return_value={"source": "new"},
            ), patch.object(dataset_store, "prepare_new_year", prepare):
                with self.assertRaisesRegex(ValueError, "Bronjaar is gewijzigd"):
                    dataset_store.commit_new_year(
                        source_year=2026,
                        target_year=2027,
                        owner="alice",
                        payload={"data": {}},
                    )
            prepare.assert_not_called()

    async def test_ors_dry_run_holds_transaction_but_writes_no_cache(self) -> None:
        with DisposablePostgresDatabase() as database:
            self._seed_companies(database, count=1)
            fake = _FakeOrsClient(
                customer_geocodes=[Coordinate(lat=52.1, lng=6.4)],
                distances=[12.34],
            )
            with patch.object(meta, "OrsClient", return_value=fake):
                result = await meta.post_compute_company_distances(
                    dry_run=True,
                    overwrite=False,
                    limit=1,
                    exclude_particulier=True,
                    session={"username": "admin"},
                )

            with database.connect() as conn:
                count = int(conn.execute("SELECT COUNT(*) FROM company_distance_cache").fetchone()[0])
            self.assertEqual(result["result"]["updated"], 1)
            self.assertEqual(count, 0)
            self.assertEqual(fake.distance_calls, 1)

    async def test_ors_success_cache_makes_retry_skip_customer_without_overwrite(self) -> None:
        with DisposablePostgresDatabase() as database:
            self._seed_companies(database, count=1)
            first = _FakeOrsClient(
                customer_geocodes=[Coordinate(lat=52.1, lng=6.4)],
                distances=[9.87],
            )
            with patch.object(meta, "OrsClient", return_value=first):
                await meta.post_compute_company_distances(
                    dry_run=False,
                    overwrite=False,
                    limit=1,
                    exclude_particulier=True,
                    session={"username": "admin"},
                )

            retry = _FakeOrsClient(customer_geocodes=[])
            with patch.object(meta, "OrsClient", return_value=retry):
                result = await meta.post_compute_company_distances(
                    dry_run=False,
                    overwrite=False,
                    limit=1,
                    exclude_particulier=True,
                    session={"username": "admin"},
                )

            cache = company_distance_storage.get_cache(1)
            self.assertEqual(result["result"]["skipped_cached"], 1)
            self.assertEqual(result["result"]["updated"], 0)
            self.assertEqual(len(retry.geocode_calls), 1)
            self.assertEqual(cache["status"], "ok")
            self.assertAlmostEqual(cache["distance_km_one_way"], 9.87)

    async def test_ors_per_company_geocode_failure_is_committed_as_status(self) -> None:
        with DisposablePostgresDatabase() as database:
            self._seed_companies(database, count=1)
            fake = _FakeOrsClient(customer_geocodes=[None])
            with patch.object(meta, "OrsClient", return_value=fake):
                result = await meta.post_compute_company_distances(
                    dry_run=False,
                    overwrite=False,
                    limit=1,
                    exclude_particulier=True,
                    session={"username": "admin"},
                )

            cache = company_distance_storage.get_cache(1)
            self.assertEqual(result["result"]["geocode_failed"], 1)
            self.assertEqual(cache["status"], "geocode_failed")

    async def test_ors_raised_failure_rolls_back_earlier_cache_write(self) -> None:
        with DisposablePostgresDatabase() as database:
            self._seed_companies(database, count=2)
            fake = _FakeOrsClient(
                customer_geocodes=[
                    Coordinate(lat=52.1, lng=6.4),
                    RuntimeError("injected ORS transport failure"),
                ],
                distances=[8.5],
            )
            with patch.object(meta, "OrsClient", return_value=fake):
                with self.assertRaises(HTTPException) as raised:
                    await meta.post_compute_company_distances(
                        dry_run=False,
                        overwrite=False,
                        limit=2,
                        exclude_particulier=True,
                        session={"username": "admin"},
                    )

            with database.connect() as conn:
                count = int(conn.execute("SELECT COUNT(*) FROM company_distance_cache").fetchone()[0])
            self.assertEqual(raised.exception.status_code, 500)
            self.assertEqual(count, 0)

    @staticmethod
    def _seed_companies(database: DisposablePostgresDatabase, *, count: int) -> None:
        company_distance_storage.ensure_schema()
        douano_sync_storage.ensure_schema()
        with database.connect() as conn:
            for company_id in range(1, count + 1):
                conn.execute(
                    """
                    INSERT INTO douano_companies (
                        company_id, name, public_name, is_customer,
                        invoice_address_line1, invoice_post_code, invoice_city,
                        invoice_country, sales_price_class_name
                    ) VALUES (%s, %s, %s, TRUE, %s, %s, %s, %s, %s)
                    """,
                    (
                        company_id,
                        f"Company {company_id}",
                        f"Company {company_id}",
                        f"Teststraat {company_id}",
                        "1234AB",
                        "Teststad",
                        "Nederland",
                        "Zakelijk",
                    ),
                )


if __name__ == "__main__":
    unittest.main()
