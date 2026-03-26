from __future__ import annotations

from typing import Any

import streamlit as st

from components.action_buttons import render_delete_button, render_edit_button, render_save_button
from components.table_ui import (
    format_currency_cell_value,
    render_currency_table_cell,
    render_read_only_table_cell,
    render_table_headers,
)
from .state import (
    HERCALCULATIE_REDENEN,
    INGREDIENT_OPTIONS,
    EENHEID_OPTIONS,
    add_new_ingredient_row,
    calculate_kosten_recept,
    calculate_prijs_per_eenheid,
    collect_ingredient_row_from_widgets,
    delete_ingredient_row,
    format_number,
    get_active_berekening,
    get_hercalculatie_basis_rows,
    get_ingredient_key,
    get_step_3_rows_for_view,
    save_current_ingredient_row,
    start_edit_ingredient_row,
    sync_active_berekening_from_widgets,
)
from .step_3_invoer import _ingredient_value, _render_step_3_summary


def _read_only_input(label: str, value: str, key: str) -> None:
    st.text_input(label, value=value, disabled=True, key=key, label_visibility="collapsed")


def _render_ingredient_row_recalculatie(
    row: dict[str, Any],
    *,
    is_editing: bool,
    basis_row_ids: set[str],
    mode: str,
) -> None:
    row_id = str(row.get("id", "") or "")
    is_basis_row = row_id in basis_row_ids
    allow_only_price = mode == "Prijswijziging"
    allow_recipe_change = mode in {"Receptafwijking", "Prijs en receptafwijking"}
    allow_price_change = mode in {"Prijswijziging", "Prijs en receptafwijking"} or not is_basis_row

    prijs_per_eenheid = calculate_prijs_per_eenheid(row)
    kosten_recept = calculate_kosten_recept(row)

    row_cols = st.columns([1.7, 2.3, 1.05, 1.0, 1.15, 1.2, 1.15, 0.48, 0.48, 0.48, 0.48])

    if is_editing:
        live_row = collect_ingredient_row_from_widgets(row_id)
        ingredient_value = _ingredient_value(row)
        default_ingredient = ingredient_value if ingredient_value in INGREDIENT_OPTIONS else INGREDIENT_OPTIONS[-1]
        default_eenheid = row["eenheid"] if row["eenheid"] in EENHEID_OPTIONS else EENHEID_OPTIONS[0]
        ingredient_key = get_ingredient_key(row_id, "ingredient")
        eenheid_key = get_ingredient_key(row_id, "eenheid")
        if st.session_state.get(ingredient_key) not in INGREDIENT_OPTIONS:
            st.session_state[ingredient_key] = default_ingredient
        if st.session_state.get(eenheid_key) not in EENHEID_OPTIONS:
            st.session_state[eenheid_key] = default_eenheid
        st.session_state.setdefault(get_ingredient_key(row_id, "omschrijving"), row["omschrijving"])
        st.session_state.setdefault(get_ingredient_key(row_id, "hoeveelheid"), float(row["hoeveelheid"]))
        st.session_state.setdefault(get_ingredient_key(row_id, "prijs"), float(row["prijs"]))
        st.session_state.setdefault(get_ingredient_key(row_id, "benodigd"), float(row["benodigd_in_recept"]))

        structure_locked = allow_only_price or (mode == "Receptafwijking" and is_basis_row is False)
        existing_recipe_locked = mode == "Receptafwijking" and is_basis_row

        with row_cols[0]:
            if allow_recipe_change and not allow_only_price:
                st.selectbox("Ingrediënt", options=INGREDIENT_OPTIONS, key=ingredient_key, label_visibility="collapsed")
            else:
                _read_only_input("Ingrediënt", ingredient_value or "-", f"nb_recalc_name_{row_id}")
        with row_cols[1]:
            if allow_recipe_change and not allow_only_price:
                st.text_input("Omschrijving", key=get_ingredient_key(row_id, "omschrijving"), label_visibility="collapsed")
            else:
                _read_only_input("Omschrijving", row["omschrijving"] or "-", f"nb_recalc_omschrijving_{row_id}")
        with row_cols[2]:
            if allow_recipe_change and not allow_only_price:
                st.number_input("Hoeveelheid", min_value=0.0, step=0.1, format="%.2f", key=get_ingredient_key(row_id, "hoeveelheid"), label_visibility="collapsed")
            else:
                _read_only_input("Hoeveelheid", format_number(row["hoeveelheid"]), f"nb_recalc_hoeveelheid_{row_id}")
        with row_cols[3]:
            if allow_recipe_change and not allow_only_price:
                st.selectbox("Eenheid", options=EENHEID_OPTIONS, key=eenheid_key, label_visibility="collapsed")
            else:
                _read_only_input("Eenheid", row["eenheid"] or "-", f"nb_recalc_eenheid_{row_id}")
        with row_cols[4]:
            if allow_price_change:
                st.number_input("Prijs", min_value=0.0, step=0.01, format="%.2f", key=get_ingredient_key(row_id, "prijs"), label_visibility="collapsed")
            else:
                _read_only_input("Prijs", format_currency_cell_value(row["prijs"]), f"nb_recalc_prijs_{row_id}")
        with row_cols[5]:
            if allow_recipe_change and not allow_only_price:
                st.number_input("Benodigd in recept", min_value=0.0, step=0.01, format="%.2f", key=get_ingredient_key(row_id, "benodigd"), label_visibility="collapsed")
            else:
                _read_only_input("Benodigd in recept", format_number(row["benodigd_in_recept"]), f"nb_recalc_benodigd_{row_id}")

        live_row = collect_ingredient_row_from_widgets(row_id)
        prijs_per_eenheid = calculate_prijs_per_eenheid(live_row)
        kosten_recept = calculate_kosten_recept(live_row)
    else:
        ingredient_value = _ingredient_value(row)
        with row_cols[0]:
            render_read_only_table_cell(ingredient_value or "-")
        with row_cols[1]:
            render_read_only_table_cell(row["omschrijving"] or "-")
        with row_cols[2]:
            render_read_only_table_cell(format_number(row["hoeveelheid"]))
        with row_cols[3]:
            render_read_only_table_cell(row["eenheid"] or "-")
        with row_cols[4]:
            render_read_only_table_cell(format_currency_cell_value(row["prijs"]))
        with row_cols[5]:
            render_read_only_table_cell(format_number(row["benodigd_in_recept"]))

    with row_cols[6]:
        render_currency_table_cell(prijs_per_eenheid)
    with row_cols[7]:
        render_currency_table_cell(kosten_recept)
    with row_cols[8]:
        if render_edit_button(key=f"nb_recalc_edit_{row_id}", disabled=is_editing):
            st.session_state["nb_ingredient_edit_row_id_pending"] = row_id
            st.rerun()
    with row_cols[9]:
        if render_save_button(key=f"nb_recalc_save_{row_id}", disabled=not is_editing):
            save_current_ingredient_row()
            st.rerun()
    with row_cols[10]:
        if render_delete_button(
            key=f"nb_recalc_delete_{row_id}",
            disabled=(mode == "Prijswijziging" and is_basis_row),
        ):
            delete_ingredient_row(get_active_berekening(), row_id)
            st.rerun()


