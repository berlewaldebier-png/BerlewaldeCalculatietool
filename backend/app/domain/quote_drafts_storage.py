from __future__ import annotations

import json
from datetime import UTC, date, datetime
from threading import Lock
from typing import Any
from uuid import uuid4

from app.domain import postgres_storage


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()

ALLOWED_STATUSES = {"concept", "definitief"}


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
                cur.execute("DROP TABLE IF EXISTS price_quote_variant_staffels CASCADE")
                cur.execute("DROP TABLE IF EXISTS price_quote_variant_lines CASCADE")
                cur.execute("DROP TABLE IF EXISTS price_quote_variant_periods CASCADE")
                cur.execute("DROP TABLE IF EXISTS price_quote_variants CASCADE")
                cur.execute("DROP TABLE IF EXISTS price_quote_staffels CASCADE")
                cur.execute("DROP TABLE IF EXISTS price_quote_lines CASCADE")
                cur.execute("DROP TABLE IF EXISTS price_quotes CASCADE")
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS quote_drafts (
                        id TEXT PRIMARY KEY,
                        quote_number TEXT NOT NULL UNIQUE,
                        quote_number_seq INTEGER NOT NULL,
                        schema_version INTEGER NOT NULL,
                        draft_version INTEGER NOT NULL,
                        status TEXT NOT NULL,
                        year INTEGER NOT NULL,
                        customer_name TEXT NOT NULL DEFAULT '',
                        contact_name TEXT NOT NULL DEFAULT '',
                        channel_code TEXT NOT NULL DEFAULT '',
                        title TEXT NOT NULL DEFAULT '',
                        valid_until DATE NULL,
                        active_scenario_id TEXT NOT NULL DEFAULT 'A',
                        created_at TIMESTAMPTZ NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL,
                        finalized_at TIMESTAMPTZ NULL,
                        payload JSONB NOT NULL
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS ix_quote_drafts_year_number_seq
                    ON quote_drafts (year, quote_number_seq)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_quote_drafts_status
                    ON quote_drafts (status)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_quote_drafts_updated_at
                    ON quote_drafts (updated_at DESC)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_quote_drafts_valid_until
                    ON quote_drafts (valid_until)
                    """
                )
                cur.execute(
                    """
                    DELETE FROM app_datasets
                    WHERE dataset_name IN ('prijsvoorstellen', 'quotes', 'quote-lines', 'quote-staffels')
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()

        _SCHEMA_READY = True


def _parse_payload(payload: Any) -> dict[str, Any]:
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, dict):
        raise ValueError("Ongeldig offerte-payload: verwacht object.")
    if str(payload.get("kind", "") or "") != "offerte-draft":
        raise ValueError("Ongeldig offerte-payload: kind moet 'offerte-draft' zijn.")
    draft = payload.get("draft")
    if not isinstance(draft, dict):
        raise ValueError("Ongeldig offerte-payload: draft ontbreekt.")
    basis = draft.get("basis")
    scenarios = draft.get("scenarios")
    ui = draft.get("ui")
    if not isinstance(basis, dict):
        raise ValueError("Ongeldig offerte-payload: basis ontbreekt.")
    if not isinstance(scenarios, dict):
        raise ValueError("Ongeldig offerte-payload: scenarios ontbreekt.")
    if not isinstance(ui, dict):
        raise ValueError("Ongeldig offerte-payload: ui ontbreekt.")
    return payload


def _parse_date(value: Any) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    return date.fromisoformat(text)


def _normalize_status(value: Any) -> str:
    status = str(value or "concept").strip().lower() or "concept"
    if status not in ALLOWED_STATUSES:
        raise ValueError(f"Ongeldige offerte-status: {status}")
    return status


def _generate_quote_number(*, year: int, seq: int) -> str:
    return f"OFF-{year}-{int(seq):04d}"


def _next_quote_number_seq(cur: Any, *, year: int) -> int:
    cur.execute(
        """
        SELECT COALESCE(MAX(quote_number_seq), 0)::int + 1
        FROM quote_drafts
        WHERE year = %s
        """,
        (int(year),),
    )
    row = cur.fetchone()
    return int((row[0] if row else 1) or 1)


