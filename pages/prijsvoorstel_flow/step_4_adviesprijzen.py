from __future__ import annotations

import streamlit as st

from . import state


def render_step_4() -> None:
    state._render_step_heading(
        "Samenvatting",
        "Controleer hieronder de commerciële samenvatting voor de groothandel en vergelijk die met jullie adviesprijzen per kanaal.",
    )
    voorstel_type = str(state._form_value("type", state.VOORSTELTYPE_LITERS))
    jaar = int(state._form_value("jaar", state._default_year()) or state._default_year())
    kanaal = str(state._form_value("kanaal", "horeca") or "horeca")
    bier_key = str(state._form_value("bier_key", "") or "")
    liters_basis = str(state._form_value("liters_basis", state.LITERS_BASIS_EEN_BIER) or state.LITERS_BASIS_EEN_BIER)
    bier_record = state._latest_record_for_bier(jaar, bier_key) if bier_key else None
    basisgegevens = bier_record.get("basisgegevens", {}) if isinstance(bier_record, dict) else {}
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    st.markdown(
        f"<div class='section-text'><strong>Klant:</strong> {str(state._form_value('klantnaam', '') or '-')} | <strong>Voorsteltype:</strong> {voorstel_type} | <strong>Verkoopjaar:</strong> {jaar} | <strong>Kanaal:</strong> {state.KANAAL_LABELS.get(kanaal, kanaal)}</div>",
        unsafe_allow_html=True,
    )

    if voorstel_type == state.VOORSTELTYPE_LITERS:
        rows = state._liters_results()
        st.markdown("<div class='section-title' style='font-size:1.2rem;'>Groothandelsoverzicht</div>", unsafe_allow_html=True)
        if liters_basis == state.LITERS_BASIS_MEERDERE_BIEREN:
            headers = ["Bier", "Verpakking", "Liters", "Inkoopprijs / L", "Adviesprijs horeca / L", "Onze winstmarge"]
            row_widths = [1.35, 1.6, 0.8, 1.1, 1.2, 1.0]
        elif liters_basis == state.LITERS_BASIS_EEN_BIER:
            headers = ["Verpakking", "Liters", "Inkoopprijs / L", "Adviesprijs zakelijk / L", "Adviesprijs retail / L", "Adviesprijs horeca / L", "Adviesprijs slijterij / L", "Onze winstmarge"]
            row_widths = [1.6, 0.8, 1.1, 1.15, 1.15, 1.15, 1.15, 1.0]
        else:
            headers = ["Liters", "Inkoopprijs / L", "Adviesprijs zakelijk / L", "Adviesprijs retail / L", "Adviesprijs horeca / L", "Adviesprijs slijterij / L", "Onze winstmarge"]
            row_widths = [0.8, 1.15, 1.15, 1.15, 1.15, 1.15, 1.0]
        state.render_table_headers(headers, row_widths)
        for row in rows:
            liters = float(row.get("liters", 0.0) or 0.0)
            kostprijs_per_liter = (float(row.get("kosten", 0.0) or 0.0) / liters) if liters > 0 else 0.0
            adviesprijzen = state._effective_channel_prices_for_cost(
                jaar,
                kostprijs_per_liter,
                bier_key=str(row.get("bier_key", "") or bier_key),
                product_key=str(row.get("product_key", "") or ""),
                verpakking=str(row.get("verpakking", "") or ""),
            )
            row_cols = st.columns(row_widths)
            if liters_basis == state.LITERS_BASIS_MEERDERE_BIEREN:
                with row_cols[0]:
                    state.render_read_only_table_cell(str(row.get("biernaam", "-") or "-"))
                with row_cols[1]:
                    state.render_read_only_table_cell(str(row.get("verpakking", "-") or "-"))
                with row_cols[2]:
                    state.render_read_only_table_cell(f"{liters:.2f}")
                with row_cols[3]:
                    state.render_read_only_table_cell(state._format_euro(row.get("prijs_per_liter")))
                with row_cols[4]:
                    state.render_read_only_table_cell(state._format_euro(adviesprijzen.get("horeca")))
                with row_cols[5]:
                    state.render_read_only_table_cell(state._format_percentage(row.get("marge_pct")))
            elif liters_basis == state.LITERS_BASIS_EEN_BIER:
                with row_cols[0]:
                    state.render_read_only_table_cell(str(row.get("verpakking", "-") or "-"))
                with row_cols[1]:
                    state.render_read_only_table_cell(f"{liters:.2f}")
                with row_cols[2]:
                    state.render_read_only_table_cell(state._format_euro(row.get("prijs_per_liter")))
                with row_cols[3]:
                    state.render_read_only_table_cell(state._format_euro(adviesprijzen.get("zakelijk")))
                with row_cols[4]:
                    state.render_read_only_table_cell(state._format_euro(adviesprijzen.get("retail")))
                with row_cols[5]:
                    state.render_read_only_table_cell(state._format_euro(adviesprijzen.get("horeca")))
                with row_cols[6]:
                    state.render_read_only_table_cell(state._format_euro(adviesprijzen.get("slijterij")))
                with row_cols[7]:
                    state.render_read_only_table_cell(state._format_percentage(row.get("marge_pct")))
            else:
                with row_cols[0]:
                    state.render_read_only_table_cell(f"{liters:.2f}")
                with row_cols[1]:
                    state.render_read_only_table_cell(state._format_euro(row.get("prijs_per_liter")))
                with row_cols[2]:
                    state.render_read_only_table_cell(state._format_euro(adviesprijzen.get("zakelijk")))
                with row_cols[3]:
                    state.render_read_only_table_cell(state._format_euro(adviesprijzen.get("retail")))
                with row_cols[4]:
                    state.render_read_only_table_cell(state._format_euro(adviesprijzen.get("horeca")))
                with row_cols[5]:
                    state.render_read_only_table_cell(state._format_euro(adviesprijzen.get("slijterij")))
                with row_cols[6]:
                    state.render_read_only_table_cell(state._format_percentage(row.get("marge_pct")))
        return

    rows = state._product_results()
    st.markdown("<div class='section-title' style='font-size:1.2rem;'>Groothandelsoverzicht</div>", unsafe_allow_html=True)
    headers = ["Bier", "Product", "Aantal", "Kostprijs / stuk", "Adviesprijs zakelijk", "Adviesprijs retail", "Adviesprijs horeca", "Adviesprijs slijterij", "Onze winstmarge"]
    row_widths = [1.3, 1.45, 0.7, 1.05, 1.0, 1.0, 1.0, 1.0, 0.9]
    state.render_table_headers(headers, row_widths)
    for row in rows:
        row_bier_key = str(row.get("bier_key", "") or "")
        product_key = next(
            (
                str(product_row.get("product_key", "") or "")
                for product_row in state._current_product_rows()
                if str(product_row.get("id", "") or "") == str(row.get("id", "") or "")
            ),
            "",
        )
        product_pricing = state._product_map_for_bier(jaar, row_bier_key).get(product_key, {})
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            state.render_read_only_table_cell(str(row.get("biernaam", "-") or "-"))
        with row_cols[1]:
            state.render_read_only_table_cell(str(row.get("verpakking", "-") or "-"))
        with row_cols[2]:
            state.render_read_only_table_cell(f"{float(row.get('aantal', 0.0) or 0.0):.2f}")
        with row_cols[3]:
            state.render_read_only_table_cell(state._format_euro(row.get("kostprijs")))
        with row_cols[4]:
            state.render_read_only_table_cell(state._format_euro(product_pricing.get("zakelijk")))
        with row_cols[5]:
            state.render_read_only_table_cell(state._format_euro(product_pricing.get("retail")))
        with row_cols[6]:
            state.render_read_only_table_cell(state._format_euro(product_pricing.get("horeca")))
        with row_cols[7]:
            state.render_read_only_table_cell(state._format_euro(product_pricing.get("slijterij")))
        with row_cols[8]:
            state.render_read_only_table_cell(state._format_percentage(row.get("marge_pct")))

