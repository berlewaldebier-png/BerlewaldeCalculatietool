from __future__ import annotations

import asyncio
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.routing import APIRoute

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.api.routes.integrations import _fetch_paged_resource, _parse_json_payload, router as integrations_router
from app.api.routes.meta import _raise_internal_error
from app.domain.auth_dependencies import require_admin
from app.domain import douano_client


def _find_route(path: str, method: str) -> APIRoute:
    for route in integrations_router.routes:
        if isinstance(route, APIRoute) and route.path == path and method.upper() in route.methods:
            return route
    raise AssertionError(f"Route not found: {method} {path}")


def _route_dependency_calls(route: APIRoute) -> set[object]:
    return {dependency.call for dependency in route.dependant.dependencies}


class _FakeAsyncResponse:
    def __init__(self, status: int, raw: str) -> None:
        self.status_code = status
        self._raw = raw
        self.headers = {}
        self.url = "https://douano.example"

    @property
    def text(self) -> str:
        return self._raw


class _FakeAsyncClient:
    def __init__(self) -> None:
        self.calls = 0

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def request(self, *_: object, **__: object) -> _FakeAsyncResponse:
        self.calls += 1
        if self.calls == 1:
            return _FakeAsyncResponse(503, '{"error":"busy"}')
        return _FakeAsyncResponse(200, '{"ok":true}')


class ApiAuthorizationTests(unittest.TestCase):
    def test_integration_mutations_require_admin(self) -> None:
        protected_routes = [
            ("POST", "/integrations/douano/sync/companies"),
            ("POST", "/integrations/douano/sync/products"),
            ("POST", "/integrations/douano/sync/sales-orders"),
            ("POST", "/integrations/douano/sync/sales-invoices"),
            ("PUT", "/integrations/douano/unmapped-rules"),
            ("POST", "/integrations/douano/backfill-line-snapshots"),
            ("POST", "/integrations/douano/create-service-sku"),
            ("PUT", "/integrations/douano/product-mappings/{douano_product_id}"),
            ("DELETE", "/integrations/douano/product-mappings/{douano_product_id}"),
            ("PUT", "/integrations/douano/product-ignored/{douano_product_id}"),
            ("DELETE", "/integrations/douano/product-ignored/{douano_product_id}"),
        ]

        for method, path in protected_routes:
            with self.subTest(method=method, path=path):
                route = _find_route(path, method)
                self.assertIn(require_admin, _route_dependency_calls(route))

    def test_internal_error_helper_hides_exception_detail(self) -> None:
        with patch("app.api.routes.meta.logger.exception"), self.assertRaises(HTTPException) as raised:
            _raise_internal_error("expected test failure", RuntimeError("secret internal detail"))

        self.assertEqual(raised.exception.status_code, 500)
        self.assertEqual(raised.exception.detail, "Internal server error")

    def test_douano_json_parse_error_hides_parser_detail(self) -> None:
        with patch("app.api.routes.integrations.logger.exception"), self.assertRaises(HTTPException) as raised:
            _parse_json_payload("not-json-secret")

        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(raised.exception.detail, "Douano response is geen geldige JSON.")

    def test_douano_network_error_hides_exception_detail(self) -> None:
        with patch("app.api.routes.integrations._douano_api_base_url", return_value="https://douano.example"), patch(
            "app.api.routes.integrations._douano_request",
            return_value=(0, {}, "socket secret"),
        ), self.assertRaises(HTTPException) as raised:
            asyncio.run(_fetch_paged_resource(tokens={"access_token": "token"}, path="/api/items"))

        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(raised.exception.detail, "Douano request faalde.")

    def test_douano_client_parses_json_objects_only(self) -> None:
        self.assertEqual(douano_client.parse_json_payload('{"ok": true}'), {"ok": True})
        with self.assertRaises(ValueError):
            douano_client.parse_json_payload("[1, 2, 3]")

    def test_douano_client_retries_transient_status(self) -> None:
        opener = _FakeAsyncClient()
        with patch("app.domain.douano_client.httpx.AsyncClient", return_value=opener), patch(
            "app.domain.douano_client.asyncio.sleep"
        ):
            status, _, raw = asyncio.run(
                douano_client.request(tokens={"access_token": "token"}, method="GET", url="https://douano.example")
            )

        self.assertEqual(opener.calls, 2)
        self.assertEqual(status, 200)
        self.assertEqual(raw, '{"ok":true}')


if __name__ == "__main__":
    unittest.main()
