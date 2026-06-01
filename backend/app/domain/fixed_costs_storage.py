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
                        cost_pool TEXT NOT NULL DEFAULT '',
                        domain_code TEXT NOT NULL DEFAULT 'sales',
                        allocation_driver TEXT NOT NULL DEFAULT '',
                        allocation_scope TEXT NOT NULL DEFAULT 'all',
                        include_in_inventory_cost BOOLEAN NOT NULL DEFAULT TRUE,
                        include_in_quote_handling BOOLEAN NOT NULL DEFAULT FALSE,
                        basis_code TEXT NOT NULL DEFAULT 'normal',
                        stand_code TEXT NOT NULL DEFAULT 'normal',
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
                cur.execute("ALTER TABLE fixed_cost_lines ADD COLUMN IF NOT EXISTS cost_pool TEXT NOT NULL DEFAULT ''")
                cur.execute("ALTER TABLE fixed_cost_lines ADD COLUMN IF NOT EXISTS domain_code TEXT NOT NULL DEFAULT 'sales'")
                cur.execute("ALTER TABLE fixed_cost_lines ADD COLUMN IF NOT EXISTS allocation_driver TEXT NOT NULL DEFAULT ''")
                cur.execute("ALTER TABLE fixed_cost_lines ADD COLUMN IF NOT EXISTS allocation_scope TEXT NOT NULL DEFAULT 'all'")
                cur.execute(
                    "ALTER TABLE fixed_cost_lines ADD COLUMN IF NOT EXISTS include_in_inventory_cost BOOLEAN NOT NULL DEFAULT TRUE"
                )
                cur.execute(
                    "ALTER TABLE fixed_cost_lines ADD COLUMN IF NOT EXISTS include_in_quote_handling BOOLEAN NOT NULL DEFAULT FALSE"
                )
                cur.execute("ALTER TABLE fixed_cost_lines ADD COLUMN IF NOT EXISTS basis_code TEXT NOT NULL DEFAULT 'normal'")
                cur.execute("ALTER TABLE fixed_cost_lines ADD COLUMN IF NOT EXISTS stand_code TEXT NOT NULL DEFAULT 'normal'")
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


