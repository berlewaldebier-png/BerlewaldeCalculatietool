from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal
from ipaddress import ip_address
import json
import os
from typing import Any, Iterable


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
YEARS = {2025, 2026}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture an anonymized, read-only RF-010A commercial-context fixture."
    )
    parser.add_argument("--baseline-commit", required=True)
    parser.add_argument("--captured-at", default=date.today().isoformat())
    parser.add_argument(
        "--allow-private-development-host",
        action="store_true",
        help=(
            "Permit an RFC-1918/RFC-4193 database host only when CALCULATIETOOL_ENV "
            "is explicitly local/dev/development. Use this for the documented development "
            "database; production-like environments remain forbidden."
        ),
    )
    parser.add_argument(
        "--acknowledge-commercial-values",
        action="store_true",
        help=(
            "Acknowledge that pseudonymized output still contains commercially sensitive "
            "numeric values. Pipe it directly into the local fingerprint runner; do not commit it."
        ),
    )
    return parser.parse_args()


def json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    return value


def as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[Any]:
    if isinstance(value, str):
        value = json.loads(value)
    return value if isinstance(value, list) else []


def aliases(values: Iterable[Any], prefix: str) -> dict[str, str]:
    normalized = sorted({str(value or "").strip() for value in values if str(value or "").strip()})
    width = max(3, len(str(len(normalized))))
    return {value: f"{prefix}-{index:0{width}d}" for index, value in enumerate(normalized, start=1)}


def validate_capture_target(
    host: str,
    environment: str,
    *,
    allow_private_development_host: bool,
) -> None:
    normalized_host = host.strip().lower()
    normalized_environment = environment.strip().lower()
    if normalized_environment not in {"local", "dev", "development"}:
        raise SystemExit(
            "Refusing RF-010A capture: CALCULATIETOOL_ENV must explicitly be local, dev or development."
        )
    if normalized_host in LOOPBACK_HOSTS:
        return
    try:
        private_address = ip_address(normalized_host).is_private
    except ValueError:
        private_address = False
    if private_address and allow_private_development_host:
        return
    raise SystemExit(
        "Refusing RF-010A capture: PostgreSQL host is not loopback. "
        "The documented private development host requires --allow-private-development-host."
    )


