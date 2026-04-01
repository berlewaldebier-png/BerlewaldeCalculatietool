from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.domain import legacy_storage, postgres_storage
from utils.storage import (
    MODEL_A_DATASET_NAMES,
    build_model_a_canonical_datasets,
    build_basisproducten_legacy_projection,
    build_samengestelde_producten_legacy_projection,
    build_verpakkingsonderdelen_legacy_projection,
    ensure_complete_verkoop_records,
    activate_kostprijsversie,
    activate_kostprijsversie_products,
    load_basisproducten,
    load_kostprijsproductactiveringen,
    load_kostprijsversies,
    load_packaging_component_masters,
    load_packaging_component_prices,
    load_packaging_component_price_versions,
    load_samengestelde_producten,
    load_all_verkoop_records,
    normalize_any_verkoop_record,
    normalize_berekening_record,
    normalize_prijsvoorstel_record,
    save_berekeningen,
    save_basisproducten,
    save_kostprijsproductactiveringen,
    save_packaging_component_masters,
    save_packaging_component_prices,
    save_packaging_component_price_versions,
    save_verpakkingsonderdelen,
    save_prijsvoorstellen,
    save_samengestelde_producten,
)


DATASET_DEFAULTS: dict[str, Any] = {
    "productie": {},
    "vaste-kosten": {},
    "tarieven-heffingen": [],
    "channels": [
        {"id": "horeca", "code": "horeca", "naam": "Horeca", "actief": True, "volgorde": 10, "default_marge_pct": 50, "default_factor": 3.5},
        {"id": "retail", "code": "retail", "naam": "Supermarkt", "actief": True, "volgorde": 20, "default_marge_pct": 30, "default_factor": 2.4},
        {"id": "slijterij", "code": "slijterij", "naam": "Slijterij", "actief": True, "volgorde": 30, "default_marge_pct": 40, "default_factor": 3.0},
        {"id": "zakelijk", "code": "zakelijk", "naam": "Speciaalzaak", "actief": True, "volgorde": 40, "default_marge_pct": 45, "default_factor": 3.2},
        {"id": "particulier", "code": "particulier", "naam": "Particulier", "actief": False, "volgorde": 50, "default_marge_pct": 50, "default_factor": 3.0},
    ],
    "verpakkingsonderdelen": [],
    "basisproducten": [],
    "samengestelde-producten": [],
    "packaging-components": [],
    "packaging-component-prices": [],
    "packaging-component-price-versions": [],
    "base-product-masters": [],
    "composite-product-masters": [],
    "bieren": [],
    "kostprijsversies": [],
    "kostprijsproductactiveringen": [],
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

READ_ONLY_PROJECTION_DATASETS = {
    "verpakkingsonderdelen",
    "basisproducten",
    "samengestelde-producten",
    "packaging-component-prices",
    "berekeningen",
    *MODEL_A_DATASET_NAMES,
}


def _normalize_channels_dataset(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, list):
        return deepcopy(DATASET_DEFAULTS["channels"])
    cleaned: list[dict[str, Any]] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code", row.get("id", "")) or "").strip().lower()
        if not code or code == "groothandel":
            continue
        cleaned.append(row)
    return cleaned


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
    if name == "channels":
        payload = postgres_storage.load_dataset(name, default_value)
        return _normalize_channels_dataset(payload)
    if name == "packaging-components":
        return load_packaging_component_masters()
    if name == "packaging-component-prices":
        return load_packaging_component_prices()
    if name == "packaging-component-price-versions":
        return load_packaging_component_price_versions()
    if name == "base-product-masters":
        return load_basisproducten()
    if name == "composite-product-masters":
        return load_samengestelde_producten()
    if name == "verpakkingsonderdelen":
        return build_verpakkingsonderdelen_legacy_projection()
    if name == "basisproducten":
        return build_basisproducten_legacy_projection()
    if name == "samengestelde-producten":
        return build_samengestelde_producten_legacy_projection()
    if name in MODEL_A_DATASET_NAMES:
        return build_model_a_canonical_datasets().get(name, default_value)
    if name in {"kostprijsversies", "berekeningen"}:
        return load_kostprijsversies()
    if name == "kostprijsproductactiveringen":
        return load_kostprijsproductactiveringen()
    payload = postgres_storage.load_dataset(name, default_value)
    if name == "prijsvoorstellen" and isinstance(payload, list):
        return [
            normalize_prijsvoorstel_record(record)
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
    if name == "channels":
        return postgres_storage.save_dataset(name, _normalize_channels_dataset(data), overwrite=True)
    if name == "packaging-components" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_packaging_component_masters(payload)
    if name == "packaging-component-prices" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_packaging_component_prices(payload)
    if name == "packaging-component-price-versions" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_packaging_component_price_versions(payload)
    if name == "verpakkingsonderdelen" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_verpakkingsonderdelen(payload)
    if name == "base-product-masters" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_basisproducten(payload)
    if name == "composite-product-masters" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_samengestelde_producten(payload)
    if name == "basisproducten" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_basisproducten(payload)
    if name == "samengestelde-producten" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_samengestelde_producten(payload)
    if name in MODEL_A_DATASET_NAMES:
        canonical_payload = build_model_a_canonical_datasets().get(name, DATASET_DEFAULTS[name])
        return postgres_storage.save_dataset(name, canonical_payload, overwrite=True)
    if name in {"kostprijsversies", "berekeningen"} and isinstance(data, list):
        payload = [
            normalize_berekening_record(record)
            for record in data
            if isinstance(record, dict)
        ]
        return save_berekeningen(payload)
    if name == "kostprijsproductactiveringen" and isinstance(data, list):
        payload = [record for record in data if isinstance(record, dict)]
        return save_kostprijsproductactiveringen(payload)
    if name == "prijsvoorstellen" and isinstance(data, list):
        payload = [
            normalize_prijsvoorstel_record(record)
            for record in data
            if isinstance(record, dict)
        ]
        return save_prijsvoorstellen(payload)
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
        if dataset_name in READ_ONLY_PROJECTION_DATASETS:
            results[dataset_name] = True
            continue
        if dataset_name in MODEL_A_DATASET_NAMES:
            payload = canonical_payloads.get(dataset_name, DATASET_DEFAULTS[dataset_name])
        elif dataset_name == "packaging-components":
            payload = load_packaging_component_masters()
        elif dataset_name == "packaging-component-prices":
            payload = load_packaging_component_prices()
        elif dataset_name == "packaging-component-price-versions":
            payload = load_packaging_component_price_versions()
        elif dataset_name == "base-product-masters":
            payload = load_basisproducten()
        elif dataset_name == "composite-product-masters":
            payload = load_samengestelde_producten()
        elif dataset_name in {"kostprijsversies", "berekeningen"}:
            payload = load_kostprijsversies()
        elif dataset_name == "verpakkingsonderdelen":
            payload = build_verpakkingsonderdelen_legacy_projection()
        elif dataset_name == "basisproducten":
            payload = build_basisproducten_legacy_projection()
        elif dataset_name == "samengestelde-producten":
            payload = build_samengestelde_producten_legacy_projection()
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
        if dataset_name in READ_ONLY_PROJECTION_DATASETS:
            results[dataset_name] = True
            continue
        results[dataset_name] = postgres_storage.save_dataset(
            dataset_name,
            deepcopy(default_value),
            overwrite=True,
        )
    return results


def activate_cost_version(version_id: str) -> dict[str, Any] | None:
    require_postgres()
    return activate_kostprijsversie(version_id)


def activate_cost_version_products(
    version_id: str,
    product_ids: list[str],
) -> dict[str, Any] | None:
    require_postgres()
    return activate_kostprijsversie_products(version_id, product_ids)
