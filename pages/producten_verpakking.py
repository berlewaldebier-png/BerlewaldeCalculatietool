from __future__ import annotations

from typing import Any, Callable
from uuid import uuid4

import streamlit as st

from components.action_buttons import (
    render_delete_button,
    render_edit_button,
    render_save_button,
)
from components.breadcrumb import render_breadcrumb
from components.page_ui import render_page_header
from components.table_ui import render_read_only_table_cell, render_table_headers
from utils.storage import (
    SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX,
    add_basisproduct,
    add_samengesteld_product,
    add_verpakkingsonderdeel,
    bereken_basisproduct_regel_kosten,
    bereken_basisproduct_totaal,
    bereken_samengesteld_product_totaal_inhoud,
    bereken_samengesteld_product_totaal_verpakkingskosten,
    delete_basisproduct,
    delete_samengesteld_product,
    delete_verpakkingsonderdeel,
    get_beschikbare_basisproducten,
    get_basisproduct_by_id,
    get_productie_years,
    get_samengesteld_product_by_id,
    get_verpakkingsonderdelen_for_year,
    get_verpakkingsonderdeel_by_id,
    init_basisproducten_file,
    init_samengestelde_producten_file,
    init_verpakkingsonderdelen_file,
    load_basisproducten,
    load_basisproducten_for_year,
    load_samengestelde_producten,
    load_samengestelde_producten_for_year,
    load_verpakkingsonderdelen,
    update_basisproduct,
    update_samengesteld_product,
    update_verpakkingsonderdeel,
)


MODE_IDLE = "idle"
MODE_ADD = "add"
MODE_EDIT = "edit"


def _format_euro(amount: float | int | None) -> str:
    value = float(amount or 0.0)
    formatted = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"\u20ac {formatted}"


def _init_page_state() -> None:
    beschikbare_jaren = get_productie_years()
    default_year = beschikbare_jaren[-1] if beschikbare_jaren else None
    defaults = {
        "producten_verpakking_selected_year": default_year,
        "producten_verpakking_active_year": default_year,
        "verpakkingsonderdelen_confirm_delete_id": None,
        "verpakkingsonderdelen_edit_row_id": "",
        "verpakkingsonderdelen_feedback": None,
        "verpakkingsonderdelen_adding_row": False,
        "basisproducten_mode": MODE_IDLE,
        "basisproducten_selected_id": None,
        "basisproducten_confirm_delete_id": None,
        "basisproducten_confirm_remove_row_id": None,
        "basisproducten_feedback": None,
        "basisproduct_form_version": 0,
        "basisproduct_form_data": {
            "omschrijving": "",
            "inhoud_per_eenheid_liter": 0.0,
            "onderdelen": [],
        },
        "samengestelde_producten_mode": MODE_IDLE,
        "samengestelde_producten_selected_id": None,
        "samengestelde_producten_confirm_delete_id": None,
        "samengestelde_producten_confirm_remove_row_id": None,
        "samengestelde_producten_feedback": None,
        "samengesteld_product_form_version": 0,
        "samengesteld_product_form_data": {
            "omschrijving": "",
            "basisproducten": [],
        },
    }

    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def _get_selected_year() -> int | None:
    try:
        value = int(st.session_state.get("producten_verpakking_selected_year") or 0)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _reset_verpakkingsonderdelen_state() -> None:
    st.session_state["verpakkingsonderdelen_confirm_delete_id"] = None
    st.session_state["verpakkingsonderdelen_edit_row_id"] = ""
    st.session_state["verpakkingsonderdelen_adding_row"] = False


def _reset_basisproducten_state() -> None:
    st.session_state["basisproducten_mode"] = MODE_IDLE
    st.session_state["basisproducten_selected_id"] = None
    st.session_state["basisproducten_confirm_delete_id"] = None
    st.session_state["basisproducten_confirm_remove_row_id"] = None
    _set_basisproduct_form_data()
    _bump_basisproduct_form_version()


def _reset_samengestelde_producten_state() -> None:
    st.session_state["samengestelde_producten_mode"] = MODE_IDLE
    st.session_state["samengestelde_producten_selected_id"] = None
    st.session_state["samengestelde_producten_confirm_delete_id"] = None
    st.session_state["samengestelde_producten_confirm_remove_row_id"] = None
    _set_samengesteld_product_form_data()
    _bump_samengesteld_product_form_version()


def _handle_year_context_change(selected_year: int | None) -> None:
    previous_year = st.session_state.get("producten_verpakking_active_year")
    if previous_year == selected_year:
        return

    _reset_verpakkingsonderdelen_state()
    _reset_basisproducten_state()
    _reset_samengestelde_producten_state()
    st.session_state["producten_verpakking_active_year"] = selected_year


def _empty_basisproduct_row() -> dict[str, Any]:
    return {"row_id": str(uuid4()), "verpakkingsonderdeel_id": "", "hoeveelheid": 1.0}


def _empty_basisproduct_form_data() -> dict[str, Any]:
    return {
        "omschrijving": "",
        "inhoud_per_eenheid_liter": 0.0,
        "onderdelen": [_empty_basisproduct_row()],
    }


def _empty_samengesteld_product_row() -> dict[str, Any]:
    return {"row_id": str(uuid4()), "basisproduct_id": "", "aantal": 1.0}


def _empty_samengesteld_product_form_data() -> dict[str, Any]:
    return {"omschrijving": "", "basisproducten": [_empty_samengesteld_product_row()]}


def _set_basisproduct_form_data(
    omschrijving: str = "",
    inhoud_per_eenheid_liter: float = 0.0,
    onderdelen: list[dict[str, Any]] | None = None,
) -> None:
    rows = onderdelen if onderdelen is not None else [_empty_basisproduct_row()]
    normalized_rows: list[dict[str, Any]] = []

    for row in rows:
        normalized_rows.append(
            {
                "row_id": str(row.get("row_id") or uuid4()),
                "verpakkingsonderdeel_id": str(row.get("verpakkingsonderdeel_id", "") or ""),
                "hoeveelheid": float(row.get("hoeveelheid", 1.0) or 1.0),
            }
        )

    if not normalized_rows:
        normalized_rows = [_empty_basisproduct_row()]

    st.session_state["basisproduct_form_data"] = {
        "omschrijving": omschrijving,
        "inhoud_per_eenheid_liter": float(inhoud_per_eenheid_liter),
        "onderdelen": normalized_rows,
    }
    st.session_state["basisproducten_confirm_remove_row_id"] = None


def _set_samengesteld_product_form_data(
    omschrijving: str = "",
    basisproducten: list[dict[str, Any]] | None = None,
) -> None:
    rows = (
        basisproducten
        if basisproducten is not None
        else [_empty_samengesteld_product_row()]
    )
    normalized_rows: list[dict[str, Any]] = []

    for row in rows:
        normalized_rows.append(
            {
                "row_id": str(row.get("row_id") or uuid4()),
                "basisproduct_id": str(row.get("basisproduct_id", "") or ""),
                "aantal": float(row.get("aantal", 1.0) or 1.0),
            }
        )

    if not normalized_rows:
        normalized_rows = [_empty_samengesteld_product_row()]

    st.session_state["samengesteld_product_form_data"] = {
        "omschrijving": omschrijving,
        "basisproducten": normalized_rows,
    }
    st.session_state["samengestelde_producten_confirm_remove_row_id"] = None


def _bump_basisproduct_form_version() -> None:
    st.session_state["basisproduct_form_version"] = int(
        st.session_state.get("basisproduct_form_version", 0)
    ) + 1


def _bump_samengesteld_product_form_version() -> None:
    st.session_state["samengesteld_product_form_version"] = int(
        st.session_state.get("samengesteld_product_form_version", 0)
    ) + 1


def _get_basisproduct_widget_key(prefix: str, row_id: str | None = None) -> str:
    version = int(st.session_state.get("basisproduct_form_version", 0))
    if row_id is None:
        return f"basisproduct_{prefix}_{version}"
    return f"basisproduct_{prefix}_{row_id}_{version}"


def _get_samengesteld_product_widget_key(
    prefix: str,
    row_id: str | None = None,
) -> str:
    version = int(st.session_state.get("samengesteld_product_form_version", 0))
    if row_id is None:
        return f"samengesteld_product_{prefix}_{version}"
    return f"samengesteld_product_{prefix}_{row_id}_{version}"


