from __future__ import annotations

import streamlit as st

from .overview import render_component_overview


def render_step_4(plan: dict) -> None:
    st.markdown(
        "<div class='section-text'>Hier zie je wat de wizard gaat klaarzetten voor het doeljaar en welke onderdelen daarna nog gecontroleerd moeten worden.</div>",
        unsafe_allow_html=True,
    )
    render_component_overview(plan)
    st.markdown(
        f"<div class='section-text'><strong>Definitieve berekeningen bronjaar {plan['source_year']}:</strong> {plan['source_record_count']}</div>",
        unsafe_allow_html=True,
    )
    st.markdown(
        f"<div class='section-text'><strong>Nieuwe conceptberekeningen voor {plan['target_year']}:</strong> {plan['ready_record_count'] if st.session_state.get('nieuw_jaar_state', {}).get('copy_berekeningen', True) else 0}</div>",
        unsafe_allow_html=True,
    )
