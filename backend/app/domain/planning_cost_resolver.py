from __future__ import annotations

from typing import Sequence

from app.domain.cost_resolution_types import (
    CostResolutionSnapshot,
    PlanningCostResolution,
)
from app.domain.cost_resolution_utils import (
    GenericRecord,
    dedupe,
    moment,
    record_metadata,
    text,
    year,
)
from app.domain.cost_resolution_types import components


class PlanningCostResolver:
    """Resolve the first approved planning anchor for one concrete SKU/year."""

    def __init__(self, snapshot: CostResolutionSnapshot):
        self._snapshot = snapshot
        self._versions_by_id = {
            text(row.get("id")): row
            for row in snapshot.cost_versions
            if text(row.get("id"))
        }
        self._rows_by_key: dict[tuple[str, str], list[GenericRecord]] = {}
        for row in snapshot.cost_rows:
            key = (text(row.get("version_id")), text(row.get("sku_id")))
            if key[0] and key[1]:
                self._rows_by_key.setdefault(key, []).append(row)

    def resolve_planning_cost(self, sku_id: str, planning_year: int) -> PlanningCostResolution:
        sku = text(sku_id)
        scope_year = year(planning_year)
        if not sku or scope_year <= 0:
            return PlanningCostResolution(
                status="missing_anchor",
                source="unresolved",
                warnings=("planning_scope_invalid",),
            )

        activations = [
            row
            for row in self._snapshot.activations
            if text(row.get("sku_id")) == sku and year(row.get("jaar")) == scope_year
        ]
        events = [
            row
            for row in self._snapshot.activation_events
            if text(row.get("sku_id")) == sku and year(row.get("jaar")) == scope_year
        ]
        candidates = [
            row
            for row in [*activations, *events]
            if text(row.get("kostprijsversie_id"))
        ]
        if not candidates:
            return PlanningCostResolution(
                status="missing_anchor",
                source="unresolved",
                warnings=("planning_anchor_missing",),
            )

        approved_rebaselines = [
            row
            for row in events
            if text(row.get("action")).casefold() == "explicit_rebaseline"
            and record_metadata(row).get("approved") is True
            and text(row.get("kostprijsversie_id"))
        ]
        if approved_rebaselines:
            selected_rows = self._latest_equivalent_rows(approved_rebaselines)
            source = "explicit_approved_rebaseline"
        else:
            selected_rows = self._earliest_equivalent_rows(candidates)
            source = "first_observable_activation"

        selected_versions = dedupe(
            text(row.get("kostprijsversie_id")) for row in selected_rows
        )
        selected_source_ids = dedupe(text(row.get("id")) for row in selected_rows)
        if len(selected_versions) != 1:
            return PlanningCostResolution(
                status="ambiguous_anchor",
                source="unresolved",
                warnings=("planning_anchor_same_moment_ambiguous",),
                candidate_source_ids=selected_source_ids,
                candidate_version_ids=selected_versions,
            )

        selected = min(selected_rows, key=lambda row: text(row.get("id")))
        version_id = selected_versions[0]
        activation_ids = dedupe(
            text(row.get("id"))
            for row in activations
            if text(row.get("kostprijsversie_id")) == version_id
        )
        history_proven = bool(events) or len(activations) > 1
        common = {
            "source": source,
            "source_id": text(selected.get("id")),
            "activation_id": activation_ids[0] if len(activation_ids) == 1 else "",
            "cost_version_id": version_id,
            "effective_at": text(
                selected.get("effectief_vanaf") or selected.get("created_at")
            ),
            "history_proven": history_proven,
            "candidate_source_ids": selected_source_ids,
            "candidate_version_ids": selected_versions,
        }
        if version_id not in self._versions_by_id:
            return PlanningCostResolution(
                status="missing_cost_version",
                warnings=("planning_cost_version_missing",),
                **common,
            )

        rows = self._rows_by_key.get((version_id, sku), [])
        if not rows:
            return PlanningCostResolution(
                status="missing_cost_row",
                warnings=("canonical_cost_row_missing",),
                **common,
            )
        if len(rows) > 1:
            return PlanningCostResolution(
                status="ambiguous_cost_row",
                warnings=("canonical_cost_row_ambiguous",),
                candidate_cost_row_ids=dedupe(text(row.get("id")) for row in rows),
                **common,
            )
        cost_row = rows[0]
        breakdown = components(cost_row)
        if breakdown.cost_price_ex <= 0:
            return PlanningCostResolution(
                status="invalid_cost",
                cost_row_id=text(cost_row.get("id")),
                components=breakdown,
                warnings=("planning_cost_non_positive",),
                **common,
            )
        warnings = () if history_proven else ("planning_anchor_history_unproven",)
        return PlanningCostResolution(
            status="resolved",
            cost_row_id=text(cost_row.get("id")),
            components=breakdown,
            warnings=warnings,
            **common,
        )

    @staticmethod
    def _earliest_equivalent_rows(rows: Sequence[GenericRecord]) -> list[GenericRecord]:
        earliest = min((moment(row)[0] for row in rows), default=0.0)
        return [row for row in rows if moment(row)[0] == earliest]

    @staticmethod
    def _latest_equivalent_rows(rows: Sequence[GenericRecord]) -> list[GenericRecord]:
        latest = max((moment(row)[0] for row in rows), default=0.0)
        return [row for row in rows if moment(row)[0] == latest]
