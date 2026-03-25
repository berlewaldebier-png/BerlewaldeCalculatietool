from __future__ import annotations

from datetime import datetime
from typing import Callable
from uuid import uuid4

import streamlit as st

from components.action_buttons import (
    render_delete_button,
    render_edit_button,
    render_save_button,
)
from components.breadcrumb import render_breadcrumb
from components.page_ui import render_page_header
from components.table_ui import render_table_headers
from utils.storage import (
    calculate_total_vaste_kosten,
    calculate_vaste_kosten_per_ingekochte_liter,
    calculate_vaste_kosten_per_liter,
    calculate_vaste_kosten_per_totale_liter,
    delete_vaste_kosten_row,
    ensure_vaste_kosten_storage,
    get_productie_record,
    get_productie_years,
    get_vaste_kosten_record,
    upsert_vaste_kosten_row,
)


COST_TYPE_OPTIONS = ["Directe kosten", "Indirecte kosten"]


def _format_euro(amount: float) -> str:
    """Formatteert een bedrag in euro-notatie."""
    formatted = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"\u20ac {formatted}"


def _format_euro_per_liter(amount: float) -> str:
    """Formatteert een bedrag per liter in euro-notatie."""
    formatted = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"\u20ac {formatted} per L"


def _get_default_year(available_years: list[int]) -> int | None:
    """Bepaalt het standaardjaar voor de pagina vaste kosten."""
    if not available_years:
        return None

    current_year = datetime.now().year
    stored_year = st.session_state.get("vaste_kosten_selected_year")

    if stored_year in available_years:
        return int(stored_year)

    if current_year in available_years:
        return current_year

    return max(available_years)


def _load_year_into_session(year: int) -> None:
    """Laadt alle kostenregels van een jaar in session_state."""
    records = get_vaste_kosten_record(year)
    st.session_state["vaste_kosten_selected_year"] = year
    st.session_state["kosten_input"] = [
        {
            "id": str(record.get("id") or uuid4()),
            "omschrijving": str(record.get("omschrijving", "")),
            "kostensoort": str(record.get("kostensoort", "Indirecte kosten")),
            "bedrag_per_jaar": float(record.get("bedrag_per_jaar", 0.0) or 0.0),
            "_is_new": False,
            "_is_editing": False,
        }
        for record in records
    ]
    for row in st.session_state["kosten_input"]:
        row_id = row["id"]
        st.session_state[f"vaste_kosten_omschrijving_{row_id}"] = str(
            row.get("omschrijving", "")
        )
        st.session_state[f"vaste_kosten_kostensoort_{row_id}"] = str(
            row.get("kostensoort", "Indirecte kosten")
        )
        st.session_state[f"vaste_kosten_bedrag_{row_id}"] = float(
            row.get("bedrag_per_jaar", 0.0) or 0.0
        )
    st.session_state["vaste_kosten_confirm_delete_row_id"] = None
    st.session_state["vaste_kosten_confirm_delete_year"] = False
    st.session_state.setdefault("vaste_kosten_feedback", None)


def _ensure_year_loaded(year: int) -> None:
    """Laadt jaargegevens alleen opnieuw als het gekozen jaar is gewijzigd."""
    loaded_year = st.session_state.get("vaste_kosten_loaded_year")
    if loaded_year != year:
        _load_year_into_session(year)
        st.session_state["vaste_kosten_loaded_year"] = year


def _set_feedback(message: str) -> None:
    """Slaat een subtiele feedbackmelding op."""
    st.session_state["vaste_kosten_feedback"] = message


def _render_feedback() -> None:
    """Toont een feedbackmelding één keer."""
    message = st.session_state.pop("vaste_kosten_feedback", None)
    if message:
        st.success(message)


def _add_empty_row() -> None:
    """Voegt een lege kostenregel toe aan de tijdelijke sessiestatus."""
    rows = list(st.session_state.get("kosten_input", []))
    for row in rows:
        row["_is_editing"] = False

    new_row = {
        "id": str(uuid4()),
        "omschrijving": "",
        "kostensoort": "Indirecte kosten",
        "bedrag_per_jaar": 0.0,
        "_is_new": True,
        "_is_editing": True,
    }
    rows.append(new_row)
    st.session_state["kosten_input"] = rows
    row_id = new_row["id"]
    st.session_state[f"vaste_kosten_omschrijving_{row_id}"] = ""
    st.session_state[f"vaste_kosten_kostensoort_{row_id}"] = "Indirecte kosten"
    st.session_state[f"vaste_kosten_bedrag_{row_id}"] = 0.0


