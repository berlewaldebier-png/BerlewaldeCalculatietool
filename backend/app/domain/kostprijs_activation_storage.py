from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.domain import postgres_storage


@dataclass(frozen=True)
class ActivationContext:
    run_id: str = ""
    actor: str = ""
    action: str = ""


_SCHEMA_READY = False


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

    postgres_storage.ensure_schema()
    # Ensure master registry exists before we add FK constraints.
    from app.domain import product_registry_storage
    product_registry_storage.ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS kostprijs_product_activations (
                    id TEXT PRIMARY KEY,
                    bier_id TEXT NOT NULL,
                    jaar INTEGER NOT NULL,
                    product_id TEXT NOT NULL,
                    product_type TEXT NOT NULL,
                    kostprijsversie_id TEXT NOT NULL,
                    effectief_vanaf TIMESTAMPTZ NULL,
                    effectief_tot TIMESTAMPTZ NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            # Add new columns on existing dev/test databases.
            cur.execute(
                "ALTER TABLE kostprijs_product_activations ADD COLUMN IF NOT EXISTS effectief_tot TIMESTAMPTZ NULL;"
            )

            # Replace the old "one row per scope" uniqueness with an "active row per scope" constraint.
            # We keep history by allowing multiple rows per (bier, jaar, product), but enforce only one active (effectief_tot IS NULL).
            cur.execute("DROP INDEX IF EXISTS ux_kostprijs_product_activation_scope;")
            cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ux_kostprijs_product_activation_active_scope
                ON kostprijs_product_activations (bier_id, jaar, product_id)
                WHERE effectief_tot IS NULL;
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS ix_kostprijs_product_activation_year
                ON kostprijs_product_activations (jaar);
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS ix_kostprijs_product_activation_bier
                ON kostprijs_product_activations (bier_id);
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS ix_kostprijs_product_activation_version
                ON kostprijs_product_activations (kostprijsversie_id);
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS ix_kostprijs_product_activation_active_year
                ON kostprijs_product_activations (jaar, effectief_tot);
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS kostprijs_activation_events (
                    id TEXT PRIMARY KEY,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    run_id TEXT NOT NULL DEFAULT '',
                    actor TEXT NOT NULL DEFAULT '',
                    action TEXT NOT NULL DEFAULT '',
                    bier_id TEXT NOT NULL,
                    jaar INTEGER NOT NULL,
                    product_id TEXT NOT NULL,
                    product_type TEXT NOT NULL,
                    previous_kostprijsversie_id TEXT NOT NULL DEFAULT '',
                    kostprijsversie_id TEXT NOT NULL,
                    effectief_vanaf TIMESTAMPTZ NULL,
                    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
                );
                """
            )
            # Migrate legacy TEXT timestamp columns (dev DBs) to TIMESTAMPTZ.
            # We use NULLIF(...,'') casts so old empty-string defaults won't break the type change.
            cur.execute("ALTER TABLE kostprijs_product_activations ALTER COLUMN effectief_vanaf DROP DEFAULT")
            cur.execute("ALTER TABLE kostprijs_product_activations ALTER COLUMN effectief_tot DROP DEFAULT")
            cur.execute("ALTER TABLE kostprijs_product_activations ALTER COLUMN created_at DROP DEFAULT")
            cur.execute("ALTER TABLE kostprijs_product_activations ALTER COLUMN updated_at DROP DEFAULT")
            cur.execute(
                "ALTER TABLE kostprijs_product_activations ALTER COLUMN effectief_vanaf TYPE TIMESTAMPTZ USING NULLIF(effectief_vanaf::text,'')::timestamptz"
            )
            cur.execute(
                "ALTER TABLE kostprijs_product_activations ALTER COLUMN effectief_tot TYPE TIMESTAMPTZ USING NULLIF(effectief_tot::text,'')::timestamptz"
            )
            cur.execute(
                "ALTER TABLE kostprijs_product_activations ALTER COLUMN created_at TYPE TIMESTAMPTZ USING NULLIF(created_at::text,'')::timestamptz"
            )
            cur.execute(
                "ALTER TABLE kostprijs_product_activations ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING NULLIF(updated_at::text,'')::timestamptz"
            )
            cur.execute("UPDATE kostprijs_product_activations SET created_at = NOW() WHERE created_at IS NULL")
            cur.execute("UPDATE kostprijs_product_activations SET updated_at = created_at WHERE updated_at IS NULL")
            cur.execute("ALTER TABLE kostprijs_product_activations ALTER COLUMN created_at SET DEFAULT NOW()")
            cur.execute("ALTER TABLE kostprijs_product_activations ALTER COLUMN updated_at SET DEFAULT NOW()")
            cur.execute("ALTER TABLE kostprijs_product_activations ALTER COLUMN created_at SET NOT NULL")
            cur.execute("ALTER TABLE kostprijs_product_activations ALTER COLUMN updated_at SET NOT NULL")

            cur.execute("ALTER TABLE kostprijs_activation_events ALTER COLUMN created_at DROP DEFAULT")
            cur.execute("ALTER TABLE kostprijs_activation_events ALTER COLUMN effectief_vanaf DROP DEFAULT")
            cur.execute(
                "ALTER TABLE kostprijs_activation_events ALTER COLUMN created_at TYPE TIMESTAMPTZ USING NULLIF(created_at::text,'')::timestamptz"
            )
            cur.execute(
                "ALTER TABLE kostprijs_activation_events ALTER COLUMN effectief_vanaf TYPE TIMESTAMPTZ USING NULLIF(effectief_vanaf::text,'')::timestamptz"
            )
            cur.execute("UPDATE kostprijs_activation_events SET created_at = NOW() WHERE created_at IS NULL")
            cur.execute("ALTER TABLE kostprijs_activation_events ALTER COLUMN created_at SET DEFAULT NOW()")
            cur.execute("ALTER TABLE kostprijs_activation_events ALTER COLUMN created_at SET NOT NULL")
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS ix_kostprijs_activation_events_created_at
                ON kostprijs_activation_events (created_at);
                """
            )

            # Enforce product_id integrity against the master registry.
            # Use an idempotent DO block (Postgres lacks IF NOT EXISTS for ADD CONSTRAINT).
            cur.execute(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'fk_kostprijs_activations_product'
                    ) THEN
                        ALTER TABLE kostprijs_product_activations
                        ADD CONSTRAINT fk_kostprijs_activations_product
                        FOREIGN KEY (product_id) REFERENCES products_master(id) ON DELETE RESTRICT;
                    END IF;
                END $$;
                """
            )

            # Some older dev databases had a FK on bier_id -> beers(id). In the current architecture,
            # beer master data lives in the `bieren` dataset (and not in a normalized `beers` table),
            # so enforcing that FK breaks legitimate writes (e.g. afronden/activeren).
            cur.execute(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'fk_kostprijs_activations_beer'
                    ) THEN
                        ALTER TABLE kostprijs_product_activations
                        DROP CONSTRAINT fk_kostprijs_activations_beer;
                    END IF;
                END $$;
                """
            )
        conn.commit()

    _SCHEMA_READY = True


