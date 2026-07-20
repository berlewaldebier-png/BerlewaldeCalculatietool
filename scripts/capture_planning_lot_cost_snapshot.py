from __future__ import annotations

import argparse
from datetime import date
import json
import os
from pathlib import Path
from typing import Any

try:
    from scripts.capture_active_commercial_context import aliases, validate_capture_target
    from scripts.planning_lot_cost_snapshot import build_private_manifest, fingerprint, text
except ModuleNotFoundError:  # Direct `python scripts/...py` execution.
    from capture_active_commercial_context import aliases, validate_capture_target  # type: ignore[no-redef]
    from planning_lot_cost_snapshot import build_private_manifest, fingerprint, text  # type: ignore[no-redef]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture an RF-010B read-only planning/LOT fingerprint manifest."
    )
    parser.add_argument("--baseline-commit", required=True)
    parser.add_argument("--years", type=int, nargs="+", default=[2025, 2026])
    parser.add_argument("--captured-at", default=date.today().isoformat())
    parser.add_argument("--allow-private-development-host", action="store_true")
    parser.add_argument(
        "--verify-manifest",
        type=Path,
        help="Compare the aggregate audit and fingerprints with a committed manifest.",
    )
    parser.add_argument(
        "--acknowledge-pseudonymous-structure",
        action="store_true",
        help="Confirm that only aggregate counts and hashes may be emitted and committed.",
    )
    return parser.parse_args()


def _lot_exact_key(value: Any) -> str:
    return "".join(char for char in text(value).upper() if char.isalnum())


def main() -> None:
    args = parse_args()
    years = sorted({int(year) for year in args.years if int(year) > 0})
    if not years:
        raise SystemExit("RF-010B requires at least one positive year.")
    host = os.getenv("CALCULATIETOOL_POSTGRES_HOST", "").strip().lower()
    environment = os.getenv("CALCULATIETOOL_ENV", "local").strip().lower()
    validate_capture_target(
        host,
        environment,
        allow_private_development_host=args.allow_private_development_host,
    )
    if not args.acknowledge_pseudonymous_structure:
        raise SystemExit(
            "Refusing RF-010B capture: pass --acknowledge-pseudonymous-structure. "
            "The command emits only aggregate counts and fingerprints."
        )

    import psycopg

    with psycopg.connect(
        host=os.environ["CALCULATIETOOL_POSTGRES_HOST"],
        port=os.getenv("CALCULATIETOOL_POSTGRES_PORT", "5432"),
        dbname=os.environ["CALCULATIETOOL_POSTGRES_DB"],
        user=os.environ["CALCULATIETOOL_POSTGRES_USER"],
        password=os.environ["CALCULATIETOOL_POSTGRES_PASSWORD"],
        autocommit=True,
    ) as connection:
        with connection.transaction():
            connection.execute("SET TRANSACTION READ ONLY")
            read_only = connection.execute("SHOW transaction_read_only").fetchone()
            if not read_only or str(read_only[0]).lower() != "on":
                raise RuntimeError("RF-010B capture transaction is not read-only.")
            payload = capture(connection, years=years)

    manifest = build_private_manifest(
        payload,
        baseline_commit=args.baseline_commit,
        captured_at=args.captured_at,
    )
    if args.verify_manifest:
        expected = json.loads(args.verify_manifest.read_text(encoding="utf-8"))
        if manifest.get("audit") != expected.get("audit") or manifest.get("fingerprints") != expected.get("fingerprints"):
            raise SystemExit("RF-010B private development fingerprint baseline differs.")
        print("RF-010B private development fingerprint baseline OK; no commercial values emitted")
        return
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


