from __future__ import annotations

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
    delete_tarieven_heffingen_row,
    ensure_tarieven_heffingen_storage,
    load_tarieven_heffingen,
    save_tarieven_heffingen,
    upsert_tarieven_heffingen_row,
)


def _set_feedback(message: str) -> None:
    """Slaat een feedbackmelding op."""
    st.session_state["tarieven_heffingen_feedback"] = message


def _reset_page_state() -> None:
    """Ruimt tijdelijke page-state op zonder opslag weg te schrijven."""
    keys_to_remove = [
        key
        for key in list(st.session_state.keys())
        if key.startswith("tarieven_heffingen_") or key.startswith("th_")
    ]
    for key in keys_to_remove:
        st.session_state.pop(key, None)


def _render_feedback() -> None:
    """Toont een feedbackmelding precies een keer."""
    message = st.session_state.pop("tarieven_heffingen_feedback", None)
    if message:
        st.success(message)


def _load_into_session() -> None:
    """Laadt de huidige tarievenregels in session_state."""
    rows = [
        {
            "id": str(record.get("id", "") or uuid4()),
            "jaar": int(record.get("jaar", 0) or 0),
            "tarief_hoog": float(record.get("tarief_hoog", 0.0) or 0.0),
            "tarief_laag": float(record.get("tarief_laag", 0.0) or 0.0),
            "verbruikersbelasting": float(
                record.get("verbruikersbelasting", 0.0) or 0.0
            ),
            "_is_editing": False,
            "_is_new": False,
        }
        for record in load_tarieven_heffingen()
    ]
    st.session_state["tarieven_heffingen_rows"] = rows
    for row in rows:
        row_id = row["id"]
        st.session_state[f"th_jaar_{row_id}"] = int(row["jaar"] or 0)
        st.session_state[f"th_hoog_{row_id}"] = float(row["tarief_hoog"] or 0.0)
        st.session_state[f"th_laag_{row_id}"] = float(row["tarief_laag"] or 0.0)
        st.session_state[f"th_verbruikersbelasting_{row_id}"] = float(
            row["verbruikersbelasting"] or 0.0
        )
    st.session_state["tarieven_heffingen_confirm_delete_row_id"] = None
    st.session_state["tarieven_heffingen_loaded"] = True


def _ensure_loaded() -> None:
    """Laadt de pagina alleen opnieuw als dat nog niet gebeurd is."""
    if not st.session_state.get("tarieven_heffingen_loaded"):
        _load_into_session()


def _set_row_edit_mode(row_id: str) -> None:
    """Zet precies één rij in bewerkmodus."""
    rows = list(st.session_state.get("tarieven_heffingen_rows", []))
    for row in rows:
        row["_is_editing"] = row["id"] == row_id
    st.session_state["tarieven_heffingen_rows"] = rows


def _add_empty_row() -> None:
    """Voegt een lege rij toe."""
    rows = list(st.session_state.get("tarieven_heffingen_rows", []))
    for row in rows:
        row["_is_editing"] = False

    row_id = str(uuid4())
    new_row = {
        "id": row_id,
        "jaar": 0,
        "tarief_hoog": 0.0,
        "tarief_laag": 0.0,
        "verbruikersbelasting": 0.0,
        "_is_editing": True,
        "_is_new": True,
    }
    rows.append(new_row)
    st.session_state["tarieven_heffingen_rows"] = rows
    st.session_state[f"th_jaar_{row_id}"] = 0
    st.session_state[f"th_hoog_{row_id}"] = 0.0
    st.session_state[f"th_laag_{row_id}"] = 0.0
    st.session_state[f"th_verbruikersbelasting_{row_id}"] = 0.0


def _get_row_from_inputs(row_id: str) -> dict[str, float | int | str] | None:
    """Leest één rij uit session_state."""
    for row in st.session_state.get("tarieven_heffingen_rows", []):
        if row["id"] != row_id:
            continue
        return {
            "id": row_id,
            "jaar": int(st.session_state.get(f"th_jaar_{row_id}", row.get("jaar", 0)) or 0),
            "tarief_hoog": float(
                st.session_state.get(
                    f"th_hoog_{row_id}",
                    row.get("tarief_hoog", 0.0),
                )
                or 0.0
            ),
            "tarief_laag": float(
                st.session_state.get(
                    f"th_laag_{row_id}",
                    row.get("tarief_laag", 0.0),
                )
                or 0.0
            ),
            "verbruikersbelasting": float(
                st.session_state.get(
                    f"th_verbruikersbelasting_{row_id}",
                    row.get("verbruikersbelasting", 0.0),
                )
                or 0.0
            ),
        }
    return None


