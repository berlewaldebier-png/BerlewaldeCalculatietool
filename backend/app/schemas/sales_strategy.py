from __future__ import annotations

from pydantic import BaseModel, Field


class ActiveSalesStrategyPriceChange(BaseModel):
    sku_id: str = Field(min_length=1)
    list_price: float = Field(gt=0)
    pricing_record_id: str = ""
    expected_record_hash: str = ""


class ActiveSalesStrategyUpdateRequest(BaseModel):
    generation_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    manifest_hash: str = Field(min_length=1)
    changes: list[ActiveSalesStrategyPriceChange] = Field(min_length=1, max_length=250)
