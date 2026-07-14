from __future__ import annotations

import json
import unittest
from collections import defaultdict
from pathlib import Path
import sys
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.domain import auth_service, postgres_storage


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "auth_identity_conflicts.json"


class _Cursor:
    def __init__(self, row: tuple[object, ...] | None) -> None:
        self.row = row
        self.executions: list[tuple[str, tuple[object, ...]]] = []

    def __enter__(self) -> "_Cursor":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, query: str, params: tuple[object, ...] = ()) -> None:
        self.executions.append((" ".join(query.split()), tuple(params)))

    def fetchone(self) -> tuple[object, ...] | None:
        return self.row


class _Connection:
    def __init__(self, cursor: _Cursor) -> None:
        self._cursor = cursor
        self.commits = 0

    def __enter__(self) -> "_Connection":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def cursor(self) -> _Cursor:
        return self._cursor

    def commit(self) -> None:
        self.commits += 1


def audit_normalized_identity_conflicts(rows: list[dict[str, object]]) -> dict[str, dict[str, list[str]]]:
    grouped: dict[str, dict[str, list[str]]] = {
        "username": defaultdict(list),
        "email": defaultdict(list),
    }
    for row in rows:
        record_id = str(row.get("id", "") or "")
        username = str(row.get("username", "") or "").strip().casefold()
        email = str(row.get("email", "") or "").strip().casefold()
        if username:
            grouped["username"][username].append(record_id)
        if email:
            grouped["email"][email].append(record_id)

    return {
        kind: {value: ids for value, ids in values.items() if len(ids) > 1}
        for kind, values in grouped.items()
    }


class AuthIdentityAuditTests(unittest.TestCase):
    def test_fixture_detects_case_variant_username_and_email_conflicts(self) -> None:
        rows = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

        conflicts = audit_normalized_identity_conflicts(rows)

        self.assertEqual(
            conflicts,
            {
                "username": {
                    "alice": ["fixture-user-1", "fixture-user-2"],
                    "bob": ["fixture-user-3", "fixture-user-4"],
                },
                "email": {
                    "finance@example.invalid": ["fixture-user-1", "fixture-user-2"],
                },
            },
        )

    def test_audit_does_not_treat_missing_email_as_a_duplicate_identity(self) -> None:
        rows = [
            {"id": "one", "username": "one", "email": None},
            {"id": "two", "username": "two", "email": ""},
        ]

        self.assertEqual(audit_normalized_identity_conflicts(rows)["email"], {})

    def test_authentication_lookup_is_case_insensitive_and_returns_stored_username_case(self) -> None:
        encoded = auth_service._hash_password("characterization-password")
        cursor = _Cursor(("Alice", "Alice Example", "user", encoded, True))
        connection = _Connection(cursor)

        with patch.object(auth_service, "ensure_schema"), patch.object(
            postgres_storage, "database_url", return_value="postgresql://fixture"
        ), patch.object(postgres_storage, "connect", return_value=connection):
            result = auth_service.authenticate_user("aLiCe", "characterization-password")

        self.assertEqual(result["username"], "Alice")
        query, params = cursor.executions[0]
        self.assertIn("WHERE LOWER(username) = LOWER(%s)", query)
        self.assertEqual(params, ("aLiCe",))

    def test_inactive_user_cannot_authenticate(self) -> None:
        encoded = auth_service._hash_password("characterization-password")
        cursor = _Cursor(("Alice", "Alice Example", "user", encoded, False))
        connection = _Connection(cursor)

        with patch.object(auth_service, "ensure_schema"), patch.object(
            postgres_storage, "database_url", return_value="postgresql://fixture"
        ), patch.object(postgres_storage, "connect", return_value=connection):
            self.assertIsNone(auth_service.authenticate_user("alice", "characterization-password"))

    def test_user_creation_duplicate_check_is_exact_case_while_login_lookup_is_not(self) -> None:
        cursor = _Cursor(None)
        connection = _Connection(cursor)
        with patch.dict("os.environ", {"CALCULATIETOOL_ENV": "local"}, clear=True), patch.object(
            auth_service, "ensure_schema"
        ), patch.object(postgres_storage, "database_url", return_value="postgresql://fixture"), patch.object(
            postgres_storage, "connect", return_value=connection
        ):
            created = auth_service.create_user(
                username="ALICE",
                password="local-password",
                display_name="Alice Duplicate Fixture",
                email="ALICE@example.invalid",
            )

        duplicate_query, duplicate_params = cursor.executions[0]
        self.assertIn("WHERE username = %s", duplicate_query)
        self.assertNotIn("LOWER(username)", duplicate_query)
        self.assertEqual(duplicate_params, ("ALICE",))
        self.assertEqual(created["username"], "ALICE")
        self.assertEqual(connection.commits, 1)

    def test_email_lookup_is_case_insensitive_without_an_ordering_or_uniqueness_guard(self) -> None:
        cursor = _Cursor(
            (
                "fixture-user-1",
                "Alice",
                "Alice Example",
                "user",
                "unused-hash",
                True,
                "Finance@Example.Invalid",
            )
        )
        connection = _Connection(cursor)

        with patch.object(postgres_storage, "connect", return_value=connection):
            result = auth_service._get_user_by_email("FINANCE@example.invalid")

        query, params = cursor.executions[0]
        self.assertIn("WHERE LOWER(email) = LOWER(%s)", query)
        self.assertNotIn("ORDER BY", query.upper())
        self.assertNotIn("LIMIT", query.upper())
        self.assertEqual(params, ("finance@example.invalid",))
        self.assertEqual(result["id"], "fixture-user-1")


if __name__ == "__main__":
    unittest.main()
