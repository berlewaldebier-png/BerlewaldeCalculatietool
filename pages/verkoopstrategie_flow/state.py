from __future__ import annotations

from typing import Any, Callable

import streamlit as st

from components.action_buttons import (
    render_delete_button,
    render_edit_button,
    render_save_button,
)
from components.page_ui import render_page_header
from components.table_ui import render_read_only_table_cell, render_table_headers
from pages.nieuwe_berekening.state import build_step_4_product_tables
from utils.storage import (
    VERKOOPSTRATEGIE_CATEGORIEN,
    add_or_update_verkoopstrategie_product,
    add_or_update_verkoopstrategie_verpakking,
    delete_verkoopstrategie_verpakking,
    get_definitieve_berekeningen,
    get_productie_years,
    get_latest_verkoopstrategie_up_to_year,
    get_latest_verkoopstrategie_verpakking_up_to_year,
    get_verkoopstrategie_product,
    get_verkoopstrategie_verpakking,
    load_samengestelde_producten_for_year,
    load_verkoopstrategie_verpakkingen,
)


SELECTED_YEAR_KEY = "verkoopstrategie_selected_year"
FEEDBACK_KEY = "verkoopstrategie_feedback"
EDIT_PACKAGING_KEY = "verkoopstrategie_edit_packaging_key"
CONFIRM_DELETE_KEY = "verkoopstrategie_confirm_delete_packaging_key"
EDIT_PRODUCT_OVERRIDE_KEY = "verkoopstrategie_edit_product_override_key"


def _format_percentage(value: float | int | None) -> str:
    try:
        amount = float(value or 0.0)
    except (TypeError, ValueError):
        amount = 0.0
    return f"{amount:.2f}%".replace(".", ",")


def _format_euro(value: float | int | None) -> str:
    try:
        amount = float(value or 0.0)
    except (TypeError, ValueError):
        amount = 0.0
    formatted = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return formatted


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


def _packaging_key(value: str) -> str:
    return str(value or "").strip().lower()


def _margin_widget_key(packaging_key: str, categorie: str) -> str:
    return f"verkoopstrategie_marge_{packaging_key}_{categorie}"


def _record_sort_key(record: dict[str, Any]) -> str:
    return str(record.get("updated_at") or record.get("finalized_at") or record.get("created_at") or "")


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


