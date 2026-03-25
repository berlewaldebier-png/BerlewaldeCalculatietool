from __future__ import annotations

from typing import Any

import streamlit as st

from components.table_ui import render_read_only_table_cell, render_table_headers
from utils.storage import get_batchgrootte_eigen_productie_l, load_samengestelde_producten

from .state import (
    add_new_ingredient_row,
    add_new_inkoop_row,
    calculate_kosten_recept,
    calculate_inkoop_prijs_per_eenheid,
    calculate_inkoop_prijs_per_liter,
    calculate_prijs_per_eenheid,
    calculate_toegerekende_extra_kosten_per_row,
    collect_ingredient_row_from_widgets,
    collect_inkoop_row_from_widgets,
    delete_ingredient_row,
    delete_inkoop_row,
    EENHEID_OPTIONS,
    format_number,
    get_active_berekening,
    get_ingredient_key,
    get_inkoop_key,
    get_record_inkoop_rows,
    get_step_3_rows_for_view,
    get_step_3_inkoop_rows_for_view,
    INGREDIENT_OPTIONS,
    save_current_ingredient_row,
    save_current_inkoop_row,
    start_edit_ingredient_row,
    start_edit_inkoop_row,
    sync_active_berekening_from_widgets,
)
from components.action_buttons import (
    render_delete_button,
    render_edit_button,
    render_save_button,
)


def _render_read_only_cell(label: str, value: str, key: str) -> None:
    """Toont een compact read-only veld in tabelstijl."""
    st.text_input(
        label,
        value=value,
        disabled=True,
        key=key,
        label_visibility="collapsed",
    )


def _get_inkoop_product_options() -> tuple[list[str], dict[str, str]]:
    """Geeft beschikbare samengestelde producten terug voor de inkoopdropdown."""
    products = load_samengestelde_producten()
    options = [""]
    labels = {"": "Selecteer inkoopeenheid"}

    for product in products:
        product_id = str(product.get("id", "") or "")
        if not product_id:
            continue
        options.append(product_id)
        labels[product_id] = str(product.get("omschrijving", product_id) or product_id)

    return options, labels


