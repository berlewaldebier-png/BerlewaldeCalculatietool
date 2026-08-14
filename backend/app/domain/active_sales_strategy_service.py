from __future__ import annotations

import copy
import hashlib
import json
from decimal import Decimal
from typing import Any, Iterable
from uuid import NAMESPACE_URL, uuid5

from app.domain import postgres_storage, yearset_dossier_service


CONTRACT_VERSION = "rf-012c4a-v1"
_WRITE_LOCK_KEY = "calculatietool:active-sales-strategy:v1"


class ActiveSalesStrategyConflict(RuntimeError):
    """Raised when an optimistic binding or live price changed."""


class ActiveSalesStrategyBlocked(RuntimeError):
    """Raised when a price cannot be changed without guessing its authority."""


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


def _mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return copy.deepcopy(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return {}
        return copy.deepcopy(parsed) if isinstance(parsed, dict) else {}
    return {}


def _codes(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            value = [value]
    if not isinstance(value, list):
        return []
    return sorted({_text(item) for item in value if _text(item)})


def _payload_hash(value: Any) -> str:
    canonical = json.dumps(
        _mapping(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _list_price(payload: dict[str, Any]) -> float | None:
    channel_prices = payload.get("sell_in_prices")
    if isinstance(channel_prices, dict):
        value = _number(channel_prices.get("list"))
        if value is not None:
            return value
    for key in ("sell_in_price", "list_price", "verkoopprijs"):
        value = _number(payload.get(key))
        if value is not None:
            return value
    return None


def _cost_state(row: dict[str, Any]) -> str:
    if not bool(row.get("cost_required")):
        return "not_applicable"
    value = _number(row.get("cost_price"))
    if _text(row.get("cost_readiness_status")) != "ready" or value is None or value <= 0:
        return "missing_cost"
    return "ready"


def _group_identity(row: dict[str, Any]) -> tuple[str, str, str, int]:
    beer_name = _text(row.get("beer_name"))
    canonical_beer_id = _text(row.get("canonical_beer_id"))
    subject_type = _text(row.get("subject_type")).lower()
    if beer_name:
        return (
            f"beer:{canonical_beer_id or beer_name.casefold()}",
            beer_name,
            "beer",
            0,
        )
    labels = {
        "bundle": "Samengestelde producten",
        "service": "Diensten",
        "article": "Overige artikelen",
    }
    return (
        f"other:{subject_type or 'other'}",
        labels.get(subject_type, "Overige producten"),
        subject_type or "other",
        1,
    )


def _display_priority(row: dict[str, Any]) -> int:
    label = _text(row.get("sku_name")).casefold().replace("×", "x").replace("*", "x")
    compact = "".join(label.split())
    if "doos24x33cl" in compact:
        return 0
    if any(token in label for token in ("fust", "keg", "vat")):
        return 1
    return 2


def _live_record(raw: dict[str, Any]) -> dict[str, Any]:
    payload = _mapping(raw.get("payload"))
    return {
        "id": _text(raw.get("id")),
        "year": int(raw.get("year") or raw.get("jaar") or payload.get("jaar") or 0),
        "sku_id": _text(payload.get("sku_id")),
        "record_type": _text(raw.get("record_type") or payload.get("record_type")),
        "payload": payload,
        "payload_hash": _payload_hash(payload),
        "updated_at": _text(raw.get("updated_at")),
    }


def overlay_current_sell_in_prices(
    candidate_rows: Iterable[dict[str, Any]],
    live_price_rows: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Overlay active mutable target prices without changing candidate snapshots."""

    live_rows = [_live_record(row) for row in live_price_rows if isinstance(row, dict)]
    live_by_id = {row["id"]: row for row in live_rows if row["id"]}
    live_by_sku: dict[str, list[dict[str, Any]]] = {}
    for row in live_rows:
        if row["sku_id"]:
            live_by_sku.setdefault(row["sku_id"], []).append(row)

    result: list[dict[str, Any]] = []
    for raw in candidate_rows:
        row = copy.deepcopy(raw)
        sku_id = _text(row.get("sku_id"))
        target_price_id = _text(row.get("target_pricing_id"))
        selected = None
        blockers = set(_codes(row.get("price_blocker_codes")))
        if target_price_id:
            target = live_by_id.get(target_price_id)
            if target and target["sku_id"] == sku_id:
                selected = target
            elif target:
                blockers.add("active_price_target_sku_mismatch")
            else:
                blockers.add("active_price_target_record_missing")
        else:
            matches = live_by_sku.get(sku_id, [])
            if len(matches) == 1:
                selected = matches[0]
            elif len(matches) > 1:
                blockers.add("active_price_record_ambiguous")

        if selected:
            price = _list_price(selected["payload"])
            row["price_id"] = selected["id"]
            row["target_pricing_id"] = selected["id"]
            row["list_price"] = price
            row["price_readiness_status"] = (
                "ready" if price is not None and price > 0 else "blocked"
            )
            if price is None:
                blockers.add("active_sell_in_missing")
            elif price <= 0:
                blockers.add("active_sell_in_non_positive")
            row["current_pricing_record_hash"] = selected["payload_hash"]
        else:
            row["price_id"] = ""
            row["list_price"] = None
            row["price_readiness_status"] = "blocked"
            if not blockers:
                blockers.add("active_sell_in_missing")
        row["price_blocker_codes"] = sorted(blockers)
        result.append(row)
    return result


def _missing(reason_codes: Iterable[str], *, can_edit: bool = False) -> dict[str, Any]:
    return {
        "version": CONTRACT_VERSION,
        "status": "missing",
        "read_only": not can_edit,
        "can_edit": can_edit,
        "binding": None,
        "groups": [],
        "summary": {
            "sku_count": 0,
            "group_count": 0,
            "ready_price_count": 0,
            "missing_price_count": 0,
            "non_positive_price_count": 0,
            "ambiguous_price_count": 0,
            "not_applicable_price_count": 0,
            "compatibility_only_price_count": 0,
        },
        "reason_codes": sorted({_text(code) for code in reason_codes if _text(code)}),
    }


def build_active_sales_strategy(
    dossier: dict[str, Any],
    *,
    live_price_rows: Iterable[dict[str, Any]],
    can_edit: bool = False,
) -> dict[str, Any]:
    """Project the active generation plus its mutable per-SKU target prices."""

    if dossier.get("status") != "ready" or not isinstance(dossier.get("binding"), dict):
        return _missing(
            dossier.get("reason_codes") or ["active_commercial_yearset_missing"],
            can_edit=can_edit,
        )
    binding = dict(dossier["binding"])
    if _text(binding.get("generation_status")) != "active":
        return _missing(["commercial_yearset_not_active"], can_edit=can_edit)

    raw_rows = [row for row in dossier.get("sku_items", []) if isinstance(row, dict)]
    sku_ids = [_text(row.get("sku_id")) for row in raw_rows]
    if any(not sku_id for sku_id in sku_ids):
        return _missing(["active_generation_sku_identity_missing"], can_edit=can_edit)
    if len(sku_ids) != len(set(sku_ids)):
        return _missing(["active_generation_duplicate_sku"], can_edit=can_edit)

    live_rows = [_live_record(row) for row in live_price_rows if isinstance(row, dict)]
    live_by_id = {row["id"]: row for row in live_rows if row["id"]}
    live_by_sku: dict[str, list[dict[str, Any]]] = {}
    for row in live_rows:
        if row["sku_id"]:
            live_by_sku.setdefault(row["sku_id"], []).append(row)

    generation_ids = set(sku_ids)
    compatibility_only_count = sum(
        1 for row in live_rows if row["sku_id"] and row["sku_id"] not in generation_ids
    )
    grouped: dict[str, dict[str, Any]] = {}
    state_counts = {
        "ready": 0,
        "missing": 0,
        "non_positive": 0,
        "ambiguous": 0,
        "not_applicable": 0,
    }

    for raw in raw_rows:
        sku_id = _text(raw.get("sku_id"))
        source = raw.get("source") if isinstance(raw.get("source"), dict) else {}
        target_price_id = _text(source.get("target_price_id"))
        candidate_price = _number(raw.get("list_price"))
        candidates = live_by_sku.get(sku_id, [])
        selected: dict[str, Any] | None = None
        price_reason_codes: list[str] = []

        if target_price_id:
            target = live_by_id.get(target_price_id)
            if target is None:
                price_reason_codes.append("active_price_target_record_missing")
            elif target["sku_id"] != sku_id:
                price_reason_codes.append("active_price_target_sku_mismatch")
            else:
                selected = target
        elif len(candidates) == 1:
            selected = candidates[0]
        elif len(candidates) > 1:
            price_reason_codes.append("active_price_record_ambiguous")

        scope = _text(raw.get("scope_classification"))
        price_required = scope != "catalog_reference_only"
        current_price = _list_price(selected["payload"]) if selected else None
        if not price_required:
            price_state = "not_applicable"
        elif "active_price_record_ambiguous" in price_reason_codes:
            price_state = "ambiguous"
        elif selected is None or current_price is None:
            price_state = "missing"
            if not price_reason_codes:
                price_reason_codes.append("active_sell_in_missing")
        elif current_price <= 0:
            price_state = "non_positive"
            price_reason_codes.append("active_sell_in_non_positive")
        else:
            price_state = "ready"
        state_counts[price_state] += 1

        group_key, group_label, group_kind, group_priority = _group_identity(raw)
        item = {
            "sku_id": sku_id,
            "sku_code": _text(raw.get("sku_code")),
            "sku_name": _text(raw.get("sku_name")) or sku_id,
            "beer_name": _text(raw.get("beer_name")),
            "canonical_beer_id": _text(raw.get("canonical_beer_id")),
            "subject_type": _text(raw.get("subject_type")),
            "subject_id": _text(raw.get("subject_id")),
            "sku_kind": _text(raw.get("sku_kind")),
            "scope_classification": scope,
            "cost_price": _number(raw.get("cost_price")),
            "cost_state": _cost_state(raw),
            "cost_blocker_codes": sorted(
                {_text(code) for code in raw.get("cost_blocker_codes", []) if _text(code)}
            ),
            "activation_list_price": candidate_price,
            "list_price": current_price,
            "price_state": price_state,
            "price_required": price_required,
            "price_reason_codes": sorted(set(price_reason_codes)),
            "pricing_record_id": selected["id"] if selected else "",
            "pricing_record_hash": selected["payload_hash"] if selected else "",
            "pricing_updated_at": selected["updated_at"] if selected else "",
            "target_pricing_id": target_price_id,
            "price_source": (
                "target_record"
                if selected and target_price_id and selected["id"] == target_price_id
                else "sku_record"
                if selected
                else "missing"
            ),
            "editable": bool(can_edit and price_required and price_state != "ambiguous"),
            "display_priority": _display_priority(raw),
        }
        group = grouped.setdefault(
            group_key,
            {
                "key": group_key,
                "label": group_label,
                "kind": group_kind,
                "priority": group_priority,
                "items": [],
            },
        )
        group["items"].append(item)

    groups = list(grouped.values())
    for group in groups:
        group["items"].sort(
            key=lambda row: (
                int(row["display_priority"]),
                _text(row["sku_name"]).casefold(),
                _text(row["sku_id"]),
            )
        )
    groups.sort(
        key=lambda group: (
            int(group["priority"]),
            _text(group["label"]).casefold(),
            group["key"],
        )
    )
    return {
        "version": CONTRACT_VERSION,
        "status": "ready",
        "read_only": not can_edit,
        "can_edit": can_edit,
        "binding": {
            "generation_id": _text(binding.get("generation_id")),
            "run_id": _text(binding.get("run_id")),
            "operational_year": int(dossier.get("operational_year") or 0),
            "manifest_hash": _text(binding.get("manifest_hash")),
            "validation_hash": _text(binding.get("validation_hash")),
        },
        "groups": groups,
        "summary": {
            "sku_count": len(sku_ids),
            "group_count": len(groups),
            "ready_price_count": state_counts["ready"],
            "missing_price_count": state_counts["missing"],
            "non_positive_price_count": state_counts["non_positive"],
            "ambiguous_price_count": state_counts["ambiguous"],
            "not_applicable_price_count": state_counts["not_applicable"],
            "compatibility_only_price_count": compatibility_only_count,
        },
        "reason_codes": [],
    }


def read_active_sales_strategy(*, can_edit: bool = False) -> dict[str, Any]:
    """Read active SKU scope and current sell-in rows without initializing schema."""

    dossier = yearset_dossier_service.read_active_yearset_dossier()
    if dossier.get("status") != "ready":
        return build_active_sales_strategy(
            dossier,
            live_price_rows=[],
            can_edit=can_edit,
        )
    year = int(dossier.get("operational_year") or 0)
    with postgres_storage.connect() as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        rows = conn.execute(
            """
            SELECT id, record_type, jaar, payload, updated_at
            FROM sales_pricing_records
            WHERE jaar = %s
              AND record_type = 'verkoopstrategie_product'
            ORDER BY id
            """,
            (year,),
        ).fetchall()
    columns = ("id", "record_type", "year", "payload", "updated_at")
    return build_active_sales_strategy(
        dossier,
        live_price_rows=[dict(zip(columns, row, strict=True)) for row in rows],
        can_edit=can_edit,
    )


def _new_record_id(year: int, sku_id: str) -> str:
    stable = uuid5(NAMESPACE_URL, f"calculatietool:active-sales-strategy:{year}:{sku_id}")
    return f"verkoopstrategie-actief-{year}-{stable}"


def update_active_sales_strategy(
    *,
    generation_id: str,
    run_id: str,
    manifest_hash: str,
    changes: Iterable[dict[str, Any]],
    actor: str,
) -> dict[str, Any]:
    """Atomically update only explicitly changed active-generation SKU prices."""

    normalized_changes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in changes:
        if not isinstance(raw, dict):
            raise ValueError("Ongeldige prijswijziging.")
        sku_id = _text(raw.get("sku_id"))
        if not sku_id or sku_id in seen:
            raise ValueError("Elke prijswijziging moet precies één unieke sku_id bevatten.")
        price = _number(raw.get("list_price"))
        if price is None or price <= 0:
            raise ValueError("Lijstprijs moet groter zijn dan nul.")
        seen.add(sku_id)
        normalized_changes.append(
            {
                "sku_id": sku_id,
                "list_price": price,
                "pricing_record_id": _text(raw.get("pricing_record_id")),
                "expected_record_hash": _text(raw.get("expected_record_hash")),
            }
        )
    if not normalized_changes:
        return read_active_sales_strategy(can_edit=True)

    with postgres_storage.transaction() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (_WRITE_LOCK_KEY,))
        authority = conn.execute(
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
            raise ActiveSalesStrategyBlocked("Actieve commerciële jaarset ontbreekt.")
        current_generation_id = _text(authority[0])
        year = int(authority[1] or 0)
        current_run_id = _text(authority[4])
        current_manifest_hash = _text(authority[7])
        if (
            current_generation_id != _text(generation_id)
            or current_run_id != _text(run_id)
            or current_manifest_hash != _text(manifest_hash)
        ):
            raise ActiveSalesStrategyConflict(
                "De actieve jaarset is gewijzigd. Herlaad Verkoopstrategie en probeer opnieuw."
            )
        if _text(authority[2]) != "active" or _text(authority[3]) != "ready":
            raise ActiveSalesStrategyBlocked("De actieve jaarset is niet gereed.")
        if _text(authority[5]) != "active" or _text(authority[6]) != "ready":
            raise ActiveSalesStrategyBlocked("De actieve reconciliatie is niet gereed.")

        for change in normalized_changes:
            sku_id = change["sku_id"]
            candidate = conn.execute(
                """
                SELECT s.canonical_beer_id, s.subject_type, s.subject_id,
                       s.scope_classification, s.cost_price,
                       p.target_pricing_id,
                       COALESCE(k.name, s.sku_id)
                FROM commercial_yearset_candidate_skus s
                LEFT JOIN commercial_yearset_candidate_prices p
                  ON p.run_id = s.run_id AND p.sku_id = s.sku_id
                LEFT JOIN skus k ON k.id = s.sku_id
                WHERE s.run_id = %s AND s.sku_id = %s
                """,
                (current_run_id, sku_id),
            ).fetchone()
            if not candidate:
                raise ActiveSalesStrategyBlocked(
                    f"SKU '{sku_id}' hoort niet bij de actieve jaarset."
                )
            if _text(candidate[3]) == "catalog_reference_only":
                raise ActiveSalesStrategyBlocked(
                    f"SKU '{sku_id}' is alleen een catalogusreferentie en kan hier niet worden geprijsd."
                )

            target_price_id = _text(candidate[5])
            selected_row = None
            if target_price_id:
                selected_row = conn.execute(
                    """
                    SELECT id, record_type, jaar, bier_id, product_id,
                           verpakking, payload, updated_at
                    FROM sales_pricing_records
                    WHERE id = %s
                    FOR UPDATE
                    """,
                    (target_price_id,),
                ).fetchone()
                if not selected_row:
                    raise ActiveSalesStrategyBlocked(
                        f"Het vastgelegde prijsrecord voor SKU '{sku_id}' ontbreekt."
                    )
            else:
                matching = conn.execute(
                    """
                    SELECT id, record_type, jaar, bier_id, product_id,
                           verpakking, payload, updated_at
                    FROM sales_pricing_records
                    WHERE jaar = %s
                      AND record_type = 'verkoopstrategie_product'
                      AND payload->>'sku_id' = %s
                    ORDER BY id
                    FOR UPDATE
                    """,
                    (year, sku_id),
                ).fetchall()
                if len(matching) > 1:
                    raise ActiveSalesStrategyBlocked(
                        f"Meerdere actuele prijsrecords gevonden voor SKU '{sku_id}'."
                    )
                selected_row = matching[0] if matching else None

            requested_record_id = change["pricing_record_id"]
            if selected_row:
                record_id = _text(selected_row[0])
                if requested_record_id and requested_record_id != record_id:
                    raise ActiveSalesStrategyConflict(
                        f"Het prijsrecord voor SKU '{sku_id}' is gewijzigd."
                    )
                current_payload = _mapping(selected_row[6])
                current_hash = _payload_hash(current_payload)
                if change["expected_record_hash"] != current_hash:
                    raise ActiveSalesStrategyConflict(
                        f"De lijstprijs voor SKU '{sku_id}' is intussen gewijzigd. Herlaad de pagina."
                    )
            else:
                if requested_record_id or change["expected_record_hash"]:
                    raise ActiveSalesStrategyConflict(
                        f"De prijsstatus voor SKU '{sku_id}' is intussen gewijzigd."
                    )
                record_id = _new_record_id(year, sku_id)
                current_payload = {}

            next_payload = copy.deepcopy(current_payload)
            prices = next_payload.get("sell_in_prices")
            prices = copy.deepcopy(prices) if isinstance(prices, dict) else {}
            prices["list"] = change["list_price"]
            next_payload.update(
                {
                    "id": record_id,
                    "record_type": "verkoopstrategie_product",
                    "jaar": year,
                    "sku_id": sku_id,
                    "bier_id": _text(candidate[0]),
                    "biernaam": _text(current_payload.get("biernaam")),
                    "product_id": sku_id,
                    "product_type": _text(current_payload.get("product_type")),
                    "verpakking": _text(candidate[6]) or sku_id,
                    "strategie_type": _text(current_payload.get("strategie_type")) or "override",
                    "kostprijs": _number(candidate[4]),
                    "sell_in_prices": prices,
                }
            )
            conn.execute(
                """
                INSERT INTO sales_pricing_records (
                    id, record_type, jaar, bier_id, product_id,
                    verpakking, payload, updated_at
                )
                VALUES (%s, 'verkoopstrategie_product', %s, %s, %s, %s, %s::jsonb, NOW())
                ON CONFLICT (id)
                DO UPDATE SET
                    record_type = EXCLUDED.record_type,
                    jaar = EXCLUDED.jaar,
                    bier_id = EXCLUDED.bier_id,
                    product_id = EXCLUDED.product_id,
                    verpakking = EXCLUDED.verpakking,
                    payload = EXCLUDED.payload,
                    updated_at = NOW()
                """,
                (
                    record_id,
                    year,
                    _text(candidate[0]),
                    sku_id,
                    _text(candidate[6]) or sku_id,
                    json.dumps(next_payload, ensure_ascii=False),
                ),
            )

    return read_active_sales_strategy(can_edit=True)
