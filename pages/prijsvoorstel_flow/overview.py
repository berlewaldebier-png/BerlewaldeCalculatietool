from __future__ import annotations

from typing import Callable

from .state import _render_overview


def render_prijsvoorstel_overview(on_back: Callable[[], None]) -> None:
    _render_overview(on_back)