def _row_to_record(row: Any) -> dict[str, Any]:
    if not row:
        raise ValueError("Offerte-record ontbreekt.")
    (
        draft_id,
        quote_number,
        quote_number_seq,
        schema_version,
        draft_version,
        status,
        year,
        customer_name,
        contact_name,
        channel_code,
        title,
        valid_until,
        active_scenario_id,
        created_at,
        updated_at,
        finalized_at,
        payload,
    ) = row

    if isinstance(payload, str):
        payload = json.loads(payload)

    return {
        "id": str(draft_id),
        "quote_number": str(quote_number or ""),
        "quote_number_seq": int(quote_number_seq or 0),
        "schema_version": int(schema_version or 1),
        "draft_version": int(draft_version or 1),
        "status": str(status or "concept"),
        "year": int(year or 0),
        "customer_name": str(customer_name or ""),
        "contact_name": str(contact_name or ""),
        "channel_code": str(channel_code or ""),
        "title": str(title or ""),
        "valid_until": valid_until.isoformat() if valid_until else None,
        "active_scenario_id": str(active_scenario_id or "A"),
        "created_at": created_at.isoformat() if created_at else None,
        "updated_at": updated_at.isoformat() if updated_at else None,
        "finalized_at": finalized_at.isoformat() if finalized_at else None,
        "payload": payload,
    }


def _build_persisted_payload(
    raw_payload: dict[str, Any],
    *,
    draft_id: str,
    status: str,
    draft_version: int,
    created_at: datetime,
    updated_at: datetime,
) -> dict[str, Any]:
    payload = json.loads(json.dumps(raw_payload))
    draft = dict(payload.get("draft") or {})
    meta = dict(draft.get("meta") or {})
    meta.update(
        {
            "draftId": draft_id,
            "status": status,
            "version": int(draft_version),
            "createdAt": created_at.isoformat(),
            "updatedAt": updated_at.isoformat(),
        }
    )
    draft["meta"] = meta
    payload["draft"] = draft
    payload["savedAt"] = updated_at.isoformat()
    return payload


def list_drafts(*, status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    ensure_schema()
    params: list[Any] = []
    where = ""
    if status:
        normalized = _normalize_status(status)
        where = "WHERE status = %s"
        params.append(normalized)
    params.append(max(1, int(limit)))

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    id,
                    quote_number,
                    quote_number_seq,
                    schema_version,
                    draft_version,
                    status,
                    year,
                    customer_name,
                    contact_name,
                    channel_code,
                    title,
                    valid_until,
                    active_scenario_id,
                    created_at,
                    updated_at,
                    finalized_at,
                    payload
                FROM quote_drafts
                {where}
                ORDER BY updated_at DESC, id DESC
                LIMIT %s
                """,
                tuple(params),
            )
            rows = cur.fetchall()
    return [_row_to_record(row) for row in rows]


def get_draft(draft_id: str) -> dict[str, Any] | None:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    quote_number,
                    quote_number_seq,
                    schema_version,
                    draft_version,
                    status,
                    year,
                    customer_name,
                    contact_name,
                    channel_code,
                    title,
                    valid_until,
                    active_scenario_id,
                    created_at,
                    updated_at,
                    finalized_at,
                    payload
                FROM quote_drafts
                WHERE id = %s
                """,
                (str(draft_id),),
            )
            row = cur.fetchone()
    return _row_to_record(row) if row else None


