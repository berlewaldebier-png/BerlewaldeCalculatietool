from __future__ import annotations

from typing import Callable

import streamlit as st

from components.breadcrumb import render_breadcrumb
from components.page_ui import close_main_card, open_main_card, render_page_header


def show_users_page(on_back: Callable[[], None]) -> None:
    """Toont een placeholderpagina voor gebruikersbeheer."""
    render_breadcrumb("Users", on_back, home_label="Beheer")
    open_main_card()
    render_page_header("Users", "Placeholder voor gebruikersbeheer")
    st.info("Gebruikersbeheer en rechten volgen later.")
    if st.button("Terug naar beheer", key="users_back"):
        on_back()
    close_main_card()
