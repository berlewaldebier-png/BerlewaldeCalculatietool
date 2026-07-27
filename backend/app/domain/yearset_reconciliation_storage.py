from __future__ import annotations

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Iterable
from uuid import uuid4

from app.domain import (
    commercial_yearset_storage,
    cost_authority_storage,
    cost_versions_storage,
    postgres_storage,
    skus_storage,
)


_SCHEMA_LOCK = Lock()
_SCHEMA_READY = False
_AUTHORITY_LOCK_KEY = "calculatietool:yearset-reconciliation:v1"


class YearsetReconciliationConflict(RuntimeError):
    pass


class YearsetReconciliationBlocked(RuntimeError):
    pass


def _text(value: Any) -> str:
    return str(value or "").strip()


def _iso(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else _text(value)


def _json(value: Any, fallback: Any) -> Any:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return fallback
    return value if isinstance(value, type(fallback)) else fallback


def ensure_schema() -> None:
    """Create only additive RF-013C candidate and audit tables."""

    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    with _SCHEMA_LOCK:
        if _SCHEMA_READY:
            return
        postgres_storage.ensure_schema()
        commercial_yearset_storage.ensure_schema()
        cost_authority_storage.ensure_schema()
        skus_storage.ensure_schema()
        cost_versions_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS commercial_yearset_reconciliation_runs (
                        id TEXT PRIMARY KEY,
                        generation_id TEXT NOT NULL UNIQUE
                            REFERENCES commercial_yearsets(id) ON DELETE RESTRICT,
                        source_year INTEGER NOT NULL CHECK (source_year > 0),
                        target_year INTEGER NOT NULL CHECK (target_year > source_year),
                        planner_version TEXT NOT NULL,
                        status TEXT NOT NULL
                            CHECK (status IN ('candidate', 'approved', 'active', 'superseded')),
                        readiness_status TEXT NOT NULL
                            CHECK (readiness_status IN ('ready', 'blocked')),
                        source_snapshot_hash TEXT NOT NULL,
                        target_input_hash TEXT NOT NULL,
                        manifest_hash TEXT NOT NULL,
                        validation_hash TEXT NOT NULL,
                        sku_count INTEGER NOT NULL CHECK (sku_count >= 0),
                        required_cost_count INTEGER NOT NULL CHECK (required_cost_count >= 0),
                        ready_cost_count INTEGER NOT NULL CHECK (ready_cost_count >= 0),
                        price_count INTEGER NOT NULL CHECK (price_count >= 0),
                        ready_price_count INTEGER NOT NULL CHECK (ready_price_count >= 0),
                        blocker_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
                        created_by TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        approved_by TEXT NOT NULL DEFAULT '',
                        approved_at TIMESTAMPTZ NULL,
                        approval_reason TEXT NOT NULL DEFAULT '',
                        activated_by TEXT NOT NULL DEFAULT '',
                        activated_at TIMESTAMPTZ NULL,
                        compatibility_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                        UNIQUE (target_year, manifest_hash)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_yearset_reconciliation_year_status
                    ON commercial_yearset_reconciliation_runs
                        (target_year, status, created_at DESC)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS commercial_yearset_candidate_skus (
                        id TEXT PRIMARY KEY,
                        run_id TEXT NOT NULL
                            REFERENCES commercial_yearset_reconciliation_runs(id)
                            ON DELETE RESTRICT,
                        sku_id TEXT NOT NULL
                            REFERENCES skus(id) ON DELETE RESTRICT,
                        scope_classification TEXT NOT NULL
                            CHECK (scope_classification IN (
                                'carried_forward',
                                'target_operational_addition',
                                'sellable_without_anchor',
                                'catalog_reference_only'
                            )),
                        subject_type TEXT NOT NULL
                            CHECK (subject_type IN ('beer', 'article', 'service', 'bundle')),
                        subject_id TEXT NOT NULL,
                        canonical_beer_id TEXT NULL
                            REFERENCES canonical_beers(id) ON DELETE RESTRICT,
                        format_article_id TEXT NOT NULL DEFAULT '',
                        sku_kind TEXT NOT NULL DEFAULT '',
                        structure_fingerprint TEXT NOT NULL,
                        mapping_fingerprint TEXT NOT NULL,
                        source_anchor_id TEXT NULL
                            REFERENCES planning_cost_anchors(id) ON DELETE RESTRICT,
                        source_cost_version_id TEXT NULL
                            REFERENCES cost_versions(id) ON DELETE RESTRICT,
                        source_cost_row_id TEXT NULL
                            REFERENCES cost_version_sku_rows(id) ON DELETE RESTRICT,
                        reserved_target_version_id TEXT NOT NULL,
                        reserved_target_cost_row_id TEXT NOT NULL,
                        calculation_method TEXT NOT NULL,
                        provenance_kind TEXT NOT NULL,
                        provenance_source_year INTEGER NOT NULL DEFAULT 0,
                        primary_cost NUMERIC(20, 6) NULL,
                        packaging_cost NUMERIC(20, 6) NULL,
                        overhead_cost NUMERIC(20, 6) NULL,
                        excise_cost NUMERIC(20, 6) NULL,
                        cost_price NUMERIC(20, 6) NULL,
                        liters_per_unit NUMERIC(20, 6) NULL,
                        cost_required BOOLEAN NOT NULL,
                        readiness_status TEXT NOT NULL
                            CHECK (readiness_status IN ('ready', 'not_required', 'blocked')),
                        changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
                        blocker_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
                        source_hash TEXT NOT NULL,
                        target_hash TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        UNIQUE (run_id, sku_id),
                        UNIQUE (run_id, reserved_target_version_id),
                        UNIQUE (run_id, reserved_target_cost_row_id)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_yearset_candidate_skus_readiness
                    ON commercial_yearset_candidate_skus
                        (run_id, readiness_status, scope_classification)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS commercial_yearset_candidate_prices (
                        id TEXT PRIMARY KEY,
                        run_id TEXT NOT NULL
                            REFERENCES commercial_yearset_reconciliation_runs(id)
                            ON DELETE RESTRICT,
                        sku_id TEXT NOT NULL
                            REFERENCES skus(id) ON DELETE RESTRICT,
                        source_pricing_id TEXT NOT NULL DEFAULT '',
                        target_pricing_id TEXT NOT NULL DEFAULT '',
                        list_price NUMERIC(20, 6) NULL,
                        readiness_status TEXT NOT NULL
                            CHECK (readiness_status IN ('ready', 'blocked')),
                        blocker_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
                        source_hash TEXT NOT NULL,
                        target_hash TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        UNIQUE (run_id, sku_id)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS commercial_yearset_candidate_channels (
                        id TEXT PRIMARY KEY,
                        run_id TEXT NOT NULL
                            REFERENCES commercial_yearset_reconciliation_runs(id)
                            ON DELETE RESTRICT,
                        channel_code TEXT NOT NULL,
                        advice_markup_pct NUMERIC(20, 6) NULL,
                        readiness_status TEXT NOT NULL
                            CHECK (readiness_status IN ('ready', 'blocked')),
                        blocker_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
                        source_hash TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        UNIQUE (run_id, channel_code)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS commercial_yearset_candidate_plan (
                        id TEXT PRIMARY KEY,
                        run_id TEXT NOT NULL UNIQUE
                            REFERENCES commercial_yearset_reconciliation_runs(id)
                            ON DELETE RESTRICT,
                        source_plan_id TEXT NOT NULL DEFAULT '',
                        plan_contract_hash TEXT NOT NULL,
                        frozen_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
                        initial_forecast JSONB NOT NULL DEFAULT '{}'::jsonb,
                        readiness_status TEXT NOT NULL
                            CHECK (readiness_status IN ('ready', 'blocked')),
                        blocker_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
                        source_hash TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS commercial_yearset_reconciliation_events (
                        id TEXT PRIMARY KEY,
                        event_sequence BIGSERIAL NOT NULL UNIQUE,
                        run_id TEXT NOT NULL
                            REFERENCES commercial_yearset_reconciliation_runs(id)
                            ON DELETE RESTRICT,
                        event_type TEXT NOT NULL
                            CHECK (event_type IN (
                                'candidate_created',
                                'approved',
                                'activated',
                                'superseded',
                                'rollback_activated'
                            )),
                        actor TEXT NOT NULL,
                        reason TEXT NOT NULL DEFAULT '',
                        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_yearset_reconciliation_events_run
                    ON commercial_yearset_reconciliation_events
                        (run_id, event_sequence)
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def _lock(cur: Any) -> None:
    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (_AUTHORITY_LOCK_KEY,))


def _event(
    cur: Any,
    *,
    run_id: str,
    event_type: str,
    actor: str,
    reason: str = "",
    payload: dict[str, Any] | None = None,
) -> None:
    cur.execute(
        """
        INSERT INTO commercial_yearset_reconciliation_events (
            id, run_id, event_type, actor, reason, payload
        )
        VALUES (%s, %s, %s, %s, %s, %s::jsonb)
        """,
        (
            str(uuid4()),
            _text(run_id),
            _text(event_type),
            _text(actor),
            _text(reason),
            json.dumps(payload or {}, ensure_ascii=False, sort_keys=True),
        ),
    )


def create_candidate(
    *,
    plan: dict[str, Any],
    generation: dict[str, Any],
    actor: str,
) -> dict[str, Any]:
    ensure_schema()
    run_id = _text(plan.get("run_id"))
    generation_id = _text(generation.get("id"))
    if not run_id or not generation_id or not _text(actor):
        raise ValueError("Run, generatie en actor zijn verplicht.")
    summary = plan.get("summary") if isinstance(plan.get("summary"), dict) else {}
    ready = bool(plan.get("ready"))
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            _lock(cur)
            cur.execute(
                """
                SELECT id
                FROM commercial_yearset_reconciliation_runs
                WHERE id = %s
                """,
                (run_id,),
            )
            if cur.fetchone():
                return {**(get_run(run_id) or {}), "created": False}
            cur.execute(
                """
                INSERT INTO commercial_yearset_reconciliation_runs (
                    id, generation_id, source_year, target_year, planner_version,
                    status, readiness_status, source_snapshot_hash, target_input_hash,
                    manifest_hash, validation_hash, sku_count, required_cost_count,
                    ready_cost_count, price_count, ready_price_count, blocker_counts,
                    created_by, compatibility_metadata
                )
                VALUES (
                    %s, %s, %s, %s, %s, 'candidate', %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb
                )
                """,
                (
                    run_id,
                    generation_id,
                    int(plan.get("source_year", 0) or 0),
                    int(plan.get("target_year", 0) or 0),
                    _text(plan.get("planner_version")),
                    "ready" if ready else "blocked",
                    _text(plan.get("source_snapshot_hash")),
                    _text(plan.get("target_input_hash")),
                    _text(plan.get("manifest_hash")),
                    _text(plan.get("validation_hash")),
                    int(summary.get("sku_count", 0) or 0),
                    int(summary.get("required_cost_count", 0) or 0),
                    int(summary.get("ready_cost_count", 0) or 0),
                    int(summary.get("price_count", 0) or 0),
                    int(summary.get("ready_price_count", 0) or 0),
                    json.dumps(plan.get("blocker_counts", {}), sort_keys=True),
                    _text(actor),
                    json.dumps(
                        {
                            "consumer_mode": "compatibility_only",
                            "data_rewritten": False,
                            "legacy_target_untouched": True,
                        },
                        sort_keys=True,
                    ),
                ),
            )
            _insert_skus(cur, run_id, plan.get("sku_entries", []))
            _insert_prices(cur, run_id, plan.get("price_entries", []))
            _insert_channels(cur, run_id, plan.get("channel_entries", []))
            _insert_plan(cur, run_id, plan.get("plan_entry", {}))
            _event(
                cur,
                run_id=run_id,
                event_type="candidate_created",
                actor=actor,
                payload={
                    "generation_id": generation_id,
                    "manifest_hash": _text(plan.get("manifest_hash")),
                    "readiness_status": "ready" if ready else "blocked",
                },
            )
        if not postgres_storage.in_transaction():
            conn.commit()
    return {**(get_run(run_id) or {}), "created": True}


def _insert_skus(cur: Any, run_id: str, rows: Iterable[dict[str, Any]]) -> None:
    for row in rows:
        components = row.get("target_components")
        components = components if isinstance(components, dict) else {}
        cur.execute(
            """
            INSERT INTO commercial_yearset_candidate_skus (
                id, run_id, sku_id, scope_classification, subject_type, subject_id,
                canonical_beer_id, format_article_id, sku_kind,
                structure_fingerprint, mapping_fingerprint,
                source_anchor_id, source_cost_version_id, source_cost_row_id,
                reserved_target_version_id, reserved_target_cost_row_id,
                calculation_method, provenance_kind, provenance_source_year,
                primary_cost, packaging_cost, overhead_cost, excise_cost, cost_price,
                liters_per_unit, cost_required, readiness_status,
                changed_fields, blocker_codes, source_hash, target_hash
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, NULLIF(%s, ''), %s, %s, %s, %s,
                NULLIF(%s, ''), NULLIF(%s, ''), NULLIF(%s, ''), %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s
            )
            """,
            (
                _text(row.get("id")),
                run_id,
                _text(row.get("sku_id")),
                _text(row.get("scope_classification")),
                _text(row.get("subject_type")),
                _text(row.get("subject_id")),
                _text(row.get("canonical_beer_id")),
                _text(row.get("format_article_id")),
                _text(row.get("sku_kind")),
                _text(row.get("structure_fingerprint")),
                _text(row.get("mapping_fingerprint")),
                _text(row.get("source_anchor_id")),
                _text(row.get("source_cost_version_id")),
                _text(row.get("source_cost_row_id")),
                _text(row.get("reserved_target_version_id")),
                _text(row.get("reserved_target_cost_row_id")),
                _text(row.get("calculation_method")),
                _text(row.get("provenance_kind")),
                int(row.get("provenance_source_year", 0) or 0),
                components.get("primary"),
                components.get("packaging"),
                components.get("overhead"),
                components.get("excise"),
                components.get("cost_price"),
                row.get("liters_per_unit"),
                bool(row.get("cost_required")),
                _text(row.get("readiness_status")),
                json.dumps(row.get("changed_fields", []), sort_keys=True),
                json.dumps(row.get("blocker_codes", []), sort_keys=True),
                _text(row.get("source_hash")),
                _text(row.get("target_hash")),
            ),
        )


def _insert_prices(cur: Any, run_id: str, rows: Iterable[dict[str, Any]]) -> None:
    for row in rows:
        cur.execute(
            """
            INSERT INTO commercial_yearset_candidate_prices (
                id, run_id, sku_id, source_pricing_id, target_pricing_id,
                list_price, readiness_status, blocker_codes, source_hash, target_hash
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
            """,
            (
                _text(row.get("id")),
                run_id,
                _text(row.get("sku_id")),
                _text(row.get("source_pricing_id")),
                _text(row.get("target_pricing_id")),
                row.get("list_price"),
                _text(row.get("readiness_status")),
                json.dumps(row.get("blocker_codes", []), sort_keys=True),
                _text(row.get("source_hash")),
                _text(row.get("target_hash")),
            ),
        )


def _insert_channels(cur: Any, run_id: str, rows: Iterable[dict[str, Any]]) -> None:
    for row in rows:
        cur.execute(
            """
            INSERT INTO commercial_yearset_candidate_channels (
                id, run_id, channel_code, advice_markup_pct,
                readiness_status, blocker_codes, source_hash
            )
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)
            """,
            (
                _text(row.get("id")),
                run_id,
                _text(row.get("channel_code")),
                row.get("advice_markup_pct"),
                _text(row.get("readiness_status")),
                json.dumps(row.get("blocker_codes", []), sort_keys=True),
                _text(row.get("source_hash")),
            ),
        )


def _insert_plan(cur: Any, run_id: str, row: dict[str, Any]) -> None:
    cur.execute(
        """
        INSERT INTO commercial_yearset_candidate_plan (
            id, run_id, source_plan_id, plan_contract_hash, frozen_plan,
            initial_forecast, readiness_status, blocker_codes, source_hash
        )
        VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s::jsonb, %s)
        """,
        (
            _text(row.get("id")),
            run_id,
            _text(row.get("source_plan_id")),
            _text(row.get("plan_contract_hash")),
            json.dumps(row.get("frozen_plan", {}), ensure_ascii=False, sort_keys=True),
            json.dumps(
                row.get("initial_forecast", {}),
                ensure_ascii=False,
                sort_keys=True,
            ),
            _text(row.get("readiness_status")),
            json.dumps(row.get("blocker_codes", []), sort_keys=True),
            _text(row.get("source_hash")),
        ),
    )


def get_run(run_id: str) -> dict[str, Any] | None:
    ensure_schema()
    with postgres_storage.connect() as conn:
        row = conn.execute(
            """
            SELECT id, generation_id, source_year, target_year, planner_version,
                   status, readiness_status, source_snapshot_hash, target_input_hash,
                   manifest_hash, validation_hash, sku_count, required_cost_count,
                   ready_cost_count, price_count, ready_price_count, blocker_counts,
                   created_by, created_at, approved_by, approved_at, approval_reason,
                   activated_by, activated_at, compatibility_metadata
            FROM commercial_yearset_reconciliation_runs
            WHERE id = %s
            """,
            (_text(run_id),),
        ).fetchone()
    if not row:
        return None
    return {
        "id": _text(row[0]),
        "generation_id": _text(row[1]),
        "source_year": int(row[2] or 0),
        "target_year": int(row[3] or 0),
        "planner_version": _text(row[4]),
        "status": _text(row[5]),
        "readiness_status": _text(row[6]),
        "source_snapshot_hash": _text(row[7]),
        "target_input_hash": _text(row[8]),
        "manifest_hash": _text(row[9]),
        "validation_hash": _text(row[10]),
        "summary": {
            "sku_count": int(row[11] or 0),
            "required_cost_count": int(row[12] or 0),
            "ready_cost_count": int(row[13] or 0),
            "price_count": int(row[14] or 0),
            "ready_price_count": int(row[15] or 0),
        },
        "blocker_counts": _json(row[16], {}),
        "created_by": _text(row[17]),
        "created_at": _iso(row[18]),
        "approved_by": _text(row[19]),
        "approved_at": _iso(row[20]),
        "approval_reason": _text(row[21]),
        "activated_by": _text(row[22]),
        "activated_at": _iso(row[23]),
        "compatibility": _json(row[24], {}),
    }


def get_run_by_generation(generation_id: str) -> dict[str, Any] | None:
    ensure_schema()
    with postgres_storage.connect() as conn:
        row = conn.execute(
            "SELECT id FROM commercial_yearset_reconciliation_runs WHERE generation_id = %s",
            (_text(generation_id),),
        ).fetchone()
    return get_run(_text(row[0])) if row else None


def has_run_for_year(target_year: int) -> bool:
    ensure_schema()
    with postgres_storage.connect() as conn:
        row = conn.execute(
            """
            SELECT EXISTS(
                SELECT 1 FROM commercial_yearset_reconciliation_runs
                WHERE target_year = %s
            )
            """,
            (int(target_year),),
        ).fetchone()
    return bool(row and row[0])


def list_runs(*, target_year: int = 0) -> list[dict[str, Any]]:
    ensure_schema()
    where = "WHERE target_year = %s" if int(target_year or 0) > 0 else ""
    params: tuple[Any, ...] = (int(target_year),) if where else ()
    with postgres_storage.connect() as conn:
        ids = [
            _text(row[0])
            for row in conn.execute(
                f"""
                SELECT id
                FROM commercial_yearset_reconciliation_runs
                {where}
                ORDER BY target_year, created_at, id
                """,
                params,
            ).fetchall()
        ]
    return [run for run_id in ids if (run := get_run(run_id))]


def approve(
    run_id: str,
    *,
    expected_manifest_hash: str,
    actor: str,
    actor_role: str,
    reason: str,
) -> dict[str, Any]:
    if _text(actor_role) != "management":
        raise PermissionError("Alleen Management mag een jaarsetkandidaat goedkeuren.")
    if not _text(reason):
        raise ValueError("Een goedkeuringsreden is verplicht.")
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            _lock(cur)
            cur.execute(
                """
                SELECT status, readiness_status, manifest_hash
                FROM commercial_yearset_reconciliation_runs
                WHERE id = %s
                FOR UPDATE
                """,
                (_text(run_id),),
            )
            row = cur.fetchone()
            if not row:
                raise YearsetReconciliationBlocked("Reconciliatiekandidaat bestaat niet.")
            if _text(row[0]) != "candidate":
                raise YearsetReconciliationConflict("Kandidaat is niet meer goedkeuringsklaar.")
            if _text(row[1]) != "ready":
                raise YearsetReconciliationBlocked(
                    "Kandidaat is geblokkeerd en kan niet worden goedgekeurd."
                )
            if _text(row[2]) != _text(expected_manifest_hash):
                raise YearsetReconciliationConflict("De manifesthash is gewijzigd.")
            cur.execute(
                """
                UPDATE commercial_yearset_reconciliation_runs
                SET status = 'approved', approved_by = %s, approved_at = NOW(),
                    approval_reason = %s
                WHERE id = %s
                """,
                (_text(actor), _text(reason), _text(run_id)),
            )
            _event(
                cur,
                run_id=run_id,
                event_type="approved",
                actor=actor,
                reason=reason,
                payload={"manifest_hash": _text(expected_manifest_hash)},
            )
        if not postgres_storage.in_transaction():
            conn.commit()
    return get_run(run_id) or {}


def mark_activated(
    run_id: str,
    *,
    actor: str,
    previous_generation_id: str,
    action: str,
) -> dict[str, Any]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            _lock(cur)
            cur.execute(
                """
                SELECT status
                FROM commercial_yearset_reconciliation_runs
                WHERE id = %s
                FOR UPDATE
                """,
                (_text(run_id),),
            )
            row = cur.fetchone()
            if not row or _text(row[0]) not in {"approved", "superseded"}:
                raise YearsetReconciliationConflict(
                    "Reconciliatiekandidaat is niet goedgekeurd of terugrolbaar."
                )
            if _text(previous_generation_id):
                cur.execute(
                    """
                    UPDATE commercial_yearset_reconciliation_runs
                    SET status = 'superseded'
                    WHERE generation_id = %s AND status = 'active'
                    """,
                    (_text(previous_generation_id),),
                )
                if int(cur.rowcount or 0):
                    previous = get_run_by_generation(previous_generation_id)
                    if previous:
                        _event(
                            cur,
                            run_id=_text(previous.get("id")),
                            event_type="superseded",
                            actor=actor,
                            payload={"superseded_by_run_id": _text(run_id)},
                        )
            cur.execute(
                """
                UPDATE commercial_yearset_reconciliation_runs
                SET status = 'active', activated_by = %s, activated_at = NOW()
                WHERE id = %s
                """,
                (_text(actor), _text(run_id)),
            )
            _event(
                cur,
                run_id=run_id,
                event_type="rollback_activated" if action == "rollback" else "activated",
                actor=actor,
                payload={"previous_generation_id": _text(previous_generation_id)},
            )
        if not postgres_storage.in_transaction():
            conn.commit()
    return get_run(run_id) or {}


def aggregate_overview(*, target_year: int = 0) -> dict[str, Any]:
    ensure_schema()
    where = "WHERE target_year = %s" if int(target_year or 0) > 0 else ""
    params: tuple[Any, ...] = (int(target_year),) if where else ()
    with postgres_storage.connect() as conn:
        status_rows = conn.execute(
            f"""
            SELECT status, readiness_status, COUNT(*)::int
            FROM commercial_yearset_reconciliation_runs
            {where}
            GROUP BY status, readiness_status
            ORDER BY status, readiness_status
            """,
            params,
        ).fetchall()
        blocker_rows = conn.execute(
            f"""
            SELECT key, SUM(value::int)::int
            FROM commercial_yearset_reconciliation_runs r,
                 LATERAL jsonb_each_text(r.blocker_counts)
            {where}
            GROUP BY key
            ORDER BY key
            """,
            params,
        ).fetchall()
    return {
        "version": "rf-013c-v1",
        "consumer_mode": "compatibility_only",
        "statuses": [
            {
                "status": _text(row[0]),
                "readiness_status": _text(row[1]),
                "count": int(row[2] or 0),
            }
            for row in status_rows
        ],
        "blocker_counts": {_text(row[0]): int(row[1] or 0) for row in blocker_rows},
    }
