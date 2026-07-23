from __future__ import annotations

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

from app.domain import postgres_storage


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()
_AUTHORITY_LOCK_KEY = "calculatietool:commercial-yearset-authority:v1"
_GENERATION_COLUMNS = """
    id, operational_year, revision, status, readiness_status,
    source_year, source_generation_id,
    cost_source_year, pricing_source_year, advice_source_year,
    break_even_plan_id, forecast_snapshot_id, year_close_snapshot_id,
    idempotency_key, validation_hash, validation_payload,
    compatibility_metadata, created_at, updated_at,
    activated_at, activated_by, superseded_at, failed_at, failure_reason
"""


class CommercialYearsetConflict(RuntimeError):
    """Raised when a compare-and-swap or validation precondition changed."""


class CommercialYearsetBlocked(RuntimeError):
    """Raised when a generation cannot be activated without guessing."""


def _text(value: Any) -> str:
    return str(value or "").strip()


def _iso(value: Any) -> str:
    return _text(value.isoformat() if hasattr(value, "isoformat") else value)


def _json(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _generation(row: Any) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": _text(row[0]),
        "operational_year": int(row[1] or 0),
        "revision": int(row[2] or 0),
        "status": _text(row[3]),
        "readiness_status": _text(row[4]),
        "source_year": int(row[5] or 0),
        "source_generation_id": _text(row[6]),
        "cost_source_year": int(row[7] or 0),
        "pricing_source_year": int(row[8] or 0),
        "advice_source_year": int(row[9] or 0),
        "break_even_plan_id": _text(row[10]),
        "forecast_snapshot_id": _text(row[11]),
        "year_close_snapshot_id": _text(row[12]),
        "idempotency_key": _text(row[13]),
        "validation_hash": _text(row[14]),
        "validation": _json(row[15]),
        "compatibility": _json(row[16]),
        "created_at": _iso(row[17]),
        "updated_at": _iso(row[18]),
        "activated_at": _iso(row[19]),
        "activated_by": _text(row[20]),
        "superseded_at": _iso(row[21]),
        "failed_at": _iso(row[22]),
        "failure_reason": _text(row[23]),
    }


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
                    CREATE TABLE IF NOT EXISTS commercial_yearsets (
                        id TEXT PRIMARY KEY,
                        operational_year INTEGER NOT NULL CHECK (operational_year > 0),
                        revision INTEGER NOT NULL CHECK (revision > 0),
                        status TEXT NOT NULL
                            CHECK (status IN ('candidate', 'active', 'superseded', 'failed')),
                        readiness_status TEXT NOT NULL
                            CHECK (readiness_status IN ('ready', 'blocked')),
                        source_year INTEGER NOT NULL DEFAULT 0 CHECK (source_year >= 0),
                        source_generation_id TEXT NULL
                            REFERENCES commercial_yearsets(id) ON DELETE RESTRICT,
                        cost_source_year INTEGER NOT NULL DEFAULT 0,
                        pricing_source_year INTEGER NOT NULL DEFAULT 0,
                        advice_source_year INTEGER NOT NULL DEFAULT 0,
                        break_even_plan_id TEXT NOT NULL DEFAULT '',
                        forecast_snapshot_id TEXT NOT NULL DEFAULT '',
                        year_close_snapshot_id TEXT NOT NULL DEFAULT '',
                        idempotency_key TEXT NOT NULL UNIQUE,
                        validation_hash TEXT NOT NULL,
                        validation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        compatibility_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        activated_at TIMESTAMPTZ NULL,
                        activated_by TEXT NOT NULL DEFAULT '',
                        superseded_at TIMESTAMPTZ NULL,
                        failed_at TIMESTAMPTZ NULL,
                        failure_reason TEXT NOT NULL DEFAULT '',
                        UNIQUE (operational_year, revision)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS ux_commercial_yearsets_single_active
                    ON commercial_yearsets (status)
                    WHERE status = 'active'
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_commercial_yearsets_year_status
                    ON commercial_yearsets (operational_year, status, revision DESC)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS commercial_yearset_events (
                        id TEXT PRIMARY KEY,
                        event_sequence BIGSERIAL NOT NULL UNIQUE,
                        generation_id TEXT NOT NULL
                            REFERENCES commercial_yearsets(id) ON DELETE RESTRICT,
                        event_type TEXT NOT NULL,
                        actor TEXT NOT NULL DEFAULT '',
                        reason TEXT NOT NULL DEFAULT '',
                        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE commercial_yearset_events
                    ADD COLUMN IF NOT EXISTS event_sequence BIGSERIAL
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS
                        ux_commercial_yearset_events_sequence
                    ON commercial_yearset_events (event_sequence)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_commercial_yearset_events_generation
                    ON commercial_yearset_events (generation_id, occurred_at, id)
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def _authority_lock(cur: Any) -> None:
    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (_AUTHORITY_LOCK_KEY,))


def _append_event(
    cur: Any,
    *,
    generation_id: str,
    event_type: str,
    actor: str,
    reason: str = "",
    payload: dict[str, Any] | None = None,
) -> None:
    cur.execute(
        """
        INSERT INTO commercial_yearset_events (
            id, generation_id, event_type, actor, reason, payload
        )
        VALUES (%s, %s, %s, %s, %s, %s::jsonb)
        """,
        (
            str(uuid4()),
            _text(generation_id),
            _text(event_type),
            _text(actor),
            _text(reason),
            json.dumps(payload or {}, ensure_ascii=False, sort_keys=True),
        ),
    )


def list_generations(*, operational_year: int = 0) -> list[dict[str, Any]]:
    ensure_schema()
    where = ""
    params: tuple[Any, ...] = ()
    if int(operational_year or 0) > 0:
        where = "WHERE operational_year = %s"
        params = (int(operational_year),)
    with postgres_storage.connect() as conn:
        rows = conn.execute(
            f"""
            SELECT {_GENERATION_COLUMNS}
            FROM commercial_yearsets
            {where}
            ORDER BY operational_year DESC, revision DESC, created_at DESC
            """,
            params,
        ).fetchall()
    return [item for row in rows if (item := _generation(row)) is not None]


def get_generation(generation_id: str, *, for_update: bool = False) -> dict[str, Any] | None:
    ensure_schema()
    clean_id = _text(generation_id)
    if not clean_id:
        return None
    suffix = " FOR UPDATE" if for_update else ""
    with postgres_storage.connect() as conn:
        row = conn.execute(
            f"""
            SELECT {_GENERATION_COLUMNS}
            FROM commercial_yearsets
            WHERE id = %s{suffix}
            """,
            (clean_id,),
        ).fetchone()
    return _generation(row)


def get_active_generation(*, for_update: bool = False) -> dict[str, Any] | None:
    ensure_schema()
    suffix = " FOR UPDATE" if for_update else ""
    with postgres_storage.connect() as conn:
        row = conn.execute(
            f"""
            SELECT {_GENERATION_COLUMNS}
            FROM commercial_yearsets
            WHERE status = 'active'{suffix}
            """
        ).fetchone()
    return _generation(row)


def create_candidate(
    *,
    operational_year: int,
    source_year: int,
    source_generation_id: str = "",
    validation: dict[str, Any],
    validation_hash: str,
    actor: str,
    idempotency_key: str,
    break_even_plan_id: str = "",
    forecast_snapshot_id: str = "",
    year_close_snapshot_id: str = "",
    compatibility: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_schema()
    year_value = int(operational_year or 0)
    source_value = int(source_year or 0)
    clean_key = _text(idempotency_key)
    clean_hash = _text(validation_hash)
    clean_actor = _text(actor)
    if (
        year_value <= 0
        or source_value < 0
        or not clean_key
        or not clean_hash
        or not clean_actor
    ):
        raise ValueError(
            "Jaar, actor, idempotency key en validation hash zijn verplicht."
        )
    ready = bool(validation.get("ready", False))
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            _authority_lock(cur)
            cur.execute(
                f"""
                SELECT {_GENERATION_COLUMNS}
                FROM commercial_yearsets
                WHERE idempotency_key = %s
                FOR UPDATE
                """,
                (clean_key,),
            )
            existing = _generation(cur.fetchone())
            if existing:
                return {**existing, "created": False}
            cur.execute(
                """
                SELECT COALESCE(MAX(revision), 0)::int
                FROM commercial_yearsets
                WHERE operational_year = %s
                """,
                (year_value,),
            )
            revision = int((cur.fetchone() or (0,))[0] or 0) + 1
            generation_id = str(
                uuid5(NAMESPACE_URL, f"commercial-yearset:{clean_key}")
            )
            cur.execute(
                """
                INSERT INTO commercial_yearsets (
                    id, operational_year, revision, status, readiness_status,
                    source_year, source_generation_id,
                    cost_source_year, pricing_source_year, advice_source_year,
                    break_even_plan_id, forecast_snapshot_id, year_close_snapshot_id,
                    idempotency_key, validation_hash, validation_payload,
                    compatibility_metadata
                )
                VALUES (
                    %s, %s, %s, 'candidate', %s,
                    %s, NULLIF(%s, ''),
                    %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s::jsonb, %s::jsonb
                )
                """,
                (
                    generation_id,
                    year_value,
                    revision,
                    "ready" if ready else "blocked",
                    source_value,
                    _text(source_generation_id),
                    year_value,
                    year_value,
                    year_value,
                    _text(break_even_plan_id),
                    _text(forecast_snapshot_id),
                    _text(year_close_snapshot_id),
                    clean_key,
                    clean_hash,
                    json.dumps(validation, ensure_ascii=False, sort_keys=True),
                    json.dumps(compatibility or {}, ensure_ascii=False, sort_keys=True),
                ),
            )
            _append_event(
                cur,
                generation_id=generation_id,
                event_type="candidate_created",
                actor=clean_actor,
                payload={
                    "operational_year": year_value,
                    "revision": revision,
                    "readiness_status": "ready" if ready else "blocked",
                    "validation_hash": clean_hash,
                },
            )
            cur.execute(
                f"""
                SELECT {_GENERATION_COLUMNS}
                FROM commercial_yearsets
                WHERE id = %s
                """,
                (generation_id,),
            )
            created = _generation(cur.fetchone())
        if not postgres_storage.in_transaction():
            conn.commit()
    if not created:
        raise RuntimeError("Commerciële jaarsetkandidaat kon niet worden opgeslagen.")
    return {**created, "created": True}


def activate_generation(
    *,
    generation_id: str,
    actor: str,
    expected_validation_hash: str,
    expected_active_generation_id: str | None,
    reason: str = "",
    action: str = "activate",
) -> dict[str, Any]:
    ensure_schema()
    clean_id = _text(generation_id)
    clean_hash = _text(expected_validation_hash)
    clean_actor = _text(actor)
    if not clean_id or not clean_hash or not clean_actor:
        raise ValueError("Generation id, actor en validation hash zijn verplicht.")
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            _authority_lock(cur)
            cur.execute(
                f"""
                SELECT {_GENERATION_COLUMNS}
                FROM commercial_yearsets
                WHERE id = %s
                FOR UPDATE
                """,
                (clean_id,),
            )
            target = _generation(cur.fetchone())
            if not target:
                raise ValueError("Commerciële jaarset niet gevonden.")
            cur.execute(
                f"""
                SELECT {_GENERATION_COLUMNS}
                FROM commercial_yearsets
                WHERE status = 'active'
                FOR UPDATE
                """
            )
            current = _generation(cur.fetchone())
            current_id = _text((current or {}).get("id"))
            if current_id == clean_id:
                return target
            if current_id != _text(expected_active_generation_id):
                raise CommercialYearsetConflict(
                    "De actieve commerciële jaarset is gewijzigd; herlaad en probeer opnieuw."
                )
            if target["status"] not in {"candidate", "superseded"}:
                raise CommercialYearsetBlocked(
                    f"Jaarsetstatus '{target['status']}' kan niet worden geactiveerd."
                )
            if target["readiness_status"] != "ready":
                raise CommercialYearsetBlocked(
                    "De commerciële jaarset is geblokkeerd door onvolledige validatie."
                )
            if target["validation_hash"] != clean_hash:
                raise CommercialYearsetConflict(
                    "De validatiehash is gewijzigd; voer de gereedheidscontrole opnieuw uit."
                )
            now = datetime.now(UTC)
            if current:
                cur.execute(
                    """
                    UPDATE commercial_yearsets
                    SET status = 'superseded', superseded_at = %s, updated_at = %s
                    WHERE id = %s
                    """,
                    (now, now, current_id),
                )
                _append_event(
                    cur,
                    generation_id=current_id,
                    event_type="superseded",
                    actor=clean_actor,
                    reason=reason,
                    payload={"superseded_by": clean_id},
                )
            cur.execute(
                """
                UPDATE commercial_yearsets
                SET status = 'active',
                    activated_at = %s,
                    activated_by = %s,
                    superseded_at = NULL,
                    failed_at = NULL,
                    failure_reason = '',
                    updated_at = %s
                WHERE id = %s
                """,
                (now, clean_actor, now, clean_id),
            )
            _append_event(
                cur,
                generation_id=clean_id,
                event_type="rollback_activated" if action == "rollback" else "activated",
                actor=clean_actor,
                reason=reason,
                payload={
                    "previous_active_generation_id": current_id,
                    "validation_hash": clean_hash,
                },
            )
            cur.execute(
                f"""
                SELECT {_GENERATION_COLUMNS}
                FROM commercial_yearsets
                WHERE id = %s
                """,
                (clean_id,),
            )
            activated = _generation(cur.fetchone())
        if not postgres_storage.in_transaction():
            conn.commit()
    if not activated:
        raise RuntimeError("Commerciële jaarsetactivatie leverde geen record op.")
    return activated


def list_events(*, generation_id: str = "") -> list[dict[str, Any]]:
    ensure_schema()
    where = ""
    params: tuple[Any, ...] = ()
    if _text(generation_id):
        where = "WHERE generation_id = %s"
        params = (_text(generation_id),)
    with postgres_storage.connect() as conn:
        rows = conn.execute(
            f"""
            SELECT
                id, event_sequence, generation_id, event_type,
                actor, reason, occurred_at, payload
            FROM commercial_yearset_events
            {where}
            ORDER BY event_sequence
            """,
            params,
        ).fetchall()
    return [
        {
            "id": _text(row[0]),
            "sequence": int(row[1] or 0),
            "generation_id": _text(row[2]),
            "event_type": _text(row[3]),
            "actor": _text(row[4]),
            "reason": _text(row[5]),
            "occurred_at": _iso(row[6]),
            "payload": _json(row[7]),
        }
        for row in rows
    ]


def audit_authority() -> dict[str, Any]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        active_count = int(
            conn.execute(
                "SELECT COUNT(*)::int FROM commercial_yearsets WHERE status = 'active'"
            ).fetchone()[0]
            or 0
        )
        orphan_source_count = int(
            conn.execute(
                """
                SELECT COUNT(*)::int
                FROM commercial_yearsets child
                LEFT JOIN commercial_yearsets parent ON parent.id = child.source_generation_id
                WHERE child.source_generation_id IS NOT NULL AND parent.id IS NULL
                """
            ).fetchone()[0]
            or 0
        )
    return {
        "active_count": active_count,
        "single_active_invariant": active_count <= 1,
        "orphan_source_generation_count": orphan_source_count,
    }
