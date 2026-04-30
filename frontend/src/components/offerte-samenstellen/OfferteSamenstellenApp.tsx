"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { buildBlockFromForm } from "@/components/offerte-samenstellen/blockFactories";
import { hydrateFormFromBlock } from "@/components/offerte-samenstellen/blockHydrators";
import { calculateScenarioMetrics as calculateScenarioMetricsForScenario } from "@/components/offerte-samenstellen/calculations";
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
  ToolbarGroup,
} from "@/components/offerte-samenstellen/types";
import { WizardSteps } from "@/components/WizardSteps";
import { buildLitersPerUnitOverrideMap, getScenario as getLocalScenario, getScenarioLabel } from "@/lib/scenarios";

type GenericRecord = Record<string, unknown>;

type StepKey = "basis" | "builder" | "vergelijk" | "afronden";
type UnitMode = "producten" | "liters";
type VatMode = "incl" | "excl";
type ScenarioId = "A" | "B" | "C";

function isPricingActionBlock(block: BuilderBlock) {
  return (
    block.type === "Staffel" ||
    block.type === "Korting" ||
    block.type === "Mix" ||
    block.type === "Groothandel"
  );
}

function usesBaseOfferProducts(block: BuilderBlock | undefined) {
  return Boolean(block?.payload?.useBaseOfferProducts ?? true);
}

type Scenario = QuoteScenario;

type Props = {
  year: number;
  channels: GenericRecord[];
  bieren: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  catalogusproducten: GenericRecord[];
  verpakkingsonderdelen: GenericRecord[];
  verpakkingsonderdeelPrijzen: GenericRecord[];
  breakEvenConfiguraties: unknown;
  vasteKosten: Record<string, unknown>;
  initialMode?: string;
  initialDraftId?: string | null;
  scenarioId?: string | null;
};

const tones: Record<OptionType, string> = {
  Intro: "cpq-tone-intro",
  Staffel: "cpq-tone-staffel",
  Mix: "cpq-tone-mix",
  Korting: "cpq-tone-korting",
  Groothandel: "cpq-tone-korting",
  Transport: "cpq-tone-transport",
  Retour: "cpq-tone-retour",
  Proeverij: "cpq-tone-proeverij",
  Tapverhuur: "cpq-tone-tap",
};

const icons: Record<OptionType, React.ReactNode> = {
  Intro: <IconClock />,
  Staffel: <IconChart />,
  Mix: <IconShuffle />,
  Korting: <IconTag />,
  Groothandel: <IconStorefront />,
  Transport: <IconTruck />,
  Retour: <IconReturn />,
  Proeverij: <IconBeer />,
  Tapverhuur: <IconTent />,
};

const toolbarGroups: ToolbarGroup[] = [
  {
    title: "Pricing",
    items: [
      { icon: icons.Intro, label: "Intro" },
      { icon: icons.Staffel, label: "Staffel" },
      { icon: icons.Mix, label: "Mix" },
      { icon: icons.Korting, label: "Korting" },
      { icon: icons.Groothandel, label: "Groothandel" },
    ],
  },
  {
    title: "Logistiek",
    items: [
      { icon: icons.Transport, label: "Transport" },
      { icon: icons.Retour, label: "Retour" },
    ],
  },
  {
    title: "Extra's",
    items: [
      { icon: icons.Proeverij, label: "Proeverij" },
      { icon: icons.Tapverhuur, label: "Tapverhuur" },
    ],
  },
];

