from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.disposable_postgres_guard import (  # noqa: E402
    DISPOSABLE_DATABASE_OPT_IN,
    UnsafePostgresTargetError,
    assert_disposable_database_url,
)
from scripts.rf013p_backup_restore import (  # noqa: E402
    build_pg_dump_command,
    build_pg_restore_command,
    assert_private_backup_path,
)
from scripts.rf013p_data_baseline import (  # noqa: E402
    PRIVATE_OUTPUT_ROOT,
    assert_private_output_path,
    compare_manifests,
    capture_from_connection_info,
    fingerprint,
    fingerprint_rowset,
    normalize_years,
    validate_source_target,
)


class Rf013pDataBaselineTests(unittest.TestCase):
    def test_fingerprints_are_deterministic_and_domain_separated(self) -> None:
        value = {"rows": [2, 1], "nested": {"value": "same"}}
        self.assertEqual(fingerprint(value, "table-a"), fingerprint(value, "table-a"))
        self.assertNotEqual(fingerprint(value, "table-a"), fingerprint(value, "table-b"))
        self.assertRegex(fingerprint(value, "table-a"), r"^sha256:[0-9a-f]{64}$")

    def test_rowset_fingerprint_is_order_independent_and_preserves_duplicates(self) -> None:
        self.assertEqual(
            fingerprint_rowset(["z", "a", "a"], "table"),
            fingerprint_rowset(["a", "z", "a"], "table"),
        )
        self.assertNotEqual(
            fingerprint_rowset(["z", "a", "a"], "table"),
            fingerprint_rowset(["z", "a"], "table"),
        )

    def test_years_are_positive_unique_and_sorted(self) -> None:
        self.assertEqual(normalize_years([2026, 2025, 2026]), (2025, 2026))
        with self.assertRaises(ValueError):
            normalize_years([0, -1])

    def test_manifest_comparison_names_only_protected_sections(self) -> None:
        baseline = {
            "schema": {"fingerprint": "same"},
            "tables": {"fingerprint": "same"},
            "appDatasets": {"fingerprint": "same"},
            "perYear": {"2025": 1},
            "integrity": {"orphans": 0},
            "unprotectedMetadata": "before",
        }
        changed = {**baseline, "unprotectedMetadata": "after"}
        self.assertEqual(compare_manifests(changed, baseline), [])

        changed = {**baseline, "tables": {"fingerprint": "changed"}}
        self.assertEqual(compare_manifests(changed, baseline), ["tables"])

    def test_private_artifact_paths_cannot_escape_ignored_output_root(self) -> None:
        json_path = assert_private_output_path(PRIVATE_OUTPUT_ROOT / "baseline.json")
        dump_path = assert_private_backup_path(PRIVATE_OUTPUT_ROOT / "backup.dump")
        self.assertTrue(json_path.is_relative_to(PRIVATE_OUTPUT_ROOT))
        self.assertTrue(dump_path.is_relative_to(PRIVATE_OUTPUT_ROOT))

        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(ValueError):
                assert_private_output_path(Path(temp_dir) / "baseline.json")
            with self.assertRaises(ValueError):
                assert_private_backup_path(Path(temp_dir) / "backup.dump")

    def test_source_capture_rejects_production_and_unverified_hosts(self) -> None:
        with self.assertRaises(SystemExit):
            validate_source_target(
                "127.0.0.1",
                "production",
                allow_private_development_host=True,
            )
        with self.assertRaises(SystemExit):
            validate_source_target(
                "database.internal",
                "development",
                allow_private_development_host=True,
            )
        validate_source_target(
            "10.10.1.10",
            "development",
            allow_private_development_host=True,
        )

    def test_capture_enforces_read_only_transaction_before_querying(self) -> None:
        executed: list[str] = []

        class Cursor:
            def __init__(self, row: tuple[str, ...] | None = None):
                self.row = row

            def fetchone(self):
                return self.row

        class Context:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

        class Connection(Context):
            def transaction(self):
                return Context()

            def execute(self, query: str):
                executed.append(query)
                if query == "SHOW transaction_read_only":
                    return Cursor(("on",))
                return Cursor()

        fake_psycopg = SimpleNamespace(connect=lambda *_args, **_kwargs: Connection())
        with patch.dict(sys.modules, {"psycopg": fake_psycopg}), patch(
            "scripts.rf013p_data_baseline.capture",
            return_value={"schemaVersion": 1},
        ):
            result = capture_from_connection_info(
                "postgresql://tester:secret@localhost:5432/calculatietool",
                years=[2025, 2026],
            )

        self.assertEqual(result, {"schemaVersion": 1})
        self.assertEqual(
            executed[:2],
            ["SET TRANSACTION READ ONLY", "SHOW transaction_read_only"],
        )

    def test_pg_commands_do_not_embed_password_in_arguments(self) -> None:
        connection_url = (
            "postgresql://test-user:top-secret@127.0.0.1:5432/"
            "calculatietool_test_rf013p?sslmode=disable"
        )
        backup_file = PRIVATE_OUTPUT_ROOT / "backup.dump"

        dump_command, dump_environment = build_pg_dump_command(
            "pg_dump", connection_url, backup_file
        )
        restore_command, restore_environment = build_pg_restore_command(
            "pg_restore", connection_url, backup_file
        )

        self.assertNotIn("top-secret", " ".join(dump_command))
        self.assertNotIn("top-secret", " ".join(restore_command))
        self.assertEqual(dump_environment["PGPASSWORD"], "top-secret")
        self.assertEqual(restore_environment["PGPASSWORD"], "top-secret")
        self.assertEqual(dump_environment["PGSSLMODE"], "disable")
        self.assertIn("--format=custom", dump_command)
        self.assertIn("--single-transaction", restore_command)

    def test_restore_target_guard_contract_remains_explicit(self) -> None:
        restore_url = (
            "postgresql://tester:secret@localhost:5432/calculatietool_test_rf013p"
        )
        with patch.dict(
            os.environ,
            {
                DISPOSABLE_DATABASE_OPT_IN: "1",
                "CALCULATIETOOL_ENV": "development",
            },
            clear=True,
        ):
            command, _ = build_pg_restore_command(
                "pg_restore", restore_url, PRIVATE_OUTPUT_ROOT / "backup.dump"
            )
            target = assert_disposable_database_url(restore_url)
            with self.assertRaises(UnsafePostgresTargetError):
                assert_disposable_database_url(
                    "postgresql://tester:secret@db.example.invalid:5432/"
                    "calculatietool_test_rf013p"
                )
        self.assertEqual(target.database, "calculatietool_test_rf013p")
        self.assertIn("calculatietool_test_rf013p", command)


if __name__ == "__main__":
    unittest.main()
