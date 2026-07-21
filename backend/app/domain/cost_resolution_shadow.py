from __future__ import annotations

from typing import Sequence

from app.domain.actual_lot_cost_resolver import ActualLotCostResolver
from app.domain.cost_resolution_types import (
    CostSelectionDifference,
    CostSelectionShadowInput,
)
from app.domain.planning_cost_resolver import PlanningCostResolver


def compare_cost_selection_shadow(
    *,
    planning_resolver: PlanningCostResolver,
    actual_resolver: ActualLotCostResolver,
    current: Sequence[CostSelectionShadowInput],
) -> tuple[CostSelectionDifference, ...]:
    """Compare IDs/statuses only; no commercial amount is returned or logged."""
    differences: list[CostSelectionDifference] = []
    for row in current:
        if row.mode == "planning":
            candidate = planning_resolver.resolve_planning_cost(row.sku_id, row.year)
        else:
            candidate = actual_resolver.resolve_actual_lot_cost(row.sku_id, row.lot_id)
        if row.current_status and row.current_status != candidate.status:
            reason = (
                "current_actual_fallback_masks_unresolved_lot"
                if row.mode == "actual"
                and candidate.status
                in {
                    "missing_lot",
                    "unknown_lot",
                    "ambiguous_lot_mapping",
                    "ambiguous_exact_lot",
                    "missing_canonical_lot_lineage",
                    "ambiguous_direct_lot_cost",
                }
                else "current_status_differs_from_candidate"
            )
            differences.append(
                CostSelectionDifference(
                    consumer=row.consumer,
                    mode=row.mode,
                    sku_id=row.sku_id,
                    year=row.year,
                    lot_id=row.lot_id,
                    field="status",
                    reason=reason,
                    current_source_id=row.current_status,
                    candidate_source_id=candidate.status,
                )
            )
        if row.current_cost_version_id != candidate.cost_version_id:
            reason = (
                "current_latest_activation_differs_from_planning_anchor"
                if row.mode == "planning"
                else "current_actual_cost_version_differs_from_exact_lot_candidate"
            )
            differences.append(
                CostSelectionDifference(
                    consumer=row.consumer,
                    mode=row.mode,
                    sku_id=row.sku_id,
                    year=row.year,
                    lot_id=row.lot_id,
                    field="cost_version",
                    reason=reason,
                    current_source_id=row.current_cost_version_id,
                    candidate_source_id=candidate.cost_version_id,
                )
            )
        if row.current_cost_row_id and row.current_cost_row_id != candidate.cost_row_id:
            differences.append(
                CostSelectionDifference(
                    consumer=row.consumer,
                    mode=row.mode,
                    sku_id=row.sku_id,
                    year=row.year,
                    lot_id=row.lot_id,
                    field="cost_row",
                    reason="current_cost_row_differs_from_candidate",
                    current_source_id=row.current_cost_row_id,
                    candidate_source_id=candidate.cost_row_id,
                )
            )
    return tuple(differences)