function euro(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function clampNumber(value: unknown, fallback: number) {
  const num = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : fallback;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function buildBreakEvenSnapshot(
  config: BreakEvenConfig | null,
  result: BreakEvenResult | null
): QuoteBreakEvenSnapshot | null {
  if (!config || !result) return null;
  return {
    configId: config.id,
    configName: config.naam,
    year: config.jaar,
    breakEvenRevenue: result.breakEvenRevenue,
    breakEvenLiters: result.breakEvenLiters,
    weightedSellInPerLiter: result.weightedSellInPerLiter,
    weightedVariableCostPerLiter: result.weightedVariableCostPerLiter,
    weightedContributionPerLiter: result.weightedContributionPerLiter,
    contributionMarginPct: result.contributionMarginPct,
    mixTotalPct: result.mixTotalPct,
    calculatedAt: new Date().toISOString(),
  };
}

export function OfferteSamenstellenApp({
  year,
  channels,
  bieren,
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
    const availability = evaluateOptionAvailability({
      scenario,
      type,
    });
    if (!availability.allowed) return;
    setEditingBlockId(null);
    setForm(createInitialQuoteFormState());
    setSelectedOption(type);
  }

  function openEditOption(block: BuilderBlock) {
    setEditingBlockId(block.id);
    setForm(hydrateFormFromBlock(block));
    setSelectedOption(block.type);
  }

  function closeOptionDialog() {
    setSelectedOption(null);
    setEditingBlockId(null);
    setForm(createInitialQuoteFormState());
  }

  const scenarioMetrics = useMemo(() => {
    const ids: ScenarioId[] = ["A", "B", "C"];
    return Object.fromEntries(
      ids.map((id) => {
        const sc = scenarios[id];
        return [
          id,
          {
            standard: calculateScenarioMetricsForScenario(
              sc,
              "standard",
              effectiveBreakEvenSnapshot
            ),
            intro: sc.intro
              ? calculateScenarioMetricsForScenario(
                  sc,
                  "intro",
                  effectiveBreakEvenSnapshot
                )
              : null,
          },
        ];
      })
    ) as Record<ScenarioId, { standard: ScenarioMetrics; intro: ScenarioMetrics | null }>;
  }, [effectiveBreakEvenSnapshot, scenarios]);

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

  const steps: { id: StepKey; title: string; desc: string }[] = [
    { id: "basis", title: "Basisgegevens", desc: "Klant, kanaal en naam" },
    { id: "builder", title: "Offerte maken", desc: "Producten, opties en voorstellen" },
    { id: "vergelijk", title: "Vergelijken", desc: "Voorstellen naast elkaar" },
    { id: "afronden", title: "Afronden", desc: "Export en notities" },
  ];

  const activeMetrics = scenarioMetrics[activeScenario];
  const rightMetrics = activeMetrics.standard;

  const incompatibilityHints = useMemo(() => {
    return buildScenarioConflictHints(scenario);
  }, [scenario.blocks, hasIntro]);

  const optionAvailability = useMemo(() => {
    const entries = ([
      "Intro",
      "Staffel",
      "Mix",
      "Korting",
      "Groothandel",
      "Transport",
      "Retour",
      "Proeverij",
      "Tapverhuur",
    ] as OptionType[]).map((type) => [
      type,
      evaluateOptionAvailability({
        scenario,
        type,
      }),
    ]);

    return Object.fromEntries(entries) as Record<
      OptionType,
      ReturnType<typeof evaluateOptionAvailability>
    >;
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

        <div className="cpq-grid">
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

          <aside className="cpq-right">
            <h2 className="cpq-right-kicker">Live inzicht</h2>
            <div className="cpq-panel">
              <div className="cpq-live-summary-head">
                <div className="cpq-panel-title">Totaal</div>
                <div className="cpq-panel-subtitle">
                  {scenario.products.length} product{scenario.products.length === 1 ? "" : "en"}
                </div>
              </div>
              <div className="cpq-live-summary-grid">
                <LiveSummaryMetric label="Omzet" value={euro(rightMetrics.revenueEx)} />
                <LiveSummaryMetric
                  label="Kostprijs"
                  value={euro(
                    Math.max(
                      0,
                      rightMetrics.costEx - rightMetrics.extraCostEx - rightMetrics.transportCostEx
                    )
                  )}
                />
                <LiveSummaryMetric
                  label="Transport"
                  value={euro(rightMetrics.transportCostEx)}
                />
                <LiveSummaryMetric
                  label="Extra kosten"
                  value={euro(rightMetrics.extraCostEx)}
                />
                <LiveSummaryMetric
                  label="Winst"
                  value={euro(rightMetrics.revenueEx - rightMetrics.costEx)}
                />
                <LiveSummaryMetric
                  label="Marge %"
                  value={`${Math.round(rightMetrics.marginPct)}%`}
                />
              </div>
            </div>

            <div className="cpq-panel">
              <div className="cpq-live-summary-head">
                <div className="cpq-panel-title">Live break-even</div>
                <div className="cpq-panel-subtitle">Impact van dit voorstel</div>
              </div>
              <div className="cpq-live-summary-grid">
                <LiveSummaryMetric
                  label="Break-even omzet"
                  value={rightMetrics.breakEvenCurrent === null ? "Niet ingesteld" : euro(rightMetrics.breakEvenCurrent)}
                />
                <LiveSummaryMetric
                  label="Boven / onder BE"
                  value={rightMetrics.breakEvenProjected === null ? "-" : euro(rightMetrics.breakEvenProjected)}
                />
                <LiveSummaryMetric
                  label="BE-dekking"
                  value={
                    rightMetrics.breakEvenCoveragePct === null
                      ? "Niet beschikbaar"
                      : `${Math.round(rightMetrics.breakEvenCoveragePct)}%`
                  }
                />
              </div>
              {effectiveBreakEvenSnapshot ? (
                <p className="cpq-panel-text cpq-break-even-note">
                  {draftMeta.status === "definitief"
                    ? `Definitieve offerte rekent met snapshot ${effectiveBreakEvenSnapshot.configName}.`
                    : hasFrozenBreakEvenSnapshot
                      ? `Conceptofferte rekent met opgeslagen snapshot ${effectiveBreakEvenSnapshot.configName}. Nieuwe offertes gebruiken de actuele actieve break-even.`
                      : `Actieve break-even: ${effectiveBreakEvenSnapshot.configName}. Bij de eerste save wordt deze snapshot vastgezet voor deze offerte.`}
                </p>
              ) : (
                <p className="cpq-panel-text cpq-break-even-note">
                  Geen actieve break-even configuratie voor {currentYear}. De offerte blijft werken,
                  maar toont nog geen break-even referentie.
                </p>
              )}
            </div>

            <div className="cpq-panel">
              <h3 className="cpq-panel-title">Actieve voorstel-notitie</h3>
              <p className="cpq-panel-text">{scenario.note || "Geen notitie toegevoegd."}</p>
            </div>
          </aside>
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

function BasisStep({
  basis,
  setBasis,
  onNext,
  onSave,
  isSaving,
}: {
  basis: BasisData;
  setBasis: React.Dispatch<React.SetStateAction<BasisData>>;
  onNext: () => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  return (
    <section className="cpq-card">
      <div className="cpq-card-header">
        <div>
          <h2 className="cpq-card-title">Basisgegevens</h2>
          <p className="cpq-card-subtitle">Vul klant, kanaal en context van de offerte in.</p>
        </div>
      </div>

      <div className="cpq-form-grid">
        <Field label="Klantnaam" value={basis.klantNaam} onChange={(v) => setBasis((prev) => ({ ...prev, klantNaam: v }))} />
        <Field label="Contactpersoon" value={basis.contactpersoon} onChange={(v) => setBasis((prev) => ({ ...prev, contactpersoon: v }))} />
        <Field label="Offertenaam" value={basis.offerteNaam} onChange={(v) => setBasis((prev) => ({ ...prev, offerteNaam: v }))} />
        <Field label="Geldig tot" value={basis.geldigTot} onChange={(v) => setBasis((prev) => ({ ...prev, geldigTot: v }))} />
      </div>

      <div className="cpq-form-row">
        <div className="cpq-label">Kanaal</div>
        <div className="cpq-toggle-strip" role="group" aria-label="Kanaal">
          {(["Horeca", "Retail", "Events"] as QuoteChannel[]).map((kanaal) => (
            <button
              key={kanaal}
              type="button"
              onClick={() => setBasis((prev) => ({ ...prev, kanaal }))}
              className={`cpq-toggle${basis.kanaal === kanaal ? " active" : ""}`}
            >
              {kanaal}
            </button>
          ))}
        </div>
      </div>

      <div className="cpq-form-row">
        <label className="cpq-field">
          <div className="cpq-label">Opmerking</div>
          <textarea
            value={basis.opmerking}
            onChange={(e) => setBasis((prev) => ({ ...prev, opmerking: e.target.value }))}
            className="cpq-textarea"
          />
        </label>
      </div>

      <div className="cpq-actions cpq-actions-split">
        <button onClick={onSave} className="cpq-button cpq-button-secondary" type="button" disabled={isSaving}>
          {isSaving ? "Opslaan..." : "Opslaan"}
        </button>
        <button onClick={onNext} className="cpq-button cpq-button-primary" type="button">
          Verder naar offerte maken
        </button>
      </div>
    </section>
  );
}

function BuilderStep({
  unitMode,
  vatMode,
  hasIntro,
  scenario,
  metrics,
  activeScenario,
  setActiveScenario,
  updateProduct,
  addProductRow,
  removeProductRow,
  removeBlock,
  toolbarGroups,
  openOption,
  editOption,
  optionAvailability,
  onNext,
  productOptions,
  onSelectRowOption,
  warnings,
  incompatibilityHints,
  onSave,
  isSaving,
}: {
  unitMode: UnitMode;
  vatMode: VatMode;
  hasIntro: boolean;
  scenario: Scenario;
  metrics: ScenarioMetrics;
  activeScenario: ScenarioId;
  setActiveScenario: (id: ScenarioId) => void;
  updateProduct: (productId: string, patch: Partial<QuoteProduct>) => void;
  addProductRow: () => void;
  removeProductRow: (productId: string) => void;
  removeBlock: (blockId: string) => void;
  toolbarGroups: ToolbarGroup[];
  openOption: (type: OptionType) => void;
  editOption: (block: BuilderBlock) => void;
  optionAvailability: Record<OptionType, { allowed: boolean; reasons: string[] }>;
  onNext: () => void;
  productOptions: ProductOption[];
  onSelectRowOption: (rowId: string, optionId: string) => void;
  warnings: string[];
  incompatibilityHints: string[];
  onSave: () => void;
  isSaving: boolean;
}) {
  const introBlocks = scenario.blocks.filter((block) => (block.appliesTo ?? "standard") === "intro");
  const standardBlocks = scenario.blocks.filter(
    (block) => (block.appliesTo ?? "standard") === "standard"
  );
  const globalBlocks = scenario.blocks.filter((block) => (block.appliesTo ?? "standard") === "global");
  const standardPricingBlock = standardBlocks.find((block) => isPricingActionBlock(block));
  const basisOfferteActive = !standardPricingBlock || usesBaseOfferProducts(standardPricingBlock);

  return (
    <div className="cpq-stack">
      <div className="cpq-builder-header">
        <div>
          <h2 className="cpq-card-title">Offerte maken</h2>
          <p className="cpq-card-subtitle">
            Start simpel met producten en breid uit met blokken via de toolbar.
          </p>
        </div>
        <div className="cpq-toggle-strip" role="group" aria-label="Voorstel">
          {(["A", "B", "C"] as ScenarioId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveScenario(id)}
              className={`cpq-toggle${activeScenario === id ? " active" : ""}`}
            >
              Voorstel {id}
            </button>
          ))}
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="cpq-alert">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      {incompatibilityHints.length > 0 ? (
        <div className="cpq-alert cpq-alert-warn">
          {incompatibilityHints.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      <div className="cpq-toolbar">
        <div className="cpq-toolbar-inner">
          {toolbarGroups.map((group) => (
            <div key={group.title} className="cpq-toolbar-group">
              <div className="cpq-toolbar-title">{group.title}</div>
              {group.items.map((item) => {
                const availability = optionAvailability[item.label];
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => openOption(item.label)}
                    className="cpq-tool"
                    title={
                      availability.allowed
                        ? item.label
                        : `${item.label} — ${availability.reasons.join(" ")}`
                    }
                    disabled={!availability.allowed}
                  >
                    <span className="cpq-tool-icon">{item.icon}</span>
                    <span className="cpq-tool-tooltip">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {basisOfferteActive ? (
        <section className="cpq-card">
          <div className="cpq-card-header cpq-card-header-row">
            <div>
              <h3 className="cpq-card-title">Basisofferte</h3>
              <p className="cpq-card-subtitle">
                Basisprijs komt uit verkoopstrategie (sell-in, ex). BTW-toggle is alleen
                weergave.
              </p>
            </div>
            <button onClick={addProductRow} className="cpq-button cpq-button-secondary" type="button">
              + Product toevoegen
            </button>
          </div>

          <div className="cpq-table-wrap">
            <table className="cpq-table">
              <thead>
                <tr>
                  <th>Bier</th>
                  <th>Aantal</th>
                  <th>Weergave</th>
                  <th>Kostprijs</th>
                  <th>Verkoopprijs</th>
                  <th>Verkoopprijs actie</th>
                  <th>Totaal</th>
                  <th className="cpq-table-action-cell" aria-label="Acties" />
                </tr>
              </thead>
              <tbody>
                {scenario.products.map((product) => {
                  const productRef = getProductRef(product);
                  const pricing = metrics.pricingByRef[productRef];
                  const display =
                    unitMode === "liters"
                      ? `${(product.qty * product.litersPerUnit).toFixed(1)} L`
                      : `${product.qty} ${product.unit}`;
                  const vatFactor =
                    vatMode === "incl" ? 1 + Math.max(0, clampNumber(product.vatRatePct, 0)) / 100 : 1;
                  const baseUnitPriceEx = pricing?.baseUnitPriceEx ?? product.standardPriceEx;
                  const offerUnitPriceEx = pricing?.offerUnitPriceEx ?? product.standardPriceEx;
                  const costUnitPrice = product.costPriceEx * vatFactor;
                  const baseUnitPrice = baseUnitPriceEx * vatFactor;
                  const offerUnitPrice = offerUnitPriceEx * vatFactor;
                  const totalPrice = product.qty * offerUnitPriceEx * vatFactor;
                  const qtyInputValue =
                    unitMode === "liters" ? product.qty * product.litersPerUnit : product.qty;

                  return (
                    <tr key={product.id}>
                      <td>
                        <select
                          className="cpq-select"
                          value={
                            product.source?.bier_id && product.source?.product_id
                              ? `beer:${product.source.bier_id}:product:${product.source.product_id}`
                              : ""
                          }
                          onChange={(e) => onSelectRowOption(product.id, e.target.value)}
                        >
                          <option value="">Kies product…</option>
                          {productOptions.map((opt) => (
                            <option key={opt.optionId} value={opt.optionId}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={Number.isFinite(qtyInputValue) ? qtyInputValue : 0}
                          onChange={(e) => {
                            const raw = Math.max(0, clampNumber(e.target.value, 0));
                            if (unitMode === "liters") {
                              const litersPerUnit = Math.max(0, clampNumber(product.litersPerUnit, 0));
                              const nextQty = litersPerUnit > 0 ? raw / litersPerUnit : 0;
                              updateProduct(product.id, { qty: nextQty });
                              return;
                            }
                            updateProduct(product.id, { qty: raw });
                          }}
                          className="cpq-input cpq-input-small"
                        />
                      </td>
                      <td className="cpq-muted">{display}</td>
                      <td>{euro(costUnitPrice)}</td>
                      <td>{euro(baseUnitPrice)}</td>
                      <td>{euro(offerUnitPrice)}</td>
                      <td className="cpq-strong">{euro(totalPrice)}</td>
                      <td className="cpq-table-action-cell">
                        <button
                          type="button"
                          className="cpq-icon-action"
                          onClick={() => removeProductRow(product.id)}
                          aria-label={`Verwijder ${product.name || "productregel"}`}
                          title="Verwijderen"
                        >
                          <IconTrash />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {scenario.products.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="cpq-empty">
                      Nog geen producten toegevoegd.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="cpq-card">
          <div className="cpq-card-header">
            <div>
              <h3 className="cpq-card-title">Basisofferte</h3>
              <p className="cpq-card-subtitle">
                Dit voorstel gebruikt de productscope uit {standardPricingBlock?.type?.toLowerCase() ?? "de pricingactie"} in plaats van de basisofferte.
              </p>
            </div>
          </div>
          <div className="cpq-alert">
            De producten in de basisofferte zijn in dit voorstel niet leidend voor de actieve pricingactie.
            Pas de productscope aan in de {standardPricingBlock?.type?.toLowerCase() ?? "pricingactie"}-kaart.
          </div>
        </section>
      )}

      <div className="cpq-stack">
        {hasIntro ? (
          <section className="cpq-card">
            <div className="cpq-card-header">
              <div>
                <h3 className="cpq-card-title">Introductie</h3>
                <p className="cpq-card-subtitle">
                  Deze periode staat boven de standaardperiode en loopt tijdelijk mee.
                </p>
              </div>
            </div>
            <div className="cpq-stack">
              {introBlocks.map((block) => (
                <BuilderBlockCard key={block.id} block={block} onEdit={editOption} onRemove={removeBlock} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="cpq-card">
          <div className="cpq-card-header">
            <div>
              <h3 className="cpq-card-title">Standaardperiode</h3>
              <p className="cpq-card-subtitle">
                {hasIntro
                  ? "Na de introductie gelden automatisch de standaardprijzen en voorwaarden. Extra afspraken kun je hieronder toevoegen."
                  : "Hier gelden de standaardprijzen en voorwaarden van de offerte."}
              </p>
            </div>
          </div>

          <div className="cpq-stack">
            <section className="cpq-block tone-neutral">
              <div className="cpq-block-row">
                <div className="cpq-block-body">
                  <div className="cpq-block-title">Standaardafspraken</div>
                  <div className="cpq-block-subtitle">{hasIntro ? "Na de introductie" : "Direct actief"}</div>
                  <ul className="cpq-block-list">
                    <li>Standaardprijzen uit verkoopstrategie blijven van toepassing.</li>
                    <li>Standaardvoorwaarden blijven gelden totdat extra afspraken worden toegevoegd.</li>
                  </ul>
                </div>
              </div>
            </section>

            {standardBlocks.map((block) => (
              <BuilderBlockCard key={block.id} block={block} onEdit={editOption} onRemove={removeBlock} />
            ))}

            {standardBlocks.length === 0 && globalBlocks.length === 0 ? (
              <div className="cpq-empty">Nog geen extra afspraken toegevoegd.</div>
            ) : null}
          </div>
        </section>

        {globalBlocks.length > 0 ? (
          <section className="cpq-card">
            <div className="cpq-card-header">
              <div>
                <h3 className="cpq-card-title">Quotebrede afspraken</h3>
                <p className="cpq-card-subtitle">
                  Deze afspraken gelden bovenop de standaardperiode.
                </p>
              </div>
            </div>
            <div className="cpq-stack">
              {globalBlocks.map((block) => (
                <BuilderBlockCard key={block.id} block={block} onEdit={editOption} onRemove={removeBlock} />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <div className="cpq-actions cpq-actions-split">
        <button onClick={onSave} className="cpq-button cpq-button-secondary" type="button" disabled={isSaving}>
          {isSaving ? "Opslaan..." : "Opslaan"}
        </button>
        <button onClick={onNext} className="cpq-button cpq-button-primary" type="button">
          Verder naar vergelijken
        </button>
      </div>
    </div>
  );
}

function BuilderBlockCard({
  block,
  onEdit,
  onRemove,
}: {
  block: BuilderBlock;
  onEdit: (block: BuilderBlock) => void;
  onRemove: (blockId: string) => void;
}) {
  return (
    <section className={`cpq-block ${block.tone}`}>
      <div className="cpq-block-row">
        <div className="cpq-block-icon">{block.icon}</div>
        <div className="cpq-block-body">
          <div className="cpq-block-title">{block.title}</div>
          <div className="cpq-block-subtitle">{block.subtitle}</div>
          <ul className="cpq-block-list">
            {block.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {block.impact ? <div className="cpq-block-impact">{block.impact}</div> : null}
        </div>
        <div className="cpq-block-actions">
          <button type="button" className="cpq-button cpq-button-secondary" onClick={() => onEdit(block)}>
            Bewerken
          </button>
          <button type="button" className="cpq-button cpq-button-secondary" onClick={() => onRemove(block.id)}>
            Verwijderen
          </button>
        </div>
      </div>
    </section>
  );
}
function CompareStep({
  scenarios,
  metrics,
  activeScenario,
  setActiveScenario,
  onNext,
  onBack,
  onSave,
  isSaving,
}: {
  scenarios: Record<ScenarioId, Scenario>;
  metrics: Record<ScenarioId, { standard: ScenarioMetrics; intro: ScenarioMetrics | null }>;
  activeScenario: ScenarioId;
  setActiveScenario: (id: ScenarioId) => void;
  onNext: () => void;
  onBack: () => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  return (
    <section className="cpq-card">
      <div className="cpq-card-header">
        <div>
          <h2 className="cpq-card-title">Vergelijken</h2>
          <p className="cpq-card-subtitle">Vergelijk voorstellen zonder verborgen aannames: we tonen standaard en (optioneel) introductie apart.</p>
        </div>
      </div>

      <div className="cpq-compare-grid">
        {(["A", "B", "C"] as ScenarioId[]).map((id) => {
          const active = activeScenario === id;
          const m = metrics[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveScenario(id)}
              className={`cpq-compare-card${active ? " active" : ""}`}
            >
              <div className="cpq-compare-title">
                <span>{scenarios[id].name}</span>
                {active ? <span className="cpq-badge">Actief</span> : null}
              </div>

              <div className="cpq-compare-section">
                <div className="cpq-compare-section-title">Standaard</div>
                <Metric label="Omzet" value={euro(m.standard.revenueEx)} />
                <Metric label="Kosten" value={euro(m.standard.costEx)} />
                <Metric label="Marge" value={`${Math.round(m.standard.marginPct)}%`} />
                <Metric
                  label="Break-even omzet"
                  value={m.standard.breakEvenCurrent === null ? "Niet ingesteld" : euro(m.standard.breakEvenCurrent)}
                />
                <Metric
                  label="Boven / onder BE"
                  value={m.standard.breakEvenProjected === null ? "-" : euro(m.standard.breakEvenProjected)}
                />
                <Metric
                  label="BE-dekking"
                  value={
                    m.standard.breakEvenCoveragePct === null
                      ? "Niet beschikbaar"
                      : `${Math.round(m.standard.breakEvenCoveragePct)}%`
                  }
                />
              </div>

              {m.intro ? (
                <div className="cpq-compare-section">
                  <div className="cpq-compare-section-title">Introductie</div>
                  <Metric label="Omzet" value={euro(m.intro.revenueEx)} />
                  <Metric label="Kosten" value={euro(m.intro.costEx)} />
                  <Metric label="Marge" value={`${Math.round(m.intro.marginPct)}%`} />
                  <Metric
                    label="Boven / onder BE"
                    value={m.intro.breakEvenProjected === null ? "-" : euro(m.intro.breakEvenProjected)}
                  />
                  <Metric
                    label="BE-dekking"
                    value={
                      m.intro.breakEvenCoveragePct === null
                        ? "Niet beschikbaar"
                        : `${Math.round(m.intro.breakEvenCoveragePct)}%`
                    }
                  />
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="cpq-actions cpq-actions-split">
        <button onClick={onBack} className="cpq-button cpq-button-secondary" type="button">
          Terug
        </button>
        <div className="cpq-actions-inline">
          <button onClick={onSave} className="cpq-button cpq-button-secondary" type="button" disabled={isSaving}>
            {isSaving ? "Opslaan..." : "Opslaan"}
          </button>
          <button onClick={onNext} className="cpq-button cpq-button-primary" type="button">
            Verder naar afronden
          </button>
        </div>
      </div>
    </section>
  );
}

function FinalizeStep({
  basis,
  scenario,
  metrics,
  draftStatus,
  onBack,
  onDownload,
  onSave,
  onFinalize,
  isSaving,
}: {
  basis: BasisData;
  scenario: Scenario;
  metrics: ScenarioMetrics;
  draftStatus: QuoteDraft["meta"]["status"];
  onBack: () => void;
  onDownload: () => void;
  onSave: () => void;
  onFinalize: () => void;
  isSaving: boolean;
}) {
  return (
    <section className="cpq-card">
      <div className="cpq-card-header">
        <div>
          <h2 className="cpq-card-title">Afronden</h2>
          <p className="cpq-card-subtitle">Export/document is nog niet geïmplementeerd. Dit is een technische stub voor toekomstige output.</p>
        </div>
      </div>

      <div className="cpq-final-grid">
        <div className="cpq-final-card">
          <h3 className="cpq-panel-title">Samenvatting</h3>
          <Metric label="Klant" value={basis.klantNaam || "—"} />
          <Metric label="Kanaal" value={basis.kanaal} />
          <Metric label="Voorstel" value={scenario.name} />
          <Metric label="Omzet (ex)" value={euro(metrics.revenueEx)} />
          <Metric label="Marge" value={`${Math.round(metrics.marginPct)}%`} />
          <Metric
            label="Break-even omzet"
            value={metrics.breakEvenCurrent === null ? "Niet ingesteld" : euro(metrics.breakEvenCurrent)}
          />
          <Metric
            label="Boven / onder BE"
            value={metrics.breakEvenProjected === null ? "-" : euro(metrics.breakEvenProjected)}
          />
          <Metric
            label="BE-dekking"
            value={
              metrics.breakEvenCoveragePct === null
                ? "Niet beschikbaar"
                : `${Math.round(metrics.breakEvenCoveragePct)}%`
            }
          />
        </div>
        <div className="cpq-final-card">
          <h3 className="cpq-panel-title">Opmerking</h3>
          <div className="cpq-panel-text">{basis.opmerking || "Geen opmerking."}</div>
          <div className="cpq-panel-text">
            Status: {draftStatus === "definitief" ? "Definitief" : "Concept"}
          </div>
        </div>
      </div>

      <div className="cpq-actions cpq-actions-split">
        <button onClick={onBack} className="cpq-button cpq-button-secondary" type="button">
          Terug
        </button>
        <div className="cpq-actions-inline">
          <button onClick={onSave} className="cpq-button cpq-button-secondary" type="button" disabled={isSaving}>
            {isSaving ? "Opslaan..." : "Opslaan"}
          </button>
          <button
            onClick={onFinalize}
            className="cpq-button cpq-button-secondary"
            type="button"
            disabled={isSaving || draftStatus === "definitief"}
          >
            {draftStatus === "definitief" ? "Al definitief" : "Definitief opslaan"}
          </button>
          <button onClick={onDownload} className="cpq-button cpq-button-primary" type="button">
            Concept downloaden (JSON stub)
          </button>
        </div>
      </div>
    </section>
  );
}


function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="cpq-field">
      <div className="cpq-label">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="cpq-input" />
    </label>
  );
}

function QuickCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="cpq-quick-label">{label}</div>
      <div className="cpq-quick-value">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="cpq-metric">
      <span className="cpq-muted">{label}</span>
      <span className="cpq-strong">{value}</span>
    </div>
  );
}

function LiveSummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="cpq-live-summary-metric">
      <div className="cpq-live-summary-metric-label">{label}</div>
      <div className="cpq-live-summary-metric-value">{value}</div>
    </div>
  );
}

function BaseIcon({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="cpq-icon"
      role="img"
      aria-label={title}
      focusable="false"
    >
      {children}
    </svg>
  );
}

function IconClock() {
  return (
    <BaseIcon title="Introductie">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5v5.0l3.2 2.0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </BaseIcon>
  );
}

function IconChart() {
  return (
    <BaseIcon title="Staffel">
      <path d="M6 18V10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 18V6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 18v-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 18.5h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </BaseIcon>
  );
}

function IconShuffle() {
  return (
    <BaseIcon title="Mix deal">
      <path d="M6 7h4l2.2 3.2L14.5 7H18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M18 7l-2 2m2-2l-2-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 17h4l2.2-3.2 2.3 3.2H18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M18 17l-2 2m2-2l-2-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </BaseIcon>
  );
}

function IconTag() {
  return (
    <BaseIcon title="Korting">
      <path d="M4.8 12.0l7.2 7.2c.4.4 1 .4 1.4 0l5.8-5.8c.4-.4.4-1 0-1.4L12 4.8H7.3c-.5 0-1 .2-1.3.6L4.3 7.1c-.3.3-.5.8-.5 1.3V12z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="8.3" cy="8.3" r="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </BaseIcon>
  );
}

function IconStorefront() {
  return (
    <BaseIcon title="Groothandel">
      <path
        d="M5.2 10.2h13.6v8.3H5.2zm1-4.5h11.6l1 3.3H5.2zm3.1 8.1v4.7m5.4-4.7v4.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  );
}

function IconTrash() {
  return (
    <BaseIcon title="Verwijderen">
      <path
        d="M8 7h8m-7 0V5.8c0-.44.36-.8.8-.8h4.4c.44 0 .8.36.8.8V7m-8.4 0-.6 10.2c-.03.46.34.84.8.84h8.8c.46 0 .83-.38.8-.84L16.4 7M10 10.2v4.8M14 10.2v4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  );
}

function IconTruck() {
  return (
    <BaseIcon title="Transport">
      <path d="M3.8 15.5V7.5h9.5v8.0H3.8z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13.3 10.0h3.7l2.2 2.6v2.9h-5.9V10z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="7.1" cy="16.8" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="16.8" cy="16.8" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </BaseIcon>
  );
}

function IconReturn() {
  return (
    <BaseIcon title="Retour">
      <path d="M9.5 8.2L6 11.8l3.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 11.8h8.4c2.7 0 4.6 1.9 4.6 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </BaseIcon>
  );
}

function IconBeer() {
  return (
    <BaseIcon title="Proeverij">
      <path d="M7.2 7.5h6.6v8.8c0 1.2-1 2.2-2.2 2.2H9.4c-1.2 0-2.2-1-2.2-2.2V7.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13.8 9.2h1.6c1.3 0 2.4 1.1 2.4 2.4s-1.1 2.4-2.4 2.4h-1.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7.2 7.5c0-1.2 1-2.2 2.2-2.2h2.2c1.2 0 2.2 1 2.2 2.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </BaseIcon>
  );
}

function IconTent() {
  return (
    <BaseIcon title="Tapverhuur">
      <path d="M4.5 18.5L12 5.8l7.5 12.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9.2 18.5V14.2c0-.6.5-1.1 1.1-1.1h3.4c.6 0 1.1.5 1.1 1.1v4.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </BaseIcon>
  );
}



