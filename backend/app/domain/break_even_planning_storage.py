from __future__ import annotations

import json
from datetime import UTC, date, datetime
from threading import Lock
from typing import Any
from uuid import uuid4

from app.domain import postgres_storage


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _text(value: Any) -> str:
    return str(value or "").strip()


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _date_text(value: Any) -> str:
    if isinstance(value, date):
        return value.isoformat()
    return _text(value)


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
                    CREATE TABLE IF NOT EXISTS break_even_plan_snapshots (
                        id TEXT PRIMARY KEY,
                        jaar INTEGER NOT NULL,
                        scenario_name TEXT NOT NULL DEFAULT 'Basis',
                        status TEXT NOT NULL DEFAULT 'active',
                        source TEXT NOT NULL DEFAULT 'planning',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    );
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS break_even_reforecast_snapshots (
                        id TEXT PRIMARY KEY,
                        jaar INTEGER NOT NULL,
                        plan_snapshot_id TEXT NULL,
                        as_of_date DATE NULL,
                        basis TEXT NOT NULL DEFAULT 'invoice',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    );
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS year_close_snapshots (
                        id TEXT PRIMARY KEY,
                        jaar INTEGER NOT NULL,
                        status TEXT NOT NULL DEFAULT 'closed',
                        closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    );
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE break_even_reforecast_snapshots
                    ALTER COLUMN plan_snapshot_id DROP DEFAULT;
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE break_even_reforecast_snapshots
                    ALTER COLUMN plan_snapshot_id DROP NOT NULL;
                    """
                )
                cur.execute(
                    """
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_constraint WHERE conname = 'fk_break_even_reforecast_plan_snapshot'
                        ) THEN
                            ALTER TABLE break_even_reforecast_snapshots
                            ADD CONSTRAINT fk_break_even_reforecast_plan_snapshot
                            FOREIGN KEY (plan_snapshot_id) REFERENCES break_even_plan_snapshots(id)
                            ON DELETE SET NULL
                            NOT VALID;
                        END IF;
                    END $$;
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_break_even_plan_year_status
                    ON break_even_plan_snapshots (jaar, status);
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_break_even_reforecast_year
                    ON break_even_reforecast_snapshots (jaar, as_of_date);
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS ux_year_close_snapshot_year
                    ON year_close_snapshots (jaar);
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def list_plan_snapshots(*, year: int = 0, include_archived: bool = False) -> list[dict[str, Any]]:
    ensure_schema()
    clauses: list[str] = []
    params: list[Any] = []
    if int(year or 0) > 0:
        clauses.append("jaar = %s")
        params.append(int(year))
    if not include_archived:
        clauses.append("status <> 'archived'")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, jaar, scenario_name, status, source, created_at, updated_at, frozen_at, payload
                FROM break_even_plan_snapshots
                {where}
                ORDER BY jaar DESC, created_at DESC
                """,
                tuple(params),
            )
            rows = cur.fetchall() or []
    return [
        {
            "id": _text(row[0]),
            "jaar": int(row[1] or 0),
            "scenario_name": _text(row[2]),
            "status": _text(row[3]),
            "source": _text(row[4]),
            "created_at": _text(row[5].isoformat() if hasattr(row[5], "isoformat") else row[5]),
            "updated_at": _text(row[6].isoformat() if hasattr(row[6], "isoformat") else row[6]),
            "frozen_at": _text(row[7].isoformat() if hasattr(row[7], "isoformat") else row[7]),
            "payload": row[8] if isinstance(row[8], dict) else {},
        }
        for row in rows
    ]


def create_plan_snapshot(
    *,
    year: int,
    scenario_name: str = "Basis",
    source: str = "planning",
    payload: dict[str, Any] | None = None,
    replace_active: bool = False,
) -> dict[str, Any]:
    ensure_schema()
    year_value = int(year or 0)
    if year_value <= 0:
        raise ValueError("Jaar is verplicht.")
    now = _now()
    snapshot_id = str(uuid4())
    body = dict(payload or {})
    body.setdefault("year", year_value)
    body.setdefault("scenario_name", _text(scenario_name) or "Basis")
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if replace_active:
                cur.execute(
                    """
                    UPDATE break_even_plan_snapshots
                    SET status = 'archived', updated_at = %s
                    WHERE jaar = %s AND status = 'active'
                    """,
                    (now, year_value),
                )
            cur.execute(
                """
                INSERT INTO break_even_plan_snapshots (
                    id, jaar, scenario_name, status, source, created_at, updated_at, frozen_at, payload
                )
                VALUES (%s, %s, %s, 'active', %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    snapshot_id,
                    year_value,
                    _text(scenario_name) or "Basis",
                    _text(source) or "planning",
                    now,
                    now,
                    now,
                    json.dumps(body),
                ),
            )
        if not postgres_storage.in_transaction():
            conn.commit()
    return {
        "id": snapshot_id,
        "jaar": year_value,
        "scenario_name": _text(scenario_name) or "Basis",
        "status": "active",
        "source": _text(source) or "planning",
        "created_at": now,
        "updated_at": now,
        "frozen_at": now,
        "payload": body,
    }


