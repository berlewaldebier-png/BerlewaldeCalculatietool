from __future__ import annotations

from typing import Callable

import streamlit as st

from components.page_ui import render_page_header
from .state import (
    _render_navigation,
    _render_step_indicator,
)
from .step_1_basisgegevens import render_step_1
from .step_2_uitgangspunten import render_step_2
from .step_3_berekening import render_step_3
from .step_4_adviesprijzen import render_step_4
from .step_5_afronden import render_step_5


def render_prijsvoorstel_wizard(
    on_back: Callable[[], None],
    page_title: str = "",
    page_subtitle: str = "",
) -> None:
    sidebar_col, content_col = st.columns([0.82, 3.95], gap="large")
    with sidebar_col:
        _render_step_indicator()
    with content_col:
        if page_title:
            render_page_header(page_title, page_subtitle)
        current_step = int(st.session_state.get("prijsvoorstel_step", 1))
        if current_step == 1:
            render_step_1()
        elif current_step == 2:
            render_step_2()
        elif current_step == 3:
            render_step_3()
        elif current_step == 4:
            render_step_4()
        else:
            render_step_5()
        st.write("")
        _render_navigation(on_back)

