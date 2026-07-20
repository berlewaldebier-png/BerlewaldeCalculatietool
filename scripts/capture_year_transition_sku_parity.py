from __future__ import annotations

import argparse
from collections import defaultdict
from decimal import Decimal
import hashlib
import json
import os
import re
from typing import Any

try:
    from scripts.capture_active_commercial_context import (
        aliases,
        as_dict,
        as_list,
        validate_capture_target,
    )
except ModuleNotFoundError:  # Direct `python scripts/...py` execution.
    from capture_active_commercial_context import (  # type: ignore[no-redef]
        aliases,
        as_dict,
        as_list,
        validate_capture_target,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture a read-only, pseudonymized RF-010C year-transition parity input."
    )
    parser.add_argument("--source-year", type=int, required=True)
    parser.add_argument("--target-year", type=int, required=True)
    parser.add_argument(
        "--allow-private-development-host",
        action="store_true",
        help="Permit the documented private development host only in local/dev/development.",
    )
    parser.add_argument(
        "--acknowledge-pseudonymous-structure",
        action="store_true",
        help=(
            "Acknowledge that stdout contains only pseudonymous IDs, booleans and nested hashes. "
            "Pipe it directly into the RF-010C TypeScript fingerprint runner; do not commit it."
        ),
    )
    return parser.parse_args()


