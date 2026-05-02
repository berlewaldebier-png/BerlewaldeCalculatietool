from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
PRODUCTIE_FILE = DATA_DIR / "productie.json"
VASTE_KOSTEN_FILE = DATA_DIR / "vaste_kosten.json"
BIEREN_FILE = DATA_DIR / "bieren.json"
BEREKENINGEN_FILE = DATA_DIR / "berekeningen.json"
KOSTPRIJSVERSIES_FILE = DATA_DIR / "kostprijsversies.json"
KOSTPRIJSPRODUCTACTIVERINGEN_FILE = DATA_DIR / "kostprijsproductactiveringen.json"
VERKOOPPRIJZEN_FILE = DATA_DIR / "verkoopprijzen.json"
PRIJSVOORSTELLEN_FILE = DATA_DIR / "prijsvoorstellen.json"
TARIEVEN_HEFFINGEN_FILE = DATA_DIR / "tarieven_heffingen.json"
VARIABELE_KOSTEN_FILE = DATA_DIR / "variabele_kosten.json"
VERPAKKINGSONDERDELEN_FILE = DATA_DIR / "verpakkingsonderdelen.json"
PACKAGING_COMPONENT_PRICES_FILE = DATA_DIR / "packaging_component_prices.json"
PACKAGING_COMPONENT_PRICE_VERSIONS_FILE = DATA_DIR / "packaging_component_price_versions.json"
BASISPRODUCTEN_FILE = DATA_DIR / "basisproducten.json"
SAMENGESTELDE_PRODUCTEN_FILE = DATA_DIR / "samengestelde_producten.json"
CATALOG_PRODUCTS_FILE = DATA_DIR / "catalog_products.json"
SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX = "verpakkingsonderdeel:"
DEFAULT_BELASTINGSOORT = "Accijns"
DEFAULT_TARIEF_ACCIJNS = "Hoog"
DEFAULT_BTW_TARIEF = "21%"


def _get_postgres_storage_module():
    try:
        from app.domain import postgres_storage  # type: ignore
    except ImportError:
        return None
    return postgres_storage


def _get_kostprijs_activation_storage_module():
    try:
        from app.domain import kostprijs_activation_storage  # type: ignore
    except ImportError:
        return None
    return kostprijs_activation_storage


def load_catalog_products() -> list[dict[str, Any]]:
    """Laadt catalogusproducten.

    Phase E (SKU-aanpak): catalogusproducten worden gemodelleerd als `articles(kind=bundle)`
    met BOM-regels in `bom_lines` (component_article_id of component_sku_id).
    We projecteren dit terug naar het legacy dataset-shape dat de UI verwacht.
    """
    postgres_storage = _get_postgres_storage_module()
    if postgres_storage is None or not postgres_storage.uses_postgres():
        raise RuntimeError("PostgreSQL is verplicht voor runtime opslag (JSON fallback is verwijderd).")

    articles = postgres_storage.load_dataset("articles", [])
    skus = postgres_storage.load_dataset("skus", [])
    bom_lines = postgres_storage.load_dataset("bom-lines", [])

    if not isinstance(articles, list) or not isinstance(skus, list) or not isinstance(bom_lines, list):
        return []

    bundle_articles = [
        row
        for row in articles
        if isinstance(row, dict) and str(row.get("kind", "") or "").strip().lower() == "bundle"
    ]

    sku_by_article: dict[str, dict[str, Any]] = {}
    for sku in skus:
        if not isinstance(sku, dict):
            continue
        if str(sku.get("kind", "") or "").strip().lower() != "article":
            continue
        article_id = str(sku.get("article_id", "") or "").strip()
        if article_id:
            sku_by_article[article_id] = sku

    lines_by_parent: dict[str, list[dict[str, Any]]] = {}
    for line in bom_lines:
        if not isinstance(line, dict):
            continue
        parent_id = str(line.get("parent_article_id", "") or "").strip()
        if not parent_id:
            continue
        lines_by_parent.setdefault(parent_id, []).append(line)

    out: list[dict[str, Any]] = []
    for article in bundle_articles:
        rid = str(article.get("id", "") or "").strip()
        if not rid:
            continue
        payload = dict(article)
        code = str(payload.get("code", "") or "").strip()
        name = str(payload.get("name", payload.get("naam", "")) or "").strip()
        active = bool(payload.get("active", payload.get("actief", True)))

        product_lines: list[dict[str, Any]] = []
        for raw_line in lines_by_parent.get(rid, []):
            line_payload = dict(raw_line)
            # Preserve legacy keys for the editor.
            line_kind = str(line_payload.get("line_kind", "") or "").strip().lower() or "beer"
            # Ensure ids are stable.
            line_id = str(line_payload.get("id", "") or "").strip()
            if not line_id:
                continue
            component_sku_id = str(line_payload.get("component_sku_id", "") or "").strip()
            component_article_id = str(line_payload.get("component_article_id", "") or "").strip()

            normalized = {
                **line_payload,
                "id": line_id,
                "catalog_product_id": rid,
                "line_kind": line_kind,
                "quantity": float(line_payload.get("quantity", 0) or 0),
                # Legacy fields (editor expects these)
                "bier_id": str(line_payload.get("bier_id", "") or ""),
                "product_id": str(line_payload.get("product_id", "") or ""),
                "product_type": str(line_payload.get("product_type", "") or ""),
                "packaging_component_id": str(line_payload.get("packaging_component_id", "") or ""),
                # Phase E explicit refs
                "component_sku_id": component_sku_id,
                "component_article_id": component_article_id,
            }
            product_lines.append(normalized)

        out.append(
            {
                **payload,
                "id": rid,
                "code": code,
                "naam": name,
                "name": name,
                "kind": "bundle",
                "actief": active,
                "active": active,
                "sku_id": str(sku_by_article.get(rid, {}).get("id", "") or ""),
                "bom_lines": product_lines,
            }
        )

    return out


