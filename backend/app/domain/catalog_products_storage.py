import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.domain import postgres_storage, product_registry_storage


def ensure_schema() -> None:
    postgres_storage.ensure_schema()
    product_registry_storage.ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS catalog_products (
                    id TEXT PRIMARY KEY,
                    code TEXT NOT NULL DEFAULT '',
                    name TEXT NOT NULL DEFAULT '',
                    kind TEXT NOT NULL DEFAULT 'catalog',
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS catalog_product_bom_lines (
                    id TEXT PRIMARY KEY,
                    catalog_product_id TEXT NOT NULL,
                    line_kind TEXT NOT NULL,
                    quantity NUMERIC NOT NULL DEFAULT 0,
                    bier_id TEXT NOT NULL DEFAULT '',
                    product_id TEXT NOT NULL DEFAULT '',
                    product_type TEXT NOT NULL DEFAULT '',
                    packaging_component_id TEXT NOT NULL DEFAULT '',
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    FOREIGN KEY (catalog_product_id) REFERENCES catalog_products(id) ON DELETE CASCADE
                );
                """
            )
            # Drop any legacy FK to products_master: products_master is rebuilt via wipe+insert,
            # so enforcing FK here creates deadlocks during registry rebuild.
            cur.execute(
                """
                DO $$
                DECLARE
                    r record;
                BEGIN
                    FOR r IN
                        SELECT conname
                        FROM pg_constraint
                        WHERE conrelid = 'catalog_product_bom_lines'::regclass
                          AND contype = 'f'
                          AND confrelid = 'products_master'::regclass
                    LOOP
                        EXECUTE format('ALTER TABLE catalog_product_bom_lines DROP CONSTRAINT IF EXISTS %I', r.conname);
                    END LOOP;
                END $$;
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS ix_catalog_products_kind ON catalog_products(kind);")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS ix_catalog_bom_lines_parent ON catalog_product_bom_lines(catalog_product_id);"
            )
        if not postgres_storage.in_transaction():
            conn.commit()


