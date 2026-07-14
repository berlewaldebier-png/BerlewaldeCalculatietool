from __future__ import annotations

import inspect
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

from fastapi import HTTPException, Request, Response

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import config_validation
from app.api.routes import auth as auth_routes
from app.domain import auth_service, postgres_storage
from app.domain.auth_dependencies import get_current_session, require_admin, require_user
from app.schemas.auth import LoginRequest


AUTH_SECRET = "rf-002-characterization-secret-32-bytes"


def _request(cookies: dict[str, str] | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if cookies:
        raw_cookie = "; ".join(f"{key}={value}" for key, value in cookies.items())
        headers.append((b"cookie", raw_cookie.encode("latin-1")))
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
        }
    )


class AuthEnvironmentCharacterizationTests(unittest.TestCase):
    def test_disabled_auth_synthesizes_admin_in_every_environment(self) -> None:
        for environment in ("local", "dev", "development", "test", "staging", "production"):
            with self.subTest(environment=environment), patch.dict(
                "os.environ",
                {
                    "CALCULATIETOOL_ENV": environment,
                    "CALCULATIETOOL_AUTH_ENABLED": "false",
                },
                clear=True,
            ):
                self.assertFalse(auth_service.auth_enabled())
                self.assertEqual(
                    get_current_session(_request()),
                    {
                        "username": "local-admin",
                        "display_name": "Local admin",
                        "role": "admin",
                    },
                )

    def test_enabled_auth_flag_accepts_only_current_truthy_spellings(self) -> None:
        for value in ("1", "true", "TRUE", "yes", "on"):
            with self.subTest(value=value), patch.dict(
                "os.environ", {"CALCULATIETOOL_AUTH_ENABLED": value}, clear=True
            ):
                self.assertTrue(auth_service.auth_enabled())

        for value in ("", "0", "false", "no", "off", "enabled"):
            with self.subTest(value=value), patch.dict(
                "os.environ", {"CALCULATIETOOL_AUTH_ENABLED": value}, clear=True
            ):
                self.assertFalse(auth_service.auth_enabled())

    def test_missing_secret_uses_local_default_but_fails_in_non_local_environments(self) -> None:
        for environment in ("local", "dev", "development"):
            with self.subTest(environment=environment), patch.dict(
                "os.environ", {"CALCULATIETOOL_ENV": environment}, clear=True
            ):
                self.assertEqual(auth_service._auth_secret(), "local-dev-secret-change-me")

        for environment in ("test", "staging", "production"):
            with self.subTest(environment=environment), patch.dict(
                "os.environ", {"CALCULATIETOOL_ENV": environment}, clear=True
            ), self.assertRaises(RuntimeError):
                auth_service._auth_secret()

    def test_production_configuration_currently_allows_disabled_auth_without_a_secret(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "CALCULATIETOOL_ENV": "production",
                "CALCULATIETOOL_AUTH_ENABLED": "false",
                "CALCULATIETOOL_CORS_ORIGINS": "https://example.invalid",
            },
            clear=True,
        ), patch.object(postgres_storage, "uses_postgres", return_value=False):
            config_validation.validate_config()

    def test_enabled_production_auth_rejects_missing_or_default_secret(self) -> None:
        base_environment = {
            "CALCULATIETOOL_ENV": "production",
            "CALCULATIETOOL_AUTH_ENABLED": "true",
            "CALCULATIETOOL_CORS_ORIGINS": "https://example.invalid",
        }
        for secret in (None, "change-me-in-production"):
            values = dict(base_environment)
            if secret is not None:
                values["CALCULATIETOOL_AUTH_SECRET"] = secret
            with self.subTest(secret_kind="missing" if secret is None else "default"), patch.dict(
                "os.environ", values, clear=True
            ), patch.object(postgres_storage, "uses_postgres", return_value=False), self.assertRaises(RuntimeError):
                config_validation.validate_config()

    def test_startup_config_matrix_accepts_current_environments_but_rejects_test(self) -> None:
        for environment in ("local", "dev", "development", "staging", "production"):
            for enabled in ("false", "true"):
                with self.subTest(environment=environment, enabled=enabled), patch.dict(
                    "os.environ",
                    {
                        "CALCULATIETOOL_ENV": environment,
                        "CALCULATIETOOL_AUTH_ENABLED": enabled,
                        "CALCULATIETOOL_AUTH_SECRET": AUTH_SECRET,
                        "CALCULATIETOOL_CORS_ORIGINS": "https://example.invalid",
                    },
                    clear=True,
                ), patch.object(postgres_storage, "uses_postgres", return_value=False):
                    config_validation.validate_config()

        for enabled in ("false", "true"):
            with self.subTest(environment="test", enabled=enabled), patch.dict(
                "os.environ",
                {
                    "CALCULATIETOOL_ENV": "test",
                    "CALCULATIETOOL_AUTH_ENABLED": enabled,
                    "CALCULATIETOOL_AUTH_SECRET": AUTH_SECRET,
                    "CALCULATIETOOL_CORS_ORIGINS": "https://example.invalid",
                },
                clear=True,
            ), patch.object(postgres_storage, "uses_postgres", return_value=False), self.assertRaises(RuntimeError):
                config_validation.validate_config()

    def test_local_temp_admin_is_available_only_in_current_local_environment_set(self) -> None:
        for environment in ("local", "dev", "development"):
            with self.subTest(environment=environment), patch.dict(
                "os.environ", {"CALCULATIETOOL_ENV": environment}, clear=True
            ):
                self.assertEqual(auth_service.authenticate_local_temp_admin("ADMIN", "admin")["role"], "admin")

        for environment in ("test", "staging", "production"):
            with self.subTest(environment=environment), patch.dict(
                "os.environ", {"CALCULATIETOOL_ENV": environment}, clear=True
            ):
                self.assertIsNone(auth_service.authenticate_local_temp_admin("admin", "admin"))

    def test_disabled_auth_status_reports_synthetic_user_only_for_local_environments(self) -> None:
        for environment, expected_count, expected_admin in (
            ("local", 1, True),
            ("dev", 1, True),
            ("development", 1, True),
            ("test", 0, False),
            ("staging", 0, False),
            ("production", 0, False),
        ):
            with self.subTest(environment=environment), patch.dict(
                "os.environ",
                {
                    "CALCULATIETOOL_ENV": environment,
                    "CALCULATIETOOL_AUTH_ENABLED": "false",
                },
                clear=True,
            ), patch.object(postgres_storage, "database_url", return_value=""), patch.object(
                postgres_storage, "storage_provider", return_value="postgres"
            ):
                status = auth_service.auth_status()
                self.assertEqual(status["user_count"], expected_count)
                self.assertEqual(status["has_admin"], expected_admin)


