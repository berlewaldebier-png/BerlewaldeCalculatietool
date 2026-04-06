from __future__ import annotations

from pydantic import BaseModel


class NavigationItem(BaseModel):
    key: str
    label: str
    description: str
    href: str
    section: str


class ExpiringQuoteItem(BaseModel):
    id: str
    offertenummer: str
    klantnaam: str
    verloopt_op: str
    status: str


class DashboardSummary(BaseModel):
    concept_berekeningen: int
    definitieve_berekeningen: int
    concept_prijsvoorstellen: int
    definitieve_prijsvoorstellen: int
    klaar_om_te_activeren: int = 0
    klaar_om_te_activeren_waarschuwing: int = 0
    aflopende_offertes: int = 0
    aflopende_offertes_items: list[ExpiringQuoteItem] = []
