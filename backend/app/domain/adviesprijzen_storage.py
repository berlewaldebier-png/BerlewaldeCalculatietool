from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.domain import postgres_storage


def ensure_schema() -> None:
    postgres_storage.ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS advice_channel_pricing (
                    id UUID PRIMARY KEY,
                    jaar INT NOT NULL,
                    channel_code TEXT NOT NULL,
                    opslag_pct NUMERIC NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (jaar, channel_code)
                )
                """
            )
        if not postgres_storage.in_transaction():
            conn.commit()


def load_dataset(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, jaar, channel_code, opslag_pct, created_at, updated_at
                FROM advice_channel_pricing
                ORDER BY jaar ASC, channel_code ASC
                """
            )
            rows = cur.fetchall()

    out: list[dict[str, Any]] = []
    for row in rows or []:
        (rid, jaar, channel_code, opslag_pct, created_at, updated_at) = row
        out.append(
            {
                "id": str(rid),
                "jaar": int(jaar or 0),
                "channel_code": str(channel_code or "").strip().lower(),
                "opslag_pct": float(opslag_pct or 0),
                "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") and created_at else "",
                "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") and updated_at else "",
            }
        )
    return out


def save_dataset(data: Any, *, overwrite: bool = True) -> bool:
    ensure_schema()
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'adviesprijzen': verwacht list.")

    records = [row for row in data if isinstance(row, dict)]
    now = datetime.now(UTC)

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if not overwrite:
                cur.execute("SELECT COUNT(*) FROM advice_channel_pricing")
                count_row = cur.fetchone()
                existing = int((count_row[0] if count_row else 0) or 0)
                if existing > 0:
                    return True

            params: list[tuple[Any, ...]] = []
            ids: list[str] = []
            for row in records:
                record_id = str(row.get("id", "") or "").strip() or str(uuid4())
                try:
                    jaar = int(row.get("jaar", 0) or 0)
                except (TypeError, ValueError):
                    jaar = 0
                channel_code = str(row.get("channel_code", row.get("code", "")) or "").strip().lower()
                if jaar <= 0 or not channel_code:
                    continue
                try:
                    opslag_pct = float(row.get("opslag_pct", row.get("opslag", 0)) or 0.0)
                except (TypeError, ValueError):
                    opslag_pct = 0.0
                ids.append(record_id)
                params.append((record_id, jaar, channel_code, float(opslag_pct), now))

            if overwrite:
                cur.execute("DELETE FROM advice_channel_pricing")

            if params:
                cur.executemany(
                    """
                    INSERT INTO advice_channel_pricing (id, jaar, channel_code, opslag_pct, updated_at)
                    VALUES (%s::uuid, %s, %s, %s::numeric, %s)
                    ON CONFLICT (jaar, channel_code)
                    DO UPDATE SET
                        opslag_pct = EXCLUDED.opslag_pct,
                        updated_at = EXCLUDED.updated_at
                    """,
                    params,
                )
            if not postgres_storage.in_transaction():
                conn.commit()
    return True

