from __future__ import annotations

import streamlit as st

from components.table_ui import (
    render_currency_table_cell,
    render_read_only_table_cell,
    render_table_headers,
)
from .state import format_number, get_active_berekening, get_inkoop_record_totals, get_record_inkoop_facturen


def render_step_4_facturen() -> None:
    """Toont een read-only overzicht van gekoppelde facturen."""
    record = get_active_berekening()
    facturen = get_record_inkoop_facturen(record)

    st.markdown("<div class='section-title'>Gekoppelde facturen</div>", unsafe_allow_html=True)
    st.markdown(
        "<div class='section-text'>Deze facturen zijn gekoppeld aan de berekening. Bewerken doe je via Inkoopfacturen.</div>",
        unsafe_allow_html=True,
    )

    if not facturen:
        st.info("Er zijn nog geen gekoppelde facturen.")
        return

    headers = ["Factuurnr.", "Factuurdatum", "Regels", "Liters", "Totale kosten"]
    widths = [1.2, 1.2, 0.8, 1.0, 1.1]
    render_table_headers(headers, widths)

    for factuur in facturen:
        rows = factuur.get("factuurregels", [])
        if not isinstance(rows, list):
            rows = []
        totaal_liters = sum(float(row.get("liters", 0.0) or 0.0) for row in rows)
        totale_kosten = (
            sum(float(row.get("subfactuurbedrag", 0.0) or 0.0) for row in rows)
            + float(factuur.get("verzendkosten", 0.0) or 0.0)
            + float(factuur.get("overige_kosten", 0.0) or 0.0)
        )
        cols = st.columns(widths)
        with cols[0]:
            render_read_only_table_cell(str(factuur.get("factuurnummer", "") or "-"))
        with cols[1]:
            render_read_only_table_cell(str(factuur.get("factuurdatum", "") or "-"))
        with cols[2]:
            render_read_only_table_cell(str(len(rows)))
        with cols[3]:
            render_read_only_table_cell(f"{format_number(totaal_liters)} L")
        with cols[4]:
            render_currency_table_cell(totale_kosten)

    totals = get_inkoop_record_totals(record)
    summary_cols = st.columns(3)
    with summary_cols[0]:
        render_read_only_table_cell(f"{format_number(totals.get('totaal_liters', 0.0))} L")
        st.caption("Totaal liters")
    with summary_cols[1]:
        render_currency_table_cell(totals.get("totaal_subfactuurbedrag", 0.0))
        st.caption("Totaal subbedragen")
    with summary_cols[2]:
        render_currency_table_cell(
            float(totals.get("totaal_subfactuurbedrag", 0.0) or 0.0)
            + float(totals.get("totale_extra_kosten", 0.0) or 0.0)
        )
        st.caption("Totale kosten")