def save_catalog_products(data: list[dict[str, Any]]) -> bool:
    """Slaat catalogusproducten op via Article(kind=bundle) + BOM + SKU(kind=article)."""
    postgres_storage = _get_postgres_storage_module()
    if postgres_storage is None or not postgres_storage.uses_postgres():
        raise RuntimeError("PostgreSQL is verplicht voor runtime opslag (JSON fallback is verwijderd).")

    def _now_iso() -> str:
        return datetime.now(UTC).isoformat()

    def _to_number(value: Any, fallback: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return fallback

    def _resolve_latest_year() -> int:
        years: set[int] = set()
        try:
            productie = production_storage.load_productie()
            if isinstance(productie, dict):
                for key in productie.keys():
                    try:
                        years.add(int(str(key)))
                    except (TypeError, ValueError):
                        continue
        except Exception:
            pass
        try:
            price_rows = load_packaging_component_prices()
            if isinstance(price_rows, list):
                for row in price_rows:
                    if not isinstance(row, dict):
                        continue
                    try:
                        years.add(int(row.get("jaar", 0) or 0))
                    except (TypeError, ValueError):
                        continue
        except Exception:
            pass
        return max([y for y in years if y > 0], default=datetime.now(UTC).year)

    def _load_packaging_price_map(year: int) -> dict[str, float]:
        prices: dict[str, float] = {}
        rows = load_packaging_component_prices()
        if not isinstance(rows, list):
            return prices
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                jaar = int(row.get("jaar", 0) or 0)
            except (TypeError, ValueError):
                jaar = 0
            if jaar != year:
                continue
            vid = str(row.get("verpakkingsonderdeel_id", "") or "").strip()
            if not vid:
                continue
            prices[vid] = _to_number(row.get("prijs_per_stuk", 0), 0.0)
        return prices

    def _load_active_activation_map(year: int) -> dict[str, str]:
        """Return sku_id -> kostprijsversie_id for the active activation in a given year."""
        try:
            rows = load_kostprijsproductactiveringen()
        except Exception:
            rows = []
        if not isinstance(rows, list):
            return {}
        out: dict[str, str] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                jaar = int(row.get("jaar", 0) or 0)
            except (TypeError, ValueError):
                jaar = 0
            if jaar != year:
                continue
            sku_id = str(row.get("sku_id", "") or "").strip()
            version_id = str(row.get("kostprijsversie_id", "") or "").strip()
            if sku_id and version_id:
                out[sku_id] = version_id
        return out

    def _load_cost_by_sku(version_ids: set[str]) -> dict[str, float]:
        """Return sku_id -> kostprijs from cost versions snapshot rows."""
        if not version_ids:
            return {}
        versions = load_kostprijsversies()
        if not isinstance(versions, list):
            return {}
        out: dict[str, float] = {}
        for version in versions:
            if not isinstance(version, dict):
                continue
            vid = str(version.get("id", "") or "").strip()
            if vid not in version_ids:
                continue
            snapshot = version.get("resultaat_snapshot") if isinstance(version, dict) else {}
            producten = (snapshot or {}).get("producten") if isinstance(snapshot, dict) else {}
            basis = (producten or {}).get("basisproducten") if isinstance(producten, dict) else []
            if not isinstance(basis, list):
                continue
            for row in basis:
                if not isinstance(row, dict):
                    continue
                sku_id = str(row.get("sku_id", "") or "").strip()
                if not sku_id:
                    continue
                out[sku_id] = _to_number(row.get("kostprijs", 0), 0.0)
        return out

    # Load current state so we can do replace semantics for only the bundle subset.
    current_articles = postgres_storage.load_dataset("articles", [])
    current_skus = postgres_storage.load_dataset("skus", [])
    current_bom = postgres_storage.load_dataset("bom-lines", [])
    if not isinstance(current_articles, list):
        current_articles = []
    if not isinstance(current_skus, list):
        current_skus = []
    if not isinstance(current_bom, list):
        current_bom = []

    incoming = [row for row in data if isinstance(row, dict)]
    incoming_bundle_ids = {str(row.get("id", "") or "").strip() for row in incoming if str(row.get("id", "") or "").strip()}

    # 1) Replace bundle articles.
    kept_articles = [
        row
        for row in current_articles
        if isinstance(row, dict) and str(row.get("kind", "") or "").strip().lower() != "bundle"
    ]
    next_articles: list[dict[str, Any]] = []
    for row in incoming:
        rid = str(row.get("id", "") or "").strip()
        if not rid:
            continue
        code = str(row.get("code", "") or "").strip()
        name = str(row.get("naam", row.get("name", "")) or "").strip()
        active = bool(row.get("actief", row.get("active", True)))
        payload = dict(row)
        # Persist canonical fields on top-level, keep everything else in payload for debug/compat.
        payload.update({"id": rid, "code": code, "name": name, "kind": "bundle", "active": active, "uom": payload.get("uom", "stuk"), "content_liter": payload.get("content_liter", 0)})
        next_articles.append(payload)

    # 2) Replace SKUs(kind=article) for bundles (one SKU per bundle article).
    kept_skus = [
        row
        for row in current_skus
        if isinstance(row, dict) and not (str(row.get("kind", "") or "").strip().lower() == "article" and str(row.get("article_id", "") or "").strip() in incoming_bundle_ids)
    ]
    next_bundle_skus: list[dict[str, Any]] = []
    for bundle in next_articles:
        rid = str(bundle.get("id", "") or "").strip()
        if not rid:
            continue
        sku_id = str(bundle.get("sku_id", "") or "").strip() or f"sku-bundle-{rid}"
        next_bundle_skus.append(
            {
                "id": sku_id,
                "kind": "article",
                "article_id": rid,
                "beer_id": "",
                "format_article_id": "",
                "code": str(bundle.get("code", "") or "").strip(),
                "name": str(bundle.get("name", bundle.get("naam", "")) or "").strip(),
                "active": bool(bundle.get("active", bundle.get("actief", True))),
            }
        )

    # 3) Replace BOM lines for these bundles.
    kept_bom = [
        row
        for row in current_bom
        if isinstance(row, dict) and str(row.get("parent_article_id", "") or "").strip() not in incoming_bundle_ids
    ]
    next_bundle_bom: list[dict[str, Any]] = []
    for row in incoming:
        parent_id = str(row.get("id", "") or "").strip()
        if not parent_id:
            continue
        lines = row.get("bom_lines", [])
        if not isinstance(lines, list):
            continue
        for line in lines:
            if not isinstance(line, dict):
                continue
            line_id = str(line.get("id", "") or "").strip() or str(uuid4())
            line_kind = str(line.get("line_kind", "") or "").strip().lower() or "beer"
            component_article_id = str(line.get("component_article_id", "") or "").strip()
            component_sku_id = str(line.get("component_sku_id", "") or "").strip()
            # Legacy editor inputs: resolve beer lines into component_sku_id if possible.
            if not component_sku_id and line_kind in {"beer", "beer_product"}:
                bier_id = str(line.get("bier_id", "") or "").strip()
                product_id = str(line.get("product_id", "") or "").strip()
                if bier_id and product_id:
                    # Find the SKU for (beer_id, format_article_id==product_id).
                    for sku in current_skus:
                        if not isinstance(sku, dict):
                            continue
                        if str(sku.get("kind", "") or "beer_format").strip().lower() != "beer_format":
                            continue
                        if str(sku.get("beer_id", "") or "").strip() == bier_id and str(sku.get("format_article_id", "") or "").strip() == product_id:
                            component_sku_id = str(sku.get("id", "") or "").strip()
                            break
            try:
                quantity = float(line.get("quantity", line.get("aantal", 0)) or 0.0)
            except (TypeError, ValueError):
                quantity = 0.0
            uom = str(line.get("uom", "stuk") or "stuk").strip().lower()
            try:
                scrap_pct = float(line.get("scrap_pct", 0) or 0.0)
            except (TypeError, ValueError):
                scrap_pct = 0.0
            payload = dict(line)
            payload.update(
                {
                    "id": line_id,
                    "parent_article_id": parent_id,
                    "component_article_id": component_article_id,
                    "component_sku_id": component_sku_id,
                    "line_kind": line_kind,
                }
            )
            next_bundle_bom.append(
                {
                    **payload,
                    "id": line_id,
                    "parent_article_id": parent_id,
                    "component_article_id": component_article_id,
                    "component_sku_id": component_sku_id,
                    "quantity": quantity,
                    "uom": uom,
                    "scrap_pct": scrap_pct,
                }
            )

    # Persist: we overwrite full datasets to keep things deterministic in dev.
    ok = bool(
        postgres_storage.save_dataset("articles", [*kept_articles, *next_articles], overwrite=True)
        and postgres_storage.save_dataset("skus", [*kept_skus, *next_bundle_skus], overwrite=True)
        and postgres_storage.save_dataset("bom-lines", [*kept_bom, *next_bundle_bom], overwrite=True)
    )
    if not ok:
        return False

    # Bundles become quoteable only after a user creates a definitive kostprijsversie and activates it
    # via Kostprijsbeheer. We intentionally do not auto-create/auto-activate costs here.

    return True


def _load_postgres_dataset(dataset_name: str) -> Any | None:
    postgres_storage = _get_postgres_storage_module()
    if postgres_storage is None or not postgres_storage.uses_postgres():
        raise RuntimeError("PostgreSQL is verplicht voor runtime opslag (JSON fallback is verwijderd).")

    # Phase G: some datasets are stored in dedicated tables but are not routed through
    # `postgres_storage.load_dataset()` (which only knows about app_datasets + a subset of table stores).
    # Route them explicitly here so calculation helpers see the canonical data.
    if dataset_name == "productie":
        from app.domain import production_storage  # type: ignore

        return production_storage.load_productie()
    if dataset_name == "vaste-kosten":
        from app.domain import fixed_costs_storage  # type: ignore

        return fixed_costs_storage.load_grouped_by_year()
    if dataset_name == "catalog-products":
        # Phase E: project bundles from Article/BOM/SKU into the legacy dataset shape.
        return load_catalog_products()

    payload = postgres_storage.load_dataset(dataset_name, None)
    _fail_if_wrapped_payload(dataset_name, payload)
    return payload


def _fail_if_wrapped_payload(dataset_name: str, payload: Any) -> None:
    """Fail hard on legacy `{Count,value}` wrappers.

    Phase C: no read-side repairs. Wrapped payloads must be migrated once, then rejected.
    """

    def is_wrapper_dict(value: Any) -> bool:
        if not isinstance(value, dict):
            return False
        keys = set(value.keys())
        return keys.issubset({"Count", "value"}) and isinstance(value.get("value"), list)

    if is_wrapper_dict(payload):
        raise RuntimeError(
            f"Dataset '{dataset_name}' bevat legacy wrapper {{Count,value}}. "
            "Voer eerst de migratie uit via /api/meta/migrate-wrapped-payloads."
        )
    if isinstance(payload, list):
        for row in payload:
            if is_wrapper_dict(row):
                raise RuntimeError(
                    f"Dataset '{dataset_name}' bevat legacy wrapper {{Count,value}}. "
                    "Voer eerst de migratie uit via /api/meta/migrate-wrapped-payloads."
                )


def _save_postgres_dataset(dataset_name: str, data: Any) -> bool:
    postgres_storage = _get_postgres_storage_module()
    if postgres_storage is None or not postgres_storage.uses_postgres():
        raise RuntimeError("PostgreSQL is verplicht voor runtime opslag (JSON fallback is verwijderd).")

    # Phase G: keep table-backed datasets consistent by routing writes to their canonical stores.
    if dataset_name == "productie":
        from app.domain import production_storage  # type: ignore

        if not isinstance(data, dict):
            raise ValueError("Ongeldig payload voor 'productie': verwacht dict.")
        return bool(production_storage.save_productie(data))
    if dataset_name == "vaste-kosten":
        from app.domain import fixed_costs_storage  # type: ignore

        if not isinstance(data, dict):
            raise ValueError("Ongeldig payload voor 'vaste-kosten': verwacht dict.")
        return bool(fixed_costs_storage.save_grouped_by_year(data))
    if dataset_name == "catalog-products":
        if not isinstance(data, list):
            raise ValueError("Ongeldig payload voor 'catalog-products': verwacht list.")
        return bool(save_catalog_products([row for row in data if isinstance(row, dict)]))

    return postgres_storage.save_dataset(dataset_name, data, overwrite=True)


def _load_postgres_first_list(dataset_name: str, fallback_path: Path) -> list[Any]:
    postgres_payload = _load_postgres_dataset(dataset_name)
    if isinstance(postgres_payload, list):
        return postgres_payload
    # Phase B: no disk fallback. Missing datasets resolve to empty structures.
    return []


def _read_local_json_text(file_path: Path, default_content: str) -> str:
    file_path = _ensure_json_file(file_path, default_content)
    return file_path.read_text(encoding="utf-8-sig")


def _write_local_json_text(file_path: Path, raw_content: str, default_content: str) -> None:
    file_path = _ensure_json_file(file_path, default_content)
    file_path.write_text(raw_content, encoding="utf-8")


def _parse_json_content(raw_content: str, default_value: Any) -> Any:
    raw_content = (raw_content or "").strip()
    if not raw_content:
        return default_value

    try:
        data = json.loads(raw_content)
        if isinstance(data, type(default_value)):
            return data
    except json.JSONDecodeError:
        return default_value

    return default_value


def _ensure_json_file(file_path: Path, default_content: str) -> Path:
    raise RuntimeError(
        "JSON opslag is verwijderd voor runtime (Phase B). "
        "Gebruik PostgreSQL, of importeer seed data via de expliciete bootstrap tooling."
    )


def _load_json_value(file_path: Path, default_value: Any) -> Any:
    raise RuntimeError(
        "JSON read fallback is verwijderd voor runtime (Phase B). "
        "Gebruik PostgreSQL of importeer seed data via de bootstrap tooling."
    )


def _save_json_value(file_path: Path, data: Any, default_content: str) -> bool:
    raise RuntimeError(
        "JSON write fallback is verwijderd voor runtime (Phase B). "
        "Gebruik PostgreSQL of importeer seed data via de bootstrap tooling."
    )


def _now_iso() -> str:
    """Geeft een eenvoudige ISO-timestamp terug."""
    return datetime.now().isoformat()


def ensure_productie_storage() -> Path:
    """Maakt het JSON-bestand voor productie aan."""
    return _ensure_json_file(PRODUCTIE_FILE, "{}")


def ensure_vaste_kosten_storage() -> Path:
    """Maakt het JSON-bestand voor vaste kosten aan."""
    return _ensure_json_file(VASTE_KOSTEN_FILE, "{}")


def ensure_bieren_storage() -> Path:
    """Maakt het JSON-bestand voor bieren aan."""
    return _ensure_json_file(BIEREN_FILE, "[]")


def ensure_berekeningen_storage() -> Path:
    """Maakt het JSON-bestand voor berekeningen aan."""
    return _ensure_json_file(BEREKENINGEN_FILE, "[]")


def ensure_kostprijsversies_storage() -> Path:
    """Maakt het JSON-bestand voor kostprijsversies aan."""
    return _ensure_json_file(KOSTPRIJSVERSIES_FILE, "[]")


def ensure_verkoopprijzen_storage() -> Path:
    """Maakt het JSON-bestand voor verkoopprijzen aan."""
    return _ensure_json_file(VERKOOPPRIJZEN_FILE, "[]")


def ensure_prijsvoorstellen_storage() -> Path:
    """Maakt het JSON-bestand voor prijsvoorstellen aan."""
    return _ensure_json_file(PRIJSVOORSTELLEN_FILE, "[]")


def ensure_tarieven_heffingen_storage() -> Path:
    """Maakt het JSON-bestand voor tarieven en heffingen aan."""
    return _ensure_json_file(TARIEVEN_HEFFINGEN_FILE, "[]")


def ensure_variabele_kosten_storage() -> Path:
    """Maakt het JSON-bestand voor variabele kosten aan."""
    return _ensure_json_file(VARIABELE_KOSTEN_FILE, "{}")


def normalize_tarieven_heffingen_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een tarieven-en-heffingenrecord."""
    def _float_value(key: str) -> float:
        try:
            return float(record.get(key, 0.0) or 0.0)
        except (TypeError, ValueError):
            return 0.0

    return {
        "id": str(record.get("id", "") or uuid4()),
        "jaar": int(record.get("jaar", 0) or 0),
        "tarief_hoog": _float_value("tarief_hoog"),
        "tarief_laag": _float_value("tarief_laag"),
        "verbruikersbelasting": _float_value("verbruikersbelasting"),
    }


def load_tarieven_heffingen() -> list[dict[str, Any]]:
    """Laadt alle tarieven en heffingen veilig in."""
    data = _load_postgres_dataset("tarieven-heffingen")
    if not isinstance(data, list):
        data = []

    records = [
        normalize_tarieven_heffingen_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    return sorted(records, key=lambda item: int(item.get("jaar", 0) or 0))


def save_tarieven_heffingen(data: list[dict[str, Any]]) -> bool:
    """Slaat alle tarieven en heffingen veilig op."""
    normalized = [
        normalize_tarieven_heffingen_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    normalized = sorted(normalized, key=lambda item: int(item.get("jaar", 0) or 0))
    return _save_postgres_dataset("tarieven-heffingen", normalized)


def upsert_tarieven_heffingen_row(record: dict[str, Any]) -> bool:
    """Voegt een tarievenregel toe of werkt een bestaande regel bij."""
    records = load_tarieven_heffingen()
    normalized = normalize_tarieven_heffingen_record(record)
    row_id = normalized["id"]

    updated = False
    for index, existing in enumerate(records):
        if str(existing.get("id", "")) != row_id:
            continue
        records[index] = normalized
        updated = True
        break

    if not updated:
        records.append(normalized)

    return save_tarieven_heffingen(records)


def delete_tarieven_heffingen_row(row_id: str) -> bool:
    """Verwijdert een tarievenregel op basis van id."""
    records = load_tarieven_heffingen()
    filtered = [record for record in records if str(record.get("id", "")) != row_id]

    if len(filtered) == len(records):
        return False

    return save_tarieven_heffingen(filtered)


def get_tarieven_heffingen_for_year(year: int | str) -> dict[str, Any] | None:
    """Geeft tarieven en heffingen terug voor een specifiek jaar."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    for record in load_tarieven_heffingen():
        if int(record.get("jaar", 0) or 0) == year_value:
            return record
    return None


def duplicate_tarieven_heffingen_to_year(
    source_year: int | str,
    target_year: int | str,
    *,
    overwrite: bool = False,
) -> bool:
    """Dupliceert tarieven en heffingen van bronjaar naar doeljaar."""
    source_record = get_tarieven_heffingen_for_year(source_year)
    if not source_record:
        return False
    if get_tarieven_heffingen_for_year(target_year) is not None and not overwrite:
        return False
    return upsert_tarieven_heffingen_row(
        {
            **source_record,
            "id": str(uuid4()),
            "jaar": int(target_year),
        }
    )


def _normalize_bier_record(bier: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert bierdata."""
    def _parse_decimal_float(value: Any) -> float:
        if isinstance(value, str):
            value = value.strip().replace(",", ".")
        try:
            return float(value)
        except (TypeError, ValueError):
            raise ValueError("Alcohol % moet een geldig getal zijn.")

    biernaam = str(bier.get("biernaam", ""))  # keep raw for validation
    belastingsoort = str(bier.get("belastingsoort", "") or "").strip()
    tarief_accijns = str(
        bier.get("tarief_accijns", DEFAULT_TARIEF_ACCIJNS) or DEFAULT_TARIEF_ACCIJNS
    ).strip()
    btw_tarief = str(bier.get("btw_tarief", DEFAULT_BTW_TARIEF) or DEFAULT_BTW_TARIEF)

    if not belastingsoort:
        belastingsoort = DEFAULT_BELASTINGSOORT

    if belastingsoort not in {"Accijns", "Verbruiksbelasting", "Geen"}:
        belastingsoort = DEFAULT_BELASTINGSOORT
    if tarief_accijns not in {"Hoog", "Laag"}:
        tarief_accijns = DEFAULT_TARIEF_ACCIJNS
    if btw_tarief not in {"9%", "21%"}:
        btw_tarief = DEFAULT_BTW_TARIEF

    raw_alcohol = bier.get("alcoholpercentage", None)
    # Fail-hard: don't silently turn empty/undefined alcohol percentage into 0.0.
    if str(biernaam or "").strip() and (raw_alcohol is None or raw_alcohol == ""):
        raise ValueError("Alcohol % is verplicht voor bierstamdata (biernaam is ingevuld).")
    alcoholpercentage = _parse_decimal_float(raw_alcohol or 0.0)

    return {
        "id": str(bier.get("id", "")),
        "biernaam": biernaam,
        "stijl": str(bier.get("stijl", "")),
        "alcoholpercentage": alcoholpercentage,
        "belastingsoort": belastingsoort,
        "tarief_accijns": tarief_accijns,
        "btw_tarief": btw_tarief,
        "created_at": str(bier.get("created_at", "") or ""),
        "updated_at": str(bier.get("updated_at", "") or ""),
    }


def normalize_bier_record(bier: dict[str, Any]) -> dict[str, Any]:
    """Publieke wrapper voor het normaliseren van bierdata."""
    normalized = _normalize_bier_record(bier)
    normalized["created_at"] = normalized["created_at"] or _now_iso()
    normalized["updated_at"] = normalized["updated_at"] or normalized["created_at"]
    return normalized


def normalize_inkoop_factuur_record(factuur: dict[str, Any] | None) -> dict[str, Any]:
    """Normaliseert een inkoopfactuur met regels."""
    source = factuur if isinstance(factuur, dict) else {}
    factuurregels = source.get("factuurregels", [])
    if not isinstance(factuurregels, list):
        factuurregels = []

    normalized_rows: list[dict[str, Any]] = []
    for row in factuurregels:
        if not isinstance(row, dict):
            continue
        try:
            aantal = float(row.get("aantal", 0.0) or 0.0)
        except (TypeError, ValueError):
            aantal = 0.0
        try:
            liters = float(row.get("liters", 0.0) or 0.0)
        except (TypeError, ValueError):
            liters = 0.0
        try:
            subfactuurbedrag = float(row.get("subfactuurbedrag", 0.0) or 0.0)
        except (TypeError, ValueError):
            subfactuurbedrag = 0.0
        try:
            afvulkosten_fust = float(row.get("afvulkosten_fust", 0.0) or 0.0)
        except (TypeError, ValueError):
            afvulkosten_fust = 0.0

        normalized_rows.append(
            {
                "id": str(row.get("id", "") or uuid4()),
                "aantal": aantal,
                "eenheid": str(row.get("eenheid", "") or ""),
                "liters": liters,
                "subfactuurbedrag": subfactuurbedrag,
                "afvulkosten_fust": afvulkosten_fust,
            }
        )

    return {
        "id": str(source.get("id", "") or uuid4()),
        "factuurnummer": str(source.get("factuurnummer", "") or ""),
        "factuurdatum": str(source.get("factuurdatum", "") or ""),
        "verzendkosten": float(source.get("verzendkosten", 0.0) or 0.0),
        "overige_kosten": float(source.get("overige_kosten", 0.0) or 0.0),
        "factuurregels": normalized_rows,
    }


def _factuur_is_meaningful(factuur: dict[str, Any] | None) -> bool:
    normalized = normalize_inkoop_factuur_record(factuur)
    if str(normalized.get("factuurnummer", "") or "").strip():
        return True
    if str(normalized.get("factuurdatum", "") or "").strip():
        return True
    if float(normalized.get("verzendkosten", 0.0) or 0.0) > 0:
        return True
    if float(normalized.get("overige_kosten", 0.0) or 0.0) > 0:
        return True

    for row in normalized.get("factuurregels", []):
        if not isinstance(row, dict):
            continue
        if float(row.get("aantal", 0.0) or 0.0) > 0:
            return True
        if float(row.get("liters", 0.0) or 0.0) > 0:
            return True
        if float(row.get("subfactuurbedrag", 0.0) or 0.0) > 0:
            return True
        if str(row.get("eenheid", "") or "").strip():
            return True
    return False


def _sanitize_inkoop_facturen(facturen: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not isinstance(facturen, list):
        return []
    return [
        normalize_inkoop_factuur_record(factuur)
        for factuur in facturen
        if isinstance(factuur, dict) and _factuur_is_meaningful(factuur)
    ]


def _cleanup_kostprijsversie_references(
    records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    changed = False
    existing_ids = {
        str(record.get("id", "") or "")
        for record in records
        if isinstance(record, dict) and str(record.get("id", "") or "").strip()
    }
    cleaned_records: list[dict[str, Any]] = []

    for source_record in records:
        if not isinstance(source_record, dict):
            changed = True
            continue

        record = normalize_berekening_record(source_record)
        invoer = record.get("invoer", {}) if isinstance(record.get("invoer", {}), dict) else {}
        inkoop = invoer.get("inkoop", {}) if isinstance(invoer.get("inkoop", {}), dict) else {}
        original_facturen = inkoop.get("facturen", [])
        sanitized_facturen = _sanitize_inkoop_facturen(original_facturen)

        original_factuur_count = len(original_facturen) if isinstance(original_facturen, list) else 0
        if len(sanitized_facturen) != original_factuur_count:
            changed = True

        if sanitized_facturen:
            first_factuur = sanitized_facturen[0]
            record.setdefault("invoer", {})
            if isinstance(record["invoer"], dict):
                record["invoer"]["inkoop"] = {
                    **inkoop,
                    "facturen": sanitized_facturen,
                    "factuurnummer": str(first_factuur.get("factuurnummer", "") or ""),
                    "factuurdatum": str(first_factuur.get("factuurdatum", "") or ""),
                    "verzendkosten": float(first_factuur.get("verzendkosten", 0.0) or 0.0),
                    "overige_kosten": float(first_factuur.get("overige_kosten", 0.0) or 0.0),
                    "factuurregels": deepcopy(first_factuur.get("factuurregels", [])),
                }
        elif str(record.get("brontype", "") or "") == "factuur" and str(record.get("status", "") or "") == "concept":
            changed = True
            continue

        bron_berekening_id = str(record.get("bron_berekening_id", "") or "")
        if bron_berekening_id and bron_berekening_id not in existing_ids:
            record["bron_berekening_id"] = ""
            changed = True

        if str(record.get("brontype", "") or "") == "hercalculatie":
            bron_id = str(record.get("bron_id", "") or "")
            if bron_id and bron_id not in existing_ids:
                record["bron_id"] = ""
                changed = True

        cleaned_records.append(record)

    return cleaned_records, changed


def normalize_kostprijsproduct_activering_record(
    record: dict[str, Any] | None,
) -> dict[str, Any]:
    source = record if isinstance(record, dict) else {}
    created_at = str(source.get("created_at", "") or "") or _now_iso()
    updated_at = str(source.get("updated_at", "") or "") or created_at
    return {
        "id": str(source.get("id", "") or uuid4()),
        "sku_id": str(source.get("sku_id", "") or ""),
        "jaar": int(source.get("jaar", 0) or 0),
        "kostprijsversie_id": str(source.get("kostprijsversie_id", "") or ""),
        "effectief_vanaf": str(
            source.get("effectief_vanaf", "") or source.get("effective_from", "") or ""
        ),
        "effectief_tot": str(
            source.get("effectief_tot", "") or source.get("effective_to", "") or ""
        ),
        "created_at": created_at,
        "updated_at": updated_at,
        # Legacy keys retained as empty placeholders; the canonical key is `sku_id`.
        "bier_id": str(source.get("bier_id", "") or ""),
        "product_id": str(source.get("product_id", "") or ""),
        "product_type": str(source.get("product_type", "") or ""),
    }


def load_kostprijsproductactiveringen() -> list[dict[str, Any]]:
    postgres_storage = _get_postgres_storage_module()
    activation_storage = _get_kostprijs_activation_storage_module()
    if (
        postgres_storage is not None
        and activation_storage is not None
        and postgres_storage.uses_postgres()
    ):
        data = activation_storage.load_activations()
        return [
            normalize_kostprijsproduct_activering_record(row)
            for row in data
            if isinstance(row, dict)
            # Canonical dataset payload: only active activations.
            and not str(row.get("effectief_tot", "") or "")
        ]

    postgres_payload = _load_postgres_dataset("kostprijsproductactiveringen")
    if isinstance(postgres_payload, list):
        data = postgres_payload
    else:
        data = []
    if not isinstance(data, list):
        return []
    return [
        normalize_kostprijsproduct_activering_record(row)
        for row in data
        if isinstance(row, dict)
    ]


def _known_sku_ids() -> set[str]:
    postgres_storage = _get_postgres_storage_module()
    if postgres_storage is None or not postgres_storage.uses_postgres():
        return set()
    payload = postgres_storage.load_dataset("skus", [])
    if not isinstance(payload, list):
        return set()
    return {
        str(record.get("id", "") or "")
        for record in payload
        if isinstance(record, dict) and str(record.get("id", "") or "")
    }


def _known_kostprijsversie_ids() -> set[str]:
    return {
        str(record.get("id", "") or "")
        for record in load_kostprijsversies()
        if isinstance(record, dict) and str(record.get("id", "") or "")
    }


def _validate_kostprijsproductactiveringen(
    rows: list[dict[str, Any]],
    *,
    known_skus: set[str] | None = None,
    known_versions: set[str] | None = None,
) -> list[dict[str, Any]]:
    known_skus = known_skus if known_skus is not None else _known_sku_ids()
    known_versions = known_versions if known_versions is not None else _known_kostprijsversie_ids()
    validated: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, int]] = set()
    invalid: list[dict[str, Any]] = []
    duplicates: list[tuple[str, int]] = []
    for row in rows:
        normalized = normalize_kostprijsproduct_activering_record(row)
        sku_id = str(normalized.get("sku_id", "") or "")
        version_id = str(normalized.get("kostprijsversie_id", "") or "")
        year_value = int(normalized.get("jaar", 0) or 0)
        unique_key = (sku_id, year_value)
        if not sku_id or sku_id not in known_skus:
            invalid.append({"reason": "unknown_sku", "row": normalized})
            continue
        if year_value <= 0:
            invalid.append({"reason": "invalid_year", "row": normalized})
            continue
        if not version_id or version_id not in known_versions:
            invalid.append({"reason": "unknown_kostprijsversie", "row": normalized})
            continue
        if unique_key in seen_keys:
            duplicates.append(unique_key)
            continue
        seen_keys.add(unique_key)
        validated.append(normalized)
    if invalid:
        counts: dict[str, int] = {}
        for item in invalid:
            reason = str(item.get("reason", "") or "unknown").strip() or "unknown"
            counts[reason] = counts.get(reason, 0) + 1
        samples = [
            item.get("row", {})
            for item in invalid[:3]
            if isinstance(item.get("row", {}), dict)
        ]
        raise ValueError(
            "Ongeldige kostprijsproductactiveringen: gevonden verwijzingen naar onbekende bier/product/kostprijsversie. "
            f"Aantallen per reden: {counts}. Voorbeelden: {samples}."
        )
    if duplicates:
        raise ValueError("Dubbele kostprijsproductactiveringen gevonden voor hetzelfde sku/jaar.")
    return validated


def save_kostprijsproductactiveringen(
    data: list[dict[str, Any]],
    *,
    context: dict[str, Any] | None = None,
) -> bool:
    normalized = _validate_kostprijsproductactiveringen(
        [row for row in data if isinstance(row, dict)]
    )
    postgres_storage = _get_postgres_storage_module()
    activation_storage = _get_kostprijs_activation_storage_module()
    if (
        postgres_storage is not None
        and activation_storage is not None
        and postgres_storage.uses_postgres()
    ):
        ctx = activation_storage.ActivationContext(
            run_id=str((context or {}).get("run_id", "") or ""),
            actor=str((context or {}).get("actor", "") or ""),
            action=str((context or {}).get("action", "") or ""),
        )
        # PUT semantics: the provided rows are the new truth.
        # This is also important for migrations where product_id values change.
        return bool(activation_storage.replace_activations(normalized, context=ctx))

    if _save_postgres_dataset("kostprijsproductactiveringen", normalized):
        return True
    return False


def upsert_kostprijsproductactiveringen(
    data: list[dict[str, Any]],
    *,
    context: dict[str, Any] | None = None,
) -> bool:
    """Voegt activaties toe of werkt ze bij per (sku,jaar) zonder de volledige set te vervangen."""
    normalized = _validate_kostprijsproductactiveringen(
        [row for row in data if isinstance(row, dict)]
    )
    postgres_storage = _get_postgres_storage_module()
    activation_storage = _get_kostprijs_activation_storage_module()
    if (
        postgres_storage is not None
        and activation_storage is not None
        and postgres_storage.uses_postgres()
    ):
        ctx = activation_storage.ActivationContext(
            run_id=str((context or {}).get("run_id", "") or ""),
            actor=str((context or {}).get("actor", "") or ""),
            action=str((context or {}).get("action", "") or ""),
        )
        # Activation semantics should preserve history (close old, open new) instead of overwriting.
        action = str(ctx.action or "")
        if action == "year_activation" or action.startswith("activate_") or action == "activate_products" or action == "activate_version":
            return bool(activation_storage.activate_activations(normalized, context=ctx))
        return bool(activation_storage.upsert_activations(normalized, context=ctx))

    # Fallback: merge and overwrite the dataset payload.
    existing = load_kostprijsproductactiveringen()
    by_key: dict[tuple[str, int], dict[str, Any]] = {
        (str(row.get("sku_id", "") or ""), int(row.get("jaar", 0) or 0)): normalize_kostprijsproduct_activering_record(row)
        for row in existing
        if isinstance(row, dict)
    }
    for row in normalized:
        key = (str(row.get("sku_id", "") or ""), int(row.get("jaar", 0) or 0))
        by_key[key] = normalize_kostprijsproduct_activering_record(row)
    return bool(_save_postgres_dataset("kostprijsproductactiveringen", list(by_key.values())))


def _resolve_kostprijsproduct_refs(
    record: dict[str, Any],
    basisproducten_by_id: dict[str, dict[str, Any]],
    samengestelde_by_id: dict[str, dict[str, Any]],
) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    def _append(product_id: str, product_type: str) -> None:
        normalized_id = str(product_id or "")
        normalized_type = str(product_type or "")
        if not normalized_id or not normalized_type:
            return
        identity = (normalized_type, normalized_id)
        if identity in seen:
            return
        seen.add(identity)
        refs.append(
            {
                "product_id": normalized_id,
                "product_type": normalized_type,
            }
        )

    producten = record.get("resultaat_snapshot", {}).get("producten", {})
    if isinstance(producten, dict):
        for row in producten.get("basisproducten", []):
            if not isinstance(row, dict):
                continue
            product_id = str(row.get("product_id", "") or "")
            _append(product_id, "basis")
        for row in producten.get("samengestelde_producten", []):
            if not isinstance(row, dict):
                continue
            product_id = str(row.get("product_id", "") or "")
            _append(product_id, "samengesteld")

    inkoop = ((record.get("invoer", {}) or {}).get("inkoop", {}) or {})
    if isinstance(inkoop, dict):
        facturen = inkoop.get("facturen", [])
        if not isinstance(facturen, list):
            facturen = []
        for factuur in facturen:
            if not isinstance(factuur, dict):
                continue
            regels = factuur.get("factuurregels", [])
            if not isinstance(regels, list):
                regels = []
            for regel in regels:
                if not isinstance(regel, dict):
                    continue
                unit_id = str(regel.get("eenheid", "") or "").strip()
                if unit_id in basisproducten_by_id:
                    _append(unit_id, "basis")
                    continue
                samengesteld = samengestelde_by_id.get(unit_id)
                if samengesteld:
                    _append(unit_id, "samengesteld")
                    onderdelen = samengesteld.get("basisproducten", [])
                    if isinstance(onderdelen, list):
                        for onderdeel in onderdelen:
                            if not isinstance(onderdeel, dict):
                                continue
                            basis_id = str(onderdeel.get("basisproduct_id", "") or "")
                            if basis_id.startswith(SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX):
                                continue
                            if basis_id in basisproducten_by_id:
                                _append(basis_id, "basis")

    return refs


def _sync_kostprijsproductactiveringen(
    records: list[dict[str, Any]],
    activations: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    basisproducten = [
        row for row in load_basisproducten() if isinstance(row, dict)
    ]
    samengestelde_producten = [
        row for row in load_samengestelde_producten() if isinstance(row, dict)
    ]
    basisproducten_by_id = {
        str(row.get("id", "") or ""): row for row in basisproducten if str(row.get("id", "") or "")
    }
    samengestelde_by_id = {
        str(row.get("id", "") or ""): row
        for row in samengestelde_producten
        if str(row.get("id", "") or "")
    }

    definitive_records = [
        record
        for record in records
        if str(record.get("status", "") or "") == "definitief"
    ]
    record_by_id = {
        str(record.get("id", "") or ""): record
        for record in definitive_records
        if str(record.get("id", "") or "")
    }
    product_refs_by_version: dict[str, list[dict[str, str]]] = {
        version_id: _resolve_kostprijsproduct_refs(
            record,
            basisproducten_by_id,
            samengestelde_by_id,
        )
        for version_id, record in record_by_id.items()
    }
    version_has_product = {
        version_id: {
            (ref["product_type"], ref["product_id"])
            for ref in refs
            if ref.get("product_id") and ref.get("product_type")
        }
        for version_id, refs in product_refs_by_version.items()
    }

    by_group: dict[tuple[str, int, str], dict[str, Any]] = {}
    for row in activations:
        normalized = normalize_kostprijsproduct_activering_record(row)
        bier_id = str(normalized.get("bier_id", "") or "")
        jaar = int(normalized.get("jaar", 0) or 0)
        product_id = str(normalized.get("product_id", "") or "")
        version_id = str(normalized.get("kostprijsversie_id", "") or "")
        if not bier_id or not jaar or not product_id or not version_id:
            continue
        record = record_by_id.get(version_id)
        if not record:
            continue
        if str(record.get("bier_id", "") or "") != bier_id or int(record.get("jaar", 0) or 0) != jaar:
            continue
        if (str(normalized.get("product_type", "") or ""), product_id) not in version_has_product.get(version_id, set()) and any(
            product_id == existing_product_id for (_, existing_product_id) in version_has_product.get(version_id, set())
        ) is False:
            continue
        group_key = (bier_id, jaar, product_id)
        current = by_group.get(group_key)
        if current is None or (
            str(normalized.get("updated_at", "") or ""),
            str(normalized.get("id", "") or ""),
        ) > (
            str(current.get("updated_at", "") or ""),
            str(current.get("id", "") or ""),
        ):
            by_group[group_key] = normalized

    cleaned = sorted(
        by_group.values(),
        key=lambda item: (
            str(item.get("bier_id", "") or ""),
            int(item.get("jaar", 0) or 0),
            str(item.get("product_type", "") or ""),
            str(item.get("product_id", "") or ""),
        ),
    )

    activation_times_by_version: dict[str, list[str]] = {}
    for activation in cleaned:
        version_id = str(activation.get("kostprijsversie_id", "") or "")
        if version_id:
            activation_times_by_version.setdefault(version_id, []).append(
                str(activation.get("effectief_vanaf", "") or "")
            )

    for record in records:
        version_id = str(record.get("id", "") or "")
        times = activation_times_by_version.get(version_id, [])
        if str(record.get("status", "") or "") != "definitief" or not times:
            record["is_actief"] = False
            record["effectief_vanaf"] = ""
            continue
        record["is_actief"] = True
        record["effectief_vanaf"] = max(
            [time for time in times if str(time or "").strip()],
            default=str(
                record.get("effectief_vanaf", "")
                or record.get("finalized_at", "")
                or record.get("updated_at", "")
                or _now_iso()
            ),
        )

    return records, cleaned


def _normalize_and_sync_kostprijsversie_state(
    records: list[dict[str, Any]],
    activations: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    normalized_records = [
        normalize_berekening_record(record)
        for record in records
        if isinstance(record, dict)
    ]
    normalized_records, _ = _cleanup_kostprijsversie_references(normalized_records)
    normalized_records = _assign_kostprijsversie_numbers(normalized_records)
    # Phase E: no read-side repairs/sync of bieren. Bierstamdata is canonical and is only
    # created/linked on explicit write actions (e.g. afronden/definitief maken).
    normalized_activations = activations
    if normalized_activations is None:
        normalized_activations = load_kostprijsproductactiveringen()
    # Phase E: never auto-create activations on read. We only clean/filter existing activations
    # and derive `is_actief/effectief_vanaf` flags from them.
    normalized_records, normalized_activations = _sync_kostprijsproductactiveringen(
        normalized_records,
        normalized_activations,
    )
    return normalized_records, normalized_activations


def _normalize_ingredient_row_record(row: dict[str, Any] | None) -> dict[str, Any]:
    """Normaliseert een ingredientregel voor opslag in berekeningen."""
    source = row if isinstance(row, dict) else {}

    def _float_value(key: str) -> float:
        try:
            return float(source.get(key, 0.0) or 0.0)
        except (TypeError, ValueError):
            return 0.0

    ingredient_value = str(source.get("ingredient", "") or source.get("ingrediënt", "") or "")

    return {
        "id": str(source.get("id", "") or uuid4()),
        "ingredient": ingredient_value,
        "omschrijving": str(source.get("omschrijving", "") or ""),
        "hoeveelheid": _float_value("hoeveelheid"),
        "eenheid": str(source.get("eenheid", "") or ""),
        "prijs": _float_value("prijs"),
        "benodigd_in_recept": _float_value("benodigd_in_recept"),
    }


def _snapshot_float(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _snapshot_known_product_ids() -> tuple[set[str], set[str]]:
    basis_ids = {
        str(row.get("id", "") or "")
        for row in load_basisproducten()
        if isinstance(row, dict) and str(row.get("id", "") or "")
    }
    samengesteld_ids = {
        str(row.get("id", "") or "")
        for row in load_samengestelde_producten()
        if isinstance(row, dict) and str(row.get("id", "") or "")
    }
    return basis_ids, samengesteld_ids


def _normalize_resultaat_snapshot_product_row(
    row: dict[str, Any] | None,
    *,
    product_type_hint: str = "",
) -> dict[str, Any]:
    source = row if isinstance(row, dict) else {}
    verpakking = str(
        source.get("verpakking", "")
        or source.get("verpakkingseenheid", "")
        or source.get("omschrijving", "")
        or ""
    )
    primaire_kosten = _snapshot_float(
        source.get("primaire_kosten", source.get("variabele_kosten", 0.0))
    )
    verpakkingskosten = _snapshot_float(source.get("verpakkingskosten", 0.0))
    vaste_kosten = _snapshot_float(
        source.get("vaste_kosten", source.get("vaste_directe_kosten", 0.0))
    )
    accijns = _snapshot_float(source.get("accijns", 0.0))
    kostprijs = _snapshot_float(
        source.get("kostprijs", primaire_kosten + verpakkingskosten + vaste_kosten + accijns)
    )
    liters_per_product = source.get(
        "liters_per_product",
        source.get("totale_inhoud_liter", source.get("inhoud_per_eenheid_liter")),
    )
    explicit_product_type = str(source.get("product_type", "") or "").strip().lower()
    explicit_product_id = str(source.get("product_id", "") or "").strip()
    product_type = explicit_product_type or str(product_type_hint or "").strip().lower()
    if product_type not in {"basis", "samengesteld"}:
        product_type = str(product_type_hint or "").strip().lower()
    product_id = explicit_product_id

    return {
        "biernaam": str(source.get("biernaam", "") or ""),
        "soort": str(source.get("soort", "") or ""),
        "product_id": product_id,
        "product_type": product_type,
        "verpakking": verpakking,
        "verpakkingseenheid": verpakking,
        "primaire_kosten": primaire_kosten,
        "variabele_kosten": primaire_kosten,
        "verpakkingskosten": verpakkingskosten,
        "vaste_kosten": vaste_kosten,
        "vaste_directe_kosten": vaste_kosten,
        "accijns": accijns,
        "kostprijs": kostprijs,
        "liters_per_product": _snapshot_float(liters_per_product),
    }


def _normalize_resultaat_snapshot_producten(
    producten: dict[str, Any] | None,
) -> dict[str, list[dict[str, Any]]]:
    source = producten if isinstance(producten, dict) else {}
    basisproducten = source.get("basisproducten", [])
    samengestelde_producten = source.get("samengestelde_producten", [])

    if not isinstance(basisproducten, list):
        basisproducten = []
    if not isinstance(samengestelde_producten, list):
        samengestelde_producten = []

    return {
        "basisproducten": [
            _normalize_resultaat_snapshot_product_row(
                row,
                product_type_hint="basis",
            )
            for row in basisproducten
            if isinstance(row, dict)
        ],
        "samengestelde_producten": [
            _normalize_resultaat_snapshot_product_row(
                row,
                product_type_hint="samengesteld",
            )
            for row in samengestelde_producten
            if isinstance(row, dict)
        ],
    }


def _assert_snapshot_product_refs_complete(record: dict[str, Any]) -> None:
    """Fail-hard when a definitive kostprijsversie contains snapshot rows without product_id.

    We intentionally do not keep read-side fallback logic in verkoopstrategie/prijsvoorstel.
    If older records exist, the admin must run `/api/meta/migrate-product-ids` once.
    """
    status = str(record.get("status", "") or "").strip().lower()
    if status != "definitief":
        return

    snapshot = record.get("resultaat_snapshot")
    if not isinstance(snapshot, dict):
        return
    producten = snapshot.get("producten")
    if not isinstance(producten, dict):
        return
    rows: list[dict[str, Any]] = []
    basis = producten.get("basisproducten", [])
    if isinstance(basis, list):
        rows.extend([row for row in basis if isinstance(row, dict)])
    samengesteld = producten.get("samengestelde_producten", [])
    if isinstance(samengesteld, list):
        rows.extend([row for row in samengesteld if isinstance(row, dict)])

    missing = [
        str(row.get("verpakking", "") or row.get("verpakkingseenheid", "") or row.get("omschrijving", "") or "")
        for row in rows
        if not str(row.get("product_id", "") or "").strip()
    ]
    if missing:
        raise ValueError(
            "Kostprijs snapshot mist product_id verwijzingen (oude data). "
            "Draai 1x de admin migratie: POST /api/meta/migrate-product-ids. "
            f"Ontbrekend voor: {', '.join([m for m in missing if m]) or '(onbekend)'}"
        )


def normalize_berekening_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een kostprijsversie-record voor Nieuwe kostprijsberekening."""
    status = str(record.get("status", "concept") or "concept").strip().lower()
    if status not in {"concept", "definitief"}:
        status = "concept"

    def _parse_decimal_float(value: Any, *, field_label: str) -> float:
        if isinstance(value, str):
            value = value.strip().replace(",", ".")
        try:
            return float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{field_label} moet een geldig getal zijn.")

    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}

    basis_biernaam = str(
        basisgegevens.get("biernaam", record.get("biernaam", "")) or ""
    )
    bier_id_for_validation = str(record.get("bier_id", "") or "").strip()
    basis_raw_alcohol = basisgegevens.get(
        "alcoholpercentage", record.get("alcoholpercentage", None)
    )
    if status == "definitief" and bier_id_for_validation and basis_biernaam.strip() and (
        basis_raw_alcohol is None or basis_raw_alcohol == ""
    ):
        raise ValueError("Alcohol % is verplicht voor definitieve kostprijsberekeningen.")
    basis_alcoholpercentage = _parse_decimal_float(
        basis_raw_alcohol or 0.0, field_label="Alcohol %"
    )

    basisgegevens = {
        "jaar": int(basisgegevens.get("jaar", record.get("jaar", 0)) or 0),
        "biernaam": basis_biernaam,
        "stijl": str(basisgegevens.get("stijl", record.get("stijl", "")) or ""),
        "alcoholpercentage": basis_alcoholpercentage,
        "belastingsoort": str(
            basisgegevens.get("belastingsoort", DEFAULT_BELASTINGSOORT) or DEFAULT_BELASTINGSOORT
        ),
        "tarief_accijns": str(
            basisgegevens.get("tarief_accijns", DEFAULT_TARIEF_ACCIJNS) or DEFAULT_TARIEF_ACCIJNS
        ),
        "btw_tarief": str(basisgegevens.get("btw_tarief", DEFAULT_BTW_TARIEF) or DEFAULT_BTW_TARIEF),
        # SKU-aanpak: preserve non-beer scope identifiers for article/bundle cost versions.
        "article_id": str(basisgegevens.get("article_id", record.get("article_id", "")) or ""),
        "sku_id": str(basisgegevens.get("sku_id", record.get("sku_id", "")) or ""),
    }

    soort_berekening = record.get("soort_berekening", {})
    if not isinstance(soort_berekening, dict):
        soort_berekening = {}
    calculation_type = str(
        soort_berekening.get("type", record.get("calculation_type", "")) or ""
    ).strip()
    if calculation_type not in {"Eigen productie", "Inkoop"}:
        calculation_type = "Eigen productie"
    soort_berekening = {"type": calculation_type}

    bier_snapshot = record.get("bier_snapshot", {})
    if not isinstance(bier_snapshot, dict):
        bier_snapshot = {}
    snapshot_biernaam = str(
        bier_snapshot.get("biernaam", basisgegevens.get("biernaam", "")) or ""
    )
    snapshot_raw_alcohol = bier_snapshot.get(
        "alcoholpercentage", basisgegevens.get("alcoholpercentage", 0.0)
    )
    if status == "definitief" and snapshot_biernaam.strip() and (
        snapshot_raw_alcohol is None or snapshot_raw_alcohol == ""
    ):
        raise ValueError("Alcohol % is verplicht voor definitieve bier-snapshots.")
    snapshot_alcoholpercentage = _parse_decimal_float(
        snapshot_raw_alcohol or 0.0, field_label="Alcohol %"
    )
    bier_snapshot = {
        "biernaam": snapshot_biernaam,
        "stijl": str(bier_snapshot.get("stijl", basisgegevens.get("stijl", "")) or ""),
        "alcoholpercentage": snapshot_alcoholpercentage,
        "belastingsoort": str(
            bier_snapshot.get(
                "belastingsoort",
                basisgegevens.get("belastingsoort", DEFAULT_BELASTINGSOORT),
            )
            or DEFAULT_BELASTINGSOORT
        ),
        "tarief_accijns": str(
            bier_snapshot.get(
                "tarief_accijns",
                basisgegevens.get("tarief_accijns", DEFAULT_TARIEF_ACCIJNS),
            )
            or DEFAULT_TARIEF_ACCIJNS
        ),
        "btw_tarief": str(
            bier_snapshot.get(
                "btw_tarief",
                basisgegevens.get("btw_tarief", DEFAULT_BTW_TARIEF),
            )
            or DEFAULT_BTW_TARIEF
        ),
    }

    hercalculatie_basis = record.get("hercalculatie_basis", {})
    if not isinstance(hercalculatie_basis, dict):
        hercalculatie_basis = {}
    hercalculatie_basis = {
        "ingredienten_regels": [
            _normalize_ingredient_row_record(row)
            for row in hercalculatie_basis.get("ingredienten_regels", [])
            if isinstance(row, dict)
        ],
    }

    invoer = record.get("invoer", {})
    if not isinstance(invoer, dict):
        invoer = {}
    ingredienten = invoer.get("ingredienten", {})
    if not isinstance(ingredienten, dict):
        ingredienten = {}
    ingredienten = {
        "regels": ingredienten.get("regels", []),
        "notities": str(ingredienten.get("notities", "") or ""),
    }
    if not isinstance(ingredienten["regels"], list):
        ingredienten["regels"] = []

    inkoop = invoer.get("inkoop", {})
    if not isinstance(inkoop, dict):
        inkoop = {}
    raw_facturen = inkoop.get("facturen", [])
    if not isinstance(raw_facturen, list):
        raw_facturen = []

    facturen = [
        normalize_inkoop_factuur_record(factuur)
        for factuur in raw_facturen
        if isinstance(factuur, dict)
    ]
    primary_factuur = facturen[0] if facturen else normalize_inkoop_factuur_record({})
    inkoop = {
        "regels": inkoop.get("regels", []),
        "factuurregels": primary_factuur.get("factuurregels", []),
        "factuurnummer": str(primary_factuur.get("factuurnummer", "") or ""),
        "factuurdatum": str(primary_factuur.get("factuurdatum", "") or ""),
        "notities": str(inkoop.get("notities", "") or ""),
        "verzendkosten": float(primary_factuur.get("verzendkosten", 0.0) or 0.0),
        "overige_kosten": float(primary_factuur.get("overige_kosten", 0.0) or 0.0),
        "facturen": facturen,
    }
    if not isinstance(inkoop["regels"], list):
        inkoop["regels"] = []

    resultaat_snapshot = record.get("resultaat_snapshot")
    if resultaat_snapshot is None:
        resultaat_snapshot = {}
    if not isinstance(resultaat_snapshot, dict):
        resultaat_snapshot = {}

    # Phase D: no read-side legacy repairs for product ids.
    # If older stored records still contain non-canonical product ids, run the explicit
    # admin migration (`/api/meta/migrate-product-ids`) once and then keep runtime strict.

    resultaat_snapshot = {
        "integrale_kostprijs_per_liter": resultaat_snapshot.get(
            "integrale_kostprijs_per_liter"
        ),
        "variabele_kosten_per_liter": resultaat_snapshot.get(
            "variabele_kosten_per_liter"
        ),
        "directe_vaste_kosten_per_liter": resultaat_snapshot.get(
            "directe_vaste_kosten_per_liter"
        ),
        "producten": _normalize_resultaat_snapshot_producten(
            resultaat_snapshot.get("producten")
        ),
    }

    jaarovergang = record.get("jaarovergang", {})
    if not isinstance(jaarovergang, dict):
        jaarovergang = {}
    jaarovergang = {
        "bron_berekening_id": str(jaarovergang.get("bron_berekening_id", "") or ""),
        "bron_jaar": int(jaarovergang.get("bron_jaar", 0) or 0),
        "doel_jaar": int(jaarovergang.get("doel_jaar", basisgegevens.get("jaar", 0)) or 0),
        "aangemaakt_via": str(jaarovergang.get("aangemaakt_via", "") or ""),
        "created_at": str(jaarovergang.get("created_at", "") or ""),
    }

    created_at = str(record.get("created_at", "") or "") or _now_iso()
    updated_at = str(record.get("updated_at", "") or "") or created_at
    finalized_at = str(record.get("finalized_at", "") or "")
    if status == "definitief" and not finalized_at:
        finalized_at = updated_at or created_at
    jaar = int(basisgegevens.get("jaar", 0) or 0)
    soort = "inkoop" if calculation_type == "Inkoop" else "productie"
    kostprijs = _snapshot_float(resultaat_snapshot.get("integrale_kostprijs_per_liter"))
    calculation_variant = str(
        record.get("calculation_variant", "origineel") or "origineel"
    )
    bron_berekening_id = str(record.get("bron_berekening_id", "") or "")

    primary_factuur_id = ""
    if facturen:
        primary_factuur_id = str((facturen[0] or {}).get("id", "") or "")

    if calculation_variant == "hercalculatie":
        bron_type = "hercalculatie"
        bron_id = bron_berekening_id
    elif calculation_variant == "factuur":
        bron_type = "factuur"
        bron_id = primary_factuur_id or str(record.get("bron_id", "") or "")
    elif soort == "inkoop" and primary_factuur_id:
        bron_type = "factuur"
        bron_id = primary_factuur_id
    else:
        bron_type = "stam"
        bron_id = bron_berekening_id

    try:
        versie_nummer = int(record.get("versie_nummer", 0) or 0)
    except (TypeError, ValueError):
        versie_nummer = 0

    effectief_vanaf = str(
        record.get("effectief_vanaf", "")
        or record.get("effective_from", "")
        or ""
    )
    is_actief = bool(record.get("is_actief", record.get("is_active", False)))
    if status != "definitief":
        is_actief = False
        effectief_vanaf = ""

    normalized = {
        "id": str(record.get("id", "") or uuid4()),
        "bier_id": str(record.get("bier_id", "") or ""),
        "jaar": jaar,
        "versie_nummer": versie_nummer,
        "type": soort,
        "kostprijs": kostprijs,
        "brontype": bron_type,
        "bron_id": bron_id,
        "effectief_vanaf": effectief_vanaf,
        "is_actief": is_actief,
        "aangemaakt_op": created_at,
        "aangepast_op": updated_at,
        "record_type": str(record.get("record_type", "kostprijsberekening") or "kostprijsberekening"),
        "calculation_variant": calculation_variant,
        "bron_berekening_id": bron_berekening_id,
        "hercalculatie_reden": str(record.get("hercalculatie_reden", "") or ""),
        "hercalculatie_notitie": str(record.get("hercalculatie_notitie", "") or ""),
        "hercalculatie_timestamp": str(record.get("hercalculatie_timestamp", "") or ""),
        "hercalculatie_basis": hercalculatie_basis,
        "status": status,
        "basisgegevens": basisgegevens,
        "soort_berekening": soort_berekening,
        "invoer": {
            "ingredienten": ingredienten,
            "inkoop": inkoop,
        },
        "bier_snapshot": bier_snapshot,
        "resultaat_snapshot": resultaat_snapshot if status == "definitief" else {},
        "jaarovergang": jaarovergang,
        "last_completed_step": max(1, int(record.get("last_completed_step", 1) or 1)),
        "created_at": created_at,
        "updated_at": updated_at,
        "finalized_at": finalized_at if status == "definitief" else "",
    }

    _assert_snapshot_product_refs_complete(normalized)

    return normalized




def init_verpakkingsonderdelen_file() -> Path:
    """Maakt het JSON-bestand voor verpakkingsonderdelen aan."""
    return _ensure_json_file(VERPAKKINGSONDERDELEN_FILE, "[]")


def bereken_prijs_per_stuk(
    hoeveelheid: float | int | None,
    prijs_artikel: float | int | None,
) -> float:
    """Berekent de prijs per stuk veilig."""
    try:
        hoeveelheid_value = float(hoeveelheid or 0.0)
        prijs_value = float(prijs_artikel or 0.0)
    except (TypeError, ValueError):
        return 0.0

    if hoeveelheid_value <= 0 or prijs_value < 0:
        return 0.0

    return prijs_value / hoeveelheid_value


def _fallback_verpakkingsonderdelen_years() -> list[int]:
    years = get_productie_years()
    if years:
        return years
    return [datetime.now().year]


def normalize_verpakkingsonderdeel_record(
    record: dict[str, Any],
    *,
    default_year: int | None = None,
    default_component_key: str | None = None,
    preserve_id: str | None = None,
) -> dict[str, Any]:
    """Normaliseert een verpakkingsonderdeelrecord voor jaargebonden opslag."""
    try:
        hoeveelheid = float(record.get("hoeveelheid", 0.0) or 0.0)
    except (TypeError, ValueError):
        hoeveelheid = 0.0

    try:
        prijs_per_stuk = float(record.get("prijs_per_stuk", 0.0) or 0.0)
    except (TypeError, ValueError):
        prijs_per_stuk = 0.0
    if prijs_per_stuk <= 0:
        try:
            prijs_artikel = float(record.get("prijs_artikel", 0.0) or 0.0)
        except (TypeError, ValueError):
            prijs_artikel = 0.0
        prijs_per_stuk = bereken_prijs_per_stuk(hoeveelheid, prijs_artikel)

    raw_year = record.get("jaar", default_year)
    try:
        jaar = int(raw_year or 0)
    except (TypeError, ValueError):
        jaar = int(default_year or 0)

    component_key = str(
        record.get("component_key")
        or default_component_key
        or record.get("id")
        or uuid4()
    )

    return {
        "id": str(preserve_id or record.get("id") or uuid4()),
        "component_key": component_key,
        "jaar": jaar,
        "omschrijving": str(record.get("omschrijving", "") or ""),
        "hoeveelheid": hoeveelheid,
        "prijs_per_stuk": prijs_per_stuk,
        "beschikbaar_voor_samengesteld": bool(
            record.get("beschikbaar_voor_samengesteld", False)
        ),
    }


def _sort_verpakkingsonderdelen(
    onderdelen: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return sorted(
        onderdelen,
        key=lambda item: (
            int(item.get("jaar", 0) or 0),
            str(item.get("omschrijving", "") or "").lower(),
            str(item.get("component_key", "") or ""),
        ),
    )


def _ensure_unique_verpakkingsonderdeel_ids(
    onderdelen: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    """Zorgt dat elke jaarregel een unieke id heeft."""
    seen_ids: set[str] = set()
    changed = False
    normalized_rows: list[dict[str, Any]] = []

    for onderdeel in onderdelen:
        current = dict(onderdeel)
        onderdeel_id = str(current.get("id", "") or uuid4())
        if onderdeel_id in seen_ids:
            current["id"] = str(uuid4())
            changed = True
        seen_ids.add(str(current.get("id", "") or ""))
        normalized_rows.append(current)

    return _sort_verpakkingsonderdelen(normalized_rows), changed


def _migrate_verpakkingsonderdelen_data(
    data: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    """Migreert legacy verpakkingsonderdelen naar jaargebonden opslag."""
    records = [record for record in data if isinstance(record, dict)]
    if not records:
        return [], False

    looks_legacy = any(
        "jaar" not in record or "component_key" not in record
        for record in records
    )

    migrated: list[dict[str, Any]] = []
    changed = False

    if looks_legacy:
        years = _fallback_verpakkingsonderdelen_years()
        earliest_year = min(years)
        for record in records:
            component_key = str(record.get("id") or uuid4())
            for year in years:
                migrated.append(
                    normalize_verpakkingsonderdeel_record(
                        record,
                        default_year=year,
                        default_component_key=component_key,
                        preserve_id=str(record.get("id")) if year == earliest_year else None,
                    )
                )
        changed = True
    else:
        migrated = [
            normalize_verpakkingsonderdeel_record(record)
            for record in records
        ]

    migrated, unique_changed = _ensure_unique_verpakkingsonderdeel_ids(migrated)
    changed = changed or unique_changed
    return migrated, changed


def get_verpakkingsonderdelen_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft verpakkingsonderdelen terug voor een geselecteerd jaar."""
    return load_verpakkingsonderdelen(year)


def get_verpakkingsonderdeel_by_component_key(
    component_key: str,
    year: int | str,
    *,
    fallback_to_latest: bool = True,
) -> dict[str, Any] | None:
    """Zoekt een verpakkingsonderdeel op basis van component_key en jaar."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        year_value = 0

    matches = [
        onderdeel
        for onderdeel in load_verpakkingsonderdelen()
        if str(onderdeel.get("component_key", "") or "") == str(component_key or "")
    ]
    if not matches:
        return None

    exact_match = next(
        (
            onderdeel
            for onderdeel in matches
            if int(onderdeel.get("jaar", 0) or 0) == year_value
        ),
        None,
    )
    if exact_match is not None:
        return exact_match

    if not fallback_to_latest:
        return None

    past_matches = [
        onderdeel
        for onderdeel in matches
        if int(onderdeel.get("jaar", 0) or 0) <= year_value
    ]
    if past_matches:
        return sorted(
            past_matches,
            key=lambda item: int(item.get("jaar", 0) or 0),
        )[-1]

    return sorted(matches, key=lambda item: int(item.get("jaar", 0) or 0))[-1]


def add_verpakkingsonderdeel(
    omschrijving: str,
    hoeveelheid: float,
    prijs_per_stuk: float,
    *,
    year: int | str | None = None,
    beschikbaar_voor_samengesteld: bool = False,
) -> dict[str, Any] | None:
    """Voegt een nieuw verpakkingsonderdeel toe."""
    onderdelen = load_verpakkingsonderdelen()
    target_year = int(year) if year is not None else max(_fallback_verpakkingsonderdelen_years())
    onderdeel = normalize_verpakkingsonderdeel_record(
        {
            "omschrijving": omschrijving,
            "hoeveelheid": hoeveelheid,
            "prijs_per_stuk": prijs_per_stuk,
            "beschikbaar_voor_samengesteld": beschikbaar_voor_samengesteld,
        },
        default_year=target_year,
    )
    onderdelen.append(onderdeel)

    if save_verpakkingsonderdelen(onderdelen):
        return onderdeel

    return None


def get_verpakkingsonderdeel_by_id(
    onderdeel_id: str,
    year: int | str | None = None,
) -> dict[str, Any] | None:
    """Haalt een verpakkingsonderdeel op op basis van id, optioneel op jaar."""
    all_onderdelen = load_verpakkingsonderdelen()
    for onderdeel in all_onderdelen:
        if str(onderdeel.get("id")) != onderdeel_id:
            continue
        if year is None:
            return onderdeel
        return get_verpakkingsonderdeel_by_component_key(
            str(onderdeel.get("component_key", "") or ""),
            year,
            fallback_to_latest=False,
        ) or onderdeel

    if year is not None:
        return get_verpakkingsonderdeel_by_component_key(
            onderdeel_id,
            year,
            fallback_to_latest=False,
        )

    return None


def update_verpakkingsonderdeel(
    onderdeel_id: str,
    omschrijving: str,
    hoeveelheid: float,
    prijs_per_stuk: float,
    *,
    year: int | str | None = None,
    beschikbaar_voor_samengesteld: bool = False,
) -> bool:
    """Werkt een bestaand verpakkingsonderdeel bij."""
    onderdelen = load_verpakkingsonderdelen()
    year_value = None
    if year is not None:
        try:
            year_value = int(year)
        except (TypeError, ValueError):
            year_value = None

    for index, onderdeel in enumerate(onderdelen):
        if str(onderdeel.get("id")) != onderdeel_id:
            continue
        if year_value is not None and int(onderdeel.get("jaar", 0) or 0) != year_value:
            continue

        onderdelen[index] = normalize_verpakkingsonderdeel_record(
            {
                **onderdeel,
                "id": onderdeel_id,
                "omschrijving": omschrijving,
                "hoeveelheid": hoeveelheid,
                "prijs_per_stuk": prijs_per_stuk,
                "beschikbaar_voor_samengesteld": beschikbaar_voor_samengesteld,
            }
        )
        return save_verpakkingsonderdelen(onderdelen)

    return False


def delete_verpakkingsonderdeel(
    onderdeel_id: str,
    *,
    year: int | str | None = None,
) -> bool:
    """Verwijdert een verpakkingsonderdeel op basis van id, optioneel binnen een jaar."""
    onderdelen = load_verpakkingsonderdelen()

    if year is None:
        filtered = [
            onderdeel
            for onderdeel in onderdelen
            if str(onderdeel.get("id")) != onderdeel_id
        ]
        if len(filtered) == len(onderdelen):
            return False
        return save_verpakkingsonderdelen(filtered)

    onderdeel = get_verpakkingsonderdeel_by_id(onderdeel_id, year)
    if not onderdeel:
        return False

    target_id = str(onderdeel.get("id", "") or "")
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return False

    filtered = [
        record
        for record in onderdelen
        if not (
            str(record.get("id", "") or "") == target_id
            and int(record.get("jaar", 0) or 0) == year_value
        )
    ]
    if len(filtered) == len(onderdelen):
        return False
    return save_verpakkingsonderdelen(filtered)


def duplicate_verpakkingsonderdelen_to_year(
    source_year: int | str,
    target_year: int | str,
    *,
    overwrite: bool = False,
) -> int:
    """Dupliceert alle verpakkingsonderdelen van een bronjaar naar een doeljaar."""
    try:
        source_year_value = int(source_year)
        target_year_value = int(target_year)
    except (TypeError, ValueError):
        return 0

    records = load_verpakkingsonderdelen()
    source_records = [
        record
        for record in records
        if int(record.get("jaar", 0) or 0) == source_year_value
    ]
    if not source_records:
        return 0

    target_by_component = {
        str(record.get("component_key", "") or ""): index
        for index, record in enumerate(records)
        if int(record.get("jaar", 0) or 0) == target_year_value
    }

    changed_count = 0
    for source in source_records:
        component_key = str(source.get("component_key", "") or "")
        normalized = normalize_verpakkingsonderdeel_record(
            source,
            default_year=target_year_value,
            default_component_key=component_key,
        )
        normalized["id"] = str(uuid4())
        normalized["jaar"] = target_year_value

        if component_key in target_by_component:
            if not overwrite:
                continue
            records[target_by_component[component_key]] = normalized
        else:
            records.append(normalized)
        changed_count += 1

    if changed_count > 0:
        save_verpakkingsonderdelen(records)

    return changed_count


def duplicate_packaging_component_prices_to_year(
    source_year: int | str,
    target_year: int | str,
    *,
    overwrite: bool = False,
) -> int:
    """Dupliceert de jaarprijzen (packaging-component-prices) van bronjaar naar doeljaar.

    Let op: de opslaglaag voor jaarprijzen is versioned (packaging-component-price-versions).
    We schrijven via `save_packaging_component_prices()` zodat de versie-tabellen correct blijven.
    """
    try:
        source_year_value = int(source_year)
        target_year_value = int(target_year)
    except (TypeError, ValueError):
        return 0

    masters = [
        record
        for record in load_packaging_component_masters()
        if isinstance(record, dict) and str(record.get("id", "") or "")
    ]
    component_ids = [str(record.get("id", "") or "") for record in masters]
    if not component_ids:
        return 0

    rows = load_packaging_component_prices()
    if not isinstance(rows, list):
        rows = []

    source_by_component: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            year_value = int(row.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            continue
        if year_value != source_year_value:
            continue
        component_id = str(row.get("verpakkingsonderdeel_id", "") or "").strip()
        if not component_id:
            continue
        source_by_component[component_id] = float(row.get("prijs_per_stuk", 0.0) or 0.0)

    target_index: dict[str, int] = {}
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        try:
            year_value = int(row.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            continue
        if year_value != target_year_value:
            continue
        component_id = str(row.get("verpakkingsonderdeel_id", "") or "").strip()
        if component_id:
            target_index[component_id] = index

    changed = 0
    # Copy explicit source-year prices.
    for component_id, price in source_by_component.items():
        if component_id in target_index:
            if not overwrite:
                continue
            existing = rows[target_index[component_id]]
            if isinstance(existing, dict):
                rows[target_index[component_id]] = {
                    **existing,
                    "verpakkingsonderdeel_id": component_id,
                    "jaar": target_year_value,
                    "prijs_per_stuk": float(price),
                }
            else:
                rows[target_index[component_id]] = {
                    "id": str(uuid4()),
                    "verpakkingsonderdeel_id": component_id,
                    "jaar": target_year_value,
                    "prijs_per_stuk": float(price),
                }
            changed += 1
        else:
            rows.append(
                {
                    "id": str(uuid4()),
                    "verpakkingsonderdeel_id": component_id,
                    "jaar": target_year_value,
                    "prijs_per_stuk": float(price),
                }
            )
            changed += 1

    # Ensure the target year is complete (every master has a row).
    existing_target_components = set(target_index.keys())
    existing_target_components.update(
        str(row.get("verpakkingsonderdeel_id", "") or "").strip()
        for row in rows
        if isinstance(row, dict) and int(row.get("jaar", 0) or 0) == target_year_value
    )
    for component_id in component_ids:
        if component_id in existing_target_components:
            continue
        rows.append(
            {
                "id": str(uuid4()),
                "verpakkingsonderdeel_id": component_id,
                "jaar": target_year_value,
                "prijs_per_stuk": 0.0,
            }
        )
        changed += 1

    if changed <= 0:
        return 0

    ok = save_packaging_component_prices([row for row in rows if isinstance(row, dict)])
    return changed if ok else 0


def init_basisproducten_file() -> Path:
    """Maakt het JSON-bestand voor basisproducten aan."""
    return _ensure_json_file(BASISPRODUCTEN_FILE, "[]")


def _fallback_producten_year() -> int:
    """Bepaalt het bronjaar voor legacy productdata."""
    years = get_productie_years()
    if years:
        return min(int(year) for year in years)
    return 2025


def _normalize_basisproduct_onderdeel_row(row: dict[str, Any]) -> dict[str, Any]:
    onderdeel_id = str(row.get("verpakkingsonderdeel_id", "") or "")
    gekoppeld_onderdeel = get_verpakkingsonderdeel_by_id(onderdeel_id)
    component_key = str(
        row.get("verpakkingsonderdeel_key")
        or row.get("component_key")
        or (gekoppeld_onderdeel or {}).get("component_key")
        or onderdeel_id
    )
    prijs_per_stuk = float(row.get("prijs_per_stuk", 0.0) or 0.0)
    hoeveelheid = float(row.get("hoeveelheid", 0.0) or 0.0)
    totale_kosten = float(
        row.get("totale_kosten", bereken_basisproduct_regel_kosten(hoeveelheid, prijs_per_stuk))
        or 0.0
    )

    return {
        "verpakkingsonderdeel_id": onderdeel_id,
        "verpakkingsonderdeel_key": component_key,
        "omschrijving": str(row.get("omschrijving", "") or ""),
        "hoeveelheid": hoeveelheid,
        "prijs_per_stuk": prijs_per_stuk,
        "totale_kosten": totale_kosten,
    }


def normalize_basisproduct_record(record: dict[str, Any]) -> dict[str, Any]:
    onderdelen = [
        _normalize_basisproduct_onderdeel_row(row)
        for row in record.get("onderdelen", [])
        if isinstance(row, dict)
    ]
    jaar = int(record.get("jaar", 0) or 0) or _fallback_producten_year()
    return {
        "id": str(record.get("id", "") or uuid4()),
        "jaar": jaar,
        "omschrijving": str(record.get("omschrijving", "") or ""),
        "inhoud_per_eenheid_liter": float(record.get("inhoud_per_eenheid_liter", 0.0) or 0.0),
        "onderdelen": onderdelen,
        "totale_verpakkingskosten": bereken_basisproduct_totaal(onderdelen),
    }


def load_basisproducten(year: int | str | None = None) -> list[dict[str, Any]]:
    """Laadt alle basisproducten veilig in.

    Phase G: Basisproducten zijn nu een projectie van `articles(kind=format)` + `bom-lines`.
    We tonen hier alleen leaf-formats (formats die geen andere formats bevatten).
    """
    postgres_storage = _get_postgres_storage_module()
    if postgres_storage is None or not postgres_storage.uses_postgres():
        raise RuntimeError("PostgreSQL is verplicht voor runtime opslag (JSON fallback is verwijderd).")

    try:
        year_value = int(year) if year is not None else _fallback_producten_year()
    except (TypeError, ValueError):
        year_value = _fallback_producten_year()

    articles = postgres_storage.load_dataset("articles", [])
    bom_lines = postgres_storage.load_dataset("bom-lines", [])
    if not isinstance(articles, list) or not isinstance(bom_lines, list):
        return []

    by_id = {str(a.get("id", "") or ""): a for a in articles if isinstance(a, dict) and str(a.get("id", "") or "")}
    format_ids = {
        aid
        for aid, a in by_id.items()
        if str(a.get("kind", "") or "").strip().lower() == "format"
    }
    packaging_ids = {
        aid
        for aid, a in by_id.items()
        if str(a.get("kind", "") or "").strip().lower() == "packaging_component"
    }

    # Group BOM lines by parent format.
    lines_by_parent: dict[str, list[dict[str, Any]]] = {}
    for line in bom_lines:
        if not isinstance(line, dict):
            continue
        parent_id = str(line.get("parent_article_id", "") or "").strip()
        if not parent_id or parent_id not in format_ids:
            continue
        lines_by_parent.setdefault(parent_id, []).append(line)

    # Leaf formats: no component formats.
    leaf_format_ids: list[str] = []
    for fmt_id in sorted(format_ids):
        lines = lines_by_parent.get(fmt_id, [])
        has_format_component = any(
            str(l.get("component_article_id", "") or "").strip() in format_ids
            for l in lines
        )
        if not has_format_component:
            leaf_format_ids.append(fmt_id)

    price_by_component: dict[str, float] = {}
    try:
        for row in load_packaging_component_prices():
            if not isinstance(row, dict):
                continue
            if int(row.get("jaar", 0) or 0) != int(year_value):
                continue
            cid = str(row.get("verpakkingsonderdeel_id", "") or "").strip()
            if not cid:
                continue
            price_by_component[cid] = float(row.get("prijs_per_stuk", 0.0) or 0.0)
    except Exception:
        price_by_component = {}

    out: list[dict[str, Any]] = []
    for fmt_id in leaf_format_ids:
        fmt = by_id.get(fmt_id, {}) if isinstance(by_id.get(fmt_id, {}), dict) else {}
        fmt_name = str(fmt.get("name", fmt.get("naam", fmt_id)) or fmt_id)
        try:
            content_liter = float(fmt.get("content_liter", 0.0) or 0.0)
        except (TypeError, ValueError):
            content_liter = 0.0

        onderdelen: list[dict[str, Any]] = []
        totale = 0.0
        for line in lines_by_parent.get(fmt_id, []):
            comp_id = str(line.get("component_article_id", "") or "").strip()
            if not comp_id or comp_id not in packaging_ids:
                continue
            try:
                qty = float(line.get("quantity", 0.0) or 0.0)
            except (TypeError, ValueError):
                qty = 0.0
            comp = by_id.get(comp_id, {}) if isinstance(by_id.get(comp_id, {}), dict) else {}
            comp_name = str(comp.get("name", comp.get("naam", comp_id)) or comp_id)
            prijs = float(price_by_component.get(comp_id, 0.0) or 0.0)
            totale_kosten = bereken_basisproduct_regel_kosten(qty, prijs)
            totale += totale_kosten
            onderdelen.append(
                {
                    "verpakkingsonderdeel_id": comp_id,
                    "omschrijving": comp_name,
                    "hoeveelheid": qty,
                    "prijs_per_stuk": prijs,
                    "totale_kosten": totale_kosten,
                }
            )

        out.append(
            normalize_basisproduct_record(
                {
                    "id": fmt_id,
                    "jaar": int(year_value),
                    "omschrijving": fmt_name,
                    "inhoud_per_eenheid_liter": content_liter,
                    "onderdelen": onderdelen,
                    "totale_verpakkingskosten": totale,
                }
            )
        )

    return out


def save_basisproducten(data: list[dict[str, Any]]) -> bool:
    """Slaat alle basisproducten veilig op.

    Phase G: schrijft naar `articles(kind=format)` + `bom-lines` i.p.v. legacy base-product-masters.
    """
    postgres_storage = _get_postgres_storage_module()
    if postgres_storage is None or not postgres_storage.uses_postgres():
        raise RuntimeError("PostgreSQL is verplicht voor runtime opslag (JSON fallback is verwijderd).")

    current_articles = postgres_storage.load_dataset("articles", [])
    current_bom = postgres_storage.load_dataset("bom-lines", [])
    if not isinstance(current_articles, list):
        current_articles = []
    if not isinstance(current_bom, list):
        current_bom = []

    valid_component_ids = {
        str(record.get("id", "") or "")
        for record in load_packaging_component_masters()
        if isinstance(record, dict) and str(record.get("id", "") or "")
    }

    normalized: list[dict[str, Any]] = []
    format_ids: set[str] = set()
    next_format_articles: list[dict[str, Any]] = []
    next_bom_lines: list[dict[str, Any]] = []
    for record in data:
        if not isinstance(record, dict):
            continue
        cleaned = normalize_basisproduct_record(record)
        format_id = str(cleaned.get("id", "") or "").strip()
        if not format_id:
            continue
        format_ids.add(format_id)

        fmt_name = str(cleaned.get("omschrijving", "") or "").strip() or format_id
        try:
            content_liter = float(cleaned.get("inhoud_per_eenheid_liter", 0.0) or 0.0)
        except (TypeError, ValueError):
            content_liter = 0.0

        # Persist as format article.
        next_format_articles.append(
            {
                "id": format_id,
                "code": str(cleaned.get("code", "") or "").strip(),
                "name": fmt_name,
                "kind": "format",
                "uom": str(cleaned.get("uom", "stuk") or "stuk").strip().lower() or "stuk",
                "content_liter": content_liter,
                "active": True,
            }
        )

        onderdelen = [
            row
            for row in cleaned.get("onderdelen", [])
            if isinstance(row, dict)
            and str(row.get("verpakkingsonderdeel_id", "") or "") in valid_component_ids
        ]
        for onderdeel in onderdelen:
            comp_id = str(onderdeel.get("verpakkingsonderdeel_id", "") or "").strip()
            try:
                qty = float(onderdeel.get("hoeveelheid", 0.0) or 0.0)
            except (TypeError, ValueError):
                qty = 0.0
            if not comp_id or qty <= 0:
                continue
            next_bom_lines.append(
                {
                    "id": str(uuid4()),
                    "parent_article_id": format_id,
                    "component_article_id": comp_id,
                    "component_sku_id": "",
                    "quantity": qty,
                    "uom": "stuk",
                    "scrap_pct": 0,
                    "line_kind": "packaging_component",
                    "packaging_component_id": comp_id,
                }
            )

        cleaned["onderdelen"] = onderdelen
        cleaned["totale_verpakkingskosten"] = bereken_basisproduct_totaal(onderdelen)
        normalized.append(cleaned)

    # Merge into existing datasets (replace by id / parent).
    kept_articles = [
        row
        for row in current_articles
        if not (isinstance(row, dict) and str(row.get("id", "") or "").strip() in format_ids and str(row.get("kind", "") or "").strip().lower() == "format")
    ]
    kept_bom = [
        row
        for row in current_bom
        if not (isinstance(row, dict) and str(row.get("parent_article_id", "") or "").strip() in format_ids)
    ]

    return bool(
        postgres_storage.save_dataset("articles", [*kept_articles, *next_format_articles], overwrite=True)
        and postgres_storage.save_dataset("bom-lines", [*kept_bom, *next_bom_lines], overwrite=True)
    )


def bereken_basisproduct_totaal(onderdelen: list[dict[str, Any]]) -> float:
    """Berekent het totaal van alle gekoppelde verpakkingsonderdelen."""
    totaal = 0.0

    for onderdeel in onderdelen:
        try:
            totaal += float(onderdeel.get("totale_kosten", 0.0) or 0.0)
        except (TypeError, ValueError):
            continue

    return totaal


def bereken_basisproduct_regel_kosten(
    hoeveelheid: float | int | None,
    prijs_per_stuk: float | int | None,
) -> float:
    """Berekent de totale kosten van een gekoppelde onderdeelregel."""
    try:
        hoeveelheid_value = float(hoeveelheid or 0.0)
        prijs_value = float(prijs_per_stuk or 0.0)
    except (TypeError, ValueError):
        return 0.0

    if hoeveelheid_value <= 0 or prijs_value < 0:
        return 0.0

    return hoeveelheid_value * prijs_value


def get_basisproduct_by_id(
    basisproduct_id: str,
    year: int | str | None = None,
) -> dict[str, Any] | None:
    """Haalt een basisproduct op op basis van id, optioneel herleid naar jaar."""
    for basisproduct in load_basisproducten(year):
        if str(basisproduct.get("id")) == basisproduct_id:
            return basisproduct
    # Fallback: masters are year-independent; year-filtered view can be empty for new years.
    if year is not None:
        for basisproduct in load_basisproducten(None):
            if str(basisproduct.get("id")) == basisproduct_id:
                return basisproduct

    return None


def get_beschikbare_basisproducten(
    geselecteerde_basisproduct_ids: set[str] | list[str] | tuple[str, ...],
    current_basisproduct_id: str = "",
    year: int | str | None = None,
) -> list[dict[str, Any]]:
    """Geeft basisproducten terug exclusief al gekozen items, behalve de huidige regel."""
    uitgesloten_ids = {str(basisproduct_id) for basisproduct_id in geselecteerde_basisproduct_ids}
    beschikbare_basisproducten: list[dict[str, Any]] = []

    for basisproduct in load_basisproducten(year):
        basisproduct_id = str(basisproduct.get("id", ""))
        if basisproduct_id == current_basisproduct_id or basisproduct_id not in uitgesloten_ids:
            beschikbare_basisproducten.append(basisproduct)

    return beschikbare_basisproducten


def add_basisproduct(
    omschrijving: str,
    inhoud_per_eenheid_liter: float,
    onderdelen: list[dict[str, Any]],
    *,
    year: int | str | None = None,
) -> dict[str, Any] | None:
    """Voegt een nieuw basisproduct toe."""
    basisproducten = load_basisproducten()
    target_year = int(year) if year is not None else _fallback_producten_year()
    basisproduct = normalize_basisproduct_record(
        {
            "id": str(uuid4()),
            "jaar": target_year,
            "omschrijving": omschrijving,
            "inhoud_per_eenheid_liter": float(inhoud_per_eenheid_liter),
            "onderdelen": onderdelen,
        }
    )
    basisproducten.append(basisproduct)

    if save_basisproducten(basisproducten):
        return basisproduct

    return None


def update_basisproduct(
    basisproduct_id: str,
    omschrijving: str,
    inhoud_per_eenheid_liter: float,
    onderdelen: list[dict[str, Any]],
    *,
    year: int | str | None = None,
) -> bool:
    """Werkt een bestaand basisproduct bij."""
    basisproducten = load_basisproducten()
    year_value = int(year) if year is not None else None

    for index, basisproduct in enumerate(basisproducten):
        if str(basisproduct.get("id")) != basisproduct_id:
            continue
        if year_value is not None and int(basisproduct.get("jaar", 0) or 0) != year_value:
            continue

        basisproducten[index] = normalize_basisproduct_record(
            {
                "id": basisproduct_id,
                "jaar": int(basisproduct.get("jaar", 0) or 0) or year_value or _fallback_producten_year(),
                "omschrijving": omschrijving,
                "inhoud_per_eenheid_liter": float(inhoud_per_eenheid_liter),
                "onderdelen": onderdelen,
            }
        )
        return save_basisproducten(basisproducten)

    return False


def delete_basisproduct(basisproduct_id: str, *, year: int | str | None = None) -> bool:
    """Verwijdert een basisproduct op basis van id."""
    basisproducten = load_basisproducten()
    year_value = int(year) if year is not None else None
    filtered = [
        basisproduct
        for basisproduct in basisproducten
        if not (
            str(basisproduct.get("id")) == basisproduct_id
            and (year_value is None or int(basisproduct.get("jaar", 0) or 0) == year_value)
        )
    ]

    if len(filtered) == len(basisproducten):
        return False

    return save_basisproducten(filtered)


def init_samengestelde_producten_file() -> Path:
    """Maakt het JSON-bestand voor samengestelde producten aan."""
    return _ensure_json_file(SAMENGESTELDE_PRODUCTEN_FILE, "[]")


def _normalize_samengesteld_basisproduct_row(row: dict[str, Any]) -> dict[str, Any]:
    basisproduct_id = str(row.get("basisproduct_id", "") or "")
    aantal = float(row.get("aantal", 0.0) or 0.0)
    return {
        "basisproduct_id": basisproduct_id,
        "omschrijving": str(row.get("omschrijving", "") or ""),
        "aantal": aantal,
        "inhoud_per_eenheid_liter": float(row.get("inhoud_per_eenheid_liter", 0.0) or 0.0),
        "totale_inhoud_liter": float(row.get("totale_inhoud_liter", 0.0) or 0.0),
        "verpakkingskosten_per_eenheid": float(
            row.get("verpakkingskosten_per_eenheid", 0.0) or 0.0
        ),
        "totale_verpakkingskosten": float(
            row.get("totale_verpakkingskosten", 0.0) or 0.0
        ),
}


def _is_samengesteld_verpakkingsonderdeel_ref(item_id: str) -> bool:
    return str(item_id or "").startswith(SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX)


def _resolve_samengesteld_bouwblok_for_year(
    item_id: str,
    year: int | str,
    *,
    basisproducten_lookup: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    item_id = str(item_id or "")
    if _is_samengesteld_verpakkingsonderdeel_ref(item_id):
        onderdeel_id = item_id.removeprefix(SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX)
        onderdeel = get_verpakkingsonderdeel_by_id(onderdeel_id, year)
        if not onderdeel:
            return None
        hoeveelheid = float(onderdeel.get("hoeveelheid", 0.0) or 0.0)
        prijs_per_stuk = float(onderdeel.get("prijs_per_stuk", 0.0) or 0.0)
        return {
            "id": item_id,
            "omschrijving": str(onderdeel.get("omschrijving", "") or ""),
            "inhoud_per_eenheid_liter": 0.0,
            "totale_verpakkingskosten": bereken_basisproduct_regel_kosten(
                hoeveelheid,
                prijs_per_stuk,
            ),
        }

    if basisproducten_lookup is not None and item_id in basisproducten_lookup:
        return basisproducten_lookup[item_id]
    base = get_basisproduct_by_id(item_id, year)
    return resolve_basisproduct_for_year(base, year) if base else None


def normalize_samengesteld_product_record(record: dict[str, Any]) -> dict[str, Any]:
    basisproducten = [
        _normalize_samengesteld_basisproduct_row(row)
        for row in record.get("basisproducten", [])
        if isinstance(row, dict)
    ]
    jaar = int(record.get("jaar", 0) or 0) or _fallback_producten_year()
    return {
        "id": str(record.get("id", "") or uuid4()),
        "jaar": jaar,
        "omschrijving": str(record.get("omschrijving", "") or ""),
        "basisproducten": basisproducten,
        "totale_inhoud_liter": bereken_samengesteld_product_totaal_inhoud(basisproducten),
        "totale_verpakkingskosten": bereken_samengesteld_product_totaal_verpakkingskosten(
            basisproducten
        ),
    }


def load_samengestelde_producten(year: int | str | None = None) -> list[dict[str, Any]]:
    """Laadt alle samengestelde producten veilig in.

    Phase G: Samengestelde producten zijn nu een projectie van `articles(kind=format)` + `bom-lines`.
    We tonen hier formats die minstens één format-component bevatten.
    """
    postgres_storage = _get_postgres_storage_module()
    if postgres_storage is None or not postgres_storage.uses_postgres():
        raise RuntimeError("PostgreSQL is verplicht voor runtime opslag (JSON fallback is verwijderd).")

    try:
        year_value = int(year) if year is not None else _fallback_producten_year()
    except (TypeError, ValueError):
        year_value = _fallback_producten_year()

    articles = postgres_storage.load_dataset("articles", [])
    bom_lines = postgres_storage.load_dataset("bom-lines", [])
    if not isinstance(articles, list) or not isinstance(bom_lines, list):
        return []

    by_id = {str(a.get("id", "") or ""): a for a in articles if isinstance(a, dict) and str(a.get("id", "") or "")}
    format_ids = {
        aid
        for aid, a in by_id.items()
        if str(a.get("kind", "") or "").strip().lower() == "format"
    }
    packaging_ids = {
        aid
        for aid, a in by_id.items()
        if str(a.get("kind", "") or "").strip().lower() == "packaging_component"
    }

    lines_by_parent: dict[str, list[dict[str, Any]]] = {}
    for line in bom_lines:
        if not isinstance(line, dict):
            continue
        parent_id = str(line.get("parent_article_id", "") or "").strip()
        if not parent_id or parent_id not in format_ids:
            continue
        lines_by_parent.setdefault(parent_id, []).append(line)

    composite_format_ids: list[str] = []
    for fmt_id in sorted(format_ids):
        lines = lines_by_parent.get(fmt_id, [])
        has_format_component = any(
            str(l.get("component_article_id", "") or "").strip() in format_ids
            for l in lines
        )
        if has_format_component:
            composite_format_ids.append(fmt_id)

    out: list[dict[str, Any]] = []
    for fmt_id in composite_format_ids:
        fmt = by_id.get(fmt_id, {}) if isinstance(by_id.get(fmt_id, {}), dict) else {}
        fmt_name = str(fmt.get("name", fmt.get("naam", fmt_id)) or fmt_id)
        basis_rows: list[dict[str, Any]] = []
        for line in lines_by_parent.get(fmt_id, []):
            comp_id = str(line.get("component_article_id", "") or "").strip()
            if not comp_id:
                continue
            try:
                qty = float(line.get("quantity", 0.0) or 0.0)
            except (TypeError, ValueError):
                qty = 0.0
            if qty <= 0:
                continue
            if comp_id in format_ids:
                comp = by_id.get(comp_id, {}) if isinstance(by_id.get(comp_id, {}), dict) else {}
                comp_name = str(comp.get("name", comp.get("naam", comp_id)) or comp_id)
                try:
                    comp_liter = float(comp.get("content_liter", 0.0) or 0.0)
                except (TypeError, ValueError):
                    comp_liter = 0.0
                basis_rows.append(
                    {
                        "basisproduct_id": comp_id,
                        "omschrijving": comp_name,
                        "aantal": qty,
                        "inhoud_per_eenheid_liter": comp_liter,
                        "totale_inhoud_liter": qty * comp_liter,
                    }
                )
            elif comp_id in packaging_ids:
                # Legacy composite editor expects packaging refs as "verpakkingsonderdeel:<id>"
                comp = by_id.get(comp_id, {}) if isinstance(by_id.get(comp_id, {}), dict) else {}
                comp_name = str(comp.get("name", comp.get("naam", comp_id)) or comp_id)
                basis_rows.append(
                    {
                        "basisproduct_id": f"{SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX}{comp_id}",
                        "omschrijving": comp_name,
                        "aantal": qty,
                        "inhoud_per_eenheid_liter": 0.0,
                        "totale_inhoud_liter": 0.0,
                    }
                )

        out.append(
            normalize_samengesteld_product_record(
                {
                    "id": fmt_id,
                    "jaar": int(year_value),
                    "omschrijving": fmt_name,
                    "basisproducten": basis_rows,
                }
            )
        )

    return out


def save_samengestelde_producten(data: list[dict[str, Any]]) -> bool:
    """Slaat alle samengestelde producten veilig op.

    Phase G: schrijft compositie naar `articles(kind=format)` + `bom-lines` (component formats + components).
    """
    postgres_storage = _get_postgres_storage_module()
    if postgres_storage is None or not postgres_storage.uses_postgres():
        raise RuntimeError("PostgreSQL is verplicht voor runtime opslag (JSON fallback is verwijderd).")

    current_articles = postgres_storage.load_dataset("articles", [])
    current_bom = postgres_storage.load_dataset("bom-lines", [])
    if not isinstance(current_articles, list):
        current_articles = []
    if not isinstance(current_bom, list):
        current_bom = []

    normalized: list[dict[str, Any]] = []
    format_ids: set[str] = set()
    next_format_articles: list[dict[str, Any]] = []
    next_bom_lines: list[dict[str, Any]] = []

    for record in data:
        if not isinstance(record, dict):
            continue
        cleaned = normalize_samengesteld_product_record(record)
        format_id = str(cleaned.get("id", "") or "").strip()
        if not format_id:
            continue
        format_ids.add(format_id)
        fmt_name = str(cleaned.get("omschrijving", "") or "").strip() or format_id

        # Derived fields.
        try:
            content_liter = float(cleaned.get("totale_inhoud_liter", 0.0) or 0.0)
        except (TypeError, ValueError):
            content_liter = 0.0

        next_format_articles.append(
            {
                "id": format_id,
                "code": str(cleaned.get("code", "") or "").strip(),
                "name": fmt_name,
                "kind": "format",
                "uom": str(cleaned.get("uom", "stuk") or "stuk").strip().lower() or "stuk",
                "content_liter": content_liter,
                "active": True,
            }
        )

        basis_rows = cleaned.get("basisproducten", [])
        if not isinstance(basis_rows, list):
            basis_rows = []
        for row in basis_rows:
            if not isinstance(row, dict):
                continue
            basis_id = str(row.get("basisproduct_id", "") or "").strip()
            try:
                qty = float(row.get("aantal", 0.0) or 0.0)
            except (TypeError, ValueError):
                qty = 0.0
            if qty <= 0 or not basis_id:
                continue
            comp_article_id = ""
            if basis_id.startswith(SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX):
                comp_article_id = basis_id.removeprefix(SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX)
                line_kind = "packaging_component"
            else:
                comp_article_id = basis_id
                line_kind = "format"

            next_bom_lines.append(
                {
                    "id": str(uuid4()),
                    "parent_article_id": format_id,
                    "component_article_id": comp_article_id,
                    "component_sku_id": "",
                    "quantity": qty,
                    "uom": "stuk",
                    "scrap_pct": 0,
                    "line_kind": line_kind,
                }
            )

        normalized.append(cleaned)

    kept_articles = [
        row
        for row in current_articles
        if not (isinstance(row, dict) and str(row.get("id", "") or "").strip() in format_ids and str(row.get("kind", "") or "").strip().lower() == "format")
    ]
    kept_bom = [
        row
        for row in current_bom
        if not (isinstance(row, dict) and str(row.get("parent_article_id", "") or "").strip() in format_ids)
    ]

    return bool(
        postgres_storage.save_dataset("articles", [*kept_articles, *next_format_articles], overwrite=True)
        and postgres_storage.save_dataset("bom-lines", [*kept_bom, *next_bom_lines], overwrite=True)
    )


def bereken_samengesteld_product_totaal_inhoud(
    basisproducten: list[dict[str, Any]],
) -> float:
    """Berekent de totale inhoud van alle gekoppelde basisproducten."""
    totaal = 0.0

    for basisproduct in basisproducten:
        try:
            totaal += float(basisproduct.get("totale_inhoud_liter", 0.0) or 0.0)
        except (TypeError, ValueError):
            continue

    return totaal


def bereken_samengesteld_product_totaal_verpakkingskosten(
    basisproducten: list[dict[str, Any]],
) -> float:
    """Berekent de totale verpakkingskosten van alle gekoppelde basisproducten."""
    totaal = 0.0

    for basisproduct in basisproducten:
        try:
            totaal += float(
                basisproduct.get("totale_verpakkingskosten", 0.0) or 0.0
            )
        except (TypeError, ValueError):
            continue

    return totaal


def resolve_basisproduct_for_year(
    basisproduct: dict[str, Any],
    year: int | str,
) -> dict[str, Any]:
    """Bouwt een jaarafhankelijke weergave van een basisproduct op."""
    normalized = normalize_basisproduct_record(basisproduct)
    resolved_rows: list[dict[str, Any]] = []

    for row in normalized.get("onderdelen", []):
        component_key = str(
            row.get("verpakkingsonderdeel_key")
            or row.get("component_key")
            or row.get("verpakkingsonderdeel_id")
            or ""
        )
        onderdeel = (
            get_verpakkingsonderdeel_by_component_key(
                component_key,
                year,
                fallback_to_latest=False,
            )
            if component_key
            else None
        )
        if onderdeel is None:
            onderdeel = get_verpakkingsonderdeel_by_id(
                str(row.get("verpakkingsonderdeel_id", "") or ""),
                year,
            )

        hoeveelheid = float(row.get("hoeveelheid", 0.0) or 0.0)
        prijs_per_stuk = float((onderdeel or {}).get("prijs_per_stuk", 0.0) or 0.0)
        resolved_rows.append(
            {
                "verpakkingsonderdeel_id": str((onderdeel or {}).get("id", "") or ""),
                "verpakkingsonderdeel_key": component_key,
                "omschrijving": str(
                    (onderdeel or {}).get("omschrijving", row.get("omschrijving", "")) or ""
                ),
                "jaar": int((onderdeel or {}).get("jaar", 0) or 0),
                "hoeveelheid": hoeveelheid,
                "prijs_per_stuk": prijs_per_stuk,
                "totale_kosten": bereken_basisproduct_regel_kosten(hoeveelheid, prijs_per_stuk),
            }
        )

    resolved = {
        **normalized,
        "jaar": int(year),
        "onderdelen": resolved_rows,
        "totale_verpakkingskosten": bereken_basisproduct_totaal(resolved_rows),
    }
    return resolved


def load_basisproducten_for_year(year: int | str) -> list[dict[str, Any]]:
    """Laadt alle basisproducten met jaarafhankelijke verpakkingskosten."""
    return [
        resolve_basisproduct_for_year(basisproduct, year)
        for basisproduct in load_basisproducten(year)
    ]


def resolve_samengesteld_product_for_year(
    samengesteld_product: dict[str, Any],
    year: int | str,
    *,
    basisproducten_lookup: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Bouwt een jaarafhankelijke weergave van een samengesteld product op."""
    normalized = normalize_samengesteld_product_record(samengesteld_product)
    if basisproducten_lookup is None:
        basisproducten_lookup = {
            str(item.get("id", "") or ""): item
            for item in load_basisproducten_for_year(year)
        }

    resolved_rows: list[dict[str, Any]] = []
    for row in normalized.get("basisproducten", []):
        basisproduct_id = str(row.get("basisproduct_id", "") or "")
        basisproduct = _resolve_samengesteld_bouwblok_for_year(
            basisproduct_id,
            year,
            basisproducten_lookup=basisproducten_lookup,
        )

        aantal = float(row.get("aantal", 0.0) or 0.0)
        inhoud_per_eenheid = float(
            (basisproduct or {}).get("inhoud_per_eenheid_liter", 0.0) or 0.0
        )
        verpakkingskosten_per_eenheid = float(
            (basisproduct or {}).get("totale_verpakkingskosten", 0.0) or 0.0
        )
        resolved_rows.append(
            {
                "basisproduct_id": basisproduct_id,
                "omschrijving": str(
                    (basisproduct or {}).get("omschrijving", row.get("omschrijving", "")) or ""
                ),
                "aantal": aantal,
                "inhoud_per_eenheid_liter": inhoud_per_eenheid,
                "totale_inhoud_liter": aantal * inhoud_per_eenheid,
                "verpakkingskosten_per_eenheid": verpakkingskosten_per_eenheid,
                "totale_verpakkingskosten": bereken_basisproduct_regel_kosten(
                    aantal,
                    verpakkingskosten_per_eenheid,
                ),
            }
        )

    return {
        **normalized,
        "jaar": int(year),
        "basisproducten": resolved_rows,
        "totale_inhoud_liter": bereken_samengesteld_product_totaal_inhoud(resolved_rows),
        "totale_verpakkingskosten": bereken_samengesteld_product_totaal_verpakkingskosten(
            resolved_rows
        ),
    }


def load_samengestelde_producten_for_year(year: int | str) -> list[dict[str, Any]]:
    """Laadt alle samengestelde producten met jaarafhankelijke verpakkingskosten."""
    basisproducten_lookup = {
        str(item.get("id", "") or ""): item
        for item in load_basisproducten_for_year(year)
    }
    return [
        resolve_samengesteld_product_for_year(
            samengesteld_product,
            year,
            basisproducten_lookup=basisproducten_lookup,
        )
        for samengesteld_product in load_samengestelde_producten(year)
    ]


def bereken_basisproduct_kostprijs(
    basisproduct: dict[str, Any],
    variabele_kosten_per_liter: float | int | None,
    year: int | str | None = None,
) -> dict[str, float]:
    """Berekent kostprijsregels voor een basisproduct."""
    source_product = (
        resolve_basisproduct_for_year(basisproduct, year)
        if year is not None
        else normalize_basisproduct_record(basisproduct)
    )
    inhoud_liter = max(
        float(source_product.get("inhoud_per_eenheid_liter", 0.0) or 0.0),
        0.0,
    )
    verpakkingskosten = max(
        float(source_product.get("totale_verpakkingskosten", 0.0) or 0.0),
        0.0,
    )
    variabele_kosten = max(float(variabele_kosten_per_liter or 0.0), 0.0)
    vloeistofkosten = variabele_kosten * inhoud_liter

    return {
        "inhoud_liter": inhoud_liter,
        "variabele_kosten_vloeistof": vloeistofkosten,
        "verpakkingskosten": verpakkingskosten,
        "totale_kostprijs": vloeistofkosten + verpakkingskosten,
    }


def bereken_samengesteld_product_kostprijs(
    samengesteld_product: dict[str, Any],
    variabele_kosten_per_liter: float | int | None,
    year: int | str | None = None,
) -> dict[str, float]:
    """Berekent kostprijsregels voor een samengesteld product."""
    source_product = (
        resolve_samengesteld_product_for_year(samengesteld_product, year)
        if year is not None
        else normalize_samengesteld_product_record(samengesteld_product)
    )
    inhoud_liter = max(
        float(source_product.get("totale_inhoud_liter", 0.0) or 0.0),
        0.0,
    )
    verpakkingskosten = max(
        float(source_product.get("totale_verpakkingskosten", 0.0) or 0.0),
        0.0,
    )
    variabele_kosten = max(float(variabele_kosten_per_liter or 0.0), 0.0)
    vloeistofkosten = variabele_kosten * inhoud_liter

    return {
        "inhoud_liter": inhoud_liter,
        "variabele_kosten_vloeistof": vloeistofkosten,
        "verpakkingskosten": verpakkingskosten,
        "totale_kostprijs": vloeistofkosten + verpakkingskosten,
    }


def get_samengesteld_product_by_id(
    samengesteld_product_id: str,
    year: int | str | None = None,
) -> dict[str, Any] | None:
    """Haalt een samengesteld product op op basis van id."""
    for samengesteld_product in load_samengestelde_producten(year):
        if str(samengesteld_product.get("id")) == samengesteld_product_id:
            return samengesteld_product
    if year is not None:
        for samengesteld_product in load_samengestelde_producten(None):
            if str(samengesteld_product.get("id")) == samengesteld_product_id:
                return samengesteld_product

    return None


def add_samengesteld_product(
    omschrijving: str,
    basisproducten: list[dict[str, Any]],
    *,
    year: int | str | None = None,
) -> dict[str, Any] | None:
    """Voegt een nieuw samengesteld product toe."""
    samengestelde_producten = load_samengestelde_producten()
    target_year = int(year) if year is not None else _fallback_producten_year()
    samengesteld_product = normalize_samengesteld_product_record(
        {
            "id": str(uuid4()),
            "jaar": target_year,
            "omschrijving": omschrijving,
            "basisproducten": basisproducten,
        }
    )
    samengestelde_producten.append(samengesteld_product)

    if save_samengestelde_producten(samengestelde_producten):
        return samengesteld_product

    return None


def update_samengesteld_product(
    samengesteld_product_id: str,
    omschrijving: str,
    basisproducten: list[dict[str, Any]],
    *,
    year: int | str | None = None,
) -> bool:
    """Werkt een bestaand samengesteld product bij."""
    samengestelde_producten = load_samengestelde_producten()
    year_value = int(year) if year is not None else None

    for index, samengesteld_product in enumerate(samengestelde_producten):
        if str(samengesteld_product.get("id")) != samengesteld_product_id:
            continue
        if year_value is not None and int(samengesteld_product.get("jaar", 0) or 0) != year_value:
            continue

        samengestelde_producten[index] = normalize_samengesteld_product_record(
            {
                "id": samengesteld_product_id,
                "jaar": int(samengesteld_product.get("jaar", 0) or 0) or year_value or _fallback_producten_year(),
                "omschrijving": omschrijving,
                "basisproducten": basisproducten,
            }
        )
        return save_samengestelde_producten(samengestelde_producten)

    return False


def delete_samengesteld_product(
    samengesteld_product_id: str,
    *,
    year: int | str | None = None,
) -> bool:
    """Verwijdert een samengesteld product op basis van id."""
    samengestelde_producten = load_samengestelde_producten()
    year_value = int(year) if year is not None else None
    filtered = [
        samengesteld_product
        for samengesteld_product in samengestelde_producten
        if not (
            str(samengesteld_product.get("id")) == samengesteld_product_id
            and (
                year_value is None
                or int(samengesteld_product.get("jaar", 0) or 0) == year_value
            )
        )
    ]

    if len(filtered) == len(samengestelde_producten):
        return False

    return save_samengestelde_producten(filtered)


def _normalize_packaging_component_master_record(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(record.get("id", "") or uuid4()),
        "component_key": str(record.get("component_key") or record.get("id") or uuid4()),
        "omschrijving": str(record.get("omschrijving", "") or ""),
        "beschikbaar_voor_samengesteld": bool(
            record.get("beschikbaar_voor_samengesteld", False)
        ),
    }


def _normalize_packaging_component_price_record(record: dict[str, Any]) -> dict[str, Any]:
    try:
        jaar = int(record.get("jaar", 0) or 0)
    except (TypeError, ValueError):
        jaar = 0

    return {
        "id": str(record.get("id", "") or uuid4()),
        "verpakkingsonderdeel_id": str(record.get("verpakkingsonderdeel_id", "") or ""),
        "jaar": jaar,
        "prijs_per_stuk": float(record.get("prijs_per_stuk", 0.0) or 0.0),
    }


def normalize_packaging_component_price_version_record(
    record: dict[str, Any],
) -> dict[str, Any]:
    now_iso = datetime.now(UTC).replace(microsecond=0).isoformat()
    try:
        jaar = int(record.get("jaar", 0) or 0)
    except (TypeError, ValueError):
        jaar = 0
    try:
        versie_nummer = int(record.get("versie_nummer", 0) or 0)
    except (TypeError, ValueError):
        versie_nummer = 0

    created_at = str(record.get("created_at") or record.get("aangemaakt_op") or now_iso)
    updated_at = str(record.get("updated_at") or record.get("aangepast_op") or created_at)
    effectief_vanaf = str(record.get("effectief_vanaf") or record.get("created_at") or created_at)

    return {
        "id": str(record.get("id", "") or uuid4()),
        "verpakkingsonderdeel_id": str(record.get("verpakkingsonderdeel_id", "") or ""),
        "jaar": jaar,
        "prijs_per_stuk": float(record.get("prijs_per_stuk", 0.0) or 0.0),
        "versie_nummer": versie_nummer,
        "effectief_vanaf": effectief_vanaf,
        "is_actief": bool(record.get("is_actief", False)),
        "created_at": created_at,
        "updated_at": updated_at,
    }


def _assign_packaging_component_price_version_numbers(
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for row in rows:
        key = (
            str(row.get("verpakkingsonderdeel_id", "") or ""),
            int(row.get("jaar", 0) or 0),
        )
        grouped.setdefault(key, []).append(dict(row))

    numbered_rows: list[dict[str, Any]] = []
    for grouped_rows in grouped.values():
        grouped_rows.sort(
            key=lambda item: (
                str(item.get("effectief_vanaf", "") or ""),
                str(item.get("created_at", "") or ""),
                str(item.get("updated_at", "") or ""),
                str(item.get("id", "") or ""),
            )
        )
        for index, row in enumerate(grouped_rows, start=1):
            numbered_rows.append({**row, "versie_nummer": index})

    return numbered_rows


def _sync_packaging_component_price_version_state(
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    numbered = _assign_packaging_component_price_version_numbers(rows)
    grouped: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for row in numbered:
        key = (
            str(row.get("verpakkingsonderdeel_id", "") or ""),
            int(row.get("jaar", 0) or 0),
        )
        grouped.setdefault(key, []).append(dict(row))

    normalized_rows: list[dict[str, Any]] = []
    for grouped_rows in grouped.values():
        grouped_rows.sort(
            key=lambda item: (
                int(item.get("versie_nummer", 0) or 0),
                str(item.get("effectief_vanaf", "") or ""),
                str(item.get("updated_at", "") or ""),
            )
        )
        active_indices = [index for index, row in enumerate(grouped_rows) if bool(row.get("is_actief"))]
        active_index = active_indices[-1] if active_indices else (len(grouped_rows) - 1 if grouped_rows else -1)
        for index, row in enumerate(grouped_rows):
            normalized_rows.append({**row, "is_actief": index == active_index})

    return normalized_rows


def _build_active_packaging_component_price_projection(
    versions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    projection = [
        _normalize_packaging_component_price_record(version)
        for version in versions
        if bool(version.get("is_actief"))
    ]
    return sorted(
        projection,
        key=lambda item: (
            int(item.get("jaar", 0) or 0),
            str(item.get("verpakkingsonderdeel_id", "") or ""),
        ),
    )


def load_packaging_component_masters() -> list[dict[str, Any]]:
    data = _load_postgres_first_list("packaging-components", VERPAKKINGSONDERDELEN_FILE)
    normalized = [
        _normalize_packaging_component_master_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    return sorted(
        normalized,
        key=lambda item: (
            str(item.get("omschrijving", "") or "").lower(),
            str(item.get("component_key", "") or ""),
        ),
    )


def save_packaging_component_masters(data: list[dict[str, Any]]) -> bool:
    normalized = [
        _normalize_packaging_component_master_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    return _save_postgres_dataset("packaging-components", normalized)


def load_packaging_component_price_versions() -> list[dict[str, Any]]:
    postgres_payload = _load_postgres_dataset("packaging-component-price-versions")
    data = postgres_payload if isinstance(postgres_payload, list) else []

    normalized = _sync_packaging_component_price_version_state(
        [
            normalize_packaging_component_price_version_record(record)
            for record in data
            if isinstance(record, dict)
        ]
    )
    return sorted(
        normalized,
        key=lambda item: (
            int(item.get("jaar", 0) or 0),
            str(item.get("verpakkingsonderdeel_id", "") or ""),
            int(item.get("versie_nummer", 0) or 0),
        ),
    )


def save_packaging_component_price_versions(data: list[dict[str, Any]]) -> bool:
    valid_component_ids = {
        str(record.get("id", "") or "")
        for record in load_packaging_component_masters()
        if isinstance(record, dict) and str(record.get("id", "") or "")
    }
    normalized = _sync_packaging_component_price_version_state(
        [
            normalize_packaging_component_price_version_record(record)
            for record in data
            if isinstance(record, dict)
            and str(record.get("verpakkingsonderdeel_id", "") or "") in valid_component_ids
        ]
    )
    projection = _build_active_packaging_component_price_projection(normalized)
    saved_versions = _save_postgres_dataset("packaging-component-price-versions", normalized)
    saved_projection = _save_postgres_dataset("packaging-component-prices", projection)
    return saved_versions and saved_projection


def load_packaging_component_prices() -> list[dict[str, Any]]:
    versions = load_packaging_component_price_versions()
    return _build_active_packaging_component_price_projection(versions)


def save_packaging_component_prices(data: list[dict[str, Any]]) -> bool:
    now_iso = datetime.now(UTC).replace(microsecond=0).isoformat()
    current_versions = load_packaging_component_price_versions()
    target_rows = [
        _normalize_packaging_component_price_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    target_keys = {
        (
            str(row.get("verpakkingsonderdeel_id", "") or ""),
            int(row.get("jaar", 0) or 0),
        )
        for row in target_rows
    }
    retained_versions = [
        dict(version)
        for version in current_versions
        if (
            str(version.get("verpakkingsonderdeel_id", "") or ""),
            int(version.get("jaar", 0) or 0),
        )
        in target_keys
    ]

    for row in target_rows:
        key = (
            str(row.get("verpakkingsonderdeel_id", "") or ""),
            int(row.get("jaar", 0) or 0),
        )
        versions_for_key = [
            version
            for version in retained_versions
            if (
                str(version.get("verpakkingsonderdeel_id", "") or ""),
                int(version.get("jaar", 0) or 0),
            )
            == key
        ]
        active_version = next(
            (version for version in reversed(versions_for_key) if bool(version.get("is_actief"))),
            None,
        )
        active_price = float((active_version or {}).get("prijs_per_stuk", 0.0) or 0.0)
        next_price = float(row.get("prijs_per_stuk", 0.0) or 0.0)
        if active_version is not None and active_price == next_price:
            continue

        retained_versions.append(
            normalize_packaging_component_price_version_record(
                {
                    "verpakkingsonderdeel_id": key[0],
                    "jaar": key[1],
                    "prijs_per_stuk": next_price,
                    "effectief_vanaf": now_iso,
                    "created_at": now_iso,
                    "updated_at": now_iso,
                    "is_actief": True,
                }
            )
        )

    return save_packaging_component_price_versions(retained_versions)


def _get_master_product_years() -> list[int]:
    years = {
        int(item.get("jaar", 0) or 0)
        for item in load_packaging_component_prices()
        if int(item.get("jaar", 0) or 0) > 0
    }
    years.update(get_productie_years())
    return sorted(year for year in years if year > 0)


def _latest_packaging_price_by_component_id() -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for row in load_packaging_component_prices():
        component_id = str(row.get("verpakkingsonderdeel_id", "") or "")
        if not component_id:
            continue
        current = latest.get(component_id)
        current_year = int(current.get("jaar", 0) or 0) if current else -1
        row_year = int(row.get("jaar", 0) or 0)
        if row_year >= current_year:
            latest[component_id] = row
    return latest


def _packaging_price_lookup_for_year(year: int | str) -> dict[str, dict[str, Any]]:
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        year_value = 0

    return {
        str(row.get("verpakkingsonderdeel_id", "") or ""): row
        for row in load_packaging_component_prices()
        if int(row.get("jaar", 0) or 0) == year_value
    }


def load_verpakkingsonderdelen(year: int | str | None = None) -> list[dict[str, Any]]:
    masters = load_packaging_component_masters()
    if year is None:
        latest_prices = _latest_packaging_price_by_component_id()
        return [
            {
                **row,
                "prijs_per_stuk": float(
                    (latest_prices.get(str(row.get("id", "") or ""), {}) or {}).get("prijs_per_stuk", 0.0) or 0.0
                ),
            }
            for row in masters
        ]

    try:
        year_value = int(year)
    except (TypeError, ValueError):
        year_value = 0
    price_lookup = _packaging_price_lookup_for_year(year_value)

    return [
        {
            **row,
            "jaar": year_value,
            "prijs_per_stuk": float(
                (price_lookup.get(str(row.get("id", "") or ""), {}) or {}).get("prijs_per_stuk", 0.0) or 0.0
            ),
        }
        for row in masters
    ]


def save_verpakkingsonderdelen(data: list[dict[str, Any]]) -> bool:
    masters: list[dict[str, Any]] = []
    prijs_rows = load_packaging_component_prices()
    prijs_index = {
        (
            str(row.get("verpakkingsonderdeel_id", "") or ""),
            int(row.get("jaar", 0) or 0),
        ): index
        for index, row in enumerate(prijs_rows)
    }

    for record in data:
        if not isinstance(record, dict):
            continue
        normalized = _normalize_packaging_component_master_record(record)
        masters.append(normalized)
        try:
            jaar = int(record.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            jaar = 0
        if jaar > 0 and "prijs_per_stuk" in record:
            prijs_row = _normalize_packaging_component_price_record(
                {
                    "verpakkingsonderdeel_id": normalized["id"],
                    "jaar": jaar,
                    "prijs_per_stuk": record.get("prijs_per_stuk", 0.0),
                }
            )
            index_key = (str(prijs_row["verpakkingsonderdeel_id"]), int(prijs_row["jaar"]))
            if index_key in prijs_index:
                prijs_rows[prijs_index[index_key]] = {
                    **prijs_rows[prijs_index[index_key]],
                    **prijs_row,
                }
            else:
                prijs_rows.append(prijs_row)
                prijs_index[index_key] = len(prijs_rows) - 1

    return save_packaging_component_masters(masters) and save_packaging_component_prices(prijs_rows)


def load_json_data() -> dict[str, Any]:
    """Legacy name: loads production data from Postgres (JSON disk fallback removed)."""
    payload = _load_postgres_dataset("productie")
    return payload if isinstance(payload, dict) else {}


def save_json_data(data: dict[str, Any]) -> bool:
    """Legacy name: saves production data to Postgres (JSON disk fallback removed)."""
    return _save_postgres_dataset("productie", data if isinstance(data, dict) else {})


def load_productiegegevens() -> dict[str, Any]:
    """Laadt productiegegevens via een expliciete helpernaam."""
    return load_json_data()


def save_productiegegevens(data: dict[str, Any]) -> bool:
    """Slaat productiegegevens op via een expliciete helpernaam."""
    return save_json_data(data)


def get_productie_record(year: int | str) -> dict[str, Any] | None:
    """Haalt het productie-record voor een specifiek jaar op."""
    data = load_json_data()
    record = data.get(str(year))
    return record if isinstance(record, dict) else None


def get_productiegegeven_by_year(year: int | str) -> dict[str, Any] | None:
    """Haalt productiegegevens op voor een specifiek jaar."""
    return get_productie_record(year)


def upsert_productie_record(year: int | str, record: dict[str, Any]) -> bool:
    """Voegt een productie-record toe of werkt het bij."""
    data = load_json_data()
    data[str(year)] = record
    return save_json_data(data)


def upsert_productiegegeven(year: int | str, record: dict[str, Any]) -> bool:
    """Voegt productiegegevens toe of werkt ze bij voor een jaar."""
    return upsert_productie_record(year, record)


def delete_productie_record(year: int | str) -> bool:
    """Verwijdert het productie-record van een specifiek jaar."""
    data = load_json_data()
    year_key = str(year)

    if year_key not in data:
        return False

    del data[year_key]
    return save_json_data(data)


def delete_productiegegeven(year: int | str) -> bool:
    """Verwijdert productiegegevens voor een specifiek jaar."""
    return delete_productie_record(year)


def get_productie_years() -> list[int]:
    """Geeft alle beschikbare productie-jaren gesorteerd terug."""
    data = load_json_data()
    years: list[int] = []

    for year in data.keys():
        if year.isdigit():
            years.append(int(year))

    return sorted(years)


def duplicate_productie_to_year(
    source_year: int | str,
    target_year: int | str,
    *,
    overwrite: bool = False,
) -> bool:
    """Dupliceert productiegegevens van bronjaar naar doeljaar."""
    source_record = get_productie_record(source_year)
    if not source_record:
        return False
    if get_productie_record(target_year) is not None and not overwrite:
        return False
    return upsert_productie_record(target_year, deepcopy(source_record))


def is_productiejaar_in_gebruik_bij_vaste_kosten(year: int | str) -> bool:
    """Controleert of een productiejaar al voorkomt in de opslag van vaste kosten."""
    return str(year) in load_vaste_kosten_data()


def get_batchgrootte_eigen_productie_l(year: int | str) -> float | None:
    """Haalt de batchgrootte eigen productie voor een jaar op."""
    record = get_productie_record(year) or {}
    value = record.get("batchgrootte_eigen_productie_l")

    try:
        batchgrootte = float(value)
    except (TypeError, ValueError):
        return None

    return batchgrootte if batchgrootte > 0 else None


def load_vaste_kosten_data() -> dict[str, Any]:
    """Laadt alle opgeslagen vaste kosten uit Postgres (JSON disk fallback removed)."""
    payload = _load_postgres_dataset("vaste-kosten")
    return payload if isinstance(payload, dict) else {}


def save_vaste_kosten_data(data: dict[str, Any]) -> bool:
    """Slaat alle vaste kosten op in Postgres (JSON disk fallback removed)."""
    return _save_postgres_dataset("vaste-kosten", data if isinstance(data, dict) else {})


def get_vaste_kosten_record(year: int | str) -> list[dict[str, Any]]:
    """Haalt alle vaste kostenregels voor een specifiek jaar op."""
    data = load_vaste_kosten_data()
    record = data.get(str(year), [])
    return record if isinstance(record, list) else []


def get_vaste_kosten_row_by_id(
    year: int | str,
    row_id: str,
) -> dict[str, Any] | None:
    """Haalt een specifieke vaste-kostenregel op voor een jaar."""
    for record in get_vaste_kosten_record(year):
        if str(record.get("id", "")) == row_id:
            return record

    return None


def upsert_vaste_kosten_record(
    year: int | str,
    records: list[dict[str, Any]],
) -> bool:
    """Vervangt of maakt alle vaste kostenregels voor een jaar aan."""
    data = load_vaste_kosten_data()
    data[str(year)] = records
    return save_vaste_kosten_data(data)


def upsert_vaste_kosten_row(
    year: int | str,
    record: dict[str, Any],
) -> bool:
    """Voegt een vaste-kostenregel toe of werkt deze bij binnen een jaar."""
    records = get_vaste_kosten_record(year)
    row_id = str(record.get("id", ""))
    updated = False

    for index, existing_record in enumerate(records):
        if str(existing_record.get("id", "")) != row_id:
            continue
        records[index] = record
        updated = True
        break

    if not updated:
        records.append(record)

    return upsert_vaste_kosten_record(year, records)


def delete_vaste_kosten_record(year: int | str) -> bool:
    """Verwijdert alle vaste kosten voor een specifiek jaar."""
    data = load_vaste_kosten_data()
    year_key = str(year)

    if year_key not in data:
        return False

    del data[year_key]
    return save_vaste_kosten_data(data)


def delete_vaste_kosten_row(year: int | str, row_id: str) -> bool:
    """Verwijdert een specifieke vaste-kostenregel binnen een jaar."""
    records = get_vaste_kosten_record(year)
    filtered_records = [
        record for record in records if str(record.get("id", "")) != row_id
    ]

    if len(filtered_records) == len(records):
        return False

    return upsert_vaste_kosten_record(year, filtered_records)


def calculate_total_vaste_kosten(records: list[dict[str, Any]]) -> float:
    """Berekent het totaalbedrag van alle vaste kostenregels."""
    return float(
        sum(float(record.get("bedrag_per_jaar", 0.0) or 0.0) for record in records)
    )


def _clamp_pct(value: Any) -> float:
    try:
        parsed = float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0
    return float(min(100.0, max(0.0, parsed)))


def _split_vaste_kosten(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Split vaste kosten regels in directe en indirecte kosten (case-insensitive)."""
    direct_rows: list[dict[str, Any]] = []
    indirect_rows: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        kostensoort = str(record.get("kostensoort", record.get("type_kosten", "")) or "").strip().lower()
        if "indirect" in kostensoort:
            indirect_rows.append(record)
        elif "direct" in kostensoort:
            direct_rows.append(record)
    return direct_rows, indirect_rows


def calculate_herverdeelde_vaste_kosten_totals(records: list[dict[str, Any]]) -> dict[str, float]:
    """Compute direct/indirect totals after applying herverdeel_pct."""
    direct_rows, indirect_rows = _split_vaste_kosten(records)
    direct_base = sum(float(row.get("bedrag_per_jaar", 0.0) or 0.0) for row in direct_rows)
    indirect_base = sum(float(row.get("bedrag_per_jaar", 0.0) or 0.0) for row in indirect_rows)

    direct_out = sum(
        float(row.get("bedrag_per_jaar", 0.0) or 0.0) * _clamp_pct(row.get("herverdeel_pct", 0.0)) / 100.0
        for row in direct_rows
    )
    indirect_out = sum(
        float(row.get("bedrag_per_jaar", 0.0) or 0.0) * _clamp_pct(row.get("herverdeel_pct", 0.0)) / 100.0
        for row in indirect_rows
    )

    direct_after = direct_base - direct_out + indirect_out
    indirect_after = indirect_base - indirect_out + direct_out
    return {
        "direct_base": float(direct_base),
        "indirect_base": float(indirect_base),
        "direct_out": float(direct_out),
        "indirect_out": float(indirect_out),
        "direct_after": float(direct_after),
        "indirect_after": float(indirect_after),
    }


def calculate_vaste_kosten_per_liter(
    totale_vaste_kosten: float,
    productie_liters: float | int | None,
) -> float | None:
    """Berekent vaste kosten per geproduceerde liter."""
    if productie_liters is None or float(productie_liters) <= 0:
        return None

    return float(totale_vaste_kosten) / float(productie_liters)


def calculate_vaste_kosten_per_ingekochte_liter(
    totale_vaste_kosten: float,
    inkoop_liters: float | int | None,
) -> float | None:
    """Berekent vaste kosten per ingekochte liter."""
    if inkoop_liters is None or float(inkoop_liters) <= 0:
        return None

    return float(totale_vaste_kosten) / float(inkoop_liters)


def calculate_vaste_kosten_per_totale_liter(
    totale_vaste_kosten: float,
    productie_liters: float | int | None,
    inkoop_liters: float | int | None,
) -> float | None:
    """Berekent vaste kosten per totale liter."""
    productie_value = float(productie_liters or 0.0)
    inkoop_value = float(inkoop_liters or 0.0)
    totale_liters = productie_value + inkoop_value

    if totale_liters <= 0:
        return None

    return float(totale_vaste_kosten) / totale_liters


def get_productiegegevens_for_year(year: int | str) -> dict[str, Any]:
    """Geeft productiegegevens voor een jaar terug met veilige standaardwaarden."""
    record = get_productie_record(year) or {}
    return record if isinstance(record, dict) else {}


def get_vaste_kosten_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft vaste kostenregels voor een jaar terug."""
    return get_vaste_kosten_record(year)


def duplicate_vaste_kosten_to_year(
    source_year: int | str,
    target_year: int | str,
    *,
    overwrite: bool = False,
) -> int:
    """Dupliceert vaste kosten van bronjaar naar doeljaar."""
    data = load_vaste_kosten_data()
    source_rows = data.get(str(source_year), [])
    if not isinstance(source_rows, list) or not source_rows:
        return 0
    if str(target_year) in data and not overwrite:
        return 0
    # Generate new row ids for the target year to avoid cross-year id collisions in the UI.
    copied_rows: list[dict[str, Any]] = []
    for row in deepcopy(source_rows):
        if not isinstance(row, dict):
            continue
        copied_rows.append({**row, "id": str(uuid4())})
    data[str(target_year)] = copied_rows
    if save_vaste_kosten_data(data):
        return len(copied_rows)
    return 0


def get_directe_vaste_kosten_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft alleen directe vaste kostenregels voor een jaar terug."""
    directe_kosten: list[dict[str, Any]] = []

    for record in get_vaste_kosten_for_year(year):
        kostensoort = str(
            record.get("kostensoort", record.get("type_kosten", "")) or ""
        ).strip().lower()
        if kostensoort not in {"direct", "directe kosten"}:
            continue
        directe_kosten.append(record)

    return directe_kosten


def get_vaste_kosten_per_liter_for_year(year: int | str) -> float | None:
    """Berekent vaste kosten per totale liter voor een geselecteerd jaar."""
    productiegegevens = get_productiegegevens_for_year(year)
    totale_vaste_kosten = calculate_total_vaste_kosten(get_vaste_kosten_for_year(year))

    return calculate_vaste_kosten_per_totale_liter(
        totale_vaste_kosten=totale_vaste_kosten,
        productie_liters=productiegegevens.get("hoeveelheid_productie_l"),
        inkoop_liters=productiegegevens.get("hoeveelheid_inkoop_l"),
    )


def bereken_indirecte_vaste_kosten_per_ingekochte_liter(year: int | str) -> float | None:
    """Berekent indirecte vaste kosten per ingekochte liter (na herverdeling)."""
    productiegegevens = get_productiegegevens_for_year(year)
    inkoop_liters = productiegegevens.get("hoeveelheid_inkoop_l")
    if inkoop_liters is None or float(inkoop_liters) <= 0:
        return None
    totals = calculate_herverdeelde_vaste_kosten_totals(get_vaste_kosten_for_year(year))
    return calculate_vaste_kosten_per_ingekochte_liter(
        totale_vaste_kosten=float(totals.get("indirect_after", 0.0) or 0.0),
        inkoop_liters=inkoop_liters,
    )


def bereken_directe_vaste_kosten_per_productieliter_herverdeeld(year: int | str) -> float | None:
    """Berekent directe vaste kosten per productieliter (na herverdeling)."""
    productiegegevens = get_productiegegevens_for_year(year)
    productie_liters = productiegegevens.get("hoeveelheid_productie_l")
    if productie_liters is None or float(productie_liters) <= 0:
        return None
    totals = calculate_herverdeelde_vaste_kosten_totals(get_vaste_kosten_for_year(year))
    return calculate_vaste_kosten_per_liter(
        totale_vaste_kosten=float(totals.get("direct_after", 0.0) or 0.0),
        productie_liters=productie_liters,
    )


def bereken_accijns_voor_liters(
    *,
    year: int | str,
    liters: float,
    alcoholpercentage: float,
    tarief_accijns: str = DEFAULT_TARIEF_ACCIJNS,
    belastingsoort: str = DEFAULT_BELASTINGSOORT,
) -> float:
    """Bereken accijns obv tarieven/heffingen van een jaar.

    Canonical model (matches frontend Kostprijsbeheer + NieuwJaarWizard):
    - Accijns: `tarief_(hoog/laag) * (alcohol% / 100) * liters`
    - Verbruiksbelasting: `verbruikersbelasting * (liters / 100)`
    """
    try:
        liters_value = float(liters or 0.0)
    except (TypeError, ValueError):
        liters_value = 0.0
    if liters_value <= 0:
        return 0.0

    tarieven = get_tarieven_heffingen_for_year(year)
    if not tarieven:
        return 0.0

    belasting_key = str(belastingsoort or "").strip().lower()
    vb = float(tarieven.get("verbruikersbelasting", 0.0) or 0.0)
    if belasting_key == "verbruiksbelasting":
        # Stored as EUR per hectoliter; liters/100 converts to hectoliter.
        return max(0.0, vb * (liters_value / 100.0))
    if belasting_key != "accijns":
        return 0.0

    tarief_key = "tarief_laag" if str(tarief_accijns or "").strip().lower() == "laag" else "tarief_hoog"
    tarief = float(tarieven.get(tarief_key, 0.0) or 0.0)
    try:
        alc = float(alcoholpercentage or 0.0)
    except (TypeError, ValueError):
        alc = 0.0
    if alc <= 0:
        return 0.0

    return max(0.0, tarief * (alc / 100.0) * liters_value)


def bereken_directe_vaste_kosten_per_liter(year: int | str) -> float | None:
    """Berekent directe vaste kosten per productieliter."""
    productiegegevens = get_productiegegevens_for_year(year)
    productie_liters = productiegegevens.get("hoeveelheid_productie_l")

    if productie_liters is None or float(productie_liters) <= 0:
        return None

    totale_directe_vaste_kosten = calculate_total_vaste_kosten(
        get_directe_vaste_kosten_for_year(year)
    )
    return float(totale_directe_vaste_kosten) / float(productie_liters)


def bereken_integrale_kostprijs_basisproduct(
    basisproduct: dict[str, Any],
    variabele_kosten_per_liter: float | int | None,
    vaste_kosten_per_liter: float | int | None,
) -> dict[str, float]:
    """Berekent integrale kostprijsregels voor een basisproduct."""
    kostprijs = bereken_basisproduct_kostprijs(
        basisproduct=basisproduct,
        variabele_kosten_per_liter=variabele_kosten_per_liter,
    )
    vaste_kosten = max(float(vaste_kosten_per_liter or 0.0), 0.0) * float(
        kostprijs["inhoud_liter"]
    )
    return {
        **kostprijs,
        "vaste_kosten": vaste_kosten,
        "integrale_kostprijs": float(kostprijs["totale_kostprijs"]) + vaste_kosten,
    }


def bereken_integrale_kostprijs_samengesteld_product(
    samengesteld_product: dict[str, Any],
    variabele_kosten_per_liter: float | int | None,
    vaste_kosten_per_liter: float | int | None,
) -> dict[str, float]:
    """Berekent integrale kostprijsregels voor een samengesteld product."""
    kostprijs = bereken_samengesteld_product_kostprijs(
        samengesteld_product=samengesteld_product,
        variabele_kosten_per_liter=variabele_kosten_per_liter,
    )
    vaste_kosten = max(float(vaste_kosten_per_liter or 0.0), 0.0) * float(
        kostprijs["inhoud_liter"]
    )
    return {
        **kostprijs,
        "vaste_kosten": vaste_kosten,
        "integrale_kostprijs": float(kostprijs["totale_kostprijs"]) + vaste_kosten,
    }


def load_bieren() -> list[dict[str, Any]]:
    """Laadt alle bieren uit de centrale bierlijst."""
    postgres_payload = _load_postgres_dataset("bieren")
    data = postgres_payload if isinstance(postgres_payload, list) else []
    if not isinstance(data, list):
        return []

    normalized_bieren: list[dict[str, Any]] = []
    for bier in data:
        if not isinstance(bier, dict):
            continue
        normalized_bieren.append(normalize_bier_record(bier))

    return normalized_bieren


def get_bieren_met_berekening_voor_jaar(year: int | str) -> list[dict[str, Any]]:
    """Geeft alleen bieren terug waarvoor variabele-kostenregels bestaan in een jaar."""
    try:
        year_key = str(int(year))
    except (TypeError, ValueError):
        return []

    data = load_variabele_kosten_data()
    bier_records = data.get(year_key, {})
    if not isinstance(bier_records, dict):
        return []

    bier_ids_met_data = {
        str(bier_id)
        for bier_id, records in bier_records.items()
        if isinstance(records, list) and len(records) > 0
    }
    if not bier_ids_met_data:
        return []

    return [
        bier
        for bier in load_bieren()
        if str(bier.get("id", "")) in bier_ids_met_data
    ]


def save_bieren(data: list[dict[str, Any]]) -> bool:
    """Slaat de centrale bierlijst veilig op."""
    normalized = [
        normalize_bier_record(bier)
        for bier in data
        if isinstance(bier, dict)
    ]
    return _save_postgres_dataset("bieren", normalized)


#
# NOTE: Wrapped `{Count,value}` records are no longer supported in runtime.
# Use `/api/meta/migrate-wrapped-payloads` to migrate existing datasets once.


def _has_meaningful_kostprijsversie_content(record: dict[str, Any]) -> bool:
    bier_id = str(record.get("bier_id", "") or "").strip()
    basisgegevens = record.get("basisgegevens", {}) or {}
    biernaam = str(basisgegevens.get("biernaam", "") or "").strip()
    jaar = int(record.get("jaar", basisgegevens.get("jaar", 0)) or 0)
    status = str(record.get("status", "") or "").strip().lower()
    invoer = record.get("invoer", {}) or {}
    ingredienten = (invoer.get("ingredienten", {}) or {}).get("regels", [])
    inkoop = invoer.get("inkoop", {}) or {}
    regels = inkoop.get("regels", [])
    factuurregels = inkoop.get("factuurregels", [])
    facturen = inkoop.get("facturen", [])
    snapshot = record.get("resultaat_snapshot", {}) or {}
    producten = (snapshot.get("producten", {}) or {})
    basisproducten = producten.get("basisproducten", [])
    samengestelde = producten.get("samengestelde_producten", [])

    if bier_id or biernaam or jaar > 0:
        return True
    if status == "definitief":
        return True
    if isinstance(ingredienten, list) and len(ingredienten) > 0:
        return True
    if isinstance(regels, list) and len(regels) > 0:
        return True
    if isinstance(factuurregels, list) and len(factuurregels) > 0:
        return True
    if isinstance(facturen, list):
        for factuur in facturen:
            if not isinstance(factuur, dict):
                continue
            if str(factuur.get("factuurnummer", "") or "").strip():
                return True
            if str(factuur.get("factuurdatum", "") or "").strip():
                return True
            if float(factuur.get("verzendkosten", 0) or 0) > 0:
                return True
            if float(factuur.get("overige_kosten", 0) or 0) > 0:
                return True
            regels_in_factuur = factuur.get("factuurregels", [])
            if isinstance(regels_in_factuur, list) and len(regels_in_factuur) > 0:
                return True
    if isinstance(basisproducten, list) and len(basisproducten) > 0:
        return True
    if isinstance(samengestelde, list) and len(samengestelde) > 0:
        return True
    return False


def _collect_referenced_bier_ids() -> set[str]:
    """Verzamelt alle bier-id's die nog ergens functioneel worden gebruikt."""
    referenced_ids: set[str] = set()

    for record in load_berekeningen():
        bier_id = str(record.get("bier_id", "") or "").strip()
        if bier_id:
            referenced_ids.add(bier_id)

    for voorstel in load_prijsvoorstellen():
        bier_id = str(voorstel.get("bier_id", "") or "").strip()
        if bier_id:
            referenced_ids.add(bier_id)
        for bier_id_value in voorstel.get("selected_bier_ids", []) if isinstance(voorstel.get("selected_bier_ids", []), list) else []:
            bier_id_text = str(bier_id_value or "").strip()
            if bier_id_text:
                referenced_ids.add(bier_id_text)

        beer_rows = voorstel.get("beer_rows", [])
        if isinstance(beer_rows, list):
            for row in beer_rows:
                if not isinstance(row, dict):
                    continue
                bier_row_id = str(row.get("bier_id", "") or "").strip()
                if bier_row_id:
                    referenced_ids.add(bier_row_id)

    for record in load_verkoopprijzen():
        bier_id = str(record.get("bier_id", "") or "").strip()
        if bier_id:
            referenced_ids.add(bier_id)

    for record in _load_verkoopprijs_records():
        if not isinstance(record, dict):
            continue
        bier_id = str(record.get("bier_id", "") or "").strip()
        if bier_id:
            referenced_ids.add(bier_id)

    for activation in load_kostprijsproductactiveringen():
        if not isinstance(activation, dict):
            continue
        bier_id = str(activation.get("bier_id", "") or "").strip()
        if bier_id:
            referenced_ids.add(bier_id)

    variabele_kosten_data = load_variabele_kosten_data()
    for year_records in variabele_kosten_data.values():
        if not isinstance(year_records, dict):
            continue
        for bier_id in year_records.keys():
            bier_id_value = str(bier_id or "").strip()
            if bier_id_value:
                referenced_ids.add(bier_id_value)

    return referenced_ids


def cleanup_unused_bieren() -> bool:
    """Verwijdert bierrecords die nergens meer door de app worden gebruikt."""
    bieren = load_bieren()
    referenced_ids = _collect_referenced_bier_ids()
    filtered = [
        bier
        for bier in bieren
        if str(bier.get("id", "") or "").strip() in referenced_ids
    ]
    if len(filtered) == len(bieren):
        return True
    return save_bieren(filtered)


def get_bier_usage_locations(
    bier_id: str,
    *,
    exclude_berekening_id: str = "",
) -> list[str]:
    """Geeft een compacte lijst terug van plekken waar een bier-id nog wordt gebruikt."""
    bier_id_value = str(bier_id or "").strip()
    if not bier_id_value:
        return []

    locations: list[str] = []

    overige_berekeningen = [
        record
        for record in load_berekeningen()
        if str(record.get("bier_id", "") or "").strip() == bier_id_value
        and str(record.get("id", "") or "").strip() != str(exclude_berekening_id or "").strip()
    ]
    if overige_berekeningen:
        label = "berekening" if len(overige_berekeningen) == 1 else "berekeningen"
        locations.append(f"{len(overige_berekeningen)} {label}")

    prijsvoorstellen = [
        record
        for record in load_prijsvoorstellen()
        if (
            str(record.get("bier_id", "") or "").strip() == bier_id_value
            or any(
                str(value or "").strip() == bier_id_value
                for value in (record.get("selected_bier_ids", []) if isinstance(record.get("selected_bier_ids", []), list) else [])
            )
            or any(
                isinstance(row, dict)
                and str(row.get("bier_id", "") or "").strip() == bier_id_value
                for row in (record.get("beer_rows", []) if isinstance(record.get("beer_rows", []), list) else [])
            )
        )
    ]
    if prijsvoorstellen:
        label = "prijsvoorstel" if len(prijsvoorstellen) == 1 else "prijsvoorstellen"
        locations.append(f"{len(prijsvoorstellen)} {label}")

    verkoopprijzen = [
        record
        for record in load_verkoopprijzen()
        if str(record.get("bier_id", "") or "").strip() == bier_id_value
    ]
    if verkoopprijzen:
        label = "verkoopprijs" if len(verkoopprijzen) == 1 else "verkoopprijzen"
        locations.append(f"{len(verkoopprijzen)} {label}")

    productstrategieen = [
        record
        for record in _load_verkoopprijs_records()
        if isinstance(record, dict)
        and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT
        and str(record.get("bier_id", "") or "").strip() == bier_id_value
    ]
    if productstrategieen:
        label = "productstrategie" if len(productstrategieen) == 1 else "productstrategieën"
        locations.append(f"{len(productstrategieen)} {label}")

    variabele_kosten_jaren = [
        year_key
        for year_key, year_records in load_variabele_kosten_data().items()
        if isinstance(year_records, dict) and bier_id_value in year_records
    ]
    if variabele_kosten_jaren:
        label = "jaar variabele kosten" if len(variabele_kosten_jaren) == 1 else "jaren variabele kosten"
        locations.append(f"{len(variabele_kosten_jaren)} {label}")

    return locations


def delete_bier_usage_everywhere(
    bier_id: str,
    *,
    exclude_berekening_id: str = "",
) -> bool:
    """Verwijdert alle afgeleide records die nog naar een bier-id verwijzen."""
    bier_id_value = str(bier_id or "").strip()
    if not bier_id_value:
        return cleanup_unused_bieren()

    berekeningen = [
        record
        for record in load_berekeningen()
        if not (
            str(record.get("bier_id", "") or "").strip() == bier_id_value
            and str(record.get("id", "") or "").strip() != str(exclude_berekening_id or "").strip()
        )
    ]
    if not save_berekeningen(berekeningen):
        return False

    kostprijsproductactiveringen = [
        record
        for record in load_kostprijsproductactiveringen()
        if str(record.get("bier_id", "") or "").strip() != bier_id_value
    ]
    if not save_kostprijsproductactiveringen(kostprijsproductactiveringen):
        return False

    prijsvoorstellen = [
        record
        for record in load_prijsvoorstellen()
        if not (
            str(record.get("bier_id", "") or "").strip() == bier_id_value
            or any(
                str(value or "").strip() == bier_id_value
                for value in (record.get("selected_bier_ids", []) if isinstance(record.get("selected_bier_ids", []), list) else [])
            )
            or any(
                isinstance(row, dict)
                and str(row.get("bier_id", "") or "").strip() == bier_id_value
                for row in (record.get("beer_rows", []) if isinstance(record.get("beer_rows", []), list) else [])
            )
        )
    ]
    if not save_prijsvoorstellen(prijsvoorstellen):
        return False

    verkoopprijzen = [
        record
        for record in load_verkoopprijzen()
        if str(record.get("bier_id", "") or "").strip() != bier_id_value
    ]
    if not save_verkoopprijzen(verkoopprijzen):
        return False

    verkoop_records = [
        record
        for record in _load_verkoopprijs_records()
        if not (
            isinstance(record, dict)
            and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT
            and str(record.get("bier_id", "") or "").strip() == bier_id_value
        )
    ]
    if not _save_verkoop_records(verkoop_records):
        return False

    variabele_kosten = load_variabele_kosten_data()
    updated_variabele_kosten: dict[str, Any] = {}
    for year_key, year_records in variabele_kosten.items():
        if not isinstance(year_records, dict):
            continue
        filtered_year_records = {
            key: value
            for key, value in year_records.items()
            if str(key or "").strip() != bier_id_value
        }
        if filtered_year_records:
            updated_variabele_kosten[year_key] = filtered_year_records
    if not save_variabele_kosten_data(updated_variabele_kosten):
        return False

    return cleanup_unused_bieren()


def add_bier(
    biernaam: str,
    stijl: str,
    alcoholpercentage: float,
    belastingsoort: str = DEFAULT_BELASTINGSOORT,
    tarief_accijns: str = DEFAULT_TARIEF_ACCIJNS,
    btw_tarief: str = DEFAULT_BTW_TARIEF,
) -> dict[str, Any] | None:
    """Voegt een nieuw bier toe aan de centrale bierlijst."""
    bieren = load_bieren()
    bier = normalize_bier_record(
        {
            "id": str(uuid4()),
            "biernaam": biernaam,
            "stijl": stijl,
            "alcoholpercentage": float(alcoholpercentage),
            "belastingsoort": belastingsoort,
            "tarief_accijns": tarief_accijns,
            "btw_tarief": btw_tarief,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
    )
    bieren.append(bier)

    if save_bieren(bieren):
        return bier

    return None


def get_bier_by_id(bier_id: str) -> dict[str, Any] | None:
    """Haalt bierdetails op op basis van het bier-id."""
    for bier in load_bieren():
        if str(bier.get("id")) == bier_id:
            return bier

    return None


def update_bier(
    bier_id: str,
    biernaam: str,
    stijl: str,
    alcoholpercentage: float,
    belastingsoort: str = DEFAULT_BELASTINGSOORT,
    tarief_accijns: str = DEFAULT_TARIEF_ACCIJNS,
    btw_tarief: str = DEFAULT_BTW_TARIEF,
) -> bool:
    """Werkt een bestaand bier bij."""
    bieren = load_bieren()

    for index, bier in enumerate(bieren):
        if str(bier.get("id")) != bier_id:
            continue

        existing_created_at = str(bier.get("created_at", "") or "") or _now_iso()
        bieren[index] = normalize_bier_record(
            {
                "id": bier_id,
                "biernaam": biernaam,
                "stijl": stijl,
                "alcoholpercentage": float(alcoholpercentage),
                "belastingsoort": belastingsoort,
                "tarief_accijns": tarief_accijns,
                "btw_tarief": btw_tarief,
                "created_at": existing_created_at,
                "updated_at": _now_iso(),
            }
        )
        return save_bieren(bieren)

    return False


def _sync_bieren_with_kostprijsversies(
    records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    bieren = load_bieren()
    bieren_by_id = {str(bier.get("id", "") or ""): bier for bier in bieren}
    bieren_by_name = {
        str(bier.get("biernaam", "") or "").strip().lower(): bier
        for bier in bieren
        if str(bier.get("biernaam", "") or "").strip()
    }
    changed = False

    for record in records:
        basisgegevens = record.get("basisgegevens", {})
        if not isinstance(basisgegevens, dict):
            basisgegevens = {}
        biernaam = str(basisgegevens.get("biernaam", "") or "").strip()
        if not biernaam:
            continue

        stijl = str(basisgegevens.get("stijl", "") or "").strip()
        alcoholpercentage = float(basisgegevens.get("alcoholpercentage", 0.0) or 0.0)
        belastingsoort = str(
            basisgegevens.get("belastingsoort", DEFAULT_BELASTINGSOORT) or DEFAULT_BELASTINGSOORT
        )
        tarief_accijns = str(
            basisgegevens.get("tarief_accijns", DEFAULT_TARIEF_ACCIJNS) or DEFAULT_TARIEF_ACCIJNS
        )
        btw_tarief = str(basisgegevens.get("btw_tarief", DEFAULT_BTW_TARIEF) or DEFAULT_BTW_TARIEF)

        bier_id = str(record.get("bier_id", "") or "").strip()
        existing = bieren_by_id.get(bier_id) if bier_id else None
        if existing is None:
            existing = bieren_by_name.get(biernaam.lower())

        if existing is None:
            bier = normalize_bier_record(
                {
                    "id": bier_id or str(uuid4()),
                    "biernaam": biernaam,
                    "stijl": stijl,
                    "alcoholpercentage": alcoholpercentage,
                    "belastingsoort": belastingsoort,
                    "tarief_accijns": tarief_accijns,
                    "btw_tarief": btw_tarief,
                    "created_at": _now_iso(),
                    "updated_at": _now_iso(),
                }
            )
            bieren.append(bier)
            bieren_by_id[str(bier["id"])] = bier
            bieren_by_name[biernaam.lower()] = bier
            existing = bier
            changed = True
        else:
            updated_bier = normalize_bier_record(
                {
                    **existing,
                    "biernaam": biernaam,
                    "stijl": stijl,
                    "alcoholpercentage": alcoholpercentage,
                    "belastingsoort": belastingsoort,
                    "tarief_accijns": tarief_accijns,
                    "btw_tarief": btw_tarief,
                    "updated_at": _now_iso(),
                }
            )
            if updated_bier != existing:
                for index, bier in enumerate(bieren):
                    if str(bier.get("id", "") or "") == str(updated_bier["id"]):
                        bieren[index] = updated_bier
                        break
                bieren_by_id[str(updated_bier["id"])] = updated_bier
                bieren_by_name[biernaam.lower()] = updated_bier
                existing = updated_bier
                changed = True

        resolved_bier_id = str(existing.get("id", "") or "")
        if str(record.get("bier_id", "") or "").strip() != resolved_bier_id:
            record["bier_id"] = resolved_bier_id
            changed = True

    if changed:
        save_bieren(bieren)

    return records, changed


def _assign_kostprijsversie_numbers(
    records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for record in records:
        bier_id = str(record.get("bier_id", "") or "")
        jaar = int(record.get("jaar", 0) or 0)
        grouped.setdefault((bier_id, jaar), []).append(record)

    for (_, _), group in grouped.items():
        group.sort(
            key=lambda item: (
                str(item.get("aangemaakt_op", item.get("created_at", "")) or ""),
                str(item.get("aangepast_op", item.get("updated_at", "")) or ""),
                str(item.get("id", "") or ""),
            )
        )
        for index, item in enumerate(group, start=1):
            item["versie_nummer"] = index

    return records


def _enforce_single_active_kostprijsversie(
    records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for record in records:
        bier_id = str(record.get("bier_id", "") or "")
        jaar = int(record.get("jaar", 0) or 0)
        grouped.setdefault((bier_id, jaar), []).append(record)

    for (_, _), group in grouped.items():
        definitive = [
            record
            for record in group
            if str(record.get("status", "") or "") == "definitief"
        ]
        active = [
            record
            for record in definitive
            if bool(record.get("is_actief", False))
        ]

        keeper: dict[str, Any] | None = None
        if active:
            active.sort(
                key=lambda item: (
                    str(item.get("effectief_vanaf", "") or ""),
                    str(item.get("aangepast_op", item.get("updated_at", "")) or ""),
                    str(item.get("id", "") or ""),
                ),
                reverse=True,
            )
            keeper = active[0]
        elif definitive:
            definitive.sort(
                key=lambda item: (
                    str(item.get("finalized_at", "") or ""),
                    str(item.get("aangepast_op", item.get("updated_at", "")) or ""),
                    str(item.get("id", "") or ""),
                ),
                reverse=True,
            )
            keeper = definitive[0]
            keeper["is_actief"] = True
            keeper["effectief_vanaf"] = str(
                keeper.get("effectief_vanaf", "")
                or keeper.get("finalized_at", "")
                or keeper.get("updated_at", "")
                or _now_iso()
            )

        keeper_id = str(keeper.get("id", "") or "") if keeper else ""
        for record in group:
            is_keeper = keeper_id and str(record.get("id", "") or "") == keeper_id
            if str(record.get("status", "") or "") != "definitief":
                record["is_actief"] = False
                record["effectief_vanaf"] = ""
                continue
            record["is_actief"] = bool(is_keeper)
            if is_keeper:
                record["effectief_vanaf"] = str(
                    record.get("effectief_vanaf", "")
                    or record.get("finalized_at", "")
                    or record.get("updated_at", "")
                    or _now_iso()
                )
            else:
                record["effectief_vanaf"] = ""

    return records


def load_kostprijsversies() -> list[dict[str, Any]]:
    """Laadt alle kostprijsversies voor de kostprijswizard."""
    postgres_payload = _load_postgres_dataset("kostprijsversies")
    if not isinstance(postgres_payload, list):
        postgres_payload = _load_postgres_dataset("berekeningen")
    if isinstance(postgres_payload, list):
        data = postgres_payload
    else:
        data = []
    if not isinstance(data, list):
        return []

    normalized_records, _ = _normalize_and_sync_kostprijsversie_state(
        [record for record in data if isinstance(record, dict)]
    )
    return normalized_records


def load_berekeningen() -> list[dict[str, Any]]:
    """Compatibele wrapper: berekeningen lezen nu uit kostprijsversies."""
    return load_kostprijsversies()


def normalize_verkoopprijs_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een verkoopprijsrecord voor opslag en UI."""

    def _float_value(key: str) -> float:
        try:
            return float(record.get(key, 0.0) or 0.0)
        except (TypeError, ValueError):
            return 0.0

    def _int_value(key: str, default: int = 0) -> int:
        try:
            return int(record.get(key, default) or default)
        except (TypeError, ValueError):
            return default

    try:
        jaar = int(record.get("jaar", 0) or 0)
    except (TypeError, ValueError):
        jaar = 0

    bier_id = str(record.get("bier_id", "") or "")
    biernaam = str(record.get("biernaam", "") or "")
    stijl = str(record.get("stijl", "") or "")

    created_at = str(record.get("created_at", "") or "") or _now_iso()
    updated_at = str(record.get("updated_at", "") or "") or created_at

    return {
        "id": str(record.get("id", "") or uuid4()),
        "record_type": "product_pricing",
        "bier_id": bier_id,
        "berekening_id": str(record.get("berekening_id", "") or ""),
        "bron_berekening_id": str(record.get("bron_berekening_id", "") or ""),
        "bron_jaar": _int_value("bron_jaar", jaar),
        "jaar": jaar,
        "biernaam": biernaam,
        "stijl": stijl,
        "product_type": str(record.get("product_type", "") or ""),
        "product_id": str(record.get("product_id", "") or ""),
        "verpakking": str(record.get("verpakking", "") or ""),
        "bron_verkoopprijs_id": str(record.get("bron_verkoopprijs_id", "") or ""),
        "bron_verkoopjaar": _int_value("bron_verkoopjaar", jaar),
        "strategie_type": str(record.get("strategie_type", "") or ""),
        "kostprijs_per_liter": _float_value("kostprijs_per_liter"),
        "particulier_marge_pct": _float_value("particulier_marge_pct"),
        "zakelijk_marge_pct": _float_value("zakelijk_marge_pct"),
        "groothandel_marge_pct": _float_value("groothandel_marge_pct"),
        "particulier_prijs_per_liter": _float_value("particulier_prijs_per_liter"),
        "zakelijk_prijs_per_liter": _float_value("zakelijk_prijs_per_liter"),
        "groothandel_prijs_per_liter": _float_value("groothandel_prijs_per_liter"),
        "adviesprijs_per_liter": _float_value("adviesprijs_per_liter"),
        "created_at": created_at,
        "updated_at": updated_at,
    }


VERKOOPSTRATEGIE_CATEGORIEN = [
    "particulier",
    "zakelijk",
    "retail",
    "horeca",
    "slijterij",
]
VERKOOPSTRATEGIE_RECORD_TYPE_JAAR = "jaarstrategie"
VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT = "verkoopstrategie_product"
VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING = "verkoopstrategie_verpakking"


def _normalize_verpakking_key(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    # Normalize common separators/typos so historical labels map to master products deterministically.
    # Examples: "24*33cl", "24×33cl", "24 x 33cl" should all match.
    text = (
        text.replace("×", "x")
        .replace("*", "x")
        .replace("  ", " ")
    )
    # Collapse whitespace around the multiplication marker.
    text = text.replace(" x ", "x").replace(" x", "x").replace("x ", "x")
    # Collapse remaining whitespace.
    text = " ".join(text.split())
    return text


def _normalize_channel_price_map(raw: Any) -> dict[str, float | None]:
    # Sparse map: missing/empty means "use defaults" (no override).
    source = raw if isinstance(raw, dict) else {}
    normalized: dict[str, float] = {}
    for categorie in VERKOOPSTRATEGIE_CATEGORIEN:
        if categorie not in source:
            continue
        value = source.get(categorie)
        if value in ("", None):
            continue
        try:
            normalized[categorie] = float(value)
        except (TypeError, ValueError):
            continue
    return normalized


def _normalize_sparse_float_overrides(
    *,
    primary: Any,
    secondary: Any,
    keep_zero: bool,
) -> dict[str, float]:
    """Normalizes a sparse overrides dict using VERKOOPSTRATEGIE_CATEGORIEN.

    primary wins over secondary; missing/empty means no override.
    When keep_zero is false, 0 values are treated as "no override" (common for legacy records).
    """
    primary_source = primary if isinstance(primary, dict) else {}
    secondary_source = secondary if isinstance(secondary, dict) else {}
    out: dict[str, float] = {}
    for categorie in VERKOOPSTRATEGIE_CATEGORIEN:
        has_value = categorie in primary_source or categorie in secondary_source
        if not has_value:
            continue
        value = primary_source.get(categorie, secondary_source.get(categorie))
        if value in ("", None):
            continue
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            continue
        if not keep_zero and parsed == 0.0:
            continue
        out[categorie] = parsed
    return out


def normalize_verkoopstrategie_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een jaargebonden verkoopstrategie-record voor opslag en UI."""

    try:
        jaar = int(record.get("jaar", 0) or 0)
    except (TypeError, ValueError):
        jaar = 0

    try:
        bron_jaar = int(record.get("bron_jaar", jaar) or jaar)
    except (TypeError, ValueError):
        bron_jaar = jaar

    strategie_type = str(record.get("strategie_type", "") or "")
    kanaalmarges = _normalize_sparse_float_overrides(
        primary=record.get("sell_in_margins", record.get("kanaalmarges", {})),
        secondary=record.get("kanaalmarges", {}),
        keep_zero=strategie_type == "override",
    )

    created_at = str(record.get("created_at", "") or "") or _now_iso()
    updated_at = str(record.get("updated_at", "") or "") or created_at

    return {
        "id": str(record.get("id", "") or uuid4()),
        "record_type": VERKOOPSTRATEGIE_RECORD_TYPE_JAAR,
        "jaar": jaar,
        "bron_jaar": bron_jaar,
        "bron_verkoopstrategie_id": str(
            record.get("bron_verkoopstrategie_id", "") or ""
        ),
        "strategie_type": strategie_type,
        "kanaalmarges": kanaalmarges,
        "sell_in_margins": dict(kanaalmarges),
        "created_at": created_at,
        "updated_at": updated_at,
    }


def normalize_verkoopstrategie_product_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een verkoopstrategie op samengesteld-productniveau."""

    def _float_value(value: Any) -> float:
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0

    try:
        jaar = int(record.get("jaar", 0) or 0)
    except (TypeError, ValueError):
        jaar = 0

    try:
        bron_jaar = int(record.get("bron_jaar", jaar) or jaar)
    except (TypeError, ValueError):
        bron_jaar = jaar

    strategie_type = str(record.get("strategie_type", "") or "")
    kanaalmarges_source = record.get("kanaalmarges", {})
    if not isinstance(kanaalmarges_source, dict):
        kanaalmarges_source = {}
    sell_in_margins_source = record.get("sell_in_margins", kanaalmarges_source)
    if not isinstance(sell_in_margins_source, dict):
        sell_in_margins_source = {}

    kanaalprijzen_source = record.get("kanaalprijzen", {})
    if not isinstance(kanaalprijzen_source, dict):
        kanaalprijzen_source = {}
    sell_in_prices_source = record.get("sell_in_prices", kanaalprijzen_source)
    if not isinstance(sell_in_prices_source, dict):
        sell_in_prices_source = {}

    kanaalmarges = _normalize_sparse_float_overrides(
        primary=sell_in_margins_source,
        secondary=kanaalmarges_source,
        keep_zero=strategie_type == "override",
    )
    kanaalprijzen: dict[str, float] = {}
    for categorie in VERKOOPSTRATEGIE_CATEGORIEN:
        if categorie not in sell_in_prices_source and categorie not in kanaalprijzen_source:
            continue
        price_value = sell_in_prices_source.get(categorie, kanaalprijzen_source.get(categorie))
        if price_value in ("", None):
            continue
        try:
            kanaalprijzen[categorie] = float(price_value)
        except (TypeError, ValueError):
            continue

    created_at = str(record.get("created_at", "") or "") or _now_iso()
    updated_at = str(record.get("updated_at", "") or "") or created_at

    return {
        "id": str(record.get("id", "") or uuid4()),
        "record_type": VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT,
        "jaar": jaar,
        "bron_jaar": bron_jaar,
        "bier_id": str(record.get("bier_id", "") or ""),
        "biernaam": str(record.get("biernaam", "") or ""),
        "stijl": str(record.get("stijl", "") or ""),
        "product_id": str(record.get("product_id", "") or ""),
        "product_type": str(record.get("product_type", "samengesteld") or "samengesteld"),
        "verpakking": str(record.get("verpakking", "") or ""),
        "bron_berekening_id": str(record.get("bron_berekening_id", "") or ""),
        "bron_verkoopstrategie_id": str(record.get("bron_verkoopstrategie_id", "") or ""),
        "strategie_type": strategie_type,
        "kostprijs": _float_value(record.get("kostprijs")),
        "kostprijs_per_liter": _float_value(record.get("kostprijs_per_liter")),
        "kanaalmarges": kanaalmarges,
        "kanaalprijzen": kanaalprijzen,
        "sell_in_margins": dict(kanaalmarges),
        "sell_in_prices": dict(kanaalprijzen),
        "created_at": created_at,
        "updated_at": updated_at,
    }


def normalize_verkoopstrategie_verpakking_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een verkoopstrategie op verpakkingstype-niveau."""

    def _float_value(value: Any) -> float:
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0

    try:
        jaar = int(record.get("jaar", 0) or 0)
    except (TypeError, ValueError):
        jaar = 0

    try:
        bron_jaar = int(record.get("bron_jaar", jaar) or jaar)
    except (TypeError, ValueError):
        bron_jaar = jaar

    kanaalmarges_source = record.get("kanaalmarges", {})
    if not isinstance(kanaalmarges_source, dict):
        kanaalmarges_source = {}
    sell_in_margins_source = record.get("sell_in_margins", kanaalmarges_source)
    if not isinstance(sell_in_margins_source, dict):
        sell_in_margins_source = {}
    sell_in_prices_source = record.get("sell_in_prices", record.get("kanaalprijzen", {}))
    if not isinstance(sell_in_prices_source, dict):
        sell_in_prices_source = {}

    strategie_type = str(record.get("strategie_type", "") or "")
    kanaalmarges = _normalize_sparse_float_overrides(
        primary=sell_in_margins_source,
        secondary=kanaalmarges_source,
        keep_zero=strategie_type == "override",
    )
    kanaalprijzen: dict[str, float] = {}
    for categorie in VERKOOPSTRATEGIE_CATEGORIEN:
        if categorie not in sell_in_prices_source:
            continue
        price_value = sell_in_prices_source.get(categorie)
        if price_value in ("", None):
            continue
        try:
            kanaalprijzen[categorie] = float(price_value)
        except (TypeError, ValueError):
            continue

    created_at = str(record.get("created_at", "") or "") or _now_iso()
    updated_at = str(record.get("updated_at", "") or "") or created_at
    verpakking = str(record.get("verpakking", "") or "")

    return {
        "id": str(record.get("id", "") or uuid4()),
        "record_type": VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING,
        "jaar": jaar,
        "bron_jaar": bron_jaar,
        "product_id": str(record.get("product_id", "") or ""),
        "product_type": str(record.get("product_type", "") or ""),
        "verpakking": verpakking,
        "bron_verkoopstrategie_id": str(record.get("bron_verkoopstrategie_id", "") or ""),
        "strategie_type": strategie_type,
        "kanaalmarges": kanaalmarges,
        "kanaalprijzen": kanaalprijzen,
        "sell_in_margins": dict(kanaalmarges),
        "sell_in_prices": dict(kanaalprijzen),
        "created_at": created_at,
        "updated_at": updated_at,
    }


def _load_verkoopprijs_records() -> list[dict[str, Any]]:
    """Laadt alle ruwe records uit verkoopprijzen.json veilig in."""
    data = _load_postgres_first_list("verkoopprijzen", VERKOOPPRIJZEN_FILE)
    return data if isinstance(data, list) else []


def _normalize_any_verkoop_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een verkooprecord op basis van het type."""
    record_type = str(record.get("record_type", "") or "")
    if record_type == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR:
        return normalize_verkoopstrategie_record(record)
    if record_type == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT:
        return normalize_verkoopstrategie_product_record(record)
    if record_type == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING:
        return normalize_verkoopstrategie_verpakking_record(record)
    return normalize_verkoopprijs_record(record)


def _default_verkoop_kanaalmarges() -> dict[str, float]:
    # Sparse: empty means "use kanaaldefaults" (no overrides).
    return {}


def _build_verkoopstrategie_packaging_sources() -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []

    for product in load_basisproducten():
        verpakking = str(product.get("omschrijving", "") or "")
        if not verpakking:
            continue
        sources.append(
            {
                "jaar": int(product.get("jaar", 0) or 0),
                "product_id": str(product.get("id", "") or ""),
                "product_type": "basis",
                "verpakking": verpakking,
            }
        )

    for product in load_samengestelde_producten():
        verpakking = str(product.get("omschrijving", "") or "")
        if not verpakking:
            continue
        sources.append(
            {
                "jaar": int(product.get("jaar", 0) or 0),
                "product_id": str(product.get("id", "") or ""),
                "product_type": "samengesteld",
                "verpakking": verpakking,
            }
        )

    return sources


def _pick_verkoopstrategie_seed(
    year: int,
    product_id: str,
    records: list[dict[str, Any]],
) -> dict[str, Any] | None:
    verpakking_candidates = [
        record
        for record in records
        if str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
        and int(record.get("jaar", 0) or 0) <= year
        and product_id
        and str(record.get("product_id", "") or "") == product_id
    ]
    if verpakking_candidates:
        return max(verpakking_candidates, key=lambda item: int(item.get("jaar", 0) or 0))

    jaarstrategie_candidates = [
        record
        for record in records
        if str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR
        and int(record.get("jaar", 0) or 0) <= year
    ]
    if jaarstrategie_candidates:
        return max(jaarstrategie_candidates, key=lambda item: int(item.get("jaar", 0) or 0))

    return None


def _ensure_complete_verkoop_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = [
        _normalize_any_verkoop_record(record)
        for record in records
        if isinstance(record, dict)
    ]
    # Enforce uniqueness for strategy records. Historical saves could introduce duplicates which then
    # cause UI rows to appear twice and "reset" on reload depending on which duplicate is picked.
    # Keyed by the business identity, keep the most recently updated record.
    strategy_by_key: dict[tuple[Any, ...], dict[str, Any]] = {}
    other_records: list[dict[str, Any]] = []
    for record in normalized:
        record_type = str(record.get("record_type", "") or "")
        try:
            jaar = int(record.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            jaar = 0

        key: tuple[Any, ...] | None = None
        if record_type == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR:
            key = (record_type, jaar)
        elif record_type == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT:
            key = (
                record_type,
                jaar,
                str(record.get("bier_id", "") or ""),
                str(record.get("product_id", "") or ""),
            )
        elif record_type == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING:
            key = (
                record_type,
                jaar,
                str(record.get("product_id", "") or ""),
                _normalize_verpakking_key(record.get("verpakking", "")),
            )

        if key is None:
            other_records.append(record)
            continue

        current = strategy_by_key.get(key)
        if current is None or (
            str(record.get("updated_at", "") or ""),
            str(record.get("id", "") or ""),
        ) > (
            str(current.get("updated_at", "") or ""),
            str(current.get("id", "") or ""),
        ):
            strategy_by_key[key] = record

    normalized = [*other_records, *strategy_by_key.values()]

    existing_packaging_keys: set[tuple[int, str, str]] = set()
    for record in normalized:
        if str(record.get("record_type", "") or "") != VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING:
            continue
        existing_packaging_keys.add(
            (
                int(record.get("jaar", 0) or 0),
                str(record.get("product_id", "") or ""),
                _normalize_verpakking_key(record.get("verpakking", "")),
            )
        )

    appended: list[dict[str, Any]] = []
    for source in _build_verkoopstrategie_packaging_sources():
        year = int(source.get("jaar", 0) or 0)
        product_id = str(source.get("product_id", "") or "")
        verpakking = str(source.get("verpakking", "") or "")
        identity = (year, product_id, _normalize_verpakking_key(verpakking))
        if identity in existing_packaging_keys:
            continue

        seed = _pick_verkoopstrategie_seed(year, product_id, normalized)
        appended.append(
            normalize_verkoopstrategie_verpakking_record(
                {
                    "jaar": year,
                    "bron_jaar": int((seed or {}).get("jaar", year) or year),
                    "product_id": product_id,
                    "product_type": str(source.get("product_type", "") or ""),
                    "verpakking": verpakking,
                    "bron_verkoopstrategie_id": str((seed or {}).get("id", "") or ""),
                    "strategie_type": str((seed or {}).get("strategie_type", "handmatig") or "handmatig"),
                    # Sparse overrides: empty means "use kanaaldefaults".
                    "kanaalmarges": dict((seed or {}).get("kanaalmarges", _default_verkoop_kanaalmarges())),
                }
            )
        )
        existing_packaging_keys.add(identity)

    completed = [*normalized, *appended]

    concrete_packaging_pairs = {
        (
            int(record.get("jaar", 0) or 0),
            _normalize_verpakking_key(record.get("verpakking", "")),
        )
        for record in completed
        if str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
        and str(record.get("product_id", "") or "")
    }

    completed = [
        record
        for record in completed
        if not (
            str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
            and not str(record.get("product_id", "") or "")
            and (
                int(record.get("jaar", 0) or 0),
                _normalize_verpakking_key(record.get("verpakking", "")),
            )
            in concrete_packaging_pairs
        )
    ]

    completed.sort(
        key=lambda item: (
            int(item.get("jaar", 0) or 0),
            0
            if str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR
            else 1
            if str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
            else 2,
            str(item.get("biernaam", "") or "").lower(),
            str(item.get("verpakking", "") or "").lower(),
        )
    )
    return completed


def normalize_any_verkoop_record(record: dict[str, Any]) -> dict[str, Any]:
    """Publieke helper voor het normaliseren van verkooprecords."""
    return _normalize_any_verkoop_record(record)


def ensure_complete_verkoop_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Publieke helper die ontbrekende verpakkingsstrategie-records aanvult."""
    return _ensure_complete_verkoop_records(records)


def _validate_verkoop_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    known_bieren = _known_bier_ids()
    known_products = _known_product_refs()
    validated: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        normalized = _normalize_any_verkoop_record(record)
        bier_id = str(normalized.get("bier_id", "") or "")
        if bier_id and bier_id not in known_bieren:
            invalid.append({"reason": "unknown_bier", "row": normalized})
            continue
        product_id = str(normalized.get("product_id", "") or "")
        product_type = str(normalized.get("product_type", "") or "").strip().lower()
        if product_id and (product_id, product_type) not in known_products:
            invalid.append({"reason": "unknown_product", "row": normalized})
            continue
        validated.append(normalized)
    if invalid:
        raise ValueError(
            "Ongeldige verkooprecords: gevonden verwijzingen naar onbekende bier/product. "
            "Voer eerst /api/meta/migrate-product-ids uit of corrigeer stamdata."
        )
    return validated


def _save_verkoop_records(records: list[dict[str, Any]]) -> bool:
    """Slaat gemengde verkooprecords veilig op."""
    normalized = _ensure_complete_verkoop_records(_validate_verkoop_records(records))
    return _save_postgres_dataset("verkoopprijzen", normalized)


def load_verkoopprijzen() -> list[dict[str, Any]]:
    """Laadt alle verkoopprijzen veilig in."""
    return [
        normalize_verkoopprijs_record(record)
        for record in _load_verkoopprijs_records()
        if isinstance(record, dict)
        and str(record.get("record_type", "") or "") not in {
            VERKOOPSTRATEGIE_RECORD_TYPE_JAAR,
            VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT,
            VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING,
        }
    ]


def load_all_verkoop_records() -> list[dict[str, Any]]:
    """Laadt alle verkoop-gerelateerde records veilig in, inclusief strategie-records."""
    return _ensure_complete_verkoop_records(_load_verkoopprijs_records())


def save_verkoopprijzen(data: list[dict[str, Any]]) -> bool:
    """Slaat alle verkoopprijzen veilig op."""
    strategy_records = [
        *load_verkoopstrategien(),
        *load_verkoopstrategie_producten(),
        *load_verkoopstrategie_verpakkingen(),
    ]
    return _save_verkoop_records([*strategy_records, *data])


def load_verkoopstrategien() -> list[dict[str, Any]]:
    """Laadt alle jaargebonden verkoopstrategieen veilig in."""
    return [
        normalize_verkoopstrategie_record(record)
        for record in load_all_verkoop_records()
        if isinstance(record, dict)
        and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR
    ]


def get_verkoopstrategie_for_year(year: int | str) -> dict[str, Any] | None:
    """Geeft de verkoopstrategie terug voor een jaar."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    for record in load_verkoopstrategien():
        if int(record.get("jaar", 0) or 0) == year_value:
            return record
    return None


def load_verkoopstrategie_producten() -> list[dict[str, Any]]:
    """Laadt alle verkoopstrategieen op productniveau veilig in."""
    return [
        normalize_verkoopstrategie_product_record(record)
        for record in load_all_verkoop_records()
        if isinstance(record, dict)
        and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT
    ]


def load_verkoopstrategie_verpakkingen() -> list[dict[str, Any]]:
    """Laadt alle verkoopstrategieen op verpakkingstype veilig in."""
    return [
        normalize_verkoopstrategie_verpakking_record(record)
        for record in load_all_verkoop_records()
        if isinstance(record, dict)
        and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
    ]


def get_verkoopstrategie_verpakkingen_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft alle verpakkingsstrategieen voor een jaar terug."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return []

    return [
        record
        for record in load_verkoopstrategie_verpakkingen()
        if int(record.get("jaar", 0) or 0) == year_value
    ]


def duplicate_verkoopstrategie_verpakkingen_to_year(
    source_year: int | str,
    target_year: int | str,
    *,
    overwrite: bool = False,
) -> int:
    """Dupliceert verpakkingsstrategieen van bronjaar naar doeljaar."""
    try:
        source_year_value = int(source_year)
        target_year_value = int(target_year)
    except (TypeError, ValueError):
        return 0

    source_records = get_verkoopstrategie_verpakkingen_for_year(source_year_value)
    if not source_records:
        return 0

    target_records = {
        str(record.get("product_id", "") or "")
        or _normalize_verpakking_key(record.get("verpakking", "")): record
        for record in get_verkoopstrategie_verpakkingen_for_year(target_year_value)
    }

    copied = 0
    for record in source_records:
        record_identity = str(record.get("product_id", "") or "") or _normalize_verpakking_key(
            record.get("verpakking", "")
        )
        if record_identity in target_records and not overwrite:
            continue
        saved = add_or_update_verkoopstrategie_verpakking(
            {
                **record,
                "id": str(uuid4()),
                "jaar": target_year_value,
                "bron_jaar": int(record.get("jaar", source_year_value) or source_year_value),
                "bron_verkoopstrategie_id": str(record.get("id", "") or ""),
            }
        )
        if saved:
            copied += 1

    return copied


def get_verkoopstrategie_verpakking(
    year: int | str,
    verpakking: str,
    *,
    product_id: str = "",
) -> dict[str, Any] | None:
    """Geeft een verpakkingsstrategie terug voor een jaar en verpakkingstype."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    verpakking_value = _normalize_verpakking_key(verpakking)
    product_id_value = str(product_id or "")
    for record in load_verkoopstrategie_verpakkingen():
        if int(record.get("jaar", 0) or 0) != year_value:
            continue
        if product_id_value:
            if str(record.get("product_id", "") or "") != product_id_value:
                continue
        elif _normalize_verpakking_key(record.get("verpakking", "")) != verpakking_value:
            continue
        return record
    return None


def get_latest_verkoopstrategie_verpakking_up_to_year(
    year: int | str,
    verpakking: str,
    *,
    product_id: str = "",
) -> dict[str, Any] | None:
    """Geeft de meest recente verpakkingsstrategie terug tot en met een jaar."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    verpakking_value = _normalize_verpakking_key(verpakking)
    product_id_value = str(product_id or "")
    candidates = [
        record
        for record in load_verkoopstrategie_verpakkingen()
        if int(record.get("jaar", 0) or 0) <= year_value
        and (
            (product_id_value and str(record.get("product_id", "") or "") == product_id_value)
            or (
                not product_id_value
                and _normalize_verpakking_key(record.get("verpakking", "")) == verpakking_value
            )
        )
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda item: int(item.get("jaar", 0) or 0))


def get_verkoopstrategie_producten_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft alle productstrategieen voor een jaar terug."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return []

    return [
        record
        for record in load_verkoopstrategie_producten()
        if int(record.get("jaar", 0) or 0) == year_value
    ]


def get_verkoopstrategie_product(
    year: int | str,
    bier_id: str,
    product_id: str,
    *,
    only_override: bool = False,
) -> dict[str, Any] | None:
    """Geeft een productstrategie terug voor jaar, bier en product."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    bier_id_value = str(bier_id or "")
    product_id_value = str(product_id or "")
    for record in load_verkoopstrategie_producten():
        if int(record.get("jaar", 0) or 0) != year_value:
            continue
        if str(record.get("bier_id", "") or "") != bier_id_value:
            continue
        if str(record.get("product_id", "") or "") != product_id_value:
            continue
        if only_override and str(record.get("strategie_type", "") or "") != "uitzondering":
            continue
        return record
    return None


def get_latest_verkoopstrategie_product_up_to_year(
    year: int | str,
    bier_id: str,
    product_id: str,
    *,
    only_override: bool = False,
) -> dict[str, Any] | None:
    """Geeft de meest recente productstrategie terug tot en met een jaar."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    bier_id_value = str(bier_id or "")
    product_id_value = str(product_id or "")
    candidates = [
        record
        for record in load_verkoopstrategie_producten()
        if int(record.get("jaar", 0) or 0) <= year_value
        and str(record.get("bier_id", "") or "") == bier_id_value
        and str(record.get("product_id", "") or "") == product_id_value
        and (
            not only_override
            or str(record.get("strategie_type", "") or "") == "uitzondering"
        )
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda item: int(item.get("jaar", 0) or 0))


def get_effective_verkoopstrategie_for_product(
    year: int | str,
    bier_id: str,
    product_id: str,
    verpakking: str = "",
    product_type: str = "",
) -> dict[str, Any] | None:
    """Geeft de meest geschikte strategie voor een product, met fallback op jaarstrategie."""
    product_strategy = get_latest_verkoopstrategie_product_up_to_year(
        year,
        bier_id,
        product_id,
        only_override=True,
    )
    if product_strategy is not None:
        return product_strategy

    if verpakking:
        verpakking_strategy = get_latest_verkoopstrategie_verpakking_up_to_year(
            year,
            verpakking,
            product_id=product_id,
        )
        if verpakking_strategy is not None:
            return {
                **verpakking_strategy,
                "record_type": VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT,
                "bier_id": str(bier_id or ""),
                "product_id": str(product_id or verpakking_strategy.get("product_id", "") or ""),
                "product_type": str(product_type or verpakking_strategy.get("product_type", "") or ""),
                "verpakking": str(verpakking or verpakking_strategy.get("verpakking", "") or ""),
                "biernaam": "",
                "stijl": "",
                "kostprijs": 0.0,
                "kostprijs_per_liter": 0.0,
                "kanaalprijzen": {categorie: None for categorie in VERKOOPSTRATEGIE_CATEGORIEN},
                "bron_verkoopstrategie_id": str(verpakking_strategy.get("id", "") or ""),
            }

    year_strategy = get_latest_verkoopstrategie_up_to_year(year)
    if year_strategy is None:
        return None

    return {
        **year_strategy,
        "record_type": VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT,
        "bier_id": str(bier_id or ""),
        "product_id": str(product_id or ""),
        "product_type": str(product_type or ""),
        "verpakking": "",
        "biernaam": "",
        "stijl": "",
        "kostprijs": 0.0,
        "kostprijs_per_liter": 0.0,
        "kanaalprijzen": {categorie: None for categorie in VERKOOPSTRATEGIE_CATEGORIEN},
        "bron_verkoopstrategie_id": str(year_strategy.get("id", "") or ""),
    }


def get_latest_verkoopstrategie_up_to_year(year: int | str) -> dict[str, Any] | None:
    """Geeft de meest recente verkoopstrategie terug tot en met een jaar."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    candidates = [
        record
        for record in load_verkoopstrategien()
        if int(record.get("jaar", 0) or 0) <= year_value
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda item: int(item.get("jaar", 0) or 0))


def add_or_update_verkoopstrategie(record: dict[str, Any]) -> dict[str, Any] | None:
    """Voegt een verkoopstrategie toe of werkt die veilig bij op jaar."""
    records = _load_verkoopprijs_records()
    normalized_input = normalize_verkoopstrategie_record(record)
    jaar = int(normalized_input.get("jaar", 0) or 0)
    existing = next(
        (
            normalize_verkoopstrategie_record(item)
            for item in records
            if isinstance(item, dict)
            and str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR
            and int(item.get("jaar", 0) or 0) == jaar
        ),
        None,
    )

    normalized = normalize_verkoopstrategie_record(
        {
            **(existing or {}),
            **normalized_input,
            "id": str(
                (existing or {}).get("id", normalized_input.get("id", "")) or uuid4()
            ),
            "created_at": str(
                (existing or {}).get(
                    "created_at",
                    normalized_input.get("created_at", "") or _now_iso(),
                )
                or _now_iso()
            ),
            "updated_at": _now_iso(),
        }
    )

    filtered_records = [
        record
        for record in records
        if not (
            isinstance(record, dict)
            and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR
            and int(record.get("jaar", 0) or 0) == jaar
        )
    ]
    filtered_records.append(normalized)

    if _save_verkoop_records(filtered_records):
        return normalized
    return None


def delete_verkoopstrategie(verkoopstrategie_id: str) -> bool:
    """Verwijdert een verkoopstrategie-record op basis van id."""
    records = _load_verkoopprijs_records()
    filtered = [
        record
        for record in records
        if not (
            isinstance(record, dict)
            and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR
            and str(record.get("id", "") or "") == str(verkoopstrategie_id or "")
        )
    ]
    if len(filtered) == len(records):
        return False
    return _save_verkoop_records(filtered)


def add_or_update_verkoopstrategie_verpakking(record: dict[str, Any]) -> dict[str, Any] | None:
    """Voegt een verpakkingsstrategie toe of werkt die veilig bij op jaar en verpakking."""
    records = _load_verkoopprijs_records()
    normalized_input = normalize_verkoopstrategie_verpakking_record(record)
    jaar = int(normalized_input.get("jaar", 0) or 0)
    product_id = str(normalized_input.get("product_id", "") or "")
    verpakking = _normalize_verpakking_key(normalized_input.get("verpakking", ""))

    existing = next(
        (
            normalize_verkoopstrategie_verpakking_record(item)
            for item in records
            if isinstance(item, dict)
            and str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
            and int(item.get("jaar", 0) or 0) == jaar
            and (
                (product_id and str(item.get("product_id", "") or "") == product_id)
                or (
                    not product_id
                    and _normalize_verpakking_key(item.get("verpakking", "")) == verpakking
                )
            )
        ),
        None,
    )

    normalized = normalize_verkoopstrategie_verpakking_record(
        {
            **(existing or {}),
            **normalized_input,
            "id": str((existing or {}).get("id", normalized_input.get("id", "")) or uuid4()),
            "created_at": str(
                (existing or {}).get(
                    "created_at",
                    normalized_input.get("created_at", "") or _now_iso(),
                )
                or _now_iso()
            ),
            "updated_at": _now_iso(),
        }
    )

    filtered_records = [
        item
        for item in records
        if not (
            isinstance(item, dict)
            and str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
            and int(item.get("jaar", 0) or 0) == jaar
            and (
                (product_id and str(item.get("product_id", "") or "") == product_id)
                or (
                    not product_id
                    and _normalize_verpakking_key(item.get("verpakking", "")) == verpakking
                )
            )
        )
    ]
    filtered_records.append(normalized)

    if _save_verkoop_records(filtered_records):
        return normalized
    return None


def delete_verkoopstrategie_verpakking(verkoopstrategie_id: str) -> bool:
    """Verwijdert een verpakkingsstrategie-record op basis van id."""
    records = _load_verkoopprijs_records()
    filtered = [
        record
        for record in records
        if not (
            isinstance(record, dict)
            and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
            and str(record.get("id", "") or "") == str(verkoopstrategie_id or "")
        )
    ]
    if len(filtered) == len(records):
        return False
    return _save_verkoop_records(filtered)


def add_or_update_verkoopstrategie_product(record: dict[str, Any]) -> dict[str, Any] | None:
    """Voegt een productstrategie toe of werkt die veilig bij op jaar, bier en product."""
    records = _load_verkoopprijs_records()
    normalized_input = normalize_verkoopstrategie_product_record(record)
    jaar = int(normalized_input.get("jaar", 0) or 0)
    bier_id = str(normalized_input.get("bier_id", "") or "")
    product_id = str(normalized_input.get("product_id", "") or "")

    existing = next(
        (
            normalize_verkoopstrategie_product_record(item)
            for item in records
            if isinstance(item, dict)
            and str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT
            and int(item.get("jaar", 0) or 0) == jaar
            and str(item.get("bier_id", "") or "") == bier_id
            and str(item.get("product_id", "") or "") == product_id
        ),
        None,
    )

    normalized = normalize_verkoopstrategie_product_record(
        {
            **(existing or {}),
            **normalized_input,
            "id": str(
                (existing or {}).get("id", normalized_input.get("id", "")) or uuid4()
            ),
            "created_at": str(
                (existing or {}).get(
                    "created_at",
                    normalized_input.get("created_at", "") or _now_iso(),
                )
                or _now_iso()
            ),
            "updated_at": _now_iso(),
        }
    )

    filtered_records = [
        item
        for item in records
        if not (
            isinstance(item, dict)
            and str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT
            and int(item.get("jaar", 0) or 0) == jaar
            and str(item.get("bier_id", "") or "") == bier_id
            and str(item.get("product_id", "") or "") == product_id
        )
    ]
    filtered_records.append(normalized)

    if _save_verkoop_records(filtered_records):
        return normalized
    return None


def delete_verkoopstrategie_product(verkoopstrategie_id: str) -> bool:
    """Verwijdert een productstrategie-record op basis van id."""
    records = _load_verkoopprijs_records()
    filtered = [
        record
        for record in records
        if not (
            isinstance(record, dict)
            and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT
            and str(record.get("id", "") or "") == str(verkoopstrategie_id or "")
        )
    ]
    if len(filtered) == len(records):
        return False
    if not _save_verkoop_records(filtered):
        return False
    cleanup_unused_bieren()
    return True


def normalize_prijsvoorstel_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een prijsvoorstelrecord voor opslag en UI."""

    def _float_value(value: Any) -> float:
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0

    status = str(record.get("status", "concept") or "concept").strip().lower()
    if status not in {"concept", "definitief"}:
        status = "concept"

    def _normalize_channel(value: Any) -> str:
        return str(value or "").strip().lower()

    staffels_source = record.get("staffels", [])
    if not isinstance(staffels_source, list):
        staffels_source = []
    staffels: list[dict[str, Any]] = []
    for row in staffels_source:
        if not isinstance(row, dict):
            continue
        staffels.append(
            {
                "id": str(row.get("id", "") or uuid4()),
                "product_id": str(row.get("product_id", "") or ""),
                "product_type": str(row.get("product_type", "") or ""),
                "liters": _float_value(row.get("liters")),
                "korting_pct": _float_value(row.get("korting_pct")),
            }
        )

    product_rows_source = record.get("product_rows", [])
    if not isinstance(product_rows_source, list):
        product_rows_source = []
    product_rows: list[dict[str, Any]] = []
    for row in product_rows_source:
        if not isinstance(row, dict):
            continue
        product_rows.append(
            {
                "id": str(row.get("id", "") or uuid4()),
                "bier_id": str(row.get("bier_id", "") or ""),
                "kostprijsversie_id": str(row.get("kostprijsversie_id", "") or ""),
                "product_id": str(row.get("product_id", "") or ""),
                "product_type": str(row.get("product_type", "") or ""),
                "verpakking_label": str(row.get("verpakking_label", "") or ""),
                "aantal": _float_value(row.get("aantal")),
                "korting_pct": _float_value(row.get("korting_pct")),
                "included": bool(row.get("included", True)),
                "cost_at_quote": _float_value(row.get("cost_at_quote")),
                "sales_price_at_quote": _float_value(row.get("sales_price_at_quote")),
                "revenue_at_quote": _float_value(row.get("revenue_at_quote")),
                "margin_at_quote": _float_value(row.get("margin_at_quote")),
                "target_margin_pct_at_quote": _float_value(row.get("target_margin_pct_at_quote")),
                "channel_at_quote": str(row.get("channel_at_quote", "") or ""),
            }
        )

    beer_rows_source = record.get("beer_rows", [])
    if not isinstance(beer_rows_source, list):
        beer_rows_source = []
    beer_rows: list[dict[str, Any]] = []
    for row in beer_rows_source:
        if not isinstance(row, dict):
            continue
        beer_rows.append(
            {
                "id": str(row.get("id", "") or uuid4()),
                "bier_id": str(row.get("bier_id", "") or ""),
                "kostprijsversie_id": str(row.get("kostprijsversie_id", "") or ""),
                "product_id": str(row.get("product_id", "") or ""),
                "product_type": str(row.get("product_type", "") or ""),
                "liters": _float_value(row.get("liters")),
                "korting_pct": _float_value(row.get("korting_pct")),
                "included": bool(row.get("included", True)),
                "verpakking_label": str(row.get("verpakking_label", "") or ""),
                "cost_at_quote": _float_value(row.get("cost_at_quote")),
                "sales_price_at_quote": _float_value(row.get("sales_price_at_quote")),
                "revenue_at_quote": _float_value(row.get("revenue_at_quote")),
                "margin_at_quote": _float_value(row.get("margin_at_quote")),
                "target_margin_pct_at_quote": _float_value(row.get("target_margin_pct_at_quote")),
                "channel_at_quote": str(row.get("channel_at_quote", "") or ""),
            }
        )

    catalog_product_rows_source = record.get("catalog_product_rows", [])
    if not isinstance(catalog_product_rows_source, list):
        catalog_product_rows_source = []
    catalog_product_rows: list[dict[str, Any]] = []
    for row in catalog_product_rows_source:
        if not isinstance(row, dict):
            continue
        catalog_product_rows.append(
            {
                "id": str(row.get("id", "") or uuid4()),
                "catalog_product_id": str(row.get("catalog_product_id", "") or ""),
                "naam": str(row.get("naam", "") or ""),
                "aantal": _float_value(row.get("aantal")),
                "korting_pct": _float_value(row.get("korting_pct")),
                "included": bool(row.get("included", True)),
                "cost_at_quote": _float_value(row.get("cost_at_quote")),
                "sales_price_at_quote": _float_value(row.get("sales_price_at_quote")),
                "revenue_at_quote": _float_value(row.get("revenue_at_quote")),
                "margin_at_quote": _float_value(row.get("margin_at_quote")),
                "target_margin_pct_at_quote": _float_value(row.get("target_margin_pct_at_quote")),
                "channel_at_quote": str(row.get("channel_at_quote", "") or ""),
            }
        )

    selected_bier_ids_source = record.get("selected_bier_ids", [])
    if not isinstance(selected_bier_ids_source, list):
        selected_bier_ids_source = []
    selected_bier_ids = [
        str(value or "")
        for value in selected_bier_ids_source
        if str(value or "").strip()
    ]

    selected_catalog_product_ids_source = record.get("selected_catalog_product_ids", [])
    if not isinstance(selected_catalog_product_ids_source, list):
        selected_catalog_product_ids_source = []
    selected_catalog_product_ids = [
        str(value or "")
        for value in selected_catalog_product_ids_source
        if str(value or "").strip()
    ]
    selected_kanalen_source = record.get("selected_kanalen", [])
    if not isinstance(selected_kanalen_source, list):
        selected_kanalen_source = []
    selected_kanalen = [
        str(value or "")
        for value in selected_kanalen_source
        if str(value or "").strip()
    ]
    reference_channels_source = record.get("reference_channels", [])
    if not isinstance(reference_channels_source, list):
        reference_channels_source = []
    reference_channels = [
        str(value or "")
        for value in reference_channels_source
        if str(value or "").strip()
    ]
    kostprijsversie_ids_source = record.get("kostprijsversie_ids", [])
    if not isinstance(kostprijsversie_ids_source, list):
        kostprijsversie_ids_source = []
    kostprijsversie_ids = [
        str(value or "")
        for value in kostprijsversie_ids_source
        if str(value or "").strip()
    ]

    deleted_product_refs_source = record.get("deleted_product_refs", [])
    if not isinstance(deleted_product_refs_source, list):
        deleted_product_refs_source = []
    deleted_product_refs: list[dict[str, Any]] = []
    for item in deleted_product_refs_source:
        if not isinstance(item, dict):
            continue
        bier_id = str(item.get("bier_id", "") or "")
        product_id = str(item.get("product_id", "") or "")
        if bier_id and product_id:
            deleted_product_refs.append(
                {
                    "bier_id": bier_id,
                    "product_id": product_id,
                }
            )

    created_at = str(record.get("created_at", "") or "") or _now_iso()
    updated_at = str(record.get("updated_at", "") or "") or created_at
    finalized_at = str(record.get("finalized_at", "") or "")
    if status != "definitief":
        finalized_at = ""

    try:
        year_value = int(record.get("jaar", 0) or 0)
    except (TypeError, ValueError):
        year_value = 0
    if year_value <= 0:
        # Derive from linked kostprijsversies when possible; otherwise default to current year.
        version_ids = {
            str(row.get("kostprijsversie_id", "") or "")
            for row in [*product_rows, *beer_rows]
            if isinstance(row, dict) and str(row.get("kostprijsversie_id", "") or "").strip()
        }
        for version in load_kostprijsversies():
            if not isinstance(version, dict):
                continue
            if str(version.get("id", "") or "") not in version_ids:
                continue
            basisgegevens = version.get("basisgegevens", {})
            try:
                inferred = int(version.get("jaar", (basisgegevens or {}).get("jaar", 0)) or 0)
            except (TypeError, ValueError, AttributeError):
                inferred = 0
            if inferred > 0:
                year_value = inferred
                break
    if year_value <= 0:
        year_value = datetime.now().year

    kanaal_value = _normalize_channel(record.get("kanaal", ""))
    pricing_channel_value = _normalize_channel(record.get("pricing_channel", ""))
    if not kanaal_value:
        kanaal_value = "horeca"
    if not pricing_channel_value:
        pricing_channel_value = kanaal_value

    verloopt_op = str(record.get("verloopt_op", "") or record.get("expires_at", "") or "").strip()

    return {
        "id": str(record.get("id", "") or uuid4()),
        "offertenummer": str(record.get("offertenummer", "") or ""),
        "status": status,
        "klantnaam": str(record.get("klantnaam", "") or ""),
        "contactpersoon": str(record.get("contactpersoon", "") or ""),
        "referentie": str(record.get("referentie", "") or ""),
        "datum_text": str(record.get("datum_text", "") or ""),
        "verloopt_op": verloopt_op,
        "opmerking": str(record.get("opmerking", "") or ""),
        "jaar": year_value,
        "voorsteltype": str(record.get("voorsteltype", "") or ""),
        "liters_basis": str(record.get("liters_basis", "een_bier") or "een_bier"),
        "kanaal": kanaal_value,
        "selected_kanalen": selected_kanalen,
        "pricing_channel": pricing_channel_value,
        "reference_channels": reference_channels,
        "pricing_method": str(record.get("pricing_method", "sell_in") or "sell_in"),
        "groothandel_marge_pct": _float_value(record.get("groothandel_marge_pct")),
        "offer_level": str(record.get("offer_level", "samengesteld") or "samengesteld"),
        "bier_id": str(record.get("bier_id", "") or ""),
        "selected_bier_ids": selected_bier_ids,
        "selected_catalog_product_ids": selected_catalog_product_ids,
        "kostprijsversie_ids": kostprijsversie_ids,
        "deleted_product_refs": deleted_product_refs,
        "staffels": staffels,
        "product_rows": product_rows,
        "beer_rows": beer_rows,
        "catalog_product_rows": catalog_product_rows,
        "last_step": int(record.get("last_step", 1) or 1),
        "created_at": created_at,
        "updated_at": updated_at,
        "finalized_at": finalized_at,
    }


def _prijsvoorstel_prefix(now: datetime | None = None) -> str:
    current = now or datetime.now()
    return current.strftime("%Y%m")


def _extract_offertenummer_seq(offertenummer: str, prefix: str) -> int | None:
    value = str(offertenummer or "").strip()
    if not value.startswith(prefix):
        return None
    suffix = value[len(prefix) :]
    if len(suffix) != 3 or not suffix.isdigit():
        return None
    return int(suffix)


def _assign_missing_offertenummers(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prefix = _prijsvoorstel_prefix()
    used_sequences = {
        seq
        for seq in (
            _extract_offertenummer_seq(str(record.get("offertenummer", "") or ""), prefix)
            for record in records
        )
        if seq is not None
    }
    next_sequence = max(used_sequences, default=0) + 1

    def _sort_key(record: dict[str, Any]) -> tuple[int, str, str, str]:
        status = str(record.get("status", "") or "")
        status_order = 0 if status == "definitief" else 1
        return (
            status_order,
            str(record.get("created_at", "") or ""),
            str(record.get("updated_at", "") or ""),
            str(record.get("id", "") or ""),
        )

    normalized_records: list[dict[str, Any]] = []
    for record in sorted(records, key=_sort_key):
        normalized = normalize_prijsvoorstel_record(record)
        if not str(normalized.get("offertenummer", "") or "").strip():
            while next_sequence in used_sequences:
                next_sequence += 1
            normalized["offertenummer"] = f"{prefix}{next_sequence:03d}"
            used_sequences.add(next_sequence)
            next_sequence += 1
        normalized_records.append(normalized)
    return normalized_records


def _validate_prijsvoorstel_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    known_bieren = _known_bier_ids()
    known_versions = _known_kostprijsversie_ids()
    known_products = _known_product_refs()

    def _valid_product_ref(product_id: str, product_type: str) -> bool:
        product_id = str(product_id or "").strip()
        if not product_id:
            return True
        return (product_id, str(product_type or "").strip().lower()) in known_products

    validated: list[dict[str, Any]] = []
    for record in records:
        normalized = normalize_prijsvoorstel_record(record)
        normalized["selected_bier_ids"] = [
            bier_id
            for bier_id in normalized.get("selected_bier_ids", [])
            if bier_id in known_bieren
        ]
        normalized["kostprijsversie_ids"] = [
            version_id
            for version_id in normalized.get("kostprijsversie_ids", [])
            if version_id in known_versions
        ]
        if str(normalized.get("bier_id", "") or "") not in known_bieren:
            normalized["bier_id"] = ""

        cleaned_product_rows: list[dict[str, Any]] = []
        for row in normalized.get("product_rows", []):
            bier_id = str(row.get("bier_id", "") or "")
            version_id = str(row.get("kostprijsversie_id", "") or "")
            if bier_id and bier_id not in known_bieren:
                continue
            if version_id and version_id not in known_versions:
                continue
            if not _valid_product_ref(row.get("product_id", ""), row.get("product_type", "")):
                continue
            cleaned_product_rows.append(row)
        normalized["product_rows"] = cleaned_product_rows

        cleaned_beer_rows: list[dict[str, Any]] = []
        for row in normalized.get("beer_rows", []):
            bier_id = str(row.get("bier_id", "") or "")
            version_id = str(row.get("kostprijsversie_id", "") or "")
            if bier_id and bier_id not in known_bieren:
                continue
            if version_id and version_id not in known_versions:
                continue
            if not _valid_product_ref(row.get("product_id", ""), row.get("product_type", "")):
                continue
            cleaned_beer_rows.append(row)
        normalized["beer_rows"] = cleaned_beer_rows

        validated.append(normalized)

    return validated


def get_next_prijsvoorstel_offertenummer() -> str:
    prefix = _prijsvoorstel_prefix()
    next_sequence = max(
        (
            _extract_offertenummer_seq(str(record.get("offertenummer", "") or ""), prefix) or 0
            for record in load_prijsvoorstellen()
        ),
        default=0,
    ) + 1
    return f"{prefix}{next_sequence:03d}"


def load_prijsvoorstellen() -> list[dict[str, Any]]:
    """Laadt alle prijsvoorstellen veilig in."""
    postgres_payload = _load_postgres_dataset("prijsvoorstellen")
    if isinstance(postgres_payload, list):
        data = postgres_payload
    else:
        data = []
    if not isinstance(data, list):
        return []
    normalized = _validate_prijsvoorstel_records(
        [record for record in data if isinstance(record, dict)]
    )
    if any(not str(record.get("offertenummer", "") or "").strip() for record in normalized):
        normalized = _assign_missing_offertenummers(normalized)
    return normalized


def save_prijsvoorstellen(data: list[dict[str, Any]]) -> bool:
    """Slaat alle prijsvoorstellen veilig op."""
    normalized = _validate_prijsvoorstel_records(
        [record for record in data if isinstance(record, dict)]
    )
    normalized = _assign_missing_offertenummers(normalized)
    normalized = sorted(
        normalized,
        key=lambda item: (
            0 if str(item.get("status", "") or "") == "concept" else 1,
            str(item.get("updated_at", "") or ""),
        ),
        reverse=True,
    )
    return _save_postgres_dataset("prijsvoorstellen", normalized)


def get_prijsvoorstel_by_id(prijsvoorstel_id: str) -> dict[str, Any] | None:
    """Geeft een prijsvoorstel terug op basis van id."""
    target_id = str(prijsvoorstel_id or "")
    for record in load_prijsvoorstellen():
        if str(record.get("id", "") or "") == target_id:
            return record
    return None


def add_or_update_prijsvoorstel(record: dict[str, Any]) -> dict[str, Any] | None:
    """Voegt een prijsvoorstel toe of werkt een bestaand voorstel bij."""
    records = load_prijsvoorstellen()
    normalized_input = normalize_prijsvoorstel_record(record)
    record_id = str(normalized_input.get("id", "") or uuid4())
    existing = next(
        (
            item for item in records
            if str(item.get("id", "") or "") == record_id
        ),
        None,
    )

    normalized = normalize_prijsvoorstel_record(
        {
            **(existing or {}),
            **normalized_input,
            "id": record_id,
            "offertenummer": str(
                (existing or {}).get("offertenummer", normalized_input.get("offertenummer", "") or "")
            ),
            "created_at": str(
                (existing or {}).get("created_at", normalized_input.get("created_at", "") or _now_iso())
                or _now_iso()
            ),
            "updated_at": _now_iso(),
        }
    )

    updated = False
    for index, item in enumerate(records):
        if str(item.get("id", "") or "") != record_id:
            continue
        records[index] = normalized
        updated = True
        break

    if not updated:
        records.append(normalized)

    if save_prijsvoorstellen(records):
        return normalized
    return None


def save_prijsvoorstel_as_concept(record: dict[str, Any]) -> dict[str, Any] | None:
    """Slaat een prijsvoorstel op als concept."""
    return add_or_update_prijsvoorstel(
        {
            **record,
            "status": "concept",
            "finalized_at": "",
        }
    )


def finalize_prijsvoorstel(record: dict[str, Any]) -> dict[str, Any] | None:
    """Slaat een prijsvoorstel op als definitief."""
    return add_or_update_prijsvoorstel(
        {
            **record,
            "status": "definitief",
            "finalized_at": _now_iso(),
        }
    )


def delete_prijsvoorstel(prijsvoorstel_id: str) -> bool:
    """Verwijdert een prijsvoorstelrecord op basis van id."""
    records = load_prijsvoorstellen()
    filtered = [
        record
        for record in records
        if str(record.get("id", "") or "") != str(prijsvoorstel_id or "")
    ]
    if len(filtered) == len(records):
        return False
    if not save_prijsvoorstellen(filtered):
        return False
    cleanup_unused_bieren()
    return True


def get_concept_prijsvoorstellen() -> list[dict[str, Any]]:
    """Geeft alle conceptvoorstellen terug."""
    return [
        record
        for record in load_prijsvoorstellen()
        if str(record.get("status", "") or "") == "concept"
    ]


def get_definitieve_prijsvoorstellen() -> list[dict[str, Any]]:
    """Geeft alle definitieve prijsvoorstellen terug."""
    return [
        record
        for record in load_prijsvoorstellen()
        if str(record.get("status", "") or "") == "definitief"
    ]


def get_verkoopprijs_by_bierjaar(
    bier_id: str,
    year: int | str,
    product_id: str = "",
) -> dict[str, Any] | None:
    """Geeft een verkoopprijsrecord terug voor een bier, jaar en optioneel verkoopartikel."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    bier_id_value = str(bier_id or "")
    product_id_value = str(product_id or "")
    for record in load_verkoopprijzen():
        if str(record.get("bier_id", "") or "") != bier_id_value:
            continue
        if int(record.get("jaar", 0) or 0) != year_value:
            continue
        if product_id_value and str(record.get("product_id", "") or "") != product_id_value:
            continue
        return record
    return None


def add_or_update_verkoopprijs(record: dict[str, Any]) -> dict[str, Any] | None:
    """Voegt een verkoopprijs toe of werkt die veilig bij op bier en jaar."""
    records = load_verkoopprijzen()
    normalized_input = normalize_verkoopprijs_record(record)
    bier_id = str(normalized_input.get("bier_id", "") or "")
    jaar = int(normalized_input.get("jaar", 0) or 0)
    product_id = str(normalized_input.get("product_id", "") or "")
    existing = next(
        (
            item
            for item in records
            if str(item.get("bier_id", "") or "") == bier_id
            and int(item.get("jaar", 0) or 0) == jaar
            and str(item.get("product_id", "") or "") == product_id
        ),
        None,
    )

    normalized = normalize_verkoopprijs_record(
        {
            **(existing or {}),
            **normalized_input,
            "id": str(
                (existing or {}).get("id", normalized_input.get("id", "")) or uuid4()
            ),
            "created_at": str(
                (existing or {}).get(
                    "created_at",
                    normalized_input.get("created_at", "") or _now_iso(),
                )
                or _now_iso()
            ),
            "updated_at": _now_iso(),
        }
    )

    updated = False
    for index, item in enumerate(records):
        if str(item.get("id", "") or "") != str(normalized.get("id", "") or ""):
            continue
        records[index] = normalized
        updated = True
        break

    if not updated:
        records.append(normalized)

    if save_verkoopprijzen(records):
        return normalized
    return None


def delete_verkoopprijs(verkoopprijs_id: str) -> bool:
    """Verwijdert een verkoopprijsrecord op basis van id."""
    records = load_verkoopprijzen()
    filtered = [
        record
        for record in records
        if str(record.get("id", "") or "") != str(verkoopprijs_id or "")
    ]
    if len(filtered) == len(records):
        return False
    if not save_verkoopprijzen(filtered):
        return False
    cleanup_unused_bieren()
    return True


def get_verkoopprijzen_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft alle verkoopprijzen voor een jaar terug."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return []

    return [
        record
        for record in load_verkoopprijzen()
        if int(record.get("jaar", 0) or 0) == year_value
    ]


def save_berekeningen(data: list[dict[str, Any]]) -> bool:
    """Compatibele wrapper: slaat berekeningen als kostprijsversies op."""
    return save_kostprijsversies(data)


def save_kostprijsversies(data: list[dict[str, Any]]) -> bool:
    """Slaat alle kostprijsversies veilig op."""
    # Never drop "concept" records implicitly.
    #
    # Historically we filtered out records without "meaningful" content to keep JSON storage tidy.
    # With Postgres-first storage and explicit delete actions in the UI, dropping records on save
    # causes surprising data loss (e.g. new concept versions disappearing after Save).
    cleaned_data = [record for record in data if isinstance(record, dict)]

    def _persist() -> bool:
        # Phase E: ensure definitive kostprijsversies are linked to canonical bierstamdata.
        # We do this on write, not on read, to avoid hidden side effects and "disappearing fields".
        bieren = load_bieren()
        bieren_by_id = {str(bier.get("id", "") or ""): bier for bier in bieren if isinstance(bier, dict)}
        bieren_by_name = {
            str(bier.get("biernaam", "") or "").strip().lower(): bier
            for bier in bieren
            if isinstance(bier, dict) and str(bier.get("biernaam", "") or "").strip()
        }
        bieren_changed = False

        for record in cleaned_data:
            try:
                status = str(record.get("status", "") or "").strip().lower()
            except Exception:
                status = ""
            if status != "definitief":
                continue
            record_cost_type = str(record.get("type", "") or "").strip().lower()
            bier_id = str(record.get("bier_id", "") or "").strip()
            basisgegevens = record.get("basisgegevens", {})
            if not isinstance(basisgegevens, dict):
                basisgegevens = {}
            # SKU-aanpak: articles/bundles are not beers and must not create/link bierstamdata.
            is_article_cost = bool(str(basisgegevens.get("article_id", "") or "").strip()) or record_cost_type in {"bundle", "article"}
            if is_article_cost:
                continue
            biernaam = str(basisgegevens.get("biernaam", "") or "").strip()
            stijl = str(basisgegevens.get("stijl", "") or "").strip()
            alcoholpercentage = float(basisgegevens.get("alcoholpercentage", 0.0) or 0.0)
            belastingsoort = str(
                basisgegevens.get("belastingsoort", DEFAULT_BELASTINGSOORT) or DEFAULT_BELASTINGSOORT
            )
            tarief_accijns = str(
                basisgegevens.get("tarief_accijns", DEFAULT_TARIEF_ACCIJNS) or DEFAULT_TARIEF_ACCIJNS
            )
            btw_tarief = str(basisgegevens.get("btw_tarief", DEFAULT_BTW_TARIEF) or DEFAULT_BTW_TARIEF)

            existing_bier = bieren_by_id.get(bier_id) if bier_id else None
            if existing_bier is None and biernaam and biernaam.lower() in bieren_by_name:
                existing_bier = bieren_by_name[biernaam.lower()]
                record["bier_id"] = str(existing_bier.get("id", "") or "")

            if not biernaam:
                # Fail hard: a definitive record must be attributable to a beer.
                raise ValueError("Definitieve kostprijsversie mist biernaam (basisgegevens.biernaam).")
            if existing_bier is None:
                # Create the beer explicitly from the definitive basisgegevens snapshot.
                #
                # Important: if the kostprijsversie already has a bier_id, we preserve it to keep
                # referential integrity stable across activations and other datasets. This also
                # prevents "unknown_bier" errors when auto-activating products for definitive records.
                if bier_id:
                    created_at = _now_iso()
                    new_bier = normalize_bier_record(
                        {
                            "id": bier_id,
                            "biernaam": biernaam,
                            "stijl": stijl,
                            "alcoholpercentage": alcoholpercentage,
                            "belastingsoort": belastingsoort,
                            "tarief_accijns": tarief_accijns,
                            "btw_tarief": btw_tarief,
                            "created_at": created_at,
                            "updated_at": created_at,
                        }
                    )
                    bieren.append(new_bier)
                    if not save_bieren(bieren):
                        raise ValueError("Kon bierstamdata niet aanmaken voor definitieve kostprijsversie.")
                    record["bier_id"] = bier_id
                    bieren_by_id[bier_id] = new_bier
                    bieren_by_name[biernaam.lower()] = new_bier
                    continue

                new_bier = add_bier(
                    biernaam=biernaam,
                    stijl=stijl,
                    alcoholpercentage=alcoholpercentage,
                    belastingsoort=belastingsoort,
                    tarief_accijns=tarief_accijns,
                    btw_tarief=btw_tarief,
                )
                if not isinstance(new_bier, dict) or not str(new_bier.get("id", "") or "").strip():
                    raise ValueError("Kon bierstamdata niet aanmaken voor definitieve kostprijsversie.")
                record["bier_id"] = str(new_bier.get("id", "") or "")
                bieren_by_id[str(new_bier.get("id", "") or "")] = new_bier
                bieren_by_name[biernaam.lower()] = new_bier
                continue

            updated_bier = normalize_bier_record(
                {
                    **existing_bier,
                    "biernaam": biernaam,
                    "stijl": stijl,
                    "alcoholpercentage": alcoholpercentage,
                    "belastingsoort": belastingsoort,
                    "tarief_accijns": tarief_accijns,
                    "btw_tarief": btw_tarief,
                    "updated_at": _now_iso(),
                }
            )
            if updated_bier != existing_bier:
                for index, bier in enumerate(bieren):
                    if str(bier.get("id", "") or "") == str(updated_bier.get("id", "") or ""):
                        bieren[index] = updated_bier
                        break
                bieren_by_id[str(updated_bier.get("id", "") or "")] = updated_bier
                bieren_by_name[biernaam.lower()] = updated_bier
                bieren_changed = True

        if bieren_changed and not save_bieren(bieren):
            raise ValueError("Kon bierstamdata niet bijwerken vanuit definitieve kostprijsversie.")

        # Prevent implicit destructive deletes: hard delete is only allowed for concept records
        # that are not referenced anywhere. Definitive/active versions must be deactivated instead.
        incoming_ids = {
            str(record.get("id", "") or "").strip()
            for record in cleaned_data
            if isinstance(record, dict) and str(record.get("id", "") or "").strip()
        }
        # Only validate potentially removed records. During migrations we rewrite in-place, and
        # loading/normalizing every record can fail on the very issues the migration is fixing.
        existing_rows = _load_postgres_dataset("kostprijsversies")
        existing_rows_list = existing_rows if isinstance(existing_rows, list) else []
        existing_ids = {
            str(record.get("id", "") or "").strip()
            for record in existing_rows_list
            if isinstance(record, dict) and str(record.get("id", "") or "").strip()
        }
        previous_status_by_id: dict[str, str] = {
            str(record.get("id", "") or "").strip(): str(record.get("status", "") or "").strip().lower()
            for record in existing_rows_list
            if isinstance(record, dict) and str(record.get("id", "") or "").strip()
        }
        removed_ids = existing_ids - incoming_ids
        if removed_ids:
            raw_by_id = {
                str(record.get("id", "") or "").strip(): record
                for record in existing_rows_list
                if isinstance(record, dict) and str(record.get("id", "") or "").strip()
            }
            removed_existing_by_id: dict[str, dict[str, Any]] = {}
            for version_id in removed_ids:
                raw = raw_by_id.get(version_id)
                if not raw:
                    continue
                try:
                    removed_existing_by_id[version_id] = normalize_berekening_record(raw)
                except ValueError as exc:
                    raise ValueError(
                        "Kan kostprijsversies niet verwijderen zolang bestaande data ongeldig is. "
                        "Draai eerst de admin migratie: POST /api/meta/migrate-product-ids."
                    ) from exc
            referenced_ids = _collect_referenced_kostprijsversie_ids()
            for version_id in removed_ids:
                existing = removed_existing_by_id.get(version_id)
                if not existing:
                    continue
                status = str(existing.get("status", "") or "").strip().lower()
                if status == "definitief":
                    raise ValueError(
                        "Je kunt geen definitieve kostprijsversie verwijderen. "
                        "Deactiveer eerst of activeer een andere versie."
                    )
                if version_id in referenced_ids:
                    raise ValueError(
                        "Je kunt deze kostprijsversie niet verwijderen omdat hij nog gebruikt wordt "
                        "(bijv. actieve productkostprijzen of prijsvoorstellen)."
                    )
        normalized_records, _ = _normalize_and_sync_kostprijsversie_state(cleaned_data)
        saved = bool(_save_postgres_dataset("kostprijsversies", normalized_records))
        if not saved:
            return False

        # SKU-aanpak: activaties zijn expliciet en worden nooit automatisch aangemaakt bij opslaan.
        # Definitieve kostprijsversies worden pas "quoteable" na een expliciete activate call.

        return True

    postgres_storage = _get_postgres_storage_module()
    if postgres_storage is not None and postgres_storage.uses_postgres():
        # Ensure all reads/writes (bieren + kostprijsversies + activations) see each other
        # consistently within one request and commit/rollback atomically.
        with postgres_storage.transaction():
            return _persist()

    return _persist()


def _collect_referenced_kostprijsversie_ids() -> set[str]:
    referenced: set[str] = set()
    for activation in load_kostprijsproductactiveringen():
        if not isinstance(activation, dict):
            continue
        version_id = str(activation.get("kostprijsversie_id", "") or "").strip()
        if version_id:
            referenced.add(version_id)

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key in {"kostprijsversie_id", "cost_version_id"}:
                    child_id = str(child or "").strip()
                    if child_id:
                        referenced.add(child_id)
                elif key == "kostprijsversie_ids" and isinstance(child, list):
                    for item in child:
                        item_id = str(item or "").strip()
                        if item_id:
                            referenced.add(item_id)
                else:
                    walk(child)
            return
        if isinstance(value, list):
            for item in value:
                walk(item)

    for voorstel in load_prijsvoorstellen():
        walk(voorstel)

    return referenced


def create_empty_berekening() -> dict[str, Any]:
    """Maakt een lege kostprijsversie aan met veilige defaults."""
    return normalize_berekening_record(
        {
            "id": str(uuid4()),
            "bier_id": "",
            "jaar": 0,
            "versie_nummer": 0,
            "type": "productie",
            "kostprijs": 0.0,
            "brontype": "stam",
            "bron_id": "",
            "effectief_vanaf": "",
            "is_actief": False,
            "record_type": "kostprijsberekening",
            "calculation_variant": "origineel",
            "bron_berekening_id": "",
            "hercalculatie_reden": "",
            "hercalculatie_notitie": "",
            "hercalculatie_timestamp": "",
            "hercalculatie_basis": {
                "ingredienten_regels": [],
            },
            "status": "concept",
            "basisgegevens": {
                "jaar": 0,
                "biernaam": "",
                "stijl": "",
                "alcoholpercentage": 0.0,
                "belastingsoort": DEFAULT_BELASTINGSOORT,
                "tarief_accijns": DEFAULT_TARIEF_ACCIJNS,
                "btw_tarief": DEFAULT_BTW_TARIEF,
            },
            "soort_berekening": {
                "type": "Eigen productie",
            },
            "invoer": {
                "ingredienten": {
                    "regels": [],
                    "notities": "",
                },
                "inkoop": {
                    "regels": [],
                    "factuurregels": [],
                    "factuurdatum": "",
                    "notities": "",
                    "verzendkosten": 0.0,
                    "overige_kosten": 0.0,
                    "facturen": [
                        {
                            "id": str(uuid4()),
                            "factuurdatum": "",
                            "verzendkosten": 0.0,
                            "overige_kosten": 0.0,
                            "factuurregels": [],
                        }
                    ],
                },
            },
            "bier_snapshot": {
                "biernaam": "",
                "stijl": "",
                "alcoholpercentage": 0.0,
                "belastingsoort": DEFAULT_BELASTINGSOORT,
                "tarief_accijns": DEFAULT_TARIEF_ACCIJNS,
                "btw_tarief": DEFAULT_BTW_TARIEF,
            },
            "resultaat_snapshot": {},
            "last_completed_step": 1,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "aangemaakt_op": _now_iso(),
            "aangepast_op": _now_iso(),
            "finalized_at": "",
        }
    )


def create_recalculatie_from_berekening(
    source_record: dict[str, Any],
    *,
    reason: str = "Hercalculatie",
) -> dict[str, Any]:
    """Maakt een nieuwe concept-hercalculatie op basis van een bestaande kostprijsversie."""
    cloned = deepcopy(source_record if isinstance(source_record, dict) else {})
    cloned["id"] = str(uuid4())
    cloned["status"] = "concept"
    cloned["record_type"] = "kostprijsberekening"
    cloned["calculation_variant"] = "hercalculatie"
    cloned["bron_berekening_id"] = str(source_record.get("id", "") or "")
    cloned["bron_id"] = str(source_record.get("id", "") or "")
    cloned["brontype"] = "hercalculatie"
    cloned["versie_nummer"] = 0
    cloned["is_actief"] = False
    cloned["effectief_vanaf"] = ""
    cloned["hercalculatie_reden"] = str(reason or "Hercalculatie")
    cloned["hercalculatie_notitie"] = ""
    cloned["hercalculatie_timestamp"] = _now_iso()
    cloned["hercalculatie_basis"] = {
        "ingredienten_regels": deepcopy(
            source_record.get("invoer", {}).get("ingredienten", {}).get("regels", []),
        ),
    }
    cloned["resultaat_snapshot"] = {}
    cloned["finalized_at"] = ""
    cloned["last_completed_step"] = 1
    cloned["created_at"] = _now_iso()
    cloned["updated_at"] = _now_iso()
    cloned["aangemaakt_op"] = cloned["created_at"]
    cloned["aangepast_op"] = cloned["updated_at"]
    return normalize_berekening_record(cloned)


def get_berekening_by_id(berekening_id: str) -> dict[str, Any] | None:
    """Haalt een berekening op basis van id."""
    for record in load_berekeningen():
        if str(record.get("id", "")) == berekening_id:
            return record
    return None


def add_or_update_berekening(record: dict[str, Any]) -> dict[str, Any] | None:
    """Voegt een kostprijsversie toe of werkt een bestaande kostprijsversie bij."""
    records = load_kostprijsversies()
    record_id = str(record.get("id", "") or uuid4())
    existing = next(
        (item for item in records if str(item.get("id", "")) == record_id),
        None,
    )
    normalized = normalize_berekening_record(
        {
            **(existing or {}),
            **record,
            "id": record_id,
            "jaar": int(
                (
                    (record.get("basisgegevens", {}) if isinstance(record.get("basisgegevens", {}), dict) else {})
                ).get("jaar", record.get("jaar", (existing or {}).get("jaar", 0)))
                or 0
            ),
            "created_at": (
                str(existing.get("created_at", "") or "")
                if isinstance(existing, dict)
                else str(record.get("created_at", "") or _now_iso())
            ),
            "updated_at": _now_iso(),
            "aangemaakt_op": (
                str(existing.get("aangemaakt_op", existing.get("created_at", "")) or "")
                if isinstance(existing, dict)
                else str(record.get("aangemaakt_op", record.get("created_at", "") or _now_iso()) or _now_iso())
            ),
            "aangepast_op": _now_iso(),
        }
    )

    updated = False
    for index, item in enumerate(records):
        if str(item.get("id", "")) != record_id:
            continue
        records[index] = normalized
        updated = True
        break

    if not updated:
        records.append(normalized)

    if save_kostprijsversies(records):
        return normalized
    return None


def save_berekening_as_concept(record: dict[str, Any]) -> dict[str, Any] | None:
    """Slaat een berekening op als concept."""
    return add_or_update_berekening(
        {
            **record,
            "status": "concept",
            "finalized_at": "",
        }
    )


def finalize_berekening(record: dict[str, Any]) -> dict[str, Any] | None:
    """Rondt een kostprijsversie af als definitief record."""
    finalized = add_or_update_berekening(
        {
            **record,
            "status": "definitief",
            "is_actief": bool(record.get("is_actief", False)),
            "finalized_at": _now_iso(),
        }
    )
    if not isinstance(finalized, dict):
        return finalized

    # Phase E: auto-activate only when this is the first time we see a (bier,jaar,product) scope.
    try:
        _auto_activate_first_time_products(finalized)
    except Exception:
        # Fail hard: if activations can't be written, the finalize action must be retried/fixed.
        raise
    return finalized


def _auto_activate_first_time_products(record: dict[str, Any]) -> None:
    if str(record.get("status", "") or "") != "definitief":
        return
    bier_id = str(record.get("bier_id", "") or "").strip()
    jaar = int(record.get("jaar", 0) or 0)
    version_id = str(record.get("id", "") or "").strip()
    if not bier_id or jaar <= 0 or not version_id:
        return

    basis_by_id = {
        str(row.get("id", "") or ""): row
        for row in load_basisproducten()
        if isinstance(row, dict) and str(row.get("id", "") or "")
    }
    samengesteld_by_id = {
        str(row.get("id", "") or ""): row
        for row in load_samengestelde_producten()
        if isinstance(row, dict) and str(row.get("id", "") or "")
    }
    refs = _resolve_kostprijsproduct_refs(record, basis_by_id, samengesteld_by_id)
    if not refs:
        return

    existing_scopes = {
        (
            str(act.get("bier_id", "") or ""),
            int(act.get("jaar", 0) or 0),
            str(act.get("product_id", "") or ""),
        )
        for act in load_kostprijsproductactiveringen()
        if isinstance(act, dict)
    }
    effective_from = str(record.get("finalized_at", "") or "") or _now_iso()
    to_upsert: list[dict[str, Any]] = []
    for ref in refs:
        product_id = str(ref.get("product_id", "") or "").strip()
        if not product_id:
            continue
        scope = (bier_id, jaar, product_id)
        if scope in existing_scopes:
            continue
        to_upsert.append(
            {
                "bier_id": bier_id,
                "jaar": jaar,
                "product_id": product_id,
                "product_type": str(ref.get("product_type", "") or ""),
                "kostprijsversie_id": version_id,
                "effectief_vanaf": effective_from,
                "created_at": effective_from,
                "updated_at": effective_from,
            }
        )
    if to_upsert:
        if not upsert_kostprijsproductactiveringen(
            to_upsert,
            context={"action": "auto_activate_first_time"},
        ):
            raise ValueError("Kon kostprijsproductactiveringen niet opslaan bij afronden.")


def generate_missing_kostprijsproductactiveringen(*, dry_run: bool = False) -> dict[str, Any]:
    """Genereer ontbrekende activaties op basis van definitieve kostprijsversies.

    Phase E: activaties zijn de enige waarheid voor wat actief is per (bier, jaar, product).
    Deze functie is expliciet (admin endpoint) en draait nooit impliciet tijdens reads.

    Regels:
    - Alleen `status=definitief` wordt meegenomen.
    - Voor elke scope (bier, jaar, product) die nog geen activatie heeft, kiezen we de *oudste*
      definitieve kostprijsversie waarin dit product voorkomt (first-time semantics).
    """

    records = [
        record
        for record in load_kostprijsversies()
        if isinstance(record, dict) and str(record.get("status", "") or "").strip().lower() == "definitief"
    ]
    activations = [
        row for row in load_kostprijsproductactiveringen() if isinstance(row, dict)
    ]

    existing_scopes: set[tuple[str, int, str]] = set()
    for act in activations:
        bier_id = str(act.get("bier_id", "") or "").strip()
        try:
            jaar = int(act.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            jaar = 0
        product_id = str(act.get("product_id", "") or "").strip()
        if bier_id and jaar > 0 and product_id:
            existing_scopes.add((bier_id, jaar, product_id))

    basis_by_id = {
        str(row.get("id", "") or ""): row
        for row in load_basisproducten()
        if isinstance(row, dict) and str(row.get("id", "") or "")
    }
    samengesteld_by_id = {
        str(row.get("id", "") or ""): row
        for row in load_samengestelde_producten()
        if isinstance(row, dict) and str(row.get("id", "") or "")
    }

    def _record_time_key(record: dict[str, Any]) -> str:
        # Prefer a stable "first-time" timestamp. Missing timestamps are treated as "latest"
        # so they won't win over properly finalized versions.
        ts = str(
            record.get("finalized_at", "")
            or record.get("updated_at", "")
            or record.get("created_at", "")
            or ""
        ).strip()
        return ts or "9999-12-31T00:00:00"

    candidates: dict[tuple[str, int, str], tuple[tuple[str, int, str], dict[str, Any]]] = {}
    for record in records:
        bier_id = str(record.get("bier_id", "") or "").strip()
        try:
            jaar = int(record.get("jaar", 0) or 0)
        except (TypeError, ValueError):
            jaar = 0
        version_id = str(record.get("id", "") or "").strip()
        if not bier_id or jaar <= 0 or not version_id:
            continue

        # Ordering for "first time": earliest finalized_at, then lowest versie_nummer.
        time_key = _record_time_key(record)
        try:
            versie_nummer = int(record.get("versie_nummer", 0) or 0)
        except (TypeError, ValueError):
            versie_nummer = 0
        order_key = (time_key, versie_nummer, version_id)

        refs = _resolve_kostprijsproduct_refs(record, basis_by_id, samengesteld_by_id)
        for ref in refs:
            product_id = str(ref.get("product_id", "") or "").strip()
            if not product_id:
                continue
            scope = (bier_id, jaar, product_id)
            if scope in existing_scopes:
                continue
            existing = candidates.get(scope)
            if existing is None or order_key < existing[0]:
                effective_from = (
                    str(record.get("finalized_at", "") or "").strip()
                    or str(record.get("updated_at", "") or "").strip()
                    or _now_iso()
                )
                candidates[scope] = (
                    order_key,
                    {
                        "bier_id": bier_id,
                        "jaar": jaar,
                        "product_id": product_id,
                        "product_type": str(ref.get("product_type", "") or ""),
                        "kostprijsversie_id": version_id,
                        "effectief_vanaf": effective_from,
                        "created_at": effective_from,
                        "updated_at": effective_from,
                    },
                )

    to_upsert = [row for _, row in candidates.values()]
    report: dict[str, Any] = {
        "dry_run": dry_run,
        "missing_scopes": len(to_upsert),
        "created": 0,
        "examples": to_upsert[:10],
    }
    if dry_run or not to_upsert:
        return report

    saved = upsert_kostprijsproductactiveringen(
        to_upsert,
        context={"action": "generate_missing_activations"},
    )
    if not saved:
        raise ValueError("Kon ontbrekende kostprijsproductactiveringen niet opslaan.")
    report["created"] = len(to_upsert)
    return report


def activate_kostprijsversie(
    kostprijsversie_id: str,
    *,
    context: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Activeert de producten uit een definitieve kostprijsversie voor bier + product + jaar."""
    records = load_kostprijsversies()
    target = next(
        (
            record
            for record in records
            if str(record.get("id", "") or "") == str(kostprijsversie_id or "")
        ),
        None,
    )
    if not isinstance(target, dict):
        return None
    if str(target.get("status", "") or "") != "definitief":
        return None

    bier_id = str(target.get("bier_id", "") or "")
    jaar = int(target.get("jaar", 0) or 0)
    effective_from = _now_iso()
    # Map legacy product refs to SKU ids.
    postgres_storage = _get_postgres_storage_module()
    sku_rows = postgres_storage.load_dataset("skus", []) if postgres_storage is not None and postgres_storage.uses_postgres() else []
    sku_by_id = {str(row.get("id", "") or ""): row for row in sku_rows if isinstance(row, dict)}
    sku_by_beer_format: dict[tuple[str, str], str] = {}
    sku_by_article: dict[str, str] = {}
    for row in sku_by_id.values():
        sku_id = str(row.get("id", "") or "").strip()
        beer_key = str(row.get("beer_id", "") or "").strip()
        format_key = str(row.get("format_article_id", "") or "").strip()
        article_key = str(row.get("article_id", "") or "").strip()
        if sku_id and beer_key and format_key:
            sku_by_beer_format[(beer_key, format_key)] = sku_id
        if sku_id and article_key:
            sku_by_article[article_key] = sku_id

    # SKU-aanpak: article/bundle kostprijsversies activeren zichzelf (1 SKU per versie).
    basisgegevens = target.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    record_cost_type = str(target.get("type", "") or "").strip().lower()
    article_id = str(basisgegevens.get("article_id", "") or "").strip()
    requested_sku_id = str(basisgegevens.get("sku_id", "") or "").strip()
    if article_id or record_cost_type in {"bundle", "article"}:
        sku_id = requested_sku_id if requested_sku_id in sku_by_id else ""
        if not sku_id and article_id:
            sku_id = sku_by_article.get(article_id, "")
        if not sku_id:
            return None
        activation_row = {
            "sku_id": sku_id,
            "jaar": jaar,
            "kostprijsversie_id": str(kostprijsversie_id or ""),
            "effectief_vanaf": effective_from,
            "created_at": effective_from,
            "updated_at": effective_from,
            # Keep legacy fields for exports/debugging.
            "bier_id": bier_id,
            "product_id": article_id or str(sku_by_id.get(sku_id, {}).get("article_id", "") or ""),
            "product_type": "article",
        }
        if not upsert_kostprijsproductactiveringen(
            [activation_row],
            context={"action": "activate_version", **(context or {})},
        ):
            return None
        return next(
            (
                record
                for record in load_kostprijsversies()
                if str(record.get("id", "") or "") == str(kostprijsversie_id or "")
            ),
            None,
        )

    target_refs = _resolve_kostprijsproduct_refs(
        target,
        {
            str(row.get("id", "") or ""): row
            for row in load_basisproducten()
            if isinstance(row, dict) and str(row.get("id", "") or "")
        },
        {
            str(row.get("id", "") or ""): row
            for row in load_samengestelde_producten()
            if isinstance(row, dict) and str(row.get("id", "") or "")
        },
    )
    if not target_refs:
        return None

    activation_rows: list[dict[str, Any]] = []
    for ref in target_refs:
        product_id = str(ref.get("product_id", "") or "")
        if not product_id:
            continue
        sku_id = product_id if product_id in sku_by_id else ""
        if not sku_id:
            sku_id = sku_by_beer_format.get((bier_id, product_id), "")
        if not sku_id:
            sku_id = sku_by_article.get(product_id, "")
        if not sku_id:
            continue
        activation_rows.append(
            {
                "sku_id": sku_id,
                "jaar": jaar,
                "kostprijsversie_id": str(kostprijsversie_id or ""),
                "effectief_vanaf": effective_from,
                "created_at": effective_from,
                "updated_at": effective_from,
                # Keep legacy fields for debugging/exports.
                "bier_id": bier_id,
                "product_id": product_id,
                "product_type": str(ref.get("product_type", "") or ""),
            }
        )

    if not activation_rows:
        return None
    if not upsert_kostprijsproductactiveringen(
        activation_rows,
        context={"action": "activate_version", **(context or {})},
    ):
        return None

    return next(
        (
            record
            for record in load_kostprijsversies()
            if str(record.get("id", "") or "") == str(kostprijsversie_id or "")
        ),
        None,
    )


def activate_kostprijsversie_products(
    kostprijsversie_id: str,
    product_ids: list[str] | tuple[str, ...],
    *,
    context: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Activeert geselecteerde producten uit een definitieve kostprijsversie."""
    requested_product_ids = {
        str(product_id or "").strip()
        for product_id in product_ids
        if str(product_id or "").strip()
    }
    if not requested_product_ids:
        return None

    records = load_kostprijsversies()
    target = next(
        (
            record
            for record in records
            if str(record.get("id", "") or "") == str(kostprijsversie_id or "")
        ),
        None,
    )
    if not isinstance(target, dict):
        return None
    if str(target.get("status", "") or "") != "definitief":
        return None

    basisgegevens = target.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    record_cost_type = str(target.get("type", "") or "").strip().lower()
    article_id = str(basisgegevens.get("article_id", "") or "").strip()
    requested_sku_id = str(basisgegevens.get("sku_id", "") or "").strip()

    # SKU-aanpak: article/bundle kostprijsversies activeren zichzelf (1 SKU per versie).
    if article_id or record_cost_type in {"bundle", "article"}:
        if not (requested_product_ids.intersection({article_id, requested_sku_id})):
            return None
        bier_id = str(target.get("bier_id", "") or "")
        jaar = int(target.get("jaar", 0) or 0)
        effective_from = _now_iso()
        postgres_storage = _get_postgres_storage_module()
        sku_rows = postgres_storage.load_dataset("skus", []) if postgres_storage is not None and postgres_storage.uses_postgres() else []
        sku_by_id = {str(row.get("id", "") or ""): row for row in sku_rows if isinstance(row, dict)}
        sku_by_article: dict[str, str] = {}
        for row in sku_by_id.values():
            sku_id = str(row.get("id", "") or "").strip()
            article_key = str(row.get("article_id", "") or "").strip()
            if sku_id and article_key:
                sku_by_article[article_key] = sku_id
        sku_id = requested_sku_id if requested_sku_id in sku_by_id else ""
        if not sku_id and article_id:
            sku_id = sku_by_article.get(article_id, "")
        if not sku_id:
            return None
        activation_row = {
            "sku_id": sku_id,
            "jaar": jaar,
            "kostprijsversie_id": str(kostprijsversie_id or ""),
            "effectief_vanaf": effective_from,
            "created_at": effective_from,
            "updated_at": effective_from,
            "bier_id": bier_id,
            "product_id": article_id or str(sku_by_id.get(sku_id, {}).get("article_id", "") or ""),
            "product_type": "article",
        }
        if not upsert_kostprijsproductactiveringen(
            [activation_row],
            context={"action": "activate_products", **(context or {})},
        ):
            return None
        return next(
            (
                record
                for record in load_kostprijsversies()
                if str(record.get("id", "") or "") == str(kostprijsversie_id or "")
            ),
            None,
        )

    basisproducten = [
        row for row in load_basisproducten() if isinstance(row, dict)
    ]
    samengestelde_producten = [
        row for row in load_samengestelde_producten() if isinstance(row, dict)
    ]
    basis_by_id = {
        str(row.get("id", "") or ""): row
        for row in basisproducten
        if str(row.get("id", "") or "")
    }
    samengesteld_by_id = {
        str(row.get("id", "") or ""): row
        for row in samengestelde_producten
        if str(row.get("id", "") or "")
    }

    target_refs = _resolve_kostprijsproduct_refs(
        target,
        basis_by_id,
        samengesteld_by_id,
    )
    target_ref_by_product_id = {
        str(ref.get("product_id", "") or ""): ref
        for ref in target_refs
        if str(ref.get("product_id", "") or "")
    }
    valid_product_ids = requested_product_ids.intersection(target_ref_by_product_id.keys())
    if not valid_product_ids:
        return None

    bier_id = str(target.get("bier_id", "") or "")
    jaar = int(target.get("jaar", 0) or 0)
    effective_from = _now_iso()
    postgres_storage = _get_postgres_storage_module()
    sku_rows = postgres_storage.load_dataset("skus", []) if postgres_storage is not None and postgres_storage.uses_postgres() else []
    sku_by_id = {str(row.get("id", "") or ""): row for row in sku_rows if isinstance(row, dict)}
    sku_by_beer_format: dict[tuple[str, str], str] = {}
    sku_by_article: dict[str, str] = {}
    for row in sku_by_id.values():
        sku_id = str(row.get("id", "") or "").strip()
        beer_key = str(row.get("beer_id", "") or "").strip()
        format_key = str(row.get("format_article_id", "") or "").strip()
        article_key = str(row.get("article_id", "") or "").strip()
        if sku_id and beer_key and format_key:
            sku_by_beer_format[(beer_key, format_key)] = sku_id
        if sku_id and article_key:
            sku_by_article[article_key] = sku_id
    activation_rows: list[dict[str, Any]] = []
    for product_id in valid_product_ids:
        ref = target_ref_by_product_id[product_id]
        sku_id = product_id if product_id in sku_by_id else ""
        if not sku_id:
            sku_id = sku_by_beer_format.get((bier_id, product_id), "")
        if not sku_id:
            sku_id = sku_by_article.get(product_id, "")
        if not sku_id:
            continue
        activation_rows.append(
            {
                "sku_id": sku_id,
                "jaar": jaar,
                "kostprijsversie_id": str(kostprijsversie_id or ""),
                "effectief_vanaf": effective_from,
                "created_at": effective_from,
                "updated_at": effective_from,
                "bier_id": bier_id,
                "product_id": product_id,
                "product_type": str(ref.get("product_type", "") or ""),
            }
        )

    if not activation_rows:
        return None
    if not upsert_kostprijsproductactiveringen(
        activation_rows,
        context={"action": "activate_products", **(context or {})},
    ):
        return None

    return next(
        (
            record
            for record in load_kostprijsversies()
            if str(record.get("id", "") or "") == str(kostprijsversie_id or "")
        ),
        None,
    )


def get_actieve_kostprijsversie(
    bier_id: str,
    jaar: int | str,
) -> dict[str, Any] | None:
    """Geeft een representatieve actieve kostprijsversie voor bier en jaar terug."""
    try:
        jaar_value = int(jaar)
    except (TypeError, ValueError):
        return None

    activations = [
        item
        for item in load_kostprijsproductactiveringen()
        if str(item.get("bier_id", "") or "") == str(bier_id or "")
        and int(item.get("jaar", 0) or 0) == jaar_value
    ]
    if not activations:
        return None
    activations.sort(
        key=lambda item: (
            str(item.get("effectief_vanaf", "") or ""),
            str(item.get("updated_at", "") or ""),
            str(item.get("id", "") or ""),
        ),
        reverse=True,
    )
    target_version_id = str(activations[0].get("kostprijsversie_id", "") or "")
    return next(
        (
            record
            for record in load_kostprijsversies()
            if str(record.get("id", "") or "") == target_version_id
        ),
        None,
    )


def delete_berekening(berekening_id: str) -> bool:
    """Verwijdert een berekening op basis van id."""
    records = load_berekeningen()
    target_record = next(
        (
            record
            for record in records
            if str(record.get("id", "")) == str(berekening_id or "")
        ),
        None,
    )
    if not isinstance(target_record, dict):
        return False

    bier_id = str(target_record.get("bier_id", "") or "").strip()
    bereken_jaar = int(
        target_record.get("basisgegevens", {}).get("jaar", 0) or 0
    )
    filtered = [
        record for record in records if str(record.get("id", "")) != berekening_id
    ]
    if not save_berekeningen(filtered):
        return False

    if bier_id and bereken_jaar > 0:
        has_remaining_year_record = any(
            str(record.get("bier_id", "") or "").strip() == bier_id
            and int(record.get("basisgegevens", {}).get("jaar", 0) or 0) == bereken_jaar
            for record in filtered
            if isinstance(record, dict)
        )
        if not has_remaining_year_record:
            delete_variabele_kosten_record(bereken_jaar, bier_id)

    cleanup_unused_bieren()
    return True


def get_concept_berekeningen() -> list[dict[str, Any]]:
    """Geeft alle conceptberekeningen terug."""
    return [
        record
        for record in load_berekeningen()
        if str(record.get("status", "")) == "concept"
    ]


def get_definitieve_berekeningen() -> list[dict[str, Any]]:
    """Geeft alle definitieve berekeningen terug."""
    return [
        record
        for record in load_berekeningen()
        if str(record.get("status", "")) == "definitief"
    ]


def get_definitieve_berekeningen_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft alle definitieve berekeningen voor een jaar terug."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return []

    return [
        record
        for record in get_definitieve_berekeningen()
        if int(record.get("basisgegevens", {}).get("jaar", 0) or 0) == year_value
    ]


def get_integrale_kostprijs_per_liter_for_bier(
    bier_id: str,
    year: int | str | None = None,
) -> float | None:
    """Geeft een afgeleide kostprijs per liter terug voor een specifiek of recent jaar."""
    data = load_variabele_kosten_data()
    beschikbare_jaren: list[int] = []

    for year, bier_records in data.items():
        if not str(year).isdigit() or not isinstance(bier_records, dict):
            continue
        if bier_id in bier_records and isinstance(bier_records.get(bier_id), list):
            beschikbare_jaren.append(int(year))

    if year is not None:
        try:
            target_year = int(year)
        except (TypeError, ValueError):
            return None
        beschikbare_jaren = [jaar for jaar in beschikbare_jaren if jaar == target_year]

    for bereken_jaar in sorted(beschikbare_jaren, reverse=True):
        records = get_variabele_kosten_record(bereken_jaar, bier_id)
        if not records:
            continue

        totale_batchkosten = 0.0
        for record in records:
            prijs_per_eenheid = calculate_price_per_unit(
                record.get("prijs_artikel"),
                record.get("verpakkingsinhoud"),
            )
            kosten_volgens_recept = calculate_kosten_volgens_recept(
                prijs_per_eenheid,
                record.get("benodigde_hoeveelheid_recept"),
                str(record.get("verpakkingsinhoud_eenheid", "")),
                str(record.get("benodigde_hoeveelheid_eenheid", "")),
            )
            if kosten_volgens_recept is None:
                continue
            totale_batchkosten += float(kosten_volgens_recept)

        variabele_kosten_per_liter = calculate_variabele_kosten_per_liter(
            totale_batchkosten,
            get_batchgrootte_eigen_productie_l(bereken_jaar),
        )
        if variabele_kosten_per_liter is not None:
            return variabele_kosten_per_liter

    return None


def load_variabele_kosten_data() -> dict[str, Any]:
    """Laadt alle variabele kosten veilig in."""
    payload = _load_postgres_dataset("variabele-kosten")
    return payload if isinstance(payload, dict) else {}


def save_variabele_kosten_data(data: dict[str, Any]) -> bool:
    """Slaat alle variabele kosten veilig op."""
    return _save_postgres_dataset("variabele-kosten", data if isinstance(data, dict) else {})


def get_variabele_kosten_record(
    year: int | str,
    bier_id: str,
) -> list[dict[str, Any]]:
    """Haalt alle variabele kostenregels voor een jaar en bier op."""
    data = load_variabele_kosten_data()
    year_data = data.get(str(year), {})
    if not isinstance(year_data, dict):
        return []

    record = year_data.get(bier_id, [])
    return record if isinstance(record, list) else []


def upsert_variabele_kosten_record(
    year: int | str,
    bier_id: str,
    records: list[dict[str, Any]],
) -> bool:
    """Slaat variabele kosten op voor een specifieke combinatie van jaar en bier."""
    data = load_variabele_kosten_data()
    year_key = str(year)

    if year_key not in data or not isinstance(data.get(year_key), dict):
        data[year_key] = {}

    data[year_key][bier_id] = records
    return save_variabele_kosten_data(data)


def delete_variabele_kosten_record(year: int | str, bier_id: str) -> bool:
    """Verwijdert alle variabele kosten voor een specifieke combinatie."""
    data = load_variabele_kosten_data()
    year_key = str(year)

    if year_key not in data or not isinstance(data.get(year_key), dict):
        return False

    if bier_id not in data[year_key]:
        return False

    del data[year_key][bier_id]

    if not data[year_key]:
        del data[year_key]

    return save_variabele_kosten_data(data)


def calculate_price_per_unit(
    prijs_artikel: float | int | None,
    verpakkingsinhoud: float | int | None,
) -> float | None:
    """Berekent de prijs per eenheid."""
    try:
        prijs_value = float(prijs_artikel or 0.0)
        inhoud_value = float(verpakkingsinhoud or 0.0)
    except (TypeError, ValueError):
        return None

    if inhoud_value <= 0 or prijs_value < 0:
        return None

    return prijs_value / inhoud_value


def calculate_kosten_volgens_recept(
    prijs_per_eenheid: float | None,
    benodigde_hoeveelheid_recept: float | int | None,
    verpakkingsinhoud_eenheid: str,
    benodigde_hoeveelheid_eenheid: str,
) -> float | None:
    """Berekent de receptkosten wanneer de eenheden overeenkomen."""
    try:
        benodigde_value = float(benodigde_hoeveelheid_recept or 0.0)
    except (TypeError, ValueError):
        return None

    if (
        prijs_per_eenheid is None
        or benodigde_value < 0
        or verpakkingsinhoud_eenheid != benodigde_hoeveelheid_eenheid
    ):
        return None

    return prijs_per_eenheid * benodigde_value


def calculate_totale_batchkosten(records: list[dict[str, Any]]) -> float:
    """Berekent de som van alle geldige receptkosten."""
    total = 0.0

    for record in records:
        kosten = record.get("kosten_volgens_recept")
        if kosten is None:
            continue

        try:
            total += float(kosten)
        except (TypeError, ValueError):
            continue

    return total


def calculate_variabele_kosten_per_liter(
    totale_batchkosten: float,
    batchgrootte_l: float | int | None,
) -> float | None:
    """Berekent variabele kosten per liter op basis van batchgrootte."""
    if batchgrootte_l is None or float(batchgrootte_l) <= 0:
        return None

    return float(totale_batchkosten) / float(batchgrootte_l)


MODEL_A_DATASET_NAMES = [
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
]


def _model_a_id(*parts: Any) -> str:
    seed = "|".join(str(part or "").strip().lower() for part in parts)
    return str(uuid5(NAMESPACE_URL, f"berlewalde-model-a|{seed}"))


def _build_model_a_product_maps() -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    products: list[dict[str, Any]] = []
    product_years: list[dict[str, Any]] = []
    product_year_components: list[dict[str, Any]] = []
    product_components: list[dict[str, Any]] = []

    product_seen: set[str] = set()
    product_year_seen: set[str] = set()
    source_years = _get_master_product_years()
    if not source_years:
        source_years = [datetime.now().year]

    for basisproduct in load_basisproducten():
        name = str(basisproduct.get("omschrijving", "") or "")
        if not name:
            continue
        product_id = str(basisproduct.get("id", "") or "").strip()
        if not product_id:
            raise ValueError("Basisproduct mist id: product ids moeten canoniek zijn.")
        if product_id not in product_seen:
            products.append(
                {
                    "id": product_id,
                    "name": name,
                    "kind": "basis",
                    "default_content_liter": float(basisproduct.get("inhoud_per_eenheid_liter", 0.0) or 0.0),
                    "active": True,
                }
            )
            product_seen.add(product_id)

        for year in source_years:
            resolved_basisproduct = resolve_basisproduct_for_year(basisproduct, year)
            product_year_id = _model_a_id("product-year", product_id, year)
            if product_year_id not in product_year_seen:
                product_years.append(
                    {
                        "id": product_year_id,
                        "product_id": product_id,
                        "year": year,
                        "content_liter": float(
                            resolved_basisproduct.get("inhoud_per_eenheid_liter", 0.0) or 0.0
                        ),
                        "total_packaging_cost": float(
                            resolved_basisproduct.get("totale_verpakkingskosten", 0.0) or 0.0
                        ),
                        "available_for_sale": True,
                        "available_for_composite": False,
                    }
                )
                product_year_seen.add(product_year_id)

            for component in (
                resolved_basisproduct.get("onderdelen", [])
                if isinstance(resolved_basisproduct.get("onderdelen", []), list)
                else []
            ):
                if not isinstance(component, dict):
                    continue
                packaging_component_id = str(component.get("verpakkingsonderdeel_id", "") or "")
                product_year_components.append(
                    {
                        "id": _model_a_id(
                            "product-year-component",
                            product_year_id,
                            packaging_component_id,
                            component.get("omschrijving"),
                        ),
                        "product_year_id": product_year_id,
                        "packaging_component_id": packaging_component_id,
                        "component_key": str(component.get("omschrijving", "") or ""),
                        "description": str(component.get("omschrijving", "") or ""),
                        "quantity": float(component.get("hoeveelheid", 0.0) or 0.0),
                        "price_per_piece": float(component.get("prijs_per_stuk", 0.0) or 0.0),
                        "total_cost": float(component.get("totale_kosten", 0.0) or 0.0),
                    }
                )

    for samengesteld in load_samengestelde_producten():
        name = str(samengesteld.get("omschrijving", "") or "")
        if not name:
            continue
        product_id = str(samengesteld.get("id", "") or "").strip()
        if not product_id:
            raise ValueError("Samengesteld product mist id: product ids moeten canoniek zijn.")
        if product_id not in product_seen:
            products.append(
                {
                    "id": product_id,
                    "name": name,
                    "kind": "samengesteld",
                    "default_content_liter": float(samengesteld.get("totale_inhoud_liter", 0.0) or 0.0),
                    "active": True,
                }
            )
            product_seen.add(product_id)

        for year in source_years:
            resolved_samengesteld = resolve_samengesteld_product_for_year(samengesteld, year)
            product_year_id = _model_a_id("product-year", product_id, year)
            if product_year_id not in product_year_seen:
                product_years.append(
                    {
                        "id": product_year_id,
                        "product_id": product_id,
                        "year": year,
                        "content_liter": float(
                            resolved_samengesteld.get("totale_inhoud_liter", 0.0) or 0.0
                        ),
                        "total_packaging_cost": float(
                            resolved_samengesteld.get("totale_verpakkingskosten", 0.0) or 0.0
                        ),
                        "available_for_sale": True,
                        "available_for_composite": True,
                    }
                )
                product_year_seen.add(product_year_id)

        for component in samengesteld.get("basisproducten", []) if isinstance(samengesteld.get("basisproducten", []), list) else []:
            if not isinstance(component, dict):
                continue
            basisproduct_id = str(component.get("basisproduct_id", "") or "")
            component_product_id = basisproduct_id
            component_packaging_component_id = ""
            component_kind = "product"
            if basisproduct_id.startswith(SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX):
                component_packaging_component_id = basisproduct_id.removeprefix(
                    SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX
                )
                component_kind = "packaging-component"
                component_product_id = ""
            product_components.append(
                {
                    "id": _model_a_id("product-component", product_id, basisproduct_id, component.get("omschrijving")),
                    "product_id": product_id,
                    "component_product_id": component_product_id,
                    "component_packaging_component_id": component_packaging_component_id,
                    "component_kind": component_kind,
                    "quantity": float(component.get("aantal", 0.0) or 0.0),
                    "description": str(component.get("omschrijving", "") or ""),
                }
            )

    for catalog_product in load_catalog_products():
        name = str(catalog_product.get("naam", catalog_product.get("name", "")) or "").strip()
        if not name:
            continue
        product_id = str(catalog_product.get("id", "") or "").strip()
        if not product_id:
            raise ValueError("Catalogusproduct mist id: product ids moeten canoniek zijn.")
        if product_id not in product_seen:
            products.append(
                {
                    "id": product_id,
                    "name": name,
                    "kind": str(catalog_product.get("kind", "catalog") or "catalog"),
                    "default_content_liter": 0.0,
                    "active": bool(catalog_product.get("actief", catalog_product.get("active", True))),
                }
            )
            product_seen.add(product_id)

        for year in source_years:
            product_year_id = _model_a_id("product-year", product_id, year)
            if product_year_id not in product_year_seen:
                product_years.append(
                    {
                        "id": product_year_id,
                        "product_id": product_id,
                        "year": year,
                        "content_liter": 0.0,
                        "total_packaging_cost": 0.0,
                        "available_for_sale": True,
                        "available_for_composite": True,
                    }
                )
                product_year_seen.add(product_year_id)

    return (
        products,
        product_years,
        product_year_components,
        product_components,
    )



def build_model_a_canonical_datasets() -> dict[str, list[dict[str, Any]]]:
    (
        products,
        product_years,
        product_year_components,
        product_components,
    ) = _build_model_a_product_maps()
    missing_product_refs: list[dict[str, Any]] = []

    sales_strategy_years = [
        {
            "id": _model_a_id("sales-strategy-year", row.get("jaar")),
            "year": int(row.get("jaar", 0) or 0),
            "source_record_id": str(row.get("id", "") or ""),
            "kanaalmarges": dict(row.get("kanaalmarges", {})),
        }
        for row in load_verkoopstrategien()
    ]

    sales_strategy_products: list[dict[str, Any]] = []
    for row in [*load_verkoopstrategie_verpakkingen(), *load_verkoopstrategie_producten()]:
        canonical_product_id = str(row.get("product_id", "") or "").strip()
        if not canonical_product_id:
            missing_product_refs.append({"dataset": "verkoopprijzen", "record": row})
            continue
        sales_strategy_products.append(
            {
                "id": _model_a_id("sales-strategy-product", row.get("id"), canonical_product_id),
                "product_id": canonical_product_id,
                "year": int(row.get("jaar", 0) or 0),
                "source_record_id": str(row.get("id", "") or ""),
                "record_type": str(row.get("record_type", "") or ""),
                "strategie_type": str(row.get("strategie_type", "") or ""),
                "kanaalmarges": dict(row.get("kanaalmarges", {})),
            }
        )

    sales_strategy_year_by_year = {
        int(row.get("year", 0) or 0): row
        for row in sales_strategy_years
        if int(row.get("year", 0) or 0) > 0
    }
    for row in sales_strategy_products:
        year = int(row.get("year", 0) or 0)
        if year <= 0 or year in sales_strategy_year_by_year:
            continue
        sales_strategy_year_by_year[year] = {
            "id": _model_a_id("sales-strategy-year-derived", year),
            "year": year,
            "source_record_id": "",
            "kanaalmarges": dict(row.get("kanaalmarges", {})),
        }
    sales_strategy_years = list(sales_strategy_year_by_year.values())

    cost_calcs: list[dict[str, Any]] = []
    cost_calc_inputs: list[dict[str, Any]] = []
    cost_calc_results: list[dict[str, Any]] = []
    cost_calc_lines: list[dict[str, Any]] = []
    for row in load_kostprijsversies():
        calc_id = str(row.get("id", "") or "")
        if not calc_id:
            continue
        basisgegevens = row.get("basisgegevens", {}) if isinstance(row.get("basisgegevens", {}), dict) else {}
        resultaat_snapshot = row.get("resultaat_snapshot", {}) if isinstance(row.get("resultaat_snapshot", {}), dict) else {}
        input_data = row.get("invoer", {}) if isinstance(row.get("invoer", {}), dict) else {}
        cost_calcs.append(
            {
                "id": calc_id,
                "beer_id": str(row.get("bier_id", "") or ""),
                "year": int(row.get("jaar", basisgegevens.get("jaar", 0)) or 0),
                "version_number": int(row.get("versie_nummer", 0) or 0),
                "calc_type": str(row.get("type", "") or ""),
                "source_type": str(row.get("brontype", "") or ""),
                "source_id": str(row.get("bron_id", "") or ""),
                "status": str(row.get("status", "") or ""),
                "is_active": bool(row.get("is_actief", False)),
                "effective_from": str(row.get("effectief_vanaf", "") or ""),
                "unit_cost": float(row.get("kostprijs", 0.0) or 0.0),
                "created_at": str(row.get("created_at", "") or ""),
                "updated_at": str(row.get("updated_at", "") or ""),
                "finalized_at": str(row.get("finalized_at", "") or ""),
            }
        )
        cost_calc_inputs.append({"cost_calc_id": calc_id, "payload": input_data})
        cost_calc_results.append(
            {
                "cost_calc_id": calc_id,
                "integral_cost_per_liter": float(resultaat_snapshot.get("integrale_kostprijs_per_liter", 0.0) or 0.0),
                "variable_cost_per_liter": float(resultaat_snapshot.get("variabele_kosten_per_liter", 0.0) or 0.0),
                "direct_fixed_cost_per_liter": float(resultaat_snapshot.get("directe_vaste_kosten_per_liter", 0.0) or 0.0),
            }
        )

        producten_snapshot = resultaat_snapshot.get("producten", {}) if isinstance(resultaat_snapshot.get("producten", {}), dict) else {}
        for source_kind, rows in (
            ("basis", producten_snapshot.get("basisproducten", [])),
            ("samengesteld", producten_snapshot.get("samengestelde_producten", [])),
        ):
            if not isinstance(rows, list):
                continue
            for line in rows:
                if not isinstance(line, dict):
                    continue
                verpakking = str(line.get("verpakking", line.get("verpakkingseenheid", "")) or "")
                canonical_product_id = str(line.get("product_id", "") or "").strip()
                if not canonical_product_id:
                    missing_product_refs.append({"dataset": "kostprijsversies.resultaat_snapshot", "record": line})
                    continue
                cost_calc_lines.append(
                    {
                        "id": _model_a_id("cost-calc-line", calc_id, source_kind, verpakking),
                        "cost_calc_id": calc_id,
                        "product_id": canonical_product_id,
                        "source_kind": source_kind,
                        "packaging": verpakking,
                        "liters_per_product": float(line.get("liters_per_product", 0.0) or 0.0),
                        "primary_cost": float(line.get("primaire_kosten", line.get("variabele_kosten", 0.0)) or 0.0),
                        "packaging_cost": float(line.get("verpakkingskosten", 0.0) or 0.0),
                        "fixed_cost": float(line.get("vaste_kosten", line.get("vaste_directe_kosten", 0.0)) or 0.0),
                        "excise": float(line.get("accijns", 0.0) or 0.0),
                        "unit_cost": float(line.get("kostprijs", 0.0) or 0.0),
                        "liter_cost": float(resultaat_snapshot.get("integrale_kostprijs_per_liter", 0.0) or 0.0),
                    }
                )

    quotes: list[dict[str, Any]] = []
    quote_lines: list[dict[str, Any]] = []
    quote_staffels: list[dict[str, Any]] = []
    for row in load_prijsvoorstellen():
        quote_id = str(row.get("id", "") or "")
        if not quote_id:
            continue
        quotes.append(
            {
                "id": quote_id,
                "beer_id": str(row.get("bier_id", "") or ""),
                "cost_version_ids": [
                    str(value or "")
                    for value in (row.get("kostprijsversie_ids", []) if isinstance(row.get("kostprijsversie_ids", []), list) else [])
                    if str(value or "").strip()
                ],
                "year": int(row.get("jaar", 0) or 0),
                "quote_number": str(row.get("offertenummer", "") or ""),
                "status": str(row.get("status", "") or ""),
                "quote_type": str(row.get("voorsteltype", "") or ""),
                "channel": str(row.get("kanaal", "") or ""),
                "quote_date": str(row.get("datum_text", "") or ""),
                "expires_at": str(row.get("verloopt_op", "") or ""),
                "customer_name": str(row.get("klantnaam", "") or ""),
                "contact_person": str(row.get("contactpersoon", "") or ""),
                "reference": str(row.get("referentie", "") or ""),
            }
        )

        for item in row.get("product_rows", []) if isinstance(row.get("product_rows", []), list) else []:
            if not isinstance(item, dict):
                continue
            canonical_product_id = str(item.get("product_id", "") or "").strip()
            if not canonical_product_id:
                missing_product_refs.append({"dataset": "prijsvoorstellen.product_rows", "record": item})
                continue
            quote_lines.append(
                {
                    "id": _model_a_id("quote-line", quote_id, item.get("id")),
                    "quote_id": quote_id,
                    "line_type": "product",
                    "product_id": canonical_product_id,
                    "cost_version_id": str(item.get("kostprijsversie_id", "") or ""),
                    "quantity": float(item.get("aantal", 0.0) or 0.0),
                    "liters": 0.0,
                    "discount_pct": float(item.get("korting_pct", 0.0) or 0.0),
                    "included": bool(item.get("included", True)),
                    "kostprijsversie_id": str(item.get("kostprijsversie_id", "") or ""),
                    "cost_at_quote": float(item.get("cost_at_quote", 0.0) or 0.0),
                    "sales_price_at_quote": float(item.get("sales_price_at_quote", 0.0) or 0.0),
                    "revenue_at_quote": float(item.get("revenue_at_quote", 0.0) or 0.0),
                    "margin_at_quote": float(item.get("margin_at_quote", 0.0) or 0.0),
                    "target_margin_pct_at_quote": float(item.get("target_margin_pct_at_quote", 0.0) or 0.0),
                    "channel_at_quote": str(item.get("channel_at_quote", "") or row.get("kanaal", "") or ""),
                }
            )

        for item in row.get("beer_rows", []) if isinstance(row.get("beer_rows", []), list) else []:
            if not isinstance(item, dict):
                continue
            canonical_product_id = str(item.get("product_id", "") or "").strip()
            if not canonical_product_id:
                missing_product_refs.append({"dataset": "prijsvoorstellen.beer_rows", "record": item})
                continue
            quote_lines.append(
                {
                    "id": _model_a_id("quote-line", quote_id, item.get("id")),
                    "quote_id": quote_id,
                    "line_type": "liter",
                    "product_id": canonical_product_id,
                    "cost_version_id": str(item.get("kostprijsversie_id", "") or ""),
                    "quantity": 0.0,
                    "liters": float(item.get("liters", 0.0) or 0.0),
                    "discount_pct": float(item.get("korting_pct", 0.0) or 0.0),
                    "included": bool(item.get("included", True)),
                    "kostprijsversie_id": str(item.get("kostprijsversie_id", "") or ""),
                    "cost_at_quote": float(item.get("cost_at_quote", 0.0) or 0.0),
                    "sales_price_at_quote": float(item.get("sales_price_at_quote", 0.0) or 0.0),
                    "revenue_at_quote": float(item.get("revenue_at_quote", 0.0) or 0.0),
                    "margin_at_quote": float(item.get("margin_at_quote", 0.0) or 0.0),
                    "target_margin_pct_at_quote": float(item.get("target_margin_pct_at_quote", 0.0) or 0.0),
                    "channel_at_quote": str(item.get("channel_at_quote", "") or row.get("kanaal", "") or ""),
                }
            )

        for item in row.get("staffels", []) if isinstance(row.get("staffels", []), list) else []:
            if not isinstance(item, dict):
                continue
            canonical_product_id = str(item.get("product_id", "") or "").strip()
            if not canonical_product_id:
                missing_product_refs.append({"dataset": "prijsvoorstellen.staffels", "record": item})
                continue
            quote_staffels.append(
                {
                    "id": _model_a_id("quote-staffel", quote_id, item.get("id")),
                    "quote_id": quote_id,
                    "product_id": canonical_product_id,
                    "product_type": str(item.get("product_type", "") or ""),
                    "liters": float(item.get("liters", 0.0) or 0.0),
                    "discount_pct": float(item.get("korting_pct", 0.0) or 0.0),
                }
            )

    if missing_product_refs:
        # Fail hard: we do not allow label-based matching or legacy ids in runtime.
        raise ValueError(
            "Dataset bevat records zonder canonieke product_id. "
            "Voer eerst de product-id migratie uit of herstel de data."
        )

    return {
        "products": products,
        "product-years": product_years,
        "product-year-components": product_year_components,
        "product-components": product_components,
        "sales-strategy-years": sales_strategy_years,
        "sales-strategy-products": sales_strategy_products,
        "cost-calcs": cost_calcs,
        "cost-calc-inputs": cost_calc_inputs,
        "cost-calc-results": cost_calc_results,
        "cost-calc-lines": cost_calc_lines,
        "quotes": quotes,
        "quote-lines": quote_lines,
        "quote-staffels": quote_staffels,
    }


def run_integrity_audit() -> dict[str, list[dict[str, Any]]]:
    known_bieren = _known_bier_ids()
    known_versions = _known_kostprijsversie_ids()
    known_products = _known_product_refs()

    duplicate_activation_keys: set[tuple[str, int, str]] = set()
    seen_activation_keys: set[tuple[str, int, str]] = set()
    invalid_activations: list[dict[str, Any]] = []
    for row in load_kostprijsproductactiveringen():
        key = (
            str(row.get("bier_id", "") or ""),
            int(row.get("jaar", 0) or 0),
            str(row.get("product_id", "") or ""),
        )
        if key in seen_activation_keys:
            duplicate_activation_keys.add(key)
        seen_activation_keys.add(key)
        if (
            key[0] not in known_bieren
            or not key[2]
            or (key[2], str(row.get("product_type", "") or "").strip().lower()) not in known_products
            or str(row.get("kostprijsversie_id", "") or "") not in known_versions
        ):
            invalid_activations.append(row)

    invalid_quotes: list[dict[str, Any]] = []
    for quote in load_prijsvoorstellen():
        if str(quote.get("bier_id", "") or "") and str(quote.get("bier_id", "") or "") not in known_bieren:
            invalid_quotes.append({"id": quote.get("id", ""), "type": "bier"})
        for version_id in quote.get("kostprijsversie_ids", []):
            if str(version_id or "") not in known_versions:
                invalid_quotes.append({"id": quote.get("id", ""), "type": "kostprijsversie", "value": version_id})

    invalid_verkoop_records: list[dict[str, Any]] = []
    for record in _load_verkoopprijs_records():
        normalized = _normalize_any_verkoop_record(record)
        bier_id = str(normalized.get("bier_id", "") or "")
        product_id = str(normalized.get("product_id", "") or "")
        product_type = str(normalized.get("product_type", "") or "").strip().lower()
        if bier_id and bier_id not in known_bieren:
            invalid_verkoop_records.append({"id": normalized.get("id", ""), "type": "bier"})
            continue
        if product_id and (product_id, product_type) not in known_products:
            invalid_verkoop_records.append({"id": normalized.get("id", ""), "type": "product"})

    return {
        "invalid_kostprijsproductactiveringen": invalid_activations,
        "duplicate_kostprijsproductactiveringen": [
            {"bier_id": bier_id, "jaar": jaar, "product_id": product_id}
            for bier_id, jaar, product_id in sorted(duplicate_activation_keys)
        ],
        "invalid_prijsvoorstellen": invalid_quotes,
        "invalid_verkooprecords": invalid_verkoop_records,
    }


def _build_legacy_model_a_product_id_map() -> dict[str, str]:
    """Builds a mapping from historical Model-A derived product ids to master product ids.

    Older revisions derived product ids from names via `_model_a_id("product", kind, name)`.
    The master datasets (basisproducten / samengestelde-producten) already have stable ids.
    This mapping allows a one-time migration of stored records that still reference the derived ids.
    """
    mapping: dict[str, str] = {}

    for record in load_basisproducten():
        if not isinstance(record, dict):
            continue
        name = str(record.get("omschrijving", "") or "")
        master_id = str(record.get("id", "") or "")
        if not name or not master_id:
            continue
        legacy_id = _model_a_id("product", "basis", name)
        if legacy_id and legacy_id != master_id:
            mapping[legacy_id] = master_id

    for record in load_samengestelde_producten():
        if not isinstance(record, dict):
            continue
        name = str(record.get("omschrijving", "") or "")
        master_id = str(record.get("id", "") or "")
        if not name or not master_id:
            continue
        legacy_id = _model_a_id("product", "samengesteld", name)
        if legacy_id and legacy_id != master_id:
            mapping[legacy_id] = master_id

    return mapping


def _deep_replace_product_ids(value: Any, mapping: dict[str, str]) -> Any:
    """Recursively replaces string values that match legacy product ids."""
    if not mapping:
        return value
    if isinstance(value, str):
        return mapping.get(value, value)
    if isinstance(value, list):
        return [_deep_replace_product_ids(item, mapping) for item in value]
    if isinstance(value, dict):
        return {key: _deep_replace_product_ids(val, mapping) for key, val in value.items()}
    return value


def migrate_product_ids_to_master_ids(*, dry_run: bool = False) -> dict[str, Any]:
    """One-time migration: ensure stored records reference master Product ids only.

    This updates datasets that historically stored Model-A derived product ids. After migration,
    `product_id` values align with the master ids from basisproducten/samengestelde-producten.
    """
    mapping = _build_legacy_model_a_product_id_map()
    changed_total = 0
    # Note: even when there is no legacy-id mapping, we still run the snapshot backfill.
    # Older stored kostprijs snapshots may miss product_id/product_type and need a one-time repair.
    details: dict[str, int] = {"mapping": len(mapping)}

    master_basis_by_name = {
        _normalize_verpakking_key(row.get("omschrijving")): str(row.get("id", "") or "")
        for row in load_basisproducten()
        if isinstance(row, dict) and _normalize_verpakking_key(row.get("omschrijving")) and str(row.get("id", "") or "")
    }
    master_samengesteld_by_name = {
        _normalize_verpakking_key(row.get("omschrijving")): str(row.get("id", "") or "")
        for row in load_samengestelde_producten()
        if isinstance(row, dict) and _normalize_verpakking_key(row.get("omschrijving")) and str(row.get("id", "") or "")
    }

    unresolved_snapshot_refs: list[dict[str, Any]] = []
    # Always include these keys so callers can verify the backend is running the latest migration logic.
    details["unresolved_snapshot_refs"] = 0
    details["unresolved_snapshot_refs_examples"] = 0

    def _backfill_snapshot_products(obj: Any) -> tuple[Any, bool]:
        """Backfill missing product_id/product_type in kostprijs snapshot rows using verpakking label.

        This is a one-time migration helper. Runtime no longer performs label-based repairs.
        """
        if not isinstance(obj, dict):
            return obj, False
        snapshot = obj.get("resultaat_snapshot")
        if not isinstance(snapshot, dict):
            return obj, False
        producten = snapshot.get("producten")
        if not isinstance(producten, dict):
            return obj, False
        changed = False

        def _fix_rows(rows: Any, kind: str) -> list[dict[str, Any]]:
            nonlocal changed
            if not isinstance(rows, list):
                return []
            out_rows: list[dict[str, Any]] = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                product_id = str(row.get("product_id", "") or "").strip()
                product_type = str(row.get("product_type", "") or "").strip().lower()
                verpakking = str(row.get("verpakking", "") or row.get("verpakkingseenheid", "") or row.get("omschrijving", "") or "").strip()
                if not product_id and verpakking:
                    key = _normalize_verpakking_key(verpakking)
                    if kind == "basis":
                        resolved = master_basis_by_name.get(key, "")
                    else:
                        resolved = master_samengesteld_by_name.get(key, "")
                    if resolved:
                        row = {**row, "product_id": resolved, "product_type": kind}
                        changed = True
                    else:
                        unresolved_snapshot_refs.append({"verpakking": verpakking, "kind": kind})
                elif product_id and not product_type and kind in {"basis", "samengesteld"}:
                    row = {**row, "product_type": kind}
                    changed = True
                out_rows.append(row)
            return out_rows

        producten_fixed = {
            **producten,
            "basisproducten": _fix_rows(producten.get("basisproducten", []), "basis"),
            "samengestelde_producten": _fix_rows(producten.get("samengestelde_producten", []), "samengesteld"),
        }
        if producten_fixed != producten:
            snapshot = {**snapshot, "producten": producten_fixed}
            obj = {**obj, "resultaat_snapshot": snapshot}
        return obj, changed

    def _backfill_verkoop_records(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
        """Backfill missing product_id on verkoopstrategie verpakking records (one-time)."""
        changed = 0
        out: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            record_type = str(row.get("record_type", "") or "")
            product_id = str(row.get("product_id", "") or "").strip()
            product_type = str(row.get("product_type", "") or "").strip().lower()
            verpakking = str(row.get("verpakking", "") or "").strip()
            if record_type == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING and not product_id and verpakking:
                key = _normalize_verpakking_key(verpakking)
                resolved = master_samengesteld_by_name.get(key) or master_basis_by_name.get(key) or ""
                if resolved:
                    inferred_type = "samengesteld" if resolved in master_samengesteld_by_name.values() else "basis"
                    row = {**row, "product_id": resolved, "product_type": product_type or inferred_type}
                    changed += 1
            out.append(row)
        return out, changed

    def _migrate_list(dataset_name: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        nonlocal changed_total
        migrated: list[dict[str, Any]] = []
        changed = 0
        for row in rows:
            # Postgres JSONB can contain values such as Decimal; use a safe dump for change detection.
            before = json.dumps(row, sort_keys=True, ensure_ascii=True, default=str)
            after_obj = _deep_replace_product_ids(row, mapping)
            after_obj, backfilled = _backfill_snapshot_products(after_obj)
            if backfilled:
                changed += 1
            after = json.dumps(after_obj, sort_keys=True, ensure_ascii=True, default=str)
            if before != after:
                changed += 1
            migrated.append(after_obj if isinstance(after_obj, dict) else row)
        details[dataset_name] = changed
        changed_total += changed
        return migrated

    # 1) verkoopprijzen (includes verkoopstrategie records)
    verkoop_rows = _load_postgres_dataset("verkoopprijzen")
    if isinstance(verkoop_rows, list):
        verkoop_dicts = [row for row in verkoop_rows if isinstance(row, dict)]
        verkoop_backfilled, verkoop_changed = _backfill_verkoop_records(verkoop_dicts)
        details["verkoopprijzen_backfill"] = verkoop_changed
        changed_total += verkoop_changed
        migrated = _migrate_list("verkoopprijzen", verkoop_backfilled)
        if not dry_run:
            _save_postgres_dataset("verkoopprijzen", migrated)

    # 2) prijsvoorstellen
    quote_rows = _load_postgres_dataset("prijsvoorstellen")
    if isinstance(quote_rows, list):
        migrated = _migrate_list("prijsvoorstellen", [row for row in quote_rows if isinstance(row, dict)])
        if not dry_run:
            _save_postgres_dataset("prijsvoorstellen", migrated)

    # 3) kostprijsversies (incl. nested invoice lines that may contain product ids)
    version_rows = _load_postgres_dataset("kostprijsversies")
    if isinstance(version_rows, list):
        migrated = _migrate_list("kostprijsversies", [row for row in version_rows if isinstance(row, dict)])
        # If we still can't map some snapshot rows to master products, fail before persisting.
        # Otherwise save_kostprijsversies() will (correctly) reject records without product_id,
        # but that would surface as a confusing "run migration" loop.
        if unresolved_snapshot_refs:
            unique = {(item.get("kind", ""), item.get("verpakking", "")) for item in unresolved_snapshot_refs}
            examples = [{"kind": k, "verpakking": v} for (k, v) in sorted(unique) if v][:15]
            details["unresolved_snapshot_refs"] = len(unique)
            details["unresolved_snapshot_refs_examples"] = 1 if examples else 0
            details["unresolved_snapshot_refs_examples_payload"] = examples
            if not dry_run:
                raise ValueError(
                    "Kon niet alle kostprijs snapshot productregels mappen naar bestaande producten. "
                    "Controleer of de bijbehorende basis-/samengestelde producten bestaan met dezelfde omschrijving. "
                    f"Voorbeelden: {examples}"
                )
        if not dry_run:
            save_kostprijsversies(migrated)

    # 4) kostprijsproductactiveringen live in their own table; rewrite via replace semantics.
    activations = load_kostprijsproductactiveringen()
    migrated_activations = _migrate_list(
        "kostprijsproductactiveringen",
        [row for row in activations if isinstance(row, dict)],
    )
    if not dry_run:
        save_kostprijsproductactiveringen(
            migrated_activations,
            context={"action": "migrate_product_ids"},
        )

    return {"changed": changed_total, "details": details}

