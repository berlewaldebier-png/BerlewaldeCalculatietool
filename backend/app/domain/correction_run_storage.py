from __future__ import annotations

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import uuid4

from app.domain import cost_versions_storage, douano_margin_snapshot_storage, fixed_costs_storage, postgres_storage

_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()


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
                    CREATE TABLE IF NOT EXISTS correction_runs (
                        id TEXT PRIMARY KEY,
                        source_type TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'applied',
                        scope_years INTEGER[] NOT NULL DEFAULT '{}'::integer[],
                        summary TEXT NOT NULL DEFAULT '',
                        impact JSONB NOT NULL DEFAULT '{}'::jsonb,
                        before_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        after_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        applied_at TIMESTAMPTZ,
                        reverted_at TIMESTAMPTZ
                    )
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS ix_correction_runs_source ON correction_runs(source_type, created_at DESC)")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_correction_runs_status ON correction_runs(status)")
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _rows_by_year(payload: Any) -> dict[int, list[dict[str, Any]]]:
    out: dict[int, list[dict[str, Any]]] = {}
    if not isinstance(payload, dict):
        return out
    for year_key, rows in payload.items():
        try:
            year = int(year_key)
        except (TypeError, ValueError):
            continue
        if not isinstance(rows, list):
            rows = []
        out[year] = [dict(row) for row in rows if isinstance(row, dict)]
    return out


def _year_total(rows: list[dict[str, Any]]) -> float:
    return sum(_num(row.get("bedrag_per_jaar")) for row in rows)


def _changed_years(before: Any, after: Any) -> list[int]:
    before_by_year = _rows_by_year(before)
    after_by_year = _rows_by_year(after)
    years = sorted(set(before_by_year) | set(after_by_year))
    changed: list[int] = []
    for year in years:
        before_rows = before_by_year.get(year, [])
        after_rows = after_by_year.get(year, [])
        before_normalized = json.dumps(before_rows, sort_keys=True, ensure_ascii=False)
        after_normalized = json.dumps(after_rows, sort_keys=True, ensure_ascii=False)
        if before_normalized != after_normalized:
            changed.append(year)
    return changed


def _cost_versions_for_years(years: list[int]) -> list[dict[str, Any]]:
    wanted = {int(year) for year in years if int(year or 0) > 0}
    if not wanted:
        return []
    rows = cost_versions_storage.load_dataset(default_value=[])
    return [
        dict(row)
        for row in (rows if isinstance(rows, list) else [])
        if isinstance(row, dict) and int(row.get("jaar", 0) or 0) in wanted
    ]


def preview_fixed_cost_change(before: Any, after: Any) -> dict[str, Any]:
    ensure_schema()
    changed = _changed_years(before, after)
    before_by_year = _rows_by_year(before)
    after_by_year = _rows_by_year(after)
    by_year: list[dict[str, Any]] = []
    if changed:
        cost_versions_storage.ensure_schema()
        douano_margin_snapshot_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                for year in changed:
                    cur.execute("SELECT COUNT(*)::int FROM cost_versions WHERE jaar = %s", (year,))
                    versions = int((cur.fetchone() or [0])[0] or 0)
                    cur.execute(
                        """
                        SELECT COUNT(*)::int
                        FROM douano_sales_line_cost_snapshots
                        WHERE line_date >= %s::date AND line_date < %s::date
                        """,
                        (f"{year}-01-01", f"{year + 1}-01-01"),
                    )
                    snapshots = int((cur.fetchone() or [0])[0] or 0)
                    before_rows = before_by_year.get(year, [])
                    after_rows = after_by_year.get(year, [])
                    by_year.append(
                        {
                            "year": year,
                            "before_rows": len(before_rows),
                            "after_rows": len(after_rows),
                            "before_total": round(_year_total(before_rows), 2),
                            "after_total": round(_year_total(after_rows), 2),
                            "delta_total": round(_year_total(after_rows) - _year_total(before_rows), 2),
                            "affected_cost_versions": versions,
                            "affected_margin_snapshots": snapshots,
                        }
                    )
    return {
        "source_type": "fixed_costs",
        "changed": bool(changed),
        "scope_years": changed,
        "by_year": by_year,
    }


