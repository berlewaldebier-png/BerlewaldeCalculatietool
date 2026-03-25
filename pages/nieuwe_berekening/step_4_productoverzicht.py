from __future__ import annotations

from typing import Any

import streamlit as st

from components.table_ui import render_read_only_table_cell, render_table_headers
from .state import (
    build_step_4_product_tables,
    format_number,
    get_active_berekening,
)


def _format_euro(amount: float | int | None) -> str:
    """Formatteert een bedrag in euro-notatie."""
    try:
        value = float(amount or 0.0)
    except (TypeError, ValueError):
        value = 0.0
    formatted = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"EUR {formatted}"

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

    kosten_label = "Inkoop in €" if calculation_type == "Inkoop" else "Ingrediënten in €"
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
        "Verpakking in €",
        vaste_kosten_label,
        "Accijns",
    ]
    row_widths = [1.6, 1.4, 1.9, 1.1, 1.1, 1.2, 1.0]
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
            render_read_only_table_cell(_format_euro(row.get("variabele_kosten")))
        with row_cols[4]:
            render_read_only_table_cell(_format_euro(row.get("verpakkingskosten")))
        with row_cols[5]:
            render_read_only_table_cell(_format_euro(row.get("vaste_directe_kosten")))
        with row_cols[6]:
            render_read_only_table_cell(_format_euro(row.get("accijns")))


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
        "Inkoopkosten per liter"
        if soort == "Inkoop"
        else "Variabele kosten per liter"
    )
    vaste_kosten_per_liter_label = (
        "Indirecte vaste kosten per liter"
        if soort == "Inkoop"
        else "Directe vaste kosten per liter"
    )
    with context_col_1:
        st.markdown(
            f"""
            <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">{kosten_per_liter_label}</div>
                <div style="font-size:1.05rem;font-weight:700;color:#24332b;">{_format_euro(tables.get("variabele_kosten_per_liter"))}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with context_col_2:
        st.markdown(
            f"""
            <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">{vaste_kosten_per_liter_label}</div>
                <div style="font-size:1.05rem;font-weight:700;color:#24332b;">{_format_euro(tables.get("directe_vaste_kosten_per_liter"))}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with context_col_3:
        batchgrootte = tables.get("batchgrootte_l")
        batchgrootte_label = (
            f"{format_number(batchgrootte)} L"
            if batchgrootte is not None
            else "Niet beschikbaar"
        )
        st.markdown(
            f"""
            <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">Batchgrootte</div>
                <div style="font-size:1.05rem;font-weight:700;color:#24332b;">{batchgrootte_label}</div>
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
        st.info("Er zijn nog geen tarieven en heffingen beschikbaar voor dit jaar. Accijns wordt daarom nu als EUR 0,00 getoond.")

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
