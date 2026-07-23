from __future__ import annotations

import argparse
from decimal import Decimal
import hashlib
from ipaddress import ip_address
import json
import os
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit


SCHEMA_VERSION = 1
PROJECT_ROOT = Path(__file__).resolve().parents[1]
PRIVATE_OUTPUT_ROOT = (PROJECT_ROOT / "outputs" / "rf013p").resolve()
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}
DEVELOPMENT_ENVIRONMENTS = {"local", "dev", "development"}

CRITICAL_TABLES = (
    "app_datasets",
    "beers",
    "articles",
    "skus",
    "bom_lines",
    "product_families",
    "sku_family_links",
    "sku_composition_lines",
    "cost_versions",
    "cost_version_sku_rows",
    "cost_version_lots",
    "kostprijs_sku_activations",
    "kostprijs_sku_activation_events",
    "purchase_lots",
    "purchase_lot_sku_costs",
    "lot_alias_mappings",
    "lot_cost_records",
    "sales_lot_allocations",
    "douano_product_mapping",
    "advice_channel_pricing",
    "sales_pricing_records",
    "new_year_drafts",
    "break_even_plan_snapshots",
    "break_even_reforecast_snapshots",
    "year_close_snapshots",
    "quote_drafts",
    "douano_sales_line_cost_snapshots",
)

CRITICAL_APP_DATASETS = (
    "bieren",
    "break-even-configuraties",
    "kostprijs-target-engine-rows",
    "packaging-component-prices",
    "packaging-components",
    "productie",
    "vaste-kosten",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Capture an RF-013P read-only PostgreSQL baseline containing only aggregate counts "
            "and domain-separated SHA-256 fingerprints."
        )
    )
    parser.add_argument("--years", type=int, nargs="+", default=[2025, 2026])
    parser.add_argument(
        "--allow-private-development-host",
        action="store_true",
        help="Permit an IP-literal private development host in an explicit local/dev environment.",
    )
    parser.add_argument(
        "--acknowledge-aggregate-fingerprints",
        action="store_true",
        help="Acknowledge that the result contains schema/table names, counts and fingerprints.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional private manifest path; must remain under ignored outputs/rf013p/.",
    )
    parser.add_argument(
        "--compare",
        type=Path,
        help="Fail when the captured manifest differs from this earlier private manifest.",
    )
    return parser.parse_args()