def _ensure_basisproduct_form_widget_state() -> None:
    form_data = st.session_state.get("basisproduct_form_data", _empty_basisproduct_form_data())
    omschrijving_key = _get_basisproduct_widget_key("omschrijving")
    inhoud_key = _get_basisproduct_widget_key("inhoud")
    if omschrijving_key not in st.session_state:
        st.session_state[omschrijving_key] = str(form_data.get("omschrijving", ""))
    if inhoud_key not in st.session_state:
        st.session_state[inhoud_key] = float(
            form_data.get("inhoud_per_eenheid_liter", 0.0) or 0.0
        )

    for row in form_data.get("onderdelen", []):
        row_id = str(row.get("row_id") or uuid4())
        onderdeel_key = _get_basisproduct_widget_key("onderdeel", row_id)
        hoeveelheid_key = _get_basisproduct_widget_key("hoeveelheid", row_id)

        if onderdeel_key not in st.session_state:
            st.session_state[onderdeel_key] = str(row.get("verpakkingsonderdeel_id", "") or "")
        if hoeveelheid_key not in st.session_state:
            st.session_state[hoeveelheid_key] = float(row.get("hoeveelheid", 1.0) or 1.0)


def _ensure_samengesteld_product_form_widget_state() -> None:
    form_data = st.session_state.get(
        "samengesteld_product_form_data",
        _empty_samengesteld_product_form_data(),
    )
    omschrijving_key = _get_samengesteld_product_widget_key("omschrijving")
    if omschrijving_key not in st.session_state:
        st.session_state[omschrijving_key] = str(form_data.get("omschrijving", ""))

    for row in form_data.get("basisproducten", []):
        row_id = str(row.get("row_id") or uuid4())
        basisproduct_key = _get_samengesteld_product_widget_key("basisproduct", row_id)
        aantal_key = _get_samengesteld_product_widget_key("aantal", row_id)

        if basisproduct_key not in st.session_state:
            st.session_state[basisproduct_key] = str(row.get("basisproduct_id", "") or "")
        if aantal_key not in st.session_state:
            st.session_state[aantal_key] = float(row.get("aantal", 1.0) or 1.0)


def _start_basisproduct_add_mode() -> None:
    st.session_state["basisproducten_mode"] = MODE_ADD
    st.session_state["basisproducten_selected_id"] = None
    st.session_state["basisproducten_confirm_delete_id"] = None
    _set_basisproduct_form_data()
    _bump_basisproduct_form_version()


def _start_basisproduct_edit_mode(basisproduct_id: str) -> None:
    basisproduct = get_basisproduct_by_id(basisproduct_id, _get_selected_year())
    if not basisproduct:
        st.warning("Het geselecteerde basisproduct is niet gevonden.")
        return

    rows: list[dict[str, Any]] = []
    for onderdeel in basisproduct.get("onderdelen", []):
        rows.append(
            {
                "row_id": str(uuid4()),
                "verpakkingsonderdeel_id": str(onderdeel.get("verpakkingsonderdeel_id", "") or ""),
                "hoeveelheid": float(onderdeel.get("hoeveelheid", 1.0) or 1.0),
            }
        )

    st.session_state["basisproducten_mode"] = MODE_EDIT
    st.session_state["basisproducten_selected_id"] = basisproduct_id
    st.session_state["basisproducten_confirm_delete_id"] = None
    _set_basisproduct_form_data(
        omschrijving=str(basisproduct.get("omschrijving", "")),
        inhoud_per_eenheid_liter=float(
            basisproduct.get("inhoud_per_eenheid_liter", 0.0) or 0.0
        ),
        onderdelen=rows,
    )
    _bump_basisproduct_form_version()


def _cancel_basisproduct_form_mode() -> None:
    st.session_state["basisproducten_mode"] = MODE_IDLE
    st.session_state["basisproducten_selected_id"] = None
    st.session_state["basisproducten_confirm_delete_id"] = None
    _set_basisproduct_form_data()
    _bump_basisproduct_form_version()


def _start_samengesteld_product_add_mode() -> None:
    st.session_state["samengestelde_producten_mode"] = MODE_ADD
    st.session_state["samengestelde_producten_selected_id"] = None
    st.session_state["samengestelde_producten_confirm_delete_id"] = None
    _set_samengesteld_product_form_data()
    _bump_samengesteld_product_form_version()


def _start_samengesteld_product_edit_mode(samengesteld_product_id: str) -> None:
    samengesteld_product = get_samengesteld_product_by_id(
        samengesteld_product_id,
        _get_selected_year(),
    )
    if not samengesteld_product:
        st.warning("Het geselecteerde samengestelde product is niet gevonden.")
        return

    rows: list[dict[str, Any]] = []
    for basisproduct in samengesteld_product.get("basisproducten", []):
        rows.append(
            {
                "row_id": str(uuid4()),
                "basisproduct_id": str(basisproduct.get("basisproduct_id", "") or ""),
                "aantal": float(basisproduct.get("aantal", 1.0) or 1.0),
            }
        )

    st.session_state["samengestelde_producten_mode"] = MODE_EDIT
    st.session_state["samengestelde_producten_selected_id"] = samengesteld_product_id
    st.session_state["samengestelde_producten_confirm_delete_id"] = None
    _set_samengesteld_product_form_data(
        omschrijving=str(samengesteld_product.get("omschrijving", "")),
        basisproducten=rows,
    )
    _bump_samengesteld_product_form_version()


def _cancel_samengesteld_product_form_mode() -> None:
    st.session_state["samengestelde_producten_mode"] = MODE_IDLE
    st.session_state["samengestelde_producten_selected_id"] = None
    st.session_state["samengestelde_producten_confirm_delete_id"] = None
    _set_samengesteld_product_form_data()
    _bump_samengesteld_product_form_version()


def _set_feedback(state_key: str, message: str) -> None:
    st.session_state[state_key] = message


def _render_feedback(state_key: str) -> None:
    message = st.session_state.pop(state_key, None)
    if message:
        st.success(message)


def _validate_verpakkingsonderdeel_row(
    omschrijving: str,
    hoeveelheid: float,
    prijs_per_stuk: float,
) -> list[str]:
    errors: list[str] = []
    if not omschrijving.strip():
        errors.append("Omschrijving is verplicht.")
    if hoeveelheid <= 0:
        errors.append("Hoeveelheid moet groter zijn dan 0.")
    if prijs_per_stuk < 0:
        errors.append("Prijs per stuk mag niet negatief zijn.")
    return errors


def _ensure_verpakkingsonderdeel_widget_state(
    onderdeel_id: str,
    onderdeel: dict[str, Any],
) -> tuple[str, str, str, str]:
    omschrijving_key = f"verpakking_omschrijving_{onderdeel_id}"
    hoeveelheid_key = f"verpakking_hoeveelheid_{onderdeel_id}"
    prijs_key = f"verpakking_prijs_per_stuk_{onderdeel_id}"
    beschikbaar_key = f"verpakking_beschikbaar_samengesteld_{onderdeel_id}"
    st.session_state.setdefault(
        omschrijving_key,
        str(onderdeel.get("omschrijving", "") or ""),
    )
    st.session_state.setdefault(
        hoeveelheid_key,
        float(onderdeel.get("hoeveelheid", 0.0) or 0.0),
    )
    st.session_state.setdefault(
        prijs_key,
        float(onderdeel.get("prijs_per_stuk", 0.0) or 0.0),
    )
    st.session_state.setdefault(
        beschikbaar_key,
        bool(onderdeel.get("beschikbaar_voor_samengesteld", False)),
    )
    return omschrijving_key, hoeveelheid_key, prijs_key, beschikbaar_key


def _start_verpakkingsonderdeel_edit(onderdeel_id: str) -> None:
    onderdeel = get_verpakkingsonderdeel_by_id(onderdeel_id, _get_selected_year())
    if not onderdeel:
        st.warning("Het geselecteerde verpakkingsonderdeel is niet gevonden.")
        return
    st.session_state[f"verpakking_omschrijving_{onderdeel_id}"] = str(
        onderdeel.get("omschrijving", "") or ""
    )
    st.session_state[f"verpakking_hoeveelheid_{onderdeel_id}"] = float(
        onderdeel.get("hoeveelheid", 0.0) or 0.0
    )
    st.session_state[f"verpakking_prijs_per_stuk_{onderdeel_id}"] = float(
        onderdeel.get("prijs_per_stuk", 0.0) or 0.0
    )
    st.session_state[f"verpakking_beschikbaar_samengesteld_{onderdeel_id}"] = bool(
        onderdeel.get("beschikbaar_voor_samengesteld", False)
    )
    st.session_state["verpakkingsonderdelen_edit_row_id"] = onderdeel_id
    st.session_state["verpakkingsonderdelen_adding_row"] = False


