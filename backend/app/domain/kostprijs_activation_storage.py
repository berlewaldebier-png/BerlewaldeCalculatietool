from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import uuid4

from app.domain import postgres_storage


@dataclass(frozen=True)
class ActivationContext:
    run_id: str = ""
    actor: str = ""
    action: str = ""


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _as_iso(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()  # type: ignore[no-any-return]
        except Exception:
            pass
    return str(value or "")


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
                    CREATE TABLE IF NOT EXISTS kostprijs_sku_activations (
                        id TEXT PRIMARY KEY,
                        sku_id TEXT NOT NULL,
                        jaar INTEGER NOT NULL,
                        kostprijsversie_id TEXT NOT NULL,
                        effectief_vanaf TIMESTAMPTZ NULL,
                        effectief_tot TIMESTAMPTZ NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                # One active activation per (sku, year).
                cur.execute("DROP INDEX IF EXISTS ux_kostprijs_product_activation_active_scope;")
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS ux_kostprijs_sku_activation_active_scope
                    ON kostprijs_sku_activations (sku_id, jaar)
                    WHERE effectief_tot IS NULL;
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_kostprijs_sku_activation_year ON kostprijs_sku_activations (jaar);"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_kostprijs_sku_activation_sku ON kostprijs_sku_activations (sku_id);"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_kostprijs_sku_activation_version ON kostprijs_sku_activations (kostprijsversie_id);"
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS kostprijs_sku_activation_events (
                        id TEXT PRIMARY KEY,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        run_id TEXT NOT NULL DEFAULT '',
                        actor TEXT NOT NULL DEFAULT '',
                        action TEXT NOT NULL DEFAULT '',
                        sku_id TEXT NOT NULL,
                        jaar INTEGER NOT NULL,
                        previous_kostprijsversie_id TEXT NOT NULL DEFAULT '',
                        kostprijsversie_id TEXT NOT NULL,
                        effectief_vanaf TIMESTAMPTZ NULL,
                        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
                    );
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()
        _SCHEMA_READY = True


def reset_defaults() -> None:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE kostprijs_sku_activation_events")
            cur.execute("TRUNCATE TABLE kostprijs_sku_activations")
        if not postgres_storage.in_transaction():
            conn.commit()


def normalize_activation_record(row: dict[str, Any]) -> dict[str, Any]:
    src = row if isinstance(row, dict) else {}
    return {
        "id": str(src.get("id", "") or ""),
        "sku_id": str(src.get("sku_id", "") or ""),
        "jaar": int(src.get("jaar", 0) or 0),
        "kostprijsversie_id": str(src.get("kostprijsversie_id", "") or ""),
        "effectief_vanaf": _as_iso(src.get("effectief_vanaf")),
        "effectief_tot": _as_iso(src.get("effectief_tot")),
        "created_at": _as_iso(src.get("created_at")),
        "updated_at": _as_iso(src.get("updated_at")),
    }


def load_activations() -> list[dict[str, Any]]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    sku_id,
                    jaar,
                    kostprijsversie_id,
                    effectief_vanaf,
                    effectief_tot,
                    created_at,
                    updated_at
                FROM kostprijs_sku_activations
                ORDER BY jaar, sku_id, effectief_vanaf DESC NULLS LAST, created_at DESC
                """
            )
            rows = cur.fetchall() or []

    return [
        normalize_activation_record(
            {
                "id": row[0],
                "sku_id": row[1],
                "jaar": row[2],
                "kostprijsversie_id": row[3],
                "effectief_vanaf": row[4],
                "effectief_tot": row[5],
                "created_at": row[6],
                "updated_at": row[7],
            }
        )
        for row in rows
    ]


def load_dataset(default_value: Any) -> Any:
    """Table-backed dataset adapter for `kostprijsproductactiveringen`."""
    activations = load_activations()
    return activations if activations else default_value


def save_dataset(data: Any, *, overwrite: bool = True) -> bool:
    """Table-backed dataset adapter for `kostprijsproductactiveringen`."""
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'kostprijsproductactiveringen': verwacht list.")
    if overwrite:
        return replace_activations(data, context=ActivationContext(action="replace_dataset"))
    return activate_activations(data, context=ActivationContext(action="append_dataset"))


def delete_activations_for_year(year: int) -> dict[str, Any]:
    ensure_schema()
    year_value = int(year or 0)
    if year_value <= 0:
        return {"deleted": 0, "year": year_value}
    deleted = 0
    deleted_events = 0
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM kostprijs_sku_activation_events WHERE jaar = %s", (year_value,))
            deleted_events = int(cur.rowcount or 0)
            cur.execute("DELETE FROM kostprijs_sku_activations WHERE jaar = %s", (year_value,))
            deleted = int(cur.rowcount or 0)
        if not postgres_storage.in_transaction():
            conn.commit()
    return {"deleted": deleted, "deleted_events": deleted_events, "year": year_value}


def replace_activations(
    rows: list[dict[str, Any]],
    *,
    context: ActivationContext | None = None,
) -> bool:
    """PUT semantics: provided rows are the full truth (history is not preserved)."""
    ensure_schema()
    normalized = [normalize_activation_record(row) for row in rows if isinstance(row, dict)]
    for row in normalized:
        if not row["sku_id"] or int(row["jaar"]) <= 0 or not row["kostprijsversie_id"]:
            raise ValueError("Ongeldige activatie: sku_id, jaar en kostprijsversie_id zijn verplicht.")
    now = _now_iso()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM kostprijs_sku_activations")
            for row in normalized:
                cur.execute(
                    """
                    INSERT INTO kostprijs_sku_activations (
                        id, sku_id, jaar, kostprijsversie_id, effectief_vanaf, effectief_tot, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, NULL, %s, %s)
                    """,
                    (
                        str(row.get("id") or uuid4()),
                        str(row["sku_id"]),
                        int(row["jaar"]),
                        str(row["kostprijsversie_id"]),
                        row.get("effectief_vanaf") or None,
                        now,
                        now,
                    ),
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return True


def activate_activations(
    rows: list[dict[str, Any]],
    *,
    context: ActivationContext | None = None,
) -> bool:
    """Activation semantics: close current active row per (sku,year) and open a new one."""
    ensure_schema()
    normalized = [normalize_activation_record(row) for row in rows if isinstance(row, dict)]
    for row in normalized:
        if not row["sku_id"] or int(row["jaar"]) <= 0 or not row["kostprijsversie_id"]:
            raise ValueError("Ongeldige activatie: sku_id, jaar en kostprijsversie_id zijn verplicht.")
    ctx = context or ActivationContext()
    now = _now_iso()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            for row in normalized:
                sku_id = str(row["sku_id"])
                jaar = int(row["jaar"])
                new_version_id = str(row["kostprijsversie_id"])
                cur.execute(
                    """
                    SELECT id, kostprijsversie_id
                    FROM kostprijs_sku_activations
                    WHERE sku_id = %s AND jaar = %s AND effectief_tot IS NULL
                    """,
                    (sku_id, jaar),
                )
                existing = cur.fetchone()
                existing_id = str(existing[0] or "") if existing else ""
                previous_version_id = str(existing[1] or "") if existing else ""

                if existing_id and previous_version_id == new_version_id:
                    cur.execute(
                        "UPDATE kostprijs_sku_activations SET updated_at = %s WHERE id = %s",
                        (now, existing_id),
                    )
                    continue

                if existing_id:
                    cur.execute(
                        """
                        UPDATE kostprijs_sku_activations
                        SET effectief_tot = %s, updated_at = %s
                        WHERE id = %s
                        """,
                        (now, now, existing_id),
                    )

                effectief_vanaf = row.get("effectief_vanaf") or now
                cur.execute(
                    """
                    INSERT INTO kostprijs_sku_activations (
                        id, sku_id, jaar, kostprijsversie_id, effectief_vanaf, effectief_tot, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, NULL, %s, %s)
                    """,
                    (
                        str(uuid4()),
                        sku_id,
                        jaar,
                        new_version_id,
                        effectief_vanaf or None,
                        now,
                        now,
                    ),
                )

                cur.execute(
                    """
                    INSERT INTO kostprijs_sku_activation_events (
                        id,
                        created_at,
                        run_id,
                        actor,
                        action,
                        sku_id,
                        jaar,
                        previous_kostprijsversie_id,
                        kostprijsversie_id,
                        effectief_vanaf,
                        metadata
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    """,
                    (
                        str(uuid4()),
                        now,
                        str(ctx.run_id or ""),
                        str(ctx.actor or ""),
                        str(ctx.action or ""),
                        sku_id,
                        jaar,
                        previous_version_id,
                        new_version_id,
                        effectief_vanaf or None,
                        "{}",
                    ),
                )
        if not postgres_storage.in_transaction():
            conn.commit()
    return True


def upsert_activations(
    rows: list[dict[str, Any]],
    *,
    context: ActivationContext | None = None,
) -> bool:
    # For SKU activations, "upsert" should behave like activation (history-aware).
    return activate_activations(rows, context=context)


def list_activation_events(
    *,
    jaar: int | None = None,
    sku_id: str | None = None,
    limit: int = 250,
) -> list[dict[str, Any]]:
    ensure_schema()
    where: list[str] = []
    params: list[Any] = []
    if jaar is not None:
        where.append("jaar = %s")
        params.append(int(jaar))
    if sku_id:
        where.append("sku_id = %s")
        params.append(str(sku_id))
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    id,
                    created_at,
                    run_id,
                    actor,
                    action,
                    sku_id,
                    jaar,
                    previous_kostprijsversie_id,
                    kostprijsversie_id,
                    effectief_vanaf,
                    metadata
                FROM kostprijs_sku_activation_events
                {clause}
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (*params, int(limit)),
            )
            rows = cur.fetchall() or []
    return [
        {
            "id": row[0],
            "created_at": _as_iso(row[1]),
            "run_id": row[2],
            "actor": row[3],
            "action": row[4],
            "sku_id": row[5],
            "jaar": row[6],
            "previous_kostprijsversie_id": row[7],
            "kostprijsversie_id": row[8],
            "effectief_vanaf": _as_iso(row[9]),
            "metadata": row[10] if isinstance(row[10], dict) else {},
        }
        for row in rows
    ]
