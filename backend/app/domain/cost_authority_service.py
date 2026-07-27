from __future__ import annotations

from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import json
from typing import Any, Iterable, Mapping, Sequence
from uuid import NAMESPACE_URL, uuid5

from app.domain import cost_authority_storage, postgres_storage
from app.domain.cost_resolution_types import CostResolutionSnapshot
from app.domain.cost_resolution_utils import lot_exact_key
from app.domain.planning_cost_resolver import PlanningCostResolver


AUTHORITY_PLAN_VERSION = "rf-013b-v1"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _year(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _normalized_name(value: Any) -> str:
    return " ".join(_text(value).casefold().split())


def _stable_id(scope: str, *parts: Any) -> str:
    key = "|".join(_text(part) for part in parts)
    return str(uuid5(NAMESPACE_URL, f"calculatietool:{scope}:{key}"))


def _hash(value: Any) -> str:
    encoded = json.dumps(
        value,
        default=str,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    return "sha256:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return deepcopy(value)
    if isinstance(value, str) and value:
        parsed = json.loads(value)
        return deepcopy(parsed) if isinstance(parsed, dict) else {}
    return {}


def _manifest_row(
    *,
    source_type: str,
    source_id: str,
    source_hash: str,
    resolution_status: str,
    reason_code: str,
    target_type: str = "",
    target_id: str = "",
    candidate_ids: Iterable[str] = (),
) -> dict[str, Any]:
    return {
        "id": _stable_id("cost-authority-manifest", source_type, source_id),
        "source_type": source_type,
        "source_id": source_id,
        "source_hash": source_hash,
        "resolution_status": resolution_status,
        "target_type": target_type,
        "target_id": target_id,
        "reason_code": reason_code,
        "candidate_ids": sorted({_text(item) for item in candidate_ids if _text(item)}),
    }


def _article_subject_type(article: Mapping[str, Any], sku: Mapping[str, Any]) -> str:
    article_kind = _text(article.get("kind")).casefold()
    subtype = _text(
        sku.get("sellable_subtype")
        or article.get("sellable_subtype")
        or sku.get("sku_type")
    ).casefold()
    product_group = _text(
        sku.get("product_group") or article.get("product_group")
    ).casefold()
    if article_kind == "bundle" or subtype == "beer_bundle":
        return "bundle"
    if article_kind == "service" or subtype in {"dienst", "service"}:
        return "service"
    if product_group in {"dienst", "service", "dienstverlening"}:
        return "service"
    return "article"


def build_authority_plan(snapshot: Mapping[str, Sequence[Mapping[str, Any]]]) -> dict[str, Any]:
    """Build a deterministic, no-guess RF-013B plan from one read snapshot."""

    beer_records = [dict(row) for row in snapshot.get("beers", ())]
    sku_records = [dict(row) for row in snapshot.get("skus", ())]
    article_records = [dict(row) for row in snapshot.get("articles", ())]
    version_records = [dict(row) for row in snapshot.get("cost_versions", ())]
    cost_rows = [dict(row) for row in snapshot.get("cost_rows", ())]
    activations = [dict(row) for row in snapshot.get("activations", ())]
    activation_events = [dict(row) for row in snapshot.get("activation_events", ())]
    lot_records = [dict(row) for row in snapshot.get("cost_version_lots", ())]
    direct_lot_records = [
        dict(row) for row in snapshot.get("direct_lot_cost_records", ())
    ]

    mappings: list[dict[str, Any]] = []
    blockers: list[dict[str, str]] = []

    beers_by_id_input: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in beer_records:
        beers_by_id_input[_text(row.get("id"))].append(row)
    canonical_beers: list[dict[str, Any]] = []
    valid_beer_ids: set[str] = set()
    beer_ids_by_name: dict[str, list[str]] = defaultdict(list)
    for beer_id, rows in sorted(beers_by_id_input.items()):
        source_hash = _hash(rows)
        if not beer_id:
            blockers.append({"source_type": "beer", "reason_code": "empty_beer_id"})
            continue
        if len(rows) != 1:
            mappings.append(
                _manifest_row(
                    source_type="beer",
                    source_id=beer_id,
                    source_hash=source_hash,
                    resolution_status="ambiguous",
                    reason_code="duplicate_beer_id",
                )
            )
            blockers.append(
                {
                    "source_type": "beer",
                    "reason_code": "duplicate_beer_id",
                }
            )
            continue
        row = rows[0]
        name = _text(
            row.get("naam") or row.get("name") or row.get("biernaam") or beer_id
        )
        if not name:
            mappings.append(
                _manifest_row(
                    source_type="beer",
                    source_id=beer_id,
                    source_hash=source_hash,
                    resolution_status="unresolved",
                    reason_code="beer_name_missing",
                )
            )
            blockers.append(
                {"source_type": "beer", "reason_code": "beer_name_missing"}
            )
            continue
        normalized_name = _normalized_name(name)
        canonical_beers.append(
            {
                "id": beer_id,
                "legacy_beer_id": beer_id,
                "name": name,
                "normalized_name": normalized_name,
                "source_status": "resolved",
                "active": bool(row.get("active", row.get("actief", True))),
                "source_hash": source_hash,
            }
        )
        valid_beer_ids.add(beer_id)
        beer_ids_by_name[normalized_name].append(beer_id)
        mappings.append(
            _manifest_row(
                source_type="beer",
                source_id=beer_id,
                source_hash=source_hash,
                resolution_status="resolved",
                reason_code="stable_legacy_beer_id",
                target_type="beer",
                target_id=beer_id,
            )
        )

    articles_by_id = {
        _text(row.get("id")): row
        for row in article_records
        if _text(row.get("id"))
    }
    sku_subjects: list[dict[str, Any]] = []
    sku_subject_by_id: dict[str, dict[str, Any]] = {}
    for row in sorted(sku_records, key=lambda item: _text(item.get("id"))):
        sku_id = _text(row.get("id"))
        source_hash = _hash(row)
        kind = _text(row.get("kind") or "beer_format").casefold()
        beer_id = _text(row.get("beer_id"))
        format_id = _text(row.get("format_article_id"))
        article_id = _text(row.get("article_id"))
        subject: dict[str, Any] | None = None
        reason = ""
        candidates: list[str] = []
        if kind == "beer_format":
            if beer_id in valid_beer_ids and format_id:
                subject = {
                    "sku_id": sku_id,
                    "subject_type": "beer",
                    "subject_id": beer_id,
                    "beer_id": beer_id,
                    "format_article_id": format_id,
                    "article_id": article_id,
                    "classification_source": "sku_kind_beer_format",
                    "source_hash": source_hash,
                }
            elif not beer_id:
                reason = "beer_format_beer_id_missing"
            elif beer_id not in valid_beer_ids:
                reason = "beer_format_beer_unknown"
                candidates = [beer_id]
            else:
                reason = "beer_format_format_missing"
        elif kind in {"article", "bundle", "service"}:
            if not article_id:
                reason = "non_beer_article_id_missing"
            else:
                article = articles_by_id.get(article_id, {})
                subject_type = (
                    kind
                    if kind in {"bundle", "service"}
                    else _article_subject_type(article, row)
                )
                related_beer = beer_id if beer_id in valid_beer_ids else ""
                subject = {
                    "sku_id": sku_id,
                    "subject_type": subject_type,
                    "subject_id": article_id,
                    "beer_id": related_beer,
                    "format_article_id": format_id,
                    "article_id": article_id,
                    "classification_source": "sku_kind_and_article",
                    "source_hash": source_hash,
                }
        else:
            reason = "sku_kind_unknown"
        if not sku_id:
            blockers.append({"source_type": "sku", "reason_code": "sku_id_missing"})
            continue
        if subject:
            sku_subjects.append(subject)
            sku_subject_by_id[sku_id] = subject
            mappings.append(
                _manifest_row(
                    source_type="sku",
                    source_id=sku_id,
                    source_hash=source_hash,
                    resolution_status="resolved",
                    reason_code=_text(subject.get("classification_source")),
                    target_type=_text(subject.get("subject_type")),
                    target_id=_text(subject.get("subject_id")),
                )
            )
        else:
            mappings.append(
                _manifest_row(
                    source_type="sku",
                    source_id=sku_id,
                    source_hash=source_hash,
                    resolution_status="unresolved",
                    reason_code=reason,
                    candidate_ids=candidates,
                )
            )
            blockers.append({"source_type": "sku", "reason_code": reason})

    rows_by_version: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in cost_rows:
        rows_by_version[_text(row.get("version_id"))].append(row)

    version_subjects: list[dict[str, Any]] = []
    for version in sorted(version_records, key=lambda item: _text(item.get("id"))):
        version_id = _text(version.get("id"))
        legacy_beer_id = _text(version.get("bier_id"))
        source_hash = _hash(
            {
                "version_id": version_id,
                "bier_id": legacy_beer_id,
                "type": version.get("type"),
                "basisgegevens": version.get("basisgegevens"),
                "cost_row_skus": sorted(
                    _text(row.get("sku_id"))
                    for row in rows_by_version.get(version_id, [])
                ),
            }
        )
        subject_type = "unresolved"
        subject_id = ""
        canonical_beer_id = ""
        resolution_status = "unresolved"
        reason = "cost_version_subject_unknown"
        candidates: list[str] = []
        if legacy_beer_id in valid_beer_ids:
            subject_type = "beer"
            subject_id = legacy_beer_id
            canonical_beer_id = legacy_beer_id
            resolution_status = "resolved"
            reason = "exact_beer_id"
        else:
            name_candidates = beer_ids_by_name.get(
                _normalized_name(legacy_beer_id), []
            )
            if len(name_candidates) == 1:
                subject_type = "beer"
                subject_id = name_candidates[0]
                canonical_beer_id = name_candidates[0]
                resolution_status = "resolved"
                reason = "unique_legacy_beer_name"
            elif len(name_candidates) > 1:
                resolution_status = "ambiguous"
                reason = "duplicate_legacy_beer_name"
                candidates = list(name_candidates)
            else:
                row_subjects = {
                    (
                        _text(sku_subject_by_id.get(_text(row.get("sku_id")), {}).get("subject_type")),
                        _text(sku_subject_by_id.get(_text(row.get("sku_id")), {}).get("subject_id")),
                    )
                    for row in rows_by_version.get(version_id, [])
                    if _text(row.get("sku_id")) in sku_subject_by_id
                }
                row_subjects.discard(("", ""))
                if len(row_subjects) == 1:
                    subject_type, subject_id = next(iter(row_subjects))
                    resolution_status = "resolved"
                    reason = "single_cost_row_subject"
                    if subject_type == "beer":
                        canonical_beer_id = subject_id
                elif len(row_subjects) > 1:
                    resolution_status = "ambiguous"
                    reason = "multiple_cost_row_subjects"
                    candidates = [f"{kind}:{subject}" for kind, subject in row_subjects]
                elif not legacy_beer_id:
                    reason = "empty_legacy_beer_and_no_sku_subject"
                else:
                    reason = "unknown_legacy_beer_reference"
        version_subjects.append(
            {
                "version_id": version_id,
                "subject_type": subject_type,
                "subject_id": subject_id,
                "canonical_beer_id": canonical_beer_id,
                "resolution_status": resolution_status,
                "resolution_reason": reason,
                "source_hash": source_hash,
            }
        )
        mappings.append(
            _manifest_row(
                source_type="cost_version",
                source_id=version_id,
                source_hash=source_hash,
                resolution_status=resolution_status,
                reason_code=reason,
                target_type=subject_type if resolution_status == "resolved" else "",
                target_id=subject_id if resolution_status == "resolved" else "",
                candidate_ids=candidates,
            )
        )
        if resolution_status != "resolved":
            blockers.append(
                {"source_type": "cost_version", "reason_code": reason}
            )

    resolver = PlanningCostResolver(
        CostResolutionSnapshot.from_records(
            activations=activations,
            activation_events=activation_events,
            cost_versions=version_records,
            cost_rows=cost_rows,
            skus=sku_records,
        )
    )
    planning_scopes = sorted(
        {
            (_text(row.get("sku_id")), _year(row.get("jaar")))
            for row in [*activations, *activation_events]
            if _text(row.get("sku_id")) and _year(row.get("jaar")) > 0
        }
    )
    planning_anchors: list[dict[str, Any]] = []
    for sku_id, planning_year in planning_scopes:
        result = resolver.resolve_planning_cost(sku_id, planning_year)
        source_hash = _hash(
            {
                "sku_id": sku_id,
                "planning_year": planning_year,
                "source_ids": result.candidate_source_ids,
                "version_ids": result.candidate_version_ids,
                "cost_row_ids": result.candidate_cost_row_ids,
                "status": result.status,
            }
        )
        status = "resolved" if result.status == "resolved" else (
            "ambiguous" if result.status in {"ambiguous_anchor", "ambiguous_cost_row"} else "unresolved"
        )
        reason = (
            result.source
            if result.status == "resolved"
            else result.warnings[0] if result.warnings else result.status
        )
        if result.status == "resolved":
            planning_anchors.append(
                {
                    "sku_id": sku_id,
                    "planning_year": planning_year,
                    "activation_id": result.activation_id,
                    "cost_version_id": result.cost_version_id,
                    "cost_row_id": result.cost_row_id,
                    "effective_at": result.effective_at,
                    "source_hash": source_hash,
                }
            )
        else:
            blockers.append(
                {"source_type": "planning_anchor", "reason_code": reason}
            )
        mappings.append(
            _manifest_row(
                source_type="planning_anchor",
                source_id=f"{sku_id}:{planning_year}",
                source_hash=source_hash,
                resolution_status=status,
                reason_code=reason,
                target_type="cost_row" if result.status == "resolved" else "",
                target_id=result.cost_row_id if result.status == "resolved" else "",
                candidate_ids=(
                    *result.candidate_source_ids,
                    *result.candidate_version_ids,
                    *result.candidate_cost_row_ids,
                ),
            )
        )

    lot_candidates: dict[
        tuple[str, str], list[tuple[dict[str, Any], dict[str, Any]]]
    ] = defaultdict(list)
    for lot in lot_records:
        version_id = _text(lot.get("version_id"))
        key = lot_exact_key(lot.get("lot_number"))
        if not version_id or not key:
            continue
        for row in rows_by_version.get(version_id, []):
            sku_id = _text(row.get("sku_id"))
            if sku_id:
                lot_candidates[(sku_id, key)].append((lot, row))
    lot_lineage: list[dict[str, Any]] = []
    for (sku_id, exact_key), candidates in sorted(lot_candidates.items()):
        pairs = {
            (_text(lot.get("version_id")), _text(row.get("id")))
            for lot, row in candidates
        }
        source_id = f"{sku_id}:{exact_key}"
        source_hash = _hash(
            [
                {
                    "lot_id": _text(lot.get("id")),
                    "version_id": _text(lot.get("version_id")),
                    "cost_row_id": _text(row.get("id")),
                }
                for lot, row in candidates
            ]
        )
        if len(pairs) == 1 and len(candidates) == 1:
            lot, row = candidates[0]
            lineage_id = _stable_id("canonical-lot-lineage", sku_id, exact_key)
            lot_lineage.append(
                {
                    "id": lineage_id,
                    "sku_id": sku_id,
                    "lot_exact_key": exact_key,
                    "lot_number": _text(lot.get("lot_number")),
                    "source_lot_id": _text(lot.get("id")),
                    "cost_version_id": _text(lot.get("version_id")),
                    "cost_row_id": _text(row.get("id")),
                    "lineage_source": "cost_version_lot",
                    "source_hash": source_hash,
                }
            )
            mappings.append(
                _manifest_row(
                    source_type="lot_lineage",
                    source_id=source_id,
                    source_hash=source_hash,
                    resolution_status="resolved",
                    reason_code="unique_exact_lot_version_row",
                    target_type="cost_row",
                    target_id=_text(row.get("id")),
                )
            )
        else:
            mappings.append(
                _manifest_row(
                    source_type="lot_lineage",
                    source_id=source_id,
                    source_hash=source_hash,
                    resolution_status="ambiguous",
                    reason_code="exact_lot_multiple_version_rows",
                    candidate_ids=(
                        f"{version_id}:{row_id}" for version_id, row_id in pairs
                    ),
                )
            )
            blockers.append(
                {
                    "source_type": "lot_lineage",
                    "reason_code": "exact_lot_multiple_version_rows",
                }
            )

    for row in sorted(direct_lot_records, key=lambda item: _text(item.get("id"))):
        record_id = _text(row.get("id"))
        sku_id = _text(row.get("sku_id"))
        exact_key = lot_exact_key(row.get("lot_number"))
        source_hash = _hash(
            {
                "id": record_id,
                "sku_id": sku_id,
                "sku_code": _text(row.get("sku_code")),
                "lot_exact_key": exact_key,
                "source_type": _text(row.get("source_type")),
                "source_ref": _text(row.get("source_ref")),
            }
        )
        canonical_candidates = lot_candidates.get((sku_id, exact_key), [])
        canonical_pairs = {
            (_text(lot.get("version_id")), _text(cost_row.get("id")))
            for lot, cost_row in canonical_candidates
        }
        if sku_id and exact_key and len(canonical_candidates) == 1:
            _, cost_row = canonical_candidates[0]
            status = "resolved"
            reason = "direct_record_has_exact_canonical_lineage"
            target_type = "cost_row"
            target_id = _text(cost_row.get("id"))
            candidates = []
        elif len(canonical_pairs) > 1:
            status = "ambiguous"
            reason = "direct_record_exact_lot_ambiguous"
            target_type = ""
            target_id = ""
            candidates = [
                f"{version_id}:{cost_row_id}"
                for version_id, cost_row_id in canonical_pairs
            ]
            blockers.append(
                {
                    "source_type": "direct_lot_cost_record",
                    "reason_code": reason,
                }
            )
        else:
            status = "unresolved"
            reason = (
                "direct_lot_record_requires_canonical_lineage"
                if exact_key
                else "direct_non_lot_cost_requires_explicit_policy"
            )
            target_type = ""
            target_id = ""
            candidates = []
            blockers.append(
                {
                    "source_type": "direct_lot_cost_record",
                    "reason_code": reason,
                }
            )
        mappings.append(
            _manifest_row(
                source_type="direct_lot_cost_record",
                source_id=record_id,
                source_hash=source_hash,
                resolution_status=status,
                reason_code=reason,
                target_type=target_type,
                target_id=target_id,
                candidate_ids=candidates,
            )
        )

    reason_counts = Counter(row["reason_code"] for row in blockers)
    plan_payload = {
        "version": AUTHORITY_PLAN_VERSION,
        "beers": sorted(canonical_beers, key=lambda row: row["id"]),
        "sku_subjects": sorted(sku_subjects, key=lambda row: row["sku_id"]),
        "version_subjects": sorted(
            version_subjects, key=lambda row: row["version_id"]
        ),
        "planning_anchors": sorted(
            planning_anchors,
            key=lambda row: (row["planning_year"], row["sku_id"]),
        ),
        "lot_lineage": sorted(
            lot_lineage, key=lambda row: (row["sku_id"], row["lot_exact_key"])
        ),
        "mappings": sorted(
            mappings, key=lambda row: (row["source_type"], row["source_id"])
        ),
    }
    plan_hash = _hash(plan_payload)
    return {
        **plan_payload,
        "manifest_hash": plan_hash,
        "ready": not blockers,
        "blocker_counts": dict(sorted(reason_counts.items())),
        "counts": {
            "canonical_beers": len(canonical_beers),
            "canonical_sku_subjects": len(sku_subjects),
            "cost_version_subjects": len(version_subjects),
            "resolved_cost_version_subjects": sum(
                1
                for row in version_subjects
                if row["resolution_status"] == "resolved"
            ),
            "planning_cost_anchors": len(planning_anchors),
            "canonical_lot_cost_lineage": len(lot_lineage),
            "mapping_manifest": len(mappings),
            "blockers": len(blockers),
        },
    }


def read_legacy_snapshot() -> dict[str, list[dict[str, Any]]]:
    """Read all RF-013B inputs once; this function never writes or backfills."""

    with postgres_storage.connect() as conn:
        beer_row = conn.execute(
            "SELECT payload FROM app_datasets WHERE dataset_name = 'bieren'"
        ).fetchone()
        beers_raw = beer_row[0] if beer_row else []
        if isinstance(beers_raw, str):
            beers_raw = json.loads(beers_raw)
        beers = [
            dict(row)
            for row in beers_raw
            if isinstance(beers_raw, list) and isinstance(row, dict)
        ]

        skus = []
        for row in conn.execute(
            """
            SELECT id, kind, beer_id, format_article_id, article_id, code, name,
                   active, payload
            FROM skus
            ORDER BY id
            """
        ).fetchall():
            payload = _payload(row[8])
            skus.append(
                {
                    **payload,
                    "id": _text(row[0]),
                    "kind": _text(row[1]),
                    "beer_id": _text(row[2]),
                    "format_article_id": _text(row[3]),
                    "article_id": _text(row[4]),
                    "code": _text(row[5]),
                    "name": _text(row[6]),
                    "active": bool(row[7]),
                }
            )

        articles = []
        for row in conn.execute(
            """
            SELECT id, code, name, kind, uom, content_liter, active, payload
            FROM articles
            ORDER BY id
            """
        ).fetchall():
            payload = _payload(row[7])
            articles.append(
                {
                    **payload,
                    "id": _text(row[0]),
                    "code": _text(row[1]),
                    "name": _text(row[2]),
                    "kind": _text(row[3]),
                    "uom": _text(row[4]),
                    "content_liter": float(row[5] or 0),
                    "active": bool(row[6]),
                }
            )

        cost_versions = []
        for row in conn.execute(
            """
            SELECT id, jaar, status, bier_id, versie_nummer,
                   created_at, updated_at, finalized_at, payload
            FROM cost_versions
            ORDER BY id
            """
        ).fetchall():
            payload = _payload(row[8])
            cost_versions.append(
                {
                    **payload,
                    "id": _text(row[0]),
                    "jaar": int(row[1] or 0),
                    "status": _text(row[2]),
                    "bier_id": _text(row[3]),
                    "versie_nummer": int(row[4] or 0),
                    "created_at": _text(row[5]),
                    "updated_at": _text(row[6]),
                    "finalized_at": _text(row[7]),
                }
            )
        cost_rows = [
            {
                "id": _text(row[0]),
                "version_id": _text(row[1]),
                "sku_id": _text(row[2]),
                "inkoop": float(row[3] or 0),
                "verpakkingskosten": float(row[4] or 0),
                "indirecte_kosten": float(row[5] or 0),
                "accijns": float(row[6] or 0),
                "kostprijs": float(row[7] or 0),
            }
            for row in conn.execute(
                """
                SELECT id, version_id, sku_id, inkoop, verpakkingskosten,
                       indirecte_kosten, accijns, kostprijs
                FROM cost_version_sku_rows
                ORDER BY id
                """
            ).fetchall()
        ]
        activations = [
            {
                "id": _text(row[0]),
                "sku_id": _text(row[1]),
                "jaar": int(row[2] or 0),
                "kostprijsversie_id": _text(row[3]),
                "effectief_vanaf": _text(row[4]),
                "created_at": _text(row[5]),
            }
            for row in conn.execute(
                """
                SELECT id, sku_id, jaar, kostprijsversie_id,
                       effectief_vanaf, created_at
                FROM kostprijs_sku_activations
                ORDER BY id
                """
            ).fetchall()
        ]
        activation_events = [
            {
                "id": _text(row[0]),
                "sku_id": _text(row[1]),
                "jaar": int(row[2] or 0),
                "kostprijsversie_id": _text(row[3]),
                "effectief_vanaf": _text(row[4]),
                "created_at": _text(row[5]),
                "action": _text(row[6]),
                "metadata": _payload(row[7]),
            }
            for row in conn.execute(
                """
                SELECT id, sku_id, jaar, kostprijsversie_id,
                       effectief_vanaf, created_at, action, metadata
                FROM kostprijs_sku_activation_events
                ORDER BY id
                """
            ).fetchall()
        ]
        cost_version_lots = [
            {
                "id": _text(row[0]),
                "version_id": _text(row[1]),
                "lot_number": _text(row[2]),
            }
            for row in conn.execute(
                """
                SELECT id, version_id, lot_number
                FROM cost_version_lots
                ORDER BY id
                """
            ).fetchall()
        ]
        direct_lot_cost_records = [
            {
                "id": _text(row[0]),
                "source_type": _text(row[1]),
                "source_ref": _text(row[2]),
                "lot_number": _text(row[3]),
                "sku_id": _text(row[4]),
                "sku_code": _text(row[5]),
            }
            for row in conn.execute(
                """
                SELECT id, source_type, source_ref, lot_number, sku_id, sku_code
                FROM lot_cost_records
                ORDER BY id
                """
            ).fetchall()
        ]
    return {
        "beers": beers,
        "skus": skus,
        "articles": articles,
        "cost_versions": cost_versions,
        "cost_rows": cost_rows,
        "activations": activations,
        "activation_events": activation_events,
        "cost_version_lots": cost_version_lots,
        "direct_lot_cost_records": direct_lot_cost_records,
    }


def backfill_legacy_authority(
    *,
    actor: str,
    dry_run: bool = True,
    expected_manifest_hash: str = "",
) -> dict[str, Any]:
    cost_authority_storage.ensure_schema()
    plan = build_authority_plan(read_legacy_snapshot())
    summary = {
        "version": plan["version"],
        "dry_run": bool(dry_run),
        "manifest_hash": plan["manifest_hash"],
        "ready": bool(plan["ready"]),
        "counts": dict(plan["counts"]),
        "blocker_counts": dict(plan["blocker_counts"]),
        "applied": {},
        "consumer_mode": "compatibility_only",
    }
    if dry_run:
        return summary
    if not _text(expected_manifest_hash):
        raise ValueError(
            "expected_manifest_hash is verplicht voor een schrijvende backfill."
        )
    if _text(expected_manifest_hash) != _text(plan["manifest_hash"]):
        raise cost_authority_storage.PlanningCostConflict(
            "De brondata is gewijzigd na de dry-run; voer de audit opnieuw uit."
        )
    summary["applied"] = cost_authority_storage.apply_backfill_plan(
        plan, actor=_text(actor)
    )
    return summary
