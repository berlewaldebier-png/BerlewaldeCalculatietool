from __future__ import annotations

import streamlit as st

from .state import CALCULATION_OPTIONS, get_active_berekening, has_linked_facturen


def render_step_2() -> None:
    """Toont stap 2: soort berekening."""
    record = get_active_berekening()
    has_facturen_lock = has_linked_facturen(record)
    is_recalculatie = str(record.get("calculation_variant", "origineel") or "origineel") == "hercalculatie"
    is_locked = has_facturen_lock or is_recalculatie
    lock_help = (
        "Soort berekening is niet meer aan te passen ivm gekoppelde facturen. "
        "Verwijder eerst het bier in overzicht en maak daarna eventueel een nieuwe berekening."
    )
    recalculatie_help = (
        "Soort berekening is niet aan te passen tijdens een hercalculatie. "
        "Deze hercalculatie blijft gekoppeld aan de oorspronkelijke berekening."
    )

    st.markdown(
        "<div class='section-title'>Soort berekening</div>",
        unsafe_allow_html=True,
    )
    st.radio(
        "Soort berekening",
        options=CALCULATION_OPTIONS,
        key="nb_soort_type",
        disabled=is_locked,
        help=(
            recalculatie_help
            if is_recalculatie
            else lock_help if has_facturen_lock else None
        ),
    )
    if is_locked:
        st.caption(recalculatie_help if is_recalculatie else lock_help)
    st.markdown(
        """
        <div class='section-text'>
            In deze fase leggen we vooral de structuur vast. De gekozen soort berekening wordt al persistent in de berekening opgeslagen.
        </div>
        """,
        unsafe_allow_html=True,
    )

