from __future__ import annotations

from typing import Any, Callable
from uuid import uuid4

import streamlit as st

from components.action_buttons import render_delete_button, render_edit_button
from components.breadcrumb import render_breadcrumb
from components.page_ui import render_page_header
from components.table_ui import render_read_only_table_cell, render_table_headers
from pages.nieuwe_berekening.state import (
    calculate_inkoop_prijs_per_eenheid,
    calculate_inkoop_prijs_per_liter,
    calculate_toegerekende_extra_kosten_per_row,
    calculate_variabele_kosten_per_liter_from_record,
    format_number,
    get_record_inkoop_facturen,
    normalize_inkoop_factuur,
    normalize_inkoop_row,
    set_record_inkoop_facturen,
)
from utils.storage import add_or_update_berekening, load_berekeningen, load_samengestelde_producten


MODE_IDLE = "idle"
MODE_ADD = "add"
MODE_EDIT = "edit"


def _format_euro(amount: float | int | None) -> str:
    value = float(amount or 0.0)
    formatted = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"EUR {formatted}"


def _inkoop_berekeningen() -> list[dict[str, Any]]:
    return [
        record
        for record in load_berekeningen()
        if str(record.get("soort_berekening", {}).get("type", "") or "") == "Inkoop"
    ]


def _berekening_label(record: dict[str, Any]) -> str:
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    biernaam = str(basisgegevens.get("biernaam", "Onbekend") or "Onbekend")
    jaar = int(basisgegevens.get("jaar", 0) or 0)
    status = str(record.get("status", "concept") or "concept")
    return f"{biernaam} ({jaar}) - {status}"


def _get_record_by_id(berekening_id: str) -> dict[str, Any] | None:
    for record in _inkoop_berekeningen():
        if str(record.get("id", "") or "") == berekening_id:
            return record
    return None


def _get_product_options() -> tuple[list[str], dict[str, str]]:
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


def _empty_factuur_row() -> dict[str, Any]:
    return normalize_inkoop_row({"id": str(uuid4()), "aantal": 0.0, "eenheid": "", "subfactuurbedrag": 0.0})


def _empty_factuur() -> dict[str, Any]:
    return normalize_inkoop_factuur(
        {
            "id": str(uuid4()),
            "factuurdatum": "",
            "verzendkosten": 0.0,
            "overige_kosten": 0.0,
            "factuurregels": [_empty_factuur_row()],
        }
    )


def _set_feedback(message: str) -> None:
    st.session_state["inkoop_facturen_feedback"] = message


def _render_feedback() -> None:
    message = st.session_state.pop("inkoop_facturen_feedback", None)
    if message:
        st.success(message)


