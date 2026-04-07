from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from app.domain import dataset_store, postgres_storage
from app.domain.auth_dependencies import require_admin, require_user
from app.schemas.storage import StorageStatus


router = APIRouter(prefix="/data", tags=["data"], dependencies=[Depends(require_user)])


@router.get("/productie")
def get_productie() -> dict:
    return dataset_store.load_dataset("productie")


@router.put("/productie")
def put_productie(data: dict[str, Any]) -> dict[str, bool]:
    _: dict = Depends(require_admin)
    try:
        return {"saved": dataset_store.save_dataset("productie", data)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/vaste-kosten")
def get_vaste_kosten() -> dict:
    return dataset_store.load_dataset("vaste-kosten")


@router.put("/vaste-kosten")
def put_vaste_kosten(data: dict[str, Any]) -> dict[str, bool]:
    _: dict = Depends(require_admin)
    try:
        return {"saved": dataset_store.save_dataset("vaste-kosten", data)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/tarieven-heffingen")
def get_tarieven_heffingen() -> list[dict]:
    return dataset_store.load_dataset("tarieven-heffingen")


@router.put("/tarieven-heffingen")
def put_tarieven_heffingen(data: list[dict[str, Any]]) -> dict[str, bool]:
    _: dict = Depends(require_admin)
    return {"saved": dataset_store.save_dataset("tarieven-heffingen", data)}


@router.get("/verpakkingsonderdelen")
def get_verpakkingsonderdelen() -> list[dict]:
    return dataset_store.load_dataset("verpakkingsonderdelen")


@router.put("/verpakkingsonderdelen")
def put_verpakkingsonderdelen(data: list[dict[str, Any]]) -> dict[str, bool]:
    _: dict = Depends(require_admin)
    return {"saved": dataset_store.save_dataset("verpakkingsonderdelen", data)}


@router.get("/basisproducten")
def get_basisproducten() -> list[dict]:
    return dataset_store.load_dataset("basisproducten")


@router.put("/basisproducten")
def put_basisproducten(data: list[dict[str, Any]]) -> dict[str, bool]:
    _: dict = Depends(require_admin)
    return {"saved": dataset_store.save_dataset("basisproducten", data)}


@router.get("/samengestelde-producten")
def get_samengestelde_producten() -> list[dict]:
    return dataset_store.load_dataset("samengestelde-producten")


@router.put("/samengestelde-producten")
def put_samengestelde_producten(data: list[dict[str, Any]]) -> dict[str, bool]:
    _: dict = Depends(require_admin)
    return {"saved": dataset_store.save_dataset("samengestelde-producten", data)}


@router.get("/bieren")
def get_bieren() -> list[dict]:
    return dataset_store.load_dataset("bieren")


@router.put("/bieren")
def put_bieren(data: list[dict[str, Any]]) -> dict[str, bool]:
    _: dict = Depends(require_admin)
    return {"saved": dataset_store.save_dataset("bieren", data)}


@router.get("/berekeningen")
def get_berekeningen() -> list[dict]:
    return dataset_store.load_dataset("berekeningen")


@router.put("/berekeningen")
def put_berekeningen(data: list[dict[str, Any]]) -> dict[str, bool]:
    _: dict = Depends(require_admin)
    return {"saved": dataset_store.save_dataset("berekeningen", data)}


@router.get("/kostprijsversies")
def get_kostprijsversies() -> list[dict]:
    return dataset_store.load_dataset("kostprijsversies")


@router.put("/kostprijsversies")
def put_kostprijsversies(data: list[dict[str, Any]]) -> dict[str, bool]:
    _: dict = Depends(require_admin)
    return {"saved": dataset_store.save_dataset("kostprijsversies", data)}


@router.post("/kostprijsversies/{version_id}/activate")
def post_activate_kostprijsversie(
    version_id: str,
    data: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    _: dict = Depends(require_admin)
    run_id = str(data.get("run_id", "") or "")
    activated = dataset_store.activate_cost_version(version_id, context={"run_id": run_id})
    if activated is None:
        raise HTTPException(status_code=404, detail="Kostprijsversie niet gevonden of niet definitief")
    return {"activated": True, "record": activated}


@router.post("/kostprijsversies/{version_id}/activate-products")
def post_activate_kostprijsversie_products(
    version_id: str,
    data: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    _: dict = Depends(require_admin)
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
    return {"activated": True, "record": activated}


@router.get("/prijsvoorstellen")
def get_prijsvoorstellen() -> list[dict]:
    return dataset_store.load_dataset("prijsvoorstellen")


@router.put("/prijsvoorstellen")
def put_prijsvoorstellen(data: list[dict[str, Any]]) -> dict[str, bool]:
    return {"saved": dataset_store.save_dataset("prijsvoorstellen", data)}


@router.get("/verkoopprijzen")
def get_verkoopprijzen() -> list[dict]:
    return dataset_store.load_dataset("verkoopprijzen")


@router.put("/verkoopprijzen")
def put_verkoopprijzen(data: list[dict[str, Any]]) -> dict[str, bool]:
    _: dict = Depends(require_admin)
    return {"saved": dataset_store.save_dataset("verkoopprijzen", data)}


@router.get("/variabele-kosten")
def get_variabele_kosten() -> dict:
    return dataset_store.load_dataset("variabele-kosten")


@router.put("/variabele-kosten")
def put_variabele_kosten(data: dict[str, Any]) -> dict[str, bool]:
    _: dict = Depends(require_admin)
    return {"saved": dataset_store.save_dataset("variabele-kosten", data)}


@router.put("/dataset/{name}")
def put_dataset(name: str, data: Any = Body(...)) -> dict[str, bool]:
    _: dict = Depends(require_admin)
    if name not in dataset_store.get_dataset_names():
        raise HTTPException(status_code=404, detail="Unknown dataset")
    return {"saved": dataset_store.save_dataset(name, data)}


@router.get("/dataset/{name}")
def get_dataset(name: str) -> Any:
    if name not in dataset_store.get_dataset_names():
        raise HTTPException(status_code=404, detail="Unknown dataset")
    return dataset_store.load_dataset(name)


@router.get("/storage-status", response_model=StorageStatus)
def get_storage_status() -> StorageStatus:
    return StorageStatus(**postgres_storage.storage_status())


@router.post("/bootstrap-postgres")
def post_bootstrap_postgres() -> dict[str, Any]:
    _: dict = Depends(require_admin)
    if not postgres_storage.database_url():
        raise HTTPException(status_code=400, detail="PostgreSQL-configuratie ontbreekt")
    results = dataset_store.bootstrap_postgres_from_json(overwrite=True)
    return {
        "provider": dataset_store.get_storage_provider(),
        "bootstrapped": results,
    }
