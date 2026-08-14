from __future__ import annotations

import json
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = PROJECT_ROOT / "frontend"
SOURCE_ROOT = FRONTEND_ROOT / "src"


class DeprecatedFrontendPathTests(unittest.TestCase):
    def test_unused_sales_strategy_editor_is_absent_and_unreferenced(self) -> None:
        candidate = SOURCE_ROOT / "components" / "VerkoopstrategieEditor.tsx"
        self.assertFalse(candidate.exists())

        references: list[str] = []
        for source in sorted(SOURCE_ROOT.rglob("*")):
            if source.suffix not in {".ts", ".tsx", ".js", ".jsx"}:
                continue
            if "VerkoopstrategieEditor" in source.read_text(encoding="utf-8"):
                references.append(source.relative_to(PROJECT_ROOT).as_posix())
        self.assertEqual(references, [])

    def test_current_sales_strategy_and_new_year_entrypoints_remain_explicit(self) -> None:
        route = (
            SOURCE_ROOT / "app" / "(app)" / "verkoopstrategie" / "page.tsx"
        ).read_text(encoding="utf-8")
        active_screen = (
            SOURCE_ROOT / "features" / "sales-strategy" / "SalesStrategyScreen.tsx"
        ).read_text(encoding="utf-8")
        new_year_wizard = (
            SOURCE_ROOT / "components" / "NieuwJaarWizard.tsx"
        ).read_text(encoding="utf-8")

        self.assertIn('from "@/features/sales-strategy/SalesStrategyScreen"', route)
        self.assertIn("/meta/commercial-yearsets/active/sales-strategy", route)
        self.assertIn("ActiveSalesStrategyWorkspace", active_screen)
        self.assertIn(
            'from "@/components/VerkoopstrategieWorkspace"', new_year_wizard
        )

    def test_frontend_is_not_a_public_component_package(self) -> None:
        package = json.loads(
            (FRONTEND_ROOT / "package.json").read_text(encoding="utf-8")
        )
        self.assertTrue(package.get("private"))
        self.assertNotIn("exports", package)


if __name__ == "__main__":
    unittest.main()