def capture(connection: Any, *, years: list[int]) -> dict[str, Any]:
    activation_rows = connection.execute(
        """
        SELECT id, sku_id, jaar, kostprijsversie_id, effectief_vanaf,
               effectief_tot, created_at, updated_at
        FROM kostprijs_sku_activations
        WHERE jaar = ANY(%s)
        ORDER BY jaar, sku_id, effectief_vanaf, id
        """,
        (years,),
    ).fetchall()
    event_rows = connection.execute(
        """
        SELECT id, created_at, action, sku_id, jaar, kostprijsversie_id,
               effectief_vanaf, metadata
        FROM kostprijs_sku_activation_events
        WHERE jaar = ANY(%s)
        ORDER BY jaar, sku_id, created_at, id
        """,
        (years,),
    ).fetchall()
    version_rows = connection.execute(
        """
        SELECT id, jaar, status, versie_nummer
        FROM cost_versions
        WHERE jaar = ANY(%s)
        ORDER BY jaar, versie_nummer, id
        """,
        (years,),
    ).fetchall()
    cost_rows = connection.execute(
        """
        SELECT r.id, r.version_id, r.sku_id, r.inkoop, r.verpakkingskosten,
               r.indirecte_kosten, r.accijns, r.kostprijs
        FROM cost_version_sku_rows r
        JOIN cost_versions v ON v.id = r.version_id
        WHERE v.jaar = ANY(%s)
        ORDER BY r.version_id, r.sku_id, r.id
        """,
        (years,),
    ).fetchall()
    version_lots = connection.execute(
        """
        SELECT l.version_id, l.lot_number
        FROM cost_version_lots l
        JOIN cost_versions v ON v.id = l.version_id
        WHERE v.jaar = ANY(%s)
        ORDER BY l.version_id, l.id
        """,
        (years,),
    ).fetchall()
    snapshot_rows = connection.execute(
        """
        SELECT id, EXTRACT(YEAR FROM line_date)::INTEGER, sku_id, lot_number,
               cost_source, cost_status, kostprijsversie_id,
               missing_cost, mapped, ignored
        FROM douano_sales_line_cost_snapshots
        WHERE EXTRACT(YEAR FROM line_date)::INTEGER = ANY(%s)
        ORDER BY line_date, source_type, source_line_id
        """,
        (years,),
    ).fetchall()

    sku_alias = aliases(
        [row[1] for row in activation_rows]
        + [row[3] for row in event_rows]
        + [row[2] for row in cost_rows]
        + [row[2] for row in snapshot_rows],
        "sku",
    )
    version_alias = aliases(
        [row[3] for row in activation_rows]
        + [row[5] for row in event_rows]
        + [row[0] for row in version_rows]
        + [row[1] for row in cost_rows]
        + [row[0] for row in version_lots]
        + [row[6] for row in snapshot_rows],
        "version",
    )
    lot_alias = aliases(
        [_lot_exact_key(row[1]) for row in version_lots]
        + [_lot_exact_key(row[3]) for row in snapshot_rows],
        "lot",
    )

    lots_by_version: dict[str, list[str]] = {}
    for version_id, lot_number in version_lots:
        lots_by_version.setdefault(text(version_id), []).append(_lot_exact_key(lot_number))

    versions: list[dict[str, Any]] = []
    for version_id, year, status, version_number in version_rows:
        raw_version = text(version_id)
        lots = lots_by_version.get(raw_version) or [""]
        for lot in lots:
            versions.append(
                {
                    "id": version_alias.get(raw_version, ""),
                    "jaar": int(year or 0),
                    "status": text(status).casefold(),
                    "versie_nummer": int(version_number or 0),
                    "lot_exact_key": lot_alias.get(lot, "") if lot else "",
                }
            )

    return {
        "activations": [
            {
                "id": f"activation-{index:04d}",
                "sku_id": sku_alias.get(text(row[1]), ""),
                "jaar": int(row[2] or 0),
                "kostprijsversie_id": version_alias.get(text(row[3]), ""),
                "effectief_vanaf": row[4],
                "effectief_tot": row[5],
                "created_at": row[6],
            }
            for index, row in enumerate(activation_rows, start=1)
        ],
        "activationEvents": [
            {
                "id": f"event-{index:04d}",
                "created_at": row[1],
                "action": text(row[2]).casefold(),
                "sku_id": sku_alias.get(text(row[3]), ""),
                "jaar": int(row[4] or 0),
                "kostprijsversie_id": version_alias.get(text(row[5]), ""),
                "effectief_vanaf": row[6],
                "metadata": {
                    "approved": bool((row[7] or {}).get("approved")) if isinstance(row[7], dict) else False
                },
            }
            for index, row in enumerate(event_rows, start=1)
        ],
        "versions": versions,
        "costRows": [
            {
                "id": f"cost-row-{index:04d}",
                "version_id": version_alias.get(text(row[1]), ""),
                "sku_id": sku_alias.get(text(row[2]), ""),
                "componentFingerprint": fingerprint(list(row[3:8]), "cost-components"),
            }
            for index, row in enumerate(cost_rows, start=1)
        ],
        "actualSnapshots": [
            {
                "id": f"actual-{index:05d}",
                "year": int(row[1] or 0),
                "sku_id": sku_alias.get(text(row[2]), ""),
                "lotKey": lot_alias.get(_lot_exact_key(row[3]), "") if text(row[3]) else "",
                "cost_source": text(row[4]).casefold(),
                "cost_status": text(row[5]).casefold(),
                "kostprijsversie_id": version_alias.get(text(row[6]), ""),
                "missing_cost": bool(row[7]),
                "mapped": bool(row[8]),
                "ignored": bool(row[9]),
            }
            for index, row in enumerate(snapshot_rows, start=1)
        ],
    }


if __name__ == "__main__":
    main()
