from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from typing import Any

from app.domain import dashboard_service
from app.domain import fixed_costs_storage, postgres_storage, production_storage
from app.domain import kostprijs_activation_storage
from app.utils import json_seed
from app.utils.storage import (
    MODEL_A_DATASET_NAMES,
    build_model_a_canonical_datasets,
    ensure_complete_verkoop_records,
    activate_kostprijsversie,
    activate_kostprijsversie_products,
    load_basisproducten,
    load_kostprijsproductactiveringen,
    load_kostprijsversies,
    get_vaste_kosten_per_liter_for_year,
    bereken_indirecte_vaste_kosten_per_ingekochte_liter,
    bereken_directe_vaste_kosten_per_productieliter_herverdeeld,
    bereken_accijns_voor_liters,
    resolve_basisproduct_for_year,
    resolve_samengesteld_product_for_year,
    load_packaging_component_masters,
    load_packaging_component_prices,
    load_packaging_component_price_versions,
    load_samengestelde_producten,
    load_catalog_products,
    load_verpakkingsonderdelen,
    load_all_verkoop_records,
    normalize_any_verkoop_record,
    normalize_berekening_record,
    migrate_product_ids_to_master_ids,
    generate_missing_kostprijsproductactiveringen,
    duplicate_productie_to_year,
    duplicate_vaste_kosten_to_year,
    duplicate_tarieven_heffingen_to_year,
    duplicate_verpakkingsonderdelen_to_year,
    duplicate_packaging_component_prices_to_year,
    duplicate_verkoopstrategie_verpakkingen_to_year,
    save_berekeningen,
    save_basisproducten,
    save_kostprijsproductactiveringen,
    save_packaging_component_masters,
    save_packaging_component_prices,
    save_packaging_component_price_versions,
    save_verpakkingsonderdelen,
    save_samengestelde_producten,
    save_catalog_products,
)

from datetime import UTC, datetime
from uuid import uuid4


DATASET_DEFAULTS: dict[str, Any] = {
    "productie": {},
    "vaste-kosten": {},
    "tarieven-heffingen": [],
    "channels": [
        {"id": "horeca", "code": "horeca", "naam": "Horeca", "actief": True, "volgorde": 10, "default_marge_pct": 50, "default_factor": 3.5},
        {"id": "retail", "code": "retail", "naam": "Supermarkt", "actief": True, "volgorde": 20, "default_marge_pct": 30, "default_factor": 2.4},
        {"id": "slijterij", "code": "slijterij", "naam": "Slijterij", "actief": True, "volgorde": 30, "default_marge_pct": 40, "default_factor": 3.0},
        {"id": "zakelijk", "code": "zakelijk", "naam": "Speciaalzaak", "actief": True, "volgorde": 40, "default_marge_pct": 45, "default_factor": 3.2},
        {"id": "particulier", "code": "particulier", "naam": "Particulier", "actief": False, "volgorde": 50, "default_marge_pct": 50, "default_factor": 3.0},
    ],
    "verpakkingsonderdelen": [],
    "basisproducten": [],
    "samengestelde-producten": [],
    "packaging-components": [],
    "packaging-component-prices": [],
    "packaging-component-price-versions": [],
    "base-product-masters": [],
    "composite-product-masters": [],
    "bieren": [],
    "kostprijsversies": [],
    "kostprijsproductactiveringen": [],
    "berekeningen": [],
    "verkoopprijzen": [],
    "adviesprijzen": [],
    "break-even-configuraties": [],
    "catalog-products": [],
    "glasmaten": [
        {"id": "glas-20cl", "label": "20 cl", "volume_ml": 200, "sort_order": 10, "active": True, "is_default": False},
        {"id": "glas-25cl", "label": "25 cl", "volume_ml": 250, "sort_order": 20, "active": True, "is_default": True},
        {"id": "glas-30cl", "label": "30 cl", "volume_ml": 300, "sort_order": 30, "active": True, "is_default": False},
        {"id": "glas-33cl", "label": "33 cl", "volume_ml": 330, "sort_order": 40, "active": True, "is_default": False},
        {"id": "glas-50cl", "label": "50 cl", "volume_ml": 500, "sort_order": 50, "active": True, "is_default": False},
    ],
    "variabele-kosten": {},
    # Phase SKU: single source of truth for everything you can buy/sell/consume/compose.
    "articles": [],
    "skus": [],
    "bom-lines": [],
    "products": [],
    "product-years": [],
    "product-year-components": [],
    "product-components": [],
    "sales-strategy-years": [],
    "sales-strategy-products": [],
    "cost-calcs": [],
    "cost-calc-inputs": [],
    "cost-calc-results": [],
    "cost-calc-lines": [],
    # Draft storage for "Nieuw jaar voorbereiden" (Phase F+).
    # This allows saving progress without mutating the actual year datasets until commit.
    "new-year-drafts": [],
    # Scenario inkoop (primair) inputs per jaar voor kostprijs-activering.
    # Shape: [{jaar, bier_id, product_id, scenario_primaire_kosten}]
    "kostprijs-scenario-inkoop": [],
    # Draft storage for "Kostprijzen activeren" wizard (Phase E+).
    "kostprijs-activatie-drafts": [],
}

READ_ONLY_PROJECTION_DATASETS = {
    "verpakkingsonderdelen",
    "basisproducten",
    "samengestelde-producten",
    "packaging-component-prices",
    "berekeningen",
    *MODEL_A_DATASET_NAMES,
}


def _stable_json_hash(value: Any) -> str:
    """Compute a stable hash for nested JSON-ish values.

    Important: we do not want random ordering differences to trigger false positives,
    so we serialize with sorted keys and normalized whitespace.
    """
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _normalize_rows_for_hash(rows: list[dict[str, Any]], *, sort_keys: list[str]) -> list[dict[str, Any]]:
    def _key(row: dict[str, Any]) -> tuple[Any, ...]:
        return tuple(row.get(key) for key in sort_keys)

    # Copy and sort to avoid mutating caller structures.
    copied = [dict(row) for row in rows if isinstance(row, dict)]
    copied.sort(key=_key)
    return copied


def _compute_source_fingerprints(*, source_year: int) -> dict[str, str]:
    """Compute fingerprints for datasets that influence year-copy + preview calculations."""
    if source_year <= 0:
        raise ValueError("Bronjaar moet een geldig getal zijn.")

    # Production / fixed costs are stored grouped-by-year dicts.
    productie = load_dataset("productie")
    vaste_kosten = load_dataset("vaste-kosten")

    tarieven = load_dataset("tarieven-heffingen")
    packaging_prices = load_dataset("packaging-component-prices")
    verkoopprijzen = load_dataset("verkoopprijzen")

    basisproducten = load_dataset("basisproducten")
    samengestelde = load_dataset("samengestelde-producten")
    packaging_components = load_dataset("packaging-components")

    def year_dict_slice(payload: Any) -> Any:
        if not isinstance(payload, dict):
            return {}
        return payload.get(str(source_year), [] if str(source_year) in payload else {})

    fingerprints: dict[str, str] = {}
    fingerprints["productie"] = _stable_json_hash({str(source_year): year_dict_slice(productie)})
    fingerprints["vaste-kosten"] = _stable_json_hash({str(source_year): year_dict_slice(vaste_kosten)})

    if isinstance(tarieven, list):
        fingerprints["tarieven-heffingen"] = _stable_json_hash(
            _normalize_rows_for_hash(
                [row for row in tarieven if isinstance(row, dict) and int(row.get("jaar", 0) or 0) == source_year],
                sort_keys=["jaar", "id", "tarief_hoog", "tarief_laag", "verbruikersbelasting"],
            )
        )
    else:
        fingerprints["tarieven-heffingen"] = _stable_json_hash([])

    if isinstance(packaging_prices, list):
        fingerprints["packaging-component-prices"] = _stable_json_hash(
            _normalize_rows_for_hash(
                [row for row in packaging_prices if isinstance(row, dict) and int(row.get("jaar", 0) or 0) == source_year],
                sort_keys=["jaar", "verpakkingsonderdeel_id", "id", "prijs_per_stuk"],
            )
        )
    else:
        fingerprints["packaging-component-prices"] = _stable_json_hash([])

    if isinstance(verkoopprijzen, list):
        strategy_types = {"jaarstrategie", "verkoopstrategie_product", "verkoopstrategie_verpakking"}
        strategy_rows = [
            row
            for row in verkoopprijzen
            if isinstance(row, dict)
            and str(row.get("record_type", "") or "") in strategy_types
            and int(row.get("jaar", 0) or 0) in {0, source_year}
        ]
        fingerprints["verkoopstrategie"] = _stable_json_hash(
            _normalize_rows_for_hash(strategy_rows, sort_keys=["record_type", "jaar", "bier_id", "product_id", "verpakking", "id"])
        )
    else:
        fingerprints["verkoopstrategie"] = _stable_json_hash([])

    # Master data used for packaging cost composition.
    fingerprints["basisproducten"] = _stable_json_hash(
        _normalize_rows_for_hash([row for row in (basisproducten if isinstance(basisproducten, list) else []) if isinstance(row, dict)], sort_keys=["jaar", "id", "omschrijving"])
    )
    fingerprints["samengestelde-producten"] = _stable_json_hash(
        _normalize_rows_for_hash([row for row in (samengestelde if isinstance(samengestelde, list) else []) if isinstance(row, dict)], sort_keys=["jaar", "id", "omschrijving"])
    )
    fingerprints["packaging-components"] = _stable_json_hash(
        _normalize_rows_for_hash([row for row in (packaging_components if isinstance(packaging_components, list) else []) if isinstance(row, dict)], sort_keys=["id", "omschrijving"])
    )

    return fingerprints


def _reject_wrapped_payload(data: Any, *, dataset_name: str) -> None:
    """Reject legacy `{Count, value}` wrappers.

    Phase C requires fail-hard writes: no implicit unwrapping or read-side repairs.
    """
    # Top-level wrapper object.
    if isinstance(data, dict):
        keys = set(data.keys())
        if keys.issubset({"Count", "value"}):
            raise ValueError(
                f"Ongeldig payload voor '{dataset_name}': legacy wrapper {{Count,value}} is niet toegestaan."
            )
        return

    # Wrapper objects nested in list-based datasets (common legacy pattern).
    if isinstance(data, list):
        for row in data:
            if isinstance(row, dict) and set(row.keys()).issubset({"Count", "value"}):
                raise ValueError(
                    f"Ongeldig payload voor '{dataset_name}': legacy wrapper {{Count,value}} is niet toegestaan."
                )
        return


def _require_type(dataset_name: str, data: Any, expected_type: type) -> None:
    if not isinstance(data, expected_type):
        raise ValueError(f"Ongeldig payload voor '{dataset_name}': verwacht {expected_type.__name__}.")


