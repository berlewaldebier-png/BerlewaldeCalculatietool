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

    def test_unused_rf011a_resolver_and_exclusive_contract_are_absent(self) -> None:
        resolver = (
            SOURCE_ROOT
            / "features"
            / "commercial-context"
            / "activeCommercialContextResolver.ts"
        )
        contract = (
            FRONTEND_ROOT
            / "scripts"
            / "activeCommercialContextResolver.contracttest.ts"
        )
        self.assertFalse(resolver.exists())
        self.assertFalse(contract.exists())

        forbidden = (
            "activeCommercialContextResolver",
            "resolveActiveCommercialContext",
            "readActiveCommercialContext",
        )
        references: list[str] = []
        for root in (SOURCE_ROOT, FRONTEND_ROOT / "scripts"):
            for source in sorted(root.rglob("*")):
                if source.suffix not in {".ts", ".tsx", ".js", ".jsx", ".json"}:
                    continue
                content = source.read_text(encoding="utf-8")
                if any(token in content for token in forbidden):
                    references.append(source.relative_to(PROJECT_ROOT).as_posix())
        self.assertEqual(references, [])

    def test_current_quote_break_even_and_year_transition_paths_remain(self) -> None:
        quote_page = (
            SOURCE_ROOT / "app" / "(app)" / "offerte-samenstellen" / "page.tsx"
        ).read_text(encoding="utf-8")
        quote_app = (
            SOURCE_ROOT
            / "components"
            / "offerte-samenstellen"
            / "OfferteSamenstellenApp.tsx"
        ).read_text(encoding="utf-8")
        break_even = (
            SOURCE_ROOT / "components" / "break-even-next" / "BreakEvenNextMockup.tsx"
        ).read_text(encoding="utf-8")
        transition = (
            SOURCE_ROOT
            / "features"
            / "year-transition"
            / "canonicalYearTransitionPlanner.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("/quotes/commercial-context", quote_page)
        self.assertIn("quoteCommercialContext", quote_app)
        self.assertIn("breakEvenCommercialContext", break_even)
        self.assertIn("selectPlanningCostCandidate", transition)

    def test_pricing_runner_no_longer_collects_removed_resolver(self) -> None:
        package = (FRONTEND_ROOT / "package.json").read_text(encoding="utf-8")
        pricing_config = (
            FRONTEND_ROOT / "scripts" / "tsconfig.pricing.json"
        ).read_text(encoding="utf-8")
        self.assertNotIn("activeCommercialContextResolver", package)
        self.assertNotIn("activeCommercialContextResolver", pricing_config)


if __name__ == "__main__":
    unittest.main()
