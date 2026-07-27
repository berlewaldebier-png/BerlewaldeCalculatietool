from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from scripts.disposable_postgres_guard import (  # noqa: E402
    DISPOSABLE_DATABASE_OPT_IN,
    assert_disposable_database_url,
    database_url_from_environment,
)
from scripts.rf013a_rehearse_authority import (  # noqa: E402
    _schema_by_table,
    compare_additive_rehearsal,
)
from scripts.rf013p_data_baseline import (  # noqa: E402
    PRIVATE_OUTPUT_ROOT,
    capture_from_connection_info,
    compare_manifests,
)


ALLOWED_NEW_TABLES = {
    "canonical_beers",
    "canonical_lot_cost_lineage",
    "canonical_sku_subjects",
    "cost_authority_mapping_manifest",
    "cost_version_subjects",
    "planning_cost_anchor_events",
    "planning_cost_anchors",
    "planning_cost_rebaseline_requests",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Rehearse RF-013B on an explicitly disposable RF-013P restore. "
            "Every pre-existing table and schema fingerprint must remain exact."
        )
    )
    parser.add_argument("--years", nargs="+", type=int, default=[2025, 2026])
    parser.add_argument("--expected-baseline", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--acknowledge-disposable-write",
        action="store_true",
        help="Required acknowledgement for the additive authority/backfill write.",
    )
    return parser.parse_args()


def _private_output(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    try:
        resolved.relative_to(PRIVATE_OUTPUT_ROOT)
    except ValueError as exc:
        raise ValueError(
            f"RF-013B output must stay under ignored {PRIVATE_OUTPUT_ROOT}."
        ) from exc
    if resolved.suffix.lower() != ".json":
        raise ValueError("RF-013B rehearsal output must use .json.")
    return resolved


def main() -> None:
    args = parse_args()
    if not args.acknowledge_disposable_write:
        raise SystemExit("Pass --acknowledge-disposable-write.")
    if os.getenv(DISPOSABLE_DATABASE_OPT_IN, "").strip() != "1":
        raise SystemExit(
            f"Set {DISPOSABLE_DATABASE_OPT_IN}=1 before running the rehearsal."
        )
    if os.getenv("CALCULATIETOOL_ENV", "").strip().lower() not in {
        "local",
        "dev",
        "development",
        "test",
    }:
        raise SystemExit("RF-013B requires an explicit non-production environment.")

    database_url = database_url_from_environment()
    target = assert_disposable_database_url(database_url)
    if target.host not in {"127.0.0.1", "::1", "localhost"}:
        raise SystemExit("RF-013B requires a loopback PostgreSQL target.")

    expected = json.loads(args.expected_baseline.read_text(encoding="utf-8"))
    before = capture_from_connection_info(database_url, years=args.years)
    baseline_differences = compare_manifests(before, expected)
    if baseline_differences:
        raise SystemExit(
            "Restored database differs from RF-013P baseline: "
            + ", ".join(baseline_differences)
        )
    before_schema = _schema_by_table(database_url)

    from app.domain import cost_authority_service, cost_authority_storage  # noqa: E402

    dry_run = cost_authority_service.backfill_legacy_authority(
        actor="rf013b-disposable-rehearsal",
        dry_run=True,
    )
    applied = cost_authority_service.backfill_legacy_authority(
        actor="rf013b-disposable-rehearsal",
        dry_run=False,
        expected_manifest_hash=str(dry_run["manifest_hash"]),
    )
    repeated = cost_authority_service.backfill_legacy_authority(
        actor="rf013b-disposable-rehearsal",
        dry_run=False,
        expected_manifest_hash=str(dry_run["manifest_hash"]),
    )
    after = capture_from_connection_info(database_url, years=args.years)
    after_schema = _schema_by_table(database_url)
    differences = compare_additive_rehearsal(
        before,
        after,
        before_schema=before_schema,
        after_schema=after_schema,
        allowed_new_tables=ALLOWED_NEW_TABLES,
    )
    if differences:
        raise SystemExit(
            "RF-013B changed protected pre-existing state: " + ", ".join(differences)
        )
    if int(repeated.get("applied", {}).get("planning_cost_anchors", 0) or 0) != 0:
        raise SystemExit("RF-013B repeat unexpectedly created a second planning anchor.")

    overview = cost_authority_storage.authority_overview()
    output = _private_output(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "version": "rf-013b-v1",
        "databaseClassification": "disposable-loopback-rf013p-restore",
        "baselineMatched": True,
        "preexistingDataAndSchemaUnchanged": True,
        "idempotentRepeat": True,
        "consumerMode": "compatibility_only",
        "allowedNewTables": sorted(ALLOWED_NEW_TABLES),
        "manifestHash": str(dry_run["manifest_hash"]),
        "ready": bool(dry_run["ready"]),
        "counts": dict(dry_run["counts"]),
        "blockerCounts": dict(dry_run["blocker_counts"]),
        "appliedCounts": dict(applied.get("applied", {})),
        "authorityCounts": dict(overview.get("counts", {})),
    }
    output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        "RF-013B rehearsal passed: RF-013P baseline matched, every pre-existing "
        "schema/data fingerprint stayed exact, additive backfill was idempotent, "
        "and consumers remain on compatibility reads."
    )


if __name__ == "__main__":
    main()
