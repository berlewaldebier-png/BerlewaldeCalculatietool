from __future__ import annotations

import streamlit as st

from components.wizard_ui import (
    apply_wizard_navigation_styles,
    render_step_sidebar,
    render_wizard_nav_row,
)

from .state import (
    TOTAL_STEPS,
    clear_step_1_widget_state,
    clear_step_2_widget_state,
    clear_step_3_inkoop_widget_state,
    ensure_step_1_widget_state,
    ensure_step_2_widget_state,
    ensure_step_3_widget_state,
    finalize_active_berekening,
    get_active_berekening,
    return_to_overview,
    save_active_as_concept,
    sync_active_inkoop_state_from_widgets,
    sync_active_berekening_from_widgets,
)
from .step_1_basisgegevens import render_step_1
from .step_2_soort_berekening import render_step_2
from .step_3_invoer import render_step_3
from .step_4_productoverzicht import render_step_4


def _step_titles(calculation_type: str) -> dict[int, str]:
    """Geeft de huidige staplabels terug."""
    return {
        1: "Basisgegevens",
        2: "Soort berekening",
        3: "Ingrediënten" if calculation_type == "Eigen productie" else "Inkoop",
        4: "Samenvatting",
    }


def _go_to_step(step_number: int) -> None:
    current_step = int(st.session_state.get("nieuwe_berekening_step", 1))
    calculation_type = str(
        st.session_state.get("nb_soort_type", "Eigen productie") or "Eigen productie"
    )

    if current_step == 3 and calculation_type == "Inkoop":
        sync_active_inkoop_state_from_widgets()
        clear_step_3_inkoop_widget_state()
    else:
        sync_active_berekening_from_widgets()

    if step_number == 3 and calculation_type == "Inkoop":
        clear_step_3_inkoop_widget_state()
    if step_number == 1:
        clear_step_1_widget_state()
    elif step_number == 2:
        clear_step_2_widget_state()

    st.session_state["nieuwe_berekening_step"] = step_number
    st.rerun()


def _render_step_indicator() -> None:
    """Toont de voortgang van de wizard in een verticale zijbalk."""
    active_record = get_active_berekening()
    current_step = int(st.session_state.get("nieuwe_berekening_step", 1))
    calculation_type = str(
        active_record.get("soort_berekening", {}).get("type", "Eigen productie")
        or "Eigen productie"
    )
    titles = _step_titles(calculation_type)
    render_step_sidebar(
        [titles[step_number] for step_number in range(1, TOTAL_STEPS + 1)],
        current_step,
        key_prefix="nb_step_indicator",
        css_prefix="nb",
        on_step_click=_go_to_step,
        accent_color="#fbb614",
    )


def _render_navigation() -> None:
    """Toont de wizardnavigatie."""
    current_step = int(st.session_state.get("nieuwe_berekening_step", 1))
    calculation_type = str(
        st.session_state.get("nb_soort_type", "Eigen productie") or "Eigen productie"
    )
    apply_wizard_navigation_styles()

    if current_step == 1:
        clicked = render_wizard_nav_row(
            [1.5, 3.0, 1, 1],
            [
                {"label": "Terug naar overzicht", "key": "nb_nav_back"},
                None,
                {"label": "Opslaan", "key": "nb_nav_save_step_1"},
                {"label": "Volgende", "key": "nb_nav_next_step_1", "type": "primary"},
            ],
        )
        if clicked.get("nb_nav_back"):
            if current_step == 3 and calculation_type == "Inkoop":
                sync_active_inkoop_state_from_widgets()
                clear_step_3_inkoop_widget_state()
                return_to_overview(skip_sync=True)
            else:
                return_to_overview()
            st.rerun()
        if clicked.get("nb_nav_save_step_1") and save_active_as_concept():
            st.rerun()
        if clicked.get("nb_nav_next_step_1"):
            sync_active_berekening_from_widgets()
            st.session_state["nieuwe_berekening_step"] = 2
            st.rerun()
        return

    next_label = "Afronden" if current_step >= TOTAL_STEPS else "Volgende"
    next_key = "nb_nav_finalize" if current_step >= TOTAL_STEPS else f"nb_nav_next_{current_step}"
    clicked = render_wizard_nav_row(
        [1.3, 1, 2.7, 1, 1],
        [
            {"label": "Terug naar overzicht", "key": f"nb_nav_back_{current_step}"},
            {"label": "Vorige", "key": f"nb_nav_prev_{current_step}"},
            None,
            {"label": "Opslaan", "key": f"nb_nav_save_{current_step}"},
            {"label": next_label, "key": next_key, "type": "primary"},
        ],
    )
    if clicked.get(f"nb_nav_back_{current_step}"):
        if current_step == 3 and calculation_type == "Inkoop":
            sync_active_inkoop_state_from_widgets()
            clear_step_3_inkoop_widget_state()
            return_to_overview(skip_sync=True)
        else:
            return_to_overview()
        st.rerun()
    if clicked.get(f"nb_nav_prev_{current_step}"):
        if current_step == 3 and calculation_type == "Inkoop":
            sync_active_inkoop_state_from_widgets()
            clear_step_3_inkoop_widget_state()
        else:
            sync_active_berekening_from_widgets()
        target_step = max(1, current_step - 1)
        if target_step == 3 and calculation_type == "Inkoop":
            clear_step_3_inkoop_widget_state()
        if target_step == 1:
            clear_step_1_widget_state()
        elif target_step == 2:
            clear_step_2_widget_state()
        st.session_state["nieuwe_berekening_step"] = target_step
        st.rerun()
    if clicked.get(f"nb_nav_save_{current_step}") and save_active_as_concept():
        st.rerun()
    if clicked.get(next_key):
        if current_step >= TOTAL_STEPS:
            if finalize_active_berekening():
                st.rerun()
        else:
            if current_step == 3 and calculation_type == "Inkoop":
                sync_active_inkoop_state_from_widgets()
                clear_step_3_inkoop_widget_state()
            else:
                sync_active_berekening_from_widgets()
            target_step = min(TOTAL_STEPS, current_step + 1)
            if target_step == 3 and calculation_type == "Inkoop":
                clear_step_3_inkoop_widget_state()
            st.session_state["nieuwe_berekening_step"] = target_step
            st.rerun()


def render_wizard() -> None:
    """Rendert de wizard voor Nieuwe berekening."""
    active_record = get_active_berekening()
    sidebar_col, content_col = st.columns([1.15, 3.85], gap="large")

    with sidebar_col:
        _render_step_indicator()

    with content_col:
        current_step = int(st.session_state.get("nieuwe_berekening_step", 1))
        if current_step == 1:
            ensure_step_1_widget_state(active_record)
            render_step_1()
        elif current_step == 2:
            ensure_step_2_widget_state(active_record)
            render_step_2()
        elif current_step == 3:
            ensure_step_3_widget_state(active_record)
            render_step_3()
        else:
            ensure_step_3_widget_state(active_record)
            render_step_4()

        st.write("")
        _render_navigation()
