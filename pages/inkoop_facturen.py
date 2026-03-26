from __future__ import annotations

from typing import Any, Callable
from uuid import uuid4

import streamlit as st

from components.action_buttons import render_add_button, render_delete_button, render_edit_button
from components.breadcrumb import render_breadcrumb
from components.form_ui import ensure_date_widget_value, format_nl_date
from components.page_ui import render_page_header
from components.table_ui import (
    format_currency_cell_value,
    render_currency_table_cell,
    render_read_only_table_cell,
    render_table_headers,
)
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
from utils.storage import add_or_update_berekening, get_definitieve_berekeningen, load_samengestelde_producten


MODE_IDLE = "idle"
MODE_ADD = "add"
MODE_EDIT = "edit"


def _format_euro(amount: float | int | None) -> str:
    return format_currency_cell_value(amount)


def _inkoop_berekeningen() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for record in get_definitieve_berekeningen():
        soort_berekening = record.get("soort_berekening", {})
        if not isinstance(soort_berekening, dict):
            continue
        if str(soort_berekening.get("type", "") or "").strip().lower() != "inkoop":
            continue
        records.append(record)
    return records


def _available_years() -> list[int]:
    years = {
        int(record.get("basisgegevens", {}).get("jaar", 0) or 0)
        for record in _inkoop_berekeningen()
        if int(record.get("basisgegevens", {}).get("jaar", 0) or 0) > 0
    }
    return sorted(years)