def _init_page_state() -> None:
    defaults = {
        "inkoop_facturen_selected_berekening_id": "",
        "inkoop_facturen_loaded_berekening_id": "",
        "inkoop_facturen_mode": MODE_IDLE,
        "inkoop_facturen_selected_factuur_id": "",
        "inkoop_facturen_confirm_delete_factuur_id": "",
        "inkoop_facturen_feedback": None,
        "inkoop_factuur_form": _empty_factuur(),
        "inkoop_factuur_form_version": 0,
        "inkoop_factuur_row_ids": [],
        "inkoop_factuur_edit_row_id": "",
        "inkoop_factuur_delete_confirm_row_id": "",
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def _bump_form_version() -> None:
    st.session_state["inkoop_factuur_form_version"] = int(
        st.session_state.get("inkoop_factuur_form_version", 0)
    ) + 1


def _widget_key(prefix: str, row_id: str | None = None) -> str:
    version = int(st.session_state.get("inkoop_factuur_form_version", 0))
    if row_id is None:
        return f"inkoop_factuur_{prefix}_{version}"
    return f"inkoop_factuur_{prefix}_{row_id}_{version}"


def _set_form_data(factuur: dict[str, Any]) -> None:
    normalized = normalize_inkoop_factuur(factuur)
    if not normalized["factuurregels"]:
        normalized["factuurregels"] = [_empty_factuur_row()]
    st.session_state["inkoop_factuur_form"] = normalized
    st.session_state["inkoop_factuur_row_ids"] = [
        str(row.get("id", "") or "")
        for row in normalized["factuurregels"]
    ]
    st.session_state["inkoop_factuur_edit_row_id"] = ""
    st.session_state["inkoop_factuur_delete_confirm_row_id"] = ""


def _ensure_form_widget_state() -> None:
    factuur = st.session_state.get("inkoop_factuur_form", _empty_factuur())
    st.session_state.setdefault(_widget_key("factuurdatum"), str(factuur.get("factuurdatum", "") or ""))
    st.session_state.setdefault(_widget_key("verzendkosten"), float(factuur.get("verzendkosten", 0.0) or 0.0))
    st.session_state.setdefault(_widget_key("overige_kosten"), float(factuur.get("overige_kosten", 0.0) or 0.0))

    for row in factuur.get("factuurregels", []):
        row_id = str(row.get("id", "") or uuid4())
        st.session_state.setdefault(_widget_key("eenheid", row_id), str(row.get("eenheid", "") or ""))
        st.session_state.setdefault(_widget_key("aantal", row_id), float(row.get("aantal", 0.0) or 0.0))
        st.session_state.setdefault(_widget_key("subfactuurbedrag", row_id), float(row.get("subfactuurbedrag", 0.0) or 0.0))


def _form_row_from_widgets(row_id: str) -> dict[str, Any]:
    return normalize_inkoop_row(
        {
            "id": row_id,
            "eenheid": st.session_state.get(_widget_key("eenheid", row_id), ""),
            "aantal": st.session_state.get(_widget_key("aantal", row_id), 0.0),
            "subfactuurbedrag": st.session_state.get(_widget_key("subfactuurbedrag", row_id), 0.0),
        }
    )


def _get_rows_from_state() -> list[dict[str, Any]]:
    row_ids = st.session_state.get("inkoop_factuur_row_ids", [])
    if not isinstance(row_ids, list):
        return []
    rows: list[dict[str, Any]] = []
    for row_id in row_ids:
        row_id = str(row_id or "")
        if not row_id:
            continue
        rows.append(_form_row_from_widgets(row_id))
    return rows


def _current_form_factuur() -> dict[str, Any]:
    factuur = normalize_inkoop_factuur(
        {
            "id": st.session_state.get("inkoop_facturen_selected_factuur_id", "") or uuid4(),
            "factuurdatum": st.session_state.get(_widget_key("factuurdatum"), ""),
            "verzendkosten": st.session_state.get(_widget_key("verzendkosten"), 0.0),
            "overige_kosten": st.session_state.get(_widget_key("overige_kosten"), 0.0),
            "factuurregels": _get_rows_from_state(),
        }
    )
    if not factuur["factuurregels"]:
        factuur["factuurregels"] = [_empty_factuur_row()]
    return factuur


def _start_add_factuur() -> None:
    st.session_state["inkoop_facturen_mode"] = MODE_ADD
    st.session_state["inkoop_facturen_selected_factuur_id"] = ""
    _set_form_data(_empty_factuur())
    _bump_form_version()


def _start_edit_factuur(factuur: dict[str, Any]) -> None:
    normalized = normalize_inkoop_factuur(factuur)
    st.session_state["inkoop_facturen_mode"] = MODE_EDIT
    st.session_state["inkoop_facturen_selected_factuur_id"] = str(normalized.get("id", "") or "")
    _set_form_data(normalized)
    _bump_form_version()


def _cancel_factuur_form() -> None:
    st.session_state["inkoop_facturen_mode"] = MODE_IDLE
    st.session_state["inkoop_facturen_selected_factuur_id"] = ""
    _set_form_data(_empty_factuur())
    _bump_form_version()


def _factuur_totals(factuur: dict[str, Any]) -> dict[str, float]:
    rows = factuur.get("factuurregels", [])
    if not isinstance(rows, list):
        rows = []
    totaal_liters = sum(float(row.get("liters", 0.0) or 0.0) for row in rows)
    totaal_subfactuurbedrag = sum(
        float(row.get("subfactuurbedrag", 0.0) or 0.0) for row in rows
    )
    totale_extra_kosten = float(factuur.get("verzendkosten", 0.0) or 0.0) + float(
        factuur.get("overige_kosten", 0.0) or 0.0
    )
    return {
        "totaal_liters": totaal_liters,
        "totaal_subfactuurbedrag": totaal_subfactuurbedrag,
        "totale_extra_kosten": totale_extra_kosten,
    }


def _validate_factuur(factuur: dict[str, Any]) -> tuple[list[str], dict[str, Any] | None]:
    errors: list[str] = []
    normalized = normalize_inkoop_factuur(factuur)
    valid_rows: list[dict[str, Any]] = []

    for index, row in enumerate(normalized.get("factuurregels", []), start=1):
        eenheid = str(row.get("eenheid", "") or "")
        aantal = float(row.get("aantal", 0.0) or 0.0)
        subfactuurbedrag = float(row.get("subfactuurbedrag", 0.0) or 0.0)
        is_empty_row = not eenheid and aantal == 0.0 and subfactuurbedrag == 0.0
        if is_empty_row:
            continue
        if not eenheid:
            errors.append(f"Regel {index}: selecteer een inkoopeenheid.")
            continue
        if aantal <= 0:
            errors.append(f"Regel {index}: aantal moet groter zijn dan 0.")
            continue
        if subfactuurbedrag < 0:
            errors.append(f"Regel {index}: subfactuurbedrag mag niet negatief zijn.")
            continue
        valid_rows.append(row)

    if not valid_rows:
        errors.append("Voeg minimaal één geldige factuurregel toe.")

    if errors:
        return errors, None

    normalized["factuurregels"] = valid_rows
    return [], normalized


def _save_factuur(record: dict[str, Any]) -> bool:
    errors, valid_factuur = _validate_factuur(_current_form_factuur())
    if errors:
        for error in errors:
            st.error(error)
        return False
    if valid_factuur is None:
        return False

    facturen = get_record_inkoop_facturen(record)
    selected_factuur_id = str(valid_factuur.get("id", "") or "")
    updated = False
    for index, existing in enumerate(facturen):
        if str(existing.get("id", "") or "") != selected_factuur_id:
            continue
        facturen[index] = valid_factuur
        updated = True
        break
    if not updated:
        facturen.append(valid_factuur)

    set_record_inkoop_facturen(record, facturen)
    saved = add_or_update_berekening(record)
    if not saved:
        st.error("Opslaan van de factuur is niet gelukt.")
        return False

    _set_feedback("Factuur opgeslagen.")
    _cancel_factuur_form()
    return True


def _delete_factuur(record: dict[str, Any], factuur_id: str) -> bool:
    facturen = [
        factuur
        for factuur in get_record_inkoop_facturen(record)
        if str(factuur.get("id", "") or "") != factuur_id
    ]
    if not facturen:
        facturen = [normalize_inkoop_factuur()]

    set_record_inkoop_facturen(record, facturen)
    saved = add_or_update_berekening(record)
    if not saved:
        st.error("Verwijderen van de factuur is niet gelukt.")
        return False

    _set_feedback("Factuur verwijderd.")
    return True


def _render_record_summary(record: dict[str, Any]) -> None:
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}

    facturen = get_record_inkoop_facturen(record)
    gemiddelde_per_liter = calculate_variabele_kosten_per_liter_from_record(record)
    totaal_liters = sum(
        _factuur_totals(factuur)["totaal_liters"]
        for factuur in facturen
    )
    col_1, col_2, col_3 = st.columns(3)
    with col_1:
        render_read_only_table_cell(str(basisgegevens.get("biernaam", "-") or "-"))
        st.caption("Biernaam")
    with col_2:
        render_read_only_table_cell(str(len(facturen)))
        st.caption("Aantal facturen")
    with col_3:
        render_read_only_table_cell(
            _format_euro(gemiddelde_per_liter) + " per L"
            if gemiddelde_per_liter is not None
            else "Nog niet berekend"
        )
        st.caption(f"Gemiddelde kostprijs per liter ({format_number(totaal_liters)} L)")


