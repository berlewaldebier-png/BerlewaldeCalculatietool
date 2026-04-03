from __future__ import annotations

from fastapi import APIRouter

from app.domain import dataset_store
from app.schemas.navigation import (
    DashboardSummary,
    KostprijsBeheerBootstrap,
    NavigationItem,
    PrijsvoorstelBootstrap,
    VerkoopstrategieBootstrap,
)


router = APIRouter(prefix="/meta", tags=["meta"])


def _navigation_items() -> list[NavigationItem]:
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


@router.get("/navigation", response_model=list[NavigationItem])
def get_navigation() -> list[NavigationItem]:
    return _navigation_items()


@router.get("/dashboard-summary", response_model=DashboardSummary)
def get_dashboard_summary() -> DashboardSummary:
    # Met alleen Postgres: gebruik dataset_store statistics (kostprijsversies/prijsvoorstellen)
    berekeningen = dataset_store.load_dataset("kostprijsversies")
    prijsvoorstellen = dataset_store.load_dataset("prijsvoorstellen")
    concept_berekeningen = sum(1 for r in berekeningen if str(r.get("status", "")) == "concept")
    definitieve_berekeningen = sum(1 for r in berekeningen if str(r.get("status", "")) == "definitief")
    concept_prijsvoorstellen = sum(1 for r in prijsvoorstellen if str(r.get("status", "")) == "concept")
    definitieve_prijsvoorstellen = sum(1 for r in prijsvoorstellen if str(r.get("status", "")) == "definitief")
    return DashboardSummary(
        concept_berekeningen=concept_berekeningen,
        definitieve_berekeningen=definitieve_berekeningen,
        concept_prijsvoorstellen=concept_prijsvoorstellen,
        definitieve_prijsvoorstellen=definitieve_prijsvoorstellen,
    )


@router.get("/kostprijs-beheer-bootstrap", response_model=KostprijsBeheerBootstrap)
def get_kostprijs_beheer_bootstrap() -> KostprijsBeheerBootstrap:
    payload = {
        "berekeningen": dataset_store.load_dataset("kostprijsversies"),
        "basisproducten": dataset_store.load_dataset("basisproducten"),
        "samengestelde_producten": dataset_store.load_dataset("samengestelde-producten"),
        "productie": dataset_store.load_dataset("productie"),
        "vaste_kosten": dataset_store.load_dataset("vaste-kosten"),
        "tarieven_heffingen": dataset_store.load_dataset("tarieven-heffingen"),
    }
    return KostprijsBeheerBootstrap(
        navigation=_navigation_items(),
        berekeningen=payload["berekeningen"],
        basisproducten=payload["basisproducten"],
        samengestelde_producten=payload["samengestelde_producten"],
        productie=payload["productie"],
        vaste_kosten=payload["vaste_kosten"],
        tarieven_heffingen=payload["tarieven_heffingen"],
    )


@router.get("/verkoopstrategie-bootstrap", response_model=VerkoopstrategieBootstrap)
def get_verkoopstrategie_bootstrap() -> VerkoopstrategieBootstrap:
    payload = {
        "verkoopprijzen": dataset_store.load_dataset("verkoopprijzen"),
        "basisproducten": dataset_store.load_dataset("basisproducten"),
        "samengestelde_producten": dataset_store.load_dataset("samengestelde-producten"),
        "bieren": dataset_store.load_dataset("bieren"),
        "berekeningen": dataset_store.load_dataset("kostprijsversies"),
        "channels": dataset_store.load_dataset("channels"),
        "kostprijsproductactiveringen": dataset_store.load_dataset("kostprijsproductactiveringen"),
    }
    return VerkoopstrategieBootstrap(
        navigation=_navigation_items(),
        verkoopprijzen=payload["verkoopprijzen"],
        basisproducten=payload["basisproducten"],
        samengestelde_producten=payload["samengestelde_producten"],
        bieren=payload["bieren"],
        berekeningen=payload["berekeningen"],
        channels=payload["channels"],
        kostprijsproductactiveringen=payload["kostprijsproductactiveringen"],
    )


@router.get("/prijsvoorstel-bootstrap", response_model=PrijsvoorstelBootstrap)
def get_prijsvoorstel_bootstrap() -> PrijsvoorstelBootstrap:
    payload = {
        "prijsvoorstellen": dataset_store.load_dataset("prijsvoorstellen"),
        "productie": dataset_store.load_dataset("productie"),
        "bieren": dataset_store.load_dataset("bieren"),
        "berekeningen": dataset_store.load_dataset("kostprijsversies"),
        "verkoopprijzen": dataset_store.load_dataset("verkoopprijzen"),
        "channels": dataset_store.load_dataset("channels"),
        "kostprijsproductactiveringen": dataset_store.load_dataset("kostprijsproductactiveringen"),
        "basisproducten": dataset_store.load_dataset("basisproducten"),
        "samengestelde_producten": dataset_store.load_dataset("samengestelde-producten"),
    }
    return PrijsvoorstelBootstrap(
        navigation=_navigation_items(),
        prijsvoorstellen=payload["prijsvoorstellen"],
        productie=payload["productie"],
        bieren=payload["bieren"],
        berekeningen=payload["berekeningen"],
        verkoopprijzen=payload["verkoopprijzen"],
        channels=payload["channels"],
        kostprijsproductactiveringen=payload["kostprijsproductactiveringen"],
        basisproducten=payload["basisproducten"],
        samengestelde_producten=payload["samengestelde_producten"],
    )
