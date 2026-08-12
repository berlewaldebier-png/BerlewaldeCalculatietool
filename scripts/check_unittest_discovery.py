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
    "test_auth_characterization.AuthEnvironmentCharacterizationTests.test_explicit_local_logout_blocks_synthetic_admin_but_accepts_a_new_session",
    "test_auth_characterization.AuthSessionCharacterizationTests.test_local_logout_deletes_session_and_persists_explicit_logged_out_marker",
    "test_auth_role_policy.AuthRolePolicyTests.test_exact_approved_role_capability_matrix",
    "test_auth_role_policy.AuthRolePolicyTests.test_named_dependencies_enforce_the_matrix",
    "test_auth_route_matrix.AuthRouteMatrixTests.test_complete_route_access_fingerprint_matches_rf_005_policy",
}
required_rf006_contracts = {
    "test_quote_boundary_characterization.QuoteBoundaryCharacterizationTests.test_registry_references_executable_request_and_response_snapshots",
    "test_quote_boundary_characterization.QuoteBoundaryCharacterizationTests.test_selected_openapi_operations_match_snapshot",
    "test_quote_boundary_characterization.QuoteBoundaryCharacterizationTests.test_typed_delete_adapter_preserves_unknown_fields_and_reports_alias",
    "test_workflow_postgres_characterization.WorkflowPostgresCharacterizationTests.test_quote_boundary_roundtrip_preserves_database_payload_and_delete_count",
}
required_rf005a_contracts = {
    "test_auth_role_policy.AuthRolePolicyTests.test_complete_navigation_projection_matches_rf_005a_role_contract",
}
required_rf007_contracts = {
    "test_dataset_resource_crud.DatasetResourceCrudTests.test_bieren_item_reconciliation_preserves_projection_sync_in_production",
    "test_workflow_source_boundaries.FrontendWorkflowBoundaryTests.test_cost_snapshot_uses_canonical_composite_to_basis_projection",
    "test_workflow_source_boundaries.FrontendWorkflowBoundaryTests.test_cost_style_save_uses_targeted_item_contract_and_busy_feedback",
}
required_rf008_contracts = {
    "test_workflow_source_boundaries.FrontendWorkflowBoundaryTests.test_application_settings_read_and_save_contract_is_preserved",
}
required_rf010a_contracts = {
    "test_active_commercial_context_capture.ActiveCommercialContextCaptureSafetyTests.test_private_target_requires_explicit_opt_in",
    "test_active_commercial_context_capture.ActiveCommercialContextCaptureSafetyTests.test_production_is_rejected_even_with_private_opt_in",
}
required_rf010c_contracts = {
    "test_year_transition_parity_capture.YearTransitionParityCaptureSafetyTests.test_capture_requires_explicit_pseudonymous_structure_acknowledgement",
    "test_year_transition_parity_capture.YearTransitionParityCaptureSafetyTests.test_capture_rejects_non_forward_year_transition_before_connecting",
    "test_year_transition_read_model_characterization.YearTransitionReadModelCharacterizationTests.test_normalized_rows_currently_replace_original_product_categories",
}
required_rf010b_contracts = {
    "test_planning_lot_cost_capture.PlanningLotCostCaptureSafetyTests.test_private_manifest_does_not_emit_identifiers_or_commercial_values",
    "test_planning_lot_cost_capture.PlanningLotCostCaptureSafetyTests.test_private_target_requires_explicit_development_opt_in",
    "test_planning_lot_cost_golden.PlanningLotCostGoldenTests.test_approved_anchor_is_first_activation_but_current_latest_selection_deviates",
    "test_planning_lot_cost_golden.PlanningLotCostGoldenTests.test_break_even_currently_reads_only_the_open_latest_activation",
    "test_planning_lot_cost_golden.PlanningLotCostGoldenTests.test_exact_lot_wins_across_later_activation_and_order_date",
    "test_planning_lot_cost_golden.PlanningLotCostGoldenTests.test_lot_requirement_and_cost_requirement_are_independent",
    "test_planning_lot_cost_golden.PlanningLotCostGoldenTests.test_missing_unknown_and_near_lot_use_visible_latest_activation_fallbacks",
    "test_planning_lot_cost_golden.PlanningLotCostGoldenTests.test_ambiguous_exact_lot_is_silently_resolved_to_highest_version_today",
    "test_planning_lot_cost_golden.PlanningLotCostGoldenTests.test_reopened_historical_quote_keeps_its_saved_cost_reference",
}
required_rf011b_contracts = {
    "test_planning_actual_cost_resolver.PlanningActualCostResolverTests.test_first_approved_activation_is_stable_planning_anchor",
    "test_planning_actual_cost_resolver.PlanningActualCostResolverTests.test_only_explicit_approved_rebaseline_replaces_first_anchor",
    "test_planning_actual_cost_resolver.PlanningActualCostResolverTests.test_textual_rebaseline_approval_is_not_treated_as_boolean_approval",
    "test_planning_actual_cost_resolver.PlanningActualCostResolverTests.test_exact_lot_wins_without_order_date_selection",
    "test_planning_actual_cost_resolver.PlanningActualCostResolverTests.test_explicit_canonical_cost_row_precedes_embedded_compatibility_row",
    "test_planning_actual_cost_resolver.PlanningActualCostResolverTests.test_sku_code_scoped_alias_is_projected_through_canonical_sku",
    "test_planning_actual_cost_resolver.PlanningActualCostResolverTests.test_direct_lot_record_without_canonical_lineage_is_visible_but_not_repriced",
    "test_planning_actual_cost_resolver.PlanningActualCostResolverTests.test_missing_unknown_near_and_ambiguous_lot_never_use_planning_fallback",
    "test_planning_actual_cost_resolver.PlanningActualCostResolverTests.test_lot_and_cost_requirement_are_independent_explicit_policies",
    "test_planning_actual_cost_resolver.PlanningActualCostResolverTests.test_shadow_exposes_current_planning_and_actual_fallback_differences",
    "test_planning_actual_cost_resolver.PlanningActualCostResolverTests.test_reader_is_called_once_and_resolver_is_read_only",
}
required_rf013p_contracts = {
    "test_rf013p_data_baseline.Rf013pDataBaselineTests.test_capture_enforces_read_only_transaction_before_querying",
    "test_rf013p_data_baseline.Rf013pDataBaselineTests.test_manifest_comparison_names_only_protected_sections",
    "test_rf013p_data_baseline.Rf013pDataBaselineTests.test_private_artifact_paths_cannot_escape_ignored_output_root",
    "test_rf013p_data_baseline.Rf013pDataBaselineTests.test_source_capture_rejects_production_and_unverified_hosts",
    "test_rf013p_data_baseline.Rf013pDataBaselineTests.test_pg_commands_do_not_embed_password_in_arguments",
}
required_rf013a_contracts = {
    "test_auth_route_matrix.AuthRouteMatrixTests.test_commercial_yearset_authority_routes_are_admin_only",
    "test_commercial_yearset_authority.CommercialYearsetReadinessTests.test_complete_contract_is_ready_and_hash_is_deterministic",
    "test_commercial_yearset_authority.CommercialYearsetReadinessTests.test_initial_forecast_must_be_an_exact_frozen_plan_copy",
    "test_commercial_yearset_authority.CommercialYearsetReadinessTests.test_missing_cost_rows_and_plan_allocations_block_activation",
    "test_commercial_yearset_authority.CommercialYearsetLegacyRollbackTests.test_active_authority_blocks_both_destructive_legacy_rollbacks",
    "test_commercial_yearset_authority.CommercialYearsetPostgresTests.test_activation_and_rollback_only_move_the_pointer",
    "test_commercial_yearset_authority.CommercialYearsetPostgresTests.test_blocked_candidate_cannot_replace_current_authority",
    "test_commercial_yearset_authority.CommercialYearsetPostgresTests.test_candidate_creation_is_idempotent_and_additive",
    "test_commercial_yearset_authority.CommercialYearsetPostgresTests.test_concurrent_compare_and_swap_allows_only_one_winner",
    "test_commercial_yearset_authority.CommercialYearsetPostgresTests.test_fallback_is_explicit_until_an_authority_is_active",
    "test_rf013p_data_baseline.Rf013pDataBaselineTests.test_rf013a_additive_comparison_preserves_existing_state",
}
required_rf013b_contracts = {
    "test_auth_route_matrix.AuthRouteMatrixTests.test_cost_authority_routes_keep_prepare_approve_execute_separated",
    "test_cost_authority.CostAuthorityPlanTests.test_article_service_and_bundle_use_explicit_subject_types",
    "test_cost_authority.CostAuthorityPlanTests.test_direct_lot_cost_without_version_row_lineage_stays_blocked",
    "test_cost_authority.CostAuthorityPlanTests.test_duplicate_name_reference_is_ambiguous_and_never_merged",
    "test_cost_authority.CostAuthorityPlanTests.test_plan_keeps_first_activation_and_exact_lots_separate",
    "test_cost_authority.CostAuthorityPostgresTests.test_ambiguous_legacy_beer_mapping_requires_reviewed_admin_choice",
    "test_cost_authority.CostAuthorityPostgresTests.test_backfill_is_idempotent_and_does_not_change_legacy_tables",
    "test_cost_authority.CostAuthorityPostgresTests.test_first_new_activation_anchors_but_later_activation_does_not_replace",
    "test_cost_authority.CostAuthorityPostgresTests.test_rebaseline_requires_brewer_management_and_admin_in_order",
    "test_rf013b_rehearsal.Rf013bRehearsalSafetyTests.test_only_exact_authority_tables_may_be_added",
}
required_rf013c_contracts = {
    "test_auth_route_matrix.AuthRouteMatrixTests.test_yearset_reconciliation_routes_keep_prepare_approve_execute_separated",
    "test_main_middleware.MainMiddlewareTests.test_startup_event_ensures_postgres_schema",
    "test_rf013c_rehearsal.Rf013cRehearsalSafetyTests.test_only_exact_six_reconciliation_tables_are_added_by_rf013c",
    "test_rf013c_rehearsal.Rf013cRehearsalSafetyTests.test_restored_characterization_requires_exact_known_gaps",
    "test_yearset_reconciliation.YearsetReconciliationPlanTests.test_catalog_reference_does_not_require_a_positive_cost",
    "test_yearset_reconciliation.YearsetReconciliationPlanTests.test_complete_manifest_is_ready_and_preserves_one_row_per_stable_sku",
    "test_yearset_reconciliation.YearsetReconciliationPlanTests.test_conflicting_financial_rows_for_one_sku_block_the_candidate",
    "test_yearset_reconciliation.YearsetReconciliationPlanTests.test_identical_ui_fanout_rows_collapse_without_using_labels_as_identity",
    "test_yearset_reconciliation.YearsetReconciliationPlanTests.test_initial_forecast_is_an_exact_detached_copy_of_the_frozen_plan",
    "test_yearset_reconciliation.YearsetReconciliationPlanTests.test_manifest_hash_is_stable_when_input_row_order_changes",
    "test_yearset_reconciliation.YearsetReconciliationPlanTests.test_multiple_closed_source_snapshots_block_deterministic_lineage",
    "test_yearset_reconciliation.YearsetReconciliationPlanTests.test_required_cost_without_target_input_is_visible_and_blocks_activation",
    "test_yearset_reconciliation.YearsetReconciliationPostgresTests.test_failed_candidate_stage_rolls_back_the_generation_and_run",
    "test_yearset_reconciliation.YearsetReconciliationPostgresTests.test_ready_candidate_requires_management_then_admin_and_moves_one_pointer",
    "test_yearset_reconciliation.YearsetReconciliationPostgresTests.test_source_change_after_candidate_blocks_approval",
}
required_rf013c1_contracts = {
    "test_rf013c_rehearsal.Rf013cRehearsalSafetyTests.test_blocker_worklist_requires_exact_known_gap_identities",
    "test_yearset_reconciliation.YearsetReconciliationPlanTests.test_blocker_worklist_names_exact_skus_without_exposing_amounts",
    "test_yearset_reconciliation.YearsetReconciliationPlanTests.test_global_blocker_occurrences_are_not_lost_from_the_worklist",
    "test_yearset_reconciliation.YearsetReconciliationPlanTests.test_review_projection_uses_a_read_only_transaction_without_schema_init",
    "test_yearset_reconciliation.YearsetReconciliationPlanTests.test_worklist_labels_do_not_change_candidate_identity",
}
required_rf013c2_contracts = {
    "test_auth_route_matrix.AuthRouteMatrixTests.test_yearset_reconciliation_routes_keep_prepare_approve_execute_separated",
    "test_rf013c_rehearsal.Rf013cRehearsalSafetyTests.test_lineage_review_requires_exact_known_gap_classifications",
    "test_yearset_blocker_lineage.YearsetBlockerLineageTests.test_exact_target_authority_is_reproducible_without_inventing_amounts",
    "test_yearset_blocker_lineage.YearsetBlockerLineageTests.test_historical_sellable_sku_without_authority_requires_human_decision",
    "test_yearset_blocker_lineage.YearsetBlockerLineageTests.test_multiple_valid_authority_chains_are_never_selected_automatically",
    "test_yearset_blocker_lineage.YearsetBlockerLineageTests.test_plan_and_zero_sell_in_are_explicit_human_policy_decisions",
    "test_yearset_blocker_lineage.YearsetBlockerLineageTests.test_projection_is_amount_free_and_labels_do_not_change_identity",
    "test_yearset_blocker_lineage.YearsetBlockerLineageTests.test_review_uses_read_only_transaction_without_schema_initialization",
}
required_rf013c3_contracts = {
    "test_auth_route_matrix.AuthRouteMatrixTests.test_yearset_reconciliation_routes_keep_prepare_approve_execute_separated",
    "test_main_middleware.MainMiddlewareTests.test_startup_event_ensures_postgres_schema",
    "test_rf013c_rehearsal.Rf013cRehearsalSafetyTests.test_approved_recovery_requires_the_exact_ready_projection",
    "test_yearset_recovery.YearsetRecoveryPostgresTests.test_approved_inputs_are_additive_and_previous_decisions_are_retained",
    "test_yearset_recovery.YearsetRecoveryProjectionTests.test_approved_projection_is_ready_balanced_and_keeps_legacy_input_untouched",
    "test_yearset_recovery.YearsetRecoveryProjectionTests.test_changed_exact_authority_blocks_instead_of_silently_recalculating",
    "test_yearset_recovery.YearsetRecoveryProjectionTests.test_duplicate_exact_authority_blocks_after_approval",
    "test_yearset_recovery.YearsetRecoveryProjectionTests.test_exact_decision_sets_must_match_the_current_lineage",
    "test_yearset_recovery.YearsetRecoveryProjectionTests.test_only_management_may_approve_the_recovery_input",
}
required_rf012c1_contracts = {
    "test_auth_route_matrix.AuthRouteMatrixTests.test_quote_read_and_mutation_routes_use_quote_capability",
    "test_quote_commercial_context.QuoteCommercialContextProjectionTests.test_active_generation_exposes_exact_cost_price_and_binding",
    "test_quote_commercial_context.QuoteCommercialContextProjectionTests.test_exclusion_keeps_typed_reasons_instead_of_silently_dropping_sku",
    "test_quote_commercial_context.QuoteCommercialContextProjectionTests.test_non_operational_generation_fails_closed",
    "test_quote_commercial_context.QuoteCommercialContextReaderTests.test_reader_starts_read_only_and_does_not_initialize_schema",
}
required_rf012c2_contracts = {
    "test_break_even_commercial_context.BreakEvenCommercialContextProjectionTests.test_active_generation_exposes_immutable_plan_and_cost_rows",
    "test_break_even_commercial_context.BreakEvenCommercialContextProjectionTests.test_initial_forecast_mismatch_fails_closed",
    "test_break_even_commercial_context.BreakEvenCommercialContextProjectionTests.test_tampered_plan_hash_fails_closed",
    "test_break_even_commercial_context.BreakEvenCommercialContextProjectionTests.test_incomplete_year_periods_fail_closed",
    "test_break_even_commercial_context.BreakEvenCommercialContextProjectionTests.test_legacy_or_other_generation_revision_is_not_applied",
    "test_break_even_commercial_context.BreakEvenCommercialContextProjectionTests.test_exact_generation_bound_revision_is_available",
    "test_break_even_commercial_context.BreakEvenPlanForecastProjectionTests.test_without_actuals_initial_forecast_exactly_equals_plan",
    "test_break_even_commercial_context.BreakEvenPlanForecastProjectionTests.test_actual_period_replaces_plan_period_and_future_plan_remains",
    "test_break_even_commercial_context.BreakEvenPlanForecastProjectionTests.test_partial_month_keeps_unelapsed_plan_in_forecast",
    "test_break_even_commercial_context.BreakEvenPlanForecastProjectionTests.test_year_close_forecast_equals_final_actual",
    "test_break_even_commercial_context.BreakEvenAbcOccupancyProjectionTests.test_forecast_uses_actual_absorption_plus_remaining_plan",
    "test_break_even_commercial_context.BreakEvenAbcOccupancyProjectionTests.test_initial_forecast_occupancy_is_zero_without_actuals",
    "test_break_even_commercial_context.BreakEvenAnalysisConsumerTests.test_active_year_uses_generation_plan_without_legacy_plan_reader",
    "test_break_even_commercial_context.BreakEvenAnalysisConsumerTests.test_active_year_does_not_fall_back_when_generation_is_invalid",
    "test_break_even_commercial_context.BreakEvenCommercialContextReaderTests.test_reader_starts_read_only_and_never_initializes_schema",
}
required_rf012d1_contracts = {
    "test_auth_route_matrix.AuthRouteMatrixTests.test_commercial_yearset_authority_routes_are_admin_only",
    "test_yearset_dossier.YearsetDossierProjectionTests.test_finalized_dossier_exposes_exact_frozen_plan_and_sku_values",
    "test_yearset_dossier.YearsetDossierProjectionTests.test_superseded_generation_remains_a_read_only_historical_dossier",
    "test_yearset_dossier.YearsetDossierProjectionTests.test_candidate_generation_is_not_exposed_as_finalized",
    "test_yearset_dossier.YearsetDossierProjectionTests.test_tampered_plan_hash_fails_closed",
    "test_yearset_dossier.YearsetDossierProjectionTests.test_candidate_count_mismatch_fails_closed",
    "test_yearset_dossier.YearsetDossierReaderTests.test_reader_starts_read_only_and_never_initializes_schema",
    "test_yearset_dossier.YearsetDossierFrontendContractTests.test_open_dossier_and_prepare_next_year_are_separate_actions",
}
required_rf012d1a_contracts = {
    "test_auth_route_matrix.AuthRouteMatrixTests.test_commercial_yearset_authority_routes_are_admin_only",
    "test_historical_yearset_wizard.HistoricalYearsetWizardProjectionTests.test_duplicate_presentation_rows_collapse_to_one_exact_stable_sku",
    "test_historical_yearset_wizard.HistoricalYearsetWizardProjectionTests.test_conflicting_duplicate_financial_rows_fail_closed",
    "test_historical_yearset_wizard.HistoricalYearsetWizardProjectionTests.test_material_difference_from_finalized_dossier_fails_closed",
    "test_historical_yearset_wizard.HistoricalYearsetWizardProjectionTests.test_only_exact_target_anchor_and_non_cost_catalog_rows_may_lack_legacy_batch",
    "test_historical_yearset_wizard.HistoricalYearsetWizardProjectionTests.test_later_production_state_is_labeled_reconstructed",
    "test_historical_yearset_wizard.HistoricalYearsetWizardReaderTests.test_reader_starts_read_only_and_never_initializes_schema",
    "test_historical_yearset_wizard.HistoricalYearsetWizardFrontendContractTests.test_historical_view_reuses_fourteen_step_source_and_has_no_mutation_form",
}
required_rf012d2_contracts = {
    "test_auth_route_matrix.AuthRouteMatrixTests.test_active_cost_overview_requires_cost_view_capability",
    "test_active_cost_overview.ActiveCostOverviewProjectionTests.test_groups_each_physical_sku_once_and_prioritizes_box_then_keg",
    "test_active_cost_overview.ActiveCostOverviewProjectionTests.test_keeps_missing_not_applicable_and_not_activated_distinct",
    "test_active_cost_overview.ActiveCostOverviewProjectionTests.test_weizen_recalculation_provenance_is_preserved",
    "test_active_cost_overview.ActiveCostOverviewProjectionTests.test_duplicate_sku_fails_closed_instead_of_cloning_a_cross_reference",
    "test_active_cost_overview.ActiveCostOverviewReaderTests.test_reader_uses_read_only_shadow_query_and_never_initializes_schema",
    "test_active_cost_overview.ActiveCostOverviewFrontendContractTests.test_kostprijs_beheren_uses_the_read_only_active_generation_component",
}
required_rf012d3_contracts = {
    "test_auth_route_matrix.AuthRouteMatrixTests.test_active_cost_overview_requires_cost_view_capability",
    "test_cost_history.CostHistoryProjectionTests.test_distinguishes_active_anchor_variants_and_unresolved_evidence",
    "test_cost_history.CostHistoryProjectionTests.test_mismatched_source_anchor_fails_closed",
    "test_cost_history.CostHistoryProjectionTests.test_duplicate_cost_row_identity_fails_closed",
    "test_cost_history.CostHistoryProjectionTests.test_component_mismatch_remains_visible_without_changing_active_anchor",
    "test_cost_history.CostHistoryReaderTests.test_reader_starts_read_only_and_never_initializes_schema",
    "test_cost_history.CostHistoryFrontendContractTests.test_history_is_lazy_read_only_and_has_accessible_disclosures",
}
missing = sorted(
    (
        required_lot_contracts
        | required_rf003_contracts
        | required_rf004_contracts
        | required_rf005_contracts
        | required_rf005a_contracts
        | required_rf006_contracts
        | required_rf007_contracts
        | required_rf008_contracts
        | required_rf010a_contracts
        | required_rf010c_contracts
        | required_rf010b_contracts
        | required_rf011b_contracts
        | required_rf013p_contracts
        | required_rf013a_contracts
        | required_rf013b_contracts
        | required_rf013c_contracts
        | required_rf013c1_contracts
        | required_rf013c2_contracts
        | required_rf013c3_contracts
        | required_rf012c1_contracts
        | required_rf012c2_contracts
        | required_rf012d1_contracts
        | required_rf012d1a_contracts
        | required_rf012d2_contracts
        | required_rf012d3_contracts
    ).difference(ids)
)

if loader.errors:
    raise SystemExit("unittest discovery errors:\n" + "\n".join(loader.errors))
if missing:
    raise SystemExit("Required contract tests were not discovered:\n" + "\n".join(missing))

print(
    f"unittest discovery: {len(ids)} tests; "
    "all required LOT, RF-003, RF-004, RF-005, RF-005A, RF-006, RF-007, "
    "RF-008, RF-010A, RF-010C, RF-010B, RF-011B, RF-013P, RF-013A, "
    "RF-013B, RF-013C, RF-013C1, RF-013C2, RF-013C3, RF-012C1 and "
    "RF-012C2, RF-012D1, RF-012D1A, RF-012D2, and RF-012D3 contracts collected"
)