def _render_ingredient_row(row: dict[str, Any], is_editing: bool) -> None:
    """Render één ingrediëntregel."""
    row_id = row["id"]
    prijs_per_eenheid = calculate_prijs_per_eenheid(row)
    kosten_recept = calculate_kosten_recept(row)
    confirm_delete_row_id = str(
        st.session_state.get("nb_ingredient_delete_confirm_row_id", "") or ""
    )

    row_cols = st.columns([1.7, 1.9, 1.6, 1.0, 0.95, 0.95, 1.1, 1.05, 1.05, 0.48, 0.48, 0.48])

    if is_editing:
        default_ingredient = row["ingrediënt"] if row["ingrediënt"] in INGREDIENT_OPTIONS else INGREDIENT_OPTIONS[-1]
        default_eenheid = row["eenheid"] if row["eenheid"] in EENHEID_OPTIONS else EENHEID_OPTIONS[0]
        ingredient_key = get_ingredient_key(row_id, "ingredient")
        eenheid_key = get_ingredient_key(row_id, "eenheid")
        if st.session_state.get(ingredient_key) not in INGREDIENT_OPTIONS:
            st.session_state[ingredient_key] = default_ingredient
        if st.session_state.get(eenheid_key) not in EENHEID_OPTIONS:
            st.session_state[eenheid_key] = default_eenheid
        st.session_state.setdefault(get_ingredient_key(row_id, "omschrijving"), row["omschrijving"])
        st.session_state.setdefault(get_ingredient_key(row_id, "leverancier"), row["leverancier"])
        st.session_state.setdefault(get_ingredient_key(row_id, "hoeveelheid"), float(row["hoeveelheid"]))
        st.session_state.setdefault(get_ingredient_key(row_id, "prijs"), float(row["prijs"]))
        st.session_state.setdefault(
            get_ingredient_key(row_id, "benodigd"),
            float(row["benodigd_in_recept"]),
        )

        with row_cols[0]:
            st.selectbox(
                "Ingrediënt",
                options=INGREDIENT_OPTIONS,
                key=ingredient_key,
                label_visibility="collapsed",
            )
        with row_cols[1]:
            st.text_input("Omschrijving", key=get_ingredient_key(row_id, "omschrijving"), label_visibility="collapsed")
        with row_cols[2]:
            st.text_input("Leverancier", key=get_ingredient_key(row_id, "leverancier"), label_visibility="collapsed")
        with row_cols[3]:
            st.number_input(
                "Hoeveelheid",
                min_value=0.0,
                step=0.1,
                format="%.2f",
                key=get_ingredient_key(row_id, "hoeveelheid"),
                label_visibility="collapsed",
            )
        with row_cols[4]:
            st.selectbox(
                "Eenheid",
                options=EENHEID_OPTIONS,
                key=eenheid_key,
                label_visibility="collapsed",
            )
        with row_cols[5]:
            st.number_input(
                "Prijs",
                min_value=0.0,
                step=0.01,
                format="%.2f",
                key=get_ingredient_key(row_id, "prijs"),
                label_visibility="collapsed",
            )
        with row_cols[6]:
            st.number_input(
                "Benodigd in recept",
                min_value=0.0,
                step=0.01,
                format="%.2f",
                key=get_ingredient_key(row_id, "benodigd"),
                label_visibility="collapsed",
            )

        live_row = collect_ingredient_row_from_widgets(row_id)
        prijs_per_eenheid = calculate_prijs_per_eenheid(live_row)
        kosten_recept = calculate_kosten_recept(live_row)
    else:
        with row_cols[0]:
            _render_read_only_cell("Ingrediënt", row["ingrediënt"] or "-", f"nb_ingredient_name_{row_id}")
        with row_cols[1]:
            _render_read_only_cell("Omschrijving", row["omschrijving"] or "-", f"nb_ingredient_omschrijving_{row_id}")
        with row_cols[2]:
            _render_read_only_cell("Leverancier", row["leverancier"] or "-", f"nb_ingredient_leverancier_{row_id}")
        with row_cols[3]:
            _render_read_only_cell("Hoeveelheid", format_number(row["hoeveelheid"]), f"nb_ingredient_hoeveelheid_{row_id}")
        with row_cols[4]:
            _render_read_only_cell("Eenheid", row["eenheid"] or "-", f"nb_ingredient_eenheid_{row_id}")
        with row_cols[5]:
            _render_read_only_cell("Prijs", format_number(row["prijs"]), f"nb_ingredient_prijs_{row_id}")
        with row_cols[6]:
            _render_read_only_cell("Benodigd in recept", format_number(row["benodigd_in_recept"]), f"nb_ingredient_benodigd_{row_id}")

    with row_cols[7]:
        render_read_only_table_cell(format_number(prijs_per_eenheid))
    with row_cols[8]:
        render_read_only_table_cell(format_number(kosten_recept))
    with row_cols[9]:
        _, action_col, _ = st.columns([1, 1.4, 1])
        with action_col:
            if render_edit_button(
                key=f"nb_ingredient_edit_{row_id}",
                disabled=is_editing,
                use_container_width=True,
            ):
                st.session_state["nb_ingredient_edit_row_id_pending"] = row_id
                st.rerun()
    with row_cols[10]:
        _, action_col, _ = st.columns([1, 1.4, 1])
        with action_col:
            if render_save_button(
                key=f"nb_ingredient_save_{row_id}",
                disabled=not is_editing,
                use_container_width=True,
            ):
                save_current_ingredient_row()
                st.rerun()
    with row_cols[11]:
        _, action_col, _ = st.columns([1, 1.4, 1])
        with action_col:
            if render_delete_button(
                key=f"nb_ingredient_delete_{row_id}",
                use_container_width=True,
            ):
                st.session_state["nb_ingredient_delete_confirm_row_id"] = row_id
                st.rerun()

    if confirm_delete_row_id == row_id:
        st.warning(
            f"Weet je zeker dat je de ingrediëntregel '{row['ingrediënt'] or 'nieuwe regel'}' wilt verwijderen?"
        )
        confirm_col, cancel_col, _ = st.columns([1, 1, 4])
        with confirm_col:
            if st.button("Ja, verwijderen", key=f"nb_ingredient_confirm_delete_{row_id}"):
                delete_ingredient_row(get_active_berekening(), row_id)
                st.rerun()
        with cancel_col:
            if st.button("Annuleren", key=f"nb_ingredient_cancel_delete_{row_id}"):
                st.session_state["nb_ingredient_delete_confirm_row_id"] = None
                st.rerun()


