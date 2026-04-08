from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, HTTPException

from app.domain import dataset_store
from app.domain import dashboard_service
from app.domain import auth_service
from app.domain import postgres_storage
from app.domain import kostprijs_activation_storage
from app.domain.auth_dependencies import require_admin, require_user
from app.schemas.new_year import PrepareNewYearRequest, UpsertNewYearDraftRequest, CommitNewYearRequest
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
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Rewrites stored product ids so the entire app references master Product ids only."""
    try:
        return dataset_store.migrate_product_ids(dry_run=dry_run)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/migrate-wrapped-payloads")
def post_migrate_wrapped_payloads(
    datasets: str = Query("", description="Comma-separated dataset names (optional)"),
    dry_run: bool = Query(False, description="Wanneer true: alleen rapporteren, niets opslaan."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Unwraps legacy `{Count,value}` payloads stored in Postgres datasets (one-time maintenance)."""
    names = [name.strip() for name in (datasets or "").split(",") if name.strip()]
    return dataset_store.migrate_wrapped_payloads(dataset_names=names or None, dry_run=dry_run)


@router.post("/generate-missing-activations")
def post_generate_missing_activations(
    dry_run: bool = Query(False, description="Wanneer true: alleen rapporteren, niets opslaan."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """One-time maintenance: create missing product activations from definitive cost versions.

    Phase E: activations are the single source of truth for what is "active" per (bier, jaar, product).
    This endpoint is the explicit repair/migration path for legacy/older data that predates
    activation records (or where invalid records were cleaned up).
    """
    try:
        return dataset_store.generate_missing_activations(dry_run=dry_run)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/prepare-new-year")
def post_prepare_new_year(
    payload: PrepareNewYearRequest,
    dry_run: bool = Query(False, description="Wanneer true: alleen rapporteren, niets opslaan."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Prepare a new year set in one transaction (Phase F)."""
    try:
        return dataset_store.prepare_new_year(
            source_year=int(payload.source_year),
            target_year=int(payload.target_year),
            copy_productie=bool(payload.copy_productie),
            copy_vaste_kosten=bool(payload.copy_vaste_kosten),
            copy_tarieven=bool(payload.copy_tarieven),
            copy_verpakkingsonderdelen=bool(payload.copy_verpakkingsonderdelen),
            copy_verkoopstrategie=bool(payload.copy_verkoopstrategie),
            copy_berekeningen=bool(payload.copy_berekeningen),
            overwrite_existing=bool(payload.overwrite_existing),
            include_datasets=bool(payload.include_datasets),
            dry_run=bool(dry_run),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/dev/reset")
def post_dev_reset(
    mode: str = Query("all", description="Reset mode: all | year_setup"),
    seed: bool = Query(False, description="Wanneer true: laad seed data uit /data na reset."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Local-only dev helper: clear all stored data (rows only) and optionally seed demo data.

    Important: never drops tables; only truncates/overwrites contents.
    Disabled in test/prod environments.
    """
    if auth_service.environment_name() not in {"local", "dev", "development"}:
        raise HTTPException(status_code=403, detail="Dev reset is alleen toegestaan in local/dev.")

    normalized_mode = str(mode or "all").strip().lower()
    if normalized_mode not in {"all", "year_setup"}:
        raise HTTPException(status_code=400, detail="Ongeldige mode. Gebruik all of year_setup.")
    if normalized_mode != "all" and seed:
        raise HTTPException(status_code=400, detail="Seed is alleen toegestaan bij mode=all.")

    report: dict[str, Any] = {"reset": {}, "seed": {}}
    with postgres_storage.transaction():
        # Clear normalized tables first (keeps schema intact).
        if normalized_mode == "all":
            kostprijs_activation_storage.reset_defaults()
            report["reset"] = dataset_store.reset_all_datasets_to_defaults()
        else:
            # Keep cost management data; only reset year setup datasets/tables.
            report["reset"] = dataset_store.reset_year_setup_keep_cost_data()

        if seed and normalized_mode == "all":
            report["seed"] = dataset_store.bootstrap_postgres_from_json(overwrite=True)
            # Keep the seeded data aligned with current invariants.
            dataset_store.migrate_wrapped_payloads(dry_run=False)
            dataset_store.migrate_product_ids(dry_run=False)
            dataset_store.generate_missing_activations(dry_run=False)

    dashboard_service.invalidate_dashboard_summary_cache()
    return report


@router.get("/new-year-draft")
def get_new_year_draft(
    target_year: int = Query(..., description="Doeljaar waarvoor de draft opgehaald moet worden."),
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    draft = dataset_store.load_new_year_draft(owner=str(session.get("username", "") or ""), target_year=int(target_year))
    return {"draft": draft}


@router.put("/new-year-draft")
def put_new_year_draft(
    payload: UpsertNewYearDraftRequest,
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    record = dataset_store.upsert_new_year_draft(
        owner=str(session.get("username", "") or ""),
        source_year=int(payload.source_year),
        target_year=int(payload.target_year),
        payload=payload.payload.model_dump(),
    )
    return {"draft": record}


@router.delete("/new-year-draft")
def delete_new_year_draft(
    target_year: int = Query(..., description="Doeljaar waarvoor de draft verwijderd moet worden."),
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    return dataset_store.delete_new_year_draft(owner=str(session.get("username", "") or ""), target_year=int(target_year))


@router.post("/commit-new-year")
def post_commit_new_year(
    payload: CommitNewYearRequest,
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return dataset_store.commit_new_year(
            source_year=int(payload.source_year),
            target_year=int(payload.target_year),
            owner=str(session.get("username", "") or ""),
            copy_productie=bool(payload.copy_productie),
            copy_vaste_kosten=bool(payload.copy_vaste_kosten),
            copy_tarieven=bool(payload.copy_tarieven),
            copy_verpakkingsonderdelen=bool(payload.copy_verpakkingsonderdelen),
            copy_verkoopstrategie=bool(payload.copy_verkoopstrategie),
            copy_berekeningen=bool(payload.copy_berekeningen),
            overwrite_existing=bool(payload.overwrite_existing),
            force=bool(payload.force),
            payload=payload.payload.model_dump(),
        )
    except ValueError as exc:
        message = str(exc)
        # Concurrency check failures should be explicit conflicts for the frontend.
        if "Bronjaar is gewijzigd sinds je concept is gestart" in message:
            raise HTTPException(status_code=409, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc


@router.post("/rollback-year")
def post_rollback_year(
    year: int = Query(..., description="Jaar dat volledig verwijderd moet worden."),
    dry_run: bool = Query(False, description="Wanneer true: alleen rapporteren, niets opslaan."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Delete all data for a given year (admin-only)."""
    try:
        return dataset_store.rollback_year(year=int(year), dry_run=bool(dry_run))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
