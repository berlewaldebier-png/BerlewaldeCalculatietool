from __future__ import annotations

from typing import Callable

import streamlit as st

from components.breadcrumb import render_breadcrumb
from components.page_ui import close_main_card, open_main_card, render_page_header
from components.table_ui import render_read_only_table_cell, render_table_headers
from utils.storage import ensure_berekeningen_storage, ensure_bieren_storage, get_definitieve_berekeningen

from pages.nieuwe_berekening.state import format_euro_per_liter, start_recalculatie_berekening


def _eigen_productie_records() -> list[dict]:
    return [
        record
        for record in get_definitieve_berekeningen()
        if str(record.get("soort_berekening", {}).get("type", "") or "") == "Eigen productie"
    ]


def _render_overview(on_open_wizard: Callable[[], None]) -> None:
    st.markdown(
        "<div class='section-text'>Kies hieronder een definitief bier uit eigen productie om een nieuwe concept-hercalculatie te starten.</div>",
        unsafe_allow_html=True,
    )

    records = _eigen_productie_records()
    if not records:
        st.info("Nog geen definitieve bieren uit eigen productie beschikbaar.")
        return

    headers = ["Jaar", "Biernaam", "Stijl", "Integrale kostprijs per liter", ""]
    row_widths = [0.9, 2.0, 1.4, 1.8, 0.7]
    render_table_headers(headers, row_widths)

    for record in records:
        record_id = str(record.get("id", "") or "")
        basisgegevens = record.get("basisgegevens", {})
        if not isinstance(basisgegevens, dict):
            basisgegevens = {}
        resultaat_snapshot = record.get("resultaat_snapshot", {})
        if not isinstance(resultaat_snapshot, dict):
            resultaat_snapshot = {}

        row_cols = st.columns(row_widths)
        with row_cols[0]:
            render_read_only_table_cell(str(int(basisgegevens.get("jaar", 0) or 0) or "-"))
        with row_cols[1]:
            render_read_only_table_cell(str(basisgegevens.get("biernaam", "") or "-"))
        with row_cols[2]:
            render_read_only_table_cell(str(basisgegevens.get("stijl", "") or "-"))
        with row_cols[3]:
            render_read_only_table_cell(
                format_euro_per_liter(resultaat_snapshot.get("integrale_kostprijs_per_liter")),
            )
        with row_cols[4]:
            if st.button("Hercalculeren", key=f"recept_hercalculatie_{record_id}"):
                start_recalculatie_berekening(record_id)
                on_open_wizard()


def show_recept_hercalculatie_page(
    on_back: Callable[[], None],
    on_open_kostprijsberekening: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    """Toont de pagina Recept hercalculeren."""
    del on_logout

    ensure_bieren_storage()
    ensure_berekeningen_storage()

    open_main_card()
    render_breadcrumb(current_label="Recept hercalculeren", on_home_click=on_back)
    render_page_header(
        "Recept hercalculeren",
        "Start hier een nieuwe concept-hercalculatie op basis van een bestaand definitief bier uit eigen productie.",
    )
    _render_overview(on_open_kostprijsberekening)
    close_main_card()