def load_dataset(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, kind, active, payload, updated_at
                FROM catalog_products
                ORDER BY kind ASC, name ASC
                """
            )
            products = cur.fetchall() or []
            cur.execute(
                """
                SELECT id, catalog_product_id, line_kind, quantity, bier_id, product_id, product_type, packaging_component_id, payload, updated_at
                FROM catalog_product_bom_lines
                ORDER BY catalog_product_id ASC, updated_at ASC, id ASC
                """
            )
            lines = cur.fetchall() or []

    lines_by_parent: dict[str, list[dict[str, Any]]] = {}
    for row in lines:
        (
            rid,
            catalog_product_id,
            line_kind,
            quantity,
            bier_id,
            product_id,
            product_type,
            packaging_component_id,
            payload,
            updated_at,
        ) = row
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = {"raw": payload}
        if not isinstance(payload, dict):
            payload = {}
        lines_by_parent.setdefault(str(catalog_product_id), []).append(
            {
                **payload,
                "id": str(rid),
                "catalog_product_id": str(catalog_product_id),
                "line_kind": str(line_kind or ""),
                "quantity": float(quantity or 0),
                "bier_id": str(bier_id or ""),
                "product_id": str(product_id or ""),
                "product_type": str(product_type or ""),
                "packaging_component_id": str(packaging_component_id or ""),
                "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") and updated_at else "",
            }
        )

    out: list[dict[str, Any]] = []
    for row in products:
        (rid, code, name, kind, active, payload, updated_at) = row
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = {"raw": payload}
        if not isinstance(payload, dict):
            payload = {}
        out.append(
            {
                **payload,
                "id": str(rid),
                "code": str(code or ""),
                "naam": str(name or ""),
                "name": str(name or ""),
                "kind": str(kind or "catalog"),
                "actief": bool(active),
                "active": bool(active),
                "bom_lines": lines_by_parent.get(str(rid), []),
                "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") and updated_at else "",
            }
        )
    return out if out else default_value


def save_dataset(data: Any, *, overwrite: bool = True) -> bool:
    ensure_schema()
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'catalog-products': verwacht list.")

    now = datetime.now(UTC)
    records: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            prod_params: list[tuple[Any, ...]] = []
            line_params: list[tuple[Any, ...]] = []
            incoming_product_ids: list[str] = []
            incoming_line_ids: list[str] = []

            for row in records:
                record_id = str(row.get("id", "") or "").strip() or str(uuid4())
                code = str(row.get("code", "") or "").strip()
                name = str(row.get("naam", row.get("name", "")) or "").strip()
                kind = str(row.get("kind", "catalog") or "catalog").strip().lower()
                active = bool(row.get("actief", row.get("active", True)))
                payload = {k: v for (k, v) in row.items() if k not in {"bom_lines"}}
                prod_params.append((record_id, code, name, kind, active, json.dumps(payload), now))
                incoming_product_ids.append(record_id)

                for line in row.get("bom_lines", []) if isinstance(row.get("bom_lines", []), list) else []:
                    if not isinstance(line, dict):
                        continue
                    line_id = str(line.get("id", "") or "").strip() or str(uuid4())
                    line_kind = str(line.get("line_kind", "") or "").strip().lower()
                    try:
                        quantity = float(line.get("quantity", line.get("aantal", 0)) or 0.0)
                    except (TypeError, ValueError):
                        quantity = 0.0
                    bier_id = str(line.get("bier_id", "") or "").strip()
                    product_id = str(line.get("product_id", "") or "").strip()
                    product_type = str(line.get("product_type", "") or "").strip().lower()
                    packaging_component_id = str(line.get("packaging_component_id", line.get("verpakkingsonderdeel_id", "")) or "").strip()
                    line_payload = dict(line)
                    line_params.append(
                        (
                            line_id,
                            record_id,
                            line_kind,
                            float(quantity),
                            bier_id,
                            product_id,
                            product_type,
                            packaging_component_id,
                            json.dumps(line_payload),
                            now,
                        )
                    )
                    incoming_line_ids.append(line_id)

            if overwrite:
                # Remove records outside the submitted dataset (upsert for the rest).
                if incoming_product_ids:
                    cur.execute(
                        "DELETE FROM catalog_products WHERE id <> ALL(%s)",
                        (incoming_product_ids,),
                    )
                    # For submitted parents, remove bom lines that are no longer present.
                    if incoming_line_ids:
                        cur.execute(
                            """
                            DELETE FROM catalog_product_bom_lines
                            WHERE catalog_product_id = ANY(%s)
                              AND id <> ALL(%s)
                            """,
                            (incoming_product_ids, incoming_line_ids),
                        )
                    else:
                        cur.execute(
                            "DELETE FROM catalog_product_bom_lines WHERE catalog_product_id = ANY(%s)",
                            (incoming_product_ids,),
                        )
                else:
                    # Empty dataset => clear everything.
                    cur.execute("DELETE FROM catalog_product_bom_lines")
                    cur.execute("DELETE FROM catalog_products")

            if prod_params:
                cur.executemany(
                    """
                    INSERT INTO catalog_products (id, code, name, kind, active, payload, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        code = EXCLUDED.code,
                        name = EXCLUDED.name,
                        kind = EXCLUDED.kind,
                        active = EXCLUDED.active,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    prod_params,
                )

            if line_params:
                cur.executemany(
                    """
                    INSERT INTO catalog_product_bom_lines (
                        id,
                        catalog_product_id,
                        line_kind,
                        quantity,
                        bier_id,
                        product_id,
                        product_type,
                        packaging_component_id,
                        payload,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s::numeric, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        catalog_product_id = EXCLUDED.catalog_product_id,
                        line_kind = EXCLUDED.line_kind,
                        quantity = EXCLUDED.quantity,
                        bier_id = EXCLUDED.bier_id,
                        product_id = EXCLUDED.product_id,
                        product_type = EXCLUDED.product_type,
                        packaging_component_id = EXCLUDED.packaging_component_id,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    line_params,
                )

        if not postgres_storage.in_transaction():
            conn.commit()

    return True