def _cancel_verpakkingsonderdeel_edit() -> None:
    st.session_state["verpakkingsonderdelen_edit_row_id"] = ""


def _start_verpakkingsonderdeel_add() -> None:
    st.session_state["verpakkingsonderdelen_edit_row_id"] = ""
    st.session_state["verpakkingsonderdelen_adding_row"] = True
    st.session_state["verpakking_new_omschrijving"] = ""
    st.session_state["verpakking_new_hoeveelheid"] = 1.0
    st.session_state["verpakking_new_prijs_per_stuk"] = 0.0
    st.session_state["verpakking_new_beschikbaar_samengesteld"] = False


def _cancel_verpakkingsonderdeel_add() -> None:
    st.session_state["verpakkingsonderdelen_adding_row"] = False


def _render_verpakkingsonderdelen_overview(
    verpakkingsonderdelen: list[dict[str, Any]],
    selected_year: int | None,
) -> None:
    st.markdown("<div class='section-title'>Overzicht verpakkingsonderdelen</div>", unsafe_allow_html=True)
    if not verpakkingsonderdelen:
        if selected_year:
            st.info(f"Nog geen verpakkingsonderdelen toegevoegd voor {selected_year}")
        else:
            st.info("Nog geen verpakkingsonderdelen toegevoegd")
    headers = ["Omschrijving", "Hoeveelheid", "Prijs per stuk", "In samengesteld", "", "", ""]
    row_widths = [2.7, 1.0, 1.1, 1.2, 0.42, 0.42, 0.42]
    render_table_headers(headers, row_widths)

    confirm_delete_id = st.session_state.get("verpakkingsonderdelen_confirm_delete_id")
    edit_row_id = str(st.session_state.get("verpakkingsonderdelen_edit_row_id", "") or "")
    for onderdeel in verpakkingsonderdelen:
        onderdeel_id = str(onderdeel.get("id", ""))
        omschrijving = str(onderdeel.get("omschrijving", ""))
        row_cols = st.columns(row_widths)
        is_editing = onderdeel_id == edit_row_id
        omschrijving_key, hoeveelheid_key, prijs_key, beschikbaar_key = _ensure_verpakkingsonderdeel_widget_state(
            onderdeel_id,
            onderdeel,
        )

        with row_cols[0]:
            if is_editing:
                st.text_input(
                    "Omschrijving",
                    key=omschrijving_key,
                    label_visibility="collapsed",
                    placeholder="Bijvoorbeeld: Fles 33cl",
                )
            else:
                render_read_only_table_cell(omschrijving or "-")
        with row_cols[1]:
            if is_editing:
                st.number_input(
                    "Hoeveelheid",
                    min_value=0.0,
                    step=1.0,
                    format="%.2f",
                    key=hoeveelheid_key,
                    label_visibility="collapsed",
                )
            else:
                render_read_only_table_cell(f"{float(onderdeel.get('hoeveelheid', 0.0) or 0.0):.2f}")
        with row_cols[2]:
            if is_editing:
                st.number_input(
                    "Prijs per stuk",
                    min_value=0.0,
                    step=0.01,
                    format="%.2f",
                    key=prijs_key,
                    label_visibility="collapsed",
                )
            else:
                render_read_only_table_cell(_format_euro(onderdeel.get("prijs_per_stuk", 0.0)))
        with row_cols[3]:
            if is_editing:
                st.checkbox(
                    "In samengesteld",
                    key=beschikbaar_key,
                    label_visibility="collapsed",
                )
            else:
                render_read_only_table_cell(
                    "Ja" if bool(onderdeel.get("beschikbaar_voor_samengesteld", False)) else "-"
                )
        with row_cols[4]:
            if render_edit_button(
                key=f"verpakking_edit_{onderdeel_id}",
                disabled=is_editing,
            ):
                _start_verpakkingsonderdeel_edit(onderdeel_id)
                st.rerun()
        with row_cols[5]:
            if render_save_button(
                key=f"verpakking_save_{onderdeel_id}",
                disabled=not is_editing,
            ):
                new_omschrijving = str(st.session_state.get(omschrijving_key, "") or "")
                new_hoeveelheid = float(st.session_state.get(hoeveelheid_key, 0.0) or 0.0)
                new_prijs_per_stuk = float(st.session_state.get(prijs_key, 0.0) or 0.0)
                beschikbaar_voor_samengesteld = bool(st.session_state.get(beschikbaar_key, False))
                errors = _validate_verpakkingsonderdeel_row(
                    new_omschrijving,
                    new_hoeveelheid,
                    new_prijs_per_stuk,
                )
                if errors:
                    for error in errors:
                        st.error(error)
                elif update_verpakkingsonderdeel(
                    onderdeel_id=onderdeel_id,
                    omschrijving=new_omschrijving.strip(),
                    hoeveelheid=new_hoeveelheid,
                    prijs_per_stuk=new_prijs_per_stuk,
                    year=selected_year,
                    beschikbaar_voor_samengesteld=beschikbaar_voor_samengesteld,
                ):
                    _cancel_verpakkingsonderdeel_edit()
                    _set_feedback("verpakkingsonderdelen_feedback", "Verpakkingsonderdeel bijgewerkt.")
                    st.rerun()
                else:
                    st.error("Bijwerken is niet gelukt.")
        with row_cols[6]:
            if render_delete_button(key=f"verpakking_delete_{onderdeel_id}"):
                st.session_state["verpakkingsonderdelen_confirm_delete_id"] = onderdeel_id
                st.rerun()

        if confirm_delete_id == onderdeel_id:
            st.warning(f"Weet je zeker dat je {omschrijving} wilt verwijderen?")
            confirm_col, cancel_col, _ = st.columns([1, 1, 4])
            with confirm_col:
                if st.button("Ja, verwijderen", key=f"confirm_delete_{onderdeel_id}"):
                    if delete_verpakkingsonderdeel(onderdeel_id, year=selected_year):
                        if str(st.session_state.get("verpakkingsonderdelen_edit_row_id", "") or "") == onderdeel_id:
                            _cancel_verpakkingsonderdeel_edit()
                        st.session_state["verpakkingsonderdelen_confirm_delete_id"] = None
                        _set_feedback("verpakkingsonderdelen_feedback", "Verpakkingsonderdeel verwijderd.")
                        st.rerun()
                    st.error("Verwijderen is niet gelukt.")
            with cancel_col:
                if st.button("Annuleren", key=f"cancel_delete_{onderdeel_id}"):
                    st.session_state["verpakkingsonderdelen_confirm_delete_id"] = None
                    st.rerun()

    if st.session_state.get("verpakkingsonderdelen_adding_row"):
        st.markdown("<div class='section-text'><strong>Nieuw verpakkingsonderdeel</strong></div>", unsafe_allow_html=True)
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            st.text_input(
                "Omschrijving",
                key="verpakking_new_omschrijving",
                label_visibility="collapsed",
                placeholder="Bijvoorbeeld: Fles 33cl",
            )
        with row_cols[1]:
            st.number_input(
                "Hoeveelheid",
                min_value=0.0,
                step=1.0,
                format="%.2f",
                key="verpakking_new_hoeveelheid",
                label_visibility="collapsed",
            )
        with row_cols[2]:
            st.number_input(
                "Prijs per stuk",
                min_value=0.0,
                step=0.01,
                format="%.2f",
                key="verpakking_new_prijs_per_stuk",
                label_visibility="collapsed",
            )
        with row_cols[3]:
            st.checkbox(
                "In samengesteld",
                key="verpakking_new_beschikbaar_samengesteld",
                label_visibility="collapsed",
            )
        with row_cols[4]:
            st.write("")
        with row_cols[5]:
            if render_save_button(key="verpakking_new_save"):
                new_omschrijving = str(st.session_state.get("verpakking_new_omschrijving", "") or "")
                new_hoeveelheid = float(st.session_state.get("verpakking_new_hoeveelheid", 0.0) or 0.0)
                new_prijs_per_stuk = float(st.session_state.get("verpakking_new_prijs_per_stuk", 0.0) or 0.0)
                beschikbaar_voor_samengesteld = bool(
                    st.session_state.get("verpakking_new_beschikbaar_samengesteld", False)
                )
                errors = _validate_verpakkingsonderdeel_row(
                    new_omschrijving,
                    new_hoeveelheid,
                    new_prijs_per_stuk,
                )
                if errors:
                    for error in errors:
                        st.error(error)
                elif add_verpakkingsonderdeel(
                    omschrijving=new_omschrijving.strip(),
                    hoeveelheid=new_hoeveelheid,
                    prijs_per_stuk=new_prijs_per_stuk,
                    year=selected_year,
                    beschikbaar_voor_samengesteld=beschikbaar_voor_samengesteld,
                ):
                    _cancel_verpakkingsonderdeel_add()
                    _set_feedback("verpakkingsonderdelen_feedback", "Verpakkingsonderdeel toegevoegd.")
                    st.rerun()
                else:
                    st.error("Opslaan is niet gelukt.")
        with row_cols[6]:
            if st.button("Annuleren", key="verpakking_new_cancel"):
                _cancel_verpakkingsonderdeel_add()
                st.rerun()


