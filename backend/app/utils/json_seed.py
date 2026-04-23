from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    # This file lives at: <repo>/backend/app/utils/json_seed.py
    # parents: utils -> app -> backend -> <repo>
    return Path(__file__).resolve().parents[3]


DATA_DIR = _repo_root() / "data"

DATASET_FILES: dict[str, str] = {
    "productie": "productie.json",
    "vaste-kosten": "vaste_kosten.json",
    "tarieven-heffingen": "tarieven_heffingen.json",
    "verpakkingsonderdelen": "verpakkingsonderdelen.json",
    "basisproducten": "basisproducten.json",
    "samengestelde-producten": "samengestelde_producten.json",
    "bieren": "bieren.json",
    "berekeningen": "berekeningen.json",
    "kostprijsversies": "kostprijsversies.json",
    "kostprijsproductactiveringen": "kostprijsproductactiveringen.json",
    "verkoopprijzen": "verkoopprijzen.json",
    "prijsvoorstellen": "prijsvoorstellen.json",
    "break-even-configuraties": "break_even_configuraties.json",
    "variabele-kosten": "variabele_kosten.json",
    "catalog-products": "catalog_products.json",
}

DATASET_DEFAULTS: dict[str, Any] = {
    "productie": {},
    "vaste-kosten": {},
    "tarieven-heffingen": [],
    "verpakkingsonderdelen": [],
    "basisproducten": [],
    "samengestelde-producten": [],
    "bieren": [],
    "berekeningen": [],
    "kostprijsversies": [],
    "kostprijsproductactiveringen": [],
    "verkoopprijzen": [],
    "prijsvoorstellen": [],
    "break-even-configuraties": [],
    "variabele-kosten": {},
    "catalog-products": [],
}


def has_dataset(name: str) -> bool:
    return name in DATASET_FILES


def load_dataset(name: str) -> Any:
    """Load a dataset from the repo `data/` directory.

    This is intended for one-time bootstrap/import flows only. Runtime storage is Postgres-only.
    """
    if name not in DATASET_FILES:
        raise KeyError(f"Onbekende seed dataset: {name}")

    path = DATA_DIR / DATASET_FILES[name]
    default = DATASET_DEFAULTS.get(name)
    if default is None:
        default = []

    try:
        raw = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        # Seed files are optional in some environments; fall back to an empty structure.
        return default

    raw = (raw or "").strip()
    if not raw:
        return default

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return default

    # Keep types stable.
    if isinstance(default, dict):
        return parsed if isinstance(parsed, dict) else default
    if isinstance(default, list):
        return parsed if isinstance(parsed, list) else default
    return parsed
