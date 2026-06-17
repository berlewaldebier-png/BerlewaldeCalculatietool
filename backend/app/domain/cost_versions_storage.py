from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Iterable
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
            # Delete child rows first to satisfy FK constraints. Use DELETE instead of TRUNCATE:
            # cost_versions is referenced by activation tables, and PostgreSQL refuses
            # TRUNCATE on a referenced parent even when the referencing table is empty.
            cur.execute("DELETE FROM cost_version_lots")
            cur.execute("DELETE FROM cost_version_sku_rows")
            cur.execute("DELETE FROM cost_versions")
        if not postgres_storage.in_transaction():
            conn.commit()


def audit_planning_state(*, year: int = 0) -> dict[str, Any]:
    """Inspect planning costprice state without changing data.

    This deliberately focuses on yearly planning tables. LOT actual-cost tables are excluded.
    """
    ensure_schema()
    year_value = int(year or 0)
    where_versions = "WHERE jaar = %s" if year_value > 0 else ""
    where_activations = "WHERE jaar = %s" if year_value > 0 else ""
    params = (year_value,) if year_value > 0 else ()
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*)::int FROM cost_versions {where_versions}", params)
            versions = int((cur.fetchone() or [0])[0] or 0)
            cur.execute(
                f"""
                SELECT COUNT(*)::int
                FROM cost_version_sku_rows r
                JOIN cost_versions v ON v.id = r.version_id
                {where_versions.replace('jaar', 'v.jaar')}
                """,
                params,
            )
            sku_rows = int((cur.fetchone() or [0])[0] or 0)
            cur.execute(f"SELECT COUNT(*)::int FROM kostprijs_sku_activations {where_activations}", params)
            activations = int((cur.fetchone() or [0])[0] or 0)
            cur.execute(f"SELECT COUNT(*)::int FROM kostprijs_sku_activation_events {where_activations}", params)
            activation_events = int((cur.fetchone() or [0])[0] or 0)
            cur.execute(
                f"""
                SELECT sku_id, jaar, COUNT(*)::int
                FROM kostprijs_sku_activations
                {where_activations}
                GROUP BY sku_id, jaar
                HAVING COUNT(*) > 1
                ORDER BY jaar, sku_id
                LIMIT 100
                """,
                params,
            )
            duplicate_activations = [
                {"sku_id": str(row[0] or ""), "jaar": int(row[1] or 0), "count": int(row[2] or 0)}
                for row in cur.fetchall() or []
            ]
            cur.execute(
                f"""
                SELECT COALESCE(NULLIF(payload->'basisgegevens'->>'biernaam', ''), bier_id, '') AS label,
                       jaar,
                       status,
                       COUNT(*)::int
                FROM cost_versions
                {where_versions}
                GROUP BY label, jaar, status
                HAVING COUNT(*) > 1
                ORDER BY COUNT(*) DESC, jaar, label
                LIMIT 100
                """,
                params,
            )
            duplicate_versions = [
                {"label": str(row[0] or ""), "jaar": int(row[1] or 0), "status": str(row[2] or ""), "count": int(row[3] or 0)}
                for row in cur.fetchall() or []
            ]
    return {
        "year": year_value,
        "scope": "all_years" if year_value <= 0 else str(year_value),
        "counts": {
            "cost_versions": versions,
            "cost_version_sku_rows": sku_rows,
            "kostprijs_sku_activations": activations,
            "kostprijs_sku_activation_events": activation_events,
        },
        "duplicate_activations": duplicate_activations,
        "duplicate_versions": duplicate_versions,
        "actual_lot_tables_in_scope": False,
    }


