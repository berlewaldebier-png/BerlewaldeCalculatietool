from __future__ import annotations

from copy import deepcopy
from typing import Any
from uuid import uuid4

import streamlit as st

from pages.nieuwe_berekening.state import build_resultaat_snapshot
from utils.storage import (
    add_or_update_berekening,
    duplicate_productie_to_year,
    duplicate_tarieven_heffingen_to_year,
    duplicate_vaste_kosten_to_year,
    duplicate_verkoopstrategie_verpakkingen_to_year,
    duplicate_verpakkingsonderdelen_to_year,
    get_definitieve_berekeningen,
    get_productie_record,
    get_tarieven_heffingen_for_year,
    get_vaste_kosten_for_year,
    get_verpakkingsonderdelen_for_year,
    get_verkoopstrategie_verpakkingen_for_year,
    get_productie_years,
    load_berekeningen,
    load_tarieven_heffingen,
    load_vaste_kosten_data,
    load_verkoopstrategie_verpakkingen,
    load_verpakkingsonderdelen,
    upsert_productie_record,
)


STEP_LABELS = [
    "Basis",
    "Jaarset",
    "Berekeningen",
    "Controle",
    "Afronden",
]
STATE_KEY = "nieuw_jaar_state"
STEP_KEY = "nieuw_jaar_step"
FEEDBACK_KEY = "nieuw_jaar_feedback"


def format_euro(amount: float | int | None) -> str:
    value = float(amount or 0.0)
    formatted = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"EUR {formatted}"


def _empty_productie_record(source_year: int | None = None) -> dict[str, float]:
    source = get_productie_record(source_year) if source_year else None
    batchgrootte = float((source or {}).get("batchgrootte_eigen_productie_l", 0.0) or 0.0)
    return {
        "hoeveelheid_inkoop_l": 0.0,
        "hoeveelheid_productie_l": 0.0,
        "batchgrootte_eigen_productie_l": batchgrootte,
    }


def _default_state() -> dict[str, Any]:
    years = source_year_options()
    source_year = years[-1] if years else None
    target_year = (source_year + 1) if source_year else None
    return {
        "source_year": source_year,
        "target_year": target_year,
        "copy_productie": True,
        "copy_vaste_kosten": True,
        "copy_tarieven": True,
        "copy_verpakkingsonderdelen": True,
        "copy_verkoopstrategie": True,
        "copy_berekeningen": True,
        "overwrite_existing": False,
    }


def init_page_state() -> dict[str, Any]:
    if STATE_KEY not in st.session_state:
        st.session_state[STATE_KEY] = _default_state()
    if STEP_KEY not in st.session_state:
        st.session_state[STEP_KEY] = 0
    return st.session_state[STATE_KEY]


def set_feedback(message: str, level: str = "success") -> None:
    st.session_state[FEEDBACK_KEY] = {"message": message, "level": level}


def render_feedback() -> None:
    feedback = st.session_state.get(FEEDBACK_KEY)
    if not isinstance(feedback, dict):
        return
    message = str(feedback.get("message", "") or "")
    level = str(feedback.get("level", "info") or "info")
    if not message:
        return
    getattr(st, level if level in {"success", "info", "warning", "error"} else "info")(message)


def source_year_options() -> list[int]:
    years: set[int] = set(get_productie_years())
    years.update(
        int(record.get("basisgegevens", {}).get("jaar", 0) or 0)
        for record in get_definitieve_berekeningen()
        if int(record.get("basisgegevens", {}).get("jaar", 0) or 0) > 0
    )
    years.update(
        int(record.get("jaar", 0) or 0)
        for record in load_tarieven_heffingen()
        if int(record.get("jaar", 0) or 0) > 0
    )
    years.update(
        int(record.get("jaar", 0) or 0)
        for record in load_verpakkingsonderdelen()
        if int(record.get("jaar", 0) or 0) > 0
    )
    years.update(
        int(record.get("jaar", 0) or 0)
        for record in load_verkoopstrategie_verpakkingen()
        if int(record.get("jaar", 0) or 0) > 0
    )
    years.update(
        int(year)
        for year in load_vaste_kosten_data().keys()
        if str(year).isdigit() and int(year) > 0
    )
    return sorted(years)


