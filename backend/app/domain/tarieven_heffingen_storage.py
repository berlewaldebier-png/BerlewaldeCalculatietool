from __future__ import annotations

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any

from app.domain import postgres_storage


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()


def ensure_schema() -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    with _SCHEMA_LOCK:
        if _SCHEMA_READY:
            return
        postgres_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS tarieven_heffingen_years (
                        jaar INTEGER PRIMARY KEY,
                        tarief_hoog NUMERIC NOT NULL DEFAULT 0,
                        tarief_laag NUMERIC NOT NULL DEFAULT 0,
                        verbruikersbelasting NUMERIC NOT NULL DEFAULT 0,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS ix_tarieven_heffingen_year ON tarieven_heffingen_years(jaar)")
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def load_dataset(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT jaar, tarief_hoog, tarief_laag, verbruikersbelasting
                FROM tarieven_heffingen_years
                ORDER BY jaar
                """
            )
            rows = cur.fetchall()
    if not rows:
        return default_value
    out: list[dict[str, Any]] = []
    for jaar, hoog, laag, vb in rows:
        out.append(
            {
                "jaar": int(jaar or 0),
                "tarief_hoog": float(hoog or 0),
                "tarief_laag": float(laag or 0),
                "verbruikersbelasting": float(vb or 0),
            }
        )
    return out


def save_dataset(data: Any, *, overwrite: bool = True) -> bool:
    ensure_schema()
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'tarieven-heffingen': verwacht list.")

    rows: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    now = datetime.now(UTC)

    # Deduplicate by year; last write wins.
    by_year: dict[int, dict[str, Any]] = {}
    for row in rows:
        try:
            jaar = int(row.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            jaar = 0
        if jaar <= 0:
            continue
        by_year[jaar] = row

    years = sorted(by_year.keys())
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if not overwrite:
                cur.execute("SELECT COUNT(*) FROM tarieven_heffingen_years")
                count_row = cur.fetchone()
                existing = int((count_row[0] if count_row else 0) or 0)
                if existing > 0:
                    return True

            if not years and overwrite:
                cur.execute("DELETE FROM tarieven_heffingen_years")
            else:
                if overwrite:
                    # Replace-by-scope: delete stale years not in payload.
                    placeholders = ", ".join(["%s"] * len(years))
                    cur.execute(
                        f"DELETE FROM tarieven_heffingen_years WHERE jaar NOT IN ({placeholders})",
                        tuple(years),
                    )

                params: list[tuple[Any, ...]] = []
                for jaar in years:
                    row = by_year[jaar]
                    try:
                        hoog = float(row.get("tarief_hoog", 0) or 0)
                    except (TypeError, ValueError):
                        hoog = 0.0
                    try:
                        laag = float(row.get("tarief_laag", 0) or 0)
                    except (TypeError, ValueError):
                        laag = 0.0
                    try:
                        vb = float(row.get("verbruikersbelasting", 0) or 0)
                    except (TypeError, ValueError):
                        vb = 0.0
                    params.append((int(jaar), hoog, laag, vb, now))

                cur.executemany(
                    """
                    INSERT INTO tarieven_heffingen_years
                        (jaar, tarief_hoog, tarief_laag, verbruikersbelasting, updated_at)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (jaar)
                    DO UPDATE SET
                        tarief_hoog = EXCLUDED.tarief_hoog,
                        tarief_laag = EXCLUDED.tarief_laag,
                        verbruikersbelasting = EXCLUDED.verbruikersbelasting,
                        updated_at = EXCLUDED.updated_at
                    """,
                    params,
                )
        if not postgres_storage.in_transaction():
            conn.commit()

    try:
        postgres_storage.delete_app_dataset_row("tarieven-heffingen")
    except Exception:
        pass
    return True

