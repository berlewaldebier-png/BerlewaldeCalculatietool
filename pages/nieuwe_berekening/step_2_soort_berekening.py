from __future__ import annotations

import streamlit as st

from .state import CALCULATION_OPTIONS


def render_step_2() -> None:
    """Toont stap 2: soort berekening."""
    st.markdown(
        "<div class='section-title'>Soort berekening</div>",
        unsafe_allow_html=True,
    )
    st.radio(
        "Soort berekening",
        options=CALCULATION_OPTIONS,
        key="nb_soort_type",
    )
    st.markdown(
        """
        <div class='section-text'>
            In deze fase leggen we vooral de structuur vast. De gekozen soort berekening wordt al persistent in de berekening opgeslagen.
        </div>
        """,
        unsafe_allow_html=True,
    )
