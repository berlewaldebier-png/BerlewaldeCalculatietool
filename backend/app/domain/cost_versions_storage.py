from __future__ import annotations

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import NAMESPACE_URL, uuid5
from uuid import uuid4

from app.domain import postgres_storage
from app.domain import fixed_costs_storage
from app.domain import production_storage


_SCHEMA_READY = False
_SCHEMA_LOCK = Lock()


def reset_defaults() -> None:
    """Development helper: clear cost versions and their normalized SKU rows.

    This is intentionally destructive and should only be called from local/dev reset flows.
    """
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            # Delete SKU rows first to satisfy FK constraints (cost_version_sku_rows -> skus).
            cur.execute("TRUNCATE TABLE cost_version_sku_rows")
            cur.execute("TRUNCATE TABLE cost_versions")
        if not postgres_storage.in_transaction():
            conn.commit()


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
                    CREATE TABLE IF NOT EXISTS cost_versions (
                        id TEXT PRIMARY KEY,
                        jaar INTEGER NOT NULL DEFAULT 0,
                        status TEXT NOT NULL DEFAULT '',
                        bier_id TEXT NOT NULL DEFAULT '',
                        versie_nummer INTEGER NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ NULL,
                        updated_at TIMESTAMPTZ NULL,
                        finalized_at TIMESTAMPTZ NULL,
                        payload JSONB NOT NULL,
                        updated_at_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                # Legacy dev DBs may still have these timestamps as TEXT; normalize to TIMESTAMPTZ.
                # Important: columns must allow NULL because legacy rows used ''.
                cur.execute(
                    """
                    DO $$
                    BEGIN
                      IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'cost_versions'
                          AND column_name = 'created_at'
                          AND data_type = 'text'
                      ) THEN
                        ALTER TABLE cost_versions ALTER COLUMN created_at DROP DEFAULT;
                        ALTER TABLE cost_versions ALTER COLUMN created_at DROP NOT NULL;
                        ALTER TABLE cost_versions
                          ALTER COLUMN created_at TYPE TIMESTAMPTZ
                          USING NULLIF(created_at::text,'')::timestamptz;
                      END IF;

                      IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'cost_versions'
                          AND column_name = 'updated_at'
                          AND data_type = 'text'
                      ) THEN
                        ALTER TABLE cost_versions ALTER COLUMN updated_at DROP DEFAULT;
                        ALTER TABLE cost_versions ALTER COLUMN updated_at DROP NOT NULL;
                        ALTER TABLE cost_versions
                          ALTER COLUMN updated_at TYPE TIMESTAMPTZ
                          USING NULLIF(updated_at::text,'')::timestamptz;
                      END IF;

                      IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'cost_versions'
                          AND column_name = 'finalized_at'
                          AND data_type = 'text'
                      ) THEN
                        ALTER TABLE cost_versions ALTER COLUMN finalized_at DROP DEFAULT;
                        ALTER TABLE cost_versions ALTER COLUMN finalized_at DROP NOT NULL;
                        ALTER TABLE cost_versions
                          ALTER COLUMN finalized_at TYPE TIMESTAMPTZ
                          USING NULLIF(finalized_at::text,'')::timestamptz;
                      END IF;
                    END $$;
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS cost_version_sku_rows (
                        id TEXT PRIMARY KEY,
                        version_id TEXT NOT NULL REFERENCES cost_versions(id) ON DELETE CASCADE,
                        sku_id TEXT NOT NULL,
                        verpakking_label TEXT NOT NULL DEFAULT '',
                        inkoop NUMERIC NOT NULL DEFAULT 0,
                        verpakkingskosten NUMERIC NOT NULL DEFAULT 0,
                        indirecte_kosten NUMERIC NOT NULL DEFAULT 0,
                        accijns NUMERIC NOT NULL DEFAULT 0,
                        kostprijs NUMERIC NOT NULL DEFAULT 0,
                        sort_index INTEGER NOT NULL DEFAULT 0
                    );
                    """
                )
                # Keep SKU integrity when possible (NOT VALID avoids blocking startup on legacy data).
                cur.execute(
                    """
                    DO $$
                    BEGIN
                        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='skus')
                           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_cost_version_sku_rows_sku') THEN
                            ALTER TABLE cost_version_sku_rows
                            ADD CONSTRAINT fk_cost_version_sku_rows_sku
                            FOREIGN KEY (sku_id) REFERENCES skus(id) ON DELETE RESTRICT
                            NOT VALID;
                        END IF;
                    END $$;
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_cost_version_sku_rows_version ON cost_version_sku_rows(version_id)"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_cost_version_sku_rows_sku ON cost_version_sku_rows(sku_id)"
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_cost_versions_year
                    ON cost_versions (jaar);
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_cost_versions_status
                    ON cost_versions (status);
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_cost_versions_bier
                    ON cost_versions (bier_id);
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_cost_versions_year_status
                    ON cost_versions (jaar, status);
                    """
                )
            if not postgres_storage.in_transaction():
                conn.commit()

        _SCHEMA_READY = True


def _strip_snapshot_sections(row: dict[str, Any]) -> dict[str, Any]:
    """Keep top-level cost version fields in payload; store product snapshot rows in normalized tables."""
    cleaned = dict(row)
    snapshot = cleaned.get("resultaat_snapshot")
    if isinstance(snapshot, dict):
        products = snapshot.get("producten")
        if isinstance(products, dict):
            products = dict(products)
            products.pop("basisproducten", None)
            products.pop("samengestelde_producten", None)
            snapshot = dict(snapshot)
            snapshot["producten"] = products
            cleaned["resultaat_snapshot"] = snapshot
    return cleaned


def load_dataset(default_value: Any) -> Any:
    ensure_schema()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    jaar,
                    status,
                    bier_id,
                    versie_nummer,
                    created_at,
                    updated_at,
                    finalized_at,
                    payload
                FROM cost_versions
                ORDER BY jaar, bier_id, versie_nummer, id
                """
            )
            version_rows = cur.fetchall()
            cur.execute(
                """
                SELECT id, version_id, sku_id, verpakking_label,
                       inkoop, verpakkingskosten, indirecte_kosten, accijns, kostprijs, sort_index
                FROM cost_version_sku_rows
                ORDER BY version_id, sort_index, id
                """
            )
            sku_rows = cur.fetchall()
            sku_meta: dict[str, dict[str, Any]] = {}
            try:
                cur.execute("SELECT id, beer_id, format_article_id, article_id, name, code FROM skus")
                for sid, beer_id, format_article_id, article_id, name, code in cur.fetchall() or []:
                    sku_meta[str(sid)] = {
                        "id": str(sid),
                        "beer_id": str(beer_id or ""),
                        "format_article_id": str(format_article_id or ""),
                        "article_id": str(article_id or ""),
                        "name": str(name or ""),
                        "code": str(code or ""),
                    }
            except Exception:
                sku_meta = {}

    if not version_rows:
        return default_value

    basis_by_version: dict[str, list[dict[str, Any]]] = {}
    for (
        row_id,
        version_id,
        sku_id,
        verpakking_label,
        inkoop,
        verpakkingskosten,
        indirecte_kosten,
        accijns,
        kostprijs,
        _sort_index,
    ) in sku_rows:
        verpakking_text = str(verpakking_label or "")
        inkoop_value = float(inkoop or 0)
        indirect_value = float(indirecte_kosten or 0)
        sku_text = str(sku_id or "")
        meta = sku_meta.get(sku_text, {})
        beer_id_text = str(meta.get("beer_id", "") or "")
        format_article_id = str(meta.get("format_article_id", "") or "")
        article_id = str(meta.get("article_id", "") or "")
        # Historically UIs expect `product_id` to be present in snapshot rows for definitive versions.
        # In the SKU model, format SKUs map to `format_article_id`, while article SKUs (bundles/packaging)
        # map to `article_id`.
        product_id = format_article_id or article_id
        product_type = "sku" if format_article_id else ("article" if article_id else "sku")
        payload: dict[str, Any] = {
            "id": str(row_id),
            "sku_id": sku_text,
            "bier_id": beer_id_text,
            "product_id": product_id,
            "product_type": product_type,
            "verpakking": verpakking_text,
            "verpakkingseenheid": verpakking_text,
            "verpakking_label": str(verpakking_label or ""),
            # Keep historical key used by wizard tooling (scenario defaults to this).
            "primaire_kosten": inkoop_value,
            "variabele_kosten": inkoop_value,
            "inkoop": float(inkoop or 0),
            "verpakkingskosten": float(verpakkingskosten or 0),
            # Legacy UIs (KostprijsBeheerWorkspace) read `vaste_kosten` / `vaste_directe_kosten`.
            # We store the year-activation fixed allocation as `indirecte_kosten` in the table,
            # so rehydrate it into the expected legacy keys here.
            "indirecte_kosten": indirect_value,
            "vaste_kosten": indirect_value,
            "vaste_directe_kosten": indirect_value,
            "accijns": float(accijns or 0),
            "kostprijs": float(kostprijs or 0),
        }
        basis_by_version.setdefault(str(version_id), []).append(payload)

    out: list[dict[str, Any]] = []
    for (
        version_id,
        jaar,
        status,
        bier_id,
        versie_nummer,
        created_at,
        updated_at,
        finalized_at,
        payload,
    ) in version_rows:
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            continue
        # Columns are canonical; payload is a view cache. Always override payload with column values.
        merged = dict(payload)
        merged["id"] = str(version_id)
        merged["jaar"] = int(jaar or 0)
        merged["status"] = str(status or "")
        merged["bier_id"] = str(bier_id or "")
        merged["versie_nummer"] = int(versie_nummer or 0)
        merged["created_at"] = created_at.isoformat() if hasattr(created_at, "isoformat") and created_at else ""
        merged["updated_at"] = updated_at.isoformat() if hasattr(updated_at, "isoformat") and updated_at else ""
        merged["finalized_at"] = finalized_at.isoformat() if hasattr(finalized_at, "isoformat") and finalized_at else ""
        snapshot = merged.get("resultaat_snapshot")
        if not isinstance(snapshot, dict):
            snapshot = {}
        producten = snapshot.get("producten")
        if not isinstance(producten, dict):
            producten = {}
        producten = dict(producten)
        producten["basisproducten"] = basis_by_version.get(str(version_id), [])
        producten["samengestelde_producten"] = []

        # Provide row-level display metadata (biernaam/soort) derived from the version itself,
        # so UIs can render a stable summary without having to recompute/guess.
        basisgegevens = merged.get("basisgegevens") if isinstance(merged.get("basisgegevens"), dict) else {}
        bier_snapshot = merged.get("bier_snapshot") if isinstance(merged.get("bier_snapshot"), dict) else {}
        biernaam = str(
            (basisgegevens or {}).get("biernaam", "") or (bier_snapshot or {}).get("biernaam", "") or ""
        ).strip()
        version_type = str(merged.get("type", "") or "").strip().lower()
        soort_label = "Inkoop" if version_type == "inkoop" else "Eigen productie"

        for row in producten.get("basisproducten", []) if isinstance(producten.get("basisproducten", []), list) else []:
            if isinstance(row, dict):
                row.setdefault("biernaam", biernaam)
                row.setdefault("soort", soort_label)
        for row in producten.get("samengestelde_producten", []) if isinstance(producten.get("samengestelde_producten", []), list) else []:
            if isinstance(row, dict):
                row.setdefault("biernaam", biernaam)
                row.setdefault("soort", soort_label)

        snapshot = dict(snapshot)
        snapshot["producten"] = producten
        merged["resultaat_snapshot"] = snapshot
        # Canonical per-SKU cost lines (normalized table). Prefer this over parsing `resultaat_snapshot` in read-models.
        merged["cost_lines"] = basis_by_version.get(str(version_id), [])
        out.append(merged)

    return out


def save_dataset(data: Any, *, overwrite: bool = True) -> bool:
    ensure_schema()
    if not isinstance(data, list):
        raise ValueError("Ongeldig payload voor 'kostprijsversies': verwacht list.")

    records: list[dict[str, Any]] = [row for row in data if isinstance(row, dict)]
    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if not overwrite:
                cur.execute("SELECT COUNT(*) FROM cost_versions")
                count_row = cur.fetchone()
                existing = int((count_row[0] if count_row else 0) or 0)
                if existing > 0:
                    return True
            if records:
                params: list[tuple[Any, ...]] = []
                years_in_payload: set[int] = set()
                version_ids_by_year: dict[int, set[str]] = {}
                for row in records:
                    record_id = str(row.get("id", "") or "").strip()
                    if not record_id:
                        raise ValueError("Kostprijsversie mist verplicht veld 'id'.")
                    status = str(row.get("status", "") or "").strip().lower()
                    bier_id = str(row.get("bier_id", "") or "")
                    try:
                        jaar = int(row.get("jaar", 0) or 0)
                    except (TypeError, ValueError):
                        jaar = 0
                    years_in_payload.add(jaar)
                    version_ids_by_year.setdefault(jaar, set()).add(record_id)
                    try:
                        versie_nummer = int(row.get("versie_nummer", 0) or 0)
                    except (TypeError, ValueError):
                        versie_nummer = 0
                    created_at = str(row.get("created_at", "") or "")
                    updated_at = str(row.get("updated_at", "") or "")
                    finalized_at = str(row.get("finalized_at", "") or "")
                    # Payload is a view cache; force canonical column values into it.
                    payload_obj = _strip_snapshot_sections(row)
                    payload_obj["id"] = record_id
                    payload_obj["jaar"] = jaar
                    payload_obj["status"] = status
                    payload_obj["bier_id"] = bier_id
                    payload_obj["versie_nummer"] = versie_nummer
                    payload_obj["created_at"] = created_at
                    payload_obj["updated_at"] = updated_at
                    payload_obj["finalized_at"] = finalized_at
                    params.append(
                        (
                            record_id,
                            jaar,
                            status,
                            bier_id,
                            versie_nummer,
                            created_at,
                            updated_at,
                            finalized_at,
                            json.dumps(payload_obj, ensure_ascii=False),
                            now,
                        )
                    )

                # Replace-by-scope (overwrite): only delete stale versions for the years present in this payload.
                # This prevents wiping other years when saving a single year from the UI.
                if overwrite:
                    for jaar in sorted(years_in_payload):
                        ids = sorted(version_ids_by_year.get(jaar, set()))
                        if not ids:
                            cur.execute("DELETE FROM cost_versions WHERE jaar = %s", (jaar,))
                            continue
                        placeholders = ", ".join(["%s"] * len(ids))
                        cur.execute(
                            f"DELETE FROM cost_versions WHERE jaar = %s AND id NOT IN ({placeholders})",
                            (jaar, *ids),
                        )
                cur.executemany(
                    """
                    INSERT INTO cost_versions
                        (id, jaar, status, bier_id, versie_nummer, created_at, updated_at, finalized_at, payload, updated_at_ts)
                    VALUES (
                        %s, %s, %s, %s, %s,
                        NULLIF(%s,'')::timestamptz,
                        NULLIF(%s,'')::timestamptz,
                        NULLIF(%s,'')::timestamptz,
                        %s::jsonb, %s
                    )
                    ON CONFLICT (id)
                    DO UPDATE SET
                        jaar = EXCLUDED.jaar,
                        status = EXCLUDED.status,
                        bier_id = EXCLUDED.bier_id,
                        versie_nummer = EXCLUDED.versie_nummer,
                        created_at = EXCLUDED.created_at,
                        updated_at = EXCLUDED.updated_at,
                        finalized_at = EXCLUDED.finalized_at,
                        payload = EXCLUDED.payload,
                        updated_at_ts = EXCLUDED.updated_at_ts
                    """,
                    params,
                )
                row_params: list[tuple[Any, ...]] = []
                row_ids_by_version: dict[str, set[str]] = {}
                sku_by_beer_format: dict[tuple[str, str], str] = {}
                try:
                    cur.execute("SELECT id, beer_id, format_article_id FROM skus")
                    for sid, beer_id, format_article_id in cur.fetchall() or []:
                        sid_text = str(sid or "")
                        beer_text = str(beer_id or "")
                        fmt_text = str(format_article_id or "")
                        if sid_text and beer_text and fmt_text:
                            sku_by_beer_format[(beer_text, fmt_text)] = sid_text
                except Exception:
                    sku_by_beer_format = {}
                for version in records:
                    version_id = str(version.get("id", "") or "").strip()
                    if not version_id:
                        continue
                    bier_id = str(version.get("bier_id", "") or "")
                    snapshot = version.get("resultaat_snapshot") if isinstance(version, dict) else {}
                    producten = (snapshot or {}).get("producten") if isinstance(snapshot, dict) else {}
                    basis = (producten or {}).get("basisproducten") if isinstance(producten, dict) else []
                    sameng = (producten or {}).get("samengestelde_producten") if isinstance(producten, dict) else []

                    sort_index = 0
                    for item in (basis if isinstance(basis, list) else []) + (sameng if isinstance(sameng, list) else []):
                        if not isinstance(item, dict):
                            continue
                        sku_id = str(item.get("sku_id", "") or "").strip()
                        if not sku_id:
                            product_id = str(item.get("product_id", "") or "").strip()
                            if product_id:
                                sku_id = sku_by_beer_format.get((bier_id, product_id), "")
                        if not sku_id:
                            continue
                        row_id = str(item.get("id", "") or "").strip() or str(
                            uuid5(NAMESPACE_URL, f"cost_version_sku_row:{version_id}:{sku_id}")
                        )
                        row_ids_by_version.setdefault(version_id, set()).add(row_id)
                        row_params.append(
                            (
                                row_id,
                                version_id,
                                sku_id,
                                str(item.get("verpakkingseenheid", item.get("verpakking_label", "")) or ""),
                                float(item.get("inkoop", item.get("primaire_kosten", item.get("variabele_kosten", 0))) or 0),
                                float(item.get("verpakkingskosten", 0) or 0),
                                float(item.get("indirecte_kosten", item.get("vaste_kosten", 0)) or 0),
                                float(item.get("accijns", 0) or 0),
                                float(item.get("kostprijs", 0) or 0),
                                int(sort_index),
                            )
                        )
                        sort_index += 1

                    # Deterministic fallback for non-beer SKUs: if a definitive version has no snapshot items,
                    # we still want a single normalized row for the version's own SKU (used by offerte selectors).
                    if sort_index == 0:
                        basisgegevens = version.get("basisgegevens") if isinstance(version.get("basisgegevens"), dict) else {}
                        version_sku_id = str((basisgegevens or {}).get("sku_id", "") or "").strip()
                        if version_sku_id:
                            try:
                                kostprijs_total = float(version.get("kostprijs", 0) or 0)
                            except (TypeError, ValueError):
                                kostprijs_total = 0.0
                            row_id = str(uuid5(NAMESPACE_URL, f"cost_version_sku_row:{version_id}:{version_sku_id}"))
                            row_ids_by_version.setdefault(version_id, set()).add(row_id)
                            row_params.append(
                                (
                                    row_id,
                                    version_id,
                                    version_sku_id,
                                    str((basisgegevens or {}).get("biernaam", "") or ""),
                                    kostprijs_total,
                                    0.0,
                                    0.0,
                                    0.0,
                                    kostprijs_total,
                                    0,
                                )
                            )

                # Replace-by-scope for snapshot rows: per version_id, delete rows that are no longer present.
                if overwrite:
                    for version in records:
                        version_id = str(version.get("id", "") or "").strip()
                        if not version_id:
                            continue
                        ids = sorted(row_ids_by_version.get(version_id, set()))
                        if not ids:
                            cur.execute("DELETE FROM cost_version_sku_rows WHERE version_id = %s", (version_id,))
                            continue
                        placeholders = ", ".join(["%s"] * len(ids))
                        cur.execute(
                            f"DELETE FROM cost_version_sku_rows WHERE version_id = %s AND id NOT IN ({placeholders})",
                            (version_id, *ids),
                        )

                if row_params:
                    cur.executemany(
                        """
                        INSERT INTO cost_version_sku_rows (
                            id, version_id, sku_id, verpakking_label,
                            inkoop, verpakkingskosten, indirecte_kosten, accijns, kostprijs, sort_index
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            version_id = EXCLUDED.version_id,
                            sku_id = EXCLUDED.sku_id,
                            verpakking_label = EXCLUDED.verpakking_label,
                            inkoop = EXCLUDED.inkoop,
                            verpakkingskosten = EXCLUDED.verpakkingskosten,
                            indirecte_kosten = EXCLUDED.indirecte_kosten,
                            accijns = EXCLUDED.accijns,
                            kostprijs = EXCLUDED.kostprijs,
                            sort_index = EXCLUDED.sort_index
                        """,
                        row_params,
                    )
            elif overwrite:
                # Overwrite with an empty list means "clear all cost versions".
                cur.execute("DELETE FROM cost_versions")
        if not postgres_storage.in_transaction():
            conn.commit()

    # Ensure we don't keep a stale legacy row around.
    try:
        postgres_storage.delete_app_dataset_row("kostprijsversies")
    except Exception:
        pass
    return True


def count_versions_for_year(year: int) -> dict[str, int]:
    """Return counts of normalized cost versions (and their product rows) for a given year."""
    ensure_schema()
    year_value = int(year)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM cost_versions WHERE jaar = %s", (year_value,))
            versions_row = cur.fetchone()
            versions = int((versions_row[0] if versions_row else 0) or 0)
            cur.execute(
                """
                SELECT COUNT(*)
                FROM cost_version_sku_rows r
                JOIN cost_versions v ON v.id = r.version_id
                WHERE v.jaar = %s
                """,
                (year_value,),
            )
            rows_row = cur.fetchone()
            rows = int((rows_row[0] if rows_row else 0) or 0)
    return {"versions": versions, "product_rows": rows}


def delete_versions_for_year(year: int) -> dict[str, int]:
    """Delete normalized cost versions for the given year (cascades to product rows)."""
    ensure_schema()
    year_value = int(year)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cost_versions WHERE jaar = %s", (year_value,))
            deleted_versions = int(cur.rowcount or 0)
        if not postgres_storage.in_transaction():
            conn.commit()
    # Product rows are deleted via ON DELETE CASCADE.
    return {"deleted_versions": deleted_versions}


def audit_sku_row_coverage(*, year: int) -> dict[str, Any]:
    """Admin helper: audit coverage of normalized SKU snapshot rows for a year.

    Goal: detect versions that exist but have zero `cost_version_sku_rows` rows, which means
    downstream selectors (offerte/verkoopstrategie/dashboards) cannot resolve per-SKU costs.
    """
    ensure_schema()
    year_value = int(year or 0)
    if year_value <= 0:
        return {"year": year_value, "error": "invalid_year"}

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT v.id, v.status, v.bier_id, v.versie_nummer
                FROM cost_versions v
                LEFT JOIN cost_version_sku_rows r ON r.version_id = v.id
                WHERE v.jaar = %s
                GROUP BY v.id, v.status, v.bier_id, v.versie_nummer
                HAVING COUNT(r.id) = 0
                ORDER BY v.status, v.bier_id, v.versie_nummer, v.id
                """,
                (year_value,),
            )
            missing_rows = [
                {"version_id": rid, "status": status, "bier_id": bier_id, "versie_nummer": versie_nummer}
                for rid, status, bier_id, versie_nummer in (cur.fetchall() or [])
            ]
            cur.execute("SELECT COUNT(*) FROM cost_versions WHERE jaar = %s", (year_value,))
            versions_total = int((cur.fetchone() or [0])[0] or 0)
            cur.execute(
                """
                SELECT COUNT(*)
                FROM cost_version_sku_rows r
                JOIN cost_versions v ON v.id = r.version_id
                WHERE v.jaar = %s
                """,
                (year_value,),
            )
            sku_rows_total = int((cur.fetchone() or [0])[0] or 0)

    return {
        "year": year_value,
        "versions_total": versions_total,
        "sku_rows_total": sku_rows_total,
        "versions_missing_sku_rows": missing_rows,
        "missing_count": len(missing_rows),
    }


def rebuild_sku_rows_for_year(*, year: int, dry_run: bool = True) -> dict[str, Any]:
    """Admin helper: regenerate `cost_version_sku_rows` from version payload snapshots for a year.

    This does **not** change the cost versions themselves; it only ensures the normalized per-SKU rows exist.
    Intended for dev/ops repair when legacy rows were missing sku_id/product_id references.
    """
    ensure_schema()
    year_value = int(year or 0)
    if year_value <= 0:
        return {"year": year_value, "error": "invalid_year"}

    # Pull the canonical dataset view for that year, then re-save it.
    dataset = load_dataset(default_value=[])
    records = [row for row in (dataset if isinstance(dataset, list) else []) if isinstance(row, dict)]
    year_records = [row for row in records if int(row.get("jaar", 0) or 0) == year_value]

    audit_before = audit_sku_row_coverage(year=year_value)
    if dry_run:
        return {"year": year_value, "dry_run": True, "audit_before": audit_before, "would_process": len(year_records)}

    # Re-save just this year. `save_dataset` uses replace-by-scope semantics per jaar.
    save_dataset(year_records, overwrite=True)
    audit_after = audit_sku_row_coverage(year=year_value)
    return {"year": year_value, "dry_run": False, "audit_before": audit_before, "audit_after": audit_after}


def repair_inkoop_unit_costs_for_year(*, year: int, dry_run: bool = True) -> dict[str, Any]:
    """Admin helper: recompute definitive inkoop snapshots using unit-cost SSOT and rebuild sku rows.

    Why: legacy definitive inkoop versions historically derived per-SKU costs from EUR/liter KPIs.
    This repair recomputes `resultaat_snapshot.producten.basisproducten` deterministically from:
    - inkoop factuurregels (unit-cost per purchased unit incl. allocated extras)
    - format composition BOM (doos -> fles) for derived units
    Then `save_dataset` rebuilds `cost_version_sku_rows` accordingly.
    """
    ensure_schema()
    year_value = int(year or 0)
    if year_value <= 0:
        return {"year": year_value, "error": "invalid_year"}

    from app.utils.storage import normalize_berekening_record

    def _is_definitive_inkoop(payload: dict[str, Any]) -> bool:
        if not isinstance(payload, dict):
            return False
        if str(payload.get("status", "") or "").strip().lower() != "definitief":
            return False
        # Primary discriminator: top-level "type" stored by UI (inkoop/bundle/article/...)
        if str(payload.get("type", "") or "").strip().lower() == "inkoop":
            return True
        soort = payload.get("soort_berekening")
        if isinstance(soort, dict) and str(soort.get("type", "") or "").strip().lower() == "inkoop":
            return True
        return False

    def _force_empty_product_snapshot(record: dict[str, Any]) -> None:
        snapshot = record.get("resultaat_snapshot")
        if not isinstance(snapshot, dict):
            snapshot = {}
        producten = snapshot.get("producten")
        if not isinstance(producten, dict):
            producten = {}
        producten = dict(producten)
        producten["basisproducten"] = []
        producten["samengestelde_producten"] = []
        snapshot = dict(snapshot)
        snapshot["producten"] = producten
        record["resultaat_snapshot"] = snapshot

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, jaar, status, bier_id, versie_nummer, created_at, updated_at, finalized_at, payload
                FROM cost_versions
                WHERE jaar = %s
                  AND LOWER(status) = 'definitief'
                ORDER BY bier_id, versie_nummer, id
                """,
                (year_value,),
            )
            rows = cur.fetchall() or []

    candidates: list[dict[str, Any]] = []
    recomputed_by_id: dict[str, dict[str, Any]] = {}
    issues: list[dict[str, Any]] = []
    for (
        version_id,
        jaar,
        status,
        bier_id,
        versie_nummer,
        created_at,
        updated_at,
        finalized_at,
        payload,
    ) in rows:
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = {}
        if not isinstance(payload, dict):
            issues.append({"version_id": str(version_id), "error": "invalid_payload"})
            continue
        merged: dict[str, Any] = dict(payload)
        merged["id"] = str(version_id)
        merged["jaar"] = int(jaar or 0)
        merged["status"] = str(status or "")
        merged["bier_id"] = str(bier_id or "")
        merged["versie_nummer"] = int(versie_nummer or 0)
        merged["created_at"] = created_at.isoformat() if hasattr(created_at, "isoformat") and created_at else ""
        merged["updated_at"] = updated_at.isoformat() if hasattr(updated_at, "isoformat") and updated_at else ""
        merged["finalized_at"] = finalized_at.isoformat() if hasattr(finalized_at, "isoformat") and finalized_at else ""

        if not _is_definitive_inkoop(merged):
            continue

        _force_empty_product_snapshot(merged)
        try:
            normalized = normalize_berekening_record(merged)
        except Exception as exc:
            issues.append({"version_id": str(version_id), "error": str(exc)})
            continue
        candidates.append(normalized)
        recomputed_by_id[str(version_id)] = normalized

    audit_before = audit_sku_row_coverage(year=year_value)
    if dry_run:
        return {
            "year": year_value,
            "dry_run": True,
            "audit_before": audit_before,
            "inkoop_versions_found": len(candidates),
            "issues": issues,
        }

    # Important: `save_dataset(..., overwrite=True)` uses replace-by-scope semantics per `jaar`.
    # So we must preserve *all* cost versions for this year, and only replace the inkoop ones we recomputed.
    dataset = load_dataset(default_value=[])
    all_records = [row for row in (dataset if isinstance(dataset, list) else []) if isinstance(row, dict)]
    year_records = [row for row in all_records if int(row.get("jaar", 0) or 0) == year_value]
    preserved_count_before = len(year_records)
    updated_year_records: list[dict[str, Any]] = []
    replaced = 0
    for row in year_records:
        vid = str(row.get("id", "") or "").strip()
        if vid and vid in recomputed_by_id:
            updated_year_records.append(recomputed_by_id[vid])
            replaced += 1
        else:
            updated_year_records.append(row)

    # Re-save this whole year. This updates cost_versions payload snapshots and rebuilds sku rows.
    save_dataset(updated_year_records, overwrite=True)
    audit_after = audit_sku_row_coverage(year=year_value)
    return {
        "year": year_value,
        "dry_run": False,
        "audit_before": audit_before,
        "audit_after": audit_after,
        "inkoop_versions_processed": len(candidates),
        "year_versions_preserved": preserved_count_before,
        "year_versions_replaced": replaced,
        "issues": issues,
    }


def rebuild_overhead_versions_for_year(*, year: int, owner: str, dry_run: bool = True) -> dict[str, Any]:
    """Create new definitive cost versions for the given year with ABC-light overhead recomputed.

    This is Phase 4 glue for the costing refactor: "recalculate" means mint a new version (non-destructive),
    then optionally activate it via the existing activation pipeline.

    Notes:
    - We only recompute overhead for product rows where we can resolve liters (basis/samengesteld formats).
    - When no ABC fields are configured on vaste kosten rows, we do not change overhead (legacy behaviour).
    """
    ensure_schema()
    year_value = int(year or 0)
    if year_value <= 0:
        raise ValueError("Jaar is ongeldig.")

    versions = load_dataset(default_value=[])
    records = [row for row in (versions if isinstance(versions, list) else []) if isinstance(row, dict)]
    year_records = [row for row in records if int(row.get("jaar", 0) or 0) == year_value]
    if not year_records:
        return {
            "year": year_value,
            "dry_run": bool(dry_run),
            "created_versions": 0,
            "created_version_ids": [],
            "detail": "Geen kostprijsversies gevonden voor dit jaar.",
        }

    productie_by_year = production_storage.load_productie()
    productie_year = productie_by_year.get(str(year_value), {}) if isinstance(productie_by_year, dict) else {}
    vaste_by_year = fixed_costs_storage.load_grouped_by_year()
    vaste_rows = vaste_by_year.get(str(year_value), []) if isinstance(vaste_by_year, dict) else []
    vaste_rows = vaste_rows if isinstance(vaste_rows, list) else []

    # Determine whether ABC is configured at all for this year.
    has_any_abc = any(
        isinstance(r, dict)
        and (str(r.get("allocation_driver", "") or "").strip() or str(r.get("cost_pool", "") or "").strip())
        for r in vaste_rows
    )
    if not has_any_abc:
        return {
            "year": year_value,
            "dry_run": bool(dry_run),
            "created_versions": 0,
            "created_version_ids": [],
            "detail": "Geen ABC overhead rules gevonden (allocation_driver/cost_pool zijn leeg).",
        }

    basisproducten = postgres_storage.load_dataset("basisproducten", [])
    samengestelde = postgres_storage.load_dataset("samengestelde-producten", [])
    liters_by_product_id: dict[str, float] = {}
    if isinstance(basisproducten, list):
        for row in basisproducten:
            if not isinstance(row, dict):
                continue
            if int(row.get("jaar", 0) or 0) != year_value:
                continue
            pid = str(row.get("id", "") or "").strip()
            if not pid:
                continue
            liters_by_product_id[pid] = float(row.get("inhoud_per_eenheid_liter", 0) or 0)
    if isinstance(samengestelde, list):
        for row in samengestelde:
            if not isinstance(row, dict):
                continue
            if int(row.get("jaar", 0) or 0) != year_value:
                continue
            pid = str(row.get("id", "") or "").strip()
            if not pid:
                continue
            liters_by_product_id[pid] = float(row.get("totale_inhoud_liter", 0) or 0)

    now = datetime.now(UTC).isoformat()
    owner_value = str(owner or "").strip() or "admin"

    # Compute next version numbers per (bier_id, jaar).
    next_num_by_key: dict[tuple[str, int], int] = {}
    for row in year_records:
        bier_id = str(row.get("bier_id", "") or "").strip()
        key = (bier_id, year_value)
        try:
            num = int(row.get("versie_nummer", 0) or 0)
        except (TypeError, ValueError):
            num = 0
        next_num_by_key[key] = max(next_num_by_key.get(key, 0), num)

    def normalize_scope(value: Any) -> str:
        text = str(value or "").strip().lower()
        return text if text in {"all", "purchased", "own_production", "contract_brew"} else "all"

    def scope_applies(scope: str, calc_type: str) -> bool:
        s = normalize_scope(scope)
        if s == "all":
            return True
        if s == "purchased":
            return calc_type == "inkoop"
        if s == "own_production":
            return calc_type == "productie"
        if s == "contract_brew":
            return calc_type == "contract_brew"
        return True

    def driver_total(domain: str, driver: str, stand: str) -> float:
        dom = str(domain or "").strip().lower() or "sales"
        d = str(driver or "").strip().upper()
        stand_code = "actual" if str(stand or "").strip().lower() == "actual" else "normal"

        # Sales domain: use sales liters totals (filled in Productie & drivers).
        if dom == "sales":
            actual_sales = float(productie_year.get("sales_l", 0) or 0)
            normal_sales = float(productie_year.get("normal_sales_l", 0) or actual_sales)
            sales = actual_sales if stand_code == "actual" else normal_sales
            if d == "ALL_LITERS":
                return sales
            # Normalized handling drivers: keep SKU costing on €/L (baseline all-in),
            # but only include these rules when their driver totals are present.
            if d == "SHIPMENTS":
                actual_shipments = float(productie_year.get("shipments", 0) or 0)
                normal_shipments = float(productie_year.get("normal_shipments", 0) or actual_shipments)
                shipments = actual_shipments if stand_code == "actual" else normal_shipments
                return sales if shipments > 0 and sales > 0 else 0.0
            if d == "PICKS_OR_ORDER_LINES":
                actual_orderlines = float(productie_year.get("orderlines", 0) or 0)
                normal_orderlines = float(productie_year.get("normal_orderlines", 0) or actual_orderlines)
                orderlines = actual_orderlines if stand_code == "actual" else normal_orderlines
                return sales if orderlines > 0 and sales > 0 else 0.0

            # Other liter sub-types don't have a meaningful sales split yet.
            return 0.0

        # Production domain (default): use production totals.
        actual_purchased = float(productie_year.get("hoeveelheid_inkoop_l", 0) or 0)
        actual_own = float(productie_year.get("hoeveelheid_productie_l", 0) or 0)
        normal_purchased = float(productie_year.get("normal_inkoop_l", 0) or actual_purchased)
        normal_own = float(productie_year.get("normal_productie_l", 0) or actual_own)
        normal_contract = float(productie_year.get("normal_contract_brew_l", 0) or 0)
        purchased = actual_purchased if stand_code == "actual" else normal_purchased
        own = actual_own if stand_code == "actual" else normal_own
        contract = 0.0 if stand_code == "actual" else normal_contract
        if d == "ALL_LITERS":
            return purchased + own + contract
        if d == "PURCHASED_LITERS":
            return purchased
        if d == "OWN_PRODUCTION_LITERS":
            return own
        if d == "CONTRACT_BREW_LITERS":
            return contract
        if d == "PRODUCTION_LITERS":
            return own + contract
        return 0.0

    # Compute per-liter buckets per calc_type (inkoop/productie/contract_brew) because scope rules can vary.
    def compute_overhead_rates(calc_type: str) -> tuple[float, float, list[dict[str, Any]]]:
        manufacturing = 0.0
        business = 0.0
        breakdown_rules: list[dict[str, Any]] = []
        for r in vaste_rows:
            if not isinstance(r, dict):
                continue
            if not scope_applies(r.get("allocation_scope", "all"), calc_type):
                continue
            amount = float(r.get("bedrag_per_jaar", 0) or 0)
            if amount == 0:
                continue
            driver = str(r.get("allocation_driver", "") or "").strip().upper()
            stand_code = str(r.get("stand", r.get("basis", "normal")) or "normal")
            domain_code = str(r.get("domain", "sales") or "sales")
            denom = driver_total(domain_code, driver, stand_code)
            if denom <= 0:
                continue
            rate = amount / denom
            include_in_inventory = bool(r.get("include_in_inventory_cost", True))
            cost_pool = str(r.get("cost_pool", "") or "").strip() or str(r.get("omschrijving", "") or "").strip() or "Overhead"
            breakdown_rules.append(
                {
                    "cost_pool": cost_pool,
                    "allocation_driver": driver or "NONE",
                    "include_in_inventory_cost": include_in_inventory,
                    "rate_per_liter": rate,
                }
            )
            if include_in_inventory:
                manufacturing += rate
            else:
                business += rate
        return manufacturing, business, breakdown_rules

    created: list[dict[str, Any]] = []
    created_ids: list[str] = []
    issues: list[str] = []

    for source in year_records:
        if str(source.get("status", "") or "").strip().lower() != "definitief":
            continue
        calc_type = str(source.get("type", "") or "").strip().lower()
        if calc_type not in {"inkoop", "productie", "contract_brew", "bundle", "article"}:
            calc_type = "inkoop" if str((source.get("soort_berekening") or {}).get("type", "")).lower() == "inkoop" else "productie"

        # Only rebuild versions that actually have snapshot product rows.
        snapshot = source.get("resultaat_snapshot") if isinstance(source.get("resultaat_snapshot"), dict) else {}
        producten = snapshot.get("producten") if isinstance(snapshot.get("producten"), dict) else {}
        basis_rows = producten.get("basisproducten") if isinstance(producten.get("basisproducten"), list) else []
        sameng_rows = producten.get("samengestelde_producten") if isinstance(producten.get("samengestelde_producten"), list) else []
        if not basis_rows and not sameng_rows:
            continue

        manufacturing_per_liter, business_per_liter, rule_rates = compute_overhead_rates(calc_type if calc_type in {"inkoop", "productie", "contract_brew"} else "inkoop")
        total_per_liter = manufacturing_per_liter + business_per_liter

        def rebuild_product_row(row: dict[str, Any]) -> dict[str, Any]:
            product_id = str(row.get("product_id", "") or "").strip()
            liters = float(liters_by_product_id.get(product_id, 0.0) or 0.0)
            manufacturing_amount = manufacturing_per_liter * liters if liters > 0 else 0.0
            business_amount = business_per_liter * liters if liters > 0 else 0.0
            overhead_breakdown: list[dict[str, Any]] = []
            if liters > 0 and rule_rates:
                for rr in rule_rates:
                    rate = float(rr.get("rate_per_liter", 0.0) or 0.0)
                    if rate == 0:
                        continue
                    allocated = rate * liters
                    if allocated == 0:
                        continue
                    overhead_breakdown.append(
                        {
                            "cost_pool": str(rr.get("cost_pool", "") or ""),
                            "allocation_driver": str(rr.get("allocation_driver", "") or ""),
                            "amount": round(allocated, 2),
                        }
                    )
            primary = float(row.get("primaire_kosten", row.get("variabele_kosten", 0.0)) or 0.0)
            packaging = float(row.get("verpakkingskosten", 0.0) or 0.0)
            excise = float(row.get("accijns", 0.0) or 0.0)
            overhead_total = manufacturing_amount + business_amount
            total_cost = primary + packaging + overhead_total + excise
            next_row = dict(row)
            next_row["liters_per_product"] = liters
            next_row["manufacturing_overhead"] = round(manufacturing_amount, 2)
            next_row["business_overhead"] = round(business_amount, 2)
            next_row["vaste_kosten"] = round(overhead_total, 2)
            next_row["kostprijs"] = round(total_cost, 2)
            next_row["overhead_breakdown"] = overhead_breakdown
            return next_row

        next_basis = [rebuild_product_row(r) for r in basis_rows if isinstance(r, dict)]
        next_sameng = [rebuild_product_row(r) for r in sameng_rows if isinstance(r, dict)]

        # New version metadata.
        bier_id = str(source.get("bier_id", "") or "").strip()
        key = (bier_id, year_value)
        next_num = next_num_by_key.get(key, 0) + 1
        next_num_by_key[key] = next_num

        new_id = str(uuid4())
        created_ids.append(new_id)
        created_version = dict(source)
        created_version["id"] = new_id
        created_version["versie_nummer"] = next_num
        created_version["status"] = "definitief"
        created_version["created_at"] = now
        created_version["updated_at"] = now
        created_version["finalized_at"] = now
        created_version["hercalculatie_reden"] = "abc_overhead_rebuild"
        created_version["hercalculatie_notitie"] = f"Overhead herberekend (ABC-light) door {owner_value} op {now}"
        created_version["hercalculatie_timestamp"] = now

        next_snapshot = dict(snapshot)
        next_snapshot["methodology_version"] = "abc_v1"
        next_snapshot["manufacturing_overhead_per_liter"] = round(manufacturing_per_liter, 6)
        next_snapshot["business_overhead_per_liter"] = round(business_per_liter, 6)
        next_snapshot["productkost_per_liter"] = round(float(snapshot.get("variabele_kosten_per_liter", 0.0) or 0.0) + manufacturing_per_liter, 6)
        next_snapshot["kostendekkend_per_liter"] = round(float(snapshot.get("variabele_kosten_per_liter", 0.0) or 0.0) + total_per_liter, 6)
        # Keep legacy fields for now (integrale/directe_vaste) for compatibility.
        next_snapshot.setdefault("directe_vaste_kosten_per_liter", float(snapshot.get("directe_vaste_kosten_per_liter", 0.0) or 0.0))
        next_snapshot.setdefault("integrale_kostprijs_per_liter", float(snapshot.get("integrale_kostprijs_per_liter", 0.0) or 0.0))
        next_snapshot.setdefault("variabele_kosten_per_liter", float(snapshot.get("variabele_kosten_per_liter", 0.0) or 0.0))
        next_snapshot["producten"] = {
            "basisproducten": next_basis,
            "samengestelde_producten": next_sameng,
        }
        created_version["resultaat_snapshot"] = next_snapshot
        created.append(created_version)

    if not created:
        return {
            "year": year_value,
            "dry_run": bool(dry_run),
            "created_versions": 0,
            "created_version_ids": [],
            "detail": "Geen geschikte definitieve versies met product rows gevonden.",
            "issues": issues,
        }

    if dry_run:
        return {
            "year": year_value,
            "dry_run": True,
            "created_versions": len(created),
            "created_version_ids": created_ids,
            "detail": "Dry run; geen data opgeslagen.",
            "issues": issues,
        }

    # Persist: include old + new versions for this year to avoid delete-by-scope.
    kept = [row for row in records if int(row.get("jaar", 0) or 0) != year_value]
    next_year_records = [row for row in year_records] + created
    save_dataset([*kept, *next_year_records], overwrite=True)

    return {
        "year": year_value,
        "dry_run": False,
        "created_versions": len(created),
        "created_version_ids": created_ids,
        "detail": "Nieuwe versies aangemaakt; sku rows moeten (opnieuw) worden opgebouwd.",
        "issues": issues,
    }


def load_cost_row_index_for_versions(
    version_ids: list[str] | set[str] | tuple[str, ...],
) -> dict[tuple[str, str], float]:
    """Return {(version_id, sku_id): kostprijs} for the given versions.

    This is the canonical read-path for cost resolution in dashboards/margin calculations.
    It intentionally avoids reading the JSON payload snapshot (`resultaat_snapshot`) to prevent
    accidental fallback behaviour when legacy snapshots are incomplete.
    """
    ensure_schema()
    wanted = [str(v or "").strip() for v in (version_ids or []) if str(v or "").strip()]
    wanted = sorted(set(wanted))
    if not wanted:
        return {}

    placeholders = ", ".join(["%s"] * len(wanted))
    out: dict[tuple[str, str], float] = {}
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT version_id, sku_id, kostprijs
                FROM cost_version_sku_rows
                WHERE version_id IN ({placeholders})
                """,
                tuple(wanted),
            )
            for version_id, sku_id, kostprijs in cur.fetchall() or []:
                vid = str(version_id or "").strip()
                sid = str(sku_id or "").strip()
                if not vid or not sid:
                    continue
                try:
                    out[(vid, sid)] = float(kostprijs or 0)
                except (TypeError, ValueError):
                    out[(vid, sid)] = 0.0
    return out