def _render_facturen_overview(record: dict[str, Any]) -> None:
    st.markdown("<div class='section-title'>Facturen</div>", unsafe_allow_html=True)
    facturen = get_record_inkoop_facturen(record)
    if not facturen:
        st.info("Nog geen facturen toegevoegd.")
        return

    headers = ["Factuurdatum", "Regels", "Liters", "Totale kosten", "", ""]
    row_widths = [1.2, 0.8, 0.9, 1.0, 0.42, 0.42]
    render_table_headers(headers, row_widths)

    confirm_delete_id = st.session_state.get("inkoop_facturen_confirm_delete_factuur_id", "")
    for factuur in facturen:
        factuur_id = str(factuur.get("id", "") or "")
        totals = _factuur_totals(factuur)
        total_cost = totals["totaal_subfactuurbedrag"] + totals["totale_extra_kosten"]
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            render_read_only_table_cell(str(factuur.get("factuurdatum", "") or "-"))
        with row_cols[1]:
            render_read_only_table_cell(str(len(factuur.get("factuurregels", []))))
        with row_cols[2]:
            render_read_only_table_cell(f"{format_number(totals['totaal_liters'])} L")
        with row_cols[3]:
            render_read_only_table_cell(_format_euro(total_cost))
        with row_cols[4]:
            if render_edit_button(key=f"inkoop_factuur_edit_{factuur_id}"):
                _start_edit_factuur(factuur)
                st.rerun()
        with row_cols[5]:
            if render_delete_button(key=f"inkoop_factuur_delete_{factuur_id}"):
                st.session_state["inkoop_facturen_confirm_delete_factuur_id"] = factuur_id
                st.rerun()

        if confirm_delete_id == factuur_id:
            st.warning("Weet je zeker dat je deze factuur wilt verwijderen?")
            confirm_col, cancel_col, _ = st.columns([1, 1, 4])
            with confirm_col:
                if st.button("Ja, verwijderen", key=f"inkoop_factuur_confirm_delete_{factuur_id}"):
                    if _delete_factuur(record, factuur_id):
                        st.session_state["inkoop_facturen_confirm_delete_factuur_id"] = ""
                        st.rerun()
            with cancel_col:
                if st.button("Annuleren", key=f"inkoop_factuur_cancel_delete_{factuur_id}"):
                    st.session_state["inkoop_facturen_confirm_delete_factuur_id"] = ""
                    st.rerun()