def _validate_row(row: dict[str, float | int | str] | None) -> tuple[list[str], dict[str, float | int | str] | None]:
    """Valideert één tarievenregel."""
    if row is None:
        return ["De geselecteerde regel is niet gevonden."], None

    errors: list[str] = []
    jaar = int(row.get("jaar", 0) or 0)
    tarief_hoog = float(row.get("tarief_hoog", 0.0) or 0.0)
    tarief_laag = float(row.get("tarief_laag", 0.0) or 0.0)
    verbruikersbelasting = float(row.get("verbruikersbelasting", 0.0) or 0.0)

    if jaar <= 0:
        errors.append("Jaar moet groter zijn dan 0.")
    if tarief_hoog < 0:
        errors.append("Tarief hoog mag niet negatief zijn.")
    if tarief_laag < 0:
        errors.append("Tarief laag mag niet negatief zijn.")
    if verbruikersbelasting < 0:
        errors.append("Verbruikersbelasting mag niet negatief zijn.")

    if errors:
        return errors, None

    return (
        [],
        {
            "id": str(row.get("id", "") or uuid4()),
            "jaar": jaar,
            "tarief_hoog": tarief_hoog,
            "tarief_laag": tarief_laag,
            "verbruikersbelasting": verbruikersbelasting,
        },
    )


def _save_row(row_id: str) -> None:
    """Slaat één rij op."""
    errors, valid_row = _validate_row(_get_row_from_inputs(row_id))
    if errors:
        for error in errors:
            st.error(error)
        return

    if valid_row is None:
        st.error("Opslaan is niet gelukt.")
        return

    if upsert_tarieven_heffingen_row(valid_row):
        st.session_state["tarieven_heffingen_loaded"] = False
        _set_feedback("Regel opgeslagen.")
    else:
        st.error("Opslaan is niet gelukt. Probeer het opnieuw.")


def _save_all_rows() -> bool:
    """Slaat alle rijen op en vervangt de opslag."""
    validated_rows: list[dict[str, float | int | str]] = []
    all_errors: list[str] = []

    for row in st.session_state.get("tarieven_heffingen_rows", []):
        errors, valid_row = _validate_row(_get_row_from_inputs(row["id"]))
        all_errors.extend(errors)
        if valid_row is not None:
            validated_rows.append(valid_row)

    if all_errors:
        for error in all_errors:
            st.error(error)
        return False

    if not save_tarieven_heffingen(validated_rows):
        st.error("Opslaan is niet gelukt. Probeer het opnieuw.")
        return False

    st.session_state["tarieven_heffingen_loaded"] = False
    return True


def _delete_row(row_id: str) -> None:
    """Verwijdert één rij uit opslag of sessie."""
    row = next(
        (item for item in st.session_state.get("tarieven_heffingen_rows", []) if item["id"] == row_id),
        None,
    )
    if row and row.get("_is_new"):
        rows = [
            item
            for item in st.session_state.get("tarieven_heffingen_rows", [])
            if item["id"] != row_id
        ]
        st.session_state["tarieven_heffingen_rows"] = rows
        st.session_state["tarieven_heffingen_confirm_delete_row_id"] = None
        _set_feedback("Regel verwijderd.")
        return

    if delete_tarieven_heffingen_row(row_id):
        st.session_state["tarieven_heffingen_loaded"] = False
        _set_feedback("Regel verwijderd.")
    else:
        st.error("Verwijderen is niet gelukt. Probeer het opnieuw.")


def _render_table_header() -> None:
    """Toont de kopregel van de tabel."""
    headers = ["Jaar", "Tarief hoog", "Tarief laag", "Verbruikersbelasting", "", "", ""]
    render_table_headers(headers, [1.0, 1.2, 1.2, 1.4, 0.42, 0.42, 0.42])


