from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PrepareNewYearRequest(BaseModel):
    source_year: int = Field(..., ge=0)
    target_year: int = Field(..., ge=0)

    copy_productie: bool = True
    copy_vaste_kosten: bool = True
    copy_tarieven: bool = True
    copy_verpakkingsonderdelen: bool = True
    copy_verkoopstrategie: bool = True
    copy_berekeningen: bool = True

    overwrite_existing: bool = False
    include_datasets: bool = True


class PrepareNewYearResponse(BaseModel):
    source_year: int
    target_year: int
    dry_run: bool = False
    results: dict
    datasets: dict | None = None


class NewYearDraftPayload(BaseModel):
    """Free-form payload for the wizard draft.

    We intentionally keep this flexible because the wizard UI can evolve without
    requiring a backend migration for every small UI field.
    """

    data: dict[str, Any] = Field(default_factory=dict)
    active_step: int = Field(0, ge=0)
    completed_step_ids: list[str] = Field(default_factory=list)


class UpsertNewYearDraftRequest(BaseModel):
    source_year: int = Field(..., ge=0)
    target_year: int = Field(..., ge=0)
    payload: NewYearDraftPayload = Field(default_factory=NewYearDraftPayload)


class CommitNewYearRequest(BaseModel):
    source_year: int = Field(..., ge=0)
    target_year: int = Field(..., ge=0)

    copy_productie: bool = True
    copy_vaste_kosten: bool = True
    copy_tarieven: bool = True
    copy_verpakkingsonderdelen: bool = True
    copy_verkoopstrategie: bool = True
    copy_berekeningen: bool = False

    overwrite_existing: bool = False
    force: bool = False

    # The draft payload contains the target-year overrides from the wizard.
    payload: NewYearDraftPayload = Field(default_factory=NewYearDraftPayload)
