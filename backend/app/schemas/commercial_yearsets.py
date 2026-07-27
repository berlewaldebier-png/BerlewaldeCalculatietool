from __future__ import annotations

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