def _render_inkoop_row(
    row: dict[str, Any],
    is_editing: bool,
    *,
    toegerekende_extra_kosten: float,
) -> None:
    """Render één inkoopregel."""
    row_id = row["id"]
    prijs_per_eenheid = calculate_inkoop_prijs_per_eenheid(row, toegerekende_extra_kosten)
    prijs_per_liter = calculate_inkoop_prijs_per_liter(row, toegerekende_extra_kosten)
    confirm_delete_row_id = str(
        st.session_state.get("nb_inkoop_delete_confirm_row_id", "") or ""
    )

    row_cols = st.columns([1.1, 0.9, 0.9, 1.1, 1.05, 1.0, 1.0, 0.48, 0.48, 0.48])
    product_options, product_labels = _get_inkoop_product_options()

    if is_editing:
        eenheid_key = get_inkoop_key(row_id, "eenheid")
        default_eenheid = row["eenheid"] if row["eenheid"] in product_options else ""
        if st.session_state.get(eenheid_key) not in product_options:
            st.session_state[eenheid_key] = default_eenheid
        st.session_state.setdefault(get_inkoop_key(row_id, "aantal"), float(row["aantal"]))
        st.session_state.setdefault(
            get_inkoop_key(row_id, "subfactuurbedrag"),
            float(row["subfactuurbedrag"]),
        )

        with row_cols[0]:
            st.selectbox(
                "Inkoopeenheid",
                options=product_options,
                format_func=lambda product_id: product_labels.get(product_id, product_id),
                key=eenheid_key,
                label_visibility="collapsed",
            )
        with row_cols[1]:
            st.number_input(
                "Aantal",
                min_value=0.0,
                step=1.0,
                format="%.2f",
                key=get_inkoop_key(row_id, "aantal"),
                label_visibility="collapsed",
            )
        with row_cols[2]:
            live_row = collect_inkoop_row_from_widgets(row_id)
            render_read_only_table_cell(format_number(live_row["liters"]))
        with row_cols[3]:
            st.number_input(
                "Subfactuurbedrag",
                min_value=0.0,
                step=0.01,
                format="%.2f",
                key=get_inkoop_key(row_id, "subfactuurbedrag"),
                label_visibility="collapsed",
            )

        live_row = collect_inkoop_row_from_widgets(row_id)
        prijs_per_eenheid = calculate_inkoop_prijs_per_eenheid(live_row, toegerekende_extra_kosten)
        prijs_per_liter = calculate_inkoop_prijs_per_liter(live_row, toegerekende_extra_kosten)
    else:
        with row_cols[0]:
            _render_read_only_cell(
                "Inkoopeenheid",
                product_labels.get(row["eenheid"], "-") if row["eenheid"] else "-",
                f"nb_inkoop_eenheid_{row_id}",
            )
        with row_cols[1]:
            _render_read_only_cell("Aantal", format_number(row["aantal"]), f"nb_inkoop_aantal_{row_id}")
        with row_cols[2]:
            _render_read_only_cell("Liters", format_number(row["liters"]), f"nb_inkoop_liters_{row_id}")
        with row_cols[3]:
            _render_read_only_cell("Subfactuurbedrag", format_number(row["subfactuurbedrag"]), f"nb_inkoop_subfactuurbedrag_{row_id}")

    with row_cols[4]:
        render_read_only_table_cell(format_number(toegerekende_extra_kosten))
    with row_cols[5]:
        render_read_only_table_cell(format_number(prijs_per_eenheid))
    with row_cols[6]:
        render_read_only_table_cell(format_number(prijs_per_liter))
    with row_cols[7]:
        _, action_col, _ = st.columns([1, 1.4, 1])
        with action_col:
            if render_edit_button(
                key=f"nb_inkoop_edit_{row_id}",
                disabled=is_editing,
                use_container_width=True,
            ):
                st.session_state["nb_inkoop_edit_row_id_pending"] = row_id
                st.rerun()
    with row_cols[8]:
        _, action_col, _ = st.columns([1, 1.4, 1])
        with action_col:
            if render_save_button(
                key=f"nb_inkoop_save_{row_id}",
                disabled=not is_editing,
                use_container_width=True,
            ):
                save_current_inkoop_row()
                st.rerun()
    with row_cols[9]:
        _, action_col, _ = st.columns([1, 1.4, 1])
        with action_col:
            if render_delete_button(
                key=f"nb_inkoop_delete_{row_id}",
                use_container_width=True,
            ):
                st.session_state["nb_inkoop_delete_confirm_row_id"] = row_id
                st.rerun()

    if confirm_delete_row_id == row_id:
        st.warning(
            "Weet je zeker dat je deze factuurregel wilt verwijderen?"
        )
        confirm_col, cancel_col, _ = st.columns([1, 1, 4])
        with confirm_col:
            if st.button("Ja, verwijderen", key=f"nb_inkoop_confirm_delete_{row_id}"):
                delete_inkoop_row(get_active_berekening(), row_id)
                st.rerun()
        with cancel_col:
            if st.button("Annuleren", key=f"nb_inkoop_cancel_delete_{row_id}"):
                st.session_state["nb_inkoop_delete_confirm_row_id"] = None
                st.rerun()


