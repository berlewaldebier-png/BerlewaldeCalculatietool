from __future__ import annotations

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

