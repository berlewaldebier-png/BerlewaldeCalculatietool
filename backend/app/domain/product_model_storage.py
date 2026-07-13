from __future__ import annotations

import json
from datetime import UTC, date, datetime
from threading import Lock
from typing import Any
from uuid import uuid5, NAMESPACE_URL

from app.domain import postgres_storage


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()


def _text(value: Any) -> str:
    return str(value or "").strip()


def _num(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value or fallback)
    except (TypeError, ValueError):
        return fallback


def _bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = _text(value).lower()
    return text in {"1", "true", "yes", "ja", "y"}


def _id_for(*parts: Any) -> str:
    key = "|".join(_text(part).lower() for part in parts)
    return str(uuid5(NAMESPACE_URL, f"calculatietool-product-model:{key}"))


def _parse_date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = _text(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def ensure_schema() -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    with _SCHEMA_LOCK:
        if _SCHEMA_READY:
            return
        postgres_storage.ensure_schema()
        from app.domain import articles_storage, skus_storage

        articles_storage.ensure_schema()
        skus_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS product_families (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        kind TEXT NOT NULL DEFAULT 'beer_style',
                        beer_id TEXT NOT NULL DEFAULT '',
                        active BOOLEAN NOT NULL DEFAULT TRUE,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT product_families_kind_name_ux UNIQUE (kind, name)
                    )
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS ix_product_families_beer ON product_families(beer_id)")
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS sku_family_links (
                        id TEXT PRIMARY KEY,
                        sku_id TEXT NOT NULL,
                        family_id TEXT NOT NULL,
                        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
                        source TEXT NOT NULL DEFAULT 'manual',
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT sku_family_links_scope_ux UNIQUE (sku_id, family_id),
                        CONSTRAINT sku_family_links_sku_fk
                            FOREIGN KEY (sku_id) REFERENCES skus(id) ON DELETE CASCADE,
                        CONSTRAINT sku_family_links_family_fk
                            FOREIGN KEY (family_id) REFERENCES product_families(id) ON DELETE CASCADE
                    )
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS ix_sku_family_links_family ON sku_family_links(family_id)")
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS sku_composition_lines (
                        id TEXT PRIMARY KEY,
                        parent_sku_id TEXT NOT NULL,
                        component_sku_id TEXT NOT NULL DEFAULT '',
                        component_article_id TEXT NOT NULL DEFAULT '',
                        quantity NUMERIC NOT NULL DEFAULT 0,
                        uom TEXT NOT NULL DEFAULT 'stuk',
                        scrap_pct NUMERIC NOT NULL DEFAULT 0,
                        source TEXT NOT NULL DEFAULT 'wizard',
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT sku_composition_parent_fk
                            FOREIGN KEY (parent_sku_id) REFERENCES skus(id) ON DELETE CASCADE,
                        CONSTRAINT sku_composition_component_sku_present_chk
                            CHECK (component_sku_id <> '' OR component_article_id <> '')
                    )
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS ix_sku_composition_parent ON sku_composition_lines(parent_sku_id)")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_sku_composition_component_sku ON sku_composition_lines(component_sku_id)")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_sku_composition_component_article ON sku_composition_lines(component_article_id)")
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS suppliers (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        normalized_name TEXT NOT NULL UNIQUE,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS purchase_lots (
                        id TEXT PRIMARY KEY,
                        lot_number TEXT NOT NULL,
                        supplier_id TEXT,
                        source_type TEXT NOT NULL DEFAULT '',
                        source_ref TEXT NOT NULL DEFAULT '',
                        source_date DATE,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT purchase_lots_supplier_fk
                            FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
                        CONSTRAINT purchase_lots_scope_ux UNIQUE (lot_number, supplier_id, source_ref)
                    )
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS ix_purchase_lots_lot ON purchase_lots(lot_number)")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_purchase_lots_supplier ON purchase_lots(supplier_id)")
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS purchase_lot_sku_costs (
                        id TEXT PRIMARY KEY,
                        purchase_lot_id TEXT NOT NULL,
                        sku_id TEXT NOT NULL DEFAULT '',
                        sku_code TEXT NOT NULL DEFAULT '',
                        product_name TEXT NOT NULL DEFAULT '',
                        quantity NUMERIC NOT NULL DEFAULT 0,
                        purchase_price_input NUMERIC NOT NULL DEFAULT 0,
                        purchase_price_includes_excise BOOLEAN NOT NULL DEFAULT FALSE,
                        purchase_price_ex_excise NUMERIC NOT NULL DEFAULT 0,
                        excise_per_unit NUMERIC NOT NULL DEFAULT 0,
                        packaging_cost_per_unit NUMERIC NOT NULL DEFAULT 0,
                        other_direct_cost_per_unit NUMERIC NOT NULL DEFAULT 0,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT purchase_lot_cost_lot_fk
                            FOREIGN KEY (purchase_lot_id) REFERENCES purchase_lots(id) ON DELETE CASCADE,
                        CONSTRAINT purchase_lot_cost_sku_identity_chk CHECK (sku_id <> '' OR sku_code <> ''),
                        CONSTRAINT purchase_lot_cost_scope_ux UNIQUE (purchase_lot_id, sku_id, sku_code)
                    )
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS ix_purchase_lot_cost_sku_id ON purchase_lot_sku_costs(sku_id)")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_purchase_lot_cost_sku_code ON purchase_lot_sku_costs(sku_code)")
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def save_sku_family_links(rows: list[dict[str, Any]]) -> bool:
    ensure_schema()
    now = datetime.now(UTC)
    cleaned: list[dict[str, Any]] = []
    source_rows = rows if isinstance(rows, list) else []
    for row in source_rows:
        if not isinstance(row, dict):
            continue
        sku_id = _text(row.get("sku_id"))
        family_id = _text(row.get("family_id") or row.get("style_id"))
        if not sku_id or not family_id:
            continue
        cleaned.append(
            {
                **row,
                "id": _text(row.get("id")) or _id_for("sku-family", sku_id, family_id),
                "sku_id": sku_id,
                "family_id": family_id,
                "is_primary": _bool(row.get("is_primary", row.get("primary", False))),
                "source": _text(row.get("source")) or "manual",
            }
        )
    ids = [row["id"] for row in cleaned]
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if ids:
                cur.execute("DELETE FROM sku_family_links WHERE id <> ALL(%s)", (ids,))
            else:
                cur.execute("DELETE FROM sku_family_links")
            for row in cleaned:
                cur.execute(
                    """
                    INSERT INTO product_families(id, name, kind, beer_id, active, payload, updated_at)
                    VALUES (%s, %s, %s, %s, TRUE, %s::jsonb, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        row["family_id"],
                        row["family_id"],
                        "beer_style",
                        row["family_id"],
                        json.dumps({"source": "sku_family_link_fallback"}),
                        now,
                    ),
                )
                cur.execute(
                    """
                    INSERT INTO sku_family_links(id, sku_id, family_id, is_primary, source, payload, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        sku_id = EXCLUDED.sku_id,
                        family_id = EXCLUDED.family_id,
                        is_primary = EXCLUDED.is_primary,
                        source = EXCLUDED.source,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (row["id"], row["sku_id"], row["family_id"], row["is_primary"], row["source"], json.dumps(row), now),
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return True


def load_sku_family_links(default_value: Any = None) -> list[dict[str, Any]]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, sku_id, family_id, is_primary, source, payload, updated_at
                FROM sku_family_links
                ORDER BY family_id, is_primary DESC, sku_id
                """
            )
            rows = cur.fetchall() or []
    if not rows:
        return default_value if isinstance(default_value, list) else []
    out: list[dict[str, Any]] = []
    for rid, sku_id, family_id, is_primary, source, payload, updated_at in rows:
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            payload = {}
        out.append(
            {
                **payload,
                "id": _text(rid),
                "sku_id": _text(sku_id),
                "style_id": _text(family_id),
                "family_id": _text(family_id),
                "primary": bool(is_primary),
                "is_primary": bool(is_primary),
                "source": _text(source),
                "updated_at": updated_at.isoformat() if updated_at else "",
            }
        )
    return out


def sync_product_families_from_beers(beers: list[dict[str, Any]]) -> None:
    ensure_schema()
    now = datetime.now(UTC)
    rows = [row for row in beers if isinstance(row, dict)]
    if not rows:
        return
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            for row in rows:
                beer_id = _text(row.get("id"))
                name = _text(row.get("naam") or row.get("name") or row.get("biernaam") or beer_id)
                if not beer_id or not name:
                    continue
                payload = dict(row)
                cur.execute(
                    """
                    SELECT id
                    FROM product_families
                    WHERE id = %s OR (kind = %s AND name = %s)
                    ORDER BY CASE WHEN id = %s THEN 0 ELSE 1 END
                    LIMIT 1
                    """,
                    (beer_id, "beer_style", name, beer_id),
                )
                existing = cur.fetchone()
                target_id = _text(existing[0]) if existing else beer_id
                cur.execute(
                    """
                    INSERT INTO product_families(id, name, kind, beer_id, active, payload, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        beer_id = EXCLUDED.beer_id,
                        active = EXCLUDED.active,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        target_id,
                        name,
                        "beer_style",
                        beer_id,
                        bool(row.get("active", row.get("actief", True))),
                        json.dumps(payload),
                        now,
                    ),
                )
        if not postgres_storage.in_transaction():
            conn.commit()


def upsert_purchase_lot_cost(raw: dict[str, Any]) -> dict[str, Any]:
    ensure_schema()
    supplier_name = _text(raw.get("supplier"))
    supplier_id = _text(raw.get("supplier_id"))
    if supplier_name and not supplier_id:
        supplier_id = _id_for("supplier", supplier_name)
    lot_number = _text(raw.get("lot_number"))
    source_type = _text(raw.get("source_type"))
    source_ref = _text(raw.get("source_ref"))
    source_date = _parse_date(raw.get("source_date"))
    sku_id = _text(raw.get("sku_id"))
    sku_code = _text(raw.get("sku_code"))
    if not lot_number or not (sku_id or sku_code):
        return {}
    lot_id = _text(raw.get("purchase_lot_id")) or _id_for("purchase-lot", lot_number, supplier_id, source_ref)
    cost_id = _text(raw.get("purchase_lot_sku_cost_id")) or _id_for("purchase-lot-cost", lot_id, sku_id, sku_code)
    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if supplier_id:
                cur.execute(
                    """
                    INSERT INTO suppliers(id, name, normalized_name, payload, updated_at)
                    VALUES (%s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (normalized_name) DO UPDATE SET
                        name = EXCLUDED.name,
                        payload = suppliers.payload || EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (supplier_id, supplier_name or supplier_id, (supplier_name or supplier_id).lower(), json.dumps({"source": "lot_cost"}), now),
                )
            cur.execute(
                """
                INSERT INTO purchase_lots(id, lot_number, supplier_id, source_type, source_ref, source_date, payload, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                ON CONFLICT (id) DO UPDATE SET
                    lot_number = EXCLUDED.lot_number,
                    supplier_id = EXCLUDED.supplier_id,
                    source_type = EXCLUDED.source_type,
                    source_ref = EXCLUDED.source_ref,
                    source_date = EXCLUDED.source_date,
                    payload = EXCLUDED.payload,
                    updated_at = EXCLUDED.updated_at
                """,
                (lot_id, lot_number, supplier_id or None, source_type, source_ref, source_date, json.dumps(raw), now),
            )
            cur.execute(
                """
                INSERT INTO purchase_lot_sku_costs (
                    id, purchase_lot_id, sku_id, sku_code, product_name, quantity,
                    purchase_price_input, purchase_price_includes_excise, purchase_price_ex_excise,
                    excise_per_unit, packaging_cost_per_unit, other_direct_cost_per_unit, payload, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                ON CONFLICT (id) DO UPDATE SET
                    purchase_lot_id = EXCLUDED.purchase_lot_id,
                    sku_id = EXCLUDED.sku_id,
                    sku_code = EXCLUDED.sku_code,
                    product_name = EXCLUDED.product_name,
                    quantity = EXCLUDED.quantity,
                    purchase_price_input = EXCLUDED.purchase_price_input,
                    purchase_price_includes_excise = EXCLUDED.purchase_price_includes_excise,
                    purchase_price_ex_excise = EXCLUDED.purchase_price_ex_excise,
                    excise_per_unit = EXCLUDED.excise_per_unit,
                    packaging_cost_per_unit = EXCLUDED.packaging_cost_per_unit,
                    other_direct_cost_per_unit = EXCLUDED.other_direct_cost_per_unit,
                    payload = EXCLUDED.payload,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    cost_id,
                    lot_id,
                    sku_id,
                    sku_code,
                    _text(raw.get("product_name")),
                    _num(raw.get("quantity")),
                    _num(raw.get("purchase_price_input")),
                    _bool(raw.get("purchase_price_includes_excise")),
                    _num(raw.get("purchase_price_ex_excise")),
                    _num(raw.get("excise_per_unit")),
                    _num(raw.get("packaging_cost_per_unit")),
                    _num(raw.get("other_direct_cost_per_unit")),
                    json.dumps(raw),
                    now,
                ),
            )
        if not postgres_storage.in_transaction():
            conn.commit()
    return {"purchase_lot_id": lot_id, "purchase_lot_sku_cost_id": cost_id}


def delete_purchase_lot_cost(raw: dict[str, Any]) -> dict[str, Any]:
    """Delete one canonical purchase LOT cost row projected from a LOT-cost record."""
    ensure_schema()
    supplier_name = _text(raw.get("supplier"))
    supplier_id = _text(raw.get("supplier_id"))
    if supplier_name and not supplier_id:
        supplier_id = _id_for("supplier", supplier_name)
    lot_number = _text(raw.get("lot_number"))
    source_ref = _text(raw.get("source_ref"))
    sku_id = _text(raw.get("sku_id"))
    sku_code = _text(raw.get("sku_code"))
    if not lot_number or not (sku_id or sku_code):
        return {"purchase_lot_sku_costs": 0, "purchase_lots": 0}

    lot_id = _text(raw.get("purchase_lot_id")) or _id_for("purchase-lot", lot_number, supplier_id, source_ref)
    cost_id = _text(raw.get("purchase_lot_sku_cost_id")) or _id_for("purchase-lot-cost", lot_id, sku_id, sku_code)
    deleted_costs = 0
    deleted_lots = 0
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM purchase_lot_sku_costs WHERE id = %s", (cost_id,))
            deleted_costs = int(cur.rowcount or 0)
            cur.execute("DELETE FROM purchase_lots WHERE id = %s AND NOT EXISTS (SELECT 1 FROM purchase_lot_sku_costs WHERE purchase_lot_id = %s)", (lot_id, lot_id))
            deleted_lots = int(cur.rowcount or 0)
        if not postgres_storage.in_transaction():
            conn.commit()
    return {"purchase_lot_sku_costs": deleted_costs, "purchase_lots": deleted_lots}


def replace_sku_composition_lines(*, parent_sku_id: str, lines: list[dict[str, Any]], source: str = "wizard") -> int:
    ensure_schema()
    parent = _text(parent_sku_id)
    if not parent:
        return 0
    now = datetime.now(UTC)
    normalized: list[dict[str, Any]] = []
    for index, line in enumerate(lines if isinstance(lines, list) else []):
        if not isinstance(line, dict):
            continue
        component_sku_id = _text(line.get("component_sku_id") or line.get("componentSkuId"))
        component_article_id = _text(line.get("component_article_id") or line.get("componentArticleId"))
        if not component_sku_id and not component_article_id:
            continue
        quantity = _num(line.get("quantity", line.get("qty", 0)))
        if quantity <= 0:
            continue
        line_id = _text(line.get("id")) or _id_for("sku-composition", parent, component_sku_id, component_article_id, index)
        normalized.append(
            {
                **line,
                "id": line_id,
                "parent_sku_id": parent,
                "component_sku_id": component_sku_id,
                "component_article_id": component_article_id,
                "quantity": quantity,
                "uom": _text(line.get("uom")) or "stuk",
                "scrap_pct": _num(line.get("scrap_pct")),
                "source": _text(source) or "wizard",
            }
        )
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM sku_composition_lines WHERE parent_sku_id = %s", (parent,))
            for row in normalized:
                cur.execute(
                    """
                    INSERT INTO sku_composition_lines(
                        id, parent_sku_id, component_sku_id, component_article_id,
                        quantity, uom, scrap_pct, source, payload, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    """,
                    (
                        row["id"],
                        row["parent_sku_id"],
                        row["component_sku_id"],
                        row["component_article_id"],
                        row["quantity"],
                        row["uom"],
                        row["scrap_pct"],
                        row["source"],
                        json.dumps(row),
                        now,
                    ),
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return len(normalized)


def audit_model_integrity() -> dict[str, Any]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            def count(sql: str) -> int:
                cur.execute(sql)
                return int((cur.fetchone() or [0])[0] or 0)

            return {
                "counts": {
                    "product_families": count("SELECT COUNT(*) FROM product_families"),
                    "sku_family_links": count("SELECT COUNT(*) FROM sku_family_links"),
                    "sku_composition_lines": count("SELECT COUNT(*) FROM sku_composition_lines"),
                    "suppliers": count("SELECT COUNT(*) FROM suppliers"),
                    "purchase_lots": count("SELECT COUNT(*) FROM purchase_lots"),
                    "purchase_lot_sku_costs": count("SELECT COUNT(*) FROM purchase_lot_sku_costs"),
                },
                "orphans": {
                    "douano_product_mapping_missing_sku": count(
                        "SELECT COUNT(*) FROM douano_product_mapping m LEFT JOIN skus s ON s.id = m.sku_id WHERE s.id IS NULL"
                    ),
                    "cost_rows_missing_sku": count(
                        "SELECT COUNT(*) FROM cost_version_sku_rows r LEFT JOIN skus s ON s.id = r.sku_id WHERE s.id IS NULL"
                    ),
                    "activations_missing_sku": count(
                        "SELECT COUNT(*) FROM kostprijs_sku_activations a LEFT JOIN skus s ON s.id = a.sku_id WHERE s.id IS NULL"
                    ),
                    "activations_missing_version": count(
                        "SELECT COUNT(*) FROM kostprijs_sku_activations a LEFT JOIN cost_versions v ON v.id = a.kostprijsversie_id WHERE v.id IS NULL"
                    ),
                    "lot_costs_missing_sku_id": count(
                        "SELECT COUNT(*) FROM lot_cost_records WHERE COALESCE(sku_id, '') = ''"
                    ),
                    "purchase_lot_costs_missing_sku_id": count(
                        "SELECT COUNT(*) FROM purchase_lot_sku_costs WHERE COALESCE(sku_id, '') = ''"
                    ),
                },
            }
