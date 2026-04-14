from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from app.domain import auth_service, dataset_store
from app.domain import product_registry_storage
from app.utils.seed_bundles import SeedProfile, read_seed_bundle, write_seed_bundle


SeedAction = Literal["export", "import"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _require_local_dev() -> None:
    if auth_service.environment_name() not in {"local", "dev", "development"}:
        raise PermissionError("Seed tools zijn alleen toegestaan in local/dev.")


def _foundation_dataset_names() -> list[str]:
    # Foundation demo: year setup + masters + verkoopstrategie (zonder bier-afhankelijke regels).
    # No cost versions / activations.
    return [
        "productie",
        "vaste-kosten",
        "tarieven-heffingen",
        "channels",
        "packaging-components",
        "packaging-component-price-versions",
        "base-product-masters",
        "composite-product-masters",
        "products",
        "sales-strategy-years",
        "sales-strategy-products",
        "verkoopprijzen",
    ]


def _full_dataset_names() -> list[str]:
    # Golden demo: includes cost versions + activations + bieren.
    return [
        *_foundation_dataset_names(),
        "bieren",
        "kostprijsversies",
        "kostprijsproductactiveringen",
    ]


def _filter_verkoopprijzen_for_foundation(rows: Any) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        return []

    keep_record_types = {
        "jaarstrategie",
        "verkoopstrategie_verpakking",
        # Keep record types that are not beer-bound; anything with bier_id is removed.
    }
    cleaned: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        record_type = str(row.get("record_type", "") or "").strip()
        bier_id = str(row.get("bier_id", "") or "").strip()
        if bier_id:
            continue
        if record_type and record_type not in keep_record_types:
            continue
        cleaned.append(row)
    return cleaned


def _filter_payload_for_year(dataset_name: str, payload: Any, *, year: int) -> Any:
    """Filter a dataset payload down to a single year where it is safe and expected.

    We only touch datasets that are year-keyed (dict of year->value) or list rows that contain a `jaar` field.
    Master datasets (products, channels, masters, etc.) are returned unchanged.
    """
    if year <= 0:
        return payload

    # Dict payloads are interpreted as "year -> value".
    if isinstance(payload, dict):
        key = str(int(year))
        if key in payload:
            return {key: payload[key]}
        # If dict isn't year-keyed, do not mutate it.
        return payload

    # List payloads: filter by row["jaar"] or row["year"] when present.
    if isinstance(payload, list):
        filtered: list[Any] = []
        for row in payload:
            if not isinstance(row, dict):
                continue
            row_year = 0
            for key in ("jaar", "year"):
                if key not in row:
                    continue
                try:
                    row_year = int(row.get(key, 0) or 0)
                except (TypeError, ValueError):
                    row_year = 0
                if row_year:
                    break
            if row_year and row_year != int(year):
                continue
            filtered.append(row)
        return filtered

    return payload


def _unwrap_legacy_wrapper(payload: Any) -> Any:
    """Unwrap legacy {Count,value} envelopes if they appear in seed bundles.

    Runtime writes reject these; seed tooling normalizes them to avoid confusing 400s.
    """
    if not isinstance(payload, dict):
        return payload
    keys = {str(k) for k in payload.keys()}
    if keys == {"Count", "value"} or ("Count" in keys and "value" in keys and len(keys) <= 3):
        return payload.get("value")
    return payload


def export_seed_bundle(profile: SeedProfile, *, source_year: int | None = None) -> dict[str, Any]:
    _require_local_dev()
    names = _foundation_dataset_names() if profile == "demo_foundation" else _full_dataset_names()
    filter_year = int(source_year or 0)

    datasets: dict[str, Any] = {}
    for name in names:
        payload = dataset_store.load_dataset(name)
        payload = _unwrap_legacy_wrapper(payload)
        if profile == "demo_foundation" and name == "verkoopprijzen":
            payload = _filter_verkoopprijzen_for_foundation(payload)
        if filter_year:
            payload = _filter_payload_for_year(name, payload, year=filter_year)
        datasets[name] = payload

    bundle: dict[str, Any] = {
        "version": 1,
        "profile": profile,
        "created_at": _now_iso(),
        "source_year": int(source_year or 0),
        "environment": auth_service.environment_name(),
        "storage_provider": dataset_store.get_storage_provider(),
        "datasets": datasets,
    }
    path = write_seed_bundle(profile, bundle)
    return {"ok": True, "profile": profile, "path": str(path)}


def _import_dataset_order(profile: SeedProfile) -> list[str]:
    """Deterministic import order to prevent dropping rows due to missing master references.

    Example: `packaging-component-price-versions` validates against `packaging-components`,
    so masters must be imported first.
    """
    base = [
        "productie",
        "vaste-kosten",
        "tarieven-heffingen",
        "channels",
        "packaging-components",
        "packaging-component-price-versions",
        "base-product-masters",
        "composite-product-masters",
        "products",
        "sales-strategy-years",
        "sales-strategy-products",
        "verkoopprijzen",
    ]
    if profile == "demo_full":
        return [
            *base,
            "bieren",
            "kostprijsversies",
            "kostprijsproductactiveringen",
        ]
    return base


def import_seed_bundle(profile: SeedProfile) -> dict[str, Any]:
    _require_local_dev()
    bundle = read_seed_bundle(profile)
    datasets = bundle.get("datasets")
    if not isinstance(datasets, dict):
        raise ValueError("Seed bundle mist datasets.")

    report: dict[str, Any] = {"reset": {}, "saved": {}, "maintenance": {}}
    # Caller is expected to wrap this in a single transaction.
    report["reset"] = dataset_store.reset_all_datasets_to_defaults()

    dataset_names = set(dataset_store.get_dataset_names())
    imported_masters = False

    fk_dependent = {
        # Table-backed stores that enforce FK(product_id -> products_master.id).
        "kostprijsversies",
        "kostprijsproductactiveringen",
        "prijsvoorstellen",
    }

    for name in _import_dataset_order(profile):
        if name not in datasets:
            continue
        if name not in dataset_names:
            continue

        # Ensure product registry exists before importing FK-dependent datasets.
        if name in fk_dependent and not imported_masters:
            try:
                registry_report = product_registry_storage.rebuild_registry(
                    validate_constraints=False
                )
            except Exception as exc:
                raise ValueError(f"Seed import: kon products registry niet opbouwen: {exc}") from exc
            if int(registry_report.get("count", 0) or 0) <= 0:
                raise ValueError(
                    "Seed import: products registry is leeg. Controleer of base/composite product masters in de seed bundle zitten."
                )
            report["maintenance"]["product_registry_pre"] = registry_report
            imported_masters = True

        payload = _unwrap_legacy_wrapper(datasets.get(name))
        # Writes are validated inside save_dataset.
        report["saved"][name] = bool(dataset_store.save_dataset(name, payload))

        # Phase G: table-backed stores enforce FK(product_id -> products_master.id) on new rows.
        # Seed bundles store product masters as datasets; we must rebuild the registry before
        # importing any table that references products_master (cost versions, activations, quote lines).
        if not imported_masters and name in {"base-product-masters", "composite-product-masters"}:
            # When both masters exist in the seed bundle, we rebuild after the second one is imported.
            have_base = bool(report["saved"].get("base-product-masters")) or ("base-product-masters" not in datasets)
            have_comp = bool(report["saved"].get("composite-product-masters")) or ("composite-product-masters" not in datasets)
            if have_base and have_comp:
                try:
                    registry_report = product_registry_storage.rebuild_registry(
                        validate_constraints=False
                    )
                except Exception as exc:
                    # Fail hard: without a product registry, downstream imports must not proceed.
                    raise ValueError(f"Seed import: kon products registry niet opbouwen: {exc}") from exc
                if int(registry_report.get("count", 0) or 0) <= 0:
                    raise ValueError(
                        "Seed import: products registry is leeg na import van product masters."
                    )
                report["maintenance"]["product_registry_pre"] = registry_report
                imported_masters = True

    # Align with current invariants.
    report["maintenance"]["wrapped_payloads"] = dataset_store.migrate_wrapped_payloads(dry_run=False)
    report["maintenance"]["product_ids"] = dataset_store.migrate_product_ids(dry_run=False)
    report["maintenance"]["activations"] = dataset_store.generate_missing_activations(dry_run=False)
    report["maintenance"]["phase_g_constraints"] = dataset_store.validate_phase_g_constraints(validate_all=False)
    if not bool(report["maintenance"]["phase_g_constraints"].get("ok", False)):
        raise ValueError("Seed import: Phase G FK constraints zijn niet valide. Zie maintenance.phase_g_constraints.")

    return report


def audit_live_data(*, expected_year: int) -> dict[str, Any]:
    """Read-only audit: list which years are present across key datasets."""
    years: dict[str, list[int]] = {}

    def _years_from_value(value: Any) -> set[int]:
        out: set[int] = set()
        if isinstance(value, dict):
            for key in value.keys():
                try:
                    out.add(int(key))
                except (TypeError, ValueError):
                    continue
            return out
        if isinstance(value, list):
            for row in value:
                if not isinstance(row, dict):
                    continue
                try:
                    y = int(row.get("jaar", 0) or 0)
                except (TypeError, ValueError):
                    y = 0
                if y:
                    out.add(y)
            return out
        return out

    key_datasets = [
        "productie",
        "vaste-kosten",
        "tarieven-heffingen",
        "packaging-component-price-versions",
        "packaging-components",
        "base-product-masters",
        "composite-product-masters",
        "products",
        "sales-strategy-years",
        "sales-strategy-products",
        "verkoopprijzen",
        "kostprijsversies",
        "kostprijsproductactiveringen",
        "bieren",
    ]

    for name in key_datasets:
        try:
            payload = dataset_store.load_dataset(name)
        except Exception:
            years[name] = [-1]
            continue
        found = sorted(_years_from_value(payload))
        years[name] = found

    # Minimal integriteitscheck voor full seed (IDs bestaan).
    missing_refs: dict[str, Any] = {}
    try:
        bieren = dataset_store.load_dataset("bieren")
        bier_ids = {str(row.get("id", "") or "") for row in bieren if isinstance(row, dict)}
        products = dataset_store.load_dataset("products")
        product_ids = {str(row.get("id", "") or "") for row in products if isinstance(row, dict)}
        activations = dataset_store.load_dataset("kostprijsproductactiveringen")
        orphan_bier: list[str] = []
        orphan_product: list[str] = []
        for row in activations if isinstance(activations, list) else []:
            if not isinstance(row, dict):
                continue
            if int(row.get("jaar", 0) or 0) != int(expected_year):
                continue
            bier_id = str(row.get("bier_id", "") or "")
            product_id = str(row.get("product_id", "") or "")
            if bier_id and bier_id not in bier_ids:
                orphan_bier.append(bier_id)
            if product_id and product_id not in product_ids:
                orphan_product.append(product_id)
        missing_refs["orphan_activation_bier_ids"] = sorted(set(orphan_bier))[:50]
        missing_refs["orphan_activation_product_ids"] = sorted(set(orphan_product))[:50]
    except Exception:
        missing_refs["error"] = "failed"

    return {"expected_year": int(expected_year), "years": years, "missing_refs": missing_refs}
