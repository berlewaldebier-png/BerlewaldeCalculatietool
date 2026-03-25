from __future__ import annotations

from datetime import date
from typing import Any, Callable
from uuid import uuid4

import streamlit as st

from components.action_buttons import render_delete_button, render_edit_button
from components.page_ui import render_page_header
from components.table_ui import render_read_only_table_cell, render_table_headers
from components.wizard_ui import (
    apply_wizard_navigation_styles,
    render_step_sidebar,
    render_wizard_nav_row,
)
from pages.nieuwe_berekening.state import build_step_4_product_tables
from utils.storage import (
    VERKOOPSTRATEGIE_CATEGORIEN,
    delete_prijsvoorstel,
    finalize_prijsvoorstel,
    get_concept_prijsvoorstellen,
    get_definitieve_berekeningen,
    get_definitieve_prijsvoorstellen,
    get_next_prijsvoorstel_offertenummer,
    get_effective_verkoopstrategie_for_product,
    get_latest_verkoopstrategie_up_to_year,
    get_prijsvoorstel_by_id,
    load_verkoopstrategie_verpakkingen,
    save_prijsvoorstel_as_concept,
)


TOTAL_STEPS = 5
VOORSTELTYPE_LITERS = "Op basis van liters"
VOORSTELTYPE_PRODUCTEN = "Op basis van producten"
LITERS_BASIS_EEN_BIER = "een_bier"
LITERS_BASIS_MEERDERE_BIEREN = "meerdere_bieren"
LITERS_BASIS_ALGEMEEN = "algemeen"
FORM_STATE_KEY = "prijsvoorstel_form"
VIEW_MODE_KEY = "prijsvoorstel_view_mode"
ACTIVE_ID_KEY = "prijsvoorstel_active_id"
KANAAL_LABELS = {
    "particulier": "Particulier",
    "zakelijk": "Zakelijk",
    "retail": "Retail",
    "horeca": "Horeca",
    "slijterij": "Slijterij",
}
LITERS_BASIS_LABELS = {
    LITERS_BASIS_EEN_BIER: "Één bier",
    LITERS_BASIS_MEERDERE_BIEREN: "Meerdere bieren",
    LITERS_BASIS_ALGEMEEN: "Algemene hoogste kostprijs",
}


def _format_euro(value: float | int | None) -> str:
    try:
        amount = float(value or 0.0)
    except (TypeError, ValueError):
        amount = 0.0
    formatted = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return formatted


def _format_percentage(value: float | int | None) -> str:
    try:
        amount = float(value or 0.0)
    except (TypeError, ValueError):
        amount = 0.0
    return f"{amount:.2f}%".replace(".", ",")


def _format_date_nl(value: date | None) -> str:
    if not isinstance(value, date):
        return ""
    return value.strftime("%d-%m-%Y")


def _calculate_price_from_margin(
    kostprijs: float | int | None,
    marge_pct: float | int | None,
) -> float | None:
    try:
        kostprijs_value = float(kostprijs or 0.0)
        marge_value = float(marge_pct or 0.0)
    except (TypeError, ValueError):
        return None
    if kostprijs_value < 0 or marge_value < 0 or marge_value >= 100:
        return None
    deler = 1.0 - (marge_value / 100.0)
    if deler <= 0:
        return None
    return kostprijs_value / deler


def _step_titles() -> dict[int, str]:
    return {
        1: "Basisgegevens",
        2: "Uitgangspunten",
        3: "Berekening",
        4: "Samenvatting",
        5: "Afronden",
    }


def _empty_staffel_row() -> dict[str, Any]:
    return {"id": str(uuid4()), "product_key": "", "liters": 0.0, "korting_pct": 0.0}


def _empty_product_row() -> dict[str, Any]:
    return {"id": str(uuid4()), "product_key": "", "aantal": 0.0, "korting_pct": 0.0}


def _empty_beer_row() -> dict[str, Any]:
    return {"id": str(uuid4()), "bier_key": "", "product_key": "", "liters": 0.0, "korting_pct": 0.0}


def _default_year() -> int:
    return date.today().year


def _default_form_state() -> dict[str, Any]:
    vandaag = date.today()
    return {
        "offertenummer": "",
        "klantnaam": "",
        "contactpersoon": "",
        "referentie": "",
        "datum": vandaag,
        "datum_text": _format_date_nl(vandaag),
        "opmerking": "",
        "jaar": _default_year(),
        "type": VOORSTELTYPE_LITERS,
        "liters_basis": LITERS_BASIS_EEN_BIER,
        "kanaal": "horeca",
        "bier_key": "",
        "staffels": [_empty_staffel_row()],
        "product_rows": [_empty_product_row()],
        "beer_rows": [_empty_beer_row()],
    }


def _widget_key(field: str) -> str:
    return f"prijsvoorstel_widget_{field}"


def _get_form_state() -> dict[str, Any]:
    state = st.session_state.get(FORM_STATE_KEY)
    if not isinstance(state, dict):
        state = _default_form_state()
        st.session_state[FORM_STATE_KEY] = state
    return state


def _form_value(field: str, default: Any = None) -> Any:
    return _get_form_state().get(field, default)


def _hydrate_widget(field: str) -> None:
    widget = _widget_key(field)
    if widget not in st.session_state:
        st.session_state[widget] = _form_value(field)


def _parse_date_text(value: str) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        day, month, year = text.split("-")
        return date(int(year), int(month), int(day))
    except (TypeError, ValueError):
        return None


