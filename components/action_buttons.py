from __future__ import annotations

import streamlit as st


ICON_ONLY_LABEL = ""
ADD_ICON = ":material/add:"
EDIT_ICON = ":material/edit:"
SAVE_ICON = ":material/save:"
DELETE_ICON = ":material/delete:"


def render_add_button(
    key: str,
    *,
    use_container_width: bool = False,
    disabled: bool = False,
) -> bool:
    """Toont een compacte toevoegknop met tooltip."""
    return st.button(
        ICON_ONLY_LABEL,
        key=key,
        help="Toevoegen",
        icon=ADD_ICON,
        use_container_width=use_container_width,
        disabled=disabled,
    )


def render_edit_button(
    key: str,
    *,
    use_container_width: bool = False,
    disabled: bool = False,
) -> bool:
    """Toont een compacte bewerkknop met tooltip."""
    return st.button(
        ICON_ONLY_LABEL,
        key=key,
        help="Bewerken",
        icon=EDIT_ICON,
        use_container_width=use_container_width,
        disabled=disabled,
    )


def render_delete_button(
    key: str,
    *,
    use_container_width: bool = False,
    disabled: bool = False,
) -> bool:
    """Toont een compacte verwijderknop met tooltip."""
    return st.button(
        ICON_ONLY_LABEL,
        key=key,
        help="Verwijderen",
        icon=DELETE_ICON,
        use_container_width=use_container_width,
        disabled=disabled,
    )


def render_save_button(
    key: str,
    *,
    use_container_width: bool = False,
    disabled: bool = False,
) -> bool:
    """Toont een compacte opslaanknop met tooltip."""
    return st.button(
        ICON_ONLY_LABEL,
        key=key,
        help="Opslaan",
        icon=SAVE_ICON,
        use_container_width=use_container_width,
        disabled=disabled,
    )


def render_delete_submit_button(
    key: str,
    *,
    use_container_width: bool = False,
    disabled: bool = False,
) -> bool:
    """Toont een compacte submitknop voor verwijderen binnen formulieren."""
    return st.form_submit_button(
        ICON_ONLY_LABEL,
        help="Verwijderen",
        icon=DELETE_ICON,
        use_container_width=use_container_width,
        disabled=disabled,
    )
