from __future__ import annotations

import os
from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.domain import (  # noqa: E402
    cost_authority_service,
    cost_authority_storage,
    kostprijs_activation_storage,
)
from tests.postgres_disposable import (  # noqa: E402
    DisposablePostgresDatabase,
    integration_tests_enabled,
)


def _snapshot() -> dict:
    return {
        "beers": [
            {"id": "beer-1", "naam": "Blond", "active": True},
        ],
        "articles": [
            {"id": "format-case", "kind": "format", "name": "Doos 24"},
            {"id": "gift-2", "kind": "bundle", "name": "Geschenkset"},
            {
                "id": "service-tour",
                "kind": "service",
                "name": "Rondleiding",
            },
        ],
        "skus": [
            {
                "id": "sku-case",
                "kind": "beer_format",
                "beer_id": "beer-1",
                "format_article_id": "format-case",
            },
            {
                "id": "sku-gift",
                "kind": "article",
                "article_id": "gift-2",
                "sellable_subtype": "beer_bundle",
            },
            {
                "id": "sku-service",
                "kind": "article",
                "article_id": "service-tour",
                "sellable_subtype": "dienst",
            },
        ],
        "cost_versions": [
            {
                "id": "version-first",
                "jaar": 2026,
                "bier_id": "beer-1",
                "type": "inkoop",
            },
            {
                "id": "version-later",
                "jaar": 2026,
                "bier_id": "beer-1",
                "type": "inkoop",
            },
            {
                "id": "version-gift",
                "jaar": 2026,
                "bier_id": "",
                "type": "bundle",
            },
            {
                "id": "version-service",
                "jaar": 2026,
                "bier_id": "",
                "type": "article",
            },
        ],
        "cost_rows": [
            {
                "id": "row-first",
                "version_id": "version-first",
                "sku_id": "sku-case",
                "kostprijs": 10,
            },
            {
                "id": "row-later",
                "version_id": "version-later",
                "sku_id": "sku-case",
                "kostprijs": 12,
            },
            {
                "id": "row-gift",
                "version_id": "version-gift",
                "sku_id": "sku-gift",
                "kostprijs": 20,
            },
            {
                "id": "row-service",
                "version_id": "version-service",
                "sku_id": "sku-service",
                "kostprijs": 30,
            },
        ],
        "activations": [
            {
                "id": "activation-current",
                "sku_id": "sku-case",
                "jaar": 2026,
                "kostprijsversie_id": "version-later",
                "effectief_vanaf": "2026-05-01T00:00:00Z",
            }
        ],
        "activation_events": [
            {
                "id": "event-first",
                "sku_id": "sku-case",
                "jaar": 2026,
                "kostprijsversie_id": "version-first",
                "effectief_vanaf": "2026-01-01T00:00:00Z",
                "action": "activate_version",
                "metadata": {},
            },
            {
                "id": "event-later",
                "sku_id": "sku-case",
                "jaar": 2026,
                "kostprijsversie_id": "version-later",
                "effectief_vanaf": "2026-05-01T00:00:00Z",
                "action": "activate_version",
                "metadata": {},
            },
        ],
        "cost_version_lots": [
            {
                "id": "lot-first",
                "version_id": "version-first",
                "lot_number": "LOT-JAN",
            },
            {
                "id": "lot-later",
                "version_id": "version-later",
                "lot_number": "LOT-MAY",
            },
        ],
        "direct_lot_cost_records": [],
    }


