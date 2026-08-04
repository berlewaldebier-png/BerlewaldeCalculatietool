from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
import logging
from typing import Any

from fastapi import APIRouter, Depends, Query, HTTPException

from app.domain import dataset_store
from app.domain import cost_versions_storage
from app.domain import dashboard_service
from app.domain import erp_dashboard_service
from app.domain import auth_policy
from app.domain import auth_service
from app.domain import postgres_storage
from app.domain import kostprijs_activation_storage
from app.domain import seed_bundle_service
from app.domain import douano_sync_storage
from app.domain import production_storage
from app.domain import company_distance_storage
from app.domain import commercial_yearset_service
from app.domain import commercial_yearset_storage
from app.domain import yearset_reconciliation_service
from app.domain import yearset_blocker_lineage_service
from app.domain import yearset_recovery_service
from app.domain import yearset_recovery_storage
from app.domain import yearset_reconciliation_storage
from app.domain import yearset_dossier_service
from app.domain import cost_authority_service
from app.domain import cost_authority_storage
from app.domain import setup_service
from app.domain import product_model_storage
from app.domain import douano_margin_service
from app.domain.ors_client import OrsClient, Coordinate
from app.domain.auth_dependencies import require_admin, require_cost_activation, require_cost_draft, require_user
from app.schemas.new_year import PrepareNewYearRequest, UpsertNewYearDraftRequest, CommitNewYearRequest
from app.schemas.kostprijs_activation import (
    ActivateKostprijzenRequest,
    KostprijsActivatiePlanResponse,
    UpsertKostprijsActivatieDraftRequest,
)
from app.schemas.navigation import DashboardSummary, NavigationItem
from app.schemas.commercial_yearsets import (
    CommercialYearsetActivationRequest,
    CommercialYearsetBackfillRequest,
    CommercialYearsetRollbackRequest,
    YearsetReconciliationActivationRequest,
    YearsetReconciliationApprovalRequest,
    YearsetReconciliationRequest,
    YearsetRecoveryRequest,
)
from app.schemas.cost_authority import (
    CostAuthorityBackfillRequest,
    CostVersionBeerMappingApprovalRequest,
    PlanningCostRebaselinePrepareRequest,
)


router = APIRouter(prefix="/meta", tags=["meta"], dependencies=[Depends(require_user)])
logger = logging.getLogger(__name__)


def _raise_internal_error(message: str, exc: Exception) -> None:
    logger.exception(message)
    raise HTTPException(status_code=500, detail="Internal server error") from exc


