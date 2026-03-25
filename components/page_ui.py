from __future__ import annotations

import streamlit as st


def render_page_header(title: str, subtitle: str | None = None) -> None:
    """Toont een consistente paginakop."""
    st.markdown(f"<div class='page-title'>{title}</div>", unsafe_allow_html=True)
    if subtitle:
        st.markdown(f"<div class='page-subtitle'>{subtitle}</div>", unsafe_allow_html=True)


def open_main_card() -> None:
    """Opent de standaard hoofdcontainer voor pagina-inhoud."""
    st.markdown("<div class='main-card'>", unsafe_allow_html=True)


def close_main_card() -> None:
    """Sluit de standaard hoofdcontainer voor pagina-inhoud."""
    st.markdown("</div>", unsafe_allow_html=True)
