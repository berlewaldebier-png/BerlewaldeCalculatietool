"""Generic CRUD route factory for dataset endpoints.

Eliminates boilerplate by creating dynamic endpoints for any dataset.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from fastapi import APIRouter, Body, Depends, HTTPException

from app.domain import dataset_store
from app.domain.auth_dependencies import require_admin, require_user

logger = logging.getLogger(__name__)


def create_dataset_crud_router(
    dataset_names: list[str],
    protected: bool = True,
) -> APIRouter:
    """Create a generic CRUD router for datasets.
    
    Args:
        dataset_names: List of dataset names to expose
        protected: If True, requires authentication on all endpoints
        
    Returns:
        FastAPI APIRouter with GET/PUT endpoints for each dataset
    """
    router = APIRouter(
        prefix="/data",
        tags=["data"],
        dependencies=[Depends(require_user)] if protected else [],
    )

    @router.get("/{dataset_name}", response_model=dict[str, Any])
    def get_dataset(dataset_name: str) -> dict[str, Any]:
        """Get a dataset by name."""
        if dataset_name not in dataset_names:
            logger.warning(f"Attempted to access unknown dataset: {dataset_name}")
            raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")
        
        try:
            data = dataset_store.load_dataset(dataset_name)
            logger.debug(f"Loaded dataset: {dataset_name}")
            return {"data": data}
        except ValueError as exc:
            logger.error(f"Validation error loading {dataset_name}: {exc}")
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception(f"Error loading dataset {dataset_name}")
            raise HTTPException(status_code=500, detail="Internal server error") from exc

    @router.put("/{dataset_name}", response_model=dict[str, bool])
    def put_dataset(
        dataset_name: str,
        data: Any = Body(...),
        _: dict = Depends(require_admin),
    ) -> dict[str, bool]:
        """Update a dataset."""
        if dataset_name not in dataset_names:
            logger.warning(f"Attempted to update unknown dataset: {dataset_name}")
            raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")
        
        try:
            saved = dataset_store.save_dataset(dataset_name, data)
            if saved:
                logger.info(f"Dataset updated: {dataset_name}")
            else:
                logger.warning(f"Dataset save returned False: {dataset_name}")
            return {"saved": saved}
        except ValueError as exc:
            logger.warning(f"Validation error saving {dataset_name}: {exc}")
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception(f"Error saving dataset {dataset_name}")
            raise HTTPException(status_code=500, detail="Internal server error") from exc

    return router


def create_custom_route(
    router: APIRouter,
    method: str,
    path: str,
    handler: Callable,
    **kwargs,
) -> None:
    """Register a custom route handler on a router.
    
    This is a convenience method for adding route-specific handlers
    alongside generic CRUD operations.
    """
    if method.upper() == "GET":
        router.get(path, **kwargs)(handler)
    elif method.upper() == "POST":
        router.post(path, **kwargs)(handler)
    elif method.upper() == "PUT":
        router.put(path, **kwargs)(handler)
    elif method.upper() == "DELETE":
        router.delete(path, **kwargs)(handler)
    else:
        raise ValueError(f"Unsupported HTTP method: {method}")
