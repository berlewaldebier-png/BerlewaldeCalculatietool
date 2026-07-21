from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable, Mapping, Sequence


GenericRecord = Mapping[str, Any]


def text(value: Any) -> str:
    return str(value or "").strip()


def number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def year(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def lot_exact_key(value: Any) -> str:
    return "".join(character for character in text(value).upper() if character.isalnum())


def lot_near_key(value: Any) -> str:
    return lot_exact_key(value).replace("O", "0")


def moment(row: GenericRecord) -> tuple[float, str]:
    raw = text(row.get("effectief_vanaf") or row.get("created_at"))
    if not raw:
        return 0.0, text(row.get("id"))
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        parsed = 0.0
    return parsed, text(row.get("id"))


def dedupe(values: Iterable[str]) -> tuple[str, ...]:
    return tuple(sorted({text(value) for value in values if text(value)}))


def record_metadata(row: GenericRecord) -> GenericRecord:
    value = row.get("metadata")
    return value if isinstance(value, Mapping) else {}


def version_lot_keys(version: GenericRecord) -> set[str]:
    keys: set[str] = set()
    direct = lot_exact_key(version.get("lot_exact_key"))
    if direct:
        keys.add(direct)
    lot_field_names = {
        "lotnummer",
        "lotnumber",
        "lot",
        "batchnummer",
        "batchnumber",
        "batch",
    }

    def collect(value: Any) -> None:
        if isinstance(value, Mapping):
            for key, child in value.items():
                normalized_key = "".join(
                    character for character in text(key).lower() if character.isalnum()
                )
                if normalized_key in lot_field_names:
                    key_value = lot_exact_key(child)
                    if key_value:
                        keys.add(key_value)
                else:
                    collect(child)
        elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
            for child in value:
                collect(child)

    collect(version)
    return keys