def reset_defaults() -> None:
    """Dev/test helper: clear all activation state while keeping schema intact."""
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE kostprijs_activation_events")
            cur.execute("TRUNCATE TABLE kostprijs_product_activations")
        if not postgres_storage.in_transaction():
            conn.commit()


def normalize_activation_record(record: dict[str, Any] | None) -> dict[str, Any]:
    src = record if isinstance(record, dict) else {}
    created_at = _as_iso(src.get("created_at")) or _now_iso()
    updated_at = _as_iso(src.get("updated_at")) or created_at
    effectief_vanaf = _as_iso(src.get("effectief_vanaf") or src.get("effective_from")) or ""
    effectief_tot = _as_iso(src.get("effectief_tot") or src.get("effective_to")) or ""
    return {
        "id": str(src.get("id", "") or uuid4()),
        "bier_id": str(src.get("bier_id", "") or ""),
        "jaar": int(src.get("jaar", 0) or 0),
        "product_id": str(src.get("product_id", "") or ""),
        "product_type": str(src.get("product_type", "") or ""),
        "kostprijsversie_id": str(src.get("kostprijsversie_id", "") or ""),
        "effectief_vanaf": effectief_vanaf,
        "effectief_tot": effectief_tot,
        "created_at": created_at,
        "updated_at": updated_at,
    }