def main() -> None:
    args = parse_args()
    host = os.getenv("CALCULATIETOOL_POSTGRES_HOST", "").strip().lower()
    environment = os.getenv("CALCULATIETOOL_ENV", "local").strip().lower()
    validate_capture_target(
        host,
        environment,
        allow_private_development_host=args.allow_private_development_host,
    )
    if not args.acknowledge_commercial_values:
        raise SystemExit(
            "Refusing RF-010A capture: pass --acknowledge-commercial-values and pipe stdout "
            "directly into the local fingerprint runner. Never commit the raw capture."
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
                raise RuntimeError("RF-010A capture transaction is not read-only.")
            fixture = capture(connection, args)

    print(json.dumps(fixture, indent=2, ensure_ascii=False, sort_keys=False))


def capture(connection: Any, args: argparse.Namespace) -> dict[str, Any]:
    app_rows = connection.execute(
        """
        SELECT dataset_name, payload
        FROM app_datasets
        WHERE dataset_name = ANY(%s)
        ORDER BY dataset_name
        """,
        (["bieren", "channels", "packaging-component-prices"],),
    ).fetchall()
    app_datasets = {str(name): value for name, value in app_rows}
    beers_raw = [as_dict(row) for row in as_list(app_datasets.get("bieren"))]
    channels_raw = [as_dict(row) for row in as_list(app_datasets.get("channels"))]
    packaging_prices_raw = [as_dict(row) for row in as_list(app_datasets.get("packaging-component-prices"))]

    sku_rows = connection.execute(
        """
        SELECT id, kind, beer_id, format_article_id, article_id, active,
               cost_origin, cost_parent_sku_id, cost_parent_quantity, payload
        FROM skus
        ORDER BY id
        """
    ).fetchall()
    article_rows = connection.execute(
        """
        SELECT id, kind, uom, content_liter, active, payload
        FROM articles
        ORDER BY id
        """
    ).fetchall()
    version_rows = connection.execute(
        """
        SELECT id, jaar, status, bier_id, versie_nummer, created_at, updated_at, finalized_at, payload
        FROM cost_versions
        WHERE jaar = ANY(%s)
        ORDER BY jaar, id
        """,
        (sorted(YEARS),),
    ).fetchall()
    cost_rows = connection.execute(
        """
        SELECT r.id, r.version_id, r.sku_id, r.inkoop, r.verpakkingskosten,
               r.indirecte_kosten, r.accijns, r.kostprijs, r.sort_index
        FROM cost_version_sku_rows r
        JOIN cost_versions v ON v.id = r.version_id
        WHERE v.jaar = ANY(%s)
        ORDER BY v.jaar, r.version_id, r.sort_index, r.id
        """,
        (sorted(YEARS),),
    ).fetchall()
    activation_rows = connection.execute(
        """
        SELECT id, sku_id, jaar, kostprijsversie_id, effectief_vanaf,
               effectief_tot, created_at, updated_at
        FROM kostprijs_sku_activations
        WHERE jaar = ANY(%s)
        ORDER BY jaar, sku_id, effectief_vanaf, id
        """,
        (sorted(YEARS),),
    ).fetchall()
    verkoop_rows = [
        as_dict(row[0])
        for row in connection.execute(
            "SELECT payload FROM sales_pricing_records WHERE jaar = ANY(%s) ORDER BY jaar, id",
            (sorted(YEARS),),
        ).fetchall()
    ]
    advice_rows = connection.execute(
        """
        SELECT id, jaar, channel_code, opslag_pct
        FROM advice_channel_pricing
        WHERE jaar = ANY(%s)
        ORDER BY jaar, channel_code, id
        """,
        (sorted(YEARS),),
    ).fetchall()
    quote_rows = connection.execute(
        """
        SELECT id, year, status, payload
        FROM quote_drafts
        WHERE year = ANY(%s)
        ORDER BY year, created_at, id
        """,
        (sorted(YEARS),),
    ).fetchall()
    plan_rows = connection.execute(
        """
        SELECT id, jaar, status, source, payload
        FROM break_even_plan_snapshots
        WHERE jaar = ANY(%s) AND status = 'active'
        ORDER BY jaar, id
        """,
        (sorted(YEARS),),
    ).fetchall()
    actual_snapshot_rows = connection.execute(
        """
        SELECT source_type, source_line_id, line_date, company_id,
               douano_product_id, sku_id, bier_id, product_id,
               lot_number, lot_internal_number, lot_transaction_number,
               cost_source, cost_status, kostprijsversie_id,
               quantity, net_revenue_ex, cost_price_ex, cost_total_ex,
               margin_ex, missing_cost, mapped, ignored
        FROM douano_sales_line_cost_snapshots
        WHERE EXTRACT(YEAR FROM line_date)::INTEGER = ANY(%s)
        ORDER BY line_date, source_type, source_line_id
        """,
        (sorted(YEARS),),
    ).fetchall()

    sku_ids = [row[0] for row in sku_rows]
    article_ids = [row[0] for row in article_rows]
    version_ids = [row[0] for row in version_rows]
    beer_ids = [row.get("id") for row in beers_raw]
    beer_ids.extend(row[2] for row in sku_rows)
    beer_ids.extend(row[3] for row in version_rows)
    product_ids = [row.get("product_id") for row in verkoop_rows]
    product_ids.extend(row[3] for row in sku_rows)
    product_ids.extend(row[4] for row in sku_rows)

    sku_alias = aliases(sku_ids, "sku")
    article_alias = aliases(article_ids, "article")
    unknown_product_alias = aliases(
        [value for value in product_ids if str(value or "").strip() not in article_alias],
        "product",
    )
    version_alias = aliases(version_ids, "cost-version")
    beer_alias = aliases(beer_ids, "beer")
    quote_alias = aliases([row[0] for row in quote_rows], "quote")
    plan_alias = aliases([row[0] for row in plan_rows], "plan")
    actual_line_alias = aliases(
        [f"{row[0]}:{row[1]}" for row in actual_snapshot_rows],
        "actual-line",
    )
    company_alias = aliases([row[3] for row in actual_snapshot_rows], "company")
    external_product_alias = aliases(
        [row[4] for row in actual_snapshot_rows],
        "external-product",
    )
    lot_alias = aliases(
        [value for row in actual_snapshot_rows for value in row[8:11]],
        "lot",
    )

    def sku_id(value: Any) -> str:
        return sku_alias.get(str(value or "").strip(), "")

    def article_id(value: Any) -> str:
        raw = str(value or "").strip()
        return article_alias.get(raw) or unknown_product_alias.get(raw, "")

    def version_id(value: Any) -> str:
        return version_alias.get(str(value or "").strip(), "")

    def beer_id(value: Any) -> str:
        return beer_alias.get(str(value or "").strip(), "")

    skus: list[dict[str, Any]] = []
    sku_product_raw: dict[str, str] = {}
    for raw_id, kind, raw_beer, format_article, raw_article, active, cost_origin, parent_sku, parent_qty, payload in sku_rows:
        details = as_dict(payload)
        product_raw = str(format_article or raw_article or "")
        sku_product_raw[str(raw_id)] = product_raw
        skus.append(
            {
                "id": sku_id(raw_id),
                "kind": str(kind or ""),
                "beer_id": beer_id(raw_beer),
                "format_article_id": article_id(format_article),
                "article_id": article_id(raw_article),
                "name": f"SKU {sku_id(raw_id).split('-')[-1]}",
                "active": bool(active),
                "cost_origin": str(cost_origin or details.get("cost_origin", "") or ""),
                "cost_parent_sku_id": sku_id(parent_sku),
                "cost_parent_quantity": float(parent_qty or 0),
                "pricing_method": str(details.get("pricing_method", "") or ""),
                "sellable_subtype": str(details.get("sellable_subtype", "") or ""),
                "product_group": str(details.get("product_group", "") or ""),
                "packaging_type": str(details.get("packaging_type", "") or ""),
                "manual_rate_ex": float(details.get("manual_rate_ex", 0) or 0),
            }
        )

    articles: list[dict[str, Any]] = []
    for raw_id, kind, uom, content_liter, active, payload in article_rows:
        details = as_dict(payload)
        articles.append(
            {
                "id": article_id(raw_id),
                "kind": str(kind or ""),
                "name": f"Article {article_id(raw_id).split('-')[-1]}",
                "uom": str(uom or "stuk"),
                "content_liter": float(content_liter or 0),
                "active": bool(active),
                "beschikbaar_voor_offertes": bool(details.get("beschikbaar_voor_offertes", False)),
                "pricing_method": str(details.get("pricing_method", "") or ""),
                "sellable_subtype": str(details.get("sellable_subtype", "") or ""),
                "product_group": str(details.get("product_group", "") or ""),
                "packaging_type": str(details.get("packaging_type", "") or ""),
                "manual_rate_ex": float(details.get("manual_rate_ex", 0) or 0),
            }
        )

    beers = [
        {
            "id": beer_id(row.get("id")),
            "biernaam": f"Beer {beer_id(row.get('id')).split('-')[-1]}",
            "active": row.get("active", row.get("actief", True)) is not False,
            "btw_tarief": str(row.get("btw_tarief", row.get("btw", "")) or ""),
        }
        for row in beers_raw
        if beer_id(row.get("id"))
    ]
    channels = [
        {
            "code": str(row.get("code", row.get("id", "")) or "").strip().lower(),
            "label": f"Channel {index:02d}",
            "actief": row.get("actief", row.get("active", True)) is not False,
            "volgorde": int(row.get("volgorde", 0) or 0),
            "default_marge_pct": float(row.get("default_marge_pct", row.get("default_marge", 0)) or 0),
        }
        for index, row in enumerate(channels_raw, start=1)
        if str(row.get("code", row.get("id", "")) or "").strip()
    ]

    cost_lines_by_version: dict[str, list[dict[str, Any]]] = defaultdict(list)
    raw_sku_by_id = {str(row[0]): row for row in sku_rows}
    canonical_cost_keys_raw = {(str(row[1]), str(row[2])) for row in cost_rows}
    for row_id, raw_version, raw_sku, purchase, packaging, overhead, excise, cost, sort_index in cost_rows:
        raw_product = sku_product_raw.get(str(raw_sku), "")
        kind = str((raw_sku_by_id.get(str(raw_sku)) or [None, ""])[1] or "")
        cost_lines_by_version[str(raw_version)].append(
            {
                "sku_id": sku_id(raw_sku),
                "product_id": article_id(raw_product),
                "product_type": "article" if kind == "article" else "sku",
                "primaire_kosten": float(purchase or 0),
                "inkoop": float(purchase or 0),
                "verpakkingskosten": float(packaging or 0),
                "indirecte_kosten": float(overhead or 0),
                "vaste_kosten": float(overhead or 0),
                "vaste_directe_kosten": float(overhead or 0),
                "accijns": float(excise or 0),
                "kostprijs": float(cost or 0),
            }
        )

    active_skus_by_version_raw: dict[str, list[str]] = defaultdict(list)
    for _activation_id, raw_sku, _year, raw_version, *_rest in activation_rows:
        active_skus_by_version_raw[str(raw_version)].append(str(raw_sku))

    fallback_snapshot_rows_by_version: dict[str, dict[str, list[dict[str, Any]]]] = {}
    fallback_snapshot_pairs: set[tuple[str, str]] = set()
    snapshot_numeric_fields = {
        "primaire_kosten",
        "inkoop",
        "verpakkingskosten",
        "indirecte_kosten",
        "vaste_kosten",
        "vaste_directe_kosten",
        "accijns",
        "kostprijs",
        "liters_per_product",
        "totale_inhoud_liter",
        "inhoud_per_eenheid_liter",
    }

    for raw_version_id, _year, _status, _raw_beer, _number, *_version_tail in version_rows:
        raw_version_key = str(raw_version_id)
        version_details = as_dict(_version_tail[-1])
        raw_snapshot = as_dict(
            version_details.get("resultaat_snapshot", version_details.get("resultaatSnapshot"))
        )
        raw_products = as_dict(raw_snapshot.get("producten"))
        categorized_rows = {
            "basisproducten": [as_dict(row) for row in as_list(raw_products.get("basisproducten"))],
            "samengestelde_producten": [
                as_dict(row) for row in as_list(raw_products.get("samengestelde_producten"))
            ],
        }
        selected = {"basisproducten": [], "samengestelde_producten": []}
        seen_snapshot_rows: set[tuple[str, str]] = set()
        for raw_sku in active_skus_by_version_raw.get(raw_version_key, []):
            if (raw_version_key, raw_sku) in canonical_cost_keys_raw:
                continue
            raw_product = sku_product_raw.get(raw_sku, "")
            match: tuple[str, dict[str, Any]] | None = None
            for category, rows in categorized_rows.items():
                by_sku = next(
                    (row for row in rows if str(row.get("sku_id", "") or "") == raw_sku),
                    None,
                )
                if by_sku is not None:
                    match = (category, by_sku)
                    break
            if match is None and raw_product:
                for category, rows in categorized_rows.items():
                    by_product = next(
                        (
                            row
                            for row in rows
                            if str(row.get("product_id", "") or "") == raw_product
                        ),
                        None,
                    )
                    if by_product is not None:
                        match = (category, by_product)
                        break
            if match is None:
                continue
            category, raw_row = match
            sanitized_sku = sku_id(raw_row.get("sku_id") or raw_sku)
            sanitized_product = article_id(raw_row.get("product_id") or raw_product)
            dedupe_key = (sanitized_sku, sanitized_product)
            if dedupe_key not in seen_snapshot_rows:
                sanitized = {
                    "sku_id": sanitized_sku,
                    "product_id": sanitized_product,
                    "product_type": str(raw_row.get("product_type", "") or ""),
                }
                for key in sorted(snapshot_numeric_fields):
                    if key in raw_row:
                        sanitized[key] = float(raw_row.get(key, 0) or 0)
                selected[category].append(sanitized)
                seen_snapshot_rows.add(dedupe_key)
            fallback_snapshot_pairs.add((version_id(raw_version_id), sku_id(raw_sku)))
        if selected["basisproducten"] or selected["samengestelde_producten"]:
            fallback_snapshot_rows_by_version[raw_version_key] = selected

    cost_versions: list[dict[str, Any]] = []
    for raw_id, year, status, raw_beer, number, created_at, updated_at, finalized_at, payload in version_rows:
        details = as_dict(payload)
        basis = as_dict(details.get("basisgegevens"))
        captured_version = {
                "id": version_id(raw_id),
                "jaar": int(year or 0),
                "status": str(status or ""),
                "bier_id": beer_id(raw_beer),
                "versie_nummer": int(number or 0),
                "type": str(details.get("type", "") or ""),
                "kostprijs": float(details.get("kostprijs", 0) or 0),
                "created_at": json_value(created_at),
                "updated_at": json_value(updated_at),
                "finalized_at": json_value(finalized_at),
                "basisgegevens": {
                    "jaar": int(basis.get("jaar", year) or 0),
                    "sku_id": sku_id(basis.get("sku_id")),
                    "article_id": article_id(basis.get("article_id")),
                    "btw_tarief": str(basis.get("btw_tarief", "") or ""),
                    "uom": str(basis.get("uom", "") or ""),
                    "manual_rate_ex": float(basis.get("manual_rate_ex", 0) or 0),
                },
                "cost_lines": cost_lines_by_version.get(str(raw_id), []),
            }
        fallback_snapshot = fallback_snapshot_rows_by_version.get(str(raw_id))
        if fallback_snapshot:
            captured_version["resultaat_snapshot"] = {"producten": fallback_snapshot}
        cost_versions.append(captured_version)

    activations = [
        {
            "id": f"activation-{int(year):04d}-{sku_id(raw_sku)}",
            "sku_id": sku_id(raw_sku),
            "jaar": int(year),
            "kostprijsversie_id": version_id(raw_version),
            "effectief_vanaf": json_value(effective_from),
            "effectief_tot": json_value(effective_to) if effective_to else "",
            "created_at": json_value(created_at),
            "updated_at": json_value(updated_at),
        }
        for _raw_id, raw_sku, year, raw_version, effective_from, effective_to, created_at, updated_at in activation_rows
    ]

    verkoopprijzen: list[dict[str, Any]] = []
    for index, row in enumerate(verkoop_rows, start=1):
        year = int(row.get("jaar", 0) or 0)
        verkoopprijzen.append(
            {
                "id": f"sales-price-{year}-{index:03d}",
                "jaar": year,
                "record_type": str(row.get("record_type", "") or ""),
                "sku_id": sku_id(row.get("sku_id")),
                "bier_id": beer_id(row.get("bier_id")),
                "product_id": article_id(row.get("product_id")),
                "product_type": str(row.get("product_type", "") or ""),
                "strategie_type": str(row.get("strategie_type", "") or ""),
                "sell_in_margins": json_value(as_dict(row.get("sell_in_margins"))),
                "sell_in_prices": json_value(as_dict(row.get("sell_in_prices"))),
                "kanaalmarges": json_value(as_dict(row.get("kanaalmarges"))),
                "kanaalprijzen": json_value(as_dict(row.get("kanaalprijzen"))),
                "kostprijs": float(row.get("kostprijs", 0) or 0),
            }
        )

    advice = [
        {
            "id": f"advice-{int(year)}-{str(channel).strip().lower()}",
            "jaar": int(year),
            "channel_code": str(channel or "").strip().lower(),
            "opslag_pct": float(markup or 0),
        }
        for _raw_id, year, channel, markup in advice_rows
    ]

    packaging_prices = [
        {
            "jaar": int(row.get("jaar", 0) or 0),
            "verpakkingsonderdeel_id": article_id(
                row.get("verpakkingsonderdeel_id", row.get("packaging_component_id"))
            ),
            "prijs_per_stuk": float(row.get("prijs_per_stuk", 0) or 0),
            "is_actief": bool(row.get("is_actief", row.get("is_active", True))),
        }
        for row in packaging_prices_raw
        if int(row.get("jaar", 0) or 0) in YEARS
        and article_id(row.get("verpakkingsonderdeel_id", row.get("packaging_component_id")))
    ]

    historical_quotes = []
    for raw_id, year, status, payload in quote_rows:
        details = as_dict(payload)
        draft = as_dict(details.get("draft"))
        historical_quotes.append(
            {
                "id": quote_alias.get(str(raw_id), ""),
                "column_year": int(year or 0),
                "status": str(status or ""),
                "saved_draft_year": int(draft.get("year", 0) or 0),
                "financial_nodes": collect_financial_nodes(
                    draft.get("scenarios", {}), sku_id=sku_id, article_id=article_id, version_id=version_id
                ),
            }
        )

    plans = []
    for raw_id, year, status, source, payload in plan_rows:
        details = as_dict(payload)
        planning_rows = []
        for row in as_list(details.get("planning_rows")):
            item = as_dict(row)
            planning_rows.append(
                {
                    key: json_value(value)
                    for key, value in item.items()
                    if (
                        key not in {"sku_name", "sku_code"}
                        and (
                            isinstance(value, (int, float, Decimal))
                            or key in {"source", "sku_id", "bier_id", "product_id"}
                        )
                    )
                }
            )
            planning_rows[-1]["sku_id"] = sku_id(item.get("sku_id"))
            if "bier_id" in planning_rows[-1]:
                planning_rows[-1]["bier_id"] = beer_id(item.get("bier_id"))
            if "product_id" in planning_rows[-1]:
                planning_rows[-1]["product_id"] = article_id(item.get("product_id"))
        plans.append(
            {
                "id": plan_alias.get(str(raw_id), ""),
                "jaar": int(year or 0),
                "status": str(status or ""),
                "source": str(source or ""),
                "summary": json_value(as_dict(details.get("summary"))),
                "targets": json_value(as_dict(details.get("targets"))),
                "planning_rows": planning_rows,
            }
        )

    historical_actual_snapshots = []
    for row in actual_snapshot_rows:
        (
            source_type,
            source_line_id,
            line_date,
            company_id,
            external_product_id,
            raw_sku,
            raw_beer,
            raw_product,
            lot_number,
            lot_internal_number,
            lot_transaction_number,
            cost_source,
            cost_status,
            raw_version,
            quantity,
            net_revenue_ex,
            cost_price_ex,
            cost_total_ex,
            margin_ex,
            missing_cost,
            mapped,
            ignored,
        ) = row
        line_key = f"{source_type}:{source_line_id}"
        historical_actual_snapshots.append(
            {
                "id": actual_line_alias.get(line_key, ""),
                "source_type": str(source_type or ""),
                "year": int(line_date.year) if line_date else 0,
                "line_date": json_value(line_date),
                "company_id": company_alias.get(str(company_id or "").strip(), ""),
                "external_product_id": external_product_alias.get(
                    str(external_product_id or "").strip(), ""
                ),
                "sku_id": sku_id(raw_sku),
                "bier_id": beer_id(raw_beer),
                "product_id": article_id(raw_product),
                "lot_number": lot_alias.get(str(lot_number or "").strip(), ""),
                "lot_internal_number": lot_alias.get(
                    str(lot_internal_number or "").strip(), ""
                ),
                "lot_transaction_number": lot_alias.get(
                    str(lot_transaction_number or "").strip(), ""
                ),
                "cost_source": str(cost_source or ""),
                "cost_status": str(cost_status or ""),
                "kostprijsversie_id": version_id(raw_version),
                "quantity": float(quantity or 0),
                "net_revenue_ex": float(net_revenue_ex or 0),
                "cost_price_ex": float(cost_price_ex) if cost_price_ex is not None else None,
                "cost_total_ex": float(cost_total_ex or 0),
                "margin_ex": float(margin_ex or 0),
                "missing_cost": bool(missing_cost),
                "mapped": bool(mapped),
                "ignored": bool(ignored),
            }
        )

    activation_keys = [(row["sku_id"], row["jaar"]) for row in activations]
    activation_duplicates = sorted(
        f"{sku}:{year}" for (sku, year), count in Counter(activation_keys).items() if count > 1
    )
    known_skus = {row["id"] for row in skus}
    known_versions = {row["id"] for row in cost_versions}
    versions_with_cost_line = {
        (version["id"], line["sku_id"])
        for version in cost_versions
        for line in version.get("cost_lines", [])
    }
    missing_cost_lines = [
        {
            "sku_id": row["sku_id"],
            "jaar": row["jaar"],
            "kostprijsversie_id": row["kostprijsversie_id"],
        }
        for row in activations
        if (row["kostprijsversie_id"], row["sku_id"]) not in versions_with_cost_line
    ]
    missing_all_cost_representations = [
        row
        for row in missing_cost_lines
        if (row["kostprijsversie_id"], row["sku_id"]) not in fallback_snapshot_pairs
    ]

    return {
        "schemaVersion": 1,
        "fixtureSet": "RF-010A-active-commercial-context",
        "baselineCommit": str(args.baseline_commit),
        "capturedAt": str(args.captured_at),
        "source": {
            "classification": "read-only-local-development",
            "environment": "local-development",
            "identifiers": "deterministically pseudonymized",
            "names": "redacted",
            "numericValues": "preserved",
        },
        "approval": {
            "status": "pending-human-approval",
            "approvedBy": None,
            "approvedAt": None,
        },
        "audit": {
            "years": sorted(YEARS),
            "counts": {
                "skus": len(skus),
                "articles": len(articles),
                "beers": len(beers),
                "costVersions": len(cost_versions),
                "costLines": sum(len(row.get("cost_lines", [])) for row in cost_versions),
                "activationsByYear": {
                    str(year): sum(1 for row in activations if row["jaar"] == year and not row["effectief_tot"])
                    for year in sorted(YEARS)
                },
                "sellingRowsByYear": {
                    str(year): sum(1 for row in verkoopprijzen if row["jaar"] == year)
                    for year in sorted(YEARS)
                },
                "adviceRowsByYear": {
                    str(year): sum(1 for row in advice if row["jaar"] == year)
                    for year in sorted(YEARS)
                },
                "historicalQuotes": len(historical_quotes),
                "activePlans": len(plans),
                "historicalActualSnapshotsByYear": {
                    str(year): sum(
                        1 for row in historical_actual_snapshots if row["year"] == year
                    )
                    for year in sorted(YEARS)
                },
                "historicalActualMissingCostByYear": {
                    str(year): sum(
                        1
                        for row in historical_actual_snapshots
                        if row["year"] == year and row["missing_cost"]
                    )
                    for year in sorted(YEARS)
                },
            },
            "activationDuplicateKeys": activation_duplicates,
            "activationUnknownSkus": sorted(
                {row["sku_id"] for row in activations if row["sku_id"] not in known_skus}
            ),
            "activationUnknownVersions": sorted(
                {row["kostprijsversie_id"] for row in activations if row["kostprijsversie_id"] not in known_versions}
            ),
            "activationWithoutCanonicalCostLine": missing_cost_lines,
            "activationWithoutAnyCostRepresentation": missing_all_cost_representations,
        },
        "input": {
            "channels": channels,
            "beers": beers,
            "skus": skus,
            "articles": articles,
            "costVersions": cost_versions,
            "activations": activations,
            "sellingPrices": verkoopprijzen,
            "advicePrices": advice,
            "packagingComponentPrices": packaging_prices,
        },
        "historicalQuotes": historical_quotes,
        "historicalActualSnapshots": historical_actual_snapshots,
        "activeBreakEvenPlans": plans,
        "expected": None,
    }


def collect_financial_nodes(
    source: Any,
    *,
    sku_id: Any,
    article_id: Any,
    version_id: Any,
) -> list[dict[str, Any]]:
    markers = {
        "costPriceEx",
        "offerUnitPriceEx",
        "standardPriceEx",
        "kostprijsEx",
        "kostprijsversie_id",
        "kostprijsversieId",
    }
    allowed = markers | {
        "id",
        "optionId",
        "skuId",
        "sku_id",
        "productId",
        "product_id",
        "qty",
        "quantity",
        "units",
        "litersPerUnit",
        "vatRatePct",
        "discountPct",
        "returnPct",
        "priceEx",
    }
    out: list[dict[str, Any]] = []

    def walk(value: Any, path: str) -> None:
        if isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, f"{path}[{index}]")
            return
        if not isinstance(value, dict):
            return
        if markers.intersection(value.keys()):
            row: dict[str, Any] = {"path": path}
            for key in sorted(allowed.intersection(value.keys())):
                raw = value.get(key)
                if key in {"skuId", "sku_id"}:
                    row[key] = sku_id(raw)
                elif key in {"productId", "product_id"}:
                    row[key] = article_id(raw)
                elif key in {"kostprijsversie_id", "kostprijsversieId"}:
                    row[key] = version_id(raw)
                elif key in {"id", "optionId"}:
                    row[key] = "redacted-reference"
                else:
                    row[key] = json_value(raw)
            out.append(row)
        for key, item in value.items():
            if isinstance(item, (dict, list)):
                walk(item, f"{path}.{key}" if path else str(key))

    walk(source, "scenarios")
    return out


if __name__ == "__main__":
    main()
