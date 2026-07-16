from __future__ import annotations

import json
import unittest
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException, Request


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.api.routes import meta
from app.domain import auth_policy, auth_service
from app.domain.auth_dependencies import (
    require_cost_activation,
    require_cost_draft,
    require_dataset_mutation,
    require_douano_sync,
    require_product_mappings_manage,
    require_quotes_manage,
    require_users_manage,
    require_users_view,
)


AUTH_SECRET = "rf-005-role-policy-secret-at-least-32-bytes"


def _request_for_role(role: str) -> Request:
    token = auth_service.issue_session_token(
        username=f"{role}-fixture",
        display_name=f"{role} fixture",
        role=role,
    )
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": [(b"cookie", f"{auth_service.SESSION_COOKIE_NAME}={token}".encode())],
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 443),
        }
    )


class AuthRolePolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.environment = patch.dict(
            "os.environ",
            {
                "CALCULATIETOOL_ENV": "production",
                "CALCULATIETOOL_AUTH_ENABLED": "true",
                "CALCULATIETOOL_AUTH_SECRET": AUTH_SECRET,
            },
            clear=True,
        )
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()

    def test_exact_approved_role_capability_matrix(self) -> None:
        expected = {
            "admin": auth_policy.ALL_CAPABILITIES,
            "management": {
                auth_policy.CAP_USERS_VIEW,
                auth_policy.CAP_COSTS_VIEW,
                auth_policy.CAP_COSTS_DRAFT,
                auth_policy.CAP_COSTS_ACTIVATE,
                auth_policy.CAP_QUOTES_MANAGE,
                auth_policy.CAP_CALCULATION_SETTINGS_MANAGE,
            },
            "brewer": {auth_policy.CAP_COSTS_VIEW, auth_policy.CAP_COSTS_DRAFT},
            "sales": {auth_policy.CAP_COSTS_VIEW, auth_policy.CAP_QUOTES_MANAGE},
            "user": {auth_policy.CAP_COSTS_VIEW, auth_policy.CAP_QUOTES_MANAGE},
        }
        self.assertEqual(set(auth_policy.ROLE_CAPABILITIES), set(expected))
        for role, capabilities in expected.items():
            with self.subTest(role=role):
                self.assertEqual(set(auth_policy.capabilities_for_role(role)), set(capabilities))

        self.assertEqual(auth_policy.capabilities_for_role("Admin"), ())
        self.assertFalse(auth_policy.is_supported_role("Admin"))
        self.assertFalse(auth_policy.is_supported_role("unknown"))

    def test_named_dependencies_enforce_the_matrix(self) -> None:
        dependency_roles = {
            require_users_view: {"admin", "management"},
            require_users_manage: {"admin"},
            require_cost_activation: {"admin", "management"},
            require_cost_draft: {"admin", "management", "brewer"},
            require_quotes_manage: {"admin", "management", "sales", "user"},
            require_douano_sync: {"admin"},
            require_product_mappings_manage: {"admin"},
        }
        for dependency, allowed_roles in dependency_roles.items():
            for role in auth_policy.SUPPORTED_ROLES:
                with self.subTest(dependency=dependency.__name__, role=role):
                    request = _request_for_role(role)
                    if role in allowed_roles:
                        self.assertEqual(dependency(request)["role"], role)
                    else:
                        with self.assertRaises(HTTPException) as forbidden:
                            dependency(request)
                        self.assertEqual(forbidden.exception.status_code, 403)
                        self.assertEqual(forbidden.exception.detail, "Geen rechten.")

    def test_dataset_mutation_separates_drafts_settings_and_unclassified_data(self) -> None:
        expectations = {
            "admin": {"kostprijsversies", "bieren", "cost-management-settings", "cost-pools", "skus"},
            "management": {"kostprijsversies", "bieren", "cost-management-settings", "cost-pools"},
            "brewer": {"kostprijsversies", "bieren"},
            "sales": set(),
            "user": set(),
        }
        datasets = {"kostprijsversies", "bieren", "cost-management-settings", "cost-pools", "skus"}
        for role, allowed_datasets in expectations.items():
            for dataset in datasets:
                with self.subTest(role=role, dataset=dataset):
                    request = _request_for_role(role)
                    if dataset in allowed_datasets:
                        self.assertEqual(require_dataset_mutation(dataset, request)["role"], role)
                    else:
                        with self.assertRaises(HTTPException) as forbidden:
                            require_dataset_mutation(dataset, request)
                        self.assertEqual(forbidden.exception.status_code, 403)

    def test_navigation_hides_workflows_without_the_required_capability(self) -> None:
        expected_visibility = {
            "admin": {"nieuwe-kostprijsberekening", "prijsvoorstel", "productkoppeling"},
            "management": {"nieuwe-kostprijsberekening", "prijsvoorstel"},
            "brewer": {"nieuwe-kostprijsberekening"},
            "sales": {"prijsvoorstel"},
        }
        with patch.object(meta.setup_service, "has_active_costprices", return_value=True):
            for role, expected in expected_visibility.items():
                with self.subTest(role=role):
                    keys = {item.key for item in meta.get_navigation({"role": role})}
                    for key in {"nieuwe-kostprijsberekening", "prijsvoorstel", "productkoppeling"}:
                        self.assertEqual(key in keys, key in expected)

    def test_complete_navigation_projection_matches_rf_005a_role_contract(self) -> None:
        fixture_path = (
            PROJECT_ROOT
            / "contracts"
            / "fixtures"
            / "navigation"
            / "role-navigation.current.json"
        )
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        expected_by_role = fixture["backend_hrefs_by_role"]
        self.assertEqual(set(expected_by_role), set(auth_policy.SUPPORTED_ROLES))

        with patch.object(meta.setup_service, "has_active_costprices", return_value=True):
            for role, expected_hrefs in expected_by_role.items():
                with self.subTest(role=role):
                    actual_hrefs = [
                        item.href
                        for item in meta.get_navigation({"role": role})
                    ]
                    self.assertEqual(actual_hrefs, expected_hrefs)

    def test_dashboard_does_not_disclose_quote_summary_to_brewer(self) -> None:
        summary = SimpleNamespace(
            concept_berekeningen=1,
            definitieve_berekeningen=2,
            concept_prijsvoorstellen=3,
            definitieve_prijsvoorstellen=4,
            klaar_om_te_activeren=5,
            klaar_om_te_activeren_waarschuwing="warning",
            aflopende_offertes=6,
            aflopende_offertes_items=[{"id": "quote"}],
        )
        brewer_payload = meta._dashboard_summary_payload(summary, {"role": "brewer"})
        sales_payload = meta._dashboard_summary_payload(summary, {"role": "sales"})
        self.assertEqual(brewer_payload["concept_prijsvoorstellen"], 0)
        self.assertEqual(brewer_payload["aflopende_offertes_items"], [])
        self.assertEqual(sales_payload["concept_prijsvoorstellen"], 3)
        self.assertEqual(sales_payload["aflopende_offertes_items"], [{"id": "quote"}])


if __name__ == "__main__":
    unittest.main()