@router.get("/customer-sales-summary")
def get_customer_sales_summary(
    company_id: int = Query(..., ge=1, description="Douano company_id"),
    year: int = Query(..., ge=2000, le=2100),
) -> dict[str, Any]:
    """Return a lightweight snapshot of realized sales for a customer (invoice lines).

    Used by the CPQ offer builder to estimate baseline volume before applying actions.
    Note: liters are only computed for mapped lines with a SKU that references a format article (content_liter).
    """
    cid = int(company_id or 0)
    yr = int(year or 0)
    if cid <= 0 or yr <= 0:
        raise HTTPException(status_code=400, detail="company_id en year zijn verplicht.")

    since = f"{yr:04d}-01-01"
    until = f"{yr + 1:04d}-01-01"

    sku_name_by_id: dict[str, str] = {}
    sku_rows = postgres_storage.load_dataset("skus", [])
    if isinstance(sku_rows, list):
        for row in sku_rows:
            if not isinstance(row, dict):
                continue
            sid = str(row.get("id", "") or "").strip()
            if not sid:
                continue
            sku_name_by_id[sid] = str(row.get("name", row.get("naam", "")) or "").strip() or sid

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    COUNT(DISTINCT l.sales_invoice_id) AS invoices_count,
                    COUNT(*) AS lines_count,
                    COALESCE(SUM(l.net_revenue_ex), 0) AS revenue_ex,
                    COALESCE(SUM(CASE WHEN m.sku_id IS NULL THEN 0 ELSE l.quantity * COALESCE(a.content_liter, 0) END), 0) AS mapped_liters,
                    COALESCE(SUM(CASE WHEN m.sku_id IS NULL THEN 0 ELSE 1 END), 0) AS mapped_lines,
                    COALESCE(SUM(CASE WHEN m.sku_id IS NULL THEN 1 ELSE 0 END), 0) AS unmapped_lines
                FROM douano_sales_invoice_lines l
                LEFT JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN skus s ON s.id = m.sku_id
                LEFT JOIN articles a ON a.id = s.format_article_id
                WHERE l.company_id = %s
                  AND l.invoice_date >= %s::date
                  AND l.invoice_date < %s::date
                """,
                (cid, since, until),
            )
            row = cur.fetchone() or (0, 0, 0, 0, 0, 0)
            invoices_count, lines_count, revenue_ex, mapped_liters, mapped_lines, unmapped_lines = row

            cur.execute(
                """
                SELECT
                    m.sku_id,
                    COALESCE(SUM(l.quantity), 0) AS units,
                    COALESCE(SUM(l.net_revenue_ex), 0) AS revenue_ex,
                    COALESCE(SUM(l.quantity * COALESCE(a.content_liter, 0)), 0) AS liters
                FROM douano_sales_invoice_lines l
                JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                LEFT JOIN skus s ON s.id = m.sku_id
                LEFT JOIN articles a ON a.id = s.format_article_id
                WHERE l.company_id = %s
                  AND l.invoice_date >= %s::date
                  AND l.invoice_date < %s::date
                GROUP BY m.sku_id
                ORDER BY liters DESC, revenue_ex DESC
                LIMIT 10
                """,
                (cid, since, until),
            )
            top_rows = cur.fetchall() or []

    top_skus: list[dict[str, Any]] = []
    for sku_id, units, revenue, liters in top_rows:
        sid = str(sku_id or "").strip()
        if not sid:
            continue
        top_skus.append(
            {
                "sku_id": sid,
                "sku_name": sku_name_by_id.get(sid, sid),
                "units": float(units or 0),
                "revenue_ex": float(revenue or 0),
                "liters": float(liters or 0),
            }
        )

    return {
        "result": {
            "company_id": cid,
            "year": yr,
            "invoices_count": int(invoices_count or 0),
            "lines_count": int(lines_count or 0),
            "revenue_ex": float(revenue_ex or 0),
            "mapped_liters": float(mapped_liters or 0),
            "mapped_lines": int(mapped_lines or 0),
            "unmapped_lines": int(unmapped_lines or 0),
            "top_skus": top_skus,
        }
    }


@router.get("/navigation", response_model=list[NavigationItem])
def get_navigation(session: dict = Depends(require_user)) -> list[NavigationItem]:
    setup_required = not setup_service.has_active_costprices()
    year_flow_item = (
        NavigationItem(
            key="setup",
            label="Setup",
            description="Doorloop de eerste inrichting en controleer of Douano, SKU's, LOTs en kostprijzen compleet zijn.",
            href="/setup",
            section="Beheer",
        )
        if setup_required
        else NavigationItem(
            key="nieuw-jaar-voorbereiden",
            label="Nieuw jaar voorbereiden",
            description="Kopieer stamdata en berekeningen naar een nieuw jaar.",
            href="/nieuw-jaar-voorbereiden",
            section="Beheer",
        )
    )
    items = [
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
            label="Brouwmoment",
            description="Maak een LOT-gebonden batchversie op basis van een actieve kostprijs.",
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
            key="jaar-afsluiten",
            label="Jaar afsluiten",
            description="Controleer realisatie en leg een jaarafsluiting vast.",
            href="/jaar-afsluiten",
            section="Beheer",
        ),
        year_flow_item,
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

    hidden_keys: set[str] = set()
    if not auth_policy.has_capability(session, auth_policy.CAP_COSTS_DRAFT):
        hidden_keys.update({"nieuwe-kostprijsberekening", "recept-hercalculatie", "inkoopfacturen"})
    if not auth_policy.has_capability(session, auth_policy.CAP_QUOTES_MANAGE):
        hidden_keys.add("prijsvoorstel")
    if not auth_policy.has_capability(session, auth_policy.CAP_PRODUCT_MAPPINGS_MANAGE):
        hidden_keys.add("productkoppeling")
    return [item for item in items if item.key not in hidden_keys]


def _dashboard_summary_payload(summary: Any, session: dict[str, Any]) -> dict[str, Any]:
    can_manage_quotes = auth_policy.has_capability(session, auth_policy.CAP_QUOTES_MANAGE)
    return {
        "concept_berekeningen": summary.concept_berekeningen,
        "definitieve_berekeningen": summary.definitieve_berekeningen,
        "concept_prijsvoorstellen": summary.concept_prijsvoorstellen if can_manage_quotes else 0,
        "definitieve_prijsvoorstellen": summary.definitieve_prijsvoorstellen if can_manage_quotes else 0,
        "klaar_om_te_activeren": summary.klaar_om_te_activeren,
        "klaar_om_te_activeren_waarschuwing": summary.klaar_om_te_activeren_waarschuwing,
        "aflopende_offertes": summary.aflopende_offertes if can_manage_quotes else 0,
        "aflopende_offertes_items": summary.aflopende_offertes_items if can_manage_quotes else [],
    }


@router.get("/dashboard-summary", response_model=DashboardSummary)
def get_dashboard_summary(session: dict = Depends(require_user)) -> DashboardSummary:
    summary = dashboard_service.get_dashboard_summary()
    return DashboardSummary(**_dashboard_summary_payload(summary, session))


@router.get("/bootstrap")
def get_bootstrap(
    datasets: str = Query("", description="Comma-separated dataset names"),
    navigation: bool = Query(True, description="Include navigation items"),
    since: str = Query("", description="Optioneel: ISO datum (YYYY-MM-DD) voor ERP dashboard"),
    until: str = Query("", description="Optioneel: ISO datum (YYYY-MM-DD) voor ERP dashboard"),
    basis: str = Query("invoice", description="Optioneel: basis voor ERP dashboard (invoice/order)"),
    year: int = Query(0, ge=0, le=2100, description="Optioneel: jaarfilter voor ERP dashboard (0 = auto)"),
    sku_id: str = Query("", description="Optioneel: filter ERP dashboard op SKU id"),
    session: dict = Depends(require_user),
) -> dict[str, Any]:
    names = [name.strip() for name in (datasets or "").split(",") if name.strip()]
    payload: dict[str, Any] = {"datasets": {}}

    if navigation:
        payload["navigation"] = get_navigation(session)

    for name in names:
        try:
            if name == "dashboard-summary":
                summary = dashboard_service.get_dashboard_summary()
                payload["datasets"][name] = _dashboard_summary_payload(summary, session)
                continue
            if name == "erp-dashboard":
                payload["datasets"][name] = erp_dashboard_service.get_erp_dashboard(
                    since=since,
                    until=until,
                    basis=basis,
                    year=int(year or 0),
                    sku_id=sku_id,
                )
                continue
            if name == "auth-status":
                payload["datasets"][name] = auth_service.auth_status()
                continue
            if name == "auth-users":
                if not auth_policy.has_capability(session, auth_policy.CAP_USERS_VIEW):
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
            _raise_internal_error(f"Bootstrap dataset failed: {name}", exc)

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
    user: dict[str, Any] = Depends(require_cost_draft),
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
    user: dict[str, Any] = Depends(require_cost_draft),
) -> dict[str, Any]:
    return dataset_store.delete_kostprijs_activatie_draft(
        owner=str(user.get("username", "") or ""),
        target_year=int(target_year),
    )


@router.post("/activate-kostprijzen")
def post_activate_kostprijzen(
    payload: ActivateKostprijzenRequest,
    user: dict[str, Any] = Depends(require_cost_activation),
) -> dict[str, Any]:
    # Capability-gated: this writes new definitive cost versions and activations for the target year.
    try:
        selections = [{"bier_id": s.bier_id, "product_id": s.product_id} for s in payload.selections]
        if bool(payload.dry_run):
            return dataset_store.activate_kostprijzen_for_year(
                owner=str(user.get("username", "") or ""),
                source_year=int(payload.source_year),
                target_year=int(payload.target_year),
                selections=selections,
                dry_run=True,
                create_break_even_plan=bool(payload.create_break_even_plan),
            )

        with postgres_storage.transaction():
            result = dataset_store.activate_kostprijzen_for_year(
                owner=str(user.get("username", "") or ""),
                source_year=int(payload.source_year),
                target_year=int(payload.target_year),
                selections=selections,
                dry_run=False,
                create_break_even_plan=bool(payload.create_break_even_plan),
            )
            result["snapshot_refresh"] = douano_margin_service.backfill_line_snapshots_for_year(
                year=int(payload.target_year),
                basis="both",
                limit=50000,
            )
        return result
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
            # Clear cost versions before seeding or wiping masters; otherwise FK constraints
            # (cost_version_sku_rows -> skus) can block deleting/replacing SKUs.
            try:
                from app.domain import cost_versions_storage

                cost_versions_storage.reset_defaults()
            except Exception:
                pass
            if normalized_profile:
                # SKU-aanpak: use the canonical SKU seeders instead of legacy seed bundles.
                try:
                    if normalized_profile == "demo_foundation":
                        report["seed"] = post_dev_seed_sku_foundation(year=2025, with_demo=False, _={})
                    else:
                        # "Golden" includes demo costing + activations.
                        report["seed"] = post_dev_seed_sku_foundation(year=2025, with_demo=True, _={})

                        # Mixed smoke-test set: keep 2 active cost prices, leave the rest inactive.
                        try:
                            seeded_year = int((report["seed"] or {}).get("year", 2025) or 2025)
                        except Exception:
                            seeded_year = 2025
                        # Keep 2 actives, leave IPA 33cl definitief maar niet actief (smoke-test scenario).
                        keep_active = {"sku-blond-33cl", "sku-bundle-giftpack-4"}
                        existing = dataset_store.load_dataset("kostprijsproductactiveringen")
                        filtered: list[dict[str, Any]] = []
                        if isinstance(existing, list):
                            for row in existing:
                                if not isinstance(row, dict):
                                    continue
                                if int(row.get("jaar", 0) or 0) != seeded_year:
                                    filtered.append(row)
                                    continue
                                sku_id = str(row.get("sku_id", "") or "").strip()
                                if sku_id in keep_active:
                                    filtered.append(row)
                        dataset_store.save_dataset("kostprijsproductactiveringen", filtered)
                except HTTPException:
                    raise
                except Exception as exc:
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
    # Important: don't import a long list in one statement; a single import error would skip resetting
    # everything and leave stale `_SCHEMA_READY` flags behind (causing "relation does not exist").
    try:
        # postgres_storage caches base schema readiness + legacy purge state; hard-reset drops `app_datasets`,
        # so we must force it to recreate the table on next use.
        try:
            if hasattr(postgres_storage, "_schema_ready"):
                setattr(postgres_storage, "_schema_ready", False)
            if hasattr(postgres_storage, "_legacy_purged"):
                getattr(postgres_storage, "_legacy_purged").clear()  # type: ignore[union-attr]
        except Exception:
            pass

        import importlib

        module_names = [
            "app.domain.adviesprijzen_storage",
            "app.domain.articles_storage",
            "app.domain.bom_storage",
            "app.domain.cost_versions_storage",
            "app.domain.douano_margin_snapshot_storage",
            "app.domain.douano_oauth_storage",
            "app.domain.douano_product_ignore_storage",
            "app.domain.douano_product_mapping_storage",
            "app.domain.douano_sync_storage",
            "app.domain.fixed_costs_storage",
            "app.domain.kostprijs_activatie_drafts_storage",
            "app.domain.kostprijs_activation_storage",
            "app.domain.kostprijs_scenario_inkoop_storage",
            "app.domain.new_year_drafts_storage",
            "app.domain.production_storage",
            "app.domain.product_registry_storage",
            "app.domain.quote_drafts_storage",
            "app.domain.sales_pricing_storage",
            "app.domain.skus_storage",
            "app.domain.tarieven_heffingen_storage",
            "app.domain.traceability_storage",
        ]

        for module_name in module_names:
            try:
                module = importlib.import_module(module_name)
            except Exception:
                continue
            for flag_name in ("_SCHEMA_READY", "_schema_ready"):
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
    with_demo: bool = Query(
        False,
        description="Voegt demo kostprijsversie + activaties + verkoopstrategie toe zodat Offerte/Break-even direct werkt.",
    ),
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
        {"id": "pkg-giftbox-4", "code": "GIFTBOX4", "name": "Giftbox 4 flessen", "kind": "packaging_component", "uom": "stuk", "content_liter": 0.0, "active": True},
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
        },
        {
            "id": "beer-ipa",
            "biernaam": "Berlewalde IPA",
            "stijl": "IPA",
            "alcoholpercentage": 6.6,
            "belastingsoort": "Accijns",
            "tarief_accijns": "Hoog",
            "btw_tarief": "21%",
        },
        {
            "id": "beer-triple",
            "biernaam": "Berlewalde Triple",
            "stijl": "Triple",
            "alcoholpercentage": 9.0,
            "belastingsoort": "Accijns",
            "tarief_accijns": "Hoog",
            "btw_tarief": "21%",
        },
    ]

    # SKUs (beer × format) + example non-beer SKU (hoodie) can be added later.
    skus = [
        {"id": "sku-blond-33cl", "kind": "beer_format", "beer_id": "beer-blond", "format_article_id": "fmt-bottle-33cl", "article_id": "", "code": "BLOND-33", "name": "Berlewalde Blond - Fles 33cl", "active": True},
        {"id": "sku-blond-24x33", "kind": "beer_format", "beer_id": "beer-blond", "format_article_id": "fmt-box-24x33cl", "article_id": "", "code": "BLOND-24X33", "name": "Berlewalde Blond - Doos 24×33cl", "active": True},
        {"id": "sku-blond-keg20", "kind": "beer_format", "beer_id": "beer-blond", "format_article_id": "fmt-keg-20l", "article_id": "", "code": "BLOND-KEG20", "name": "Berlewalde Blond - Fust 20L", "active": True},
        {"id": "sku-ipa-33cl", "kind": "beer_format", "beer_id": "beer-ipa", "format_article_id": "fmt-bottle-33cl", "article_id": "", "code": "IPA-33", "name": "Berlewalde IPA - Fles 33cl", "active": True},
        {"id": "sku-ipa-24x33", "kind": "beer_format", "beer_id": "beer-ipa", "format_article_id": "fmt-box-24x33cl", "article_id": "", "code": "IPA-24X33", "name": "Berlewalde IPA - Doos 24Ã—33cl", "active": True},
        {"id": "sku-triple-33cl", "kind": "beer_format", "beer_id": "beer-triple", "format_article_id": "fmt-bottle-33cl", "article_id": "", "code": "TRIPLE-33", "name": "Berlewalde Triple - Fles 33cl", "active": True},
        {"id": "sku-triple-24x33", "kind": "beer_format", "beer_id": "beer-triple", "format_article_id": "fmt-box-24x33cl", "article_id": "", "code": "TRIPLE-24X33", "name": "Berlewalde Triple - Doos 24Ã—33cl", "active": True},
    ]

    # Demo bundle: model catalog/giftpacks as Article(kind=bundle) + SKU(kind=article) + BOM (can mix SKUs + articles).
    bundle_articles = [
        {"id": "bundle-giftpack-4", "code": "GIFT4", "name": "Giftpack 4x33cl (2x Blond, 2x IPA)", "kind": "bundle", "uom": "pakket", "content_liter": 4 * 0.33, "active": True},
    ]
    bundle_skus = [
        {"id": "sku-bundle-giftpack-4", "kind": "article", "beer_id": "", "format_article_id": "", "article_id": "bundle-giftpack-4", "code": "GIFT4", "name": "Giftpack 4x33cl (2x Blond, 2x IPA)", "active": True},
    ]
    bundle_bom_lines = [
        {"id": "bom-gift4-blond-33cl", "parent_article_id": "bundle-giftpack-4", "component_article_id": "", "component_sku_id": "sku-blond-33cl", "quantity": 2, "uom": "stuk", "scrap_pct": 0, "line_kind": "beer", "bier_id": "beer-blond", "product_id": "fmt-bottle-33cl", "product_type": "basis"},
        {"id": "bom-gift4-ipa-33cl", "parent_article_id": "bundle-giftpack-4", "component_article_id": "", "component_sku_id": "sku-ipa-33cl", "quantity": 2, "uom": "stuk", "scrap_pct": 0, "line_kind": "beer", "bier_id": "beer-ipa", "product_id": "fmt-bottle-33cl", "product_type": "basis"},
        {"id": "bom-gift4-box", "parent_article_id": "bundle-giftpack-4", "component_article_id": "pkg-giftbox-4", "component_sku_id": "", "quantity": 1, "uom": "stuk", "scrap_pct": 0, "line_kind": "packaging_component", "packaging_component_id": "pkg-giftbox-4"},
    ]

    # Minimal packaging component prices (per year) using the existing dataset name the UI expects.
    packaging_component_prices = [
        {"id": "price-bottle-33cl", "jaar": year_value, "verpakkingsonderdeel_id": "pkg-bottle-33cl", "prijs_per_stuk": 0.22},
        {"id": "price-cap", "jaar": year_value, "verpakkingsonderdeel_id": "pkg-cap", "prijs_per_stuk": 0.03},
        {"id": "price-label", "jaar": year_value, "verpakkingsonderdeel_id": "pkg-label", "prijs_per_stuk": 0.05},
        {"id": "price-box-24", "jaar": year_value, "verpakkingsonderdeel_id": "pkg-box-24", "prijs_per_stuk": 1.10},
        {"id": "price-giftbox-4", "jaar": year_value, "verpakkingsonderdeel_id": "pkg-giftbox-4", "prijs_per_stuk": 1.30},
    ]

    # Provide a basic production year so cost allocation screens have a year anchor.
    productie = {str(year_value): {"hoeveelheid_inkoop_l": 0, "hoeveelheid_productie_l": 0, "batchgrootte_eigen_productie_l": 0}}

    with postgres_storage.transaction():
        # Ensure we can safely overwrite SKU masters even when a dev DB already contains cost versions.
        # FK constraints (cost_version_sku_rows -> skus) would otherwise block deleting/replacing SKUs.
        try:
            from app.domain import cost_versions_storage

            cost_versions_storage.reset_defaults()
        except Exception:
            pass

        # Seed controlled vocabularies so Beheer is the single source of truth.
        # This ensures the same options appear in:
        # - Beheer > Productclassificaties
        # - Kostprijsbeheer > Classificeren
        # - Product samenstellen
        dataset_store.save_dataset("productgroepen", deepcopy(dataset_store.DATASET_DEFAULTS["productgroepen"]))
        dataset_store.save_dataset("alcoholcategorieen", deepcopy(dataset_store.DATASET_DEFAULTS["alcoholcategorieen"]))
        dataset_store.save_dataset("verpakkingstypen", deepcopy(dataset_store.DATASET_DEFAULTS["verpakkingstypen"]))

        # SKU/Article core
        postgres_storage.save_dataset("articles", [*packaging_components, *formats, *bundle_articles], overwrite=True)
        postgres_storage.save_dataset("bom-lines", [*bom_lines, *bundle_bom_lines], overwrite=True)
        postgres_storage.save_dataset("skus", [*skus, *bundle_skus], overwrite=True)

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

        if with_demo:
            # Rich demo: year setup + pricing scaffolding similar to the old golden seed.
            channels = [
                {"id": "horeca", "code": "horeca", "naam": "Horeca", "actief": True, "volgorde": 10, "default_marge_pct": 25, "default_factor": 2.5},
                {"id": "retail", "code": "retail", "naam": "Supermarkt", "actief": True, "volgorde": 20, "default_marge_pct": 20, "default_factor": 2.4},
                {"id": "slijterij", "code": "slijterij", "naam": "Slijterij", "actief": True, "volgorde": 30, "default_marge_pct": 20, "default_factor": 3.0},
                {"id": "zakelijk", "code": "zakelijk", "naam": "Speciaalzaak", "actief": True, "volgorde": 40, "default_marge_pct": 20, "default_factor": 3.2},
            ]
            dataset_store.save_dataset("channels", channels)

            adviesprijzen = [
                # ID must be a UUID (table is UUID PK); omit to let storage generate stable ids.
                {"jaar": year_value, "channel_code": "horeca", "opslag_pct": 25.0},
                {"jaar": year_value, "channel_code": "retail", "opslag_pct": 25.0},
                {"jaar": year_value, "channel_code": "slijterij", "opslag_pct": 40.0},
                {"jaar": year_value, "channel_code": "zakelijk", "opslag_pct": 45.0},
            ]
            dataset_store.save_dataset("adviesprijzen", adviesprijzen)

            dataset_store.save_dataset(
                "tarieven-heffingen",
                [{"jaar": year_value, "tarief_hoog": 0.0, "tarief_laag": 0.0, "verbruikersbelasting": 0.0}],
            )

            dataset_store.save_dataset(
                "vaste-kosten",
                {
                    str(year_value): [
                        {"id": f"fc-{year_value}-indirect", "omschrijving": "Indirecte vaste kosten", "kostensoort": "Indirecte kosten", "bedrag_per_jaar": 100000.0, "herverdeel_pct": 0.0},
                        {"id": f"fc-{year_value}-direct", "omschrijving": "Directe vaste kosten", "kostensoort": "Directe kosten", "bedrag_per_jaar": 50000.0, "herverdeel_pct": 0.0},
                    ]
                },
            )

            # Traceability-ready demo: one packaging lot + one production batch consuming it.
            now_iso = datetime.now(UTC).isoformat()
            dataset_store.save_dataset(
                "trace-lots",
                [
                    {
                        "id": f"lot-box-{year_value}",
                        "kind": "purchase",
                        "article_id": "pkg-box-24",
                        "sku_id": "",
                        "quantity": 100,
                        "uom": "stuk",
                        "received_at": now_iso,
                        "supplier": "Demo leverancier",
                        "external_ref": f"PO-DEMO-{year_value}",
                    }
                ],
            )
            dataset_store.save_dataset(
                "trace-batches",
                [
                    {
                        "id": f"batch-blond-33cl-{year_value}",
                        "kind": "production",
                        "sku_id": "sku-blond-33cl",
                        "quantity": 1000,
                        "uom": "stuk",
                        "produced_at": now_iso,
                        "external_ref": f"BREW-{year_value}-001",
                    }
                ],
            )
            dataset_store.save_dataset(
                "trace-batch-consumptions",
                [
                    {
                        "id": f"cons-box-{year_value}",
                        "batch_id": f"batch-blond-33cl-{year_value}",
                        "component_lot_id": f"lot-box-{year_value}",
                        "component_article_id": "pkg-box-24",
                        "component_sku_id": "",
                        "quantity": 1,
                        "uom": "stuk",
                    }
                ],
            )

            # Minimal year strategy for sell-in (opslag %) so prices are non-zero.
            verkoopstrategie = [
                {
                    "id": f"verkoopstrategie-{year_value}",
                    "record_type": "jaarstrategie",
                    "jaar": year_value,
                    "sell_in_margins": {"horeca": 25, "retail": 20, "slijterij": 20, "zakelijk": 20},
                }
            ]

            # Definitive cost versions for each beer + the giftpack (2 active, IPA 33cl NOT active).
            def _snapshot_for_beer(beer_id: str, base_cost_per_liter: float) -> list[dict[str, Any]]:
                rows: list[dict[str, Any]] = []
                for sku in skus:
                    if str(sku.get("beer_id", "") or "") != beer_id:
                        continue
                    fmt_id = str(sku.get("format_article_id", "") or "")
                    fmt_row = next((f for f in formats if str(f.get("id", "")) == fmt_id), None)
                    liters_per_unit = float((fmt_row or {}).get("content_liter", 0.0) or 0.0)
                    pack_label = str((fmt_row or {}).get("name", "") or fmt_id)
                    kostprijs = round(base_cost_per_liter * max(liters_per_unit, 0.0), 4)
                    vaste_kosten_row = round(kostprijs * 0.2, 4) if kostprijs > 0 else 0.0
                    rows.append(
                        {
                            "sku_id": str(sku.get("id", "") or ""),
                            "product_type": "sku",
                            "product_id": fmt_id,
                            "verpakking": pack_label,
                            "verpakking_label": pack_label,
                            "liters_per_product": liters_per_unit,
                            "kostprijs": kostprijs,
                            "vaste_kosten": vaste_kosten_row,
                        }
                    )
                return rows

            kostprijsversies = [
                {
                    "id": f"kostprijs-blond-{year_value}",
                    "jaar": year_value,
                    "status": "definitief",
                    "bier_id": "beer-blond",
                    "type": "productie",
                    "is_actief": True,
                    "kostprijs": 2.0,
                    "basisgegevens": {"jaar": year_value, "biernaam": "Berlewalde Blond", "stijl": "Blond", "alcoholpercentage": 6.0, "belastingsoort": "Accijns", "tarief_accijns": "Hoog", "btw_tarief": "21%"},
                    "resultaat_snapshot": {"producten": {"basisproducten": _snapshot_for_beer("beer-blond", 2.0), "samengestelde_producten": []}},
                },
                {
                    "id": f"kostprijs-ipa-{year_value}",
                    "jaar": year_value,
                    "status": "definitief",
                    "bier_id": "beer-ipa",
                    "type": "productie",
                    "is_actief": True,
                    "kostprijs": 2.2,
                    "basisgegevens": {"jaar": year_value, "biernaam": "Berlewalde IPA", "stijl": "IPA", "alcoholpercentage": 6.6, "belastingsoort": "Accijns", "tarief_accijns": "Hoog", "btw_tarief": "21%"},
                    "resultaat_snapshot": {"producten": {"basisproducten": _snapshot_for_beer("beer-ipa", 2.2), "samengestelde_producten": []}},
                },
                {
                    "id": f"kostprijs-triple-{year_value}",
                    "jaar": year_value,
                    "status": "definitief",
                    "bier_id": "beer-triple",
                    "type": "inkoop",
                    "is_actief": True,
                    "kostprijs": 3.0,
                    "basisgegevens": {"jaar": year_value, "biernaam": "Berlewalde Triple", "stijl": "Triple", "alcoholpercentage": 9.0, "belastingsoort": "Accijns", "tarief_accijns": "Hoog", "btw_tarief": "21%"},
                    "resultaat_snapshot": {"producten": {"basisproducten": _snapshot_for_beer("beer-triple", 3.0), "samengestelde_producten": []}},
                },
                {
                    "id": f"kostprijs-giftpack-{year_value}",
                    "jaar": year_value,
                    "status": "definitief",
                    "bier_id": "",
                    "type": "bundle",
                    "is_actief": True,
                    "kostprijs": 10.0,
                    "basisgegevens": {"jaar": year_value, "biernaam": "Giftpack 4x33cl (2x Blond, 2x IPA)", "btw_tarief": "21%", "article_id": "bundle-giftpack-4", "sku_id": "sku-bundle-giftpack-4"},
                    "resultaat_snapshot": {"producten": {"basisproducten": [], "samengestelde_producten": []}},
                },
            ]
            postgres_storage.save_dataset("kostprijsversies", kostprijsversies, overwrite=True)

            dataset_store.save_dataset(
                "kostprijsproductactiveringen",
                [
                    {"sku_id": "sku-blond-33cl", "jaar": year_value, "kostprijsversie_id": f"kostprijs-blond-{year_value}"},
                    {"sku_id": "sku-bundle-giftpack-4", "jaar": year_value, "kostprijsversie_id": f"kostprijs-giftpack-{year_value}"},
                ],
            )

            # Pricing (verkoopprijzen): year strategy only; product prices derive from cost * opslag%.
            dataset_store.save_dataset("verkoopprijzen", verkoopstrategie)

    dashboard_service.invalidate_dashboard_summary_cache()
    return {
        "ok": True,
        "year": year_value,
        "seeded": {
            "articles": len(packaging_components) + len(formats) + len(bundle_articles),
            "bom_lines": len(bom_lines) + len(bundle_bom_lines),
            "skus": len(skus) + len(bundle_skus),
            "bieren": len(beers),
            "packaging_component_prices": len(packaging_component_prices),
            "with_demo": bool(with_demo),
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
        _raise_internal_error("Seed bundle export failed", exc)


@router.post("/dev/cleanup-duplicate-skus")
def post_dev_cleanup_duplicate_skus(
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets verwijderen."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Local-only dev helper: remove duplicate SKUs with the same logical scope.

    Only deletes SKUs that have zero references in known datasets/tables.
    """
    if auth_service.environment_name() not in {"local", "dev", "development"}:
        raise HTTPException(status_code=403, detail="Cleanup is alleen toegestaan in local/dev.")
    try:
        from app.domain import skus_storage

        return {"result": skus_storage.cleanup_duplicate_skus(dry_run=bool(dry_run))}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/dev/cleanup-legacy-beer-format-aliases")