def _render_factuur_form(record: dict[str, Any]) -> None:
    mode = st.session_state.get("inkoop_facturen_mode", MODE_IDLE)
    if mode not in {MODE_ADD, MODE_EDIT}:
        return

    _ensure_form_widget_state()
    title = "Nieuwe factuur toevoegen" if mode == MODE_ADD else "Factuur bewerken"
    st.markdown(f"<div class='section-title'>{title}</div>", unsafe_allow_html=True)

    st.text_input("Factuurdatum", key=_widget_key("factuurdatum"), placeholder="DD-MM-YYYY")
    cost_col_1, cost_col_2 = st.columns(2)
    with cost_col_1:
        st.number_input(
            "Verzendkosten",
            min_value=0.0,
            step=0.01,
            format="%.2f",
            key=_widget_key("verzendkosten"),
        )
    with cost_col_2:
        st.number_input(
            "Overige kosten",
            min_value=0.0,
            step=0.01,
            format="%.2f",
            key=_widget_key("overige_kosten"),
        )

    rows = _get_rows_from_state()
    product_options, product_labels = _get_product_options()
    toegerekende_extra_kosten = calculate_toegerekende_extra_kosten_per_row(
        st.session_state.get(_widget_key("verzendkosten"), 0.0),
        st.session_state.get(_widget_key("overige_kosten"), 0.0),
        len(rows),
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
    ]
    row_widths = [1.1, 0.9, 0.9, 1.1, 1.05, 1.0, 1.0, 0.42]
    render_table_headers(headers, row_widths)

    confirm_row_id = st.session_state.get("inkoop_factuur_delete_confirm_row_id", "")
    for row in rows:
        row_id = str(row.get("id", "") or "")
        row_cols = st.columns(row_widths)
        row_options = list(product_options)

        with row_cols[0]:
            st.selectbox(
                "Inkoopeenheid",
                options=row_options,
                format_func=lambda product_id: product_labels.get(product_id, product_id),
                key=_widget_key("eenheid", row_id),
                label_visibility="collapsed",
            )
        with row_cols[1]:
            st.number_input(
                "Aantal",
                min_value=0.0,
                step=1.0,
                format="%.2f",
                key=_widget_key("aantal", row_id),
                label_visibility="collapsed",
            )

        live_row = _form_row_from_widgets(row_id)
        prijs_per_eenheid = calculate_inkoop_prijs_per_eenheid(live_row, toegerekende_extra_kosten)
        prijs_per_liter = calculate_inkoop_prijs_per_liter(live_row, toegerekende_extra_kosten)

        with row_cols[2]:
            render_read_only_table_cell(f"{format_number(live_row['liters'])} L")
        with row_cols[3]:
            st.number_input(
                "Subfactuurbedrag",
                min_value=0.0,
                step=0.01,
                format="%.2f",
                key=_widget_key("subfactuurbedrag", row_id),
                label_visibility="collapsed",
            )
        with row_cols[4]:
            render_read_only_table_cell(_format_euro(toegerekende_extra_kosten))
        with row_cols[5]:
            render_read_only_table_cell(_format_euro(prijs_per_eenheid))
        with row_cols[6]:
            render_read_only_table_cell(_format_euro(prijs_per_liter))
        with row_cols[7]:
            if render_delete_button(key=f"inkoop_factuur_remove_row_{row_id}"):
                st.session_state["inkoop_factuur_delete_confirm_row_id"] = row_id
                st.rerun()

        if confirm_row_id == row_id:
            st.warning("Weet je zeker dat je deze factuurregel wilt verwijderen?")
            confirm_col, cancel_col, _ = st.columns([1, 1, 4])
            with confirm_col:
                if st.button("Ja, verwijderen", key=f"inkoop_factuur_confirm_remove_row_{row_id}"):
                    remaining_rows = [
                        item
                        for item in rows
                        if str(item.get("id", "") or "") != row_id
                    ]
                    if not remaining_rows:
                        remaining_rows = [_empty_factuur_row()]
                    st.session_state["inkoop_factuur_row_ids"] = [
                        str(item.get("id", "") or "") for item in remaining_rows
                    ]
                    st.session_state["inkoop_factuur_form"]["factuurregels"] = remaining_rows
                    st.session_state["inkoop_factuur_delete_confirm_row_id"] = ""
                    _bump_form_version()
                    _set_form_data(
                        {
                            **_current_form_factuur(),
                            "factuurregels": remaining_rows,
                        }
                    )
                    st.rerun()
            with cancel_col:
                if st.button("Annuleren", key=f"inkoop_factuur_cancel_remove_row_{row_id}"):
                    st.session_state["inkoop_factuur_delete_confirm_row_id"] = ""
                    st.rerun()

    add_col, spacer_col = st.columns([1.2, 4.8])
    with add_col:
        if st.button("Toevoegen", key="inkoop_factuur_add_row", use_container_width=True):
            rows = _get_rows_from_state()
            rows.append(_empty_factuur_row())
            _set_form_data(
                {
                    **_current_form_factuur(),
                    "factuurregels": rows,
                }
            )
            _bump_form_version()
            st.rerun()
    with spacer_col:
        st.write("")

    totals = _factuur_totals(_current_form_factuur())
    summary_col_1, summary_col_2, summary_col_3, summary_col_4 = st.columns(4)
    with summary_col_1:
        render_read_only_table_cell(f"{format_number(totals['totaal_liters'])} L")
        st.caption("Totaal liters")
    with summary_col_2:
        render_read_only_table_cell(_format_euro(totals["totaal_subfactuurbedrag"]))
        st.caption("Totaal subfactuurbedrag")
    with summary_col_3:
        render_read_only_table_cell(_format_euro(totals["totale_extra_kosten"]))
        st.caption("Totale extra kosten")
    with summary_col_4:
        gemiddelde = (
            (totals["totaal_subfactuurbedrag"] + totals["totale_extra_kosten"]) / totals["totaal_liters"]
            if totals["totaal_liters"] > 0
            else None
        )
        render_read_only_table_cell(
            (_format_euro(gemiddelde) + " per L") if gemiddelde is not None else "Nog niet berekend"
        )
        st.caption("Gemiddelde kostprijs per liter")

    action_col_cancel, action_col_spacer, action_col_save = st.columns([1, 4, 1])
    with action_col_cancel:
        if st.button("Annuleren", key="inkoop_factuur_form_cancel", use_container_width=True):
            _cancel_factuur_form()
            st.rerun()
    with action_col_save:
        save_label = "Factuur opslaan" if mode == MODE_EDIT else "Factuur toevoegen"
        if st.button(save_label, key="inkoop_factuur_form_save", use_container_width=True):
            if _save_factuur(record):
                st.rerun()


