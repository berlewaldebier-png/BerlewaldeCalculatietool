"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { buildBlockFromForm } from "@/components/offerte-samenstellen/blockFactories";
import { hydrateFormFromBlock } from "@/components/offerte-samenstellen/blockHydrators";
import { buildScenarioMetricsMap } from "@/components/offerte-samenstellen/offerteSamenstellenDerivations";
import {
  buildScenarioConflictHints,
  evaluateOptionAvailability,
} from "@/components/offerte-samenstellen/conflictRules";
import { buildQuoteableProductOptions } from "@/components/offerte-samenstellen/dataSources";
import {
  createInitialBasisData,
  createInitialQuoteDraft,
  createInitialQuoteFormState,
  getProductRef,
  inferUnitFromPack,
  resolveScenarioProductRefs,
} from "@/components/offerte-samenstellen/quoteUtils";
import {
  buildQuoteDownloadFilename,
  buildQuoteDraftSnapshot,
  buildQuotePersistencePayload,
} from "@/components/offerte-samenstellen/persistence";
import {
  createQuoteDraft,
  loadQuoteDraft,
  updateQuoteDraft,
} from "@/components/offerte-samenstellen/quoteApi";
import { ToolbarOptionDialog } from "@/components/offerte-samenstellen/ToolbarOptionDialog";
import { buildBreakEvenSnapshot } from "@/components/offerte-samenstellen/breakEvenSnapshot";
import {
  closeOptionDialog as closeOptionDialogAction,
  openEditOption as openEditOptionAction,
  openNewOption as openNewOptionAction,
} from "@/components/offerte-samenstellen/offerteOptionDialogActions";
import { buildOptionAvailabilityMap } from "@/components/offerte-samenstellen/offerteOptionAvailability";
import {
  buildBreakEvenProductLines,
  calculateBreakEvenResult,
  normalizeConfigList,
  type BreakEvenConfig,
  type BreakEvenResult,
} from "@/components/break-even/breakEvenUtils";
import type {
  BasisData,
  BuilderBlock,
  OptionType,
  ProductOption,
  QuoteBreakEvenSnapshot,
  QuoteChannel,
  QuoteDraft,
  QuoteDraftSnapshot,
  QuoteFormState,
  QuoteProduct,
  QuoteScenario,
  ScenarioMetrics,
  StepKey,
  ToolbarGroup,
} from "@/components/offerte-samenstellen/types";
import { WizardSteps } from "@/components/WizardSteps";
import { buildLitersPerUnitOverrideMap, getScenario as getLocalScenario, getScenarioLabel } from "@/lib/scenarios";
import { Field, LiveSummaryMetric, Metric, QuickCell } from "@/components/offerte-samenstellen/OfferteSamenstellenParts";
import { clampNumber, euro, normalizeText } from "@/components/offerte-samenstellen/offerteSamenstellenUi";
import { IconTrash, icons, tones } from "@/components/offerte-samenstellen/offerteSamenstellenConfig";
import { offerteToolbarGroups, offerteWizardSteps } from "@/components/offerte-samenstellen/offerteSamenstellenConstants";
import { BasisStep } from "@/components/offerte-samenstellen/steps/BasisStep";
import { FinalizeStep } from "@/components/offerte-samenstellen/steps/FinalizeStep";
import { CompareStep } from "@/components/offerte-samenstellen/steps/CompareStep";
import { BuilderBlockCard } from "@/components/offerte-samenstellen/steps/BuilderBlockCard";
import { BuilderStep } from "@/components/offerte-samenstellen/steps/BuilderStep";

type GenericRecord = Record<string, unknown>;

type UnitMode = "producten" | "liters";
type VatMode = "incl" | "excl";
type ScenarioId = "A" | "B" | "C";

type Scenario = QuoteScenario;

type Props = {
  year: number;
  channels: GenericRecord[];
  bieren: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  verpakkingsonderdelen: GenericRecord[];
  verpakkingsonderdeelPrijzen: GenericRecord[];
  breakEvenConfiguraties: unknown;
  vasteKosten: Record<string, unknown>;
  initialMode?: string;
  initialDraftId?: string | null;
  scenarioId?: string | null;
};