def _is_verpakkingsonderdeel_samengesteld_choice(choice_id: str) -> bool:
    return str(choice_id or "").startswith(SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX)


def _resolve_samengesteld_choice(choice_id: str, selected_year: int | None) -> dict[str, Any] | None:
    choice_id = str(choice_id or "")
    if not choice_id:
        return None
    if _is_verpakkingsonderdeel_samengesteld_choice(choice_id):
        onderdeel_id = choice_id.removeprefix(SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX)
        onderdeel = get_verpakkingsonderdeel_by_id(onderdeel_id, selected_year)
        if not onderdeel:
            return None
        hoeveelheid = float(onderdeel.get("hoeveelheid", 0.0) or 0.0)
        prijs_per_stuk = float(onderdeel.get("prijs_per_stuk", 0.0) or 0.0)
        return {
            "id": choice_id,
            "omschrijving": str(onderdeel.get("omschrijving", "") or ""),
            "inhoud_per_eenheid_liter": 0.0,
            "totale_verpakkingskosten": bereken_basisproduct_regel_kosten(
                hoeveelheid,
                prijs_per_stuk,
            ),
        }
    return get_basisproduct_by_id(choice_id, selected_year)


def _get_samengesteld_keuzes(
    basisproducten: list[dict[str, Any]],
    verpakkingsonderdelen: list[dict[str, Any]],
    geselecteerde_ids: set[str] | None = None,
    current_id: str = "",
) -> list[dict[str, str]]:
    uitgesloten = {str(item_id) for item_id in (geselecteerde_ids or set())}
    keuzes: list[dict[str, str]] = []
    for basisproduct in basisproducten:
        item_id = str(basisproduct.get("id", "") or "")
        if item_id == current_id or item_id not in uitgesloten:
            keuzes.append({"id": item_id, "label": str(basisproduct.get("omschrijving", "") or item_id)})
    for onderdeel in verpakkingsonderdelen:
        if not bool(onderdeel.get("beschikbaar_voor_samengesteld", False)):
            continue
        item_id = f"{SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX}{str(onderdeel.get('id', '') or '')}"
        if item_id == current_id or item_id not in uitgesloten:
            keuzes.append({"id": item_id, "label": f"{str(onderdeel.get('omschrijving', '') or item_id)} (onderdeel)"})
    return keuzes


def _render_verpakkingsonderdelen_tab(
    verpakkingsonderdelen: list[dict[str, Any]],
    selected_year: int | None,
) -> None:
    st.markdown(
        "<div class='section-text'>Beheer hier losse verpakkingsonderdelen zoals flessen, doppen, etiketten, dozen en fusten.</div>",
        unsafe_allow_html=True,
    )
    _render_feedback("verpakkingsonderdelen_feedback")
    _render_verpakkingsonderdelen_overview(verpakkingsonderdelen, selected_year)
    if st.button(
        "Nieuw verpakkingsonderdeel toevoegen",
        key="add_verpakkingsonderdeel_inline",
        use_container_width=False,
        disabled=bool(st.session_state.get("verpakkingsonderdelen_adding_row", False)),
    ):
        _start_verpakkingsonderdeel_add()
        st.rerun()


def _get_basisproduct_rows_from_state() -> list[dict[str, Any]]:
    form_data = st.session_state.get("basisproduct_form_data", _empty_basisproduct_form_data())
    rows: list[dict[str, Any]] = []
    for row in form_data.get("onderdelen", []):
        row_id = str(row.get("row_id") or uuid4())
        rows.append(
            {
                "row_id": row_id,
                "verpakkingsonderdeel_id": str(st.session_state.get(_get_basisproduct_widget_key("onderdeel", row_id), row.get("verpakkingsonderdeel_id", "")) or ""),
                "hoeveelheid": float(st.session_state.get(_get_basisproduct_widget_key("hoeveelheid", row_id), row.get("hoeveelheid", 1.0)) or 0.0),
            }
        )
    return rows


def _build_basisproduct_live_rows(selected_year: int | None) -> list[dict[str, Any]]:
    live_rows: list[dict[str, Any]] = []
    for row in _get_basisproduct_rows_from_state():
        onderdeel_id = row["verpakkingsonderdeel_id"]
        gekoppeld_onderdeel = (
            get_verpakkingsonderdeel_by_id(onderdeel_id, selected_year)
            if onderdeel_id
            else None
        )
        prijs_per_stuk = float(gekoppeld_onderdeel.get("prijs_per_stuk", 0.0) if gekoppeld_onderdeel else 0.0)
        hoeveelheid = max(float(row.get("hoeveelheid", 0.0) or 0.0), 0.0)
        live_rows.append(
            {
                "row_id": row["row_id"],
                "verpakkingsonderdeel_id": onderdeel_id,
                "omschrijving": str(gekoppeld_onderdeel.get("omschrijving", "") if gekoppeld_onderdeel else ""),
                "hoeveelheid": hoeveelheid,
                "prijs_per_stuk": prijs_per_stuk,
                "totale_kosten": bereken_basisproduct_regel_kosten(
                    hoeveelheid,
                    prijs_per_stuk,
                ),
            }
        )
    return live_rows


def _get_geselecteerde_verpakkingsonderdelen(
    current_row_id: str | None = None,
) -> set[str]:
    """Geeft alle gekozen verpakkingsonderdelen terug behalve die van de huidige regel."""
    selected_ids: set[str] = set()

    for row in _get_basisproduct_rows_from_state():
        row_id = str(row.get("row_id", ""))
        onderdeel_id = str(row.get("verpakkingsonderdeel_id", "") or "")
        if not onderdeel_id or row_id == current_row_id:
            continue
        selected_ids.add(onderdeel_id)

    return selected_ids


def _get_basisproduct_omschrijving_value() -> str:
    form_data = st.session_state.get("basisproduct_form_data", _empty_basisproduct_form_data())
    return str(st.session_state.get(_get_basisproduct_widget_key("omschrijving"), form_data.get("omschrijving", "")))


def _get_basisproduct_inhoud_value() -> float:
    form_data = st.session_state.get("basisproduct_form_data", _empty_basisproduct_form_data())
    return float(
        st.session_state.get(
            _get_basisproduct_widget_key("inhoud"),
            form_data.get("inhoud_per_eenheid_liter", 0.0),
        )
        or 0.0
    )


def _add_basisproduct_row() -> None:
    rows = list(_get_basisproduct_rows_from_state())
    rows.append(_empty_basisproduct_row())
    _set_basisproduct_form_data(
        omschrijving=_get_basisproduct_omschrijving_value(),
        inhoud_per_eenheid_liter=_get_basisproduct_inhoud_value(),
        onderdelen=rows,
    )
    _bump_basisproduct_form_version()


def _remove_basisproduct_row(row_id: str) -> None:
    rows = [row for row in _get_basisproduct_rows_from_state() if str(row.get("row_id")) != row_id]
    if not rows:
        rows = [_empty_basisproduct_row()]
    _set_basisproduct_form_data(
        omschrijving=_get_basisproduct_omschrijving_value(),
        inhoud_per_eenheid_liter=_get_basisproduct_inhoud_value(),
        onderdelen=rows,
    )
    _bump_basisproduct_form_version()


