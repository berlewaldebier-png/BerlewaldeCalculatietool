from __future__ import annotations

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any

from app.domain import postgres_storage


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()


def _row_id(*, jaar: int, bier_id: str, product_id: str) -> str:
    return f"{int(jaar)}::{str(bier_id or '').strip()}::{str(product_id or '').strip()}"


def ensure_schema() -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    with _SCHEMA_LOCK:
        if _SCHEMA_READY:
            return
        postgres_storage.ensure_schema()
        # Ensure master registry exists before we add FK constraints (NOT VALID).
        from app.domain import product_registry_storage

        product_registry_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS kostprijs_scenario_inkoop_rows (
                        id TEXT PRIMARY KEY,
                        jaar INTEGER NOT NULL,
                        bier_id TEXT NOT NULL,
                        product_id TEXT NOT NULL,
                        scenario_primaire_kosten NUMERIC NOT NULL DEFAULT 0,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                # Enforce product_id integrity against the master registry.
                # NOT VALID keeps existing legacy rows from blocking startup; new rows are checked.
                cur.execute(
                    """
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_constraint WHERE conname = 'fk_kostprijs_scenario_product'
                        ) THEN
                            ALTER TABLE kostprijs_scenario_inkoop_rows
                            ADD CONSTRAINT fk_kostprijs_scenario_product
                            FOREIGN KEY (product_id) REFERENCES products_master(id) ON DELETE RESTRICT
                            NOT VALID;
                        END IF;
                    END $$;
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_kostprijs_scenario_inkoop_year ON kostprijs_scenario_inkoop_rows(jaar)"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_kostprijs_scenario_inkoop_product ON kostprijs_scenario_inkoop_rows(product_id)"
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def load_dataset(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT jaar, bier_id, product_id, scenario_primaire_kosten
                FROM kostprijs_scenario_inkoop_rows
                ORDER BY jaar, bier_id, product_id, id
                """
            )
            rows = cur.fetchall()
    if not rows:
        return default_value
    out: list[dict[str, Any]] = []
    for jaar, bier_id, product_id, value in rows:
        out.append(
            {
                "jaar": int(jaar or 0),
                "bier_id": str(bier_id or ""),
                "product_id": str(product_id or ""),
                "scenario_primaire_kosten": float(value or 0),
            }
        )
    return out


def save_dataset(data: Any, *, overwrite: bool = True) -> bool:
    ensure_schema()
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'kostprijs-scenario-inkoop': verwacht list.")

    rows: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    now = datetime.now(UTC)

    # Deduplicate in-memory by scope; last write wins.
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        try:
            jaar = int(row.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            jaar = 0
        bier_id = str(row.get("bier_id", "") or "").strip()
        product_id = str(row.get("product_id", "") or "").strip()
        if jaar <= 0 or not bier_id or not product_id:
            continue
        rid = _row_id(jaar=jaar, bier_id=bier_id, product_id=product_id)
        by_id[rid] = {"jaar": jaar, "bier_id": bier_id, "product_id": product_id, "value": row.get("scenario_primaire_kosten")}

    normalized = list(by_id.items())
    years_in_payload = {int(v["jaar"]) for _, v in normalized}

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if not overwrite:
                cur.execute("SELECT COUNT(*) FROM kostprijs_scenario_inkoop_rows")
                count_row = cur.fetchone()
                existing = int((count_row[0] if count_row else 0) or 0)
                if existing > 0:
                    return True

            if not normalized and overwrite:
                cur.execute("DELETE FROM kostprijs_scenario_inkoop_rows")
            else:
                # Replace-by-scope: only mutate years present in this payload.
                if overwrite:
                    for jaar in sorted(years_in_payload):
                        cur.execute("DELETE FROM kostprijs_scenario_inkoop_rows WHERE jaar = %s", (int(jaar),))

                params: list[tuple[Any, ...]] = []
                for rid, row in normalized:
                    jaar = int(row["jaar"])
                    bier_id = str(row["bier_id"])
                    product_id = str(row["product_id"])
                    try:
                        value = float(row.get("value") or 0.0)
                    except (TypeError, ValueError):
                        value = 0.0
                    params.append((rid, jaar, bier_id, product_id, value, now))

                if params:
                    cur.executemany(
                        """
                        INSERT INTO kostprijs_scenario_inkoop_rows
                            (id, jaar, bier_id, product_id, scenario_primaire_kosten, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id)
                        DO UPDATE SET
                            jaar = EXCLUDED.jaar,
                            bier_id = EXCLUDED.bier_id,
                            product_id = EXCLUDED.product_id,
                            scenario_primaire_kosten = EXCLUDED.scenario_primaire_kosten,
                            updated_at = EXCLUDED.updated_at
                        """,
                        params,
                    )
        if not postgres_storage.in_transaction():
            conn.commit()

    try:
        postgres_storage.delete_app_dataset_row("kostprijs-scenario-inkoop")
    except Exception:
        pass
    return True

