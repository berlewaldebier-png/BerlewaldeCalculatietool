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
  deleteQuoteDraft,
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
  calculateFixedCostsTotal,
  normalizeConfigList,
  type BreakEvenConfig,
  type BreakEvenResult,
} from "@/components/break-even/breakEvenUtils";
import {
  buildRealizedBreakEvenRows,
  calculateBreakEvenV2Summary,
  type BreakEvenV2Summary,
  type RealizedSalesBySkuPayload,
} from "@/components/break-even-v2/breakEvenV2Utils";
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
import { calculateQuoteScenarioLines } from "@/lib/quoteScenarioPricing";

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
  const [isDeletingDraft, setIsDeletingDraft] = useState(false);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [basis, setBasis] = useState<BasisData>(() => createInitialBasisData());
  const [realizedSales, setRealizedSales] = useState<RealizedSalesBySkuPayload | null>(null);
  const [realizedSalesError, setRealizedSalesError] = useState<string | null>(null);

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
    if (breakEvenConfigs.length === 0) return null;

    const activeCandidates = breakEvenConfigs.filter((config) => config.is_active_for_quotes);
    const candidates = activeCandidates.length > 0 ? activeCandidates : breakEvenConfigs;

    const sorted = [...candidates].sort((a, b) => {
      const yearDiff = (b.jaar ?? 0) - (a.jaar ?? 0);
      if (yearDiff !== 0) return yearDiff;
      const updatedA = String(a.updated_at ?? a.created_at ?? "");
      const updatedB = String(b.updated_at ?? b.created_at ?? "");
      if (updatedA && updatedB && updatedA !== updatedB) return updatedB.localeCompare(updatedA);
      return String(b.id ?? "").localeCompare(String(a.id ?? ""));
    });

    return sorted[0] ?? null;
  }, [breakEvenConfigs]);

  const breakEvenYear = activeBreakEvenConfig?.jaar ?? currentYear;
  const breakEvenChannelCode = (activeBreakEvenConfig?.active_channel ?? "horeca").toLowerCase();

  const breakEvenProductLines = useMemo(
    () =>
      buildBreakEvenProductLines({
        year: breakEvenYear,
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
      breakEvenYear,
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

  useEffect(() => {
    let cancelled = false;
    const basisMode = activeBreakEvenConfig?.basis ?? "invoice";
    setRealizedSalesError(null);

    fetch(`/api/integrations/douano/sales-by-sku?year=${breakEvenYear}&basis=${basisMode}`)
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }
        return (await response.json()) as { result?: RealizedSalesBySkuPayload };
      })
      .then((payload) => {
        if (cancelled) return;
        const result = payload?.result ?? null;
        setRealizedSales(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setRealizedSales(null);
        setRealizedSalesError(String(err?.message ?? err ?? "Onbekende fout"));
      });

    return () => {
      cancelled = true;
    };
  }, [breakEvenYear, activeBreakEvenConfig?.basis]);

  const breakEvenV2Summary = useMemo<BreakEvenV2Summary | null>(() => {
    if (!realizedSales) return null;
    const channelCode = breakEvenChannelCode || "horeca";
    const realized = buildRealizedBreakEvenRows({
      year: breakEvenYear,
      channelCode,
      sales: realizedSales,
      channels,
      bieren,
      kostprijsversies,
      kostprijsproductactiveringen,
      verkoopprijzen,
      skus,
      articles,
      basisproducten,
      samengesteldeProducten,
    });

    const fixedCostsTotal = calculateFixedCostsTotal(vasteKosten, breakEvenYear);
    return calculateBreakEvenV2Summary({
      year: breakEvenYear,
      fixedCostsTotal,
      fixedCostAdjustment: 0,
      adjustments: [],
      rows: realized.rows,
      totalSoldLiters: realized.totalSoldLiters,
    });
  }, [
    realizedSales,
    breakEvenChannelCode,
    breakEvenYear,
    channels,
    bieren,
    kostprijsversies,
    kostprijsproductactiveringen,
    verkoopprijzen,
    skus,
    articles,
    basisproducten,
    samengesteldeProducten,
    vasteKosten,
  ]);

  const currentBreakEvenSnapshot = useMemo(() => {
    if (!activeBreakEvenConfig) return null;
    return buildBreakEvenSnapshot(activeBreakEvenConfig, breakEvenResult);
  }, [activeBreakEvenConfig, breakEvenResult]);
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

  const offerBreakEvenImpact = useMemo(() => {
    if (!breakEvenV2Summary) return null;

    const labelByRef = new Map<string, string>();
    productIndex.options.forEach((opt) => {
      const ref = String((opt as any)?.ref ?? "").trim();
      const label = String((opt as any)?.label ?? "").trim();
      if (ref && label) labelByRef.set(ref, label);
    });

    const baseline = calculateQuoteScenarioLines({ scenario, activePeriod: "standard", includeBlocks: false }).lines;
    const current = calculateQuoteScenarioLines({ scenario, activePeriod: "standard", includeBlocks: true }).lines;

    const baselineByRef = new Map(baseline.map((line) => [line.ref, line]));
    const impacts = current
      .map((line) => {
        const base = baselineByRef.get(line.ref);
        if (!base) return null;

        const baseContributionUnit = Math.max(0, (base.baseUnitPriceEx ?? 0) - (base.costPriceEx ?? 0));
        const scenarioContributionUnit = Math.max(0, (line.offerUnitPriceEx ?? 0) - (line.costPriceEx ?? 0));

        const qtyPaid = Math.max(0, line.qtyPaid ?? 0);
        const lostContributionEx = Math.max(
          0,
          (baseContributionUnit - scenarioContributionUnit) * qtyPaid
        );

        const needsMore = lostContributionEx > 0.0001;
        if (!needsMore) return null;

        const extraUnits =
          scenarioContributionUnit > 0 ? lostContributionEx / scenarioContributionUnit : Number.POSITIVE_INFINITY;
        const litersPerUnit = Math.max(0, line.litersPerUnit ?? 0);
        const extraLiters = litersPerUnit > 0 && Number.isFinite(extraUnits) ? extraUnits * litersPerUnit : null;

        const label = labelByRef.get(line.ref) ?? line.ref;
        return {
          ref: line.ref,
          label,
          qtyPaid,
          baseUnitPriceEx: base.baseUnitPriceEx,
          offerUnitPriceEx: line.offerUnitPriceEx,
          costPriceEx: line.costPriceEx,
          lostContributionEx,
          extraUnits,
          extraLiters,
        };
      })
      .filter(Boolean) as Array<{
      ref: string;
      label: string;
      qtyPaid: number;
      baseUnitPriceEx: number;
      offerUnitPriceEx: number;
      costPriceEx: number;
      lostContributionEx: number;
      extraUnits: number;
      extraLiters: number | null;
    }>;

    const totalLostContributionEx = impacts.reduce((sum, row) => sum + row.lostContributionEx, 0);
    const weightedContributionPerLiter = breakEvenV2Summary.weightedContributionPerLiter;
    const portfolioExtraLiters =
      weightedContributionPerLiter > 0 ? totalLostContributionEx / weightedContributionPerLiter : null;

    return { impacts, totalLostContributionEx, portfolioExtraLiters };
  }, [breakEvenV2Summary, scenario, productIndex.options]);

  function SummaryMetric({ label, value }: { label: string; value: string }) {
    return (
      <div className="cpq-intro-summary-metric">
        <div className="cpq-intro-summary-metric-label">{label}</div>
        <div className="cpq-intro-summary-metric-value">{value}</div>
      </div>
    );
  }

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

  async function handleDeleteDraft() {
    if (isDeletingDraft) return;
    const draftId = draftMeta.draftId;
    if (!draftId) return;
    const confirmed = window.confirm("Offerte verwijderen? Dit kan niet ongedaan gemaakt worden.");
    if (!confirmed) return;
    setIsDeletingDraft(true);
    try {
      await deleteQuoteDraft(draftId);
      router.push("/prijsvoorstellen");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verwijderen mislukt.";
      setDraftError(message);
      setIsDeletingDraft(false);
    }
  }

  return (
    <div className="cpq-root">
      <div className="cpq-frame">
        <div className="cpq-topbar">
          <div>
            <div className="cpq-kicker">Offerte wizard</div>
            <h1 className="cpq-title">Offerte samenstellen</h1>
          </div>
          <div className="cpq-topbar-actions">
            <button
              type="button"
              className="cpq-button cpq-button-secondary"
              onClick={() => router.push("/prijsvoorstellen")}
            >
              Terug
            </button>
            <button
              type="button"
              className="cpq-icon-button"
              title={draftMeta.draftId ? "Offerte verwijderen" : "Sla eerst een offerte op om te kunnen verwijderen."}
              aria-label="Offerte verwijderen"
              onClick={() => void handleDeleteDraft()}
              disabled={!draftMeta.draftId || isDeletingDraft}
            >
              <IconTrash />
            </button>
            <span className="pill">{draftMeta.status === "definitief" ? "Definitief" : "Concept"}</span>
          </div>
        </div>

        <div className="cpq-topbar" style={{ marginTop: 12, paddingTop: 0, borderTop: 0 }}>
          <div />
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
                  value={
                    activeBreakEvenConfig
                      ? activeBreakEvenConfig.naam
                      : "Geen actieve versie"
                  }
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
            <div className="cpq-right-kicker">Break-even</div>
            {!breakEvenV2Summary ? (
              <div className="cpq-alert cpq-alert-warn">
                Break-even niet geladen.
                {realizedSalesError ? <div style={{ marginTop: "0.35rem" }}>{realizedSalesError}</div> : null}
              </div>
            ) : (
              <div className="cpq-intro-summary-card">
                <div className="cpq-intro-summary-grid">
                  <SummaryMetric label="Vaste kosten" value={euro(breakEvenV2Summary.adjustedFixedCostsTotal)} />
                  <SummaryMetric label="Gewogen contributie/L" value={euro(breakEvenV2Summary.weightedContributionPerLiter)} />
                  <SummaryMetric label="Break-even liters" value={`${Math.round(breakEvenV2Summary.breakEvenLiters).toLocaleString("nl-NL")} L`} />
                  <SummaryMetric label="Break-even omzet (bier)" value={euro(breakEvenV2Summary.breakEvenRevenue)} />
                  <SummaryMetric label="Margin of safety" value={euro(breakEvenV2Summary.marginOfSafetyEx)} />
                  <SummaryMetric label="Verkochte liters" value={`${Math.round(breakEvenV2Summary.totalSoldLiters).toLocaleString("nl-NL")} L`} />
                </div>
              </div>
            )}

            <div style={{ marginTop: "1rem" }}>
              <div className="cpq-right-kicker">Impact offerte</div>
              {!offerBreakEvenImpact ? (
                <div className="cpq-intro-summary-card">
                  <div className="cpq-muted">Selecteer producten om impact te zien.</div>
                </div>
              ) : offerBreakEvenImpact.impacts.length === 0 ? (
                <div className="cpq-intro-summary-card">
                  <div className="cpq-muted">Geen korting/toeslag impact t.o.v. standaardprijzen.</div>
                </div>
              ) : (
                <>
                  <div className="cpq-intro-summary-card">
                    <div className="cpq-intro-summary-grid">
                      <SummaryMetric label="Verlies contributie" value={euro(offerBreakEvenImpact.totalLostContributionEx)} />
                      <SummaryMetric
                        label="Extra liters (portfolio)"
                        value={
                          typeof offerBreakEvenImpact.portfolioExtraLiters === "number"
                            ? `${Math.round(offerBreakEvenImpact.portfolioExtraLiters).toLocaleString("nl-NL")} L`
                            : "—"
                        }
                      />
                    </div>
                  </div>

                  <div className="cpq-intro-summary-card" style={{ marginTop: "0.8rem" }}>
                    <div className="cpq-intro-card-title">Extra volume per product</div>
                    <div style={{ marginTop: "0.75rem" }}>
                      {offerBreakEvenImpact.impacts.map((row) => (
                        <div key={row.ref} className="cpq-impact-row">
                          <div className="cpq-impact-title">{row.label}</div>
                          <div className="cpq-impact-meta">
                            {row.extraUnits === Number.POSITIVE_INFINITY ? (
                              <span>Contributie per eenheid ≤ 0 bij actieprijs.</span>
                            ) : (
                              <span>
                                Extra nodig: {Math.ceil(row.extraUnits).toLocaleString("nl-NL")}
                                {row.extraLiters !== null ? ` (${Math.round(row.extraLiters).toLocaleString("nl-NL")} L)` : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
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

