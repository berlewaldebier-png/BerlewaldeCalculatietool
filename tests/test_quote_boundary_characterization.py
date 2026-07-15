from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.api.routes import quotes  # noqa: E402
from app.contracts.quote_boundary import (  # noqa: E402
    adapt_quote_delete_response,
    quote_list_response,
)


FIXTURES = ROOT / "contracts" / "fixtures" / "quotes"


def _fixture(name: str) -> object:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class QuoteBoundaryCharacterizationTests(unittest.TestCase):
    def test_registry_references_executable_request_and_response_snapshots(self) -> None:
        registry = json.loads(
            (ROOT / "contracts" / "boundary-contracts.json").read_text(encoding="utf-8")
        )

        for contract_name, contract in registry["contracts"].items():
            with self.subTest(contract=contract_name):
                request_path = ROOT / contract["request_fixture"]
                self.assertTrue(request_path.is_file())
                request = json.loads(request_path.read_text(encoding="utf-8"))
                self.assertEqual(request["method"], contract["method"])
                self.assertTrue(str(request["path"]).startswith(str(contract["path"]).split("?")[0].split("{")[0]))
                for response_fixture in contract["response_fixtures"]:
                    response_path = ROOT / response_fixture
                    self.assertTrue(response_path.is_file())
                    self.assertIsInstance(
                        json.loads(response_path.read_text(encoding="utf-8")),
                        dict,
                    )

    def test_typed_list_adapter_preserves_item_identity_and_json(self) -> None:
        expected = _fixture("list-response.future-legacy.json")
        items = expected["items"]

        actual = quote_list_response(items)

        self.assertEqual(actual, {"items": items})
        self.assertIs(actual["items"], items)
        self.assertIs(actual["items"][0], items[0])

    def test_typed_delete_adapter_preserves_unknown_fields_and_reports_alias(self) -> None:
        payload = _fixture("delete-response.future-legacy.json")

        actual, deviations = adapt_quote_delete_response(payload)

        self.assertIs(actual, payload)
        self.assertEqual(actual["future_trace_id"], "trace-contract-001")
        self.assertEqual(len(deviations), 1)
        self.assertEqual(deviations[0]["kind"], "legacy_alias")

    def test_list_route_preserves_current_response_snapshot(self) -> None:
        expected = _fixture("list-response.current.json")
        items = expected["items"]

        with patch.object(quotes.quote_drafts_storage, "list_drafts", return_value=items) as list_drafts:
            actual = quotes.get_quotes(status="", limit=100)

        self.assertEqual(actual, expected)
        self.assertIs(actual["items"], items)
        list_drafts.assert_called_once_with(status=None, limit=100)

    def test_list_route_does_not_normalize_unknown_or_malformed_record_fields(self) -> None:
        fixture = _fixture("list-response.future-legacy.json")
        items = fixture["items"]

        with patch.object(quotes.quote_drafts_storage, "list_drafts", return_value=items):
            actual = quotes.get_quotes(status="concept", limit=100)

        self.assertEqual(actual, {"items": items})
        self.assertIs(actual["items"][0], items[0])
        self.assertEqual(actual["items"][0]["quote_number_seq"], "99")
        self.assertIsNone(actual["items"][0]["customer_name"])
        self.assertEqual(actual["items"][0]["future_record_field"], "keep")

    def test_delete_route_preserves_deleted_row_count_snapshots(self) -> None:
        for fixture_name in ("delete-response.deleted.json", "delete-response.not-found.json"):
            with self.subTest(fixture=fixture_name):
                expected = _fixture(fixture_name)
                with (
                    patch.object(quotes.quote_drafts_storage, "delete_draft", return_value=expected),
                    patch.object(quotes.dashboard_service, "invalidate_dashboard_summary_cache") as invalidate,
                ):
                    actual = quotes.delete_quote("quote-contract-001")

                self.assertIs(actual, expected)
                self.assertEqual(actual, expected)
                invalidate.assert_called_once_with()

    def test_selected_openapi_operations_match_snapshot(self) -> None:
        app = FastAPI()
        app.include_router(quotes.router)
        paths = app.openapi()["paths"]
        actual = {
            "delete": paths["/quotes/{quote_id}"]["delete"],
            "list": paths["/quotes"]["get"],
        }

        self.assertEqual(actual, _fixture("openapi.current.json"))


if __name__ == "__main__":
    unittest.main()
