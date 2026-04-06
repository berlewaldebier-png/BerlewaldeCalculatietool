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
_MIGRATED_FROM_DATASET = False


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def ensure_schema() -> None:
    global _SCHEMA_READY, _MIGRATED_FROM_DATASET
    if _SCHEMA_READY:
        return

    postgres_storage.ensure_schema()
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
                    effectief_vanaf TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT ''
                );
                """
            )
            cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ux_kostprijs_product_activation_scope
                ON kostprijs_product_activations (bier_id, jaar, product_id);
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
                CREATE TABLE IF NOT EXISTS kostprijs_activation_events (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    run_id TEXT NOT NULL DEFAULT '',
                    actor TEXT NOT NULL DEFAULT '',
                    action TEXT NOT NULL DEFAULT '',
                    bier_id TEXT NOT NULL,
                    jaar INTEGER NOT NULL,
                    product_id TEXT NOT NULL,
                    product_type TEXT NOT NULL,
                    previous_kostprijsversie_id TEXT NOT NULL DEFAULT '',
                    kostprijsversie_id TEXT NOT NULL,
                    effectief_vanaf TEXT NOT NULL DEFAULT '',
                    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
                );
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS ix_kostprijs_activation_events_created_at
                ON kostprijs_activation_events (created_at);
                """
            )
        conn.commit()

    _SCHEMA_READY = True

    # One-time migration from legacy app_datasets payload into the normalized table.
    if not _MIGRATED_FROM_DATASET:
        _MIGRATED_FROM_DATASET = True
        try:
            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM kostprijs_product_activations")
                    count_row = cur.fetchone()
                    existing_count = int((count_row[0] if count_row else 0) or 0)
            if existing_count == 0:
                legacy = postgres_storage.load_dataset("kostprijsproductactiveringen", None)
                if isinstance(legacy, list) and legacy:
                    upsert_activations([row for row in legacy if isinstance(row, dict)], context=ActivationContext(action="migrate"))
        except Exception:
            # Migration is best-effort; schema must still be usable for new writes.
            pass

    # _SCHEMA_READY already set above


def normalize_activation_record(record: dict[str, Any] | None) -> dict[str, Any]:
    src = record if isinstance(record, dict) else {}
    created_at = str(src.get("created_at", "") or "") or _now_iso()
    updated_at = str(src.get("updated_at", "") or "") or created_at
    effectief_vanaf = str(src.get("effectief_vanaf", "") or src.get("effective_from", "") or "")
    return {
        "id": str(src.get("id", "") or uuid4()),
        "bier_id": str(src.get("bier_id", "") or ""),
        "jaar": int(src.get("jaar", 0) or 0),
        "product_id": str(src.get("product_id", "") or ""),
        "product_type": str(src.get("product_type", "") or ""),
        "kostprijsversie_id": str(src.get("kostprijsversie_id", "") or ""),
        "effectief_vanaf": effectief_vanaf,
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
                    created_at,
                    updated_at
                FROM kostprijs_product_activations
                ORDER BY jaar, bier_id, product_id
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
                "created_at": row[7],
                "updated_at": row[8],
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
                    WHERE bier_id = %s AND jaar = %s AND product_id = %s
                    """,
                    (bier_id, jaar, product_id),
                )
                existing = cur.fetchone()
                previous_version_id = str(existing[1] or "") if existing else ""

                created_at = str(row.get("created_at", "") or "") or now
                updated_at = str(row.get("updated_at", "") or "") or now
                effectief_vanaf = str(row.get("effectief_vanaf", "") or "") or ""

                cur.execute(
                    """
                    INSERT INTO kostprijs_product_activations (
                        id, bier_id, jaar, product_id, product_type, kostprijsversie_id,
                        effectief_vanaf, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (bier_id, jaar, product_id)
                    DO UPDATE SET
                        product_type = EXCLUDED.product_type,
                        kostprijsversie_id = EXCLUDED.kostprijsversie_id,
                        effectief_vanaf = EXCLUDED.effectief_vanaf,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        str(row["id"]),
                        bier_id,
                        jaar,
                        product_id,
                        str(row.get("product_type", "") or ""),
                        str(row["kostprijsversie_id"]),
                        effectief_vanaf,
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
                            effectief_vanaf,
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

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            # Full replace to guarantee that old/legacy ids are removed.
            cur.execute("DELETE FROM kostprijs_product_activations")

            for row in normalized_rows:
                bier_id = str(row["bier_id"])
                jaar = int(row["jaar"])
                product_id = str(row["product_id"])

                created_at = str(row.get("created_at", "") or "") or now
                updated_at = str(row.get("updated_at", "") or "") or now
                effectief_vanaf = str(row.get("effectief_vanaf", "") or "") or ""

                cur.execute(
                    """
                    INSERT INTO kostprijs_product_activations (
                        id, bier_id, jaar, product_id, product_type, kostprijsversie_id,
                        effectief_vanaf, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        str(row["id"]),
                        bier_id,
                        jaar,
                        product_id,
                        str(row.get("product_type", "") or ""),
                        str(row["kostprijsversie_id"]),
                        effectief_vanaf,
                        created_at,
                        updated_at,
                    ),
                )

        conn.commit()

    # Event logging for replace operations is intentionally omitted; use activate endpoints for audit trails.
    _ = ctx
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
            "created_at": row[1],
            "run_id": row[2],
            "actor": row[3],
            "action": row[4],
            "bier_id": row[5],
            "jaar": row[6],
            "product_id": row[7],
            "product_type": row[8],
            "previous_kostprijsversie_id": row[9],
            "kostprijsversie_id": row[10],
            "effectief_vanaf": row[11],
            "metadata": row[12] if isinstance(row[12], dict) else {},
        }
        for row in rows
    ]
