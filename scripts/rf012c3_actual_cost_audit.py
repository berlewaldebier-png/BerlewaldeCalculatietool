from __future__ import annotations

from collections import Counter
import json
import sys
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
for path in (ROOT, BACKEND):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import postgres_storage  # noqa: E402
from app.domain import douano_margin_snapshot_storage  # noqa: E402
from app.domain.actual_lot_cost_resolver import ActualLotCostResolver  # noqa: E402
from app.domain.cost_resolution_postgres_reader import (  # noqa: E402
    PostgresCostResolutionSnapshotReader,
)
from app.domain.planning_actual_cost_resolver import (  # noqa: E402
    ReadOnlyCostResolutionService,
)


def build_report(
    rows: Iterable[dict[str, Any]],
    resolver: ActualLotCostResolver,
    *,
    active_year: int,
) -> dict[str, Any]:
    statuses: Counter[tuple[int, str]] = Counter()
    version_comparison: Counter[str] = Counter()
    prior_statuses: Counter[tuple[int, str]] = Counter()
    automatic_reconsideration: Counter[tuple[int, str]] = Counter()
    snapshot_policy: Counter[str] = Counter()
    total = 0
    for row in rows:
        total += 1
        year = int(row.get("year", 0) or 0)
        previous_status = str(row.get("cost_status", "") or "")
        cost_requirement = (
            "ignored"
            if bool(row.get("ignored"))
            else "not_required"
            if previous_status == "no_cost_required"
            else "required"
        )
        lot_requirement = (
            "required"
            if str(row.get("sku_kind", "") or "") == "beer_format"
            and str(row.get("product_group", "") or "").casefold() != "giftset"
            else "not_required"
        )
        result = resolver.resolve_actual_lot_cost(
            str(row.get("sku_id", "") or ""),
            str(row.get("lot_number", "") or row.get("lot_internal_number", "") or ""),
            cost_requirement=cost_requirement,
            lot_requirement=lot_requirement,
            planning_year=year,
        )
        statuses[(year, result.status)] += 1
        prior_statuses[(year, previous_status)] += 1
        if douano_margin_snapshot_storage.is_recomputable_cost_status(
            previous_status
        ) and year >= int(active_year):
            automatic_reconsideration[(year, result.status)] += 1
            snapshot_policy["reconsidered_by_regular_sync"] += 1
        else:
            snapshot_policy["finalized_snapshot_preserved"] += 1
        previous_version = str(row.get("cost_version_id", "") or "")
        if result.cost_version_id and result.cost_version_id == previous_version:
            version_comparison["same_version"] += 1
        elif result.cost_version_id:
            version_comparison["different_version"] += 1
        else:
            version_comparison["unresolved_or_not_applicable"] += 1
    return {
        "scope": "invoice_snapshots",
        "active_commercial_year": int(active_year),
        "rows": total,
        "projected_status_counts": {
            f"{year}:{status}": count
            for (year, status), count in sorted(statuses.items())
        },
        "prior_status_counts": {
            f"{year}:{status}": count
            for (year, status), count in sorted(prior_statuses.items())
        },
        "automatic_reconsideration_counts": {
            f"{year}:{status}": count
            for (year, status), count in sorted(automatic_reconsideration.items())
        },
        "snapshot_policy_counts": dict(sorted(snapshot_policy.items())),
        "version_comparison": dict(sorted(version_comparison.items())),
        "contains_identifiers_or_amounts": False,
    }


def read_invoice_snapshot_rows() -> list[dict[str, Any]]:
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SET TRANSACTION READ ONLY")
            cur.execute(
                """
                SELECT EXTRACT(YEAR FROM snap.line_date)::int,
                       snap.sku_id,
                       snap.lot_number,
                       snap.lot_internal_number,
                       snap.cost_status,
                       snap.kostprijsversie_id,
                       snap.ignored,
                       COALESCE(s.kind, ''),
                       LOWER(COALESCE(s.payload->>'product_group', ''))
                FROM douano_sales_line_cost_snapshots snap
                LEFT JOIN skus s ON s.id = snap.sku_id
                WHERE snap.source_type = 'invoice'
                ORDER BY snap.source_line_id
                """
            )
            rows = cur.fetchall() or []
        conn.rollback()
    return [
        {
            "year": int(row[0] or 0),
            "sku_id": str(row[1] or ""),
            "lot_number": str(row[2] or ""),
            "lot_internal_number": str(row[3] or ""),
            "cost_status": str(row[4] or ""),
            "cost_version_id": str(row[5] or ""),
            "ignored": bool(row[6]),
            "sku_kind": str(row[7] or ""),
            "product_group": str(row[8] or ""),
        }
        for row in rows
    ]


def read_active_commercial_year() -> int:
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SET TRANSACTION READ ONLY")
            cur.execute(
                """
                SELECT operational_year
                FROM commercial_yearsets
                WHERE status = 'active'
                ORDER BY activated_at DESC NULLS LAST, id
                """
            )
            rows = cur.fetchall() or []
        conn.rollback()
    if len(rows) != 1:
        raise RuntimeError(
            "Audit verwacht exact één actieve commerciële jaarset en stopt fail-closed."
        )
    year = int(rows[0][0] or 0)
    if year <= 0:
        raise RuntimeError("Actieve commerciële jaarset ontbreekt; audit stopt fail-closed.")
    return year


def read_multiple_lot_allocation_count() -> int:
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SET TRANSACTION READ ONLY")
            cur.execute(
                """
                SELECT COUNT(*)::int
                FROM (
                    SELECT transaction_number, LOWER(sku_code)
                    FROM sales_lot_allocations
                    GROUP BY transaction_number, LOWER(sku_code)
                    HAVING COUNT(
                        DISTINCT LOWER(NULLIF(TRIM(lot_number), ''))
                    ) > 1
                ) conflicts
                """
            )
            row = cur.fetchone()
        conn.rollback()
    return int((row or [0])[0] or 0)


def main() -> int:
    service = ReadOnlyCostResolutionService(
        PostgresCostResolutionSnapshotReader()
    )
    active_year = read_active_commercial_year()
    report = build_report(
        read_invoice_snapshot_rows(),
        service.actual,
        active_year=active_year,
    )
    report["multiple_lot_transaction_sku_keys"] = (
        read_multiple_lot_allocation_count()
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
