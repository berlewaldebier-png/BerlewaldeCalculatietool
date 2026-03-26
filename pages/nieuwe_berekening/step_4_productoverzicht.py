from __future__ import annotations

from typing import Any

import streamlit as st

from components.table_ui import (
    format_currency_cell_value,
    render_currency_table_cell,
    render_read_only_table_cell,
    render_table_headers,
)
from .state import (
    build_step_4_product_tables,
    format_number,
    get_active_berekening,
)


def _calculate_kostprijs(row: dict[str, Any]) -> float:
    """Telt de zichtbare kostencomponenten op tot één kostprijs."""
    try:
        return (
            float(row.get("variabele_kosten", 0.0) or 0.0)
            + float(row.get("verpakkingskosten", 0.0) or 0.0)
            + float(row.get("vaste_directe_kosten", 0.0) or 0.0)
            + float(row.get("accijns", 0.0) or 0.0)
        )
    except (TypeError, ValueError):
        return 0.0


def _render_products_table(
    title: str,
    rows: list[dict[str, Any]],
    *,
    calculation_type: str,
) -> None:
    """Rendert een read-only kostprijstabel."""
    st.markdown(
        f"<div class='section-title' style='font-size:1.2rem;'>{title}</div>",
        unsafe_allow_html=True,
    )

    if not rows:
        st.info(f"Nog geen {title.lower()} beschikbaar.")
        return

    kosten_label = "Inkoop" if calculation_type == "Inkoop" else "Ingrediënten"
    vaste_kosten_label = (
        "Indirecte kosten"
        if calculation_type == "Inkoop"
        else "Directe kosten"
    )
    headers = [
        "Biernaam",
        "Soort",
        "Verpakkingseenheid",
        kosten_label,
        "Verpakking",
        vaste_kosten_label,
        "Accijns",
        "Kostprijs",
    ]
    row_widths = [1.6, 1.4, 1.9, 1.1, 1.1, 1.2, 1.0, 1.1]
    render_table_headers(headers, row_widths)

    for row in rows:
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            render_read_only_table_cell(str(row.get("biernaam", "-") or "-"))
        with row_cols[1]:
            render_read_only_table_cell(str(row.get("soort", "-") or "-"))
        with row_cols[2]:
            render_read_only_table_cell(str(row.get("verpakking", "-") or "-"))
        with row_cols[3]:
            render_currency_table_cell(row.get("variabele_kosten"))
        with row_cols[4]:
            render_currency_table_cell(row.get("verpakkingskosten"))
        with row_cols[5]:
            render_currency_table_cell(row.get("vaste_directe_kosten"))
        with row_cols[6]:
            render_currency_table_cell(row.get("accijns"))
        with row_cols[7]:
            render_currency_table_cell(_calculate_kostprijs(row))


def render_step_4() -> None:
    """Toont stap 4 als read-only kostprijs-overzicht en afrondstap."""
    record = get_active_berekening()
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    soort_berekening = record.get("soort_berekening", {})
    if not isinstance(soort_berekening, dict):
        soort_berekening = {}

    tables = build_step_4_product_tables(record)
    tarieven_record = tables.get("tarieven_record", {})
    if not isinstance(tarieven_record, dict):
        tarieven_record = {}

    st.markdown(
        "<div class='section-title'>Samenvatting</div>",
        unsafe_allow_html=True,
    )
    st.markdown(
        "<div class='section-text'>Hier zie je per verpakking de afgeleide kosten op basis van stap 1 t/m 3. Deze stap is read-only en wordt gebruikt als laatste controle voor afronden.</div>",
        unsafe_allow_html=True,
    )

    context_col_1, context_col_2, context_col_3 = st.columns(3)
    soort = str(soort_berekening.get("type", "Eigen productie") or "Eigen productie")
    kosten_per_liter_label = (
        "Gemiddelde inkoop per liter"
        if soort == "Inkoop"
        else "Gemiddelde variabele kosten per liter"
    )
    vaste_kosten_per_liter_label = (
        "Gemiddelde indirecte kosten per liter"
        if soort == "Inkoop"
        else "Gemiddelde directe kosten per liter"
    )
    integrale_kostprijs_per_liter = (
        float(tables.get("variabele_kosten_per_liter", 0.0) or 0.0)
        + float(tables.get("directe_vaste_kosten_per_liter", 0.0) or 0.0)
    )
    with context_col_1:
        st.markdown(
            f"""
            <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">{kosten_per_liter_label}</div>
                <div style="font-size:1.05rem;font-weight:700;color:#24332b;">{format_currency_cell_value(tables.get("variabele_kosten_per_liter"))}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with context_col_2:
        st.markdown(
            f"""
            <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">{vaste_kosten_per_liter_label}</div>
                <div style="font-size:1.05rem;font-weight:700;color:#24332b;">{format_currency_cell_value(tables.get("directe_vaste_kosten_per_liter"))}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with context_col_3:
        st.markdown(
            f"""
            <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">Gemiddelde integrale kostprijs per liter</div>
                <div style="font-size:1.05rem;font-weight:700;color:#24332b;">{format_currency_cell_value(integrale_kostprijs_per_liter)}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )

    jaar = int(basisgegevens.get("jaar", 0) or 0)
    biernaam = str(basisgegevens.get("biernaam", "") or "-")
    tarief_type = str(tables.get("tarief_type", "-") or "-")
    alcoholpercentage = float(basisgegevens.get("alcoholpercentage", 0.0) or 0.0)
    st.markdown(
        f"<div class='section-text'><strong>Bier:</strong> {biernaam} | <strong>Soort berekening:</strong> {soort} | <strong>Jaar:</strong> {jaar or '-'} | <strong>Accijnstarief:</strong> {tarief_type} | <strong>Alcoholpercentage:</strong> {format_number(alcoholpercentage, 1)}%</div>",
        unsafe_allow_html=True,
    )

    if soort == "Inkoop":
        with st.expander("Toelichting inkoopkosten"):
            st.markdown(
                "<div class='section-text' style='margin-bottom:0;'>Inkoopkosten komen uit stap 3 en volgen daar de prijs per eenheid van de gekozen inkoopeenheid.</div>",
                unsafe_allow_html=True,
            )

    if not tarieven_record:
        st.info("Er zijn nog geen tarieven en heffingen beschikbaar voor dit jaar. Accijns wordt daarom nu als 0,00 getoond.")

    st.write("")
    _render_products_table(
        "Basisproducten",
        tables.get("basisproducten", []),
        calculation_type=soort,
    )
    st.write("")
    _render_products_table(
        "Samengestelde producten",
        tables.get("samengestelde_producten", []),
        calculation_type=soort,
    )

