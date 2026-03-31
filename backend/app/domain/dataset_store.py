from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.domain import legacy_storage, postgres_storage
from utils.storage import (
    MODEL_A_DATASET_NAMES,
    build_model_a_canonical_datasets,
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
    "products": [],
    "product-years": [],
    "product-year-components": [],
    "product-components": [],
    "sales-strategy-years": [],
    "sales-strategy-products": [],
    "cost-calcs": [],
    "cost-calc-inputs": [],
    "cost-calc-results": [],
    "cost-calc-lines": [],
    "quotes": [],
    "quote-lines": [],
    "quote-staffels": [],
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
    if name in MODEL_A_DATASET_NAMES:
        payload = postgres_storage.load_dataset(name, default_value)
        if payload in (None, [], {}):
            return build_model_a_canonical_datasets().get(name, default_value)
        return payload
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
    if name in MODEL_A_DATASET_NAMES:
        return postgres_storage.save_dataset(name, data)
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
    canonical_payloads = build_model_a_canonical_datasets()
    for dataset_name in get_dataset_names():
        if dataset_name in MODEL_A_DATASET_NAMES:
            payload = canonical_payloads.get(dataset_name, DATASET_DEFAULTS[dataset_name])
        else:
            payload = legacy_storage.load_dataset_from_json(dataset_name)
        results[dataset_name] = postgres_storage.save_dataset(
            dataset_name,
            payload,
            overwrite=overwrite,
        )
    return results


def reset_all_datasets_to_defaults() -> dict[str, bool]:
    require_postgres()
    results: dict[str, bool] = {}
    for dataset_name, default_value in DATASET_DEFAULTS.items():
        results[dataset_name] = postgres_storage.save_dataset(
            dataset_name,
            deepcopy(default_value),
            overwrite=True,
        )
    return results
