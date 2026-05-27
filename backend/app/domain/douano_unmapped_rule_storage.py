from __future__ import annotations

from datetime import UTC, datetime
from threading import Lock
from typing import Any, Literal

from app.domain import postgres_storage

MatchType = Literal["douano_product_id", "product0_description"]
ActionType = Literal["categorize", "ignore", "map_to_sku"]

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
                    CREATE TABLE IF NOT EXISTS douano_unmapped_rules (
                        rule_id BIGSERIAL PRIMARY KEY,
                        match_type TEXT NOT NULL DEFAULT '',
                        douano_product_id BIGINT NOT NULL DEFAULT 0,
                        line_description TEXT NOT NULL DEFAULT '',
                        action TEXT NOT NULL DEFAULT '',
                        sku_id TEXT NOT NULL DEFAULT '',
                        category TEXT NOT NULL DEFAULT '',
                        include_revenue BOOLEAN NOT NULL DEFAULT TRUE,
                        include_liters BOOLEAN NOT NULL DEFAULT FALSE,
                        include_break_even BOOLEAN NOT NULL DEFAULT TRUE,
                        note TEXT NOT NULL DEFAULT '',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        UNIQUE (match_type, douano_product_id, line_description)
                    )
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_douano_unmapped_rules_updated ON douano_unmapped_rules(updated_at DESC)"
                )
                cur.execute("ALTER TABLE douano_unmapped_rules ADD COLUMN IF NOT EXISTS sku_id TEXT NOT NULL DEFAULT ''")
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def _normalize_match(*, match_type: str, douano_product_id: int, line_description: str) -> tuple[MatchType, int, str]:
    mt = str(match_type or "").strip()
    if mt not in {"douano_product_id", "product0_description"}:
        raise ValueError("Ongeldige match_type")
    pid = int(douano_product_id or 0)
    desc = str(line_description or "").strip()
    if mt == "douano_product_id":
        if pid <= 0:
            raise ValueError("douano_product_id ontbreekt")
        return "douano_product_id", pid, ""
    # product0_description
    if pid != 0:
        # keep it strict so we don't accidentally attach description rules to real products
        raise ValueError("product0_description vereist douano_product_id=0")
    if not desc:
        raise ValueError("line_description ontbreekt")
    return "product0_description", 0, desc


