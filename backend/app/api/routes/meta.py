from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, HTTPException

from app.domain import dataset_store
from app.domain import dashboard_service
from app.domain import auth_service
from app.domain import postgres_storage
from app.domain import kostprijs_activation_storage
from app.domain import seed_bundle_service
from app.domain.auth_dependencies import require_admin, require_user
from app.schemas.new_year import PrepareNewYearRequest, UpsertNewYearDraftRequest, CommitNewYearRequest
from app.schemas.kostprijs_activation import (
    ActivateKostprijzenRequest,
    KostprijsActivatiePlanResponse,
    UpsertKostprijsActivatieDraftRequest,
)
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
            key="adviesprijzen",
            label="Adviesprijzen",
            description="Beheer adviesopslag per kanaal (sell-out).",
            href="/adviesprijzen",
            section="Verkoop",
        ),
        NavigationItem(
            key="break-even",
            label="Break-even analyseren",
            description="Maak break-even scenario's voor productmix, prijs en vaste kosten.",
            href="/break-even",
            section="Verkoop",
        ),
        NavigationItem(
            key="omzet-en-marge",
            label="Omzet & marge",
            description="Omzet, kostprijs en brutomarge per klant (Douano).",
            href="/omzet-en-marge",
            section="Verkoop",
        ),
        NavigationItem(
            key="prijsvoorstel",
            label="Prijsvoorstel maken",
            description="Maak prijsvoorstellen op basis van liters of producten.",
            href="/prijsvoorstellen",
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
        NavigationItem(
            key="productkoppeling",
            label="Productkoppeling",
            description="Koppel Douano producten aan actieve kostprijscombinaties.",
            href="/beheer/productkoppeling",
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
        try:
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
        except HTTPException:
            raise
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"bootstrap dataset '{name}': {exc}") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"bootstrap dataset '{name}' faalde: {exc}") from exc

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
    return dataset_store.generate_missing_activations(dry_run=dry_run)


