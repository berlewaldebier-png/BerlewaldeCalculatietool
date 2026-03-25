from __future__ import annotations

from datetime import datetime
from typing import Any, Callable
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
    ensure_productie_storage,
    is_productiejaar_in_gebruik_bij_vaste_kosten,
    load_productiegegevens,
    upsert_productiegegeven,
    delete_productiegegeven,
)


def _get_default_year() -> int:
    """Bepaalt een logisch standaardjaar."""
    current_year = datetime.now().year
    return int(st.session_state.get("productie_selected_year", current_year))


def _validate_year(year: int) -> str | None:
    """Controleert of het gekozen jaar binnen een bruikbaar bereik valt."""
    if year < 1900 or year > 2100:
        return "Voer een geldig jaartal in tussen 1900 en 2100."
    return None


def _validate_liters(value: float | int | None, label: str) -> str | None:
    """Controleert of liters zijn ingevuld en niet negatief zijn."""
    if value is None:
        return f"Vul een waarde in voor '{label}'."
    if value < 0:
        return f"De waarde voor '{label}' mag niet negatief zijn."
    return None


def _load_rows_into_session() -> None:
    """Laadt alle productiegegevens in session_state voor tabelweergave."""
    data = load_productiegegevens()
    rows: list[dict[str, Any]] = []

    for year, values in sorted(data.items(), key=lambda item: item[0]):
        row = {
            "id": f"productie_{year}",
            "year": int(year),
            "hoeveelheid_inkoop_l": float(values.get("hoeveelheid_inkoop_l", 0.0) or 0.0),
            "hoeveelheid_productie_l": float(
                values.get("hoeveelheid_productie_l", 0.0) or 0.0
            ),
            "batchgrootte_eigen_productie_l": float(
                values.get("batchgrootte_eigen_productie_l", 0.0) or 0.0
            ),
            "_is_new": False,
            "_is_editing": False,
        }
        rows.append(row)

    st.session_state["productie_rows"] = rows
    for row in rows:
        row_id = row["id"]
        st.session_state[f"productie_year_{row_id}"] = int(row["year"])
        st.session_state[f"productie_inkoop_{row_id}"] = float(row["hoeveelheid_inkoop_l"])
        st.session_state[f"productie_productie_{row_id}"] = float(
            row["hoeveelheid_productie_l"]
        )
        st.session_state[f"productie_batch_{row_id}"] = float(
            row["batchgrootte_eigen_productie_l"]
        )

    st.session_state["productie_confirm_delete_row_id"] = None
    st.session_state.setdefault("productie_feedback", None)


def _ensure_rows_loaded() -> None:
    """Laadt productiegegevens opnieuw wanneer dat nodig is."""
    if (
        "productie_rows" not in st.session_state
        or st.session_state.get("productie_force_reload")
    ):
        _load_rows_into_session()
        st.session_state["productie_force_reload"] = False


def _set_feedback(message: str) -> None:
    """Slaat een subtiele feedbackmelding op."""
    st.session_state["productie_feedback"] = message


def _render_feedback() -> None:
    """Toont feedback precies één keer."""
    message = st.session_state.pop("productie_feedback", None)
    if message:
        st.success(message)


def _add_empty_row() -> None:
    """Voegt een nieuwe bewerkbare productierij toe."""
    rows = list(st.session_state.get("productie_rows", []))
    for row in rows:
        row["_is_editing"] = False

    new_row = {
        "id": str(uuid4()),
        "year": _get_default_year(),
        "hoeveelheid_inkoop_l": 0.0,
        "hoeveelheid_productie_l": 0.0,
        "batchgrootte_eigen_productie_l": 0.0,
        "_is_new": True,
        "_is_editing": True,
    }
    rows.append(new_row)
    st.session_state["productie_rows"] = rows
    row_id = new_row["id"]
    st.session_state[f"productie_year_{row_id}"] = int(new_row["year"])
    st.session_state[f"productie_inkoop_{row_id}"] = 0.0
    st.session_state[f"productie_productie_{row_id}"] = 0.0
    st.session_state[f"productie_batch_{row_id}"] = 0.0


def _set_row_edit_mode(row_id: str) -> None:
    """Zet precies één rij in bewerkmodus."""
    rows = list(st.session_state.get("productie_rows", []))
    for row in rows:
        row["_is_editing"] = row["id"] == row_id
    st.session_state["productie_rows"] = rows


def _remove_row_from_session(row_id: str) -> None:
    """Verwijdert een rij uit de lokale sessie."""
    st.session_state["productie_rows"] = [
        row for row in st.session_state.get("productie_rows", []) if row["id"] != row_id
    ]
    st.session_state["productie_confirm_delete_row_id"] = None


