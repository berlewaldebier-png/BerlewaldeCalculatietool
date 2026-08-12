from __future__ import annotations

import json
from typing import Any, Iterable

from app.domain import postgres_storage
from app.domain.cost_resolution_types import CostResolutionSnapshot


def _text(value: Any) -> str:
    return str(value or "").strip()


def _json_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value:
        parsed = json.loads(value)
        return dict(parsed) if isinstance(parsed, dict) else {}
    return {}


def _json_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [_text(item) for item in value if _text(item)]
    if isinstance(value, str) and value:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [_text(item) for item in parsed if _text(item)]
    return []


def _candidate_ids(values: Iterable[str]) -> tuple[list[str], list[str]]:
    version_ids: list[str] = []
    row_ids: list[str] = []
    for value in values:
        version_id, separator, row_id = _text(value).partition(":")
        if version_id:
            version_ids.append(version_id)
        if separator and row_id:
            row_ids.append(row_id)
    return sorted(set(version_ids)), sorted(set(row_ids))


class PostgresCostResolutionSnapshotReader:
    """Read the RF-013B authorities in one connection without schema or data writes."""

    def read_cost_resolution_snapshot(self) -> CostResolutionSnapshot:
        with postgres_storage.connect() as conn:
            conn.execute("SET TRANSACTION READ ONLY")
            cost_versions = []
            for row in conn.execute(
                """
                SELECT id, jaar, status, bier_id, versie_nummer, payload
                FROM cost_versions
                ORDER BY id
                """
            ).fetchall():
                payload = _json_dict(row[5])
                cost_versions.append(
                    {
                        **payload,
                        "id": _text(row[0]),
                        "jaar": int(row[1] or 0),
                        "status": _text(row[2]),
                        "bier_id": _text(row[3]),
                        "versie_nummer": int(row[4] or 0),
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

            planning_anchors = [
                {
                    "id": _text(row[0]),
                    "sku_id": _text(row[1]),
                    "planning_year": int(row[2] or 0),
                    "activation_id": _text(row[3]),
                    "cost_version_id": _text(row[4]),
                    "cost_row_id": _text(row[5]),
                    "anchor_kind": _text(row[6]),
                    "effective_at": _text(row[7]),
                }
                for row in conn.execute(
                    """
                    SELECT id, sku_id, planning_year, activation_id,
                           cost_version_id, cost_row_id, anchor_kind, effective_at
                    FROM planning_cost_anchors
                    ORDER BY planning_year, sku_id
                    """
                ).fetchall()
            ]

            lot_lineage = [
                {
                    "id": _text(row[0]),
                    "sku_id": _text(row[1]),
                    "lot_exact_key": _text(row[2]),
                    "lot_number": _text(row[3]),
                    "cost_version_id": _text(row[4]),
                    "cost_row_id": _text(row[5]),
                    "resolution_status": _text(row[6]) or "resolved",
                }
                for row in conn.execute(
                    """
                    SELECT id, sku_id, lot_exact_key, lot_number,
                           cost_version_id, cost_row_id, resolution_status
                    FROM canonical_lot_cost_lineage
                    ORDER BY sku_id, lot_exact_key
                    """
                ).fetchall()
            ]
            for source_id, candidate_ids in conn.execute(
                """
                SELECT source_id, candidate_ids
                FROM cost_authority_mapping_manifest
                WHERE source_type = 'lot_lineage'
                  AND resolution_status = 'ambiguous'
                ORDER BY source_id
                """
            ).fetchall():
                sku_id, separator, exact_key = _text(source_id).rpartition(":")
                if not separator or not sku_id or not exact_key:
                    continue
                version_ids, row_ids = _candidate_ids(_json_list(candidate_ids))
                lot_lineage.append(
                    {
                        "id": f"ambiguous:{source_id}",
                        "sku_id": sku_id,
                        "lot_exact_key": exact_key,
                        "resolution_status": "ambiguous",
                        "candidate_version_ids": version_ids,
                        "candidate_cost_row_ids": row_ids,
                    }
                )

            lot_aliases = [
                {
                    "id": _text(row[0]),
                    "sku_id": _text(row[1]),
                    "sku_code": _text(row[2]),
                    "douano_lot_number": _text(row[3]),
                    "internal_lot_number": _text(row[4]),
                }
                for row in conn.execute(
                    """
                    SELECT id, sku_id, sku_code, douano_lot_number,
                           internal_lot_number
                    FROM lot_alias_mappings
                    ORDER BY id
                    """
                ).fetchall()
            ]
            skus = [
                {
                    **_json_dict(row[6]),
                    "id": _text(row[0]),
                    "code": _text(row[1]),
                    "kind": _text(row[2]),
                    "beer_id": _text(row[3]),
                    "format_article_id": _text(row[4]),
                    "article_id": _text(row[5]),
                }
                for row in conn.execute(
                    """
                    SELECT id, code, kind, beer_id, format_article_id,
                           article_id, payload
                    FROM skus
                    ORDER BY id
                    """
                ).fetchall()
            ]
            direct_lot_cost_records = [
                {
                    "id": _text(row[0]),
                    "lot_number": _text(row[1]),
                    "sku_id": _text(row[2]),
                    "sku_code": _text(row[3]),
                    "source_type": _text(row[4]),
                    "source_ref": _text(row[5]),
                }
                for row in conn.execute(
                    """
                    SELECT id, lot_number, sku_id, sku_code, source_type, source_ref
                    FROM lot_cost_records
                    ORDER BY id
                    """
                ).fetchall()
            ]
            conn.rollback()

        return CostResolutionSnapshot.from_records(
            activations=(),
            activation_events=(),
            cost_versions=cost_versions,
            cost_rows=cost_rows,
            planning_anchors=planning_anchors,
            lot_lineage=lot_lineage,
            lot_aliases=lot_aliases,
            skus=skus,
            direct_lot_cost_records=direct_lot_cost_records,
            authority_mode="canonical",
        )


__all__ = ["PostgresCostResolutionSnapshotReader"]
