from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

import streamlit as st


def render_step_sidebar(
    step_labels: Sequence[str],
    current_step: int,
    *,
    key_prefix: str,
    css_prefix: str,
    on_step_click: Callable[[int], None],
    title: str = "Stappen",
    accent_color: str = "#eadf9b",
    compact: bool = False,
) -> None:
    """Toont een consistente verticale wizard-zijbalk."""
    hover_background = "transparent" if compact else "#eef3ee"
    border_radius = "0" if compact else "8px"
    padding = "0.1rem 0" if compact else "0.35rem 0.4rem"
    button_height = "1.8rem" if compact else "2.2rem"
    button_bg = "transparent"
    sidebar_border = "1px solid #d9ddcf" if compact else "1px solid #e2e6dc"
    sidebar_background = "#f8f8f4"

    st.markdown(
        f"""
        <style>
        .{css_prefix}-wizard-sidebar {{
            border: {sidebar_border};
            border-radius: 16px;
            padding: 1rem;
            background: {sidebar_background};
            position: sticky;
            top: 1rem;
        }}

        .{css_prefix}-wizard-sidebar-title {{
            font-size: 0.82rem;
            color: #6b766b;
            font-weight: 700;
            margin-bottom: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }}

        .{css_prefix}-step-icon {{
            width: 1.8rem;
            height: 1.8rem;
            min-width: 1.8rem;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.95rem;
            font-weight: 700;
            color: #7b877d;
            border-radius: 999px;
            border: 1px solid #d3d9d1;
            background: transparent;
        }}

        .{css_prefix}-step-icon-active {{
            background: {accent_color};
            border-color: {accent_color};
            box-shadow: 0 0 0 3px rgba(47, 174, 102, 0.12);
            color: #ffffff;
        }}

        .{css_prefix}-step-icon-completed {{
            background: #e3e9e1;
            border-color: #b8c4b8;
            color: #4f6356;
        }}

        .{css_prefix}-wizard-sidebar div[data-testid="stButton"] > button {{
            background: {button_bg} !important;
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
            color: #5b6b60;
            display: flex !important;
            justify-content: flex-start !important;
            text-align: left !important;
            width: 100% !important;
            align-items: center;
            padding: {padding};
            min-height: {button_height};
            height: auto;
            font-weight: 500;
            line-height: 1.2;
            border-radius: {border_radius};
        }}

        .{css_prefix}-wizard-sidebar div[data-testid="stButton"] > button:hover {{
            background: {hover_background} !important;
            color: #24332b;
            box-shadow: none !important;
        }}

        .{css_prefix}-wizard-sidebar div[data-testid="stButton"] > button:disabled {{
            background: transparent !important;
            border: none !important;
            color: #24332b;
            opacity: 1;
            box-shadow: none !important;
        }}

        .{css_prefix}-wizard-sidebar div[data-testid="stButton"] {{
            margin-bottom: 0.45rem;
            width: 100%;
        }}
        </style>
        """,
        unsafe_allow_html=True,
    )

    st.markdown(f"<div class='{css_prefix}-wizard-sidebar'>", unsafe_allow_html=True)
    st.markdown(
        f"<div class='{css_prefix}-wizard-sidebar-title'>{title}</div>",
        unsafe_allow_html=True,
    )

    for index, label in enumerate(step_labels, start=1):
        is_active = index == current_step
        is_completed = index < current_step
        icon_class = (
            f"{css_prefix}-step-icon-active"
            if is_active
            else f"{css_prefix}-step-icon-completed"
            if is_completed
            else ""
        )
        icon_col, button_col = st.columns([0.22, 0.78], gap="small")
        with icon_col:
            st.markdown(
                f"<div class='{css_prefix}-step-icon {icon_class}'>{index}</div>",
                unsafe_allow_html=True,
            )
        with button_col:
            if st.button(
                str(label),
                key=f"{key_prefix}_{index}",
                use_container_width=True,
                disabled=is_active,
            ):
                on_step_click(index)
    st.markdown("</div>", unsafe_allow_html=True)


def apply_wizard_navigation_styles() -> None:
    """Past de gedeelde styling voor wizard-navigatieknoppen toe."""
    st.markdown(
        """
        <style>
        div[data-testid="stButton"] > button {
            white-space: nowrap;
            min-height: 3rem;
            height: 3rem;
        }
        div[data-testid="stButton"] > button[kind="secondary"] {
            background: transparent;
            color: #24332b;
            border: 1px solid #d9ddcf;
            box-shadow: none;
        }
        div[data-testid="stButton"] > button[kind="secondary"]:hover {
            background: #f6f4ed;
            border-color: #c9d1c5;
            color: #1f2b24;
        }
        div[data-testid="stButton"] > button[kind="primary"] {
            background: #eadf9b;
            color: #3a3112;
            border: 1px solid #d8ca79;
            box-shadow: none;
        }
        div[data-testid="stButton"] > button[kind="primary"]:hover {
            background: #e3d484;
            color: #332b10;
            border-color: #cdbd64;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_wizard_nav_row(
    widths: Sequence[float | int],
    buttons: Sequence[dict[str, Any] | None],
) -> dict[str, bool]:
    """Rendert een generieke wizardknoppenrij en geeft klikstatus per key terug."""
    columns = st.columns(list(widths))
    clicked: dict[str, bool] = {}
    for column, config in zip(columns, buttons):
        with column:
            if not config:
                st.write("")
                continue
            key = str(config["key"])
            clicked[key] = st.button(
                str(config.get("label", "")),
                key=key,
                use_container_width=bool(config.get("use_container_width", True)),
                type=str(config.get("type", "secondary") or "secondary"),
                disabled=bool(config.get("disabled", False)),
                help=config.get("help"),
                icon=config.get("icon"),
            )
    return clicked