def upsert_rule(
    *,
    match_type: str,
    douano_product_id: int = 0,
    line_description: str = "",
    action: str,
    sku_id: str = "",
    category: str = "",
    include_revenue: bool = True,
    include_liters: bool = False,
    include_break_even: bool = True,
    note: str = "",
) -> dict[str, Any]:
    ensure_schema()
    mt, pid, desc = _normalize_match(
        match_type=match_type, douano_product_id=douano_product_id, line_description=line_description
    )
    act = str(action or "").strip()
    if act not in {"categorize", "ignore", "map_to_sku"}:
        raise ValueError("Ongeldige action")
    sku = str(sku_id or "").strip()
    cat = str(category or "").strip()
    if act == "categorize" and not cat:
        raise ValueError("category ontbreekt")
    if act == "ignore":
        sku = ""
        cat = ""
        include_revenue = False
        include_liters = False
        include_break_even = False
    if act == "map_to_sku":
        if not sku:
            raise ValueError("sku_id ontbreekt")
        # Mapping implies the line becomes a real SKU line; flags/category are irrelevant.
        cat = ""
        include_revenue = True
        include_liters = True
        include_break_even = True

    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO douano_unmapped_rules(
                    match_type,
                    douano_product_id,
                    line_description,
                    action,
                    sku_id,
                    category,
                    include_revenue,
                    include_liters,
                    include_break_even,
                    note,
                    updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (match_type, douano_product_id, line_description)
                DO UPDATE SET
                    action = EXCLUDED.action,
                    sku_id = EXCLUDED.sku_id,
                    category = EXCLUDED.category,
                    include_revenue = EXCLUDED.include_revenue,
                    include_liters = EXCLUDED.include_liters,
                    include_break_even = EXCLUDED.include_break_even,
                    note = EXCLUDED.note,
                    updated_at = EXCLUDED.updated_at
                RETURNING rule_id, created_at
                """,
                (
                    mt,
                    pid,
                    desc,
                    act,
                    sku,
                    cat,
                    bool(include_revenue),
                    bool(include_liters),
                    bool(include_break_even),
                    str(note or ""),
                    now,
                ),
            )
            row = cur.fetchone()
        if not postgres_storage.in_transaction():
            conn.commit()
    rule_id = int(row[0] or 0) if row else 0
    created_at = row[1].isoformat() if row and row[1] else ""
    return {
        "rule_id": rule_id,
        "match_type": mt,
        "douano_product_id": pid,
        "line_description": desc,
        "action": act,
        "sku_id": sku,
        "category": cat,
        "include_revenue": bool(include_revenue),
        "include_liters": bool(include_liters),
        "include_break_even": bool(include_break_even),
        "note": str(note or ""),
        "created_at": created_at,
        "updated_at": now.isoformat(),
    }


def delete_rule(*, match_type: str, douano_product_id: int = 0, line_description: str = "") -> bool:
    ensure_schema()
    mt, pid, desc = _normalize_match(
        match_type=match_type, douano_product_id=douano_product_id, line_description=line_description
    )
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM douano_unmapped_rules WHERE match_type=%s AND douano_product_id=%s AND line_description=%s",
                (mt, pid, desc),
            )
            deleted = int(getattr(cur, "rowcount", 0) or 0) > 0
        if not postgres_storage.in_transaction():
            conn.commit()
    return deleted


def list_rules(*, limit: int = 10000) -> list[dict[str, Any]]:
    ensure_schema()
    lim = max(1, min(int(limit or 10000), 50000))
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    rule_id,
                    match_type,
                    douano_product_id,
                    line_description,
                    action,
                    sku_id,
                    category,
                    include_revenue,
                    include_liters,
                    include_break_even,
                    note,
                    created_at,
                    updated_at
                FROM douano_unmapped_rules
                ORDER BY updated_at DESC
                LIMIT %s
                """,
                (lim,),
            )
            rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for (
        rule_id,
        match_type,
        douano_product_id,
        line_description,
        action,
        sku_id,
        category,
        include_revenue,
        include_liters,
        include_break_even,
        note,
        created_at,
        updated_at,
    ) in rows:
        out.append(
            {
                "rule_id": int(rule_id or 0),
                "match_type": str(match_type or ""),
                "douano_product_id": int(douano_product_id or 0),
                "line_description": str(line_description or ""),
                "action": str(action or ""),
                "sku_id": str(sku_id or ""),
                "category": str(category or ""),
                "include_revenue": bool(include_revenue),
                "include_liters": bool(include_liters),
                "include_break_even": bool(include_break_even),
                "note": str(note or ""),
                "created_at": created_at.isoformat() if created_at else "",
                "updated_at": updated_at.isoformat() if updated_at else "",
            }
        )
    return out


def get_rule(*, match_type: str, douano_product_id: int = 0, line_description: str = "") -> dict[str, Any] | None:
    ensure_schema()
    mt, pid, desc = _normalize_match(
        match_type=match_type, douano_product_id=douano_product_id, line_description=line_description
    )
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    rule_id,
                    action,
                    sku_id,
                    category,
                    include_revenue,
                    include_liters,
                    include_break_even,
                    note,
                    created_at,
                    updated_at
                FROM douano_unmapped_rules
                WHERE match_type=%s AND douano_product_id=%s AND line_description=%s
                """,
                (mt, pid, desc),
            )
            row = cur.fetchone()
    if not row:
        return None
    (
        rule_id,
        action,
        sku_id,
        category,
        include_revenue,
        include_liters,
        include_break_even,
        note,
        created_at,
        updated_at,
    ) = row
    return {
        "rule_id": int(rule_id or 0),
        "match_type": mt,
        "douano_product_id": pid,
        "line_description": desc,
        "action": str(action or ""),
        "sku_id": str(sku_id or ""),
        "category": str(category or ""),
        "include_revenue": bool(include_revenue),
        "include_liters": bool(include_liters),
        "include_break_even": bool(include_break_even),
        "note": str(note or ""),
        "created_at": created_at.isoformat() if created_at else "",
        "updated_at": updated_at.isoformat() if updated_at else "",
    }