def load_activations() -> list[dict[str, Any]]:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    bier_id,
                    jaar,
                    product_id,
                    product_type,
                    kostprijsversie_id,
                    effectief_vanaf,
                    effectief_tot,
                    created_at,
                    updated_at
                FROM kostprijs_product_activations
                ORDER BY jaar, bier_id, product_id, effectief_vanaf DESC NULLS LAST, created_at DESC
                """
            )
            rows = cur.fetchall() or []

    return [
        normalize_activation_record(
            {
                "id": row[0],
                "bier_id": row[1],
                "jaar": row[2],
                "product_id": row[3],
                "product_type": row[4],
                "kostprijsversie_id": row[5],
                "effectief_vanaf": row[6],
                "effectief_tot": row[7],
                "created_at": row[8],
                "updated_at": row[9],
            }
        )
        for row in rows
    ]


def upsert_activations(
    rows: list[dict[str, Any]],
    *,
    context: ActivationContext | None = None,
) -> bool:
    ensure_schema()
    normalized_rows = [normalize_activation_record(row) for row in rows if isinstance(row, dict)]

    # Deduplicate in-memory by scope; last write wins.
    by_key: dict[tuple[str, int, str], dict[str, Any]] = {}
    for row in normalized_rows:
        key = (str(row["bier_id"]), int(row["jaar"]), str(row["product_id"]))
        by_key[key] = row
    normalized_rows = list(by_key.values())

    for row in normalized_rows:
        if not row["bier_id"] or not row["product_id"] or int(row["jaar"]) <= 0 or not row["kostprijsversie_id"]:
            raise ValueError(
                "Ongeldige kostprijsproductactivering: bier_id, jaar, product_id en kostprijsversie_id zijn verplicht."
            )

    ctx = context or ActivationContext()
    now = _now_iso()

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            for row in normalized_rows:
                bier_id = str(row["bier_id"])
                jaar = int(row["jaar"])
                product_id = str(row["product_id"])

                cur.execute(
                    """
                    SELECT id, kostprijsversie_id
                    FROM kostprijs_product_activations
                    WHERE bier_id = %s AND jaar = %s AND product_id = %s AND effectief_tot IS NULL
                    """,
                    (bier_id, jaar, product_id),
                )
                existing = cur.fetchone()
                previous_version_id = str(existing[1] or "") if existing else ""

                created_at = str(row.get("created_at", "") or "") or now
                updated_at = str(row.get("updated_at", "") or "") or now
                effectief_vanaf = str(row.get("effectief_vanaf", "") or "") or ""
                effectief_vanaf_ts = effectief_vanaf or None
                effectief_tot = str(row.get("effectief_tot", "") or "") or ""
                effectief_tot_ts = effectief_tot or None

                cur.execute(
                    """
                    INSERT INTO kostprijs_product_activations (
                        id, bier_id, jaar, product_id, product_type, kostprijsversie_id,
                        effectief_vanaf, effectief_tot, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (bier_id, jaar, product_id) WHERE effectief_tot IS NULL
                    DO UPDATE SET
                        product_type = EXCLUDED.product_type,
                        kostprijsversie_id = EXCLUDED.kostprijsversie_id,
                        effectief_vanaf = EXCLUDED.effectief_vanaf,
                        effectief_tot = EXCLUDED.effectief_tot,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        str(row["id"]),
                        bier_id,
                        jaar,
                        product_id,
                        str(row.get("product_type", "") or ""),
                        str(row["kostprijsversie_id"]),
                        effectief_vanaf_ts,
                        effectief_tot_ts,
                        created_at,
                        updated_at,
                    ),
                )

                # Only log when the active version actually changes (including first insert).
                new_version_id = str(row["kostprijsversie_id"])
                if previous_version_id != new_version_id:
                    cur.execute(
                        """
                        INSERT INTO kostprijs_activation_events (
                            id,
                            created_at,
                            run_id,
                            actor,
                            action,
                            bier_id,
                            jaar,
                            product_id,
                            product_type,
                            previous_kostprijsversie_id,
                            kostprijsversie_id,
                            effectief_vanaf,
                            metadata
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                        """,
                        (
                            str(uuid4()),
                            now,
                            str(ctx.run_id or ""),
                            str(ctx.actor or ""),
                            str(ctx.action or ""),
                            bier_id,
                            jaar,
                            product_id,
                            str(row.get("product_type", "") or ""),
                            previous_version_id,
                            new_version_id,
                            effectief_vanaf_ts,
                            "{}",
                        ),
                    )
        conn.commit()

    return True


