from __future__ import annotations

from datetime import UTC, datetime
from threading import Lock
from typing import Any

from app.domain import postgres_storage


_schema_ready = False
_schema_lock = Lock()


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        if not postgres_storage.database_url():
            return
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS company_distance_cache (
                        company_id BIGINT PRIMARY KEY,
                        address_hash TEXT NOT NULL DEFAULT '',
                        lat NUMERIC NOT NULL DEFAULT 0,
                        lng NUMERIC NOT NULL DEFAULT 0,
                        distance_km_one_way NUMERIC NOT NULL DEFAULT 0,
                        status TEXT NOT NULL DEFAULT '',
                        error TEXT NOT NULL DEFAULT '',
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS idx_company_distance_status ON company_distance_cache(status)")
            if not postgres_storage.in_transaction():
                conn.commit()
        _schema_ready = True


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def upsert_distance(
    *,
    company_id: int,
    address_hash: str,
    lat: float,
    lng: float,
    distance_km_one_way: float,
    status: str,
    error: str = "",
) -> None:
    ensure_schema()
    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO company_distance_cache(
                  company_id,
                  address_hash,
                  lat,
                  lng,
                  distance_km_one_way,
                  status,
                  error,
                  updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (company_id) DO UPDATE SET
                  address_hash = EXCLUDED.address_hash,
                  lat = EXCLUDED.lat,
                  lng = EXCLUDED.lng,
                  distance_km_one_way = EXCLUDED.distance_km_one_way,
                  status = EXCLUDED.status,
                  error = EXCLUDED.error,
                  updated_at = EXCLUDED.updated_at
                """,
                (
                    int(company_id or 0),
                    str(address_hash or ""),
                    _num(lat),
                    _num(lng),
                    _num(distance_km_one_way),
                    str(status or ""),
                    str(error or ""),
                    now,
                ),
            )
        if not postgres_storage.in_transaction():
            conn.commit()


def get_cache(company_id: int) -> dict[str, Any] | None:
    ensure_schema()
    cid = int(company_id or 0)
    if cid <= 0:
        return None
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT company_id, address_hash, lat, lng, distance_km_one_way, status, error, updated_at
                FROM company_distance_cache
                WHERE company_id = %s
                """,
                (cid,),
            )
            row = cur.fetchone()
    if not row:
        return None
    company_id, address_hash, lat, lng, km, status, error, updated_at = row
    return {
        "company_id": int(company_id or 0),
        "address_hash": str(address_hash or ""),
        "lat": float(lat or 0),
        "lng": float(lng or 0),
        "distance_km_one_way": float(km or 0),
        "status": str(status or ""),
        "error": str(error or ""),
        "updated_at": updated_at.isoformat() if updated_at else "",
    }


def list_cache(limit: int = 2000) -> list[dict[str, Any]]:
    ensure_schema()
    lim = max(1, min(int(limit or 2000), 20000))
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT company_id, address_hash, lat, lng, distance_km_one_way, status, error, updated_at
                FROM company_distance_cache
                ORDER BY updated_at DESC
                LIMIT %s
                """,
                (lim,),
            )
            rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for company_id, address_hash, lat, lng, km, status, error, updated_at in rows:
        out.append(
            {
                "company_id": int(company_id or 0),
                "address_hash": str(address_hash or ""),
                "lat": float(lat or 0),
                "lng": float(lng or 0),
                "distance_km_one_way": float(km or 0),
                "status": str(status or ""),
                "error": str(error or ""),
                "updated_at": updated_at.isoformat() if updated_at else "",
            }
        )
    return out

