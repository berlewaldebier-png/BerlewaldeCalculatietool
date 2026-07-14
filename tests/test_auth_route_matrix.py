from __future__ import annotations

import hashlib
import unittest
from pathlib import Path
import sys

from fastapi.routing import APIRoute

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.api.routes.auth import router as auth_router
from app.api.routes.data import router as data_router
from app.api.routes.integrations import router as integrations_router
from app.api.routes.meta import router as meta_router
from app.api.routes.quotes import router as quotes_router
from app.domain.auth_dependencies import require_admin, require_user


def _route(router, path: str, method: str) -> APIRoute:
    for candidate in router.routes:
        if isinstance(candidate, APIRoute) and candidate.path == path and method.upper() in candidate.methods:
            return candidate
    raise AssertionError(f"Route not found: {method} {path}")


def _dependency_calls(route: APIRoute) -> set[object]:
    calls: set[object] = set()

    def collect(dependency) -> None:
        if dependency.call is not None:
            calls.add(dependency.call)
        for child in dependency.dependencies:
            collect(child)

    for dependency in route.dependant.dependencies:
        collect(dependency)
    return calls


def _static_access(route: APIRoute) -> str:
    calls = _dependency_calls(route)
    if require_admin in calls:
        return "admin"
    if require_user in calls:
        return "user"
    return "public"


class AuthRouteMatrixTests(unittest.TestCase):
    def test_every_non_auth_api_route_is_at_least_user_protected(self) -> None:
        for router in (data_router, meta_router, quotes_router, integrations_router):
            for route in router.routes:
                if not isinstance(route, APIRoute):
                    continue
                with self.subTest(path=route.path, methods=sorted(route.methods or [])):
                    self.assertIn(require_user, _dependency_calls(route))

    def test_auth_route_access_matrix_matches_current_behavior(self) -> None:
        expected = {
            ("GET", "/auth/status"): "public",
            ("POST", "/auth/login"): "public",
            ("POST", "/auth/forgot-password"): "public",
            ("POST", "/auth/reset-password"): "public",
            ("POST", "/auth/change-password"): "manual-user-cookie",
            ("POST", "/auth/logout"): "public",
            ("GET", "/auth/me"): "manual-user-cookie",
            ("GET", "/auth/users"): "admin",
            ("POST", "/auth/bootstrap-admin"): "public-bootstrap-token",
            ("POST", "/auth/users"): "admin",
            ("PUT", "/auth/users/{username}"): "admin",
        }
        observed: dict[tuple[str, str], str] = {}
        manual_user_paths = {("POST", "/auth/change-password"), ("GET", "/auth/me")}
        bootstrap_paths = {("POST", "/auth/bootstrap-admin")}

        for route in auth_router.routes:
            if not isinstance(route, APIRoute):
                continue
            for method in sorted((route.methods or set()) - {"HEAD", "OPTIONS"}):
                key = (method, route.path)
                access = _static_access(route)
                if key in manual_user_paths:
                    access = "manual-user-cookie"
                elif key in bootstrap_paths:
                    access = "public-bootstrap-token"
                observed[key] = access

        self.assertEqual(observed, expected)

    def test_douano_connect_probe_debug_and_callback_are_user_not_admin(self) -> None:
        paths = (
            "/integrations/douano/connect",
            "/integrations/douano/probe",
            "/integrations/douano/debug",
            "/integrations/douano/callback",
            "/integrations/douano/status",
        )
        for path in paths:
            with self.subTest(path=path):
                route = _route(integrations_router, path, "GET")
                self.assertEqual(_static_access(route), "user")

    def test_quote_read_and_mutation_routes_are_user_not_admin(self) -> None:
        for route in quotes_router.routes:
            if not isinstance(route, APIRoute):
                continue
            with self.subTest(path=route.path, methods=sorted(route.methods or [])):
                self.assertEqual(_static_access(route), "user")

    def test_user_management_api_is_admin_even_though_page_route_has_no_frontend_role_gate(self) -> None:
        self.assertEqual(_static_access(_route(auth_router, "/auth/users", "GET")), "admin")
        self.assertEqual(_static_access(_route(auth_router, "/auth/users", "POST")), "admin")
        self.assertEqual(_static_access(_route(auth_router, "/auth/users/{username}", "PUT")), "admin")

    def test_complete_route_access_fingerprint_matches_rf_002_baseline(self) -> None:
        manual_access = {
            ("POST", "/auth/change-password"): "manual-user-cookie",
            ("GET", "/auth/me"): "manual-user-cookie",
            ("POST", "/auth/bootstrap-admin"): "public-bootstrap-token",
        }
        rows: list[str] = []
        for router in (auth_router, data_router, meta_router, quotes_router, integrations_router):
            for route in router.routes:
                if not isinstance(route, APIRoute):
                    continue
                for method in sorted((route.methods or set()) - {"HEAD", "OPTIONS"}):
                    access = manual_access.get((method, route.path), _static_access(route))
                    rows.append(f"{method} {route.path} {access}")

        normalized = "\n".join(sorted(rows))
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        self.assertEqual(len(rows), 158, normalized)
        self.assertEqual(digest, "b72db2ac9b7f8efacfb72f8dbac442058cd2a96a15663cc7b458f7f4c11135f6", normalized)


if __name__ == "__main__":
    unittest.main()
