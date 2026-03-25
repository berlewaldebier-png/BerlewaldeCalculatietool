from __future__ import annotations

from typing import Callable

import streamlit as st

from components.breadcrumb import render_breadcrumb
from components.page_ui import close_main_card, open_main_card, render_page_header
from utils.storage import ensure_berekeningen_storage, ensure_bieren_storage

from .overview import render_overview
from .state import init_page_state, render_feedback
from .wizard import render_wizard


def show_nieuwe_berekening_page(
    on_back: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    """Toont de pagina Nieuwe berekening via de opgesplitste module-architectuur."""
    del on_logout

    ensure_bieren_storage()
    ensure_berekeningen_storage()
    init_page_state()

    open_main_card()
    render_breadcrumb(current_label="Nieuwe berekening", on_home_click=on_back)

    if st.session_state.get("nieuwe_berekening_view_mode") != "wizard":
        render_page_header(
            "Nieuwe berekening",
            "Maak en beheer hier kostprijsberekeningen op basis van de integrale kostprijsmethodiek.",
        )
        render_feedback()
        render_overview(on_back)
        close_main_card()
        return

    render_page_header("Nieuwe berekening", "Wizard voor kostprijsberekeningen")
    render_feedback()
    render_wizard()
    close_main_card()
