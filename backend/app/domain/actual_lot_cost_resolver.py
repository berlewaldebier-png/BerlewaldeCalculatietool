from __future__ import annotations

from typing import Literal

from app.domain.cost_resolution_types import (
    ActualLotCostResolution,
    ActualStatus,
    CostResolutionSnapshot,
    PlanningStatus,
    components,
)
from app.domain.cost_resolution_utils import (
    GenericRecord,
    dedupe,
    lot_exact_key,
    lot_near_key,
    text,
    version_lot_keys,
    year,
)
from app.domain.planning_cost_resolver import PlanningCostResolver


class ActualLotCostResolver:
    """Resolve actual cost by exact LOT; never substitute planning implicitly."""

    def __init__(
        self,
        snapshot: CostResolutionSnapshot,
        planning_resolver: PlanningCostResolver | None = None,
    ):
        self._snapshot = snapshot
        self._planning = planning_resolver or PlanningCostResolver(snapshot)
        self._versions_by_id = {
            text(row.get("id")): row
            for row in snapshot.cost_versions
            if text(row.get("id"))
        }
        self._sku_codes_by_id = {
            text(row.get("id")): text(row.get("code") or row.get("sku_code"))
            for row in snapshot.skus
            if text(row.get("id")) and text(row.get("code") or row.get("sku_code"))
        }
        rows_by_key: dict[tuple[str, str], list[GenericRecord]] = {}
        rows_by_id: dict[str, GenericRecord] = {}
        for row in snapshot.cost_rows:
            key = (text(row.get("version_id")), text(row.get("sku_id")))
            if key[0] and key[1]:
                rows_by_key.setdefault(key, []).append(row)
            if text(row.get("id")):
                rows_by_id[text(row.get("id"))] = row

        rows_by_version: dict[str, list[tuple[str, list[GenericRecord]]]] = {}
        for (version_id, sku_id), rows in rows_by_key.items():
            rows_by_version.setdefault(version_id, []).append((sku_id, rows))
        self._exact_candidates: dict[tuple[str, str], list[tuple[str, GenericRecord]]] = {}
        self._near_candidate_versions: dict[tuple[str, str], set[str]] = {}
        self._canonical_ambiguities: dict[tuple[str, str], list[GenericRecord]] = {}
        self._canonical_lineage_errors: dict[tuple[str, str], ActualLotCostResolution] = {}
        if snapshot.authority_mode == "canonical":
            for lineage in snapshot.lot_lineage:
                sku_id = text(lineage.get("sku_id"))
                key = lot_exact_key(
                    lineage.get("lot_exact_key") or lineage.get("lot_number")
                )
                if not sku_id or not key:
                    continue
                if text(lineage.get("resolution_status")).casefold() == "ambiguous":
                    self._canonical_ambiguities.setdefault((sku_id, key), []).append(
                        lineage
                    )
                    for version_id in lineage.get("candidate_version_ids", ()) or ():
                        self._near_candidate_versions.setdefault(
                            (sku_id, lot_near_key(key)), set()
                        ).add(text(version_id))
                    continue
                version_id = text(lineage.get("cost_version_id"))
                row_id = text(lineage.get("cost_row_id"))
                row = rows_by_id.get(row_id)
                if not version_id or version_id not in self._versions_by_id:
                    self._canonical_lineage_errors[(sku_id, key)] = ActualLotCostResolution(
                        status="missing_cost_version",
                        source="canonical_lot_lineage",
                        cost_version_id=version_id,
                        cost_row_id=row_id,
                        warnings=("canonical_lot_cost_version_missing",),
                    )
                    continue
                if (
                    row is None
                    or text(row.get("version_id")) != version_id
                    or text(row.get("sku_id")) != sku_id
                ):
                    self._canonical_lineage_errors[(sku_id, key)] = ActualLotCostResolution(
                        status="missing_cost_row",
                        source="canonical_lot_lineage",
                        cost_version_id=version_id,
                        cost_row_id=row_id,
                        warnings=("canonical_lot_cost_row_missing_or_mismatched",),
                    )
                    continue
                self._exact_candidates.setdefault((sku_id, key), []).append(
                    (version_id, row)
                )
                self._near_candidate_versions.setdefault(
                    (sku_id, lot_near_key(key)), set()
                ).add(version_id)
        else:
            for version_id, version in self._versions_by_id.items():
                keys = version_lot_keys(version)
                for sku_id, rows in rows_by_version.get(version_id, []):
                    for key in keys:
                        self._exact_candidates.setdefault((sku_id, key), []).extend(
                            (version_id, row) for row in rows
                        )
                        self._near_candidate_versions.setdefault(
                            (sku_id, lot_near_key(key)), set()
                        ).add(version_id)
        self._direct_lot_records: dict[tuple[str, str], list[GenericRecord]] = {}
        for row in snapshot.direct_lot_cost_records:
            sku_id = text(row.get("sku_id"))
            lot_key = lot_exact_key(row.get("lot_number") or row.get("lot_id"))
            if sku_id and lot_key:
                self._direct_lot_records.setdefault((sku_id, lot_key), []).append(row)

    def resolve_actual_lot_cost(
        self,
        sku_id: str,
        lot_id: str,
        *,
        cost_requirement: Literal["required", "not_required", "ignored"] = "required",
        lot_requirement: Literal["required", "not_required"] = "required",
        planning_year: int = 0,
    ) -> ActualLotCostResolution:
        requested_lot = text(lot_id)
        if cost_requirement == "ignored":
            return ActualLotCostResolution(status="ignored", source="maintained_policy")
        if cost_requirement == "not_required":
            return ActualLotCostResolution(
                status="no_cost_required",
                source="maintained_policy",
                requested_lot_id=requested_lot,
            )

        sku = text(sku_id)
        if not sku:
            return ActualLotCostResolution(
                status="missing_sku",
                source="unresolved",
                requested_lot_id=requested_lot,
                warnings=("cost_required_sku_missing",),
            )
        if lot_requirement == "not_required":
            return self._resolve_explicit_non_lot_cost(
                sku_id=sku,
                requested_lot=requested_lot,
                planning_year=planning_year,
            )
        if not requested_lot:
            return ActualLotCostResolution(
                status="missing_lot",
                source="unresolved",
                warnings=("lot_required_but_missing",),
            )

        mapping_rows = self._matching_aliases(sku, requested_lot)
        mapping_ids = dedupe(text(row.get("id")) for row in mapping_rows)
        mapped_lot_ids = dedupe(
            text(row.get("internal_lot_number") or row.get("internal_lot"))
            for row in mapping_rows
        )
        if len(mapped_lot_ids) > 1:
            return ActualLotCostResolution(
                status="ambiguous_lot_mapping",
                source="unresolved",
                requested_lot_id=requested_lot,
                warnings=("explicit_lot_mapping_ambiguous",),
                candidate_mapping_ids=mapping_ids,
                candidate_lot_ids=mapped_lot_ids,
            )

        resolved_lot = mapped_lot_ids[0] if mapped_lot_ids else requested_lot
        resolved_key = lot_exact_key(resolved_lot)
        candidates = self._exact_candidates.get((sku, resolved_key), [])
        canonical_ambiguities = self._canonical_ambiguities.get((sku, resolved_key), [])
        if canonical_ambiguities:
            return ActualLotCostResolution(
                status="ambiguous_exact_lot",
                source="canonical_lot_lineage",
                requested_lot_id=requested_lot,
                resolved_lot_id=resolved_lot,
                lot_mapping_id=mapping_ids[0] if len(mapping_ids) == 1 else "",
                warnings=("canonical_exact_lot_lineage_ambiguous",),
                candidate_mapping_ids=mapping_ids,
                candidate_lot_ids=(resolved_lot,),
                candidate_version_ids=dedupe(
                    version_id
                    for row in canonical_ambiguities
                    for version_id in (row.get("candidate_version_ids", ()) or ())
                ),
                candidate_cost_row_ids=dedupe(
                    row_id
                    for row in canonical_ambiguities
                    for row_id in (row.get("candidate_cost_row_ids", ()) or ())
                ),
            )
        lineage_error = self._canonical_lineage_errors.get((sku, resolved_key))
        if lineage_error is not None:
            return ActualLotCostResolution(
                **{
                    **lineage_error.__dict__,
                    "requested_lot_id": requested_lot,
                    "resolved_lot_id": resolved_lot,
                    "lot_mapping_id": mapping_ids[0] if len(mapping_ids) == 1 else "",
                }
            )
        near_candidates = self._near_candidate_versions.get(
            (sku, lot_near_key(resolved_lot)), set()
        )
        version_ids = dedupe(version_id for version_id, _ in candidates)
        row_ids = dedupe(text(row.get("id")) for _, row in candidates)
        if not candidates:
            direct_records = self._direct_lot_records.get(
                (sku, lot_exact_key(resolved_lot)), []
            )
            direct_ids = dedupe(text(row.get("id")) for row in direct_records)
            if len(direct_records) > 1:
                return ActualLotCostResolution(
                    status="ambiguous_direct_lot_cost",
                    source="unresolved",
                    requested_lot_id=requested_lot,
                    resolved_lot_id=resolved_lot,
                    lot_mapping_id=mapping_ids[0] if len(mapping_ids) == 1 else "",
                    warnings=("direct_lot_cost_record_ambiguous",),
                    candidate_lot_cost_record_ids=direct_ids,
                )
            if len(direct_records) == 1:
                return ActualLotCostResolution(
                    status="missing_canonical_lot_lineage",
                    source="direct_lot_record_unlinked",
                    requested_lot_id=requested_lot,
                    resolved_lot_id=resolved_lot,
                    lot_mapping_id=mapping_ids[0] if len(mapping_ids) == 1 else "",
                    warnings=("direct_lot_cost_requires_canonical_version_row_lineage",),
                    candidate_lot_cost_record_ids=direct_ids,
                )
            warnings = ["exact_lot_cost_missing"]
            if near_candidates:
                warnings.append("near_lot_match_requires_explicit_mapping")
            return ActualLotCostResolution(
                status="unknown_lot",
                source="unresolved",
                requested_lot_id=requested_lot,
                resolved_lot_id=resolved_lot,
                lot_mapping_id=mapping_ids[0] if len(mapping_ids) == 1 else "",
                warnings=tuple(warnings),
                candidate_version_ids=dedupe(near_candidates),
            )
        if len(version_ids) > 1:
            return ActualLotCostResolution(
                status="ambiguous_exact_lot",
                source="unresolved",
                requested_lot_id=requested_lot,
                resolved_lot_id=resolved_lot,
                lot_mapping_id=mapping_ids[0] if len(mapping_ids) == 1 else "",
                warnings=("exact_lot_matches_multiple_cost_versions",),
                candidate_mapping_ids=mapping_ids,
                candidate_lot_ids=(resolved_lot,),
                candidate_version_ids=version_ids,
                candidate_cost_row_ids=row_ids,
            )
        if len(candidates) > 1:
            return ActualLotCostResolution(
                status="ambiguous_cost_row",
                source="unresolved",
                requested_lot_id=requested_lot,
                resolved_lot_id=resolved_lot,
                lot_mapping_id=mapping_ids[0] if len(mapping_ids) == 1 else "",
                cost_version_id=version_ids[0],
                warnings=("exact_lot_cost_row_ambiguous",),
                candidate_mapping_ids=mapping_ids,
                candidate_lot_ids=(resolved_lot,),
                candidate_version_ids=version_ids,
                candidate_cost_row_ids=row_ids,
            )

        version_id, cost_row = candidates[0]
        breakdown = components(cost_row)
        if breakdown.cost_price_ex <= 0:
            return ActualLotCostResolution(
                status="invalid_cost",
                source="exact_lot",
                requested_lot_id=requested_lot,
                resolved_lot_id=resolved_lot,
                lot_mapping_id=mapping_ids[0] if len(mapping_ids) == 1 else "",
                cost_version_id=version_id,
                cost_row_id=text(cost_row.get("id")),
                components=breakdown,
                warnings=("actual_lot_cost_non_positive",),
            )
        warnings = (
            ("duplicate_equivalent_lot_mappings",) if len(mapping_ids) > 1 else ()
        )
        return ActualLotCostResolution(
            status="resolved_exact_lot",
            source=(
                "canonical_exact_lot_alias"
                if mapping_ids and self._snapshot.authority_mode == "canonical"
                else "canonical_exact_lot"
                if self._snapshot.authority_mode == "canonical"
                else "exact_lot_alias"
                if mapping_ids
                else "exact_lot"
            ),
            requested_lot_id=requested_lot,
            resolved_lot_id=resolved_lot,
            lot_mapping_id=mapping_ids[0] if len(mapping_ids) == 1 else "",
            cost_version_id=version_id,
            cost_row_id=text(cost_row.get("id")),
            components=breakdown,
            warnings=warnings,
        )

    def _resolve_explicit_non_lot_cost(
        self,
        *,
        sku_id: str,
        requested_lot: str,
        planning_year: int,
    ) -> ActualLotCostResolution:
        if year(planning_year) <= 0:
            return ActualLotCostResolution(
                status="missing_planning_year",
                source="unresolved",
                requested_lot_id=requested_lot,
                warnings=("non_lot_cost_requires_explicit_planning_year",),
            )
        planning = self._planning.resolve_planning_cost(sku_id, planning_year)
        if planning.status != "resolved":
            return ActualLotCostResolution(
                status=_actual_status_from_planning(planning.status),
                source="planning_anchor_for_non_lot_sku",
                requested_lot_id=requested_lot,
                cost_version_id=planning.cost_version_id,
                cost_row_id=planning.cost_row_id,
                components=planning.components,
                warnings=("non_lot_sku_cost_unresolved", *planning.warnings),
                candidate_version_ids=planning.candidate_version_ids,
                candidate_cost_row_ids=planning.candidate_cost_row_ids,
            )
        return ActualLotCostResolution(
            status="resolved_non_lot_sku_cost",
            source="planning_anchor_for_non_lot_sku",
            requested_lot_id=requested_lot,
            cost_version_id=planning.cost_version_id,
            cost_row_id=planning.cost_row_id,
            components=planning.components,
            warnings=("explicit_non_lot_policy_uses_planning_anchor",),
        )

    def _matching_aliases(self, sku_id: str, lot_id: str) -> list[GenericRecord]:
        requested_key = lot_exact_key(lot_id)
        exact_scope = [
            row
            for row in self._snapshot.lot_aliases
            if lot_exact_key(row.get("douano_lot_number") or row.get("douano_lot"))
            == requested_key
            and text(row.get("sku_id")) == sku_id
        ]
        if exact_scope:
            return exact_scope
        sku_code = self._sku_codes_by_id.get(sku_id, "")
        code_scope = [
            row
            for row in self._snapshot.lot_aliases
            if lot_exact_key(row.get("douano_lot_number") or row.get("douano_lot"))
            == requested_key
            and sku_code
            and text(row.get("sku_code")).casefold() == sku_code.casefold()
        ]
        if code_scope:
            return code_scope
        return [
            row
            for row in self._snapshot.lot_aliases
            if lot_exact_key(row.get("douano_lot_number") or row.get("douano_lot"))
            == requested_key
            and not text(row.get("sku_id"))
            and not text(row.get("sku_code"))
        ]


def _actual_status_from_planning(status: PlanningStatus) -> ActualStatus:
    mapping: dict[PlanningStatus, ActualStatus] = {
        "resolved": "resolved_non_lot_sku_cost",
        "not_required": "no_cost_required",
        "missing_anchor": "missing_planning_anchor",
        "ambiguous_anchor": "ambiguous_planning_anchor",
        "missing_cost_version": "missing_cost_version",
        "missing_cost_row": "missing_cost_row",
        "ambiguous_cost_row": "ambiguous_cost_row",
        "invalid_cost": "invalid_cost",
    }
    return mapping[status]
