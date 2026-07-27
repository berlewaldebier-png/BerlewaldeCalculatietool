from __future__ import annotations

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

from app.main import postgres_request_connection, startup_event


class _FakeConnection:
    def __init__(self) -> None:
        self.rolled_back = False

    def rollback(self) -> None:
        self.rolled_back = True


class _FakeConnectionManager:
    def __init__(self) -> None:
        self.conn = _FakeConnection()
        self.entered = False
        self.exited = False

    def __enter__(self) -> _FakeConnection:
        self.entered = True
        return self.conn

    def __exit__(self, *_: object) -> None:
        self.exited = True


class _FakeRequest:
    method = "POST"


class MainMiddlewareTests(unittest.IsolatedAsyncioTestCase):
    async def test_postgres_request_connection_releases_connection(self) -> None:
        manager = _FakeConnectionManager()
        token = object()

        async def call_next(_: object) -> str:
            return "ok"

        with patch("app.main.postgres_storage.uses_postgres", return_value=True), patch(
            "app.main.postgres_storage.database_url", return_value="postgres://test"
        ), patch("app.main.db_pool.get_connection", return_value=manager), patch(
            "app.main.postgres_storage.set_request_connection", return_value=token
        ) as set_connection, patch("app.main.postgres_storage.reset_request_connection") as reset_connection:
            response = await postgres_request_connection(_FakeRequest(), call_next)

        self.assertEqual(response, "ok")
        self.assertTrue(manager.entered)
        self.assertTrue(manager.conn.rolled_back)
        self.assertTrue(manager.exited)
        set_connection.assert_called_once_with(manager.conn)
        reset_connection.assert_called_once_with(token)

    def test_startup_event_ensures_postgres_schema(self) -> None:
        with patch("app.main.validate_config"), patch("app.main.log_startup_info"), patch(
            "app.main.postgres_storage.uses_postgres",
            return_value=True,
        ), patch("app.main.postgres_storage.database_url", return_value="postgres://test"), patch(
            "app.main.db_pool.initialize_pool"
        ) as init_pool, patch("app.main.postgres_storage.ensure_schema") as ensure_schema:
            with patch(
                "app.main.commercial_yearset_storage.ensure_schema"
            ) as ensure_commercial_schema, patch(
                "app.main.cost_authority_storage.ensure_schema"
            ) as ensure_cost_authority_schema:
                    startup_event()

        init_pool.assert_called_once_with("postgres://test", min_size=5, max_size=20)
        ensure_schema.assert_called_once()
        ensure_commercial_schema.assert_called_once()
        ensure_cost_authority_schema.assert_called_once()


if __name__ == "__main__":
    unittest.main()