def _set_row_edit_mode(row_id: str) -> None:
    """Zet precies één rij in bewerkmodus."""
    rows = list(st.session_state.get("kosten_input", []))
    for row in rows:
        row["_is_editing"] = row["id"] == row_id
    st.session_state["kosten_input"] = rows


def _remove_row(row_id: str) -> None:
    """Verwijdert een kostenregel uit de sessie."""
    rows = [
        row for row in st.session_state.get("kosten_input", []) if row["id"] != row_id
    ]
    st.session_state["kosten_input"] = rows
    st.session_state["vaste_kosten_confirm_delete_row_id"] = None


def _get_row_from_inputs(row_id: str) -> dict[str, float | str] | None:
    """Leest de actuele invoer van één rij uit session_state."""
    for row in st.session_state.get("kosten_input", []):
        if row["id"] != row_id:
            continue
        return {
            "id": row_id,
            "omschrijving": str(
                st.session_state.get(
                    f"vaste_kosten_omschrijving_{row_id}",
                    row.get("omschrijving", ""),
                )
            ),
            "kostensoort": str(
                st.session_state.get(
                    f"vaste_kosten_kostensoort_{row_id}",
                    row.get("kostensoort", "Indirecte kosten"),
                )
            ),
            "bedrag_per_jaar": float(
                st.session_state.get(
                    f"vaste_kosten_bedrag_{row_id}",
                    row.get("bedrag_per_jaar", 0.0),
                )
                or 0.0
            ),
        }

    return None


def _save_row(selected_year: int, row_id: str) -> None:
    """Valideert en slaat één kostenregel op."""
    row = _get_row_from_inputs(row_id)
    if row is None:
        st.error("De geselecteerde kostenregel is niet gevonden.")
        return

    errors, valid_rows = _validate_rows([row])
    if errors:
        for error in errors:
            st.error(error)
        return

    if not valid_rows:
        st.error("Vul eerst een geldige kostenregel in.")
        return

    saved_row = valid_rows[0]
    if upsert_vaste_kosten_row(selected_year, saved_row):
        st.session_state["vaste_kosten_loaded_year"] = None
        st.session_state["vaste_kosten_confirm_delete_row_id"] = None
        _set_feedback("Kostenregel opgeslagen.")
    else:
        st.error("Opslaan is niet gelukt. Probeer het opnieuw.")


def _delete_row(selected_year: int, row_id: str) -> None:
    """Verwijdert één kostenregel, uit opslag of alleen uit de sessie."""
    row = next(
        (item for item in st.session_state.get("kosten_input", []) if item["id"] == row_id),
        None,
    )
    if row is None:
        st.error("De geselecteerde kostenregel is niet gevonden.")
        return

    if bool(row.get("_is_new")):
        _remove_row(row_id)
        _set_feedback("Conceptregel verwijderd.")
        return

    if delete_vaste_kosten_row(selected_year, row_id):
        _remove_row(row_id)
        _set_feedback("Kostenregel verwijderd.")
    else:
        st.error("Verwijderen is niet gelukt. Probeer het opnieuw.")


def _render_table_header() -> None:
    """Toont de kopregel van de kostenregels."""
    headers = ["Omschrijving", "Kostensoort", "Bedrag per jaar", "", "", ""]
    render_table_headers(headers, [2.3, 1.5, 1.2, 0.42, 0.42, 0.42])


def _collect_rows_from_inputs() -> list[dict[str, float | str]]:
    """Leest de actuele invoervelden uit en zet ze om naar een lijst regels."""
    collected_rows: list[dict[str, float | str]] = []

    for row in st.session_state.get("kosten_input", []):
        row_id = row["id"]
        collected_rows.append(
            {
                "id": row_id,
                "omschrijving": st.session_state.get(
                    f"vaste_kosten_omschrijving_{row_id}",
                    row.get("omschrijving", ""),
                ),
                "kostensoort": st.session_state.get(
                    f"vaste_kosten_kostensoort_{row_id}",
                    row.get("kostensoort", "Indirecte kosten"),
                ),
                "bedrag_per_jaar": float(
                    st.session_state.get(
                        f"vaste_kosten_bedrag_{row_id}",
                        row.get("bedrag_per_jaar", 0.0),
                    )
                    or 0.0
                ),
            }
        )

    return collected_rows


