from __future__ import annotations

import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _function_source(path: Path, start: str, end: str) -> str:
    source = path.read_text(encoding="utf-8")
    start_index = source.index(start)
    end_index = source.index(end, start_index + len(start))
    return source[start_index:end_index]


class FrontendWorkflowBoundaryTests(unittest.TestCase):
    def test_cost_finalize_persists_version_before_style_and_optional_activation(self) -> None:
        source = _function_source(
            PROJECT_ROOT / "frontend" / "src" / "components" / "BerekeningenWizard.tsx",
            "  async function handleFinalize()",
            "  async function handleDeleteCurrent()",
        )

        version_index = source.index("await saveKostprijsversie(nextCurrent, { knownExisting: isEditingExisting })")
        style_index = source.index("await persistPreparedStyle(preparedStyle)")
        activation_index = source.index("await activateKostprijsversieProducts")

        self.assertLess(version_index, style_index)
        self.assertLess(style_index, activation_index)
        self.assertIn("Afronden gelukt, maar nieuwe artikelen automatisch activeren mislukt", source)

    def test_cost_style_save_uses_targeted_item_contract_and_busy_feedback(self) -> None:
        wizard_source = (
            PROJECT_ROOT / "frontend" / "src" / "components" / "BerekeningenWizard.tsx"
        ).read_text(encoding="utf-8")
        io_source = (
            PROJECT_ROOT
            / "frontend"
            / "src"
            / "components"
            / "berekeningen"
            / "berekeningenWizardIo.ts"
        ).read_text(encoding="utf-8")
        coupling_source = (
            PROJECT_ROOT
            / "frontend"
            / "src"
            / "components"
            / "berekeningen"
            / "steps"
            / "KoppelenStep.tsx"
        ).read_text(encoding="utf-8")

        self.assertIn("saveBierRow,", wizard_source)
        self.assertNotIn("saveBierenRows", wizard_source)
        self.assertNotIn("BIEREN_API", wizard_source)
        self.assertIn('saveDatasetItem("bieren", payload, options)', io_source)
        self.assertNotIn('reconcileDatasetItems("bieren"', io_source)
        self.assertIn('aria-busy={isSaving}', wizard_source)
        self.assertIn('<SavingIndicator label="Opslaan..." />', wizard_source)
        self.assertIn("selectExplicitBeerVariantSkus({", wizard_source)
        self.assertIn("selectExplicitBeerVariantSkus({", coupling_source)

    def test_year_close_api_commit_precedes_incidental_reconciliation_and_draft_removal(self) -> None:
        source = _function_source(
            PROJECT_ROOT
            / "frontend"
            / "src"
            / "components"
            / "jaar-afsluiten"
            / "JaarAfsluitenWizard.tsx",
            "  async function closeYear(",
            "  function saveDraft(",
        )

        close_request_index = source.index("/integrations/break-even/close-year")
        incidental_index = source.index("await persistIncidentalRowsForYear()")
        draft_removal_index = source.index("removeDraft()")

        self.assertLess(close_request_index, incidental_index)
        self.assertLess(incidental_index, draft_removal_index)
        self.assertIn('setStatus(error instanceof Error ? error.message : String(error))', source)


if __name__ == "__main__":
    unittest.main()