def _validate_basisproduct_form(
    omschrijving: str,
    inhoud_per_eenheid_liter: float,
    rows: list[dict[str, Any]],
    selected_year: int | None,
) -> tuple[list[str], list[dict[str, Any]]]:
    errors: list[str] = []
    valid_rows: list[dict[str, Any]] = []
    seen_onderdeel_ids: set[str] = set()

    if not omschrijving.strip():
        errors.append("Omschrijving is verplicht.")
    if inhoud_per_eenheid_liter <= 0:
        errors.append("Inhoud per eenheid (liter) moet groter zijn dan 0.")

    for index, row in enumerate(rows, start=1):
        onderdeel_id = str(row.get("verpakkingsonderdeel_id", "") or "")
        hoeveelheid = float(row.get("hoeveelheid", 0.0) or 0.0)
        if not onderdeel_id and hoeveelheid in {0.0, 1.0}:
            continue

        onderdeel = get_verpakkingsonderdeel_by_id(onderdeel_id, selected_year)
        if not onderdeel:
            errors.append(f"Regel {index}: selecteer een geldig verpakkingsonderdeel.")
            continue
        if hoeveelheid <= 0:
            errors.append(f"Regel {index}: hoeveelheid moet groter zijn dan 0.")
            continue
        if onderdeel_id in seen_onderdeel_ids:
            errors.append(
                f"Regel {index}: elk verpakkingsonderdeel mag maar één keer voorkomen."
            )
            continue

        prijs_per_stuk = float(onderdeel.get("prijs_per_stuk", 0.0) or 0.0)
        seen_onderdeel_ids.add(onderdeel_id)
        valid_rows.append(
            {
                "verpakkingsonderdeel_id": onderdeel_id,
                "verpakkingsonderdeel_key": str(
                    onderdeel.get("component_key", onderdeel_id) or onderdeel_id
                ),
                "omschrijving": str(onderdeel.get("omschrijving", "")),
                "hoeveelheid": hoeveelheid,
                "prijs_per_stuk": prijs_per_stuk,
                "totale_kosten": prijs_per_stuk * hoeveelheid,
            }
        )

    if not valid_rows:
        errors.append("Koppel minimaal één geldig verpakkingsonderdeel.")

    return errors, valid_rows


def _get_samengesteld_product_rows_from_state() -> list[dict[str, Any]]:
    form_data = st.session_state.get(
        "samengesteld_product_form_data",
        _empty_samengesteld_product_form_data(),
    )
    rows: list[dict[str, Any]] = []

    for row in form_data.get("basisproducten", []):
        row_id = str(row.get("row_id") or uuid4())
        rows.append(
            {
                "row_id": row_id,
                "basisproduct_id": str(
                    st.session_state.get(
                        _get_samengesteld_product_widget_key("basisproduct", row_id),
                        row.get("basisproduct_id", ""),
                    )
                    or ""
                ),
                "aantal": float(
                    st.session_state.get(
                        _get_samengesteld_product_widget_key("aantal", row_id),
                        row.get("aantal", 1.0),
                    )
                    or 0.0
                ),
            }
        )

    return rows


def _build_samengesteld_product_live_rows(selected_year: int | None) -> list[dict[str, Any]]:
    live_rows: list[dict[str, Any]] = []

    for row in _get_samengesteld_product_rows_from_state():
        basisproduct_id = row["basisproduct_id"]
        basisproduct = _resolve_samengesteld_choice(basisproduct_id, selected_year) if basisproduct_id else None
        aantal = max(float(row.get("aantal", 0.0) or 0.0), 0.0)
        inhoud_per_eenheid = float(
            basisproduct.get("inhoud_per_eenheid_liter", 0.0) if basisproduct else 0.0
        )
        verpakkingskosten_per_eenheid = float(
            basisproduct.get("totale_verpakkingskosten", 0.0) if basisproduct else 0.0
        )

        live_rows.append(
            {
                "row_id": row["row_id"],
                "basisproduct_id": basisproduct_id,
                "omschrijving": str(basisproduct.get("omschrijving", "") if basisproduct else ""),
                "aantal": aantal,
                "inhoud_per_eenheid_liter": inhoud_per_eenheid,
                "totale_inhoud_liter": aantal * inhoud_per_eenheid,
                "verpakkingskosten_per_eenheid": verpakkingskosten_per_eenheid,
                "totale_verpakkingskosten": bereken_basisproduct_regel_kosten(
                    aantal,
                    verpakkingskosten_per_eenheid,
                ),
            }
        )

    return live_rows


def _get_geselecteerde_basisproducten(current_row_id: str | None = None) -> set[str]:
    """Geeft alle gekozen basisproducten terug behalve die van de huidige regel."""
    selected_ids: set[str] = set()

    for row in _get_samengesteld_product_rows_from_state():
        row_id = str(row.get("row_id", ""))
        basisproduct_id = str(row.get("basisproduct_id", "") or "")
        if not basisproduct_id or row_id == current_row_id:
            continue
        selected_ids.add(basisproduct_id)

    return selected_ids


def _get_samengesteld_product_omschrijving_value() -> str:
    form_data = st.session_state.get(
        "samengesteld_product_form_data",
        _empty_samengesteld_product_form_data(),
    )
    return str(
        st.session_state.get(
            _get_samengesteld_product_widget_key("omschrijving"),
            form_data.get("omschrijving", ""),
        )
    )


def _add_samengesteld_product_row() -> None:
    rows = list(_get_samengesteld_product_rows_from_state())
    rows.append(_empty_samengesteld_product_row())
    _set_samengesteld_product_form_data(
        omschrijving=_get_samengesteld_product_omschrijving_value(),
        basisproducten=rows,
    )
    _bump_samengesteld_product_form_version()


def _remove_samengesteld_product_row(row_id: str) -> None:
    rows = [
        row
        for row in _get_samengesteld_product_rows_from_state()
        if str(row.get("row_id")) != row_id
    ]
    if not rows:
        rows = [_empty_samengesteld_product_row()]

    _set_samengesteld_product_form_data(
        omschrijving=_get_samengesteld_product_omschrijving_value(),
        basisproducten=rows,
    )
    _bump_samengesteld_product_form_version()


def _validate_samengesteld_product_form(
    omschrijving: str,
    rows: list[dict[str, Any]],
    selected_year: int | None,
) -> tuple[list[str], list[dict[str, Any]]]:
    errors: list[str] = []
    valid_rows: list[dict[str, Any]] = []
    seen_basisproduct_ids: set[str] = set()

    if not omschrijving.strip():
        errors.append("Omschrijving is verplicht.")

    for index, row in enumerate(rows, start=1):
        basisproduct_id = str(row.get("basisproduct_id", "") or "")
        aantal = float(row.get("aantal", 0.0) or 0.0)

        if not basisproduct_id and aantal in {0.0, 1.0}:
            continue

        basisproduct = _resolve_samengesteld_choice(basisproduct_id, selected_year)
        if not basisproduct:
            errors.append(f"Regel {index}: selecteer een geldig basisproduct.")
            continue
        if aantal <= 0:
            errors.append(f"Regel {index}: aantal moet groter zijn dan 0.")
            continue
        if basisproduct_id in seen_basisproduct_ids:
            errors.append(
                f"Regel {index}: elk basisproduct mag maar één keer voorkomen."
            )
            continue

        inhoud_per_eenheid = float(
            basisproduct.get("inhoud_per_eenheid_liter", 0.0) or 0.0
        )
        verpakkingskosten_per_eenheid = float(
            basisproduct.get("totale_verpakkingskosten", 0.0) or 0.0
        )
        seen_basisproduct_ids.add(basisproduct_id)
        valid_rows.append(
            {
                "basisproduct_id": basisproduct_id,
                "omschrijving": str(basisproduct.get("omschrijving", "")),
                "aantal": aantal,
                "inhoud_per_eenheid_liter": inhoud_per_eenheid,
                "totale_inhoud_liter": aantal * inhoud_per_eenheid,
                "verpakkingskosten_per_eenheid": verpakkingskosten_per_eenheid,
                "totale_verpakkingskosten": bereken_basisproduct_regel_kosten(
                    aantal,
                    verpakkingskosten_per_eenheid,
                ),
            }
        )

    if not valid_rows:
        errors.append("Koppel minimaal één geldig basisproduct.")

    return errors, valid_rows


