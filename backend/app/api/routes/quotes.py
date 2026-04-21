from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from app.domain import dashboard_service, quote_drafts_storage
from app.domain.auth_dependencies import require_user


router = APIRouter(prefix="/quotes", tags=["quotes"], dependencies=[Depends(require_user)])


@router.get("")
def get_quotes(
    status: str = Query("", description="Optionele statusfilter: concept | definitief"),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    try:
        items = quote_drafts_storage.list_drafts(status=status or None, limit=int(limit))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"items": items}


@router.get("/{quote_id}")
def get_quote(quote_id: str) -> dict[str, Any]:
    record = quote_drafts_storage.get_draft(quote_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Offerte niet gevonden.")
    return {"record": record}


@router.post("")
def post_quote(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        record = quote_drafts_storage.save_draft(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    dashboard_service.invalidate_dashboard_summary_cache()
    return {"record": record}


@router.put("/{quote_id}")
def put_quote(quote_id: str, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        record = quote_drafts_storage.save_draft(payload, draft_id=quote_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    dashboard_service.invalidate_dashboard_summary_cache()
    return {"record": record}


@router.delete("/{quote_id}")
def delete_quote(quote_id: str) -> dict[str, Any]:
    result = quote_drafts_storage.delete_draft(quote_id)
    dashboard_service.invalidate_dashboard_summary_cache()
    return result