@router.get("/kostprijs-activatie-plan", response_model=KostprijsActivatiePlanResponse)
def get_kostprijs_activatie_plan(
    source_year: int,
    target_year: int,
    user: dict[str, Any] = Depends(require_user),
) -> KostprijsActivatiePlanResponse:
    try:
        return dataset_store.get_kostprijs_activatie_plan(
            owner=str(user.get("username", "") or ""),
            source_year=int(source_year),
            target_year=int(target_year),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/kostprijs-activatie-draft")
def put_kostprijs_activatie_draft(
    payload: UpsertKostprijsActivatieDraftRequest,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    return {
        "draft": dataset_store.upsert_kostprijs_activatie_draft(
            owner=str(user.get("username", "") or ""),
            source_year=int(payload.source_year),
            target_year=int(payload.target_year),
            payload=payload.payload,
        )
    }


@router.delete("/kostprijs-activatie-draft")
def delete_kostprijs_activatie_draft(
    target_year: int,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    return dataset_store.delete_kostprijs_activatie_draft(
        owner=str(user.get("username", "") or ""),
        target_year=int(target_year),
    )


@router.post("/activate-kostprijzen")
def post_activate_kostprijzen(
    payload: ActivateKostprijzenRequest,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    # Admin-only: this writes new definitive kostprijsversies + activations for the target year.
    try:
        return dataset_store.activate_kostprijzen_for_year(
            owner=str(user.get("username", "") or ""),
            source_year=int(payload.source_year),
            target_year=int(payload.target_year),
            selections=[{"bier_id": s.bier_id, "product_id": s.product_id} for s in payload.selections],
            dry_run=bool(payload.dry_run),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/validate-phase-g-constraints")
def post_validate_phase_g_constraints(
    validate_all: bool = Query(False, description="Wanneer true: valideer ook al-validated constraints opnieuw."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Validate NOT VALID FK constraints introduced during Phase G."""
    return dataset_store.validate_phase_g_constraints(validate_all=bool(validate_all))


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
    seed_profile: str = Query("", description="Seed profiel: demo_foundation | demo_full"),
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

    normalized_profile = str(seed_profile or "").strip().lower()
    if normalized_profile and normalized_profile not in {"demo_foundation", "demo_full"}:
        raise HTTPException(status_code=400, detail="Ongeldig seed profiel. Gebruik demo_foundation of demo_full.")
    if normalized_mode != "all" and normalized_profile:
        raise HTTPException(status_code=400, detail="Seed is alleen toegestaan bij mode=all.")

    report: dict[str, Any] = {"reset": {}, "seed": {}}
    with postgres_storage.transaction():
        # Clear normalized tables first (keeps schema intact).
        if normalized_mode == "all":
            kostprijs_activation_storage.reset_defaults()
            if normalized_profile:
                # Import does its own reset + maintenance inside this transaction.
                try:
                    report["seed"] = seed_bundle_service.import_seed_bundle(normalized_profile)  # type: ignore[arg-type]
                except FileNotFoundError as exc:
                    raise HTTPException(status_code=400, detail=f"Seed bestand ontbreekt voor {normalized_profile}.") from exc
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=str(exc)) from exc
                report["reset"] = report["seed"].get("reset", {}) if isinstance(report["seed"], dict) else {}
                dashboard_service.invalidate_dashboard_summary_cache()
                return report
            report["reset"] = dataset_store.reset_all_datasets_to_defaults()
        else:
            # Keep cost management data; only reset year setup datasets/tables.
            report["reset"] = dataset_store.reset_year_setup_keep_cost_data()

    dashboard_service.invalidate_dashboard_summary_cache()
    return report


@router.post("/dev/hard-reset")
def post_dev_hard_reset(
    include_users: bool = Query(False, description="Wanneer true: reset ook app_users (kan je buitensluiten)."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Local-only dev helper: drop all domain tables and start from a clean schema.

    This is intentionally destructive and intended for development only.

    Notes:
    - Drops tables (not just rows), including Douano sync tables.
    - Keeps auth by default (`app_users`) unless `include_users=true`.
    - After this, the backend should be restarted so in-memory `_SCHEMA_READY` flags don't lie.
    """
    if auth_service.environment_name() not in {"local", "dev", "development"}:
        raise HTTPException(status_code=403, detail="Hard reset is alleen toegestaan in local/dev.")

    # Explicit allow-list: only tables we own (avoids nuking extensions/etc).
    tables = [
        # Generic dataset store
        "app_datasets",
        # SKU core
        "articles",
        "skus",
        "bom_lines",
        # Core year setup
        "production_years",
        "fixed_cost_lines",
        "tarieven_heffingen_years",
        # Costing
        "cost_version_sku_rows",
        "cost_version_product_rows",
        "cost_versions",
        "kostprijs_sku_activations",
        "kostprijs_sku_activation_events",
        "kostprijs_product_activations",
        "kostprijs_activation_events",
        "kostprijs_scenario_inkoop_rows",
        "kostprijs_activatie_drafts",
        "new_year_drafts",
        # Sales/pricing
        "sales_pricing_records",
        "advice_channel_pricing",
        # Offers/quotes
        "quote_drafts",
        # Catalog/bundles
        "catalog_product_bom_lines",
        "catalog_products",
        # Douano sync + analytics
        "douano_sales_line_cost_snapshot",
        "douano_product_mapping",
        "douano_product_ignore",
        "douano_oauth_tokens",
        "douano_sales_invoice_lines",
        "douano_sales_invoices",
        "douano_sales_order_lines",
        "douano_sales_orders",
        "douano_products",
        "douano_companies",
        "douano_sync_state",
        "douano_raw_objects",
    ]
    if include_users:
        tables.append("app_users")

    dropped: list[str] = []
    with postgres_storage.transaction():
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                for table in tables:
                    name = str(table or "").strip()
                    if not name:
                        continue
                    cur.execute(f"DROP TABLE IF EXISTS {name} CASCADE")
                    dropped.append(name)

    # Best-effort: reset module-level schema flags (still recommend restart).
    try:
        from app.domain import (
            adviesprijzen_storage,
            catalog_products_storage,
            cost_versions_storage,
            douano_margin_snapshot_storage,
            douano_oauth_storage,
            douano_product_ignore_storage,
            douano_product_mapping_storage,
            douano_sync_storage,
            fixed_costs_storage,
            kostprijs_activatie_drafts_storage,
            kostprijs_activation_storage,
            kostprijs_scenario_inkoop_storage,
            new_year_drafts_storage,
            production_storage,
            product_registry_storage,
            quote_drafts_storage,
            sales_pricing_storage,
            tarieven_heffingen_storage,
        )

        for module in [
            adviesprijzen_storage,
            catalog_products_storage,
            cost_versions_storage,
            douano_margin_snapshot_storage,
            douano_oauth_storage,
            douano_product_ignore_storage,
            douano_product_mapping_storage,
            douano_sync_storage,
            fixed_costs_storage,
            kostprijs_activatie_drafts_storage,
            kostprijs_activation_storage,
            kostprijs_scenario_inkoop_storage,
            new_year_drafts_storage,
            production_storage,
            product_registry_storage,
            quote_drafts_storage,
            sales_pricing_storage,
            tarieven_heffingen_storage,
        ]:
            for flag_name in ["_SCHEMA_READY", "_schema_ready"]:
                if hasattr(module, flag_name):
                    try:
                        setattr(module, flag_name, False)
                    except Exception:
                        pass
    except Exception:
        pass

    dashboard_service.invalidate_dashboard_summary_cache()
    return {
        "ok": True,
        "dropped_tables": dropped,
        "include_users": bool(include_users),
        "restart_backend": True,
    }


@router.post("/dev/seed-sku-foundation")
def post_dev_seed_sku_foundation(
    year: int = Query(2025, description="Jaar voor seed (prijzen/jaarsetup)."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Seed a minimal foundation dataset for the SKU/Article model.

    Dev-only helper; safe to run on an empty DB after /dev/hard-reset.
    """
    if auth_service.environment_name() not in {"local", "dev", "development"}:
        raise HTTPException(status_code=403, detail="Seed is alleen toegestaan in local/dev.")

    year_value = int(year)
    if year_value <= 0:
        raise HTTPException(status_code=400, detail="Ongeldig jaar.")

    # Minimal packaging components as articles (inventory-ready building blocks).
    packaging_components = [
        {"id": "pkg-bottle-33cl", "code": "BOTTLE33", "name": "Fles 33cl", "kind": "packaging_component", "uom": "stuk", "content_liter": 0.0, "active": True},
        {"id": "pkg-cap", "code": "CAP", "name": "Dop", "kind": "packaging_component", "uom": "stuk", "content_liter": 0.0, "active": True},
        {"id": "pkg-label", "code": "LABEL", "name": "Label", "kind": "packaging_component", "uom": "stuk", "content_liter": 0.0, "active": True},
        {"id": "pkg-box-24", "code": "BOX24", "name": "Doos 24", "kind": "packaging_component", "uom": "stuk", "content_liter": 0.0, "active": True},
    ]

    # Formats (sellable/purchasable forms). These are the "ArticleFormat" layer.
    formats = [
        {"id": "fmt-bottle-33cl", "code": "FMT33", "name": "Fles 33cl", "kind": "format", "uom": "stuk", "content_liter": 0.33, "active": True},
        {"id": "fmt-box-24x33cl", "code": "FMT24X33", "name": "Doos 24×33cl", "kind": "format", "uom": "doos", "content_liter": 24 * 0.33, "active": True},
        {"id": "fmt-keg-20l", "code": "FMTKEG20", "name": "Fust 20L", "kind": "format", "uom": "fust", "content_liter": 20.0, "active": True},
    ]

    # BOM for formats (composition of packaging components and nested formats).
    bom_lines = [
        # Doos 24×33cl consists of 24 bottles + 24 caps + 24 labels + 1 box.
        {"id": "bom-24x33-bottle", "parent_article_id": "fmt-box-24x33cl", "component_article_id": "fmt-bottle-33cl", "quantity": 24, "uom": "stuk", "scrap_pct": 0},
        {"id": "bom-24x33-cap", "parent_article_id": "fmt-box-24x33cl", "component_article_id": "pkg-cap", "quantity": 24, "uom": "stuk", "scrap_pct": 0},
        {"id": "bom-24x33-label", "parent_article_id": "fmt-box-24x33cl", "component_article_id": "pkg-label", "quantity": 24, "uom": "stuk", "scrap_pct": 0},
        {"id": "bom-24x33-box", "parent_article_id": "fmt-box-24x33cl", "component_article_id": "pkg-box-24", "quantity": 1, "uom": "stuk", "scrap_pct": 0},
        # Fles 33cl packaging structure (cap+label+bottle). In reality bottle is the container too; we keep it explicit.
        {"id": "bom-33cl-bottle", "parent_article_id": "fmt-bottle-33cl", "component_article_id": "pkg-bottle-33cl", "quantity": 1, "uom": "stuk", "scrap_pct": 0},
        {"id": "bom-33cl-cap", "parent_article_id": "fmt-bottle-33cl", "component_article_id": "pkg-cap", "quantity": 1, "uom": "stuk", "scrap_pct": 0},
        {"id": "bom-33cl-label", "parent_article_id": "fmt-bottle-33cl", "component_article_id": "pkg-label", "quantity": 1, "uom": "stuk", "scrap_pct": 0},
    ]

    # Minimal beer identity (not a SKU; SKU is beer × format).
    beers = [
        {
            "id": "beer-blond",
            "biernaam": "Berlewalde Blond",
            "stijl": "Blond",
            "alcoholpercentage": 6.0,
            "belastingsoort": "Accijns",
            "tarief_accijns": "Hoog",
            "btw_tarief": "21%",
        }
    ]

    # SKUs (beer × format) + example non-beer SKU (hoodie) can be added later.
    skus = [
        {"id": "sku-blond-33cl", "beer_id": "beer-blond", "format_article_id": "fmt-bottle-33cl", "code": "BLOND-33", "name": "Berlewalde Blond - Fles 33cl", "active": True},
        {"id": "sku-blond-24x33", "beer_id": "beer-blond", "format_article_id": "fmt-box-24x33cl", "code": "BLOND-24X33", "name": "Berlewalde Blond - Doos 24×33cl", "active": True},
        {"id": "sku-blond-keg20", "beer_id": "beer-blond", "format_article_id": "fmt-keg-20l", "code": "BLOND-KEG20", "name": "Berlewalde Blond - Fust 20L", "active": True},
    ]

    # Minimal packaging component prices (per year) using the existing dataset name the UI expects.
    packaging_component_prices = [
        {"id": "price-bottle-33cl", "jaar": year_value, "verpakkingsonderdeel_id": "pkg-bottle-33cl", "prijs_per_stuk": 0.22},
        {"id": "price-cap", "jaar": year_value, "verpakkingsonderdeel_id": "pkg-cap", "prijs_per_stuk": 0.03},
        {"id": "price-label", "jaar": year_value, "verpakkingsonderdeel_id": "pkg-label", "prijs_per_stuk": 0.05},
        {"id": "price-box-24", "jaar": year_value, "verpakkingsonderdeel_id": "pkg-box-24", "prijs_per_stuk": 1.10},
    ]

    # Provide a basic production year so cost allocation screens have a year anchor.
    productie = {str(year_value): {"hoeveelheid_inkoop_l": 0, "hoeveelheid_productie_l": 0, "batchgrootte_eigen_productie_l": 0}}

    with postgres_storage.transaction():
        # SKU/Article core
        postgres_storage.save_dataset("articles", [*packaging_components, *formats], overwrite=True)
        postgres_storage.save_dataset("bom-lines", bom_lines, overwrite=True)
        postgres_storage.save_dataset("skus", skus, overwrite=True)

        # Legacy UI datasets (kept in sync for now)
        dataset_store.save_dataset(
            "packaging-components",
            [
                {"id": row["id"], "omschrijving": row["name"], "beschikbaar_voor_samengesteld": True}
                for row in packaging_components
            ],
        )
        dataset_store.save_dataset("packaging-component-prices", packaging_component_prices)
        dataset_store.save_dataset("bieren", beers)
        dataset_store.save_dataset("productie", productie)

    dashboard_service.invalidate_dashboard_summary_cache()
    return {
        "ok": True,
        "year": year_value,
        "seeded": {
            "articles": len(packaging_components) + len(formats),
            "bom_lines": len(bom_lines),
            "skus": len(skus),
            "bieren": len(beers),
            "packaging_component_prices": len(packaging_component_prices),
        },
    }


@router.get("/dev/seed/audit")
def get_dev_seed_audit(
    year: int = Query(2025, description="Verwacht jaar voor demo checks (default 2025)."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    if auth_service.environment_name() not in {"local", "dev", "development"}:
        raise HTTPException(status_code=403, detail="Dev seed audit is alleen toegestaan in local/dev.")
    return seed_bundle_service.audit_live_data(expected_year=int(year))


@router.post("/dev/seed/export")
def post_dev_seed_export(
    profile: str = Query(..., description="Seed profiel: demo_foundation | demo_full"),
    year: int = Query(2025, description="Bronjaar label voor export (default 2025)."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    if auth_service.environment_name() not in {"local", "dev", "development"}:
        raise HTTPException(status_code=403, detail="Dev seed export is alleen toegestaan in local/dev.")
    normalized_profile = str(profile or "").strip().lower()
    if normalized_profile not in {"demo_foundation", "demo_full"}:
        raise HTTPException(status_code=400, detail="Ongeldig profiel. Gebruik demo_foundation of demo_full.")
    try:
        return seed_bundle_service.export_seed_bundle(normalized_profile, source_year=int(year))  # type: ignore[arg-type]
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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


@router.get("/yearsets")
def get_yearsets(_: dict = Depends(require_admin)) -> dict[str, Any]:
    """Admin overview: drafts + definitive production years."""
    drafts = dataset_store.list_new_year_drafts()
    years = dataset_store.load_dataset("productie")
    production_years: list[int] = []
    if isinstance(years, dict):
        for key in years.keys():
            try:
                production_years.append(int(key))
            except (TypeError, ValueError):
                continue
    production_years = sorted(set(production_years))
    last_year = max(production_years) if production_years else 0
    return {"drafts": drafts, "production_years": production_years, "last_year": last_year}


@router.delete("/new-year-drafts-for-year")
def delete_new_year_drafts_for_year(
    target_year: int = Query(..., description="Doeljaar waarvan alle concepten verwijderd moeten worden."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    return dataset_store.delete_new_year_drafts_for_target_year(target_year=int(target_year))


@router.post("/rollback-yearset")
def post_rollback_yearset(
    year: int = Query(..., description="Jaar dat teruggedraaid moet worden (alleen laatste productiejaar)."),
    dry_run: bool = Query(False, description="Wanneer true: alleen rapporteren, niets opslaan."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Rollback a committed yearset (latest production year) including cost versions/activations for that year."""
    try:
        return dataset_store.rollback_yearset(year=int(year), dry_run=bool(dry_run))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
