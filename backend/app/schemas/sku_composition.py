from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CompositionLine(BaseModel):
    component_sku_id: str = Field(..., description="SKU id van het component (sellable SKU).")
    qty: float = Field(..., ge=0, description="Aantal stuks.")


class PackagingLine(BaseModel):
    kind: Literal["packaging_component", "format"] = Field(..., description="Type BOM component.")
    component_id: str = Field(..., description="Article id van component (packaging component of format).")
    qty: float = Field(..., ge=0, description="Aantal stuks.")


class UpsertFormatRequest(BaseModel):
    name: str
    uom: str = "stuk"
    totals_liters: float = Field(0, ge=0)
    afvul_parts: list[PackagingLine] = Field(default_factory=list)
    edit_format_id: str | None = None


class UpsertFormatResponse(BaseModel):
    article_id: str


class UpsertBundleRequest(BaseModel):
    name: str
    uom: str = "stuk"
    totals_liters: float = Field(0, ge=0)
    sellable_kind: Literal["product", "dienst"] = "product"
    bundle_context: Literal["giftset", "beer_variant"] = "giftset"
    beer_id: str = ""
    manual_rate_ex: float = Field(0, ge=0)
    product_group: str = ""
    alcohol_category: str = ""
    packaging_type: str = ""
    composition: list[CompositionLine] = Field(default_factory=list)
    packaging: list[PackagingLine] = Field(default_factory=list)
    edit_article_id: str | None = None
    edit_sku_id: str | None = None


class UpsertBundleResponse(BaseModel):
    sku_id: str
    article_id: str