def _normalize_scope(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return "all"
    if text in {"all", "purchased", "own_production", "contract_brew"}:
        return text
    return "all"


def _normalize_driver(value: Any) -> str:
    text = str(value or "").strip().upper()
    if not text:
        return ""
    allowed = {
        "ALL_LITERS",
        "PURCHASED_LITERS",
        "PRODUCTION_LITERS",
        "OWN_PRODUCTION_LITERS",
        "CONTRACT_BREW_LITERS",
        "FILLING_HOURS",
        "BATCHES",
        "PICKS_OR_ORDER_LINES",
        "SHIPMENTS",
        "PALLETS",
        "NONE",
    }
    return text if text in allowed else ""


def _normalize_stand(value: Any) -> str:
    text = str(value or "").strip().lower()
    return "actual" if text == "actual" else "normal"

def _normalize_domain(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        # Backward compatible default: existing ABC-light behavior used production totals.
        return "production"
    if text in {"production", "productie", "p"}:
        return "production"
    return "sales"


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
                SELECT
                    id,
                    jaar,
                    omschrijving,
                    kostensoort_code,
                    cost_pool,
                    domain_code,
                    allocation_driver,
                    allocation_scope,
                    include_in_inventory_cost,
                    include_in_quote_handling,
                    COALESCE(NULLIF(stand_code, ''), NULLIF(basis_code, ''), 'normal') AS stand_code,
                    bedrag_per_jaar,
                    herverdeel_pct
                FROM fixed_cost_lines
                ORDER BY jaar, omschrijving, id
                """
            )
            rows = cur.fetchall()

    result: dict[str, list[dict[str, Any]]] = {}
    for (
        line_id,
        jaar,
        omschrijving,
        kostensoort_code,
        cost_pool,
        domain_code,
        allocation_driver,
        allocation_scope,
        include_in_inventory_cost,
        include_in_quote_handling,
        stand_code,
        bedrag,
        herverdeel_pct,
    ) in rows:
        key = str(int(jaar))
        result.setdefault(key, []).append(
            {
                "id": str(line_id),
                "omschrijving": str(omschrijving or ""),
                "kostensoort": _display_cost_type(str(kostensoort_code or "")),
                "cost_pool": str(cost_pool or ""),
                "domain": (
                    "production"
                    if str(domain_code or "").strip().lower() == "production"
                    # Backward compatible heuristic: driver types that only make sense for production
                    # should default to production domain even if older DBs injected a default.
                    or str(allocation_driver or "").strip().upper()
                    in {"PURCHASED_LITERS", "OWN_PRODUCTION_LITERS", "CONTRACT_BREW_LITERS", "PRODUCTION_LITERS"}
                    else "sales"
                ),
                "allocation_driver": str(allocation_driver or ""),
                "allocation_scope": str(allocation_scope or "all"),
                "include_in_inventory_cost": bool(include_in_inventory_cost),
                "include_in_quote_handling": bool(include_in_quote_handling),
                "stand": "actual" if str(stand_code or "").strip().lower() == "actual" else "normal",
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
    flattened: list[tuple[str, int, str, str, str, str, str, str, bool, bool, str, float, float]] = []
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
            cost_pool = str(raw.get("cost_pool", "") or "").strip()
            domain_code = _normalize_domain(raw.get("domain", raw.get("domein", "sales")))
            allocation_driver = _normalize_driver(raw.get("allocation_driver", ""))
            allocation_scope = _normalize_scope(raw.get("allocation_scope", "all"))
            include_in_inventory_cost = bool(raw.get("include_in_inventory_cost", True))
            include_in_quote_handling = bool(raw.get("include_in_quote_handling", False))
            stand_code = _normalize_stand(raw.get("stand", raw.get("basis", "normal")))
            bedrag = float(raw.get("bedrag_per_jaar", 0) or 0)
            pct = float(raw.get("herverdeel_pct", 0) or 0)
            if pct < 0:
                pct = 0
            if pct > 100:
                pct = 100
            flattened.append(
                (
                    line_id,
                    jaar,
                    omschrijving,
                    kostensoort_code,
                    cost_pool,
                    domain_code,
                    allocation_driver,
                    allocation_scope,
                    include_in_inventory_cost,
                    include_in_quote_handling,
                    stand_code,
                    bedrag,
                    pct,
                )
            )

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
            for (
                line_id,
                jaar,
                omschrijving,
                kostensoort_code,
                cost_pool,
                domain_code,
                allocation_driver,
                allocation_scope,
                include_in_inventory_cost,
                include_in_quote_handling,
                stand_code,
                bedrag,
                pct,
            ) in flattened:
                cur.execute(
                    """
                    INSERT INTO fixed_cost_lines (
                        id,
                        jaar,
                        omschrijving,
                        kostensoort_code,
                        cost_pool,
                        domain_code,
                        allocation_driver,
                        allocation_scope,
                        include_in_inventory_cost,
                        include_in_quote_handling,
                        basis_code,
                        stand_code,
                        bedrag_per_jaar,
                        herverdeel_pct,
                        created_at,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        jaar = EXCLUDED.jaar,
                        omschrijving = EXCLUDED.omschrijving,
                        kostensoort_code = EXCLUDED.kostensoort_code,
                        cost_pool = EXCLUDED.cost_pool,
                        domain_code = EXCLUDED.domain_code,
                        allocation_driver = EXCLUDED.allocation_driver,
                        allocation_scope = EXCLUDED.allocation_scope,
                        include_in_inventory_cost = EXCLUDED.include_in_inventory_cost,
                        include_in_quote_handling = EXCLUDED.include_in_quote_handling,
                        basis_code = EXCLUDED.basis_code,
                        stand_code = EXCLUDED.stand_code,
                        bedrag_per_jaar = EXCLUDED.bedrag_per_jaar,
                        herverdeel_pct = EXCLUDED.herverdeel_pct,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        line_id,
                        jaar,
                        omschrijving,
                        kostensoort_code,
                        cost_pool,
                        domain_code,
                        allocation_driver,
                        allocation_scope,
                        include_in_inventory_cost,
                        include_in_quote_handling,
                        stand_code,
                        stand_code,
                        bedrag,
                        pct,
                        now,
                        now,
                    ),
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