const toolbarGroups: ToolbarGroup[] = offerteToolbarGroups;


export function OfferteSamenstellenApp({
  year,
  channels,
  bieren,
  skus,
  articles,
  kostprijsversies,
  kostprijsproductactiveringen,
  verkoopprijzen,
  basisproducten,
  samengesteldeProducten,
  breakEvenConfiguraties,
  vasteKosten,
  initialMode,
  initialDraftId,
  scenarioId,
}: Props) {
  const router = useRouter();
  const [currentYear, setCurrentYear] = useState<number>(year);
  const [step, setStep] = useState<StepKey>("basis");
  const [activeScenario, setActiveScenario] = useState<ScenarioId>("A");
  const [unitMode, setUnitMode] = useState<UnitMode>("producten");
  const [vatMode, setVatMode] = useState<VatMode>("excl");
  const [draftMeta, setDraftMeta] = useState<QuoteDraft["meta"]>(() => createInitialQuoteDraft(year).meta);
  const [savedBreakEvenSnapshot, setSavedBreakEvenSnapshot] = useState<QuoteBreakEvenSnapshot | null>(
    () => createInitialQuoteDraft(year).breakEven
  );
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [basis, setBasis] = useState<BasisData>(() => createInitialBasisData());

  const appliedScenario = useMemo(() => {
    const id = String(scenarioId ?? "").trim();
    if (!id) return null;
    return getLocalScenario(id);
  }, [scenarioId]);
  const appliedScenarioLabel = useMemo(() => getScenarioLabel(appliedScenario), [appliedScenario]);
  const litersPerUnitOverrides = useMemo(
    () => buildLitersPerUnitOverrideMap(appliedScenario),
    [appliedScenario]
  );

  const productIndex = useMemo(() => {
    return buildQuoteableProductOptions({
      year: currentYear,
      channel: basis.kanaal,
      channels,
      bieren,
      skus,
      articles,
      kostprijsversies,
      kostprijsproductactiveringen,
      verkoopprijzen,
      basisproducten,
      samengesteldeProducten,
      litersPerUnitOverrides,
      scenarioLabelSuffix: appliedScenarioLabel ? ` (${appliedScenarioLabel})` : " (scenario)",
    });
  }, [
    currentYear,
    basis.kanaal,
    channels,
    bieren,
    skus,
    articles,
    kostprijsversies,
    kostprijsproductactiveringen,
    verkoopprijzen,
    basisproducten,
    samengesteldeProducten,
    litersPerUnitOverrides,
    appliedScenarioLabel,
  ]);

  const breakEvenConfigs = useMemo(
    () => normalizeConfigList(breakEvenConfiguraties, currentYear),
    [breakEvenConfiguraties, currentYear]
  );

  const activeBreakEvenConfig = useMemo<BreakEvenConfig | null>(() => {
    return breakEvenConfigs.find((config) => config.jaar === currentYear && config.is_active_for_quotes) ?? null;
  }, [breakEvenConfigs, currentYear]);

  const breakEvenProductLines = useMemo(
    () =>
      buildBreakEvenProductLines({
        year: currentYear,
        channels,
        bieren,
        skus,
        articles,
        kostprijsversies,
        kostprijsproductactiveringen,
        verkoopprijzen,
        basisproducten,
        samengesteldeProducten,
      }),
    [
      currentYear,
      channels,
      bieren,
      skus,
      articles,
      kostprijsversies,
      kostprijsproductactiveringen,
      verkoopprijzen,
      basisproducten,
      samengesteldeProducten,
    ]
  );

  const breakEvenResult = useMemo<BreakEvenResult | null>(() => {
    if (!activeBreakEvenConfig) return null;
    return calculateBreakEvenResult(activeBreakEvenConfig, breakEvenProductLines, vasteKosten);
  }, [activeBreakEvenConfig, breakEvenProductLines, vasteKosten]);
  const currentBreakEvenSnapshot = useMemo(
    () => buildBreakEvenSnapshot(activeBreakEvenConfig, breakEvenResult),
    [activeBreakEvenConfig, breakEvenResult]
  );
  const hasFrozenBreakEvenSnapshot = Boolean(savedBreakEvenSnapshot?.configId);
  const effectiveBreakEvenSnapshot = savedBreakEvenSnapshot ?? currentBreakEvenSnapshot;

  const [scenarios, setScenarios] = useState<Record<ScenarioId, Scenario>>(
    () => createInitialQuoteDraft(year).scenarios
  );

  const [selectedOption, setSelectedOption] = useState<OptionType | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  const [form, setForm] = useState<QuoteFormState>(() => createInitialQuoteFormState());
  const scenario = scenarios[activeScenario];
  const hasIntro = Boolean(scenario.intro && scenario.intro.start && scenario.intro.end);
  const baseOfferRefs = useMemo(
    () => resolveScenarioProductRefs(scenario.products, productIndex.options),
    [scenario.products, productIndex.options]
  );

  function openNewOption(type: OptionType) {
    openNewOptionAction({
      type,
      scenario,
      setEditingBlockId,
      setForm,
      setSelectedOption,
      evaluateOptionAvailability,
      createInitialQuoteFormState,
    });
  }

  function openEditOption(block: BuilderBlock) {
    openEditOptionAction({
      block,
      setEditingBlockId,
      setForm,
      setSelectedOption,
      hydrateFormFromBlock,
    });
  }

  function closeOptionDialog() {
    closeOptionDialogAction({
      setSelectedOption,
      setEditingBlockId,
      setForm,
      createInitialQuoteFormState,
    });
  }

  const scenarioMetrics = useMemo(
    () => buildScenarioMetricsMap({ scenarios, effectiveBreakEvenSnapshot }),
    [effectiveBreakEvenSnapshot, scenarios]
  );

  function updateProduct(productId: string, patch: Partial<QuoteProduct>) {
    setScenarios((prev) => ({
      ...prev,
      [activeScenario]: {
        ...prev[activeScenario],
        products: prev[activeScenario].products.map((p) => (p.id === productId ? { ...p, ...patch } : p)),
      },
    }));
  }

  function addProductRow() {
    const id = `row-${Date.now()}`;
    setScenarios((prev) => ({
      ...prev,
      [activeScenario]: {
        ...prev[activeScenario],
        products: [
          ...prev[activeScenario].products,
          {
            id,
            name: "",
            pack: "",
            qty: 1,
            litersPerUnit: 0,
            unit: "doos",
            standardPriceEx: 0,
            costPriceEx: 0,
            vatRatePct: 0,
          },
        ],
      },
    }));
  }

  function removeProductRow(productId: string) {
    setScenarios((prev) => ({
      ...prev,
      [activeScenario]: {
        ...prev[activeScenario],
        products: prev[activeScenario].products.filter((product) => product.id !== productId),
      },
    }));
  }

  function applyOptionToScenario(type: OptionType) {
    const availability = evaluateOptionAvailability({
      scenario,
      type,
      editingBlockId,
    });
    if (!availability.allowed) {
      return;
    }

    const period: "intro" | "standard" = type === "Intro" ? "intro" : "standard";
    const block = buildBlockFromForm({
      type,
      form,
      activePeriod: period,
      tones,
      icons,
      productOptions: productIndex.options,
      baseOfferRefs,
      existingBlockId: editingBlockId,
    });

    setScenarios((prev) => {
      const existing = prev[activeScenario];

      // If no explicit product selection was captured for a scoped pricing rule, default it to the current proposal lines
      // to avoid silent no-ops. The forms now make this choice visible via the "gebruik basisofferte" switch.
      if (type === "Staffel" || type === "Mix" || type === "Korting") {
        const payload = (block.payload ?? {}) as Record<string, unknown>;
        const eligibleRaw = Array.isArray(payload.eligibleRefs) ? (payload.eligibleRefs as unknown[]) : [];
        const eligible = eligibleRaw.map((r) => String(r ?? "")).filter(Boolean);
        if (eligible.length === 0) {
          const refs = (existing.products ?? []).map(getProductRef).filter(Boolean);
          block.payload = { ...payload, eligibleRefs: refs };
        }
      }

      // Guardrails are evaluated before save; this branch stays structural only.
      if (type === "Intro") {
        return {
          ...prev,
          [activeScenario]: {
            ...existing,
            intro: { start: normalizeText(form.introStart), end: normalizeText(form.introEnd) },
            blocks: [
              block,
              ...existing.blocks.filter((b) => (b.id !== editingBlockId) && b.type !== "Intro"),
            ],
          },
        };
      }

      return {
        ...prev,
        [activeScenario]: {
          ...existing,
          blocks: [block, ...existing.blocks.filter((b) => b.id !== editingBlockId)],
        },
      };
    });

    closeOptionDialog();
  }

  function removeBlock(blockId: string) {
    setScenarios((prev) => {
      const existing = prev[activeScenario];
      const nextBlocks = existing.blocks.filter((b) => b.id !== blockId);
      const removedWasIntro = existing.blocks.some((b) => b.id === blockId && b.type === "Intro");
      return {
        ...prev,
        [activeScenario]: {
          ...existing,
          blocks: nextBlocks,
          intro: removedWasIntro ? null : existing.intro,
        },
      };
    });
  }

  function handleSelectOptionForRow(rowId: string, optionId: string) {
    const option = productIndex.options.find((o) => o.optionId === optionId);
    if (!option) return;
    updateProduct(rowId, {
      name: option.bierName,
      pack: option.packLabel,
      litersPerUnit: option.litersPerUnit,
      unit: inferUnitFromPack(option.packLabel),
      standardPriceEx: option.standardPriceEx,
      costPriceEx: option.costPriceEx,
      vatRatePct: option.vatRatePct,
      source: {
        sku_id: optionId.startsWith("sku:") ? optionId.slice("sku:".length) : undefined,
        bier_id: option.bierId,
        product_id: option.productId,
        kostprijsversie_id: option.kostprijsversieId,
      },
    });
  }

  function buildCurrentDraftSnapshot(nextMeta: QuoteDraft["meta"]) {
    const snapshotBreakEven = savedBreakEvenSnapshot ?? currentBreakEvenSnapshot;
    return buildQuoteDraftSnapshot({
      meta: nextMeta,
      year: currentYear,
      basis,
      scenarios,
      breakEven: snapshotBreakEven,
      ui: {
        step,
        activeScenario,
        unitMode,
        vatMode,
      },
    });
  }

  function restoreScenarioPresentation(snapshot: QuoteDraftSnapshot): Record<ScenarioId, Scenario> {
    const ids: ScenarioId[] = ["A", "B", "C"];
    return Object.fromEntries(
      ids.map((id) => [
        id,
        {
          ...snapshot.scenarios[id],
          blocks: snapshot.scenarios[id].blocks.map((block) => ({
            ...block,
            icon: icons[block.type] ?? null,
            tone: block.tone || tones[block.type],
          })),
        },
      ])
    ) as Record<ScenarioId, Scenario>;
  }

  function hydrateDraftSnapshot(snapshot: QuoteDraftSnapshot) {
    setCurrentYear(Number(snapshot.year || year) || year);
    setDraftMeta(snapshot.meta);
    setSavedBreakEvenSnapshot(snapshot.breakEven ?? null);
    setBasis(snapshot.basis);
    setScenarios(restoreScenarioPresentation(snapshot));
    setStep(snapshot.ui.step);
    setActiveScenario(snapshot.ui.activeScenario);
    setUnitMode(snapshot.ui.unitMode);
    setVatMode(snapshot.ui.vatMode);
  }

  useEffect(() => {
    if (!initialDraftId) {
      return;
    }

    let cancelled = false;
    setIsLoadingDraft(true);
    setDraftError(null);

    void loadQuoteDraft(initialDraftId)
      .then(({ record }) => {
        if (cancelled) return;
        const snapshot = record.payload?.draft;
        if (!snapshot) {
          throw new Error("Offertepayload bevat geen draft snapshot.");
        }
        hydrateDraftSnapshot(snapshot);
      })
      .catch((error) => {
        if (cancelled) return;
        setDraftError(error instanceof Error ? error.message : "Offerte kon niet geladen worden.");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingDraft(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialDraftId, year]);

  async function saveQuoteDraft() {
    await persistQuoteDraft(draftMeta);
  }

  async function finalizeQuoteDraft() {
    const nextMeta: QuoteDraft["meta"] = {
      ...draftMeta,
      status: "definitief",
    };
    await persistQuoteDraft(nextMeta);
  }

  async function persistQuoteDraft(nextMeta: QuoteDraft["meta"]) {
    setIsSavingDraft(true);
    setDraftError(null);
    try {
      const payload = buildQuotePersistencePayload(buildCurrentDraftSnapshot(nextMeta));
      const response = draftMeta.draftId
        ? await updateQuoteDraft(draftMeta.draftId, payload)
        : await createQuoteDraft(payload);
      const snapshot = response.record.payload?.draft;
      if (!snapshot) {
        throw new Error("Opslaan gaf geen geldige draft snapshot terug.");
      }
      setSavedBreakEvenSnapshot(snapshot.breakEven ?? null);
      hydrateDraftSnapshot(snapshot);
      if (response.record.id) {
        router.replace(`/offerte-samenstellen?draft=${encodeURIComponent(response.record.id)}`);
      }
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "Offerte kon niet opgeslagen worden.");
    } finally {
      setIsSavingDraft(false);
    }
  }

  function downloadQuoteStub() {
    const snapshot = buildCurrentDraftSnapshot(draftMeta);
    const payload = {
      ...buildQuotePersistencePayload(snapshot),
      exportMeta: {
        activeScenario,
        exportedAt: new Date().toISOString(),
        note: "V1 export stub: document generator is nog niet gekoppeld.",
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildQuoteDownloadFilename(basis.offerteNaam);
    a.click();
    URL.revokeObjectURL(url);
  }

  const steps = offerteWizardSteps;

  const activeMetrics = scenarioMetrics[activeScenario];
  const rightMetrics = activeMetrics.standard;

  const incompatibilityHints = useMemo(() => {
    return buildScenarioConflictHints(scenario);
  }, [scenario.blocks, hasIntro]);

  const optionAvailability = useMemo(() => {
    return buildOptionAvailabilityMap({
      scenario,
      evaluateOptionAvailability,
    });
  }, [scenario]);

  const selectedOptionAvailability = selectedOption
    ? evaluateOptionAvailability({
        scenario,
        type: selectedOption,
        editingBlockId,
      })
    : null;

  return (
    <div className="cpq-root">
      <div className="cpq-frame">
        <div className="cpq-topbar">
          <div>
            <div className="cpq-kicker">Offerte wizard</div>
            <h1 className="cpq-title">Offerte samenstellen</h1>
          </div>
          <div className="cpq-topbar-actions">
            <div className="cpq-toggle-strip" role="group" aria-label="Eenheden">
              <button
                onClick={() => setUnitMode("producten")}
                className={`cpq-toggle${unitMode === "producten" ? " active" : ""}`}
              >
                Producten
              </button>
              <button
                onClick={() => setUnitMode("liters")}
                className={`cpq-toggle${unitMode === "liters" ? " active" : ""}`}
              >
                Liters
              </button>
            </div>
            <div className="cpq-toggle-strip" role="group" aria-label="BTW">
              <button
                onClick={() => setVatMode("excl")}
                className={`cpq-toggle${vatMode === "excl" ? " active" : ""}`}
              >
                Excl. btw
              </button>
              <button
                onClick={() => setVatMode("incl")}
                className={`cpq-toggle${vatMode === "incl" ? " active" : ""}`}
              >
                Incl. btw
              </button>
            </div>
          </div>
        </div>

        {draftError ? <div className="cpq-alert cpq-alert-warn">{draftError}</div> : null}
        {isLoadingDraft ? <div className="cpq-alert">Offerte wordt geladen...</div> : null}
        {appliedScenarioLabel ? (
          <div className="cpq-alert">
            Scenario actief: <strong>{appliedScenarioLabel}</strong>. Kostprijs + sell-in per eenheid zijn aangepast op basis van literinhoud per eenheid.
          </div>
        ) : null}

        <div className="cpq-grid cpq-grid-two">
          <aside className="cpq-left">
            <WizardSteps
              title="Stappen"
              steps={steps.map((item) => ({ id: item.id, title: item.title, description: item.desc }))}
              activeIndex={steps.findIndex((item) => item.id === step)}
              onSelect={(index) => {
                const next = steps[index];
                if (!next) return;
                setStep(next.id);
              }}
            />

            <div className="cpq-quick">
              <div className="cpq-quick-title">Quick view</div>
              <div className="cpq-quick-grid">
                <QuickCell label="Klant" value={basis.klantNaam || "—"} />
                <QuickCell label="Kanaal" value={basis.kanaal} />
                <QuickCell label="Status" value={draftMeta.status === "definitief" ? "Definitief" : "Concept"} />
                <QuickCell label="Voorstel" value={activeScenario} />
                <QuickCell label="Jaar" value={String(year)} />
                <QuickCell
                  label="Break-even"
                  value={activeBreakEvenConfig ? activeBreakEvenConfig.naam : "Geen actieve versie"}
                />
                <QuickCell label="Versie" value={String(draftMeta.version)} />
                <QuickCell label="Bewaard" value={draftMeta.updatedAt ? new Date(draftMeta.updatedAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }) : "Nog niet"} />
              </div>
            </div>
          </aside>

          <main className="cpq-main">
            {step === "basis" ? (
              <BasisStep
                basis={basis}
                setBasis={setBasis}
                onNext={() => setStep("builder")}
                onSave={() => void saveQuoteDraft()}
                isSaving={isSavingDraft || isLoadingDraft}
              />
            ) : null}

            {step === "builder" ? (
              <BuilderStep
                unitMode={unitMode}
                vatMode={vatMode}
                hasIntro={hasIntro}
                scenario={scenario}
                metrics={activeMetrics.standard}
                activeScenario={activeScenario}
                setActiveScenario={setActiveScenario}
                updateProduct={updateProduct}
                addProductRow={addProductRow}
                removeProductRow={removeProductRow}
                removeBlock={removeBlock}
                toolbarGroups={toolbarGroups}
                openOption={openNewOption}
                editOption={openEditOption}
                optionAvailability={optionAvailability}
                onNext={() => setStep("vergelijk")}
                productOptions={productIndex.options}
                onSelectRowOption={handleSelectOptionForRow}
                warnings={productIndex.warnings}
                incompatibilityHints={incompatibilityHints}
                onSave={() => void saveQuoteDraft()}
                isSaving={isSavingDraft || isLoadingDraft}
              />
            ) : null}

            {step === "vergelijk" ? (
              <CompareStep
                scenarios={scenarios}
                metrics={scenarioMetrics}
                activeScenario={activeScenario}
                setActiveScenario={setActiveScenario}
                onNext={() => setStep("afronden")}
                onBack={() => setStep("builder")}
                onSave={() => void saveQuoteDraft()}
                isSaving={isSavingDraft || isLoadingDraft}
              />
            ) : null}

            {step === "afronden" ? (
              <FinalizeStep
                basis={basis}
                scenario={scenario}
                metrics={scenarioMetrics[activeScenario].standard}
                draftStatus={draftMeta.status}
                onBack={() => setStep("vergelijk")}
                onDownload={downloadQuoteStub}
                onSave={() => void saveQuoteDraft()}
                onFinalize={() => void finalizeQuoteDraft()}
                isSaving={isSavingDraft || isLoadingDraft}
              />
            ) : null}
          </main>
        </div>

        {selectedOption ? (
          <ToolbarOptionDialog
            selectedOption={selectedOption}
            hasIntro={hasIntro}
            incompatibilityHints={incompatibilityHints}
            selectedOptionAvailability={selectedOptionAvailability ?? optionAvailability[selectedOption]}
            form={form}
            setForm={setForm}
            productOptions={productIndex.options}
            baseOfferRefs={baseOfferRefs}
            onClose={closeOptionDialog}
            onSave={() => applyOptionToScenario(selectedOption)}
          />
        ) : null}
      </div>
    </div>
  );
}

