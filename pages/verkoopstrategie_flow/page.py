from __future__ import annotations

from typing import Callable

from components.breadcrumb import render_breadcrumb
from components.page_ui import close_main_card, open_main_card
from .overview import render_verkoopstrategie_overview
from .state import _init_page_state, _render_feedback
from utils.storage import ensure_verkoopprijzen_storage


def show_verkoopstrategie_page(
    on_back: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    del on_logout
    ensure_verkoopprijzen_storage()
    _init_page_state()
    open_main_card()
    render_breadcrumb(current_label="Verkoopstrategie", on_home_click=on_back)
    _render_feedback()
    render_verkoopstrategie_overview(on_back)
    close_main_card()


def show_verkoopprijzen_page(
    on_back: Callable[[], None],
    on_logout: Callable[[], None],
) -> None:
    show_verkoopstrategie_page(on_back=on_back, on_logout=on_logout)
