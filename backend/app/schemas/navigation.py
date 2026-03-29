from __future__ import annotations

from pydantic import BaseModel


class NavigationItem(BaseModel):
    key: str
    label: str
    description: str
    href: str
    section: str


class DashboardSummary(BaseModel):
    concept_berekeningen: int
    definitieve_berekeningen: int
    concept_prijsvoorstellen: int
    definitieve_prijsvoorstellen: int
