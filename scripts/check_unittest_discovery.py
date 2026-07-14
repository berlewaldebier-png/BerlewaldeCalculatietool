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
missing = sorted(required_lot_contracts.difference(ids))

if loader.errors:
    raise SystemExit("unittest discovery errors:\n" + "\n".join(loader.errors))
if missing:
    raise SystemExit("Required LOT contract tests were not discovered:\n" + "\n".join(missing))

print(f"unittest discovery: {len(ids)} tests; all required LOT contracts collected")
