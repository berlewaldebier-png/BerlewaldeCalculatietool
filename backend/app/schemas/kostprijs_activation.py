from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class KostprijsActivatieSelection(BaseModel):
    bier_id: str = Field(..., min_length=1)
    product_id: str = Field(..., min_length=1)


class KostprijsActivatiePlanRequest(BaseModel):
    source_year: int = Field(..., ge=0)
    target_year: int = Field(..., ge=0)


class KostprijsActivatieRow(BaseModel):
    bier_id: str
    biernaam: str
    product_id: str
    product_type: str
    product_label: str
    source_version_id: str
    source_cost: float
    source_primary: float
    scenario_primary: float
    target_cost: float
    delta: float


class KostprijsActivatiePlanResponse(BaseModel):
    source_year: int
    target_year: int
    rows: list[KostprijsActivatieRow] = Field(default_factory=list)


class UpsertKostprijsActivatieDraftRequest(BaseModel):
    source_year: int = Field(..., ge=0)
    target_year: int = Field(..., ge=0)
    payload: dict[str, Any] = Field(default_factory=dict)


class ActivateKostprijzenRequest(BaseModel):
    source_year: int = Field(..., ge=0)
    target_year: int = Field(..., ge=0)
    selections: list[KostprijsActivatieSelection] = Field(default_factory=list)
    dry_run: bool = False