def _init_page_state() -> None:
    defaults = {
        "prijsvoorstel_step": 1,
        "prijsvoorstel_feedback": None,
        VIEW_MODE_KEY: "overview",
        ACTIVE_ID_KEY: "",
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value
    if FORM_STATE_KEY not in st.session_state or not isinstance(st.session_state.get(FORM_STATE_KEY), dict):
        migrated = _default_form_state()
        legacy_map = {
            "prijsvoorstel_klantnaam": "klantnaam",
            "prijsvoorstel_contactpersoon": "contactpersoon",
            "prijsvoorstel_referentie": "referentie",
            "prijsvoorstel_datum": "datum",
            "prijsvoorstel_datum_text": "datum_text",
            "prijsvoorstel_opmerking": "opmerking",
            "prijsvoorstel_jaar": "jaar",
            "prijsvoorstel_type": "type",
            "prijsvoorstel_liters_basis": "liters_basis",
            "prijsvoorstel_kanaal": "kanaal",
            "prijsvoorstel_bier_key": "bier_key",
            "prijsvoorstel_staffels": "staffels",
            "prijsvoorstel_product_rows": "product_rows",
            "prijsvoorstel_beer_rows": "beer_rows",
        }
        for legacy_key, field in legacy_map.items():
            if legacy_key in st.session_state:
                migrated[field] = st.session_state.get(legacy_key)
        st.session_state[FORM_STATE_KEY] = migrated


def init_page_state() -> None:
    _init_page_state()


def _reset_form_state() -> None:
    st.session_state[FORM_STATE_KEY] = _default_form_state()
    st.session_state["prijsvoorstel_step"] = 1
    st.session_state[ACTIVE_ID_KEY] = ""
    widget_prefixes = [
        "prijsvoorstel_widget_",
        "prijsvoorstel_staffel_",
        "prijsvoorstel_product_",
        "prijsvoorstel_beer_",
    ]
    for key in list(st.session_state.keys()):
        if any(str(key).startswith(prefix) for prefix in widget_prefixes):
            del st.session_state[key]


def _start_new_prijsvoorstel() -> None:
    _reset_form_state()
    _get_form_state()["offertenummer"] = get_next_prijsvoorstel_offertenummer()
    st.session_state[VIEW_MODE_KEY] = "wizard"


def _start_edit_prijsvoorstel(prijsvoorstel_id: str) -> None:
    record = get_prijsvoorstel_by_id(prijsvoorstel_id)
    if not record:
        _set_feedback("Prijsvoorstel niet gevonden.")
        return
    st.session_state[FORM_STATE_KEY] = {
        "offertenummer": str(record.get("offertenummer", "") or ""),
        "klantnaam": str(record.get("klantnaam", "") or ""),
        "contactpersoon": str(record.get("contactpersoon", "") or ""),
        "referentie": str(record.get("referentie", "") or ""),
        "datum": _parse_date_text(str(record.get("datum_text", "") or "")) or date.today(),
        "datum_text": str(record.get("datum_text", "") or ""),
        "opmerking": str(record.get("opmerking", "") or ""),
        "jaar": int(record.get("jaar", _default_year()) or _default_year()),
        "type": str(record.get("voorsteltype", VOORSTELTYPE_LITERS) or VOORSTELTYPE_LITERS),
        "liters_basis": str(record.get("liters_basis", LITERS_BASIS_EEN_BIER) or LITERS_BASIS_EEN_BIER),
        "kanaal": str(record.get("kanaal", "horeca") or "horeca"),
        "bier_key": str(record.get("bier_key", "") or ""),
        "staffels": list(record.get("staffels", []) or [_empty_staffel_row()]),
        "product_rows": list(record.get("product_rows", []) or [_empty_product_row()]),
        "beer_rows": list(record.get("beer_rows", []) or [_empty_beer_row()]),
    }
    st.session_state["prijsvoorstel_step"] = int(record.get("last_step", 1) or 1)
    st.session_state[ACTIVE_ID_KEY] = str(record.get("id", "") or "")
    st.session_state[VIEW_MODE_KEY] = "wizard"
    for key in list(st.session_state.keys()):
        if (
            str(key).startswith("prijsvoorstel_widget_")
            or str(key).startswith("prijsvoorstel_staffel_")
            or str(key).startswith("prijsvoorstel_product_")
            or str(key).startswith("prijsvoorstel_beer_")
        ):
            del st.session_state[key]


def _serialize_current_form(*, status: str) -> dict[str, Any]:
    _sync_state_from_widgets()
    form_state = _get_form_state()
    return {
        "id": str(st.session_state.get(ACTIVE_ID_KEY, "") or ""),
        "status": status,
        "offertenummer": str(form_state.get("offertenummer", "") or ""),
        "klantnaam": str(form_state.get("klantnaam", "") or ""),
        "contactpersoon": str(form_state.get("contactpersoon", "") or ""),
        "referentie": str(form_state.get("referentie", "") or ""),
        "datum_text": str(form_state.get("datum_text", "") or ""),
        "opmerking": str(form_state.get("opmerking", "") or ""),
        "jaar": int(form_state.get("jaar", _default_year()) or _default_year()),
        "voorsteltype": str(form_state.get("type", VOORSTELTYPE_LITERS) or VOORSTELTYPE_LITERS),
        "liters_basis": str(form_state.get("liters_basis", LITERS_BASIS_EEN_BIER) or LITERS_BASIS_EEN_BIER),
        "kanaal": str(form_state.get("kanaal", "horeca") or "horeca"),
        "bier_key": str(form_state.get("bier_key", "") or ""),
        "staffels": list(form_state.get("staffels", [])),
        "product_rows": list(form_state.get("product_rows", [])),
        "beer_rows": list(form_state.get("beer_rows", [])),
        "last_step": int(st.session_state.get("prijsvoorstel_step", 1) or 1),
    }


def _save_and_close_as_concept() -> None:
    saved = save_prijsvoorstel_as_concept(_serialize_current_form(status="concept"))
    if saved:
        st.session_state[ACTIVE_ID_KEY] = str(saved.get("id", "") or "")
        st.session_state[VIEW_MODE_KEY] = "overview"
        _set_feedback("Prijsvoorstel opgeslagen als concept.")
        _reset_form_state()


def _finalize_and_close() -> None:
    saved = finalize_prijsvoorstel(_serialize_current_form(status="definitief"))
    if saved:
        st.session_state[ACTIVE_ID_KEY] = str(saved.get("id", "") or "")
        st.session_state[VIEW_MODE_KEY] = "overview"
        _set_feedback("Prijsvoorstel definitief gemaakt.")
        _reset_form_state()


def _set_feedback(message: str) -> None:
    st.session_state["prijsvoorstel_feedback"] = message


def _render_feedback() -> None:
    message = st.session_state.pop("prijsvoorstel_feedback", None)
    if message:
        st.success(message)


def render_feedback() -> None:
    _render_feedback()


def _render_prijsvoorstellen_tabel(title: str, records: list[dict[str, Any]], *, key_prefix: str) -> None:
    st.markdown(
        f"<div class='section-title' style='font-size:1.35rem;'>{title}</div>",
        unsafe_allow_html=True,
    )
    if not records:
        st.info(f"Nog geen {title.lower()}")
        return

    headers = ["Naam klant", "Offertenummer", "Referentie", "Datum", "Voorsteltype", "", ""]
    row_widths = [1.55, 1.15, 1.45, 1.0, 1.35, 0.42, 0.42]
    render_table_headers(headers, row_widths)

    for record in records:
        record_id = str(record.get("id", "") or "")
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            render_read_only_table_cell(str(record.get("klantnaam", "") or "-"))
        with row_cols[1]:
            render_read_only_table_cell(str(record.get("offertenummer", "") or "-"))
        with row_cols[2]:
            render_read_only_table_cell(str(record.get("referentie", "") or "-"))
        with row_cols[3]:
            render_read_only_table_cell(str(record.get("datum_text", "") or "-"))
        with row_cols[4]:
            render_read_only_table_cell(str(record.get("voorsteltype", "") or "-"))
        with row_cols[5]:
            if render_edit_button(key=f"{key_prefix}_edit_{record_id}"):
                _start_edit_prijsvoorstel(record_id)
                st.rerun()
        with row_cols[6]:
            if render_delete_button(key=f"{key_prefix}_delete_{record_id}"):
                delete_prijsvoorstel(record_id)
                _set_feedback("Prijsvoorstel verwijderd.")
                st.rerun()


def _render_overview(on_back: Callable[[], None]) -> None:
    render_page_header(
        "Prijsvoorstel maken",
        "Beheer hier concepten en definitieve prijsvoorstellen.",
    )
    top_col, spacer_col = st.columns([1.2, 4.8])
    with top_col:
        if st.button("Toevoegen", key="prijsvoorstel_add"):
            _start_new_prijsvoorstel()
            st.rerun()
    with spacer_col:
        st.write("")

    _render_prijsvoorstellen_tabel(
        "Concept prijsvoorstellen",
        get_concept_prijsvoorstellen(),
        key_prefix="pp_concept",
    )
    st.write("")
    _render_prijsvoorstellen_tabel(
        "Definitieve prijsvoorstellen",
        get_definitieve_prijsvoorstellen(),
        key_prefix="pp_definitief",
    )

    back_col, _ = st.columns([1.2, 4.8])
    with back_col:
        if st.button("Terug naar welkom", key="prijsvoorstel_overview_back"):
            on_back()


def _record_sort_key(record: dict[str, Any]) -> str:
    return str(
        record.get("updated_at")
        or record.get("finalized_at")
        or record.get("created_at")
        or ""
    )


def _bier_group_key(record: dict[str, Any]) -> str:
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    bier_id = str(record.get("bier_id", "") or "")
    fallback_key = "|".join(
        [
            str(basisgegevens.get("biernaam", "") or ""),
            str(basisgegevens.get("stijl", "") or ""),
        ]
    )
    return bier_id or fallback_key


def _latest_definitive_records_up_to_year(year: int) -> list[dict[str, Any]]:
    latest_by_bier: dict[str, dict[str, Any]] = {}
    for record in get_definitieve_berekeningen():
        basisgegevens = record.get("basisgegevens", {})
        if not isinstance(basisgegevens, dict):
            basisgegevens = {}
        record_year = int(basisgegevens.get("jaar", 0) or 0)
        if record_year <= 0 or record_year > year:
            continue
        key = _bier_group_key(record)
        current = latest_by_bier.get(key)
        if current is None or _record_sort_key(record) > _record_sort_key(current):
            latest_by_bier[key] = record
    return sorted(
        latest_by_bier.values(),
        key=lambda item: str(item.get("basisgegevens", {}).get("biernaam", "") or "").lower(),
    )


def _records_for_bier_up_to_year(year: int, bier_key: str) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for record in get_definitieve_berekeningen():
        basisgegevens = record.get("basisgegevens", {})
        if not isinstance(basisgegevens, dict):
            basisgegevens = {}
        record_year = int(basisgegevens.get("jaar", 0) or 0)
        if record_year <= 0 or record_year > year:
            continue
        if _bier_group_key(record) == bier_key:
            matches.append(record)
    return sorted(matches, key=_record_sort_key, reverse=True)


def _bier_options(year: int) -> tuple[list[str], dict[str, str]]:
    options = [""]
    labels = {"": "Selecteer bier"}
    for record in _latest_definitive_records_up_to_year(year):
        basisgegevens = record.get("basisgegevens", {})
        if not isinstance(basisgegevens, dict):
            basisgegevens = {}
        bier_key = _bier_group_key(record)
        biernaam = str(basisgegevens.get("biernaam", "") or "Onbekend")
        stijl = str(basisgegevens.get("stijl", "") or "-")
        bronjaar = int(basisgegevens.get("jaar", 0) or 0)
        options.append(bier_key)
        labels[bier_key] = f"{biernaam} ({stijl}) - bronjaar {bronjaar}"
    return options, labels


def _highest_cost_for_bier(year: int, bier_key: str) -> tuple[float | None, int | None]:
    hoogste_kostprijs: float | None = None
    bronjaar: int | None = None
    for record in _records_for_bier_up_to_year(year, bier_key):
        basisgegevens = record.get("basisgegevens", {})
        if not isinstance(basisgegevens, dict):
            basisgegevens = {}
        snapshot = record.get("resultaat_snapshot", {})
        if not isinstance(snapshot, dict):
            snapshot = {}
        try:
            kostprijs = float(snapshot.get("integrale_kostprijs_per_liter", 0.0) or 0.0)
        except (TypeError, ValueError):
            continue
        if hoogste_kostprijs is None or kostprijs > hoogste_kostprijs:
            hoogste_kostprijs = kostprijs
            bronjaar = int(basisgegevens.get("jaar", 0) or 0)
    return hoogste_kostprijs, bronjaar


def _latest_record_for_bier(year: int, bier_key: str) -> dict[str, Any] | None:
    records = _records_for_bier_up_to_year(year, bier_key)
    return records[0] if records else None


def _highest_cost_overall(year: int) -> tuple[float | None, int | None, str]:
    hoogste_kostprijs: float | None = None
    bronjaar: int | None = None
    biernaam = ""
    for record in _latest_definitive_records_up_to_year(year):
        basisgegevens = record.get("basisgegevens", {})
        if not isinstance(basisgegevens, dict):
            basisgegevens = {}
        snapshot = record.get("resultaat_snapshot", {})
        if not isinstance(snapshot, dict):
            snapshot = {}
        try:
            kostprijs = float(snapshot.get("integrale_kostprijs_per_liter", 0.0) or 0.0)
        except (TypeError, ValueError):
            continue
        if hoogste_kostprijs is None or kostprijs > hoogste_kostprijs:
            hoogste_kostprijs = kostprijs
            bronjaar = int(basisgegevens.get("jaar", 0) or 0)
            biernaam = str(basisgegevens.get("biernaam", "") or "-")
    return hoogste_kostprijs, bronjaar, biernaam


def _selected_strategy(year: int) -> dict[str, Any] | None:
    strategy = get_latest_verkoopstrategie_up_to_year(year)
    return strategy if isinstance(strategy, dict) else None


def _has_strategy_for_year(year: int) -> bool:
    if _selected_strategy(year) is not None:
        return True
    for record in load_verkoopstrategie_verpakkingen():
        try:
            record_year = int(record.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            record_year = 0
        if 0 < record_year <= year:
            return True
    return False


def _kanaal_marge(year: int, kanaal: str) -> float | None:
    strategy = _selected_strategy(year)
    if not strategy:
        return None
    kanaalmarges = strategy.get("kanaalmarges", {})
    if not isinstance(kanaalmarges, dict):
        return None
    try:
        return float(kanaalmarges.get(kanaal, 0.0) or 0.0)
    except (TypeError, ValueError):
        return None


def _strategy_kanaalmarges(strategy: dict[str, Any] | None) -> dict[str, float]:
    if not isinstance(strategy, dict):
        return {}
    raw = strategy.get("kanaalmarges", {})
    if not isinstance(raw, dict):
        return {}
    margins: dict[str, float] = {}
    for categorie in VERKOOPSTRATEGIE_CATEGORIEN:
        try:
            margins[categorie] = float(raw.get(categorie, 0.0) or 0.0)
        except (TypeError, ValueError):
            margins[categorie] = 0.0
    return margins


def _effective_strategy_for_context(
    year: int,
    bier_key: str = "",
    product_key: str = "",
    verpakking: str = "",
) -> dict[str, Any] | None:
    bier_key_value = str(bier_key or "")
    product_key_value = str(product_key or "")
    verpakking_value = str(verpakking or "")
    if bier_key_value and product_key_value:
        strategy = get_effective_verkoopstrategie_for_product(
            year,
            bier_key_value,
            product_key_value,
            verpakking_value,
        )
        if isinstance(strategy, dict):
            return strategy
    return _selected_strategy(year)


def _effective_channel_margin_for_context(
    year: int,
    kanaal: str,
    bier_key: str = "",
    product_key: str = "",
    verpakking: str = "",
) -> float | None:
    strategy = _effective_strategy_for_context(
        year,
        bier_key=bier_key,
        product_key=product_key,
        verpakking=verpakking,
    )
    kanaalmarges = _strategy_kanaalmarges(strategy)
    try:
        return float(kanaalmarges.get(kanaal, 0.0) or 0.0)
    except (TypeError, ValueError):
        return None


def _effective_channel_prices_for_cost(
    year: int,
    kostprijs: float | int | None,
    bier_key: str = "",
    product_key: str = "",
    verpakking: str = "",
) -> dict[str, float | None]:
    strategy = _effective_strategy_for_context(
        year,
        bier_key=bier_key,
        product_key=product_key,
        verpakking=verpakking,
    )
    kanaalmarges = _strategy_kanaalmarges(strategy)
    return {
        categorie: _calculate_price_from_margin(kostprijs, kanaalmarges.get(categorie))
        for categorie in VERKOOPSTRATEGIE_CATEGORIEN
    }


def _effective_strategy_source_label(
    year: int,
    bier_key: str = "",
    product_key: str = "",
    verpakking: str = "",
) -> str:
    strategy = _effective_strategy_for_context(
        year,
        bier_key=bier_key,
        product_key=product_key,
        verpakking=verpakking,
    )
    if not isinstance(strategy, dict):
        return "-"
    record_type = str(strategy.get("record_type", "") or "")
    strategy_year = int(strategy.get("jaar", 0) or 0)
    strategy_type = str(strategy.get("strategie_type", "") or "")
    if record_type == "verkoopstrategie_product" and strategy_type == "uitzondering":
        return f"Overzicht bieren {strategy_year}"
    if record_type == "verkoopstrategie_verpakking":
        return f"Marges per jaar {strategy_year}"
    if record_type == "jaarstrategie":
        return f"Legacy jaarstrategie {strategy_year}"
    return str(strategy_year or "-")


def _build_product_rows_for_bier(year: int, bier_key: str) -> list[dict[str, Any]]:
    record = _latest_record_for_bier(year, bier_key)
    if not record:
        return []

    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}

    raw_rows: list[dict[str, Any]] = []
    tables = build_step_4_product_tables(record)
    for group_name, product_type in [
        ("samengestelde_producten", "samengesteld"),
        ("basisproducten", "basis"),
    ]:
        for product in tables.get(group_name, []):
            if not isinstance(product, dict):
                continue
            kostprijs = float(
                float(product.get("variabele_kosten", 0.0) or 0.0)
                + float(product.get("verpakkingskosten", 0.0) or 0.0)
                + float(product.get("vaste_directe_kosten", 0.0) or 0.0)
                + float(product.get("accijns", 0.0) or 0.0)
            )
            verpakking = str(product.get("verpakking", "") or "-")
            product_key = f"{product_type}|{verpakking.strip().lower()}"
            strategy = get_effective_verkoopstrategie_for_product(
                year,
                _bier_group_key(record),
                product_key,
                verpakking,
            )
            kanaalmarges = strategy.get("kanaalmarges", {}) if isinstance(strategy, dict) else {}
            if not isinstance(kanaalmarges, dict):
                kanaalmarges = {}
            raw_rows.append(
                {
                    "product_type": product_type,
                    "product_key": product_key,
                    "biernaam": str(basisgegevens.get("biernaam", "") or "-"),
                    "stijl": str(basisgegevens.get("stijl", "") or "-"),
                    "verpakking": verpakking,
                    "liters_per_product": float(product.get("liters_per_product", 0.0) or 0.0),
                    "kostprijs": kostprijs,
                    **{
                        categorie: _calculate_price_from_margin(
                            kostprijs,
                            kanaalmarges.get(categorie),
                        )
                        for categorie in VERKOOPSTRATEGIE_CATEGORIEN
                    },
                }
            )

    deduped: dict[str, dict[str, Any]] = {}
    for row in raw_rows:
        key = str(row.get("product_key", "") or "")
        if not key:
            continue
        current = deduped.get(key)
        if current is None or (
            current.get("product_type") != "samengesteld"
            and row.get("product_type") == "samengesteld"
        ):
            deduped[key] = row

    return sorted(
        deduped.values(),
        key=lambda item: str(item.get("verpakking", "") or "").lower(),
    )


def _fust_cost_insights(year: int, bier_key: str) -> list[dict[str, Any]]:
    return [
        row
        for row in _build_product_rows_for_bier(year, bier_key)
        if "fust" in str(row.get("verpakking", "") or "").strip().lower()
    ]


def _product_map_for_bier(year: int, bier_key: str) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("product_key", "") or ""): row
        for row in _build_product_rows_for_bier(year, bier_key)
        if str(row.get("product_key", "") or "")
    }


def _product_cost_per_liter(product_row: dict[str, Any] | None) -> float | None:
    if not isinstance(product_row, dict):
        return None
    try:
        liters_per_product = float(product_row.get("liters_per_product", 0.0) or 0.0)
        kostprijs = float(product_row.get("kostprijs", 0.0) or 0.0)
    except (TypeError, ValueError):
        return None
    if liters_per_product <= 0:
        return None
    return kostprijs / liters_per_product


def _product_channel_price_per_liter(
    product_row: dict[str, Any] | None,
    kanaal: str,
) -> float | None:
    if not isinstance(product_row, dict):
        return None
    try:
        liters_per_product = float(product_row.get("liters_per_product", 0.0) or 0.0)
        kanaalprijs = float(product_row.get(kanaal, 0.0) or 0.0)
    except (TypeError, ValueError):
        return None
    if liters_per_product <= 0:
        return None
    return kanaalprijs / liters_per_product