class CostAuthorityPlanTests(unittest.TestCase):
    def test_plan_keeps_first_activation_and_exact_lots_separate(self) -> None:
        first = cost_authority_service.build_authority_plan(_snapshot())
        second = cost_authority_service.build_authority_plan(_snapshot())

        self.assertEqual(first["manifest_hash"], second["manifest_hash"])
        anchor = next(
            row for row in first["planning_anchors"] if row["sku_id"] == "sku-case"
        )
        self.assertEqual(anchor["cost_version_id"], "version-first")
        self.assertEqual(anchor["cost_row_id"], "row-first")
        lineage = {
            row["lot_exact_key"]: row["cost_version_id"]
            for row in first["lot_lineage"]
        }
        self.assertEqual(
            lineage,
            {"LOTJAN": "version-first", "LOTMAY": "version-later"},
        )

    def test_article_service_and_bundle_use_explicit_subject_types(self) -> None:
        plan = cost_authority_service.build_authority_plan(_snapshot())
        sku_subjects = {
            row["sku_id"]: row["subject_type"] for row in plan["sku_subjects"]
        }
        version_subjects = {
            row["version_id"]: row["subject_type"]
            for row in plan["version_subjects"]
        }
        self.assertEqual(sku_subjects["sku-case"], "beer")
        self.assertEqual(sku_subjects["sku-gift"], "bundle")
        self.assertEqual(sku_subjects["sku-service"], "service")
        self.assertEqual(version_subjects["version-gift"], "bundle")
        self.assertEqual(version_subjects["version-service"], "service")

    def test_duplicate_name_reference_is_ambiguous_and_never_merged(self) -> None:
        snapshot = _snapshot()
        snapshot["beers"] = [
            {"id": "beer-a", "naam": "Dubbel"},
            {"id": "beer-b", "naam": "Dubbel"},
        ]
        snapshot["cost_versions"] = [
            {"id": "version-name", "jaar": 2026, "bier_id": "Dubbel"}
        ]
        snapshot["cost_rows"] = []
        snapshot["activations"] = []
        snapshot["activation_events"] = []
        snapshot["cost_version_lots"] = []

        plan = cost_authority_service.build_authority_plan(snapshot)
        subject = plan["version_subjects"][0]
        self.assertEqual(subject["resolution_status"], "ambiguous")
        self.assertEqual(subject["resolution_reason"], "duplicate_legacy_beer_name")
        self.assertEqual(len(plan["beers"]), 2)
        self.assertGreater(plan["blocker_counts"]["duplicate_legacy_beer_name"], 0)

    def test_missing_cost_row_blocks_anchor_instead_of_inventing_zero(self) -> None:
        snapshot = _snapshot()
        snapshot["cost_rows"] = [
            row for row in snapshot["cost_rows"] if row["id"] != "row-first"
        ]
        plan = cost_authority_service.build_authority_plan(snapshot)

        self.assertFalse(
            any(row["sku_id"] == "sku-case" for row in plan["planning_anchors"])
        )
        self.assertEqual(plan["blocker_counts"]["canonical_cost_row_missing"], 1)

    def test_same_exact_lot_on_two_versions_is_ambiguous(self) -> None:
        snapshot = _snapshot()
        snapshot["cost_version_lots"][1]["lot_number"] = "lot jan"
        plan = cost_authority_service.build_authority_plan(snapshot)

        self.assertEqual(plan["lot_lineage"], [])
        self.assertEqual(
            plan["blocker_counts"]["exact_lot_multiple_version_rows"],
            1,
        )

    def test_direct_lot_cost_without_version_row_lineage_stays_blocked(self) -> None:
        snapshot = _snapshot()
        snapshot["direct_lot_cost_records"] = [
            {
                "id": "direct-unlinked",
                "sku_id": "sku-case",
                "lot_number": "LOT-UNKNOWN",
                "source_type": "purchase_invoice",
            }
        ]
        plan = cost_authority_service.build_authority_plan(snapshot)

        mapping = next(
            row
            for row in plan["mappings"]
            if row["source_type"] == "direct_lot_cost_record"
        )
        self.assertEqual(mapping["resolution_status"], "unresolved")
        self.assertEqual(
            mapping["reason_code"],
            "direct_lot_record_requires_canonical_lineage",
        )


