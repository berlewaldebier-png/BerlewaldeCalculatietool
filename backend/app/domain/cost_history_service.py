from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

from app.domain import postgres_storage, yearset_dossier_service


CONTRACT_VERSION = "rf-012d3-v1"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed and parsed not in {float("inf"), float("-inf")} else None


def _iso(value: Any) -> str:
    return _text(value.isoformat() if hasattr(value, "isoformat") else value)


def _codes(values: Any) -> list[str]:
    if not isinstance(values, (list, tuple, set)):
        return []
    return sorted({_text(value) for value in values if _text(value)})


def _missing(reason_codes: Iterable[str], *, binding: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "version": CONTRACT_VERSION,
        "status": "missing",
        "read_only": True,
        "binding": dict(binding) if isinstance(binding, dict) else None,
        "summary": {
            "sku_count": 0,
            "source_anchor_verified_count": 0,
            "target_anchor_verified_count": 0,
            "active_generation_only_count": 0,
            "not_applicable_count": 0,
            "cost_version_count": 0,
            "additional_variant_count": 0,
            "canonical_lot_count": 0,
            "unverified_declared_lot_count": 0,
            "direct_lot_evidence_count": 0,
            "unresolved_evidence_count": 0,
        },
        "histories": [],
        "reason_codes": sorted({_text(code) for code in reason_codes if _text(code)}),
    }


def _component_state(row: dict[str, Any], *, cost_required: bool = True) -> str:
    total = _number(row.get("cost_price", row.get("kostprijs")))
    if not cost_required:
        return "not_applicable"
    if total is None or total <= 0:
        return "missing_cost"
    values = [
        row.get("primary_cost", row.get("inkoop")),
        row.get("packaging_cost", row.get("verpakkingskosten")),
        row.get("overhead_cost", row.get("indirecte_kosten")),
        row.get("excise_cost", row.get("accijns")),
    ]
    try:
        component_total = sum(Decimal(str(value or 0)) for value in values)
        difference = abs(component_total - Decimal(str(total)))
    except (InvalidOperation, ValueError):
        return "component_mismatch"
    return "ready" if difference <= Decimal("0.000001") else "component_mismatch"


def _components(row: dict[str, Any]) -> dict[str, float | None]:
    return {
        "primary_cost": _number(row.get("primary_cost", row.get("inkoop"))),
        "packaging_cost": _number(row.get("packaging_cost", row.get("verpakkingskosten"))),
        "overhead_cost": _number(row.get("overhead_cost", row.get("indirecte_kosten"))),
        "excise_cost": _number(row.get("excise_cost", row.get("accijns"))),
        "cost_price": _number(row.get("cost_price", row.get("kostprijs"))),
    }


def _component_signature(row: dict[str, Any]) -> tuple[str, ...]:
    components = _components(row)
    return tuple(
        "" if value is None else format(Decimal(str(value)).quantize(Decimal("0.000001")), "f")
        for value in components.values()
    )


def _exact_lot(value: Any) -> str:
    return "".join(character for character in _text(value).upper() if character.isalnum())