def _product_channel_margin_pct(
    product_row: dict[str, Any] | None,
    kanaal: str,
) -> float | None:
    if not isinstance(product_row, dict):
        return None
    try:
        kostprijs = float(product_row.get("kostprijs", 0.0) or 0.0)
        kanaalprijs = float(product_row.get(kanaal, 0.0) or 0.0)
    except (TypeError, ValueError):
        return None
    if kanaalprijs <= 0:
        return None
    return (1.0 - (kostprijs / kanaalprijs)) * 100.0


def _highest_product_cost_for_bier(year: int, bier_key: str) -> tuple[float | None, str]:
    highest_cost: float | None = None
    highest_label = ""
    for row in _build_product_rows_for_bier(year, bier_key):
        cost_per_liter = _product_cost_per_liter(row)
        if cost_per_liter is None:
            continue
        if highest_cost is None or cost_per_liter > highest_cost:
            highest_cost = cost_per_liter
            highest_label = str(row.get("verpakking", "") or "-")
    return highest_cost, highest_label


def _product_options_for_bier(
    year: int,
    bier_key: str,
    *,
    current_key: str = "",
    excluded_keys: set[str] | None = None,
) -> tuple[list[str], dict[str, str]]:
    product_rows = _build_product_rows_for_bier(year, bier_key)
    excluded = {str(key or "") for key in (excluded_keys or set()) if str(key or "")}
    current = str(current_key or "")
    options = [""]
    labels = {"": "Selecteer verpakking"}
    for row in product_rows:
        product_key = str(row.get("product_key", "") or "")
        if not product_key:
            continue
        if product_key in excluded and product_key != current:
            continue
        options.append(product_key)
        product_type = "Samengesteld" if str(row.get("product_type", "") or "") == "samengesteld" else "Basisproduct"
        labels[product_key] = f"{str(row.get('verpakking', '') or '-')} ({product_type})"
    if current and current not in options:
        options.append(current)
        labels.setdefault(current, current)
    return options, labels


def _ensure_staffels() -> None:
    form_state = _get_form_state()
    rows = form_state.get("staffels", [])
    if not isinstance(rows, list) or not rows:
        form_state["staffels"] = [_empty_staffel_row()]


def _ensure_product_rows() -> None:
    form_state = _get_form_state()
    rows = form_state.get("product_rows", [])
    if not isinstance(rows, list) or not rows:
        form_state["product_rows"] = [_empty_product_row()]


def _ensure_beer_rows() -> None:
    form_state = _get_form_state()
    rows = form_state.get("beer_rows", [])
    if not isinstance(rows, list) or not rows:
        form_state["beer_rows"] = [_empty_beer_row()]


def _staffel_widget_key(row_id: str, field: str) -> str:
    return f"prijsvoorstel_staffel_{field}_{row_id}"


def _product_widget_key(row_id: str, field: str) -> str:
    return f"prijsvoorstel_product_{field}_{row_id}"


def _beer_widget_key(row_id: str, field: str) -> str:
    return f"prijsvoorstel_beer_{field}_{row_id}"


def _hydrate_staffel_widgets() -> None:
    for row in _form_value("staffels", []):
        row_id = str(row.get("id", "") or "")
        if not row_id:
            continue
        st.session_state.setdefault(_staffel_widget_key(row_id, "product"), str(row.get("product_key", "") or ""))
        st.session_state.setdefault(_staffel_widget_key(row_id, "liters"), float(row.get("liters", 0.0) or 0.0))
        st.session_state.setdefault(_staffel_widget_key(row_id, "korting"), float(row.get("korting_pct", 0.0) or 0.0))


def _hydrate_product_widgets() -> None:
    for row in _form_value("product_rows", []):
        row_id = str(row.get("id", "") or "")
        if not row_id:
            continue
        st.session_state.setdefault(_product_widget_key(row_id, "product"), str(row.get("product_key", "") or ""))
        st.session_state.setdefault(_product_widget_key(row_id, "aantal"), float(row.get("aantal", 0.0) or 0.0))
        st.session_state.setdefault(_product_widget_key(row_id, "korting"), float(row.get("korting_pct", 0.0) or 0.0))


def _hydrate_beer_widgets() -> None:
    for row in _form_value("beer_rows", []):
        row_id = str(row.get("id", "") or "")
        if not row_id:
            continue
        st.session_state.setdefault(_beer_widget_key(row_id, "bier"), str(row.get("bier_key", "") or ""))
        st.session_state.setdefault(_beer_widget_key(row_id, "product"), str(row.get("product_key", "") or ""))
        st.session_state.setdefault(_beer_widget_key(row_id, "liters"), float(row.get("liters", 0.0) or 0.0))
        st.session_state.setdefault(_beer_widget_key(row_id, "korting"), float(row.get("korting_pct", 0.0) or 0.0))


def _current_staffels() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in _form_value("staffels", []):
        row_id = str(row.get("id", "") or "")
        if not row_id:
            continue
        rows.append(
            {
                "id": row_id,
                "product_key": str(
                    st.session_state.get(
                        _staffel_widget_key(row_id, "product"),
                        row.get("product_key", ""),
                    )
                    or ""
                ),
                "liters": float(
                    st.session_state.get(
                        _staffel_widget_key(row_id, "liters"),
                        row.get("liters", 0.0),
                    )
                    or 0.0
                ),
                "korting_pct": float(
                    st.session_state.get(
                        _staffel_widget_key(row_id, "korting"),
                        row.get("korting_pct", 0.0),
                    )
                    or 0.0
                ),
            }
        )
    return rows


def _current_product_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in _form_value("product_rows", []):
        row_id = str(row.get("id", "") or "")
        if not row_id:
            continue
        rows.append(
            {
                "id": row_id,
                "product_key": str(
                    st.session_state.get(
                        _product_widget_key(row_id, "product"),
                        row.get("product_key", ""),
                    )
                    or ""
                ),
                "aantal": float(
                    st.session_state.get(
                        _product_widget_key(row_id, "aantal"),
                        row.get("aantal", 0.0),
                    )
                    or 0.0
                ),
                "korting_pct": float(
                    st.session_state.get(
                        _product_widget_key(row_id, "korting"),
                        row.get("korting_pct", 0.0),
                    )
                    or 0.0
                ),
            }
        )
    return rows


def _current_beer_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in _form_value("beer_rows", []):
        row_id = str(row.get("id", "") or "")
        if not row_id:
            continue
        rows.append(
            {
                "id": row_id,
                "bier_key": str(st.session_state.get(_beer_widget_key(row_id, "bier"), row.get("bier_key", "")) or ""),
                "product_key": str(st.session_state.get(_beer_widget_key(row_id, "product"), row.get("product_key", "")) or ""),
                "liters": float(st.session_state.get(_beer_widget_key(row_id, "liters"), row.get("liters", 0.0)) or 0.0),
                "korting_pct": float(st.session_state.get(_beer_widget_key(row_id, "korting"), row.get("korting_pct", 0.0)) or 0.0),
            }
        )
    return rows


def _sync_state_from_widgets() -> None:
    """Schrijft de actuele widgetwaarden terug naar de wizardstate."""
    form_state = _get_form_state()
    updates = {
        "klantnaam": str(st.session_state.get(_widget_key("klantnaam"), form_state.get("klantnaam", "")) or ""),
        "contactpersoon": str(st.session_state.get(_widget_key("contactpersoon"), form_state.get("contactpersoon", "")) or ""),
        "referentie": str(st.session_state.get(_widget_key("referentie"), form_state.get("referentie", "")) or ""),
        "datum_text": str(st.session_state.get(_widget_key("datum_text"), form_state.get("datum_text", "")) or ""),
        "opmerking": str(st.session_state.get(_widget_key("opmerking"), form_state.get("opmerking", "")) or ""),
        "jaar": int(st.session_state.get(_widget_key("jaar"), form_state.get("jaar", _default_year())) or _default_year()),
        "type": str(st.session_state.get(_widget_key("type"), form_state.get("type", VOORSTELTYPE_LITERS)) or VOORSTELTYPE_LITERS),
        "liters_basis": str(st.session_state.get(_widget_key("liters_basis"), form_state.get("liters_basis", LITERS_BASIS_EEN_BIER)) or LITERS_BASIS_EEN_BIER),
        "kanaal": str(st.session_state.get(_widget_key("kanaal"), form_state.get("kanaal", "horeca")) or "horeca"),
        "bier_key": str(st.session_state.get(_widget_key("bier_key"), form_state.get("bier_key", "")) or ""),
        "staffels": _current_staffels(),
        "product_rows": _current_product_rows(),
        "beer_rows": _current_beer_rows(),
    }
    parsed_date = _parse_date_text(updates["datum_text"])
    if parsed_date is not None:
        updates["datum"] = parsed_date
    else:
        updates["datum"] = form_state.get("datum")
    form_state.update(updates)


def _add_staffel_row() -> None:
    rows = list(_current_staffels())
    rows.append(_empty_staffel_row())
    _get_form_state()["staffels"] = rows


def _remove_staffel_row(row_id: str) -> None:
    rows = [row for row in _current_staffels() if str(row.get("id", "") or "") != row_id]
    _get_form_state()["staffels"] = rows or [_empty_staffel_row()]


def _add_product_row() -> None:
    rows = list(_current_product_rows())
    rows.append(_empty_product_row())
    _get_form_state()["product_rows"] = rows


def _remove_product_row(row_id: str) -> None:
    rows = [row for row in _current_product_rows() if str(row.get("id", "") or "") != row_id]
    _get_form_state()["product_rows"] = rows or [_empty_product_row()]


def _add_beer_row() -> None:
    rows = list(_current_beer_rows())
    rows.append(_empty_beer_row())
    _get_form_state()["beer_rows"] = rows


def _remove_beer_row(row_id: str) -> None:
    rows = [row for row in _current_beer_rows() if str(row.get("id", "") or "") != row_id]
    _get_form_state()["beer_rows"] = rows or [_empty_beer_row()]


def _liters_results() -> list[dict[str, Any]]:
    jaar = int(_form_value("jaar", _default_year()) or _default_year())
    kanaal = str(_form_value("kanaal", "horeca") or "horeca")
    liters_basis = str(_form_value("liters_basis", LITERS_BASIS_EEN_BIER) or LITERS_BASIS_EEN_BIER)
    results: list[dict[str, Any]] = []
    marge = _kanaal_marge(jaar, kanaal)

    if liters_basis == LITERS_BASIS_ALGEMEEN:
        hoogste_kostprijs, bronjaar, bronbier = _highest_cost_overall(jaar)
        referentieprijs = _calculate_price_from_margin(hoogste_kostprijs, marge)
        if hoogste_kostprijs is None or referentieprijs is None:
            return results
        for row in _current_staffels():
            liters = float(row.get("liters", 0.0) or 0.0)
            korting_pct = float(row.get("korting_pct", 0.0) or 0.0)
            prijs_per_liter = referentieprijs * max(0.0, 1.0 - (korting_pct / 100.0))
            omzet = liters * prijs_per_liter
            kosten = liters * hoogste_kostprijs
            marge_eur = omzet - kosten
            marge_pct = (marge_eur / omzet * 100.0) if omzet > 0 else 0.0
            results.append(
                {
                    "id": row["id"],
                    "biernaam": bronbier,
                    "bronjaar": bronjaar,
                    "liters": liters,
                    "korting_pct": korting_pct,
                    "referentieprijs": referentieprijs,
                    "prijs_per_liter": prijs_per_liter,
                    "kosten": kosten,
                    "omzet": omzet,
                    "marge_eur": marge_eur,
                    "marge_pct": marge_pct,
                }
            )
        return results

    if liters_basis == LITERS_BASIS_MEERDERE_BIEREN:
        for row in _current_beer_rows():
            bier_key = str(row.get("bier_key", "") or "")
            product_key = str(row.get("product_key", "") or "")
            if not bier_key or not product_key:
                continue
            bier_record = _latest_record_for_bier(jaar, bier_key)
            basisgegevens = bier_record.get("basisgegevens", {}) if isinstance(bier_record, dict) else {}
            if not isinstance(basisgegevens, dict):
                basisgegevens = {}
            bronjaar = int(basisgegevens.get("jaar", 0) or 0)
            product = _product_map_for_bier(jaar, bier_key).get(product_key)
            kostprijs_per_liter = _product_cost_per_liter(product)
            referentieprijs = _product_channel_price_per_liter(product, kanaal)
            if kostprijs_per_liter is None or referentieprijs is None:
                continue
            liters = float(row.get("liters", 0.0) or 0.0)
            korting_pct = float(row.get("korting_pct", 0.0) or 0.0)
            prijs_per_liter = referentieprijs * max(0.0, 1.0 - (korting_pct / 100.0))
            omzet = liters * prijs_per_liter
            kosten = liters * kostprijs_per_liter
            marge_eur = omzet - kosten
            marge_pct = (marge_eur / omzet * 100.0) if omzet > 0 else 0.0
            results.append(
                {
                    "id": row["id"],
                    "bier_key": bier_key,
                    "biernaam": str(basisgegevens.get("biernaam", "") or "-"),
                    "product_key": product_key,
                    "verpakking": str((product or {}).get("verpakking", "") or "-"),
                    "bronjaar": bronjaar,
                    "liters": liters,
                    "korting_pct": korting_pct,
                    "referentieprijs": referentieprijs,
                    "prijs_per_liter": prijs_per_liter,
                    "kosten": kosten,
                    "omzet": omzet,
                    "marge_eur": marge_eur,
                    "marge_pct": marge_pct,
                }
            )
        return results

    bier_key = str(_form_value("bier_key", "") or "")
    bier_record = _latest_record_for_bier(jaar, bier_key)
    basisgegevens = bier_record.get("basisgegevens", {}) if isinstance(bier_record, dict) else {}
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    bronjaar = int(basisgegevens.get("jaar", 0) or 0)
    product_map = _product_map_for_bier(jaar, bier_key)
    for row in _current_staffels():
        product_key = str(row.get("product_key", "") or "")
        product = product_map.get(product_key)
        kostprijs_per_liter = _product_cost_per_liter(product)
        referentieprijs = _product_channel_price_per_liter(product, kanaal)
        if kostprijs_per_liter is None or referentieprijs is None:
            continue
        liters = float(row.get("liters", 0.0) or 0.0)
        korting_pct = float(row.get("korting_pct", 0.0) or 0.0)
        prijs_per_liter = referentieprijs * max(0.0, 1.0 - (korting_pct / 100.0))
        omzet = liters * prijs_per_liter
        kosten = liters * kostprijs_per_liter
        marge_eur = omzet - kosten
        marge_pct = (marge_eur / omzet * 100.0) if omzet > 0 else 0.0
        results.append(
            {
                "id": row["id"],
                "bier_key": bier_key,
                "biernaam": str(basisgegevens.get("biernaam", "") or "-"),
                "product_key": product_key,
                "verpakking": str((product or {}).get("verpakking", "") or "-"),
                "bronjaar": bronjaar,
                "liters": liters,
                "korting_pct": korting_pct,
                "referentieprijs": referentieprijs,
                "prijs_per_liter": prijs_per_liter,
                "kosten": kosten,
                "omzet": omzet,
                "marge_eur": marge_eur,
                "marge_pct": marge_pct,
            }
        )
    return results


