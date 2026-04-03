from __future__ import annotations

import os
import sys
import time
from threading import Lock

from app.config import PROJECT_ROOT


if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.domain import postgres_storage  # noqa: E402
from utils import storage  # noqa: E402

_DASHBOARD_CACHE_LOCK = Lock()
_DASHBOARD_CACHE: dict[str, object] = {
    "value": None,
    "expires_at": 0.0,
}


def _dashboard_summary_ttl_seconds() -> float:
    raw_value = str(os.getenv("CALCULATIETOOL_DASHBOARD_SUMMARY_TTL_SECONDS", "5") or "5")
    try:
        ttl = float(raw_value)
    except ValueError:
        ttl = 5.0
    return max(0.0, ttl)


def _load_status_counts(dataset_name: str) -> tuple[int, int]:
    """Reads raw dataset rows for fast dashboard counters."""
    raw = storage._load_postgres_dataset(dataset_name)  # type: ignore[attr-defined]
    if not isinstance(raw, list):
        return (0, 0)
    concept = 0
    definitief = 0
    for record in raw:
        if not isinstance(record, dict):
            continue
        status = str(record.get("status", "") or "")
        if status == "concept":
            concept += 1
        elif status == "definitief":
            definitief += 1
    return (concept, definitief)


def load_dashboard_summary() -> dict[str, int]:
    now = time.monotonic()
    with _DASHBOARD_CACHE_LOCK:
        cached_value = _DASHBOARD_CACHE.get("value")
        expires_at = float(_DASHBOARD_CACHE.get("expires_at", 0.0) or 0.0)
        if isinstance(cached_value, dict) and expires_at > now:
            return dict(cached_value)

    concept_berekeningen, definitieve_berekeningen = _load_status_counts("kostprijsversies")
    concept_prijsvoorstellen, definitieve_prijsvoorstellen = _load_status_counts("prijsvoorstellen")

    summary = {
        "concept_berekeningen": concept_berekeningen,
        "definitieve_berekeningen": definitieve_berekeningen,
        "concept_prijsvoorstellen": concept_prijsvoorstellen,
        "definitieve_prijsvoorstellen": definitieve_prijsvoorstellen,
    }
    with _DASHBOARD_CACHE_LOCK:
        _DASHBOARD_CACHE["value"] = dict(summary)
        _DASHBOARD_CACHE["expires_at"] = time.monotonic() + _dashboard_summary_ttl_seconds()
    return summary


def load_kostprijs_beheer_bootstrap() -> dict[str, object]:
    return {
        "berekeningen": storage.load_kostprijsversies(),
        "basisproducten": storage.load_basisproducten(),
        "samengestelde_producten": storage.load_samengestelde_producten(),
        "productie": storage.load_productiegegevens(),
        "vaste_kosten": storage.load_vaste_kosten_data(),
        "tarieven_heffingen": storage.load_tarieven_heffingen(),
    }


def load_verkoopstrategie_bootstrap() -> dict[str, object]:
    channels = postgres_storage.load_dataset("channels", [])
    return {
        "verkoopprijzen": storage.load_verkoopprijzen(),
        "basisproducten": storage.load_basisproducten(),
        "samengestelde_producten": storage.load_samengestelde_producten(),
        "bieren": storage.load_bieren(),
        "berekeningen": storage.load_kostprijsversies(),
        "channels": channels if isinstance(channels, list) else [],
        "kostprijsproductactiveringen": storage.load_kostprijsproductactiveringen(),
    }


def load_prijsvoorstel_bootstrap() -> dict[str, object]:
    channels = postgres_storage.load_dataset("channels", [])
    return {
        "prijsvoorstellen": storage.load_prijsvoorstellen(),
        "productie": storage.load_productiegegevens(),
        "bieren": storage.load_bieren(),
        "berekeningen": storage.load_kostprijsversies(),
        "verkoopprijzen": storage.load_verkoopprijzen(),
        "channels": channels if isinstance(channels, list) else [],
        "kostprijsproductactiveringen": storage.load_kostprijsproductactiveringen(),
        "basisproducten": storage.load_basisproducten(),
        "samengestelde_producten": storage.load_samengestelde_producten(),
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


def load_all_verkoop_records() -> list[dict]:
    return storage.load_all_verkoop_records()


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
        "verkoopprijzen": load_all_verkoop_records,
        "variabele-kosten": load_variabele_kosten,
    }
    return mapping[name]()
