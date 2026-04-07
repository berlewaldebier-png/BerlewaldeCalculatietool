from __future__ import annotations

from app.utils import json_seed


def load_dashboard_summary() -> dict[str, int]:
    # Only used for legacy import flows; keep a minimal, deterministic summary.
    berekeningen = json_seed.load_dataset("berekeningen")
    prijsvoorstellen = json_seed.load_dataset("prijsvoorstellen")
    concept_berekeningen = len([r for r in berekeningen if isinstance(r, dict) and str(r.get("status", "") or "") == "concept"]) if isinstance(berekeningen, list) else 0
    definitieve_berekeningen = len([r for r in berekeningen if isinstance(r, dict) and str(r.get("status", "") or "") == "definitief"]) if isinstance(berekeningen, list) else 0
    concept_prijsvoorstellen = len([r for r in prijsvoorstellen if isinstance(r, dict) and str(r.get("status", "") or "") == "concept"]) if isinstance(prijsvoorstellen, list) else 0
    definitieve_prijsvoorstellen = len([r for r in prijsvoorstellen if isinstance(r, dict) and str(r.get("status", "") or "") == "definitief"]) if isinstance(prijsvoorstellen, list) else 0
    return {
        "concept_berekeningen": concept_berekeningen,
        "definitieve_berekeningen": definitieve_berekeningen,
        "concept_prijsvoorstellen": concept_prijsvoorstellen,
        "definitieve_prijsvoorstellen": definitieve_prijsvoorstellen,
    }


def load_productie_records() -> dict:
    value = json_seed.load_dataset("productie")
    return value if isinstance(value, dict) else {}


def load_vaste_kosten() -> dict:
    value = json_seed.load_dataset("vaste-kosten")
    return value if isinstance(value, dict) else {}


def load_tarieven_heffingen() -> list[dict]:
    value = json_seed.load_dataset("tarieven-heffingen")
    return value if isinstance(value, list) else []


def load_verpakkingsonderdelen() -> list[dict]:
    value = json_seed.load_dataset("verpakkingsonderdelen")
    return value if isinstance(value, list) else []


def load_basisproducten() -> list[dict]:
    value = json_seed.load_dataset("basisproducten")
    return value if isinstance(value, list) else []


def load_samengestelde_producten() -> list[dict]:
    value = json_seed.load_dataset("samengestelde-producten")
    return value if isinstance(value, list) else []


def load_bieren() -> list[dict]:
    value = json_seed.load_dataset("bieren")
    return value if isinstance(value, list) else []


def load_berekeningen() -> list[dict]:
    value = json_seed.load_dataset("berekeningen")
    return value if isinstance(value, list) else []


def load_prijsvoorstellen() -> list[dict]:
    value = json_seed.load_dataset("prijsvoorstellen")
    return value if isinstance(value, list) else []


def load_verkoopprijzen() -> list[dict]:
    value = json_seed.load_dataset("verkoopprijzen")
    return value if isinstance(value, list) else []


def load_all_verkoop_records() -> list[dict]:
    value = json_seed.load_dataset("verkoopprijzen")
    return value if isinstance(value, list) else []


def load_variabele_kosten() -> dict:
    value = json_seed.load_dataset("variabele-kosten")
    return value if isinstance(value, dict) else {}


def save_productie_records(data: dict) -> bool:
    raise RuntimeError("Legacy JSON write is disabled. Use PostgreSQL runtime storage.")


def save_vaste_kosten(data: dict) -> bool:
    raise RuntimeError("Legacy JSON write is disabled. Use PostgreSQL runtime storage.")


def save_tarieven_heffingen(data: list[dict]) -> bool:
    raise RuntimeError("Legacy JSON write is disabled. Use PostgreSQL runtime storage.")


def save_verpakkingsonderdelen(data: list[dict]) -> bool:
    raise RuntimeError("Legacy JSON write is disabled. Use PostgreSQL runtime storage.")


def save_basisproducten(data: list[dict]) -> bool:
    raise RuntimeError("Legacy JSON write is disabled. Use PostgreSQL runtime storage.")


def save_samengestelde_producten(data: list[dict]) -> bool:
    raise RuntimeError("Legacy JSON write is disabled. Use PostgreSQL runtime storage.")


def save_bieren(data: list[dict]) -> bool:
    raise RuntimeError("Legacy JSON write is disabled. Use PostgreSQL runtime storage.")


def save_berekeningen(data: list[dict]) -> bool:
    raise RuntimeError("Legacy JSON write is disabled. Use PostgreSQL runtime storage.")


def save_prijsvoorstellen(data: list[dict]) -> bool:
    raise RuntimeError("Legacy JSON write is disabled. Use PostgreSQL runtime storage.")


def save_verkoopprijzen(data: list[dict]) -> bool:
    raise RuntimeError("Legacy JSON write is disabled. Use PostgreSQL runtime storage.")


def save_variabele_kosten(data: dict) -> bool:
    raise RuntimeError("Legacy JSON write is disabled. Use PostgreSQL runtime storage.")


def load_dataset_from_json(name: str):
    return json_seed.load_dataset(name)