def _product_results() -> list[dict[str, Any]]:
    jaar = int(_form_value("jaar", _default_year()) or _default_year())
    bier_key = str(_form_value("bier_key", "") or "")
    kanaal = str(_form_value("kanaal", "horeca") or "horeca")
    products = {row["product_key"]: row for row in _build_product_rows_for_bier(jaar, bier_key)}
    results: list[dict[str, Any]] = []
    for row in _current_product_rows():
        product = products.get(str(row.get("product_key", "") or ""))
        if not product:
            continue
        aantal = float(row.get("aantal", 0.0) or 0.0)
        korting_pct = float(row.get("korting_pct", 0.0) or 0.0)
        basisprijs = float(product.get(kanaal, 0.0) or 0.0)
        verkoopprijs = basisprijs * max(0.0, 1.0 - (korting_pct / 100.0))
        kostprijs = float(product.get("kostprijs", 0.0) or 0.0)
        omzet = aantal * verkoopprijs
        kosten = aantal * kostprijs
        marge_eur = omzet - kosten
        marge_pct = (marge_eur / omzet * 100.0) if omzet > 0 else 0.0
        results.append(
            {
                "id": row["id"],
                "verpakking": str(product.get("verpakking", "-") or "-"),
                "aantal": aantal,
                "korting_pct": korting_pct,
                "kostprijs": kostprijs,
                "basisprijs": basisprijs,
                "verkoopprijs": verkoopprijs,
                "omzet": omzet,
                "kosten": kosten,
                "marge_eur": marge_eur,
                "marge_pct": marge_pct,
            }
        )
    return results


def _validate_step(step: int) -> bool:
    if step == 1:
        klantnaam = str(_form_value("klantnaam", "") or "").strip()
        if not klantnaam:
            st.error("Vul minimaal een klantnaam in.")
            return False
    if step == 2:
        jaar = int(_form_value("jaar", 0) or 0)
        if jaar <= 0:
            st.error("Kies een geldig verkoopjaar.")
            return False
        if not _has_strategy_for_year(jaar):
            st.error("Er is nog geen verkoopstrategie beschikbaar voor dit jaar of een eerder bronjaar.")
            return False
    if step == 3:
        bier_key = str(_form_value("bier_key", "") or "")
        if not bier_key:
            st.error("Selecteer eerst een bier.")
            return False
        voorstel_type = str(_form_value("type", VOORSTELTYPE_LITERS))
        if voorstel_type == VOORSTELTYPE_LITERS:
            if not any(float(row.get("liters", 0.0) or 0.0) > 0 for row in _current_staffels()):
                st.error("Vul minimaal één staffel met liters in.")
                return False
        else:
            if not any(float(row.get("aantal", 0.0) or 0.0) > 0 for row in _current_product_rows()):
                st.error("Vul minimaal één productregel met aantal in.")
                return False
    return True


def _validate_step_v2(step: int) -> bool:
    if step == 1:
        klantnaam = str(_form_value("klantnaam", "") or "").strip()
        if not klantnaam:
            st.error("Vul minimaal een klantnaam in.")
            return False
    if step == 2:
        jaar = int(_form_value("jaar", 0) or 0)
        if jaar <= 0:
            st.error("Kies een geldig verkoopjaar.")
            return False
        if not _has_strategy_for_year(jaar):
            st.error("Er is nog geen verkoopstrategie beschikbaar voor dit jaar of een eerder bronjaar.")
            return False
    if step == 3:
        voorstel_type = str(_form_value("type", VOORSTELTYPE_LITERS))
        if voorstel_type == VOORSTELTYPE_LITERS:
            liters_basis = str(_form_value("liters_basis", LITERS_BASIS_EEN_BIER) or LITERS_BASIS_EEN_BIER)
            if liters_basis == LITERS_BASIS_EEN_BIER:
                bier_key = str(_form_value("bier_key", "") or "")
                if not bier_key:
                    st.error("Selecteer eerst een bier.")
                    return False
                if not any(float(row.get("liters", 0.0) or 0.0) > 0 for row in _current_staffels()):
                    st.error("Vul minimaal één staffel met liters in.")
                    return False
            elif liters_basis == LITERS_BASIS_MEERDERE_BIEREN:
                if not any(
                    str(row.get("bier_key", "") or "").strip()
                    and float(row.get("liters", 0.0) or 0.0) > 0
                    for row in _current_beer_rows()
                ):
                    st.error("Vul minimaal één bierregel met liters in.")
                    return False
            else:
                if not any(float(row.get("liters", 0.0) or 0.0) > 0 for row in _current_staffels()):
                    st.error("Vul minimaal één staffel met liters in.")
                    return False
        else:
            if not any(float(row.get("aantal", 0.0) or 0.0) > 0 for row in _current_product_rows()):
                st.error("Vul minimaal één productregel met aantal in.")
                return False
    return True