def _available_years() -> list[int]:
    years: set[int] = set(get_productie_years())
    for record in get_definitieve_berekeningen():
        basisgegevens = record.get("basisgegevens", {})
        if not isinstance(basisgegevens, dict):
            basisgegevens = {}
        try:
            year = int(basisgegevens.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            year = 0
        if year > 0:
            years.add(year)
    return sorted(years, reverse=True)


def _default_year() -> int:
    years = _available_years()
    return years[0] if years else date.today().year


def _init_page_state() -> None:
    if SELECTED_YEAR_KEY not in st.session_state:
        st.session_state[SELECTED_YEAR_KEY] = _default_year()
    if FEEDBACK_KEY not in st.session_state:
        st.session_state[FEEDBACK_KEY] = None
    if EDIT_PACKAGING_KEY not in st.session_state:
        st.session_state[EDIT_PACKAGING_KEY] = ""
    if CONFIRM_DELETE_KEY not in st.session_state:
        st.session_state[CONFIRM_DELETE_KEY] = ""
    if EDIT_PRODUCT_OVERRIDE_KEY not in st.session_state:
        st.session_state[EDIT_PRODUCT_OVERRIDE_KEY] = ""


def _set_feedback(message: str) -> None:
    st.session_state[FEEDBACK_KEY] = message


def _render_feedback() -> None:
    message = st.session_state.pop(FEEDBACK_KEY, None)
    if message:
        st.success(message)


def _latest_definitive_records_up_to_year(year: int) -> list[dict[str, Any]]:
    latest_by_bier: dict[str, dict[str, Any]] = {}
    for record in get_definitieve_berekeningen():
        basisgegevens = record.get("basisgegevens", {})
        if not isinstance(basisgegevens, dict):
            basisgegevens = {}
        try:
            record_year = int(basisgegevens.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            record_year = 0
        if record_year <= 0 or record_year > year:
            continue
        bier_key = _bier_group_key(record)
        current = latest_by_bier.get(bier_key)
        if current is None or _record_sort_key(record) > _record_sort_key(current):
            latest_by_bier[bier_key] = record
    return sorted(
        latest_by_bier.values(),
        key=lambda item: str(item.get("basisgegevens", {}).get("biernaam", "") or "").lower(),
    )


def _build_samengestelde_product_rows(record: dict[str, Any]) -> list[dict[str, Any]]:
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    tables = build_step_4_product_tables(record)
    rows: list[dict[str, Any]] = []
    for product in tables.get("samengestelde_producten", []):
        if not isinstance(product, dict):
            continue
        kostprijs = float(
            float(product.get("variabele_kosten", 0.0) or 0.0)
            + float(product.get("verpakkingskosten", 0.0) or 0.0)
            + float(product.get("vaste_directe_kosten", 0.0) or 0.0)
            + float(product.get("accijns", 0.0) or 0.0)
        )
        liters_per_product = float(product.get("liters_per_product", 0.0) or 0.0)
        kostprijs_per_liter = kostprijs / liters_per_product if liters_per_product > 0 else 0.0
        verpakking = str(product.get("verpakking", "") or "-")
        rows.append(
            {
                "bier_key": _bier_group_key(record),
                "biernaam": str(basisgegevens.get("biernaam", "") or "-"),
                "stijl": str(basisgegevens.get("stijl", "") or "-"),
                "bron_berekening_id": str(record.get("id", "") or ""),
                "bron_jaar": int(basisgegevens.get("jaar", 0) or 0),
                "product_key": f"samengesteld|{_packaging_key(verpakking)}",
                "verpakking_key": _packaging_key(verpakking),
                "verpakking": verpakking,
                "kostprijs": kostprijs,
                "kostprijs_per_liter": kostprijs_per_liter,
            }
        )
    return rows


def _packaging_catalog(year: int) -> list[dict[str, str]]:
    catalog: dict[str, str] = {}
    for product in load_samengestelde_producten_for_year(year):
        if not isinstance(product, dict):
            continue
        verpakking = str(product.get("omschrijving", "") or "").strip()
        verpakking_key = _packaging_key(verpakking)
        if verpakking_key and verpakking_key not in catalog:
            catalog[verpakking_key] = verpakking
    for record in _latest_definitive_records_up_to_year(year):
        for row in _build_samengestelde_product_rows(record):
            verpakking_key = str(row.get("verpakking_key", "") or "")
            verpakking = str(row.get("verpakking", "") or "")
            if verpakking_key and verpakking_key not in catalog:
                catalog[verpakking_key] = verpakking
    for strategy in load_verkoopstrategie_verpakkingen():
        verpakking_key = _packaging_key(strategy.get("verpakking_key", ""))
        verpakking = str(strategy.get("verpakking", "") or "")
        if verpakking_key and verpakking_key not in catalog:
            catalog[verpakking_key] = verpakking
    return [
        {"verpakking_key": key, "verpakking": label}
        for key, label in sorted(catalog.items(), key=lambda item: item[1].lower())
    ]


def _effective_packaging_strategy(year: int, verpakking_key: str, verpakking: str) -> dict[str, Any]:
    empty_margins = {categorie: 0.0 for categorie in VERKOOPSTRATEGIE_CATEGORIEN}
    current = get_verkoopstrategie_verpakking(year, verpakking_key)
    if current:
        return {
            "record": current,
            "kanaalmarges": dict(current.get("kanaalmarges", {}) or empty_margins),
            "status": "Ingevuld voor dit jaar",
            "bron_label": f"Jaar {year}",
            "bron_jaar": int(current.get("jaar", year) or year),
            "exact": True,
            "delete_enabled": True,
        }

    previous = get_latest_verkoopstrategie_verpakking_up_to_year(year, verpakking_key)
    if previous:
        bronjaar = int(previous.get("jaar", year) or year)
        return {
            "record": previous,
            "kanaalmarges": dict(previous.get("kanaalmarges", {}) or empty_margins),
            "status": f"Overgenomen uit {bronjaar}",
            "bron_label": f"Bronjaar {bronjaar}",
            "bron_jaar": bronjaar,
            "exact": False,
            "delete_enabled": False,
        }

    fallback_year = get_latest_verkoopstrategie_up_to_year(year)
    if fallback_year:
        bronjaar = int(fallback_year.get("jaar", year) or year)
        return {
            "record": fallback_year,
            "kanaalmarges": dict(fallback_year.get("kanaalmarges", {}) or empty_margins),
            "status": f"Algemene jaarstrategie {bronjaar}",
            "bron_label": f"Jaarstrategie {bronjaar}",
            "bron_jaar": bronjaar,
            "exact": False,
            "delete_enabled": False,
        }

    return {
        "record": None,
        "kanaalmarges": empty_margins,
        "status": "Nog invullen",
        "bron_label": "Nog invullen",
        "bron_jaar": year,
        "exact": False,
        "delete_enabled": False,
    }


def _begin_edit_packaging(year: int, packaging_row: dict[str, str]) -> None:
    verpakking_key = str(packaging_row.get("verpakking_key", "") or "")
    strategy = _effective_packaging_strategy(
        year,
        verpakking_key,
        str(packaging_row.get("verpakking", "") or ""),
    )
    for categorie in VERKOOPSTRATEGIE_CATEGORIEN:
        st.session_state[_margin_widget_key(verpakking_key, categorie)] = float(
            strategy.get("kanaalmarges", {}).get(categorie, 0.0) or 0.0
        )
    st.session_state[EDIT_PACKAGING_KEY] = verpakking_key
    st.session_state[CONFIRM_DELETE_KEY] = ""


def _save_packaging_strategy(year: int, packaging_row: dict[str, str]) -> bool:
    verpakking_key = str(packaging_row.get("verpakking_key", "") or "")
    verpakking = str(packaging_row.get("verpakking", "") or "")
    existing = _effective_packaging_strategy(year, verpakking_key, verpakking)
    kanaalmarges: dict[str, float] = {}
    for categorie in VERKOOPSTRATEGIE_CATEGORIEN:
        try:
            value = float(st.session_state.get(_margin_widget_key(verpakking_key, categorie), 0.0) or 0.0)
        except (TypeError, ValueError):
            value = 0.0
        if value < 0 or value >= 100:
            st.error(f"De winstmarge voor {categorie} moet tussen 0 en 99,99 liggen.")
            return False
        kanaalmarges[categorie] = value

    saved = add_or_update_verkoopstrategie_verpakking(
        {
            "jaar": year,
            "bron_jaar": int(existing.get("bron_jaar", year) or year),
            "verpakking_key": verpakking_key,
            "verpakking": verpakking,
            "bron_verkoopstrategie_id": str(
                ((existing.get("record") or {}) if isinstance(existing.get("record"), dict) else {}).get("id", "") or ""
            ),
            "strategie_type": "handmatig",
            "kanaalmarges": kanaalmarges,
        }
    )
    if not saved:
        st.error("Opslaan van de verkoopstrategie is niet gelukt.")
        return False
    st.session_state[EDIT_PACKAGING_KEY] = ""
    st.session_state[CONFIRM_DELETE_KEY] = ""
    _set_feedback(f"Verkoopstrategie opgeslagen voor {verpakking}.")
    return True


def _render_marge_summary_cell(marge: float | int | None, prijs: float | int | None) -> None:
    st.markdown(
        f"""
        <div style="
            min-height:2.5rem;
            display:flex;
            align-items:center;
            padding:0.45rem 0.7rem;
            border:1px solid #d9ddcf;
            border-radius:0.5rem;
            background:#f7f8f3;
            color:#24332b;
            font-size:0.92rem;">
            {_format_percentage(marge)} | {_format_euro(prijs)}
        </div>
        """,
        unsafe_allow_html=True,
    )


def _product_override_edit_key(year: int, row: dict[str, Any]) -> str:
    return "|".join(
        [
            str(int(year or 0)),
            str(row.get("bier_key", "") or ""),
            str(row.get("product_key", "") or ""),
        ]
    )


def _product_override_margin_widget_key(year: int, row: dict[str, Any], categorie: str) -> str:
    return f"verkoopstrategie_override_{_product_override_edit_key(year, row)}_{categorie}"


def _begin_edit_product_override(year: int, row: dict[str, Any]) -> None:
    existing = get_verkoopstrategie_product(
        year,
        str(row.get("bier_key", "") or ""),
        str(row.get("product_key", "") or ""),
        only_override=True,
    )
    kanaalmarges = (
        dict(existing.get("kanaalmarges", {}) or {})
        if isinstance(existing, dict)
        else dict(row.get("kanaalmarges", {}) or {})
    )
    for categorie in VERKOOPSTRATEGIE_CATEGORIEN:
        st.session_state[_product_override_margin_widget_key(year, row, categorie)] = float(
            kanaalmarges.get(categorie, 0.0) or 0.0
        )
    st.session_state[EDIT_PRODUCT_OVERRIDE_KEY] = _product_override_edit_key(year, row)


def _save_product_override(year: int, row: dict[str, Any]) -> bool:
    kanaalmarges: dict[str, float] = {}
    for categorie in VERKOOPSTRATEGIE_CATEGORIEN:
        try:
            value = float(st.session_state.get(_product_override_margin_widget_key(year, row, categorie), 0.0) or 0.0)
        except (TypeError, ValueError):
            value = 0.0
        if value < 0 or value >= 100:
            st.error(f"De winstmarge voor {categorie} moet tussen 0 en 99,99 liggen.")
            return False
        kanaalmarges[categorie] = value

    saved = add_or_update_verkoopstrategie_product(
        {
            "jaar": year,
            "bron_jaar": int(row.get("bron_jaar", 0) or 0),
            "bier_key": str(row.get("bier_key", "") or ""),
            "biernaam": str(row.get("biernaam", "") or ""),
            "stijl": str(row.get("stijl", "") or ""),
            "product_key": str(row.get("product_key", "") or ""),
            "product_type": "samengesteld",
            "verpakking": str(row.get("verpakking", "") or ""),
            "bron_berekening_id": str(row.get("bron_berekening_id", "") or ""),
            "strategie_type": "uitzondering",
            "kostprijs": float(row.get("kostprijs", 0.0) or 0.0),
            "kostprijs_per_liter": float(row.get("kostprijs_per_liter", 0.0) or 0.0),
            "kanaalmarges": kanaalmarges,
        }
    )
    if not saved:
        st.error("Opslaan van de productspecifieke afwijking is niet gelukt.")
        return False
    st.session_state[EDIT_PRODUCT_OVERRIDE_KEY] = ""
    _set_feedback(
        f"Afwijkende verkoopstrategie opgeslagen voor {row.get('biernaam', '-')}"
        f" - {row.get('verpakking', '-')}.",
    )
    return True


def _render_marges_tab(year: int) -> None:
    st.markdown(
        "<div class='section-text'>Beheer hier per jaar de winstmarges per samengesteld verpakkingstype. Nieuwe bieren nemen automatisch de marges van hun verpakkingstype over.</div>",
        unsafe_allow_html=True,
    )
    packaging_rows = _packaging_catalog(year)
    if not packaging_rows:
        st.info("Er zijn nog geen samengestelde producten gevonden om marges voor te beheren.")
        return

    headers = ["Verpakkingstype", "Particulier", "Zakelijk", "Retail", "Horeca", "Slijterij", "Status", "", ""]
    row_widths = [1.9, 0.95, 0.95, 0.95, 0.95, 0.95, 1.15, 0.42, 0.42]
    render_table_headers(headers, row_widths)

    edit_packaging_key = str(st.session_state.get(EDIT_PACKAGING_KEY, "") or "")
    confirm_delete_key = str(st.session_state.get(CONFIRM_DELETE_KEY, "") or "")

    for packaging_row in packaging_rows:
        verpakking_key = str(packaging_row.get("verpakking_key", "") or "")
        verpakking = str(packaging_row.get("verpakking", "") or "-")
        strategy = _effective_packaging_strategy(year, verpakking_key, verpakking)
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            render_read_only_table_cell(verpakking)

        if edit_packaging_key == verpakking_key:
            for index, categorie in enumerate(VERKOOPSTRATEGIE_CATEGORIEN, start=1):
                with row_cols[index]:
                    st.number_input(
                        f"{verpakking} {categorie}",
                        min_value=0.0,
                        max_value=99.99,
                        step=0.1,
                        format="%.2f",
                        key=_margin_widget_key(verpakking_key, categorie),
                        label_visibility="collapsed",
                    )
            with row_cols[6]:
                render_read_only_table_cell(str(strategy.get("bron_label", "") or "-"))
            with row_cols[7]:
                if render_save_button(key=f"verkoopstrategie_save_{verpakking_key}"):
                    if _save_packaging_strategy(year, packaging_row):
                        st.rerun()
            with row_cols[8]:
                if render_delete_button(
                    key=f"verkoopstrategie_delete_{verpakking_key}",
                    disabled=not bool(strategy.get("delete_enabled")),
                ):
                    st.session_state[CONFIRM_DELETE_KEY] = verpakking_key
                    st.rerun()
        else:
            for index, categorie in enumerate(VERKOOPSTRATEGIE_CATEGORIEN, start=1):
                with row_cols[index]:
                    render_read_only_table_cell(_format_percentage(strategy.get("kanaalmarges", {}).get(categorie)))
            with row_cols[6]:
                render_read_only_table_cell(str(strategy.get("status", "") or "-"))
            with row_cols[7]:
                if render_edit_button(key=f"verkoopstrategie_edit_{verpakking_key}"):
                    _begin_edit_packaging(year, packaging_row)
                    st.rerun()
            with row_cols[8]:
                if render_delete_button(
                    key=f"verkoopstrategie_delete_{verpakking_key}",
                    disabled=not bool(strategy.get("delete_enabled")),
                ):
                    st.session_state[CONFIRM_DELETE_KEY] = verpakking_key
                    st.rerun()

        if confirm_delete_key == verpakking_key and bool(strategy.get("delete_enabled")):
            st.warning(f"Weet je zeker dat je de marges voor {verpakking} in {year} wilt verwijderen?")
            confirm_col, cancel_col, _ = st.columns([1.0, 1.0, 5.0])
            with confirm_col:
                record = strategy.get("record", {})
                record_id = str(record.get("id", "") or "") if isinstance(record, dict) else ""
                if st.button("Ja, verwijderen", key=f"verkoopstrategie_confirm_delete_{verpakking_key}"):
                    if record_id and delete_verkoopstrategie_verpakking(record_id):
                        st.session_state[CONFIRM_DELETE_KEY] = ""
                        st.session_state[EDIT_PACKAGING_KEY] = ""
                        _set_feedback(f"Verkoopstrategie verwijderd voor {verpakking}.")
                        st.rerun()
            with cancel_col:
                if st.button("Annuleren", key=f"verkoopstrategie_cancel_delete_{verpakking_key}"):
                    st.session_state[CONFIRM_DELETE_KEY] = ""
                    st.rerun()


def _overview_rows(year: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for record in _latest_definitive_records_up_to_year(year):
        for product_row in _build_samengestelde_product_rows(record):
            product_override = get_verkoopstrategie_product(
                year,
                str(product_row.get("bier_key", "") or ""),
                str(product_row.get("product_key", "") or ""),
                only_override=True,
            )
            if product_override:
                strategy = {
                    "status": "Afwijkend voor bier",
                    "kanaalmarges": dict(product_override.get("kanaalmarges", {}) or {}),
                }
            else:
                strategy = _effective_packaging_strategy(
                    year,
                    str(product_row.get("verpakking_key", "") or ""),
                    str(product_row.get("verpakking", "") or ""),
                )
            kanaalmarges = strategy.get("kanaalmarges", {})
            if not isinstance(kanaalmarges, dict):
                kanaalmarges = {}
            kostprijs = float(product_row.get("kostprijs", 0.0) or 0.0)
            rows.append(
                {
                    **product_row,
                    "status": str(strategy.get("status", "") or "-"),
                    "kanaalmarges": {
                        categorie: float(kanaalmarges.get(categorie, 0.0) or 0.0)
                        for categorie in VERKOOPSTRATEGIE_CATEGORIEN
                    },
                    "kanaalprijzen": {
                        categorie: _calculate_price_from_margin(kostprijs, kanaalmarges.get(categorie))
                        for categorie in VERKOOPSTRATEGIE_CATEGORIEN
                    },
                }
            )
    return sorted(
        rows,
        key=lambda item: (
            str(item.get("biernaam", "") or "").lower(),
            str(item.get("verpakking", "") or "").lower(),
        ),
    )


def _render_bieren_tab(year: int) -> None:
    st.markdown(
        "<div class='section-text'>Hier zie je per bier en verpakking de actuele kostprijs, de gekoppelde winstmarges en de afgeleide adviesprijzen.</div>",
        unsafe_allow_html=True,
    )
    rows = _overview_rows(year)
    if not rows:
        st.info("Er zijn nog geen bierregels beschikbaar voor dit jaaroverzicht.")
        return

    headers = [
        "Bier",
        "Stijl",
        "Verpakking",
        "Bronjaar",
        "Kostprijs € / stuk",
        "Kostprijs € / L",
        "Zakelijk",
        "Retail",
        "Horeca",
        "Slijterij",
        "Status",
        "",
    ]
    row_widths = [1.55, 1.0, 1.5, 0.7, 0.95, 0.95, 1.05, 1.05, 1.05, 1.05, 1.15, 0.42]
    render_table_headers(headers, row_widths)
    edit_override_key = str(st.session_state.get(EDIT_PRODUCT_OVERRIDE_KEY, "") or "")
    for row in rows:
        current_edit_key = _product_override_edit_key(year, row)
        row_cols = st.columns(row_widths)
        with row_cols[0]:
            render_read_only_table_cell(str(row.get("biernaam", "") or "-"))
        with row_cols[1]:
            render_read_only_table_cell(str(row.get("stijl", "") or "-"))
        with row_cols[2]:
            render_read_only_table_cell(str(row.get("verpakking", "") or "-"))
        with row_cols[3]:
            render_read_only_table_cell(str(int(row.get("bron_jaar", 0) or 0) or "-"))
        with row_cols[4]:
            render_read_only_table_cell(_format_euro(row.get("kostprijs")))
        with row_cols[5]:
            render_read_only_table_cell(_format_euro(row.get("kostprijs_per_liter")))
        if edit_override_key == current_edit_key:
            for index, categorie in enumerate(["zakelijk", "retail", "horeca", "slijterij"], start=6):
                with row_cols[index]:
                    st.number_input(
                        f"{row.get('biernaam', '')} {row.get('verpakking', '')} {categorie}",
                        min_value=0.0,
                        max_value=99.99,
                        step=0.1,
                        format="%.2f",
                        key=_product_override_margin_widget_key(year, row, categorie),
                        label_visibility="collapsed",
                    )
        else:
            for index, categorie in enumerate(["zakelijk", "retail", "horeca", "slijterij"], start=6):
                with row_cols[index]:
                    _render_marge_summary_cell(
                        row.get("kanaalmarges", {}).get(categorie),
                        row.get("kanaalprijzen", {}).get(categorie),
                    )
        with row_cols[10]:
            render_read_only_table_cell(str(row.get("status", "") or "-"))
        with row_cols[11]:
            if edit_override_key == current_edit_key:
                if render_save_button(key=f"verkoopstrategie_product_override_save_{current_edit_key}"):
                    if _save_product_override(year, row):
                        st.rerun()
            else:
                if render_edit_button(key=f"verkoopstrategie_product_override_edit_{current_edit_key}"):
                    _begin_edit_product_override(year, row)
                    st.rerun()


def render_verkoopstrategie_content(on_back: Callable[[], None]) -> None:
    render_page_header(
        "Verkoopstrategie",
        "Beheer hier per jaar de winstmarges per samengesteld verpakkingstype. Adviesprijzen voor bieren worden daar automatisch van afgeleid.",
    )
    available_years = _available_years()
    if not available_years:
        st.info("Er zijn nog geen bekende jaren beschikbaar voor Verkoopstrategie.")
        back_col, _ = st.columns([1.2, 4.8])
        with back_col:
            if st.button("Terug naar welkom", key="verkoopstrategie_back_empty"):
                on_back()
        return

    selected_year = int(st.session_state.get(SELECTED_YEAR_KEY, _default_year()) or _default_year())
    if selected_year not in available_years:
        selected_year = available_years[0]
        st.session_state[SELECTED_YEAR_KEY] = selected_year

    year_col, _ = st.columns([1.2, 4.8])
    with year_col:
        selected_year = st.selectbox(
            "Jaar",
            options=available_years,
            index=available_years.index(selected_year),
            key=f"{SELECTED_YEAR_KEY}_selector",
        )
        st.session_state[SELECTED_YEAR_KEY] = int(selected_year)

    marges_tab, overzicht_tab = st.tabs(["Marges per jaar", "Overzicht bieren"])
    with marges_tab:
        _render_marges_tab(selected_year)
    with overzicht_tab:
        _render_bieren_tab(selected_year)

    back_col, _ = st.columns([1.2, 4.8])
    with back_col:
        if st.button("Terug naar welkom", key="verkoopstrategie_back"):
            on_back()


def show_verkoopprijzen_page(on_back: Callable[[], None], on_logout: Callable[[], None]) -> None:
    del on_logout
    render_verkoopstrategie_content(on_back)
