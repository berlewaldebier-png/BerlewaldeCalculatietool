from __future__ import annotations

import unittest
from pathlib import Path
import sys
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from backend.app.domain import auth_service


class AuthServiceTests(unittest.TestCase):
    def test_verify_password_accepts_matching_hash(self) -> None:
        encoded = auth_service._hash_password("correct horse battery staple")

        self.assertTrue(auth_service.verify_password("correct horse battery staple", encoded))
        self.assertFalse(auth_service.verify_password("wrong password", encoded))

    def test_password_reset_token_round_trip(self) -> None:
        token = auth_service.issue_password_reset_token(email="User@Example.COM")

        self.assertEqual(auth_service.verify_password_reset_token(token), "user@example.com")

    def test_password_reset_token_invalid_returns_none(self) -> None:
        self.assertIsNone(auth_service.verify_password_reset_token("invalid-token"))

    def test_auth_secret_uses_legacy_env_variable_fallback(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "CALCULATIETOOL_ENV": "production",
                "AUTH_SECRET": "legacy-secret",
            },
            clear=False,
        ):
            self.assertEqual(auth_service._auth_secret(), "legacy-secret")

    def test_require_bootstrap_token_uses_constant_time_compare(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "CALCULATIETOOL_ENV": "production",
                "CALCULATIETOOL_BOOTSTRAP_TOKEN": "expected-token",
            },
            clear=False,
        ):
            auth_service.require_bootstrap_token("expected-token")
            with self.assertRaises(RuntimeError):
                auth_service.require_bootstrap_token("wrong-token")


if __name__ == "__main__":
    unittest.main()