def replace_activations(
    rows: list[dict[str, Any]],
    *,
    context: ActivationContext | None = None,
) -> bool:
    """
    Replace the full activation set.

    This matches PUT semantics for the dataset: the provided rows are the new truth.
    It also enables safe migrations where product_id values change, without primary-key conflicts.
    """
    ensure_schema()
    normalized_rows = [normalize_activation_record(row) for row in rows if isinstance(row, dict)]

    # Deduplicate in-memory by scope; last write wins.
    by_key: dict[tuple[str, int, str], dict[str, Any]] = {}
    for row in normalized_rows:
        key = (str(row["bier_id"]), int(row["jaar"]), str(row["product_id"]))
        by_key[key] = row
    normalized_rows = list(by_key.values())

    for row in normalized_rows:
        if not row["bier_id"] or not row["product_id"] or int(row["jaar"]) <= 0 or not row["kostprijsversie_id"]:
            raise ValueError(
                "Ongeldige kostprijsproductactivering: bier_id, jaar, product_id en kostprijsversie_id zijn verplicht."
            )

    ctx = context or ActivationContext()
    now = _now_iso()

    years_in_payload: set[int] = {int(row["jaar"]) for row in normalized_rows if int(row.get("jaar") or 0) > 0}

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            # Replace-by-scope: only clear years present in this payload.
            # This avoids wiping other years when saving a single year via the UI/admin tooling.
            for jaar in sorted(years_in_payload):
                cur.execute("DELETE FROM kostprijs_product_activations WHERE jaar = %s", (jaar,))

            for row in normalized_rows:
                bier_id = str(row["bier_id"])
                jaar = int(row["jaar"])
                product_id = str(row["product_id"])

                created_at = str(row.get("created_at", "") or "") or now
                updated_at = str(row.get("updated_at", "") or "") or now
                effectief_vanaf = str(row.get("effectief_vanaf", "") or "") or ""
                effectief_vanaf_ts = effectief_vanaf or None
                effectief_tot = str(row.get("effectief_tot", "") or "") or ""
                effectief_tot_ts = effectief_tot or None

                cur.execute(
                    """
                    INSERT INTO kostprijs_product_activations (
                        id, bier_id, jaar, product_id, product_type, kostprijsversie_id,
                        effectief_vanaf, effectief_tot, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        str(row["id"]),
                        bier_id,
                        jaar,
                        product_id,
                        str(row.get("product_type", "") or ""),
                        str(row["kostprijsversie_id"]),
                        effectief_vanaf_ts,
                        effectief_tot_ts,
                        created_at,
                        updated_at,
                    ),
                )

        conn.commit()

    # Event logging for replace operations is intentionally omitted; use activate endpoints for audit trails.
    _ = ctx
    return True


def delete_activations_for_year(year: int) -> dict[str, int]:
    """Hard delete all activation rows (and their audit events) for a given year.

    This is a maintenance operation used by admin rollback tooling.
    """
    ensure_schema()
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        year_value = 0
    if year_value <= 0:
        return {"activations_deleted": 0, "events_deleted": 0}

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM kostprijs_product_activations WHERE jaar = %s",
                (year_value,),
            )
            activations_count = int(cur.fetchone()[0] or 0)
            cur.execute(
                "DELETE FROM kostprijs_product_activations WHERE jaar = %s",
                (year_value,),
            )

            cur.execute(
                "SELECT COUNT(*) FROM kostprijs_activation_events WHERE jaar = %s",
                (year_value,),
            )
            events_count = int(cur.fetchone()[0] or 0)
            cur.execute(
                "DELETE FROM kostprijs_activation_events WHERE jaar = %s",
                (year_value,),
            )
        if not postgres_storage.in_transaction():
            conn.commit()

    return {"activations_deleted": activations_count, "events_deleted": events_count}


def activate_activations(
    rows: list[dict[str, Any]],
    *,
    context: ActivationContext | None = None,
) -> bool:
    """Activation semantics:

    - Close any active activation for the same (bier, jaar, product) by setting `effectief_tot = now()`.
    - Insert a new active activation row with `effectief_vanaf = now()` and `effectief_tot = NULL`.

    This preserves history while keeping a single active row per scope.
    """
    ensure_schema()
    normalized_rows = [normalize_activation_record(row) for row in rows if isinstance(row, dict)]

    # Deduplicate in-memory by scope; last write wins.
    by_key: dict[tuple[str, int, str], dict[str, Any]] = {}
    for row in normalized_rows:
        key = (str(row["bier_id"]), int(row["jaar"]), str(row["product_id"]))
        by_key[key] = row
    normalized_rows = list(by_key.values())

    for row in normalized_rows:
        if not row["bier_id"] or not row["product_id"] or int(row["jaar"]) <= 0 or not row["kostprijsversie_id"]:
            raise ValueError(
                "Ongeldige kostprijsproductactivering: bier_id, jaar, product_id en kostprijsversie_id zijn verplicht."
            )

    ctx = context or ActivationContext()
    now = _now_iso()

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            for row in normalized_rows:
                bier_id = str(row["bier_id"])
                jaar = int(row["jaar"])
                product_id = str(row["product_id"])
                new_version_id = str(row["kostprijsversie_id"])

                cur.execute(
                    """
                    SELECT id, kostprijsversie_id
                    FROM kostprijs_product_activations
                    WHERE bier_id = %s AND jaar = %s AND product_id = %s AND effectief_tot IS NULL
                    ORDER BY effectief_vanaf DESC NULLS LAST, created_at DESC
                    LIMIT 1
                    """,
                    (bier_id, jaar, product_id),
                )
                existing = cur.fetchone()
                existing_id = str(existing[0] or "") if existing else ""
                previous_version_id = str(existing[1] or "") if existing else ""

                # If the active activation already points at the requested version, we keep it as-is.
                if existing_id and previous_version_id == new_version_id:
                    cur.execute(
                        "UPDATE kostprijs_product_activations SET updated_at = %s WHERE id = %s",
                        (now, existing_id),
                    )
                    continue

                if existing_id:
                    cur.execute(
                        """
                        UPDATE kostprijs_product_activations
                        SET effectief_tot = %s, updated_at = %s
                        WHERE id = %s
                        """,
                        (now, now, existing_id),
                    )

                effectief_vanaf = str(row.get("effectief_vanaf", "") or "") or now
                effectief_vanaf_ts = effectief_vanaf or None

                cur.execute(
                    """
                    INSERT INTO kostprijs_product_activations (
                        id, bier_id, jaar, product_id, product_type, kostprijsversie_id,
                        effectief_vanaf, effectief_tot, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, %s, %s)
                    """,
                    (
                        str(uuid4()),
                        bier_id,
                        jaar,
                        product_id,
                        str(row.get("product_type", "") or ""),
                        new_version_id,
                        effectief_vanaf_ts,
                        now,
                        now,
                    ),
                )

                cur.execute(
                    """
                    INSERT INTO kostprijs_activation_events (
                        id,
                        created_at,
                        run_id,
                        actor,
                        action,
                        bier_id,
                        jaar,
                        product_id,
                        product_type,
                        previous_kostprijsversie_id,
                        kostprijsversie_id,
                        effectief_vanaf,
                        metadata
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    """,
                    (
                        str(uuid4()),
                        now,
                        str(ctx.run_id or ""),
                        str(ctx.actor or ""),
                        str(ctx.action or ""),
                        bier_id,
                        jaar,
                        product_id,
                        str(row.get("product_type", "") or ""),
                        previous_version_id,
                        new_version_id,
                        effectief_vanaf_ts,
                        "{}",
                    ),
                )
        conn.commit()

    return True


def list_activation_events(
    *,
    jaar: int | None = None,
    bier_id: str | None = None,
    limit: int = 250,
) -> list[dict[str, Any]]:
    ensure_schema()
    where: list[str] = []
    params: list[Any] = []
    if jaar is not None:
        where.append("jaar = %s")
        params.append(int(jaar))
    if bier_id:
        where.append("bier_id = %s")
        params.append(str(bier_id))
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
                    bier_id,
                    jaar,
                    product_id,
                    product_type,
                    previous_kostprijsversie_id,
                    kostprijsversie_id,
                    effectief_vanaf,
                    metadata
                FROM kostprijs_activation_events
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
            "bier_id": row[5],
            "jaar": row[6],
            "product_id": row[7],
            "product_type": row[8],
            "previous_kostprijsversie_id": row[9],
            "kostprijsversie_id": row[10],
            "effectief_vanaf": _as_iso(row[11]),
            "metadata": row[12] if isinstance(row[12], dict) else {},
        }
        for row in rows
    ]