def _render_basisproduct_form(
    verpakkingsonderdelen: list[dict[str, Any]],
    selected_year: int | None,
) -> bool:
    mode = st.session_state.get("basisproducten_mode", MODE_IDLE)
    if mode not in {MODE_ADD, MODE_EDIT}:
        return False

    if not verpakkingsonderdelen:
        st.warning("Voeg eerst minimaal één verpakkingsonderdeel toe voordat je een basisproduct kunt maken.")
        return False

    _ensure_basisproduct_form_widget_state()
    lookup = {str(onderdeel.get("id", "")): onderdeel for onderdeel in verpakkingsonderdelen}

    title = "Nieuw basisproduct toevoegen" if mode == MODE_ADD else "Basisproduct bewerken"
    st.markdown(f"<div class='section-title'>{title}</div>", unsafe_allow_html=True)

    omschrijving_col, inhoud_col = st.columns([2.4, 1.0])
    with omschrijving_col:
        omschrijving = st.text_input(
            "Omschrijving",
            key=_get_basisproduct_widget_key("omschrijving"),
            placeholder="Bijvoorbeeld: Fles 33cl",
        )
    with inhoud_col:
        inhoud_per_eenheid_liter = st.number_input(
            "Inhoud per eenheid (liter)",
            min_value=0.0,
            step=0.01,
            format="%.2f",
            key=_get_basisproduct_widget_key("inhoud"),
        )

    st.markdown(
        "<div class='section-title' style='font-size:1.15rem;margin-top:1rem;'>Gekoppelde verpakkingsonderdelen</div>",
        unsafe_allow_html=True,
    )

    headers = ["Verpakkingsonderdeel", "Hoeveelheid", "Prijs per stuk", "Totale kosten", ""]
    render_table_headers(headers, [2.4, 1.0, 1.2, 1.2, 1.0])

    confirm_row_id = st.session_state.get("basisproducten_confirm_remove_row_id")
    live_rows = _build_basisproduct_live_rows(selected_year)
    for row in live_rows:
        row_id = str(row["row_id"])
        current_onderdeel_id = str(row.get("verpakkingsonderdeel_id", "") or "")
        unavailable_ids = _get_geselecteerde_verpakkingsonderdelen(row_id)
        options = [""]
        options.extend(
            str(onderdeel.get("id", ""))
            for onderdeel in verpakkingsonderdelen
            if str(onderdeel.get("id", "")) == current_onderdeel_id
            or str(onderdeel.get("id", "")) not in unavailable_ids
        )
        row_cols = st.columns([2.4, 1.0, 1.2, 1.2, 1.0])

        with row_cols[0]:
            option_index = options.index(current_onderdeel_id) if current_onderdeel_id in options else 0
            st.selectbox(
                "Verpakkingsonderdeel",
                options=options,
                index=option_index,
                format_func=lambda onderdeel_id: "Selecteer onderdeel" if not onderdeel_id else str(lookup[onderdeel_id].get("omschrijving", onderdeel_id)),
                key=_get_basisproduct_widget_key("onderdeel", row_id),
                label_visibility="collapsed",
            )
        with row_cols[1]:
            st.number_input(
                "Hoeveelheid",
                min_value=0.0,
                step=1.0,
                format="%.2f",
                key=_get_basisproduct_widget_key("hoeveelheid", row_id),
                label_visibility="collapsed",
            )
        with row_cols[2]:
            render_read_only_table_cell(
                _format_euro(row.get("prijs_per_stuk", 0.0))
            )
        with row_cols[3]:
            render_read_only_table_cell(
                _format_euro(row.get("totale_kosten", 0.0))
            )
        with row_cols[4]:
            if render_delete_button(key=f"basisproduct_remove_row_{row_id}"):
                st.session_state["basisproducten_confirm_remove_row_id"] = row_id
                st.rerun()

        if confirm_row_id == row_id:
            row_label = row.get("omschrijving") or "deze onderdeelregel"
            st.warning(f"Weet je zeker dat je {row_label} wilt verwijderen?")
            confirm_col, cancel_col, _ = st.columns([1, 1, 4])
            with confirm_col:
                if st.button("Ja, verwijderen", key=f"basisproduct_confirm_remove_{row_id}"):
                    _remove_basisproduct_row(row_id)
                    st.rerun()
            with cancel_col:
                if st.button("Annuleren", key=f"basisproduct_cancel_remove_{row_id}"):
                    st.session_state["basisproducten_confirm_remove_row_id"] = None
                    st.rerun()

    totale_verpakkingskosten = bereken_basisproduct_totaal(
        _build_basisproduct_live_rows(selected_year)
    )
    st.markdown(
        f"<div class='section-text'><strong>Totale verpakkingskosten:</strong> {_format_euro(totale_verpakkingskosten)}</div>",
        unsafe_allow_html=True,
    )

    action_col_cancel, action_col_add_row, action_col_spacer, action_col_save = st.columns([1, 1, 3, 1])
    with action_col_cancel:
        if st.button("Annuleren", key="basisproduct_form_cancel", use_container_width=True):
            _cancel_basisproduct_form_mode()
            st.rerun()
    with action_col_add_row:
        if st.button("Toevoegen", key="basisproduct_add_row", use_container_width=True):
            _add_basisproduct_row()
            st.rerun()
            return False
    with action_col_save:
        save_label = "Opslaan" if mode == MODE_EDIT else "Afronden"
        if st.button(save_label, key="basisproduct_form_save", use_container_width=True):
            errors, valid_rows = _validate_basisproduct_form(
                omschrijving=omschrijving,
                inhoud_per_eenheid_liter=float(inhoud_per_eenheid_liter),
                rows=_get_basisproduct_rows_from_state(),
                selected_year=selected_year,
            )
            if errors:
                for error in errors:
                    st.error(error)
                return

            if mode == MODE_ADD:
                saved = add_basisproduct(
                    omschrijving=omschrijving.strip(),
                    inhoud_per_eenheid_liter=float(inhoud_per_eenheid_liter),
                    onderdelen=valid_rows,
                    year=selected_year,
                )
                if saved:
                    _set_feedback("basisproducten_feedback", "Basisproduct toegevoegd.")
                    _cancel_basisproduct_form_mode()
                    st.rerun()
                st.error("Opslaan is niet gelukt. Probeer het opnieuw.")
                return False

            basisproduct_id = st.session_state.get("basisproducten_selected_id")
            if basisproduct_id and update_basisproduct(
                basisproduct_id=basisproduct_id,
                omschrijving=omschrijving.strip(),
                inhoud_per_eenheid_liter=float(inhoud_per_eenheid_liter),
                onderdelen=valid_rows,
                year=selected_year,
            ):
                _set_feedback("basisproducten_feedback", "Basisproduct bijgewerkt.")
                _cancel_basisproduct_form_mode()
                st.rerun()
            st.error("Bijwerken is niet gelukt. Probeer het opnieuw.")

    return False


def _render_basisproducten_overview(basisproducten: list[dict[str, Any]]) -> None:
    st.markdown("<div class='section-title'>Overzicht basisproducten</div>", unsafe_allow_html=True)
    if not basisproducten:
        st.info("Nog geen basisproducten toegevoegd")
        return

    headers = ["Omschrijving", "Inhoud", "Aantal onderdelen", "Totale verpakkingskosten", "", ""]
    row_widths = [2.6, 1.0, 1.2, 1.4, 0.9, 1.0]
    render_table_headers(headers, row_widths)

    confirm_delete_id = st.session_state.get("basisproducten_confirm_delete_id")
    for basisproduct in basisproducten:
        basisproduct_id = str(basisproduct.get("id", ""))
        omschrijving = str(basisproduct.get("omschrijving", ""))
        row_cols = st.columns(row_widths)

        with row_cols[0]:
            render_read_only_table_cell(omschrijving or "-")
        with row_cols[1]:
            render_read_only_table_cell(
                f"{float(basisproduct.get('inhoud_per_eenheid_liter', 0.0) or 0.0):.2f} L"
            )
        with row_cols[2]:
            render_read_only_table_cell(str(len(basisproduct.get("onderdelen", []))))
        with row_cols[3]:
            render_read_only_table_cell(
                _format_euro(basisproduct.get("totale_verpakkingskosten", 0.0))
            )
        with row_cols[4]:
            if render_edit_button(key=f"basisproduct_edit_{basisproduct_id}"):
                _start_basisproduct_edit_mode(basisproduct_id)
                st.rerun()
        with row_cols[5]:
            if render_delete_button(key=f"basisproduct_delete_{basisproduct_id}"):
                st.session_state["basisproducten_confirm_delete_id"] = basisproduct_id
                st.rerun()

        if confirm_delete_id == basisproduct_id:
            st.warning(f"Weet je zeker dat je basisproduct {omschrijving} wilt verwijderen?")
            confirm_col, cancel_col, _ = st.columns([1, 1, 4])
            with confirm_col:
                if st.button("Ja, verwijderen", key=f"basisproduct_confirm_delete_{basisproduct_id}"):
                    if delete_basisproduct(basisproduct_id, year=selected_year):
                        if st.session_state.get("basisproducten_selected_id") == basisproduct_id:
                            _cancel_basisproduct_form_mode()
                        st.session_state["basisproducten_confirm_delete_id"] = None
                        _set_feedback("basisproducten_feedback", "Basisproduct verwijderd.")
                        st.rerun()
                    st.error("Verwijderen is niet gelukt.")
            with cancel_col:
                if st.button("Annuleren", key=f"basisproduct_cancel_delete_{basisproduct_id}"):
                    st.session_state["basisproducten_confirm_delete_id"] = None
                    st.rerun()


