from __future__ import annotations

from datetime import date

import streamlit as st


def parse_nl_date(value: str | None) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        day, month, year = text.split("-")
        return date(int(year), int(month), int(day))
    except (TypeError, ValueError):
        return None


def format_nl_date(value: date | None) -> str:
    if not isinstance(value, date):
        return ""
    return value.strftime("%d-%m-%Y")


def ensure_date_widget_value(key: str, value: str | date | None) -> None:
    if key in st.session_state:
        return
    if isinstance(value, date):
        st.session_state[key] = value
        return
    parsed = parse_nl_date(str(value or ""))
    st.session_state[key] = parsed if parsed is not None else None
