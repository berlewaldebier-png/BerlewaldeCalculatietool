from app.domain import douano_margin_service, lot_costs_storage


def test_lot_exact_key_keeps_letter_o_and_digit_zero_distinct() -> None:
    douano_lot = "PO3010"
    internal_lot = "P03010"

    assert lot_costs_storage._lot_exact_key(douano_lot) != lot_costs_storage._lot_exact_key(internal_lot)
    assert douano_margin_service._lot_exact_key(douano_lot) != douano_margin_service._lot_exact_key(internal_lot)


def test_lot_near_key_is_only_for_diagnostics() -> None:
    douano_lot = "PO3010"
    internal_lot = "P03010"

    assert lot_costs_storage._lot_near_key(douano_lot) == lot_costs_storage._lot_near_key(internal_lot)
    assert douano_margin_service._lot_near_key(douano_lot) == douano_margin_service._lot_near_key(internal_lot)
    assert lot_costs_storage._lot_exact_key(douano_lot) != lot_costs_storage._lot_near_key(internal_lot)


def test_snapshot_backfill_uses_keyset_pagination() -> None:
    names = douano_margin_service.backfill_line_snapshots.__code__.co_names

    assert "offset" not in {str(name).lower() for name in names}


def test_legacy_company_lines_route_stays_snapshot_only() -> None:
    names = douano_margin_service.list_company_lines.__code__.co_names

    assert "_resolve_cost_per_unit" not in names
    assert "_resolve_cost_for_sale" not in names