def _render_basisproducten_tab(
    basisproducten: list[dict[str, Any]],
    verpakkingsonderdelen: list[dict[str, Any]],
    selected_year: int | None,
) -> None:
    st.markdown(
        "<div class='section-text'>Beheer hier basisproducten zoals een fles 33cl of fles 75cl, opgebouwd uit verpakkingsonderdelen.</div>",
        unsafe_allow_html=True,
    )
    _render_feedback("basisproducten_feedback")

    if st.session_state.get("basisproducten_mode") == MODE_IDLE:
        if st.button("Nieuw basisproduct toevoegen", key="add_basisproduct"):
            _start_basisproduct_add_mode()
            st.rerun()
            return
    else:
        st.button("Nieuw basisproduct toevoegen", key="add_basisproduct_disabled", disabled=True)

    form_changed = _render_basisproduct_form(verpakkingsonderdelen, selected_year)
    actuele_basisproducten = (
        load_basisproducten_for_year(selected_year)
        if selected_year is not None
        else load_basisproducten()
    )
    if form_changed:
        _render_feedback("basisproducten_feedback")
    _render_basisproducten_overview(actuele_basisproducten)


def _render_samengesteld_product_form(
    basisproducten: list[dict[str, Any]],
    verpakkingsonderdelen: list[dict[str, Any]],
    selected_year: int | None,
) -> bool:
    mode = st.session_state.get("samengestelde_producten_mode", MODE_IDLE)
    if mode not in {MODE_ADD, MODE_EDIT}:
        return False

    selecteerbare_bouwblokken = _get_samengesteld_keuzes(
        basisproducten,
        verpakkingsonderdelen,
    )
    if not selecteerbare_bouwblokken:
        st.warning(
            "Voeg eerst minimaal één basisproduct of één verpakkingsonderdeel met 'In samengesteld' toe."
        )
        return False

    _ensure_samengesteld_product_form_widget_state()
    lookup = {choice["id"]: {"omschrijving": choice["label"]} for choice in selecteerbare_bouwblokken}

    title = (
        "Nieuw samengesteld product toevoegen"
        if mode == MODE_ADD
        else "Samengesteld product bewerken"
    )
    st.markdown(f"<div class='section-title'>{title}</div>", unsafe_allow_html=True)

    omschrijving = st.text_input(
        "Omschrijving",
        key=_get_samengesteld_product_widget_key("omschrijving"),
        placeholder="Bijvoorbeeld: Doos 24 flessen 33cl",
    )

    st.markdown(
        "<div class='section-title' style='font-size:1.15rem;margin-top:1rem;'>Gekoppelde basisproducten</div>",
        unsafe_allow_html=True,
    )

    headers = [
        "Basisproduct",
        "Aantal",
        "Inhoud / eenheid",
        "Totale inhoud",
        "Verpakkingskosten / eenheid",
        "Totale verpakkingskosten",
        "",
    ]
    render_table_headers(headers, [2.4, 0.9, 1.1, 1.1, 1.3, 1.3, 1.0])

    confirm_row_id = st.session_state.get("samengestelde_producten_confirm_remove_row_id")
    live_rows = _build_samengesteld_product_live_rows(selected_year)
    for row in live_rows:
        row_id = str(row["row_id"])
        current_basisproduct_id = str(row.get("basisproduct_id", "") or "")
        unavailable_ids = _get_geselecteerde_basisproducten(row_id)
        options = [""]
        options.extend(
            choice["id"]
            for choice in _get_samengesteld_keuzes(
                basisproducten,
                verpakkingsonderdelen,
                geselecteerde_ids=unavailable_ids,
                current_id=current_basisproduct_id,
            )
        )
        row_cols = st.columns([2.4, 0.9, 1.1, 1.1, 1.3, 1.3, 1.0])

        with row_cols[0]:
            st.selectbox(
                "Basisproduct",
                options=options,
                format_func=lambda basisproduct_id: (
                    "Selecteer basisproduct"
                    if not basisproduct_id
                    else str(lookup[basisproduct_id].get("omschrijving", basisproduct_id))
                ),
                key=_get_samengesteld_product_widget_key("basisproduct", row_id),
                label_visibility="collapsed",
            )
        with row_cols[1]:
            st.number_input(
                "Aantal",
                min_value=0.0,
                step=1.0,
                format="%.2f",
                key=_get_samengesteld_product_widget_key("aantal", row_id),
                label_visibility="collapsed",
            )
        with row_cols[2]:
            render_read_only_table_cell(
                f"{float(row.get('inhoud_per_eenheid_liter', 0.0) or 0.0):.2f} L"
            )
        with row_cols[3]:
            render_read_only_table_cell(
                f"{float(row.get('totale_inhoud_liter', 0.0) or 0.0):.2f} L"
            )
        with row_cols[4]:
            render_read_only_table_cell(
                _format_euro(row.get("verpakkingskosten_per_eenheid", 0.0))
            )
        with row_cols[5]:
            render_read_only_table_cell(
                _format_euro(row.get("totale_verpakkingskosten", 0.0))
            )
        with row_cols[6]:
            if render_delete_button(key=f"samengesteld_product_remove_row_{row_id}"):
                st.session_state["samengestelde_producten_confirm_remove_row_id"] = row_id
                st.rerun()

        if confirm_row_id == row_id:
            row_label = row.get("omschrijving") or "deze basisproductregel"
            st.warning(f"Weet je zeker dat je {row_label} wilt verwijderen?")
            confirm_col, cancel_col, _ = st.columns([1, 1, 4])
            with confirm_col:
                if st.button("Ja, verwijderen", key=f"samengesteld_product_confirm_remove_{row_id}"):
                    _remove_samengesteld_product_row(row_id)
                    st.rerun()
            with cancel_col:
                if st.button("Annuleren", key=f"samengesteld_product_cancel_remove_{row_id}"):
                    st.session_state["samengestelde_producten_confirm_remove_row_id"] = None
                    st.rerun()

    totale_inhoud = bereken_samengesteld_product_totaal_inhoud(live_rows)
    totale_verpakkingskosten = bereken_samengesteld_product_totaal_verpakkingskosten(
        live_rows
    )
    st.markdown(
        f"<div class='section-text'><strong>Totale inhoud:</strong> {totale_inhoud:.2f} L</div>",
        unsafe_allow_html=True,
    )
    st.markdown(
        f"<div class='section-text'><strong>Totale verpakkingskosten:</strong> {_format_euro(totale_verpakkingskosten)}</div>",
        unsafe_allow_html=True,
    )

    action_col_cancel, action_col_add_row, action_col_spacer, action_col_save = st.columns([1, 1, 3, 1])
    with action_col_cancel:
        if st.button("Annuleren", key="samengesteld_product_form_cancel", use_container_width=True):
            _cancel_samengesteld_product_form_mode()
            st.rerun()
    with action_col_add_row:
        if st.button("Toevoegen", key="samengesteld_product_add_row", use_container_width=True):
            _add_samengesteld_product_row()
            st.rerun()
            return False
    with action_col_save:
        save_label = "Opslaan" if mode == MODE_EDIT else "Afronden"
        if st.button(
            save_label,
            key="samengesteld_product_form_save",
            use_container_width=True,
        ):
            errors, valid_rows = _validate_samengesteld_product_form(
                omschrijving=omschrijving,
                rows=_get_samengesteld_product_rows_from_state(),
                selected_year=selected_year,
            )
            if errors:
                for error in errors:
                    st.error(error)
                return False

            if mode == MODE_ADD:
                saved = add_samengesteld_product(
                    omschrijving=omschrijving.strip(),
                    basisproducten=valid_rows,
                    year=selected_year,
                )
                if saved:
                    _set_feedback(
                        "samengestelde_producten_feedback",
                        "Samengesteld product toegevoegd.",
                    )
                    _cancel_samengesteld_product_form_mode()
                    st.rerun()
                st.error("Opslaan is niet gelukt. Probeer het opnieuw.")
                return False

            samengesteld_product_id = st.session_state.get(
                "samengestelde_producten_selected_id"
            )
            if samengesteld_product_id and update_samengesteld_product(
                samengesteld_product_id=samengesteld_product_id,
                omschrijving=omschrijving.strip(),
                basisproducten=valid_rows,
                year=selected_year,
            ):
                _set_feedback(
                    "samengestelde_producten_feedback",
                    "Samengesteld product bijgewerkt.",
                )
                _cancel_samengesteld_product_form_mode()
                st.rerun()
            st.error("Bijwerken is niet gelukt. Probeer het opnieuw.")

    return False


