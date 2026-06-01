from __future__ import annotations

from datetime import UTC, datetime
from threading import Lock
from typing import Any

from app.domain import postgres_storage


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
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS production_years (
                        jaar INTEGER PRIMARY KEY,
                        normal_inkoop_l NUMERIC NOT NULL DEFAULT 0,
                        normal_productie_l NUMERIC NOT NULL DEFAULT 0,
                        normal_contract_brew_l NUMERIC NOT NULL DEFAULT 0,
                        normal_shipments NUMERIC NOT NULL DEFAULT 0,
                        normal_orderlines NUMERIC NOT NULL DEFAULT 0,
                        normal_sales_l NUMERIC NOT NULL DEFAULT 0,
                        sales_l NUMERIC NOT NULL DEFAULT 0,
                        hoeveelheid_inkoop_l NUMERIC NOT NULL DEFAULT 0,
                        hoeveelheid_productie_l NUMERIC NOT NULL DEFAULT 0,
                        batchgrootte_eigen_productie_l NUMERIC NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute(
                    "ALTER TABLE production_years ADD COLUMN IF NOT EXISTS normal_inkoop_l NUMERIC NOT NULL DEFAULT 0"
                )
                cur.execute(
                    "ALTER TABLE production_years ADD COLUMN IF NOT EXISTS normal_productie_l NUMERIC NOT NULL DEFAULT 0"
                )
                cur.execute(
                    "ALTER TABLE production_years ADD COLUMN IF NOT EXISTS normal_contract_brew_l NUMERIC NOT NULL DEFAULT 0"
                )
                cur.execute(
                    "ALTER TABLE production_years ADD COLUMN IF NOT EXISTS normal_shipments NUMERIC NOT NULL DEFAULT 0"
                )
                cur.execute(
                    "ALTER TABLE production_years ADD COLUMN IF NOT EXISTS normal_orderlines NUMERIC NOT NULL DEFAULT 0"
                )
                cur.execute(
                    "ALTER TABLE production_years ADD COLUMN IF NOT EXISTS normal_sales_l NUMERIC NOT NULL DEFAULT 0"
                )
                cur.execute(
                    "ALTER TABLE production_years ADD COLUMN IF NOT EXISTS sales_l NUMERIC NOT NULL DEFAULT 0"
                )

                # Legacy dev DBs may have these columns as DOUBLE PRECISION; make them NUMERIC to
                # avoid floating point drift in cost allocation calculations.
                cur.execute(
                    """
                    DO $$
                    BEGIN
                      IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'production_years'
                          AND column_name = 'hoeveelheid_inkoop_l'
                          AND data_type = 'double precision'
                      ) THEN
                        ALTER TABLE production_years
                          ALTER COLUMN hoeveelheid_inkoop_l TYPE NUMERIC USING hoeveelheid_inkoop_l::numeric;
                      END IF;

                      IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'production_years'
                          AND column_name = 'hoeveelheid_productie_l'
                          AND data_type = 'double precision'
                      ) THEN
                        ALTER TABLE production_years
                          ALTER COLUMN hoeveelheid_productie_l TYPE NUMERIC USING hoeveelheid_productie_l::numeric;
                      END IF;

                      IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'production_years'
                          AND column_name = 'batchgrootte_eigen_productie_l'
                          AND data_type = 'double precision'
                      ) THEN
                        ALTER TABLE production_years
                          ALTER COLUMN batchgrootte_eigen_productie_l TYPE NUMERIC USING batchgrootte_eigen_productie_l::numeric;
                      END IF;
                    END $$;
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
    return years


def load_productie() -> dict[str, dict[str, Any]]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    jaar,
                    normal_inkoop_l,
                    normal_productie_l,
                    normal_contract_brew_l,
                    normal_shipments,
                    normal_orderlines,
                    normal_sales_l,
                    sales_l,
                    hoeveelheid_inkoop_l,
                    hoeveelheid_productie_l,
                    batchgrootte_eigen_productie_l
                FROM production_years
                ORDER BY jaar
                """
            )
            rows = cur.fetchall()

    result: dict[str, dict[str, Any]] = {}
    for jaar, n_inkoop, n_productie, n_contract, n_shipments, n_orderlines, n_sales, sales, inkoop, productie, batch in rows:
        result[str(int(jaar))] = {
            "normal_inkoop_l": float(n_inkoop or 0),
            "normal_productie_l": float(n_productie or 0),
            "normal_contract_brew_l": float(n_contract or 0),
            "normal_shipments": float(n_shipments or 0),
            "normal_orderlines": float(n_orderlines or 0),
            "normal_sales_l": float(n_sales or 0),
            "sales_l": float(sales or 0),
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
    rows: list[tuple[int, float, float, float, float, float, float, float, float, float, float]] = []
    for year_key, raw in (payload or {}).items():
        try:
            jaar = int(year_key)
        except (TypeError, ValueError):
            continue
        if not isinstance(raw, dict):
            raw = {}
        inkoop = float(raw.get("hoeveelheid_inkoop_l", 0) or 0)
        productie = float(raw.get("hoeveelheid_productie_l", 0) or 0)
        sales_l = float(raw.get("sales_l", 0) or 0)
        rows.append(
            (
                jaar,
                float(raw.get("normal_inkoop_l", 0) or inkoop),
                float(raw.get("normal_productie_l", 0) or productie),
                float(raw.get("normal_contract_brew_l", 0) or 0),
                float(raw.get("normal_shipments", 0) or 0),
                float(raw.get("normal_orderlines", 0) or 0),
                float(raw.get("normal_sales_l", 0) or sales_l),
                sales_l,
                inkoop,
                productie,
                float(raw.get("batchgrootte_eigen_productie_l", 0) or 0),
            )
        )

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            for jaar, n_inkoop, n_productie, n_contract, n_shipments, n_orderlines, n_sales, sales, inkoop, productie, batch in rows:
                cur.execute(
                    """
                    INSERT INTO production_years (
                        jaar,
                        normal_inkoop_l,
                        normal_productie_l,
                        normal_contract_brew_l,
                        normal_shipments,
                        normal_orderlines,
                        normal_sales_l,
                        sales_l,
                        hoeveelheid_inkoop_l,
                        hoeveelheid_productie_l,
                        batchgrootte_eigen_productie_l,
                        created_at,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (jaar) DO UPDATE SET
                        normal_inkoop_l = EXCLUDED.normal_inkoop_l,
                        normal_productie_l = EXCLUDED.normal_productie_l,
                        normal_contract_brew_l = EXCLUDED.normal_contract_brew_l,
                        normal_shipments = EXCLUDED.normal_shipments,
                        normal_orderlines = EXCLUDED.normal_orderlines,
                        normal_sales_l = EXCLUDED.normal_sales_l,
                        sales_l = EXCLUDED.sales_l,
                        hoeveelheid_inkoop_l = EXCLUDED.hoeveelheid_inkoop_l,
                        hoeveelheid_productie_l = EXCLUDED.hoeveelheid_productie_l,
                        batchgrootte_eigen_productie_l = EXCLUDED.batchgrootte_eigen_productie_l,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (jaar, n_inkoop, n_productie, n_contract, n_shipments, n_orderlines, n_sales, sales, inkoop, productie, batch, now, now),
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return True


def update_order_drivers_for_year(
    *,
    jaar: int,
    normal_shipments: float,
    normal_orderlines: float,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Update normal shipment/orderline drivers for a single year.

    - When overwrite is False, only fills fields that are currently 0.
    - When overwrite is True, replaces existing values.
    """
    ensure_schema()
    yr = int(jaar or 0)
    if yr <= 0:
        raise ValueError("jaar is verplicht.")

    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT normal_shipments, normal_orderlines
                FROM production_years
                WHERE jaar = %s
                """,
                (yr,),
            )
            row = cur.fetchone()
            if row is None:
                raise ValueError(f"Jaar {yr} bestaat niet in productie. Voeg eerst het jaar toe.")
            current_shipments, current_orderlines = row

            next_shipments = float(normal_shipments or 0)
            next_orderlines = float(normal_orderlines or 0)

            if not overwrite:
                if float(current_shipments or 0) > 0:
                    next_shipments = float(current_shipments or 0)
                if float(current_orderlines or 0) > 0:
                    next_orderlines = float(current_orderlines or 0)

            cur.execute(
                """
                UPDATE production_years
                SET
                  normal_shipments = %s,
                  normal_orderlines = %s,
                  updated_at = %s
                WHERE jaar = %s
                """,
                (next_shipments, next_orderlines, now, yr),
            )
        if not postgres_storage.in_transaction():
            conn.commit()

    return {
        "jaar": yr,
        "normal_shipments": float(next_shipments or 0),
        "normal_orderlines": float(next_orderlines or 0),
        "overwrote": bool(overwrite),
    }


def update_sales_liters_for_year(
    *,
    jaar: int,
    sales_l: float,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Update sales liters (actual) and normal sales liters (baseline) for a single year.

    - When overwrite is False, only fills fields that are currently 0.
    - When overwrite is True, replaces existing values.
    """
    ensure_schema()
    yr = int(jaar or 0)
    if yr <= 0:
        raise ValueError("jaar is verplicht.")

    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT normal_sales_l, sales_l
                FROM production_years
                WHERE jaar = %s
                """,
                (yr,),
            )
            row = cur.fetchone()
            if row is None:
                raise ValueError(f"Jaar {yr} bestaat niet in productie. Voeg eerst het jaar toe.")
            current_normal, current_sales = row

            next_sales = float(sales_l or 0)
            next_normal = float(next_sales or 0)

            if not overwrite:
                if float(current_sales or 0) > 0:
                    next_sales = float(current_sales or 0)
                if float(current_normal or 0) > 0:
                    next_normal = float(current_normal or 0)

            cur.execute(
                """
                UPDATE production_years
                SET
                  normal_sales_l = %s,
                  sales_l = %s,
                  updated_at = %s
                WHERE jaar = %s
                """,
                (next_normal, next_sales, now, yr),
            )
        if not postgres_storage.in_transaction():
            conn.commit()

    return {
        "jaar": yr,
        "normal_sales_l": float(next_normal or 0),
        "sales_l": float(next_sales or 0),
        "overwrote": bool(overwrite),
    }


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