def save_draft(payload: dict[str, Any], *, draft_id: str | None = None) -> dict[str, Any]:
    ensure_schema()
    parsed = _parse_payload(payload)
    draft = parsed["draft"]
    basis = dict(draft.get("basis") or {})
    ui = dict(draft.get("ui") or {})
    meta = dict(draft.get("meta") or {})

    year = int(draft.get("year", 0) or 0)
    if year <= 0:
        raise ValueError("Ongeldige offerte-payload: jaar ontbreekt.")

    status = _normalize_status(meta.get("status", "concept"))
    now = datetime.now(UTC)
    resolved_id = str(draft_id or meta.get("draftId") or f"quote-{uuid4().hex}")

    customer_name = str(basis.get("klantNaam", "") or "")
    contact_name = str(basis.get("contactpersoon", "") or "")
    channel_code = str(basis.get("kanaal", "") or "")
    title = str(basis.get("offerteNaam", "") or "")
    valid_until = _parse_date(basis.get("geldigTot"))
    active_scenario_id = str(ui.get("activeScenario", "A") or "A")
    schema_version = int(parsed.get("schemaVersion", 1) or 1)

    with postgres_storage.transaction():
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        quote_number,
                        quote_number_seq,
                        created_at,
                        finalized_at,
                        draft_version
                    FROM quote_drafts
                    WHERE id = %s
                    FOR UPDATE
                    """,
                    (resolved_id,),
                )
                existing = cur.fetchone()

                if existing:
                    quote_number = str(existing[0] or "")
                    quote_number_seq = int(existing[1] or 0)
                    created_at = existing[2] or now
                    finalized_at = existing[3]
                    draft_version = int(existing[4] or 1) + 1
                else:
                    if draft_id:
                        raise ValueError("Offerte niet gevonden.")
                    quote_number_seq = _next_quote_number_seq(cur, year=year)
                    quote_number = _generate_quote_number(year=year, seq=quote_number_seq)
                    created_at = now
                    finalized_at = None
                    draft_version = 1

                if status == "definitief" and finalized_at is None:
                    finalized_at = now
                if status != "definitief":
                    finalized_at = None

                persisted_payload = _build_persisted_payload(
                    parsed,
                    draft_id=resolved_id,
                    status=status,
                    draft_version=draft_version,
                    created_at=created_at,
                    updated_at=now,
                )

                cur.execute(
                    """
                    INSERT INTO quote_drafts (
                        id,
                        quote_number,
                        quote_number_seq,
                        schema_version,
                        draft_version,
                        status,
                        year,
                        customer_name,
                        contact_name,
                        channel_code,
                        title,
                        valid_until,
                        active_scenario_id,
                        created_at,
                        updated_at,
                        finalized_at,
                        payload
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                    )
                    ON CONFLICT (id)
                    DO UPDATE SET
                        schema_version = EXCLUDED.schema_version,
                        draft_version = EXCLUDED.draft_version,
                        status = EXCLUDED.status,
                        year = EXCLUDED.year,
                        customer_name = EXCLUDED.customer_name,
                        contact_name = EXCLUDED.contact_name,
                        channel_code = EXCLUDED.channel_code,
                        title = EXCLUDED.title,
                        valid_until = EXCLUDED.valid_until,
                        active_scenario_id = EXCLUDED.active_scenario_id,
                        updated_at = EXCLUDED.updated_at,
                        finalized_at = EXCLUDED.finalized_at,
                        payload = EXCLUDED.payload
                    """,
                    (
                        resolved_id,
                        quote_number,
                        quote_number_seq,
                        schema_version,
                        draft_version,
                        status,
                        year,
                        customer_name,
                        contact_name,
                        channel_code,
                        title,
                        valid_until,
                        active_scenario_id,
                        created_at,
                        now,
                        finalized_at,
                        json.dumps(persisted_payload, ensure_ascii=False),
                    ),
                )
                cur.execute(
                    """
                    SELECT
                        id,
                        quote_number,
                        quote_number_seq,
                        schema_version,
                        draft_version,
                        status,
                        year,
                        customer_name,
                        contact_name,
                        channel_code,
                        title,
                        valid_until,
                        active_scenario_id,
                        created_at,
                        updated_at,
                        finalized_at,
                        payload
                    FROM quote_drafts
                    WHERE id = %s
                    """,
                    (resolved_id,),
                )
                row = cur.fetchone()
    return _row_to_record(row)


def delete_draft(draft_id: str) -> dict[str, Any]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM quote_drafts WHERE id = %s", (str(draft_id),))
            deleted = int(cur.rowcount or 0)
        if not postgres_storage.in_transaction():
            conn.commit()
    return {"deleted": deleted}


def clear_all_drafts() -> dict[str, Any]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM quote_drafts")
            deleted = int(cur.rowcount or 0)
        if not postgres_storage.in_transaction():
            conn.commit()
    return {"deleted": deleted}