@unittest.skipUnless(
    integration_tests_enabled(),
    "requires an explicitly opted-in disposable PostgreSQL server",
)
class CostAuthorityPostgresTests(unittest.TestCase):
    def setUp(self) -> None:
        self.database = DisposablePostgresDatabase()
        self.database.__enter__()
        cost_authority_storage.ensure_schema()
        self._seed()

    def tearDown(self) -> None:
        self.database.__exit__(None, None, None)

    def _seed(self) -> None:
        snapshot = _snapshot()
        with postgres_storage_transaction() as conn:
            conn.execute(
                """
                INSERT INTO app_datasets(dataset_name, payload)
                VALUES ('bieren', %s::jsonb)
                """,
                (json_text(snapshot["beers"]),),
            )
            for article in snapshot["articles"]:
                conn.execute(
                    """
                    INSERT INTO articles(id, code, name, kind, payload)
                    VALUES (%s, %s, %s, %s, %s::jsonb)
                    """,
                    (
                        article["id"],
                        article["id"],
                        article["name"],
                        article["kind"],
                        json_text(article),
                    ),
                )
            for sku in snapshot["skus"]:
                conn.execute(
                    """
                    INSERT INTO skus(
                        id, kind, beer_id, format_article_id, article_id, payload
                    )
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                    """,
                    (
                        sku["id"],
                        sku["kind"],
                        sku.get("beer_id", ""),
                        sku.get("format_article_id", ""),
                        sku.get("article_id", ""),
                        json_text(sku),
                    ),
                )
            for version in snapshot["cost_versions"]:
                conn.execute(
                    """
                    INSERT INTO cost_versions(
                        id, jaar, status, bier_id, payload
                    )
                    VALUES (%s, %s, 'definitief', %s, %s::jsonb)
                    """,
                    (
                        version["id"],
                        version["jaar"],
                        version.get("bier_id", ""),
                        json_text(version),
                    ),
                )
            for row in snapshot["cost_rows"]:
                conn.execute(
                    """
                    INSERT INTO cost_version_sku_rows(
                        id, version_id, sku_id, kostprijs
                    )
                    VALUES (%s, %s, %s, %s)
                    """,
                    (
                        row["id"],
                        row["version_id"],
                        row["sku_id"],
                        row["kostprijs"],
                    ),
                )
            for lot in snapshot["cost_version_lots"]:
                conn.execute(
                    """
                    INSERT INTO cost_version_lots(id, version_id, lot_number)
                    VALUES (%s, %s, %s)
                    """,
                    (lot["id"], lot["version_id"], lot["lot_number"]),
                )
            for event in snapshot["activation_events"]:
                conn.execute(
                    """
                    INSERT INTO kostprijs_sku_activation_events(
                        id, sku_id, jaar, kostprijsversie_id,
                        effectief_vanaf, action, metadata
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, '{}'::jsonb)
                    """,
                    (
                        event["id"],
                        event["sku_id"],
                        event["jaar"],
                        event["kostprijsversie_id"],
                        event["effectief_vanaf"],
                        event["action"],
                    ),
                )
            activation = snapshot["activations"][0]
            conn.execute(
                """
                INSERT INTO kostprijs_sku_activations(
                    id, sku_id, jaar, kostprijsversie_id, effectief_vanaf
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    activation["id"],
                    activation["sku_id"],
                    activation["jaar"],
                    activation["kostprijsversie_id"],
                    activation["effectief_vanaf"],
                ),
            )

    def test_backfill_is_idempotent_and_does_not_change_legacy_tables(self) -> None:
        before = legacy_counts(self.database)
        dry_run = cost_authority_service.backfill_legacy_authority(
            actor="admin", dry_run=True
        )
        first = cost_authority_service.backfill_legacy_authority(
            actor="admin",
            dry_run=False,
            expected_manifest_hash=dry_run["manifest_hash"],
        )
        second = cost_authority_service.backfill_legacy_authority(
            actor="admin",
            dry_run=False,
            expected_manifest_hash=dry_run["manifest_hash"],
        )

        self.assertEqual(before, legacy_counts(self.database))
        self.assertGreater(first["applied"]["planning_cost_anchors"], 0)
        self.assertEqual(second["applied"]["planning_cost_anchors"], 0)
        anchor = cost_authority_storage.get_anchor(
            sku_id="sku-case", planning_year=2026
        )
        self.assertEqual(anchor["cost_version_id"], "version-first")  # type: ignore[index]

    def test_first_new_activation_anchors_but_later_activation_does_not_replace(self) -> None:
        with postgres_storage_transaction() as conn:
            conn.execute(
                """
                INSERT INTO cost_versions(id, jaar, status, bier_id, payload)
                VALUES ('version-new-first', 2027, 'definitief', 'beer-1', '{}'::jsonb),
                       ('version-new-later', 2027, 'definitief', 'beer-1', '{}'::jsonb)
                """
            )
            conn.execute(
                """
                INSERT INTO cost_version_sku_rows(id, version_id, sku_id, kostprijs)
                VALUES ('row-new-first', 'version-new-first', 'sku-case', 14),
                       ('row-new-later', 'version-new-later', 'sku-case', 15)
                """
            )
        kostprijs_activation_storage.activate_activations(
            [
                {
                    "sku_id": "sku-case",
                    "jaar": 2027,
                    "kostprijsversie_id": "version-new-first",
                }
            ],
            context=kostprijs_activation_storage.ActivationContext(
                actor="manager", action="activate_version"
            ),
        )
        first = cost_authority_storage.get_anchor(
            sku_id="sku-case", planning_year=2027
        )
        kostprijs_activation_storage.activate_activations(
            [
                {
                    "sku_id": "sku-case",
                    "jaar": 2027,
                    "kostprijsversie_id": "version-new-later",
                }
            ],
            context=kostprijs_activation_storage.ActivationContext(
                actor="manager", action="activate_version"
            ),
        )
        later = cost_authority_storage.get_anchor(
            sku_id="sku-case", planning_year=2027
        )

        self.assertEqual(first["cost_version_id"], "version-new-first")  # type: ignore[index]
        self.assertEqual(later["cost_version_id"], "version-new-first")  # type: ignore[index]

    def test_rebaseline_requires_brewer_management_and_admin_in_order(self) -> None:
        dry_run = cost_authority_service.backfill_legacy_authority(
            actor="admin", dry_run=True
        )
        cost_authority_service.backfill_legacy_authority(
            actor="admin",
            dry_run=False,
            expected_manifest_hash=dry_run["manifest_hash"],
        )
        request = cost_authority_storage.prepare_rebaseline(
            sku_id="sku-case",
            planning_year=2026,
            cost_version_id="version-later",
            reason="Goedgekeurde nieuwe planningsbasis",
            actor="brewer-user",
            actor_role="brewer",
        )
        with self.assertRaises(PermissionError):
            cost_authority_storage.approve_rebaseline(
                request["id"], actor="sales-user", actor_role="sales"
            )
        approved = cost_authority_storage.approve_rebaseline(
            request["id"], actor="management-user", actor_role="management"
        )
        self.assertEqual(approved["status"], "approved")
        executed = cost_authority_storage.execute_rebaseline(
            request["id"], actor="admin-user", actor_role="admin"
        )
        self.assertEqual(executed["status"], "executed")
        anchor = cost_authority_storage.get_anchor(
            sku_id="sku-case", planning_year=2026
        )
        self.assertEqual(anchor["cost_version_id"], "version-later")  # type: ignore[index]

    def test_ambiguous_legacy_beer_mapping_requires_reviewed_admin_choice(self) -> None:
        snapshot = _snapshot()
        duplicate_beers = [
            *snapshot["beers"],
            {"id": "beer-2", "naam": "Blond", "active": True},
        ]
        with postgres_storage_transaction() as conn:
            conn.execute(
                """
                UPDATE app_datasets
                SET payload = %s::jsonb
                WHERE dataset_name = 'bieren'
                """,
                (json_text(duplicate_beers),),
            )
            conn.execute(
                """
                INSERT INTO cost_versions(id, jaar, status, bier_id, payload)
                VALUES ('version-name-only', 2026, 'definitief', 'Blond', '{}'::jsonb)
                """
            )
        dry_run = cost_authority_service.backfill_legacy_authority(
            actor="admin", dry_run=True
        )
        cost_authority_service.backfill_legacy_authority(
            actor="admin",
            dry_run=False,
            expected_manifest_hash=dry_run["manifest_hash"],
        )
        with self.database.connect() as conn:
            mapping_id, source_hash = conn.execute(
                """
                SELECT id, source_hash
                FROM cost_authority_mapping_manifest
                WHERE source_type = 'cost_version'
                  AND source_id = 'version-name-only'
                """
            ).fetchone()
        with self.assertRaises(PermissionError):
            cost_authority_storage.approve_cost_version_beer_mapping(
                str(mapping_id),
                canonical_beer_id="beer-1",
                expected_source_hash=str(source_hash),
                review_reason="Reviewed against source dossier",
                actor="management-user",
                actor_role="management",
            )
        approved = cost_authority_storage.approve_cost_version_beer_mapping(
            str(mapping_id),
            canonical_beer_id="beer-1",
            expected_source_hash=str(source_hash),
            review_reason="Reviewed against source dossier",
            actor="admin-user",
            actor_role="admin",
        )
        self.assertEqual(approved["resolution_status"], "resolved")
        self.assertEqual(approved["target_id"], "beer-1")


def json_text(value: object) -> str:
    import json

    return json.dumps(value, ensure_ascii=False)


def postgres_storage_transaction():
    from app.domain import postgres_storage

    return postgres_storage.transaction()


def legacy_counts(database: DisposablePostgresDatabase) -> dict[str, int]:
    with database.connect() as conn:
        return {
            table: int(
                conn.execute(f"SELECT COUNT(*)::int FROM {table}").fetchone()[0]
            )
            for table in (
                "app_datasets",
                "articles",
                "skus",
                "cost_versions",
                "cost_version_sku_rows",
                "cost_version_lots",
                "kostprijs_sku_activations",
                "kostprijs_sku_activation_events",
            )
        }


if __name__ == "__main__":
    unittest.main()