def _render_step_indicator() -> None:
    current_step = int(st.session_state.get("prijsvoorstel_step", 1))
    st.markdown(
        """
        <style>
        .pp-summary-sidebar .section-title {
            font-size: 1.05rem !important;
        }
        .pp-summary-sidebar .section-text {
            font-size: 0.92rem;
        }
        .pp-summary-sidebar .stCaption {
            font-size: 0.76rem;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )

    def _handle_step_click(step_number: int) -> None:
        _sync_state_from_widgets()
        if step_number > current_step and not _validate_step_v2(current_step):
            return
        st.session_state["prijsvoorstel_step"] = step_number
        st.rerun()

    render_step_sidebar(
        [_step_titles()[step_number] for step_number in range(1, TOTAL_STEPS + 1)],
        current_step,
        key_prefix="pp_step",
        css_prefix="pp",
        on_step_click=_handle_step_click,
        accent_color="#2fae66",
        compact=True,
    )


def _render_step_1() -> None:
    render_page_header("Basisgegevens", "Leg hier de basis van het prijsvoorstel vast.")
    if not str(_form_value("offertenummer", "") or "").strip():
        _get_form_state()["offertenummer"] = get_next_prijsvoorstel_offertenummer()
    _hydrate_widget("klantnaam")
    _hydrate_widget("contactpersoon")
    _hydrate_widget("referentie")
    _hydrate_widget("datum_text")
    render_read_only_table_cell(str(_form_value("offertenummer", "") or "-"))
    st.caption("Offertenummer")
    col_1, col_2 = st.columns(2)
    with col_1:
        st.text_input("Klantnaam", key=_widget_key("klantnaam"))
    with col_2:
        st.text_input("Contactpersoon", key=_widget_key("contactpersoon"))
    col_3, col_4 = st.columns(2)
    with col_3:
        st.text_input("Referentie / voorstelnaam", key=_widget_key("referentie"))
    with col_4:
        st.text_input(
            "Datum",
            key=_widget_key("datum_text"),
            placeholder="DD-MM-YYYY",
        )


def _render_step_2_uitgangspunten() -> None:
    render_page_header(
        "Uitgangspunten",
        "Kies hier het verkoopjaar, het voorsteltype en het referentiekanaal.",
    )
    _hydrate_widget("jaar")
    _hydrate_widget("type")
    _hydrate_widget("liters_basis")
    _hydrate_widget("kanaal")
    col_1, col_2 = st.columns(2)
    with col_1:
        st.number_input("Verkoopjaar", min_value=2020, max_value=2100, step=1, key=_widget_key("jaar"))
    with col_2:
        st.selectbox(
            "Voorsteltype",
            options=[VOORSTELTYPE_LITERS, VOORSTELTYPE_PRODUCTEN],
            key=_widget_key("type"),
        )
    voorstel_type = str(st.session_state.get(_widget_key("type"), _form_value("type", VOORSTELTYPE_LITERS)) or VOORSTELTYPE_LITERS)
    if voorstel_type == VOORSTELTYPE_LITERS:
        st.selectbox(
            "Bereken liters op basis van",
            options=list(LITERS_BASIS_LABELS.keys()),
            format_func=lambda key: LITERS_BASIS_LABELS.get(key, key),
            key=_widget_key("liters_basis"),
        )
    st.selectbox(
        "Referentiekanaal",
        options=list(KANAAL_LABELS.keys()),
        format_func=lambda key: KANAAL_LABELS.get(key, key),
        key=_widget_key("kanaal"),
    )
    jaar = int(st.session_state.get(_widget_key("jaar"), _form_value("jaar", _default_year())) or _default_year())
    if _has_strategy_for_year(jaar):
        kanaal = str(st.session_state.get(_widget_key("kanaal"), _form_value("kanaal", "horeca")) or "horeca")
        default_margin = _kanaal_marge(jaar, kanaal)
        st.info(
            f"Voor verkoopjaar {jaar} zijn standaardmarges beschikbaar. Zodra je in stap 3 een bier en verpakking kiest, kijkt de app eerst naar 'Overzicht bieren' en anders naar 'Marges per jaar'. Huidige default voor {KANAAL_LABELS.get(kanaal, kanaal)}: {_format_percentage(default_margin)}."
        )
    else:
        st.warning("Voor dit verkoopjaar is nog geen verkoopstrategie beschikbaar.")


def _render_liters_table() -> None:
    _ensure_staffels()
    _hydrate_staffel_widgets()
    headers = ["Liters", "Korting %", "Prijs € / L", "Omzet €", "Kosten €", "Marge €", "Marge %", ""]
    row_widths = [0.9, 1.2, 1.0, 1.0, 1.0, 1.0, 0.9, 0.42]
    render_table_headers(headers, row_widths)
    results_by_id = {row["id"]: row for row in _liters_results()}
    for row in _current_staffels():
        row_id = row["id"]
        result = results_by_id.get(row_id, {})
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            st.number_input("Liters", min_value=0.0, step=1000.0, format="%.2f", key=_staffel_widget_key(row_id, "liters"), label_visibility="collapsed")
        with row_cols[1]:
            st.number_input("Korting", min_value=0.0, max_value=99.99, step=0.1, format="%.2f", key=_staffel_widget_key(row_id, "korting"), label_visibility="collapsed")
        with row_cols[2]:
            render_read_only_table_cell(_format_euro(result.get("prijs_per_liter")))
        with row_cols[3]:
            render_read_only_table_cell(_format_euro(result.get("omzet")))
        with row_cols[4]:
            render_read_only_table_cell(_format_euro(result.get("kosten")))
        with row_cols[5]:
            render_read_only_table_cell(_format_euro(result.get("marge_eur")))
        with row_cols[6]:
            render_read_only_table_cell(_format_percentage(result.get("marge_pct")))
        with row_cols[7]:
            if render_delete_button(key=f"pp_staffel_delete_{row_id}"):
                _remove_staffel_row(row_id)
                st.rerun()
    add_col, _ = st.columns([1.2, 4.8])
    with add_col:
        if st.button("Staffel toevoegen", key="pp_add_staffel"):
            _add_staffel_row()
            st.rerun()


def _render_multi_beer_table(year: int) -> None:
    _ensure_beer_rows()
    _hydrate_beer_widgets()
    options, labels = _bier_options(year)
    results_by_id = {row["id"]: row for row in _liters_results()}
    headers = ["Bier", "Liters", "Korting %", "Prijs € / L", "Omzet €", "Kosten €", "Marge €", "Marge %", ""]
    row_widths = [1.7, 0.9, 0.8, 1.0, 1.0, 1.0, 1.0, 0.8, 0.42]
    render_table_headers(headers, row_widths)
    for row in _current_beer_rows():
        row_id = row["id"]
        result = results_by_id.get(row_id, {})
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            st.selectbox(
                "Bier",
                options=options,
                format_func=lambda key: labels.get(key, key),
                key=_beer_widget_key(row_id, "bier"),
                label_visibility="collapsed",
            )
        with row_cols[1]:
            st.number_input("Liters", min_value=0.0, step=1000.0, format="%.2f", key=_beer_widget_key(row_id, "liters"), label_visibility="collapsed")
        with row_cols[2]:
            st.number_input("Korting", min_value=0.0, max_value=99.99, step=0.1, format="%.2f", key=_beer_widget_key(row_id, "korting"), label_visibility="collapsed")
        with row_cols[3]:
            render_read_only_table_cell(_format_euro(result.get("prijs_per_liter")))
        with row_cols[4]:
            render_read_only_table_cell(_format_euro(result.get("omzet")))
        with row_cols[5]:
            render_read_only_table_cell(_format_euro(result.get("kosten")))
        with row_cols[6]:
            render_read_only_table_cell(_format_euro(result.get("marge_eur")))
        with row_cols[7]:
            render_read_only_table_cell(_format_percentage(result.get("marge_pct")))
        with row_cols[8]:
            if render_delete_button(key=f"pp_beer_delete_{row_id}"):
                _remove_beer_row(row_id)
                st.rerun()
    add_col, _ = st.columns([1.3, 4.7])
    with add_col:
        if st.button("Biersoort toevoegen", key="pp_add_beer"):
            _add_beer_row()
            st.rerun()


def _render_products_table(product_rows: list[dict[str, Any]]) -> None:
    _ensure_product_rows()
    _hydrate_product_widgets()
    results_by_id = {row["id"]: row for row in _product_results()}
    options = [""]
    options.extend(row["product_key"] for row in product_rows)
    labels = {"": "Selecteer product"}
    labels.update({row["product_key"]: row["verpakking"] for row in product_rows})
    headers = ["Product", "Aantal", "Korting", "Kanaalprijs € / stuk", "Omzet €", "Kosten €", "Marge €", "Marge %", ""]
    row_widths = [1.8, 0.8, 0.8, 1.0, 1.0, 1.0, 1.0, 0.9, 0.42]
    render_table_headers(headers, row_widths)
    for row in _current_product_rows():
        row_id = row["id"]
        result = results_by_id.get(row_id, {})
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            st.selectbox("Product", options=options, format_func=lambda key: labels.get(key, key), key=_product_widget_key(row_id, "product"), label_visibility="collapsed")
        with row_cols[1]:
            st.number_input("Aantal", min_value=0.0, step=1.0, format="%.2f", key=_product_widget_key(row_id, "aantal"), label_visibility="collapsed")
        with row_cols[2]:
            st.number_input("Korting", min_value=0.0, max_value=99.99, step=0.1, format="%.2f", key=_product_widget_key(row_id, "korting"), label_visibility="collapsed")
        with row_cols[3]:
            render_read_only_table_cell(_format_euro(result.get("verkoopprijs")))
        with row_cols[4]:
            render_read_only_table_cell(_format_euro(result.get("omzet")))
        with row_cols[5]:
            render_read_only_table_cell(_format_euro(result.get("kosten")))
        with row_cols[6]:
            render_read_only_table_cell(_format_euro(result.get("marge_eur")))
        with row_cols[7]:
            render_read_only_table_cell(_format_percentage(result.get("marge_pct")))
        with row_cols[8]:
            if render_delete_button(key=f"pp_product_delete_{row_id}"):
                _remove_product_row(row_id)
                st.rerun()
    add_col, _ = st.columns([1.2, 4.8])
    with add_col:
        if st.button("Productregel toevoegen", key="pp_add_product"):
            _add_product_row()
            st.rerun()


def _render_summary_sidebar() -> None:
    jaar = int(_form_value("jaar", _default_year()) or _default_year())
    bier_key = str(_form_value("bier_key", "") or "")
    liters_basis = str(_form_value("liters_basis", LITERS_BASIS_EEN_BIER) or LITERS_BASIS_EEN_BIER)
    bier_record = _latest_record_for_bier(jaar, bier_key) if bier_key else None
    basisgegevens = bier_record.get("basisgegevens", {}) if isinstance(bier_record, dict) else {}
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    voorstel_type = str(_form_value("type", VOORSTELTYPE_LITERS))
    kanaal = str(_form_value("kanaal", "horeca") or "horeca")
    bier_label = str(basisgegevens.get("biernaam", "") or "-")
    bron_strategy_label = "-"
    if voorstel_type == VOORSTELTYPE_LITERS and liters_basis == LITERS_BASIS_MEERDERE_BIEREN:
        bier_label = "Meerdere bieren"
        first_row = next(
            (
                row
                for row in _current_beer_rows()
                if str(row.get("bier_key", "") or "") and str(row.get("product_key", "") or "")
            ),
            None,
        )
        if isinstance(first_row, dict):
            bron_strategy_label = _effective_strategy_source_label(
                jaar,
                bier_key=str(first_row.get("bier_key", "") or ""),
                product_key=str(first_row.get("product_key", "") or ""),
            )
    if voorstel_type == VOORSTELTYPE_LITERS and liters_basis == LITERS_BASIS_ALGEMEEN:
        bier_label = "Algemene hoogste kostprijs"
        bron_strategy_label = _effective_strategy_source_label(jaar)
    elif voorstel_type == VOORSTELTYPE_LITERS and liters_basis == LITERS_BASIS_EEN_BIER:
        first_row = next(
            (
                row
                for row in _current_staffels()
                if str(row.get("product_key", "") or "")
            ),
            None,
        )
        if isinstance(first_row, dict):
            product_key = str(first_row.get("product_key", "") or "")
            product = _product_map_for_bier(jaar, bier_key).get(product_key)
            bron_strategy_label = _effective_strategy_source_label(
                jaar,
                bier_key=bier_key,
                product_key=product_key,
                verpakking=str((product or {}).get("verpakking", "") or ""),
            )
        else:
            bron_strategy_label = _effective_strategy_source_label(jaar)
    elif voorstel_type == VOORSTELTYPE_PRODUCTEN:
        first_row = next(
            (
                row
                for row in _current_product_rows()
                if str(row.get("product_key", "") or "")
            ),
            None,
        )
        if isinstance(first_row, dict):
            product_key = str(first_row.get("product_key", "") or "")
            product = _product_map_for_bier(jaar, bier_key).get(product_key)
            bron_strategy_label = _effective_strategy_source_label(
                jaar,
                bier_key=bier_key,
                product_key=product_key,
                verpakking=str((product or {}).get("verpakking", "") or ""),
            )
        else:
            bron_strategy_label = _effective_strategy_source_label(jaar)

    st.markdown("<div class='pp-summary-sidebar'>", unsafe_allow_html=True)
    st.markdown("<div class='section-title' style='font-size:1.2rem;'>Samenvatting</div>", unsafe_allow_html=True)
    for label, value in [
        ("Klant", str(_form_value("klantnaam", "") or "-")),
        ("Type", voorstel_type),
        ("Verkoopjaar", str(jaar)),
        ("Kanaal", KANAAL_LABELS.get(kanaal, kanaal)),
        ("Bier", bier_label),
        ("Bron strategie", bron_strategy_label),
    ]:
        st.markdown(
            f"<div class='section-text' style='margin-bottom:0.45rem;'><strong>{label}:</strong> {value}</div>",
            unsafe_allow_html=True,
        )

    results = _liters_results() if voorstel_type == VOORSTELTYPE_LITERS else _product_results()
    totale_omzet = sum(float(row.get("omzet", 0.0) or 0.0) for row in results)
    totale_kosten = sum(float(row.get("kosten", 0.0) or 0.0) for row in results)
    totale_marge = totale_omzet - totale_kosten
    marge_pct = (totale_marge / totale_omzet * 100.0) if totale_omzet > 0 else 0.0

    st.write("")
    summary_cols = st.columns(2)
    with summary_cols[0]:
        render_read_only_table_cell(_format_euro(totale_omzet))
        st.caption("Totale omzet €")
    with summary_cols[1]:
        render_read_only_table_cell(_format_euro(totale_kosten))
        st.caption("Totale kosten €")
    render_read_only_table_cell(_format_euro(totale_marge))
    st.caption("Totale winstmarge €")
    render_read_only_table_cell(_format_percentage(marge_pct))
    st.caption("Gemiddelde winstmarge")
    st.markdown("</div>", unsafe_allow_html=True)


def _render_step_3() -> None:
    render_page_header(
        "Berekening",
        "Werk hier het voorstel uit. Links vul je staffels of producten in, rechts zie je direct de samenvatting.",
    )
    _hydrate_widget("bier_key")
    jaar = int(_form_value("jaar", _default_year()) or _default_year())
    voorstel_type = str(_form_value("type", VOORSTELTYPE_LITERS))
    kanaal = str(_form_value("kanaal", "horeca") or "horeca")
    liters_basis = str(_form_value("liters_basis", LITERS_BASIS_EEN_BIER) or LITERS_BASIS_EEN_BIER)
    options, labels = _bier_options(jaar)
    bier_widget_key = _widget_key("bier_key")
    if str(st.session_state.get(bier_widget_key, _form_value("bier_key", "")) or "") not in options:
        st.session_state[bier_widget_key] = ""
        _get_form_state()["bier_key"] = ""

    left_col, right_col = st.columns([2.35, 0.75], gap="large")
    with left_col:
        if voorstel_type == VOORSTELTYPE_LITERS:
            if liters_basis == LITERS_BASIS_EEN_BIER:
                st.selectbox("Bier", options=options, format_func=lambda key: labels.get(key, key), key=bier_widget_key)
                bier_key = str(st.session_state.get(bier_widget_key, "") or "")
                if not bier_key:
                    st.info("Selecteer eerst een bier om de berekening op te bouwen.")
                else:
                    hoogste_kostprijs, bronjaar = _highest_cost_for_bier(jaar, bier_key)
                    referentieprijs = _calculate_price_from_margin(hoogste_kostprijs, _kanaal_marge(jaar, kanaal))
                    info_cols = st.columns(3)
                    with info_cols[0]:
                        render_read_only_table_cell(_format_euro(hoogste_kostprijs))
                        st.caption(f"Hoogste kostprijs per liter ({bronjaar or '-'})")
                    with info_cols[1]:
                        render_read_only_table_cell(_format_euro(referentieprijs))
                        st.caption(f"Referentieprijs {KANAAL_LABELS.get(kanaal, kanaal)} per liter")
                    with info_cols[2]:
                        render_read_only_table_cell(_format_percentage(_kanaal_marge(jaar, kanaal)))
                        st.caption("Kanaalwinstmarge verkoopstrategie")
                    fust_rows = _fust_cost_insights(jaar, bier_key)
                    if fust_rows:
                        fust_labels = ", ".join(
                            f"{str(row.get('verpakking', '-') or '-')}: € { _format_euro(row.get('kostprijs')) }"
                            for row in fust_rows[:3]
                        )
                        st.info(f"Fustinzicht: {fust_labels}")
                    st.write("")
                    _render_liters_table()
            elif liters_basis == LITERS_BASIS_MEERDERE_BIEREN:
                st.info("Voeg hieronder één of meer bieren toe. Per bier reken ik met de hoogste bekende kostprijs en dezelfde referentiestrategie.")
                _render_multi_beer_table(jaar)
            else:
                hoogste_kostprijs, bronjaar, bronbier = _highest_cost_overall(jaar)
                referentieprijs = _calculate_price_from_margin(hoogste_kostprijs, _kanaal_marge(jaar, kanaal))
                info_cols = st.columns(3)
                with info_cols[0]:
                    render_read_only_table_cell(_format_euro(hoogste_kostprijs))
                    st.caption(f"Algemene hoogste kostprijs per liter ({bronjaar or '-'})")
                with info_cols[1]:
                    render_read_only_table_cell(str(bronbier or "-"))
                    st.caption("Bronbier hoogste kostprijs")
                with info_cols[2]:
                    render_read_only_table_cell(_format_euro(referentieprijs))
                    st.caption(f"Referentieprijs {KANAAL_LABELS.get(kanaal, kanaal)} per liter")
                st.write("")
                _render_liters_table()
        else:
            st.selectbox("Bier", options=options, format_func=lambda key: labels.get(key, key), key=bier_widget_key)
            bier_key = str(st.session_state.get(bier_widget_key, "") or "")
            if not bier_key:
                st.info("Selecteer eerst een bier om de berekening op te bouwen.")
            else:
                hoogste_kostprijs, bronjaar = _highest_cost_for_bier(jaar, bier_key)
                product_rows = _build_product_rows_for_bier(jaar, bier_key)
                if not product_rows:
                    st.warning("Voor dit bier zijn nog geen producten beschikbaar vanuit stap 4 van 'Nieuwe berekening'.")
                else:
                    st.info(
                        f"De basisprijzen volgen eerst 'Overzicht bieren' en anders de default uit 'Marges per jaar' voor kanaal {KANAAL_LABELS.get(kanaal, kanaal)}."
                    )
                    _render_products_table(product_rows)
    with right_col:
        _render_summary_sidebar()


def _render_step_4() -> None:
    render_page_header(
        "Samenvatting",
        "Controleer hieronder de commerciële samenvatting voor de groothandel en vergelijk die met jullie adviesprijzen per kanaal.",
    )
    voorstel_type = str(_form_value("type", VOORSTELTYPE_LITERS))
    jaar = int(_form_value("jaar", _default_year()) or _default_year())
    kanaal = str(_form_value("kanaal", "horeca") or "horeca")
    bier_key = str(_form_value("bier_key", "") or "")
    bier_record = _latest_record_for_bier(jaar, bier_key) if bier_key else None
    basisgegevens = bier_record.get("basisgegevens", {}) if isinstance(bier_record, dict) else {}
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    st.markdown(
        f"<div class='section-text'><strong>Klant:</strong> {str(_form_value('klantnaam', '') or '-')} | <strong>Voorsteltype:</strong> {voorstel_type} | <strong>Verkoopjaar:</strong> {jaar} | <strong>Kanaal:</strong> {KANAAL_LABELS.get(kanaal, kanaal)}</div>",
        unsafe_allow_html=True,
    )

    if voorstel_type == VOORSTELTYPE_LITERS:
        rows = _liters_results()
        hoogste_kostprijs, bronjaar = _highest_cost_for_bier(jaar, bier_key)
        strategy = _selected_strategy(jaar)
        kanaalmarges = strategy.get("kanaalmarges", {}) if isinstance(strategy, dict) else {}
        if not isinstance(kanaalmarges, dict):
            kanaalmarges = {}
        st.markdown("<div class='section-title' style='font-size:1.2rem;'>Groothandelsoverzicht</div>", unsafe_allow_html=True)
        headers = [
            "Liters",
            "Inkoopprijs € / L",
            "Adviesprijs zakelijk € / L",
            "Adviesprijs retail € / L",
            "Adviesprijs horeca € / L",
            "Adviesprijs slijterij € / L",
            "Onze winstmarge",
        ]
        row_widths = [0.8, 1.15, 1.15, 1.15, 1.15, 1.15, 1.0]
        render_table_headers(headers, row_widths)
        for row in rows:
            advies_zakelijk = _calculate_price_from_margin(hoogste_kostprijs, kanaalmarges.get("zakelijk"))
            advies_retail = _calculate_price_from_margin(hoogste_kostprijs, kanaalmarges.get("retail"))
            advies_horeca = _calculate_price_from_margin(hoogste_kostprijs, kanaalmarges.get("horeca"))
            advies_slijterij = _calculate_price_from_margin(hoogste_kostprijs, kanaalmarges.get("slijterij"))
            row_cols = st.columns(row_widths)
            with row_cols[0]:
                render_read_only_table_cell(f"{float(row.get('liters', 0.0) or 0.0):.2f}")
            with row_cols[1]:
                render_read_only_table_cell(_format_euro(row.get("prijs_per_liter")))
            with row_cols[2]:
                render_read_only_table_cell(_format_euro(advies_zakelijk))
            with row_cols[3]:
                render_read_only_table_cell(_format_euro(advies_retail))
            with row_cols[4]:
                render_read_only_table_cell(_format_euro(advies_horeca))
            with row_cols[5]:
                render_read_only_table_cell(_format_euro(advies_slijterij))
            with row_cols[6]:
                render_read_only_table_cell(_format_percentage(row.get("marge_pct")))
        st.write("")
        info_cols = st.columns(3)
        with info_cols[0]:
            render_read_only_table_cell(_format_euro(hoogste_kostprijs))
            st.caption(f"Hoogste bekende kostprijs per liter ({bronjaar or '-'})")
        with info_cols[1]:
            render_read_only_table_cell(str(basisgegevens.get("biernaam", "") or "-"))
            st.caption("Bier")
        with info_cols[2]:
            render_read_only_table_cell(str(int(strategy.get("jaar", 0) or 0) or "-") if strategy else "-")
            st.caption("Bronjaar verkoopstrategie")
    else:
        rows = _product_results()
        products = {row["product_key"]: row for row in _build_product_rows_for_bier(jaar, bier_key)}
        st.markdown("<div class='section-title' style='font-size:1.2rem;'>Groothandelsoverzicht</div>", unsafe_allow_html=True)
        headers = [
            "Product",
            "Aantal",
            "Inkoopprijs € / stuk",
            "Adviesprijs zakelijk €",
            "Adviesprijs retail €",
            "Adviesprijs horeca €",
            "Adviesprijs slijterij €",
            "Onze winstmarge",
        ]
        row_widths = [1.6, 0.7, 1.05, 1.0, 1.0, 1.0, 1.0, 0.9]
        render_table_headers(headers, row_widths)
        for row in rows:
            product = next(
                (
                    product_row
                    for product_row in _current_product_rows()
                    if str(product_row.get("id", "") or "") == str(row.get("id", "") or "")
                ),
                {},
            )
            product_pricing = products.get(str(product.get("product_key", "") or ""), {})
            row_cols = st.columns(row_widths)
            with row_cols[0]:
                render_read_only_table_cell(str(row.get("verpakking", "-") or "-"))
            with row_cols[1]:
                render_read_only_table_cell(f"{float(row.get('aantal', 0.0) or 0.0):.2f}")
            with row_cols[2]:
                render_read_only_table_cell(_format_euro(row.get("verkoopprijs")))
            with row_cols[3]:
                render_read_only_table_cell(_format_euro(product_pricing.get("zakelijk")))
            with row_cols[4]:
                render_read_only_table_cell(_format_euro(product_pricing.get("retail")))
            with row_cols[5]:
                render_read_only_table_cell(_format_euro(product_pricing.get("horeca")))
            with row_cols[6]:
                render_read_only_table_cell(_format_euro(product_pricing.get("slijterij")))
            with row_cols[7]:
                render_read_only_table_cell(_format_percentage(row.get("marge_pct")))


def _render_step_5() -> None:
    render_page_header(
        "Afronden",
        "Voeg hier nog een interne notitie toe. PDF-export en verdere afronding kunnen we hierna verder inkleden.",
    )
    _hydrate_widget("opmerking")
    st.write("")
    st.text_area(
        "Interne notitie",
        key=_widget_key("opmerking"),
        placeholder="Bijvoorbeeld: voorstel voor eerste groothandelsgesprek, prijzen nog intern afstemmen.",
        height=120,
    )
    st.info("PDF-export en verdere afronding kunnen we hierna als vervolgstap toevoegen.")


def _render_step_4_v2() -> None:
    render_page_header(
        "Samenvatting",
        "Controleer hieronder de commerciële samenvatting voor de groothandel en vergelijk die met jullie adviesprijzen per kanaal.",
    )
    voorstel_type = str(_form_value("type", VOORSTELTYPE_LITERS))
    jaar = int(_form_value("jaar", _default_year()) or _default_year())
    kanaal = str(_form_value("kanaal", "horeca") or "horeca")
    bier_key = str(_form_value("bier_key", "") or "")
    liters_basis = str(_form_value("liters_basis", LITERS_BASIS_EEN_BIER) or LITERS_BASIS_EEN_BIER)
    bier_record = _latest_record_for_bier(jaar, bier_key) if bier_key else None
    basisgegevens = bier_record.get("basisgegevens", {}) if isinstance(bier_record, dict) else {}
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    st.markdown(
        f"<div class='section-text'><strong>Klant:</strong> {str(_form_value('klantnaam', '') or '-')} | <strong>Voorsteltype:</strong> {voorstel_type} | <strong>Verkoopjaar:</strong> {jaar} | <strong>Kanaal:</strong> {KANAAL_LABELS.get(kanaal, kanaal)}</div>",
        unsafe_allow_html=True,
    )

    if voorstel_type == VOORSTELTYPE_LITERS:
        rows = _liters_results()
        st.markdown("<div class='section-title' style='font-size:1.2rem;'>Groothandelsoverzicht</div>", unsafe_allow_html=True)
        if liters_basis == LITERS_BASIS_MEERDERE_BIEREN:
            headers = ["Bier", "Liters", "Inkoopprijs € / L", "Adviesprijs horeca € / L", "Onze winstmarge"]
            row_widths = [1.5, 0.8, 1.1, 1.2, 1.0]
        else:
            headers = [
                "Liters",
                "Inkoopprijs € / L",
                "Adviesprijs zakelijk € / L",
                "Adviesprijs retail € / L",
                "Adviesprijs horeca € / L",
                "Adviesprijs slijterij € / L",
                "Onze winstmarge",
            ]
            row_widths = [0.8, 1.15, 1.15, 1.15, 1.15, 1.15, 1.0]
        render_table_headers(headers, row_widths)
        for row in rows:
            liters = float(row.get("liters", 0.0) or 0.0)
            kostprijs_per_liter = (float(row.get("kosten", 0.0) or 0.0) / liters) if liters > 0 else 0.0
            row_bier_key = str(row.get("bier_key", "") or bier_key or "")
            row_product_map = _product_map_for_bier(jaar, row_bier_key) if row_bier_key else {}
            product = row_product_map.get(str(row.get("product_key", "") or ""))
            advies_zakelijk = _product_channel_price_per_liter(product, "zakelijk")
            advies_retail = _product_channel_price_per_liter(product, "retail")
            advies_horeca = _product_channel_price_per_liter(product, "horeca")
            advies_slijterij = _product_channel_price_per_liter(product, "slijterij")
            if advies_zakelijk is None:
                advies_zakelijk = _calculate_price_from_margin(kostprijs_per_liter, kanaalmarges.get("zakelijk"))
            if advies_retail is None:
                advies_retail = _calculate_price_from_margin(kostprijs_per_liter, kanaalmarges.get("retail"))
            if advies_horeca is None:
                advies_horeca = _calculate_price_from_margin(kostprijs_per_liter, kanaalmarges.get("horeca"))
            if advies_slijterij is None:
                advies_slijterij = _calculate_price_from_margin(kostprijs_per_liter, kanaalmarges.get("slijterij"))
            row_cols = st.columns(row_widths)
            if liters_basis == LITERS_BASIS_MEERDERE_BIEREN:
                with row_cols[0]:
                    render_read_only_table_cell(str(row.get("biernaam", "-") or "-"))
                with row_cols[1]:
                    render_read_only_table_cell(f"{liters:.2f}")
                with row_cols[2]:
                    render_read_only_table_cell(_format_euro(row.get("prijs_per_liter")))
                with row_cols[3]:
                    render_read_only_table_cell(_format_euro(advies_horeca))
                with row_cols[4]:
                    render_read_only_table_cell(_format_percentage(row.get("marge_pct")))
            else:
                with row_cols[0]:
                    render_read_only_table_cell(f"{liters:.2f}")
                with row_cols[1]:
                    render_read_only_table_cell(_format_euro(row.get("prijs_per_liter")))
                with row_cols[2]:
                    render_read_only_table_cell(_format_euro(advies_zakelijk))
                with row_cols[3]:
                    render_read_only_table_cell(_format_euro(advies_retail))
                with row_cols[4]:
                    render_read_only_table_cell(_format_euro(advies_horeca))
                with row_cols[5]:
                    render_read_only_table_cell(_format_euro(advies_slijterij))
                with row_cols[6]:
                    render_read_only_table_cell(_format_percentage(row.get("marge_pct")))
        st.write("")
        if liters_basis == LITERS_BASIS_ALGEMEEN:
            hoogste_kostprijs, bronjaar, bronbier = _highest_cost_overall(jaar)
        else:
            hoogste_kostprijs, bronjaar = _highest_cost_for_bier(jaar, bier_key)
            bronbier = str(basisgegevens.get("biernaam", "") or "-")
        info_cols = st.columns(3)
        with info_cols[0]:
            render_read_only_table_cell(_format_euro(hoogste_kostprijs))
            st.caption(f"Hoogste bekende kostprijs per liter ({bronjaar or '-'})")
        with info_cols[1]:
            render_read_only_table_cell(str(bronbier or "-"))
            st.caption("Bronbier")
        with info_cols[2]:
            render_read_only_table_cell(str(int(strategy.get("jaar", 0) or 0) or "-") if strategy else "-")
            st.caption("Bronjaar verkoopstrategie")
        return

    rows = _product_results()
    products = {row["product_key"]: row for row in _build_product_rows_for_bier(jaar, bier_key)}
    st.markdown("<div class='section-title' style='font-size:1.2rem;'>Groothandelsoverzicht</div>", unsafe_allow_html=True)
    headers = [
        "Product",
        "Aantal",
        "Inkoopprijs groothandel € / stuk",
        "Adviesprijs zakelijk €",
        "Adviesprijs retail €",
        "Adviesprijs horeca €",
        "Adviesprijs slijterij €",
        "Onze winstmarge",
    ]
    row_widths = [1.6, 0.7, 1.05, 1.0, 1.0, 1.0, 1.0, 0.9]
    render_table_headers(headers, row_widths)
    for row in rows:
        product = next(
            (
                product_row
                for product_row in _current_product_rows()
                if str(product_row.get("id", "") or "") == str(row.get("id", "") or "")
            ),
            {},
        )
        product_pricing = products.get(str(product.get("product_key", "") or ""), {})
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            render_read_only_table_cell(str(row.get("verpakking", "-") or "-"))
        with row_cols[1]:
            render_read_only_table_cell(f"{float(row.get('aantal', 0.0) or 0.0):.2f}")
        with row_cols[2]:
            render_read_only_table_cell(_format_euro(row.get("kostprijs")))
        with row_cols[3]:
            render_read_only_table_cell(_format_euro(product_pricing.get("zakelijk")))
        with row_cols[4]:
            render_read_only_table_cell(_format_euro(product_pricing.get("retail")))
        with row_cols[5]:
            render_read_only_table_cell(_format_euro(product_pricing.get("horeca")))
        with row_cols[6]:
            render_read_only_table_cell(_format_euro(product_pricing.get("slijterij")))
        with row_cols[7]:
            render_read_only_table_cell(_format_percentage(row.get("marge_pct")))


def _validate_step_v2(step: int) -> bool:
    if step == 1:
        klantnaam = str(_form_value("klantnaam", "") or "").strip()
        if not klantnaam:
            st.error("Vul minimaal een klantnaam in.")
            return False
    if step == 2:
        jaar = int(_form_value("jaar", 0) or 0)
        if jaar <= 0:
            st.error("Kies een geldig verkoopjaar.")
            return False
        if not _has_strategy_for_year(jaar):
            st.error("Er is nog geen verkoopstrategie beschikbaar voor dit jaar of een eerder bronjaar.")
            return False
    if step == 3:
        voorstel_type = str(_form_value("type", VOORSTELTYPE_LITERS))
        if voorstel_type == VOORSTELTYPE_LITERS:
            liters_basis = str(_form_value("liters_basis", LITERS_BASIS_EEN_BIER) or LITERS_BASIS_EEN_BIER)
            if liters_basis == LITERS_BASIS_EEN_BIER:
                bier_key = str(_form_value("bier_key", "") or "")
                if not bier_key:
                    st.error("Selecteer eerst een bier.")
                    return False
                if not any(
                    str(row.get("product_key", "") or "").strip()
                    and float(row.get("liters", 0.0) or 0.0) > 0
                    for row in _current_staffels()
                ):
                    st.error("Kies minimaal één verpakking en vul liters in.")
                    return False
            elif liters_basis == LITERS_BASIS_MEERDERE_BIEREN:
                if not any(
                    str(row.get("bier_key", "") or "").strip()
                    and str(row.get("product_key", "") or "").strip()
                    and float(row.get("liters", 0.0) or 0.0) > 0
                    for row in _current_beer_rows()
                ):
                    st.error("Vul minimaal één bierregel met verpakking en liters in.")
                    return False
            else:
                if not any(float(row.get("liters", 0.0) or 0.0) > 0 for row in _current_staffels()):
                    st.error("Vul minimaal één staffel met liters in.")
                    return False
        else:
            if not any(float(row.get("aantal", 0.0) or 0.0) > 0 for row in _current_product_rows()):
                st.error("Vul minimaal één productregel met aantal in.")
                return False
    return True


def _render_liters_table(year: int, bier_key: str) -> None:
    _ensure_staffels()
    _hydrate_staffel_widgets()
    selected_rows = _current_staffels()
    valid_product_keys = set(_product_map_for_bier(year, bier_key).keys())
    results_by_id = {row["id"]: row for row in _liters_results()}
    selected_keys = {
        str(row.get("product_key", "") or "")
        for row in selected_rows
        if str(row.get("product_key", "") or "")
    }
    headers = ["Verpakking", "Liters", "Korting %", "Prijs € / L", "Omzet €", "Kosten €", "Marge €", "Marge %", ""]
    row_widths = [2.2, 0.9, 0.9, 1.0, 1.0, 1.0, 1.0, 0.9, 0.42]
    render_table_headers(headers, row_widths)
    for row in selected_rows:
        row_id = str(row.get("id", "") or "")
        current_product_key = str(row.get("product_key", "") or "")
        if current_product_key and current_product_key not in valid_product_keys:
            st.session_state[_staffel_widget_key(row_id, "product")] = ""
            current_product_key = ""
        options, labels = _product_options_for_bier(
            year,
            bier_key,
            current_key=current_product_key,
            excluded_keys=selected_keys - ({current_product_key} if current_product_key else set()),
        )
        result = results_by_id.get(row_id, {})
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            st.selectbox(
                "Verpakking",
                options=options,
                format_func=lambda key: labels.get(key, key),
                key=_staffel_widget_key(row_id, "product"),
                label_visibility="collapsed",
            )
        with row_cols[1]:
            st.number_input("Liters", min_value=0.0, step=1000.0, format="%.2f", key=_staffel_widget_key(row_id, "liters"), label_visibility="collapsed")
        with row_cols[2]:
            st.number_input("Korting", min_value=0.0, max_value=99.99, step=0.1, format="%.2f", key=_staffel_widget_key(row_id, "korting"), label_visibility="collapsed")
        with row_cols[3]:
            render_read_only_table_cell(_format_euro(result.get("prijs_per_liter")))
        with row_cols[4]:
            render_read_only_table_cell(_format_euro(result.get("omzet")))
        with row_cols[5]:
            render_read_only_table_cell(_format_euro(result.get("kosten")))
        with row_cols[6]:
            render_read_only_table_cell(_format_euro(result.get("marge_eur")))
        with row_cols[7]:
            render_read_only_table_cell(_format_percentage(result.get("marge_pct")))
        with row_cols[8]:
            if render_delete_button(key=f"pp_staffel_delete_{row_id}"):
                _remove_staffel_row(row_id)
                st.rerun()
    add_col, _ = st.columns([1.6, 4.4])
    with add_col:
        if st.button("Verpakking toevoegen", key="pp_add_staffel"):
            _add_staffel_row()
            st.rerun()


def _render_multi_beer_table(year: int) -> None:
    _ensure_beer_rows()
    _hydrate_beer_widgets()
    bier_options, bier_labels = _bier_options(year)
    rows = _current_beer_rows()
    results_by_id = {row["id"]: row for row in _liters_results()}
    headers = ["Bier", "Verpakking", "Liters", "Korting %", "Prijs € / L", "Omzet €", "Kosten €", "Marge €", "Marge %", ""]
    row_widths = [1.65, 2.05, 0.85, 0.85, 1.0, 1.0, 1.0, 1.0, 0.85, 0.42]
    render_table_headers(headers, row_widths)
    for row in rows:
        row_id = str(row.get("id", "") or "")
        bier_key = str(row.get("bier_key", "") or "")
        current_product_key = str(row.get("product_key", "") or "")
        valid_product_keys = set(_product_map_for_bier(year, bier_key).keys()) if bier_key else set()
        if current_product_key and current_product_key not in valid_product_keys:
            st.session_state[_beer_widget_key(row_id, "product")] = ""
            current_product_key = ""
        same_bier_keys = {
            str(other.get("product_key", "") or "")
            for other in rows
            if str(other.get("id", "") or "") != row_id
            and str(other.get("bier_key", "") or "") == bier_key
            and str(other.get("product_key", "") or "")
        }
        product_options, product_labels = _product_options_for_bier(
            year,
            bier_key,
            current_key=current_product_key,
            excluded_keys=same_bier_keys,
        ) if bier_key else ([""], {"": "Selecteer eerst een bier"})
        result = results_by_id.get(row_id, {})
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            st.selectbox(
                "Bier",
                options=bier_options,
                format_func=lambda key: bier_labels.get(key, key),
                key=_beer_widget_key(row_id, "bier"),
                label_visibility="collapsed",
            )
        with row_cols[1]:
            st.selectbox(
                "Verpakking",
                options=product_options,
                format_func=lambda key: product_labels.get(key, key),
                key=_beer_widget_key(row_id, "product"),
                label_visibility="collapsed",
            )
        with row_cols[2]:
            st.number_input("Liters", min_value=0.0, step=1000.0, format="%.2f", key=_beer_widget_key(row_id, "liters"), label_visibility="collapsed")
        with row_cols[3]:
            st.number_input("Korting", min_value=0.0, max_value=99.99, step=0.1, format="%.2f", key=_beer_widget_key(row_id, "korting"), label_visibility="collapsed")
        with row_cols[4]:
            render_read_only_table_cell(_format_euro(result.get("prijs_per_liter")))
        with row_cols[5]:
            render_read_only_table_cell(_format_euro(result.get("omzet")))
        with row_cols[6]:
            render_read_only_table_cell(_format_euro(result.get("kosten")))
        with row_cols[7]:
            render_read_only_table_cell(_format_euro(result.get("marge_eur")))
        with row_cols[8]:
            render_read_only_table_cell(_format_percentage(result.get("marge_pct")))
        with row_cols[9]:
            if render_delete_button(key=f"pp_beer_delete_{row_id}"):
                _remove_beer_row(row_id)
                st.rerun()
    add_col, _ = st.columns([1.5, 4.5])
    with add_col:
        if st.button("Biersoort toevoegen", key="pp_add_beer"):
            _add_beer_row()
            st.rerun()


def _render_step_3() -> None:
    render_page_header(
        "Berekening",
        "Werk hier het voorstel uit. Links vul je staffels of producten in, rechts zie je direct de samenvatting.",
    )
    _hydrate_widget("bier_key")
    jaar = int(_form_value("jaar", _default_year()) or _default_year())
    voorstel_type = str(_form_value("type", VOORSTELTYPE_LITERS))
    kanaal = str(_form_value("kanaal", "horeca") or "horeca")
    liters_basis = str(_form_value("liters_basis", LITERS_BASIS_EEN_BIER) or LITERS_BASIS_EEN_BIER)
    options, labels = _bier_options(jaar)
    bier_widget_key = _widget_key("bier_key")
    if str(st.session_state.get(bier_widget_key, _form_value("bier_key", "")) or "") not in options:
        st.session_state[bier_widget_key] = ""
        _get_form_state()["bier_key"] = ""

    left_col, right_col = st.columns([3.15, 0.55], gap="large")
    with left_col:
        if voorstel_type == VOORSTELTYPE_LITERS:
            if liters_basis == LITERS_BASIS_EEN_BIER:
                st.selectbox("Bier", options=options, format_func=lambda key: labels.get(key, key), key=bier_widget_key)
                bier_key = str(st.session_state.get(bier_widget_key, "") or "")
                if not bier_key:
                    st.info("Selecteer eerst een bier om de berekening op te bouwen.")
                else:
                    hoogste_product_kostprijs, duurste_verpakking = _highest_product_cost_for_bier(jaar, bier_key)
                    product_map = _product_map_for_bier(jaar, bier_key)
                    selected_product = next(
                        (
                            product_map.get(str(row.get("product_key", "") or ""))
                            for row in _current_staffels()
                            if str(row.get("product_key", "") or "")
                        ),
                        None,
                    )
                    selected_reference_price = _product_channel_price_per_liter(selected_product, kanaal)
                    selected_margin_pct = _product_channel_margin_pct(selected_product, kanaal)
                    info_cols = st.columns([1.2, 1.4, 1.0])
                    with info_cols[0]:
                        render_read_only_table_cell(_format_euro(hoogste_product_kostprijs))
                        st.caption("Hoogste productkostprijs € / L")
                    with info_cols[1]:
                        render_read_only_table_cell(
                            _format_euro(selected_reference_price)
                            if selected_reference_price is not None
                            else str(duurste_verpakking or "-")
                        )
                        st.caption(
                            f"Referentieprijs {KANAAL_LABELS.get(kanaal, kanaal)} € / L"
                            if selected_reference_price is not None
                            else "Duurste verpakking als referentie"
                        )
                    with info_cols[2]:
                        render_read_only_table_cell(_format_percentage(selected_margin_pct))
                        st.caption(
                            "Kanaalwinstmarge gekozen verpakking"
                            if selected_margin_pct is not None
                            else "Kanaalwinstmarge"
                        )
                    st.info("Kies hieronder per regel de verpakking. De prijs per liter, kostprijs en marge volgen dan die gekozen verpakking.")
                    st.write("")
                    _render_liters_table(jaar, bier_key)
            elif liters_basis == LITERS_BASIS_MEERDERE_BIEREN:
                st.info("Voeg hieronder één of meer bierregels toe. Per regel kies je eerst het bier en daarna de verpakking.")
                _render_multi_beer_table(jaar)
            else:
                hoogste_kostprijs, bronjaar, bronbier = _highest_cost_overall(jaar)
                referentieprijs = _calculate_price_from_margin(hoogste_kostprijs, _kanaal_marge(jaar, kanaal))
                info_cols = st.columns(3)
                with info_cols[0]:
                    render_read_only_table_cell(_format_euro(hoogste_kostprijs))
                    st.caption(f"Algemene hoogste kostprijs per liter ({bronjaar or '-'})")
                with info_cols[1]:
                    render_read_only_table_cell(str(bronbier or "-"))
                    st.caption("Bronbier hoogste kostprijs")
                with info_cols[2]:
                    render_read_only_table_cell(_format_euro(referentieprijs))
                    st.caption(f"Referentieprijs {KANAAL_LABELS.get(kanaal, kanaal)} per liter")
                st.write("")
                _render_liters_table_legacy()
        else:
            st.selectbox("Bier", options=options, format_func=lambda key: labels.get(key, key), key=bier_widget_key)
            bier_key = str(st.session_state.get(bier_widget_key, "") or "")
            if not bier_key:
                st.info("Selecteer eerst een bier om de berekening op te bouwen.")
            else:
                product_rows = _build_product_rows_for_bier(jaar, bier_key)
                if not product_rows:
                    st.warning("Voor dit bier zijn nog geen producten beschikbaar vanuit stap 4 van 'Nieuwe berekening'.")
                else:
                    st.info(f"De basisprijzen komen uit de verkoopstrategie van {jaar} voor kanaal {KANAAL_LABELS.get(kanaal, kanaal)}.")
                    _render_products_table(product_rows)
    with right_col:
        _render_summary_sidebar()


def _render_liters_table_legacy() -> None:
    _ensure_staffels()
    _hydrate_staffel_widgets()
    headers = ["Liters", "Korting %", "Prijs € / L", "Omzet €", "Kosten €", "Marge €", "Marge %", ""]
    row_widths = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.42]
    render_table_headers(headers, row_widths)
    results_by_id = {row["id"]: row for row in _liters_results()}
    for row in _current_staffels():
        row_id = row["id"]
        result = results_by_id.get(row_id, {})
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            st.number_input("Liters", min_value=0.0, step=1000.0, format="%.2f", key=_staffel_widget_key(row_id, "liters"), label_visibility="collapsed")
        with row_cols[1]:
            st.number_input("Korting", min_value=0.0, max_value=99.99, step=0.1, format="%.2f", key=_staffel_widget_key(row_id, "korting"), label_visibility="collapsed")
        with row_cols[2]:
            render_read_only_table_cell(_format_euro(result.get("prijs_per_liter")))
        with row_cols[3]:
            render_read_only_table_cell(_format_euro(result.get("omzet")))
        with row_cols[4]:
            render_read_only_table_cell(_format_euro(result.get("kosten")))
        with row_cols[5]:
            render_read_only_table_cell(_format_euro(result.get("marge_eur")))
        with row_cols[6]:
            render_read_only_table_cell(_format_percentage(result.get("marge_pct")))
        with row_cols[7]:
            if render_delete_button(key=f"pp_staffel_delete_{row_id}"):
                _remove_staffel_row(row_id)
                st.rerun()
    add_col, _ = st.columns([1.4, 4.6])
    with add_col:
        if st.button("Staffel toevoegen", key="pp_add_staffel_legacy"):
            _add_staffel_row()
            st.rerun()


def _render_step_4_v2() -> None:
    render_page_header(
        "Samenvatting",
        "Controleer hieronder de commerciële samenvatting voor de groothandel en vergelijk die met jullie adviesprijzen per kanaal.",
    )
    voorstel_type = str(_form_value("type", VOORSTELTYPE_LITERS))
    jaar = int(_form_value("jaar", _default_year()) or _default_year())
    kanaal = str(_form_value("kanaal", "horeca") or "horeca")
    bier_key = str(_form_value("bier_key", "") or "")
    liters_basis = str(_form_value("liters_basis", LITERS_BASIS_EEN_BIER) or LITERS_BASIS_EEN_BIER)
    bier_record = _latest_record_for_bier(jaar, bier_key) if bier_key else None
    basisgegevens = bier_record.get("basisgegevens", {}) if isinstance(bier_record, dict) else {}
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    st.markdown(
        f"<div class='section-text'><strong>Klant:</strong> {str(_form_value('klantnaam', '') or '-')} | <strong>Voorsteltype:</strong> {voorstel_type} | <strong>Verkoopjaar:</strong> {jaar} | <strong>Kanaal:</strong> {KANAAL_LABELS.get(kanaal, kanaal)}</div>",
        unsafe_allow_html=True,
    )

    if voorstel_type == VOORSTELTYPE_LITERS:
        rows = _liters_results()
        strategy = _selected_strategy(jaar)
        kanaalmarges = strategy.get("kanaalmarges", {}) if isinstance(strategy, dict) else {}
        if not isinstance(kanaalmarges, dict):
            kanaalmarges = {}
        st.markdown("<div class='section-title' style='font-size:1.2rem;'>Groothandelsoverzicht</div>", unsafe_allow_html=True)
        if liters_basis == LITERS_BASIS_MEERDERE_BIEREN:
            headers = ["Bier", "Verpakking", "Liters", "Inkoopprijs € / L", "Adviesprijs horeca € / L", "Onze winstmarge"]
            row_widths = [1.35, 1.6, 0.8, 1.1, 1.2, 1.0]
        elif liters_basis == LITERS_BASIS_EEN_BIER:
            headers = ["Verpakking", "Liters", "Inkoopprijs € / L", "Adviesprijs zakelijk € / L", "Adviesprijs retail € / L", "Adviesprijs horeca € / L", "Adviesprijs slijterij € / L", "Onze winstmarge"]
            row_widths = [1.6, 0.8, 1.1, 1.15, 1.15, 1.15, 1.15, 1.0]
        else:
            headers = ["Liters", "Inkoopprijs € / L", "Adviesprijs zakelijk € / L", "Adviesprijs retail € / L", "Adviesprijs horeca € / L", "Adviesprijs slijterij € / L", "Onze winstmarge"]
            row_widths = [0.8, 1.15, 1.15, 1.15, 1.15, 1.15, 1.0]
        render_table_headers(headers, row_widths)
        for row in rows:
            liters = float(row.get("liters", 0.0) or 0.0)
            kostprijs_per_liter = (float(row.get("kosten", 0.0) or 0.0) / liters) if liters > 0 else 0.0
            adviesprijzen = _effective_channel_prices_for_cost(
                jaar,
                kostprijs_per_liter,
                bier_key=str(row.get("bier_key", "") or bier_key),
                product_key=str(row.get("product_key", "") or ""),
                verpakking=str(row.get("verpakking", "") or ""),
            )
            row_cols = st.columns(row_widths)
            if liters_basis == LITERS_BASIS_MEERDERE_BIEREN:
                with row_cols[0]:
                    render_read_only_table_cell(str(row.get("biernaam", "-") or "-"))
                with row_cols[1]:
                    render_read_only_table_cell(str(row.get("verpakking", "-") or "-"))
                with row_cols[2]:
                    render_read_only_table_cell(f"{liters:.2f}")
                with row_cols[3]:
                    render_read_only_table_cell(_format_euro(row.get("prijs_per_liter")))
                with row_cols[4]:
                    render_read_only_table_cell(_format_euro(adviesprijzen.get("horeca")))
                with row_cols[5]:
                    render_read_only_table_cell(_format_percentage(row.get("marge_pct")))
            elif liters_basis == LITERS_BASIS_EEN_BIER:
                with row_cols[0]:
                    render_read_only_table_cell(str(row.get("verpakking", "-") or "-"))
                with row_cols[1]:
                    render_read_only_table_cell(f"{liters:.2f}")
                with row_cols[2]:
                    render_read_only_table_cell(_format_euro(row.get("prijs_per_liter")))
                with row_cols[3]:
                    render_read_only_table_cell(_format_euro(adviesprijzen.get("zakelijk")))
                with row_cols[4]:
                    render_read_only_table_cell(_format_euro(adviesprijzen.get("retail")))
                with row_cols[5]:
                    render_read_only_table_cell(_format_euro(adviesprijzen.get("horeca")))
                with row_cols[6]:
                    render_read_only_table_cell(_format_euro(adviesprijzen.get("slijterij")))
                with row_cols[7]:
                    render_read_only_table_cell(_format_percentage(row.get("marge_pct")))
            else:
                with row_cols[0]:
                    render_read_only_table_cell(f"{liters:.2f}")
                with row_cols[1]:
                    render_read_only_table_cell(_format_euro(row.get("prijs_per_liter")))
                with row_cols[2]:
                    render_read_only_table_cell(_format_euro(adviesprijzen.get("zakelijk")))
                with row_cols[3]:
                    render_read_only_table_cell(_format_euro(adviesprijzen.get("retail")))
                with row_cols[4]:
                    render_read_only_table_cell(_format_euro(adviesprijzen.get("horeca")))
                with row_cols[5]:
                    render_read_only_table_cell(_format_euro(adviesprijzen.get("slijterij")))
                with row_cols[6]:
                    render_read_only_table_cell(_format_percentage(row.get("marge_pct")))
        st.write("")
        if liters_basis == LITERS_BASIS_ALGEMEEN:
            hoogste_kostprijs, bronjaar, bronbier = _highest_cost_overall(jaar)
            bron_strategy_label = _effective_strategy_source_label(jaar)
        else:
            hoogste_kostprijs, bronjaar = _highest_cost_for_bier(jaar, bier_key)
            bronbier = str(basisgegevens.get("biernaam", "") or "-")
            first_row = rows[0] if rows else {}
            bron_strategy_label = _effective_strategy_source_label(
                jaar,
                bier_key=str(first_row.get("bier_key", "") or bier_key),
                product_key=str(first_row.get("product_key", "") or ""),
                verpakking=str(first_row.get("verpakking", "") or ""),
            )
        info_cols = st.columns(3)
        with info_cols[0]:
            render_read_only_table_cell(_format_euro(hoogste_kostprijs))
            st.caption(f"Hoogste bekende kostprijs per liter ({bronjaar or '-'})")
        with info_cols[1]:
            render_read_only_table_cell(str(bronbier or "-"))
            st.caption("Bronbier")
        with info_cols[2]:
            render_read_only_table_cell(bron_strategy_label)
            st.caption("Bron strategie")
        return

    rows = _product_results()
    products = {row["product_key"]: row for row in _build_product_rows_for_bier(jaar, bier_key)}
    st.markdown("<div class='section-title' style='font-size:1.2rem;'>Groothandelsoverzicht</div>", unsafe_allow_html=True)
    headers = [
        "Product",
        "Aantal",
        "Kostprijs € / stuk",
        "Adviesprijs zakelijk €",
        "Adviesprijs retail €",
        "Adviesprijs horeca €",
        "Adviesprijs slijterij €",
        "Onze winstmarge",
    ]
    row_widths = [1.6, 0.7, 1.05, 1.0, 1.0, 1.0, 1.0, 0.9]
    render_table_headers(headers, row_widths)
    for row in rows:
        product = next(
            (
                product_row
                for product_row in _current_product_rows()
                if str(product_row.get("id", "") or "") == str(row.get("id", "") or "")
            ),
            {},
        )
        product_pricing = products.get(str(product.get("product_key", "") or ""), {})
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            render_read_only_table_cell(str(row.get("verpakking", "-") or "-"))
        with row_cols[1]:
            render_read_only_table_cell(f"{float(row.get('aantal', 0.0) or 0.0):.2f}")
        with row_cols[2]:
            render_read_only_table_cell(_format_euro(row.get("kostprijs")))
        with row_cols[3]:
            render_read_only_table_cell(_format_euro(product_pricing.get("zakelijk")))
        with row_cols[4]:
            render_read_only_table_cell(_format_euro(product_pricing.get("retail")))
        with row_cols[5]:
            render_read_only_table_cell(_format_euro(product_pricing.get("horeca")))
        with row_cols[6]:
            render_read_only_table_cell(_format_euro(product_pricing.get("slijterij")))
        with row_cols[7]:
            render_read_only_table_cell(_format_percentage(row.get("marge_pct")))


def _render_navigation(on_back: Callable[[], None]) -> None:
    del on_back
    current_step = int(st.session_state.get("prijsvoorstel_step", 1))
    apply_wizard_navigation_styles()
    if current_step == 1:
        clicked = render_wizard_nav_row(
            [1.5, 1.4, 2.6, 1],
            [
                {"label": "Terug naar overzicht", "key": "pp_nav_overview"},
                {"label": "Opslaan en sluiten", "key": "pp_nav_save_1"},
                None,
                {"label": "Volgende", "key": "pp_nav_next_1", "type": "primary"},
            ],
        )
        if clicked.get("pp_nav_overview"):
            _sync_state_from_widgets()
            st.session_state[VIEW_MODE_KEY] = "overview"
            st.rerun()
        if clicked.get("pp_nav_save_1"):
            _save_and_close_as_concept()
            st.rerun()
        if clicked.get("pp_nav_next_1"):
            _sync_state_from_widgets()
            if _validate_step_v2(1):
                st.session_state["prijsvoorstel_step"] = 2
                st.rerun()
        return

    next_key = "pp_nav_finish" if current_step >= TOTAL_STEPS else f"pp_nav_next_{current_step}"
    next_label = "Afronden" if current_step >= TOTAL_STEPS else "Volgende"
    clicked = render_wizard_nav_row(
        [1.5, 1.0, 1.4, 1.6, 1.0],
        [
            {"label": "Terug naar overzicht", "key": f"pp_nav_overview_{current_step}"},
            {"label": "Vorige", "key": f"pp_nav_prev_{current_step}"},
            {"label": "Opslaan en sluiten", "key": f"pp_nav_save_{current_step}"},
            None,
            {"label": next_label, "key": next_key, "type": "primary"},
        ],
    )
    if clicked.get(f"pp_nav_overview_{current_step}"):
        _sync_state_from_widgets()
        st.session_state[VIEW_MODE_KEY] = "overview"
        st.rerun()
    if clicked.get(f"pp_nav_prev_{current_step}"):
        _sync_state_from_widgets()
        st.session_state["prijsvoorstel_step"] = max(1, current_step - 1)
        st.rerun()
    if clicked.get(f"pp_nav_save_{current_step}"):
        _save_and_close_as_concept()
        st.rerun()
    if clicked.get(next_key):
        if current_step >= TOTAL_STEPS:
            _finalize_and_close()
            st.rerun()
        _sync_state_from_widgets()
        if _validate_step_v2(current_step):
            st.session_state["prijsvoorstel_step"] = min(TOTAL_STEPS, current_step + 1)
            st.rerun()


def show_prijsvoorstel_page(
    on_back: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    del on_logout
    _init_page_state()
    st.markdown("<div class='main-card'>", unsafe_allow_html=True)
    render_breadcrumb(current_label="Prijsvoorstel maken", on_home_click=on_back)
    _render_feedback()
    if str(st.session_state.get(VIEW_MODE_KEY, "overview") or "overview") == "overview":
        _render_overview(on_back)
    else:
        sidebar_col, content_col = st.columns([1.05, 3.2], gap="large")
        with sidebar_col:
            _render_step_indicator()
        with content_col:
            current_step = int(st.session_state.get("prijsvoorstel_step", 1))
            if current_step == 1:
                _render_step_1()
            elif current_step == 2:
                _render_step_2_uitgangspunten()
            elif current_step == 3:
                _render_step_3()
            elif current_step == 4:
                _render_step_4_v2()
            else:
                _render_step_5()
            st.write("")
            _render_navigation(on_back)
    st.markdown("</div>", unsafe_allow_html=True)