class AuthSessionCharacterizationTests(unittest.TestCase):
    def _token_environment(self):
        return patch.dict(
            "os.environ",
            {
                "CALCULATIETOOL_ENV": "production",
                "CALCULATIETOOL_AUTH_ENABLED": "true",
                "CALCULATIETOOL_AUTH_SECRET": AUTH_SECRET,
            },
            clear=True,
        )

    def test_session_token_round_trip_preserves_embedded_identity_and_role(self) -> None:
        with self._token_environment():
            token = auth_service.issue_session_token(
                username="alice",
                display_name="Alice Example",
                role="admin",
            )

            self.assertEqual(
                auth_service.verify_session_token(token),
                {"username": "alice", "display_name": "Alice Example", "role": "admin"},
            )

    def test_expired_or_tampered_session_token_is_rejected(self) -> None:
        with self._token_environment():
            expired = auth_service.issue_session_token(
                username="alice",
                display_name="Alice Example",
                role="user",
                expires_in_seconds=-1,
            )
            valid = auth_service.issue_session_token(
                username="alice",
                display_name="Alice Example",
                role="user",
            )

            self.assertIsNone(auth_service.verify_session_token(expired))
            self.assertIsNone(auth_service.verify_session_token(f"{valid}tampered"))

    def test_existing_token_is_not_rechecked_against_user_active_state_or_current_role(self) -> None:
        with self._token_environment():
            token = auth_service.issue_session_token(
                username="alice",
                display_name="Alice Example",
                role="admin",
            )
            with patch.object(
                postgres_storage,
                "connect",
                side_effect=AssertionError("session verification must not query the user table"),
            ):
                session = auth_service.verify_session_token(token)

            self.assertEqual(session, {"username": "alice", "display_name": "Alice Example", "role": "admin"})

    def test_enabled_auth_returns_401_for_missing_session_and_403_for_non_admin(self) -> None:
        with self._token_environment(), self.assertRaises(HTTPException) as unauthenticated:
            get_current_session(_request())
        self.assertEqual(unauthenticated.exception.status_code, 401)
        self.assertEqual(unauthenticated.exception.detail, "Niet ingelogd.")

        with self._token_environment():
            user_token = auth_service.issue_session_token(
                username="bob",
                display_name="Bob Example",
                role="user",
            )
            request = _request({auth_service.SESSION_COOKIE_NAME: user_token})
            self.assertEqual(require_user(request)["role"], "user")
            with self.assertRaises(HTTPException) as forbidden:
                require_admin(request)

        self.assertEqual(forbidden.exception.status_code, 403)
        self.assertEqual(forbidden.exception.detail, "Geen rechten.")

    def test_admin_role_comparison_is_case_sensitive(self) -> None:
        with self._token_environment():
            token = auth_service.issue_session_token(
                username="alice",
                display_name="Alice Example",
                role="Admin",
            )
            with self.assertRaises(HTTPException) as forbidden:
                require_admin(_request({auth_service.SESSION_COOKIE_NAME: token}))

        self.assertEqual(forbidden.exception.status_code, 403)

    def test_login_cookie_contract_is_12_hours_http_only_lax_and_environment_secure(self) -> None:
        login = inspect.unwrap(auth_routes.post_login)
        authenticated = {
            "authenticated": True,
            "username": "alice",
            "display_name": "Alice Example",
            "role": "user",
        }

        for environment, secure_expected in (("local", False), ("production", True)):
            response = Response()
            with self.subTest(environment=environment), patch.dict(
                "os.environ",
                {
                    "CALCULATIETOOL_ENV": environment,
                    "CALCULATIETOOL_AUTH_SECRET": AUTH_SECRET,
                },
                clear=True,
            ), patch.object(auth_service, "authenticate_local_temp_admin", return_value=None), patch.object(
                auth_service, "authenticate_user", return_value=authenticated
            ), patch.object(auth_service, "issue_session_token", return_value="characterization-token"):
                result = login(
                    _request(),
                    LoginRequest(username="alice", password="not-used-in-characterization"),
                    response,
                )

            cookie = response.headers["set-cookie"]
            self.assertEqual(result.username, "alice")
            self.assertIn(f"{auth_service.SESSION_COOKIE_NAME}=characterization-token", cookie)
            self.assertIn("HttpOnly", cookie)
            self.assertIn("Max-Age=43200", cookie)
            self.assertIn("Path=/", cookie)
            self.assertIn("SameSite=lax", cookie)
            self.assertEqual("Secure" in cookie, secure_expected)


if __name__ == "__main__":
    unittest.main()
