from __future__ import annotations

import streamlit as st

from components.table_ui import render_read_only_table_cell

from .state import (
    _format_date_nl,
    _get_form_state,
    _hydrate_widget,
    _render_step_heading,
    _widget_key,
    _form_value,
    get_next_prijsvoorstel_offertenummer,
)


def render_step_1() -> None:
    _render_step_heading("Basisgegevens", "Leg hier de basis van het prijsvoorstel vast.")
    if not str(_form_value("offertenummer", "") or "").strip():
        _get_form_state()["offertenummer"] = get_next_prijsvoorstel_offertenummer()
        _get_form_state()["datum_text"] = _format_date_nl(_form_value("datum"))
    _hydrate_widget("klantnaam")
    _hydrate_widget("contactpersoon")
    _hydrate_widget("referentie")
    _hydrate_widget("datum_text")
    render_read_only_table_cell(str(_form_value("offertenummer", "") or "-"))
    st.caption("Offertenummer")
    col_1, col_2 = st.columns(2)
    with col_1:
        st.text_input("Klantnaam", key=_widget_key("klantnaam"))
    with col_2:
        st.text_input("Contactpersoon", key=_widget_key("contactpersoon"))
    col_3, col_4 = st.columns(2)
    with col_3:
        st.text_input("Referentie / voorstelnaam", key=_widget_key("referentie"))
    with col_4:
        st.text_input("Datum", key=_widget_key("datum_text"), placeholder="DD-MM-YYYY")