def show_inkoop_facturen_page(
    on_back: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    del on_logout
    _init_page_state()

    berekeningen = _inkoop_berekeningen()
    st.markdown("<div class='main-card'>", unsafe_allow_html=True)
    render_breadcrumb(current_label="Inkoopfacturen", on_home_click=on_back)
    render_page_header(
        "Inkoopfacturen",
        "Voeg extra facturen toe aan een bestaande inkoopberekening. De gemiddelde inkoopkostprijs wordt daarna opnieuw opgebouwd uit alle facturen samen.",
    )
    _render_feedback()

    if not berekeningen:
        st.info("Er zijn nog geen berekeningen met soort 'Inkoop' beschikbaar.")
        col_back, _ = st.columns([1, 4])
        with col_back:
            if st.button("Terug naar welkom", key="inkoop_facturen_back_empty"):
                on_back()
        st.markdown("</div>", unsafe_allow_html=True)
        return

    option_ids = [str(record.get("id", "") or "") for record in berekeningen]
    current_selection = st.session_state.get("inkoop_facturen_selected_berekening_id", "")
    if current_selection not in option_ids:
        current_selection = option_ids[0]
        st.session_state["inkoop_facturen_selected_berekening_id"] = current_selection

    selected_id = st.selectbox(
        "Inkoopberekening",
        options=option_ids,
        format_func=lambda record_id: _berekening_label(_get_record_by_id(record_id) or {}),
        key="inkoop_facturen_selected_berekening_id",
    )
    record = _get_record_by_id(selected_id)
    if not record:
        st.warning("De geselecteerde inkoopberekening is niet gevonden.")
        st.markdown("</div>", unsafe_allow_html=True)
        return

    if st.session_state.get("inkoop_facturen_loaded_berekening_id", "") != selected_id:
        st.session_state["inkoop_facturen_loaded_berekening_id"] = selected_id
        _cancel_factuur_form()

    _render_record_summary(record)
    st.write("")

    action_col_add, action_col_spacer = st.columns([1.4, 4.6])
    with action_col_add:
        if st.button("Nieuwe factuur toevoegen", key="inkoop_facturen_add", use_container_width=True):
            _start_add_factuur()
            st.rerun()
    with action_col_spacer:
        st.write("")

    _render_factuur_form(record)
    st.write("")
    _render_facturen_overview(record)

    col_back, _ = st.columns([1, 4])
    with col_back:
        if st.button("Terug naar welkom", key="inkoop_facturen_back"):
            on_back()

    st.markdown("</div>", unsafe_allow_html=True)
