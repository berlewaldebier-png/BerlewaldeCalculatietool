from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date, timedelta
from threading import Lock

from app.domain import postgres_storage
from app.domain import kostprijs_activation_storage
from app.domain import cost_versions_storage, quote_drafts_storage


@dataclass(frozen=True)
class DashboardSummaryCounts:
    concept_berekeningen: int
    definitieve_berekeningen: int
    concept_prijsvoorstellen: int
    definitieve_prijsvoorstellen: int
    klaar_om_te_activeren: int
    klaar_om_te_activeren_waarschuwing: int
    aflopende_offertes: int
    aflopende_offertes_items: list[dict[str, str]]


_cache_lock = Lock()
_cache_until_monotonic: float = 0.0
_cache_value: DashboardSummaryCounts | None = None


def invalidate_dashboard_summary_cache() -> None:
    global _cache_until_monotonic, _cache_value
    with _cache_lock:
        _cache_until_monotonic = 0.0
        _cache_value = None


def _count_statuses_in_dataset(dataset_name: str) -> tuple[int, int]:
    """
    Count concept/definitief rows inside a dataset or table-backed storage.

    This intentionally bypasses utils.storage normalization and avoids multiple full dataset loads
    just to compute dashboard badges.
    """
    # Phase G: some datasets are stored in dedicated tables instead of `app_datasets`.
    if dataset_name == "kostprijsversies":
        cost_versions_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE status = 'concept')::int AS concept_count,
                        COUNT(*) FILTER (WHERE status = 'definitief')::int AS definitief_count
                    FROM cost_versions
                    """
                )
                row = cur.fetchone()
    elif dataset_name == "quote_drafts":
        quote_drafts_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE status = 'concept')::int AS concept_count,
                        COUNT(*) FILTER (WHERE status = 'definitief')::int AS definitief_count
                    FROM quote_drafts
                    """
                )
                row = cur.fetchone()
    else:
        postgres_storage.ensure_schema()
        with postgres_storage.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE elem->>'status' = 'concept')::int AS concept_count,
                        COUNT(*) FILTER (WHERE elem->>'status' = 'definitief')::int AS definitief_count
                    FROM jsonb_array_elements(
                        COALESCE(
                            (SELECT payload FROM app_datasets WHERE dataset_name = %s),
                            '[]'::jsonb
                        )
                    ) AS elem
                    """,
                    (dataset_name,),
                )
                row = cur.fetchone()
    if not row:
        return 0, 0
    return int(row[0] or 0), int(row[1] or 0)


def _expiring_quotes(*, within_days: int = 14, limit: int = 5) -> tuple[int, list[dict[str, str]]]:
    """Count and list concept offertes that expire within a window based on `valid_until`."""
    quote_drafts_storage.ensure_schema()
    today = date.today()
    until = today + timedelta(days=int(within_days))

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    (SELECT COUNT(*)::int
                     FROM quote_drafts
                     WHERE status = 'concept'
                       AND valid_until IS NOT NULL
                       AND valid_until >= %s::date
                       AND valid_until <= %s::date
                    ) AS total,
                    (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
                     FROM (
                        SELECT
                            id,
                            quote_number AS offertenummer,
                            customer_name AS klantnaam,
                            valid_until::text AS verloopt_op,
                            status
                        FROM quote_drafts
                        WHERE status = 'concept'
                          AND valid_until IS NOT NULL
                          AND valid_until >= %s::date
                          AND valid_until <= %s::date
                        ORDER BY valid_until ASC, quote_number ASC
                        LIMIT %s
                     ) AS x
                    ) AS items
                """,
                (today.isoformat(), until.isoformat(), today.isoformat(), until.isoformat(), int(limit)),
            )
            row = cur.fetchone()

    if not row:
        return 0, []
    total = int(row[0] or 0)
    items_payload = row[1] or []
    if isinstance(items_payload, str):
        import json as _json

        items_payload = _json.loads(items_payload)
    items: list[dict[str, str]] = []
    if isinstance(items_payload, list):
        for item in items_payload:
            if not isinstance(item, dict):
                continue
            items.append(
                {
                    "id": str(item.get("id", "") or ""),
                    "offertenummer": str(item.get("offertenummer", "") or ""),
                    "klantnaam": str(item.get("klantnaam", "") or ""),
                    "verloopt_op": str(item.get("verloopt_op", "") or ""),
                    "status": str(item.get("status", "") or ""),
                }
            )
    return total, items


