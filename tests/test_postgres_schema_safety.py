from __future__ import annotations

import json
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import (  # noqa: E402
    cost_versions_storage,
    dashboard_service,
    dataset_store,
    kostprijs_activation_storage,
    postgres_storage,
    production_storage,
    quote_drafts_storage,
    skus_storage,
)
from tests.postgres_disposable import (  # noqa: E402
    DisposablePostgresDatabase,
    data_snapshot,
    integration_tests_enabled,
    reset_application_database_state,
    schema_snapshot,
)


LEGACY_QUOTE_TABLES = (
    "price_quote_variant_staffels",
    "price_quote_variant_lines",
    "price_quote_variant_periods",
    "price_quote_variants",
    "price_quote_staffels",
    "price_quote_lines",
    "price_quotes",
)
LEGACY_QUOTE_DATASETS = (
    "prijsvoorstellen",
    "quotes",
    "quote-lines",
    "quote-staffels",
)


def _create_legacy_quote_shapes(database: DisposablePostgresDatabase) -> None:
    postgres_storage.ensure_schema()
    with database.connect() as conn:
        for table in LEGACY_QUOTE_TABLES:
            conn.execute(f'CREATE TABLE "{table}" (id INTEGER PRIMARY KEY, payload JSONB)')
            conn.execute(
                f'INSERT INTO "{table}" (id, payload) VALUES (1, %s::jsonb)',
                (json.dumps({"legacy": table}),),
            )
        for dataset in LEGACY_QUOTE_DATASETS:
            conn.execute(
                """
                INSERT INTO app_datasets (dataset_name, payload)
                VALUES (%s, %s::jsonb)
                """,
                (dataset, json.dumps([{"legacy": dataset}])),
            )
        conn.execute("CREATE TABLE rf003_unrelated_sentinel (id INTEGER PRIMARY KEY)")
        conn.execute("INSERT INTO rf003_unrelated_sentinel (id) VALUES (1)")