def validate_dataset_write(name: str, data: Any) -> None:
    _reject_wrapped_payload(data, dataset_name=name)

    # Note: `channels` is stored and served as a list (see `_normalize_channels_dataset`),
    # so treating it as a dict here would break seed import + writes.
    dict_datasets = {"productie", "vaste-kosten", "variabele-kosten"}
    list_datasets = {
        "tarieven-heffingen",
        "verpakkingsonderdelen",
        "basisproducten",
        "samengestelde-producten",
        "bieren",
        "adviesprijzen",
        "break-even-configuraties",
        "catalog-products",
        "kostprijs-scenario-inkoop",
        "kostprijs-activatie-drafts",
        "berekeningen",
        "kostprijsversies",
        "kostprijsproductactiveringen",
        "verkoopprijzen",
        "channels",
        "packaging-components",
        "packaging-component-prices",
        "packaging-component-price-versions",
        "base-product-masters",
        "composite-product-masters",
        "products",
        "product-years",
        "product-year-components",
        "product-components",
        "sales-strategy-years",
        "sales-strategy-products",
        "cost-calcs",
        "cost-calc-inputs",
        "cost-calc-results",
        "cost-calc-lines",
        "quotes",
        "articles",
        "skus",
        "bom-lines",
        *MODEL_A_DATASET_NAMES,
    }

    if name in dict_datasets:
        _require_type(name, data, dict)
        return
    if name in list_datasets:
        _require_type(name, data, list)
        return

    raise ValueError(f"Onbekende dataset voor write: {name}")


def _normalize_channels_dataset(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, list):
        return deepcopy(DATASET_DEFAULTS["channels"])
    cleaned: list[dict[str, Any]] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code", row.get("id", "")) or "").strip().lower()
        if not code or code == "groothandel":
            continue
        cleaned.append(row)
    return cleaned


def get_dataset_names() -> list[str]:
    return list(DATASET_DEFAULTS.keys())


def get_storage_provider() -> str:
    return postgres_storage.storage_provider()


def require_postgres() -> None:
    if not postgres_storage.uses_postgres():
        raise RuntimeError(
            "Deze backend is opgeschoond naar PostgreSQL-first opslag. "
            "Activeer PostgreSQL of gebruik expliciet de bootstrap/migratietools voor legacy JSON."
        )


def load_dataset(name: str) -> Any:
    require_postgres()
    default_value = DATASET_DEFAULTS[name]
    if name == "productie":
        return production_storage.load_productie()
    if name == "vaste-kosten":
        return fixed_costs_storage.load_grouped_by_year()
    if name == "channels":
        payload = postgres_storage.load_dataset(name, default_value)
        return _normalize_channels_dataset(payload)
    if name == "packaging-components":
        return load_packaging_component_masters()
    if name == "packaging-component-prices":
        return load_packaging_component_prices()
    if name == "packaging-component-price-versions":
        return load_packaging_component_price_versions()
    if name == "base-product-masters":
        return load_basisproducten()
    if name == "composite-product-masters":
        return load_samengestelde_producten()
    if name == "catalog-products":
        return load_catalog_products()
    if name == "verpakkingsonderdelen":
        # Legacy projection expanded prices for every year; too heavy for interactive UIs.
        return load_verpakkingsonderdelen()
    if name == "basisproducten":
        return load_basisproducten()
    if name == "samengestelde-producten":
        return load_samengestelde_producten()
    if name in MODEL_A_DATASET_NAMES:
        return build_model_a_canonical_datasets().get(name, default_value)
    if name in {"kostprijsversies", "berekeningen"}:
        return load_kostprijsversies()
    if name == "kostprijsproductactiveringen":
        return load_kostprijsproductactiveringen()
    if name == "adviesprijzen":
        return postgres_storage.load_dataset("adviesprijzen", deepcopy(DATASET_DEFAULTS["adviesprijzen"]))
    payload = postgres_storage.load_dataset(name, default_value)
    if name == "verkoopprijzen" and isinstance(payload, list):
        source_records = load_all_verkoop_records() if payload == [] else payload
        return ensure_complete_verkoop_records(
            [
                normalize_any_verkoop_record(record)
                for record in source_records
                if isinstance(record, dict)
            ]
        )
    return payload


def save_dataset(name: str, data: Any) -> bool:
    require_postgres()
    validate_dataset_write(name, data)
    if name == "productie" and isinstance(data, dict):
        return production_storage.save_productie(data)
    if name == "vaste-kosten" and isinstance(data, dict):
        return fixed_costs_storage.save_grouped_by_year(data)
    if name == "channels":
        return postgres_storage.save_dataset(name, _normalize_channels_dataset(data), overwrite=True)
    if name == "packaging-components" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_packaging_component_masters(payload)
    if name == "packaging-component-prices" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_packaging_component_prices(payload)
    if name == "packaging-component-price-versions" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_packaging_component_price_versions(payload)
    if name == "verpakkingsonderdelen" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_verpakkingsonderdelen(payload)
    if name == "base-product-masters" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_basisproducten(payload)
    if name == "composite-product-masters" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_samengestelde_producten(payload)
    if name == "catalog-products" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        saved = save_catalog_products(payload)
        if saved:
            dashboard_service.invalidate_dashboard_summary_cache()
        return bool(saved)
    if name == "basisproducten" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_basisproducten(payload)
    if name == "samengestelde-producten" and isinstance(data, list):
        payload = [row for row in data if isinstance(row, dict)]
        return save_samengestelde_producten(payload)
    if name in MODEL_A_DATASET_NAMES:
        # Model-A canonical datasets are derived; writes should not accept arbitrary payloads.
        canonical_payload = build_model_a_canonical_datasets().get(name, DATASET_DEFAULTS[name])
        return postgres_storage.save_dataset(name, canonical_payload, overwrite=True)
    if name in {"kostprijsversies", "berekeningen"} and isinstance(data, list):
        payload = [
            normalize_berekening_record(record)
            for record in data
            if isinstance(record, dict)
        ]
        saved = save_berekeningen(payload)
        if saved:
            dashboard_service.invalidate_dashboard_summary_cache()
        return saved
    if name == "kostprijsproductactiveringen" and isinstance(data, list):
        payload = [record for record in data if isinstance(record, dict)]
        saved = postgres_storage.save_dataset(name, payload, overwrite=True)
        if saved:
            dashboard_service.invalidate_dashboard_summary_cache()
        return saved
    if name == "verkoopprijzen" and isinstance(data, list):
        payload = ensure_complete_verkoop_records(
            [
                normalize_any_verkoop_record(record)
                for record in data
                if isinstance(record, dict)
            ]
        )
        return postgres_storage.save_dataset(name, payload)
    # Default path: store payload as-is after shape validation.
    saved = postgres_storage.save_dataset(name, data)
    if saved and name in {"kostprijsversies", "berekeningen"}:
        dashboard_service.invalidate_dashboard_summary_cache()
    return saved


def bootstrap_postgres_from_json(overwrite: bool = False) -> dict[str, bool]:
    results: dict[str, bool] = {}
    for dataset_name in get_dataset_names():
        if dataset_name in READ_ONLY_PROJECTION_DATASETS:
            results[dataset_name] = True
            continue
        if dataset_name == "productie":
            payload = json_seed.load_dataset("productie")
            if not isinstance(payload, dict):
                payload = {}
            results[dataset_name] = production_storage.save_productie(payload)
            continue
        if dataset_name == "vaste-kosten":
            payload = json_seed.load_dataset("vaste-kosten")
            if not isinstance(payload, dict):
                payload = {}
            results[dataset_name] = fixed_costs_storage.save_grouped_by_year(payload)
            continue
        if dataset_name == "packaging-components":
            payload = json_seed.load_dataset("verpakkingsonderdelen")
            results[dataset_name] = save_packaging_component_masters(payload if isinstance(payload, list) else [])
            continue
        elif dataset_name == "packaging-component-prices":
            payload = load_packaging_component_prices()
        elif dataset_name == "packaging-component-price-versions":
            payload = load_packaging_component_price_versions()
        elif dataset_name == "base-product-masters":
            payload = json_seed.load_dataset("basisproducten")
            results[dataset_name] = save_basisproducten(payload if isinstance(payload, list) else [])
            continue
        elif dataset_name == "composite-product-masters":
            payload = json_seed.load_dataset("samengestelde-producten")
            results[dataset_name] = save_samengestelde_producten(payload if isinstance(payload, list) else [])
            continue
        elif dataset_name == "kostprijsproductactiveringen":
            payload = json_seed.load_dataset("kostprijsproductactiveringen")
            results[dataset_name] = postgres_storage.save_dataset(
                dataset_name,
                payload if isinstance(payload, list) else [],
                overwrite=overwrite,
            )
            continue
        elif dataset_name in {"kostprijsversies", "berekeningen"}:
            payload = json_seed.load_dataset("kostprijsversies") if dataset_name == "kostprijsversies" else json_seed.load_dataset("berekeningen")
        else:
            payload = (
                json_seed.load_dataset(dataset_name)
                if json_seed.has_dataset(dataset_name)
                else deepcopy(DATASET_DEFAULTS[dataset_name])
            )
        results[dataset_name] = postgres_storage.save_dataset(
            dataset_name,
            payload,
            overwrite=overwrite,
        )
    dashboard_service.invalidate_dashboard_summary_cache()
    return results


def reset_all_datasets_to_defaults() -> dict[str, bool]:
    require_postgres()
    results: dict[str, bool] = {}
    # Reset normalized tables first.
    fixed_costs_storage.reset_defaults()
    production_storage.reset_defaults()
    for dataset_name, default_value in DATASET_DEFAULTS.items():
        if dataset_name in READ_ONLY_PROJECTION_DATASETS:
            results[dataset_name] = True
            continue
        results[dataset_name] = postgres_storage.save_dataset(
            dataset_name,
            deepcopy(default_value),
            overwrite=True,
        )
    dashboard_service.invalidate_dashboard_summary_cache()
    return results


def reset_year_setup_keep_cost_data() -> dict[str, bool]:
    """Local/dev helper: reset year setup data while keeping cost management + invoices + recalcs.

    Keeps (so those pages keep working):
    - users (app_users) (not a dataset)
    - kostprijsversies (includes inkoopfacturen payloads)
    - berekeningen (includes hercalculaties)
    - kostprijsproductactiveringen (so verkoop/kostprijs can still resolve active scope)
    - product masters (products, packaging-components, etc.)

    Resets (so first-year setup/new-year flows can be tested again):
    - productie, vaste kosten, tarieven/heffingen
    - packaging-component prices (yearly)
    - verkoopstrategie / verkoopprijzen / offerte drafts
    - wizard drafts

    Never drops tables; only overwrites dataset rows and truncates normalized year tables.
    """
    require_postgres()
    results: dict[str, bool] = {}

    # Reset normalized year tables.
    fixed_costs_storage.reset_defaults()
    production_storage.reset_defaults()

    wipe_dataset_names: set[str] = {
        "productie",
        "vaste-kosten",
        "tarieven-heffingen",
        "packaging-component-prices",
        "packaging-component-price-versions",
        "verkoopprijzen",
        "sales-strategy-years",
        "sales-strategy-products",
        "new-year-drafts",
    }

    for dataset_name, default_value in DATASET_DEFAULTS.items():
        if dataset_name in READ_ONLY_PROJECTION_DATASETS:
            # Read-only projections will be recomputed from masters; they should never be wiped directly here.
            results[dataset_name] = True
            continue
        if dataset_name in wipe_dataset_names:
            results[dataset_name] = postgres_storage.save_dataset(
                dataset_name,
                deepcopy(default_value),
                overwrite=True,
            )
            continue
        # Keep everything else intact.
        results[dataset_name] = True

    try:
        from app.domain import quote_drafts_storage

        results["quote_drafts"] = bool(quote_drafts_storage.clear_all_drafts().get("deleted", 0) >= 0)
    except Exception:
        results["quote_drafts"] = False

    dashboard_service.invalidate_dashboard_summary_cache()
    return results


