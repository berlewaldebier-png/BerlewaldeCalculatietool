from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal


SeedProfile = Literal["demo_foundation", "demo_full"]


def _repo_root() -> Path:
    # This file lives at: <repo>/backend/app/utils/seed_bundles.py
    # parents: utils -> app -> backend -> <repo>
    return Path(__file__).resolve().parents[3]


SEEDS_DIR = _repo_root() / "seeds"

PROFILE_FILES: dict[str, str] = {
    "demo_foundation": "demo_foundation.seed.json",
    "demo_full": "demo_full.seed.json",
}


def seed_path(profile: SeedProfile) -> Path:
    filename = PROFILE_FILES.get(str(profile))
    if not filename:
        raise KeyError(f"Onbekend seed-profiel: {profile}")
    return SEEDS_DIR / filename


def read_seed_bundle(profile: SeedProfile) -> dict[str, Any]:
    path = seed_path(profile)
    raw = path.read_text(encoding="utf-8-sig")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("Seed bundle is ongeldig: verwacht JSON object.")
    if int(parsed.get("version", 0) or 0) != 1:
        raise ValueError("Seed bundle versie wordt niet ondersteund.")
    datasets = parsed.get("datasets")
    if not isinstance(datasets, dict):
        raise ValueError("Seed bundle is ongeldig: datasets ontbreekt of is geen object.")
    return parsed


def write_seed_bundle(profile: SeedProfile, bundle: dict[str, Any]) -> Path:
    path = seed_path(profile)
    SEEDS_DIR.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(bundle, ensure_ascii=True, sort_keys=True, indent=2)
    path.write_text(payload + "\n", encoding="utf-8")
    return path

