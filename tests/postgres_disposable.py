from __future__ import annotations

import hashlib
import json
import os
import sys
from dataclasses import dataclass
from types import TracebackType
from typing import Any
from uuid import uuid4

from scripts.disposable_postgres_guard import (
    DISPOSABLE_DATABASE_OPT_IN,
    DISPOSABLE_DATABASE_PREFIX,
    TEST_ADMIN_URL_ENV,
    UnsafePostgresTargetError,
    assert_disposable_database_url,
    database_url_from_environment,
    maintenance_url_from_environment,
    replace_database,
)


_VOLATILE_COLUMNS = {"created_at", "updated_at", "updated_at_ts"}


def integration_tests_enabled() -> bool:
    if os.getenv(DISPOSABLE_DATABASE_OPT_IN, "").strip() != "1":
        return False
    try:
        if os.getenv(TEST_ADMIN_URL_ENV, "").strip():
            maintenance_url_from_environment()
        else:
            assert_disposable_database_url(database_url_from_environment())
    except UnsafePostgresTargetError:
        return False
    return True


def reset_application_database_state() -> None:
    """Reset process-local schema caches between unique disposable databases."""

    for module_name, module in list(sys.modules.items()):
        if not module_name.startswith("app.domain."):
            continue
        for attribute in ("_SCHEMA_READY", "_schema_ready"):
            if hasattr(module, attribute):
                setattr(module, attribute, False)

    postgres_storage = sys.modules.get("app.domain.postgres_storage")
    if postgres_storage is not None:
        legacy_purged = getattr(postgres_storage, "_legacy_purged", None)
        if isinstance(legacy_purged, set):
            legacy_purged.clear()
        getattr(postgres_storage, "_request_connection").set(None)
        getattr(postgres_storage, "_transaction_depth").set(0)

    dashboard_service = sys.modules.get("app.domain.dashboard_service")
    if dashboard_service is not None:
        getattr(dashboard_service, "invalidate_dashboard_summary_cache")()


@dataclass
class DisposablePostgresDatabase:
    database_name: str = ""
    database_url: str = ""
    _maintenance_url: str = ""
    _old_environment: dict[str, str | None] | None = None
    _created: bool = False

    def __enter__(self) -> "DisposablePostgresDatabase":
        from app.domain import db_pool

        if db_pool.is_pool_initialized():
            raise UnsafePostgresTargetError(
                "Disposable database tests refuse to reuse an initialized application pool."
            )

        self._maintenance_url = maintenance_url_from_environment()
        self.database_name = (
            f"{DISPOSABLE_DATABASE_PREFIX}rf003_{os.getpid()}_{uuid4().hex[:12]}"
        )
        self.database_url = replace_database(self._maintenance_url, self.database_name)
        assert_disposable_database_url(self.database_url)

        import psycopg
        from psycopg import sql

        try:
            with psycopg.connect(self._maintenance_url, autocommit=True) as conn:
                conn.execute(
                    sql.SQL("CREATE DATABASE {} TEMPLATE template0 ENCODING 'UTF8'").format(
                        sql.Identifier(self.database_name)
                    )
                )
            self._created = True

            keys = (
                "CALCULATIETOOL_POSTGRES_URL",
                "CALCULATIETOOL_BACKEND_STORAGE_PROVIDER",
            )
            self._old_environment = {key: os.environ.get(key) for key in keys}
            os.environ["CALCULATIETOOL_POSTGRES_URL"] = self.database_url
            os.environ["CALCULATIETOOL_BACKEND_STORAGE_PROVIDER"] = "postgres"
            reset_application_database_state()

            with self.connect() as conn:
                current_database = str(conn.execute("SELECT current_database()").fetchone()[0])
            if current_database != self.database_name:
                raise UnsafePostgresTargetError(
                    "Disposable database verification returned an unexpected database name."
                )
            return self
        except Exception:
            self._restore_environment()
            self._drop_database()
            raise

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        try:
            reset_application_database_state()
        finally:
            self._restore_environment()
            self._drop_database()

    def connect(self):
        assert_disposable_database_url(self.database_url)
        import psycopg

        return psycopg.connect(self.database_url)

    def _restore_environment(self) -> None:
        if self._old_environment is None:
            return
        for key, value in self._old_environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._old_environment = None

    def _drop_database(self) -> None:
        if not self._created:
            return
        assert_disposable_database_url(self.database_url)
        import psycopg
        from psycopg import sql

        with psycopg.connect(self._maintenance_url, autocommit=True) as conn:
            conn.execute(
                """
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = %s AND pid <> pg_backend_pid()
                """,
                (self.database_name,),
            )
            conn.execute(
                sql.SQL("DROP DATABASE {}").format(sql.Identifier(self.database_name))
            )
        self._created = False


def schema_snapshot(conn: Any) -> str:
    rows: list[tuple[Any, ...]] = []
    rows.extend(
        conn.execute(
            """
            SELECT 'column', table_name, column_name, ordinal_position::text,
                   data_type, is_nullable, COALESCE(column_default, '')
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
            """
        ).fetchall()
    )
    rows.extend(
        conn.execute(
            """
            SELECT 'constraint', conrelid::regclass::text, conname, contype::text,
                   pg_get_constraintdef(oid), '', ''
            FROM pg_constraint
            WHERE connamespace = 'public'::regnamespace
            ORDER BY conrelid::regclass::text, conname
            """
        ).fetchall()
    )
    rows.extend(
        conn.execute(
            """
            SELECT 'index', tablename, indexname, indexdef, '', '', ''
            FROM pg_indexes
            WHERE schemaname = 'public'
            ORDER BY tablename, indexname
            """
        ).fetchall()
    )
    encoded = json.dumps(rows, default=str, ensure_ascii=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def data_snapshot(conn: Any, *, ignore_volatile_columns: bool = False) -> dict[str, tuple[int, str]]:
    from psycopg import sql

    tables = [
        str(row[0])
        for row in conn.execute(
            """
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
            """
        ).fetchall()
    ]
    snapshot: dict[str, tuple[int, str]] = {}
    for table in tables:
        if ignore_volatile_columns:
            columns = {
                str(row[0])
                for row in conn.execute(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = %s
                    """,
                    (table,),
                ).fetchall()
            }
            ignored = sorted(columns.intersection(_VOLATILE_COLUMNS))
        else:
            ignored = []

        if ignored:
            row_json = sql.SQL("to_jsonb(t) - {}::text[]").format(sql.Literal(ignored))
        else:
            row_json = sql.SQL("to_jsonb(t)")
        query = sql.SQL(
            "SELECT COUNT(*)::int, md5(COALESCE(string_agg(({row_json})::text, '|' "
            "ORDER BY ({row_json})::text), '')) FROM {table} AS t"
        ).format(row_json=row_json, table=sql.Identifier(table))
        count, digest = conn.execute(query).fetchone()
        snapshot[table] = (int(count or 0), str(digest or ""))
    return snapshot
