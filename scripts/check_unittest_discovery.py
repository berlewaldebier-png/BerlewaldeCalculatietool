from __future__ import annotations

import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TESTS_ROOT = PROJECT_ROOT / "tests"
BACKEND_ROOT = PROJECT_ROOT / "backend"

for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))


def _test_ids(suite: unittest.TestSuite) -> list[str]:
    result: list[str] = []
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            result.extend(_test_ids(test))
        else:
            result.append(test.id())
    return result


loader = unittest.TestLoader()
suite = loader.discover(str(TESTS_ROOT), pattern="test_*.py")
ids = _test_ids(suite)

required_lot_contracts = {
    "test_lot_contract.LotContractTests.test_lot_exact_key_keeps_letter_o_and_digit_zero_distinct",
    "test_lot_contract.LotContractTests.test_lot_near_key_is_only_for_diagnostics",
    "test_lot_contract.LotContractTests.test_snapshot_backfill_uses_keyset_pagination",
    "test_lot_contract.LotContractTests.test_legacy_company_lines_route_stays_snapshot_only",
}
required_rf003_contracts = {
    "test_disposable_postgres_guard.DisposablePostgresGuardTests.test_non_test_database_name_is_always_rejected",
    "test_disposable_postgres_guard.DisposablePostgresGuardTests.test_production_environment_is_always_rejected",
    "test_disposable_postgres_guard.DisposablePostgresGuardTests.test_remote_host_is_always_rejected",
    "test_postgres_schema_safety.PostgresSchemaSafetyTests.test_dashboard_first_read_mutates_schema_then_warm_read_is_pure",
    "test_postgres_schema_safety.PostgresSchemaSafetyTests.test_legacy_quote_shapes_are_destructively_removed_only_in_fixture",
    "test_postgres_schema_safety.PostgresSchemaSafetyTests.test_populated_fk_reset_exposes_current_non_atomic_partial_failure",
    "test_runtime_ddl_inventory.RuntimeDdlInventoryTests.test_runtime_ddl_inventory_matches_owned_baseline",
}
required_rf004_contracts = {
    "test_workflow_failure_characterization.DouanoWorkflowFailureTests.test_nth_raw_write_failure_leaves_prior_write_and_rerun_converges",
    "test_workflow_failure_characterization.LotWorkflowFailureTests.test_opening_import_nth_row_failure_leaves_prior_row_and_rerun_converges",
    "test_workflow_failure_characterization.NewYearDraftConcurrencyTests.test_same_owner_and_year_is_last_write_wins_with_frozen_fingerprints",
    "test_workflow_postgres_characterization.WorkflowPostgresCharacterizationTests.test_concurrent_quote_create_exposes_max_plus_one_unique_conflict",
    "test_workflow_postgres_characterization.WorkflowPostgresCharacterizationTests.test_cost_route_snapshot_failure_leaves_activation_and_retry_is_idempotent",
    "test_workflow_postgres_characterization.WorkflowPostgresCharacterizationTests.test_new_year_failure_rolls_back_all_target_markers",
    "test_workflow_postgres_characterization.WorkflowPostgresCharacterizationTests.test_ors_raised_failure_rolls_back_earlier_cache_write",
    "test_workflow_postgres_characterization.WorkflowPostgresCharacterizationTests.test_year_close_snapshot_survives_later_production_failure_and_requires_overwrite_retry",
    "test_workflow_source_boundaries.FrontendWorkflowBoundaryTests.test_year_close_api_commit_precedes_incidental_reconciliation_and_draft_removal",
}
required_rf005_contracts = {
    "test_auth_characterization.AuthEnvironmentCharacterizationTests.test_disabled_auth_synthesizes_admin_only_in_explicit_bypass_environments",
    "test_auth_characterization.AuthEnvironmentCharacterizationTests.test_production_configuration_rejects_disabled_auth",
    "test_auth_role_policy.AuthRolePolicyTests.test_exact_approved_role_capability_matrix",
    "test_auth_role_policy.AuthRolePolicyTests.test_named_dependencies_enforce_the_matrix",
    "test_auth_route_matrix.AuthRouteMatrixTests.test_complete_route_access_fingerprint_matches_rf_005_policy",
}
missing = sorted(
    (
        required_lot_contracts
        | required_rf003_contracts
        | required_rf004_contracts
        | required_rf005_contracts
    ).difference(ids)
)

if loader.errors:
    raise SystemExit("unittest discovery errors:\n" + "\n".join(loader.errors))
if missing:
    raise SystemExit("Required contract tests were not discovered:\n" + "\n".join(missing))

print(
    f"unittest discovery: {len(ids)} tests; "
    "all required LOT, RF-003, RF-004 and RF-005 contracts collected"
)
