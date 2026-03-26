from __future__ import annotations

import streamlit as st

from . import state


def render_step_3() -> None:
    state._render_step_heading("Berekening", "Werk hier het voorstel uit.")
    state._hydrate_widget("bier_key")
    state._hydrate_widget("product_bier_keys")
    jaar = int(state._form_value("jaar", state._default_year()) or state._default_year())
    voorstel_type = str(state._form_value("type", state.VOORSTELTYPE_LITERS))
    kanaal = str(state._form_value("kanaal", "horeca") or "horeca")
    liters_basis = str(state._form_value("liters_basis", state.LITERS_BASIS_EEN_BIER) or state.LITERS_BASIS_EEN_BIER)
    options, labels = state._bier_options(jaar)
    bier_widget_key = state._widget_key("bier_key")
    if str(st.session_state.get(bier_widget_key, state._form_value("bier_key", "")) or "") not in options:
        st.session_state[bier_widget_key] = ""
        state._get_form_state()["bier_key"] = ""

    with st.container():
        if voorstel_type == state.VOORSTELTYPE_LITERS:
            if liters_basis == state.LITERS_BASIS_EEN_BIER:
                st.selectbox("Bier", options=options, format_func=lambda key: labels.get(key, key), key=bier_widget_key)
                bier_key = str(st.session_state.get(bier_widget_key, "") or "")
                if not bier_key:
                    st.info("Selecteer eerst een bier om de berekening op te bouwen.")
                else:
                    hoogste_kostprijs, bronjaar = state._highest_cost_for_bier(jaar, bier_key)
                    referentieprijs = state._calculate_price_from_margin(hoogste_kostprijs, state._kanaal_marge(jaar, kanaal))
                    info_cols = st.columns(3)
                    with info_cols[0]:
                        state.render_read_only_table_cell(state._format_euro(hoogste_kostprijs))
                        st.caption(f"Hoogste kostprijs per liter ({bronjaar or '-'})")
                    with info_cols[1]:
                        state.render_read_only_table_cell(state._format_euro(referentieprijs))
                        st.caption(f"Referentieprijs {state.KANAAL_LABELS.get(kanaal, kanaal)} per liter")
                    with info_cols[2]:
                        state.render_read_only_table_cell(state._format_percentage(state._kanaal_marge(jaar, kanaal)))
                        st.caption("Kanaalwinstmarge verkoopstrategie")
                    state._render_liters_table(jaar, bier_key)
            elif liters_basis == state.LITERS_BASIS_MEERDERE_BIEREN:
                st.info("Voeg hieronder een of meer bieren toe. Per bier reken ik met de hoogste bekende kostprijs en dezelfde referentiestrategie.")
                state._render_multi_beer_table(jaar)
            else:
                hoogste_kostprijs, bronjaar, bronbier = state._highest_cost_overall(jaar)
                referentieprijs = state._calculate_price_from_margin(hoogste_kostprijs, state._kanaal_marge(jaar, kanaal))
                info_cols = st.columns(3)
                with info_cols[0]:
                    state.render_read_only_table_cell(state._format_euro(hoogste_kostprijs))
                    st.caption(f"Algemene hoogste kostprijs per liter ({bronjaar or '-'})")
                with info_cols[1]:
                    state.render_read_only_table_cell(str(bronbier or "-"))
                    st.caption("Bronbier hoogste kostprijs")
                with info_cols[2]:
                    state.render_read_only_table_cell(state._format_euro(referentieprijs))
                    st.caption(f"Referentieprijs {state.KANAAL_LABELS.get(kanaal, kanaal)} per liter")
                state._render_liters_table(jaar, "")
        else:
            bier_keys_widget = state._widget_key("product_bier_keys")
            valid_selected = [key for key in list(st.session_state.get(bier_keys_widget, state._selected_product_bier_keys()) or []) if key in options and key]
            st.session_state[bier_keys_widget] = valid_selected
            st.multiselect(
                "Bieren",
                options=[key for key in options if key],
                default=valid_selected,
                format_func=lambda key: labels.get(key, key),
                key=bier_keys_widget,
            )
            selected_bier_keys = [str(key or "") for key in st.session_state.get(bier_keys_widget, []) if str(key or "")]
            state._get_form_state()["product_bier_keys"] = selected_bier_keys
            state._get_form_state()["bier_key"] = selected_bier_keys[0] if selected_bier_keys else ""
            if not selected_bier_keys:
                st.info("Selecteer eerst een of meer bieren om de berekening op te bouwen.")
            else:
                product_rows = state._combined_product_rows_for_bieren(jaar, selected_bier_keys)
                if not product_rows:
                    st.warning("Voor de geselecteerde bieren zijn nog geen producten beschikbaar vanuit stap 4 van 'Nieuwe kostprijsberekening'.")
                else:
                    st.info(f"De basisprijzen volgen eerst 'Overzicht bieren' en anders de default uit 'Marges per jaar' voor kanaal {state.KANAAL_LABELS.get(kanaal, kanaal)}.")
                    state._render_products_table(product_rows)

