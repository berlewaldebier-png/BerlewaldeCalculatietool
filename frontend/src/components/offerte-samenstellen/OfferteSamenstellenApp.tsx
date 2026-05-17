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
import { calculateBreakEvenProgress } from "@/lib/breakEvenProgress";
import {
  buildRealizedBreakEvenRows,
  calculateBreakEvenV2Summary,
  type BreakEvenV2Summary,
  type RealizedSalesBySkuPayload,
} from "@/components/break-even-v2/breakEvenV2Utils";
import { resolvePricedLitersTotal } from "@/lib/dealContext";
import { WarningIcon } from "@/components/kostprijsbeheer/KostprijsBeheerParts";
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
import { HorizontalStepper } from "@/components/offerte-samenstellen/HorizontalStepper";
import { DealContextBar } from "@/components/offerte-samenstellen/DealContextBar";
import { BreakEvenProgressCard } from "@/components/offerte-samenstellen/sidebar/BreakEvenProgressCard";
import { QuoteImpactCard } from "@/components/offerte-samenstellen/sidebar/QuoteImpactCard";
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

type CustomerSalesSummary = {
  company_id: number;
  year: number;
  invoices_count: number;
  lines_count: number;
  revenue_ex: number;
  mapped_liters: number;
  mapped_lines: number;
  unmapped_lines: number;
  top_skus: Array<{
    sku_id: string;
    sku_name: string;
    units: number;
    revenue_ex: number;
    liters: number;
  }>;
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
  const [dealContext, setDealContext] = useState<QuoteDraft["dealContext"]>(() => createInitialQuoteDraft(year).dealContext);
  const [mixSource, setMixSource] = useState<QuoteDraft["mixSource"]>(() => createInitialQuoteDraft(year).mixSource);
  const [targetVolumeLiters, setTargetVolumeLiters] = useState<number | null>(() => createInitialQuoteDraft(year).targetVolumeLiters);
  const [agreementVolumeLiters, setAgreementVolumeLiters] = useState<number | null>(() => createInitialQuoteDraft(year).agreementVolumeLiters);
  const [pendingRequiredVolumeChange, setPendingRequiredVolumeChange] = useState<null | {
    kind: "update_product" | "remove_product";
    productId: string;
    patch?: Partial<QuoteProduct>;
    nextTotalLiters: number;
    requiredLiters: number;
    requiredField: "target" | "agreement";
  }>(null);
  const [realizedSales, setRealizedSales] = useState<RealizedSalesBySkuPayload | null>(null);
  const [realizedSalesError, setRealizedSalesError] = useState<string | null>(null);
  const [customerSummary, setCustomerSummary] = useState<CustomerSalesSummary | null>(null);
  const [customerSummaryError, setCustomerSummaryError] = useState<string | null>(null);
  const [isCustomerSummaryLoading, setIsCustomerSummaryLoading] = useState(false);

  useEffect(() => {
    const cid = basis.klantId ?? null;
    if (!cid) {
      setCustomerSummary(null);
      setCustomerSummaryError(null);
      setIsCustomerSummaryLoading(false);
      return;
    }
    const controller = new AbortController();
    async function loadSummary() {
      setIsCustomerSummaryLoading(true);
      setCustomerSummaryError(null);
      try {
        const response = await fetch(`/api/meta/customer-sales-summary?company_id=${cid}&year=${currentYear}`, {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = typeof (payload as any)?.detail === "string" ? (payload as any).detail : response.statusText;
          throw new Error(detail || "Klant snapshot laden faalde.");
        }
        const result = (payload as any)?.result as CustomerSalesSummary | undefined;
        if (!controller.signal.aborted) setCustomerSummary(result ?? null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setCustomerSummary(null);
        setCustomerSummaryError(err instanceof Error ? err.message : "Klant snapshot laden faalde.");
      } finally {
        if (!controller.signal.aborted) setIsCustomerSummaryLoading(false);
      }
    }
    void loadSummary();
    return () => controller.abort();
  }, [basis.klantId, currentYear]);

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

  const realizedBreakEvenRows = useMemo(() => {
    if (!realizedSales) return null;
    const channelCode = breakEvenChannelCode || "horeca";
    return buildRealizedBreakEvenRows({
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
  ]);

  const breakEvenV2Summary = useMemo<BreakEvenV2Summary | null>(() => {
    if (!realizedBreakEvenRows) return null;

    const fixedCostsTotal = calculateFixedCostsTotal(vasteKosten, breakEvenYear);
    return calculateBreakEvenV2Summary({
      year: breakEvenYear,
      fixedCostsTotal,
      fixedCostAdjustment: 0,
      adjustments: [],
      rows: realizedBreakEvenRows.rows,
      totalSoldLiters: realizedBreakEvenRows.totalSoldLiters,
    });
  }, [
    realizedBreakEvenRows,
    breakEvenYear,
    vasteKosten,
  ]);

  const portfolioMixPctByRef = useMemo(() => {
    const out: Record<string, number> = {};
    (realizedBreakEvenRows?.rows ?? []).forEach((row) => {
      const skuId = String(row.skuId ?? "").trim();
      if (!skuId) return;
      if (row.kind !== "liter") return;
      out[`sku:${skuId}`] = Number.isFinite(row.mixPct) ? row.mixPct : 0;
    });
    return out;
  }, [realizedBreakEvenRows]);

  const customerMixPctByRef = useMemo(() => {
    const out: Record<string, number> = {};
    const top = customerSummary?.top_skus ?? [];
    const total = top.reduce((sum, row) => sum + (Number(row.liters ?? 0) || 0), 0);
    if (total <= 0) return out;
    top.forEach((row) => {
      const skuId = String(row.sku_id ?? "").trim();
      if (!skuId) return;
      const liters = Number(row.liters ?? 0) || 0;
      if (liters <= 0) return;
      out[`sku:${skuId}`] = (liters / total) * 100;
    });
    return out;
  }, [customerSummary]);

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
    if (!scenario) return null;

    const labelByRef = new Map<string, string>();
    productIndex.options.forEach((opt) => {
      const ref = String((opt as any)?.ref ?? "").trim();
      const label = String((opt as any)?.label ?? "").trim();
      if (ref && label) labelByRef.set(ref, label);
    });

    const baseline = calculateQuoteScenarioLines({ scenario, activePeriod: "standard", includeBlocks: false }).lines;
    const current = calculateQuoteScenarioLines({ scenario, activePeriod: "standard", includeBlocks: true }).lines;

    const activeStandardPricingBlock = scenario.blocks.find((block) => {
      const scope = (block.appliesTo ?? "standard") as any;
      if (scope !== "standard" && scope !== "global") return false;
      return block.type === "Korting" || block.type === "Groothandel";
    });

    const pricingPayload = (activeStandardPricingBlock?.payload ?? {}) as any;

    const eligibleRefs = Array.isArray(pricingPayload.eligibleRefs)
      ? new Set((pricingPayload.eligibleRefs as any[]).map(String))
      : new Set<string>();

    const selectionLitersByRef = new Map<string, number>();
    for (const line of current) {
      if (eligibleRefs.size > 0 && !eligibleRefs.has(line.ref)) continue;
      const liters = Math.max(0, (line.litersPerUnit ?? 0) * (line.qtyPaid ?? 0));
      if (liters > 0) selectionLitersByRef.set(line.ref, liters);
    }
    const selectionLitersTotal = Array.from(selectionLitersByRef.values()).reduce((sum, v) => sum + v, 0);

    const customerBaselineLiters = Math.max(0, customerSummary?.mapped_liters ?? 0);

    const pricedLitersTotal = resolvePricedLitersTotal({
      dealContext,
      selectionLitersTotal,
      customerBaselineLiters,
      targetVolumeLiters: typeof targetVolumeLiters === "number" ? targetVolumeLiters : null,
      agreementVolumeLiters: typeof agreementVolumeLiters === "number" ? agreementVolumeLiters : null,
    });
    const existingLitersTotal =
      selectionLitersTotal > 0 && dealContext === "one_off"
        ? Math.min(customerBaselineLiters, selectionLitersTotal)
        : 0;
    const upliftLitersTotal =
      selectionLitersTotal > 0 && dealContext === "one_off"
        ? Math.max(0, selectionLitersTotal - customerBaselineLiters)
        : 0;

    const baselineByRef = new Map(baseline.map((line) => [line.ref, line]));
    let pricePressureVsReferenceEx = 0;
    const impacts = current
      .map((line) => {
        const base = baselineByRef.get(line.ref);
        if (!base) return null;

        const baseContributionUnit = Math.max(0, (base.baseUnitPriceEx ?? 0) - (base.costPriceEx ?? 0));
        const scenarioContributionUnit = Math.max(0, (line.offerUnitPriceEx ?? 0) - (line.costPriceEx ?? 0));

        const qtyPaid = Math.max(0, line.qtyPaid ?? 0);
        const litersPerUnit = Math.max(0, line.litersPerUnit ?? 0);
        const share = selectionLitersTotal > 0 ? (selectionLitersByRef.get(line.ref) ?? 0) / selectionLitersTotal : 0;

        const existingLitersForLine = existingLitersTotal > 0 && share > 0 ? existingLitersTotal * share : 0;
        const upliftLitersForLine = upliftLitersTotal > 0 && share > 0 ? upliftLitersTotal * share : 0;
        const pricedLitersForLine = pricedLitersTotal > 0 && share > 0 ? pricedLitersTotal * share : 0;

        const existingQtyForLine = existingLitersForLine > 0 && litersPerUnit > 0 ? existingLitersForLine / litersPerUnit : 0;
        const upliftQtyForLine = upliftLitersForLine > 0 && litersPerUnit > 0 ? upliftLitersForLine / litersPerUnit : 0;
        const pricedQtyForLine = pricedLitersForLine > 0 && litersPerUnit > 0 ? pricedLitersForLine / litersPerUnit : 0;

        const lostContributionEx =
          existingQtyForLine > 0
            ? Math.max(0, (baseContributionUnit - scenarioContributionUnit) * existingQtyForLine)
            : 0;
        const gainedContributionEx = pricedQtyForLine > 0 ? Math.max(0, scenarioContributionUnit * pricedQtyForLine) : 0;
        const netContributionEx = gainedContributionEx - lostContributionEx;

        if (dealContext === "agreement" && pricedQtyForLine > 0) {
          pricePressureVsReferenceEx += (baseContributionUnit - scenarioContributionUnit) * pricedQtyForLine;
        }

        const shouldRender = Math.abs(lostContributionEx) > 0.0001 || Math.abs(gainedContributionEx) > 0.0001;
        if (!shouldRender) return null;

        const extraUnits =
          scenarioContributionUnit > 0 && lostContributionEx > 0
            ? lostContributionEx / scenarioContributionUnit
            : lostContributionEx > 0
              ? Number.POSITIVE_INFINITY
              : 0;
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
          gainedContributionEx,
          netContributionEx,
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
      gainedContributionEx: number;
      netContributionEx: number;
      extraUnits: number;
      extraLiters: number | null;
    }>;

    const totalLostContributionEx = impacts.reduce((sum, row) => sum + row.lostContributionEx, 0);
    const totalGainedContributionEx = impacts.reduce((sum, row) => sum + row.gainedContributionEx, 0);
    const netContributionEx = totalGainedContributionEx - totalLostContributionEx;
    const weightedContributionPerLiter = breakEvenV2Summary.weightedContributionPerLiter;
    const portfolioExtraLiters =
      weightedContributionPerLiter > 0 && netContributionEx < 0
        ? Math.abs(netContributionEx) / weightedContributionPerLiter
        : 0;

    const discountEffectLitersEquivalent =
      breakEvenV2Summary.weightedContributionPerLiter > 0
        ? totalLostContributionEx / breakEvenV2Summary.weightedContributionPerLiter
        : 0;

    const growthFromDealLiters =
      dealContext === "growth"
        ? Math.max(0, pricedLitersTotal)
        : dealContext === "agreement"
          ? Math.max(0, pricedLitersTotal)
          : Math.max(0, upliftLitersTotal);

    return {
      impacts,
      totalLostContributionEx,
      totalGainedContributionEx,
      netContributionEx,
      portfolioExtraLiters,
      discountEffectLitersEquivalent,
      growthFromDealLiters,
      existingLitersTotal,
      upliftLitersTotal,
      pricedLitersTotal,
      pricePressureVsReferenceEx,
    };
  }, [breakEvenV2Summary, scenario, productIndex.options, customerSummary, dealContext, targetVolumeLiters, agreementVolumeLiters]);

  const breakEvenProgress = useMemo(() => {
    if (!breakEvenV2Summary) return null;

    const growthFromDealLiters = Math.max(0, offerBreakEvenImpact?.growthFromDealLiters ?? 0);
    const discountEffectLitersEquivalent = Math.max(
      0,
      offerBreakEvenImpact?.discountEffectLitersEquivalent ?? 0
    );
    const transportCostEx = Math.max(
      0,
      scenarioMetrics[activeScenario]?.standard?.transportCostEx ?? 0
    );
    const transportEffectLitersEquivalent =
      breakEvenV2Summary.weightedContributionPerLiter > 0
        ? transportCostEx / breakEvenV2Summary.weightedContributionPerLiter
        : 0;

    return calculateBreakEvenProgress({
      breakEvenTargetLiters: breakEvenV2Summary.breakEvenLiters,
      alreadySoldLitersYtd: breakEvenV2Summary.totalSoldLiters,
      customerAlreadyBoughtLiters: customerSummary?.mapped_liters ?? null,
      growthFromDealLiters,
      discountEffectLitersEquivalent,
      transportEffectLitersEquivalent,
    });
  }, [breakEvenV2Summary, offerBreakEvenImpact, customerSummary, scenarioMetrics, activeScenario]);

  function SummaryMetric({ label, value }: { label: string; value: string }) {
    return (
      <div className="cpq-intro-summary-metric">
        <div className="cpq-intro-summary-metric-label">{label}</div>
        <div className="cpq-intro-summary-metric-value">{value}</div>
      </div>
    );
  }

  function MixSourceBar() {
    const hasCustomerMix = Object.keys(customerMixPctByRef).length > 0;
    return (
      <div className="cpq-card" style={{ padding: 14 }}>
        <div className="cpq-label" style={{ marginBottom: 8 }}>
          Mix voor berekening
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className={`cpq-toggle${mixSource === "quote" ? " active" : ""}`}
            onClick={() => setMixSource("quote")}
            title="Gebruik de verdeling van de producten in deze offerte."
          >
            Quote-mix
          </button>
          <button
            type="button"
            className={`cpq-toggle${mixSource === "customer" ? " active" : ""}`}
            onClick={() => setMixSource("customer")}
            title={hasCustomerMix ? "Gebruik de historische klantmix." : "Geen klantmix beschikbaar; valt terug op portfolio."}
          >
            Klantmix
          </button>
          {mixSource === "customer" && !hasCustomerMix ? (
            <span
              title="Geen klantmix beschikbaar; we vallen per product terug op portfolio mix."
              style={{ color: "#d97706", display: "inline-flex", alignItems: "center" }}
            >
              <WarningIcon />
            </span>
          ) : null}
          <button
            type="button"
            className={`cpq-toggle${mixSource === "portfolio" ? " active" : ""}`}
            onClick={() => setMixSource("portfolio")}
            title="Gebruik de totale portfolio mix (gerealiseerd)."
          >
            Portfolio-mix
          </button>
          <span className="cpq-muted" style={{ marginLeft: 6 }}>
            Percentages zijn informatief en sturen de berekening alleen als je geen productspecificatie hebt.
          </span>
        </div>
      </div>
    );
  }

  function updateProduct(productId: string, patch: Partial<QuoteProduct>) {
    setScenarios((prev) => {
      const current = prev[activeScenario];
      const required = getRequiredTotalLiters();
      if (!required) {
        return {
          ...prev,
          [activeScenario]: {
            ...current,
            products: current.products.map((p) => (p.id === productId ? { ...p, ...patch } : p)),
          },
        };
      }

      const nextProducts = current.products.map((p) => (p.id === productId ? { ...p, ...patch } : p));
      const nextTotalLiters = calculateScenarioTotalLiters(nextProducts);
      if (nextTotalLiters + 1e-6 < required.requiredLiters) {
        setPendingRequiredVolumeChange({
          kind: "update_product",
          productId,
          patch,
          nextTotalLiters,
          requiredLiters: required.requiredLiters,
          requiredField: required.requiredField,
        });
        return prev;
      }

      return {
        ...prev,
        [activeScenario]: {
          ...current,
          products: nextProducts,
        },
      };
    });
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
            roundingMode: "none",
            standardPriceEx: 0,
            costPriceEx: 0,
            vatRatePct: 0,
          },
        ],
      },
    }));
  }

  function removeProductRow(productId: string) {
    setScenarios((prev) => {
      const current = prev[activeScenario];
      const nextProducts = current.products.filter((product) => product.id !== productId);
      const required = getRequiredTotalLiters();

      if (!required) {
        return {
          ...prev,
          [activeScenario]: {
            ...current,
            products: nextProducts,
          },
        };
      }

      const nextTotalLiters = calculateScenarioTotalLiters(nextProducts);
      if (nextTotalLiters + 1e-6 < required.requiredLiters) {
        setPendingRequiredVolumeChange({
          kind: "remove_product",
          productId,
          nextTotalLiters,
          requiredLiters: required.requiredLiters,
          requiredField: required.requiredField,
        });
        return prev;
      }

      return {
        ...prev,
        [activeScenario]: {
          ...current,
          products: nextProducts,
        },
      };
    });
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
    const resolvedUnit =
      option.salesUnitLabel === "doos" || option.salesUnitLabel === "fust" || option.salesUnitLabel === "fles" || option.salesUnitLabel === "stuk"
        ? option.salesUnitLabel
        : inferUnitFromPack(option.packLabel);
    updateProduct(rowId, {
      name: option.bierName,
      pack: option.packLabel,
      litersPerUnit: option.litersPerUnit,
      unit: resolvedUnit,
      unitsPerLayer: option.unitsPerLayer ?? null,
      unitsPerPallet: option.unitsPerPallet ?? null,
      contributesToLiters: option.contributesToLiters ?? undefined,
      contributesToMargin: option.contributesToMargin ?? undefined,
      standardPriceEx: option.standardPriceEx,
      standardPriceYear: option.standardPriceYear,
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

  const mixPricing = useMemo(() => {
    const sellInPerLiter = Math.max(0, breakEvenV2Summary?.weightedSellInPerLiter ?? 0);
    const contributionPerLiter = Math.max(0, breakEvenV2Summary?.weightedContributionPerLiter ?? 0);
    const costPerLiter = Math.max(0, sellInPerLiter - contributionPerLiter);
    return { sellInPerLiter, costPerLiter };
  }, [breakEvenV2Summary]);

  function calculateScenarioTotalLiters(products: QuoteProduct[]) {
    return products.reduce((sum, product) => {
      if (product.contributesToLiters === false) return sum;
      const litersPerUnit = Math.max(0, product.litersPerUnit ?? 0);
      const qty = Math.max(0, product.qty ?? 0);
      if (litersPerUnit <= 0 || qty <= 0) return sum;
      return sum + litersPerUnit * qty;
    }, 0);
  }

  function getRequiredTotalLiters(): { requiredField: "target" | "agreement"; requiredLiters: number } | null {
    if (dealContext === "growth" && typeof targetVolumeLiters === "number") {
      return { requiredField: "target", requiredLiters: Math.max(0, targetVolumeLiters) };
    }
    if (dealContext === "agreement" && typeof agreementVolumeLiters === "number") {
      return { requiredField: "agreement", requiredLiters: Math.max(0, agreementVolumeLiters) };
    }
    return null;
  }

  function setMixLiters(nextLiters: number) {
    const liters = Math.max(0, clampNumber(nextLiters, 0));
    setScenarios((prev) => {
      const current = prev[activeScenario];
      const existing = current.products.find((p) => Boolean((p as any).isMixLiters));
      const withoutMix = current.products.filter((p) => !Boolean((p as any).isMixLiters));

      if (liters <= 0) {
        return {
          ...prev,
          [activeScenario]: {
            ...current,
            products: withoutMix,
          },
        };
      }

      const mixProduct = {
        id: existing?.id ?? "mix-liters",
        name: "Bier (mix)",
        pack: "Totaal liters",
        qty: liters,
        litersPerUnit: 1,
        unit: "liter" as any,
        isMixLiters: true,
        mixPackUnit: (existing as any)?.mixPackUnit ?? "doos",
        roundingMode: "none" as const,
        standardPriceEx: mixPricing.sellInPerLiter,
        costPriceEx: mixPricing.costPerLiter,
        vatRatePct: 21,
      };

      return {
        ...prev,
        [activeScenario]: {
          ...current,
          products: [mixProduct as any, ...withoutMix],
        },
      };
    });
  }

  function buildCurrentDraftSnapshot(nextMeta: QuoteDraft["meta"]) {
    const snapshotBreakEven = savedBreakEvenSnapshot ?? currentBreakEvenSnapshot;
    return buildQuoteDraftSnapshot({
      meta: nextMeta,
      year: currentYear,
      basis,
      dealContext,
      mixSource,
      targetVolumeLiters,
      agreementVolumeLiters,
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
    setBasis({
      ...createInitialBasisData(),
      ...(snapshot.basis ?? {}),
      klantId: typeof (snapshot.basis as any)?.klantId === "number" ? (snapshot.basis as any).klantId : null,
    });
    setDealContext((snapshot as any).dealContext === "growth" || (snapshot as any).dealContext === "agreement" ? (snapshot as any).dealContext : "one_off");
    setMixSource((snapshot as any).mixSource === "customer" || (snapshot as any).mixSource === "portfolio" ? (snapshot as any).mixSource : "quote");
    setTargetVolumeLiters(typeof (snapshot as any).targetVolumeLiters === "number" ? (snapshot as any).targetVolumeLiters : null);
    setAgreementVolumeLiters(typeof (snapshot as any).agreementVolumeLiters === "number" ? (snapshot as any).agreementVolumeLiters : null);
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

  function confirmLowerRequiredVolume() {
    const pending = pendingRequiredVolumeChange;
    if (!pending) return;

    if (pending.requiredField === "target") {
      setTargetVolumeLiters(pending.nextTotalLiters);
    } else {
      setAgreementVolumeLiters(pending.nextTotalLiters);
    }

    setScenarios((prev) => {
      const current = prev[activeScenario];
      if (pending.kind === "remove_product") {
        return {
          ...prev,
          [activeScenario]: {
            ...current,
            products: current.products.filter((product) => product.id !== pending.productId),
          },
        };
      }

      return {
        ...prev,
        [activeScenario]: {
          ...current,
          products: current.products.map((p) => (p.id === pending.productId ? { ...p, ...(pending.patch ?? {}) } : p)),
        },
      };
    });

    setPendingRequiredVolumeChange(null);
  }

  function cancelLowerRequiredVolume() {
    setPendingRequiredVolumeChange(null);
  }

  return (
    <div className="cpq-root">
      <div className="cpq-frame">
        {pendingRequiredVolumeChange ? (
          <div className="cpq-modal-backdrop" role="dialog" aria-modal="true">
            <div className="cpq-modal">
              <div className="cpq-modal-header">
                <div>
                  <div className="cpq-kicker">Controle</div>
                  <h3 className="cpq-modal-title">Volume aanpassen?</h3>
                </div>
                <button onClick={cancelLowerRequiredVolume} className="cpq-icon-button" type="button">
                  ×
                </button>
              </div>

              <div className="cpq-modal-body">
                <div className="cpq-alert cpq-alert-warn">
                  De som van het aantal liters in de offerte ({pendingRequiredVolumeChange.nextTotalLiters.toFixed(2)} L) is lager dan het{" "}
                  {pendingRequiredVolumeChange.requiredField === "target" ? "doelvolume" : "contractvolume"} ({pendingRequiredVolumeChange.requiredLiters.toFixed(2)} L).
                  <div style={{ marginTop: 8 }}>
                    Wil je het {pendingRequiredVolumeChange.requiredField === "target" ? "doelvolume" : "contractvolume"} verlagen naar het nieuwe totaal?
                  </div>
                </div>
              </div>

              <div className="cpq-modal-footer">
                <button type="button" className="cpq-button cpq-button-secondary" onClick={cancelLowerRequiredVolume}>
                  Annuleren
                </button>
                <button type="button" className="cpq-button" onClick={confirmLowerRequiredVolume}>
                  OK
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="cpq-topbar">
          <div>
            <h1 className="cpq-title">Offerte samenstellen</h1>
            <div className="cpq-muted" style={{ marginTop: 2 }}>
              Bouw offertes op basis van standaardprijzen en breid ze uit met introducties, staffels, mix deals en services.
            </div>
            <div style={{ marginTop: 10 }}>
              <HorizontalStepper
                steps={steps.map((item) => ({ id: item.id, title: item.title }))}
                activeId={step}
                onSelect={(id) => {
                  const next = steps.find((s) => s.id === id);
                  if (!next) return;
                  setStep(next.id);
                }}
              />
            </div>
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

        <div className="cpq-topbar" style={{ paddingTop: 0, borderTop: 0 }}>
          <div />
          <div className="cpq-topbar-actions">
            <div className="cpq-toggle-strip" role="group" aria-label="Voorstel">
              {(["A", "B", "C"] as const).map((id) => (
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

        {/* Layout override: offerte-samenstellen uses 2 columns (main + sidebar). */}
        <div className="cpq-grid cpq-grid-offerte">
          <main className="cpq-main">
            {step === "basis" ? (
              <BasisStep
                year={currentYear}
                basis={basis}
                setBasis={setBasis}
                customerSummary={customerSummary}
                customerSummaryError={customerSummaryError}
                isCustomerSummaryLoading={isCustomerSummaryLoading}
                onNext={() => setStep("builder")}
                onSave={() => void saveQuoteDraft()}
                isSaving={isSavingDraft || isLoadingDraft}
              />
            ) : null}

            {step === "builder" ? (
              <>
                <div
                  style={{
                    marginBottom: 12,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
                    gap: 12,
                    alignItems: "stretch",
                  }}
                >
                  <div style={{ height: "100%" }}>
                    <DealContextBar
                      value={dealContext}
                      onChange={setDealContext}
                      targetVolumeLiters={targetVolumeLiters}
                      onChangeTargetVolumeLiters={setTargetVolumeLiters}
                      agreementVolumeLiters={agreementVolumeLiters}
                      onChangeAgreementVolumeLiters={setAgreementVolumeLiters}
                    />
                  </div>
                  <div style={{ height: "100%" }}>
                    <MixSourceBar />
                  </div>
                </div>
                <BuilderStep
                  unitMode={unitMode}
                  vatMode={vatMode}
                  hasIntro={hasIntro}
                  quoteYear={currentYear}
                  scenario={scenario}
                  metrics={activeMetrics.standard}
                  dealContext={dealContext}
                  setDealContext={setDealContext}
                  mixSource={mixSource}
                  setMixSource={setMixSource}
                  customerMixPctByRef={customerMixPctByRef}
                  portfolioMixPctByRef={portfolioMixPctByRef}
                  targetVolumeLiters={targetVolumeLiters}
                  setTargetVolumeLiters={setTargetVolumeLiters}
                  agreementVolumeLiters={agreementVolumeLiters}
                  setAgreementVolumeLiters={setAgreementVolumeLiters}
                  mixLiters={
                    Math.max(
                      0,
                      scenario.products.find((p) => Boolean((p as any).isMixLiters))?.qty ?? 0
                    )
                  }
                  onChangeMixLiters={setMixLiters}
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
              </>
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
            {!breakEvenV2Summary || !breakEvenProgress ? (
              <div className="cpq-alert cpq-alert-warn">
                Break-even niet geladen.
                {realizedSalesError ? <div style={{ marginTop: "0.35rem" }}>{realizedSalesError}</div> : null}
              </div>
            ) : (
              <BreakEvenProgressCard
                breakEvenTargetLiters={breakEvenV2Summary.breakEvenLiters}
                alreadySoldLitersYtd={breakEvenV2Summary.totalSoldLiters}
                customerAlreadyBoughtLiters={Math.max(0, customerSummary?.mapped_liters ?? 0)}
                growthFromDealLiters={Math.max(0, offerBreakEvenImpact?.growthFromDealLiters ?? 0)}
                discountEffectLitersEquivalent={Math.max(0, offerBreakEvenImpact?.discountEffectLitersEquivalent ?? 0)}
                transportEffectLitersEquivalent={
                  breakEvenV2Summary.weightedContributionPerLiter > 0
                    ? Math.max(0, activeMetrics.standard.transportCostEx ?? 0) / breakEvenV2Summary.weightedContributionPerLiter
                    : 0
                }
                progressPct={breakEvenProgress.progressPct}
                newTotalProgressLiters={breakEvenProgress.newTotalProgressLiters}
                remainingLitersToBreakEven={breakEvenProgress.remainingLitersToBreakEven}
                theoreticalCurrentLiters={breakEvenV2Summary.breakEvenLiters}
                theoreticalDealLiters={null}
                theoreticalDeltaLiters={null}
              />
            )}

            <div style={{ marginTop: 14 }}>
              <QuoteImpactCard
                lostExistingEx={offerBreakEvenImpact?.totalLostContributionEx ?? 0}
                gainedGrowthEx={offerBreakEvenImpact?.totalGainedContributionEx ?? 0}
                transportEx={Math.max(0, activeMetrics.standard.transportCostEx ?? 0)}
                netEffectEx={
                  (offerBreakEvenImpact?.netContributionEx ?? 0) -
                  Math.max(0, activeMetrics.standard.transportCostEx ?? 0)
                }
                extraLitersNeeded={Math.max(0, offerBreakEvenImpact?.portfolioExtraLiters ?? 0)}
                dealContext={dealContext}
                pricePressureVsReferenceEx={offerBreakEvenImpact?.pricePressureVsReferenceEx ?? 0}
              />
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
            quoteYear={currentYear}
            onClose={closeOptionDialog}
            onSave={() => applyOptionToScenario(selectedOption)}
          />
        ) : null}
      </div>
    </div>
  );
}