def build_cost_history(
    dossier: dict[str, Any],
    *,
    authority_anchors: Iterable[dict[str, Any]] = (),
    target_anchors: Iterable[dict[str, Any]] = (),
    version_rows: Iterable[dict[str, Any]] = (),
    canonical_lots: Iterable[dict[str, Any]] = (),
    declared_lots: Iterable[dict[str, Any]] = (),
    direct_lot_evidence: Iterable[dict[str, Any]] = (),
    superseded_anchor_rows: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    """Build a read-only history without treating unresolved evidence as a cost."""

    binding = dossier.get("binding") if isinstance(dossier.get("binding"), dict) else None
    if dossier.get("status") != "ready" or not binding:
        return _missing(dossier.get("reason_codes") or ["active_commercial_yearset_missing"], binding=binding)
    if _text(binding.get("generation_status")) != "active":
        return _missing(["commercial_yearset_not_active"], binding=binding)

    year = int(dossier.get("operational_year") or 0)
    sku_rows = [row for row in dossier.get("sku_items", []) if isinstance(row, dict)]
    sku_ids = [_text(row.get("sku_id")) for row in sku_rows]
    if any(not sku_id for sku_id in sku_ids) or len(sku_ids) != len(set(sku_ids)):
        return _missing(["active_generation_sku_identity_invalid"], binding=binding)
    sku_id_set = set(sku_ids)

    anchor_by_id: dict[str, dict[str, Any]] = {}
    for raw in authority_anchors:
        anchor_id = _text(raw.get("anchor_id"))
        sku_id = _text(raw.get("sku_id"))
        if sku_id not in sku_id_set:
            continue
        if not anchor_id or anchor_id in anchor_by_id:
            return _missing(["duplicate_or_missing_source_anchor_identity"], binding=binding)
        anchor_by_id[anchor_id] = dict(raw)

    target_anchor_by_sku: dict[str, dict[str, Any]] = {}
    for raw in target_anchors:
        sku_id = _text(raw.get("sku_id"))
        if sku_id not in sku_id_set:
            continue
        if sku_id in target_anchor_by_sku:
            return _missing(["duplicate_target_planning_anchor"], binding=binding)
        target_anchor_by_sku[sku_id] = dict(raw)

    cost_rows: dict[str, dict[str, Any]] = {}
    for raw in version_rows:
        row_id = _text(raw.get("cost_row_id"))
        sku_id = _text(raw.get("sku_id"))
        if sku_id not in sku_id_set:
            continue
        if not row_id or row_id in cost_rows:
            return _missing(["duplicate_or_missing_cost_row_identity"], binding=binding)
        cost_rows[row_id] = dict(raw)

    lots_by_row: dict[str, list[dict[str, Any]]] = defaultdict(list)
    canonical_lot_keys: set[tuple[str, str]] = set()
    for raw in canonical_lots:
        sku_id = _text(raw.get("sku_id"))
        row_id = _text(raw.get("cost_row_id"))
        lot_number = _text(raw.get("lot_number"))
        if sku_id not in sku_id_set:
            continue
        canonical_lot_keys.add((sku_id, _exact_lot(lot_number)))
        if row_id in cost_rows:
            lots_by_row[row_id].append(
                {
                    "lineage_id": _text(raw.get("lineage_id")),
                    "lot_number": lot_number,
                    "source_type": _text(raw.get("source_type")),
                    "source_ref": _text(raw.get("source_ref")),
                    "source_date": _iso(raw.get("source_date")),
                    "supplier": _text(raw.get("supplier")),
                    "resolution_status": _text(raw.get("resolution_status")) or "resolved",
                    "evidence_kind": "canonical_lot",
                }
            )

    declared_by_version: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for raw in declared_lots:
        version_id = _text(raw.get("cost_version_id"))
        lot_number = _text(raw.get("lot_number"))
        if version_id and lot_number:
            declared_by_version[version_id].append(
                {
                    "lot_number": lot_number,
                    "source_type": _text(raw.get("source_type")),
                    "source_ref": _text(raw.get("source_ref")),
                    "source_date": _iso(raw.get("source_date")),
                    "supplier": _text(raw.get("supplier")),
                    "resolution_status": "unresolved",
                    "evidence_kind": "version_declared_lot",
                }
            )

    superseded_pairs = {
        (_text(raw.get("sku_id")), _text(raw.get("cost_version_id")), _text(raw.get("cost_row_id")))
        for raw in superseded_anchor_rows
        if _text(raw.get("sku_id")) and _text(raw.get("cost_version_id")) and _text(raw.get("cost_row_id"))
    }
    evidence_by_sku: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for raw in direct_lot_evidence:
        sku_id = _text(raw.get("sku_id"))
        lot_number = _text(raw.get("lot_number"))
        if sku_id not in sku_id_set or (sku_id, _exact_lot(lot_number)) in canonical_lot_keys:
            continue
        evidence_by_sku[sku_id].append(
            {
                "evidence_id": _text(raw.get("evidence_id")),
                "evidence_kind": "direct_lot_without_canonical_lineage",
                "source_type": _text(raw.get("source_type")),
                "source_ref": _text(raw.get("source_ref")),
                "source_date": _iso(raw.get("source_date")),
                "supplier": _text(raw.get("supplier")),
                "lot_number": lot_number,
                "product_name": _text(raw.get("product_name")),
                "reason_codes": ["direct_lot_cost_without_canonical_lineage"],
                "components": None,
            }
        )

    records_by_sku: dict[str, list[dict[str, Any]]] = defaultdict(list)
    additional_variants = 0
    for row_id, raw in cost_rows.items():
        sku_id = _text(raw.get("sku_id"))
        version_id = _text(raw.get("cost_version_id"))
        source = next((item for item in sku_rows if _text(item.get("sku_id")) == sku_id), {})
        source_ids = source.get("source") if isinstance(source.get("source"), dict) else {}
        target_anchor = target_anchor_by_sku.get(sku_id, {})
        is_anchor_source = (
            version_id == _text(source_ids.get("cost_version_id"))
            and row_id == _text(source_ids.get("cost_row_id"))
        )
        is_target_anchor_source = (
            version_id == _text(target_anchor.get("cost_version_id"))
            and row_id == _text(target_anchor.get("cost_row_id"))
        )
        relation = (
            "anchor_source"
            if is_anchor_source
            else "target_anchor_source"
            if is_target_anchor_source
            else "registered_variant"
        )
        if (sku_id, version_id, row_id) in superseded_pairs:
            relation = "superseded_anchor"
        if relation not in {"anchor_source", "target_anchor_source"}:
            additional_variants += 1

        resolved_lots = sorted(lots_by_row.get(row_id, []), key=lambda item: (item["source_date"], item["lot_number"]))
        resolved_keys = {_exact_lot(item["lot_number"]) for item in resolved_lots}
        unverified_lots = [
            item
            for item in declared_by_version.get(version_id, [])
            if _exact_lot(item["lot_number"]) not in resolved_keys
        ]
        records_by_sku[sku_id].append(
            {
                "record_id": f"cost-row:{row_id}",
                "record_kind": "cost_version",
                "relation_to_anchor": relation,
                "cost_version_id": version_id,
                "cost_row_id": row_id,
                "source_year": int(raw.get("source_year") or 0),
                "version_number": int(raw.get("version_number") or 0),
                "version_status": _text(raw.get("version_status")),
                "cost_method": _text(raw.get("cost_method")),
                "cost_source": _text(raw.get("cost_source")),
                "source_ref": _text(raw.get("source_ref")),
                "effective_at": _iso(raw.get("effective_at")),
                "supplier": _text(raw.get("supplier")),
                "component_state": _component_state(raw),
                "components": _components(raw),
                "lots": resolved_lots,
                "unverified_lots": sorted(unverified_lots, key=lambda item: (item["source_date"], item["lot_number"])),
            }
        )

    histories: list[dict[str, Any]] = []
    source_anchor_verified_count = 0
    target_anchor_verified_count = 0
    active_generation_only_count = 0
    not_applicable_count = 0
    for sku in sku_rows:
        sku_id = _text(sku.get("sku_id"))
        source = sku.get("source") if isinstance(sku.get("source"), dict) else {}
        source_anchor_id = _text(source.get("anchor_id"))
        authority = anchor_by_id.get(source_anchor_id)
        target_anchor = target_anchor_by_sku.get(sku_id)
        cost_required = bool(sku.get("cost_required"))
        if not cost_required:
            authority_status = "not_applicable"
            not_applicable_count += 1
        elif source_anchor_id:
            if not authority:
                return _missing(["source_planning_anchor_missing"], binding=binding)
            if (
                _text(authority.get("sku_id")) != sku_id
                or _text(authority.get("cost_version_id")) != _text(source.get("cost_version_id"))
                or _text(authority.get("cost_row_id")) != _text(source.get("cost_row_id"))
            ):
                return _missing(["planning_anchor_binding_mismatch"], binding=binding)
            if (
                int(authority.get("planning_year") or 0) == year
                and _text(sku.get("provenance_kind")) == "recovered_from_exact_target_anchor"
            ):
                authority_status = "target_anchor_verified"
                target_anchor_verified_count += 1
            else:
                authority_status = "source_anchor_verified"
                source_anchor_verified_count += 1
        else:
            if target_anchor and _component_signature(target_anchor) == _component_signature(sku):
                authority_status = "target_anchor_verified"
                target_anchor_verified_count += 1
            else:
                authority_status = "active_generation_only"
                active_generation_only_count += 1

        anchor = {
            "record_id": f"active-generation:{sku_id}",
            "record_kind": "active_planning_anchor",
            "authority_status": authority_status,
            "planning_year": year,
            "source_anchor_id": source_anchor_id,
            "cost_version_id": _text(source.get("cost_version_id")),
            "cost_row_id": _text(source.get("cost_row_id")),
            "source_anchor_kind": _text((authority or {}).get("anchor_kind")),
            "source_anchor_year": int((authority or {}).get("planning_year") or 0),
            "source_anchor_effective_at": _iso((authority or {}).get("effective_at")),
            "target_anchor_id": _text((target_anchor or {}).get("anchor_id")),
            "target_cost_version_id": _text((target_anchor or {}).get("cost_version_id")),
            "target_cost_row_id": _text((target_anchor or {}).get("cost_row_id")),
            "effective_at": _iso(dossier.get("audit", {}).get("generation", {}).get("activated_at")),
            "cost_method": _text(sku.get("cost_method")),
            "provenance_kind": _text(sku.get("provenance_kind")),
            "provenance_source_year": int(sku.get("provenance_source_year") or 0),
            "component_state": _component_state(sku, cost_required=cost_required),
            "components": _components(sku),
            "cost_blocker_codes": _codes(sku.get("cost_blocker_codes")),
        }
        records = records_by_sku.get(sku_id, [])
        records.sort(
            key=lambda row: (
                0 if row["relation_to_anchor"] in {"anchor_source", "target_anchor_source"} else 1,
                -int(row["source_year"]),
                row["effective_at"],
                row["cost_version_id"],
                row["cost_row_id"],
            )
        )
        evidence = evidence_by_sku.get(sku_id, [])
        evidence.sort(key=lambda row: (row["source_date"], row["lot_number"], row["evidence_id"]))
        histories.append(
            {
                "sku_id": sku_id,
                "sku_code": _text(sku.get("sku_code")),
                "sku_name": _text(sku.get("sku_name")) or sku_id,
                "beer_name": _text(sku.get("beer_name")),
                "subject_type": _text(sku.get("subject_type")),
                "active_anchor": anchor,
                "cost_versions": records,
                "unresolved_evidence": evidence,
                "reason_codes": ["active_generation_has_no_relational_anchor"] if authority_status == "active_generation_only" else [],
            }
        )

    histories.sort(key=lambda row: (row["beer_name"].casefold(), row["sku_name"].casefold(), row["sku_id"]))
    canonical_lot_count = sum(len(record["lots"]) for history in histories for record in history["cost_versions"])
    unverified_declared_lot_count = sum(
        len(record["unverified_lots"])
        for history in histories
        for record in history["cost_versions"]
    )
    direct_lot_evidence_count = sum(len(history["unresolved_evidence"]) for history in histories)
    unresolved_count = unverified_declared_lot_count + direct_lot_evidence_count
    return {
        "version": CONTRACT_VERSION,
        "status": "ready",
        "read_only": True,
        "binding": {
            "generation_id": _text(binding.get("generation_id")),
            "run_id": _text(binding.get("run_id")),
            "operational_year": year,
            "manifest_hash": _text(binding.get("manifest_hash")),
            "validation_hash": _text(binding.get("validation_hash")),
        },
        "summary": {
            "sku_count": len(histories),
            "source_anchor_verified_count": source_anchor_verified_count,
            "target_anchor_verified_count": target_anchor_verified_count,
            "active_generation_only_count": active_generation_only_count,
            "not_applicable_count": not_applicable_count,
            "cost_version_count": sum(len(history["cost_versions"]) for history in histories),
            "additional_variant_count": additional_variants,
            "canonical_lot_count": canonical_lot_count,
            "unverified_declared_lot_count": unverified_declared_lot_count,
            "direct_lot_evidence_count": direct_lot_evidence_count,
            "unresolved_evidence_count": unresolved_count,
        },
        "histories": histories,
        "reason_codes": [],
    }


def _dict_rows(rows: Iterable[Any], columns: tuple[str, ...]) -> list[dict[str, Any]]:
    return [dict(zip(columns, row, strict=True)) for row in rows]


def read_active_cost_history() -> dict[str, Any]:
    """Read active cost history and evidence without writes or schema initialization."""

    dossier = yearset_dossier_service.read_active_yearset_dossier()
    if dossier.get("status") != "ready":
        return build_cost_history(dossier)
    binding = dossier.get("binding") if isinstance(dossier.get("binding"), dict) else {}
    generation_id = _text(binding.get("generation_id"))
    year = int(dossier.get("operational_year") or 0)
    sku_ids = sorted({_text(row.get("sku_id")) for row in dossier.get("sku_items", []) if _text(row.get("sku_id"))})
    source_anchor_ids = sorted(
        {
            _text(row.get("source", {}).get("anchor_id"))
            for row in dossier.get("sku_items", [])
            if isinstance(row, dict)
            and isinstance(row.get("source"), dict)
            and _text(row.get("source", {}).get("anchor_id"))
        }
    )
    target_anchor_sku_ids = sorted(
        {
            _text(row.get("sku_id"))
            for row in dossier.get("sku_items", [])
            if isinstance(row, dict)
            and bool(row.get("cost_required"))
            and isinstance(row.get("source"), dict)
            and not _text(row.get("source", {}).get("anchor_id"))
            and _text(row.get("sku_id"))
        }
    )
    if not generation_id or not sku_ids:
        return _missing(["active_generation_binding_incomplete"], binding=binding)

    with postgres_storage.connect() as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        active_row = conn.execute(
            "SELECT id FROM commercial_yearsets WHERE status = 'active'",
        ).fetchone()
        if not active_row or _text(active_row[0]) != generation_id:
            return _missing(["active_generation_changed_during_history_read"], binding=binding)

        anchor_rows = conn.execute(
            """
            SELECT anchor.id, anchor.sku_id, anchor.planning_year,
                   anchor.activation_id, anchor.cost_version_id,
                   anchor.cost_row_id, anchor.anchor_kind, anchor.effective_at,
                   row.inkoop, row.verpakkingskosten, row.indirecte_kosten,
                   row.accijns, row.kostprijs
            FROM planning_cost_anchors anchor
            JOIN cost_version_sku_rows row ON row.id = anchor.cost_row_id
            WHERE anchor.id = ANY(%s)
            ORDER BY anchor.sku_id
            """,
            (source_anchor_ids,),
        ).fetchall() if source_anchor_ids else []
        target_anchor_rows = conn.execute(
            """
            SELECT anchor.id, anchor.sku_id, anchor.planning_year,
                   anchor.activation_id, anchor.cost_version_id,
                   anchor.cost_row_id, anchor.anchor_kind, anchor.effective_at,
                   row.inkoop, row.verpakkingskosten, row.indirecte_kosten,
                   row.accijns, row.kostprijs
            FROM planning_cost_anchors anchor
            JOIN cost_version_sku_rows row ON row.id = anchor.cost_row_id
            WHERE anchor.planning_year = %s
              AND anchor.sku_id = ANY(%s)
            ORDER BY anchor.sku_id
            """,
            (year, target_anchor_sku_ids),
        ).fetchall() if target_anchor_sku_ids else []
        version_rows = conn.execute(
            """
            SELECT r.id, r.version_id, r.sku_id, v.jaar, v.versie_nummer,
                   v.status,
                   COALESCE(NULLIF(v.payload->>'type', ''), NULLIF(v.payload->'soort_berekening'->>'type', ''), ''),
                   COALESCE(NULLIF(v.payload->>'cost_source', ''), ''),
                   COALESCE(NULLIF(v.payload->>'factuurnummer', ''), NULLIF(v.payload->>'invoice_number', ''), ''),
                   COALESCE(NULLIF(v.payload->>'supplier_name', ''), NULLIF(v.payload->>'leverancier', ''), ''),
                   COALESCE(v.finalized_at, v.updated_at, v.created_at),
                   r.inkoop, r.verpakkingskosten, r.indirecte_kosten,
                   r.accijns, r.kostprijs
            FROM cost_version_sku_rows r
            JOIN cost_versions v ON v.id = r.version_id
            WHERE r.sku_id = ANY(%s)
            ORDER BY r.sku_id, v.jaar DESC, v.versie_nummer DESC, r.id
            """,
            (sku_ids,),
        ).fetchall()
        canonical_lot_rows = conn.execute(
            """
            SELECT lineage.id, lineage.sku_id, lineage.cost_version_id,
                   lineage.cost_row_id, lineage.lot_number,
                   lineage.resolution_status, lot.source_type, lot.source_ref,
                   lot.source_date, lot.supplier
            FROM canonical_lot_cost_lineage lineage
            JOIN cost_version_lots lot ON lot.id = lineage.source_lot_id
            WHERE lineage.sku_id = ANY(%s)
            ORDER BY lineage.sku_id, lot.source_date, lineage.lot_number
            """,
            (sku_ids,),
        ).fetchall()
        declared_lot_rows = conn.execute(
            """
            SELECT lot.version_id, lot.lot_number, lot.source_type,
                   lot.source_ref, lot.source_date, lot.supplier
            FROM cost_version_lots lot
            WHERE lot.version_id IN (
                SELECT DISTINCT version_id
                FROM cost_version_sku_rows
                WHERE sku_id = ANY(%s)
            )
            ORDER BY lot.version_id, lot.source_date, lot.lot_number
            """,
            (sku_ids,),
        ).fetchall()
        direct_rows = conn.execute(
            """
            SELECT id, sku_id, sku_code, product_name, source_type,
                   source_ref, supplier, lot_number, source_date, updated_at
            FROM lot_cost_records
            WHERE sku_id = ANY(%s)
            ORDER BY sku_id, source_date, lot_number, id
            """,
            (sku_ids,),
        ).fetchall()
        superseded_rows = conn.execute(
            """
            SELECT anchor.sku_id, event.before_cost_version_id,
                   event.before_cost_row_id
            FROM planning_cost_anchor_events event
            JOIN planning_cost_anchors anchor ON anchor.id = event.anchor_id
            WHERE anchor.sku_id = ANY(%s)
              AND event.event_type = 'rebaseline_executed'
              AND event.before_cost_version_id <> ''
              AND event.before_cost_row_id <> ''
            ORDER BY anchor.sku_id, event.event_sequence
            """,
            (sku_ids,),
        ).fetchall()

    return build_cost_history(
        dossier,
        authority_anchors=_dict_rows(
            anchor_rows,
            (
                "anchor_id", "sku_id", "planning_year", "activation_id",
                "cost_version_id", "cost_row_id", "anchor_kind", "effective_at",
                "inkoop", "verpakkingskosten", "indirecte_kosten", "accijns",
                "kostprijs",
            ),
        ),
        target_anchors=_dict_rows(
            target_anchor_rows,
            (
                "anchor_id", "sku_id", "planning_year", "activation_id",
                "cost_version_id", "cost_row_id", "anchor_kind", "effective_at",
                "inkoop", "verpakkingskosten", "indirecte_kosten", "accijns",
                "kostprijs",
            ),
        ),
        version_rows=_dict_rows(
            version_rows,
            (
                "cost_row_id", "cost_version_id", "sku_id", "source_year",
                "version_number", "version_status", "cost_method", "cost_source",
                "source_ref", "supplier", "effective_at", "inkoop",
                "verpakkingskosten", "indirecte_kosten", "accijns", "kostprijs",
            ),
        ),
        canonical_lots=_dict_rows(
            canonical_lot_rows,
            (
                "lineage_id", "sku_id", "cost_version_id", "cost_row_id",
                "lot_number", "resolution_status", "source_type", "source_ref",
                "source_date", "supplier",
            ),
        ),
        declared_lots=_dict_rows(
            declared_lot_rows,
            ("cost_version_id", "lot_number", "source_type", "source_ref", "source_date", "supplier"),
        ),
        direct_lot_evidence=_dict_rows(
            direct_rows,
            (
                "evidence_id", "sku_id", "sku_code", "product_name", "source_type",
                "source_ref", "supplier", "lot_number", "source_date", "updated_at",
            ),
        ),
        superseded_anchor_rows=_dict_rows(
            superseded_rows,
            ("sku_id", "cost_version_id", "cost_row_id"),
        ),
    )
