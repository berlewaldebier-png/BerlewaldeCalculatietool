from __future__ import annotations

from pydantic import BaseModel, Field


class CostAuthorityBackfillRequest(BaseModel):
    dry_run: bool = True
    expected_manifest_hash: str = Field("", max_length=80)


class PlanningCostRebaselinePrepareRequest(BaseModel):
    sku_id: str = Field(..., min_length=1, max_length=200)
    planning_year: int = Field(..., ge=2000, le=2100)
    cost_version_id: str = Field(..., min_length=1, max_length=200)
    reason: str = Field(..., min_length=1, max_length=500)


class CostVersionBeerMappingApprovalRequest(BaseModel):
    canonical_beer_id: str = Field(..., min_length=1, max_length=200)
    expected_source_hash: str = Field(..., min_length=8, max_length=80)
    review_reason: str = Field(..., min_length=1, max_length=500)