@unittest.skipUnless(
    integration_tests_enabled(),
    "requires explicit loopback disposable PostgreSQL opt-in",
)
class PostgresSchemaSafetyTests(unittest.TestCase):
    def test_fresh_repeated_and_concurrent_initialization_is_stable(self) -> None:
        with DisposablePostgresDatabase() as database:
            reset_application_database_state()
            barrier = Barrier(6)

            def initialize() -> None:
                barrier.wait()
                postgres_storage.ensure_schema()
                quote_drafts_storage.ensure_schema()

            with ThreadPoolExecutor(max_workers=6) as executor:
                futures = [executor.submit(initialize) for _ in range(6)]
                for future in futures:
                    future.result(timeout=30)

            with database.connect() as conn:
                first_schema = schema_snapshot(conn)

            reset_application_database_state()
            postgres_storage.ensure_schema()
            quote_drafts_storage.ensure_schema()
            with database.connect() as conn:
                second_schema = schema_snapshot(conn)

            self.assertEqual(first_schema, second_schema)

    def test_current_quote_schema_reinitialization_preserves_current_rows(self) -> None:
        with DisposablePostgresDatabase() as database:
            quote_drafts_storage.ensure_schema()
            with database.connect() as conn:
                conn.execute(
                    """
                    INSERT INTO quote_drafts (
                        id, quote_number, quote_number_seq, schema_version, draft_version,
                        status, year, created_at, updated_at, payload
                    ) VALUES (
                        'rf003-current', 'OFF-2099-0001', 1, 2, 1,
                        'concept', 2099, NOW(), NOW(), %s::jsonb
                    )
                    """,
                    (json.dumps({"kind": "offerte-draft", "draft": {}}),),
                )
                before = schema_snapshot(conn)

            reset_application_database_state()
            quote_drafts_storage.ensure_schema()
            with database.connect() as conn:
                after = schema_snapshot(conn)
                row = conn.execute(
                    "SELECT id, quote_number FROM quote_drafts WHERE id = 'rf003-current'"
                ).fetchone()

            self.assertEqual(before, after)
            self.assertEqual(row, ("rf003-current", "OFF-2099-0001"))

    def test_legacy_quote_shapes_are_destructively_removed_only_in_fixture(self) -> None:
        with DisposablePostgresDatabase() as database:
            _create_legacy_quote_shapes(database)

            quote_drafts_storage.ensure_schema()

            with database.connect() as conn:
                remaining_tables = {
                    str(row[0])
                    for row in conn.execute(
                        """
                        SELECT tablename FROM pg_tables
                        WHERE schemaname = 'public'
                        """
                    ).fetchall()
                }
                remaining_datasets = {
                    str(row[0])
                    for row in conn.execute(
                        "SELECT dataset_name FROM app_datasets"
                    ).fetchall()
                }
                sentinel_count = int(
                    conn.execute("SELECT COUNT(*) FROM rf003_unrelated_sentinel").fetchone()[0]
                )

            self.assertTrue(set(LEGACY_QUOTE_TABLES).isdisjoint(remaining_tables))
            self.assertTrue(set(LEGACY_QUOTE_DATASETS).isdisjoint(remaining_datasets))
            self.assertIn("quote_drafts", remaining_tables)
            self.assertEqual(sentinel_count, 1)

    def test_dashboard_first_read_mutates_schema_then_warm_read_is_pure(self) -> None:
        with DisposablePostgresDatabase() as database:
            _create_legacy_quote_shapes(database)
            with database.connect() as conn:
                schema_before = schema_snapshot(conn)
                data_before = data_snapshot(conn)

            dashboard_service.invalidate_dashboard_summary_cache()
            summary = dashboard_service.get_dashboard_summary(ttl_seconds=0)

            with database.connect() as conn:
                schema_after_first = schema_snapshot(conn)
                data_after_first = data_snapshot(conn)

            self.assertNotEqual(schema_before, schema_after_first)
            self.assertNotEqual(data_before, data_after_first)
            self.assertEqual(summary.concept_berekeningen, 0)
            self.assertEqual(summary.concept_prijsvoorstellen, 0)

            dashboard_service.invalidate_dashboard_summary_cache()
            dashboard_service.get_dashboard_summary(ttl_seconds=0)
            with database.connect() as conn:
                schema_after_second = schema_snapshot(conn)
                data_after_second = data_snapshot(conn)

            self.assertEqual(schema_after_first, schema_after_second)
            self.assertEqual(data_after_first, data_after_second)

    def test_empty_reset_is_repeatable(self) -> None:
        with DisposablePostgresDatabase() as database:
            first_results = dataset_store.reset_all_datasets_to_defaults()
            with database.connect() as conn:
                first = data_snapshot(conn, ignore_volatile_columns=True)

            second_results = dataset_store.reset_all_datasets_to_defaults()
            with database.connect() as conn:
                second = data_snapshot(conn, ignore_volatile_columns=True)

            self.assertTrue(first_results)
            self.assertTrue(all(first_results.values()))
            self.assertEqual(first_results.keys(), second_results.keys())
            self.assertEqual(first, second)

    def test_seed_bootstrap_is_semantically_repeatable(self) -> None:
        with DisposablePostgresDatabase() as database:
            first_results = dataset_store.bootstrap_postgres_from_json(overwrite=True)
            with database.connect() as conn:
                first = data_snapshot(conn, ignore_volatile_columns=True)

            second_results = dataset_store.bootstrap_postgres_from_json(overwrite=True)
            with database.connect() as conn:
                second = data_snapshot(conn, ignore_volatile_columns=True)

            self.assertTrue(first_results)
            self.assertTrue(all(first_results.values()))
            self.assertEqual(first_results.keys(), second_results.keys())
            self.assertEqual(first, second)

    def test_populated_fk_reset_exposes_current_non_atomic_partial_failure(self) -> None:
        with DisposablePostgresDatabase() as database:
            production_storage.ensure_schema()
            skus_storage.ensure_schema()
            cost_versions_storage.ensure_schema()
            kostprijs_activation_storage.ensure_schema()
            with database.connect() as conn:
                conn.execute("INSERT INTO production_years (jaar) VALUES (2099)")
                conn.execute("INSERT INTO skus (id) VALUES ('rf003-sku')")
                conn.execute(
                    """
                    INSERT INTO cost_versions (id, jaar, status, bier_id, versie_nummer)
                    VALUES ('rf003-version', 2099, 'definitief', 'rf003-beer', 1)
                    """
                )
                conn.execute(
                    """
                    INSERT INTO kostprijs_sku_activations (
                        id, sku_id, jaar, kostprijsversie_id
                    ) VALUES (
                        'rf003-activation', 'rf003-sku', 2099, 'rf003-version'
                    )
                    """
                )

            with self.assertRaises(Exception) as raised:
                dataset_store.reset_all_datasets_to_defaults()

            with database.connect() as conn:
                production_count = int(
                    conn.execute("SELECT COUNT(*) FROM production_years").fetchone()[0]
                )
                version_count = int(
                    conn.execute("SELECT COUNT(*) FROM cost_versions").fetchone()[0]
                )
                activation_count = int(
                    conn.execute("SELECT COUNT(*) FROM kostprijs_sku_activations").fetchone()[0]
                )

            self.assertEqual(getattr(raised.exception, "sqlstate", ""), "23503")
            self.assertEqual(production_count, 0)
            self.assertEqual(version_count, 1)
            self.assertEqual(activation_count, 1)

    def test_transaction_rolls_back_and_direct_connection_is_released(self) -> None:
        with DisposablePostgresDatabase() as database:
            postgres_storage.ensure_schema()
            captured_connection = None
            with postgres_storage.connect() as conn:
                captured_connection = conn
                self.assertFalse(bool(conn.closed))
            self.assertIsNotNone(captured_connection)
            self.assertTrue(bool(captured_connection.closed))

            with self.assertRaisesRegex(RuntimeError, "rf003 rollback"):
                with postgres_storage.transaction():
                    postgres_storage.save_dataset(
                        "rf003-transaction",
                        {"value": "must-roll-back"},
                    )
                    raise RuntimeError("rf003 rollback")

            self.assertIsNone(
                postgres_storage.load_app_dataset_payload("rf003-transaction")
            )

            with postgres_storage.transaction():
                postgres_storage.save_dataset(
                    "rf003-transaction",
                    {"value": "committed"},
                )
            self.assertEqual(
                postgres_storage.load_app_dataset_payload("rf003-transaction"),
                {"value": "committed"},
            )


if __name__ == "__main__":
    unittest.main()
