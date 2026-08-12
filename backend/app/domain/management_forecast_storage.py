from __future__ import annotations

import json
import hashlib
from datetime import UTC, datetime
from threading import Lock
from typing import Any

from app.domain import postgres_storage, yearset_reconciliation_storage


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()
_AUTHORITY_LOCK_KEY = "calculatietool:management-forecast:v1"


class ManagementForecastConflict(RuntimeError):
    pass


class ManagementForecastBlocked(RuntimeError):
    pass


def _text(value: Any) -> str:
    return str(value or "").strip()


def _json(value: Any, fallback: Any) -> Any:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return fallback
    return value if isinstance(value, type(fallback)) else fallback


def _iso(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else _text(value)


def compute_content_hash(
    *,
    binding: dict[str, Any],
    as_of_date: str,
    annual_targets: dict[str, Any],
    period_allocations: list[dict[str, Any]],
) -> str:
    """Hash the immutable revision payload and its exact authority binding."""

    canonical = json.dumps(
        {
            "binding": binding,
            "basis": "invoice",
            "as_of_date": _text(as_of_date),
            "annual_targets": annual_targets,
            "period_allocations": period_allocations,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def ensure_schema() -> None:
    """Create the additive, append-only RF-012C2B Forecast authority."""

    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    with _SCHEMA_LOCK:
        if _SCHEMA_READY:
            return
        postgres_storage.ensure_schema()
        yearset_reconciliation_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS commercial_forecast_revisions (
                        id TEXT PRIMARY KEY,
                        generation_id TEXT NOT NULL
                            REFERENCES commercial_yearsets(id) ON DELETE RESTRICT,
                        run_id TEXT NOT NULL
                            REFERENCES commercial_yearset_reconciliation_runs(id)
                            ON DELETE RESTRICT,
                        plan_id TEXT NOT NULL
                            REFERENCES commercial_yearset_candidate_plan(id)
                            ON DELETE RESTRICT,
                        plan_contract_hash TEXT NOT NULL,
                        operational_year INTEGER NOT NULL
                            CHECK (operational_year > 0),
                        revision_number INTEGER NOT NULL
                            CHECK (revision_number > 0),
                        status TEXT NOT NULL
                            CHECK (status IN ('active', 'superseded')),
                        as_of_date DATE NOT NULL,
                        basis TEXT NOT NULL DEFAULT 'invoice'
                            CHECK (basis = 'invoice'),
                        annual_targets JSONB NOT NULL,
                        period_allocations JSONB NOT NULL,
                        reason TEXT NOT NULL,
                        created_by TEXT NOT NULL,
                        created_role TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        supersedes_revision_id TEXT NULL
                            REFERENCES commercial_forecast_revisions(id)
                            ON DELETE RESTRICT,
                        content_hash TEXT NOT NULL,
                        UNIQUE (generation_id, revision_number)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS
                        ux_commercial_forecast_active_generation
                    ON commercial_forecast_revisions (generation_id)
                    WHERE status = 'active'
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS
                        ix_commercial_forecast_history
                    ON commercial_forecast_revisions
                        (generation_id, revision_number DESC, created_at DESC)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS
                        ix_commercial_forecast_content_hash
                    ON commercial_forecast_revisions
                        (generation_id, content_hash)
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def _row_to_dict(row: Any) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": _text(row[0]),
        "generation_id": _text(row[1]),
        "run_id": _text(row[2]),
        "plan_id": _text(row[3]),
        "plan_contract_hash": _text(row[4]),
        "operational_year": int(row[5] or 0),
        "revision_number": int(row[6] or 0),
        "status": _text(row[7]),
        "as_of_date": _iso(row[8]),
        "basis": _text(row[9]),
        "annual_targets": _json(row[10], {}),
        "period_allocations": _json(row[11], []),
        "reason": _text(row[12]),
        "created_by": _text(row[13]),
        "created_role": _text(row[14]),
        "created_at": _iso(row[15]),
        "supersedes_revision_id": _text(row[16]),
        "content_hash": _text(row[17]),
    }


_SELECT_COLUMNS = """
    id, generation_id, run_id, plan_id, plan_contract_hash,
    operational_year, revision_number, status, as_of_date, basis,
    annual_targets, period_allocations, reason, created_by,
    created_role, created_at, supersedes_revision_id, content_hash
"""


def get_active_revision(
    *, generation_id: str, connection: Any | None = None
) -> dict[str, Any] | None:
    def read(conn: Any) -> dict[str, Any] | None:
        row = conn.execute(
            f"""
            SELECT {_SELECT_COLUMNS}
            FROM commercial_forecast_revisions
            WHERE generation_id = %s AND status = 'active'
            """,
            (_text(generation_id),),
        ).fetchone()
        return _row_to_dict(row)

    if connection is not None:
        return read(connection)
    with postgres_storage.connect() as conn:
        return read(conn)


def list_revisions(
    *, generation_id: str, connection: Any | None = None
) -> list[dict[str, Any]]:
    def read(conn: Any) -> list[dict[str, Any]]:
        rows = conn.execute(
            f"""
            SELECT {_SELECT_COLUMNS}
            FROM commercial_forecast_revisions
            WHERE generation_id = %s
            ORDER BY revision_number DESC, created_at DESC, id
            """,
            (_text(generation_id),),
        ).fetchall()
        return [value for row in rows if (value := _row_to_dict(row))]

    if connection is not None:
        return read(connection)
    with postgres_storage.connect() as conn:
        return read(conn)


def create_revision(
    *,
    revision_id: str,
    generation_id: str,
    run_id: str,
    plan_id: str,
    plan_contract_hash: str,
    operational_year: int,
    as_of_date: str,
    annual_targets: dict[str, Any],
    period_allocations: list[dict[str, Any]],
    reason: str,
    actor: str,
    actor_role: str,
    content_hash: str,
    expected_active_revision_id: str = "",
) -> dict[str, Any]:
    """Append one revision and supersede only the prior active pointer."""

    ensure_schema()
    values = (
        revision_id,
        generation_id,
        run_id,
        plan_id,
        plan_contract_hash,
        content_hash,
        actor,
        actor_role,
        reason,
    )
    if not all(_text(value) for value in values):
        raise ValueError("Forecast-revisie mist verplichte identiteit of auditgegevens.")

    with postgres_storage.transaction() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s))",
                (_AUTHORITY_LOCK_KEY,),
            )
            cur.execute(
                """
                SELECT y.id, y.operational_year, y.status, y.readiness_status,
                       r.id, r.status, r.readiness_status,
                       p.id, p.plan_contract_hash, p.readiness_status,
                       p.blocker_codes
                FROM commercial_yearsets y
                JOIN commercial_yearset_reconciliation_runs r
                  ON r.generation_id = y.id
                JOIN commercial_yearset_candidate_plan p
                  ON p.run_id = r.id
                WHERE y.status = 'active'
                FOR UPDATE OF y, r, p
                """
            )
            authority = cur.fetchone()
            if not authority:
                raise ManagementForecastBlocked(
                    "Geen actieve commerciële jaarset met Plan gevonden."
                )
            if (
                _text(authority[0]) != _text(generation_id)
                or int(authority[1] or 0) != int(operational_year)
                or _text(authority[2]) != "active"
                or _text(authority[3]) != "ready"
                or _text(authority[4]) != _text(run_id)
                or _text(authority[5]) != "active"
                or _text(authority[6]) != "ready"
                or _text(authority[7]) != _text(plan_id)
                or _text(authority[8]) != _text(plan_contract_hash)
                or _text(authority[9]) != "ready"
                or bool(_json(authority[10], []))
            ):
                raise ManagementForecastConflict(
                    "De actieve jaarset, reconciliation-run of Plan-hash is gewijzigd. Vernieuw de pagina."
                )

            cur.execute(
                "SELECT id FROM year_close_snapshots WHERE jaar = %s AND status = 'closed'",
                (int(operational_year),),
            )
            if cur.fetchone():
                raise ManagementForecastBlocked(
                    "Het jaar is afgesloten; Forecast is nu gelijk aan definitieve Actual."
                )

            cur.execute(
                """
                SELECT id, revision_number
                FROM commercial_forecast_revisions
                WHERE generation_id = %s AND status = 'active'
                FOR UPDATE
                """,
                (_text(generation_id),),
            )
            current = cur.fetchone()
            current_id = _text(current[0]) if current else ""
            if current_id != _text(expected_active_revision_id):
                raise ManagementForecastConflict(
                    "Er is inmiddels een andere Forecast-revisie actief. Vernieuw de pagina."
                )

            next_revision = int(current[1] or 0) + 1 if current else 1
            if current:
                cur.execute(
                    """
                    UPDATE commercial_forecast_revisions
                    SET status = 'superseded'
                    WHERE id = %s AND status = 'active'
                    """,
                    (current_id,),
                )
            cur.execute(
                """
                INSERT INTO commercial_forecast_revisions (
                    id, generation_id, run_id, plan_id, plan_contract_hash,
                    operational_year, revision_number, status, as_of_date,
                    basis, annual_targets, period_allocations, reason,
                    created_by, created_role, created_at,
                    supersedes_revision_id, content_hash
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s, 'active', %s::date,
                    'invoice', %s::jsonb, %s::jsonb, %s, %s, %s, %s,
                    NULLIF(%s, ''), %s
                )
                """,
                (
                    _text(revision_id),
                    _text(generation_id),
                    _text(run_id),
                    _text(plan_id),
                    _text(plan_contract_hash),
                    int(operational_year),
                    next_revision,
                    _text(as_of_date),
                    json.dumps(annual_targets, ensure_ascii=False, sort_keys=True),
                    json.dumps(period_allocations, ensure_ascii=False, sort_keys=True),
                    _text(reason),
                    _text(actor),
                    _text(actor_role),
                    datetime.now(UTC),
                    current_id,
                    _text(content_hash),
                ),
            )
        result = get_active_revision(
            generation_id=_text(generation_id), connection=conn
        )
        if not result:
            raise ManagementForecastConflict(
                "Forecast-revisie is niet teruggelezen na opslaan."
            )
        return result
