from __future__ import annotations

from typing import Callable

from .state import render_verkoopstrategie_content


def render_verkoopstrategie_overview(on_back: Callable[[], None]) -> None:
    render_verkoopstrategie_content(on_back)