def _validate_rows(rows: list[dict[str, float | str]]) -> tuple[list[str], list[dict[str, float | str]]]:
    """Valideert alle kostenregels en filtert volledig lege regels weg."""
    errors: list[str] = []
    valid_rows: list[dict[str, float | str]] = []

    for index, row in enumerate(rows, start=1):
        omschrijving = str(row.get("omschrijving", "")).strip()
        kostensoort = str(row.get("kostensoort", "Indirecte kosten"))
        bedrag = float(row.get("bedrag_per_jaar", 0.0) or 0.0)
        is_empty_row = not omschrijving and bedrag == 0.0

        if is_empty_row:
            continue

        if not omschrijving:
            errors.append(f"Regel {index}: omschrijving mag niet leeg zijn.")
            continue

        if bedrag < 0:
            errors.append(f"Regel {index}: bedrag per jaar mag niet negatief zijn.")
            continue

        if kostensoort not in COST_TYPE_OPTIONS:
            errors.append(f"Regel {index}: kostensoort is ongeldig.")
            continue

        valid_rows.append(
            {
                "id": str(row.get("id") or uuid4()),
                "omschrijving": omschrijving,
                "kostensoort": kostensoort,
                "bedrag_per_jaar": bedrag,
            }
        )

    return errors, valid_rows


def _get_live_rows_for_summary() -> list[dict[str, float | str]]:
    """Bouwt een veilige conceptlijst voor live berekeningen op basis van session_state."""
    live_rows: list[dict[str, float | str]] = []

    for row in _collect_rows_from_inputs():
        try:
            bedrag = float(row.get("bedrag_per_jaar", 0.0) or 0.0)
        except (TypeError, ValueError):
            bedrag = 0.0

        if bedrag < 0:
            bedrag = 0.0

        live_rows.append(
            {
                "id": str(row.get("id") or uuid4()),
                "omschrijving": str(row.get("omschrijving", "")).strip(),
                "kostensoort": str(row.get("kostensoort", "Indirecte kosten")),
                "bedrag_per_jaar": bedrag,
            }
        )

    return live_rows


def _render_cost_rows(selected_year: int) -> None:
    """Toont alle kostenregels in een tabel-achtige rijstructuur."""
    rows = st.session_state.get("kosten_input", [])
    confirm_row_id = st.session_state.get("vaste_kosten_confirm_delete_row_id")

    if not rows:
        st.info("Er zijn nog geen kostenposten toegevoegd voor dit jaar.")
        return

    _render_table_header()

    for index, row in enumerate(rows, start=1):
        row_id = row["id"]
        is_editing = bool(row.get("_is_editing"))
        row_cols = st.columns([2.3, 1.5, 1.2, 0.42, 0.42, 0.42])

        with row_cols[0]:
            st.text_input(
                f"Omschrijving {index}",
                key=f"vaste_kosten_omschrijving_{row_id}",
                placeholder="Bijvoorbeeld: Autokosten",
                label_visibility="collapsed",
                disabled=not is_editing,
            )

        with row_cols[1]:
            st.selectbox(
                f"Kostensoort {index}",
                options=COST_TYPE_OPTIONS,
                key=f"vaste_kosten_kostensoort_{row_id}",
                label_visibility="collapsed",
                disabled=not is_editing,
            )

        with row_cols[2]:
            st.number_input(
                f"Bedrag per jaar {index}",
                min_value=0.0,
                step=100.0,
                format="%.2f",
                key=f"vaste_kosten_bedrag_{row_id}",
                label_visibility="collapsed",
                disabled=not is_editing,
            )

        with row_cols[3]:
            if render_edit_button(
                key=f"vaste_kosten_edit_{row_id}",
                disabled=is_editing,
            ):
                _set_row_edit_mode(row_id)
                st.session_state["vaste_kosten_confirm_delete_row_id"] = None
                st.rerun()

        with row_cols[4]:
            if render_save_button(
                key=f"vaste_kosten_save_{row_id}",
                disabled=not is_editing,
            ):
                _save_row(selected_year, row_id)
                st.rerun()

        with row_cols[5]:
            if render_delete_button(key=f"vaste_kosten_delete_{row_id}"):
                st.session_state["vaste_kosten_confirm_delete_row_id"] = row_id
                st.session_state["vaste_kosten_confirm_delete_year"] = False
                st.rerun()

        if confirm_row_id == row_id:
            omschrijving = st.session_state.get(
                f"vaste_kosten_omschrijving_{row_id}",
                row.get("omschrijving", ""),
            ).strip() or "deze kostenpost"
            st.warning(
                f"Weet je zeker dat je '{omschrijving}' wilt verwijderen?"
            )
            confirm_col, cancel_col, _ = st.columns([1, 1, 4])
            with confirm_col:
                if st.button("Ja, verwijderen", key=f"confirm_delete_row_{row_id}"):
                    _delete_row(selected_year, row_id)
                    st.rerun()
            with cancel_col:
                if st.button("Annuleren", key=f"cancel_delete_row_{row_id}"):
                    st.session_state["vaste_kosten_confirm_delete_row_id"] = None
                    st.rerun()


