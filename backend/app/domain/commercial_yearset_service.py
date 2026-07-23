from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any, Iterable

from app.domain import (
    adviesprijzen_storage,
    break_even_planning_storage,
    commercial_yearset_storage,
    cost_versions_storage,
    kostprijs_activation_storage,
    postgres_storage,
    production_storage,
    sales_pricing_storage,
    skus_storage,
)


READINESS_VERSION = "rf-013a-v1"
_PLAN_TOLERANCE = Decimal("0.02")
_VALIDATION_TABLES = (
    "advice_channel_pricing",
    "app_datasets",
    "articles",
    "break_even_plan_snapshots",
    "break_even_reforecast_snapshots",
    "cost_version_sku_rows",
    "cost_versions",
    "kostprijs_sku_activations",
    "production_years",
    "sales_pricing_records",
    "skus",
    "year_close_snapshots",
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except Exception:
        return Decimal("0")


def _stable(value: Any) -> str:
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

    return json.dumps(
        normalize(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _fingerprint(value: Any, domain: str) -> str:
    payload = f"rf013a:{domain}:".encode("utf-8") + _stable(value).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _truthy(value: Any, fallback: bool = True) -> bool:
    if value is None:
        return fallback
    if isinstance(value, bool):
        return value
    return _text(value).lower() not in {"0", "false", "no", "nee", "inactive", "inactief"}


def _target_values(payload: dict[str, Any]) -> dict[str, Decimal]:
    targets = payload.get("targets") if isinstance(payload.get("targets"), dict) else {}
    return {
        "revenue": _decimal(targets.get("revenue")),
        "variable_cost": _decimal(
            targets.get("variable_cost", targets.get("variableCost"))
        ),
        "contribution": _decimal(targets.get("contribution")),
        "liters": _decimal(targets.get("liters")),
        "units": _decimal(targets.get("units")),
    }


def _allocation_values(
    rows: Iterable[Any],
    *,
    planned_prefix: bool = False,
) -> dict[str, Decimal]:
    totals = {
        "revenue": Decimal("0"),
        "variable_cost": Decimal("0"),
        "contribution": Decimal("0"),
        "liters": Decimal("0"),
        "units": Decimal("0"),
    }
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        for key in totals:
            aliases = [key]
            if key == "variable_cost":
                aliases.append("variableCost")
            if planned_prefix:
                aliases.insert(0, f"planned_{key}")
            value = next((raw.get(alias) for alias in aliases if alias in raw), 0)
            totals[key] += _decimal(value)
    return totals


def _allocation_matches(
    targets: dict[str, Decimal],
    rows: list[Any],
    *,
    planned_prefix: bool = False,
) -> bool:
    totals = _allocation_values(rows, planned_prefix=planned_prefix)
    return all(abs(totals[key] - targets[key]) <= _PLAN_TOLERANCE for key in targets)


def validate_plan_contract(
    *,
    source: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    blockers: list[str] = []
    if _text(source) != "new_year_preparation":
        blockers.append("plan_source_not_new_year_preparation")
    targets = _target_values(payload)
    if targets["revenue"] <= 0:
        blockers.append("plan_revenue_missing")
    if targets["variable_cost"] < 0:
        blockers.append("plan_variable_cost_invalid")
    if targets["contribution"] <= 0:
        blockers.append("plan_contribution_missing")
    if (
        abs(
            targets["revenue"]
            - targets["variable_cost"]
            - targets["contribution"]
        )
        > _PLAN_TOLERANCE
    ):
        blockers.append("plan_target_balance_mismatch")
    if targets["liters"] <= 0:
        blockers.append("plan_liters_missing")
    if targets["units"] <= 0:
        blockers.append("plan_units_missing")

    period_rows = payload.get("period_allocations")
    if not isinstance(period_rows, list):
        period_rows = payload.get("periodAllocations")
    period_rows = period_rows if isinstance(period_rows, list) else []
    if not period_rows:
        blockers.append("plan_period_allocation_missing")
    elif not _allocation_matches(targets, period_rows):
        blockers.append("plan_period_allocation_mismatch")

    sku_rows = payload.get("sku_allocations")
    if not isinstance(sku_rows, list):
        sku_rows = payload.get("skuAllocations")
    planned_prefix = False
    if not isinstance(sku_rows, list):
        sku_rows = payload.get("planning_rows")
        planned_prefix = True
    sku_rows = sku_rows if isinstance(sku_rows, list) else []
    if not sku_rows:
        blockers.append("plan_sku_allocation_missing")
    elif not _allocation_matches(targets, sku_rows, planned_prefix=planned_prefix):
        blockers.append("plan_sku_allocation_mismatch")

    normalized_contract = {
        "source": _text(source),
        "targets": targets,
        # Allocation order has no financial meaning. Sorting avoids a false
        # mismatch when an exact frozen copy is returned in another row order.
        "period_allocations": sorted(period_rows, key=_stable),
        "sku_allocations": sorted(sku_rows, key=_stable),
    }
    return {
        "ready": not blockers,
        "blockers": sorted(set(blockers)),
        "contract_hash": _fingerprint(normalized_contract, "frozen-plan"),
    }


def validate_initial_forecast(
    *,
    plan_contract_hash: str,
    forecasts: list[dict[str, Any]],
) -> dict[str, Any]:
    blockers: list[str] = []
    frozen = [row for row in forecasts if _text(row.get("basis")) == "frozen_plan"]
    if not frozen:
        blockers.append("initial_forecast_missing")
    elif len(frozen) > 1:
        blockers.append("initial_forecast_ambiguous")
    forecast_id = _text((frozen[0] if len(frozen) == 1 else {}).get("id"))
    if len(frozen) == 1:
        payload = frozen[0].get("payload")
        payload = payload if isinstance(payload, dict) else {}
        body = payload.get("forecast") if isinstance(payload.get("forecast"), dict) else payload
        source = _text(body.get("source") or "new_year_preparation")
        forecast_contract = validate_plan_contract(source=source, payload=body)
        if forecast_contract["contract_hash"] != plan_contract_hash:
            blockers.append("initial_forecast_plan_mismatch")
    return {
        "ready": not blockers,
        "blockers": sorted(set(blockers)),
        "forecast_id": forecast_id,
    }


def ensure_dependencies() -> None:
    postgres_storage.ensure_schema()
    production_storage.ensure_schema()
    skus_storage.ensure_schema()
    cost_versions_storage.ensure_schema()
    kostprijs_activation_storage.ensure_schema()
    sales_pricing_storage.ensure_schema()
    adviesprijzen_storage.ensure_schema()
    break_even_planning_storage.ensure_schema()
    commercial_yearset_storage.ensure_schema()


def _lock_validation_tables(connection: Any) -> None:
    connection.execute(
        "SELECT pg_advisory_xact_lock(hashtext(%s))",
        ("calculatietool:commercial-yearset-validation:v1",),
    )
    for table in _VALIDATION_TABLES:
        connection.execute(f"LOCK TABLE {table} IN SHARE MODE")


def collect_readiness_snapshot(
    connection: Any,
    *,
    operational_year: int,
    source_year: int,
) -> dict[str, Any]:
    year_value = int(operational_year)
    source_value = int(source_year)
    production_exists = bool(
        connection.execute(
            "SELECT EXISTS(SELECT 1 FROM production_years WHERE jaar = %s)",
            (year_value,),
        ).fetchone()[0]
    )
    activation_stats = connection.execute(
        """
        WITH target AS (
            SELECT sku_id, kostprijsversie_id
            FROM kostprijs_sku_activations
            WHERE jaar = %s AND effectief_tot IS NULL
        ),
        scoped AS (
            SELECT
                a.sku_id,
                a.kostprijsversie_id,
                s.id AS known_sku_id,
                s.beer_id,
                s.kind,
                f.id AS format_id,
                f.content_liter,
                COALESCE(costs.matches, 0) AS cost_matches,
                COALESCE(costs.positive_matches, 0) AS positive_cost_matches
            FROM target a
            LEFT JOIN skus s ON s.id = a.sku_id
            LEFT JOIN articles f
              ON f.id = COALESCE(NULLIF(s.format_article_id, ''), NULLIF(s.article_id, ''))
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*)::int AS matches,
                    COUNT(*) FILTER (WHERE kostprijs > 0)::int AS positive_matches
                FROM cost_version_sku_rows r
                WHERE r.version_id = a.kostprijsversie_id
                  AND r.sku_id = a.sku_id
            ) costs ON TRUE
        )
        SELECT
            COUNT(*)::int,
            COUNT(DISTINCT sku_id)::int,
            COUNT(*) FILTER (WHERE known_sku_id IS NULL)::int,
            COUNT(*) FILTER (WHERE cost_matches = 0)::int,
            COUNT(*) FILTER (WHERE cost_matches > 1)::int,
            COUNT(*) FILTER (WHERE cost_matches > 0 AND positive_cost_matches = 0)::int,
            COUNT(*) FILTER (
                WHERE COALESCE(beer_id, '') <> ''
                  AND (format_id IS NULL OR COALESCE(content_liter, 0) <= 0)
            )::int
        FROM scoped
        """,
        (year_value,),
    ).fetchone()
    membership_rows = connection.execute(
        """
        SELECT a.sku_id, a.kostprijsversie_id, COALESCE(r.id, '')
        FROM kostprijs_sku_activations a
        LEFT JOIN cost_version_sku_rows r
          ON r.version_id = a.kostprijsversie_id
         AND r.sku_id = a.sku_id
        WHERE a.jaar = %s AND a.effectief_tot IS NULL
        ORDER BY a.sku_id, a.kostprijsversie_id, r.id
        """,
        (year_value,),
    ).fetchall()
    missing_source_skus = 0
    source_activation_count = 0
    if source_value > 0:
        source_activation_count, missing_source_skus = connection.execute(
            """
            WITH source AS (
                SELECT DISTINCT sku_id
                FROM kostprijs_sku_activations
                WHERE jaar = %s AND effectief_tot IS NULL
            ),
            target AS (
                SELECT DISTINCT sku_id
                FROM kostprijs_sku_activations
                WHERE jaar = %s AND effectief_tot IS NULL
            )
            SELECT
                (SELECT COUNT(*)::int FROM source),
                COUNT(*) FILTER (WHERE target.sku_id IS NULL)::int
            FROM source
            LEFT JOIN target USING (sku_id)
            """,
            (source_value, year_value),
        ).fetchone()

    pricing_rows = connection.execute(
        """
        SELECT id, record_type, bier_id, product_id, verpakking, payload
        FROM sales_pricing_records
        WHERE jaar = %s
        ORDER BY record_type, id
        """,
        (year_value,),
    ).fetchall()
    pricing_count = len(pricing_rows)
    app_channels = connection.execute(
        "SELECT payload FROM app_datasets WHERE dataset_name = 'channels'"
    ).fetchone()
    channel_payload = app_channels[0] if app_channels else []
    if isinstance(channel_payload, str):
        channel_payload = json.loads(channel_payload)
    active_channel_rows = sorted(
        [
            row
            for row in (channel_payload if isinstance(channel_payload, list) else [])
            if isinstance(row, dict)
            and _text(row.get("code") or row.get("id"))
            and _truthy(row.get("active", row.get("actief")), True)
        ],
        key=lambda row: _text(row.get("code") or row.get("id")).lower(),
    )
    active_channels = sorted(
        {
            _text(row.get("code") or row.get("id")).lower()
            for row in active_channel_rows
        }
    )
    advice_rows = connection.execute(
        """
        SELECT id::text, channel_code, opslag_pct
        FROM advice_channel_pricing
        WHERE jaar = %s
        ORDER BY channel_code, id
        """,
        (year_value,),
    ).fetchall()
    advice_codes = {
        _text(row[1]).lower()
        for row in advice_rows
        if _text(row[1])
    }
    missing_advice_channels = sorted(set(active_channels).difference(advice_codes))

    plan_rows = connection.execute(
        """
        SELECT id, source, payload
        FROM break_even_plan_snapshots
        WHERE jaar = %s AND status = 'active'
        ORDER BY created_at, id
        """,
        (year_value,),
    ).fetchall()
    plan_id = _text(plan_rows[0][0]) if len(plan_rows) == 1 else ""
    plan_source = _text(plan_rows[0][1]) if len(plan_rows) == 1 else ""
    plan_payload = (
        plan_rows[0][2] if len(plan_rows) == 1 and isinstance(plan_rows[0][2], dict) else {}
    )
    plan_contract = validate_plan_contract(source=plan_source, payload=plan_payload)
    forecast_rows: list[dict[str, Any]] = []
    if plan_id:
        forecast_rows = [
            {
                "id": _text(row[0]),
                "basis": _text(row[1]),
                "payload": row[2] if isinstance(row[2], dict) else {},
            }
            for row in connection.execute(
                """
                SELECT id, basis, payload
                FROM break_even_reforecast_snapshots
                WHERE jaar = %s AND plan_snapshot_id = %s
                ORDER BY created_at, id
                """,
                (year_value, plan_id),
            ).fetchall()
        ]
    forecast_contract = validate_initial_forecast(
        plan_contract_hash=plan_contract["contract_hash"],
        forecasts=forecast_rows,
    )
    year_close_row = connection.execute(
        "SELECT id FROM year_close_snapshots WHERE jaar = %s AND status = 'closed'",
        (source_value,),
    ).fetchone()
    return {
        "operational_year": year_value,
        "source_year": source_value,
        "production_exists": production_exists,
        "activation_count": int(activation_stats[0] or 0),
        "distinct_activation_skus": int(activation_stats[1] or 0),
        "unknown_activation_skus": int(activation_stats[2] or 0),
        "missing_cost_rows": int(activation_stats[3] or 0),
        "duplicate_cost_rows": int(activation_stats[4] or 0),
        "non_positive_cost_rows": int(activation_stats[5] or 0),
        "missing_beer_format_or_liters": int(activation_stats[6] or 0),
        "source_activation_count": int(source_activation_count or 0),
        "missing_source_skus": int(missing_source_skus or 0),
        "membership_hash": _fingerprint(membership_rows, "target-membership"),
        "pricing_scope_hash": _fingerprint(pricing_rows, "target-sales-pricing"),
        "channel_policy_hash": _fingerprint(
            active_channel_rows,
            "active-channel-policy",
        ),
        "advice_scope_hash": _fingerprint(advice_rows, "target-advice-pricing"),
        "pricing_count": pricing_count,
        "active_channel_count": len(active_channels),
        "missing_advice_channel_count": len(missing_advice_channels),
        "plan_count": len(plan_rows),
        "plan_id": plan_id,
        "plan_contract": plan_contract,
        "forecast_contract": forecast_contract,
        "year_close_snapshot_id": _text(year_close_row[0] if year_close_row else ""),
    }


def evaluate_readiness(snapshot: dict[str, Any]) -> dict[str, Any]:
    blockers: list[str] = []
    if int(snapshot.get("source_year", 0) or 0) <= 0:
        blockers.append("source_year_missing")
    elif int(snapshot.get("source_activation_count", 0) or 0) <= 0:
        blockers.append("source_activations_missing")
    if not _text(snapshot.get("year_close_snapshot_id")):
        blockers.append("source_year_close_missing")
    if not bool(snapshot.get("production_exists")):
        blockers.append("production_year_missing")
    activation_count = int(snapshot.get("activation_count", 0) or 0)
    if activation_count <= 0:
        blockers.append("target_activations_missing")
    if activation_count != int(snapshot.get("distinct_activation_skus", 0) or 0):
        blockers.append("activation_scope_duplicate")
    count_blockers = (
        ("unknown_activation_skus", "activation_unknown_sku"),
        ("missing_cost_rows", "canonical_cost_row_missing"),
        ("duplicate_cost_rows", "canonical_cost_row_duplicate"),
        ("non_positive_cost_rows", "planning_cost_non_positive"),
        ("missing_beer_format_or_liters", "beer_format_or_liters_missing"),
        ("missing_source_skus", "source_sku_membership_missing"),
        ("missing_advice_channel_count", "advice_channel_missing"),
    )
    blockers.extend(
        code
        for key, code in count_blockers
        if int(snapshot.get(key, 0) or 0) > 0
    )
    if int(snapshot.get("pricing_count", 0) or 0) <= 0:
        blockers.append("sales_pricing_missing")
    if int(snapshot.get("active_channel_count", 0) or 0) <= 0:
        blockers.append("active_channel_policy_missing")
    for key, code in (
        ("pricing_scope_hash", "sales_pricing_fingerprint_missing"),
        ("channel_policy_hash", "channel_policy_fingerprint_missing"),
        ("advice_scope_hash", "advice_pricing_fingerprint_missing"),
    ):
        if not _text(snapshot.get(key)):
            blockers.append(code)
    plan_count = int(snapshot.get("plan_count", 0) or 0)
    if plan_count == 0:
        blockers.append("active_plan_missing")
    elif plan_count > 1:
        blockers.append("active_plan_ambiguous")
    plan_contract = snapshot.get("plan_contract")
    plan_contract = plan_contract if isinstance(plan_contract, dict) else {}
    blockers.extend(str(code) for code in plan_contract.get("blockers", []))
    forecast_contract = snapshot.get("forecast_contract")
    forecast_contract = forecast_contract if isinstance(forecast_contract, dict) else {}
    blockers.extend(str(code) for code in forecast_contract.get("blockers", []))

    report = {
        "version": READINESS_VERSION,
        "operational_year": int(snapshot.get("operational_year", 0) or 0),
        "source_year": int(snapshot.get("source_year", 0) or 0),
        "ready": not blockers,
        "blockers": sorted(set(blockers)),
        "counts": {
            key: int(snapshot.get(key, 0) or 0)
            for key in (
                "activation_count",
                "distinct_activation_skus",
                "unknown_activation_skus",
                "missing_cost_rows",
                "duplicate_cost_rows",
                "non_positive_cost_rows",
                "missing_beer_format_or_liters",
                "source_activation_count",
                "missing_source_skus",
                "pricing_count",
                "active_channel_count",
                "missing_advice_channel_count",
                "plan_count",
            )
        },
        "fingerprints": {
            "membership": _text(snapshot.get("membership_hash")),
            "sales_pricing": _text(snapshot.get("pricing_scope_hash")),
            "channel_policy": _text(snapshot.get("channel_policy_hash")),
            "advice_pricing": _text(snapshot.get("advice_scope_hash")),
            "plan_contract": _text(plan_contract.get("contract_hash")),
        },
        "source_records": {
            "break_even_plan_id": _text(snapshot.get("plan_id")),
            "forecast_snapshot_id": _text(forecast_contract.get("forecast_id")),
            "year_close_snapshot_id": _text(snapshot.get("year_close_snapshot_id")),
        },
    }
    report["validation_hash"] = _fingerprint(report, "readiness-report")
    return report


def build_readiness_report(
    *,
    operational_year: int,
    source_year: int,
    connection: Any | None = None,
) -> dict[str, Any]:
    ensure_dependencies()
    if connection is not None:
        return evaluate_readiness(
            collect_readiness_snapshot(
                connection,
                operational_year=operational_year,
                source_year=source_year,
            )
        )
    with postgres_storage.connect() as conn:
        return evaluate_readiness(
            collect_readiness_snapshot(
                conn,
                operational_year=operational_year,
                source_year=source_year,
            )
        )


def create_legacy_candidate(
    *,
    operational_year: int,
    source_year: int,
    actor: str,
    dry_run: bool = True,
) -> dict[str, Any]:
    year_value = int(operational_year or 0)
    source_value = int(source_year or 0)
    if year_value <= 0 or source_value <= 0 or source_value >= year_value:
        raise ValueError("Gebruik expliciet 0 < source_year < operational_year.")
    ensure_dependencies()
    with postgres_storage.transaction() as conn:
        _lock_validation_tables(conn)
        report = build_readiness_report(
            operational_year=year_value,
            source_year=source_value,
            connection=conn,
        )
        active = commercial_yearset_storage.get_active_generation(for_update=True)
        result: dict[str, Any] = {
            "dry_run": bool(dry_run),
            "readiness": report,
            "candidate": None,
        }
        if dry_run:
            return result
        validation_hash = _text(report.get("validation_hash"))
        source_records = report.get("source_records")
        source_records = source_records if isinstance(source_records, dict) else {}
        candidate = commercial_yearset_storage.create_candidate(
            operational_year=year_value,
            source_year=source_value,
            source_generation_id=(
                _text(active.get("id"))
                if active and int(active.get("operational_year", 0) or 0) == source_value
                else ""
            ),
            validation=report,
            validation_hash=validation_hash,
            actor=actor,
            idempotency_key=f"legacy:{source_value}:{year_value}:{validation_hash}",
            break_even_plan_id=_text(source_records.get("break_even_plan_id")),
            forecast_snapshot_id=_text(source_records.get("forecast_snapshot_id")),
            year_close_snapshot_id=_text(source_records.get("year_close_snapshot_id")),
            compatibility={
                "authority_version": READINESS_VERSION,
                "legacy_reader_fallback": True,
                "fallback_year": year_value,
                "data_rewritten": False,
            },
        )
        result["candidate"] = candidate
        return result


def activate_candidate(
    *,
    generation_id: str,
    actor: str,
    expected_validation_hash: str,
    expected_active_generation_id: str | None,
    reason: str = "",
    action: str = "activate",
) -> dict[str, Any]:
    ensure_dependencies()
    with postgres_storage.transaction() as conn:
        _lock_validation_tables(conn)
        generation = commercial_yearset_storage.get_generation(
            generation_id,
            for_update=True,
        )
        if not generation:
            raise ValueError("Commerciële jaarset niet gevonden.")
        report = build_readiness_report(
            operational_year=int(generation["operational_year"]),
            source_year=int(generation["source_year"]),
            connection=conn,
        )
        current_hash = _text(report.get("validation_hash"))
        if current_hash != _text(generation.get("validation_hash")):
            raise commercial_yearset_storage.CommercialYearsetConflict(
                "Onderliggende jaarsetgegevens zijn gewijzigd; maak een nieuwe kandidaat."
            )
        if current_hash != _text(expected_validation_hash):
            raise commercial_yearset_storage.CommercialYearsetConflict(
                "De aangeboden validatiehash is verouderd."
            )
        if not bool(report.get("ready")):
            blocker_codes = ", ".join(str(code) for code in report.get("blockers", []))
            raise commercial_yearset_storage.CommercialYearsetBlocked(
                f"Jaarset is niet activatieklaar: {blocker_codes}"
            )
        return commercial_yearset_storage.activate_generation(
            generation_id=generation_id,
            actor=actor,
            expected_validation_hash=current_hash,
            expected_active_generation_id=expected_active_generation_id,
            reason=reason,
            action=action,
        )


def authority_overview(*, fallback_year: int = 0) -> dict[str, Any]:
    # Overview reads only the authority tables. Readiness dependencies are
    # initialized exclusively by candidate/activation commands.
    commercial_yearset_storage.ensure_schema()
    active = commercial_yearset_storage.get_active_generation()
    generations = commercial_yearset_storage.list_generations()
    fallback_value = int(fallback_year or 0)
    if active:
        context = {
            "operational_year": int(active["operational_year"]),
            "generation_id": _text(active["id"]),
            "authority": "commercial_yearset",
            "fallback_used": False,
            "warnings": [],
        }
    else:
        context = {
            "operational_year": fallback_value,
            "generation_id": "",
            "authority": "legacy_explicit_fallback" if fallback_value > 0 else "unresolved",
            "fallback_used": fallback_value > 0,
            "warnings": [
                {
                    "code": "active_commercial_yearset_missing",
                    "message": (
                        "Er is nog geen gevalideerde actieve commerciële jaarset; "
                        "bestaande lezers gebruiken tijdelijk hun expliciete jaarcontext."
                    ),
                }
            ],
        }
    return {
        "version": READINESS_VERSION,
        "context": context,
        "active_generation": active,
        "generations": generations,
        "audit": commercial_yearset_storage.audit_authority(),
    }
