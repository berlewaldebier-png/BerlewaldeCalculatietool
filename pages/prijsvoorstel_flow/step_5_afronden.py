from __future__ import annotations

import streamlit as st

from . import state


def render_step_5() -> None:
    state._render_step_heading(
        "Afronden",
        "Voeg hier nog een interne notitie toe. PDF-export en verdere afronding kunnen we hierna verder inkleden.",
    )
    state._hydrate_widget("opmerking")
    st.write("")
    st.text_area(
        "Interne notitie",
        key=state._widget_key("opmerking"),
        placeholder="Bijvoorbeeld: voorstel voor eerste groothandelsgesprek, prijzen nog intern afstemmen.",
        height=120,
    )
    st.info("PDF-export en verdere afronding kunnen we hierna als vervolgstap toevoegen.")

