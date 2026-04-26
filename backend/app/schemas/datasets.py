"""Pydantic models for request/response validation.

Provides type-safe validation for all API endpoints.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# Generic validation response
class SuccessResponse(BaseModel):
    """Generic success response wrapper."""
    saved: bool = True


class DatasetResponse(BaseModel):
    """Generic dataset response."""
    data: Any = Field(..., description="Dataset content")


# Validation helpers for common patterns
class BaseDataRow(BaseModel):
    """Base class for data rows with ID."""
    id: str | None = Field(None, description="Unique identifier")


class ProductieData(BaseModel):
    """Productie dataset - year-keyed dictionary."""
    __root__: dict[str, Any] = Field(..., description="Year -> production data")


class VasteKostenData(BaseModel):
    """Fixed costs dataset - year-keyed dictionary."""
    __root__: dict[str, Any] = Field(..., description="Year -> fixed costs")


class TarievenRow(BaseModel):
    """Single tariff/levy row."""
    id: str
    jaar: int = Field(..., ge=2000, le=2100)
    omschrijving: str | None = None
    tarief_hoog: float | None = None
    tarief_laag: float | None = None
    verbruikersbelasting: float | None = None


class TarievenHeffingen(BaseModel):
    """Tariffs and levies dataset."""
    __root__: list[TarievenRow] = Field(..., description="List of tariff rows")


class VerpakkingsRow(BaseModel):
    """Packaging component row."""
    id: str
    naam: str
    omschrijving: str | None = None
    actief: bool = True


class BasisproductRow(BaseModel):
    """Base product row."""
    id: str
    naam: str
    soort: str
    densiteit_kg_liter: float | None = None
    densiteit_liters_kg: float | None = None


class SamengesteldeRow(BaseModel):
    """Composite product row."""
    id: str
    naam: str
    samenstellingen: list[dict[str, Any]] | None = None


class BierRow(BaseModel):
    """Beer product row."""
    id: str
    naam: str
    stijl: str | None = None
    alcoholpercentage: float | None = None
    actief: bool = True


class CalculationRow(BaseModel):
    """Cost calculation row."""
    id: str
    bier_id: str
    status: str = Field(..., pattern="^(concept|definitief)$")
    effectief_vanaf: str | None = None


class KostprijsversieRow(BaseModel):
    """Cost version row."""
    id: str
    bier_id: str
    status: str = Field(..., pattern="^(concept|definitief)$")
    effectief_vanaf: str | None = None


class VerkoopprijsRow(BaseModel):
    """Sales price row."""
    id: str
    record_type: str
    bier_id: str | None = None
    jaar: int | None = None


class CatalogProductRow(BaseModel):
    """Catalog product row."""
    id: str
    naam: str
    producttype: str | None = None
    actief: bool = True


# Response models for standard operations
class CreateResourceResponse(BaseModel):
    """Response when creating a new resource."""
    saved: bool = True
    record: dict[str, Any]


class UpdateResourceResponse(BaseModel):
    """Response when updating a resource."""
    saved: bool = True
    record: dict[str, Any]


class ListResourcesResponse(BaseModel):
    """Response when listing multiple resources."""
    items: list[dict[str, Any]]
    total: int | None = None


class ErrorResponse(BaseModel):
    """Standard error response."""
    error: str = Field(..., description="Error message")
    detail: str | None = None
    request_id: str | None = None
