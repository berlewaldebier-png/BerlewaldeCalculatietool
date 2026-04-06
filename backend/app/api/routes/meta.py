from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, HTTPException

from app.domain import dataset_store
from app.domain import dashboard_service
from app.domain import auth_service
from app.domain.auth_dependencies import require_user
from app.schemas.navigation import DashboardSummary, NavigationItem


router = APIRouter(prefix="/meta", tags=["meta"], dependencies=[Depends(require_user)])


@router.get("/navigation", response_model=list[NavigationItem])
def get_navigation() -> list[NavigationItem]:
    return [
        NavigationItem(
            key="productie",
            label="Productie",
            description="Beheer productiegegevens per jaartal.",
            href="/productie",
            section="Stamdata",
        ),
        NavigationItem(
            key="vaste-kosten",
            label="Vaste kosten",
            description="Beheer vaste kosten per jaar.",
            href="/vaste-kosten",
            section="Stamdata",
        ),
        NavigationItem(
            key="tarieven-heffingen",
            label="Tarieven & heffingen",
            description="Accijns en belastingtarieven per jaar.",
            href="/tarieven-heffingen",
            section="Stamdata",
        ),
        NavigationItem(
            key="producten-verpakking",
            label="Producten & verpakking",
            description="Basisproducten, verpakkingsonderdelen en samenstellingen.",
            href="/producten-verpakking",
            section="Stamdata",
        ),
        NavigationItem(
            key="bieren",
            label="Bieren",
            description="Beheer bierstamdata, stijl, alcohol en belastinginstellingen.",
            href="/bieren",
            section="Stamdata",
        ),
        NavigationItem(
            key="nieuwe-kostprijsberekening",
            label="Kostprijs beheren",
            description="Start nieuwe berekeningen of werk bestaande dossiers bij.",
            href="/nieuwe-kostprijsberekening",
            section="Calculatie",
        ),
        NavigationItem(
            key="recept-hercalculatie",
            label="Recept hercalculeren",
            description="Start een hercalculatie voor eigen productie.",
            href="/recept-hercalculatie",
            section="Calculatie",
        ),
        NavigationItem(
            key="inkoopfacturen",
            label="Inkoopfacturen",
            description="Beheer gekoppelde facturen voor inkoopbieren.",
            href="/inkoopfacturen",
            section="Calculatie",
        ),
        NavigationItem(
            key="verkoopstrategie",
            label="Verkoopstrategie",
            description="Beheer marges en prijsstrategie per kanaal en verpakking.",
            href="/verkoopstrategie",
            section="Verkoop",
        ),
        NavigationItem(
            key="prijsvoorstel",
            label="Prijsvoorstel maken",
            description="Maak prijsvoorstellen op basis van liters of producten.",
            href="/prijsvoorstel",
            section="Verkoop",
        ),
        NavigationItem(
            key="nieuw-jaar-voorbereiden",
            label="Nieuw jaar voorbereiden",
            description="Kopieer stamdata en berekeningen naar een nieuw jaar.",
            href="/nieuw-jaar-voorbereiden",
            section="Beheer",
        ),
        NavigationItem(
            key="beheer",
            label="Beheer",
            description="Users, handleiding en deployment-informatie.",
            href="/beheer",
            section="Beheer",
        ),
    ]


@router.get("/dashboard-summary", response_model=DashboardSummary)
def get_dashboard_summary() -> DashboardSummary:
    summary = dashboard_service.get_dashboard_summary()
    return DashboardSummary(
        concept_berekeningen=summary.concept_berekeningen,
        definitieve_berekeningen=summary.definitieve_berekeningen,
        concept_prijsvoorstellen=summary.concept_prijsvoorstellen,
        definitieve_prijsvoorstellen=summary.definitieve_prijsvoorstellen,
        klaar_om_te_activeren=summary.klaar_om_te_activeren,
        klaar_om_te_activeren_waarschuwing=summary.klaar_om_te_activeren_waarschuwing,
        aflopende_offertes=summary.aflopende_offertes,
        aflopende_offertes_items=summary.aflopende_offertes_items,
    )


@router.get("/bootstrap")
def get_bootstrap(
    datasets: str = Query("", description="Comma-separated dataset names"),
    navigation: bool = Query(True, description="Include navigation items"),
    session: dict = Depends(require_user),
) -> dict[str, Any]:
    names = [name.strip() for name in (datasets or "").split(",") if name.strip()]
    payload: dict[str, Any] = {"datasets": {}}

    if navigation:
        payload["navigation"] = get_navigation()

    for name in names:
        if name == "dashboard-summary":
            summary = dashboard_service.get_dashboard_summary()
            payload["datasets"][name] = {
                "concept_berekeningen": summary.concept_berekeningen,
                "definitieve_berekeningen": summary.definitieve_berekeningen,
                "concept_prijsvoorstellen": summary.concept_prijsvoorstellen,
                "definitieve_prijsvoorstellen": summary.definitieve_prijsvoorstellen,
                "klaar_om_te_activeren": summary.klaar_om_te_activeren,
                "klaar_om_te_activeren_waarschuwing": summary.klaar_om_te_activeren_waarschuwing,
                "aflopende_offertes": summary.aflopende_offertes,
                "aflopende_offertes_items": summary.aflopende_offertes_items,
            }
            continue
        if name == "auth-status":
            payload["datasets"][name] = auth_service.auth_status()
            continue
        if name == "auth-users":
            if str(session.get("role", "") or "") != "admin":
                raise HTTPException(status_code=403, detail="Geen rechten.")
            payload["datasets"][name] = auth_service.list_users()
            continue
        if name not in dataset_store.get_dataset_names():
            payload["datasets"][name] = None
            continue
        payload["datasets"][name] = dataset_store.load_dataset(name)

    return payload


@router.post("/migrate-product-ids")
def post_migrate_product_ids(
    dry_run: bool = Query(False, description="Wanneer true: alleen rapporteren, niets opslaan."),
) -> dict[str, Any]:
    """Rewrites stored product ids so the entire app references master Product ids only."""
    return dataset_store.migrate_product_ids(dry_run=dry_run)