def archive_plan_snapshot(*, snapshot_id: str) -> dict[str, Any]:
    ensure_schema()
    clean_id = _text(snapshot_id)
    if not clean_id:
        raise ValueError("Plan snapshot id is verplicht.")
    now = _now()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE break_even_plan_snapshots
                SET status = 'archived', updated_at = %s
                WHERE id = %s
                RETURNING id, jaar, scenario_name, status, source, created_at, updated_at, frozen_at, payload
                """,
                (now, clean_id),
            )
            row = cur.fetchone()
        if not postgres_storage.in_transaction():
            conn.commit()
    if not row:
        raise ValueError("Plan snapshot niet gevonden.")
    return {
        "id": _text(row[0]),
        "jaar": int(row[1] or 0),
        "scenario_name": _text(row[2]),
        "status": _text(row[3]),
        "source": _text(row[4]),
        "created_at": _text(row[5].isoformat() if hasattr(row[5], "isoformat") else row[5]),
        "updated_at": _text(row[6].isoformat() if hasattr(row[6], "isoformat") else row[6]),
        "frozen_at": _text(row[7].isoformat() if hasattr(row[7], "isoformat") else row[7]),
        "payload": row[8] if isinstance(row[8], dict) else {},
    }


def create_reforecast_snapshot(
    *,
    year: int,
    plan_snapshot_id: str = "",
    as_of_date: str = "",
    basis: str = "invoice",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_schema()
    year_value = int(year or 0)
    if year_value <= 0:
        raise ValueError("Jaar is verplicht.")
    now = _now()
    snapshot_id = str(uuid4())
    body = dict(payload or {})
    body.setdefault("year", year_value)
    body.setdefault("basis", _text(basis) or "invoice")
    body.setdefault("as_of_date", _date_text(as_of_date))
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO break_even_reforecast_snapshots (
                    id, jaar, plan_snapshot_id, as_of_date, basis, created_at, payload
                )
                VALUES (%s, %s, %s, NULLIF(%s, '')::date, %s, %s, %s::jsonb)
                """,
                (
                    snapshot_id,
                    year_value,
                    _text(plan_snapshot_id) or None,
                    _date_text(as_of_date),
                    _text(basis) or "invoice",
                    now,
                    json.dumps(body),
                ),
            )
        if not postgres_storage.in_transaction():
            conn.commit()
    return {
        "id": snapshot_id,
        "jaar": year_value,
        "plan_snapshot_id": _text(plan_snapshot_id),
        "as_of_date": _date_text(as_of_date),
        "basis": _text(basis) or "invoice",
        "created_at": now,
        "payload": body,
    }


def latest_reforecast_snapshot(*, year: int, basis: str = "") -> dict[str, Any] | None:
    ensure_schema()
    clauses = ["jaar = %s"]
    params: list[Any] = [int(year or 0)]
    basis_value = _text(basis)
    if basis_value:
        clauses.append("basis = %s")
        params.append(basis_value)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, jaar, plan_snapshot_id, as_of_date, basis, created_at, payload
                FROM break_even_reforecast_snapshots
                WHERE {' AND '.join(clauses)}
                ORDER BY as_of_date DESC NULLS LAST, created_at DESC
                LIMIT 1
                """,
                tuple(params),
            )
            row = cur.fetchone()
    if not row:
        return None
    return {
        "id": _text(row[0]),
        "jaar": int(row[1] or 0),
        "plan_snapshot_id": _text(row[2]),
        "as_of_date": _text(row[3].isoformat() if hasattr(row[3], "isoformat") else row[3]),
        "basis": _text(row[4]),
        "created_at": _text(row[5].isoformat() if hasattr(row[5], "isoformat") else row[5]),
        "payload": row[6] if isinstance(row[6], dict) else {},
    }


def close_year_snapshot(*, year: int, payload: dict[str, Any], overwrite: bool = False) -> dict[str, Any]:
    ensure_schema()
    year_value = int(year or 0)
    if year_value <= 0:
        raise ValueError("Jaar is verplicht.")
    now = _now()
    existing = get_year_close_snapshot(year=year_value)
    if existing and not overwrite:
        raise ValueError("Jaar is al afgesloten. Gebruik overwrite=true om opnieuw vast te leggen.")
    snapshot_id = existing.get("id") if existing else str(uuid4())
    body = dict(payload or {})
    body.setdefault("year", year_value)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO year_close_snapshots (id, jaar, status, closed_at, created_at, payload)
                VALUES (%s, %s, 'closed', %s, %s, %s::jsonb)
                ON CONFLICT (jaar) DO UPDATE SET
                    status = 'closed',
                    closed_at = EXCLUDED.closed_at,
                    payload = EXCLUDED.payload
                """,
                (snapshot_id, year_value, now, now, json.dumps(body)),
            )
        if not postgres_storage.in_transaction():
            conn.commit()
    return {"id": snapshot_id, "jaar": year_value, "status": "closed", "closed_at": now, "payload": body}


