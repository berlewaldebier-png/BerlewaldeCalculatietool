from __future__ import annotations

from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.rf013b_rehearse_authority import (  # noqa: E402
    ALLOWED_NEW_TABLES,
    compare_additive_rehearsal,
)


class Rf013bRehearsalSafetyTests(unittest.TestCase):
    def test_only_exact_authority_tables_may_be_added(self) -> None:
        before = {
            "tables": {"records": {"legacy": {"rows": 1, "fingerprint": "same"}}},
            "appDatasets": {"fingerprint": "datasets"},
            "perYear": {"2026": {"fingerprint": "year"}},
            "integrity": {"fingerprint": "integrity"},
        }
        after = {
            **before,
            "tables": {
                "records": {
                    **before["tables"]["records"],
                    **{
                        table: {"rows": 0, "fingerprint": f"new-{table}"}
                        for table in ALLOWED_NEW_TABLES
                    },
                }
            },
        }
        before_schema = {"legacy": "same-schema"}
        after_schema = {
            **before_schema,
            **{table: f"new-schema-{table}" for table in ALLOWED_NEW_TABLES},
        }

        self.assertEqual(
            compare_additive_rehearsal(
                before,
                after,
                before_schema=before_schema,
                after_schema=after_schema,
                allowed_new_tables=ALLOWED_NEW_TABLES,
            ),
            [],
        )
        after["tables"]["records"]["unexpected"] = {
            "rows": 0,
            "fingerprint": "unexpected",
        }
        self.assertIn(
            "unexpected_additive_tables",
            compare_additive_rehearsal(
                before,
                after,
                before_schema=before_schema,
                after_schema={**after_schema, "unexpected": "unexpected"},
                allowed_new_tables=ALLOWED_NEW_TABLES,
            ),
        )


if __name__ == "__main__":
    unittest.main()
