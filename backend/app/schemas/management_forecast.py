from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field


class ManagementForecastBinding(BaseModel):
    generation_id: str = Field(..., min_length=1, max_length=100)
    run_id: str = Field(..., min_length=1, max_length=100)
    plan_id: str = Field(..., min_length=1, max_length=100)
    plan_contract_hash: str = Field(..., min_length=8, max_length=100)
    operational_year: int = Field(..., ge=2000, le=2100)


class ManagementForecastPeriod(BaseModel):
    period: str = Field(..., min_length=7, max_length=7)
    revenue: Decimal
    variable_cost: Decimal
    contribution: Decimal = Field(...)
    liters: Decimal
    units: Decimal


class CreateManagementForecastRequest(BaseModel):
    binding: ManagementForecastBinding
    expected_active_revision_id: str = Field("", max_length=100)
    reason: str = Field(..., min_length=10, max_length=1000)
    period_allocations: list[ManagementForecastPeriod] = Field(
        ..., min_length=12, max_length=12
    )