def render_step_4_herberekening() -> None:
    """Toont stap 4 voor herberekeningen."""
    record = get_active_berekening()
    pending_edit_row_id = str(
        st.session_state.pop("nb_ingredient_edit_row_id_pending", "") or ""
    )
    if pending_edit_row_id:
        start_edit_ingredient_row(record, pending_edit_row_id)
        record = get_active_berekening()

    basis_rows = get_hercalculatie_basis_rows(record)
    basis_row_ids = {str(row.get("id", "") or "") for row in basis_rows}

    st.markdown("<div class='section-title'>Herberekening</div>", unsafe_allow_html=True)
    st.markdown(
        "<div class='section-text'>Kies waarom je hercalculeert en pas daarna alleen de relevante onderdelen aan.</div>",
        unsafe_allow_html=True,
    )

    if "nb_hercalculatie_reden" not in st.session_state:
        current_reason = str(record.get("hercalculatie_reden", "") or "")
        st.session_state["nb_hercalculatie_reden"] = (
            current_reason if current_reason in HERCALCULATIE_REDENEN else HERCALCULATIE_REDENEN[0]
        )

    st.radio(
        "Waarom hercalculeren?",
        options=HERCALCULATIE_REDENEN,
        key="nb_hercalculatie_reden",
        horizontal=True,
    )

    mode = str(st.session_state.get("nb_hercalculatie_reden", HERCALCULATIE_REDENEN[0]) or HERCALCULATIE_REDENEN[0])
    if mode == "Prijswijziging":
        st.info("Je past alleen prijzen aan. De bestaande receptopbouw blijft vast staan.")
    elif mode == "Receptafwijking":
        st.info("Je past receptregels aan, maar bestaande prijzen blijven vast. Nieuwe regels mogen wel een prijs krijgen.")
    else:
        st.info("Je kunt zowel recept als prijzen aanpassen.")

    rows = get_step_3_rows_for_view(record)
    headers = [
        "Ingrediënt",
        "Omschrijving",
        "Hoeveelheid",
        "Eenheid",
        "Prijs",
        "Benodigd in recept",
        "Prijs per eenheid",
        "Kosten recept",
        "",
        "",
        "",
    ]
    render_table_headers(headers, [1.7, 2.3, 1.05, 1.0, 1.15, 1.2, 1.15, 0.48, 0.48, 0.48])

    if not rows:
        st.info("Nog geen ingrediënten beschikbaar.")
    else:
        editing_row_id = str(st.session_state.get("nb_ingredient_edit_row_id", "") or "")
        for row in rows:
            _render_ingredient_row_recalculatie(
                row,
                is_editing=row["id"] == editing_row_id,
                basis_row_ids=basis_row_ids,
                mode=mode,
            )

    add_disabled = mode == "Prijswijziging"
    add_col, _ = st.columns([1.2, 4.8])
    with add_col:
        if st.button("Toevoegen", key="nb_recalc_add", disabled=add_disabled):
            sync_active_berekening_from_widgets()
            add_new_ingredient_row(get_active_berekening())
            st.rerun()

    st.write("")
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    _render_step_3_summary(
        get_step_3_rows_for_view(get_active_berekening()),
        int(basisgegevens.get("jaar", 0) or 0) or None,
    )