def _berekeningen_for_year(year: int) -> list[dict[str, Any]]:
    return [
        record
        for record in _inkoop_berekeningen()
        if int(record.get("basisgegevens", {}).get("jaar", 0) or 0) == int(year)
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
            "factuurnummer": "",
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
    available_years = _available_years()
    defaults = {
        "inkoop_facturen_selected_year": available_years[-1] if available_years else None,
        "inkoop_facturen_selected_berekening_id": "",
        "inkoop_facturen_loaded_berekening_id": "",
        "inkoop_facturen_mode": MODE_IDLE,
        "inkoop_facturen_selected_factuur_id": "",
        "inkoop_facturen_confirm_delete_factuur_id": "",
        "inkoop_facturen_pending_add_record_id": "",
        "inkoop_facturen_pending_edit_record_id": "",
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
    st.session_state.setdefault(_widget_key("factuurnummer"), str(factuur.get("factuurnummer", "") or ""))
    ensure_date_widget_value(_widget_key("factuurdatum"), str(factuur.get("factuurdatum", "") or ""))
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
            "factuurnummer": st.session_state.get(_widget_key("factuurnummer"), ""),
            "factuurdatum": format_nl_date(st.session_state.get(_widget_key("factuurdatum"))),
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


def _open_record_for_add(record: dict[str, Any]) -> None:
    record_id = str(record.get("id", "") or "")
    st.session_state["inkoop_facturen_selected_berekening_id"] = record_id
    st.session_state["inkoop_facturen_loaded_berekening_id"] = record_id
    st.session_state["inkoop_facturen_pending_add_record_id"] = ""
    st.session_state["inkoop_facturen_pending_edit_record_id"] = ""
    _start_add_factuur()


def _open_record_for_edit(record: dict[str, Any], factuur: dict[str, Any]) -> None:
    record_id = str(record.get("id", "") or "")
    st.session_state["inkoop_facturen_selected_berekening_id"] = record_id
    st.session_state["inkoop_facturen_loaded_berekening_id"] = record_id
    st.session_state["inkoop_facturen_pending_add_record_id"] = ""
    st.session_state["inkoop_facturen_pending_edit_record_id"] = ""
    _start_edit_factuur(factuur)


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


def _validate_factuur(factuur: dict[str, Any], expected_year: int) -> tuple[list[str], dict[str, Any] | None]:
    errors: list[str] = []
    normalized = normalize_inkoop_factuur(factuur)
    valid_rows: list[dict[str, Any]] = []
    factuurdatum = str(normalized.get("factuurdatum", "") or "").strip()
    if factuurdatum:
        parsed = st.session_state.get(_widget_key("factuurdatum"))
        if parsed is None:
            errors.append("Kies een geldige factuurdatum.")
        elif int(parsed.year) != int(expected_year):
            errors.append(f"De factuurdatum moet binnen het geselecteerde jaar {expected_year} vallen.")

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
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    expected_year = int(basisgegevens.get("jaar", 0) or 0)
    errors, valid_factuur = _validate_factuur(_current_form_factuur(), expected_year)
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


def _factuur_keuze_label(factuur: dict[str, Any]) -> str:
    totals = _factuur_totals(factuur)
    total_cost = totals["totaal_subfactuurbedrag"] + totals["totale_extra_kosten"]
    factuurnummer = str(factuur.get("factuurnummer", "") or "-")
    factuurdatum = str(factuur.get("factuurdatum", "") or "-")
    regels = len(factuur.get("factuurregels", []))
    return f"{factuurnummer} | {factuurdatum} | {regels} regels | {_format_euro(total_cost)}"


def _render_bier_selectie(record: dict[str, Any]) -> None:
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    biernaam = str(basisgegevens.get("biernaam", "Onbekend") or "Onbekend")
    jaar = int(basisgegevens.get("jaar", 0) or 0)
    facturen = get_record_inkoop_facturen(record)
    row_cols = st.columns([2.2, 0.8, 0.42, 0.42])
    with row_cols[0]:
        render_read_only_table_cell(biernaam)
    with row_cols[1]:
        render_read_only_table_cell(str(jaar))
    with row_cols[2]:
        if render_add_button(
            key=f"inkoop_facturen_add_for_{record.get('id', '')}",
            use_container_width=True,
        ):
            st.session_state["inkoop_facturen_pending_add_record_id"] = str(record.get("id", "") or "")
            st.session_state["inkoop_facturen_pending_edit_record_id"] = ""
            st.rerun()
    with row_cols[3]:
        if render_edit_button(
            key=f"inkoop_facturen_pick_edit_{record.get('id', '')}",
            disabled=not bool(facturen),
            use_container_width=True,
        ):
            st.session_state["inkoop_facturen_pending_edit_record_id"] = str(record.get("id", "") or "")
            st.session_state["inkoop_facturen_pending_add_record_id"] = ""
            st.rerun()

    record_id = str(record.get("id", "") or "")
    if st.session_state.get("inkoop_facturen_pending_add_record_id", "") == record_id:
        st.warning(f"Weet je zeker dat je voor {biernaam} een factuur wilt toevoegen?")
        confirm_col, cancel_col, _ = st.columns([1, 1, 4])
        with confirm_col:
            if st.button("Ja, toevoegen", key=f"inkoop_facturen_confirm_add_{record_id}"):
                _open_record_for_add(record)
                st.rerun()
        with cancel_col:
            if st.button("Annuleren", key=f"inkoop_facturen_cancel_add_{record_id}"):
                st.session_state["inkoop_facturen_pending_add_record_id"] = ""
                st.rerun()

    if st.session_state.get("inkoop_facturen_pending_edit_record_id", "") == record_id:
        st.info(f"Kies welke factuur van {biernaam} je wilt aanpassen.")
        options = [str(factuur.get("id", "") or "") for factuur in facturen]
        labels = {
            str(factuur.get("id", "") or ""): _factuur_keuze_label(factuur)
            for factuur in facturen
        }
        if options:
            selected_factuur_id = st.selectbox(
                "Factuur",
                options=options,
                format_func=lambda factuur_id: labels.get(factuur_id, factuur_id),
                key=f"inkoop_facturen_edit_factuur_select_{record_id}",
            )
            action_col, cancel_col, _ = st.columns([1, 1, 4])
            with action_col:
                if st.button("Factuur openen", key=f"inkoop_facturen_open_edit_{record_id}"):
                    factuur = next(
                        (
                            item
                            for item in facturen
                            if str(item.get("id", "") or "") == str(selected_factuur_id or "")
                        ),
                        None,
                    )
                    if factuur:
                        _open_record_for_edit(record, factuur)
                        st.rerun()
            with cancel_col:
                if st.button("Annuleren", key=f"inkoop_facturen_cancel_edit_{record_id}"):
                    st.session_state["inkoop_facturen_pending_edit_record_id"] = ""
                    st.rerun()


def _render_bier_overview(year: int) -> None:
    st.markdown("<div class='section-title'>Definitieve bieren</div>", unsafe_allow_html=True)
    records = _berekeningen_for_year(year)
    if not records:
        st.info("Er zijn voor dit jaar nog geen definitieve inkoopberekeningen beschikbaar.")
        return
    headers = ["Bier", "Jaar", "", ""]
    row_widths = [2.2, 0.8, 0.42, 0.42]
    render_table_headers(headers, row_widths)
    for record in records:
        _render_bier_selectie(record)


def _render_facturen_overview(record: dict[str, Any]) -> None:
    st.markdown("<div class='section-title'>Facturen</div>", unsafe_allow_html=True)
    facturen = get_record_inkoop_facturen(record)
    if not facturen:
        st.info("Nog geen facturen toegevoegd.")
        return

    headers = ["Factuurnr.", "Factuurdatum", "Regels", "Liters", "Totale kosten", "", ""]
    row_widths = [1.1, 1.2, 0.8, 0.9, 1.0, 0.42, 0.42]
    render_table_headers(headers, row_widths)

    confirm_delete_id = st.session_state.get("inkoop_facturen_confirm_delete_factuur_id", "")
    for factuur in facturen:
        factuur_id = str(factuur.get("id", "") or "")
        totals = _factuur_totals(factuur)
        total_cost = totals["totaal_subfactuurbedrag"] + totals["totale_extra_kosten"]
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            render_read_only_table_cell(str(factuur.get("factuurnummer", "") or "-"))
        with row_cols[1]:
            render_read_only_table_cell(str(factuur.get("factuurdatum", "") or "-"))
        with row_cols[2]:
            render_read_only_table_cell(str(len(factuur.get("factuurregels", []))))
        with row_cols[3]:
            render_read_only_table_cell(f"{format_number(totals['totaal_liters'])} L")
        with row_cols[4]:
            render_currency_table_cell(total_cost)
        with row_cols[5]:
            if render_edit_button(key=f"inkoop_factuur_edit_{factuur_id}"):
                _start_edit_factuur(factuur)
                st.rerun()
        with row_cols[6]:
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

    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    factuur_col_1, factuur_col_2 = st.columns(2)
    with factuur_col_1:
        st.text_input("Factuurnummer", key=_widget_key("factuurnummer"))
    with factuur_col_2:
        st.date_input("Factuurdatum", key=_widget_key("factuurdatum"), format="DD-MM-YYYY")
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
        "Subbedrag",
        "Extra kosten",
        "p.p. eenheid",
        "Prijs per liter",
        "",
        "",
    ]
    row_widths = [1.1, 0.9, 0.9, 1.1, 1.05, 1.0, 1.0, 0.42, 0.42]
    render_table_headers(headers, row_widths)

    confirm_row_id = st.session_state.get("inkoop_factuur_delete_confirm_row_id", "")
    total_rows = len(rows)
    for row_index, row in enumerate(rows):
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
            render_currency_table_cell(toegerekende_extra_kosten)
        with row_cols[5]:
            render_currency_table_cell(prijs_per_eenheid)
        with row_cols[6]:
            render_currency_table_cell(prijs_per_liter)
        with row_cols[7]:
            if row_index == total_rows - 1:
                if render_add_button(key="inkoop_factuur_add_row", use_container_width=True):
                    current_rows = _get_rows_from_state()
                    current_rows.append(_empty_factuur_row())
                    _set_form_data(
                        {
                            **_current_form_factuur(),
                            "factuurregels": current_rows,
                        }
                    )
                    _bump_form_version()
                    st.rerun()
            else:
                st.write("")
        with row_cols[8]:
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

    totals = _factuur_totals(_current_form_factuur())
    summary_col_1, summary_col_2, summary_col_3, summary_col_4 = st.columns(4)
    with summary_col_1:
        render_read_only_table_cell(f"{format_number(totals['totaal_liters'])} L")
        st.caption("Totaal liters")
    with summary_col_2:
        render_currency_table_cell(totals["totaal_subfactuurbedrag"])
        st.caption("Totaal subfactuurbedrag")
    with summary_col_3:
        render_currency_table_cell(totals["totale_extra_kosten"])
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

    available_years = _available_years()
    st.markdown("<div class='main-card'>", unsafe_allow_html=True)
    render_breadcrumb(current_label="Inkoopfacturen", on_home_click=on_back)
    render_page_header(
        "Inkoopfacturen",
        "Voeg extra facturen toe aan een bestaande inkoopberekening. De gemiddelde inkoopkostprijs wordt daarna opnieuw opgebouwd uit alle facturen samen.",
    )
    _render_feedback()

    if not available_years:
        st.info("Er zijn nog geen berekeningen met soort 'Inkoop' beschikbaar.")
        col_back, _ = st.columns([1, 4])
        with col_back:
            if st.button("Terug naar welkom", key="inkoop_facturen_back_empty"):
                on_back()
        st.markdown("</div>", unsafe_allow_html=True)
        return

    selected_year = st.session_state.get("inkoop_facturen_selected_year")
    if selected_year not in available_years:
        selected_year = available_years[-1]
        st.session_state["inkoop_facturen_selected_year"] = selected_year

    year_col, _ = st.columns([1.2, 4.8])
    with year_col:
        selected_year = st.selectbox(
            "Jaar",
            options=available_years,
            index=available_years.index(selected_year),
            key="inkoop_facturen_selected_year",
        )

    _render_bier_overview(int(selected_year))

    active_record_id = str(st.session_state.get("inkoop_facturen_loaded_berekening_id", "") or "")
    record = _get_record_by_id(active_record_id) if active_record_id else None
    if record and st.session_state.get("inkoop_facturen_mode") in {MODE_ADD, MODE_EDIT}:
        st.write("")
        _render_record_summary(record)
        st.write("")
        _render_factuur_form(record)
        st.write("")
        _render_facturen_overview(record)
    col_back, _ = st.columns([1, 4])
    with col_back:
        if st.button("Terug naar welkom", key="inkoop_facturen_back"):
            on_back()

    st.markdown("</div>", unsafe_allow_html=True)








