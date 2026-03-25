from __future__ import annotations

from typing import Callable

import streamlit as st

from components.breadcrumb import render_breadcrumb
from components.page_ui import close_main_card, open_main_card
from .overview import render_prijsvoorstel_overview
from .state import VIEW_MODE_KEY, init_page_state, render_feedback
from .wizard import render_prijsvoorstel_wizard


def show_prijsvoorstel_page(
    on_back: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    del on_logout
    init_page_state()
    open_main_card()
    render_breadcrumb(current_label="Prijsvoorstel maken", on_home_click=on_back)
    render_feedback()

    if str(st.session_state.get(VIEW_MODE_KEY, "overview") or "overview") == "overview":
        render_prijsvoorstel_overview(on_back)
    else:
        render_prijsvoorstel_wizard(on_back)

    close_main_card()
