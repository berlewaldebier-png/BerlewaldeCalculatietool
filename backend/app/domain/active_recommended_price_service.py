from __future__ import annotations

import copy
import hashlib
import json
import logging
from decimal import Decimal
from typing import Any, Iterable
from uuid import NAMESPACE_URL, uuid5

from app.domain import (
    active_sales_strategy_service,
    postgres_storage,
    yearset_dossier_service,
)


CONTRACT_VERSION = "rf-012c4b-v1"
_WRITE_LOCK_KEY = "calculatietool:active-recommended-prices:v1"
logger = logging.getLogger(__name__)


class ActiveRecommendedPriceConflict(RuntimeError):
    """Raised when the active authority or a live channel row changed."""


class ActiveRecommendedPriceBlocked(RuntimeError):
    """Raised when a channel update cannot be applied without guessing."""


def _text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = Decimal(str(value))
    except Exception:
        return None
    return float(parsed) if parsed.is_finite() else None


def _codes(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            value = [value]
    if not isinstance(value, list):
        return []
    return sorted({_text(item) for item in value if _text(item)})


def _json_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    if not isinstance(value, list):
        return []
    return [copy.deepcopy(row) for row in value if isinstance(row, dict)]


def _parse_percentage(value: Any) -> float | None:
    raw = _text(value).replace("%", "").replace(",", ".")
    if not raw:
        return None
    parsed = _number(raw)
    if parsed is None or parsed < 0 or parsed > 100:
        return None
    return parsed


def _channel_row_hash(row: dict[str, Any]) -> str:
    canonical = json.dumps(
        {
            "id": _text(row.get("id")),
            "year": int(row.get("year") or row.get("jaar") or 0),
            "channel_code": _text(row.get("channel_code")).lower(),
            "advice_markup_pct": _number(
                row.get("advice_markup_pct", row.get("opslag_pct"))
            ),
            "updated_at": _text(row.get("updated_at")),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _live_channel(raw: dict[str, Any]) -> dict[str, Any]:
    row = {
        "id": _text(raw.get("id")),
        "year": int(raw.get("year") or raw.get("jaar") or 0),
        "channel_code": _text(raw.get("channel_code")).lower(),
        "advice_markup_pct": _number(
            raw.get("advice_markup_pct", raw.get("opslag_pct"))
        ),
        "created_at": _text(raw.get("created_at")),
        "updated_at": _text(raw.get("updated_at")),
    }
    row["row_hash"] = _channel_row_hash(row)
    return row


def _missing(reason_codes: Iterable[str], *, can_edit: bool = False) -> dict[str, Any]:
    return {
        "version": CONTRACT_VERSION,
        "status": "missing",
        "read_only": not can_edit,
        "can_edit": can_edit,
        "binding": None,
        "channels": [],
        "groups": [],
        "summary": {
            "sku_count": 0,
            "group_count": 0,
            "channel_count": 0,
            "ready_advice_sku_count": 0,
            "missing_cost_count": 0,
            "missing_sell_in_count": 0,
            "missing_vat_count": 0,
            "not_applicable_count": 0,
            "missing_channel_markup_count": 0,
        },
        "reason_codes": sorted({_text(code) for code in reason_codes if _text(code)}),
    }


def build_active_recommended_prices(
    dossier: dict[str, Any],
    sales_projection: dict[str, Any],
    *,
    live_advice_rows: Iterable[dict[str, Any]],
    configured_channels: Iterable[dict[str, Any]],
    vat_by_sku: dict[str, Any],
    can_edit: bool = False,
) -> dict[str, Any]:
    """Combine active SKU/sell-in authority with current channel advice policy."""

    if dossier.get("status") != "ready" or not isinstance(dossier.get("binding"), dict):
        return _missing(
            dossier.get("reason_codes") or ["active_commercial_yearset_missing"],
            can_edit=can_edit,
        )
    if sales_projection.get("status") != "ready" or not isinstance(
        sales_projection.get("binding"), dict
    ):
        return _missing(
            sales_projection.get("reason_codes") or ["active_sales_strategy_missing"],
            can_edit=can_edit,
        )
    binding = dict(dossier["binding"])
    sales_binding = dict(sales_projection["binding"])
    binding_keys = ("generation_id", "run_id", "manifest_hash", "validation_hash")
    if any(_text(binding.get(key)) != _text(sales_binding.get(key)) for key in binding_keys):
        return _missing(["active_sales_strategy_binding_mismatch"], can_edit=can_edit)

    year = int(dossier.get("operational_year") or 0)
    live_by_code: dict[str, list[dict[str, Any]]] = {}
    for raw in live_advice_rows:
        if not isinstance(raw, dict):
            continue
        row = _live_channel(raw)
        if row["year"] == year and row["channel_code"]:
            live_by_code.setdefault(row["channel_code"], []).append(row)

    configured_by_code: dict[str, dict[str, Any]] = {}
    for raw in configured_channels:
        if not isinstance(raw, dict):
            continue
        code = _text(raw.get("code") or raw.get("id")).lower()
        if code and code not in configured_by_code:
            configured_by_code[code] = copy.deepcopy(raw)

    candidate_by_code: dict[str, dict[str, Any]] = {}
    for raw in dossier.get("channels", []):
        if not isinstance(raw, dict):
            continue
        code = _text(raw.get("channel_code")).lower()
        if not code:
            continue
        if code in candidate_by_code:
            return _missing(["active_advice_channel_duplicate"], can_edit=can_edit)
        candidate_by_code[code] = copy.deepcopy(raw)

    channels: list[dict[str, Any]] = []
    for code, candidate in candidate_by_code.items():
        configured = configured_by_code.get(code, {})
        live = live_by_code.get(code, [])
        selected = live[0] if len(live) == 1 else None
        blockers = set(_codes(candidate.get("blocker_codes")))
        if _text(candidate.get("readiness_status")) != "ready":
            blockers.add("active_advice_channel_not_ready")
        if len(live) > 1:
            state = "ambiguous"
            blockers.add("active_advice_channel_ambiguous")
        elif selected is None:
            state = "missing"
            blockers.add("active_advice_channel_record_missing")
        elif selected["advice_markup_pct"] is None or selected["advice_markup_pct"] < 0:
            state = "invalid"
            blockers.add("active_advice_markup_invalid")
        elif blockers:
            state = "blocked"
        else:
            state = "ready"
        channels.append(
            {
                "channel_code": code,
                "channel_name": _text(
                    configured.get("naam") or configured.get("label") or code
                ),
                "order": int(configured.get("volgorde") or 0),
                "activation_advice_markup_pct": _number(
                    candidate.get("advice_markup_pct")
                ),
                "advice_markup_pct": (
                    selected["advice_markup_pct"] if selected is not None else None
                ),
                "markup_state": state,
                "reason_codes": sorted(blockers),
                "pricing_record_id": selected["id"] if selected else "",
                "pricing_record_hash": selected["row_hash"] if selected else "",
                "pricing_updated_at": selected["updated_at"] if selected else "",
                "editable": bool(can_edit and state not in {"ambiguous", "blocked"}),
            }
        )
    channels.sort(
        key=lambda row: (
            int(row["order"]),
            _text(row["channel_name"]).casefold(),
            row["channel_code"],
        )
    )

    state_counts = {
        "ready": 0,
        "missing_cost": 0,
        "missing_sell_in": 0,
        "missing_vat": 0,
        "not_applicable": 0,
    }
    groups = copy.deepcopy(sales_projection.get("groups", []))
    seen_skus: set[str] = set()
    for group in groups:
        if not isinstance(group, dict):
            continue
        for item in group.get("items", []):
            if not isinstance(item, dict):
                continue
            sku_id = _text(item.get("sku_id"))
            if not sku_id or sku_id in seen_skus:
                return _missing(["active_advice_duplicate_sku"], can_edit=can_edit)
            seen_skus.add(sku_id)
            vat_pct = _parse_percentage(vat_by_sku.get(sku_id))
            if not bool(item.get("price_required")):
                advice_state = "not_applicable"
            elif _text(item.get("cost_state")) != "ready":
                advice_state = "missing_cost"
            elif _text(item.get("price_state")) != "ready":
                advice_state = "missing_sell_in"
            elif vat_pct is None:
                advice_state = "missing_vat"
            else:
                advice_state = "ready"
            state_counts[advice_state] += 1
            item["vat_pct"] = vat_pct
            item["vat_state"] = "ready" if vat_pct is not None else "missing"
            item["advice_state"] = advice_state
            item["advice_reason_codes"] = {
                "missing_cost": ["active_advice_cost_missing"],
                "missing_sell_in": ["active_advice_sell_in_missing"],
                "missing_vat": ["active_advice_vat_missing"],
                "not_applicable": ["active_advice_not_applicable"],
            }.get(advice_state, [])
            item["editable"] = False

    if len(seen_skus) != int(sales_projection.get("summary", {}).get("sku_count") or 0):
        return _missing(["active_advice_sku_count_mismatch"], can_edit=can_edit)

    return {
        "version": CONTRACT_VERSION,
        "status": "ready",
        "read_only": not can_edit,
        "can_edit": can_edit,
        "binding": {
            "generation_id": _text(binding.get("generation_id")),
            "run_id": _text(binding.get("run_id")),
            "operational_year": year,
            "manifest_hash": _text(binding.get("manifest_hash")),
            "validation_hash": _text(binding.get("validation_hash")),
        },
        "channels": channels,
        "groups": groups,
        "summary": {
            "sku_count": len(seen_skus),
            "group_count": len(groups),
            "channel_count": len(channels),
            "ready_advice_sku_count": state_counts["ready"],
            "missing_cost_count": state_counts["missing_cost"],
            "missing_sell_in_count": state_counts["missing_sell_in"],
            "missing_vat_count": state_counts["missing_vat"],
            "not_applicable_count": state_counts["not_applicable"],
            "missing_channel_markup_count": sum(
                row["markup_state"] != "ready" for row in channels
            ),
        },
        "reason_codes": [],
    }


def read_active_recommended_prices(*, can_edit: bool = False) -> dict[str, Any]:
    """Read active SKUs, current sell-in prices and live channel advice policy."""

    dossier = yearset_dossier_service.read_active_yearset_dossier()
    if dossier.get("status") != "ready" or not isinstance(dossier.get("binding"), dict):
        return _missing(
            dossier.get("reason_codes") or ["active_commercial_yearset_missing"],
            can_edit=can_edit,
        )
    year = int(dossier.get("operational_year") or 0)
    run_id = _text(dossier["binding"].get("run_id"))
    with postgres_storage.connect() as connection:
        connection.execute("SET TRANSACTION READ ONLY")
        sales_rows = connection.execute(
            """
            SELECT id, record_type, jaar, payload, updated_at
            FROM sales_pricing_records
            WHERE jaar = %s
              AND record_type = 'verkoopstrategie_product'
            ORDER BY id
            """,
            (year,),
        ).fetchall()
        advice_rows = connection.execute(
            """
            SELECT id, jaar, channel_code, opslag_pct, created_at, updated_at
            FROM advice_channel_pricing
            WHERE jaar = %s
            ORDER BY channel_code, id
            """,
            (year,),
        ).fetchall()
        configured_row = connection.execute(
            """
            SELECT payload
            FROM app_datasets
            WHERE dataset_name = 'channels'
            """
        ).fetchone()
        vat_rows = connection.execute(
            """
            SELECT s.sku_id,
                   NULLIF(v.payload->'basisgegevens'->>'btw_tarief', '')
            FROM commercial_yearset_candidate_skus s
            LEFT JOIN cost_versions v ON v.id = s.source_cost_version_id
            WHERE s.run_id = %s
            ORDER BY s.sku_id
            """,
            (run_id,),
        ).fetchall()

    sales_columns = ("id", "record_type", "year", "payload", "updated_at")
    sales_projection = active_sales_strategy_service.build_active_sales_strategy(
        dossier,
        live_price_rows=[
            dict(zip(sales_columns, row, strict=True)) for row in sales_rows
        ],
        can_edit=False,
    )
    advice_columns = (
        "id",
        "year",
        "channel_code",
        "advice_markup_pct",
        "created_at",
        "updated_at",
    )
    configured = _json_list(configured_row[0] if configured_row else [])
    return build_active_recommended_prices(
        dossier,
        sales_projection,
        live_advice_rows=[
            dict(zip(advice_columns, row, strict=True)) for row in advice_rows
        ],
        configured_channels=configured,
        vat_by_sku={_text(sku_id): vat for sku_id, vat in vat_rows if _text(sku_id)},
        can_edit=can_edit,
    )


def _new_record_id(year: int, channel_code: str) -> str:
    return str(
        uuid5(
            NAMESPACE_URL,
            f"calculatietool:active-recommended-prices:{year}:{channel_code}",
        )
    )


def update_active_recommended_prices(
    *,
    generation_id: str,
    run_id: str,
    manifest_hash: str,
    changes: Iterable[dict[str, Any]],
    actor: str,
) -> dict[str, Any]:
    """Atomically update only explicitly changed active-year channel markups."""

    normalized_changes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in changes:
        if not isinstance(raw, dict):
            raise ValueError("Ongeldige adviesopslagwijziging.")
        code = _text(raw.get("channel_code")).lower()
        markup = _number(raw.get("advice_markup_pct"))
        if not code or code in seen:
            raise ValueError("Elke wijziging moet precies één uniek kanaal bevatten.")
        if markup is None or markup < 0:
            raise ValueError("Adviesopslag moet nul of hoger zijn.")
        seen.add(code)
        normalized_changes.append(
            {
                "channel_code": code,
                "advice_markup_pct": markup,
                "pricing_record_id": _text(raw.get("pricing_record_id")),
                "expected_record_hash": _text(raw.get("expected_record_hash")),
            }
        )
    if not normalized_changes:
        return read_active_recommended_prices(can_edit=True)

    with postgres_storage.transaction() as connection:
        connection.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s))", (_WRITE_LOCK_KEY,)
        )
        authority = connection.execute(
            """
            SELECT g.id, g.operational_year, g.status, g.readiness_status,
                   r.id, r.status, r.readiness_status, r.manifest_hash
            FROM commercial_yearsets g
            JOIN commercial_yearset_reconciliation_runs r
              ON r.generation_id = g.id
            WHERE g.status = 'active'
              AND r.status = 'active'
            FOR UPDATE OF g, r
            """
        ).fetchone()
        if not authority:
            raise ActiveRecommendedPriceBlocked("Actieve commerciële jaarset ontbreekt.")
        current_generation_id = _text(authority[0])
        year = int(authority[1] or 0)
        current_run_id = _text(authority[4])
        current_manifest_hash = _text(authority[7])
        if (
            current_generation_id != _text(generation_id)
            or current_run_id != _text(run_id)
            or current_manifest_hash != _text(manifest_hash)
        ):
            raise ActiveRecommendedPriceConflict(
                "De actieve jaarset is gewijzigd. Herlaad Adviesprijzen en probeer opnieuw."
            )
        if _text(authority[2]) != "active" or _text(authority[3]) != "ready":
            raise ActiveRecommendedPriceBlocked("De actieve jaarset is niet gereed.")
        if _text(authority[5]) != "active" or _text(authority[6]) != "ready":
            raise ActiveRecommendedPriceBlocked("De actieve reconciliatie is niet gereed.")

        for change in normalized_changes:
            code = change["channel_code"]
            candidate = connection.execute(
                """
                SELECT advice_markup_pct, readiness_status, blocker_codes
                FROM commercial_yearset_candidate_channels
                WHERE run_id = %s AND channel_code = %s
                """,
                (current_run_id, code),
            ).fetchone()
            if not candidate:
                raise ActiveRecommendedPriceBlocked(
                    f"Kanaal '{code}' hoort niet bij de actieve jaarset."
                )
            if _text(candidate[1]) != "ready" or _codes(candidate[2]):
                raise ActiveRecommendedPriceBlocked(
                    f"Kanaal '{code}' is niet gereed voor een adviesopslag."
                )

            selected = connection.execute(
                """
                SELECT id, jaar, channel_code, opslag_pct, created_at, updated_at
                FROM advice_channel_pricing
                WHERE jaar = %s AND channel_code = %s
                FOR UPDATE
                """,
                (year, code),
            ).fetchone()
            requested_id = change["pricing_record_id"]
            if selected:
                current = _live_channel(
                    dict(
                        zip(
                            (
                                "id",
                                "year",
                                "channel_code",
                                "advice_markup_pct",
                                "created_at",
                                "updated_at",
                            ),
                            selected,
                            strict=True,
                        )
                    )
                )
                record_id = current["id"]
                if requested_id and requested_id != record_id:
                    raise ActiveRecommendedPriceConflict(
                        f"De adviesopslag voor '{code}' is gewijzigd."
                    )
                if change["expected_record_hash"] != current["row_hash"]:
                    raise ActiveRecommendedPriceConflict(
                        f"De adviesopslag voor '{code}' is intussen gewijzigd. Herlaad de pagina."
                    )
                connection.execute(
                    """
                    UPDATE advice_channel_pricing
                    SET opslag_pct = %s, updated_at = NOW()
                    WHERE id = %s::uuid
                    """,
                    (change["advice_markup_pct"], record_id),
                )
            else:
                if requested_id or change["expected_record_hash"]:
                    raise ActiveRecommendedPriceConflict(
                        f"De prijsstatus voor '{code}' is intussen gewijzigd."
                    )
                record_id = _new_record_id(year, code)
                connection.execute(
                    """
                    INSERT INTO advice_channel_pricing (
                        id, jaar, channel_code, opslag_pct, created_at, updated_at
                    )
                    VALUES (%s::uuid, %s, %s, %s, NOW(), NOW())
                    """,
                    (record_id, year, code, change["advice_markup_pct"]),
                )
            logger.info(
                "Updated active advice markup for year=%s channel=%s actor=%s",
                year,
                code,
                _text(actor) or "unknown",
            )

    return read_active_recommended_prices(can_edit=True)
