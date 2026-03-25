from __future__ import annotations

from typing import Callable

from components.breadcrumb import render_breadcrumb
from components.page_ui import close_main_card, open_main_card, render_page_header

from .state import init_page_state, render_feedback
from .wizard import render_wizard


def show_nieuw_jaar_voorbereiden_page(
    on_back: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    del on_logout
    init_page_state()

    open_main_card()
    render_breadcrumb(current_label="Nieuw jaar voorbereiden", on_home_click=on_back)
    render_page_header(
        "Nieuw jaar voorbereiden",
        "Bereid hier een complete jaarset voor op basis van een bestaand bronjaar.",
    )
    render_feedback()
    render_wizard(on_back)
    close_main_card()
