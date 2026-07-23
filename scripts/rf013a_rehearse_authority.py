from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any, Iterable


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
from scripts.rf013p_data_baseline import (  # noqa: E402
    PRIVATE_OUTPUT_ROOT,
    _schema_records,
    capture_from_connection_info,
    compare_manifests,
    fingerprint,
)


ALLOWED_NEW_TABLES = {
    "commercial_yearset_events",
    "commercial_yearsets",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Rehearse RF-013A on an explicitly disposable loopback PostgreSQL restore. "
            "Existing table schema and data must remain byte-fingerprint equivalent."
        )
    )
    parser.add_argument("--source-year", required=True, type=int)
    parser.add_argument("--operational-year", required=True, type=int)
    parser.add_argument("--expected-baseline", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--acknowledge-disposable-write",
        action="store_true",
        help="Required acknowledgement that two additive tables/candidate rows are written.",
    )
    return parser.parse_args()


def _schema_by_table(connection_info: str) -> dict[str, str]:
    import psycopg

    with psycopg.connect(connection_info) as connection:
        grouped: dict[str, list[tuple[Any, ...]]] = {}
        for record in _schema_records(connection):
            table_name = str(record[1])
            grouped.setdefault(table_name, []).append(record)
    return {
        table_name: fingerprint(records, f"schema-table:{table_name}")
        for table_name, records in sorted(grouped.items())
    }


def compare_additive_rehearsal(
    before: dict[str, Any],
    after: dict[str, Any],
    *,
    before_schema: dict[str, str],
    after_schema: dict[str, str],
    allowed_new_tables: Iterable[str] = ALLOWED_NEW_TABLES,
) -> list[str]:
    differences: list[str] = []
    allowed = set(allowed_new_tables)
    before_tables = before.get("tables", {}).get("records", {})
    after_tables = after.get("tables", {}).get("records", {})
    before_names = set(before_tables)
    after_names = set(after_tables)

    if before_names.difference(after_names):
        differences.append("preexisting_tables_removed")
    if after_names.difference(before_names) != allowed:
        differences.append("unexpected_additive_tables")
    if {
        name: before_tables.get(name)
        for name in sorted(before_names)
    } != {
        name: after_tables.get(name)
        for name in sorted(before_names)
    }:
        differences.append("preexisting_table_data")
    if {
        name: before_schema.get(name)
        for name in sorted(before_names)
    } != {
        name: after_schema.get(name)
        for name in sorted(before_names)
    }:
        differences.append("preexisting_table_schema")
    for section in ("appDatasets", "perYear", "integrity"):
        if before.get(section) != after.get(section):
            differences.append(section)
    return differences


def _private_output(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    try:
        resolved.relative_to(PRIVATE_OUTPUT_ROOT)
    except ValueError as exc:
        raise ValueError(
            f"RF-013A output must stay under ignored {PRIVATE_OUTPUT_ROOT}."
        ) from exc
    if resolved.suffix.lower() != ".json":
        raise ValueError("RF-013A rehearsal output must use .json.")
    return resolved


def main() -> None:
    args = parse_args()
    if not args.acknowledge_disposable_write:
        raise SystemExit("Pass --acknowledge-disposable-write.")
    if os.getenv(DISPOSABLE_DATABASE_OPT_IN, "").strip() != "1":
        raise SystemExit(
            f"Set {DISPOSABLE_DATABASE_OPT_IN}=1 before running the rehearsal."
        )
    if args.source_year <= 0 or args.operational_year <= args.source_year:
        raise SystemExit("Use an explicit forward source/operational year pair.")

    database_url = database_url_from_environment()
    target = assert_disposable_database_url(database_url)
    if target.host not in {"127.0.0.1", "::1", "localhost"}:
        raise SystemExit("RF-013A rehearsal requires a loopback PostgreSQL target.")
    if os.getenv("CALCULATIETOOL_ENV", "").strip().lower() not in {
        "local",
        "dev",
        "development",
        "test",
    }:
        raise SystemExit("RF-013A rehearsal requires an explicit non-production environment.")

    expected = json.loads(args.expected_baseline.read_text(encoding="utf-8"))
    before = capture_from_connection_info(
        database_url,
        years=[args.source_year, args.operational_year],
    )
    baseline_differences = compare_manifests(before, expected)
    if baseline_differences:
        raise SystemExit(
            "Restored database differs from RF-013P baseline: "
            + ", ".join(baseline_differences)
        )
    before_schema = _schema_by_table(database_url)

    from app.domain import (  # noqa: E402
        commercial_yearset_service,
        commercial_yearset_storage,
    )

    result = commercial_yearset_service.create_legacy_candidate(
        source_year=args.source_year,
        operational_year=args.operational_year,
        actor="rf013a-disposable-rehearsal",
        dry_run=False,
    )
    after = capture_from_connection_info(
        database_url,
        years=[args.source_year, args.operational_year],
    )
    after_schema = _schema_by_table(database_url)
    differences = compare_additive_rehearsal(
        before,
        after,
        before_schema=before_schema,
        after_schema=after_schema,
    )
    active = commercial_yearset_storage.get_active_generation()
    candidate = result.get("candidate") or {}
    readiness = result.get("readiness") or {}
    if differences:
        raise SystemExit(
            "RF-013A changed protected pre-existing state: " + ", ".join(differences)
        )
    if active:
        raise SystemExit("RF-013A rehearsal unexpectedly activated a commercial yearset.")
    if candidate.get("readiness_status") != "blocked":
        raise SystemExit(
            "Known incomplete restored yearset was expected to remain a blocked candidate."
        )

    output = _private_output(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "version": "rf-013a-v1",
        "databaseClassification": "disposable-loopback-restore",
        "sourceYear": args.source_year,
        "operationalYear": args.operational_year,
        "baselineMatched": True,
        "preexistingDataAndSchemaUnchanged": True,
        "allowedNewTables": sorted(ALLOWED_NEW_TABLES),
        "candidate": {
            "id": candidate.get("id", ""),
            "status": candidate.get("status", ""),
            "readinessStatus": candidate.get("readiness_status", ""),
            "validationHash": candidate.get("validation_hash", ""),
        },
        "readiness": {
            "ready": bool(readiness.get("ready")),
            "blockers": list(readiness.get("blockers") or []),
            "counts": dict(readiness.get("counts") or {}),
        },
        "activeGenerationCount": 0,
    }
    output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        "RF-013A rehearsal passed: RF-013P baseline matched, pre-existing schema/data "
        "unchanged, blocked candidate retained, no active generation."
    )


if __name__ == "__main__":
    main()