def _get_row_from_inputs(row_id: str) -> dict[str, Any] | None:
    """Leest de actuele widgetwaarden voor één rij."""
    for row in st.session_state.get("productie_rows", []):
        if row["id"] != row_id:
            continue
        return {
            "id": row_id,
            "year": int(
                st.session_state.get(
                    f"productie_year_{row_id}",
                    row.get("year", _get_default_year()),
                )
            ),
            "hoeveelheid_inkoop_l": float(
                st.session_state.get(
                    f"productie_inkoop_{row_id}",
                    row.get("hoeveelheid_inkoop_l", 0.0),
                )
                or 0.0
            ),
            "hoeveelheid_productie_l": float(
                st.session_state.get(
                    f"productie_productie_{row_id}",
                    row.get("hoeveelheid_productie_l", 0.0),
                )
                or 0.0
            ),
            "batchgrootte_eigen_productie_l": float(
                st.session_state.get(
                    f"productie_batch_{row_id}",
                    row.get("batchgrootte_eigen_productie_l", 0.0),
                )
                or 0.0
            ),
            "_is_new": bool(row.get("_is_new")),
        }

    return None


def _validate_row(row: dict[str, Any]) -> list[str]:
    """Valideert één productierij."""
    year = int(row.get("year", _get_default_year()))
    errors = [
        _validate_year(year),
        _validate_liters(
            row.get("hoeveelheid_inkoop_l"),
            f"Hoeveelheid inkoop in L {year}",
        ),
        _validate_liters(
            row.get("hoeveelheid_productie_l"),
            f"Hoeveelheid productie in L {year}",
        ),
        _validate_liters(
            row.get("batchgrootte_eigen_productie_l"),
            f"Batchgrootte eigen productie in L {year}",
        ),
    ]

    existing_years = {
        int(existing_row["year"])
        for existing_row in st.session_state.get("productie_rows", [])
        if existing_row["id"] != row["id"] and not bool(existing_row.get("_is_new"))
    }
    new_row_years = {
        int(
            st.session_state.get(
                f"productie_year_{existing_row['id']}",
                existing_row.get("year", _get_default_year()),
            )
        )
        for existing_row in st.session_state.get("productie_rows", [])
        if existing_row["id"] != row["id"] and bool(existing_row.get("_is_new"))
    }
    if year in existing_years or year in new_row_years:
        errors.append(f"Er bestaan al productiegegevens voor {year}.")

    return [error for error in errors if error]


def _save_row(row_id: str) -> None:
    """Slaat één productierij op."""
    row = _get_row_from_inputs(row_id)
    if row is None:
        st.error("De geselecteerde productierij is niet gevonden.")
        return

    errors = _validate_row(row)
    if errors:
        for error in errors:
            st.error(error)
        return

    payload = {
        "hoeveelheid_inkoop_l": float(row["hoeveelheid_inkoop_l"]),
        "hoeveelheid_productie_l": float(row["hoeveelheid_productie_l"]),
        "batchgrootte_eigen_productie_l": float(row["batchgrootte_eigen_productie_l"]),
    }

    if upsert_productiegegeven(int(row["year"]), payload):
        st.session_state["productie_selected_year"] = int(row["year"])
        st.session_state["productie_force_reload"] = True
        st.session_state["productie_confirm_delete_row_id"] = None
        _set_feedback(f"Productiegegevens voor {int(row['year'])} zijn opgeslagen.")
    else:
        st.error("Opslaan is niet gelukt. Probeer het opnieuw.")


def _delete_row(row_id: str) -> None:
    """Verwijdert één productierij."""
    row = next(
        (item for item in st.session_state.get("productie_rows", []) if item["id"] == row_id),
        None,
    )
    if row is None:
        st.error("De geselecteerde productierij is niet gevonden.")
        return

    year = int(
        st.session_state.get(
            f"productie_year_{row_id}",
            row.get("year", _get_default_year()),
        )
    )
    year_error = _validate_year(year)
    if year_error:
        st.error(year_error)
        return

    if bool(row.get("_is_new")):
        _remove_row_from_session(row_id)
        _set_feedback("Conceptregel verwijderd.")
        return

    if is_productiejaar_in_gebruik_bij_vaste_kosten(year):
        st.error(
            "Dit productiejaar kan niet worden verwijderd omdat het al wordt gebruikt bij vaste kosten."
        )
        return

    if delete_productiegegeven(year):
        st.session_state["productie_force_reload"] = True
        st.session_state["productie_confirm_delete_row_id"] = None
        _set_feedback(f"De productiegegevens voor {year} zijn verwijderd.")
    else:
        st.error("Verwijderen is niet gelukt. Probeer het opnieuw.")


