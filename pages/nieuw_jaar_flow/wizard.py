from __future__ import annotations

import streamlit as st

from components.wizard_ui import (
    apply_wizard_navigation_styles,
    render_step_sidebar,
    render_wizard_nav_row,
)

from .state import STEP_KEY, STEP_LABELS, STATE_KEY, build_plan, can_go_next
from .step_1_basis import render_step_1
from .step_2_jaarset import render_step_2
from .step_3_berekeningen import render_step_3
from .step_4_controle import render_step_4
from .step_5_afronden import render_step_5


def _render_step_navigation() -> None:
    current_step = int(st.session_state.get(STEP_KEY, 0))
    render_step_sidebar(
        STEP_LABELS,
        current_step + 1,
        key_prefix="nieuw_jaar_step",
        css_prefix="ny",
        on_step_click=lambda index: _set_current_step(index - 1),
    )


def _set_current_step(step_index: int) -> None:
    st.session_state[STEP_KEY] = step_index
    st.rerun()


def _render_navigation(on_back) -> None:
    current_step = int(st.session_state.get(STEP_KEY, 0))
    apply_wizard_navigation_styles()
    buttons = [
        {"label": "Terug naar welkom", "key": "nieuw_jaar_back"},
        None,
        {"label": "Vorige", "key": "nieuw_jaar_prev"} if current_step > 0 else None,
        {
            "label": "Volgende",
            "key": "nieuw_jaar_next",
            "type": "primary",
            "disabled": current_step >= len(STEP_LABELS) - 1 or not can_go_next(),
        },
    ]
    clicked = render_wizard_nav_row([1.2, 2.4, 1.2, 1.2], buttons)
    if clicked.get("nieuw_jaar_back"):
        on_back()
    if clicked.get("nieuw_jaar_prev"):
        st.session_state[STEP_KEY] = current_step - 1
        st.rerun()
    if clicked.get("nieuw_jaar_next"):
        st.session_state[STEP_KEY] = current_step + 1
        st.rerun()


def render_wizard(on_back) -> None:
    state = st.session_state[STATE_KEY]
    plan = build_plan(state)
    current_step = int(st.session_state.get(STEP_KEY, 0))

    nav_col, content_col = st.columns([1.15, 5.0])
    with nav_col:
        _render_step_navigation()
    with content_col:
        if current_step == 0:
            render_step_1(state)
        elif current_step == 1:
            render_step_2(state, plan)
        elif current_step == 2:
            render_step_3(state, plan)
        elif current_step == 3:
            render_step_4(plan)
        else:
            render_step_5(state, plan)

    _render_navigation(on_back)
