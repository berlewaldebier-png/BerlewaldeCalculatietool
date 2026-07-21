from __future__ import annotations

from app.domain.actual_lot_cost_resolver import ActualLotCostResolver
from app.domain.cost_resolution_shadow import compare_cost_selection_shadow
from app.domain.cost_resolution_types import (
    ActualLotCostResolution,
    ActualStatus,
    CostComponents,
    CostResolutionSnapshot,
    CostResolutionSnapshotReader,
    CostSelectionDifference,
    CostSelectionShadowInput,
    PlanningCostResolution,
    PlanningStatus,
)
from app.domain.planning_cost_resolver import PlanningCostResolver


class ReadOnlyCostResolutionService:
    """Load one snapshot, then expose intentionally distinct planning/actual APIs."""

    def __init__(self, reader: CostResolutionSnapshotReader):
        snapshot = reader.read_cost_resolution_snapshot()
        self.planning = PlanningCostResolver(snapshot)
        self.actual = ActualLotCostResolver(snapshot, self.planning)


__all__ = [
    "ActualLotCostResolution",
    "ActualLotCostResolver",
    "ActualStatus",
    "CostComponents",
    "CostResolutionSnapshot",
    "CostResolutionSnapshotReader",
    "CostSelectionDifference",
    "CostSelectionShadowInput",
    "PlanningCostResolution",
    "PlanningCostResolver",
    "PlanningStatus",
    "ReadOnlyCostResolutionService",
    "compare_cost_selection_shadow",
]
