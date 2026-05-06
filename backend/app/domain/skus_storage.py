from __future__ import annotations

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import uuid4

from app.domain import postgres_storage


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()


def _load_active_ids(dataset_name: str) -> set[str]:
    payload = postgres_storage.load_dataset(dataset_name, [])
    if not isinstance(payload, list):
        return set()
    out: set[str] = set()
    for row in payload:
        if not isinstance(row, dict):
            continue
        rid = str(row.get("id", "") or "").strip()
        if not rid:
            continue
        active = bool(row.get("active", True))
        if active:
            out.add(rid)
    return out


def _load_packaging_type_rules() -> dict[str, set[str]]:
    payload = postgres_storage.load_dataset("verpakkingstypen", [])
    if not isinstance(payload, list):
        return {}
    out: dict[str, set[str]] = {}
    for row in payload:
        if not isinstance(row, dict):
            continue
        rid = str(row.get("id", "") or "").strip()
        if not rid or not bool(row.get("active", True)):
            continue
        allowed = row.get("allowed_product_groups", [])
        allowed_set: set[str] = set()
        if isinstance(allowed, list):
            for item in allowed:
                gid = str(item or "").strip()
                if gid:
                    allowed_set.add(gid)
        out[rid] = allowed_set
    return out


def _validate_sku_classification(row: dict[str, Any]) -> None:
    """Validate optional SKU classification fields.

    Phase 1/2 introduces controlled vocab datasets for SKU metadata.
    We validate values when present, but do not require classification yet
    (other flows will be updated in subsequent phases).
    """
    sku_id = str(row.get("id", "") or "").strip()
    product_group = str(row.get("product_group", row.get("productgroep", "")) or "").strip()
    alcohol_category = str(row.get("alcohol_category", row.get("alcoholcategorie", "")) or "").strip()
    packaging_type = str(row.get("packaging_type", row.get("verpakkingstype", "")) or "").strip()

    if not (product_group or alcohol_category or packaging_type):
        return

    product_groups = _load_active_ids("productgroepen")
    alcohol_categories = _load_active_ids("alcoholcategorieen")
    packaging_rules = _load_packaging_type_rules()

    if product_group and product_group not in product_groups:
        raise ValueError(f"Ongeldige productgroep '{product_group}' voor SKU '{sku_id}'.")
    if alcohol_category and alcohol_category not in alcohol_categories:
        raise ValueError(f"Ongeldige alcoholcategorie '{alcohol_category}' voor SKU '{sku_id}'.")
    if packaging_type and packaging_type not in packaging_rules:
        raise ValueError(f"Ongeldig verpakkingstype '{packaging_type}' voor SKU '{sku_id}'.")
    if product_group and packaging_type:
        allowed_groups = packaging_rules.get(packaging_type, set())
        if allowed_groups and product_group not in allowed_groups:
            raise ValueError(
                f"Verpakkingstype '{packaging_type}' is niet toegestaan voor productgroep '{product_group}' (SKU '{sku_id}')."
            )