def _render_samengestelde_producten_overview(
    samengestelde_producten: list[dict[str, Any]],
) -> None:
    st.markdown(
        "<div class='section-title'>Overzicht samengestelde producten</div>",
        unsafe_allow_html=True,
    )
    if not samengestelde_producten:
        st.info("Nog geen samengestelde producten toegevoegd")
        return

    headers = [
        "Omschrijving",
        "Aantal basisproducten",
        "Totale inhoud",
        "Totale verpakkingskosten",
        "",
        "",
    ]
    row_widths = [2.6, 1.1, 1.1, 1.4, 0.9, 1.0]
    render_table_headers(headers, row_widths)

    confirm_delete_id = st.session_state.get("samengestelde_producten_confirm_delete_id")
    for samengesteld_product in samengestelde_producten:
        samengesteld_product_id = str(samengesteld_product.get("id", ""))
        omschrijving = str(samengesteld_product.get("omschrijving", ""))
        row_cols = st.columns(row_widths)

        with row_cols[0]:
            render_read_only_table_cell(omschrijving or "-")
        with row_cols[1]:
            render_read_only_table_cell(
                str(len(samengesteld_product.get("basisproducten", [])))
            )
        with row_cols[2]:
            render_read_only_table_cell(
                f"{float(samengesteld_product.get('totale_inhoud_liter', 0.0) or 0.0):.2f} L"
            )
        with row_cols[3]:
            render_read_only_table_cell(
                _format_euro(samengesteld_product.get("totale_verpakkingskosten", 0.0))
            )
        with row_cols[4]:
            if render_edit_button(
                key=f"samengesteld_product_edit_{samengesteld_product_id}",
            ):
                _start_samengesteld_product_edit_mode(samengesteld_product_id)
                st.rerun()
        with row_cols[5]:
            if render_delete_button(
                key=f"samengesteld_product_delete_{samengesteld_product_id}",
            ):
                st.session_state[
                    "samengestelde_producten_confirm_delete_id"
                ] = samengesteld_product_id
                st.rerun()

        if confirm_delete_id == samengesteld_product_id:
            st.warning(
                f"Weet je zeker dat je samengesteld product {omschrijving} wilt verwijderen?"
            )
            confirm_col, cancel_col, _ = st.columns([1, 1, 4])
            with confirm_col:
                if st.button(
                    "Ja, verwijderen",
                    key=f"samengesteld_product_confirm_delete_{samengesteld_product_id}",
                ):
                    if delete_samengesteld_product(
                        samengesteld_product_id,
                        year=selected_year,
                    ):
                        if (
                            st.session_state.get("samengestelde_producten_selected_id")
                            == samengesteld_product_id
                        ):
                            _cancel_samengesteld_product_form_mode()
                        st.session_state[
                            "samengestelde_producten_confirm_delete_id"
                        ] = None
                        _set_feedback(
                            "samengestelde_producten_feedback",
                            "Samengesteld product verwijderd.",
                        )
                        st.rerun()
                    st.error("Verwijderen is niet gelukt.")
            with cancel_col:
                if st.button(
                    "Annuleren",
                    key=f"samengesteld_product_cancel_delete_{samengesteld_product_id}",
                ):
                    st.session_state[
                        "samengestelde_producten_confirm_delete_id"
                    ] = None
                    st.rerun()


def _render_samengestelde_producten_tab(
    samengestelde_producten: list[dict[str, Any]],
    basisproducten: list[dict[str, Any]],
    verpakkingsonderdelen: list[dict[str, Any]],
    selected_year: int | None,
) -> None:
    st.markdown(
        "<div class='section-text'>Beheer hier samengestelde producten zoals een doos met 24 flessen, opgebouwd uit basisproducten en optioneel losse onderdelen met 'In samengesteld'.</div>",
        unsafe_allow_html=True,
    )
    _render_feedback("samengestelde_producten_feedback")

    if st.session_state.get("samengestelde_producten_mode") == MODE_IDLE:
        if st.button(
            "Nieuw samengesteld product toevoegen",
            key="add_samengesteld_product",
        ):
            _start_samengesteld_product_add_mode()
            st.rerun()
            return
    else:
        st.button(
            "Nieuw samengesteld product toevoegen",
            key="add_samengesteld_product_disabled",
            disabled=True,
        )

    form_changed = _render_samengesteld_product_form(
        basisproducten,
        verpakkingsonderdelen,
        selected_year,
    )
    actuele_samengestelde_producten = (
        load_samengestelde_producten_for_year(selected_year)
        if selected_year is not None
        else load_samengestelde_producten()
    )
    if form_changed:
        _render_feedback("samengestelde_producten_feedback")
    _render_samengestelde_producten_overview(actuele_samengestelde_producten)


def show_producten_verpakking_page(
    on_back: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    del on_logout
    init_verpakkingsonderdelen_file()
    init_basisproducten_file()
    init_samengestelde_producten_file()
    _init_page_state()

    beschikbare_jaren = get_productie_years()
    selected_year = _get_selected_year()
    if beschikbare_jaren:
        if selected_year not in beschikbare_jaren:
            selected_year = beschikbare_jaren[-1]
            st.session_state["producten_verpakking_selected_year"] = selected_year
    else:
        selected_year = None
        st.session_state["producten_verpakking_selected_year"] = None

    _handle_year_context_change(selected_year)

    verpakkingsonderdelen = (
        get_verpakkingsonderdelen_for_year(selected_year)
        if selected_year is not None
        else load_verpakkingsonderdelen()
    )
    basisproducten = (
        load_basisproducten_for_year(selected_year)
        if selected_year is not None
        else load_basisproducten()
    )
    samengestelde_producten = (
        load_samengestelde_producten_for_year(selected_year)
        if selected_year is not None
        else load_samengestelde_producten()
    )

    st.markdown("<div class='main-card'>", unsafe_allow_html=True)
    render_breadcrumb(current_label="Producten & verpakking", on_home_click=on_back)
    render_page_header(
        "Producten & verpakking",
        "Beheer hier centrale stamgegevens voor verpakkingsonderdelen, basisproducten en samengestelde producten.",
    )

    if beschikbare_jaren:
        filter_col, info_col = st.columns([1.2, 3.0])
        with filter_col:
            st.selectbox(
                "Jaar",
                options=beschikbare_jaren,
                index=beschikbare_jaren.index(selected_year),
                key="producten_verpakking_selected_year",
            )
    else:
        st.info("Voeg eerst een productiejaar toe om jaarspecifieke verpakkingsonderdelen te beheren.")

    tab_verpakking, tab_basis, tab_samengesteld = st.tabs(
        [f"Verpakkingsonderdelen {selected_year}", f"Basisproducten {selected_year}", f"Samengestelde producten {selected_year}"]
    )

    with tab_verpakking:
        _render_verpakkingsonderdelen_tab(verpakkingsonderdelen, selected_year)
    with tab_basis:
        _render_basisproducten_tab(basisproducten, verpakkingsonderdelen, selected_year)
    with tab_samengesteld:
        _render_samengestelde_producten_tab(
            samengestelde_producten,
            basisproducten,
            verpakkingsonderdelen,
            selected_year,
        )

    col_back, col_spacer = st.columns([1, 4])
    with col_back:
        if st.button("Terug naar home", key="producten_verpakking_back"):
            on_back()

    st.markdown("</div>", unsafe_allow_html=True)