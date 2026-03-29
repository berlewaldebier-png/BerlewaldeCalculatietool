from __future__ import annotations

from typing import Any, Callable

from app.domain import legacy_storage, postgres_storage


JsonLoader = Callable[[], Any]
JsonSaver = Callable[[Any], bool]


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


DATASET_LOADERS: dict[str, JsonLoader] = {
    "productie": legacy_storage.load_productie_records,
    "vaste-kosten": legacy_storage.load_vaste_kosten,
    "tarieven-heffingen": legacy_storage.load_tarieven_heffingen,
    "verpakkingsonderdelen": legacy_storage.load_verpakkingsonderdelen,
    "basisproducten": legacy_storage.load_basisproducten,
    "samengestelde-producten": legacy_storage.load_samengestelde_producten,
    "bieren": legacy_storage.load_bieren,
    "berekeningen": legacy_storage.load_berekeningen,
    "prijsvoorstellen": legacy_storage.load_prijsvoorstellen,
    "verkoopprijzen": legacy_storage.load_verkoopprijzen,
    "variabele-kosten": legacy_storage.load_variabele_kosten,
}


DATASET_SAVERS: dict[str, JsonSaver] = {
    "productie": legacy_storage.save_productie_records,
    "vaste-kosten": legacy_storage.save_vaste_kosten,
    "tarieven-heffingen": legacy_storage.save_tarieven_heffingen,
    "verpakkingsonderdelen": legacy_storage.save_verpakkingsonderdelen,
    "basisproducten": legacy_storage.save_basisproducten,
    "samengestelde-producten": legacy_storage.save_samengestelde_producten,
    "bieren": legacy_storage.save_bieren,
    "berekeningen": legacy_storage.save_berekeningen,
    "prijsvoorstellen": legacy_storage.save_prijsvoorstellen,
    "verkoopprijzen": legacy_storage.save_verkoopprijzen,
    "variabele-kosten": legacy_storage.save_variabele_kosten,
}


def get_dataset_names() -> list[str]:
    return list(DATASET_DEFAULTS.keys())


def get_storage_provider() -> str:
    return postgres_storage.storage_provider()


def load_dataset(name: str) -> Any:
    default_value = DATASET_DEFAULTS[name]
    if postgres_storage.uses_postgres():
        return postgres_storage.load_dataset(name, default_value)
    return DATASET_LOADERS[name]()


def save_dataset(name: str, data: Any) -> bool:
    if postgres_storage.uses_postgres():
        return postgres_storage.save_dataset(name, data)
    return bool(DATASET_SAVERS[name](data))


def bootstrap_postgres_from_json(overwrite: bool = False) -> dict[str, bool]:
    results: dict[str, bool] = {}
    for dataset_name in get_dataset_names():
        payload = DATASET_LOADERS[dataset_name]()
        results[dataset_name] = postgres_storage.save_dataset(
            dataset_name,
            payload,
            overwrite=overwrite,
        )
    return results
