from __future__ import annotations

from collections.abc import Sequence

import streamlit as st


_HEADER_STYLE = (
    "font-size:0.82rem;"
    "color:#6b766b;"
    "font-weight:700;"
    "margin-bottom:0.45rem;"
    "padding-bottom:0.35rem;"
    "border-bottom:1px solid #d9ddcf;"
)

_READ_ONLY_CELL_STYLE = (
    "min-height:2.5rem;"
    "display:flex;"
    "align-items:center;"
    "padding:0.45rem 0.7rem;"
    "border:1px solid #d9ddcf;"
    "border-radius:0.5rem;"
    "background:#f7f8f3;"
    "color:#24332b;"
    "font-size:0.95rem;"
)


def render_table_headers(
    headers: Sequence[str],
    widths: Sequence[float | int],
) -> None:
    """Render een consistente tabelkop voor custom Streamlit-tabellen."""
    header_cols = st.columns(list(widths))
    for col, label in zip(header_cols, headers):
        with col:
            if label:
                st.markdown(
                    f"<div style='{_HEADER_STYLE}'>{label}</div>",
                    unsafe_allow_html=True,
                )


def render_read_only_table_cell(value: str) -> None:
    """Render een consistente read-only cel in tabelstijl."""
    st.markdown(
        f"""
        <div style="{_READ_ONLY_CELL_STYLE}">
            {value}
        </div>
        """,
        unsafe_allow_html=True,
    )


def format_currency_cell_value(value: float | int | None) -> str:
    """Formatteert een bedrag voor gebruik in standaard tabelcellen."""
    try:
        amount = float(value or 0.0)
    except (TypeError, ValueError):
        amount = 0.0
    formatted = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return "\u20ac " + formatted


def render_currency_table_cell(value: float | int | None) -> None:
    """Render een consistente tabelcel voor bedragen."""
    render_read_only_table_cell(format_currency_cell_value(value))
