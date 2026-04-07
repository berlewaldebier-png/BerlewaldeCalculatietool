from __future__ import annotations

from copy import deepcopy
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
    load_packaging_component_masters,
    load_packaging_component_prices,
    load_packaging_component_price_versions,
    load_samengestelde_producten,
    load_verpakkingsonderdelen,
    load_all_verkoop_records,
    normalize_any_verkoop_record,
    normalize_berekening_record,
    normalize_prijsvoorstel_record,
    migrate_product_ids_to_master_ids,
    generate_missing_kostprijsproductactiveringen,
    duplicate_productie_to_year,
    duplicate_vaste_kosten_to_year,
    duplicate_tarieven_heffingen_to_year,
    duplicate_verpakkingsonderdelen_to_year,
    duplicate_verkoopstrategie_verpakkingen_to_year,
    save_berekeningen,
    save_basisproducten,
    save_kostprijsproductactiveringen,
    save_packaging_component_masters,
    save_packaging_component_prices,
    save_packaging_component_price_versions,
    save_verpakkingsonderdelen,
    save_prijsvoorstellen,
    save_samengestelde_producten,
)

from copy import deepcopy
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
    "prijsvoorstellen": [],
    "verkoopprijzen": [],
    "variabele-kosten": {},
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
    "quotes": [],
    "quote-lines": [],
    "quote-staffels": [],
}

READ_ONLY_PROJECTION_DATASETS = {
    "verpakkingsonderdelen",
    "basisproducten",
    "samengestelde-producten",
    "packaging-component-prices",
    "berekeningen",
    *MODEL_A_DATASET_NAMES,
}


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

    dict_datasets = {"productie", "vaste-kosten", "variabele-kosten", "channels"}
    list_datasets = {
        "tarieven-heffingen",
        "verpakkingsonderdelen",
        "basisproducten",
        "samengestelde-producten",
        "bieren",
        "berekeningen",
        "kostprijsversies",
        "kostprijsproductactiveringen",
        "prijsvoorstellen",
        "verkoopprijzen",
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
        "quote-lines",
        "quote-staffels",
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
    payload = postgres_storage.load_dataset(name, default_value)
    if name == "prijsvoorstellen" and isinstance(payload, list):
        return [
            normalize_prijsvoorstel_record(record)
            for record in payload
            if isinstance(record, dict)
        ]
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
        saved = save_kostprijsproductactiveringen(payload)
        if saved:
            dashboard_service.invalidate_dashboard_summary_cache()
        return saved
    if name == "prijsvoorstellen" and isinstance(data, list):
        payload = [
            normalize_prijsvoorstel_record(record)
            for record in data
            if isinstance(record, dict)
        ]
        saved = save_prijsvoorstellen(payload)
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
    if saved and name in {"kostprijsversies", "berekeningen", "prijsvoorstellen"}:
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
            results[dataset_name] = save_kostprijsproductactiveringen(payload if isinstance(payload, list) else [])
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
                copied = duplicate_verpakkingsonderdelen_to_year(source_year, target_year, overwrite=overwrite_existing)
                report["results"]["verpakkingsonderdelen"] = {"copied_rows": int(copied)}

        if copy_verkoopstrategie:
            if dry_run:
                report["results"]["verkoopstrategie"] = {"would_copy": True}
            else:
                # Copy packaging strategies first (canonical function); other strategy records are stored
                # in the same dataset and will be handled by save_dataset normalization.
                copied = duplicate_verkoopstrategie_verpakkingen_to_year(
                    source_year, target_year, overwrite=overwrite_existing
                )
                report["results"]["verkoopstrategie"] = {"copied_rows": int(copied)}

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
                "verkoopprijzen": load_dataset("verkoopprijzen"),
                "berekeningen": load_dataset("berekeningen"),
            }

    if not dry_run:
        dashboard_service.invalidate_dashboard_summary_cache()
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
            payload = postgres_storage.load_dataset("prijsvoorstellen", [])
            kept, removed = _filter_list_by_year(payload)
            report["results"]["prijsvoorstellen"] = {"removed": removed}
            if removed and not dry_run:
                postgres_storage.save_dataset("prijsvoorstellen", kept, overwrite=True)

        if include_cost_versions:
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

    if not dry_run:
        dashboard_service.invalidate_dashboard_summary_cache()
    return report
