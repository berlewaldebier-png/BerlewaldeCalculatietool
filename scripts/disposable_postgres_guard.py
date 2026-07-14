from __future__ import annotations

import os
import re
from dataclasses import dataclass
from urllib.parse import quote, unquote, urlsplit, urlunsplit


DISPOSABLE_DATABASE_PREFIX = "calculatietool_test_"
DISPOSABLE_DATABASE_OPT_IN = "CALCULATIETOOL_ALLOW_DISPOSABLE_DB_TESTS"
TEST_ADMIN_URL_ENV = "CALCULATIETOOL_TEST_ADMIN_URL"
_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}
_DISPOSABLE_ENVIRONMENTS = {"", "ci", "dev", "development", "local", "test"}
_DATABASE_NAME_RE = re.compile(r"^[a-z0-9_]+$")


class UnsafePostgresTargetError(RuntimeError):
    """Raised before a test could connect to a non-disposable PostgreSQL target."""


@dataclass(frozen=True)
class PostgresTarget:
    host: str
    database: str


def _require_opt_in() -> None:
    if os.getenv(DISPOSABLE_DATABASE_OPT_IN, "").strip() != "1":
        raise UnsafePostgresTargetError(
            f"Disposable PostgreSQL tests require {DISPOSABLE_DATABASE_OPT_IN}=1."
        )
    environment = os.getenv("CALCULATIETOOL_ENV", "").strip().lower()
    if environment not in _DISPOSABLE_ENVIRONMENTS:
        raise UnsafePostgresTargetError(
            "Disposable PostgreSQL tests refuse staging/production-like environments."
        )


def _parse_target(database_url: str) -> tuple[PostgresTarget, object]:
    value = str(database_url or "").strip()
    if not value:
        raise UnsafePostgresTargetError("PostgreSQL URL is missing.")

    parsed = urlsplit(value)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise UnsafePostgresTargetError("Only postgres/postgresql URLs are accepted.")

    host = str(parsed.hostname or "").strip().lower()
    database = unquote(parsed.path.lstrip("/")).strip().lower()
    if not host or not database or "/" in database:
        raise UnsafePostgresTargetError("PostgreSQL URL must name one host and database.")
    return PostgresTarget(host=host, database=database), parsed


def assert_disposable_database_url(database_url: str) -> PostgresTarget:
    """Fail closed unless the URL is an explicitly opted-in, loopback test database."""

    _require_opt_in()
    target, _ = _parse_target(database_url)
    if target.host not in _LOOPBACK_HOSTS:
        raise UnsafePostgresTargetError(
            "Disposable PostgreSQL tests only accept localhost/loopback hosts."
        )
    if not target.database.startswith(DISPOSABLE_DATABASE_PREFIX):
        raise UnsafePostgresTargetError(
            f"Database name must start with {DISPOSABLE_DATABASE_PREFIX!r}."
        )
    if not _DATABASE_NAME_RE.fullmatch(target.database):
        raise UnsafePostgresTargetError("Disposable database name contains unsafe characters.")
    return target


def assert_maintenance_database_url(database_url: str) -> PostgresTarget:
    """Validate the loopback maintenance connection used only to create/drop test DBs."""

    _require_opt_in()
    target, _ = _parse_target(database_url)
    if target.host not in _LOOPBACK_HOSTS:
        raise UnsafePostgresTargetError(
            "PostgreSQL maintenance access only accepts localhost/loopback hosts."
        )
    if target.database != "postgres":
        raise UnsafePostgresTargetError("Maintenance URL must target the postgres database.")
    return target


def database_url_from_environment() -> str:
    env_url = os.getenv("CALCULATIETOOL_POSTGRES_URL", "").strip()
    if env_url:
        return env_url

    host = os.getenv("CALCULATIETOOL_POSTGRES_HOST", "").strip()
    port = os.getenv("CALCULATIETOOL_POSTGRES_PORT", "5432").strip()
    database = os.getenv("CALCULATIETOOL_POSTGRES_DB", "").strip()
    user = os.getenv("CALCULATIETOOL_POSTGRES_USER", "").strip()
    password = os.getenv("CALCULATIETOOL_POSTGRES_PASSWORD", "").strip()
    if not all([host, port, database, user, password]):
        return ""
    return (
        f"postgresql://{quote(user, safe='')}:{quote(password, safe='')}"
        f"@{host}:{port}/{quote(database, safe='')}"
    )


def replace_database(database_url: str, database_name: str) -> str:
    name = str(database_name or "").strip().lower()
    if not _DATABASE_NAME_RE.fullmatch(name):
        raise UnsafePostgresTargetError("Replacement database name contains unsafe characters.")
    _, parsed = _parse_target(database_url)
    return urlunsplit((parsed.scheme, parsed.netloc, f"/{quote(name, safe='')}", parsed.query, parsed.fragment))


def maintenance_url_from_environment() -> str:
    explicit = os.getenv(TEST_ADMIN_URL_ENV, "").strip()
    if explicit:
        assert_maintenance_database_url(explicit)
        return explicit

    configured = database_url_from_environment()
    assert_disposable_database_url(configured)
    maintenance = replace_database(configured, "postgres")
    assert_maintenance_database_url(maintenance)
    return maintenance
