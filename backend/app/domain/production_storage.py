from __future__ import annotations

from datetime import UTC, datetime
from threading import Lock
from typing import Any

from app.domain import postgres_storage


_schema_ready = False
_schema_lock = Lock()
_migrated_from_dataset = False


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        if not postgres_storage.database_url():
            return
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS production_years (
                        jaar INTEGER PRIMARY KEY,
                        hoeveelheid_inkoop_l DOUBLE PRECISION NOT NULL DEFAULT 0,
                        hoeveelheid_productie_l DOUBLE PRECISION NOT NULL DEFAULT 0,
                        batchgrootte_eigen_productie_l DOUBLE PRECISION NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _schema_ready = True


def list_years() -> list[int]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT jaar FROM production_years ORDER BY jaar")
            rows = cur.fetchall()
    years = [int(row[0]) for row in rows]
    if years:
        return years

    # One-time migration from legacy app_datasets payload (if present).
    global _migrated_from_dataset
    if _migrated_from_dataset:
        return years

    legacy = postgres_storage.load_dataset("productie", None)
    if isinstance(legacy, dict) and legacy:
        _migrated_from_dataset = True
        save_productie(legacy)
        return list_years()

    _migrated_from_dataset = True
    return years


def load_productie() -> dict[str, dict[str, Any]]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT jaar, hoeveelheid_inkoop_l, hoeveelheid_productie_l, batchgrootte_eigen_productie_l
                FROM production_years
                ORDER BY jaar
                """
            )
            rows = cur.fetchall()

    if not rows:
        # One-time migration from legacy app_datasets payload (if present).
        global _migrated_from_dataset
        if not _migrated_from_dataset:
            legacy = postgres_storage.load_dataset("productie", None)
            if isinstance(legacy, dict) and legacy:
                _migrated_from_dataset = True
                save_productie(legacy)
                return load_productie()
            _migrated_from_dataset = True

    result: dict[str, dict[str, Any]] = {}
    for jaar, inkoop, productie, batch in rows:
        result[str(int(jaar))] = {
            "hoeveelheid_inkoop_l": float(inkoop or 0),
            "hoeveelheid_productie_l": float(productie or 0),
            "batchgrootte_eigen_productie_l": float(batch or 0),
        }
    return result


def save_productie(payload: dict[str, Any]) -> bool:
    """
    Persist productie in a normalized table.

    Input shape stays backward compatible with the UI:
    {
      "2025": {"hoeveelheid_inkoop_l": 0, ...},
      "2026": {...}
    }
    """
    ensure_schema()
    now = datetime.now(UTC)

    # We treat this as overwrite, because this is dev-first and avoids drift.
    rows: list[tuple[int, float, float, float]] = []
    for year_key, raw in (payload or {}).items():
        try:
            jaar = int(year_key)
        except (TypeError, ValueError):
            continue
        if not isinstance(raw, dict):
            raw = {}
        rows.append(
            (
                jaar,
                float(raw.get("hoeveelheid_inkoop_l", 0) or 0),
                float(raw.get("hoeveelheid_productie_l", 0) or 0),
                float(raw.get("batchgrootte_eigen_productie_l", 0) or 0),
            )
        )

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            for jaar, inkoop, productie, batch in rows:
                cur.execute(
                    """
                    INSERT INTO production_years (
                        jaar, hoeveelheid_inkoop_l, hoeveelheid_productie_l, batchgrootte_eigen_productie_l, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (jaar) DO UPDATE SET
                        hoeveelheid_inkoop_l = EXCLUDED.hoeveelheid_inkoop_l,
                        hoeveelheid_productie_l = EXCLUDED.hoeveelheid_productie_l,
                        batchgrootte_eigen_productie_l = EXCLUDED.batchgrootte_eigen_productie_l,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (jaar, inkoop, productie, batch, now, now),
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return True


def reset_defaults() -> None:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            # `fixed_cost_lines` references `production_years(jaar)` via a FK.
            # Postgres TRUNCATE requires CASCADE (or truncating both tables in one statement),
            # otherwise dev resets will fail with "cannot truncate a table referenced in a foreign key constraint".
            cur.execute("TRUNCATE TABLE production_years CASCADE")
        if not postgres_storage.in_transaction():
            conn.commit()
