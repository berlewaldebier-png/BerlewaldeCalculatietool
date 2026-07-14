from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.disposable_postgres_guard import (  # noqa: E402
    DISPOSABLE_DATABASE_OPT_IN,
    UnsafePostgresTargetError,
    assert_disposable_database_url,
    assert_maintenance_database_url,
    database_url_from_environment,
    maintenance_url_from_environment,
    replace_database,
)


class DisposablePostgresGuardTests(unittest.TestCase):
    def test_opt_in_is_mandatory(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(UnsafePostgresTargetError):
                assert_disposable_database_url(
                    "postgresql://tester:secret@127.0.0.1:5432/calculatietool_test_rf003"
                )

    def test_remote_host_is_always_rejected(self) -> None:
        with patch.dict(os.environ, {DISPOSABLE_DATABASE_OPT_IN: "1"}, clear=True):
            with self.assertRaises(UnsafePostgresTargetError):
                assert_disposable_database_url(
                    "postgresql://tester:secret@db.example.invalid:5432/calculatietool_test_rf003"
                )

    def test_production_environment_is_always_rejected(self) -> None:
        with patch.dict(
            os.environ,
            {DISPOSABLE_DATABASE_OPT_IN: "1", "CALCULATIETOOL_ENV": "production"},
            clear=True,
        ):
            with self.assertRaises(UnsafePostgresTargetError):
                assert_disposable_database_url(
                    "postgresql://tester:secret@localhost:5432/calculatietool_test_rf003"
                )

    def test_non_test_database_name_is_always_rejected(self) -> None:
        with patch.dict(os.environ, {DISPOSABLE_DATABASE_OPT_IN: "1"}, clear=True):
            with self.assertRaises(UnsafePostgresTargetError):
                assert_disposable_database_url(
                    "postgresql://tester:secret@localhost:5432/calculatietool"
                )

    def test_loopback_prefixed_database_is_accepted(self) -> None:
        with patch.dict(os.environ, {DISPOSABLE_DATABASE_OPT_IN: "1"}, clear=True):
            target = assert_disposable_database_url(
                "postgresql://tester:secret@127.0.0.1:5432/calculatietool_test_rf003_abc"
            )

        self.assertEqual(target.host, "127.0.0.1")
        self.assertEqual(target.database, "calculatietool_test_rf003_abc")

    def test_component_environment_builds_url_without_logging_credentials(self) -> None:
        env = {
            DISPOSABLE_DATABASE_OPT_IN: "1",
            "CALCULATIETOOL_POSTGRES_HOST": "127.0.0.1",
            "CALCULATIETOOL_POSTGRES_PORT": "5432",
            "CALCULATIETOOL_POSTGRES_DB": "calculatietool_test_ci",
            "CALCULATIETOOL_POSTGRES_USER": "test user",
            "CALCULATIETOOL_POSTGRES_PASSWORD": "p@ss/word",
        }
        with patch.dict(os.environ, env, clear=True):
            url = database_url_from_environment()
            target = assert_disposable_database_url(url)

        self.assertEqual(target.database, "calculatietool_test_ci")
        self.assertNotIn("test user", url)
        self.assertNotIn("p@ss/word", url)

    def test_maintenance_url_requires_postgres_on_loopback(self) -> None:
        env = {
            DISPOSABLE_DATABASE_OPT_IN: "1",
            "CALCULATIETOOL_POSTGRES_URL": (
                "postgresql://tester:secret@localhost:5432/calculatietool_test_ci?sslmode=disable"
            ),
        }
        with patch.dict(os.environ, env, clear=True):
            maintenance = maintenance_url_from_environment()
            target = assert_maintenance_database_url(maintenance)

        self.assertEqual(target.database, "postgres")
        self.assertIn("sslmode=disable", maintenance)

    def test_replacement_database_name_is_strict(self) -> None:
        source = "postgresql://tester:secret@localhost:5432/postgres"
        with self.assertRaises(UnsafePostgresTargetError):
            replace_database(source, "calculatietool_test_bad-name")


if __name__ == "__main__":
    unittest.main()