def record_group_key(record: dict[str, Any]) -> str:
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    calculation_type = str(record.get("soort_berekening", {}).get("type", "") or "")
    bier_id = str(record.get("bier_id", "") or "")
    if bier_id:
        return f"{bier_id}|{calculation_type}"
    return "|".join(
        [
            str(basisgegevens.get("biernaam", "") or ""),
            str(basisgegevens.get("stijl", "") or ""),
            calculation_type,
        ]
    )


def clone_berekening_for_year(source_record: dict[str, Any], target_year: int) -> dict[str, Any]:
    cloned = deepcopy(source_record)
    basisgegevens = cloned.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    basisgegevens["jaar"] = target_year
    cloned["basisgegevens"] = basisgegevens
    cloned["id"] = str(uuid4())
    cloned["status"] = "concept"
    cloned["finalized_at"] = ""
    cloned["last_completed_step"] = 4
    cloned["jaarovergang"] = {
        "bron_berekening_id": str(source_record.get("id", "") or ""),
        "bron_jaar": int(source_record.get("basisgegevens", {}).get("jaar", 0) or 0),
        "doel_jaar": target_year,
        "aangemaakt_via": "nieuw_jaar_voorbereiden",
    }
    cloned["resultaat_snapshot"] = build_resultaat_snapshot(cloned)
    return cloned


def build_plan(state: dict[str, Any]) -> dict[str, Any]:
    source_year = int(state.get("source_year", 0) or 0)
    target_year = int(state.get("target_year", 0) or 0)
    source_records = [
        record
        for record in get_definitieve_berekeningen()
        if int(record.get("basisgegevens", {}).get("jaar", 0) or 0) == source_year
    ]
    source_records.sort(
        key=lambda item: (
            str(item.get("basisgegevens", {}).get("biernaam", "") or "").lower(),
            str(item.get("soort_berekening", {}).get("type", "") or ""),
        )
    )
    target_records = [
        record
        for record in load_berekeningen()
        if int(record.get("basisgegevens", {}).get("jaar", 0) or 0) == target_year
    ]
    target_record_map = {record_group_key(record): record for record in target_records}

    steps = [
        {
            "label": "Productie",
            "copy": bool(state.get("copy_productie", True)),
            "source_exists": get_productie_record(source_year) is not None,
            "target_exists": get_productie_record(target_year) is not None,
        },
        {
            "label": "Vaste kosten",
            "copy": bool(state.get("copy_vaste_kosten", True)),
            "source_exists": len(get_vaste_kosten_for_year(source_year)) > 0,
            "target_exists": len(get_vaste_kosten_for_year(target_year)) > 0,
        },
        {
            "label": "Tarieven en heffingen",
            "copy": bool(state.get("copy_tarieven", True)),
            "source_exists": get_tarieven_heffingen_for_year(source_year) is not None,
            "target_exists": get_tarieven_heffingen_for_year(target_year) is not None,
        },
        {
            "label": "Verpakkingsonderdelen",
            "copy": bool(state.get("copy_verpakkingsonderdelen", True)),
            "source_exists": len(get_verpakkingsonderdelen_for_year(source_year)) > 0,
            "target_exists": len(get_verpakkingsonderdelen_for_year(target_year)) > 0,
        },
        {
            "label": "Verkoopstrategie",
            "copy": bool(state.get("copy_verkoopstrategie", True)),
            "source_exists": len(get_verkoopstrategie_verpakkingen_for_year(source_year)) > 0,
            "target_exists": len(get_verkoopstrategie_verpakkingen_for_year(target_year)) > 0,
        },
    ]

    berekening_rows: list[dict[str, Any]] = []
    for record in source_records:
        basisgegevens = record.get("basisgegevens", {})
        if not isinstance(basisgegevens, dict):
            basisgegevens = {}
        key = record_group_key(record)
        existing_target = target_record_map.get(key)
        bron_snapshot = record.get("resultaat_snapshot", {})
        if not isinstance(bron_snapshot, dict):
            bron_snapshot = {}
        bron_kostprijs = float(
            bron_snapshot.get("integrale_kostprijs_per_liter", 0.0)
            or bron_snapshot.get("variabele_kosten_per_liter", 0.0)
            or 0.0
        )
        generated_record = None if existing_target else clone_berekening_for_year(record, target_year)
        nieuwe_kostprijs = None
        if isinstance(generated_record, dict):
            generated_snapshot = generated_record.get("resultaat_snapshot", {})
            if not isinstance(generated_snapshot, dict):
                generated_snapshot = {}
            nieuwe_kostprijs = float(
                generated_snapshot.get("integrale_kostprijs_per_liter", 0.0)
                or generated_snapshot.get("variabele_kosten_per_liter", 0.0)
                or 0.0
            )
        berekening_rows.append(
            {
                "biernaam": str(basisgegevens.get("biernaam", "") or "-"),
                "stijl": str(basisgegevens.get("stijl", "") or "-"),
                "soort": str(record.get("soort_berekening", {}).get("type", "") or "-"),
                "bron_kostprijs": bron_kostprijs,
                "nieuwe_kostprijs": nieuwe_kostprijs,
                "generated_record": generated_record,
                "exists_in_target": existing_target is not None,
            }
        )

    return {
        "source_year": source_year,
        "target_year": target_year,
        "steps": steps,
        "source_records": source_records,
        "berekening_rows": berekening_rows,
        "source_record_count": len(source_records),
        "ready_record_count": len(
            [row for row in berekening_rows if row.get("generated_record") is not None]
        ),
    }


