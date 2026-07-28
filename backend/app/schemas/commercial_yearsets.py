from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class CommercialYearsetBackfillRequest(BaseModel):
    operational_year: int = Field(..., ge=2000, le=2100)
    source_year: int = Field(..., ge=2000, le=2100)
    dry_run: bool = True


class CommercialYearsetActivationRequest(BaseModel):
    expected_validation_hash: str = Field(..., min_length=8)
    expected_active_generation_id: str | None = Field(...)
    reason: str = Field("", max_length=500)


class CommercialYearsetRollbackRequest(BaseModel):
    expected_validation_hash: str = Field(..., min_length=8)
    expected_active_generation_id: str = Field(..., min_length=1)
    reason: str = Field(..., min_length=1, max_length=500)


class YearsetReconciliationRequest(BaseModel):
    source_year: int = Field(..., ge=2000, le=2100)
    target_year: int = Field(..., ge=2000, le=2100)
    dry_run: bool = True
    expected_manifest_hash: str = Field("", max_length=80)


class YearsetReconciliationApprovalRequest(BaseModel):
    expected_manifest_hash: str = Field(..., min_length=8, max_length=80)
    reason: str = Field(..., min_length=1, max_length=500)


class YearsetReconciliationActivationRequest(BaseModel):
    expected_manifest_hash: str = Field(..., min_length=8, max_length=80)
    expected_active_generation_id: str | None = Field(...)
    reason: str = Field(..., min_length=1, max_length=500)


class YearsetRecoveryScopeDecision(BaseModel):
    sku_id: str = Field(..., min_length=1)
    decision: Literal["historical_only_for_target_year"]
    reason: str = Field(..., min_length=1, max_length=500)


class YearsetRecoveryPricingDecision(BaseModel):
    sku_id: str = Field(..., min_length=1)
    sell_in_ex_vat: Decimal = Field(..., gt=0)
    currency: Literal["EUR"] = "EUR"
    vat_basis: Literal["exclusive"] = "exclusive"
    reason: str = Field(..., min_length=1, max_length=500)


class YearsetRecoveryRequest(BaseModel):
    source_year: int = Field(..., ge=2000, le=2100)
    target_year: int = Field(..., ge=2000, le=2100)
    expected_lineage_review_hash: str = Field(..., min_length=8, max_length=80)
    exact_target_anchor_sku_ids: list[str] = Field(..., min_length=1)
    scope_decisions: list[YearsetRecoveryScopeDecision] = Field(
        ..., min_length=1
    )
    pricing_decisions: list[YearsetRecoveryPricingDecision] = Field(
        ..., min_length=1
    )
    approved_plan_revenue_ex_vat: Decimal = Field(..., gt=0)
    allocation_policy: Literal[
        "closed_source_actual_mix_scaled_to_approved_revenue"
    ] = "closed_source_actual_mix_scaled_to_approved_revenue"
    reason: str = Field(..., min_length=1, max_length=500)
    expected_decision_hash: str = Field("", max_length=80)
