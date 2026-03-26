from __future__ import annotations

import streamlit as st

from .state import source_year_options


def render_step_1(state: dict) -> None:
    source_options = source_year_options()
    from utils.storage import get_productie_years

    productie_years = get_productie_years()
    st.markdown(
        "<div class='section-text'>Kies hier het bronjaar en het doeljaar dat je wilt voorbereiden. Het doeljaar wordt daarna gevuld via duplicaties en conceptberekeningen.</div>",
        unsafe_allow_html=True,
    )
    if not source_options:
        st.warning("Er zijn nog geen bruikbare bronjaren beschikbaar om over te nemen.")
        return

    source_index = source_options.index(state["source_year"]) if state["source_year"] in source_options else 0
    source_year = st.selectbox("Bronjaar", options=source_options, index=source_index)
    target_default = int(state.get("target_year") or (source_year + 1))
    target_year = int(
        st.number_input(
            "Doeljaar",
            min_value=2000,
            max_value=2100,
            value=target_default,
            step=1,
        )
    )
    state["source_year"] = source_year
    state["target_year"] = target_year

    lines = [
        f"Productiejaren bekend: {', '.join(str(year) for year in productie_years) if productie_years else 'nog geen jaren'}",
        f"Doeljaar al aanwezig in Productie: {'Ja' if target_year in productie_years else 'Nee'}",
        f"Doeljaar hoger dan bronjaar: {'Ja' if target_year > source_year else 'Nee'}",
    ]
    for line in lines:
        st.markdown(f"<div class='section-text'>{line}</div>", unsafe_allow_html=True)

    if target_year <= source_year:
        st.error("Het doeljaar moet hoger zijn dan het bronjaar.")

