"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";

import { VerkoopstrategieWorkspace } from "@/components/VerkoopstrategieWorkspace";

type GenericRecord = Record<string, unknown>;

type PricingMode = "keep_price" | "scale_cost_ratio" | "keep_margin" | "free";

type PreviewRow = {
  bierId: string;
  biernaam: string;
  productId: string;
  productType: string;
  productLabel: string;
  estimatedTargetCost: number;
  sellIn?: Record<string, unknown>;
};

type VerkoopstrategieDraftStepProps = {
  sourceYear: number;
  targetYear: number;
  isRunning: boolean;
  conceptStarted: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;

  pricingMode: PricingMode;
  setPricingMode: Dispatch<SetStateAction<PricingMode>>;
  applyPricingScenario: () => Promise<void> | void;

  wizardVerkoopprijzen: GenericRecord[];
  currentProductie: Record<string, GenericRecord>;
  initialBasisproducten: GenericRecord[];
  initialSamengesteldeProducten: GenericRecord[];
  initialBieren: GenericRecord[];
  currentBerekeningen: GenericRecord[];
  currentActivations: GenericRecord[];
  previewRows: PreviewRow[];

  verkoopstrategieSave: null | (() => Promise<void>);
  setVerkoopstrategieSave: Dispatch<SetStateAction<null | (() => Promise<void>)>>;
  setDraftVerkoopstrategieTarget: Dispatch<SetStateAction<GenericRecord[]>>;
  setCompletedStepIds: Dispatch<SetStateAction<string[]>>;
  saveDraftToServer: (message?: string) => Promise<unknown> | unknown;
};

export function VerkoopstrategieDraftStep({
  sourceYear,
  targetYear,
  isRunning,
  conceptStarted,
  saveAndCloseButton,
  navigateToStep,
  pricingMode,
  setPricingMode,
  applyPricingScenario,
  wizardVerkoopprijzen,
  currentProductie,
  initialBasisproducten,
  initialSamengesteldeProducten,
  initialBieren,
  currentBerekeningen,
  currentActivations,
  previewRows,
  verkoopstrategieSave,
  setVerkoopstrategieSave,
  setDraftVerkoopstrategieTarget,
  setCompletedStepIds,
  saveDraftToServer,
}: VerkoopstrategieDraftStepProps) {
  return (
    <div>
      <div className="placeholder-block" style={{ marginBottom: 14 }}>
        <strong>Prijsstrategie (wizard)</strong>
        <div className="muted" style={{ marginTop: 8 }}>
          Kies hoe we van bronjaar {sourceYear} naar doeljaar {targetYear} bewegen. Dit zet concept-overrides klaar in
          verkoopstrategie op bier+product niveau. Je kunt daarna nog vrij bijstellen.
        </div>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label className="nested-field" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="radio"
              name="pricingMode"
              checked={pricingMode === "keep_price"}
              onChange={() => setPricingMode("keep_price")}
              disabled={isRunning}
            />
            <span>1. Verkoopprijs blijft gelijk (marge past aan)</span>
          </label>
          <label className="nested-field" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="radio"
              name="pricingMode"
              checked={pricingMode === "scale_cost_ratio"}
              onChange={() => setPricingMode("scale_cost_ratio")}
              disabled={isRunning}
            />
            <span>2B. Verkoopprijs stijgt mee met kostprijs (default)</span>
          </label>
          <label className="nested-field" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="radio"
              name="pricingMode"
              checked={pricingMode === "keep_margin"}
              onChange={() => setPricingMode("keep_margin")}
              disabled={isRunning}
            />
            <span>2A. Marge% blijft gelijk</span>
          </label>
          <label className="nested-field" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="radio"
              name="pricingMode"
              checked={pricingMode === "free"}
              onChange={() => setPricingMode("free")}
              disabled={isRunning}
            />
            <span>3. Vrij invullen</span>
          </label>
        </div>
        <div className="editor-actions" style={{ marginTop: 12 }}>
          <div className="editor-actions-group" />
          <div className="editor-actions-group">
            <button
              type="button"
              className="editor-button editor-button-secondary"
              onClick={() => void applyPricingScenario()}
              disabled={isRunning || !conceptStarted}
            >
              Toepassen
            </button>
          </div>
        </div>
        {pricingMode === "scale_cost_ratio" || pricingMode === "keep_margin" ? (
          <div className="muted" style={{ marginTop: 10 }}>
            Let op: als je geen expliciete sell-in prijzen hebt opgeslagen (alleen marges), dan zijn 2A en 2B in deze tool
            wiskundig vrijwel gelijk. 2B wordt pas onderscheidend als er echte bronprijzen bestaan.
          </div>
        ) : null}
      </div>

      <VerkoopstrategieWorkspace
        endpoint="/data/verkoopprijzen"
        verkoopprijzen={wizardVerkoopprijzen}
        productie={currentProductie}
        basisproducten={Array.isArray(initialBasisproducten) ? initialBasisproducten : []}
        samengesteldeProducten={Array.isArray(initialSamengesteldeProducten) ? initialSamengesteldeProducten : []}
        bieren={Array.isArray(initialBieren) ? initialBieren : []}
        berekeningen={Array.isArray(currentBerekeningen) ? currentBerekeningen : []}
        channels={[]}
        kostprijsproductactiveringen={Array.isArray(currentActivations) ? currentActivations : []}
        draftKostprijsPreviewRows={previewRows.map((row) => ({
          bierId: row.bierId,
          biernaam: row.biernaam,
          productId: row.productId,
          productType: row.productType === "basis" || row.productType === "samengesteld" ? row.productType : "",
          productLabel: row.productLabel,
          kostprijs: row.estimatedTargetCost,
        }))}
        initialYear={targetYear}
        lockYear
        exposeSave={setVerkoopstrategieSave}
        mode="draft"
        onDraftSave={async (rows) => {
          const strategyTypes = new Set(["jaarstrategie", "verkoopstrategie_product", "verkoopstrategie_verpakking"]);
          const filtered = (Array.isArray(rows) ? rows : []).filter(
            (row) =>
              row &&
              typeof row === "object" &&
              strategyTypes.has(String((row as any).record_type ?? "")) &&
              Number((row as any).jaar ?? 0) === targetYear
          ) as any[];
          setDraftVerkoopstrategieTarget(filtered);
          setCompletedStepIds((current) =>
            current.includes("verkoopstrategie") ? current : [...current, "verkoopstrategie"]
          );
          await saveDraftToServer(`Verkoopstrategie (concept) voor ${targetYear} opgeslagen.`);
        }}
      />

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(8)}
            disabled={isRunning}
          >
            Vorige
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => {
              void verkoopstrategieSave?.();
            }}
            disabled={isRunning || !verkoopstrategieSave}
          >
            Opslaan
          </button>
          <button type="button" className="editor-button" onClick={() => void navigateToStep(10)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}