def create_fixed_cost_run(*, before: Any, after: Any, result: dict[str, Any] | None = None) -> dict[str, Any] | None:
    impact = preview_fixed_cost_change(before, after)
    if not impact.get("changed"):
        return None
    ensure_schema()
    run_id = str(uuid4())
    now = datetime.now(UTC)
    years = [int(year) for year in impact.get("scope_years", [])]
    summary = "Vaste kosten gewijzigd voor " + ", ".join(str(year) for year in years)
    versions_before = _cost_versions_for_years(years)
    result_payload = {
        **(result if isinstance(result, dict) else {}),
        "cost_versions_before": versions_before,
        "revision_reports": [],
        "snapshot_refreshes": [],
    }
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO correction_runs (
                    id, source_type, status, scope_years, summary, impact,
                    before_payload, after_payload, result_payload, created_at, applied_at
                )
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s)
                """,
                (
                    run_id,
                    "fixed_costs",
                    "applied",
                    years,
                    summary,
                    json.dumps(impact, ensure_ascii=False),
                    json.dumps(before if isinstance(before, dict) else {}, ensure_ascii=False),
                    json.dumps(after if isinstance(after, dict) else {}, ensure_ascii=False),
                    json.dumps(result_payload, ensure_ascii=False),
                    now,
                    now,
                ),
            )
        if not postgres_storage.in_transaction():
            conn.commit()

    revision_reports: list[dict[str, Any]] = []
    snapshot_refreshes: list[dict[str, Any]] = []
    try:
        for year in years:
            revision_reports.append(
                cost_versions_storage.rebuild_overhead_versions_for_year(
                    year=int(year),
                    owner="correction-run",
                    dry_run=False,
                    source_version_ids=None,
                    in_place_revision=True,
                    correction_run_id=run_id,
                )
            )
            try:
                from app.domain import douano_margin_service

                snapshot_refreshes.append(
                    douano_margin_service.backfill_line_snapshots_for_year(
                        year=int(year),
                        basis="both",
                        limit=50000,
                    )
                )
            except Exception as exc:
                snapshot_refreshes.append({"year": int(year), "error": str(exc)})
        versions_after = _cost_versions_for_years(years)
        result_payload = {
            **result_payload,
            "revision_reports": revision_reports,
            "snapshot_refreshes": snapshot_refreshes,
            "cost_versions_after": versions_after,
        }
        status = "applied"
    except Exception as exc:
        result_payload = {**result_payload, "error": str(exc)}
        status = "failed"
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE correction_runs
                SET status = %s,
                    result_payload = %s::jsonb
                WHERE id = %s
                """,
                (
                    status,
                    json.dumps(result_payload, ensure_ascii=False),
                    run_id,
                ),
            )
        if not postgres_storage.in_transaction():
            conn.commit()
    return get_correction_run(run_id)


def get_correction_run(run_id: str) -> dict[str, Any] | None:
    ensure_schema()
    rid = str(run_id or "").strip()
    if not rid:
        return None
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, source_type, status, scope_years, summary, impact,
                       result_payload, created_at, applied_at, reverted_at
                FROM correction_runs
                WHERE id = %s
                """,
                (rid,),
            )
            row = cur.fetchone()
    if not row:
        return None
    run_id, source_type, status, scope_years, summary, impact, result_payload, created_at, applied_at, reverted_at = row
    result_public = result_payload if isinstance(result_payload, dict) else {}
    result_public = {
        key: value
        for key, value in result_public.items()
        if key not in {"cost_versions_before", "cost_versions_after"}
    }
    return {
        "id": str(run_id or ""),
        "source_type": str(source_type or ""),
        "status": str(status or ""),
        "scope_years": [int(year) for year in (scope_years or [])],
        "summary": str(summary or ""),
        "impact": impact if isinstance(impact, dict) else {},
        "result": result_public,
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") and created_at else "",
        "applied_at": applied_at.isoformat() if hasattr(applied_at, "isoformat") and applied_at else "",
        "reverted_at": reverted_at.isoformat() if hasattr(reverted_at, "isoformat") and reverted_at else "",
    }


def list_correction_runs(*, source_type: str = "", limit: int = 50) -> list[dict[str, Any]]:
    ensure_schema()
    lim = max(1, min(int(limit or 50), 200))
    source = str(source_type or "").strip()
    where = "WHERE source_type = %s" if source else ""
    params: tuple[Any, ...] = (source, lim) if source else (lim,)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id
                FROM correction_runs
                {where}
                ORDER BY created_at DESC
                LIMIT %s
                """,
                params,
            )
            ids = [str(row[0] or "") for row in cur.fetchall() or []]
    return [run for run_id in ids if (run := get_correction_run(run_id)) is not None]


def revert_fixed_cost_run(run_id: str) -> dict[str, Any]:
    ensure_schema()
    rid = str(run_id or "").strip()
    if not rid:
        raise ValueError("Correctierun ontbreekt.")
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT source_type, status, scope_years, before_payload, result_payload
                FROM correction_runs
                WHERE id = %s
                FOR UPDATE
                """,
                (rid,),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("Correctierun niet gevonden.")
            source_type, status, scope_years, before_payload, result_payload = row
            if str(source_type or "") != "fixed_costs":
                raise ValueError("Alleen vaste-kosten correctieruns kunnen via deze route worden teruggedraaid.")
            if str(status or "") == "reverted":
                raise ValueError("Correctierun is al teruggedraaid.")
            restored = dict(before_payload) if isinstance(before_payload, dict) else {}
            for year in scope_years or []:
                restored.setdefault(str(int(year)), [])
            fixed_costs_storage.save_grouped_by_year(restored)
            result_obj = result_payload if isinstance(result_payload, dict) else {}
            versions_before = result_obj.get("cost_versions_before")
            if isinstance(versions_before, list):
                cost_versions_storage.save_dataset(
                    [dict(row) for row in versions_before if isinstance(row, dict)],
                    overwrite=True,
                )
            snapshot_refreshes: list[dict[str, Any]] = []
            try:
                from app.domain import douano_margin_service

                for year in scope_years or []:
                    snapshot_refreshes.append(
                        douano_margin_service.backfill_line_snapshots_for_year(
                            year=int(year),
                            basis="both",
                            limit=50000,
                        )
                    )
            except Exception as exc:
                snapshot_refreshes.append({"error": str(exc)})
            now = datetime.now(UTC)
            cur.execute(
                """
                UPDATE correction_runs
                SET status = 'reverted',
                    reverted_at = %s,
                    result_payload = result_payload || %s::jsonb
                WHERE id = %s
                """,
                (
                    now,
                    json.dumps({"rollback_snapshot_refreshes": snapshot_refreshes}, ensure_ascii=False),
                    rid,
                ),
            )
        if not postgres_storage.in_transaction():
            conn.commit()
    run = get_correction_run(rid) or {}
    return {"reverted": True, "run": run}
