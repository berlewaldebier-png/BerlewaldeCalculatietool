"""Generic CRUD route factory for dataset endpoints.

Eliminates boilerplate by creating dynamic endpoints for any dataset.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Response, status

from app.domain import dataset_store
from app.domain.auth_dependencies import require_admin, require_user

logger = logging.getLogger(__name__)


def _production_bulk_put_disabled(dataset_name: str) -> bool:
    env = os.getenv("CALCULATIETOOL_ENV", "local").strip().lower()
    if env in {"local", "dev", "development", "test"}:
        return False
    try:
        default_value = dataset_store.DATASET_DEFAULTS.get(dataset_name)
        return isinstance(default_value, list) and dataset_name not in dataset_store.READ_ONLY_PROJECTION_DATASETS
    except Exception:
        return False


def _quoted_etag(value: str) -> str:
    return f'"{str(value or "").strip()}"'


def _raise_dataset_http_error(exc: Exception) -> None:
    if isinstance(exc, dataset_store.DatasetItemNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, dataset_store.DatasetPreconditionRequiredError):
        raise HTTPException(status_code=428, detail=str(exc)) from exc
    if isinstance(exc, dataset_store.DatasetConflictError):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if isinstance(exc, dataset_store.DatasetReadOnlyError):
        raise HTTPException(status_code=405, detail=str(exc)) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    logger.exception("Dataset operation failed")
    raise HTTPException(status_code=500, detail="Internal server error") from exc


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
    def get_dataset(dataset_name: str, response: Response) -> dict[str, Any]:
        """Get a dataset by name."""
        if dataset_name not in dataset_names:
            logger.warning(f"Attempted to access unknown dataset: {dataset_name}")
            raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")
        
        try:
            data = dataset_store.load_dataset(dataset_name)
            etag = dataset_store.compute_dataset_etag(data)
            response.headers["ETag"] = _quoted_etag(etag)
            logger.debug(f"Loaded dataset: {dataset_name}")
            return {"data": data, "etag": etag}
        except ValueError as exc:
            logger.error(f"Validation error loading {dataset_name}: {exc}")
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception(f"Error loading dataset {dataset_name}")
            raise HTTPException(status_code=500, detail="Internal server error") from exc

    @router.get("/{dataset_name}/items", response_model=dict[str, Any])
    def list_dataset_items(dataset_name: str, response: Response) -> dict[str, Any]:
        """List item resources for list-shaped datasets."""
        if dataset_name not in dataset_names:
            raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")
        try:
            result = dataset_store.list_dataset_items(dataset_name)
            response.headers["ETag"] = _quoted_etag(str(result.get("dataset_etag", "")))
            return result
        except Exception as exc:
            _raise_dataset_http_error(exc)

    @router.post("/{dataset_name}/items", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
    def post_dataset_item(
        dataset_name: str,
        response: Response,
        data: dict[str, Any] = Body(...),
        _: dict = Depends(require_admin),
    ) -> dict[str, Any]:
        """Create one item resource. Requires a unique `id` field."""
        if dataset_name not in dataset_names:
            raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")
        try:
            result = dataset_store.create_dataset_item(dataset_name, data)
            response.headers["ETag"] = _quoted_etag(str(result.get("etag", "")))
            return result
        except Exception as exc:
            _raise_dataset_http_error(exc)

    @router.get("/{dataset_name}/items/{item_id}", response_model=dict[str, Any])
    def get_dataset_item(dataset_name: str, item_id: str, response: Response) -> dict[str, Any]:
        """Read one item resource."""
        if dataset_name not in dataset_names:
            raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")
        try:
            result = dataset_store.get_dataset_item(dataset_name, item_id)
            response.headers["ETag"] = _quoted_etag(str(result.get("etag", "")))
            return result
        except Exception as exc:
            _raise_dataset_http_error(exc)

    @router.put("/{dataset_name}/items/{item_id}", response_model=dict[str, Any])
    def put_dataset_item(
        dataset_name: str,
        item_id: str,
        response: Response,
        data: dict[str, Any] = Body(...),
        if_match: str | None = Header(default=None, alias="If-Match"),
        _: dict = Depends(require_admin),
    ) -> dict[str, Any]:
        """Replace one item resource. Requires `If-Match` to prevent lost updates."""
        if dataset_name not in dataset_names:
            raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")
        try:
            result = dataset_store.replace_dataset_item(dataset_name, item_id, data, expected_etag=if_match)
            response.headers["ETag"] = _quoted_etag(str(result.get("etag", "")))
            return result
        except Exception as exc:
            _raise_dataset_http_error(exc)

    @router.patch("/{dataset_name}/items/{item_id}", response_model=dict[str, Any])
    def patch_dataset_item(
        dataset_name: str,
        item_id: str,
        response: Response,
        data: dict[str, Any] = Body(...),
        if_match: str | None = Header(default=None, alias="If-Match"),
        _: dict = Depends(require_admin),
    ) -> dict[str, Any]:
        """Partially update one item resource. Requires `If-Match`."""
        if dataset_name not in dataset_names:
            raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")
        try:
            result = dataset_store.patch_dataset_item(dataset_name, item_id, data, expected_etag=if_match)
            response.headers["ETag"] = _quoted_etag(str(result.get("etag", "")))
            return result
        except Exception as exc:
            _raise_dataset_http_error(exc)

    @router.delete("/{dataset_name}/items/{item_id}", response_model=dict[str, Any])
    def delete_dataset_item(
        dataset_name: str,
        item_id: str,
        if_match: str | None = Header(default=None, alias="If-Match"),
        _: dict = Depends(require_admin),
    ) -> dict[str, Any]:
        """Delete one item resource. Requires `If-Match`."""
        if dataset_name not in dataset_names:
            raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found")
        try:
            return dataset_store.delete_dataset_item(dataset_name, item_id, expected_etag=if_match)
        except Exception as exc:
            _raise_dataset_http_error(exc)

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
        if _production_bulk_put_disabled(dataset_name):
            raise HTTPException(
                status_code=405,
                detail="Bulk dataset PUT is uitgeschakeld in productie. Gebruik /data/{dataset}/items.",
            )
        
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
