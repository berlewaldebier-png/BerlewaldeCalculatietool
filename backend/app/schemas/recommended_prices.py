from __future__ import annotations

from pydantic import BaseModel, Field


class ActiveRecommendedPriceChannelChange(BaseModel):
    channel_code: str = Field(min_length=1)
    advice_markup_pct: float = Field(ge=0)
    pricing_record_id: str = ""
    expected_record_hash: str = ""


class ActiveRecommendedPriceUpdateRequest(BaseModel):
    generation_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    manifest_hash: str = Field(min_length=1)
    changes: list[ActiveRecommendedPriceChannelChange] = Field(
        min_length=1, max_length=25
    )