def stable_json(value: Any) -> str:
    def normalize(item: Any) -> Any:
        if isinstance(item, Decimal):
            return float(item)
        if isinstance(item, dict):
            return {str(key): normalize(item[key]) for key in sorted(item)}
        if isinstance(item, (list, tuple)):
            return [normalize(child) for child in item]
        if hasattr(item, "isoformat"):
            return item.isoformat()
        return item

    return json.dumps(normalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def fingerprint(value: Any, domain: str) -> str:
    digest = hashlib.sha256(f"rf010c:{domain}:".encode("utf-8") + stable_json(value).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def text(value: Any) -> str:
    return str(value or "").strip()


def number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def normalized_label(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text(value).casefold()).strip()


def main() -> None:
    args = parse_args()
    if args.source_year <= 0 or args.target_year <= args.source_year:
        raise SystemExit("RF-010C requires target-year > source-year > 0.")
    host = os.getenv("CALCULATIETOOL_POSTGRES_HOST", "").strip().lower()
    environment = os.getenv("CALCULATIETOOL_ENV", "local").strip().lower()
    validate_capture_target(
        host,
        environment,
        allow_private_development_host=args.allow_private_development_host,
    )
    if not args.acknowledge_pseudonymous_structure:
        raise SystemExit(
            "Refusing RF-010C capture: pass --acknowledge-pseudonymous-structure and pipe stdout "
            "directly into the fingerprint runner."
        )

    import psycopg

    with psycopg.connect(
        host=os.environ["CALCULATIETOOL_POSTGRES_HOST"],
        port=os.getenv("CALCULATIETOOL_POSTGRES_PORT", "5432"),
        dbname=os.environ["CALCULATIETOOL_POSTGRES_DB"],
        user=os.environ["CALCULATIETOOL_POSTGRES_USER"],
        password=os.environ["CALCULATIETOOL_POSTGRES_PASSWORD"],
        autocommit=True,
    ) as connection:
        with connection.transaction():
            connection.execute("SET TRANSACTION READ ONLY")
            read_only = connection.execute("SHOW transaction_read_only").fetchone()
            if not read_only or str(read_only[0]).lower() != "on":
                raise RuntimeError("RF-010C capture transaction is not read-only.")
            captured = capture(connection, source_year=args.source_year, target_year=args.target_year)

    print(json.dumps(captured, ensure_ascii=False, sort_keys=False))


def capture(connection: Any, *, source_year: int, target_year: int) -> dict[str, Any]:
    sku_rows = connection.execute(
        """
        SELECT id, kind, beer_id, format_article_id, article_id, code, name, active,
               cost_origin, cost_parent_sku_id, cost_parent_quantity, payload
        FROM skus
        ORDER BY id
        """
    ).fetchall()
    article_rows = connection.execute(
        """
        SELECT id, code, name, kind, uom, content_liter, active, payload
        FROM articles
        ORDER BY id
        """
    ).fetchall()
    bom_rows = connection.execute(
        """
        SELECT id, parent_article_id, component_article_id, component_sku_id,
               quantity, uom, scrap_pct, payload
        FROM bom_lines
        ORDER BY parent_article_id, id
        """
    ).fetchall()
    version_rows = connection.execute(
        """
        SELECT id, jaar, status, bier_id, payload
        FROM cost_versions
        WHERE jaar = ANY(%s)
        ORDER BY jaar, id
        """,
        ([source_year, target_year],),
    ).fetchall()
    cost_rows = connection.execute(
        """
        SELECT r.id, r.version_id, r.sku_id, r.inkoop, r.verpakkingskosten,
               r.indirecte_kosten, r.accijns, r.kostprijs, r.verpakking_label
        FROM cost_version_sku_rows r
        JOIN cost_versions v ON v.id = r.version_id
        WHERE v.jaar = ANY(%s)
        ORDER BY r.version_id, r.sku_id, r.id
        """,
        ([source_year, target_year],),
    ).fetchall()
    activation_rows = connection.execute(
        """
        SELECT sku_id, jaar, kostprijsversie_id
        FROM kostprijs_sku_activations
        WHERE jaar = ANY(%s) AND effectief_tot IS NULL
        ORDER BY jaar, sku_id, kostprijsversie_id
        """,
        ([source_year, target_year],),
    ).fetchall()
    sales_rows = connection.execute(
        """
        SELECT payload
        FROM sales_pricing_records
        WHERE jaar = ANY(%s)
        ORDER BY jaar, id
        """,
        ([source_year, target_year],),
    ).fetchall()
    channel_dataset = connection.execute(
        "SELECT payload FROM app_datasets WHERE dataset_name = 'channels'"
    ).fetchone()
    mappings_available = connection.execute(
        "SELECT to_regclass('public.douano_product_mapping')"
    ).fetchone()
    mapping_rows = []
    if mappings_available and mappings_available[0]:
        mapping_rows = connection.execute(
            "SELECT douano_product_id, sku_id FROM douano_product_mapping ORDER BY sku_id, douano_product_id"
        ).fetchall()

    raw_skus: dict[str, dict[str, Any]] = {}
    for row in sku_rows:
        (
            sku_id_raw,
            kind,
            beer_id_raw,
            format_article_id,
            article_id_raw,
            code,
            name,
            active,
            cost_origin,
            cost_parent_sku_id,
            cost_parent_quantity,
            payload,
        ) = row
        raw_skus[str(sku_id_raw)] = {
            "id": str(sku_id_raw),
            "kind": text(kind),
            "beer_id": text(beer_id_raw),
            "format_article_id": text(format_article_id),
            "article_id": text(article_id_raw),
            "code": text(code),
            "name": text(name),
            "active": bool(active),
            "cost_origin": text(cost_origin),
            "cost_parent_sku_id": text(cost_parent_sku_id),
            "cost_parent_quantity": number(cost_parent_quantity),
            "payload": as_dict(payload),
        }

    raw_articles = {
        str(row[0]): {
            "id": str(row[0]),
            "code": text(row[1]),
            "name": text(row[2]),
            "kind": text(row[3]),
            "uom": text(row[4]),
            "content_liter": number(row[5]),
            "active": bool(row[6]),
            "payload": as_dict(row[7]),
        }
        for row in article_rows
    }
    raw_versions = {
        str(row[0]): {
            "id": str(row[0]),
            "year": int(row[1] or 0),
            "status": text(row[2]),
            "beer_id": text(row[3]),
            "payload": as_dict(row[4]),
        }
        for row in version_rows
    }
    raw_cost_rows = {
        (str(row[1]), str(row[2])): {
            "id": str(row[0]),
            "version_id": str(row[1]),
            "sku_id": str(row[2]),
            "primary": number(row[3]),
            "packaging": number(row[4]),
            "overhead": number(row[5]),
            "excise": number(row[6]),
            "cost": number(row[7]),
            "label": text(row[8]),
        }
        for row in cost_rows
    }

    all_sku_ids = list(raw_skus) + [str(row[0]) for row in activation_rows]
    all_article_ids = list(raw_articles)
    all_version_ids = list(raw_versions) + [str(row[2]) for row in activation_rows]
    all_cost_row_ids = [str(row[0]) for row in cost_rows]
    all_beer_ids = [row["beer_id"] for row in raw_skus.values()] + [row["beer_id"] for row in raw_versions.values()]
    sku_alias = aliases(all_sku_ids, "sku")
    article_alias = aliases(all_article_ids, "article")
    version_alias = aliases(all_version_ids, "version")
    cost_row_alias = aliases(all_cost_row_ids, "cost-row")
    beer_alias = aliases(all_beer_ids, "beer")

    bom_by_parent: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in bom_rows:
        parent = text(row[1])
        if not parent:
            continue
        bom_by_parent[parent].append(
            {
                "componentArticleId": article_alias.get(text(row[2]), ""),
                "componentSkuId": sku_alias.get(text(row[3]), ""),
                "quantity": number(row[4]),
                "uom": text(row[5]),
                "scrapPct": number(row[6]),
                "payloadFingerprint": fingerprint(as_dict(row[7]), "bom-payload"),
            }
        )

    mappings_by_sku: dict[str, list[int]] = defaultdict(list)
    for external_id, raw_sku_id in mapping_rows:
        mappings_by_sku[str(raw_sku_id)].append(int(external_id or 0))

    raw_channels = [
        as_dict(row)
        for row in as_list(channel_dataset[0] if channel_dataset else [])
        if isinstance(row, (dict, str))
    ]
    active_channel_codes = sorted(
        {
            text(row.get("code", row.get("id"))).lower()
            for row in raw_channels
            if row.get("actief", row.get("active", True)) is not False
            and text(row.get("code", row.get("id")))
        }
    )
    channel_alias = aliases(active_channel_codes, "channel")
    required_channels = [channel_alias[code] for code in active_channel_codes]

    pricing_ready: dict[tuple[int, str], set[str]] = defaultdict(set)
    for (payload,) in sales_rows:
        row = as_dict(payload)
        year = int(row.get("jaar", 0) or 0)
        raw_sku_id = text(row.get("sku_id"))
        candidate_skus: list[str] = []
        if raw_sku_id in raw_skus:
            candidate_skus = [raw_sku_id]
        else:
            raw_beer_id = text(row.get("bier_id"))
            raw_product_id = text(row.get("product_id"))
            candidate_skus = [
                sku_id_raw
                for sku_id_raw, sku in raw_skus.items()
                if (not raw_beer_id or sku["beer_id"] == raw_beer_id)
                and raw_product_id in {sku["format_article_id"], sku["article_id"]}
            ]
        prices = as_dict(row.get("sell_in_prices"))
        margins = as_dict(row.get("sell_in_margins"))
        for code in active_channel_codes:
            price_ready = number(prices.get(code)) > 0 or number(prices.get("list")) > 0
            margin_present = code in margins and isinstance(margins.get(code), (int, float, Decimal))
            if not price_ready and not margin_present:
                continue
            for sku_id_raw in candidate_skus:
                pricing_ready[(year, sku_id_raw)].add(channel_alias[code])

    def product_id_for(sku: dict[str, Any]) -> str:
        return text(sku.get("format_article_id")) or text(sku.get("article_id"))

    def classification_for(sku: dict[str, Any]) -> str:
        origin = text(sku.get("cost_origin") or sku.get("payload", {}).get("cost_origin")).lower()
        kind = text(sku.get("kind")).lower()
        product_id_raw = product_id_for(sku)
        payload = sku.get("payload", {}) if isinstance(sku.get("payload"), dict) else {}
        subtype = text(payload.get("sellable_subtype")).lower()
        pricing_method = text(payload.get("pricing_method")).lower()
        if origin == "derived_from_parent":
            return "variant"
        if origin == "composed_sellable" or product_id_raw in bom_by_parent:
            return "composed"
        if pricing_method == "manual_rate" or subtype in {"service", "dienst"}:
            return "service"
        if kind == "article":
            return "article"
        if kind == "beer_format":
            return "basis"
        return "unknown"

    def provenance_for(version: dict[str, Any]) -> dict[str, Any]:
        details = version.get("payload", {}) if isinstance(version.get("payload"), dict) else {}
        transition = as_dict(details.get("jaarovergang"))
        transition_source_year = int(transition.get("bron_jaar", 0) or 0)
        if transition_source_year > 0:
            return {"kind": "recalculated_from_year", "sourceYear": transition_source_year}
        cost_source = text(details.get("cost_source", details.get("source"))).lower()
        version_type = text(details.get("type", as_dict(details.get("soort_berekening")).get("type"))).lower()
        if "invoice" in cost_source or "factuur" in cost_source or version_type == "inkoop":
            return {"kind": "purchase_invoice", "sourceYear": None}
        if "brew" in cost_source or "brouw" in cost_source:
            return {"kind": "brew_moment", "sourceYear": None}
        return {"kind": "initial_calculation", "sourceYear": None}

    def manifest_for(year: int) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for raw_sku_id, activation_year, raw_version_id in activation_rows:
            if int(activation_year or 0) != year:
                continue
            raw_sku_key = str(raw_sku_id)
            raw_version_key = str(raw_version_id)
            sku = raw_skus.get(raw_sku_key)
            version = raw_versions.get(raw_version_key)
            sku = sku or {}
            version = version or {}
            product_id_raw = product_id_for(sku)
            article = raw_articles.get(product_id_raw, {})
            cost_row = raw_cost_rows.get((raw_version_key, raw_sku_key))
            transition = as_dict(version.get("payload", {}).get("jaarovergang"))
            source_version_raw = text(transition.get("bron_berekening_id"))
            bom_fingerprint = fingerprint(
                sorted(bom_by_parent.get(product_id_raw, []), key=stable_json),
                "bom",
            )
            cost_components = (
                {
                    "primary": cost_row["primary"],
                    "packaging": cost_row["packaging"],
                    "overhead": cost_row["overhead"],
                    "excise": cost_row["excise"],
                    "cost": cost_row["cost"],
                }
                if cost_row
                else {"missing": True}
            )
            result.append(
                {
                    "skuId": sku_alias.get(raw_sku_key, ""),
                    "beerId": beer_alias.get(text(sku.get("beer_id")) or text(version.get("beer_id")), ""),
                    "productId": article_alias.get(product_id_raw, ""),
                    "kind": text(sku.get("kind")),
                    "classification": classification_for(sku),
                    "bomFingerprint": bom_fingerprint,
                    "externalMappingFingerprint": fingerprint(
                        sorted(mappings_by_sku.get(raw_sku_key, [])),
                        "external-mapping",
                    ),
                    "labelFingerprint": fingerprint(
                        normalized_label((cost_row or {}).get("label") or sku.get("name") or article.get("name")),
                        "label",
                    ),
                    "planningCostVersionId": version_alias.get(raw_version_key, ""),
                    "planningCostRowId": cost_row_alias.get(text((cost_row or {}).get("id")), ""),
                    "sourcePlanningCostVersionId": version_alias.get(source_version_raw, ""),
                    "componentFingerprint": fingerprint(cost_components, "cost-components"),
                    "activated": True,
                    "costPositive": bool(cost_row and number(cost_row.get("cost")) > 0),
                    "litersPositive": number(article.get("content_liter")) > 0,
                    "sellInReadyChannels": sorted(pricing_ready.get((year, raw_sku_key), set())),
                    "provenance": provenance_for(version),
                }
            )
        return sorted(result, key=lambda row: (row["skuId"], row["planningCostVersionId"]))

    source_manifest = manifest_for(source_year)
    target_manifest = manifest_for(target_year)
    source_sku_ids = {row["skuId"] for row in source_manifest}
    for row in target_manifest:
        row["sourceSkuIds"] = [row["skuId"]] if row["skuId"] in source_sku_ids else []

    ui_projection: list[dict[str, str]] = []
    for raw_sku_id, sku in raw_skus.items():
        product_id_raw = product_id_for(sku)
        # Reconstruct only the fan-out cardinality; group labels remain pseudonymous.
        raw_component_beers: set[str] = set()
        for bom_row in bom_rows:
            if text(bom_row[1]) != product_id_raw:
                continue
            component_sku = raw_skus.get(text(bom_row[3]), {})
            component_beer = text(component_sku.get("beer_id"))
            if component_beer:
                raw_component_beers.add(component_beer)
        groups = sorted(raw_component_beers) or [text(sku.get("beer_id")) or f"sku:{raw_sku_id}"]
        for raw_group in groups:
            ui_projection.append(
                {
                    "skuId": sku_alias.get(raw_sku_id, ""),
                    "groupKey": beer_alias.get(raw_group, fingerprint(raw_group, "group")),
                }
            )

    format_expectations: list[dict[str, Any]] = []
    active_beers = sorted({row["beerId"] for row in source_manifest if row["beerId"]})
    source_by_beer: dict[str, list[dict[str, Any]]] = defaultdict(list)
    raw_by_alias = {sku_alias.get(raw_id, ""): sku for raw_id, sku in raw_skus.items()}
    for row in source_manifest:
        source_by_beer[row["beerId"]].append(row)
    for beer_id_value in active_beers:
        rows = source_by_beer.get(beer_id_value, [])
        for format_code in ("box_24x33", "keg"):
            matched_sku: str | None = None
            for manifest_row in rows:
                sku = raw_by_alias.get(manifest_row["skuId"], {})
                product = raw_articles.get(product_id_for(sku), {})
                label = normalized_label(f"{sku.get('name', '')} {product.get('name', '')}")
                if format_code == "box_24x33":
                    is_match = ("24" in label and ("33cl" in label or "33 cl" in label)) and ("doos" in label or "box" in label)
                else:
                    is_match = "fust" in label or "keg" in label
                if is_match:
                    matched_sku = manifest_row["skuId"]
                    break
            format_expectations.append(
                {"beerId": beer_id_value, "formatCode": format_code, "skuId": matched_sku}
            )

    def snapshot_matches(version: dict[str, Any], raw_sku_id: str, raw_product_id: str) -> tuple[str, list[dict[str, Any]]]:
        snapshot = as_dict(version.get("payload", {}).get("resultaat_snapshot"))
        products = as_dict(snapshot.get("producten"))
        matches: list[tuple[str, dict[str, Any]]] = []
        for category_key, category in (("basisproducten", "basis"), ("samengestelde_producten", "composed")):
            for raw_row in as_list(products.get(category_key)):
                row = as_dict(raw_row)
                if text(row.get("sku_id")) == raw_sku_id or (
                    raw_product_id and text(row.get("product_id")) == raw_product_id
                ):
                    matches.append((category, row))
        if not matches:
            return "none", []
        categories = {category for category, _row in matches}
        return (next(iter(categories)) if len(categories) == 1 else "ambiguous"), [row for _category, row in matches]

    def semantic_snapshot_fingerprint(rows: list[dict[str, Any]]) -> str:
        normalized = []
        for row in rows:
            normalized.append(
                {
                    "primary": number(row.get("primaire_kosten", row.get("inkoop"))),
                    "packaging": number(row.get("verpakkingskosten")),
                    "overhead": number(row.get("indirecte_kosten", row.get("vaste_kosten"))),
                    "excise": number(row.get("accijns")),
                    "cost": number(row.get("kostprijs")),
                }
            )
        return fingerprint(normalized, "historical-semantic")

    dossiers: list[dict[str, Any]] = []
    seen_dossiers: set[tuple[str, str]] = set()
    for raw_sku_id, _year, raw_version_id in activation_rows:
        pair = (str(raw_version_id), str(raw_sku_id))
        if pair in seen_dossiers:
            continue
        seen_dossiers.add(pair)
        sku = raw_skus.get(str(raw_sku_id))
        version = raw_versions.get(str(raw_version_id))
        if not sku or not version:
            continue
        product_id_raw = product_id_for(sku)
        original_category, original_rows = snapshot_matches(version, str(raw_sku_id), product_id_raw)
        canonical = raw_cost_rows.get(pair)
        normalized_rows = (
            [
                {
                    "primaire_kosten": canonical["primary"],
                    "verpakkingskosten": canonical["packaging"],
                    "indirecte_kosten": canonical["overhead"],
                    "accijns": canonical["excise"],
                    "kostprijs": canonical["cost"],
                }
            ]
            if canonical
            else []
        )
        dossiers.append(
            {
                "versionId": version_alias.get(str(raw_version_id), ""),
                "skuId": sku_alias.get(str(raw_sku_id), ""),
                "originalCategory": original_category,
                "normalizedCategory": "basis" if canonical else "none",
                "originalFingerprint": semantic_snapshot_fingerprint(original_rows),
                "normalizedFingerprint": semantic_snapshot_fingerprint(normalized_rows),
            }
        )

    return {
        "sourceYear": int(source_year),
        "targetYear": int(target_year),
        "requiredChannels": required_channels,
        "sourceRows": source_manifest,
        "targetRows": target_manifest,
        "currentUiProjection": sorted(ui_projection, key=lambda row: (row["skuId"], row["groupKey"])),
        "formatExpectations": sorted(format_expectations, key=lambda row: (row["beerId"], row["formatCode"])),
        "historicalDossiers": sorted(dossiers, key=lambda row: (row["versionId"], row["skuId"])),
    }


if __name__ == "__main__":
    main()
