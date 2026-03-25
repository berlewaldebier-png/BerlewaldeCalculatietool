from __future__ import annotations

from datetime import datetime

import streamlit as st

from utils.storage import get_productie_years

from .state import (
    BELASTINGSOORT_OPTIONS,
    BTW_TARIEF_OPTIONS,
    TARIEF_ACCIJNS_OPTIONS,
)


def render_step_1() -> bool:
    """Toont stap 1: basisgegevens."""
    available_years = get_productie_years()
    if not available_years:
        available_years = [datetime.now().year]
    if st.session_state.get("nb_basis_jaar") not in available_years:
        st.session_state["nb_basis_jaar"] = available_years[0]

    st.markdown(
        "<div class='section-title'>Basisgegevens</div>",
        unsafe_allow_html=True,
    )
    st.markdown(
        "<div class='section-text'>Vul hier de algemene gegevens van de berekening in. Deze gegevens worden gebruikt in de vervolgstappen.</div>",
        unsafe_allow_html=True,
    )

    st.selectbox("Jaartal", options=available_years, key="nb_basis_jaar")
    st.text_input("Biernaam", key="nb_basis_biernaam")

    style_col, alcohol_col = st.columns([2, 1])
    with style_col:
        st.text_input("Stijl", key="nb_basis_stijl")
    with alcohol_col:
        st.number_input(
            "Alcoholpercentage",
            min_value=0.0,
            step=0.1,
            format="%.1f",
            key="nb_basis_alcoholpercentage",
        )

    if st.session_state.get("nb_basis_belastingsoort", "Accijns") != "Accijns":
        st.session_state["nb_basis_tarief_accijns"] = "Hoog"

    belasting_col, tarief_col, btw_col = st.columns([1.2, 1, 1])
    with belasting_col:
        st.selectbox(
            "Belastingsoort",
            options=BELASTINGSOORT_OPTIONS,
            key="nb_basis_belastingsoort",
        )
    with tarief_col:
        st.selectbox(
            "Tarief accijns",
            options=TARIEF_ACCIJNS_OPTIONS,
            key="nb_basis_tarief_accijns",
            disabled=st.session_state.get("nb_basis_belastingsoort") != "Accijns",
        )
    with btw_col:
        st.selectbox(
            "BTW-tarief",
            options=BTW_TARIEF_OPTIONS,
            key="nb_basis_btw_tarief",
        )

    return True