def _render_rows() -> None:
    """Toont alle rijen in de tabelstructuur."""
    rows = st.session_state.get("tarieven_heffingen_rows", [])
    confirm_row_id = st.session_state.get("tarieven_heffingen_confirm_delete_row_id")

    if not rows:
        st.info("Nog geen tarieven en heffingen toegevoegd.")
        return

    _render_table_header()

    for row in rows:
        row_id = row["id"]
        is_editing = bool(row.get("_is_editing"))
        row_cols = st.columns([1.0, 1.2, 1.2, 1.4, 0.42, 0.42, 0.42])

        with row_cols[0]:
            st.number_input(
                "Jaar",
                min_value=0,
                step=1,
                value=int(row.get("jaar", 0) or 0),
                key=f"th_jaar_{row_id}",
                label_visibility="collapsed",
                disabled=not is_editing,
            )
        with row_cols[1]:
            st.number_input(
                "Tarief hoog",
                min_value=0.0,
                step=0.01,
                format="%.2f",
                value=float(row.get("tarief_hoog", 0.0) or 0.0),
                key=f"th_hoog_{row_id}",
                label_visibility="collapsed",
                disabled=not is_editing,
            )
        with row_cols[2]:
            st.number_input(
                "Tarief laag",
                min_value=0.0,
                step=0.01,
                format="%.2f",
                value=float(row.get("tarief_laag", 0.0) or 0.0),
                key=f"th_laag_{row_id}",
                label_visibility="collapsed",
                disabled=not is_editing,
            )
        with row_cols[3]:
            st.number_input(
                "Verbruikersbelasting",
                min_value=0.0,
                step=0.01,
                format="%.2f",
                value=float(row.get("verbruikersbelasting", 0.0) or 0.0),
                key=f"th_verbruikersbelasting_{row_id}",
                label_visibility="collapsed",
                disabled=not is_editing,
            )
        with row_cols[4]:
            if render_edit_button(
                key=f"th_edit_{row_id}",
                disabled=is_editing,
            ):
                _set_row_edit_mode(row_id)
                st.session_state["tarieven_heffingen_confirm_delete_row_id"] = None
                st.rerun()
        with row_cols[5]:
            if render_save_button(
                key=f"th_save_{row_id}",
                disabled=not is_editing,
            ):
                _save_row(row_id)
                st.rerun()
        with row_cols[6]:
            if render_delete_button(key=f"th_delete_{row_id}"):
                st.session_state["tarieven_heffingen_confirm_delete_row_id"] = row_id
                st.rerun()

        if confirm_row_id == row_id:
            jaar = st.session_state.get(f"th_jaar_{row_id}", row.get("jaar", 0))
            st.warning(f"Weet je zeker dat je de regel voor jaar {jaar} wilt verwijderen?")
            confirm_col, cancel_col, _ = st.columns([1, 1, 4])
            with confirm_col:
                if st.button("Ja, verwijderen", key=f"th_confirm_delete_{row_id}"):
                    _delete_row(row_id)
                    st.rerun()
            with cancel_col:
                if st.button("Annuleren", key=f"th_cancel_delete_{row_id}"):
                    st.session_state["tarieven_heffingen_confirm_delete_row_id"] = None
                    st.rerun()


def show_tarieven_heffingen_page(
    on_back: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    """Toont de pagina Tarieven en heffingen."""
    del on_logout

    ensure_tarieven_heffingen_storage()
    _ensure_loaded()

    st.markdown("<div class='main-card'>", unsafe_allow_html=True)
    render_breadcrumb(current_label="Tarieven en heffingen", on_home_click=on_back)
    render_page_header(
        "Tarieven en heffingen",
        "Beheer hier de jaargebonden accijnstarieven en verbruikersbelasting.",
    )
    _render_feedback()

    st.markdown(
        "<div class='section-text'>Deze waarden kunnen later gebruikt worden in Nieuwe kostprijsberekening om accijnzen per liter op basis van jaar te bepalen.</div>",
        unsafe_allow_html=True,
    )

    _render_rows()

    add_col, spacer_col = st.columns([1, 4])
    with add_col:
        if st.button("Regel toevoegen", key="th_add_row"):
            _add_empty_row()
            st.rerun()
    st.write("")
    back_col, save_close_col, _ = st.columns([1, 1.2, 2.8])
    with back_col:
        if st.button("Terug naar home", key="th_back_home"):
            _reset_page_state()
            on_back()
    with save_close_col:
        if st.button("Opslaan en sluiten", key="th_save_close"):
            if _save_all_rows():
                _reset_page_state()
                on_back()

    st.markdown("</div>", unsafe_allow_html=True)







