from __future__ import annotations

import streamlit as st

from components.table_ui import render_read_only_table_cell, render_table_headers

from .state import format_euro


def render_step_3(state: dict, plan: dict) -> None:
    st.markdown(
        "<div class='section-text'>Definitieve berekeningen uit het bronjaar kunnen als concept naar het doeljaar worden gekopieerd. Daarna rekenen ze automatisch opnieuw met de gegevens van het doeljaar.</div>",
        unsafe_allow_html=True,
    )
    state["copy_berekeningen"] = st.checkbox(
        "Definitieve berekeningen als concept dupliceren",
        value=bool(state.get("copy_berekeningen", True)),
    )

    rows = plan["berekening_rows"]
    if not rows:
        st.info("Er zijn geen definitieve berekeningen gevonden in het bronjaar.")
        return

    headers = ["Bier", "Stijl", "Soort", f"Kostprijs {plan['source_year']}", f"Kostprijs {plan['target_year']}", "Status"]
    widths = [2.4, 1.2, 1.1, 1.2, 1.2, 1.6]
    render_table_headers(headers, widths)

    for row in rows:
        cols = st.columns(widths)
        with cols[0]:
            render_read_only_table_cell(row["biernaam"])
        with cols[1]:
            render_read_only_table_cell(row["stijl"])
        with cols[2]:
            render_read_only_table_cell(row["soort"])
        with cols[3]:
            render_read_only_table_cell(format_euro(row["bron_kostprijs"]))
        with cols[4]:
            render_read_only_table_cell(
                format_euro(row["nieuwe_kostprijs"]) if row["nieuwe_kostprijs"] is not None else "-"
            )
        with cols[5]:
            render_read_only_table_cell("Bestaat al" if row["exists_in_target"] else "Nieuw concept")
