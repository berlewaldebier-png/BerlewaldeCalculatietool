from __future__ import annotations

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from app.domain import postgres_storage


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
        # Ensure master registry exists before we add FK constraints.
        from app.domain import product_registry_storage
        product_registry_storage.ensure_schema()
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
                        created_at TEXT NOT NULL DEFAULT '',
                        updated_at TEXT NOT NULL DEFAULT '',
                        finalized_at TEXT NOT NULL DEFAULT '',
                        payload JSONB NOT NULL,
                        updated_at_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS cost_version_product_rows (
                        id TEXT PRIMARY KEY,
                        version_id TEXT NOT NULL REFERENCES cost_versions(id) ON DELETE CASCADE,
                        kind TEXT NOT NULL,
                        bier_id TEXT NOT NULL DEFAULT '',
                        product_id TEXT NOT NULL DEFAULT '',
                        product_type TEXT NOT NULL DEFAULT '',
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
                # Enforce product_id integrity against the master registry for snapshot rows.
                # NOT VALID keeps existing legacy rows from blocking startup; new rows are checked.
                cur.execute(
                    """
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_constraint WHERE conname = 'fk_cost_version_rows_product'
                        ) THEN
                            ALTER TABLE cost_version_product_rows
                            ADD CONSTRAINT fk_cost_version_rows_product
                            FOREIGN KEY (product_id) REFERENCES products_master(id) ON DELETE RESTRICT
                            NOT VALID;
                        END IF;
                    END $$;
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_cost_version_product_rows_version ON cost_version_product_rows(version_id)"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS ix_cost_version_product_rows_product ON cost_version_product_rows(product_id)"
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

        # One-time best-effort migration from legacy `app_datasets` payload.
        try:
            with postgres_storage.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM cost_versions")
                    count_row = cur.fetchone()
                    existing = int((count_row[0] if count_row else 0) or 0)
            if existing == 0:
                legacy = postgres_storage.load_app_dataset_payload("kostprijsversies")
                if isinstance(legacy, list) and legacy:
                    save_dataset(legacy, overwrite=True)
                    postgres_storage.delete_app_dataset_row("kostprijsversies")
        except Exception:
            # Migration is best-effort; schema must still be usable for new writes.
            pass


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
            cur.execute("SELECT id, payload FROM cost_versions")
            version_rows = cur.fetchall()
            cur.execute(
                """
                SELECT id, version_id, kind, bier_id, product_id, product_type, verpakking_label,
                       inkoop, verpakkingskosten, indirecte_kosten, accijns, kostprijs, sort_index
                FROM cost_version_product_rows
                ORDER BY version_id, kind, sort_index, id
                """
            )
            product_rows = cur.fetchall()

    if not version_rows:
        return default_value

    basis_by_version: dict[str, list[dict[str, Any]]] = {}
    sameng_by_version: dict[str, list[dict[str, Any]]] = {}
    for (
        row_id,
        version_id,
        kind,
        bier_id,
        product_id,
        product_type,
        verpakking_label,
        inkoop,
        verpakkingskosten,
        indirecte_kosten,
        accijns,
        kostprijs,
        _sort_index,
    ) in product_rows:
        verpakking_text = str(verpakking_label or "")
        inkoop_value = float(inkoop or 0)
        indirect_value = float(indirecte_kosten or 0)
        payload: dict[str, Any] = {
            "id": str(row_id),
            "bier_id": str(bier_id or ""),
            "product_id": str(product_id or ""),
            "product_type": str(product_type or ""),
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
        if str(kind or "") == "samengesteld":
            sameng_by_version.setdefault(str(version_id), []).append(payload)
        else:
            basis_by_version.setdefault(str(version_id), []).append(payload)

    out: list[dict[str, Any]] = []
    for version_id, payload in version_rows:
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            continue
        merged = dict(payload)
        snapshot = merged.get("resultaat_snapshot")
        if not isinstance(snapshot, dict):
            snapshot = {}
        producten = snapshot.get("producten")
        if not isinstance(producten, dict):
            producten = {}
        producten = dict(producten)
        producten["basisproducten"] = basis_by_version.get(str(version_id), [])
        producten["samengestelde_producten"] = sameng_by_version.get(str(version_id), [])
        snapshot = dict(snapshot)
        snapshot["producten"] = producten
        merged["resultaat_snapshot"] = snapshot
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
                            json.dumps(_strip_snapshot_sections(row), ensure_ascii=False),
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
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
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
                    for item in basis if isinstance(basis, list) else []:
                        if not isinstance(item, dict):
                            continue
                        product_id = str(item.get("product_id", "") or "").strip()
                        row_id = str(item.get("id", "") or "").strip() or str(
                            uuid5(NAMESPACE_URL, f"cost_version_row:{version_id}:basis:{product_id}")
                        )
                        row_ids_by_version.setdefault(version_id, set()).add(row_id)
                        row_params.append(
                            (
                                row_id,
                                version_id,
                                "basis",
                                bier_id,
                                product_id,
                                str(item.get("product_type", "") or ""),
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

                    sort_index = 0
                    for item in sameng if isinstance(sameng, list) else []:
                        if not isinstance(item, dict):
                            continue
                        product_id = str(item.get("product_id", "") or "").strip()
                        row_id = str(item.get("id", "") or "").strip() or str(
                            uuid5(NAMESPACE_URL, f"cost_version_row:{version_id}:samengesteld:{product_id}")
                        )
                        row_ids_by_version.setdefault(version_id, set()).add(row_id)
                        row_params.append(
                            (
                                row_id,
                                version_id,
                                "samengesteld",
                                bier_id,
                                product_id,
                                str(item.get("product_type", "") or ""),
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

                # Replace-by-scope for snapshot rows: per version_id, delete rows that are no longer present.
                if overwrite:
                    for version in records:
                        version_id = str(version.get("id", "") or "").strip()
                        if not version_id:
                            continue
                        ids = sorted(row_ids_by_version.get(version_id, set()))
                        if not ids:
                            cur.execute("DELETE FROM cost_version_product_rows WHERE version_id = %s", (version_id,))
                            continue
                        placeholders = ", ".join(["%s"] * len(ids))
                        cur.execute(
                            f"DELETE FROM cost_version_product_rows WHERE version_id = %s AND id NOT IN ({placeholders})",
                            (version_id, *ids),
                        )

                if row_params:
                    cur.executemany(
                        """
                        INSERT INTO cost_version_product_rows (
                            id, version_id, kind, bier_id, product_id, product_type, verpakking_label,
                            inkoop, verpakkingskosten, indirecte_kosten, accijns, kostprijs, sort_index
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            version_id = EXCLUDED.version_id,
                            kind = EXCLUDED.kind,
                            bier_id = EXCLUDED.bier_id,
                            product_id = EXCLUDED.product_id,
                            product_type = EXCLUDED.product_type,
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
                FROM cost_version_product_rows r
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
