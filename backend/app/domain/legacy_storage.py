from __future__ import annotations

import sys

from app.config import PROJECT_ROOT


if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils import storage  # noqa: E402


def load_dashboard_summary() -> dict[str, int]:
    return {
        "concept_berekeningen": len(storage.get_concept_berekeningen()),
        "definitieve_berekeningen": len(storage.get_definitieve_berekeningen()),
        "concept_prijsvoorstellen": len(storage.get_concept_prijsvoorstellen()),
        "definitieve_prijsvoorstellen": len(storage.get_definitieve_prijsvoorstellen()),
    }


def load_productie_records() -> dict:
    return storage.load_productiegegevens()


def load_vaste_kosten() -> dict:
    return storage.load_vaste_kosten_data()


def load_tarieven_heffingen() -> list[dict]:
    return storage.load_tarieven_heffingen()


def load_verpakkingsonderdelen() -> list[dict]:
    return storage.load_verpakkingsonderdelen()


def load_basisproducten() -> list[dict]:
    return storage.load_basisproducten()


def load_samengestelde_producten() -> list[dict]:
    return storage.load_samengestelde_producten()


def load_bieren() -> list[dict]:
    return storage.load_bieren()


def load_berekeningen() -> list[dict]:
    return storage.load_berekeningen()


def load_prijsvoorstellen() -> list[dict]:
    return storage.load_prijsvoorstellen()


def load_verkoopprijzen() -> list[dict]:
    return storage.load_verkoopprijzen()


def load_variabele_kosten() -> dict:
    return storage.load_variabele_kosten_data()


def save_productie_records(data: dict) -> bool:
    return storage.save_productiegegevens(data)


def save_vaste_kosten(data: dict) -> bool:
    return storage.save_vaste_kosten_data(data)


def save_tarieven_heffingen(data: list[dict]) -> bool:
    return storage.save_tarieven_heffingen(data)


def save_verpakkingsonderdelen(data: list[dict]) -> bool:
    return storage.save_verpakkingsonderdelen(data)


def save_basisproducten(data: list[dict]) -> bool:
    return storage.save_basisproducten(data)


def save_samengestelde_producten(data: list[dict]) -> bool:
    return storage.save_samengestelde_producten(data)


def save_bieren(data: list[dict]) -> bool:
    return storage.save_bieren(data)


def save_berekeningen(data: list[dict]) -> bool:
    return storage.save_berekeningen(data)


def save_prijsvoorstellen(data: list[dict]) -> bool:
    return storage.save_prijsvoorstellen(data)


def save_verkoopprijzen(data: list[dict]) -> bool:
    return storage.save_verkoopprijzen(data)


def save_variabele_kosten(data: dict) -> bool:
    return storage.save_variabele_kosten_data(data)


def load_dataset_from_json(name: str):
    mapping = {
        "productie": load_productie_records,
        "vaste-kosten": load_vaste_kosten,
        "tarieven-heffingen": load_tarieven_heffingen,
        "verpakkingsonderdelen": load_verpakkingsonderdelen,
        "basisproducten": load_basisproducten,
        "samengestelde-producten": load_samengestelde_producten,
        "bieren": load_bieren,
        "berekeningen": load_berekeningen,
        "prijsvoorstellen": load_prijsvoorstellen,
        "verkoopprijzen": load_verkoopprijzen,
        "variabele-kosten": load_variabele_kosten,
    }
    return mapping[name]()
