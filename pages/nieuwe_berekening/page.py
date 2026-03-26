from __future__ import annotations

from typing import Callable

import streamlit as st

from components.breadcrumb import render_breadcrumb
from components.page_ui import close_main_card, open_main_card, render_page_header
from utils.storage import ensure_berekeningen_storage, ensure_bieren_storage

from .overview import render_overview
from .state import get_active_berekening, init_page_state, render_feedback
from .wizard import render_wizard


def show_nieuwe_kostprijsberekening_page(
    on_back: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    """Toont de pagina Nieuwe kostprijsberekening via de opgesplitste module-architectuur."""
    del on_logout

    ensure_bieren_storage()
    ensure_berekeningen_storage()
    init_page_state()

    open_main_card()
    render_breadcrumb(current_label="Nieuwe kostprijsberekening", on_home_click=on_back)

    if st.session_state.get("nieuwe_berekening_view_mode") != "wizard":
        render_page_header(
            "Nieuwe kostprijsberekening",
            "Maak en beheer hier kostprijsberekeningen op basis van de integrale kostprijsmethodiek.",
        )
        render_feedback()
        render_overview(on_back)
        close_main_card()
        return

    active_record = get_active_berekening()
    basisgegevens = active_record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    biernaam = str(basisgegevens.get("biernaam", "") or "").strip()
    bronjaar = int(basisgegevens.get("jaar", 0) or 0)
    is_existing = bool(str(active_record.get("id", "") or "").strip()) and bool(biernaam)
    title = (
        f"Aanpassen kostprijs {biernaam} {bronjaar}"
        if is_existing
        else "Nieuwe kostprijsberekening"
    )
    render_feedback()
    render_wizard(title, "")
    close_main_card()