def load_cost_row_components_index_for_versions(
    version_ids: list[str] | set[str] | tuple[str, ...],
) -> dict[tuple[str, str], dict[str, float]]:
    """Return {(version_id, sku_id): {kostprijs, indirecte_kosten, inkoop, verpakkingskosten, accijns}}.

    This is the canonical read-path when callers need more than the total kostprijs, e.g.
    to separate variable vs allocated fixed components for break-even analyses.
    """
    ensure_schema()
    wanted = [str(v or "").strip() for v in (version_ids or []) if str(v or "").strip()]
    wanted = sorted(set(wanted))
    if not wanted:
        return {}

    placeholders = ", ".join(["%s"] * len(wanted))
    out: dict[tuple[str, str], dict[str, float]] = {}
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT version_id, sku_id, kostprijs, indirecte_kosten, inkoop, verpakkingskosten, accijns
                FROM cost_version_sku_rows
                WHERE version_id IN ({placeholders})
                """,
                tuple(wanted),
            )
            for (
                version_id,
                sku_id,
                kostprijs,
                indirecte_kosten,
                inkoop,
                verpakkingskosten,
                accijns,
            ) in cur.fetchall() or []:
                vid = str(version_id or "").strip()
                sid = str(sku_id or "").strip()
                if not vid or not sid:
                    continue
                out[(vid, sid)] = {
                    "kostprijs": float(kostprijs or 0),
                    "indirecte_kosten": float(indirecte_kosten or 0),
                    "inkoop": float(inkoop or 0),
                    "verpakkingskosten": float(verpakkingskosten or 0),
                    "accijns": float(accijns or 0),
                }
    return out