def _ready_to_activate_counts(*, warning_threshold_pct: float = 10.0) -> tuple[int, int]:
    """
    Compare current active product activations against the newest definitive kostprijsversie
    for the same bier/year/product.
    """
    postgres_storage.ensure_schema()
    kostprijs_activation_storage.ensure_schema()
    cost_versions_storage.ensure_schema()

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM kostprijs_sku_activations WHERE effectief_tot IS NULL")
            count_row = cur.fetchone()
            activation_count = int((count_row[0] if count_row else 0) or 0)
            if activation_count == 0:
                return 0, 0

            cur.execute(
                """
                WITH activations AS (
                    SELECT sku_id, jaar, kostprijsversie_id
                    FROM kostprijs_sku_activations
                    WHERE effectief_tot IS NULL
                ),
                versions AS (
                    SELECT
                        id AS version_id,
                        bier_id,
                        jaar,
                        versie_nummer,
                        COALESCE(
                            finalized_at,
                            updated_at,
                            created_at,
                            updated_at_ts
                        ) AS version_ts
                    FROM cost_versions
                    WHERE status = 'definitief'
                ),
                sku_costs AS (
                    SELECT
                        v.version_id,
                        v.jaar,
                        r.sku_id,
                        COALESCE(r.kostprijs, 0) AS kostprijs,
                        v.version_ts,
                        v.versie_nummer
                    FROM versions v
                    JOIN cost_version_sku_rows r
                      ON r.version_id = v.version_id
                    WHERE COALESCE(r.sku_id,'') <> ''
                ),
                active_cost AS (
                    SELECT
                        a.sku_id,
                        a.jaar,
                        a.kostprijsversie_id AS active_version_id,
                        COALESCE(sc.kostprijs, 0) AS active_kostprijs
                    FROM activations a
                    LEFT JOIN sku_costs sc
                      ON sc.version_id = a.kostprijsversie_id
                     AND sc.jaar = a.jaar
                     AND sc.sku_id = a.sku_id
                ),
                latest_per_scope AS (
                    SELECT DISTINCT ON (sku_id, jaar)
                        sku_id,
                        jaar,
                        version_id AS latest_version_id,
                        kostprijs AS latest_kostprijs,
                        version_ts,
                        versie_nummer
                    FROM sku_costs
                    ORDER BY sku_id, jaar, version_ts DESC, versie_nummer DESC, version_id DESC
                ),
                diffs AS (
                    SELECT
                        a.active_version_id,
                        l.latest_version_id,
                        a.active_kostprijs,
                        l.latest_kostprijs,
                        CASE
                            WHEN a.active_kostprijs > 0
                                THEN ((l.latest_kostprijs - a.active_kostprijs) / a.active_kostprijs) * 100.0
                            ELSE NULL
                        END AS delta_pct
                    FROM active_cost a
                    JOIN latest_per_scope l
                      ON l.sku_id = a.sku_id
                     AND l.jaar = a.jaar
                    WHERE l.latest_version_id <> a.active_version_id
                )
                SELECT
                    COUNT(*)::int AS total_ready,
                    COUNT(*) FILTER (
                        WHERE delta_pct IS NOT NULL AND delta_pct >= %s
                    )::int AS warning_ready
                FROM diffs
                """,
                (float(warning_threshold_pct),),
            )
            row = cur.fetchone()

    if not row:
        return 0, 0
    return int(row[0] or 0), int(row[1] or 0)


def get_dashboard_summary(ttl_seconds: float = 10.0) -> DashboardSummaryCounts:
    """
    Return dashboard counts with a short in-process TTL cache.

    Cache is explicitly invalidated on writes/activations, and also expires quickly to avoid
    surprises in development while still making navigation to '/' snappy.
    """
    global _cache_value, _cache_until_monotonic

    if not postgres_storage.uses_postgres():
        raise RuntimeError("dashboard-summary vereist PostgreSQL provider.")

    now = time.monotonic()
    with _cache_lock:
        if _cache_value is not None and now < _cache_until_monotonic:
            return _cache_value

    # kostprijsversies is the canonical source for (compat) berekeningen counts.
    concept_berekeningen, definitieve_berekeningen = _count_statuses_in_dataset("kostprijsversies")
    concept_prijsvoorstellen, definitieve_prijsvoorstellen = _count_statuses_in_dataset("quote_drafts")
    klaar_count, klaar_warn = _ready_to_activate_counts()
    aflopend_count, aflopend_items = _expiring_quotes()
    summary = DashboardSummaryCounts(
        concept_berekeningen=concept_berekeningen,
        definitieve_berekeningen=definitieve_berekeningen,
        concept_prijsvoorstellen=concept_prijsvoorstellen,
        definitieve_prijsvoorstellen=definitieve_prijsvoorstellen,
        klaar_om_te_activeren=klaar_count,
        klaar_om_te_activeren_waarschuwing=klaar_warn,
        aflopende_offertes=aflopend_count,
        aflopende_offertes_items=aflopend_items,
    )

    with _cache_lock:
        _cache_value = summary
        _cache_until_monotonic = now + max(0.0, float(ttl_seconds))

    return summary