def _render_summary(selected_year: int) -> None:
    """Toont totaalbedrag en kengetal voor het geselecteerde jaar."""
    live_rows = _get_live_rows_for_summary()
    totaal = calculate_total_vaste_kosten(live_rows)

    st.markdown(
        "<div class='section-title'>Samenvatting</div>",
        unsafe_allow_html=True,
    )
    st.markdown(
        f"<div class='section-text'><strong>Totaal vaste kosten:</strong> {_format_euro(totaal)}</div>",
        unsafe_allow_html=True,
    )

    productie_record = get_productie_record(selected_year) or {}
    productie_liters = productie_record.get("hoeveelheid_productie_l")
    inkoop_liters = productie_record.get("hoeveelheid_inkoop_l")
    kosten_per_liter = calculate_vaste_kosten_per_liter(totaal, productie_liters)
    kosten_per_ingekochte_liter = calculate_vaste_kosten_per_ingekochte_liter(
        totaal,
        inkoop_liters,
    )
    kosten_per_totale_liter = calculate_vaste_kosten_per_totale_liter(
        totaal,
        productie_liters,
        inkoop_liters,
    )

    if kosten_per_liter is None:
        st.info(
            "Vaste kosten per geproduceerde liter kan niet berekend worden, "
            "omdat de hoeveelheid productie voor dit jaar ontbreekt of 0 is."
        )
    else:
        st.markdown(
            "<div class='section-text'><strong>Vaste kosten per geproduceerde liter:</strong> "
            f"{_format_euro_per_liter(kosten_per_liter)}</div>",
            unsafe_allow_html=True,
        )

    if kosten_per_ingekochte_liter is None:
        st.info("Vaste kosten per ingekochte liter: Niet te berekenen (geen inkoopgegevens beschikbaar)")
    else:
        st.markdown(
            "<div class='section-text'><strong>Vaste kosten per ingekochte liter:</strong> "
            f"{_format_euro_per_liter(kosten_per_ingekochte_liter)}</div>",
            unsafe_allow_html=True,
        )

    if kosten_per_totale_liter is None:
        st.info("Vaste kosten per totale liter: Niet te berekenen (geen totale liters beschikbaar)")
    else:
        st.markdown(
            "<div class='section-text' style='font-size: 1.05rem; color: #24332b;'><strong>Vaste kosten per totale liter:</strong> "
            f"{_format_euro_per_liter(kosten_per_totale_liter)}</div>",
            unsafe_allow_html=True,
        )


def show_vaste_kosten_page(
    on_back: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    """Toont de pagina voor vaste kosten met opslag per productiejaar."""
    ensure_vaste_kosten_storage()

    st.markdown("<div class='main-card'>", unsafe_allow_html=True)
    render_breadcrumb(current_label="Vaste kosten", on_home_click=on_back)
    render_page_header("Vaste kosten", "Beheer vaste kosten per productiejaar")

    available_years = get_productie_years()
    if not available_years:
        st.warning(
            "Er zijn nog geen productie-jaren beschikbaar. Voeg eerst een productiejaar toe."
        )
        col_back, col_spacer = st.columns([1, 4])
        with col_back:
            if st.button("Terug naar welkom", key="vaste_kosten_back_empty"):
                on_back()
        st.markdown("</div>", unsafe_allow_html=True)
        return

    default_year = _get_default_year(available_years)
    selected_year = st.selectbox(
        "Jaartal",
        options=available_years,
        index=available_years.index(default_year) if default_year in available_years else 0,
        key="vaste_kosten_year_selector",
    )
    selected_year = int(selected_year)

    if st.session_state.get("vaste_kosten_selected_year") != selected_year:
        st.session_state["vaste_kosten_selected_year"] = selected_year

    _ensure_year_loaded(selected_year)
    _render_feedback()

    st.markdown(
        "<div class='section-text'>Voeg kostenposten toe en sla ze op per geselecteerd jaar.</div>",
        unsafe_allow_html=True,
    )

    _render_cost_rows(selected_year)

    action_col_add, action_col_spacer = st.columns([1, 4])
    with action_col_add:
        if st.button("Kostenpost toevoegen", key="vaste_kosten_add"):
            _add_empty_row()
            st.rerun()

    _render_summary(selected_year)

    col_back, col_spacer = st.columns([1, 4])
    with col_back:
        if st.button("Terug naar welkom", key="vaste_kosten_back"):
            on_back()

    st.markdown("</div>", unsafe_allow_html=True)