def reset_planning_state(*, year: int = 0, dry_run: bool = True) -> dict[str, Any]:
    """Clear non-production planning costprice data.

    This deletes planning cost versions and activations only. It does not delete Douano sync data,
    LOT allocations, opening LOT prices, fixed costs, tariffs, SKUs, products, or mappings.
    """
    ensure_schema()
    before = audit_planning_state(year=year)
    if dry_run:
        return {"dry_run": True, "before": before, "deleted": {}}

    year_value = int(year or 0)
    deleted: dict[str, int] = {}
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if year_value > 0:
                cur.execute("DELETE FROM kostprijs_sku_activation_events WHERE jaar = %s", (year_value,))
                deleted["kostprijs_sku_activation_events"] = int(cur.rowcount or 0)
                cur.execute("DELETE FROM kostprijs_sku_activations WHERE jaar = %s", (year_value,))
                deleted["kostprijs_sku_activations"] = int(cur.rowcount or 0)
                cur.execute("DELETE FROM cost_versions WHERE jaar = %s", (year_value,))
                deleted["cost_versions"] = int(cur.rowcount or 0)
            else:
                cur.execute("DELETE FROM kostprijs_sku_activation_events")
                deleted["kostprijs_sku_activation_events"] = int(cur.rowcount or 0)
                cur.execute("DELETE FROM kostprijs_sku_activations")
                deleted["kostprijs_sku_activations"] = int(cur.rowcount or 0)
                cur.execute("DELETE FROM cost_versions")
                deleted["cost_versions"] = int(cur.rowcount or 0)
        if not postgres_storage.in_transaction():
            conn.commit()
    after = audit_planning_state(year=year)
    return {"dry_run": False, "before": before, "deleted": deleted, "after": after}


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
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS cost_version_lots (
                        id TEXT PRIMARY KEY,
                        version_id TEXT NOT NULL REFERENCES cost_versions(id) ON DELETE CASCADE,
                        lot_number TEXT NOT NULL,
                        source_type TEXT NOT NULL DEFAULT 'cost_version',
                        source_ref TEXT NOT NULL DEFAULT '',
                        source_date DATE,
                        supplier TEXT NOT NULL DEFAULT '',
                        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
                    "CREATE INDEX IF NOT EXISTS ix_cost_version_lots_version ON cost_version_lots(version_id)"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_cost_version_lots_lot ON cost_version_lots(lot_number)"
                )
                cur.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS ux_cost_version_lots_version_lot
                    ON cost_version_lots(version_id, LOWER(lot_number));
                    """
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


def _num(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _clean_repeated_name(label: Any) -> str:
    text = str(label or "").strip()
    if not text:
        return ""
    parts = [part.strip() for part in text.split(" - ") if part.strip()]
    if len(parts) >= 3 and parts[0].lower() == parts[1].lower():
        return " - ".join([parts[0], *parts[2:]])
    return text


def _strip_beer_prefix(label: Any, beer_name: Any) -> str:
    text = _clean_repeated_name(label)
    beer = str(beer_name or "").strip()
    if not text or not beer:
        return text
    pattern = re.compile(rf"^{re.escape(beer)}\s*[-–—:]?\s*", re.IGNORECASE)
    stripped = pattern.sub("", text).strip()
    return stripped or text


_LOT_KEYS = {"lotnummer", "lotnumber", "lot", "batchnummer", "batchnumber", "batch"}


def _lot_key_name(value: Any) -> str:
    return "".join(ch for ch in str(value or "").strip().lower() if ch.isalnum())


def _lot_exact_key(value: Any) -> str:
    return "".join(ch for ch in str(value or "").strip().upper() if ch.isalnum())


def _version_lot_records(version: dict[str, Any]) -> list[dict[str, Any]]:
    """Project LOT numbers from a cost version payload into canonical lot rows.

    This preserves existing costprice/invoice payloads while giving read paths a
    normalized table. Douano LOT remains the source of truth; these rows are our
    internal declared LOTs for cost versions.
    """
    version_id = str(version.get("id", "") or "").strip()
    if not version_id:
        return []
    source_type = str(version.get("type", "") or "").strip() or "cost_version"
    source_ref = str(version.get("factuurnummer", "") or version.get("invoice_number", "") or version_id).strip()
    supplier = str(version.get("leverancier", "") or version.get("supplier", "") or "").strip()
    source_date = str(version.get("factuurdatum", "") or version.get("datum", "") or version.get("finalized_at", "") or "").strip()[:10]
    seen: set[str] = set()
    rows: list[dict[str, Any]] = []

    def collect(value: Any, path: str = "") -> None:
        nonlocal source_ref, supplier, source_date
        if isinstance(value, dict):
            local_source_ref = str(
                value.get("factuurnummer", "")
                or value.get("invoice_number", "")
                or value.get("source_ref", "")
                or source_ref
            ).strip()
            local_supplier = str(value.get("leverancier", "") or value.get("supplier", "") or supplier).strip()
            local_source_date = str(
                value.get("factuurdatum", "")
                or value.get("datum", "")
                or value.get("source_date", "")
                or source_date
            ).strip()[:10]
            for key, child in value.items():
                key_text = _lot_key_name(key)
                if key_text in _LOT_KEYS:
                    lot = str(child or "").strip()
                    lot_key = _lot_exact_key(lot)
                    if lot and lot_key and lot_key not in seen:
                        seen.add(lot_key)
                        rows.append(
                            {
                                "id": str(uuid5(NAMESPACE_URL, f"cost_version_lot:{version_id}:{lot_key}")),
                                "version_id": version_id,
                                "lot_number": lot,
                                "source_type": source_type,
                                "source_ref": local_source_ref,
                                "source_date": local_source_date,
                                "supplier": local_supplier,
                                "payload": {"path": f"{path}.{key}" if path else str(key)},
                            }
                        )
                    continue
                collect(child, f"{path}.{key}" if path else str(key))
            return
        if isinstance(value, list):
            for index, child in enumerate(value):
                collect(child, f"{path}[{index}]")

    collect(version)
    return rows


def _upsert_lot_rows(
    cur: Any,
    versions: list[dict[str, Any]],
    *,
    overwrite: bool,
    now: datetime,
) -> None:
    lot_params: list[tuple[Any, ...]] = []
    row_ids_by_version: dict[str, set[str]] = {}
    for version in versions:
        version_id = str(version.get("id", "") or "").strip()
        if not version_id:
            continue
        for row in _version_lot_records(version):
            row_ids_by_version.setdefault(version_id, set()).add(str(row["id"]))
            lot_params.append(
                (
                    row["id"],
                    row["version_id"],
                    row["lot_number"],
                    row["source_type"],
                    row["source_ref"],
                    row["source_date"],
                    row["supplier"],
                    json.dumps(row.get("payload") if isinstance(row.get("payload"), dict) else {}),
                    now,
                )
            )

    if overwrite:
        for version in versions:
            version_id = str(version.get("id", "") or "").strip()
            if not version_id:
                continue
            ids = sorted(row_ids_by_version.get(version_id, set()))
            if not ids:
                cur.execute("DELETE FROM cost_version_lots WHERE version_id = %s", (version_id,))
                continue
            placeholders = ", ".join(["%s"] * len(ids))
            cur.execute(
                f"DELETE FROM cost_version_lots WHERE version_id = %s AND id NOT IN ({placeholders})",
                (version_id, *ids),
            )

    if lot_params:
        cur.executemany(
            """
            INSERT INTO cost_version_lots (
                id, version_id, lot_number, source_type, source_ref, source_date, supplier, payload, updated_at_ts
            )
            VALUES (%s, %s, %s, %s, %s, NULLIF(%s, '')::date, %s, %s::jsonb, %s)
            ON CONFLICT (id) DO UPDATE SET
                version_id = EXCLUDED.version_id,
                lot_number = EXCLUDED.lot_number,
                source_type = EXCLUDED.source_type,
                source_ref = EXCLUDED.source_ref,
                source_date = EXCLUDED.source_date,
                supplier = EXCLUDED.supplier,
                payload = EXCLUDED.payload,
                updated_at_ts = EXCLUDED.updated_at_ts
            """,
            lot_params,
        )


def _packaging_price_index(year: int) -> dict[str, float]:
    rows = postgres_storage.load_dataset("packaging-component-prices", [])
    index: dict[str, float] = {}
    if not isinstance(rows, list):
        return index
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_year = int(_num(row.get("jaar", row.get("year", 0)), 0))
        if row_year and year and row_year != year:
            continue
        component_id = str(
            row.get("verpakkingsonderdeel_id")
            or row.get("component_article_id")
            or row.get("component_id")
            or row.get("article_id")
            or row.get("id")
            or ""
        ).strip()
        if not component_id:
            continue
        index[component_id] = _num(row.get("prijs_per_stuk", row.get("price_per_unit", row.get("kostprijs", 0))), 0)
    return index


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
                _upsert_lot_rows(cur, records, overwrite=overwrite, now=now)
                row_params: list[tuple[Any, ...]] = []
                row_ids_by_version: dict[str, set[str]] = {}
                sku_by_beer_format: dict[tuple[str, str], str] = {}
                sku_meta_by_id: dict[str, dict[str, str]] = {}
                article_by_id: dict[str, dict[str, Any]] = {}
                bom_by_parent_article: dict[str, list[dict[str, Any]]] = {}
                sku_by_version_activation: dict[str, str] = {}
                try:
                    cur.execute("SELECT id, beer_id, format_article_id, article_id, kind, name FROM skus")
                    for sid, beer_id, format_article_id, article_id, kind, name in cur.fetchall() or []:
                        sid_text = str(sid or "")
                        beer_text = str(beer_id or "")
                        fmt_text = str(format_article_id or "")
                        article_text = str(article_id or "")
                        if sid_text and beer_text and fmt_text:
                            sku_by_beer_format[(beer_text, fmt_text)] = sid_text
                        if sid_text:
                            sku_meta_by_id[sid_text] = {
                                "id": sid_text,
                                "beer_id": beer_text,
                                "format_article_id": fmt_text,
                                "article_id": article_text,
                                "kind": str(kind or ""),
                                "name": str(name or ""),
                            }
                except Exception:
                    sku_by_beer_format = {}
                    sku_meta_by_id = {}
                try:
                    articles_rows = postgres_storage.load_dataset("articles", [])
                    if isinstance(articles_rows, list):
                        article_by_id = {
                            str(row.get("id", "") or "").strip(): row
                            for row in articles_rows
                            if isinstance(row, dict) and str(row.get("id", "") or "").strip()
                        }
                    bom_rows = postgres_storage.load_dataset("bom-lines", [])
                    if isinstance(bom_rows, list):
                        for line in bom_rows:
                            if not isinstance(line, dict):
                                continue
                            parent_id = str(line.get("parent_article_id", "") or "").strip()
                            if parent_id:
                                bom_by_parent_article.setdefault(parent_id, []).append(line)
                except Exception:
                    article_by_id = {}
                    bom_by_parent_article = {}
                try:
                    activations = postgres_storage.load_dataset("kostprijsproductactiveringen", [])
                    if isinstance(activations, list):
                        for activation in activations:
                            if not isinstance(activation, dict):
                                continue
                            version_text = str(activation.get("kostprijsversie_id", "") or "").strip()
                            sku_text = str(activation.get("sku_id", "") or "").strip()
                            if version_text and sku_text and version_text not in sku_by_version_activation:
                                sku_by_version_activation[version_text] = sku_text
                except Exception:
                    sku_by_version_activation = {}
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
                    cost_components_by_sku_id: dict[str, dict[str, float]] = {}
                    year_value = int(_num(version.get("jaar", 0), 0))
                    basisgegevens = version.get("basisgegevens") if isinstance(version.get("basisgegevens"), dict) else {}
                    beer_name = str((basisgegevens or {}).get("biernaam", "") or "").strip()
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
                        sku_kind = str((sku_meta_by_id.get(sku_id, {}) or {}).get("kind", "") or "").strip().lower()
                        if sku_kind == "article" and str(version.get("type", "") or "").strip().lower() == "inkoop":
                            # Sellable beer variants are derived from their BOM below. Older snapshots may contain
                            # stale copied rows, e.g. a 12-pack with the cost of a single bottle.
                            continue
                        row_id = str(item.get("id", "") or "").strip() or str(
                            uuid5(NAMESPACE_URL, f"cost_version_sku_row:{version_id}:{sku_id}")
                        )
                        row_ids_by_version.setdefault(version_id, set()).add(row_id)
                        verpakking_label = _strip_beer_prefix(
                            item.get("verpakkingseenheid", item.get("verpakking_label", "")),
                            beer_name,
                        )
                        inkoop_value = float(item.get("inkoop", item.get("primaire_kosten", item.get("variabele_kosten", 0))) or 0)
                        verpakking_value = float(item.get("verpakkingskosten", 0) or 0)
                        indirect_value = float(item.get("indirecte_kosten", item.get("vaste_kosten", 0)) or 0)
                        accijns_value = float(item.get("accijns", 0) or 0)
                        kostprijs_value = float(item.get("kostprijs", 0) or 0)
                        row_params.append(
                            (
                                row_id,
                                version_id,
                                sku_id,
                                verpakking_label,
                                inkoop_value,
                                verpakking_value,
                                indirect_value,
                                accijns_value,
                                kostprijs_value,
                                int(sort_index),
                            )
                        )
                        cost_components_by_sku_id[sku_id] = {
                            "inkoop": inkoop_value,
                            "verpakkingskosten": verpakking_value,
                            "indirecte_kosten": indirect_value,
                            "accijns": accijns_value,
                            "kostprijs": kostprijs_value,
                        }
                        sort_index += 1

                    # Include sellable variants created in step 5. These are article SKUs whose BOM
                    # points to the costed base SKUs from step 4 plus optional packaging components.
                    packaging_prices = _packaging_price_index(year_value)
                    for sku_id, sku_meta in sorted(sku_meta_by_id.items()):
                        if str(sku_meta.get("kind", "")).strip().lower() != "article":
                            continue
                        if str(sku_meta.get("beer_id", "")).strip() != bier_id:
                            continue
                        article_id = str(sku_meta.get("article_id", "") or "").strip()
                        if not article_id:
                            continue
                        lines = bom_by_parent_article.get(article_id, [])
                        if not lines:
                            continue
                        if sku_id in cost_components_by_sku_id:
                            continue
                        inkoop_value = 0.0
                        verpakking_value = 0.0
                        indirect_value = 0.0
                        accijns_value = 0.0
                        has_costed_component = False
                        for line in lines:
                            component_sku_id = str(line.get("component_sku_id", "") or "").strip()
                            component_article_id = str(line.get("component_article_id", "") or "").strip()
                            quantity = _num(line.get("quantity", line.get("qty", 0)), 0)
                            if quantity <= 0:
                                continue
                            if component_sku_id:
                                component_cost = cost_components_by_sku_id.get(component_sku_id)
                                if not component_cost:
                                    continue
                                has_costed_component = True
                                inkoop_value += component_cost["inkoop"] * quantity
                                verpakking_value += component_cost["verpakkingskosten"] * quantity
                                indirect_value += component_cost["indirecte_kosten"] * quantity
                                accijns_value += component_cost["accijns"] * quantity
                                continue
                            if component_article_id:
                                verpakking_value += packaging_prices.get(component_article_id, 0.0) * quantity
                        if not has_costed_component:
                            continue
                        kostprijs_value = inkoop_value + verpakking_value + indirect_value + accijns_value
                        row_id = str(uuid5(NAMESPACE_URL, f"cost_version_sku_row:{version_id}:{sku_id}"))
                        row_ids_by_version.setdefault(version_id, set()).add(row_id)
                        article_name = str((article_by_id.get(article_id, {}) or {}).get("name", "") or sku_meta.get("name", "") or "")
                        row_params.append(
                            (
                                row_id,
                                version_id,
                                sku_id,
                                _strip_beer_prefix(article_name, beer_name),
                                inkoop_value,
                                verpakking_value,
                                indirect_value,
                                accijns_value,
                                kostprijs_value,
                                int(sort_index),
                            )
                        )
                        cost_components_by_sku_id[sku_id] = {
                            "inkoop": inkoop_value,
                            "verpakkingskosten": verpakking_value,
                            "indirecte_kosten": indirect_value,
                            "accijns": accijns_value,
                            "kostprijs": kostprijs_value,
                        }
                        sort_index += 1

                    # Deterministic fallback for non-beer SKUs: if a definitive version has no snapshot items,
                    # we still want a single normalized row for the version's own SKU (used by offerte selectors).
                    if sort_index == 0:
                        basisgegevens = version.get("basisgegevens") if isinstance(version.get("basisgegevens"), dict) else {}
                        version_sku_id = str((basisgegevens or {}).get("sku_id", "") or "").strip()
                        if not version_sku_id:
                            version_sku_id = sku_by_version_activation.get(version_id, "")
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
                cur.execute("DELETE FROM cost_version_lots")
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


def rebuild_overhead_versions_for_year(
    *,
    year: int,
    owner: str,
    dry_run: bool = True,
    source_version_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
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
    source_id_set = {str(value or "").strip() for value in (source_version_ids or []) if str(value or "").strip()}
    all_year_records = [row for row in records if int(row.get("jaar", 0) or 0) == year_value]
    year_records = list(all_year_records)
    if source_id_set:
        year_records = [row for row in year_records if str(row.get("id", "") or "").strip() in source_id_set]
    if not year_records:
        return {
            "year": year_value,
            "dry_run": bool(dry_run),
            "created_versions": 0,
            "created_version_ids": [],
            "detail": "Geen kostprijsversies gevonden voor dit jaar en deze selectie.",
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

    sku_format_by_id: dict[str, str] = {}
    skus = postgres_storage.load_dataset("skus", [])
    if isinstance(skus, list):
        for row in skus:
            if not isinstance(row, dict):
                continue
            sku_id = str(row.get("id", "") or "").strip()
            format_id = str(row.get("format_article_id", "") or "").strip()
            if sku_id and format_id:
                sku_format_by_id[sku_id] = format_id

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

    def infer_liters_from_text(*values: str) -> float:
        text = " ".join(str(value or "").strip().lower() for value in values if str(value or "").strip())
        if not text:
            return 0.0
        count = 1.0
        count_match = re.search(r"(?:doos|box)[^\d]*(\d+)", text)
        if not count_match:
            count_match = re.search(r"\b(\d+)\s*[x×]\s*\d", text)
        if count_match:
            try:
                count = float(count_match.group(1))
            except (TypeError, ValueError):
                count = 1.0

        cl_match = re.search(r"(\d+(?:[.,]\d+)?)\s*cl\b", text)
        if cl_match:
            return count * float(cl_match.group(1).replace(",", ".")) / 100.0

        liter_match = re.search(r"(\d+(?:[.,]\d+)?)\s*l\b", text)
        if liter_match:
            return count * float(liter_match.group(1).replace(",", "."))

        return 0.0

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
            sku_id = str(row.get("sku_id", "") or "").strip()
            product_id = (
                str(row.get("product_id", "") or "").strip()
                or str(row.get("format_article_id", "") or "").strip()
                or sku_format_by_id.get(sku_id, "")
            )
            liters = float(liters_by_product_id.get(product_id, 0.0) or 0.0)
            if liters <= 0:
                liters = infer_liters_from_text(
                    product_id,
                    str(row.get("verpakking", "") or ""),
                    str(row.get("verpakkingseenheid", "") or ""),
                    str(row.get("verpakking_label", "") or ""),
                )
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
            primary = float(row.get("inkoop", row.get("primaire_kosten", row.get("variabele_kosten", 0.0))) or 0.0)
            packaging = float(row.get("verpakkingskosten", 0.0) or 0.0)
            excise = float(row.get("accijns", 0.0) or 0.0)
            overhead_total = manufacturing_amount + business_amount
            total_cost = primary + packaging + overhead_total + excise
            next_row = dict(row)
            next_row["product_id"] = product_id
            next_row["inkoop"] = round(primary, 2)
            next_row["primaire_kosten"] = round(primary, 2)
            next_row["liters_per_product"] = liters
            next_row["manufacturing_overhead"] = round(manufacturing_amount, 2)
            next_row["business_overhead"] = round(business_amount, 2)
            next_row["vaste_kosten"] = round(overhead_total, 2)
            next_row["indirecte_kosten"] = round(overhead_total, 2)
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
    if source_id_set:
        kept.extend(
            row
            for row in all_year_records
            if str(row.get("id", "") or "").strip() not in source_id_set
        )
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


def rebuild_lot_rows_from_payloads(*, year: int = 0, only_if_empty: bool = False) -> dict[str, int]:
    """Rebuild canonical `cost_version_lots` rows from existing cost version payloads.

    This is the migration bridge for data created before LOT rows were normalized.
    It does not delete cost versions, invoices or their payloads.
    """
    ensure_schema()
    year_value = int(year or 0)
    now = datetime.now(UTC)
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            if only_if_empty:
                where_count = "WHERE v.jaar = %s" if year_value > 0 else ""
                params_count: tuple[Any, ...] = (year_value,) if year_value > 0 else ()
                cur.execute(
                    f"""
                    SELECT COUNT(*)::int
                    FROM cost_version_lots l
                    JOIN cost_versions v ON v.id = l.version_id
                    {where_count}
                    """,
                    params_count,
                )
                existing = int((cur.fetchone() or [0])[0] or 0)
                if existing > 0:
                    return {"versions": 0, "lots": existing, "rebuilt": 0}

            where = "WHERE jaar = %s" if year_value > 0 else ""
            params: tuple[Any, ...] = (year_value,) if year_value > 0 else ()
            cur.execute(
                f"""
                SELECT id, jaar, status, bier_id, versie_nummer, payload
                FROM cost_versions
                {where}
                """,
                params,
            )
            versions: list[dict[str, Any]] = []
            for version_id, jaar, status, bier_id, versie_nummer, payload in cur.fetchall() or []:
                row = payload if isinstance(payload, dict) else {}
                if not isinstance(row, dict):
                    row = {}
                row = dict(row)
                row["id"] = str(version_id or row.get("id", "") or "")
                row["jaar"] = int(jaar or row.get("jaar", 0) or 0)
                row["status"] = str(status or row.get("status", "") or "")
                row["bier_id"] = str(bier_id or row.get("bier_id", "") or "")
                row["versie_nummer"] = int(versie_nummer or row.get("versie_nummer", 0) or 0)
                versions.append(row)

            _upsert_lot_rows(cur, versions, overwrite=True, now=now)
        if not postgres_storage.in_transaction():
            conn.commit()

    return {"versions": len(versions), "lots": sum(len(_version_lot_records(row)) for row in versions), "rebuilt": 1}


def load_internal_lot_summary(*, year: int = 0, limit: int = 5000) -> list[dict[str, Any]]:
    """Return internal LOTs grouped by beer style directly from cost versions.

    Cost version payloads are the source for internal LOT declarations. The
    normalized `cost_version_lots` table is useful as an index, but this read
    path deliberately avoids depending on that index being backfilled.
    """
    ensure_schema()
    lim = max(1, min(int(limit or 5000), 50000))
    year_value = int(year or 0)
    where = "WHERE LOWER(status) = 'definitief'"
    params: list[Any] = []
    if year_value > 0:
        where += " AND jaar = %s"
        params.append(year_value)
    params.append(lim)

    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, jaar, status, bier_id, versie_nummer, payload
                FROM cost_versions
                {where}
                ORDER BY jaar DESC, bier_id, versie_nummer, id
                LIMIT %s
                """,
                tuple(params),
            )
            rows = cur.fetchall() or []

    groups: dict[str, dict[str, Any]] = {}
    for version_id, version_year, status, beer_id, version_number, payload in rows:
        version = payload if isinstance(payload, dict) else {}
        if not isinstance(version, dict):
            continue
        version = dict(version)
        version["id"] = str(version_id or version.get("id", "") or "")
        version["jaar"] = int(version_year or version.get("jaar", 0) or 0)
        version["status"] = str(status or version.get("status", "") or "")
        version["bier_id"] = str(beer_id or version.get("bier_id", "") or "")
        version["versie_nummer"] = int(version_number or version.get("versie_nummer", 0) or 0)
        lot_rows = _version_lot_records(version)
        if not lot_rows:
            continue

        basis = version.get("basisgegevens") if isinstance(version.get("basisgegevens"), dict) else {}
        style_id = str(version.get("bier_id", "") or basis.get("bier_id", "") or "").strip()
        style_name = str(
            basis.get("biernaam", "")
            or basis.get("naam", "")
            or version.get("biernaam", "")
            or version.get("naam", "")
            or style_id
            or "Onbekende stijl"
        ).strip()
        group_key = style_id or style_name.lower()
        group = groups.setdefault(
            group_key,
            {
                "style_id": style_id,
                "style_name": style_name,
                "lots": {},
            },
        )
        version_num = int(version.get("versie_nummer", 0) or 0)
        version_label = f"v{version_num}" if version_num > 0 else "kostprijsversie"
        for lot_row in lot_rows:
            lot_number = str(lot_row.get("lot_number", "") or "").strip()
            lot_key = _lot_exact_key(lot_number)
            if not lot_number or not lot_key:
                continue
            lot_item = group["lots"].setdefault(
                lot_key,
                {
                    "lot_number": lot_number,
                    "versions": [],
                    "version_ids": [],
                    "years": [],
                    "sources": [],
                    "source_date": str(lot_row.get("source_date", "") or ""),
                },
            )
            if version_label not in lot_item["versions"]:
                lot_item["versions"].append(version_label)
            version_id_text = str(version.get("id", "") or "").strip()
            if version_id_text and version_id_text not in lot_item["version_ids"]:
                lot_item["version_ids"].append(version_id_text)
            year_num = int(version.get("jaar", 0) or 0)
            if year_num > 0 and year_num not in lot_item["years"]:
                lot_item["years"].append(year_num)
            source_label = str(lot_row.get("source_ref", "") or lot_row.get("source_type", "") or "").strip()
            if source_label and source_label not in lot_item["sources"]:
                lot_item["sources"].append(source_label)

    out: list[dict[str, Any]] = []
    for group in groups.values():
        lots = list(group["lots"].values())
        lots.sort(key=lambda item: str(item.get("lot_number", "") or "").upper())
        out.append(
            {
                "style_id": group["style_id"],
                "style_name": group["style_name"],
                "lot_count": len(lots),
                "lots": lots,
            }
        )
    out.sort(key=lambda item: str(item.get("style_name", "") or "").lower())
    return out


