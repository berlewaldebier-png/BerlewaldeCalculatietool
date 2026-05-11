"""Data management API routes.

Provides CRUD operations for datasets with special handlers for complex operations
like cost version activation.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from app.api.utils import create_dataset_crud_router
from app.domain import dataset_store, postgres_storage
from app.domain.auth_dependencies import require_admin
from app.schemas.sku_composition import (
    UpsertBundleRequest,
    UpsertBundleResponse,
    UpsertFormatRequest,
    UpsertFormatResponse,
)
from app.schemas.storage import StorageStatus

logger = logging.getLogger(__name__)

# Standard datasets exposed via generic CRUD
_STANDARD_DATASETS = [
    "productie",
    "vaste-kosten",
    "tarieven-heffingen",
    "verpakkingsonderdelen",
    "basisproducten",
    "samengestelde-producten",
    "bieren",
    "berekeningen",
    "kostprijsversies",
    "kostprijsproductactiveringen",
    "verkoopprijzen",
    "break-even-configuraties",
    "adviesprijzen",
    "channels",
    "packaging-components",
    "packaging-component-prices",
    "packaging-component-price-versions",
    "trace-lots",
    "trace-batches",
    "trace-batch-consumptions",
    "variabele-kosten",
    # SKU-aanpak canonical datasets
    "articles",
    "skus",
    "bom-lines",
    # SKU-classificatie vocabularies
    "productgroepen",
    "verpakkingstypen",
    "alcoholcategorieen",
]

# Create generic CRUD router for standard datasets
router = create_dataset_crud_router(_STANDARD_DATASETS, protected=True)


@router.put("/skus/{sku_id}/classification")
def put_sku_classification(
    sku_id: str,
    data: dict[str, Any] = Body(default_factory=dict),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Update classification for a SKU.

    Important: productkoppeling (Douano mappings) is the source of truth for ERP-related
    classification. This endpoint is kept for backward compatibility with older UI code,
    but it updates the `douano_product_mapping` records that reference the given SKU.

    If the SKU is not mapped to any Douano product yet, this endpoint returns 409 to
    prevent multiple sources of truth.
    """
    try:
        from app.domain import douano_product_mapping_storage

        sku_value = str(sku_id or "").strip()
        if not sku_value:
            raise HTTPException(status_code=400, detail="sku_id ontbreekt.")

        product_group = str(data.get("product_group", "") or "").strip()
        alcohol_category = str(data.get("alcohol_category", "") or "").strip()
        packaging_type = str(data.get("packaging_type", "") or "").strip()

        report = douano_product_mapping_storage.update_classification_by_sku_id(
            sku_id=sku_value,
            product_group=product_group,
            alcohol_category=alcohol_category,
            packaging_type=packaging_type,
        )
        if int(report.get("updated", 0) or 0) <= 0:
            raise HTTPException(
                status_code=409,
                detail="SKU is nog niet gekoppeld in Beheer > Productkoppeling; classificatie kan pas daar worden opgeslagen.",
            )
        return {"ok": True, "mapping_update": report}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error updating sku classification")
        raise HTTPException(status_code=500, detail=str(exc) or "Internal server error") from exc