def get_year_close_snapshot(*, year: int) -> dict[str, Any] | None:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, jaar, status, closed_at, created_at, payload
                FROM year_close_snapshots
                WHERE jaar = %s
                """,
                (int(year or 0),),
            )
            row = cur.fetchone()
    if not row:
        return None
    return {
        "id": _text(row[0]),
        "jaar": int(row[1] or 0),
        "status": _text(row[2]),
        "closed_at": _text(row[3].isoformat() if hasattr(row[3], "isoformat") else row[3]),
        "created_at": _text(row[4].isoformat() if hasattr(row[4], "isoformat") else row[4]),
        "payload": row[5] if isinstance(row[5], dict) else {},
    }


def delete_year_close_snapshot(*, year: int) -> dict[str, Any]:
    ensure_schema()
    year_value = int(year or 0)
    if year_value <= 0:
        raise ValueError("Jaar is verplicht.")
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM year_close_snapshots
                WHERE jaar = %s
                RETURNING id, jaar, status, closed_at, created_at, payload
                """,
                (year_value,),
            )
            row = cur.fetchone()
        if not postgres_storage.in_transaction():
            conn.commit()
    if not row:
        raise ValueError("Jaarafsluiting niet gevonden.")
    return {
        "id": _text(row[0]),
        "jaar": int(row[1] or 0),
        "status": _text(row[2]),
        "closed_at": _text(row[3].isoformat() if hasattr(row[3], "isoformat") else row[3]),
        "created_at": _text(row[4].isoformat() if hasattr(row[4], "isoformat") else row[4]),
        "payload": row[5] if isinstance(row[5], dict) else {},
        "deleted": True,
    }


def list_year_close_snapshots(*, year: int = 0) -> list[dict[str, Any]]:
    ensure_schema()
    clauses: list[str] = []
    params: list[Any] = []
    if int(year or 0) > 0:
        clauses.append("jaar = %s")
        params.append(int(year))
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, jaar, status, closed_at, created_at, payload
                FROM year_close_snapshots
                {where}
                ORDER BY jaar DESC, closed_at DESC
                """,
                tuple(params),
            )
            rows = cur.fetchall() or []
    return [
        {
            "id": _text(row[0]),
            "jaar": int(row[1] or 0),
            "status": _text(row[2]),
            "closed_at": _text(row[3].isoformat() if hasattr(row[3], "isoformat") else row[3]),
            "created_at": _text(row[4].isoformat() if hasattr(row[4], "isoformat") else row[4]),
            "payload": row[5] if isinstance(row[5], dict) else {},
        }
        for row in rows
    ]


def audit_model() -> dict[str, Any]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*)::int FROM break_even_plan_snapshots")
            plan_count = int((cur.fetchone() or [0])[0] or 0)
            cur.execute("SELECT COUNT(*)::int FROM break_even_reforecast_snapshots")
            reforecast_count = int((cur.fetchone() or [0])[0] or 0)
            cur.execute("SELECT COUNT(*)::int FROM year_close_snapshots")
            close_count = int((cur.fetchone() or [0])[0] or 0)
            cur.execute(
                """
                SELECT jaar, COUNT(*)::int
                FROM break_even_plan_snapshots
                WHERE status = 'active'
                GROUP BY jaar
                HAVING COUNT(*) > 1
                ORDER BY jaar
                """
            )
            duplicate_active_plans = [{"jaar": int(r[0]), "count": int(r[1])} for r in cur.fetchall() or []]
    return {
        "tables": {
            "break_even_plan_snapshots": plan_count,
            "break_even_reforecast_snapshots": reforecast_count,
            "year_close_snapshots": close_count,
        },
        "duplicate_active_plans": duplicate_active_plans,
        "review": {
            "pk": "All snapshot tables use immutable TEXT UUID primary keys.",
            "fk": "Reforecast snapshots link to plan snapshots with an ON DELETE SET NULL foreign key; analytical snapshots keep their payload intact.",
            "normalization": "Snapshots intentionally store JSON payloads as immutable reporting facts; canonical SKU costs remain normalized in cost_version_sku_rows.",
            "antipatterns": [],
        },
    }