def load_lot_candidates_by_sku(*, year: int = 0, limit: int = 20000) -> dict[str, list[dict[str, Any]]]:
    """Return internal LOT candidates keyed by SKU id from canonical cost version LOT rows."""
    ensure_schema()
    rebuild_lot_rows_from_payloads(year=int(year or 0), only_if_empty=True)
    lim = max(1, min(int(limit or 20000), 50000))
    year_value = int(year or 0)
    where = "WHERE v.status = 'definitief'"
    params: list[Any] = []
    if year_value > 0:
        where += " AND v.jaar = %s"
        params.append(year_value)
    params.append(lim)

    out_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    with postgres_storage.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    r.sku_id,
                    l.lot_number,
                    l.source_type,
                    l.source_ref,
                    l.source_date,
                    v.id,
                    v.jaar,
                    v.versie_nummer
                FROM cost_version_lots l
                JOIN cost_versions v ON v.id = l.version_id
                JOIN cost_version_sku_rows r ON r.version_id = v.id
                {where}
                ORDER BY v.jaar DESC, v.versie_nummer DESC, l.lot_number, r.sku_id
                LIMIT %s
                """,
                tuple(params),
            )
            for sku_id, lot_number, source_type, source_ref, source_date, version_id, version_year, version_number in cur.fetchall() or []:
                sku_text = str(sku_id or "").strip()
                lot_text = str(lot_number or "").strip()
                if not sku_text or not lot_text:
                    continue
                key = (sku_text, _lot_exact_key(lot_text))
                item = out_by_key.setdefault(
                    key,
                    {
                        "lot_number": lot_text,
                        "source": str(source_type or "cost_version"),
                        "label": "",
                        "labels": [],
                        "version_ids": [],
                        "year": int(version_year or 0),
                        "source_ref": str(source_ref or ""),
                        "source_date": source_date.isoformat() if source_date else "",
                    },
                )
                label = f"v{int(version_number or 0)}" if int(version_number or 0) > 0 else "kostprijsversie"
                if label and label not in item["labels"]:
                    item["labels"].append(label)
                version_text = str(version_id or "").strip()
                if version_text and version_text not in item["version_ids"]:
                    item["version_ids"].append(version_text)

    out: dict[str, list[dict[str, Any]]] = {}
    for (sku_id, _), item in out_by_key.items():
        labels = item.get("labels") if isinstance(item.get("labels"), list) else []
        item["label"] = ", ".join(str(label) for label in labels if str(label).strip())
        out.setdefault(sku_id, []).append(item)
    return out