def _render_table_header() -> None:
    """Toont de tabelkop van productie."""
    headers = [
        "Jaar",
        "Hoeveelheid inkoop in L",
        "Hoeveelheid productie in L",
        "Batchgrootte eigen productie in L",
        "",
        "",
        "",
    ]
    render_table_headers(headers, [0.9, 1.4, 1.4, 1.6, 0.42, 0.42, 0.42])


def _render_rows() -> None:
    """Toont alle productierijen in tabelvorm."""
    rows = st.session_state.get("productie_rows", [])
    confirm_row_id = st.session_state.get("productie_confirm_delete_row_id")

    if not rows:
        st.info("Er zijn nog geen productiegegevens opgeslagen.")
        return

    _render_table_header()

    for row in rows:
        row_id = row["id"]
        is_editing = bool(row.get("_is_editing"))
        row_cols = st.columns([0.9, 1.4, 1.4, 1.6, 0.42, 0.42, 0.42])

        with row_cols[0]:
            st.number_input(
                "Jaar",
                min_value=1900,
                max_value=2100,
                value=int(row.get("year", _get_default_year())),
                step=1,
                format="%d",
                key=f"productie_year_{row_id}",
                label_visibility="collapsed",
                disabled=not is_editing,
            )
        with row_cols[1]:
            st.number_input(
                "Hoeveelheid inkoop in L",
                min_value=0.0,
                value=float(row.get("hoeveelheid_inkoop_l", 0.0) or 0.0),
                step=100.0,
                key=f"productie_inkoop_{row_id}",
                label_visibility="collapsed",
                disabled=not is_editing,
            )
        with row_cols[2]:
            st.number_input(
                "Hoeveelheid productie in L",
                min_value=0.0,
                value=float(row.get("hoeveelheid_productie_l", 0.0) or 0.0),
                step=100.0,
                key=f"productie_productie_{row_id}",
                label_visibility="collapsed",
                disabled=not is_editing,
            )
        with row_cols[3]:
            st.number_input(
                "Batchgrootte eigen productie in L",
                min_value=0.0,
                value=float(row.get("batchgrootte_eigen_productie_l", 0.0) or 0.0),
                step=100.0,
                key=f"productie_batch_{row_id}",
                label_visibility="collapsed",
                disabled=not is_editing,
            )
        with row_cols[4]:
            if render_edit_button(
                key=f"productie_edit_{row_id}",
                disabled=is_editing,
            ):
                _set_row_edit_mode(row_id)
                st.session_state["productie_confirm_delete_row_id"] = None
                st.rerun()
        with row_cols[5]:
            if render_save_button(
                key=f"productie_save_{row_id}",
                disabled=not is_editing,
            ):
                _save_row(row_id)
                st.rerun()
        with row_cols[6]:
            if render_delete_button(key=f"productie_delete_{row_id}"):
                st.session_state["productie_confirm_delete_row_id"] = row_id
                st.rerun()

        if confirm_row_id == row_id:
            year = int(
                st.session_state.get(
                    f"productie_year_{row_id}",
                    row.get("year", _get_default_year()),
                )
            )
            st.warning(f"Weet je zeker dat je productiejaar {year} wilt verwijderen?")
            confirm_col, cancel_col, _ = st.columns([1, 1, 4])
            with confirm_col:
                if st.button("Ja, verwijderen", key=f"confirm_productie_delete_{row_id}"):
                    _delete_row(row_id)
                    st.rerun()
            with cancel_col:
                if st.button("Annuleren", key=f"cancel_productie_delete_{row_id}"):
                    st.session_state["productie_confirm_delete_row_id"] = None
                    st.rerun()


def show_productie_page(
    on_back: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    """Toont de productiepagina in tabelvorm met rij-acties."""
    ensure_productie_storage()
    _ensure_rows_loaded()

    st.markdown("<div class='main-card'>", unsafe_allow_html=True)
    render_breadcrumb(current_label="Productie", on_home_click=on_back)
    render_page_header("Productie", "Beheer productiegegevens per jaartal")
    _render_feedback()

    st.markdown(
        "<div class='section-text'>Beheer hieronder productiegegevens per jaar via de tabel.</div>",
        unsafe_allow_html=True,
    )

    _render_rows()

    action_col_add, action_col_spacer = st.columns([1, 4])
    with action_col_add:
        if st.button("Toevoegen", key="productie_add"):
            _add_empty_row()
            st.rerun()

    col_back, col_spacer = st.columns([1, 4])
    with col_back:
        if st.button("Terug naar home", key="productie_back"):
            on_back()

    st.markdown("</div>", unsafe_allow_html=True)