def _render_step_3_summary(rows: list[dict[str, Any]], year: int | None) -> None:
    """Toont de samenvatting onder de ingrediëntentabel."""
    totale_kosten_recept = sum(calculate_kosten_recept(row) for row in rows)
    batchgrootte = get_batchgrootte_eigen_productie_l(year) if year else None

    summary_col_1, summary_col_2, summary_col_3 = st.columns(3)
    with summary_col_1:
        st.markdown(
            f"""
            <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">Totale kosten recept</div>
                <div style="font-size:1.1rem;font-weight:700;color:#24332b;">EUR {format_number(totale_kosten_recept)}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with summary_col_2:
        if batchgrootte and batchgrootte > 0:
            prijs_per_liter = totale_kosten_recept / batchgrootte
            st.markdown(
                f"""
                <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                    <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">Prijs per liter</div>
                    <div style="font-size:1.1rem;font-weight:700;color:#24332b;">EUR {format_number(prijs_per_liter)} per L</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
        else:
            st.info("Prijs per liter is nog niet te berekenen omdat batchgrootte voor dit jaar ontbreekt.")
    with summary_col_3:
        if batchgrootte and batchgrootte > 0:
            st.markdown(
                f"""
                <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                    <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">Batchgrootte</div>
                    <div style="font-size:1.1rem;font-weight:700;color:#24332b;">{format_number(batchgrootte)} L</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
        else:
            st.info("Batchgrootte voor dit jaar ontbreekt.")


def _render_step_3_inkoop_summary(
    rows: list[dict[str, Any]],
    *,
    verzendkosten: float,
    overige_kosten: float,
) -> None:
    """Toont de samenvatting onder de inkooptabel."""
    totaal_liters = sum(float(row.get("liters", 0.0) or 0.0) for row in rows)
    totaal_subfactuurbedrag = sum(
        float(row.get("subfactuurbedrag", 0.0) or 0.0) for row in rows
    )
    totale_extra_kosten = float(verzendkosten or 0.0) + float(overige_kosten or 0.0)
    gemiddelde_kostprijs_per_liter = (
        (totaal_subfactuurbedrag + totale_extra_kosten) / totaal_liters
        if totaal_liters > 0
        else None
    )

    summary_col_1, summary_col_2, summary_col_3, summary_col_4 = st.columns(4)
    with summary_col_1:
        st.markdown(
            f"""
            <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">Totaal liters</div>
                <div style="font-size:1.1rem;font-weight:700;color:#24332b;">{format_number(totaal_liters)} L</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with summary_col_2:
        st.markdown(
            f"""
            <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">Totaal subfactuurbedrag</div>
                <div style="font-size:1.1rem;font-weight:700;color:#24332b;">EUR {format_number(totaal_subfactuurbedrag)}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with summary_col_3:
        st.markdown(
            f"""
            <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">Totale extra kosten</div>
                <div style="font-size:1.1rem;font-weight:700;color:#24332b;">EUR {format_number(totale_extra_kosten)}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with summary_col_4:
        if gemiddelde_kostprijs_per_liter is not None:
            st.markdown(
                f"""
                <div style="border:1px solid #d9ddcf;border-radius:14px;padding:0.9rem 1rem;background:#f8f8f4;">
                    <div style="font-size:0.82rem;color:#6b766b;font-weight:700;">Gemiddelde kostprijs per liter</div>
                    <div style="font-size:1.1rem;font-weight:700;color:#24332b;">EUR {format_number(gemiddelde_kostprijs_per_liter)} per L</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
        else:
            st.info("Gemiddelde kostprijs per liter is nog niet te berekenen.")


def _render_step_3_inkoop(record: dict[str, Any]) -> None:
    """Toont stap 3 voor inkoop."""
    pending_edit_row_id = str(
        st.session_state.pop("nb_inkoop_edit_row_id_pending", "") or ""
    )
    if pending_edit_row_id:
        start_edit_inkoop_row(record, pending_edit_row_id)
        record = get_active_berekening()

    st.markdown("<div class='section-title'>Inkoop</div>", unsafe_allow_html=True)

    st.text_input(
        "Factuurdatum",
        key="nb_inkoop_factuurdatum",
        placeholder="DD-MM-YYYY",
    )

    cost_col_1, cost_col_2 = st.columns(2)
    with cost_col_1:
        st.number_input(
            "Verzendkosten",
            min_value=0.0,
            step=0.01,
            format="%.2f",
            key="nb_inkoop_verzendkosten",
        )
    with cost_col_2:
        st.number_input(
            "Overige kosten",
            min_value=0.0,
            step=0.01,
            format="%.2f",
            key="nb_inkoop_overige_kosten",
        )

    rows = get_step_3_inkoop_rows_for_view(record)
    aantal_regels = len(rows)
    toegerekende_extra_kosten = calculate_toegerekende_extra_kosten_per_row(
        st.session_state.get("nb_inkoop_verzendkosten", 0.0),
        st.session_state.get("nb_inkoop_overige_kosten", 0.0),
        aantal_regels,
    )

    headers = [
        "Inkoopeenheid",
        "Aantal",
        "Liters",
        "Subfactuurbedrag",
        "Toegerekende extra kosten",
        "Prijs per eenheid",
        "Prijs per liter",
        "",
        "",
        "",
    ]
    render_table_headers(headers, [1.1, 0.9, 0.9, 1.1, 1.05, 1.0, 1.0, 0.48, 0.48, 0.48])

    if not rows:
        st.info("Nog geen factuurregels toegevoegd.")
    else:
        editing_row_id = str(st.session_state.get("nb_inkoop_edit_row_id", "") or "")
        for row in rows:
            _render_inkoop_row(
                row,
                is_editing=row["id"] == editing_row_id,
                toegerekende_extra_kosten=toegerekende_extra_kosten,
            )

    add_col, spacer_col = st.columns([1.2, 4.8])
    with add_col:
        if st.button("Toevoegen", key="nb_inkoop_add"):
            sync_active_berekening_from_widgets()
            add_new_inkoop_row(get_active_berekening())
            st.rerun()
    with spacer_col:
        st.write("")

    st.write("")
    _render_step_3_inkoop_summary(
        get_step_3_inkoop_rows_for_view(get_active_berekening()),
        verzendkosten=float(st.session_state.get("nb_inkoop_verzendkosten", 0.0) or 0.0),
        overige_kosten=float(st.session_state.get("nb_inkoop_overige_kosten", 0.0) or 0.0),
    )


def render_step_3() -> None:
    """Toont stap 3 voor productie of inkoop."""
    record = get_active_berekening()
    calculation_type = str(
        st.session_state.get("nb_soort_type", "Eigen productie") or "Eigen productie"
    )
    pending_edit_row_id = str(
        st.session_state.pop("nb_ingredient_edit_row_id_pending", "") or ""
    )
    if pending_edit_row_id:
        start_edit_ingredient_row(record, pending_edit_row_id)
        record = get_active_berekening()

    if calculation_type != "Eigen productie":
        _render_step_3_inkoop(record)
        return

    st.markdown("<div class='section-title'>Ingrediënten</div>", unsafe_allow_html=True)

    rows = get_step_3_rows_for_view(record)
    headers = [
        "Ingrediënt",
        "Omschrijving",
        "Leverancier",
        "Hoeveelheid",
        "Eenheid",
        "Prijs",
        "Benodigd in recept",
        "Prijs per eenheid",
        "Kosten recept",
        "",
        "",
        "",
    ]
    render_table_headers(
        headers,
        [1.7, 1.9, 1.6, 1.0, 0.95, 0.95, 1.1, 1.05, 1.05, 0.48, 0.48, 0.48],
    )

    if not rows:
        st.info("Nog geen ingrediënten toegevoegd.")
    else:
        editing_row_id = str(st.session_state.get("nb_ingredient_edit_row_id", "") or "")
        for row in rows:
            _render_ingredient_row(row, is_editing=row["id"] == editing_row_id)

    add_col, spacer_col = st.columns([1.2, 4.8])
    with add_col:
        if st.button("Toevoegen", key="nb_ingredient_add"):
            sync_active_berekening_from_widgets()
            add_new_ingredient_row(get_active_berekening())
            st.rerun()
    with spacer_col:
        st.write("")

    st.write("")
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    _render_step_3_summary(
        get_step_3_rows_for_view(get_active_berekening()),
        int(basisgegevens.get("jaar", 0) or 0) or None,
    )
