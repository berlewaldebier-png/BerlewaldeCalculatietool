from __future__ import annotations

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Iterable

from app.domain import postgres_storage

_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()


def ensure_schema() -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    with _SCHEMA_LOCK:
        if _SCHEMA_READY:
            return
        postgres_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS douano_raw_objects (
                        resource TEXT NOT NULL,
                        external_id BIGINT NOT NULL,
                        entity_version INT NOT NULL DEFAULT 0,
                        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        payload JSONB NOT NULL,
                        PRIMARY KEY (resource, external_id)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS douano_sync_state (
                        resource TEXT PRIMARY KEY,
                        last_success_at TIMESTAMPTZ,
                        last_since_date DATE,
                        last_error TEXT NOT NULL DEFAULT '',
                        stats JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS douano_companies (
                        company_id BIGINT PRIMARY KEY,
                        entity_version INT NOT NULL DEFAULT 0,
                        name TEXT NOT NULL DEFAULT '',
                        public_name TEXT NOT NULL DEFAULT '',
                        vat_number TEXT NOT NULL DEFAULT '',
                        company_number TEXT NOT NULL DEFAULT '',
                        is_customer BOOLEAN NOT NULL DEFAULT FALSE,
                        status TEXT NOT NULL DEFAULT '',
                        updated_at TIMESTAMPTZ,
                        raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS douano_products (
                        product_id BIGINT PRIMARY KEY,
                        entity_version INT NOT NULL DEFAULT 0,
                        name TEXT NOT NULL DEFAULT '',
                        sku TEXT NOT NULL DEFAULT '',
                        gtin TEXT NOT NULL DEFAULT '',
                        is_sellable BOOLEAN NOT NULL DEFAULT FALSE,
                        status TEXT NOT NULL DEFAULT '',
                        packaging_type TEXT NOT NULL DEFAULT '',
                        updated_at TIMESTAMPTZ,
                        raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS douano_sales_orders (
                        sales_order_id BIGINT PRIMARY KEY,
                        entity_version INT NOT NULL DEFAULT 0,
                        order_date DATE,
                        transaction_number TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL DEFAULT '',
                        company_id BIGINT NOT NULL DEFAULT 0,
                        updated_at TIMESTAMPTZ,
                        raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS douano_sales_order_lines (
                        line_id BIGINT PRIMARY KEY,
                        sales_order_id BIGINT NOT NULL,
                        company_id BIGINT NOT NULL DEFAULT 0,
                        order_date DATE,
                        douano_product_id BIGINT NOT NULL DEFAULT 0,
                        quantity NUMERIC NOT NULL DEFAULT 0,
                        unit_price_ex NUMERIC NOT NULL DEFAULT 0,
                        discount_ex NUMERIC NOT NULL DEFAULT 0,
                        excise_per_unit NUMERIC NOT NULL DEFAULT 0,
                        refund_per_unit NUMERIC NOT NULL DEFAULT 0,
                        gross_revenue_ex NUMERIC NOT NULL DEFAULT 0,
                        charges_total_ex NUMERIC NOT NULL DEFAULT 0,
                        net_revenue_ex NUMERIC NOT NULL DEFAULT 0,
                        updated_at TIMESTAMPTZ
                    )
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_douano_sales_lines_company_date ON douano_sales_order_lines(company_id, order_date)"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_douano_sales_lines_product ON douano_sales_order_lines(douano_product_id)"
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    # Douano returns "YYYY-MM-DD HH:MM:SS"
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(text, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt
        except Exception:
            continue
    return None


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def upsert_raw_object(*, resource: str, external_id: int, entity_version: int, payload: dict[str, Any]) -> None:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO douano_raw_objects(resource, external_id, entity_version, fetched_at, payload)
                VALUES (%s, %s, %s, NOW(), %s::jsonb)
                ON CONFLICT (resource, external_id)
                DO UPDATE SET
                    entity_version = EXCLUDED.entity_version,
                    fetched_at = EXCLUDED.fetched_at,
                    payload = EXCLUDED.payload
                """,
                (
                    str(resource or "").strip(),
                    int(external_id or 0),
                    int(entity_version or 0),
                    json.dumps(payload or {}, ensure_ascii=True),
                ),
            )
        if not postgres_storage.in_transaction():
            conn.commit()


def set_sync_state(
    *,
    resource: str,
    success: bool,
    since_date: str | None,
    stats: dict[str, Any] | None = None,
    error: str = "",
) -> None:
    ensure_schema()
    now = datetime.now(UTC)
    last_success = now if success else None
    stats_payload = stats if isinstance(stats, dict) else {}
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO douano_sync_state(resource, last_success_at, last_since_date, last_error, stats, updated_at)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s)
                ON CONFLICT (resource)
                DO UPDATE SET
                    last_success_at = COALESCE(EXCLUDED.last_success_at, douano_sync_state.last_success_at),
                    last_since_date = COALESCE(EXCLUDED.last_since_date, douano_sync_state.last_since_date),
                    last_error = EXCLUDED.last_error,
                    stats = EXCLUDED.stats,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    str(resource or "").strip(),
                    last_success,
                    since_date,
                    str(error or ""),
                    json.dumps(stats_payload, ensure_ascii=True),
                    now,
                ),
            )
        if not postgres_storage.in_transaction():
            conn.commit()


def list_sync_state() -> list[dict[str, Any]]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT resource, last_success_at, last_since_date, last_error, stats, updated_at
                FROM douano_sync_state
                ORDER BY resource
                """
            )
            rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for resource, last_success_at, last_since_date, last_error, stats, updated_at in rows:
        out.append(
            {
                "resource": str(resource or ""),
                "last_success_at": last_success_at.isoformat() if last_success_at else "",
                "last_since_date": str(last_since_date) if last_since_date else "",
                "last_error": str(last_error or ""),
                "stats": stats if isinstance(stats, dict) else {},
                "updated_at": updated_at.isoformat() if updated_at else "",
            }
        )
    return out


def upsert_companies(items: Iterable[dict[str, Any]]) -> int:
    ensure_schema()
    count = 0
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            for item in items:
                if not isinstance(item, dict):
                    continue
                company_id = int(item.get("id", 0) or 0)
                if company_id <= 0:
                    continue
                cur.execute(
                    """
                    INSERT INTO douano_companies(
                        company_id,
                        entity_version,
                        name,
                        public_name,
                        vat_number,
                        company_number,
                        is_customer,
                        status,
                        updated_at,
                        raw_payload
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (company_id)
                    DO UPDATE SET
                        entity_version = EXCLUDED.entity_version,
                        name = EXCLUDED.name,
                        public_name = EXCLUDED.public_name,
                        vat_number = EXCLUDED.vat_number,
                        company_number = EXCLUDED.company_number,
                        is_customer = EXCLUDED.is_customer,
                        status = EXCLUDED.status,
                        updated_at = EXCLUDED.updated_at,
                        raw_payload = EXCLUDED.raw_payload
                    """,
                    (
                        company_id,
                        int(item.get("entity_version", 0) or 0),
                        str(item.get("name", "") or ""),
                        str(item.get("public_name", "") or ""),
                        str(item.get("vat_number", "") or ""),
                        str(item.get("company_number", "") or ""),
                        bool(item.get("is_customer", False)),
                        str(((item.get("company_status") or {}) if isinstance(item.get("company_status"), dict) else {}).get("name", "") or ""),
                        _parse_ts(item.get("updated_at")),
                        json.dumps(item, ensure_ascii=True),
                    ),
                )
                count += 1
        if not postgres_storage.in_transaction():
            conn.commit()
    return count


def upsert_products(items: Iterable[dict[str, Any]]) -> int:
    ensure_schema()
    count = 0
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            for item in items:
                if not isinstance(item, dict):
                    continue
                product_id = int(item.get("id", 0) or 0)
                if product_id <= 0:
                    continue
                status_obj = item.get("product_status")
                status_name = ""
                if isinstance(status_obj, dict):
                    status_name = str(status_obj.get("name", "") or "")
                packaging_obj = item.get("packaging_type")
                packaging_name = ""
                if isinstance(packaging_obj, dict):
                    packaging_name = str(packaging_obj.get("name", "") or "")
                cur.execute(
                    """
                    INSERT INTO douano_products(
                        product_id,
                        entity_version,
                        name,
                        sku,
                        gtin,
                        is_sellable,
                        status,
                        packaging_type,
                        updated_at,
                        raw_payload
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (product_id)
                    DO UPDATE SET
                        entity_version = EXCLUDED.entity_version,
                        name = EXCLUDED.name,
                        sku = EXCLUDED.sku,
                        gtin = EXCLUDED.gtin,
                        is_sellable = EXCLUDED.is_sellable,
                        status = EXCLUDED.status,
                        packaging_type = EXCLUDED.packaging_type,
                        updated_at = EXCLUDED.updated_at,
                        raw_payload = EXCLUDED.raw_payload
                    """,
                    (
                        product_id,
                        int(item.get("entity_version", 0) or 0),
                        str(item.get("name", "") or ""),
                        str(item.get("sku", "") or ""),
                        str(item.get("gtin", "") or ""),
                        bool(item.get("is_sellable", False)),
                        status_name,
                        packaging_name,
                        _parse_ts(item.get("updated_at")),
                        json.dumps(item, ensure_ascii=True),
                    ),
                )
                count += 1
        if not postgres_storage.in_transaction():
            conn.commit()
    return count


def upsert_sales_orders(items: Iterable[dict[str, Any]]) -> dict[str, int]:
    ensure_schema()
    orders = 0
    lines = 0
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            for order in items:
                if not isinstance(order, dict):
                    continue
                sales_order_id = int(order.get("id", 0) or 0)
                if sales_order_id <= 0:
                    continue
                company_obj = order.get("company")
                company_id = int(company_obj.get("id", 0) or 0) if isinstance(company_obj, dict) else 0
                order_date = str(order.get("date", "") or "").strip() or None
                updated = _parse_ts(order.get("updated_at"))
                cur.execute(
                    """
                    INSERT INTO douano_sales_orders(
                        sales_order_id,
                        entity_version,
                        order_date,
                        transaction_number,
                        status,
                        company_id,
                        updated_at,
                        raw_payload
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (sales_order_id)
                    DO UPDATE SET
                        entity_version = EXCLUDED.entity_version,
                        order_date = EXCLUDED.order_date,
                        transaction_number = EXCLUDED.transaction_number,
                        status = EXCLUDED.status,
                        company_id = EXCLUDED.company_id,
                        updated_at = EXCLUDED.updated_at,
                        raw_payload = EXCLUDED.raw_payload
                    """,
                    (
                        sales_order_id,
                        int(order.get("entity_version", 0) or 0),
                        order_date,
                        str(order.get("transaction_number", "") or ""),
                        str(order.get("status", "") or ""),
                        company_id,
                        updated,
                        json.dumps(order, ensure_ascii=True),
                    ),
                )
                orders += 1

                ordered_items = order.get("ordered_items", [])
                if not isinstance(ordered_items, list):
                    continue
                for item in ordered_items:
                    if not isinstance(item, dict):
                        continue
                    line_id = int(item.get("id", 0) or 0)
                    if line_id <= 0:
                        continue
                    product_obj = item.get("product")
                    douano_product_id = int(product_obj.get("id", 0) or 0) if isinstance(product_obj, dict) else 0
                    quantity = _num(item.get("quantity", 0))
                    unit_price_ex = _num(item.get("price", 0))
                    discount_ex = _num(item.get("discount", 0))

                    excise_per_unit = 0.0
                    refund_per_unit = 0.0
                    extension_values = item.get("extension_values", [])
                    if isinstance(extension_values, list):
                        for ext in extension_values:
                            if not isinstance(ext, dict):
                                continue
                            ext_meta = ext.get("extension")
                            ext_name = ""
                            if isinstance(ext_meta, dict):
                                ext_name = str(ext_meta.get("name", "") or "").strip().lower()
                            if ext_name == "excise":
                                excise_per_unit += _num(ext.get("value", 0))
                            elif ext_name == "refund":
                                refund_per_unit += _num(ext.get("value", 0))

                    gross = quantity * unit_price_ex
                    charges_total = quantity * (excise_per_unit + refund_per_unit)
                    net = gross - discount_ex + charges_total

                    cur.execute(
                        """
                        INSERT INTO douano_sales_order_lines(
                            line_id,
                            sales_order_id,
                            company_id,
                            order_date,
                            douano_product_id,
                            quantity,
                            unit_price_ex,
                            discount_ex,
                            excise_per_unit,
                            refund_per_unit,
                            gross_revenue_ex,
                            charges_total_ex,
                            net_revenue_ex,
                            updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (line_id)
                        DO UPDATE SET
                            sales_order_id = EXCLUDED.sales_order_id,
                            company_id = EXCLUDED.company_id,
                            order_date = EXCLUDED.order_date,
                            douano_product_id = EXCLUDED.douano_product_id,
                            quantity = EXCLUDED.quantity,
                            unit_price_ex = EXCLUDED.unit_price_ex,
                            discount_ex = EXCLUDED.discount_ex,
                            excise_per_unit = EXCLUDED.excise_per_unit,
                            refund_per_unit = EXCLUDED.refund_per_unit,
                            gross_revenue_ex = EXCLUDED.gross_revenue_ex,
                            charges_total_ex = EXCLUDED.charges_total_ex,
                            net_revenue_ex = EXCLUDED.net_revenue_ex,
                            updated_at = EXCLUDED.updated_at
                        """,
                        (
                            line_id,
                            sales_order_id,
                            company_id,
                            order_date,
                            douano_product_id,
                            quantity,
                            unit_price_ex,
                            discount_ex,
                            excise_per_unit,
                            refund_per_unit,
                            gross,
                            charges_total,
                            net,
                            updated,
                        ),
                    )
                    lines += 1
        if not postgres_storage.in_transaction():
            conn.commit()
    return {"orders": orders, "lines": lines}


def list_companies(*, only_customers: bool = False, limit: int = 200) -> list[dict[str, Any]]:
    ensure_schema()
    lim = max(1, min(int(limit or 200), 2000))
    where = "WHERE is_customer = TRUE" if only_customers else ""
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT company_id, name, public_name, vat_number, company_number, is_customer, status, updated_at
                FROM douano_companies
                {where}
                ORDER BY name
                LIMIT %s
                """,
                (lim,),
            )
            rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for company_id, name, public_name, vat_number, company_number, is_customer, status, updated_at in rows:
        out.append(
            {
                "company_id": int(company_id or 0),
                "name": str(name or ""),
                "public_name": str(public_name or ""),
                "vat_number": str(vat_number or ""),
                "company_number": str(company_number or ""),
                "is_customer": bool(is_customer),
                "status": str(status or ""),
                "updated_at": updated_at.isoformat() if updated_at else "",
            }
        )
    return out


def list_products(*, q: str = "", limit: int = 200) -> list[dict[str, Any]]:
    ensure_schema()
    lim = max(1, min(int(limit or 200), 2000))
    query = (q or "").strip().lower()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if query:
                like = f"%{query}%"
                cur.execute(
                    """
                    SELECT product_id, name, sku, gtin, is_sellable, status, packaging_type, updated_at
                    FROM douano_products
                    WHERE LOWER(name) LIKE %s OR LOWER(sku) LIKE %s OR LOWER(gtin) LIKE %s
                    ORDER BY name
                    LIMIT %s
                    """,
                    (like, like, like, lim),
                )
            else:
                cur.execute(
                    """
                    SELECT product_id, name, sku, gtin, is_sellable, status, packaging_type, updated_at
                    FROM douano_products
                    ORDER BY name
                    LIMIT %s
                    """,
                    (lim,),
                )
            rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for product_id, name, sku, gtin, is_sellable, status, packaging_type, updated_at in rows:
        out.append(
            {
                "product_id": int(product_id or 0),
                "name": str(name or ""),
                "sku": str(sku or ""),
                "gtin": str(gtin or ""),
                "is_sellable": bool(is_sellable),
                "status": str(status or ""),
                "packaging_type": str(packaging_type or ""),
                "updated_at": updated_at.isoformat() if updated_at else "",
            }
        )
    return out


def list_company_revenue_summary(*, since: str = "", limit: int = 500) -> list[dict[str, Any]]:
    ensure_schema()
    lim = max(1, min(int(limit or 500), 5000))
    since_text = (since or "").strip()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if since_text:
                cur.execute(
                    """
                    SELECT
                        company_id,
                        COUNT(*)::int AS lines,
                        COALESCE(SUM(gross_revenue_ex), 0) AS omzet_ex,
                        COALESCE(SUM(discount_ex), 0) AS korting_ex,
                        COALESCE(SUM(charges_total_ex), 0) AS charges_ex,
                        COALESCE(SUM(net_revenue_ex), 0) AS netto_omzet_ex
                    FROM douano_sales_order_lines
                    WHERE order_date >= %s::date
                    GROUP BY company_id
                    ORDER BY netto_omzet_ex DESC
                    LIMIT %s
                    """,
                    (since_text, lim),
                )
            else:
                cur.execute(
                    """
                    SELECT
                        company_id,
                        COUNT(*)::int AS lines,
                        COALESCE(SUM(gross_revenue_ex), 0) AS omzet_ex,
                        COALESCE(SUM(discount_ex), 0) AS korting_ex,
                        COALESCE(SUM(charges_total_ex), 0) AS charges_ex,
                        COALESCE(SUM(net_revenue_ex), 0) AS netto_omzet_ex
                    FROM douano_sales_order_lines
                    GROUP BY company_id
                    ORDER BY netto_omzet_ex DESC
                    LIMIT %s
                    """,
                    (lim,),
                )
            rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for company_id, lines, omzet, korting, charges, netto in rows:
        out.append(
            {
                "company_id": int(company_id or 0),
                "lines": int(lines or 0),
                "omzet_ex": float(omzet or 0),
                "korting_ex": float(korting or 0),
                "charges_ex": float(charges or 0),
                "netto_omzet_ex": float(netto or 0),
            }
        )
    return out
