from __future__ import annotations

import ast
import hashlib
import json
import re
import unittest
from collections import Counter
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_APP = PROJECT_ROOT / "backend" / "app"
DDL_RE = re.compile(
    r"\b(CREATE(?:\s+UNIQUE)?|ALTER|DROP|TRUNCATE)\s+"
    r"(TABLE|INDEX|SCHEMA|EXTENSION|TYPE|VIEW|SEQUENCE)\s+"
    r"(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([^\s;(]+)",
    re.IGNORECASE,
)


def _sql_template(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts: list[str] = []
        for value in node.values:
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                parts.append(value.value)
            else:
                parts.append("{dynamic}")
        return "".join(parts)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = _sql_template(node.left)
        right = _sql_template(node.right)
        if left is not None and right is not None:
            return left + right
    return None


class _ExecuteVisitor(ast.NodeVisitor):
    def __init__(self, relative_path: str) -> None:
        self.relative_path = relative_path
        self.function_stack: list[str] = []
        self.records: list[str] = []

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.function_stack.append(node.name)
        self.generic_visit(node)
        self.function_stack.pop()

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.function_stack.append(node.name)
        self.generic_visit(node)
        self.function_stack.pop()

    def visit_Call(self, node: ast.Call) -> None:
        function = node.func
        is_execute = isinstance(function, ast.Attribute) and function.attr in {
            "execute",
            "executemany",
        }
        if is_execute and node.args:
            template = _sql_template(node.args[0])
            if template:
                normalized = " ".join(template.split())
                owner = ".".join(self.function_stack) if self.function_stack else "<module>"
                for match in DDL_RE.finditer(normalized):
                    operation = " ".join(match.group(1).upper().split())
                    object_type = match.group(2).upper()
                    object_name = match.group(3).strip('"').lower()
                    self.records.append(
                        f"{self.relative_path}:{owner}:{operation}:{object_type}:{object_name}"
                    )
        self.generic_visit(node)


def runtime_ddl_inventory() -> list[str]:
    records: list[str] = []
    for path in sorted(BACKEND_APP.rglob("*.py")):
        relative = path.relative_to(PROJECT_ROOT).as_posix()
        visitor = _ExecuteVisitor(relative)
        visitor.visit(ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path)))
        records.extend(visitor.records)
    return sorted(records)


def inventory_fingerprint(records: list[str]) -> str:
    encoded = json.dumps(records, ensure_ascii=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


EXPECTED_DDL_COUNT = 253
EXPECTED_DDL_FINGERPRINT = "7aeb11a38a06ef1b28ef17593258373536324db6386f3bf171d686304ced824b"
EXPECTED_OWNER_COUNTS: dict[str, int] = {
    "backend/app/api/routes/meta.py:post_dev_hard_reset": 1,
    "backend/app/domain/adviesprijzen_storage.py:ensure_schema": 1,
    "backend/app/domain/articles_storage.py:ensure_schema": 3,
    "backend/app/domain/auth_service.py:ensure_schema": 4,
    "backend/app/domain/bom_storage.py:ensure_schema": 5,
    "backend/app/domain/break_even_planning_storage.py:ensure_schema": 9,
    "backend/app/domain/commercial_yearset_storage.py:ensure_schema": 7,
    "backend/app/domain/company_distance_storage.py:ensure_schema": 2,
    "backend/app/domain/correction_run_storage.py:ensure_schema": 3,
    "backend/app/domain/cost_authority_storage.py:ensure_schema": 16,
    "backend/app/domain/cost_versions_storage.py:ensure_schema": 22,
    "backend/app/domain/dataset_store.py:validate_phase_g_constraints": 1,
    "backend/app/domain/douano_margin_snapshot_storage.py:ensure_schema": 3,
    "backend/app/domain/douano_oauth_storage.py:ensure_schema": 1,
    "backend/app/domain/douano_product_ignore_storage.py:ensure_schema": 1,
    "backend/app/domain/douano_product_mapping_storage.py:ensure_schema": 7,
    "backend/app/domain/douano_sync_storage.py:ensure_schema": 22,
    "backend/app/domain/douano_unmapped_rule_storage.py:ensure_schema": 11,
    "backend/app/domain/fixed_costs_storage.py:ensure_schema": 13,
    "backend/app/domain/fixed_costs_storage.py:reset_defaults": 1,
    "backend/app/domain/kostprijs_activatie_drafts_storage.py:ensure_schema": 2,
    "backend/app/domain/kostprijs_activation_storage.py:ensure_schema": 9,
    "backend/app/domain/kostprijs_activation_storage.py:reset_defaults": 2,
    "backend/app/domain/kostprijs_scenario_inkoop_storage.py:ensure_schema": 4,
    "backend/app/domain/lot_costs_storage.py:ensure_schema": 19,
    "backend/app/domain/new_year_drafts_storage.py:ensure_schema": 2,
    "backend/app/domain/postgres_storage.py:ensure_schema": 1,
    "backend/app/domain/product_model_storage.py:ensure_schema": 15,
    "backend/app/domain/product_registry_storage.py:ensure_schema": 6,
    "backend/app/domain/production_storage.py:ensure_schema": 14,
    "backend/app/domain/production_storage.py:reset_defaults": 1,
    "backend/app/domain/quote_drafts_storage.py:ensure_schema": 12,
    "backend/app/domain/sales_pricing_storage.py:ensure_schema": 5,
    "backend/app/domain/skus_storage.py:ensure_schema": 11,
    "backend/app/domain/tarieven_heffingen_storage.py:ensure_schema": 2,
    "backend/app/domain/traceability_storage.py:ensure_schema": 15,
}


class RuntimeDdlInventoryTests(unittest.TestCase):
    def test_runtime_ddl_inventory_matches_owned_baseline(self) -> None:
        records = runtime_ddl_inventory()
        owner_counts = Counter(record.rsplit(":", 3)[0] for record in records)

        self.assertTrue(records)
        self.assertFalse(
            [record for record in records if ":<module>:" in record],
            "runtime DDL must have a named function owner",
        )
        self.assertEqual(len(records), EXPECTED_DDL_COUNT)
        self.assertEqual(inventory_fingerprint(records), EXPECTED_DDL_FINGERPRINT)
        self.assertEqual(dict(sorted(owner_counts.items())), EXPECTED_OWNER_COUNTS)


if __name__ == "__main__":
    unittest.main()
