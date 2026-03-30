from __future__ import annotations

from typing import Any

from app.domain import legacy_storage, postgres_storage
from utils.storage import (
    ensure_complete_verkoop_records,
    load_all_verkoop_records,
    normalize_any_verkoop_record,
    normalize_berekening_record,
)


DATASET_DEFAULTS: dict[str, Any] = {
    "productie": {},
    "vaste-kosten": {},
    "tarieven-heffingen": [],
    "verpakkingsonderdelen": [],
    "basisproducten": [],
    "samengestelde-producten": [],
    "bieren": [],
    "berekeningen": [],
    "prijsvoorstellen": [],
    "verkoopprijzen": [],
    "variabele-kosten": {},
}


def get_dataset_names() -> list[str]:
    return list(DATASET_DEFAULTS.keys())


def get_storage_provider() -> str:
    return postgres_storage.storage_provider()


def require_postgres() -> None:
    if not postgres_storage.uses_postgres():
        raise RuntimeError(
            "Deze backend is opgeschoond naar PostgreSQL-first opslag. "
            "Activeer PostgreSQL of gebruik expliciet de bootstrap/migratietools voor legacy JSON."
        )


def load_dataset(name: str) -> Any:
    require_postgres()
    default_value = DATASET_DEFAULTS[name]
    payload = postgres_storage.load_dataset(name, default_value)
    if name == "berekeningen" and isinstance(payload, list):
        return [
            normalize_berekening_record(record)
            for record in payload
            if isinstance(record, dict)
        ]
    if name == "verkoopprijzen" and isinstance(payload, list):
        source_records = load_all_verkoop_records() if payload == [] else payload
        return ensure_complete_verkoop_records(
            [
                normalize_any_verkoop_record(record)
                for record in source_records
                if isinstance(record, dict)
            ]
        )
    return payload


def save_dataset(name: str, data: Any) -> bool:
    require_postgres()
    if name == "berekeningen" and isinstance(data, list):
        payload = [
            normalize_berekening_record(record)
            for record in data
            if isinstance(record, dict)
        ]
        return postgres_storage.save_dataset(name, payload)
    if name == "verkoopprijzen" and isinstance(data, list):
        payload = ensure_complete_verkoop_records(
            [
                normalize_any_verkoop_record(record)
                for record in data
                if isinstance(record, dict)
            ]
        )
        return postgres_storage.save_dataset(name, payload)
    return postgres_storage.save_dataset(name, data)


def bootstrap_postgres_from_json(overwrite: bool = False) -> dict[str, bool]:
    results: dict[str, bool] = {}
    for dataset_name in get_dataset_names():
        payload = legacy_storage.load_dataset_from_json(dataset_name)
        results[dataset_name] = postgres_storage.save_dataset(
            dataset_name,
            payload,
            overwrite=overwrite,
        )
    return results
