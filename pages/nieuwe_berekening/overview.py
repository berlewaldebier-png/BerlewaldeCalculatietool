from __future__ import annotations

from typing import Any

import streamlit as st

from components.action_buttons import render_delete_button, render_edit_button
from components.table_ui import render_read_only_table_cell, render_table_headers
from utils.storage import (
    delete_berekening,
    get_concept_berekeningen,
    get_definitieve_berekeningen,
    get_definitieve_berekeningen_for_year,
)

from .state import format_euro_per_liter, set_feedback, start_edit_berekening, start_new_berekening


def _render_concept_berekeningen(records: list[dict[str, Any]]) -> None:
    """Toont conceptberekeningen in overzichtsvorm."""
    st.markdown(
        "<div class='section-title' style='font-size:1.35rem;'>Concept berekeningen</div>",
        unsafe_allow_html=True,
    )

    if not records:
        st.info("Nog geen concept berekeningen")
        return

    headers = ["Jaar", "Biernaam", "Stijl", "Status", "", ""]
    row_widths = [0.9, 2.2, 1.4, 1.0, 0.42, 0.42]
    render_table_headers(headers, row_widths)

    for record in records:
        record_id = str(record.get("id", ""))
        basisgegevens = record.get("basisgegevens", {})
        if not isinstance(basisgegevens, dict):
            basisgegevens = {}
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            render_read_only_table_cell(str(int(basisgegevens.get("jaar", 0) or 0) or "-"))
        with row_cols[1]:
            render_read_only_table_cell(str(basisgegevens.get("biernaam", "") or "-"))
        with row_cols[2]:
            render_read_only_table_cell(str(basisgegevens.get("stijl", "") or "-"))
        with row_cols[3]:
            render_read_only_table_cell(str(record.get("status", "concept") or "concept").capitalize())
        with row_cols[4]:
            if render_edit_button(key=f"nb_concept_edit_{record_id}"):
                start_edit_berekening(record_id)
                st.rerun()
        with row_cols[5]:
            if render_delete_button(key=f"nb_concept_delete_{record_id}"):
                delete_berekening(record_id)
                set_feedback("Concept verwijderd.")
                st.rerun()


def _render_definitieve_berekeningen(
    records: list[dict[str, Any]],
    *,
    show_year_column: bool,
) -> None:
    """Toont definitieve berekeningen in overzichtsvorm."""
    st.markdown(
        "<div class='section-title' style='font-size:1.35rem;'>Definitieve bieren</div>",
        unsafe_allow_html=True,
    )

    if not records:
        st.info("Nog geen definitieve berekeningen")
        return

    if show_year_column:
        row_widths = [0.9, 2.0, 1.3, 1.7, 0.42, 0.42]
        headers = ["Jaar", "Biernaam", "Stijl", "Integrale kostprijs per liter", "", ""]
    else:
        row_widths = [2.2, 1.5, 1.9, 0.42, 0.42]
        headers = ["Biernaam", "Stijl", "Integrale kostprijs per liter", "", ""]
    render_table_headers(headers, row_widths)

    for record in records:
        record_id = str(record.get("id", ""))
        basisgegevens = record.get("basisgegevens", {})
        if not isinstance(basisgegevens, dict):
            basisgegevens = {}
        resultaat_snapshot = record.get("resultaat_snapshot", {})
        if not isinstance(resultaat_snapshot, dict):
            resultaat_snapshot = {}

        if show_year_column:
            row_cols = st.columns(row_widths)
            offset = 1
            with row_cols[0]:
                render_read_only_table_cell(str(int(basisgegevens.get("jaar", 0) or 0) or "-"))
        else:
            row_cols = st.columns(row_widths)
            offset = 0

        with row_cols[0 + offset]:
            render_read_only_table_cell(str(basisgegevens.get("biernaam", "") or "-"))
        with row_cols[1 + offset]:
            render_read_only_table_cell(str(basisgegevens.get("stijl", "") or "-"))
        with row_cols[2 + offset]:
            render_read_only_table_cell(
                format_euro_per_liter(resultaat_snapshot.get("integrale_kostprijs_per_liter")),
            )
        with row_cols[3 + offset]:
            if render_edit_button(key=f"nb_definitief_edit_{record_id}"):
                start_edit_berekening(record_id)
                st.rerun()
        with row_cols[4 + offset]:
            if render_delete_button(key=f"nb_definitief_delete_{record_id}"):
                delete_berekening(record_id)
                set_feedback("Definitieve berekening verwijderd.")
                st.rerun()


def render_overview(on_back) -> None:
    """Rendert het overzicht van Nieuwe berekening."""
    top_col, spacer_col = st.columns([1.2, 4.8])
    with top_col:
        if st.button("Toevoegen", key="nieuwe_berekening_add"):
            start_new_berekening()
            st.rerun()
    with spacer_col:
        st.write("")

    _render_concept_berekeningen(get_concept_berekeningen())
    st.write("")

    definitieve_records = get_definitieve_berekeningen()
    available_years = sorted(
        {
            int(record.get("basisgegevens", {}).get("jaar", 0) or 0)
            for record in definitieve_records
            if int(record.get("basisgegevens", {}).get("jaar", 0) or 0) > 0
        }
    )
    options: list[int | str] = ["Alles", *available_years]
    if st.session_state.get("nieuwe_berekening_overview_year") not in options:
        st.session_state["nieuwe_berekening_overview_year"] = "Alles"

    selected_year = st.selectbox(
        "Jaar",
        options=options,
        key="nieuwe_berekening_overview_year",
    )
    filtered_records = (
        definitieve_records
        if selected_year == "Alles"
        else get_definitieve_berekeningen_for_year(selected_year)
    )
    _render_definitieve_berekeningen(
        filtered_records,
        show_year_column=selected_year == "Alles",
    )

    col_back, _ = st.columns([1, 4])
    with col_back:
        if st.button("Terug naar home", key="nieuwe_berekening_back_home"):
            on_back()
