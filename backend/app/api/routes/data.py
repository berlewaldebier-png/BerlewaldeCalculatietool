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
    "verkoopprijzen",
    "variabele-kosten",
]

# Create generic CRUD router for standard datasets
router = create_dataset_crud_router(_STANDARD_DATASETS, protected=True)


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
        activated = dataset_store.activate_cost_version(version_id, context={"run_id": run_id})
        if activated is None:
            raise HTTPException(status_code=404, detail="Kostprijsversie niet gevonden of niet definitief")
        logger.info(f"Activated cost version: {version_id}")
        return {"activated": True, "record": activated}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Error activating cost version {version_id}")
        raise HTTPException(status_code=500, detail="Internal server error") from exc


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
