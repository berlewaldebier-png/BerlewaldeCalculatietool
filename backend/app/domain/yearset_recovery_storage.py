from __future__ import annotations

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any

from app.domain import postgres_storage


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()
_AUTHORITY_LOCK_KEY = "calculatietool:yearset-recovery-input:v1"


class YearsetRecoveryConflict(RuntimeError):
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


def ensure_schema() -> None:
    """Create the single additive RF-013C3 decision/audit table."""

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
                    CREATE TABLE IF NOT EXISTS commercial_yearset_recovery_inputs (
                        id TEXT PRIMARY KEY,
                        source_year INTEGER NOT NULL CHECK (source_year > 0),
                        target_year INTEGER NOT NULL CHECK (target_year > source_year),
                        status TEXT NOT NULL
                            CHECK (status IN ('approved', 'superseded')),
                        lineage_review_hash TEXT NOT NULL,
                        base_manifest_hash TEXT NOT NULL,
                        decision_hash TEXT NOT NULL,
                        payload JSONB NOT NULL,
                        approved_by TEXT NOT NULL,
                        approved_at TIMESTAMPTZ NOT NULL,
                        approval_reason TEXT NOT NULL,
                        superseded_by TEXT NULL
                            REFERENCES commercial_yearset_recovery_inputs(id)
                            ON DELETE RESTRICT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        UNIQUE (target_year, decision_hash)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS
                        ux_commercial_yearset_recovery_input_approved_year
                    ON commercial_yearset_recovery_inputs (target_year)
                    WHERE status = 'approved'
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS
                        ix_commercial_yearset_recovery_inputs_history
                    ON commercial_yearset_recovery_inputs
                        (target_year, status, approved_at DESC)
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def _table_exists(connection: Any) -> bool:
    row = connection.execute(
        "SELECT to_regclass('public.commercial_yearset_recovery_inputs')"
    ).fetchone()
    return bool(row and row[0])


def _row_to_dict(row: Any) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": _text(row[0]),
        "source_year": int(row[1] or 0),
        "target_year": int(row[2] or 0),
        "status": _text(row[3]),
        "lineage_review_hash": _text(row[4]),
        "base_manifest_hash": _text(row[5]),
        "decision_hash": _text(row[6]),
        "payload": _json(row[7], {}),
        "approved_by": _text(row[8]),
        "approved_at": row[9].isoformat() if row[9] else "",
        "approval_reason": _text(row[10]),
        "superseded_by": _text(row[11]),
        "created_at": row[12].isoformat() if row[12] else "",
    }


def get_approved_input(
    *,
    source_year: int,
    target_year: int,
    connection: Any | None = None,
) -> dict[str, Any] | None:
    """Read the approved input without creating schema on read-only review paths."""

    def read(conn: Any) -> dict[str, Any] | None:
        if not _table_exists(conn):
            return None
        row = conn.execute(
            """
            SELECT id, source_year, target_year, status, lineage_review_hash,
                   base_manifest_hash, decision_hash, payload, approved_by,
                   approved_at, approval_reason, superseded_by, created_at
            FROM commercial_yearset_recovery_inputs
            WHERE source_year = %s
              AND target_year = %s
              AND status = 'approved'
            """,
            (int(source_year), int(target_year)),
        ).fetchone()
        return _row_to_dict(row)

    if connection is not None:
        return read(connection)
    with postgres_storage.connect() as conn:
        return read(conn)


def approve_input(
    *,
    input_id: str,
    source_year: int,
    target_year: int,
    lineage_review_hash: str,
    base_manifest_hash: str,
    decision_hash: str,
    payload: dict[str, Any],
    actor: str,
    actor_role: str,
    reason: str,
    connection: Any | None = None,
) -> dict[str, Any]:
    if _text(actor_role) != "management":
        raise PermissionError(
            "Alleen Management mag een herstelinvoer voor een jaarset goedkeuren."
        )
    if not _text(actor) or not _text(reason):
        raise ValueError("Actor en goedkeuringsreden zijn verplicht.")
    if not all(
        _text(value)
        for value in (
            input_id,
            lineage_review_hash,
            base_manifest_hash,
            decision_hash,
        )
    ):
        raise ValueError("Herstelinvoer mist verplichte hashes of identiteit.")

    ensure_schema()
    now = datetime.now(UTC)

    def write(conn: Any) -> dict[str, Any]:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s))",
                (_AUTHORITY_LOCK_KEY,),
            )
            cur.execute(
                """
                SELECT id, decision_hash
                FROM commercial_yearset_recovery_inputs
                WHERE source_year = %s
                  AND target_year = %s
                  AND status = 'approved'
                FOR UPDATE
                """,
                (int(source_year), int(target_year)),
            )
            current = cur.fetchone()
            if current and _text(current[1]) == _text(decision_hash):
                existing = get_approved_input(
                    source_year=int(source_year),
                    target_year=int(target_year),
                    connection=conn,
                )
                return {**(existing or {}), "created": False}

            cur.execute(
                """
                SELECT id
                FROM commercial_yearset_recovery_inputs
                WHERE target_year = %s AND decision_hash = %s
                """,
                (int(target_year), _text(decision_hash)),
            )
            same = cur.fetchone()
            if same:
                raise YearsetRecoveryConflict(
                    "Deze beslisinvoer bestaat al maar is niet de actieve goedkeuring."
                )

            if current:
                cur.execute(
                    """
                    UPDATE commercial_yearset_recovery_inputs
                    SET status = 'superseded'
                    WHERE id = %s AND status = 'approved'
                    """,
                    (_text(current[0]),),
                )
            cur.execute(
                """
                INSERT INTO commercial_yearset_recovery_inputs (
                    id, source_year, target_year, status, lineage_review_hash,
                    base_manifest_hash, decision_hash, payload, approved_by,
                    approved_at, approval_reason
                )
                VALUES (
                    %s, %s, %s, 'approved', %s, %s, %s, %s::jsonb, %s, %s, %s
                )
                """,
                (
                    _text(input_id),
                    int(source_year),
                    int(target_year),
                    _text(lineage_review_hash),
                    _text(base_manifest_hash),
                    _text(decision_hash),
                    json.dumps(payload, ensure_ascii=False, sort_keys=True),
                    _text(actor),
                    now,
                    _text(reason),
                ),
            )
            if current:
                cur.execute(
                    """
                    UPDATE commercial_yearset_recovery_inputs
                    SET superseded_by = %s
                    WHERE id = %s AND status = 'superseded'
                    """,
                    (_text(input_id), _text(current[0])),
                )
        result = get_approved_input(
            source_year=int(source_year),
            target_year=int(target_year),
            connection=conn,
        )
        return {**(result or {}), "created": True}

    if connection is not None:
        return write(connection)
    with postgres_storage.connect() as conn:
        result = write(conn)
        if not postgres_storage.in_transaction():
            conn.commit()
        return result


def list_inputs(*, target_year: int = 0) -> list[dict[str, Any]]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        rows = conn.execute(
            """
            SELECT id, source_year, target_year, status, lineage_review_hash,
                   base_manifest_hash, decision_hash, payload, approved_by,
                   approved_at, approval_reason, superseded_by, created_at
            FROM commercial_yearset_recovery_inputs
            WHERE (%s = 0 OR target_year = %s)
            ORDER BY target_year DESC, approved_at DESC, id
            """,
            (int(target_year), int(target_year)),
        ).fetchall()
    return [value for row in rows if (value := _row_to_dict(row))]
