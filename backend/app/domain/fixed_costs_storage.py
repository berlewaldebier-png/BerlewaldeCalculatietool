from __future__ import annotations

from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import uuid4

from app.domain import postgres_storage
from app.domain import production_storage


_schema_ready = False
_schema_lock = Lock()


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        if not postgres_storage.database_url():
            return
        # Ensure master table exists for FK integrity.
        production_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS fixed_cost_lines (
                        id TEXT PRIMARY KEY,
                        jaar INTEGER NOT NULL REFERENCES production_years(jaar) ON DELETE CASCADE,
                        omschrijving TEXT NOT NULL,
                        kostensoort_code TEXT NOT NULL,
                        bedrag_per_jaar NUMERIC NOT NULL DEFAULT 0,
                        herverdeel_pct NUMERIC NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT fixed_cost_lines_kostensoort_ck
                          CHECK (kostensoort_code IN ('direct', 'indirect'))
                    )
                    """
                )
                # Idempotent migrations for evolving dev databases.
                # Legacy column could exist as DOUBLE PRECISION; make it NUMERIC.
                cur.execute("ALTER TABLE fixed_cost_lines ADD COLUMN IF NOT EXISTS herverdeel_pct NUMERIC NOT NULL DEFAULT 0")
                cur.execute(
                    "ALTER TABLE fixed_cost_lines ALTER COLUMN bedrag_per_jaar TYPE NUMERIC USING bedrag_per_jaar::numeric"
                )
                cur.execute(
                    "ALTER TABLE fixed_cost_lines ALTER COLUMN herverdeel_pct TYPE NUMERIC USING herverdeel_pct::numeric"
                )
                cur.execute("CREATE INDEX IF NOT EXISTS fixed_cost_lines_year_idx ON fixed_cost_lines(jaar)")
            if not postgres_storage.in_transaction():
                conn.commit()
        _schema_ready = True


def _normalize_cost_type(value: Any) -> str:
    text = str(value or "").strip().lower()
    if "indirect" in text:
        return "indirect"
    if "direct" in text:
        return "direct"
    return ""


def _display_cost_type(code: str) -> str:
    return "Indirecte kosten" if code == "indirect" else "Directe kosten"


def load_grouped_by_year() -> dict[str, list[dict[str, Any]]]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, jaar, omschrijving, kostensoort_code, bedrag_per_jaar, herverdeel_pct
                FROM fixed_cost_lines
                ORDER BY jaar, omschrijving, id
                """
            )
            rows = cur.fetchall()

    result: dict[str, list[dict[str, Any]]] = {}
    for line_id, jaar, omschrijving, kostensoort_code, bedrag, herverdeel_pct in rows:
        key = str(int(jaar))
        result.setdefault(key, []).append(
            {
                "id": str(line_id),
                "omschrijving": str(omschrijving or ""),
                "kostensoort": _display_cost_type(str(kostensoort_code or "")),
                "bedrag_per_jaar": float(bedrag or 0),
                "herverdeel_pct": float(herverdeel_pct or 0),
            }
        )
    return result


def save_grouped_by_year(payload: dict[str, Any]) -> bool:
    """
    Persist vaste kosten in a normalized table.

    Expected shape:
    { "2025": [ {id, omschrijving, kostensoort, bedrag_per_jaar, herverdeel_pct?}, ... ], ... }
    """
    ensure_schema()
    now = datetime.now(UTC)

    # Flatten rows, validate cost type up-front (avoid silent bad data).
    existing_years = set(production_storage.list_years())
    flattened: list[tuple[str, int, str, str, float, float]] = []
    years_in_payload: set[int] = set()
    ids_by_year: dict[int, set[str]] = {}
    for year_key, raw_rows in (payload or {}).items():
        try:
            jaar = int(year_key)
        except (TypeError, ValueError):
            continue
        if jaar not in existing_years:
            raise ValueError(f"Jaar {jaar} bestaat niet in productie. Voeg eerst een productiejaar toe.")
        years_in_payload.add(jaar)
        ids_by_year.setdefault(jaar, set())
        if not isinstance(raw_rows, list):
            continue
        for raw in raw_rows:
            if not isinstance(raw, dict):
                continue
            line_id = str(raw.get("id", "") or "").strip() or str(uuid4())
            ids_by_year[jaar].add(line_id)
            omschrijving = str(raw.get("omschrijving", "") or "").strip()
            kostensoort_code = _normalize_cost_type(raw.get("kostensoort", ""))
            if not omschrijving or not kostensoort_code:
                raise ValueError("Elke vaste kostenregel moet een omschrijving en kostensoort hebben.")
            bedrag = float(raw.get("bedrag_per_jaar", 0) or 0)
            pct = float(raw.get("herverdeel_pct", 0) or 0)
            if pct < 0:
                pct = 0
            if pct > 100:
                pct = 100
            flattened.append((line_id, jaar, omschrijving, kostensoort_code, bedrag, pct))

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            # Replace-by-scope: only mutate years present in the payload.
            # This avoids wiping other years when the UI saves a single year.
            for jaar in sorted(years_in_payload):
                ids = sorted(ids_by_year.get(jaar, set()))
                if not ids:
                    cur.execute("DELETE FROM fixed_cost_lines WHERE jaar = %s", (jaar,))
                    continue
                placeholders = ", ".join(["%s"] * len(ids))
                cur.execute(
                    f"DELETE FROM fixed_cost_lines WHERE jaar = %s AND id NOT IN ({placeholders})",
                    (jaar, *ids),
                )
            for line_id, jaar, omschrijving, kostensoort_code, bedrag, pct in flattened:
                cur.execute(
                    """
                    INSERT INTO fixed_cost_lines (
                        id, jaar, omschrijving, kostensoort_code, bedrag_per_jaar, herverdeel_pct, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        jaar = EXCLUDED.jaar,
                        omschrijving = EXCLUDED.omschrijving,
                        kostensoort_code = EXCLUDED.kostensoort_code,
                        bedrag_per_jaar = EXCLUDED.bedrag_per_jaar,
                        herverdeel_pct = EXCLUDED.herverdeel_pct,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (line_id, jaar, omschrijving, kostensoort_code, bedrag, pct, now, now),
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return True


def reset_defaults() -> None:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE fixed_cost_lines")
        if not postgres_storage.in_transaction():
            conn.commit()
