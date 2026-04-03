from __future__ import annotations

import json
import os
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any, Iterator

from app import config  # noqa: F401


def storage_provider() -> str:
    # Legacy JSON storage is deprecated; default to Postgres.
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
    psycopg = _require_psycopg()
    db_url = database_url()
    if not db_url:
        raise RuntimeError("PostgreSQL-provider is actief, maar databaseconfiguratie ontbreekt.")

    with psycopg.connect(db_url) as conn:
        yield conn


def ensure_schema() -> None:
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
        conn.commit()


def load_dataset(name: str, default_value: Any) -> Any:
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
        conn.commit()
    return True


def delete_dataset(name: str) -> bool:
    ensure_schema()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM app_datasets WHERE dataset_name = %s",
                (name,),
            )
        conn.commit()
    return True


def storage_status() -> dict[str, Any]:
    return {
        "provider": storage_provider(),
        "postgres_enabled": uses_postgres(),
        "postgres_configured": bool(database_url()),
    }