def post_dev_cleanup_legacy_beer_format_aliases(
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets wijzigen."),
    year: int = Query(0, description="Optioneel jaar om activaties te beperken; 0 = alle jaren."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Local-only dev helper: merge legacy beer_format SKU aliases into canonical SKUs."""
    if auth_service.environment_name() not in {"local", "dev", "development"}:
        raise HTTPException(status_code=403, detail="Cleanup is alleen toegestaan in local/dev.")
    try:
        from app.domain import skus_storage

        result = skus_storage.cleanup_legacy_beer_format_aliases(dry_run=bool(dry_run), year=int(year or 0))
        return {
            "route": "cleanup-legacy-beer-format-aliases",
            "dry_run": bool(dry_run),
            "year": int(year or 0),
            "result": result,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/dev/delete-sellable")
def post_dev_delete_sellable(
    article_id: str = Query("", description="Article id (bundle/article) to delete."),
    sku_id: str = Query("", description="SKU id to delete (optional; inferred from article_id when omitted)."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Local-only dev helper: delete a sellable article/SKU and related rows (development only)."""
    if auth_service.environment_name() not in {"local", "dev", "development"}:
        raise HTTPException(status_code=403, detail="Delete is alleen toegestaan in local/dev.")

    target_article_id = str(article_id or "").strip()
    target_sku_id = str(sku_id or "").strip()
    if not target_article_id and not target_sku_id:
        raise HTTPException(status_code=400, detail="Geef article_id of sku_id mee.")

    try:
        from app.domain import douano_product_mapping_storage

        # Resolve sku ids when only article_id is provided.
        skus = postgres_storage.load_dataset("skus", [])
        if not isinstance(skus, list):
            skus = []
        sku_ids: set[str] = set()
        if target_sku_id:
            sku_ids.add(target_sku_id)
        if target_article_id:
            for row in skus:
                if not isinstance(row, dict):
                    continue
                if str(row.get("article_id", "") or "").strip() == target_article_id:
                    sid = str(row.get("id", "") or "").strip()
                    if sid:
                        sku_ids.add(sid)

        report: dict[str, Any] = {"article_id": target_article_id, "sku_ids": sorted(sku_ids), "deleted": {}}

        # Articles.
        if target_article_id:
            articles = postgres_storage.load_dataset("articles", [])
            if isinstance(articles, list):
                before = len(articles)
                articles = [
                    row
                    for row in articles
                    if not (isinstance(row, dict) and str(row.get("id", "") or "").strip() == target_article_id)
                ]
                report["deleted"]["articles"] = before - len(articles)
                postgres_storage.save_dataset("articles", articles, overwrite=True)

        # SKUs.
        if sku_ids:
            # cost_version_sku_rows has a FK to skus (ON DELETE RESTRICT). Clear those rows first.
            try:
                with postgres_storage.connect() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "DELETE FROM cost_version_sku_rows WHERE sku_id = ANY(%s)",
                            (list(sku_ids),),
                        )
                        report["deleted"]["cost_version_sku_rows"] = int(cur.rowcount or 0)
                    if not postgres_storage.in_transaction():
                        conn.commit()
            except Exception:
                report["deleted"]["cost_version_sku_rows"] = "error"

            before = len(skus)
            skus = [
                row
                for row in skus
                if not (isinstance(row, dict) and str(row.get("id", "") or "").strip() in sku_ids)
            ]
            report["deleted"]["skus"] = before - len(skus)
            postgres_storage.save_dataset("skus", skus, overwrite=True)

        # BOM lines referencing the article as parent.
        if target_article_id:
            bom_lines = postgres_storage.load_dataset("bom-lines", [])
            if isinstance(bom_lines, list):
                before = len(bom_lines)
                bom_lines = [
                    row
                    for row in bom_lines
                    if not (isinstance(row, dict) and str(row.get("parent_article_id", "") or "").strip() == target_article_id)
                ]
                report["deleted"]["bom-lines"] = before - len(bom_lines)
                postgres_storage.save_dataset("bom-lines", bom_lines, overwrite=True)

        # Kostprijsversies referencing the article/sku.
        kostprijsversies = postgres_storage.load_dataset("kostprijsversies", [])
        if isinstance(kostprijsversies, list):
            before = len(kostprijsversies)

            def _keep_kv(row: Any) -> bool:
                if not isinstance(row, dict):
                    return True
                basis = row.get("basisgegevens", {})
                if not isinstance(basis, dict):
                    basis = {}
                a_id = str(basis.get("article_id", "") or "").strip()
                s_id = str(basis.get("sku_id", "") or "").strip()
                if target_article_id and a_id == target_article_id:
                    return False
                if sku_ids and s_id in sku_ids:
                    return False
                return True

            kostprijsversies = [row for row in kostprijsversies if _keep_kv(row)]
            report["deleted"]["kostprijsversies"] = before - len(kostprijsversies)
            postgres_storage.save_dataset("kostprijsversies", kostprijsversies, overwrite=True)

        # Activations for sku ids.
        if sku_ids:
            activations = postgres_storage.load_dataset("kostprijsproductactiveringen", [])
            if isinstance(activations, list):
                before = len(activations)
                activations = [
                    row
                    for row in activations
                    if not (isinstance(row, dict) and str(row.get("sku_id", "") or "").strip() in sku_ids)
                ]
                report["deleted"]["kostprijsproductactiveringen"] = before - len(activations)
                postgres_storage.save_dataset("kostprijsproductactiveringen", activations, overwrite=True)

        # Verkoopprijzen for sku ids.
        if sku_ids:
            verkoopprijzen = postgres_storage.load_dataset("verkoopprijzen", [])
            if isinstance(verkoopprijzen, list):
                before = len(verkoopprijzen)
                verkoopprijzen = [
                    row
                    for row in verkoopprijzen
                    if not (isinstance(row, dict) and str(row.get("sku_id", "") or "").strip() in sku_ids)
                ]
                report["deleted"]["verkoopprijzen"] = before - len(verkoopprijzen)
                postgres_storage.save_dataset("verkoopprijzen", verkoopprijzen, overwrite=True)

        # Remove product-mappings that point to these sku ids.
        mapping_deleted: list[dict[str, Any]] = []
        for sid in sorted(sku_ids):
            try:
                mapping_deleted.append(douano_product_mapping_storage.delete_mappings_for_sku_id(sku_id=sid))
            except Exception:
                continue
        report["deleted"]["douano_product_mapping"] = mapping_deleted

        return report
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.post("/delete-sellable")
def post_delete_sellable(
    sku_id: str = Query(..., description="SKU id om te verwijderen (alleen wanneer ongerefereerd)."),
    dry_run: bool = Query(True, description="Wanneer true: alleen valideren/rapporteren, niets verwijderen."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Safely delete a sellable SKU and its owned bundle/article rows when unreferenced.

    Hard-delete is only allowed when the SKU has zero references in:
    - kostprijs activations (any year)
    - Douano product mappings (productkoppeling)
    - offertes (quote_drafts)
    - BOM lines as component (component_sku_id)

    When allowed, we remove:
    - the SKU row
    - its owned article (article_id) + bom_lines where parent_article_id == article_id
    - any cost_version_sku_rows rows for sku_id
    - any dataset rows that reference the sku/article (kostprijsversies/verkoopprijzen/kostprijsproductactiveringen)
    """
    rid = str(sku_id or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="sku_id is verplicht.")

    def _scan_for_sku_ids(value: Any, out: set[str]) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                if k in {"sku_id", "component_sku_id"}:
                    sid = str(v or "").strip()
                    if sid:
                        out.add(sid)
                _scan_for_sku_ids(v, out)
        elif isinstance(value, list):
            for item in value:
                _scan_for_sku_ids(item, out)

    try:
        # Load SKU row (must exist).
        skus = postgres_storage.load_dataset("skus", [])
        if not isinstance(skus, list):
            skus = []
        sku_row = next((row for row in skus if isinstance(row, dict) and str(row.get("id", "") or "").strip() == rid), None)
        if not isinstance(sku_row, dict):
            raise HTTPException(status_code=404, detail=f"SKU '{rid}' niet gevonden.")

        kind = str(sku_row.get("kind", "") or "").strip().lower()
        if kind != "article":
            raise HTTPException(status_code=400, detail="Alleen kind=article SKUs kunnen via deze route verwijderd worden.")

        owned_article_id = str(sku_row.get("article_id", "") or "").strip()

        # Reference checks.
        reasons: list[str] = []

        # 1) Kostprijs activations (any year).
        activations = postgres_storage.load_dataset("kostprijsproductactiveringen", [])
        if isinstance(activations, list):
            if any(
                isinstance(row, dict) and str(row.get("sku_id", "") or "").strip() == rid
                for row in activations
            ):
                reasons.append("SKU heeft kostprijs-activaties (kostprijsbeheer).")

        # 2) Douano product mappings table.
        try:
            from app.domain import douano_product_mapping_storage

            douano_product_mapping_storage.ensure_schema()
            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM douano_product_mapping WHERE sku_id = %s", (rid,))
                    count = int((cur.fetchone() or [0])[0] or 0)
                    if count > 0:
                        reasons.append("SKU heeft een productkoppeling (Douano mapping).")
        except Exception:
            # If we can't verify, block hard delete (safety).
            reasons.append("Kon productkoppelingen niet verifiëren (veiligheidsblokkade).")

        # 3) BOM as component.
        bom_lines = postgres_storage.load_dataset("bom-lines", [])
        if isinstance(bom_lines, list):
            if any(
                isinstance(row, dict) and str(row.get("component_sku_id", "") or "").strip() == rid
                for row in bom_lines
            ):
                reasons.append("SKU wordt gebruikt als component in een samenstelling (BOM).")

        # 4) Offertes (quote_drafts table payload scan).
        try:
            from app.domain import quote_drafts_storage

            quote_drafts_storage.ensure_schema()
            referenced_in_quotes = False
            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT id, quote_number, status, year, payload FROM quote_drafts")
                    for (qid, qnum, qstatus, qyear, payload) in cur.fetchall() or []:
                        sku_ids: set[str] = set()
                        _scan_for_sku_ids(payload, sku_ids)
                        if rid in sku_ids:
                            referenced_in_quotes = True
                            break
            if referenced_in_quotes:
                reasons.append("SKU komt voor in offertes/prijsvoorstellen.")
        except Exception:
            reasons.append("Kon offertes niet verifiëren (veiligheidsblokkade).")

        report: dict[str, Any] = {
            "sku_id": rid,
            "article_id": owned_article_id,
            "dry_run": bool(dry_run),
            "can_delete": len(reasons) == 0,
            "blocked_reasons": reasons,
            "deleted": {},
        }

        if reasons:
            if dry_run:
                return {"result": report}
            raise HTTPException(status_code=409, detail={"message": "Verwijderen geblokkeerd.", "reasons": reasons})

        if dry_run:
            return {"result": report}

        # --- Perform deletion ---
        # 1) Remove SKU row.
        before = len(skus)
        skus = [
            row
            for row in skus
            if not (isinstance(row, dict) and str(row.get("id", "") or "").strip() == rid)
        ]
        report["deleted"]["skus"] = before - len(skus)
        postgres_storage.save_dataset("skus", skus, overwrite=True)

        # 2) Remove owned article and bom-lines (parent) when present.
        if owned_article_id:
            articles = postgres_storage.load_dataset("articles", [])
            if isinstance(articles, list):
                before = len(articles)
                articles = [
                    row
                    for row in articles
                    if not (isinstance(row, dict) and str(row.get("id", "") or "").strip() == owned_article_id)
                ]
                report["deleted"]["articles"] = before - len(articles)
                postgres_storage.save_dataset("articles", articles, overwrite=True)

            bom_lines = postgres_storage.load_dataset("bom-lines", [])
            if isinstance(bom_lines, list):
                before = len(bom_lines)
                bom_lines = [
                    row
                    for row in bom_lines
                    if not (
                        isinstance(row, dict)
                        and str(row.get("parent_article_id", "") or "").strip() == owned_article_id
                    )
                ]
                report["deleted"]["bom-lines"] = before - len(bom_lines)
                postgres_storage.save_dataset("bom-lines", bom_lines, overwrite=True)

        # 3) Remove cost_version_sku_rows (table-backed).
        try:
            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM cost_version_sku_rows WHERE sku_id = %s", (rid,))
                    report["deleted"]["cost_version_sku_rows"] = int(cur.rowcount or 0)
                if not postgres_storage.in_transaction():
                    conn.commit()
        except Exception:
            report["deleted"]["cost_version_sku_rows"] = "error"

        # 4) Cleanup datasets that may have references.
        kostprijsversies = postgres_storage.load_dataset("kostprijsversies", [])
        if isinstance(kostprijsversies, list):
            before = len(kostprijsversies)

            def _keep_kv(row: Any) -> bool:
                if not isinstance(row, dict):
                    return True
                basis = row.get("basisgegevens", {})
                if not isinstance(basis, dict):
                    basis = {}
                a_id = str(basis.get("article_id", "") or "").strip()
                s_id = str(basis.get("sku_id", "") or "").strip()
                if owned_article_id and a_id == owned_article_id:
                    return False
                if s_id == rid:
                    return False
                return True

            kostprijsversies = [row for row in kostprijsversies if _keep_kv(row)]
            report["deleted"]["kostprijsversies"] = before - len(kostprijsversies)
            postgres_storage.save_dataset("kostprijsversies", kostprijsversies, overwrite=True)

        verkoopprijzen = postgres_storage.load_dataset("verkoopprijzen", [])
        if isinstance(verkoopprijzen, list):
            before = len(verkoopprijzen)
            verkoopprijzen = [
                row
                for row in verkoopprijzen
                if not (isinstance(row, dict) and str(row.get("sku_id", "") or "").strip() == rid)
            ]
            report["deleted"]["verkoopprijzen"] = before - len(verkoopprijzen)
            postgres_storage.save_dataset("verkoopprijzen", verkoopprijzen, overwrite=True)

        # We already enforced activations==0; still remove any stale activation rows defensively.
        activations = postgres_storage.load_dataset("kostprijsproductactiveringen", [])
        if isinstance(activations, list):
            before = len(activations)
            activations = [
                row
                for row in activations
                if not (isinstance(row, dict) and str(row.get("sku_id", "") or "").strip() == rid)
            ]
            report["deleted"]["kostprijsproductactiveringen"] = before - len(activations)
            postgres_storage.save_dataset("kostprijsproductactiveringen", activations, overwrite=True)

        return {"result": report}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.post("/delete-kostprijs-concept")
def post_delete_kostprijs_concept(
    kostprijs_id: str = Query(..., description="Concept kostprijsversie om volledig terug te draaien."),
    dry_run: bool = Query(True, description="Wanneer true: alleen valideren/rapporteren, niets verwijderen."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Delete a draft costprice and the sellable model rows created around it.

    This is the reverse path for the costprice wizard. A draft may have already
    created local sellable SKUs, article rows, BOM rows, SKU composition rows and
    Douano mappings. Deleting the draft should remove those rows together, but
    only while they are still unused by activations, quotes or other products.
    """

    target_id = str(kostprijs_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="kostprijs_id is verplicht.")

    def _text(value: Any) -> str:
        return str(value or "").strip()

    def _truthy(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        return str(value or "").strip().lower() in {"1", "true", "yes", "ja", "on"}

    def _scan_ids(value: Any, keys: set[str], out: set[str]) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key in keys:
                    sid = _text(item)
                    if sid:
                        out.add(sid)
                _scan_ids(item, keys, out)
        elif isinstance(value, list):
            for item in value:
                _scan_ids(item, keys, out)

    def _snapshot_product_ids(row: dict[str, Any]) -> set[str]:
        snapshot = row.get("resultaat_snapshot")
        if not isinstance(snapshot, dict):
            snapshot = row.get("resultaat")
        if not isinstance(snapshot, dict):
            snapshot = {}
        producten = snapshot.get("producten")
        if not isinstance(producten, dict):
            producten = {}
        rows: list[Any] = []
        for key in ("basisproducten", "samengestelde_producten", "samengesteldeProducten"):
            value = producten.get(key)
            if isinstance(value, list):
                rows.extend(value)
        out: set[str] = set()
        for item in rows:
            if not isinstance(item, dict):
                continue
            pid = _text(item.get("product_id") or item.get("article_id") or item.get("format_article_id"))
            if pid:
                out.add(pid)
        return out

    try:
        kostprijsversies = postgres_storage.load_dataset("kostprijsversies", [])
        if not isinstance(kostprijsversies, list):
            kostprijsversies = []
        target = next(
            (
                row
                for row in kostprijsversies
                if isinstance(row, dict) and _text(row.get("id")) == target_id
            ),
            None,
        )
        if not isinstance(target, dict):
            raise HTTPException(status_code=404, detail=f"Kostprijsconcept '{target_id}' niet gevonden.")

        status = _text(target.get("status")).lower()
        # TODO: Remove temporary test-version rollback before production use.
        is_test_version = _truthy(target.get("is_test_version"))
        is_finalized_test_version = is_test_version and status in {"definitief", "definitive", "active", "actief"}
        if status in {"definitief", "definitive", "active", "actief"} and not is_finalized_test_version:
            raise HTTPException(status_code=409, detail="Alleen concept-kostprijzen kunnen via deze route verwijderd worden.")

        basis = target.get("basisgegevens")
        if not isinstance(basis, dict):
            basis = {}
        beer_id = _text(target.get("bier_id") or basis.get("bier_id"))
        product_ids = set() if is_finalized_test_version else _snapshot_product_ids(target)

        skus = postgres_storage.load_dataset("skus", [])
        if not isinstance(skus, list):
            skus = []
        articles = postgres_storage.load_dataset("articles", [])
        if not isinstance(articles, list):
            articles = []
        bom_lines = postgres_storage.load_dataset("bom-lines", [])
        if not isinstance(bom_lines, list):
            bom_lines = []

        sku_ids: set[str] = set()
        article_ids: set[str] = set()

        for row in skus:
            if not isinstance(row, dict):
                continue
            sid = _text(row.get("id"))
            if not sid:
                continue
            kind = _text(row.get("kind")).lower()
            row_beer_id = _text(row.get("beer_id"))
            format_article_id = _text(row.get("format_article_id"))
            article_id = _text(row.get("article_id"))
            subtype = _text(row.get("sellable_subtype")).lower()
            belongs_to_target = False
            if beer_id and row_beer_id == beer_id and format_article_id and format_article_id in product_ids:
                belongs_to_target = True
            if beer_id and row_beer_id == beer_id and article_id and article_id in product_ids:
                belongs_to_target = True
            if beer_id and row_beer_id == beer_id and kind == "article" and subtype in {"beer_bundle", "bier"}:
                belongs_to_target = True
            if sid == _text(basis.get("sku_id")):
                belongs_to_target = True
            if belongs_to_target:
                sku_ids.add(sid)
                if article_id:
                    article_ids.add(article_id)
                if format_article_id and format_article_id in product_ids:
                    article_ids.add(format_article_id)

        # Include article ids from snapshot rows only when a SKU above owns/uses them.
        article_ids = {aid for aid in article_ids if aid}

        reasons: list[str] = []

        # Active costprice usage means this is no longer a reversible draft.
        # Temporary test versions may be removed after activation; only their own activations are deleted.
        if not is_finalized_test_version:
            try:
                kostprijs_activation_storage.ensure_schema()
                with postgres_storage.connect() as conn:
                    with conn.cursor() as cur:
                        if sku_ids:
                            cur.execute(
                                """
                                SELECT sku_id, kostprijsversie_id
                                FROM kostprijs_sku_activations
                                WHERE kostprijsversie_id = %s OR sku_id = ANY(%s)
                                LIMIT 10
                                """,
                                (target_id, list(sku_ids)),
                            )
                        else:
                            cur.execute(
                                """
                                SELECT sku_id, kostprijsversie_id
                                FROM kostprijs_sku_activations
                                WHERE kostprijsversie_id = %s
                                LIMIT 10
                                """,
                                (target_id,),
                            )
                        activation_rows = cur.fetchall() or []
                        if activation_rows:
                            reasons.append("Kostprijs/SKU is al geactiveerd; concept-delete is geblokkeerd.")
            except Exception:
                reasons.append("Kon kostprijsactivaties niet verifieren.")

        # Normalized cost rows may only belong to this target version.
        if sku_ids:
            try:
                with postgres_storage.connect() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            SELECT DISTINCT version_id
                            FROM cost_version_sku_rows
                            WHERE sku_id = ANY(%s) AND version_id <> %s
                            LIMIT 10
                            """,
                            (list(sku_ids), target_id),
                        )
                        external_versions = [_text(row[0]) for row in (cur.fetchall() or []) if _text(row[0])]
                        if external_versions:
                            reasons.append(
                                "Een of meer SKU's hebben kostprijsregels in andere versies: "
                                + ", ".join(external_versions[:5])
                            )
            except Exception:
                reasons.append("Kon genormaliseerde kostprijsregels niet verifieren.")

        # Other kostprijs payloads may not reference the same SKU/article ids.
        if not is_finalized_test_version:
            for row in kostprijsversies:
                if not isinstance(row, dict) or _text(row.get("id")) == target_id:
                    continue
                found_skus: set[str] = set()
                found_articles: set[str] = set()
                _scan_ids(row, {"sku_id", "component_sku_id"}, found_skus)
                _scan_ids(row, {"product_id", "article_id", "format_article_id"}, found_articles)
                if sku_ids.intersection(found_skus) or article_ids.intersection(found_articles):
                    reasons.append(f"Kostprijsversie '{_text(row.get('id'))}' verwijst nog naar dezelfde SKU/article.")
                    break

        # A SKU may not be a component in something outside the deletion set.
        for line in bom_lines:
            if not isinstance(line, dict):
                continue
            component_sku_id = _text(line.get("component_sku_id"))
            parent_article_id = _text(line.get("parent_article_id"))
            if component_sku_id in sku_ids and parent_article_id not in article_ids:
                reasons.append("Een SKU wordt gebruikt als component in een andere samenstelling.")
                break

        # Articles may not be referenced by other SKUs that are not being deleted.
        for row in skus:
            if not isinstance(row, dict):
                continue
            sid = _text(row.get("id"))
            if sid in sku_ids:
                continue
            if _text(row.get("article_id")) in article_ids or _text(row.get("format_article_id")) in article_ids:
                reasons.append("Een article/afvuleenheid wordt nog gebruikt door een andere SKU.")
                break

        # New normalized composition table may not point at a deleted component from outside.
        if sku_ids:
            try:
                product_model_storage.ensure_schema()
                with postgres_storage.connect() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            SELECT parent_sku_id
                            FROM sku_composition_lines
                            WHERE component_sku_id = ANY(%s)
                              AND parent_sku_id <> ALL(%s)
                            LIMIT 10
                            """,
                            (list(sku_ids), list(sku_ids)),
                        )
                        external_composition = [_text(row[0]) for row in (cur.fetchall() or []) if _text(row[0])]
                        if external_composition:
                            reasons.append("Een SKU wordt gebruikt in sku_composition_lines buiten dit concept.")
            except Exception:
                reasons.append("Kon SKU-composities niet verifieren.")

        # Quote drafts are user-facing documents; never silently mutate them.
        if sku_ids:
            try:
                from app.domain import quote_drafts_storage

                quote_drafts_storage.ensure_schema()
                referenced_in_quotes = False
                with postgres_storage.connect() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT payload FROM quote_drafts")
                        for (payload,) in cur.fetchall() or []:
                            found: set[str] = set()
                            _scan_ids(payload, {"sku_id", "component_sku_id"}, found)
                            if sku_ids.intersection(found):
                                referenced_in_quotes = True
                                break
                if referenced_in_quotes:
                    reasons.append("Een SKU komt voor in offertes/prijsvoorstellen.")
            except Exception:
                reasons.append("Kon offertes niet verifieren.")

        report: dict[str, Any] = {
            "kostprijs_id": target_id,
            "dry_run": bool(dry_run),
            "can_delete": len(reasons) == 0,
            "test_version": is_test_version,
            "finalized_test_version": is_finalized_test_version,
            "blocked_reasons": reasons,
            "related": {
                "beer_id": beer_id,
                "product_ids": sorted(product_ids),
                "sku_ids": sorted(sku_ids),
                "article_ids": sorted(article_ids),
            },
            "deleted": {},
        }

        if reasons:
            if dry_run:
                return {"result": report}
            raise HTTPException(status_code=409, detail={"message": "Concept verwijderen geblokkeerd.", "reasons": reasons})

        if dry_run:
            return {"result": report}

        from app.domain import douano_product_mapping_storage

        cost_versions_storage.ensure_schema()
        product_model_storage.ensure_schema()
        douano_product_mapping_storage.ensure_schema()

        with postgres_storage.transaction():
            # Remove table-backed references first to satisfy FK restrictions.
            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    if is_finalized_test_version:
                        cur.execute("DELETE FROM kostprijs_sku_activations WHERE kostprijsversie_id = %s", (target_id,))
                        report["deleted"]["kostprijs_sku_activations"] = int(cur.rowcount or 0)
                        cur.execute("DELETE FROM kostprijs_sku_activation_events WHERE kostprijsversie_id = %s", (target_id,))
                        report["deleted"]["kostprijs_sku_activation_events"] = int(cur.rowcount or 0)
                    cur.execute("DELETE FROM cost_version_lots WHERE version_id = %s", (target_id,))
                    report["deleted"]["cost_version_lots"] = int(cur.rowcount or 0)
                    cur.execute("DELETE FROM cost_version_sku_rows WHERE version_id = %s", (target_id,))
                    report["deleted"]["cost_version_sku_rows_by_version"] = int(cur.rowcount or 0)
                    if sku_ids:
                        cur.execute("DELETE FROM cost_version_sku_rows WHERE sku_id = ANY(%s)", (list(sku_ids),))
                        report["deleted"]["cost_version_sku_rows_by_sku"] = int(cur.rowcount or 0)
                        cur.execute("DELETE FROM douano_product_mapping WHERE sku_id = ANY(%s)", (list(sku_ids),))
                        report["deleted"]["douano_product_mapping"] = int(cur.rowcount or 0)
                        cur.execute("DELETE FROM sku_family_links WHERE sku_id = ANY(%s)", (list(sku_ids),))
                        report["deleted"]["sku_family_links"] = int(cur.rowcount or 0)
                        cur.execute("DELETE FROM sku_composition_lines WHERE parent_sku_id = ANY(%s)", (list(sku_ids),))
                        report["deleted"]["sku_composition_lines"] = int(cur.rowcount or 0)

            if sku_ids:
                before = len(skus)
                skus = [
                    row
                    for row in skus
                    if not (isinstance(row, dict) and _text(row.get("id")) in sku_ids)
                ]
                report["deleted"]["skus"] = before - len(skus)
                postgres_storage.save_dataset("skus", skus, overwrite=True)

            if article_ids:
                before = len(bom_lines)
                bom_lines = [
                    row
                    for row in bom_lines
                    if not (
                        isinstance(row, dict)
                        and (
                            _text(row.get("parent_article_id")) in article_ids
                            or _text(row.get("component_sku_id")) in sku_ids
                        )
                    )
                ]
                report["deleted"]["bom-lines"] = before - len(bom_lines)
                postgres_storage.save_dataset("bom-lines", bom_lines, overwrite=True)

                before = len(articles)
                articles = [
                    row
                    for row in articles
                    if not (isinstance(row, dict) and _text(row.get("id")) in article_ids)
                ]
                report["deleted"]["articles"] = before - len(articles)
                postgres_storage.save_dataset("articles", articles, overwrite=True)

            before = len(kostprijsversies)
            kostprijsversies = [
                row
                for row in kostprijsversies
                if not (isinstance(row, dict) and _text(row.get("id")) == target_id)
            ]
            report["deleted"]["kostprijsversies"] = before - len(kostprijsversies)
            postgres_storage.save_dataset("kostprijsversies", kostprijsversies, overwrite=True)

        return {"result": report}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Delete kostprijs concept failed", exc)


@router.post("/repair/format-article-names")
def post_repair_format_article_names(
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets opslaan."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Repair polluted afvuleenheid names that accidentally include a beer/style prefix."""

    def _text(value: Any) -> str:
        return str(value or "").strip()

    def _normalize_space(value: str) -> str:
        return " ".join(value.replace(" - ", " ").split()).strip()

    try:
        articles = postgres_storage.load_dataset("articles", [])
        if not isinstance(articles, list):
            articles = []
        bieren = postgres_storage.load_dataset("bieren", [])
        if not isinstance(bieren, list):
            bieren = []

        prefixes: set[str] = set()
        for row in bieren:
            if not isinstance(row, dict):
                continue
            for key in ("biernaam", "naam", "name", "stijl"):
                value = _normalize_space(_text(row.get(key)))
                if value:
                    prefixes.add(value)

        # Longer prefixes first: "Berlewalde Blond" before "Blond".
        ordered_prefixes = sorted(prefixes, key=len, reverse=True)

        repaired: list[dict[str, Any]] = []
        next_articles: list[dict[str, Any]] = []
        for row in articles:
            if not isinstance(row, dict):
                continue
            next_row = dict(row)
            kind = _text(row.get("kind")).lower()
            name = _normalize_space(_text(row.get("name") or row.get("naam")))
            if kind == "format" and name:
                for prefix in ordered_prefixes:
                    normalized_prefix = _normalize_space(prefix)
                    lower_name = name.lower()
                    lower_prefix = normalized_prefix.lower()
                    if lower_name == lower_prefix:
                        continue
                    if lower_name.startswith(lower_prefix + " "):
                        repaired_name = name[len(normalized_prefix) :].strip(" -")
                        if repaired_name and repaired_name != name:
                            next_row["name"] = repaired_name
                            next_row["naam"] = repaired_name
                            repaired.append(
                                {
                                    "id": _text(row.get("id")),
                                    "old_name": name,
                                    "new_name": repaired_name,
                                    "removed_prefix": normalized_prefix,
                                }
                            )
                        break
            next_articles.append(next_row)

        report = {"dry_run": bool(dry_run), "count": len(repaired), "repaired": repaired}
        if not dry_run and repaired:
            postgres_storage.save_dataset("articles", next_articles, overwrite=True)
        return {"result": report}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Repair format article names failed", exc)


@router.post("/dev/delete-kostprijs-activation")
def post_dev_delete_kostprijs_activation(
    sku_id: str = Query(..., description="SKU id waarvan de kostprijs-activatie verwijderd moet worden."),
    jaar: int | None = Query(None, description="Optioneel: beperk tot jaar. Wanneer leeg: verwijder alle jaren."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Local-only dev helper: delete kostprijs activations for a SKU (development only).

    This is useful when a SKU shows up in 'Actieve kostprijzen' with an unknown kostprijsversie
    because the referenced kostprijsversie was removed during dev work.
    """
    if auth_service.environment_name() not in {"local", "dev", "development"}:
        raise HTTPException(status_code=403, detail="Delete is alleen toegestaan in local/dev.")

    target_sku_id = str(sku_id or "").strip()
    if not target_sku_id:
        raise HTTPException(status_code=400, detail="sku_id is verplicht.")

    try:
        from app.domain import kostprijs_activation_storage

        kostprijs_activation_storage.ensure_schema()
        deleted_activations = 0
        deleted_events = 0
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                if jaar is None:
                    cur.execute(
                        "DELETE FROM kostprijs_sku_activation_events WHERE sku_id = %s",
                        (target_sku_id,),
                    )
                    deleted_events = int(cur.rowcount or 0)
                    cur.execute(
                        "DELETE FROM kostprijs_sku_activations WHERE sku_id = %s",
                        (target_sku_id,),
                    )
                    deleted_activations = int(cur.rowcount or 0)
                else:
                    year_value = int(jaar or 0)
                    cur.execute(
                        "DELETE FROM kostprijs_sku_activation_events WHERE sku_id = %s AND jaar = %s",
                        (target_sku_id, year_value),
                    )
                    deleted_events = int(cur.rowcount or 0)
                    cur.execute(
                        "DELETE FROM kostprijs_sku_activations WHERE sku_id = %s AND jaar = %s",
                        (target_sku_id, year_value),
                    )
                    deleted_activations = int(cur.rowcount or 0)
            if not postgres_storage.in_transaction():
                conn.commit()
        return {
            "sku_id": target_sku_id,
            "jaar": int(jaar) if jaar is not None else None,
            "deleted": {"kostprijs_sku_activations": deleted_activations, "kostprijs_sku_activation_events": deleted_events},
        }
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.post("/dev/delete-cost-version")
def post_dev_delete_cost_version(
    version_id: str = Query(..., description="Kostprijsversie id om te verwijderen."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Local-only dev helper: delete a cost version (and its normalized cost lines).

    Safety:
    - Refuses deletion when there are active activations referencing this version id.
    """
    if auth_service.environment_name() not in {"local", "dev", "development"}:
        raise HTTPException(status_code=403, detail="Delete is alleen toegestaan in local/dev.")

    target_version_id = str(version_id or "").strip()
    if not target_version_id:
        raise HTTPException(status_code=400, detail="version_id is verplicht.")

    try:
        from app.domain import cost_versions_storage, kostprijs_activation_storage

        cost_versions_storage.ensure_schema()
        kostprijs_activation_storage.ensure_schema()

        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(*)::int
                    FROM kostprijs_sku_activations
                    WHERE kostprijsversie_id = %s
                      AND effectief_tot IS NULL
                    """,
                    (target_version_id,),
                )
                active_refs = int((cur.fetchone() or [0])[0] or 0)
                if active_refs > 0:
                    raise HTTPException(
                        status_code=409,
                        detail="Kan kostprijsversie niet verwijderen: er zijn actieve activaties die hiernaar verwijzen.",
                    )

                cur.execute("SELECT COUNT(*)::int FROM kostprijs_sku_activations WHERE kostprijsversie_id = %s", (target_version_id,))
                total_refs = int((cur.fetchone() or [0])[0] or 0)

                cur.execute("DELETE FROM kostprijs_sku_activation_events WHERE kostprijsversie_id = %s", (target_version_id,))
                deleted_activation_events = int(cur.rowcount or 0)
                cur.execute("DELETE FROM kostprijs_sku_activations WHERE kostprijsversie_id = %s", (target_version_id,))
                deleted_activations = int(cur.rowcount or 0)
                cur.execute("DELETE FROM cost_version_lots WHERE version_id = %s", (target_version_id,))
                deleted_lots = int(cur.rowcount or 0)
                cur.execute("DELETE FROM cost_version_sku_rows WHERE version_id = %s", (target_version_id,))
                deleted_sku_rows = int(cur.rowcount or 0)
                cur.execute("DELETE FROM cost_versions WHERE id = %s", (target_version_id,))
                deleted_versions = int(cur.rowcount or 0)

            if not postgres_storage.in_transaction():
                conn.commit()

        return {
            "version_id": target_version_id,
            "deleted": {
                "cost_versions": deleted_versions,
                "cost_version_lots": deleted_lots,
                "cost_version_sku_rows": deleted_sku_rows,
                "kostprijs_sku_activations": deleted_activations,
                "kostprijs_sku_activation_events": deleted_activation_events,
            },
            "references": {"activations_total": total_refs, "activations_active": active_refs},
        }
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.get("/audit/cost-lines")
def get_audit_cost_lines(
    year: int = Query(2025, description="Jaar om te auditen (default 2025)."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Admin audit: detect kostprijsversies without normalized per-SKU cost lines."""
    try:
        return {"result": cost_versions_storage.audit_sku_row_coverage(year=int(year))}
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.get("/audit/costprice-planning-state")
def get_audit_costprice_planning_state(
    year: int = Query(0, description="0 = alle jaren, anders alleen het gekozen jaar."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return {"result": cost_versions_storage.audit_planning_state(year=int(year))}
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.post("/reset/costprice-planning-state")
def post_reset_costprice_planning_state(
    year: int = Query(0, description="0 = alle jaren, anders alleen het gekozen jaar."),
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets verwijderen."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return {"result": cost_versions_storage.reset_planning_state(year=int(year), dry_run=bool(dry_run))}
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.post("/repair/cost-lines")
def post_repair_cost_lines(
    year: int = Query(2025, description="Jaar om te repareren (default 2025)."),
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets opslaan."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Admin repair: regenerate normalized per-SKU cost lines from version payload snapshots."""
    try:
        return {
            "result": cost_versions_storage.rebuild_sku_rows_for_year(year=int(year), dry_run=bool(dry_run))
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.post("/rebuild-overhead-cost-versions")
def post_rebuild_overhead_cost_versions(
    year: int = Query(2025, description="Jaar om te herberekenen (default 2025)."),
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets opslaan."),
    activate: bool = Query(True, description="Wanneer true: activeer nieuw aangemaakte versies direct."),
    active_only: bool = Query(True, description="Wanneer true: herbereken alleen versies die actief zijn in dit jaar."),
    force: bool = Query(False, description="Expliciete dev override; standaard blokkeren we muterende bulk rebuilds."),
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Phase 4: bulk rebuild overhead by minting new cost versions for a year and (optionally) activating them."""
    if not dry_run and not force:
        raise HTTPException(
            status_code=409,
            detail=(
                "Deze bulk-rebuild is gedeactiveerd voor mutaties omdat hij duplicate definitieve versies kan maken. "
                "Gebruik de planning-correctieflow of force=true alleen bewust in dev."
            ),
        )
    owner = str(session.get("username", "") or "").strip() or "admin"
    source_version_ids: list[str] | None = None
    if active_only:
        activations = dataset_store.load_dataset("kostprijsproductactiveringen")
        source_version_ids = sorted(
            {
                str(row.get("kostprijsversie_id", "") or "").strip()
                for row in (activations if isinstance(activations, list) else [])
                if isinstance(row, dict)
                and int(row.get("jaar", 0) or 0) == int(year)
                and str(row.get("kostprijsversie_id", "") or "").strip()
            }
        )
    report = cost_versions_storage.rebuild_overhead_versions_for_year(
        year=int(year),
        owner=owner,
        dry_run=bool(dry_run),
        source_version_ids=source_version_ids,
    )


@router.get("/setup/status")
def get_setup_status(
    year: int = Query(2025, ge=2000, le=2100),
) -> dict[str, Any]:
    try:
        return {"result": setup_service.build_setup_status(year=int(year))}
    except Exception as exc:
        _raise_internal_error("Setup status failed", exc)


@router.post("/setup/reset-rebuildable")
def post_setup_reset_rebuildable(
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets verwijderen."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return {"result": setup_service.reset_setup_rebuildable_data(dry_run=bool(dry_run))}
    except Exception as exc:
        _raise_internal_error("Setup reset failed", exc)


@router.get("/datamodel/audit")
def get_datamodel_audit(_: dict = Depends(require_admin)) -> dict[str, Any]:
    try:
        return {"result": product_model_storage.audit_model_integrity()}
    except Exception as exc:
        _raise_internal_error("Datamodel audit failed", exc)
    if dry_run:
        return {"result": report}

    # Rebuild normalized per-SKU cost rows so activation + dashboards see the new numbers.
    cost_versions_storage.rebuild_sku_rows_for_year(year=int(year), dry_run=False)

    activated = 0
    if activate:
        created_ids = report.get("created_version_ids") if isinstance(report, dict) else None
        if isinstance(created_ids, list):
            for version_id in created_ids:
                vid = str(version_id or "").strip()
                if not vid:
                    continue
                if dataset_store.activate_cost_version(vid, context={"action": "bulk_overhead_rebuild", "owner": owner}) is not None:
                    activated += 1

    return {"result": {**(report if isinstance(report, dict) else {}), "activated": activated}}


@router.post("/derive-production-order-drivers")
def post_derive_production_order_drivers(
    year: int = Query(2025, description="Jaar om te vullen (default 2025)."),
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets opslaan."),
    overwrite: bool = Query(False, description="Wanneer true: overschrijf bestaande waarden (anders alleen vullen als 0)."),
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Derive production 'normal' drivers from Douano order lines (order basis).

    - normal_shipments: COUNT(DISTINCT sales_order_id) for the year
    - normal_orderlines: COUNT(*) order lines for the year

    Rationale: invoice basis can merge multiple orders into one invoice; for handling costs we want the activity count.
    """
    try:
        from app.domain import douano_sync_storage

        yr = int(year or 0)
        if yr <= 0:
            raise ValueError("year is verplicht.")

        postgres_storage.ensure_schema()
        production_storage.ensure_schema()
        douano_sync_storage.ensure_schema()

        since = f"{yr:04d}-01-01"
        until = f"{yr + 1:04d}-01-01"

        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                      COUNT(DISTINCT l.sales_order_id)::int AS shipments,
                      COUNT(*)::int AS orderlines
                    FROM douano_sales_order_lines l
                    WHERE l.order_date >= %s::date
                      AND l.order_date < %s::date
                    """,
                    (since, until),
                )
                row = cur.fetchone() or (0, 0)
                shipments, orderlines = row

        result = {
            "year": yr,
            "basis": "order",
            "source": "douano_sales_order_lines",
            "computed": {"normal_shipments": int(shipments or 0), "normal_orderlines": int(orderlines or 0)},
            "dry_run": bool(dry_run),
            "overwrite": bool(overwrite),
            "owner": str(session.get("username", "") or "").strip() or "admin",
        }

        if dry_run:
            return {"result": result}

        updated = production_storage.update_order_drivers_for_year(
            jaar=yr,
            normal_shipments=float(shipments or 0),
            normal_orderlines=float(orderlines or 0),
            overwrite=bool(overwrite),
        )
        return {"result": {**result, "updated": updated}}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.post("/derive-sales-liters")
def post_derive_sales_liters(
    year: int = Query(2025, description="Jaar om te vullen (default 2025)."),
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets opslaan."),
    overwrite: bool = Query(False, description="Wanneer true: overschrijf bestaande waarden (anders alleen vullen als 0)."),
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Derive sales liters from Douano invoice lines (invoice basis).

    Liters are computed for mapped lines only:
      quantity * articles.content_liter (via douano_product_mapping -> skus -> articles)
    """
    try:
        from app.domain import douano_sync_storage

        yr = int(year or 0)
        if yr <= 0:
            raise ValueError("year is verplicht.")

        postgres_storage.ensure_schema()
        production_storage.ensure_schema()
        douano_sync_storage.ensure_schema()

        since = f"{yr:04d}-01-01"
        until = f"{yr + 1:04d}-01-01"

        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                      COALESCE(SUM(l.quantity * COALESCE(a.content_liter, 0)), 0) AS liters
                    FROM douano_sales_invoice_lines l
                    JOIN douano_product_mapping m ON m.douano_product_id = l.douano_product_id
                    LEFT JOIN skus s ON s.id = m.sku_id
                    LEFT JOIN articles a ON a.id = s.format_article_id
                    WHERE l.invoice_date >= %s::date
                      AND l.invoice_date < %s::date
                    """,
                    (since, until),
                )
                row = cur.fetchone() or (0,)
                liters = row[0] if isinstance(row, (tuple, list)) else 0

        liters_value = float(liters or 0.0)
        result = {
            "year": yr,
            "basis": "invoice",
            "source": "douano_sales_invoice_lines",
            "computed": {"sales_l": liters_value},
            "dry_run": bool(dry_run),
            "overwrite": bool(overwrite),
            "owner": str(session.get("username", "") or "").strip() or "admin",
        }

        if dry_run:
            return {"result": result}

        updated = production_storage.update_sales_liters_for_year(
            jaar=yr,
            sales_l=liters_value,
            overwrite=bool(overwrite),
        )
        return {"result": {**result, "updated": updated}}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.post("/repair/douano-companies-flat")
def post_repair_douano_companies_flat(
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets opslaan."),
    limit: int = Query(0, ge=0, le=20000, description="Optioneel: max aantal companies om te verwerken (0 = alles)."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Backfill normalized address + sales_price_class columns from douano_companies.raw_payload.

    Useful after schema migrations; avoids needing to re-sync from Douano.
    """
    try:
        postgres_storage.ensure_schema()
        douano_sync_storage.ensure_schema()

        lim = int(limit or 0)
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT company_id, raw_payload
                    FROM douano_companies
                    ORDER BY company_id
                    """
                )
                rows = cur.fetchall() or []

        processed = 0
        updated = 0
        missing_payload = 0
        sample: list[dict[str, Any]] = []

        def extract(raw: Any) -> tuple[str, str, str, str, int, str]:
            if not isinstance(raw, dict):
                return ("", "", "", "", 0, "")
            invoice = raw.get("invoice_address") if isinstance(raw.get("invoice_address"), dict) else {}
            line1 = str(invoice.get("address_line1", "") or "")
            post = str(invoice.get("post_code", "") or "")
            city = str(invoice.get("city", "") or "")
            country = ""
            cobj = invoice.get("country")
            if isinstance(cobj, dict):
                country = str(cobj.get("name", "") or "")

            spc = raw.get("sales_price_class")
            spc_id = 0
            spc_name = ""
            if isinstance(spc, dict):
                try:
                    spc_id = int(spc.get("id", 0) or 0)
                except (TypeError, ValueError):
                    spc_id = 0
                spc_name = str(spc.get("name", "") or "")
            return (line1, post, city, country, spc_id, spc_name)

        if dry_run:
            for company_id, raw_payload in rows[: min(len(rows), 10)]:
                raw = raw_payload if isinstance(raw_payload, dict) else {}
                line1, post, city, country, spc_id, spc_name = extract(raw)
                sample.append(
                    {
                        "company_id": int(company_id or 0),
                        "invoice_address": {"address_line1": line1, "post_code": post, "city": city, "country": country},
                        "sales_price_class": {"id": spc_id, "name": spc_name},
                    }
                )
            return {
                "result": {
                    "dry_run": True,
                    "total_companies": len(rows),
                    "sample": sample,
                }
            }

        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                for company_id, raw_payload in rows:
                    if lim and processed >= lim:
                        break
                    processed += 1
                    cid = int(company_id or 0)
                    raw = raw_payload if isinstance(raw_payload, dict) else {}
                    if not raw:
                        missing_payload += 1
                    line1, post, city, country, spc_id, spc_name = extract(raw)
                    cur.execute(
                        """
                        UPDATE douano_companies
                        SET
                          invoice_address_line1 = %s,
                          invoice_post_code = %s,
                          invoice_city = %s,
                          invoice_country = %s,
                          sales_price_class_id = %s,
                          sales_price_class_name = %s
                        WHERE company_id = %s
                        """,
                        (line1, post, city, country, int(spc_id or 0), spc_name, cid),
                    )
                    if int(cur.rowcount or 0) > 0:
                        updated += 1
            if not postgres_storage.in_transaction():
                conn.commit()

        return {
            "result": {
                "dry_run": False,
                "processed": processed,
                "updated": updated,
                "missing_payload": missing_payload,
            }
        }
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


def _hash_address(*parts: str) -> str:
    import hashlib

    normalized = "|".join([str(p or "").strip().lower() for p in parts])
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


@router.post("/ors/compute-company-distances")
async def post_compute_company_distances(
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets opslaan."),
    overwrite: bool = Query(False, description="Wanneer true: overschrijf bestaande cache entries."),
    limit: int = Query(500, ge=1, le=5000, description="Max aantal companies om te verwerken."),
    exclude_particulier: bool = Query(True, description="Wanneer true: sla Particulier over op basis van sales_price_class_name."),
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Compute and cache driving distance (km one-way) from brewery to customers via ORS.

    Requires env var: CALCULATIETOOL_ORS_API_KEY

    Brewery origin is currently fixed for MVP:
      Enkweg 2A, 7021 KD Zelhem, NL

    Notes:
    - Uses invoice address only (delivery address not available yet).
    - Caches per company_id with address_hash.
    """
    try:
        # This endpoint writes to PostgreSQL. We must commit those writes explicitly;
        # the request middleware rolls back pooled connections after each request.
        with postgres_storage.transaction():
            postgres_storage.ensure_schema()
            douano_sync_storage.ensure_schema()
            company_distance_storage.ensure_schema()

            ors = OrsClient()
            if not ors.is_configured():
                raise HTTPException(status_code=400, detail="ORS API key ontbreekt (CALCULATIETOOL_ORS_API_KEY).")

            owner = str(session.get("username", "") or "").strip() or "admin"

            brewery_query = "Enkweg 2A, 7021 KD Zelhem, Nederland"
            brewery_coord = await ors.geocode(brewery_query, country="NL")
            if brewery_coord is None:
                raise HTTPException(status_code=400, detail="Brouwerijadres kon niet worden geocoded via ORS.")

            lim = int(limit or 500)
            lim = max(1, min(lim, 5000))
            where_parts = ["is_customer = TRUE"]
            params: list[Any] = []
            if exclude_particulier:
                where_parts.append("LOWER(COALESCE(sales_price_class_name, '')) <> 'particulier'")
            where_parts.append("COALESCE(invoice_address_line1, '') <> ''")
            where_parts.append("COALESCE(invoice_post_code, '') <> ''")
            where = " AND ".join(where_parts)

            # Selection strategy:
            # - When overwrite=false, we may hit a prefix of already-cached OK customers (ORDER BY company_id).
            #   To avoid returning "cached skip N / updated 0" while there are still pending customers later,
            #   we scan a wider window and stop once we *computed* `lim` customers (or run out).
            # - When overwrite=true, scan_limit == lim (recompute everything in that window).
            scan_limit = lim if overwrite else min(5000, lim * 50)
            params.append(scan_limit)

            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        f"""
                        SELECT
                          company_id,
                          COALESCE(public_name, '') AS public_name,
                          COALESCE(name, '') AS name,
                          COALESCE(invoice_address_line1, '') AS line1,
                          COALESCE(invoice_post_code, '') AS post_code,
                          COALESCE(invoice_city, '') AS city,
                          COALESCE(invoice_country, '') AS country,
                          COALESCE(sales_price_class_name, '') AS price_class
                        FROM douano_companies
                        WHERE {where}
                        ORDER BY company_id
                        LIMIT %s
                        """
                    ,
                        tuple(params),
                    )
                    companies = cur.fetchall() or []

            processed = 0
            skipped_cached = 0
            geocode_failed = 0
            routed_failed = 0
            updated = 0
            results_sample: list[dict[str, Any]] = []

            for row in companies:
                # Stop once we've actually computed `lim` entries (ok + failures).
                if not overwrite and (updated + geocode_failed + routed_failed) >= lim:
                    break
                (
                    company_id,
                    public_name,
                    name,
                    line1,
                    post_code,
                    city,
                    country,
                    price_class,
                ) = row
                cid = int(company_id or 0)
                if cid <= 0:
                    continue
                processed += 1

                address_hash = _hash_address(line1, post_code, city, country)
                cached = company_distance_storage.get_cache(cid)
                if cached and not overwrite:
                    if str(cached.get("address_hash", "") or "") == address_hash and str(cached.get("status", "") or "") == "ok":
                        skipped_cached += 1
                        continue

                query = f"{line1}, {post_code} {city}, {country or 'Nederland'}"
                coord = await ors.geocode(query, country="NL", focus=Coordinate(lat=brewery_coord.lat, lng=brewery_coord.lng))
                if coord is None:
                    geocode_failed += 1
                    if not dry_run:
                        company_distance_storage.upsert_distance(
                            company_id=cid,
                            address_hash=address_hash,
                            lat=0,
                            lng=0,
                            distance_km_one_way=0,
                            status="geocode_failed",
                            error="geocode_failed",
                        )
                    continue

                km = await ors.driving_distance_km_one_way(
                    Coordinate(lat=brewery_coord.lat, lng=brewery_coord.lng),
                    Coordinate(lat=coord.lat, lng=coord.lng),
                )
                if km is None:
                    routed_failed += 1
                    if not dry_run:
                        company_distance_storage.upsert_distance(
                            company_id=cid,
                            address_hash=address_hash,
                            lat=coord.lat,
                            lng=coord.lng,
                            distance_km_one_way=0,
                            status="route_failed",
                            error="route_failed",
                        )
                    continue

                updated += 1
                if not dry_run:
                    company_distance_storage.upsert_distance(
                        company_id=cid,
                        address_hash=address_hash,
                        lat=coord.lat,
                        lng=coord.lng,
                        distance_km_one_way=km,
                        status="ok",
                        error="",
                    )

                if len(results_sample) < 15:
                    results_sample.append(
                        {
                            "company_id": cid,
                            "company_name": str(public_name or name or ""),
                            "sales_price_class": str(price_class or ""),
                            "address": f"{line1}, {post_code} {city}",
                            "customer_coord": {"lat": coord.lat, "lng": coord.lng},
                            "distance_km_one_way": round(float(km or 0), 2),
                        }
                    )

            return {
                "result": {
                    "dry_run": bool(dry_run),
                    "owner": owner,
                    "brewery_query": brewery_query,
                    "brewery_coord": {"lat": brewery_coord.lat, "lng": brewery_coord.lng},
                    "exclude_particulier": bool(exclude_particulier),
                    "overwrite": bool(overwrite),
                    "limit": lim,
                    "processed": processed,
                    "skipped_cached": skipped_cached,
                    "geocode_failed": geocode_failed,
                    "route_failed": routed_failed,
                    "updated": updated,
                    "sample": results_sample,
                }
            }
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.get("/ors/company-distance-cache")
def get_company_distance_cache(
    company_id: int = Query(..., ge=1, description="Douano company_id om cache voor op te halen."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Debug helper: return raw cached distance entry for a company_id (if any)."""
    try:
        postgres_storage.ensure_schema()
        company_distance_storage.ensure_schema()
        cached = company_distance_storage.get_cache(int(company_id))
        return {"company_id": int(company_id), "cache": cached}
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.post("/repair/inkoop-unit-costs")
def post_repair_inkoop_unit_costs(
    year: int = Query(2025, description="Jaar om te repareren (default 2025)."),
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets opslaan."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Admin repair: recompute definitive inkoop snapshots using unit-cost SSOT and rebuild sku rows."""
    try:
        return {
            "result": cost_versions_storage.repair_inkoop_unit_costs_for_year(year=int(year), dry_run=bool(dry_run))
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.post("/repair/kostprijs-activation-sku-mismatches")
def post_repair_kostprijs_activation_sku_mismatches(
    year: int = Query(0, description="Optioneel: alleen dit jaar (0 = alle jaren)."),
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets verwijderen."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Admin repair: remove activation rows that point to a cost version belonging to a different SKU.

    Problem we fix:
    - `kostprijsproductactiveringen.sku_id` -> `kostprijsversie_id`
    - but the referenced cost version's `basisgegevens.sku_id` is a *different* SKU

    This corrupts "active cost" resolution (two SKUs can show the same cost version).

    Approach:
    - Build a map version_id -> version.basisgegevens.sku_id (when present)
    - Flag activations where the cost version has a non-empty sku_id that != activation.sku_id
    - Optionally hard delete the offending activation rows (safe because they are invalid history)
    """
    try:
        from app.domain import cost_versions_storage, kostprijs_activation_storage

        cost_versions_storage.ensure_schema()
        kostprijs_activation_storage.ensure_schema()

        year_value = int(year or 0)
        activations = kostprijs_activation_storage.load_activations()
        if year_value > 0:
            activations = [a for a in activations if int(a.get("jaar", 0) or 0) == year_value]

        versions = cost_versions_storage.load_dataset([])
        version_sku_by_id: dict[str, str] = {}
        version_year_by_id: dict[str, int] = {}
        for v in versions if isinstance(versions, list) else []:
            if not isinstance(v, dict):
                continue
            vid = str(v.get("id", "") or "")
            if not vid:
                continue
            basis = v.get("basisgegevens")
            sku_from_version = ""
            if isinstance(basis, dict):
                sku_from_version = str(basis.get("sku_id", "") or "")
            version_sku_by_id[vid] = sku_from_version
            try:
                version_year_by_id[vid] = int(v.get("jaar", 0) or 0)
            except Exception:
                version_year_by_id[vid] = 0

        mismatches: list[dict[str, Any]] = []
        for act in activations:
            if not isinstance(act, dict):
                continue
            act_id = str(act.get("id", "") or "")
            act_sku = str(act.get("sku_id", "") or "")
            act_year = int(act.get("jaar", 0) or 0)
            act_version_id = str(act.get("kostprijsversie_id", "") or "")
            if not act_id or not act_sku or not act_version_id:
                continue
            version_sku = str(version_sku_by_id.get(act_version_id, "") or "")
            if not version_sku:
                # Legacy/inkoop/productie versions often have no sku_id in basisgegevens; can't validate.
                continue
            if version_sku != act_sku:
                mismatches.append(
                    {
                        "activation": {
                            "id": act_id,
                            "sku_id": act_sku,
                            "jaar": act_year,
                            "kostprijsversie_id": act_version_id,
                            "effectief_tot": str(act.get("effectief_tot", "") or ""),
                        },
                        "cost_version": {
                            "id": act_version_id,
                            "jaar": int(version_year_by_id.get(act_version_id, 0) or 0),
                            "basis_sku_id": version_sku,
                        },
                        "reason": "activation_sku_mismatch",
                    }
                )

        if dry_run:
            return {
                "dry_run": True,
                "year": year_value,
                "mismatches": {
                    "count": len(mismatches),
                    "sample": mismatches[:10],
                },
            }

        if not mismatches:
            return {"dry_run": False, "year": year_value, "deleted": {"activations": 0}, "mismatches": {"count": 0}}

        ids_to_delete = [m["activation"]["id"] for m in mismatches if isinstance(m.get("activation"), dict)]
        deleted = 0
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM kostprijs_sku_activations
                    WHERE id = ANY(%s)
                    """,
                    (ids_to_delete,),
                )
                deleted = int(cur.rowcount or 0)
            if not postgres_storage.in_transaction():
                conn.commit()

        return {
            "dry_run": False,
            "year": year_value,
            "deleted": {"activations": deleted},
            "mismatches": {"count": len(mismatches), "sample": mismatches[:10]},
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)


@router.get("/health/kostprijs-activation-sku-mismatches")
def get_health_kostprijs_activation_sku_mismatches(
    year: int = Query(0, description="Optioneel: alleen dit jaar (0 = alle jaren)."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Read-only health check for activation->cost version SKU mismatches.

    This is a safe alias for the repair endpoint in `dry_run=true` mode.
    """
    return post_repair_kostprijs_activation_sku_mismatches(year=int(year), dry_run=True, _={})


@router.post("/repair/beer-bundles")
def post_repair_beer_bundles(
    year: int = Query(2025, description="Jaar om te gebruiken voor activatie-detectie (default 2025)."),
    dry_run: bool = Query(True, description="Wanneer true: alleen rapporteren, niets opslaan."),
    beer_id: str = Query("", description="Beer id om te koppelen (bijv. Berlewalde Blond)."),
    packaging_type: str = Query("", description="Verpakkingstype id (bijv. doos-12x33cl)."),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Admin repair: migrate/dedupe "beer bundles".

    A "beer bundle" is an article-SKU that is really a sellable packaging variant of a single beer
    (e.g. Berlewalde Blond - Doos 12×33cl). These should carry:
    - `skus.beer_id` so UI/reporting can group under the beer/style
    - `skus.packaging_type` for deterministic selection/grouping
    - `skus.sellable_subtype="beer_bundle"`

    This endpoint:
    - picks one candidate SKU to keep (prefers active activation in `year`)
    - updates that SKU to include the metadata above
    - deactivates other matching SKUs (safe alternative to hard delete)
    """

    def normalize_name(value: str) -> str:
        return (
            str(value or "")
            .strip()
            .lower()
            .replace("*", "x")
            .replace("×", "x")
            .replace("Ã—", "x")
        )

    def packaging_tokens(value: str) -> set[str]:
        normalized = normalize_name(value)
        # Make tokens comparable to SKU names like "Doos 12 x 33cl" (packaging_type often uses "12x33cl").
        expanded = normalized.replace("-", " ").replace("x", " x ")
        return {tok for tok in expanded.split(" ") if tok.strip()}

    try:
        target_beer_id = str(beer_id or "").strip()
        target_packaging_type = str(packaging_type or "").strip()
        if not target_beer_id:
            raise ValueError("beer_id is verplicht.")
        if not target_packaging_type:
            raise ValueError("packaging_type is verplicht.")

        verpakkingstypen = dataset_store.load_dataset("verpakkingstypen")
        verpakkingstypen_list = (
            [row for row in verpakkingstypen if isinstance(row, dict)] if isinstance(verpakkingstypen, list) else []
        )
        allowed_packaging_ids = {
            str(row.get("id", "") or "").strip()
            for row in verpakkingstypen_list
            if bool(row.get("active", True))
        }
        if target_packaging_type not in allowed_packaging_ids:
            raise ValueError(
                f"Onbekend verpakkingstype \"{target_packaging_type}\". Voeg deze eerst toe via stamdata (verpakkingstypen)."
            )

        skus = postgres_storage.load_dataset("skus", [])
        articles = postgres_storage.load_dataset("articles", [])
        activations = postgres_storage.load_dataset("kostprijsproductactiveringen", [])

        skus_list = [row for row in skus if isinstance(row, dict)] if isinstance(skus, list) else []
        articles_list = [row for row in articles if isinstance(row, dict)] if isinstance(articles, list) else []
        activations_list = [row for row in activations if isinstance(row, dict)] if isinstance(activations, list) else []

        wanted_tokens = packaging_tokens(target_packaging_type)

        candidates: list[dict[str, Any]] = []
        for row in skus_list:
            if str(row.get("kind", "") or "").strip().lower() != "article":
                continue

            row_beer_id = str(row.get("beer_id", "") or "").strip()
            if row_beer_id and row_beer_id != target_beer_id:
                continue

            existing_packaging_type = str(row.get("packaging_type", "") or "").strip()
            if existing_packaging_type == target_packaging_type:
                candidates.append(row)
                continue

            name = str(row.get("name", row.get("naam", "")) or "").strip()
            n = normalize_name(name)
            if not n:
                continue
            expanded_name = n.replace("-", " ").replace("x", " x ")
            name_tokens = {tok for tok in expanded_name.split(" ") if tok.strip()}
            if wanted_tokens.issubset(name_tokens):
                candidates.append(row)

        active_skus_for_year: set[str] = set()
        for act in activations_list:
            if int(act.get("jaar", 0) or 0) != int(year):
                continue
            if str(act.get("effectief_tot", "") or "").strip():
                continue
            sid = str(act.get("sku_id", "") or "").strip()
            if sid:
                active_skus_for_year.add(sid)

        keep: dict[str, Any] | None = None
        for row in candidates:
            sid = str(row.get("id", "") or "").strip()
            if sid and sid in active_skus_for_year:
                keep = row
                break
        if keep is None and candidates:
            keep = sorted(candidates, key=lambda r: str(r.get("id", "") or ""))[0]

        keep_sku_id = str((keep or {}).get("id", "") or "").strip()
        keep_article_id = str((keep or {}).get("article_id", "") or "").strip()
        deactivate_candidates = [
            r
            for r in candidates
            if str(r.get("id", "") or "").strip() and str(r.get("id", "") or "").strip() != keep_sku_id
        ]

        report: dict[str, Any] = {
            "year": int(year),
            "dry_run": bool(dry_run),
            "beer_id": target_beer_id,
            "packaging_type": target_packaging_type,
            "candidates": [str(r.get("id", "") or "") for r in candidates],
            "keep_sku_id": keep_sku_id,
            "deactivate_sku_ids": [str(r.get("id", "") or "") for r in deactivate_candidates],
            "mutations": {"updated": 0, "deactivated": 0},
        }

        if not keep_sku_id:
            report["note"] = "Geen candidates gevonden."
            return {"result": report}

        next_skus: list[dict[str, Any]] = []
        for row in skus_list:
            sid = str(row.get("id", "") or "").strip()
            if not sid:
                continue
            if sid != keep_sku_id:
                next_skus.append(row)
                continue
            next_row = dict(row)
            next_row["beer_id"] = target_beer_id
            next_row["packaging_type"] = target_packaging_type
            next_row["sellable_subtype"] = "beer_bundle"
            # A beer bundle behaves like a beer sellable (not a giftset), so classify it under the beer product group.
            next_row["product_group"] = "drank"
            next_skus.append(next_row)
            report["mutations"]["updated"] += 1

        next_articles: list[dict[str, Any]] = []
        for row in articles_list:
            aid = str(row.get("id", "") or "").strip()
            if not aid:
                continue
            if aid != keep_article_id:
                next_articles.append(row)
                continue
            next_row = dict(row)
            next_row["packaging_type"] = target_packaging_type
            next_row["sellable_subtype"] = "beer_bundle"
            next_articles.append(next_row)

        deactivate_ids = {
            str(r.get("id", "") or "").strip()
            for r in deactivate_candidates
            if str(r.get("id", "") or "").strip()
        }
        if deactivate_ids:
            patched_skus: list[dict[str, Any]] = []
            for row in next_skus:
                sid = str(row.get("id", "") or "").strip()
                if sid in deactivate_ids:
                    next_row = dict(row)
                    next_row["active"] = False
                    next_row["actief"] = False
                    patched_skus.append(next_row)
                    report["mutations"]["deactivated"] += 1
                else:
                    patched_skus.append(row)
            next_skus = patched_skus

        if dry_run:
            return {"result": report}

        postgres_storage.save_dataset("skus", next_skus, overwrite=True)
        postgres_storage.save_dataset("articles", next_articles, overwrite=True)
        return {"result": report}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Meta endpoint failed", exc)

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
    return {
        "drafts": drafts,
        "production_years": production_years,
        "last_year": last_year,
        "commercial_authority": commercial_yearset_service.authority_overview(
            fallback_year=last_year
        ),
    }


@router.get("/commercial-yearsets")
def get_commercial_yearsets(
    fallback_year: int = Query(
        0,
        ge=0,
        description="Expliciet legacy fallbackjaar; 0 betekent geen fallback.",
    ),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    return commercial_yearset_service.authority_overview(
        fallback_year=int(fallback_year)
    )


@router.get("/commercial-yearsets/{operational_year}/dossier")
def get_commercial_yearset_dossier(
    operational_year: int,
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Return one finalized yearset as a strictly read-only dossier."""

    if int(operational_year or 0) <= 0:
        raise HTTPException(status_code=422, detail="Jaar moet groter zijn dan nul.")
    return yearset_dossier_service.read_yearset_dossier(
        int(operational_year)
    )


@router.post("/commercial-yearsets/backfill")
def post_commercial_yearset_backfill(
    payload: CommercialYearsetBackfillRequest,
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return commercial_yearset_service.create_legacy_candidate(
            operational_year=int(payload.operational_year),
            source_year=int(payload.source_year),
            actor=str(session.get("username", "") or ""),
            dry_run=bool(payload.dry_run),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/commercial-yearsets/{generation_id}/activate")
def post_commercial_yearset_activate(
    generation_id: str,
    payload: CommercialYearsetActivationRequest,
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return {
            "generation": commercial_yearset_service.activate_candidate(
                generation_id=str(generation_id),
                actor=str(session.get("username", "") or ""),
                expected_validation_hash=str(payload.expected_validation_hash),
                expected_active_generation_id=payload.expected_active_generation_id,
                reason=str(payload.reason or ""),
                action="activate",
            )
        }
    except commercial_yearset_storage.CommercialYearsetConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except commercial_yearset_storage.CommercialYearsetBlocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/commercial-yearsets/{generation_id}/rollback")
def post_commercial_yearset_rollback(
    generation_id: str,
    payload: CommercialYearsetRollbackRequest,
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return {
            "generation": commercial_yearset_service.activate_candidate(
                generation_id=str(generation_id),
                actor=str(session.get("username", "") or ""),
                expected_validation_hash=str(payload.expected_validation_hash),
                expected_active_generation_id=str(
                    payload.expected_active_generation_id
                ),
                reason=str(payload.reason),
                action="rollback",
            )
        }
    except commercial_yearset_storage.CommercialYearsetConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except commercial_yearset_storage.CommercialYearsetBlocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/commercial-yearsets/reconciliations")
def get_commercial_yearset_reconciliations(
    target_year: int = Query(0, ge=0, le=2100),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    return yearset_reconciliation_service.aggregate_overview(
        target_year=int(target_year)
    )


@router.get("/commercial-yearsets/reconciliation-blockers")
def get_commercial_yearset_reconciliation_blockers(
    source_year: int = Query(..., ge=2000, le=2100),
    target_year: int = Query(..., ge=2000, le=2100),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Admin-only, amount-free worklist for the current candidate blockers."""

    try:
        return yearset_reconciliation_service.review_current_blockers(
            source_year=int(source_year),
            target_year=int(target_year),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/commercial-yearsets/reconciliation-lineage")
def get_commercial_yearset_reconciliation_lineage(
    source_year: int = Query(..., ge=2000, le=2100),
    target_year: int = Query(..., ge=2000, le=2100),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Admin-only, amount-free lineage classification for current blockers."""

    try:
        return yearset_blocker_lineage_service.review_current_lineage(
            source_year=int(source_year),
            target_year=int(target_year),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/commercial-yearsets/recovery/preview")
def post_commercial_yearset_recovery_preview(
    payload: YearsetRecoveryRequest,
    _: dict = Depends(require_cost_activation),
) -> dict[str, Any]:
    """Preview the exact approved-input projection without persisting it."""

    try:
        return yearset_recovery_service.preview(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/commercial-yearsets/recovery/approve")
def post_commercial_yearset_recovery_approve(
    payload: YearsetRecoveryRequest,
    session: dict = Depends(require_cost_activation),
) -> dict[str, Any]:
    """Persist one Management-approved input; no legacy row is overwritten."""

    try:
        return yearset_recovery_service.approve(
            payload,
            actor=str(session.get("username", "") or ""),
            actor_role=str(session.get("role", "") or ""),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except yearset_recovery_storage.YearsetRecoveryConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/commercial-yearsets/recovery-inputs")
def get_commercial_yearset_recovery_inputs(
    target_year: int = Query(0, ge=0, le=2100),
    _: dict = Depends(require_admin),
) -> dict[str, Any]:
    return {
        "items": yearset_recovery_storage.list_inputs(
            target_year=int(target_year)
        ),
        "consumer_mode": "compatibility_only",
        "data_rewritten": False,
    }


@router.post("/commercial-yearsets/reconcile")
def post_commercial_yearset_reconcile(
    payload: YearsetReconciliationRequest,
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return yearset_reconciliation_service.reconcile(
            source_year=int(payload.source_year),
            target_year=int(payload.target_year),
            actor=str(session.get("username", "") or ""),
            dry_run=bool(payload.dry_run),
            expected_manifest_hash=str(payload.expected_manifest_hash or ""),
        )
    except yearset_reconciliation_storage.YearsetReconciliationConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/commercial-yearsets/reconciliations/{run_id}/approve")
def post_commercial_yearset_reconciliation_approve(
    run_id: str,
    payload: YearsetReconciliationApprovalRequest,
    session: dict = Depends(require_cost_activation),
) -> dict[str, Any]:
    try:
        return {
            "run": yearset_reconciliation_service.approve(
                str(run_id),
                expected_manifest_hash=str(payload.expected_manifest_hash),
                actor=str(session.get("username", "") or ""),
                actor_role=str(session.get("role", "") or ""),
                reason=str(payload.reason),
            )
        }
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except yearset_reconciliation_storage.YearsetReconciliationConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except yearset_reconciliation_storage.YearsetReconciliationBlocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/commercial-yearsets/reconciliations/{run_id}/activate")
def post_commercial_yearset_reconciliation_activate(
    run_id: str,
    payload: YearsetReconciliationActivationRequest,
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return yearset_reconciliation_service.activate(
            str(run_id),
            expected_manifest_hash=str(payload.expected_manifest_hash),
            expected_active_generation_id=payload.expected_active_generation_id,
            actor=str(session.get("username", "") or ""),
            actor_role=str(session.get("role", "") or ""),
            reason=str(payload.reason),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except yearset_reconciliation_storage.YearsetReconciliationConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except yearset_reconciliation_storage.YearsetReconciliationBlocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except commercial_yearset_storage.CommercialYearsetConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except commercial_yearset_storage.CommercialYearsetBlocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/commercial-yearsets/reconciliations/{run_id}/rollback")
def post_commercial_yearset_reconciliation_rollback(
    run_id: str,
    payload: YearsetReconciliationActivationRequest,
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return yearset_reconciliation_service.activate(
            str(run_id),
            expected_manifest_hash=str(payload.expected_manifest_hash),
            expected_active_generation_id=payload.expected_active_generation_id,
            actor=str(session.get("username", "") or ""),
            actor_role=str(session.get("role", "") or ""),
            reason=str(payload.reason),
            action="rollback",
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except yearset_reconciliation_storage.YearsetReconciliationConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except yearset_reconciliation_storage.YearsetReconciliationBlocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except commercial_yearset_storage.CommercialYearsetConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except commercial_yearset_storage.CommercialYearsetBlocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/cost-authority")
def get_cost_authority(_: dict = Depends(require_admin)) -> dict[str, Any]:
    """Aggregate-only RF-013B state; no prices, names, LOTs or identifiers."""

    return cost_authority_storage.authority_overview()


@router.post("/cost-authority/backfill")
def post_cost_authority_backfill(
    payload: CostAuthorityBackfillRequest,
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return cost_authority_service.backfill_legacy_authority(
            actor=str(session.get("username", "") or ""),
            dry_run=bool(payload.dry_run),
            expected_manifest_hash=str(payload.expected_manifest_hash or ""),
        )
    except cost_authority_storage.PlanningCostConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/cost-authority/mappings/{mapping_id}/approve-beer")
def post_cost_authority_approve_beer_mapping(
    mapping_id: str,
    payload: CostVersionBeerMappingApprovalRequest,
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return {
            "mapping": cost_authority_storage.approve_cost_version_beer_mapping(
                str(mapping_id),
                canonical_beer_id=str(payload.canonical_beer_id),
                expected_source_hash=str(payload.expected_source_hash),
                review_reason=str(payload.review_reason),
                actor=str(session.get("username", "") or ""),
                actor_role=str(session.get("role", "") or ""),
            )
        }
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except cost_authority_storage.PlanningCostConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except cost_authority_storage.PlanningCostBlocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/planning-cost-rebaseline")
def post_planning_cost_rebaseline_prepare(
    payload: PlanningCostRebaselinePrepareRequest,
    session: dict = Depends(require_cost_draft),
) -> dict[str, Any]:
    try:
        return {
            "request": cost_authority_storage.prepare_rebaseline(
                sku_id=str(payload.sku_id),
                planning_year=int(payload.planning_year),
                cost_version_id=str(payload.cost_version_id),
                reason=str(payload.reason),
                actor=str(session.get("username", "") or ""),
                actor_role=str(session.get("role", "") or ""),
            )
        }
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except cost_authority_storage.PlanningCostBlocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/planning-cost-rebaseline/{request_id}/approve")
def post_planning_cost_rebaseline_approve(
    request_id: str,
    session: dict = Depends(require_cost_activation),
) -> dict[str, Any]:
    try:
        return {
            "request": cost_authority_storage.approve_rebaseline(
                str(request_id),
                actor=str(session.get("username", "") or ""),
                actor_role=str(session.get("role", "") or ""),
            )
        }
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except cost_authority_storage.PlanningCostConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/planning-cost-rebaseline/{request_id}/execute")
def post_planning_cost_rebaseline_execute(
    request_id: str,
    session: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        return {
            "request": cost_authority_storage.execute_rebaseline(
                str(request_id),
                actor=str(session.get("username", "") or ""),
                actor_role=str(session.get("role", "") or ""),
            )
        }
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except cost_authority_storage.PlanningCostConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except cost_authority_storage.PlanningCostBlocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


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
    if commercial_yearset_storage.get_active_generation():
        raise HTTPException(
            status_code=409,
            detail=(
                "Destructieve legacy-rollback is geblokkeerd zodra een commerciële "
                "jaarset actief is. Gebruik de generation-pointer rollback."
            ),
        )
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
    if commercial_yearset_storage.get_active_generation():
        raise HTTPException(
            status_code=409,
            detail=(
                "Verwijderen van jaargegevens is geblokkeerd zodra een commerciële "
                "jaarset actief is. Gebruik de generation-pointer rollback."
            ),
        )
    try:
        return dataset_store.rollback_year(year=int(year), dry_run=bool(dry_run))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