def can_go_next() -> bool:
    current_step = int(st.session_state.get(STEP_KEY, 0))
    if current_step != 0:
        return True
    state = st.session_state.get(STATE_KEY, {})
    if not isinstance(state, dict):
        return True
    source_year = int(state.get("source_year", 0) or 0)
    target_year = int(state.get("target_year", 0) or 0)
    return source_year > 0 and target_year > source_year


def run_generation(state: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    source_year = plan["source_year"]
    target_year = plan["target_year"]
    overwrite = bool(state.get("overwrite_existing", False))
    result = {
        "productie": False,
        "vaste_kosten": 0,
        "tarieven": False,
        "verpakkingsonderdelen": 0,
        "verkoopstrategie": 0,
        "berekeningen": 0,
        "open_actions": [],
    }

    if state.get("copy_productie", True):
        result["productie"] = duplicate_productie_to_year(
            source_year,
            target_year,
            overwrite=overwrite,
        )
    elif get_productie_record(target_year) is None:
        result["productie"] = upsert_productie_record(
            target_year,
            _empty_productie_record(source_year),
        )
        result["open_actions"].append(f"Vul Productie {target_year} handmatig aan.")

    if state.get("copy_vaste_kosten", True):
        result["vaste_kosten"] = duplicate_vaste_kosten_to_year(
            source_year,
            target_year,
            overwrite=overwrite,
        )
    else:
        result["open_actions"].append(f"Voeg vaste kosten voor {target_year} handmatig toe.")

    if state.get("copy_tarieven", True):
        result["tarieven"] = duplicate_tarieven_heffingen_to_year(
            source_year,
            target_year,
            overwrite=overwrite,
        )
    else:
        result["open_actions"].append(f"Controleer tarieven en heffingen voor {target_year}.")

    if state.get("copy_verpakkingsonderdelen", True):
        result["verpakkingsonderdelen"] = duplicate_verpakkingsonderdelen_to_year(
            source_year,
            target_year,
            overwrite=overwrite,
        )
    else:
        result["open_actions"].append(f"Vul verpakkingsonderdelen voor {target_year} handmatig aan.")

    if state.get("copy_verkoopstrategie", True):
        result["verkoopstrategie"] = duplicate_verkoopstrategie_verpakkingen_to_year(
            source_year,
            target_year,
            overwrite=overwrite,
        )
    else:
        result["open_actions"].append(f"Controleer verkoopstrategie voor {target_year}.")

    if state.get("copy_berekeningen", True):
        for row in plan["berekening_rows"]:
            generated_record = row.get("generated_record")
            if not isinstance(generated_record, dict):
                continue
            if add_or_update_berekening(generated_record):
                result["berekeningen"] += 1
        if result["berekeningen"] == 0 and plan["source_record_count"] > 0:
            result["open_actions"].append(f"Controleer conceptberekeningen voor {target_year}.")

    return result
