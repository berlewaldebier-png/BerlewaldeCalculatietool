from __future__ import annotations

import json
import os
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Iterator

from app import config  # noqa: F401


_request_connection: ContextVar[Any | None] = ContextVar("calculatietool_request_connection", default=None)
_transaction_depth: ContextVar[int] = ContextVar("calculatietool_transaction_depth", default=0)
_schema_ready = False
_schema_lock = Lock()


def set_request_connection(conn: Any) -> Any:
    """Bind a psycopg connection to the current request context."""
    return _request_connection.set(conn)


def reset_request_connection(token: Any) -> None:
    _request_connection.reset(token)


def in_transaction() -> bool:
    return int(_transaction_depth.get() or 0) > 0


@contextmanager
def transaction() -> Iterator[Any]:
    """Open a transaction that spans multiple dataset reads/writes.

    - Uses the request-bound connection when available (FastAPI middleware).
    - Ensures save_dataset does not commit per call while inside the transaction.
    - Commits on success, rolls back on error (outermost transaction only).
    """
    ensure_schema()
    depth = int(_transaction_depth.get() or 0)
    token = _transaction_depth.set(depth + 1)
    try:
        with connect() as conn:
            try:
                yield conn
                if depth == 0:
                    conn.commit()
            except Exception:
                if depth == 0:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                raise
    finally:
        _transaction_depth.reset(token)


def storage_provider() -> str:
    # Phase B: runtime storage is Postgres-only. JSON storage is no longer supported as a runtime provider.
    return os.getenv("CALCULATIETOOL_BACKEND_STORAGE_PROVIDER", "postgres").strip().lower()


def uses_postgres() -> bool:
    return storage_provider() == "postgres"


def database_url() -> str:
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

    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


def _require_psycopg():
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError(
            "PostgreSQL-provider is geconfigureerd, maar psycopg is niet geinstalleerd."
        ) from exc
    return psycopg


@contextmanager
def connect() -> Iterator[Any]:
    existing = _request_connection.get()
    if existing is not None:
        # The request middleware owns lifecycle; do not close here.
        yield existing
        return

    psycopg = _require_psycopg()
    db_url = database_url()
    if not db_url:
        raise RuntimeError("PostgreSQL-provider is actief, maar databaseconfiguratie ontbreekt.")

    with psycopg.connect(db_url) as conn:
        yield conn


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS app_datasets (
                        dataset_name TEXT PRIMARY KEY,
                        payload JSONB NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            if not in_transaction():
                conn.commit()
        _schema_ready = True


def load_app_dataset_payload(dataset_name: str) -> Any | None:
    """Load raw payload from `app_datasets` without any dataset routing.

    Phase G introduces table-backed storages for some datasets. This helper is used
    by one-time migrations and audits that need to inspect legacy rows stored in
    `app_datasets` without calling `load_dataset()` (which may route elsewhere).
    """
    ensure_schema()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT payload FROM app_datasets WHERE dataset_name = %s",
                (dataset_name,),
            )
            row = cur.fetchone()
    if not row:
        return None
    payload = row[0]
    if isinstance(payload, str):
        payload = json.loads(payload)
    return payload


def delete_app_dataset_row(dataset_name: str) -> None:
    """Delete a legacy row from `app_datasets` (no-op if missing)."""
    ensure_schema()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM app_datasets WHERE dataset_name = %s", (dataset_name,))
        if not in_transaction():
            conn.commit()


def _get_table_storage(name: str):
    """Return a module that implements table-backed load/save for a dataset, or None."""
    if name == "verkoopprijzen":
        from app.domain import sales_pricing_storage

        return sales_pricing_storage
    if name == "kostprijsversies":
        from app.domain import cost_versions_storage

        return cost_versions_storage
    if name == "prijsvoorstellen":
        from app.domain import price_quotes_storage

        return price_quotes_storage
    if name == "new-year-drafts":
        from app.domain import new_year_drafts_storage

        return new_year_drafts_storage
    if name == "kostprijs-activatie-drafts":
        from app.domain import kostprijs_activatie_drafts_storage

        return kostprijs_activatie_drafts_storage
    return None


def load_dataset(name: str, default_value: Any) -> Any:
    # Phase G: some datasets are stored in dedicated tables instead of `app_datasets`.
    storage = _get_table_storage(name)
    if storage is not None:
        return storage.load_dataset(default_value)

    ensure_schema()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT payload FROM app_datasets WHERE dataset_name = %s",
                (name,),
            )
            row = cur.fetchone()
    if row is None:
        return default_value
    payload = row[0]
    if isinstance(payload, str):
        payload = json.loads(payload)
    return payload


def save_dataset(name: str, data: Any, overwrite: bool = True) -> bool:
    # Phase G: some datasets are stored in dedicated tables instead of `app_datasets`.
    storage = _get_table_storage(name)
    if storage is not None:
        return bool(storage.save_dataset(data, overwrite=overwrite))

    ensure_schema()
    now = datetime.now(UTC)
    with connect() as conn:
        with conn.cursor() as cur:
            if overwrite:
                cur.execute(
                    """
                    INSERT INTO app_datasets (dataset_name, payload, updated_at)
                    VALUES (%s, %s::jsonb, %s)
                    ON CONFLICT (dataset_name)
                    DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
                    """,
                    (name, json.dumps(data, ensure_ascii=False), now),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO app_datasets (dataset_name, payload, updated_at)
                    VALUES (%s, %s::jsonb, %s)
                    ON CONFLICT (dataset_name) DO NOTHING
                    """,
                    (name, json.dumps(data, ensure_ascii=False), now),
                )
        if not in_transaction():
            conn.commit()
    return True


def storage_status() -> dict[str, Any]:
    return {
        "provider": storage_provider(),
        "postgres_enabled": uses_postgres(),
        "postgres_configured": bool(database_url()),
    }
