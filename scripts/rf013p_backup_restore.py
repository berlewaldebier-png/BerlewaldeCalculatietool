from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

try:
    from scripts.disposable_postgres_guard import assert_disposable_database_url
    from scripts.rf013p_data_baseline import (
        PRIVATE_OUTPUT_ROOT,
        assert_private_output_path,
        capture_from_connection_info,
        compare_manifests,
        connection_info_from_environment,
        normalize_years,
        validate_source_target,
    )
except ModuleNotFoundError:  # Direct `python scripts/...py` execution.
    from disposable_postgres_guard import assert_disposable_database_url  # type: ignore[no-redef]
    from rf013p_data_baseline import (  # type: ignore[no-redef]
        PRIVATE_OUTPUT_ROOT,
        assert_private_output_path,
        capture_from_connection_info,
        compare_manifests,
        connection_info_from_environment,
        normalize_years,
        validate_source_target,
    )


RESTORE_TARGET_ENV = "CALCULATIETOOL_RF013P_RESTORE_URL"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Create an RF-013P PostgreSQL custom backup and rehearse restoration into an "
            "explicitly guarded disposable loopback database."
        )
    )
    parser.add_argument("--years", type=int, nargs="+", default=[2025, 2026])
    parser.add_argument(
        "--backup-file",
        type=Path,
        default=PRIVATE_OUTPUT_ROOT / "calculatietool-rf013p.dump",
    )
    parser.add_argument("--pg-dump", type=Path)
    parser.add_argument("--pg-restore", type=Path)
    parser.add_argument("--allow-private-development-host", action="store_true")
    parser.add_argument("--acknowledge-sensitive-backup", action="store_true")
    return parser.parse_args()


def assert_private_backup_path(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    try:
        resolved.relative_to(PRIVATE_OUTPUT_ROOT)
    except ValueError as exc:
        raise ValueError(
            f"RF-013P backups must stay under ignored {PRIVATE_OUTPUT_ROOT}."
        ) from exc
    if resolved.suffix.lower() != ".dump":
        raise ValueError("RF-013P PostgreSQL backups must use the .dump extension.")
    return resolved


def resolve_binary(explicit: Path | None, executable_name: str) -> str:
    if explicit:
        resolved = explicit.expanduser().resolve()
        if not resolved.is_file():
            raise FileNotFoundError(f"{executable_name} was not found at the provided path.")
        return str(resolved)
    found = shutil.which(executable_name)
    if not found:
        raise FileNotFoundError(
            f"{executable_name} is required for RF-013P backup/restore rehearsal."
        )
    return found


def _connection_parts(connection_info: str | dict[str, str]) -> tuple[list[str], dict[str, str]]:
    if isinstance(connection_info, dict):
        host = str(connection_info["host"])
        port = str(connection_info["port"])
        database = str(connection_info["dbname"])
        user = str(connection_info["user"])
        password = str(connection_info["password"])
        sslmode = ""
    else:
        parsed = urlsplit(connection_info)
        if parsed.scheme not in {"postgres", "postgresql"}:
            raise ValueError("RF-013P accepts only postgres/postgresql connection URLs.")
        host = str(parsed.hostname or "")
        port = str(parsed.port or 5432)
        database = unquote(parsed.path.lstrip("/"))
        user = unquote(parsed.username or "")
        password = unquote(parsed.password or "")
        sslmode = str(parse_qs(parsed.query).get("sslmode", [""])[0])
    if not all((host, port, database, user)):
        raise ValueError("RF-013P PostgreSQL CLI connection details are incomplete.")
    args = ["--host", host, "--port", port, "--username", user, "--dbname", database]
    environment = os.environ.copy()
    if password:
        environment["PGPASSWORD"] = password
    if sslmode:
        environment["PGSSLMODE"] = sslmode
    return args, environment


def build_pg_dump_command(
    pg_dump: str,
    connection_info: str | dict[str, str],
    backup_file: Path,
) -> tuple[list[str], dict[str, str]]:
    connection_args, environment = _connection_parts(connection_info)
    command = [
        pg_dump,
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        str(backup_file),
        *connection_args,
    ]
    return command, environment


def build_pg_restore_command(
    pg_restore: str,
    restore_url: str,
    backup_file: Path,
) -> tuple[list[str], dict[str, str]]:
    connection_args, environment = _connection_parts(restore_url)
    command = [
        pg_restore,
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-privileges",
        *connection_args,
        str(backup_file),
    ]
    return command, environment


def _run(command: list[str], environment: dict[str, str], *, label: str) -> None:
    result = subprocess.run(
        command,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"RF-013P {label} failed with exit code {result.returncode}. "
            "Inspect the PostgreSQL client output locally; credentials are not printed."
        )


def assert_empty_restore_target(restore_url: str) -> None:
    import psycopg

    with psycopg.connect(restore_url) as connection:
        row = connection.execute(
            "SELECT COUNT(*)::int FROM pg_tables WHERE schemaname = 'public'"
        ).fetchone()
    if int((row[0] if row else 0) or 0) != 0:
        raise RuntimeError(
            "RF-013P restore target is not empty. Create a new disposable calculatietool_test_* database."
        )


def _write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    import json

    output = assert_private_output_path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    if not args.acknowledge_sensitive_backup:
        raise SystemExit(
            "Refusing RF-013P backup: pass --acknowledge-sensitive-backup. "
            "The private .dump contains application data and must never be committed."
        )

    years = normalize_years(args.years)
    source_info, source_host = connection_info_from_environment()
    validate_source_target(
        source_host,
        os.getenv("CALCULATIETOOL_ENV", "").strip().lower(),
        allow_private_development_host=args.allow_private_development_host,
    )
    restore_url = os.getenv(RESTORE_TARGET_ENV, "").strip()
    if not restore_url:
        raise SystemExit(f"RF-013P requires {RESTORE_TARGET_ENV}.")
    assert_disposable_database_url(restore_url)
    assert_empty_restore_target(restore_url)

    backup_file = assert_private_backup_path(args.backup_file)
    backup_file.parent.mkdir(parents=True, exist_ok=True)
    pg_dump = resolve_binary(args.pg_dump, "pg_dump")
    pg_restore = resolve_binary(args.pg_restore, "pg_restore")

    source_before = capture_from_connection_info(source_info, years=years)
    dump_command, dump_environment = build_pg_dump_command(
        pg_dump, source_info, backup_file
    )
    _run(dump_command, dump_environment, label="pg_dump")
    source_after = capture_from_connection_info(source_info, years=years)
    changed_during_backup = compare_manifests(source_after, source_before)
    if changed_during_backup:
        raise RuntimeError(
            "RF-013P source changed during backup in protected sections: "
            + ", ".join(changed_during_backup)
            + ". Stop application writers and repeat."
        )

    restore_command, restore_environment = build_pg_restore_command(
        pg_restore, restore_url, backup_file
    )
    _run(restore_command, restore_environment, label="pg_restore")
    restored = capture_from_connection_info(restore_url, years=years)
    restore_differences = compare_manifests(restored, source_after)
    if restore_differences:
        raise RuntimeError(
            "RF-013P restored database differs in protected sections: "
            + ", ".join(restore_differences)
        )

    _write_manifest(PRIVATE_OUTPUT_ROOT / "source-baseline.json", source_after)
    _write_manifest(PRIVATE_OUTPUT_ROOT / "restored-baseline.json", restored)
    print(
        "RF-013P backup and disposable restore rehearsal passed; "
        "private artifacts remain under ignored outputs/rf013p."
    )


if __name__ == "__main__":
    main()
