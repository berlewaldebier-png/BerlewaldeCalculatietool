from __future__ import annotations

from typing import Callable

import streamlit as st

from components.breadcrumb import render_breadcrumb
from components.page_ui import close_main_card, open_main_card, render_page_header


def show_beheer_page(
    on_back: Callable[[], None],
    on_open_users: Callable[[], None],
    on_open_handleiding: Callable[[], None],
    on_open_deployment: Callable[[], None],
    is_test_environment: bool,
) -> None:
    """Toont de beheerpagina met links naar beheerhulppagina's."""
    render_breadcrumb("Beheer", on_back)
    open_main_card()
    render_page_header("Beheer", "Extra beheerpagina's en instructies")

    cols = st.columns(3, gap="large")
    with cols[0]:
        if st.button("👥 Users", key="beheer_users", use_container_width=True):
            on_open_users()
    with cols[1]:
        if st.button("📘 Handleiding", key="beheer_handleiding", use_container_width=True):
            on_open_handleiding()
    with cols[2]:
        if is_test_environment:
            if st.button("🚀 Deployment instructie", key="beheer_deployment", use_container_width=True):
                on_open_deployment()
        else:
            st.write("")

    st.write("")
    if st.button("Terug naar home", key="beheer_back_home"):
        on_back()
    close_main_card()