# Special handlers for complex operations
@router.post("/kostprijsversies/{version_id}/activate")
def post_activate_kostprijsversie(
    version_id: str,
    data: dict[str, Any] = Body(default_factory=dict),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Activate a cost version."""
    try:
        run_id = str(data.get("run_id", "") or "")
        effective_from = str(data.get("effective_from", "") or "").strip()
        activated = dataset_store.activate_cost_version(
            version_id,
            context={"run_id": run_id},
            effective_from=effective_from,
        )
        if activated is None:
            raise HTTPException(status_code=404, detail="Kostprijsversie niet gevonden of niet definitief")
        logger.info(f"Activated cost version: {version_id}")
        return {"activated": True, "record": activated}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Error activating cost version {version_id}")
        # In local/dev this endpoint is frequently used to diagnose data-model issues.
        # Include the exception message so the UI/Swagger can surface the real root cause.
        raise HTTPException(status_code=500, detail=str(exc) or "Internal server error") from exc


@router.post("/kostprijsversies/{version_id}/activate-products")
def post_activate_kostprijsversie_products(
    version_id: str,
    data: dict[str, Any] = Body(...),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Activate specific products for a cost version."""
    try:
        product_ids = data.get("product_ids", [])
        run_id = str(data.get("run_id", "") or "")
        
        if not isinstance(product_ids, list):
            raise HTTPException(status_code=400, detail="product_ids moet een lijst zijn")
        
        activated = dataset_store.activate_cost_version_products(
            version_id,
            [str(product_id or "") for product_id in product_ids if str(product_id or "").strip()],
            context={"run_id": run_id},
        )
        
        if activated is None:
            raise HTTPException(
                status_code=404,
                detail="Kostprijsversie of productkoppeling niet gevonden of niet definitief",
            )
        
        logger.info(f"Activated {len(product_ids)} products for cost version: {version_id}")
        return {"activated": True, "record": activated}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Error activating products for cost version {version_id}")
        raise HTTPException(status_code=500, detail="Internal server error") from exc


@router.get("/storage-status", response_model=StorageStatus)
def get_storage_status() -> StorageStatus:
    """Get current storage provider and status."""
    try:
        status = postgres_storage.storage_status()
        logger.debug("Retrieved storage status")
        return StorageStatus(**status)
    except Exception as exc:
        logger.exception("Error retrieving storage status")
        raise HTTPException(status_code=500, detail="Internal server error") from exc


@router.post("/bootstrap-postgres")
def post_bootstrap_postgres(_: dict = Depends(require_admin)) -> dict[str, Any]:
    """Bootstrap PostgreSQL database from JSON files."""
    try:
        if not postgres_storage.database_url():
            raise HTTPException(status_code=400, detail="PostgreSQL-configuratie ontbreekt")
        
        results = dataset_store.bootstrap_postgres_from_json(overwrite=True)
        logger.info("PostgreSQL bootstrap completed")
        return {
            "provider": dataset_store.get_storage_provider(),
            "bootstrapped": results,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error bootstrapping PostgreSQL")
        raise HTTPException(status_code=500, detail="Internal server error") from exc


def _slugify_id(value: str) -> str:
    import re

    normalized = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower())
    normalized = re.sub(r"(^-|-$)", "", normalized)
    return normalized or "new"


def _raise_validation_error(message: str, *, field_errors: list[dict[str, Any]] | None = None) -> None:
    raise HTTPException(
        status_code=400,
        detail={
            "message": str(message or "Validatiefout."),
            "field_errors": field_errors or [],
        },
    )


@router.post("/sku-composition/upsert-format", response_model=UpsertFormatResponse)
def post_upsert_format(
    payload: UpsertFormatRequest,
    _: dict = Depends(require_admin),
) -> UpsertFormatResponse:
    """Atomisch opslaan: format article + bijbehorende bom-lines."""
    try:
        name = str(payload.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Naam ontbreekt.")

        article_id = f"fmt-{_slugify_id(name)}"
        target_article_id = str(payload.edit_format_id or "").strip() or article_id

        article_payload: dict[str, Any] = {
            "id": target_article_id,
            "name": name,
            "kind": "format",
            "uom": "stuk" if payload.uom in {"pakket", "uur"} else str(payload.uom or "stuk"),
            "content_liter": max(float(payload.totals_liters or 0.0), 0.0),
            "active": True,
            "actief": True,
        }

        from uuid import NAMESPACE_URL, uuid5

        def bom_id(kind: str, component_id: str) -> str:
            return str(uuid5(NAMESPACE_URL, f"bom:{target_article_id}:{kind}:{component_id}"))

        next_bom_lines: list[dict[str, Any]] = []
        seen_component_keys: set[tuple[str, str]] = set()
        field_errors: list[dict[str, Any]] = []
        for idx, line in enumerate(payload.afvul_parts or []):
            component_id = str(line.component_id or "").strip()
            if not component_id:
                field_errors.append(
                    {"field": f"afvul_parts[{idx}].component_id", "code": "required", "message": "Component ontbreekt."}
                )
                continue
            qty = float(line.qty or 0.0)
            if qty <= 0:
                field_errors.append({"field": f"afvul_parts[{idx}].qty", "code": "gt0", "message": "Aantal moet > 0 zijn."})
                continue
            key = (str(line.kind), component_id)
            if key in seen_component_keys:
                field_errors.append(
                    {
                        "field": f"afvul_parts[{idx}]",
                        "code": "duplicate",
                        "message": "Dubbele component in BOM. Combineer aantallen of verwijder duplicaat.",
                    }
                )
                continue
            seen_component_keys.add(key)
            next_bom_lines.append(
                {
                    "id": bom_id(str(line.kind), component_id),
                    "parent_article_id": target_article_id,
                    "component_article_id": component_id,
                    "component_sku_id": "",
                    "quantity": qty,
                    "uom": "stuk",
                }
            )

        with postgres_storage.transaction():
            existing_articles = dataset_store.load_dataset("articles")
            existing_bom = dataset_store.load_dataset("bom-lines")
            articles = [
                row
                for row in (existing_articles if isinstance(existing_articles, list) else [])
                if isinstance(row, dict)
            ]
            bom_lines = [
                row for row in (existing_bom if isinstance(existing_bom, list) else []) if isinstance(row, dict)
            ]

            # Validate BOM kind-consistency against canonical article kinds.
            articles_by_id = {
                str(row.get("id", "") or "").strip(): row for row in articles if str(row.get("id", "") or "").strip()
            }
            for idx, line in enumerate(payload.afvul_parts or []):
                component_id = str(line.component_id or "").strip()
                if not component_id:
                    continue
                kind = str(line.kind or "").strip().lower()
                component = articles_by_id.get(component_id, {})
                component_kind = str((component or {}).get("kind", "") or "").strip().lower()
                if kind == "format" and component_kind != "format":
                    field_errors.append(
                        {
                            "field": f"afvul_parts[{idx}].component_id",
                            "code": "kind_mismatch",
                            "message": "Component moet een afvuleenheid (format) zijn.",
                        }
                    )
                if kind == "packaging_component" and component_kind != "packaging_component":
                    field_errors.append(
                        {
                            "field": f"afvul_parts[{idx}].component_id",
                            "code": "kind_mismatch",
                            "message": "Component moet een verpakkingsonderdeel (packaging_component) zijn.",
                        }
                    )

            if field_errors:
                _raise_validation_error("Afvuleenheid (format) kan niet worden opgeslagen.", field_errors=field_errors)

            kept_articles = [row for row in articles if str(row.get("id", "") or "").strip() != target_article_id]
            kept_bom = [row for row in bom_lines if str(row.get("parent_article_id", "") or "").strip() != target_article_id]

            dataset_store.save_dataset("articles", [*kept_articles, article_payload])
            dataset_store.save_dataset("bom-lines", [*kept_bom, *next_bom_lines])

        return UpsertFormatResponse(article_id=target_article_id)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error upserting format")
        raise HTTPException(status_code=500, detail=str(exc) or "Internal server error") from exc


@router.post("/sku-composition/upsert-bundle", response_model=UpsertBundleResponse)
def post_upsert_bundle(
    payload: UpsertBundleRequest,
    _: dict = Depends(require_admin),
) -> UpsertBundleResponse:
    """Atomisch opslaan: bundle article + SKU + bom-lines."""
    try:
        name = str(payload.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Naam ontbreekt.")

        article_id = str(payload.edit_article_id or "").strip() or f"bundle-{_slugify_id(name)}"
        sku_id = str(payload.edit_sku_id or "").strip() or f"sku-{article_id}"

        sellable_kind = str(payload.sellable_kind or "product").strip().lower()
        is_service = sellable_kind == "dienst"

        article_payload: dict[str, Any] = {
            "id": article_id,
            "name": name,
            "kind": "bundle",
            "uom": str(payload.uom or "stuk"),
            "content_liter": max(float(payload.totals_liters or 0.0), 0.0),
            "active": True,
            "actief": True,
            "sellable_subtype": "dienst" if is_service else "product",
            "pricing_method": "manual_rate" if is_service else "cost_plus",
            "manual_rate_ex": float(payload.manual_rate_ex or 0.0) if is_service else 0.0,
            "product_group": str(payload.product_group or "").strip(),
            "alcohol_category": str(payload.alcohol_category or "").strip(),
            "packaging_type": str(payload.packaging_type or "").strip(),
        }

        sku_payload: dict[str, Any] = {
            "id": sku_id,
            "kind": "article",
            "article_id": article_id,
            "name": name,
            "active": True,
            "actief": True,
            "pricing_method": article_payload["pricing_method"],
            "manual_rate_ex": article_payload["manual_rate_ex"],
            "product_group": article_payload["product_group"],
            "alcohol_category": article_payload["alcohol_category"],
            "packaging_type": article_payload["packaging_type"],
        }

        from uuid import NAMESPACE_URL, uuid5

        def bom_id(kind: str, component_key: str) -> str:
            return str(uuid5(NAMESPACE_URL, f"bom:{article_id}:{kind}:{component_key}"))

        next_bom_lines: list[dict[str, Any]] = []
        field_errors: list[dict[str, Any]] = []
        seen_component_skus: set[str] = set()
        for idx, line in enumerate(payload.composition or []):
            component_sku_id = str(line.component_sku_id or "").strip()
            if not component_sku_id:
                field_errors.append(
                    {
                        "field": f"composition[{idx}].component_sku_id",
                        "code": "required",
                        "message": "Component SKU ontbreekt.",
                    }
                )
                continue
            qty = float(line.qty or 0.0)
            if qty <= 0:
                field_errors.append({"field": f"composition[{idx}].qty", "code": "gt0", "message": "Aantal moet > 0 zijn."})
                continue
            if component_sku_id in seen_component_skus:
                field_errors.append(
                    {
                        "field": f"composition[{idx}].component_sku_id",
                        "code": "duplicate",
                        "message": "Dubbele component SKU. Combineer aantallen of verwijder duplicaat.",
                    }
                )
                continue
            seen_component_skus.add(component_sku_id)
            next_bom_lines.append(
                {
                    "id": bom_id("sku", component_sku_id),
                    "parent_article_id": article_id,
                    "component_sku_id": component_sku_id,
                    "component_article_id": "",
                    "quantity": qty,
                    "uom": "stuk",
                }
            )
        seen_packaging_keys: set[tuple[str, str]] = set()
        for idx, line in enumerate(payload.packaging or []):
            component_id = str(line.component_id or "").strip()
            if not component_id:
                field_errors.append(
                    {"field": f"packaging[{idx}].component_id", "code": "required", "message": "Verpakkingscomponent ontbreekt."}
                )
                continue
            qty = float(line.qty or 0.0)
            if qty <= 0:
                field_errors.append({"field": f"packaging[{idx}].qty", "code": "gt0", "message": "Aantal moet > 0 zijn."})
                continue
            key = (str(line.kind), component_id)
            if key in seen_packaging_keys:
                field_errors.append(
                    {
                        "field": f"packaging[{idx}]",
                        "code": "duplicate",
                        "message": "Dubbele verpakkingscomponent. Combineer aantallen of verwijder duplicaat.",
                    }
                )
                continue
            seen_packaging_keys.add(key)
            next_bom_lines.append(
                {
                    "id": bom_id(str(line.kind), component_id),
                    "parent_article_id": article_id,
                    "component_article_id": component_id,
                    "component_sku_id": "",
                    "quantity": qty,
                    "uom": "stuk",
                }
            )

        with postgres_storage.transaction():
            existing_articles = dataset_store.load_dataset("articles")
            existing_skus = dataset_store.load_dataset("skus")
            existing_bom = dataset_store.load_dataset("bom-lines")
            articles = [
                row
                for row in (existing_articles if isinstance(existing_articles, list) else [])
                if isinstance(row, dict)
            ]
            skus = [row for row in (existing_skus if isinstance(existing_skus, list) else []) if isinstance(row, dict)]
            bom_lines = [
                row for row in (existing_bom if isinstance(existing_bom, list) else []) if isinstance(row, dict)
            ]

            # Validate: component SKUs must exist + be active + not self-referential.
            skus_by_id = {str(row.get("id", "") or "").strip(): row for row in skus if str(row.get("id", "") or "").strip()}
            for idx, line in enumerate(payload.composition or []):
                component_sku_id = str(line.component_sku_id or "").strip()
                if not component_sku_id:
                    continue
                if component_sku_id == sku_id:
                    field_errors.append(
                        {
                            "field": f"composition[{idx}].component_sku_id",
                            "code": "self_reference",
                            "message": "Een bundle kan zichzelf niet als component bevatten.",
                        }
                    )
                    continue
                component_sku = skus_by_id.get(component_sku_id, {})
                if not component_sku:
                    field_errors.append(
                        {
                            "field": f"composition[{idx}].component_sku_id",
                            "code": "not_found",
                            "message": "Component SKU bestaat niet.",
                        }
                    )
                    continue
                if (component_sku.get("active") is False) or (component_sku.get("actief") is False):
                    field_errors.append(
                        {
                            "field": f"composition[{idx}].component_sku_id",
                            "code": "inactive",
                            "message": "Component SKU is niet actief/verkoopbaar.",
                        }
                    )

            # Validate packaging component kinds.
            articles_by_id = {str(row.get("id", "") or "").strip(): row for row in articles if str(row.get("id", "") or "").strip()}
            for idx, line in enumerate(payload.packaging or []):
                component_id = str(line.component_id or "").strip()
                if not component_id:
                    continue
                kind = str(line.kind or "").strip().lower()
                component = articles_by_id.get(component_id, {})
                component_kind = str((component or {}).get("kind", "") or "").strip().lower()
                if kind == "format" and component_kind != "format":
                    field_errors.append(
                        {
                            "field": f"packaging[{idx}].component_id",
                            "code": "kind_mismatch",
                            "message": "Component moet een afvuleenheid (format) zijn.",
                        }
                    )
                if kind == "packaging_component" and component_kind != "packaging_component":
                    field_errors.append(
                        {
                            "field": f"packaging[{idx}].component_id",
                            "code": "kind_mismatch",
                            "message": "Component moet een verpakkingsonderdeel (packaging_component) zijn.",
                        }
                    )

            if field_errors:
                _raise_validation_error("Bundle kan niet worden opgeslagen.", field_errors=field_errors)

            kept_articles = [row for row in articles if str(row.get("id", "") or "").strip() != article_id]
            kept_skus = [row for row in skus if str(row.get("id", "") or "").strip() != sku_id]
            kept_bom = [row for row in bom_lines if str(row.get("parent_article_id", "") or "").strip() != article_id]

            dataset_store.save_dataset("articles", [*kept_articles, article_payload])
            dataset_store.save_dataset("skus", [*kept_skus, sku_payload])
            dataset_store.save_dataset("bom-lines", [*kept_bom, *next_bom_lines])

        return UpsertBundleResponse(sku_id=sku_id, article_id=article_id)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Error upserting bundle")
        raise HTTPException(status_code=500, detail=str(exc) or "Internal server error") from exc
