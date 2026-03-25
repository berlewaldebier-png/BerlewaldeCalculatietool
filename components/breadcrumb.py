from __future__ import annotations

from typing import Callable

import streamlit as st


def render_breadcrumb(
    current_label: str,
    on_home_click: Callable[[], None],
    home_label: str = "Home",
) -> None:
    """Toont een subtiele breadcrumb met klikbare home-link."""
    breadcrumb_html = """
    <style>
    .breadcrumb-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.25rem;
        font-size: 0.9rem;
        color: #8a948a;
    }

    .breadcrumb-separator,
    .breadcrumb-current {
        color: #6f796f;
    }
    </style>
    """
    st.markdown(breadcrumb_html, unsafe_allow_html=True)

    col_home, col_sep, col_current, col_spacer = st.columns([0.12, 0.04, 0.2, 0.64])
    with col_home:
        if st.button(home_label, key=f"breadcrumb_{current_label}_home"):
            on_home_click()
    with col_sep:
        st.markdown(
            "<div class='breadcrumb-row'><span class='breadcrumb-separator'>&gt;</span></div>",
            unsafe_allow_html=True,
        )
    with col_current:
        st.markdown(
            f"<div class='breadcrumb-row'><span class='breadcrumb-current'>{current_label}</span></div>",
            unsafe_allow_html=True,
        )
