from __future__ import annotations

import streamlit as st

from .state import (
    KANAAL_LABELS,
    LITERS_BASIS_LABELS,
    VOORSTELTYPE_LITERS,
    VOORSTELTYPE_PRODUCTEN,
    _default_year,
    _form_value,
    _format_percentage,
    _has_strategy_for_year,
    _hydrate_widget,
    _kanaal_marge,
    _render_step_heading,
    _widget_key,
    _year_options,
)


def render_step_2() -> None:
    _render_step_heading(
        "Uitgangspunten",
        "Kies hier het verkoopjaar, het voorsteltype en het referentiekanaal.",
    )
    _hydrate_widget("jaar")
    _hydrate_widget("type")
    _hydrate_widget("liters_basis")
    _hydrate_widget("kanaal")
    col_1, col_2 = st.columns(2)
    with col_1:
        available_years = _year_options()
        current_year = int(
            st.session_state.get(
                _widget_key("jaar"),
                _form_value("jaar", available_years[-1]),
            )
            or available_years[-1]
        )
        if current_year not in available_years:
            current_year = available_years[-1]
            st.session_state[_widget_key("jaar")] = current_year
        st.selectbox(
            "Verkoopjaar",
            options=available_years,
            index=available_years.index(current_year),
            key=_widget_key("jaar"),
        )
    with col_2:
        st.selectbox(
            "Voorsteltype",
            options=[VOORSTELTYPE_LITERS, VOORSTELTYPE_PRODUCTEN],
            key=_widget_key("type"),
        )
    voorstel_type = str(
        st.session_state.get(_widget_key("type"), _form_value("type", VOORSTELTYPE_LITERS))
        or VOORSTELTYPE_LITERS
    )
    if voorstel_type == VOORSTELTYPE_LITERS:
        st.selectbox(
            "Bereken liters op basis van",
            options=list(LITERS_BASIS_LABELS.keys()),
            format_func=lambda key: LITERS_BASIS_LABELS.get(key, key),
            key=_widget_key("liters_basis"),
        )
    st.selectbox(
        "Referentiekanaal",
        options=list(KANAAL_LABELS.keys()),
        format_func=lambda key: KANAAL_LABELS.get(key, key),
        key=_widget_key("kanaal"),
    )
    jaar = int(st.session_state.get(_widget_key("jaar"), _form_value("jaar", _default_year())) or _default_year())
    if _has_strategy_for_year(jaar):
        kanaal = str(st.session_state.get(_widget_key("kanaal"), _form_value("kanaal", "horeca")) or "horeca")
        default_margin = _kanaal_marge(jaar, kanaal)
        st.info(
            f"Voor verkoopjaar {jaar} zijn standaardmarges beschikbaar. Zodra je in stap 3 een bier en verpakking kiest, kijkt de app eerst naar 'Overzicht bieren' en anders naar 'Marges per jaar'. Huidige default voor {KANAAL_LABELS.get(kanaal, kanaal)}: {_format_percentage(default_margin)}."
        )
    else:
        st.warning("Voor dit verkoopjaar is nog geen verkoopstrategie beschikbaar.")