def activate_cost_version(
    version_id: str,
    *,
    context: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    require_postgres()
    record = activate_kostprijsversie(version_id, context=context)
    if record is not None:
        dashboard_service.invalidate_dashboard_summary_cache()
    return record


def activate_cost_version_products(
    version_id: str,
    product_ids: list[str],
    *,
    context: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    require_postgres()
    record = activate_kostprijsversie_products(version_id, product_ids, context=context)
    if record is not None:
        dashboard_service.invalidate_dashboard_summary_cache()
    return record


def migrate_product_ids(*, dry_run: bool = False) -> dict[str, Any]:
    """One-time maintenance: rewrite stored product ids to match master Product ids."""
    require_postgres()
    return migrate_product_ids_to_master_ids(dry_run=dry_run)


def migrate_wrapped_payloads(
    *,
    dataset_names: list[str] | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """One-time maintenance: unwrap legacy `{Count,value}` payloads stored in Postgres.

    Phase C: runtime no longer supports wrapped payloads on read or write.
    This endpoint rewrites existing datasets once, then the app fails hard if wrappers reappear.
    """
    require_postgres()

    # Only migrate datasets we can safely write back.
    target_names = (
        [name for name in (dataset_names or []) if name in get_dataset_names()]
        if dataset_names
        else [name for name in get_dataset_names() if name not in READ_ONLY_PROJECTION_DATASETS]
    )

    def is_wrapper_dict(value: Any) -> bool:
        return (
            isinstance(value, dict)
            and set(value.keys()).issubset({"Count", "value"})
            and isinstance(value.get("value"), list)
        )

    def unwrap(value: Any) -> tuple[Any, bool]:
        if is_wrapper_dict(value):
            return unwrap(value.get("value", []))
        if isinstance(value, list):
            changed = False
            out: list[Any] = []
            for item in value:
                if is_wrapper_dict(item):
                    nested, nested_changed = unwrap(item.get("value", []))
                    if isinstance(nested, list):
                        out.extend(nested)
                    else:
                        out.append(nested)
                    changed = True or nested_changed
                    continue
                nested, nested_changed = unwrap(item)
                out.append(nested)
                changed = changed or nested_changed
            return out, changed
        return value, False

    report: dict[str, Any] = {"dry_run": dry_run, "datasets": {}}
    for name in target_names:
        payload = postgres_storage.load_dataset(name, None)
        new_payload, changed = unwrap(payload)
        report["datasets"][name] = {
            "changed": bool(changed),
            "had_wrapper": bool(changed),
        }
        if changed and not dry_run:
            postgres_storage.save_dataset(name, new_payload, overwrite=True)

    return report


def generate_missing_activations(*, dry_run: bool = False) -> dict[str, Any]:
    """One-time maintenance: generate missing product activations from definitive cost versions.

    Phase E: activations are the single source of truth for (bier, jaar, product) activeness.
    This function is intentionally explicit (admin endpoint) and never runs on reads.
    """
    require_postgres()
    report = generate_missing_kostprijsproductactiveringen(dry_run=dry_run)
    if not dry_run:
        dashboard_service.invalidate_dashboard_summary_cache()
    return report


def duplicate_adviesprijzen_to_year(source_year: int, target_year: int, *, overwrite: bool = False) -> int:
    """Copy advice channel pricing defaults from source_year to target_year.

    Returns number of target rows written.
    """
    payload = load_dataset("adviesprijzen")
    if not isinstance(payload, list):
        payload = []

    source_rows = [
        row
        for row in payload
        if isinstance(row, dict) and int(row.get("jaar", 0) or 0) == int(source_year)
    ]
    if not source_rows:
        return 0

    has_target = any(isinstance(row, dict) and int(row.get("jaar", 0) or 0) == int(target_year) for row in payload)
    if has_target and not overwrite:
        return 0

    kept = [row for row in payload if isinstance(row, dict) and int(row.get("jaar", 0) or 0) != int(target_year)]
    copied = 0
    for row in source_rows:
        channel_code = str(row.get("channel_code", "") or "").strip().lower()
        if not channel_code:
            continue
        copied += 1
        kept.append(
            {
                "id": str(uuid4()),
                "jaar": int(target_year),
                "channel_code": channel_code,
                "opslag_pct": float(row.get("opslag_pct", 0.0) or 0.0),
            }
        )

    save_dataset("adviesprijzen", kept)
    return int(copied)


def prepare_new_year(
    *,
    source_year: int,
    target_year: int,
    copy_productie: bool = True,
    copy_vaste_kosten: bool = True,
    copy_tarieven: bool = True,
    copy_verpakkingsonderdelen: bool = True,
    copy_verkoopstrategie: bool = True,
    copy_berekeningen: bool = True,
    overwrite_existing: bool = False,
    include_datasets: bool = True,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Prepare a new year set in one Postgres transaction (Phase F).

    This replaces the old client-side flow that did multiple independent PUTs which could
    leave the database in a half-written state.
    """
    require_postgres()
    if source_year <= 0 or target_year <= 0:
        raise ValueError("Bronjaar en doeljaar moeten geldig zijn.")
    if target_year <= source_year:
        raise ValueError("Doeljaar moet hoger zijn dan bronjaar.")

    now = datetime.now(UTC).isoformat()

    def berekening_key(record: dict[str, Any]) -> str:
        bier_id = str(record.get("bier_id", "") or "").strip()
        soort = ""
        soort_berekening = record.get("soort_berekening", {})
        if isinstance(soort_berekening, dict):
            soort = str(soort_berekening.get("type", "") or "").strip()
        if not soort:
            soort = str(record.get("type", "") or "").strip()
        basis = record.get("basisgegevens", {})
        if not isinstance(basis, dict):
            basis = {}
        if bier_id:
            return f"{bier_id}|{soort}"
        return "|".join(
            [
                str(basis.get("biernaam", "") or "").strip(),
                str(basis.get("stijl", "") or "").strip(),
                soort,
            ]
        )

    def duplicate_berekening(record: dict[str, Any]) -> dict[str, Any]:
        draft = deepcopy(record)
        basis = draft.get("basisgegevens", {})
        if not isinstance(basis, dict):
            basis = {}
        draft["id"] = str(uuid4())
        draft["status"] = "concept"
        draft["finalized_at"] = ""
        draft["created_at"] = now
        draft["updated_at"] = now
        draft["effectief_vanaf"] = ""
        draft["is_actief"] = False
        draft["last_completed_step"] = 4
        draft["basisgegevens"] = {**basis, "jaar": target_year}
        draft["jaarovergang"] = {
            "bron_berekening_id": str(record.get("id", "") or ""),
            "bron_jaar": int((basis.get("jaar", 0) or 0) if isinstance(basis, dict) else 0),
            "doel_jaar": target_year,
            "aangemaakt_via": "nieuw_jaar_voorbereiden",
            "created_at": now,
        }
        return draft

    report: dict[str, Any] = {
        "dry_run": dry_run,
        "source_year": source_year,
        "target_year": target_year,
        "results": {},
    }

    with postgres_storage.transaction():
        if copy_productie:
            if dry_run:
                # Best-effort signal; we don't mutate.
                report["results"]["productie"] = {"would_copy": True}
            else:
                ok = duplicate_productie_to_year(source_year, target_year, overwrite=overwrite_existing)
                report["results"]["productie"] = {"copied": bool(ok)}

        if copy_vaste_kosten:
            if dry_run:
                report["results"]["vaste-kosten"] = {"would_copy": True}
            else:
                copied_rows = duplicate_vaste_kosten_to_year(source_year, target_year, overwrite=overwrite_existing)
                report["results"]["vaste-kosten"] = {"copied_rows": int(copied_rows)}

        if copy_tarieven:
            if dry_run:
                report["results"]["tarieven-heffingen"] = {"would_copy": True}
            else:
                ok = duplicate_tarieven_heffingen_to_year(source_year, target_year, overwrite=overwrite_existing)
                report["results"]["tarieven-heffingen"] = {"copied": bool(ok)}

        if copy_verpakkingsonderdelen:
            if dry_run:
                report["results"]["verpakkingsonderdelen"] = {"would_copy": True}
            else:
                legacy_copied = duplicate_verpakkingsonderdelen_to_year(
                    source_year, target_year, overwrite=overwrite_existing
                )
                prices_copied = duplicate_packaging_component_prices_to_year(
                    source_year, target_year, overwrite=overwrite_existing
                )
                report["results"]["verpakkingsonderdelen"] = {
                    "copied_rows": int(legacy_copied),
                    "copied_packaging_component_prices": int(prices_copied),
                }

        if copy_verkoopstrategie:
            if dry_run:
                report["results"]["verkoopstrategie"] = {"would_copy": True}
            else:
                # Copy packaging strategies first (canonical function); other strategy records are stored
                # in the same dataset and will be handled by save_dataset normalization.
                copied = duplicate_verkoopstrategie_verpakkingen_to_year(
                    source_year, target_year, overwrite=overwrite_existing
                )
                # Also copy advice channel pricing defaults (sell-out advisory).
                advies_copied = 0
                try:
                    advies_copied = int(duplicate_adviesprijzen_to_year(source_year, target_year, overwrite=overwrite_existing) or 0)
                except Exception:
                    advies_copied = 0
                report["results"]["verkoopstrategie"] = {"copied_rows": int(copied), "adviesprijzen_copied_rows": int(advies_copied)}

        if copy_berekeningen:
            records = [
                record
                for record in load_kostprijsversies()
                if isinstance(record, dict)
            ]
            source_definitive = [
                record
                for record in records
                if int(((record.get("basisgegevens", {}) or {}).get("jaar", 0) or 0)) == source_year
                and str(record.get("status", "") or "").strip().lower() == "definitief"
            ]
            keys_to_copy = {berekening_key(record) for record in source_definitive}

            if overwrite_existing and keys_to_copy:
                filtered: list[dict[str, Any]] = []
                for record in records:
                    basis = record.get("basisgegevens", {})
                    if not isinstance(basis, dict):
                        basis = {}
                    is_target = int(basis.get("jaar", 0) or 0) == target_year
                    if is_target and berekening_key(record) in keys_to_copy:
                        continue
                    filtered.append(record)
                records = filtered

            existing_target_keys = {
                berekening_key(record)
                for record in records
                if int(((record.get("basisgegevens", {}) or {}).get("jaar", 0) or 0)) == target_year
            }

            created = 0
            if not dry_run:
                for record in source_definitive:
                    key = berekening_key(record)
                    if key in existing_target_keys:
                        continue
                    records.append(duplicate_berekening(record))
                    existing_target_keys.add(key)
                    created += 1
                saved = save_berekeningen(records)
                report["results"]["berekeningen"] = {"created": int(created), "saved": bool(saved)}
            else:
                report["results"]["berekeningen"] = {"would_create": max(0, len(keys_to_copy) - len(existing_target_keys))}

        if not dry_run and include_datasets:
            report["datasets"] = {
                "productie": load_dataset("productie"),
                "vaste-kosten": load_dataset("vaste-kosten"),
                "tarieven-heffingen": load_dataset("tarieven-heffingen"),
                "verpakkingsonderdelen": load_dataset("verpakkingsonderdelen"),
                "packaging-components": load_dataset("packaging-components"),
                "packaging-component-prices": load_dataset("packaging-component-prices"),
                "verkoopprijzen": load_dataset("verkoopprijzen"),
                "berekeningen": load_dataset("berekeningen"),
            }

    if not dry_run:
        dashboard_service.invalidate_dashboard_summary_cache()
    return report


def load_new_year_draft(*, owner: str, target_year: int) -> dict[str, Any] | None:
    """Load the saved wizard draft for a user+target_year, if any."""
    require_postgres()
    if target_year <= 0:
        raise ValueError("Doeljaar moet een geldig getal zijn.")

    payload = postgres_storage.load_dataset("new-year-drafts", deepcopy(DATASET_DEFAULTS["new-year-drafts"]))
    if not isinstance(payload, list):
        return None

    for row in payload:
        if not isinstance(row, dict):
            continue
        if str(row.get("owner", "") or "") != str(owner or ""):
            continue
        try:
            row_year = int(row.get("target_year", 0) or 0)
        except (TypeError, ValueError):
            row_year = 0
        if row_year == int(target_year):
            return row
    return None


def upsert_new_year_draft(
    *,
    owner: str,
    source_year: int,
    target_year: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Create/update a wizard draft record.

    Important: this does NOT touch any year datasets; it's purely draft storage.
    """
    require_postgres()
    if source_year <= 0 or target_year <= 0:
        raise ValueError("Bronjaar en doeljaar moeten geldig zijn.")
    if target_year <= source_year:
        raise ValueError("Doeljaar moet hoger zijn dan bronjaar.")

    now = datetime.now(UTC).isoformat()
    existing = postgres_storage.load_dataset("new-year-drafts", deepcopy(DATASET_DEFAULTS["new-year-drafts"]))
    if not isinstance(existing, list):
        existing = []

    next_rows: list[dict[str, Any]] = []
    found = None
    for row in existing:
        if not isinstance(row, dict):
            continue
        is_match = (
            str(row.get("owner", "") or "") == str(owner or "")
            and int(row.get("target_year", 0) or 0) == int(target_year)
        )
        if is_match:
            found = row
            continue
        next_rows.append(row)

    record = {
        "id": str((found or {}).get("id", "") or uuid4()),
        "owner": str(owner or ""),
        "source_year": int(source_year),
        "target_year": int(target_year),
        "created_at": str((found or {}).get("created_at", "") or now),
        "updated_at": now,
        "payload": payload if isinstance(payload, dict) else {},
    }

    # Compute and freeze source fingerprints only once, so we can detect mid-draft source changes.
    if isinstance(found, dict) and isinstance(found.get("source_fingerprints"), dict):
        record["source_fingerprints"] = found.get("source_fingerprints")
        record["source_fingerprints_at"] = str(found.get("source_fingerprints_at", "") or "")
    else:
        record["source_fingerprints"] = _compute_source_fingerprints(source_year=int(source_year))
        record["source_fingerprints_at"] = now

    next_rows.append(record)
    postgres_storage.save_dataset("new-year-drafts", next_rows, overwrite=True)
    return record


def delete_new_year_draft(*, owner: str, target_year: int) -> dict[str, Any]:
    require_postgres()
    if target_year <= 0:
        raise ValueError("Doeljaar moet een geldig getal zijn.")

    existing = postgres_storage.load_dataset("new-year-drafts", deepcopy(DATASET_DEFAULTS["new-year-drafts"]))
    if not isinstance(existing, list):
        existing = []

    removed = 0
    kept: list[dict[str, Any]] = []
    for row in existing:
        if not isinstance(row, dict):
            continue
        if str(row.get("owner", "") or "") == str(owner or "") and int(row.get("target_year", 0) or 0) == int(target_year):
            removed += 1
            continue
        kept.append(row)

    postgres_storage.save_dataset("new-year-drafts", kept, overwrite=True)
    return {"deleted": int(removed)}


def list_new_year_drafts() -> list[dict[str, Any]]:
    """List all stored new-year drafts (admin tooling)."""
    require_postgres()
    payload = postgres_storage.load_dataset("new-year-drafts", deepcopy(DATASET_DEFAULTS["new-year-drafts"]))
    if not isinstance(payload, list):
        return []
    rows = [row for row in payload if isinstance(row, dict)]
    rows.sort(
        key=lambda row: (int(row.get("target_year", 0) or 0), str(row.get("updated_at", "") or "")),
        reverse=True,
    )
    return rows


def load_kostprijs_activatie_draft(*, owner: str, target_year: int) -> dict[str, Any] | None:
    payload = postgres_storage.load_dataset(
        "kostprijs-activatie-drafts",
        deepcopy(DATASET_DEFAULTS["kostprijs-activatie-drafts"]),
    )
    if not isinstance(payload, list):
        return None
    for row in payload:
        if not isinstance(row, dict):
            continue
        if str(row.get("owner", "") or "") != str(owner or ""):
            continue
        try:
            row_year = int(row.get("target_year", 0) or 0)
        except (TypeError, ValueError):
            row_year = 0
        if row_year == int(target_year):
            return row
    return None


def upsert_kostprijs_activatie_draft(
    *,
    owner: str,
    source_year: int,
    target_year: int,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    require_postgres()
    existing = postgres_storage.load_dataset(
        "kostprijs-activatie-drafts",
        deepcopy(DATASET_DEFAULTS["kostprijs-activatie-drafts"]),
    )
    if not isinstance(existing, list):
        existing = []
    now = datetime.now(UTC).isoformat()
    payload = payload if isinstance(payload, dict) else {}

    kept: list[dict[str, Any]] = []
    previous: dict[str, Any] | None = None
    for row in existing:
        if not isinstance(row, dict):
            continue
        if str(row.get("owner", "") or "") == str(owner or "") and int(row.get("target_year", 0) or 0) == int(
            target_year
        ):
            previous = row
            continue
        kept.append(row)

    record = {
        "id": str(previous.get("id", "") or uuid4()) if isinstance(previous, dict) else str(uuid4()),
        "owner": str(owner or ""),
        "source_year": int(source_year),
        "target_year": int(target_year),
        "payload": payload,
        "created_at": str(previous.get("created_at", "") or now) if isinstance(previous, dict) else now,
        "updated_at": now,
    }
    kept.append(record)
    postgres_storage.save_dataset("kostprijs-activatie-drafts", kept, overwrite=True)
    return record


def delete_kostprijs_activatie_draft(*, owner: str, target_year: int) -> dict[str, Any]:
    require_postgres()
    existing = postgres_storage.load_dataset(
        "kostprijs-activatie-drafts",
        deepcopy(DATASET_DEFAULTS["kostprijs-activatie-drafts"]),
    )
    if not isinstance(existing, list):
        existing = []
    kept: list[dict[str, Any]] = []
    removed = 0
    for row in existing:
        if not isinstance(row, dict):
            continue
        if str(row.get("owner", "") or "") == str(owner or "") and int(row.get("target_year", 0) or 0) == int(
            target_year
        ):
            removed += 1
            continue
        kept.append(row)
    postgres_storage.save_dataset("kostprijs-activatie-drafts", kept, overwrite=True)
    return {"deleted": int(removed)}


def _latest_activations_for_year(year: int) -> list[dict[str, Any]]:
    rows = [
        row
        for row in load_kostprijsproductactiveringen()
        if isinstance(row, dict) and int(row.get("jaar", 0) or 0) == int(year)
    ]
    latest_by_key: dict[str, dict[str, Any]] = {}
    for row in rows:
        bier_id = str(row.get("bier_id", "") or "").strip()
        product_id = str(row.get("product_id", "") or "").strip()
        if not bier_id or not product_id:
            continue
        key = f"{bier_id}::{product_id}"
        current = latest_by_key.get(key)
        if current is None:
            latest_by_key[key] = row
            continue
        # Prefer newest effective_from / updated_at.
        candidate_key = (
            str(row.get("effectief_vanaf", "") or ""),
            str(row.get("updated_at", "") or ""),
            str(row.get("id", "") or ""),
        )
        current_key = (
            str(current.get("effectief_vanaf", "") or ""),
            str(current.get("updated_at", "") or ""),
            str(current.get("id", "") or ""),
        )
        if candidate_key > current_key:
            latest_by_key[key] = row
    return list(latest_by_key.values())


def _find_snapshot_product_row(version: dict[str, Any], product_id: str) -> dict[str, Any] | None:
    snapshot = version.get("resultaat_snapshot")
    if not isinstance(snapshot, dict):
        return None
    producten = snapshot.get("producten")
    if not isinstance(producten, dict):
        return None
    for group_key in ("basisproducten", "samengestelde_producten"):
        group = producten.get(group_key, [])
        if not isinstance(group, list):
            continue
        for row in group:
            if not isinstance(row, dict):
                continue
            if str(row.get("product_id", "") or "").strip() == str(product_id or "").strip():
                return row
    return None


def _load_scenario_primary_costs_for_year(target_year: int) -> dict[str, float]:
    payload = load_dataset("kostprijs-scenario-inkoop")
    if not isinstance(payload, list):
        return {}
    out: dict[str, float] = {}
    for row in payload:
        if not isinstance(row, dict):
            continue
        try:
            jaar = int(row.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            continue
        if jaar != int(target_year):
            continue
        bier_id = str(row.get("bier_id", "") or "").strip()
        product_id = str(row.get("product_id", "") or "").strip()
        if not bier_id or not product_id:
            continue
        try:
            value = float(row.get("scenario_primaire_kosten", 0.0) or 0.0)
        except (TypeError, ValueError):
            continue
        out[f"{bier_id}::{product_id}"] = float(value)
    return out


def _upsert_scenario_primary_costs_for_year(*, target_year: int, overrides: dict[str, Any]) -> int:
    if not isinstance(overrides, dict):
        return 0
    existing = load_dataset("kostprijs-scenario-inkoop")
    if not isinstance(existing, list):
        existing = []
    kept = [
        row
        for row in existing
        if isinstance(row, dict) and int(row.get("jaar", 0) or 0) != int(target_year)
    ]
    created = 0
    for key, raw_value in overrides.items():
        if not isinstance(key, str) or "::" not in key:
            continue
        bier_id, product_id = key.split("::", 1)
        bier_id = str(bier_id or "").strip()
        product_id = str(product_id or "").strip()
        if not bier_id or not product_id:
            continue
        try:
            value = float(raw_value or 0.0)
        except (TypeError, ValueError):
            continue
        kept.append(
            {
                "jaar": int(target_year),
                "bier_id": bier_id,
                "product_id": product_id,
                "scenario_primaire_kosten": float(value),
            }
        )
        created += 1
    save_dataset("kostprijs-scenario-inkoop", kept)
    return created


def _compute_eigen_productie_liter_prijs_from_override(*, override: dict[str, Any], target_year: int) -> float:
    """Compute ingredient cost per liter from an override payload (best-effort, fail-soft to 0.0).

    This mirrors the frontend BerekeningenWizard logic:
    - kosten_recept = sum((prijs / inhoud_verpakking) * benodigd_in_recept)
    - liter_prijs = kosten_recept / batchgrootte_eigen_productie_l
    """
    if not isinstance(override, dict):
        return 0.0
    productie = production_storage.load_productie()
    year_row: dict[str, Any] = {}
    if isinstance(productie, dict):
        year_row = productie.get(str(target_year), {}) or productie.get(int(target_year), {}) or {}
    if not isinstance(year_row, dict):
        year_row = {}
    try:
        batch = float(year_row.get("batchgrootte_eigen_productie_l", 0.0) or 0.0)
    except (TypeError, ValueError):
        batch = 0.0
    if batch <= 0:
        return 0.0
    regels = override.get("ingredienten")
    if not isinstance(regels, list):
        return 0.0
    recept_totaal = 0.0
    for regel in regels:
        if not isinstance(regel, dict):
            continue
        try:
            prijs = float(regel.get("prijs", 0.0) or 0.0)
        except (TypeError, ValueError):
            prijs = 0.0
        try:
            inhoud = float(regel.get("hoeveelheid", 0.0) or 0.0)
        except (TypeError, ValueError):
            inhoud = 0.0
        try:
            nodig = float(regel.get("benodigd_in_recept", 0.0) or 0.0)
        except (TypeError, ValueError):
            nodig = 0.0
        if inhoud <= 0 or nodig <= 0:
            continue
        recept_totaal += (prijs / inhoud) * nodig
    if recept_totaal <= 0:
        return 0.0
    return float(recept_totaal / batch)


def _compute_target_product_components(
    *,
    product_type: str,
    product_id: str,
    target_year: int,
) -> tuple[float, float]:
    """Returns (liters_per_product, packaging_cost) for the target year (fail-hard if missing)."""
    normalized_type = str(product_type or "").strip().lower()
    # Products are mastered (year-independent). Only packaging prices are year-dependent.
    if normalized_type in {"basis", "basisproduct"}:
        master = next(
            (
                row
                for row in load_basisproducten()
                if isinstance(row, dict) and str(row.get("id", "") or "") == str(product_id or "")
            ),
            None,
        )
        if not isinstance(master, dict):
            raise ValueError(f"Basisproduct niet gevonden voor product_id={product_id}.")
        resolved = resolve_basisproduct_for_year(master, target_year)
        liters = float(resolved.get("inhoud_per_eenheid_liter", 0.0) or 0.0)
        packaging = float(resolved.get("totale_verpakkingskosten", 0.0) or 0.0)
        return (max(liters, 0.0), max(packaging, 0.0))

    master = next(
        (
            row
            for row in load_samengestelde_producten()
            if isinstance(row, dict) and str(row.get("id", "") or "") == str(product_id or "")
        ),
        None,
    )
    if not isinstance(master, dict):
        raise ValueError(f"Samengesteld product niet gevonden voor product_id={product_id}.")
    resolved = resolve_samengesteld_product_for_year(master, target_year)
    liters = float(resolved.get("totale_inhoud_liter", 0.0) or 0.0)
    packaging = float(resolved.get("totale_verpakkingskosten", 0.0) or 0.0)
    return (max(liters, 0.0), max(packaging, 0.0))


def get_kostprijs_activatie_plan(*, owner: str, source_year: int, target_year: int) -> dict[str, Any]:
    require_postgres()
    if source_year <= 0 or target_year <= 0:
        raise ValueError("Bronjaar en doeljaar moeten geldig zijn.")

    versions = [row for row in load_kostprijsversies() if isinstance(row, dict)]
    version_by_id = {str(row.get("id", "") or ""): row for row in versions}
    activations = _latest_activations_for_year(source_year)

    scenario_by_key = _load_scenario_primary_costs_for_year(target_year)
    draft = load_kostprijs_activatie_draft(owner=str(owner or ""), target_year=int(target_year))
    draft_payload = (draft or {}).get("payload") if isinstance(draft, dict) else {}
    draft_overrides = (draft_payload or {}).get("scenario_primary_costs") if isinstance(draft_payload, dict) else {}
    if not isinstance(draft_overrides, dict):
        draft_overrides = {}

    # Eigen productie overrides come from the nieuw-jaar wizard draft (same owner+target_year).
    new_year_draft = load_new_year_draft(owner=str(owner or ""), target_year=int(target_year))
    ny_payload = (new_year_draft or {}).get("payload") if isinstance(new_year_draft, dict) else {}
    ny_data = (ny_payload or {}).get("data") if isinstance(ny_payload, dict) else {}
    eigen_overrides = (ny_data or {}).get("eigen_productie_overrides") if isinstance(ny_data, dict) else {}
    if not isinstance(eigen_overrides, dict):
        eigen_overrides = {}

    rows: list[dict[str, Any]] = []
    for activation in activations:
        bier_id = str(activation.get("bier_id", "") or "").strip()
        product_id = str(activation.get("product_id", "") or "").strip()
        product_type = str(activation.get("product_type", "") or "").strip()
        version_id = str(activation.get("kostprijsversie_id", "") or "").strip()
        if not bier_id or not product_id or not version_id:
            continue
        version = version_by_id.get(version_id)
        if not isinstance(version, dict):
            continue
        basis = version.get("basisgegevens", {}) if isinstance(version.get("basisgegevens", {}), dict) else {}
        bier_snapshot = version.get("bier_snapshot", {}) if isinstance(version.get("bier_snapshot", {}), dict) else {}
        biernaam = str(basis.get("biernaam", "") or "").strip()
        snapshot_row = _find_snapshot_product_row(version, product_id)
        if not isinstance(snapshot_row, dict):
            continue
        source_cost = float(snapshot_row.get("kostprijs", 0.0) or 0.0)
        source_primary = float(snapshot_row.get("primaire_kosten", 0.0) or 0.0)
        soort = str(version.get("type", "") or "").strip().lower()
        bier_alcohol = float(bier_snapshot.get("alcoholpercentage", basis.get("alcoholpercentage", 0.0)) or 0.0)
        bier_tarief_accijns = str(bier_snapshot.get("tarief_accijns", basis.get("tarief_accijns", "Hoog")) or "Hoog")
        bier_belastingsoort = str(bier_snapshot.get("belastingsoort", basis.get("belastingsoort", "Accijns")) or "Accijns")
        eigen_override = eigen_overrides.get(bier_id) if soort != "inkoop" else None
        if isinstance(eigen_override, dict):
            try:
                bier_alcohol = float(eigen_override.get("alcoholpercentage", bier_alcohol) or bier_alcohol)
            except (TypeError, ValueError):
                bier_alcohol = bier_alcohol
            bier_tarief_accijns = str(eigen_override.get("tarief_accijns", bier_tarief_accijns) or bier_tarief_accijns)

        key = f"{bier_id}::{product_id}"
        scenario_primary = scenario_by_key.get(key, source_primary)
        if key in draft_overrides:
            try:
                scenario_primary = float(draft_overrides.get(key) or 0.0)
            except (TypeError, ValueError):
                scenario_primary = scenario_primary

        liters, packaging_cost = _compute_target_product_components(
            product_type=product_type, product_id=product_id, target_year=target_year
        )
        # For inkoop cost versions we treat packaging as included in the purchase price.
        # The legacy snapshots and the UI both expect verpakkingskosten = 0.0 for inkoop rows.
        if soort == "inkoop":
            packaging_cost = 0.0
        if soort != "inkoop" and isinstance(eigen_override, dict):
            liter_prijs = _compute_eigen_productie_liter_prijs_from_override(override=eigen_override, target_year=target_year)
            if liter_prijs > 0 and float(liters) > 0:
                scenario_primary = float(liter_prijs) * float(liters)
        if soort == "inkoop":
            vaste_kosten_per_liter = float(bereken_indirecte_vaste_kosten_per_ingekochte_liter(target_year) or 0.0)
        else:
            vaste_kosten_per_liter = float(bereken_directe_vaste_kosten_per_productieliter_herverdeeld(target_year) or 0.0)
        vaste_kosten = vaste_kosten_per_liter * float(liters)
        accijns = float(
            bereken_accijns_voor_liters(
                year=target_year,
                liters=float(liters),
                alcoholpercentage=float(bier_alcohol),
                tarief_accijns=bier_tarief_accijns,
                belastingsoort=bier_belastingsoort,
            )
        )
        target_cost = float(scenario_primary) + float(packaging_cost) + float(vaste_kosten) + float(accijns)
        delta = target_cost - source_cost
        rows.append(
            {
                "bier_id": bier_id,
                "biernaam": biernaam,
                "product_id": product_id,
                "product_type": product_type,
                "product_label": str(snapshot_row.get("verpakking", "") or snapshot_row.get("product_label", "") or ""),
                "source_version_id": version_id,
                "source_cost": float(source_cost),
                "source_primary": float(source_primary),
                "scenario_primary": float(scenario_primary),
                "target_cost": float(target_cost),
                "delta": float(delta),
            }
        )

    rows.sort(key=lambda r: (str(r.get("biernaam", "") or ""), str(r.get("product_label", "") or "")))
    return {
        "source_year": int(source_year),
        "target_year": int(target_year),
        "rows": rows,
    }


def activate_kostprijzen_for_year(
    *,
    owner: str,
    source_year: int,
    target_year: int,
    selections: list[dict[str, str]] | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    require_postgres()
    plan = get_kostprijs_activatie_plan(owner=owner, source_year=source_year, target_year=target_year)
    plan_rows = plan.get("rows", [])
    if not isinstance(plan_rows, list):
        plan_rows = []
    if not plan_rows:
        return {"created_versions": 0, "activated": 0, "detail": "Geen plan-rijen beschikbaar."}

    selected_keys: set[str] = set()
    if selections:
        for sel in selections:
            if not isinstance(sel, dict):
                continue
            bier_id = str(sel.get("bier_id", "") or "").strip()
            product_id = str(sel.get("product_id", "") or "").strip()
            if bier_id and product_id:
                selected_keys.add(f"{bier_id}::{product_id}")
    else:
        selected_keys = {f"{str(r.get('bier_id','') or '')}::{str(r.get('product_id','') or '')}" for r in plan_rows if isinstance(r, dict)}

    # Group by beer.
    rows_by_beer: dict[str, list[dict[str, Any]]] = {}
    for row in plan_rows:
        if not isinstance(row, dict):
            continue
        bier_id = str(row.get("bier_id", "") or "").strip()
        product_id = str(row.get("product_id", "") or "").strip()
        if not bier_id or not product_id:
            continue
        if f"{bier_id}::{product_id}" not in selected_keys:
            continue
        rows_by_beer.setdefault(bier_id, []).append(row)

    if not rows_by_beer:
        return {"created_versions": 0, "activated": 0, "detail": "Geen geselecteerde rijen."}

    versions = [row for row in load_kostprijsversies() if isinstance(row, dict)]
    version_by_id = {str(row.get("id", "") or ""): row for row in versions}
    now = datetime.now(UTC).isoformat()

    new_year_draft = load_new_year_draft(owner=str(owner or ""), target_year=int(target_year))
    ny_payload = (new_year_draft or {}).get("payload") if isinstance(new_year_draft, dict) else {}
    ny_data = (ny_payload or {}).get("data") if isinstance(ny_payload, dict) else {}
    eigen_overrides = (ny_data or {}).get("eigen_productie_overrides") if isinstance(ny_data, dict) else {}
    if not isinstance(eigen_overrides, dict):
        eigen_overrides = {}

    created_versions = 0
    activated_scopes = 0
    created_version_ids: list[str] = []
    for bier_id, beer_rows in rows_by_beer.items():
        # pick a source version for metadata
        source_version_id = str(beer_rows[0].get("source_version_id", "") or "").strip()
        source_version = version_by_id.get(source_version_id)
        if not isinstance(source_version, dict):
            raise ValueError(f"Bron kostprijsversie niet gevonden voor bier_id={bier_id}.")
        basis = source_version.get("basisgegevens", {}) if isinstance(source_version.get("basisgegevens", {}), dict) else {}
        bier_snapshot = source_version.get("bier_snapshot", {}) if isinstance(source_version.get("bier_snapshot", {}), dict) else {}
        # Determine next versie_nummer for this beer+target_year.
        existing_nums = [
            int(row.get("versie_nummer", 0) or 0)
            for row in versions
            if isinstance(row, dict)
            and str(row.get("bier_id", "") or "").strip() == bier_id
            and int(row.get("jaar", 0) or 0) == int(target_year)
        ]
        next_num = (max(existing_nums) if existing_nums else 0) + 1
        new_id = str(uuid4())

        basis_target = {**basis, "jaar": int(target_year)}
        soort = str(source_version.get("type", "") or "").strip().lower()
        calc_type = "Inkoop" if soort == "inkoop" else "Productie"
        eigen_override = eigen_overrides.get(bier_id) if soort != "inkoop" else None
        if isinstance(eigen_override, dict):
            try:
                basis_target["alcoholpercentage"] = float(eigen_override.get("alcoholpercentage", basis_target.get("alcoholpercentage", 0.0)) or 0.0)
            except (TypeError, ValueError):
                pass
            basis_target["tarief_accijns"] = str(eigen_override.get("tarief_accijns", basis_target.get("tarief_accijns", "Hoog")) or "Hoog")
        bier_snapshot_target = dict(bier_snapshot) if isinstance(bier_snapshot, dict) else {}
        if isinstance(eigen_override, dict):
            bier_snapshot_target["alcoholpercentage"] = float(basis_target.get("alcoholpercentage", 0.0) or 0.0)
            bier_snapshot_target["tarief_accijns"] = str(basis_target.get("tarief_accijns", "Hoog") or "Hoog")

        bier_alcohol = float(bier_snapshot_target.get("alcoholpercentage", basis_target.get("alcoholpercentage", 0.0)) or 0.0)
        bier_tarief_accijns = str(
            bier_snapshot_target.get("tarief_accijns", basis_target.get("tarief_accijns", "Hoog")) or "Hoog"
        )
        bier_belastingsoort = str(
            bier_snapshot_target.get("belastingsoort", basis_target.get("belastingsoort", "Accijns")) or "Accijns"
        )

        # Build snapshot product rows.
        basisproducten_snapshot: list[dict[str, Any]] = []
        samengestelde_snapshot: list[dict[str, Any]] = []

        # Preserve enough "inputs" so the Kostprijs beheren wizard can show a meaningful dossier.
        # The definitive target-year cost remains the resultaat_snapshot rows we store below.
        invoer_payload: dict[str, Any] = {}
        if soort == "inkoop":
            # Represent the year-activation scenario as a 1-unit "factuurregel" per product.
            # The wizard already derives liters and per-liter costs from `eenheid`.
            factuurregels: list[dict[str, Any]] = []
            for r in beer_rows:
                product_id = str(r.get("product_id", "") or "").strip()
                if not product_id:
                    continue
                source_primary = float(r.get("source_primary", 0.0) or 0.0)
                scenario_primary = float(r.get("scenario_primary", source_primary) or source_primary)
                factuurregels.append(
                    {
                        "id": str(uuid4()),
                        "aantal": 1,
                        "eenheid": product_id,
                        "subfactuurbedrag": float(scenario_primary),
                        "liters": None,
                    }
                )
            invoer_payload = {
                "ingredienten": {"regels": [], "notities": ""},
                "inkoop": {
                    "factuurnummer": f"Scenario jaarovergang {source_year}->{target_year}",
                    "factuurdatum": "",
                    "verzendkosten": 0.0,
                    "overige_kosten": 0.0,
                    "factuurregels": factuurregels,
                    "facturen": [],
                },
            }
        else:
            # For productie: keep the recipe inputs from the source version as a starting point.
            invoer_payload = (
                deepcopy(source_version.get("invoer", {}))
                if isinstance(source_version.get("invoer", {}), dict)
                else {}
            )
            if isinstance(eigen_override, dict) and isinstance(eigen_override.get("ingredienten"), list):
                ingredienten = invoer_payload.get("ingredienten") if isinstance(invoer_payload, dict) else {}
                if not isinstance(ingredienten, dict):
                    ingredienten = {}
                ingredienten = dict(ingredienten)
                ingredienten["regels"] = [row for row in eigen_override.get("ingredienten", []) if isinstance(row, dict)]
                invoer_payload = dict(invoer_payload)
                invoer_payload["ingredienten"] = ingredienten
        # Build per-liter summary values (these drive PrijsvoorstelWizard comparisons).
        per_liter_candidates: list[float] = []
        for r in beer_rows:
            product_id = str(r.get("product_id", "") or "").strip()
            product_type = str(r.get("product_type", "") or "").strip()
            label = str(r.get("product_label", "") or "")
            source_primary = float(r.get("source_primary", 0.0) or 0.0)
            scenario_primary = float(r.get("scenario_primary", source_primary) or source_primary)
            liters, packaging_cost = _compute_target_product_components(
                product_type=product_type, product_id=product_id, target_year=target_year
            )
            if soort == "inkoop":
                packaging_cost = 0.0
            if soort == "inkoop":
                vaste_kosten_per_liter = float(bereken_indirecte_vaste_kosten_per_ingekochte_liter(target_year) or 0.0)
            else:
                vaste_kosten_per_liter = float(bereken_directe_vaste_kosten_per_productieliter_herverdeeld(target_year) or 0.0)
            vaste_kosten = vaste_kosten_per_liter * float(liters)
            accijns = float(
                bereken_accijns_voor_liters(
                    year=target_year,
                    liters=float(liters),
                    alcoholpercentage=float(bier_alcohol),
                    tarief_accijns=bier_tarief_accijns,
                    belastingsoort=bier_belastingsoort,
                )
            )
            kostprijs = float(scenario_primary) + float(packaging_cost) + float(vaste_kosten) + float(accijns)
            if float(liters) > 0 and float(scenario_primary) > 0:
                try:
                    per_liter_candidates.append(float(scenario_primary) / float(liters))
                except ZeroDivisionError:
                    pass
            row_payload = {
                "product_id": product_id,
                "product_type": product_type,
                "verpakking": label,
                "liters_per_product": float(liters),
                "primaire_kosten": float(scenario_primary),
                "verpakkingskosten": float(packaging_cost),
                "vaste_kosten": float(vaste_kosten),
                "indirecte_kosten": float(vaste_kosten),
                "accijns": float(accijns),
                "kostprijs": float(kostprijs),
            }
            if str(product_type or "").strip().lower() in {"basis", "basisproduct"}:
                basisproducten_snapshot.append(row_payload)
            else:
                samengestelde_snapshot.append(row_payload)

        vaste_kosten_per_liter_summary = 0.0
        if soort == "inkoop":
            vaste_kosten_per_liter_summary = float(bereken_indirecte_vaste_kosten_per_ingekochte_liter(target_year) or 0.0)
        else:
            vaste_kosten_per_liter_summary = float(bereken_directe_vaste_kosten_per_productieliter_herverdeeld(target_year) or 0.0)

        # Estimate variabele kosten per liter from scenario primary costs. For inkoop this should
        # be stable across verpakkingen (scenario_primary scales with liters).
        variabele_kosten_per_liter_summary = float(sum(per_liter_candidates) / len(per_liter_candidates)) if per_liter_candidates else 0.0

        # Accijns is linear in liters; compute per-liter by evaluating liters=1.
        accijns_per_liter_summary = float(
            bereken_accijns_voor_liters(
                year=target_year,
                liters=1.0,
                alcoholpercentage=float(bier_alcohol),
                tarief_accijns=bier_tarief_accijns,
                belastingsoort=bier_belastingsoort,
            )
        )
        integrale_kostprijs_per_liter_summary = (
            float(variabele_kosten_per_liter_summary)
            + float(vaste_kosten_per_liter_summary)
            + float(accijns_per_liter_summary)
        )

        record = normalize_berekening_record(
            {
                "id": new_id,
                "bier_id": bier_id,
                "basisgegevens": basis_target,
                "bier_snapshot": bier_snapshot_target,
                "status": "definitief",
                "calculation_type": calc_type,
                "soort_berekening": {"type": "Inkoop" if soort == "inkoop" else "Eigen productie"},
                "invoer": invoer_payload,
                "versie_nummer": int(next_num),
                "kostprijs": float(integrale_kostprijs_per_liter_summary),
                "calculation_variant": "jaarovergang",
                "jaarovergang": {
                    "bron_berekening_id": str(source_version_id),
                    "bron_jaar": int(source_year),
                    "doel_jaar": int(target_year),
                    "aangemaakt_via": "kostprijs_activatie",
                    "created_at": now,
                },
                "created_at": now,
                "updated_at": now,
                "finalized_at": now,
                "resultaat_snapshot": {
                    "integrale_kostprijs_per_liter": float(integrale_kostprijs_per_liter_summary),
                    "variabele_kosten_per_liter": float(variabele_kosten_per_liter_summary),
                    "directe_vaste_kosten_per_liter": float(vaste_kosten_per_liter_summary),
                    "producten": {
                        "basisproducten": basisproducten_snapshot,
                        "samengestelde_producten": samengestelde_snapshot,
                    },
                },
            }
        )

        if dry_run:
            created_versions += 1
            activated_scopes += len(beer_rows)
            continue

        versions.append(record)
        if not save_berekeningen(versions):
            raise ValueError("Kon kostprijsversies niet opslaan.")
        created_versions += 1
        created_version_ids.append(new_id)

        product_ids = [str(r.get("product_id", "") or "").strip() for r in beer_rows if str(r.get("product_id", "") or "").strip()]
        activated = activate_kostprijsversie_products(new_id, product_ids, context={"action": "year_activation", "owner": owner})
        if not activated:
            raise ValueError("Kon kostprijsproducten niet activeren.")
        activated_scopes += len(product_ids)

    dashboard_service.invalidate_dashboard_summary_cache()
    return {
        "created_versions": int(created_versions),
        "activated": int(activated_scopes),
        "version_ids": created_version_ids,
        "dry_run": bool(dry_run),
    }


def delete_new_year_drafts_for_target_year(*, target_year: int) -> dict[str, Any]:
    """Delete drafts for a target year regardless of owner (admin tooling)."""
    require_postgres()
    if target_year <= 0:
        raise ValueError("Doeljaar moet een geldig getal zijn.")

    existing = postgres_storage.load_dataset("new-year-drafts", deepcopy(DATASET_DEFAULTS["new-year-drafts"]))
    if not isinstance(existing, list):
        existing = []

    removed = 0
    kept: list[dict[str, Any]] = []
    for row in existing:
        if not isinstance(row, dict):
            continue
        try:
            row_year = int(row.get("target_year", 0) or 0)
        except (TypeError, ValueError):
            row_year = 0
        if row_year == int(target_year):
            removed += 1
            continue
        kept.append(row)

    postgres_storage.save_dataset("new-year-drafts", kept, overwrite=True)
    return {"deleted": int(removed)}


def commit_new_year(
    *,
    source_year: int,
    target_year: int,
    owner: str,
    copy_productie: bool = True,
    copy_vaste_kosten: bool = True,
    copy_tarieven: bool = True,
    copy_verpakkingsonderdelen: bool = True,
    copy_verkoopstrategie: bool = True,
    copy_berekeningen: bool = False,
    overwrite_existing: bool = False,
    force: bool = False,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Commit the wizard draft to real datasets in one transaction.

    This is the production-minded path: no partial writes per step.
    """
    require_postgres()
    if source_year <= 0 or target_year <= 0:
        raise ValueError("Bronjaar en doeljaar moeten geldig zijn.")
    if target_year <= source_year:
        raise ValueError("Doeljaar moet hoger zijn dan bronjaar.")

    payload = payload if isinstance(payload, dict) else {}
    draft_data = payload.get("data", {}) if isinstance(payload.get("data", {}), dict) else {}

    report: dict[str, Any] = {"source_year": int(source_year), "target_year": int(target_year), "results": {}}

    # Validate that the source data hasn't changed since the draft started.
    draft_record = load_new_year_draft(owner=str(owner or ""), target_year=int(target_year))
    if not draft_record:
        raise ValueError("Geen concept gevonden voor dit doeljaar. Sla eerst een concept op.")
    stored_fps = draft_record.get("source_fingerprints")
    if not isinstance(stored_fps, dict):
        raise ValueError("Concept mist bronjaar-fingerprints. Sla het concept opnieuw op en probeer opnieuw.")
    current_fps = _compute_source_fingerprints(source_year=int(source_year))
    changed = sorted([key for key, value in current_fps.items() if str(stored_fps.get(key, "")) != str(value)])
    if changed and not force:
        raise ValueError(
            "Bronjaar is gewijzigd sinds je concept is gestart. "
            f"Gewijzigde datasets: {', '.join(changed)}. "
            "Herlaad je concept of commit met force."
        )
    report["results"]["source_changed"] = {"changed": changed, "force": bool(force)}

    with postgres_storage.transaction():
        seeded = prepare_new_year(
            source_year=int(source_year),
            target_year=int(target_year),
            copy_productie=bool(copy_productie),
            copy_vaste_kosten=bool(copy_vaste_kosten),
            copy_tarieven=bool(copy_tarieven),
            copy_verpakkingsonderdelen=bool(copy_verpakkingsonderdelen),
            copy_verkoopstrategie=bool(copy_verkoopstrategie),
            copy_berekeningen=bool(copy_berekeningen),
            overwrite_existing=bool(overwrite_existing),
            include_datasets=False,
            dry_run=False,
        )
        report["results"]["seed"] = seeded.get("results", {})

        # Apply target-year overrides from draft.
        productie_target = draft_data.get("productie_target")
        if isinstance(productie_target, dict):
            productie_payload = load_dataset("productie")
            if not isinstance(productie_payload, dict):
                productie_payload = {}
            productie_payload[str(target_year)] = productie_target
            saved = save_dataset("productie", productie_payload)
            report["results"]["productie_override"] = {"saved": bool(saved)}

        vaste_kosten_target = draft_data.get("vaste_kosten_target")
        if isinstance(vaste_kosten_target, list):
            vaste_payload = load_dataset("vaste-kosten")
            if not isinstance(vaste_payload, dict):
                vaste_payload = {}
            vaste_payload[str(target_year)] = [row for row in vaste_kosten_target if isinstance(row, dict)]
            saved = save_dataset("vaste-kosten", vaste_payload)
            report["results"]["vaste_kosten_override"] = {"saved": bool(saved), "rows": len(vaste_payload.get(str(target_year), []))}

        tarieven_target = draft_data.get("tarieven_target")
        if isinstance(tarieven_target, dict):
            tarieven_payload = load_dataset("tarieven-heffingen")
            if not isinstance(tarieven_payload, list):
                tarieven_payload = []
            sanitized = [row for row in tarieven_payload if isinstance(row, dict) and int(row.get("jaar", 0) or 0) != int(target_year)]
            sanitized.append({**tarieven_target, "jaar": int(target_year)})
            saved = save_dataset("tarieven-heffingen", sanitized)
            report["results"]["tarieven_override"] = {"saved": bool(saved)}

        packaging_prices_target = draft_data.get("packaging_prices_target")
        if isinstance(packaging_prices_target, list):
            packaging_payload = load_dataset("packaging-component-prices")
            if not isinstance(packaging_payload, list):
                packaging_payload = []
            kept = [
                row
                for row in packaging_payload
                if isinstance(row, dict) and int(row.get("jaar", 0) or 0) != int(target_year)
            ]
            kept.extend(
                [
                    {**row, "jaar": int(target_year)}
                    for row in packaging_prices_target
                    if isinstance(row, dict)
                ]
            )
            saved = save_dataset("packaging-component-prices", kept)
            report["results"]["packaging_prices_override"] = {"saved": bool(saved), "rows": len(packaging_prices_target)}

        verkoopstrategie_target = draft_data.get("verkoopstrategie_target")
        if isinstance(verkoopstrategie_target, list):
            verkoop_payload = load_dataset("verkoopprijzen")
            if not isinstance(verkoop_payload, list):
                verkoop_payload = []
            strategy_types = {
                "jaarstrategie",
                "verkoopstrategie_product",
                "verkoopstrategie_verpakking",
            }
            kept = [
                row
                for row in verkoop_payload
                if isinstance(row, dict)
                and not (
                    int(row.get("jaar", 0) or 0) == int(target_year)
                    and str(row.get("record_type", "") or "") in strategy_types
                )
            ]
            kept.extend([row for row in verkoopstrategie_target if isinstance(row, dict)])
            saved = save_dataset("verkoopprijzen", kept)
            report["results"]["verkoopstrategie_override"] = {"saved": bool(saved), "rows": len(verkoopstrategie_target)}

        adviesprijzen_target = draft_data.get("adviesprijzen_target")
        if isinstance(adviesprijzen_target, list):
            advies_payload = load_dataset("adviesprijzen")
            if not isinstance(advies_payload, list):
                advies_payload = []
            kept: list[dict[str, Any]] = []
            for row in advies_payload:
                if not isinstance(row, dict):
                    continue
                try:
                    row_year = int(row.get("jaar", 0) or 0)
                except (TypeError, ValueError):
                    row_year = 0
                if row_year == int(target_year):
                    continue
                kept.append(row)
            # Normalize target rows to the canonical schema (jaar + channel_code + opslag_pct).
            for row in adviesprijzen_target:
                if not isinstance(row, dict):
                    continue
                channel_code = str(row.get("channel_code", row.get("code", "")) or "").strip().lower()
                if not channel_code:
                    continue
                try:
                    opslag_pct = float(row.get("opslag_pct", row.get("opslag", 0)) or 0.0)
                except (TypeError, ValueError):
                    opslag_pct = 0.0
                kept.append(
                    {
                        "id": str(row.get("id", "") or ""),
                        "jaar": int(target_year),
                        "channel_code": channel_code,
                        "opslag_pct": float(opslag_pct),
                    }
                )
            saved = save_dataset("adviesprijzen", kept)
            report["results"]["adviesprijzen_override"] = {"saved": bool(saved), "rows": len(adviesprijzen_target)}

        # Persist scenario inkoop (primair) inputs for cost activation.
        scenario_map = draft_data.get("scenario_primary_costs")
        if isinstance(scenario_map, dict):
            existing = load_dataset("kostprijs-scenario-inkoop")
            if not isinstance(existing, list):
                existing = []
            kept = [
                row
                for row in existing
                if isinstance(row, dict) and int(row.get("jaar", 0) or 0) != int(target_year)
            ]
            for key, raw_value in scenario_map.items():
                # key is "bierId::productId"
                if not isinstance(key, str) or "::" not in key:
                    continue
                bier_id, product_id = key.split("::", 1)
                bier_id = str(bier_id or "").strip()
                product_id = str(product_id or "").strip()
                if not bier_id or not product_id:
                    continue
                try:
                    value = float(raw_value or 0.0)
                except (TypeError, ValueError):
                    continue
                kept.append(
                    {
                        "jaar": int(target_year),
                        "bier_id": bier_id,
                        "product_id": product_id,
                        "scenario_primaire_kosten": float(value),
                    }
                )
            saved = save_dataset("kostprijs-scenario-inkoop", kept)
            report["results"]["kostprijs_scenario_inkoop"] = {"saved": bool(saved), "rows": len(kept)}

        # Draft is no longer needed after commit.
        try:
            delete_new_year_draft(owner=str(owner or ""), target_year=int(target_year))
            report["results"]["draft_deleted"] = True
        except Exception:
            report["results"]["draft_deleted"] = False

    return report


def rollback_year(
    *,
    year: int,
    include_cost_versions: bool = True,
    include_quotes: bool = True,
    include_variabele_kosten: bool = True,
    include_sales_strategy: bool = True,
    include_packaging: bool = True,
    include_tarieven: bool = True,
    include_productie_and_fixed_costs: bool = True,
    include_activations: bool = True,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Delete all data for a given year, without touching other years.

    This is an admin maintenance tool for dev/test environments.
    """
    require_postgres()
    if year <= 0:
        raise ValueError("Jaar moet een geldig getal zijn.")

    year_value = int(year)

    def _filter_list_by_year(rows: Any) -> tuple[list[dict[str, Any]], int]:
        if not isinstance(rows, list):
            return [], 0
        kept: list[dict[str, Any]] = []
        removed = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                row_year = int(row.get("jaar", 0) or 0)
            except (TypeError, ValueError):
                row_year = 0
            if row_year == year_value:
                removed += 1
                continue
            kept.append(row)
        return kept, removed

    def _filter_kostprijsversies(rows: Any) -> tuple[list[dict[str, Any]], int]:
        if not isinstance(rows, list):
            return [], 0
        kept: list[dict[str, Any]] = []
        removed = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            basis = row.get("basisgegevens", {})
            if not isinstance(basis, dict):
                basis = {}
            try:
                row_year = int(row.get("jaar", basis.get("jaar", 0) or 0) or 0)
            except (TypeError, ValueError):
                row_year = 0
            if row_year == year_value:
                removed += 1
                continue
            kept.append(row)
        return kept, removed

    def _filter_variabele_kosten(payload: Any) -> tuple[dict[str, Any], int]:
        if not isinstance(payload, dict):
            return {}, 0
        key = str(year_value)
        if key not in payload:
            return payload, 0
        out = dict(payload)
        del out[key]
        return out, 1

    report: dict[str, Any] = {"dry_run": dry_run, "year": year_value, "results": {}}

    with postgres_storage.transaction():
        if include_activations:
            if dry_run:
                report["results"]["activations"] = {"would_delete": True}
            else:
                report["results"]["activations"] = kostprijs_activation_storage.delete_activations_for_year(year_value)

        if include_productie_and_fixed_costs:
            # These are normalized tables (production_years + fixed_cost_lines).
            if dry_run:
                report["results"]["productie"] = {"would_delete_year": year_value}
                report["results"]["vaste_kosten"] = {"would_delete_year": year_value}
            else:
                production_storage.ensure_schema()
                fixed_costs_storage.ensure_schema()
                with postgres_storage.connect() as conn:
                    with conn.cursor() as cur:
                        cur.execute("DELETE FROM fixed_cost_lines WHERE jaar = %s", (year_value,))
                        deleted_fixed = int(cur.rowcount or 0)
                        cur.execute("DELETE FROM production_years WHERE jaar = %s", (year_value,))
                        deleted_prod = int(cur.rowcount or 0)
                    if not postgres_storage.in_transaction():
                        conn.commit()
                report["results"]["vaste_kosten"] = {"deleted_rows": deleted_fixed}
                report["results"]["productie"] = {"deleted_year": deleted_prod}

                # Also clean legacy dataset payloads (if still present) without touching other years.
                legacy_productie = postgres_storage.load_dataset("productie", None)
                if isinstance(legacy_productie, dict) and str(year_value) in legacy_productie:
                    legacy_out = dict(legacy_productie)
                    del legacy_out[str(year_value)]
                    postgres_storage.save_dataset("productie", legacy_out, overwrite=True)
                    report["results"]["productie"]["legacy_dataset_key_removed"] = True
                legacy_vaste = postgres_storage.load_dataset("vaste-kosten", None)
                if isinstance(legacy_vaste, dict) and str(year_value) in legacy_vaste:
                    legacy_out = dict(legacy_vaste)
                    del legacy_out[str(year_value)]
                    postgres_storage.save_dataset("vaste-kosten", legacy_out, overwrite=True)
                    report["results"]["vaste_kosten"]["legacy_dataset_key_removed"] = True

        if include_tarieven:
            payload = postgres_storage.load_dataset("tarieven-heffingen", [])
            kept, removed = _filter_list_by_year(payload)
            report["results"]["tarieven-heffingen"] = {"removed": removed}
            if removed and not dry_run:
                postgres_storage.save_dataset("tarieven-heffingen", kept, overwrite=True)

        if include_packaging:
            payload = postgres_storage.load_dataset("verpakkingsonderdelen", [])
            kept, removed = _filter_list_by_year(payload)
            report["results"]["verpakkingsonderdelen"] = {"removed": removed}
            if removed and not dry_run:
                postgres_storage.save_dataset("verpakkingsonderdelen", kept, overwrite=True)

        if include_sales_strategy:
            payload = postgres_storage.load_dataset("verkoopprijzen", [])
            kept, removed = _filter_list_by_year(payload)
            report["results"]["verkoopprijzen"] = {"removed": removed}
            if removed and not dry_run:
                postgres_storage.save_dataset("verkoopprijzen", kept, overwrite=True)

        if include_variabele_kosten:
            payload = postgres_storage.load_dataset("variabele-kosten", {})
            kept, removed = _filter_variabele_kosten(payload)
            report["results"]["variabele-kosten"] = {"removed": removed}
            if removed and not dry_run:
                postgres_storage.save_dataset("variabele-kosten", kept, overwrite=True)

        if include_quotes:
            from app.domain import quote_drafts_storage

            existing_quotes = quote_drafts_storage.list_drafts(limit=10000)
            kept_quotes = [row for row in existing_quotes if int(row.get("year", 0) or 0) != year_value]
            removed = len(existing_quotes) - len(kept_quotes)
            report["results"]["quote_drafts"] = {"removed": removed}
            if removed and not dry_run:
                quote_drafts_storage.clear_all_drafts()
                for row in kept_quotes:
                    payload = row.get("payload")
                    if isinstance(payload, dict):
                        quote_drafts_storage.save_draft(payload, draft_id=str(row.get("id", "") or ""))

        if include_cost_versions:
            # Canonical storage (Phase G): normalized cost version tables.
            try:
                from app.domain import cost_versions_storage

                if dry_run:
                    report["results"]["cost_versions_table"] = cost_versions_storage.count_versions_for_year(year_value)
                else:
                    report["results"]["cost_versions_table"] = cost_versions_storage.delete_versions_for_year(year_value)
            except Exception as exc:
                # Fail hard: rollback must not silently ignore table storage, otherwise the year becomes inconsistent.
                raise ValueError(f"Kon cost versions table rollback niet uitvoeren: {exc}") from exc

            payload = postgres_storage.load_dataset("kostprijsversies", None)
            kept_versions, removed_versions = _filter_kostprijsversies(payload)
            report["results"]["kostprijsversies"] = {"removed": removed_versions}
            if removed_versions and not dry_run:
                postgres_storage.save_dataset("kostprijsversies", kept_versions, overwrite=True)

            legacy_payload = postgres_storage.load_dataset("berekeningen", None)
            kept_legacy, removed_legacy = _filter_kostprijsversies(legacy_payload)
            report["results"]["berekeningen"] = {"removed": removed_legacy}
            if removed_legacy and not dry_run:
                postgres_storage.save_dataset("berekeningen", kept_legacy, overwrite=True)

            # Clean legacy activation dataset payload if present; canonical storage is the activations table.
            legacy_acts = postgres_storage.load_dataset("kostprijsproductactiveringen", None)
            if isinstance(legacy_acts, list):
                kept_acts, removed_acts = _filter_list_by_year(legacy_acts)
                report["results"]["kostprijsproductactiveringen_legacy"] = {"removed": removed_acts}
                if removed_acts and not dry_run:
                    postgres_storage.save_dataset("kostprijsproductactiveringen", kept_acts, overwrite=True)

            # Scenario inkoop inputs are stored as rows keyed by year; remove them too to avoid stale activation inputs.
            scenario_rows = postgres_storage.load_dataset("kostprijs-scenario-inkoop", None)
            if isinstance(scenario_rows, list):
                kept_scenario, removed_scenario = _filter_list_by_year(scenario_rows)
                report["results"]["kostprijs-scenario-inkoop"] = {"removed": removed_scenario}
                if removed_scenario and not dry_run:
                    postgres_storage.save_dataset("kostprijs-scenario-inkoop", kept_scenario, overwrite=True)

    if not dry_run:
        dashboard_service.invalidate_dashboard_summary_cache()
    return report


def validate_phase_g_constraints(*, validate_all: bool = False) -> dict[str, Any]:
    """Validate NOT VALID FK constraints introduced during Phase G."""
    require_postgres()

    from app.domain import (
        cost_versions_storage,
        kostprijs_activation_storage,
        kostprijs_scenario_inkoop_storage,
        skus_storage,
    )

    cost_versions_storage.ensure_schema()
    kostprijs_scenario_inkoop_storage.ensure_schema()
    kostprijs_activation_storage.ensure_schema()
    skus_storage.ensure_schema()

    report: dict[str, Any] = {"ok": True, "validated": [], "already_valid": [], "missing": [], "failed": []}

    targets: list[dict[str, str]] = [
        {"constraint": "fk_cost_version_sku_rows_sku", "table": "cost_version_sku_rows"},
    ]
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            for target in targets:
                name = str(target.get("constraint", "") or "")
                table = str(target.get("table", "") or "")
                if not name or not table:
                    continue

                cur.execute("SELECT convalidated FROM pg_constraint WHERE conname = %s", (name,))
                row = cur.fetchone()
                if not row:
                    report["missing"].append({"constraint": name, "table": table})
                    continue

                is_validated = bool(row[0])
                if is_validated and not validate_all:
                    report["already_valid"].append({"constraint": name, "table": table})
                    continue

                try:
                    cur.execute(f"ALTER TABLE {table} VALIDATE CONSTRAINT {name}")
                    report["validated"].append({"constraint": name, "table": table, "revalidated": bool(is_validated)})
                except Exception as exc:
                    report["ok"] = False
                    report["failed"].append({"constraint": name, "table": table, "error": str(exc)})
        if not postgres_storage.in_transaction():
            conn.commit()

    return report


def rollback_yearset(*, year: int, dry_run: bool = False) -> dict[str, Any]:
    """Rollback a committed yearset (production data for a given year).

    Guardrails:
    - Only the latest production year can be rolled back.
    - Removes all year-scoped data for that year, including cost versions and activations created for that year.
    """
    require_postgres()
    if year <= 0:
        raise ValueError("Jaar moet een geldig getal zijn.")

    years = production_storage.list_years()
    if not years:
        raise ValueError("Er zijn geen productie-jaren om terug te draaien.")
    last_year = max(int(y) for y in years)
    year_value = int(year)
    if year_value != last_year:
        raise ValueError(f"Alleen het laatste productiejaar ({last_year}) kan worden teruggedraaid.")

    report: dict[str, Any] = {"dry_run": dry_run, "year": year_value, "last_year": last_year, "results": {}}

    # Use the existing rollback helper for legacy + normalized production/fixed costs + tarieven + legacy packaging rows.
    report["results"]["base"] = rollback_year(
        year=year_value,
        include_cost_versions=True,
        include_quotes=False,
        include_variabele_kosten=False,
        include_sales_strategy=False,
        include_packaging=True,
        include_tarieven=True,
        include_productie_and_fixed_costs=True,
        include_activations=True,
        dry_run=dry_run,
    )

    strategy_types = {"jaarstrategie", "verkoopstrategie_product", "verkoopstrategie_verpakking"}

    with postgres_storage.transaction():
        # Remove packaging price versions for the year (projection is derived).
        versions = load_dataset("packaging-component-price-versions")
        if isinstance(versions, list):
            kept_versions = [
                row
                for row in versions
                if isinstance(row, dict) and int(row.get("jaar", 0) or 0) != year_value
            ]
            removed_versions = len(
                [
                    row
                    for row in versions
                    if isinstance(row, dict) and int(row.get("jaar", 0) or 0) == year_value
                ]
            )
            report["results"]["packaging-component-price-versions"] = {"removed": int(removed_versions)}
            if removed_versions and not dry_run:
                save_dataset("packaging-component-price-versions", kept_versions)

        # Remove strategy records for the year (preserve non-strategy records if any).
        verkoop_payload = load_dataset("verkoopprijzen")
        if isinstance(verkoop_payload, list):
            kept: list[dict[str, Any]] = []
            removed = 0
            for row in verkoop_payload:
                if not isinstance(row, dict):
                    continue
                row_year = int(row.get("jaar", 0) or 0)
                record_type = str(row.get("record_type", "") or "")
                if row_year == year_value and record_type in strategy_types:
                    removed += 1
                    continue
                kept.append(row)
            report["results"]["verkoopprijzen"] = {"removed_strategy_rows": int(removed)}
            if removed and not dry_run:
                save_dataset("verkoopprijzen", kept)

        # Also remove any lingering drafts for this year (optional hygiene).
        try:
            res = delete_new_year_drafts_for_target_year(target_year=year_value)
            report["results"]["drafts_deleted"] = res
        except Exception:
            report["results"]["drafts_deleted"] = {"deleted": 0}

    if not dry_run:
        dashboard_service.invalidate_dashboard_summary_cache()
    return report