def stable_json(value: Any) -> str:
    def normalize(item: Any) -> Any:
        if isinstance(item, Decimal):
            return str(item)
        if isinstance(item, dict):
            return {str(key): normalize(item[key]) for key in sorted(item)}
        if isinstance(item, (list, tuple)):
            return [normalize(child) for child in item]
        if hasattr(item, "isoformat"):
            return item.isoformat()
        return item

    return json.dumps(normalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def fingerprint(value: Any, domain: str) -> str:
    payload = f"rf013p:{domain}:".encode("utf-8") + stable_json(value).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def fingerprint_rowset(serialized_rows: Iterable[str], domain: str) -> str:
    """Fingerprint a row multiset without relying on database collation order."""
    digest = hashlib.sha256(f"rf013p:{domain}:".encode("utf-8"))
    for row in sorted(str(value or "").encode("utf-8") for value in serialized_rows):
        digest.update(row)
        digest.update(b"\n")
    return f"sha256:{digest.hexdigest()}"


def normalize_years(values: Iterable[int]) -> tuple[int, ...]:
    years = tuple(sorted({int(value) for value in values if int(value) > 0}))
    if not years:
        raise ValueError("RF-013P requires at least one positive year.")
    return years


def validate_source_target(
    host: str,
    environment: str,
    *,
    allow_private_development_host: bool,
) -> None:
    normalized_host = str(host or "").strip().lower()
    normalized_environment = str(environment or "").strip().lower()
    if normalized_environment not in DEVELOPMENT_ENVIRONMENTS:
        raise SystemExit(
            "Refusing RF-013P capture: CALCULATIETOOL_ENV must explicitly be local, dev or development."
        )
    if normalized_host in LOOPBACK_HOSTS:
        return
    try:
        private_address = ip_address(normalized_host).is_private
    except ValueError:
        private_address = False
    if private_address and allow_private_development_host:
        return
    raise SystemExit(
        "Refusing RF-013P capture: PostgreSQL must be loopback or an explicitly acknowledged "
        "private IP development host."
    )


def connection_info_from_environment() -> tuple[str | dict[str, str], str]:
    configured_url = os.getenv("CALCULATIETOOL_POSTGRES_URL", "").strip()
    if configured_url:
        parsed = urlsplit(configured_url)
        host = str(parsed.hostname or "").strip().lower()
        if parsed.scheme not in {"postgres", "postgresql"} or not host:
            raise SystemExit("RF-013P requires a valid postgres/postgresql URL.")
        return configured_url, host

    required = {
        "host": os.getenv("CALCULATIETOOL_POSTGRES_HOST", "").strip(),
        "port": os.getenv("CALCULATIETOOL_POSTGRES_PORT", "5432").strip(),
        "dbname": os.getenv("CALCULATIETOOL_POSTGRES_DB", "").strip(),
        "user": os.getenv("CALCULATIETOOL_POSTGRES_USER", "").strip(),
        "password": os.getenv("CALCULATIETOOL_POSTGRES_PASSWORD", "").strip(),
    }
    if not all(required.values()):
        raise SystemExit("RF-013P PostgreSQL connection environment is incomplete.")
    return required, required["host"].lower()


def assert_private_output_path(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    try:
        resolved.relative_to(PRIVATE_OUTPUT_ROOT)
    except ValueError as exc:
        raise ValueError(
            f"RF-013P private artifacts must stay under {PRIVATE_OUTPUT_ROOT}."
        ) from exc
    if resolved.suffix.lower() != ".json":
        raise ValueError("RF-013P baseline manifests must use the .json extension.")
    return resolved


def compare_manifests(actual: dict[str, Any], expected: dict[str, Any]) -> list[str]:
    sections = ("schema", "tables", "appDatasets", "perYear", "integrity")
    differences: list[str] = []
    for section in sections:
        if actual.get(section) != expected.get(section):
            differences.append(section)
    return differences


def _schema_records(connection: Any) -> list[tuple[Any, ...]]:
    records: list[tuple[Any, ...]] = []
    records.extend(
        connection.execute(
            """
            SELECT 'column', table_name, column_name, ordinal_position::text,
                   data_type, is_nullable, COALESCE(column_default, '')
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
            """
        ).fetchall()
    )
    records.extend(
        connection.execute(
            """
            SELECT 'constraint', conrelid::regclass::text, conname, contype::text,
                   pg_get_constraintdef(oid), '', ''
            FROM pg_constraint
            WHERE connamespace = 'public'::regnamespace
            ORDER BY conrelid::regclass::text, conname
            """
        ).fetchall()
    )
    records.extend(
        connection.execute(
            """
            SELECT 'index', tablename, indexname, indexdef, '', '', ''
            FROM pg_indexes
            WHERE schemaname = 'public'
            ORDER BY tablename, indexname
            """
        ).fetchall()
    )
    return sorted(records, key=stable_json)


def _table_names(connection: Any) -> list[str]:
    return [
        str(row[0])
        for row in connection.execute(
            """
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
            """
        ).fetchall()
    ]


def _table_fingerprint(connection: Any, table_name: str) -> dict[str, Any]:
    from psycopg import sql

    query = sql.SQL("SELECT to_jsonb(t)::text FROM {} AS t").format(
        sql.Identifier(table_name)
    )
    serialized_rows = [str(row[0] or "") for row in connection.execute(query)]
    return {
        "rows": len(serialized_rows),
        "fingerprint": fingerprint_rowset(
            serialized_rows,
            f"table:{table_name}",
        ),
    }


def _app_dataset_manifest(connection: Any, tables: set[str]) -> dict[str, Any]:
    if "app_datasets" not in tables:
        return {
            "rows": 0,
            "fingerprint": fingerprint([], "app-datasets"),
            "datasets": {},
            "missingCritical": list(CRITICAL_APP_DATASETS),
        }
    rows = connection.execute(
        "SELECT dataset_name, payload::text FROM app_datasets ORDER BY dataset_name"
    ).fetchall()
    datasets = {
        str(name): fingerprint(str(payload or ""), f"app-dataset:{name}")
        for name, payload in rows
    }
    return {
        "rows": len(rows),
        "fingerprint": fingerprint(sorted(datasets.items()), "app-datasets"),
        "datasets": datasets,
        "missingCritical": sorted(set(CRITICAL_APP_DATASETS).difference(datasets)),
    }


def _count_by_year(
    connection: Any,
    tables: set[str],
    *,
    table: str,
    year_column: str,
    years: tuple[int, ...],
) -> dict[str, int]:
    if table not in tables:
        return {str(year): 0 for year in years}
    from psycopg import sql

    query = sql.SQL(
        "SELECT {year}, COUNT(*)::int FROM {table} "
        "WHERE {year} = ANY(%s) GROUP BY {year} ORDER BY {year}"
    ).format(year=sql.Identifier(year_column), table=sql.Identifier(table))
    found = {
        str(int(year)): int(count or 0)
        for year, count in connection.execute(query, (list(years),)).fetchall()
    }
    return {str(year): found.get(str(year), 0) for year in years}


def _cost_rows_by_year(
    connection: Any, tables: set[str], years: tuple[int, ...]
) -> dict[str, int]:
    if not {"cost_versions", "cost_version_sku_rows"}.issubset(tables):
        return {str(year): 0 for year in years}
    rows = connection.execute(
        """
        SELECT v.jaar, COUNT(*)::int
        FROM cost_version_sku_rows r
        JOIN cost_versions v ON v.id = r.version_id
        WHERE v.jaar = ANY(%s)
        GROUP BY v.jaar
        ORDER BY v.jaar
        """,
        (list(years),),
    ).fetchall()
    found = {str(int(year)): int(count or 0) for year, count in rows}
    return {str(year): found.get(str(year), 0) for year in years}


def _activation_cost_coverage_by_year(
    connection: Any, tables: set[str], years: tuple[int, ...]
) -> dict[str, dict[str, int]]:
    empty = {
        str(year): {"openActivations": 0, "withCostRow": 0, "missingCostRow": 0}
        for year in years
    }
    if not {
        "kostprijs_sku_activations",
        "cost_version_sku_rows",
    }.issubset(tables):
        return empty
    rows = connection.execute(
        """
        SELECT
            a.jaar,
            COUNT(*)::int AS open_activations,
            COUNT(r.id)::int AS with_cost_row,
            (COUNT(*) - COUNT(r.id))::int AS missing_cost_row
        FROM kostprijs_sku_activations a
        LEFT JOIN cost_version_sku_rows r
          ON r.version_id = a.kostprijsversie_id
         AND r.sku_id = a.sku_id
        WHERE a.effectief_tot IS NULL
          AND a.jaar = ANY(%s)
        GROUP BY a.jaar
        ORDER BY a.jaar
        """,
        (list(years),),
    ).fetchall()
    for year, activations, matched, missing in rows:
        empty[str(int(year))] = {
            "openActivations": int(activations or 0),
            "withCostRow": int(matched or 0),
            "missingCostRow": int(missing or 0),
        }
    return empty


def _integrity_manifest(connection: Any, tables: set[str]) -> dict[str, int]:
    checks: dict[str, int] = {}

    def scalar(name: str, query: str) -> None:
        row = connection.execute(query).fetchone()
        checks[name] = int((row[0] if row else 0) or 0)

    if {"cost_version_sku_rows", "cost_versions"}.issubset(tables):
        scalar(
            "costRowsMissingVersion",
            """
            SELECT COUNT(*) FROM cost_version_sku_rows r
            LEFT JOIN cost_versions v ON v.id = r.version_id
            WHERE v.id IS NULL
            """,
        )
    if {"cost_version_sku_rows", "skus"}.issubset(tables):
        scalar(
            "costRowsMissingSku",
            """
            SELECT COUNT(*) FROM cost_version_sku_rows r
            LEFT JOIN skus s ON s.id = r.sku_id
            WHERE s.id IS NULL
            """,
        )
    if "cost_version_sku_rows" in tables:
        scalar(
            "duplicateCostVersionSkuScopes",
            """
            SELECT COUNT(*) FROM (
                SELECT version_id, sku_id
                FROM cost_version_sku_rows
                GROUP BY version_id, sku_id
                HAVING COUNT(*) > 1
            ) duplicates
            """,
        )
    if {"kostprijs_sku_activations", "skus"}.issubset(tables):
        scalar(
            "activationsMissingSku",
            """
            SELECT COUNT(*) FROM kostprijs_sku_activations a
            LEFT JOIN skus s ON s.id = a.sku_id
            WHERE s.id IS NULL
            """,
        )
    if {"kostprijs_sku_activations", "cost_versions"}.issubset(tables):
        scalar(
            "activationsMissingVersion",
            """
            SELECT COUNT(*) FROM kostprijs_sku_activations a
            LEFT JOIN cost_versions v ON v.id = a.kostprijsversie_id
            WHERE v.id IS NULL
            """,
        )
    if "kostprijs_sku_activations" in tables:
        scalar(
            "duplicateOpenActivationScopes",
            """
            SELECT COUNT(*) FROM (
                SELECT sku_id, jaar
                FROM kostprijs_sku_activations
                WHERE effectief_tot IS NULL
                GROUP BY sku_id, jaar
                HAVING COUNT(*) > 1
            ) duplicates
            """,
        )
    if {
        "kostprijs_sku_activations",
        "cost_version_sku_rows",
    }.issubset(tables):
        scalar(
            "openActivationsMissingCostRow",
            """
            SELECT COUNT(*)
            FROM kostprijs_sku_activations a
            LEFT JOIN cost_version_sku_rows r
              ON r.version_id = a.kostprijsversie_id
             AND r.sku_id = a.sku_id
            WHERE a.effectief_tot IS NULL
              AND r.id IS NULL
            """,
        )
    return checks


def capture(connection: Any, *, years: Iterable[int]) -> dict[str, Any]:
    normalized_years = normalize_years(years)
    schema_records = _schema_records(connection)
    table_names = _table_names(connection)
    tables = set(table_names)
    table_manifest = {
        table_name: _table_fingerprint(connection, table_name)
        for table_name in table_names
    }
    return {
        "schemaVersion": SCHEMA_VERSION,
        "fixtureSet": "RF-013P-protected-data-baseline",
        "classification": {
            "mode": "read-only-private-development-fingerprint",
            "containsRawCommercialValues": False,
            "containsRawBusinessIdentifiers": False,
            "containsSchemaIdentifiers": True,
        },
        "years": list(normalized_years),
        "schema": {
            "records": len(schema_records),
            "fingerprint": fingerprint(schema_records, "public-schema"),
        },
        "tables": {
            "count": len(table_names),
            "missingCritical": sorted(set(CRITICAL_TABLES).difference(tables)),
            "records": table_manifest,
            "fingerprint": fingerprint(table_manifest, "all-public-tables"),
        },
        "appDatasets": _app_dataset_manifest(connection, tables),
        "perYear": {
            "costVersions": _count_by_year(
                connection,
                tables,
                table="cost_versions",
                year_column="jaar",
                years=normalized_years,
            ),
            "costRows": _cost_rows_by_year(connection, tables, normalized_years),
            "activationCostCoverage": _activation_cost_coverage_by_year(
                connection, tables, normalized_years
            ),
            "activations": _count_by_year(
                connection,
                tables,
                table="kostprijs_sku_activations",
                year_column="jaar",
                years=normalized_years,
            ),
            "adviceChannels": _count_by_year(
                connection,
                tables,
                table="advice_channel_pricing",
                year_column="jaar",
                years=normalized_years,
            ),
            "salesPricing": _count_by_year(
                connection,
                tables,
                table="sales_pricing_records",
                year_column="jaar",
                years=normalized_years,
            ),
        },
        "integrity": _integrity_manifest(connection, tables),
    }


def capture_from_connection_info(
    connection_info: str | dict[str, str], *, years: Iterable[int]
) -> dict[str, Any]:
    import psycopg

    connect_args: tuple[Any, ...] = (connection_info,) if isinstance(connection_info, str) else ()
    connect_kwargs = connection_info if isinstance(connection_info, dict) else {}
    with psycopg.connect(*connect_args, **connect_kwargs, autocommit=True) as connection:
        with connection.transaction():
            connection.execute("SET TRANSACTION READ ONLY")
            read_only = connection.execute("SHOW transaction_read_only").fetchone()
            if not read_only or str(read_only[0]).lower() != "on":
                raise RuntimeError("RF-013P capture transaction is not read-only.")
            return capture(connection, years=years)


def main() -> None:
    args = parse_args()
    if not args.acknowledge_aggregate_fingerprints:
        raise SystemExit(
            "Refusing RF-013P capture: pass --acknowledge-aggregate-fingerprints."
        )
    years = normalize_years(args.years)
    connection_info, host = connection_info_from_environment()
    validate_source_target(
        host,
        os.getenv("CALCULATIETOOL_ENV", "").strip().lower(),
        allow_private_development_host=args.allow_private_development_host,
    )
    manifest = capture_from_connection_info(connection_info, years=years)

    if args.compare:
        expected = json.loads(args.compare.read_text(encoding="utf-8"))
        differences = compare_manifests(manifest, expected)
        if differences:
            raise SystemExit(
                "RF-013P baseline differs in protected sections: " + ", ".join(differences)
            )

    serialized = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        output_path = assert_private_output_path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(serialized + "\n", encoding="utf-8")
        print(
            "RF-013P private baseline written under ignored outputs/rf013p; "
            "no raw identifiers or commercial values emitted."
        )
    else:
        print(serialized)


if __name__ == "__main__":
    main()
