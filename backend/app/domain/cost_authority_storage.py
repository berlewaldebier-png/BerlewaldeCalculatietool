from __future__ import annotations

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Iterable
from uuid import NAMESPACE_URL, uuid4, uuid5

from app.domain import postgres_storage


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()
_AUTHORITY_LOCK_KEY = "calculatietool:planning-cost-authority:v1"


class PlanningCostConflict(RuntimeError):
    """Raised when an authority pointer changed during an approved operation."""


class PlanningCostBlocked(RuntimeError):
    """Raised when an authority operation would require guessing."""


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


def _stable_id(scope: str, *parts: Any) -> str:
    key = "|".join(_text(part) for part in parts)
    return str(uuid5(NAMESPACE_URL, f"calculatietool:{scope}:{key}"))


def _source_hash(value: Any) -> str:
    encoded = json.dumps(
        value,
        default=str,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    import hashlib

    return "sha256:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _lot_exact_key(value: Any) -> str:
    return "".join(character for character in _text(value).upper() if character.isalnum())


def ensure_schema() -> None:
    """Create RF-013B authority tables without changing existing tables or rows."""

    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    with _SCHEMA_LOCK:
        if _SCHEMA_READY:
            return
        postgres_storage.ensure_schema()
        # RF-013B is additive, but its foreign keys require the existing authorities
        # to exist first on a fresh disposable database.
        from app.domain import (
            articles_storage,
            cost_versions_storage,
            kostprijs_activation_storage,
            lot_costs_storage,
            skus_storage,
        )

        articles_storage.ensure_schema()
        skus_storage.ensure_schema()
        cost_versions_storage.ensure_schema()
        kostprijs_activation_storage.ensure_schema()
        lot_costs_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS canonical_beers (
                        id TEXT PRIMARY KEY,
                        legacy_beer_id TEXT NOT NULL UNIQUE,
                        name TEXT NOT NULL,
                        normalized_name TEXT NOT NULL,
                        source_status TEXT NOT NULL
                            CHECK (source_status IN ('resolved', 'reference_only')),
                        active BOOLEAN NOT NULL DEFAULT TRUE,
                        source_hash TEXT NOT NULL DEFAULT '',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_canonical_beers_normalized_name
                    ON canonical_beers (normalized_name)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS canonical_sku_subjects (
                        sku_id TEXT PRIMARY KEY
                            REFERENCES skus(id) ON DELETE RESTRICT,
                        subject_type TEXT NOT NULL
                            CHECK (subject_type IN ('beer', 'article', 'service', 'bundle')),
                        subject_id TEXT NOT NULL,
                        beer_id TEXT NULL
                            REFERENCES canonical_beers(id) ON DELETE RESTRICT,
                        format_article_id TEXT NOT NULL DEFAULT '',
                        article_id TEXT NOT NULL DEFAULT '',
                        classification_source TEXT NOT NULL,
                        source_hash TEXT NOT NULL DEFAULT '',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT canonical_sku_subjects_shape_chk CHECK (
                            (subject_type = 'beer' AND beer_id IS NOT NULL
                                AND subject_id = beer_id AND format_article_id <> '')
                            OR
                            (subject_type <> 'beer' AND subject_id <> '')
                        )
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_canonical_sku_subjects_subject
                    ON canonical_sku_subjects (subject_type, subject_id)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS cost_version_subjects (
                        version_id TEXT PRIMARY KEY
                            REFERENCES cost_versions(id) ON DELETE RESTRICT,
                        subject_type TEXT NOT NULL
                            CHECK (subject_type IN ('beer', 'article', 'service', 'bundle', 'unresolved')),
                        subject_id TEXT NOT NULL DEFAULT '',
                        canonical_beer_id TEXT NULL
                            REFERENCES canonical_beers(id) ON DELETE RESTRICT,
                        resolution_status TEXT NOT NULL
                            CHECK (resolution_status IN ('resolved', 'ambiguous', 'unresolved')),
                        resolution_reason TEXT NOT NULL DEFAULT '',
                        source_hash TEXT NOT NULL DEFAULT '',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT cost_version_subjects_shape_chk CHECK (
                            (resolution_status = 'resolved' AND subject_type <> 'unresolved'
                                AND subject_id <> '')
                            OR
                            (resolution_status <> 'resolved' AND subject_type = 'unresolved'
                                AND subject_id = '')
                        )
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_cost_version_subjects_subject
                    ON cost_version_subjects (subject_type, subject_id)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS planning_cost_anchors (
                        id TEXT PRIMARY KEY,
                        sku_id TEXT NOT NULL
                            REFERENCES skus(id) ON DELETE RESTRICT,
                        planning_year INTEGER NOT NULL CHECK (planning_year > 0),
                        activation_id TEXT NOT NULL DEFAULT '',
                        cost_version_id TEXT NOT NULL
                            REFERENCES cost_versions(id) ON DELETE RESTRICT,
                        cost_row_id TEXT NOT NULL
                            REFERENCES cost_version_sku_rows(id) ON DELETE RESTRICT,
                        anchor_kind TEXT NOT NULL
                            CHECK (anchor_kind IN ('first_activation', 'explicit_rebaseline')),
                        effective_at TIMESTAMPTZ NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        created_by TEXT NOT NULL DEFAULT '',
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_by TEXT NOT NULL DEFAULT '',
                        UNIQUE (sku_id, planning_year)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_planning_cost_anchors_version
                    ON planning_cost_anchors (cost_version_id, cost_row_id)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS planning_cost_anchor_events (
                        id TEXT PRIMARY KEY,
                        event_sequence BIGSERIAL NOT NULL UNIQUE,
                        anchor_id TEXT NOT NULL
                            REFERENCES planning_cost_anchors(id) ON DELETE RESTRICT,
                        event_type TEXT NOT NULL
                            CHECK (event_type IN ('anchor_created', 'rebaseline_executed')),
                        actor TEXT NOT NULL DEFAULT '',
                        reason TEXT NOT NULL DEFAULT '',
                        before_cost_version_id TEXT NOT NULL DEFAULT '',
                        before_cost_row_id TEXT NOT NULL DEFAULT '',
                        after_cost_version_id TEXT NOT NULL,
                        after_cost_row_id TEXT NOT NULL,
                        approval_actor TEXT NOT NULL DEFAULT '',
                        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_planning_cost_anchor_events_anchor
                    ON planning_cost_anchor_events (anchor_id, event_sequence)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS planning_cost_rebaseline_requests (
                        id TEXT PRIMARY KEY,
                        sku_id TEXT NOT NULL
                            REFERENCES skus(id) ON DELETE RESTRICT,
                        planning_year INTEGER NOT NULL CHECK (planning_year > 0),
                        requested_cost_version_id TEXT NOT NULL
                            REFERENCES cost_versions(id) ON DELETE RESTRICT,
                        requested_cost_row_id TEXT NOT NULL
                            REFERENCES cost_version_sku_rows(id) ON DELETE RESTRICT,
                        expected_anchor_id TEXT NOT NULL
                            REFERENCES planning_cost_anchors(id) ON DELETE RESTRICT,
                        expected_cost_version_id TEXT NOT NULL,
                        expected_cost_row_id TEXT NOT NULL,
                        status TEXT NOT NULL
                            CHECK (status IN ('prepared', 'approved', 'executed', 'rejected')),
                        reason TEXT NOT NULL,
                        prepared_by TEXT NOT NULL,
                        prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        approved_by TEXT NOT NULL DEFAULT '',
                        approved_at TIMESTAMPTZ NULL,
                        executed_by TEXT NOT NULL DEFAULT '',
                        executed_at TIMESTAMPTZ NULL,
                        rejection_reason TEXT NOT NULL DEFAULT '',
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS ux_planning_rebaseline_open_scope
                    ON planning_cost_rebaseline_requests (sku_id, planning_year)
                    WHERE status IN ('prepared', 'approved')
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS canonical_lot_cost_lineage (
                        id TEXT PRIMARY KEY,
                        sku_id TEXT NOT NULL
                            REFERENCES skus(id) ON DELETE RESTRICT,
                        lot_exact_key TEXT NOT NULL,
                        lot_number TEXT NOT NULL,
                        source_lot_id TEXT NOT NULL
                            REFERENCES cost_version_lots(id) ON DELETE RESTRICT,
                        cost_version_id TEXT NOT NULL
                            REFERENCES cost_versions(id) ON DELETE RESTRICT,
                        cost_row_id TEXT NOT NULL
                            REFERENCES cost_version_sku_rows(id) ON DELETE RESTRICT,
                        resolution_status TEXT NOT NULL DEFAULT 'resolved'
                            CHECK (resolution_status IN ('resolved', 'ambiguous')),
                        lineage_source TEXT NOT NULL DEFAULT 'cost_version_lot',
                        source_hash TEXT NOT NULL DEFAULT '',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        UNIQUE (sku_id, lot_exact_key)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_canonical_lot_cost_lineage_version
                    ON canonical_lot_cost_lineage (cost_version_id, cost_row_id)
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS cost_authority_mapping_manifest (
                        id TEXT PRIMARY KEY,
                        source_type TEXT NOT NULL,
                        source_id TEXT NOT NULL,
                        source_hash TEXT NOT NULL,
                        resolution_status TEXT NOT NULL
                            CHECK (resolution_status IN ('resolved', 'ambiguous', 'unresolved')),
                        target_type TEXT NOT NULL DEFAULT '',
                        target_id TEXT NOT NULL DEFAULT '',
                        reason_code TEXT NOT NULL,
                        candidate_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                        reviewed_status TEXT NOT NULL DEFAULT 'unreviewed'
                            CHECK (reviewed_status IN ('unreviewed', 'approved', 'rejected')),
                        reviewed_by TEXT NOT NULL DEFAULT '',
                        reviewed_at TIMESTAMPTZ NULL,
                        review_reason TEXT NOT NULL DEFAULT '',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        UNIQUE (source_type, source_id)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_cost_authority_manifest_status
                    ON cost_authority_mapping_manifest
                        (resolution_status, reviewed_status, source_type)
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def _authority_lock(cur: Any) -> None:
    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (_AUTHORITY_LOCK_KEY,))


def _upsert_beers(cur: Any, rows: Iterable[dict[str, Any]]) -> int:
    count = 0
    for row in rows:
        beer_id = _text(row.get("id"))
        if not beer_id:
            continue
        cur.execute(
            """
            INSERT INTO canonical_beers (
                id, legacy_beer_id, name, normalized_name, source_status,
                active, source_hash, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                normalized_name = EXCLUDED.normalized_name,
                source_status = EXCLUDED.source_status,
                active = EXCLUDED.active,
                source_hash = EXCLUDED.source_hash,
                updated_at = NOW()
            """,
            (
                beer_id,
                _text(row.get("legacy_beer_id")) or beer_id,
                _text(row.get("name")) or beer_id,
                _text(row.get("normalized_name")) or beer_id.casefold(),
                _text(row.get("source_status")) or "resolved",
                bool(row.get("active", True)),
                _text(row.get("source_hash")),
            ),
        )
        count += 1
    return count


def _upsert_sku_subjects(cur: Any, rows: Iterable[dict[str, Any]]) -> int:
    count = 0
    for row in rows:
        cur.execute(
            """
            INSERT INTO canonical_sku_subjects (
                sku_id, subject_type, subject_id, beer_id, format_article_id,
                article_id, classification_source, source_hash, updated_at
            )
            VALUES (%s, %s, %s, NULLIF(%s, ''), %s, %s, %s, %s, NOW())
            ON CONFLICT (sku_id) DO UPDATE SET
                subject_type = EXCLUDED.subject_type,
                subject_id = EXCLUDED.subject_id,
                beer_id = EXCLUDED.beer_id,
                format_article_id = EXCLUDED.format_article_id,
                article_id = EXCLUDED.article_id,
                classification_source = EXCLUDED.classification_source,
                source_hash = EXCLUDED.source_hash,
                updated_at = NOW()
            """,
            (
                _text(row.get("sku_id")),
                _text(row.get("subject_type")),
                _text(row.get("subject_id")),
                _text(row.get("beer_id")),
                _text(row.get("format_article_id")),
                _text(row.get("article_id")),
                _text(row.get("classification_source")),
                _text(row.get("source_hash")),
            ),
        )
        count += 1
    return count


def _upsert_version_subjects(cur: Any, rows: Iterable[dict[str, Any]]) -> int:
    count = 0
    for row in rows:
        cur.execute(
            """
            INSERT INTO cost_version_subjects (
                version_id, subject_type, subject_id, canonical_beer_id,
                resolution_status, resolution_reason, source_hash, updated_at
            )
            VALUES (%s, %s, %s, NULLIF(%s, ''), %s, %s, %s, NOW())
            ON CONFLICT (version_id) DO UPDATE SET
                subject_type = EXCLUDED.subject_type,
                subject_id = EXCLUDED.subject_id,
                canonical_beer_id = EXCLUDED.canonical_beer_id,
                resolution_status = EXCLUDED.resolution_status,
                resolution_reason = EXCLUDED.resolution_reason,
                source_hash = EXCLUDED.source_hash,
                updated_at = NOW()
            """,
            (
                _text(row.get("version_id")),
                _text(row.get("subject_type")) or "unresolved",
                _text(row.get("subject_id")),
                _text(row.get("canonical_beer_id")),
                _text(row.get("resolution_status")) or "unresolved",
                _text(row.get("resolution_reason")),
                _text(row.get("source_hash")),
            ),
        )
        count += 1
    return count


def _insert_anchor(
    cur: Any,
    *,
    sku_id: str,
    planning_year: int,
    activation_id: str,
    cost_version_id: str,
    cost_row_id: str,
    effective_at: str,
    actor: str,
    source_hash: str = "",
) -> bool:
    anchor_id = _stable_id("planning-cost-anchor", sku_id, planning_year)
    cur.execute(
        """
        INSERT INTO planning_cost_anchors (
            id, sku_id, planning_year, activation_id, cost_version_id,
            cost_row_id, anchor_kind, effective_at, created_by, updated_by
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, 'first_activation',
            NULLIF(%s, '')::timestamptz, %s, %s
        )
        ON CONFLICT (sku_id, planning_year) DO NOTHING
        """,
        (
            anchor_id,
            _text(sku_id),
            int(planning_year),
            _text(activation_id),
            _text(cost_version_id),
            _text(cost_row_id),
            _text(effective_at),
            _text(actor),
            _text(actor),
        ),
    )
    inserted = int(cur.rowcount or 0) == 1
    if inserted:
        cur.execute(
            """
            INSERT INTO planning_cost_anchor_events (
                id, anchor_id, event_type, actor, after_cost_version_id,
                after_cost_row_id, payload
            )
            VALUES (%s, %s, 'anchor_created', %s, %s, %s, %s::jsonb)
            """,
            (
                str(uuid4()),
                anchor_id,
                _text(actor),
                _text(cost_version_id),
                _text(cost_row_id),
                json.dumps(
                    {
                        "activation_id": _text(activation_id),
                        "source_hash": _text(source_hash),
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            ),
        )
    return inserted


def apply_backfill_plan(plan: dict[str, Any], *, actor: str) -> dict[str, int]:
    """Apply only deterministic plan rows; never delete or rewrite compatibility data."""

    ensure_schema()
    counts = {
        "canonical_beers": 0,
        "canonical_sku_subjects": 0,
        "cost_version_subjects": 0,
        "planning_cost_anchors": 0,
        "canonical_lot_cost_lineage": 0,
        "mapping_manifest": 0,
    }
    with postgres_storage.transaction() as conn:
        cur = conn.cursor()
        _authority_lock(cur)
        counts["canonical_beers"] = _upsert_beers(cur, plan.get("beers", []))
        counts["canonical_sku_subjects"] = _upsert_sku_subjects(
            cur, plan.get("sku_subjects", [])
        )
        counts["cost_version_subjects"] = _upsert_version_subjects(
            cur, plan.get("version_subjects", [])
        )
        for row in plan.get("planning_anchors", []):
            if _insert_anchor(
                cur,
                sku_id=_text(row.get("sku_id")),
                planning_year=int(row.get("planning_year", 0) or 0),
                activation_id=_text(row.get("activation_id")),
                cost_version_id=_text(row.get("cost_version_id")),
                cost_row_id=_text(row.get("cost_row_id")),
                effective_at=_text(row.get("effective_at")),
                actor=_text(actor),
                source_hash=_text(row.get("source_hash")),
            ):
                counts["planning_cost_anchors"] += 1
        for row in plan.get("lot_lineage", []):
            cur.execute(
                """
                INSERT INTO canonical_lot_cost_lineage (
                    id, sku_id, lot_exact_key, lot_number, source_lot_id,
                    cost_version_id, cost_row_id, resolution_status,
                    lineage_source, source_hash
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'resolved', %s, %s)
                ON CONFLICT (sku_id, lot_exact_key) DO NOTHING
                """,
                (
                    _text(row.get("id")),
                    _text(row.get("sku_id")),
                    _text(row.get("lot_exact_key")),
                    _text(row.get("lot_number")),
                    _text(row.get("source_lot_id")),
                    _text(row.get("cost_version_id")),
                    _text(row.get("cost_row_id")),
                    _text(row.get("lineage_source")) or "cost_version_lot",
                    _text(row.get("source_hash")),
                ),
            )
            counts["canonical_lot_cost_lineage"] += int(cur.rowcount or 0)
        for row in plan.get("mappings", []):
            cur.execute(
                """
                INSERT INTO cost_authority_mapping_manifest (
                    id, source_type, source_id, source_hash, resolution_status,
                    target_type, target_id, reason_code, candidate_ids, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
                ON CONFLICT (source_type, source_id) DO UPDATE SET
                    source_hash = EXCLUDED.source_hash,
                    resolution_status = EXCLUDED.resolution_status,
                    target_type = EXCLUDED.target_type,
                    target_id = EXCLUDED.target_id,
                    reason_code = EXCLUDED.reason_code,
                    candidate_ids = EXCLUDED.candidate_ids,
                    reviewed_status = CASE
                        WHEN cost_authority_mapping_manifest.source_hash = EXCLUDED.source_hash
                        THEN cost_authority_mapping_manifest.reviewed_status
                        ELSE 'unreviewed'
                    END,
                    reviewed_by = CASE
                        WHEN cost_authority_mapping_manifest.source_hash = EXCLUDED.source_hash
                        THEN cost_authority_mapping_manifest.reviewed_by
                        ELSE ''
                    END,
                    reviewed_at = CASE
                        WHEN cost_authority_mapping_manifest.source_hash = EXCLUDED.source_hash
                        THEN cost_authority_mapping_manifest.reviewed_at
                        ELSE NULL
                    END,
                    review_reason = CASE
                        WHEN cost_authority_mapping_manifest.source_hash = EXCLUDED.source_hash
                        THEN cost_authority_mapping_manifest.review_reason
                        ELSE ''
                    END,
                    updated_at = NOW()
                """,
                (
                    _text(row.get("id")),
                    _text(row.get("source_type")),
                    _text(row.get("source_id")),
                    _text(row.get("source_hash")),
                    _text(row.get("resolution_status")),
                    _text(row.get("target_type")),
                    _text(row.get("target_id")),
                    _text(row.get("reason_code")),
                    json.dumps(row.get("candidate_ids", []), ensure_ascii=False),
                ),
            )
            counts["mapping_manifest"] += 1
    return counts


def sync_beers_from_legacy_rows(rows: Iterable[dict[str, Any]]) -> int:
    """Dual-write explicit Beer IDs; never merge on name and never delete."""

    ensure_schema()
    normalized = []
    for row in rows:
        beer_id = _text(row.get("id"))
        name = _text(
            row.get("naam") or row.get("name") or row.get("biernaam") or beer_id
        )
        if not beer_id or not name:
            continue
        normalized.append(
            {
                "id": beer_id,
                "legacy_beer_id": beer_id,
                "name": name,
                "normalized_name": " ".join(name.casefold().split()),
                "source_status": "resolved",
                "active": bool(row.get("active", row.get("actief", True))),
                "source_hash": _source_hash(row),
            }
        )
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            count = _upsert_beers(cur, normalized)
        if not postgres_storage.in_transaction():
            conn.commit()
    return count


def sync_sku_subjects_from_rows(cur: Any, rows: Iterable[dict[str, Any]]) -> int:
    """Dual-write only structurally explicit SKU subjects in the caller transaction."""

    cur.execute("SELECT id FROM canonical_beers")
    beer_ids = {_text(row[0]) for row in (cur.fetchall() or [])}
    cur.execute("SELECT id, kind, payload FROM articles")
    article_by_id: dict[str, dict[str, Any]] = {}
    for article_id, kind, payload in cur.fetchall() or []:
        value = _json(payload)
        value["kind"] = _text(kind)
        article_by_id[_text(article_id)] = value

    subjects: list[dict[str, Any]] = []
    for row in rows:
        sku_id = _text(row.get("id"))
        kind = _text(row.get("kind") or "beer_format").casefold()
        beer_id = _text(row.get("beer_id"))
        format_id = _text(row.get("format_article_id"))
        article_id = _text(row.get("article_id"))
        source_hash = _source_hash(row)
        subject_type = ""
        subject_id = ""
        source = ""
        related_beer = beer_id if beer_id in beer_ids else ""
        if kind == "beer_format" and beer_id in beer_ids and format_id:
            subject_type = "beer"
            subject_id = beer_id
            source = "sku_kind_beer_format"
        elif kind in {"article", "bundle", "service"} and article_id:
            article = article_by_id.get(article_id, {})
            article_kind = _text(article.get("kind")).casefold()
            subtype = _text(
                row.get("sellable_subtype") or article.get("sellable_subtype")
            ).casefold()
            if kind == "bundle" or article_kind == "bundle" or subtype == "beer_bundle":
                subject_type = "bundle"
            elif (
                kind == "service"
                or article_kind == "service"
                or subtype in {"dienst", "service"}
            ):
                subject_type = "service"
            else:
                subject_type = "article"
            subject_id = article_id
            source = "sku_kind_and_article"
        if subject_type:
            subjects.append(
                {
                    "sku_id": sku_id,
                    "subject_type": subject_type,
                    "subject_id": subject_id,
                    "beer_id": related_beer if subject_type != "beer" else beer_id,
                    "format_article_id": format_id,
                    "article_id": article_id,
                    "classification_source": source,
                    "source_hash": source_hash,
                }
            )
            continue
        source_id = sku_id or _stable_id("unidentified-sku", source_hash)
        cur.execute(
            """
            INSERT INTO cost_authority_mapping_manifest (
                id, source_type, source_id, source_hash, resolution_status,
                reason_code, candidate_ids, updated_at
            )
            VALUES (%s, 'sku', %s, %s, 'unresolved', %s, %s::jsonb, NOW())
            ON CONFLICT (source_type, source_id) DO UPDATE SET
                source_hash = EXCLUDED.source_hash,
                resolution_status = EXCLUDED.resolution_status,
                target_type = '',
                target_id = '',
                reason_code = EXCLUDED.reason_code,
                candidate_ids = EXCLUDED.candidate_ids,
                reviewed_status = 'unreviewed',
                reviewed_by = '',
                reviewed_at = NULL,
                review_reason = '',
                updated_at = NOW()
            """,
            (
                _stable_id("cost-authority-manifest", "sku", source_id),
                source_id,
                source_hash,
                "sku_subject_incomplete",
                json.dumps([beer_id] if beer_id else []),
            ),
        )
    return _upsert_sku_subjects(cur, subjects)


def sync_cost_version_authority(cur: Any, version_ids: Iterable[str]) -> dict[str, int]:
    """Dual-write version subjects and exact LOT lineage for newly saved versions."""

    ids = sorted({_text(value) for value in version_ids if _text(value)})
    if not ids:
        return {"version_subjects": 0, "lot_lineage": 0, "lot_ambiguities": 0}
    cur.execute(
        """
        SELECT v.id, v.bier_id, v.payload
        FROM cost_versions v
        WHERE v.id = ANY(%s)
        ORDER BY v.id
        """,
        (ids,),
    )
    versions = cur.fetchall() or []
    cur.execute("SELECT id FROM canonical_beers")
    beer_ids = {_text(row[0]) for row in (cur.fetchall() or [])}
    version_subjects: list[dict[str, Any]] = []
    for version_id, legacy_beer_id, payload in versions:
        version_id_text = _text(version_id)
        beer_id = _text(legacy_beer_id)
        cur.execute(
            """
            SELECT DISTINCT s.subject_type, s.subject_id, COALESCE(s.beer_id, '')
            FROM cost_version_sku_rows r
            JOIN canonical_sku_subjects s ON s.sku_id = r.sku_id
            WHERE r.version_id = %s
            ORDER BY s.subject_type, s.subject_id
            """,
            (version_id_text,),
        )
        row_subjects = [
            (_text(row[0]), _text(row[1]), _text(row[2]))
            for row in (cur.fetchall() or [])
        ]
        if beer_id in beer_ids:
            subject_type = "beer"
            subject_id = beer_id
            canonical_beer_id = beer_id
            status = "resolved"
            reason = "exact_beer_id"
        elif len(row_subjects) == 1:
            subject_type, subject_id, related_beer = row_subjects[0]
            canonical_beer_id = related_beer if subject_type == "beer" else ""
            status = "resolved"
            reason = "single_cost_row_subject"
        else:
            subject_type = "unresolved"
            subject_id = ""
            canonical_beer_id = ""
            status = "ambiguous" if len(row_subjects) > 1 else "unresolved"
            reason = (
                "multiple_cost_row_subjects"
                if len(row_subjects) > 1
                else "cost_version_subject_unknown"
            )
        source_hash = _source_hash(
            {
                "version_id": version_id_text,
                "bier_id": beer_id,
                "payload": _json(payload),
                "row_subjects": row_subjects,
            }
        )
        version_subjects.append(
            {
                "version_id": version_id_text,
                "subject_type": subject_type,
                "subject_id": subject_id,
                "canonical_beer_id": canonical_beer_id,
                "resolution_status": status,
                "resolution_reason": reason,
                "source_hash": source_hash,
            }
        )
    version_subject_count = _upsert_version_subjects(cur, version_subjects)

    cur.execute(
        """
        SELECT l.id, l.version_id, l.lot_number, r.id, r.sku_id
        FROM cost_version_lots l
        JOIN cost_version_sku_rows r ON r.version_id = l.version_id
        ORDER BY l.id, r.id
        """
    )
    candidates: dict[tuple[str, str], list[tuple[str, str, str, str]]] = {}
    for lot_id, version_id, lot_number, row_id, sku_id in cur.fetchall() or []:
        exact = _lot_exact_key(lot_number)
        key = (_text(sku_id), exact)
        if key[0] and key[1]:
            candidates.setdefault(key, []).append(
                (_text(lot_id), _text(version_id), _text(lot_number), _text(row_id))
            )
    lineage_count = 0
    ambiguity_count = 0
    for (sku_id, exact), rows in candidates.items():
        if not any(version_id in ids for _, version_id, _, _ in rows):
            continue
        source_id = f"{sku_id}:{exact}"
        source_hash = _source_hash(rows)
        if len(rows) == 1:
            lot_id, version_id, lot_number, row_id = rows[0]
            cur.execute(
                """
                INSERT INTO canonical_lot_cost_lineage (
                    id, sku_id, lot_exact_key, lot_number, source_lot_id,
                    cost_version_id, cost_row_id, resolution_status,
                    lineage_source, source_hash
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'resolved',
                        'cost_version_lot', %s)
                ON CONFLICT (sku_id, lot_exact_key) DO UPDATE SET
                    lot_number = EXCLUDED.lot_number,
                    source_lot_id = EXCLUDED.source_lot_id,
                    cost_version_id = EXCLUDED.cost_version_id,
                    cost_row_id = EXCLUDED.cost_row_id,
                    resolution_status = 'resolved',
                    source_hash = EXCLUDED.source_hash
                """,
                (
                    _stable_id("canonical-lot-lineage", sku_id, exact),
                    sku_id,
                    exact,
                    lot_number,
                    lot_id,
                    version_id,
                    row_id,
                    source_hash,
                ),
            )
            lineage_count += 1
            manifest_status = "resolved"
            reason = "unique_exact_lot_version_row"
            candidates_payload: list[str] = []
            target_id = row_id
        else:
            cur.execute(
                """
                UPDATE canonical_lot_cost_lineage
                SET resolution_status = 'ambiguous', source_hash = %s
                WHERE sku_id = %s AND lot_exact_key = %s
                """,
                (source_hash, sku_id, exact),
            )
            ambiguity_count += 1
            manifest_status = "ambiguous"
            reason = "exact_lot_multiple_version_rows"
            candidates_payload = [
                f"{version_id}:{row_id}" for _, version_id, _, row_id in rows
            ]
            target_id = ""
        cur.execute(
            """
            INSERT INTO cost_authority_mapping_manifest (
                id, source_type, source_id, source_hash, resolution_status,
                target_type, target_id, reason_code, candidate_ids, updated_at
            )
            VALUES (%s, 'lot_lineage', %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
            ON CONFLICT (source_type, source_id) DO UPDATE SET
                source_hash = EXCLUDED.source_hash,
                resolution_status = EXCLUDED.resolution_status,
                target_type = EXCLUDED.target_type,
                target_id = EXCLUDED.target_id,
                reason_code = EXCLUDED.reason_code,
                candidate_ids = EXCLUDED.candidate_ids,
                reviewed_status = CASE
                    WHEN cost_authority_mapping_manifest.source_hash = EXCLUDED.source_hash
                    THEN cost_authority_mapping_manifest.reviewed_status
                    ELSE 'unreviewed'
                END,
                updated_at = NOW()
            """,
            (
                _stable_id("cost-authority-manifest", "lot_lineage", source_id),
                source_id,
                source_hash,
                manifest_status,
                "cost_row" if manifest_status == "resolved" else "",
                target_id,
                reason,
                json.dumps(candidates_payload),
            ),
        )
    return {
        "version_subjects": version_subject_count,
        "lot_lineage": lineage_count,
        "lot_ambiguities": ambiguity_count,
    }


def register_first_activation_anchor(
    cur: Any,
    *,
    sku_id: str,
    planning_year: int,
    activation_id: str,
    cost_version_id: str,
    effective_at: str,
    actor: str,
) -> str:
    """Dual-write a first anchor only when history and one cost row prove it."""

    cur.execute(
        """
        SELECT id
        FROM cost_version_sku_rows
        WHERE version_id = %s AND sku_id = %s
        ORDER BY id
        """,
        (_text(cost_version_id), _text(sku_id)),
    )
    rows = [_text(row[0]) for row in (cur.fetchall() or [])]
    if len(rows) != 1:
        return "missing_cost_row" if not rows else "ambiguous_cost_row"
    cur.execute(
        """
        SELECT COUNT(*)::int
        FROM kostprijs_sku_activation_events
        WHERE sku_id = %s AND jaar = %s
        """,
        (_text(sku_id), int(planning_year)),
    )
    history_count = int((cur.fetchone() or [0])[0] or 0)
    if history_count:
        return "history_requires_backfill"
    inserted = _insert_anchor(
        cur,
        sku_id=_text(sku_id),
        planning_year=int(planning_year),
        activation_id=_text(activation_id),
        cost_version_id=_text(cost_version_id),
        cost_row_id=rows[0],
        effective_at=_text(effective_at),
        actor=_text(actor),
    )
    return "created" if inserted else "already_exists"


def get_anchor(*, sku_id: str, planning_year: int) -> dict[str, Any] | None:
    ensure_schema()
    with postgres_storage.connect() as conn:
        row = conn.execute(
            """
            SELECT id, sku_id, planning_year, activation_id, cost_version_id,
                   cost_row_id, anchor_kind, effective_at, created_at, created_by,
                   updated_at, updated_by
            FROM planning_cost_anchors
            WHERE sku_id = %s AND planning_year = %s
            """,
            (_text(sku_id), int(planning_year)),
        ).fetchone()
    if not row:
        return None
    return {
        "id": _text(row[0]),
        "sku_id": _text(row[1]),
        "planning_year": int(row[2] or 0),
        "activation_id": _text(row[3]),
        "cost_version_id": _text(row[4]),
        "cost_row_id": _text(row[5]),
        "anchor_kind": _text(row[6]),
        "effective_at": _iso(row[7]),
        "created_at": _iso(row[8]),
        "created_by": _text(row[9]),
        "updated_at": _iso(row[10]),
        "updated_by": _text(row[11]),
    }


def prepare_rebaseline(
    *,
    sku_id: str,
    planning_year: int,
    cost_version_id: str,
    reason: str,
    actor: str,
    actor_role: str,
) -> dict[str, Any]:
    if _text(actor_role) != "brewer":
        raise PermissionError("Alleen de rol Brouwer mag een herijking voorbereiden.")
    if not _text(reason):
        raise ValueError("Een reden is verplicht voor een herijkingsvoorstel.")
    ensure_schema()
    with postgres_storage.transaction() as conn:
        cur = conn.cursor()
        _authority_lock(cur)
        cur.execute(
            """
            SELECT id, cost_version_id, cost_row_id
            FROM planning_cost_anchors
            WHERE sku_id = %s AND planning_year = %s
            FOR UPDATE
            """,
            (_text(sku_id), int(planning_year)),
        )
        anchor = cur.fetchone()
        if not anchor:
            raise PlanningCostBlocked("Planninganker ontbreekt; herijking is niet mogelijk.")
        cur.execute(
            """
            SELECT id
            FROM cost_version_sku_rows
            WHERE version_id = %s AND sku_id = %s
            ORDER BY id
            """,
            (_text(cost_version_id), _text(sku_id)),
        )
        cost_rows = [_text(row[0]) for row in (cur.fetchall() or [])]
        if len(cost_rows) != 1:
            raise PlanningCostBlocked(
                "De nieuwe kostprijsversie heeft niet exact één SKU-kostprijsregel."
            )
        if _text(anchor[1]) == _text(cost_version_id) and _text(anchor[2]) == cost_rows[0]:
            raise PlanningCostBlocked("De voorgestelde kostprijs is al het planninganker.")
        request_id = str(uuid4())
        cur.execute(
            """
            INSERT INTO planning_cost_rebaseline_requests (
                id, sku_id, planning_year, requested_cost_version_id,
                requested_cost_row_id, expected_anchor_id,
                expected_cost_version_id, expected_cost_row_id,
                status, reason, prepared_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'prepared', %s, %s)
            """,
            (
                request_id,
                _text(sku_id),
                int(planning_year),
                _text(cost_version_id),
                cost_rows[0],
                _text(anchor[0]),
                _text(anchor[1]),
                _text(anchor[2]),
                _text(reason),
                _text(actor),
            ),
        )
    return get_rebaseline_request(request_id) or {}


def get_rebaseline_request(request_id: str) -> dict[str, Any] | None:
    ensure_schema()
    with postgres_storage.connect() as conn:
        row = conn.execute(
            """
            SELECT id, sku_id, planning_year, requested_cost_version_id,
                   requested_cost_row_id, expected_anchor_id,
                   expected_cost_version_id, expected_cost_row_id,
                   status, reason, prepared_by, prepared_at,
                   approved_by, approved_at, executed_by, executed_at,
                   rejection_reason, payload
            FROM planning_cost_rebaseline_requests
            WHERE id = %s
            """,
            (_text(request_id),),
        ).fetchone()
    if not row:
        return None
    return {
        "id": _text(row[0]),
        "sku_id": _text(row[1]),
        "planning_year": int(row[2] or 0),
        "requested_cost_version_id": _text(row[3]),
        "requested_cost_row_id": _text(row[4]),
        "expected_anchor_id": _text(row[5]),
        "expected_cost_version_id": _text(row[6]),
        "expected_cost_row_id": _text(row[7]),
        "status": _text(row[8]),
        "reason": _text(row[9]),
        "prepared_by": _text(row[10]),
        "prepared_at": _iso(row[11]),
        "approved_by": _text(row[12]),
        "approved_at": _iso(row[13]),
        "executed_by": _text(row[14]),
        "executed_at": _iso(row[15]),
        "rejection_reason": _text(row[16]),
        "payload": _json(row[17]),
    }


def approve_rebaseline(
    request_id: str, *, actor: str, actor_role: str
) -> dict[str, Any]:
    if _text(actor_role) != "management":
        raise PermissionError("Alleen Management mag een herijking goedkeuren.")
    ensure_schema()
    with postgres_storage.transaction() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE planning_cost_rebaseline_requests
            SET status = 'approved', approved_by = %s, approved_at = NOW()
            WHERE id = %s AND status = 'prepared'
            """,
            (_text(actor), _text(request_id)),
        )
        if int(cur.rowcount or 0) != 1:
            raise PlanningCostConflict(
                "Herijkingsvoorstel ontbreekt of is niet meer voorbereid."
            )
    return get_rebaseline_request(request_id) or {}


def execute_rebaseline(
    request_id: str, *, actor: str, actor_role: str
) -> dict[str, Any]:
    if _text(actor_role) != "admin":
        raise PermissionError("Alleen de Administrator mag een herijking uitvoeren.")
    ensure_schema()
    with postgres_storage.transaction() as conn:
        cur = conn.cursor()
        _authority_lock(cur)
        cur.execute(
            """
            SELECT id, sku_id, planning_year, requested_cost_version_id,
                   requested_cost_row_id, expected_anchor_id,
                   expected_cost_version_id, expected_cost_row_id,
                   status, reason, approved_by
            FROM planning_cost_rebaseline_requests
            WHERE id = %s
            FOR UPDATE
            """,
            (_text(request_id),),
        )
        request = cur.fetchone()
        if not request or _text(request[8]) != "approved":
            raise PlanningCostBlocked(
                "Alleen een goedgekeurd herijkingsvoorstel kan worden uitgevoerd."
            )
        cur.execute(
            """
            SELECT id, cost_version_id, cost_row_id
            FROM planning_cost_anchors
            WHERE id = %s
            FOR UPDATE
            """,
            (_text(request[5]),),
        )
        anchor = cur.fetchone()
        if not anchor:
            raise PlanningCostConflict("Het verwachte planninganker bestaat niet meer.")
        if (
            _text(anchor[1]) != _text(request[6])
            or _text(anchor[2]) != _text(request[7])
        ):
            raise PlanningCostConflict(
                "Het planninganker is gewijzigd na voorbereiding; maak een nieuw voorstel."
            )
        cur.execute(
            """
            UPDATE planning_cost_anchors
            SET cost_version_id = %s,
                cost_row_id = %s,
                anchor_kind = 'explicit_rebaseline',
                updated_at = NOW(),
                updated_by = %s
            WHERE id = %s
            """,
            (_text(request[3]), _text(request[4]), _text(actor), _text(anchor[0])),
        )
        cur.execute(
            """
            INSERT INTO planning_cost_anchor_events (
                id, anchor_id, event_type, actor, reason,
                before_cost_version_id, before_cost_row_id,
                after_cost_version_id, after_cost_row_id, approval_actor, payload
            )
            VALUES (
                %s, %s, 'rebaseline_executed', %s, %s,
                %s, %s, %s, %s, %s, '{}'::jsonb
            )
            """,
            (
                str(uuid4()),
                _text(anchor[0]),
                _text(actor),
                _text(request[9]),
                _text(anchor[1]),
                _text(anchor[2]),
                _text(request[3]),
                _text(request[4]),
                _text(request[10]),
            ),
        )
        cur.execute(
            """
            UPDATE planning_cost_rebaseline_requests
            SET status = 'executed', executed_by = %s, executed_at = NOW()
            WHERE id = %s
            """,
            (_text(actor), _text(request_id)),
        )
    return get_rebaseline_request(request_id) or {}


def authority_overview() -> dict[str, Any]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        counts = {}
        for table in (
            "canonical_beers",
            "canonical_sku_subjects",
            "cost_version_subjects",
            "planning_cost_anchors",
            "canonical_lot_cost_lineage",
            "cost_authority_mapping_manifest",
        ):
            counts[table] = int(
                conn.execute(f"SELECT COUNT(*)::int FROM {table}").fetchone()[0] or 0
            )
        statuses = {
            _text(row[0]): int(row[1] or 0)
            for row in conn.execute(
                """
                SELECT resolution_status, COUNT(*)::int
                FROM cost_authority_mapping_manifest
                GROUP BY resolution_status
                """
            ).fetchall()
        }
        unresolved_versions = int(
            conn.execute(
                """
                SELECT COUNT(*)::int
                FROM cost_version_subjects
                WHERE resolution_status <> 'resolved'
                """
            ).fetchone()[0]
            or 0
        )
    return {
        "authority": "rf013b_canonical_cost_authority",
        "consumer_mode": "compatibility_only",
        "counts": counts,
        "mapping_statuses": statuses,
        "unresolved_cost_version_subjects": unresolved_versions,
    }


def approve_cost_version_beer_mapping(
    mapping_id: str,
    *,
    canonical_beer_id: str,
    expected_source_hash: str,
    review_reason: str,
    actor: str,
    actor_role: str,
) -> dict[str, Any]:
    """Approve one ambiguous legacy cost-version -> Beer relation without rewriting it."""

    if _text(actor_role) != "admin":
        raise PermissionError("Alleen de Administrator mag een mapping uitvoeren.")
    if not _text(review_reason):
        raise ValueError("Een reviewreden is verplicht.")
    ensure_schema()
    with postgres_storage.transaction() as conn:
        cur = conn.cursor()
        _authority_lock(cur)
        cur.execute(
            """
            SELECT source_type, source_id, source_hash, resolution_status,
                   candidate_ids
            FROM cost_authority_mapping_manifest
            WHERE id = %s
            FOR UPDATE
            """,
            (_text(mapping_id),),
        )
        mapping = cur.fetchone()
        if not mapping:
            raise PlanningCostBlocked("Mapping bestaat niet.")
        if _text(mapping[0]) != "cost_version":
            raise PlanningCostBlocked(
                "Alleen een kostprijsversie-naar-Beer mapping is in RF-013B goedkeuringsklaar."
            )
        if _text(mapping[2]) != _text(expected_source_hash):
            raise PlanningCostConflict(
                "De bronkostprijsversie is na beoordeling gewijzigd."
            )
        cur.execute("SELECT id FROM canonical_beers WHERE id = %s", (_text(canonical_beer_id),))
        if not cur.fetchone():
            raise PlanningCostBlocked("De gekozen canonieke Beer bestaat niet.")
        candidate_ids = mapping[4]
        if isinstance(candidate_ids, str):
            candidate_ids = json.loads(candidate_ids)
        if (
            _text(mapping[3]) == "ambiguous"
            and isinstance(candidate_ids, list)
            and candidate_ids
            and _text(canonical_beer_id) not in {_text(value) for value in candidate_ids}
        ):
            raise PlanningCostBlocked(
                "De gekozen Beer behoort niet tot de vastgelegde kandidaten."
            )
        cur.execute(
            """
            UPDATE cost_version_subjects
            SET subject_type = 'beer',
                subject_id = %s,
                canonical_beer_id = %s,
                resolution_status = 'resolved',
                resolution_reason = 'reviewed_legacy_beer_mapping',
                updated_at = NOW()
            WHERE version_id = %s
            """,
            (_text(canonical_beer_id), _text(canonical_beer_id), _text(mapping[1])),
        )
        if int(cur.rowcount or 0) != 1:
            raise PlanningCostBlocked("Kostprijsversie-subject ontbreekt.")
        cur.execute(
            """
            UPDATE cost_authority_mapping_manifest
            SET resolution_status = 'resolved',
                target_type = 'beer',
                target_id = %s,
                reason_code = 'reviewed_legacy_beer_mapping',
                reviewed_status = 'approved',
                reviewed_by = %s,
                reviewed_at = NOW(),
                review_reason = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (
                _text(canonical_beer_id),
                _text(actor),
                _text(review_reason),
                _text(mapping_id),
            ),
        )
    return {
        "mapping_id": _text(mapping_id),
        "source_type": "cost_version",
        "resolution_status": "resolved",
        "target_type": "beer",
        "target_id": _text(canonical_beer_id),
        "reviewed_status": "approved",
    }