def update_classification(
    sku_id: str,
    *,
    product_group: str = "",
    alcohol_category: str = "",
    packaging_type: str = "",
) -> dict[str, Any] | None:
    """Update classification fields for a single SKU.

    Writes into the SKU `payload` JSON, leaving other fields untouched.
    Empty strings remove the corresponding field.
    """
    ensure_schema()
    rid = str(sku_id or "").strip()
    if not rid:
        return None

    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, kind, beer_id, format_article_id, article_id, code, name, active, payload, updated_at
                FROM skus
                WHERE id = %s
                """,
                (rid,),
            )
            row = cur.fetchone()
            if not row:
                return None
            (
                rid_db,
                kind,
                beer_id,
                format_article_id,
                article_id,
                code,
                name,
                active,
                payload,
                updated_at,
            ) = row
            if isinstance(payload, str):
                payload = json.loads(payload)
            if not isinstance(payload, dict):
                payload = {}

            next_payload = dict(payload)

            def upsert_field(key: str, value: str) -> None:
                v = str(value or "").strip()
                if v:
                    next_payload[key] = v
                else:
                    next_payload.pop(key, None)

            upsert_field("product_group", product_group)
            upsert_field("alcohol_category", alcohol_category)
            upsert_field("packaging_type", packaging_type)

            # Validate the classification against controlled vocab datasets.
            _validate_sku_classification({"id": rid, **next_payload})

            cur.execute(
                """
                UPDATE skus
                SET payload = %s::jsonb, updated_at = %s
                WHERE id = %s
                """,
                (json.dumps(next_payload), now, rid),
            )
        if not postgres_storage.in_transaction():
            conn.commit()

    # Return a normalized row shape (similar to load_dataset()).
    out_payload = next_payload if isinstance(next_payload, dict) else {}
    return {
        **out_payload,
        "id": str(rid_db),
        "kind": str(kind or "beer_format"),
        "beer_id": str(beer_id or ""),
        "format_article_id": str(format_article_id or ""),
        "article_id": str(article_id or ""),
        "code": str(code or ""),
        "name": str(name or ""),
        "naam": str(name or ""),
        "active": bool(active),
        "actief": bool(active),
        "updated_at": now.isoformat(),
    }


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
                    CREATE TABLE IF NOT EXISTS skus (
                        id TEXT PRIMARY KEY,
                        kind TEXT NOT NULL DEFAULT 'beer_format',
                        beer_id TEXT NOT NULL DEFAULT '',
                        format_article_id TEXT NOT NULL DEFAULT '',
                        article_id TEXT NOT NULL DEFAULT '',
                        code TEXT NOT NULL DEFAULT '',
                        name TEXT NOT NULL DEFAULT '',
                        active BOOLEAN NOT NULL DEFAULT TRUE,
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT skus_kind_scope_ux UNIQUE (kind, beer_id, format_article_id, article_id)
                    );
                    """
                )
                # Migrate from the old uniqueness constraint (beer_id, format_article_id).
                cur.execute("ALTER TABLE skus DROP CONSTRAINT IF EXISTS skus_beer_format_ux;")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_skus_beer ON skus(beer_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_skus_format ON skus(format_article_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_skus_kind ON skus(kind);")
                cur.execute("CREATE INDEX IF NOT EXISTS ix_skus_article ON skus(article_id);")
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def load_dataset(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, kind, beer_id, format_article_id, article_id, code, name, active, payload, updated_at
                FROM skus
                ORDER BY active DESC, name ASC, id ASC
                """
            )
            rows = cur.fetchall() or []
    if not rows:
        return default_value
    out: list[dict[str, Any]] = []
    for rid, kind, beer_id, format_article_id, article_id, code, name, active, payload, updated_at in rows:
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            payload = {}
        out.append(
            {
                **payload,
                "id": str(rid),
                "kind": str(kind or "beer_format"),
                "beer_id": str(beer_id or ""),
                "format_article_id": str(format_article_id or ""),
                "article_id": str(article_id or ""),
                "code": str(code or ""),
                "name": str(name or ""),
                "naam": str(name or ""),
                "active": bool(active),
                "actief": bool(active),
                "updated_at": updated_at.isoformat() if updated_at else "",
            }
        )
    return out


def save_dataset(data: Any, *, overwrite: bool = True) -> bool:
    ensure_schema()
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'skus': verwacht list.")
    now = datetime.now(UTC)
    rows: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    incoming_ids: list[str] = []
    params: list[tuple[Any, ...]] = []
    for row in rows:
        _validate_sku_classification(row)
        rid = str(row.get("id", "") or "").strip() or str(uuid4())
        kind = str(row.get("kind", "") or "").strip().lower() or "beer_format"
        beer_id = str(row.get("beer_id", "") or "").strip()
        format_article_id = str(row.get("format_article_id", "") or "").strip()
        article_id = str(row.get("article_id", "") or "").strip()
        code = str(row.get("code", "") or "").strip()
        name = str(row.get("name", row.get("naam", "")) or "").strip()
        active = bool(row.get("active", row.get("actief", True)))
        payload = {k: v for (k, v) in row.items() if k not in {"naam"}}
        incoming_ids.append(rid)
        params.append((rid, kind, beer_id, format_article_id, article_id, code, name, active, json.dumps(payload), now))

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if overwrite:
                if incoming_ids:
                    cur.execute("DELETE FROM skus WHERE id <> ALL(%s)", (incoming_ids,))
                else:
                    cur.execute("DELETE FROM skus")
            if params:
                cur.executemany(
                    """
                    INSERT INTO skus (id, kind, beer_id, format_article_id, article_id, code, name, active, payload, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        kind = EXCLUDED.kind,
                        beer_id = EXCLUDED.beer_id,
                        format_article_id = EXCLUDED.format_article_id,
                        article_id = EXCLUDED.article_id,
                        code = EXCLUDED.code,
                        name = EXCLUDED.name,
                        active = EXCLUDED.active,
                        payload = EXCLUDED.payload,
                        updated_at = EXCLUDED.updated_at
                    """,
                    params,
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return True
