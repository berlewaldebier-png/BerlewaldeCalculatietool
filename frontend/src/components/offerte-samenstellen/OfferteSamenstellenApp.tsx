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
  inferUnitFromPack,
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
import type {
  ProductOption,
  QuoteDraft,
  QuoteDraftSnapshot,
  QuoteFormState,
} from "@/components/offerte-samenstellen/types";

type GenericRecord = Record<string, unknown>;

type StepKey = "basis" | "builder" | "vergelijk" | "afronden";
type UnitMode = "producten" | "liters";
type VatMode = "incl" | "excl";
type ScenarioId = "A" | "B" | "C";

type QuoteChannel = "Horeca" | "Retail" | "Events";

type QuoteProduct = {
  id: string;
  name: string;
  pack: string;
  qty: number;
  litersPerUnit: number;
  unit: "fust" | "doos" | "fles";
  standardPriceEx: number;
  costPriceEx: number;
  vatRatePct: number;
  source?: {
    bier_id?: string;
    product_id?: string;
    kostprijsversie_id?: string;
  };
};

type OptionType =
  | "Intro"
  | "Staffel"
  | "Mix"
  | "Korting"
  | "Transport"
  | "Retour"
  | "Proeverij"
  | "Tapverhuur";

type ToolbarGroup = { title: string; items: Array<{ icon: React.ReactNode; label: OptionType }> };

type BuilderBlock = {
  id: string;
  type: OptionType;
  title: string;
  subtitle: string;
  lines: string[];
  tone: string;
  icon: React.ReactNode;
  impact?: string;
  appliesTo?: "intro" | "standard" | "global";
  // Minimal payload for v1 calculations. Kept explicit to avoid hidden magic.
  payload?: Record<string, unknown>;
};

type Scenario = {
  id: ScenarioId;
  name: string;
  // Products are the base quote lines for this scenario.
  products: QuoteProduct[];
  // Blocks represent pricing rules/services for this scenario.
  blocks: BuilderBlock[];
  note?: string;
  intro?: { start: string; end: string } | null;
};

type BasisData = {
  klantNaam: string;
  contactpersoon: string;
  kanaal: QuoteChannel;
  offerteNaam: string;
  geldigTot: string;
  opmerking: string;
};

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
  initialMode?: string;
  initialDraftId?: string | null;
};

const tones: Record<OptionType, string> = {
  Intro: "cpq-tone-intro",
  Staffel: "cpq-tone-staffel",
  Mix: "cpq-tone-mix",
  Korting: "cpq-tone-korting",
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

type ScenarioMetrics = {
  revenueEx: number;
  costEx: number;
  extraCostEx: number;
  transportCostEx: number;
  marginPct: number;
  breakEvenCurrent: number | null;
  breakEvenProjected: number | null;
  notes: string[];
};

/* function calculateScenarioMetrics(scenario: Scenario, activePeriod: "standard" | "intro"): ScenarioMetrics {
  const notes: string[] = [];

  const periodBlocks = scenario.blocks.filter(
    (b) => (b.appliesTo ?? "standard") === activePeriod || (b.appliesTo ?? "standard") === "global"
  );

  const staffelBlock = periodBlocks.find((b) => b.type === "Staffel");
  const discountBlock = periodBlocks.find((b) => b.type === "Korting");
  const mixBlock = periodBlocks.find((b) => b.type === "Mix");
  const returnBlock = periodBlocks.find((b) => b.type === "Retour");
  const introBlock = periodBlocks.find((b) => b.type === "Intro");

  if (introBlock) {
    // We capture intro config fully, but promo variants are still being expanded. Keep it explicit.
    notes.push("Introductieperiode: berekening is beperkt tot eenvoudige korting of X+Y gratis (v1).");
  }

  const lines = scenario.products
    .filter((p) => p.qty > 0)
    .map((p) => {
      const ref =
        p.source?.bier_id && p.source?.product_id
          ? `beer:${String(p.source.bier_id)}:product:${String(p.source.product_id)}`
          : p.id;
      return {
        ref,
        qtyPaid: Math.max(0, clampNumber(p.qty, 0)),
        unitPriceEx: Math.max(0, clampNumber(p.standardPriceEx, 0)),
        costPriceEx: Math.max(0, clampNumber(p.costPriceEx, 0)),
      };
    })
    .filter((row) => row.ref && row.qtyPaid > 0);

  if (lines.length === 0) {
    return {
      revenueEx: 0,
      costEx: 0,
      extraCostEx: 0,
      transportCostEx: 0,
      marginPct: 0,
      breakEvenCurrent: null,
      breakEvenProjected: null,
      notes,
    };
  }

  // 1) Determine unit prices, including staffel overrides.
  const unitPriceByRef = new Map<string, number>();
  for (const row of lines) unitPriceByRef.set(row.ref, row.unitPriceEx);

  if (staffelBlock) {
    const tiersRaw = Array.isArray(staffelBlock.payload?.tiers) ? (staffelBlock.payload?.tiers as any[]) : [];
    const eligible = new Set<string>(Array.isArray(staffelBlock.payload?.eligibleRefs) ? (staffelBlock.payload?.eligibleRefs as any[]).map(String) : []);
    if (tiersRaw.length === 0 || eligible.size === 0) {
      notes.push("Staffel is actief maar mist tiers/productselectie (v1).");
    } else {
      for (const row of lines) {
        if (!eligible.has(row.ref)) continue;
        const qty = row.qtyPaid;
        const tier = tiersRaw.find((t) => {
          const from = clampNumber(t?.from, 0);
          const to = t?.to === null || t?.to === undefined || String(t?.to).trim() === "" ? Number.POSITIVE_INFINITY : clampNumber(t?.to, Number.POSITIVE_INFINITY);
          return qty >= from && qty <= to;
        });
        const nextPrice = tier ? clampNumber((tier as any).priceEx, 0) : 0;
        if (nextPrice > 0) {
          unitPriceByRef.set(row.ref, nextPrice);
        }
      }
    }
  }

  // 2) Apply % discount (exclusive with staffel/mix in same context by guardrails).
  const discountPct = discountBlock ? clampNumber(discountBlock.payload?.discountPct, 0) : 0;
  const hasStaffel = Boolean(staffelBlock);
  const hasMix = Boolean(mixBlock);
  if (discountPct > 0 && (hasStaffel || hasMix)) {
    notes.push("Korting is genegeerd: korting is niet combineerbaar met staffel/mix in dezelfde periode.");
  } else if (discountPct > 0) {
    for (const row of lines) {
      const current = unitPriceByRef.get(row.ref) ?? row.unitPriceEx;
      unitPriceByRef.set(row.ref, applyDiscountPct(current, discountPct));
    }
  }

  // 3) Mix/X+Y gratis (implemented as cheapest-free allocation across eligible refs).
  let freeByRef = new Map<string, number>();
  if (mixBlock) {
    const requiredQty = clampNumber(mixBlock.payload?.requiredQty, 0);
    const freeQty = clampNumber(mixBlock.payload?.freeQty, 0);
    const eligibleRefs = Array.isArray(mixBlock.payload?.eligibleRefs) ? (mixBlock.payload?.eligibleRefs as any[]).map(String) : [];
    if (requiredQty <= 0 || freeQty <= 0) {
      notes.push("Mix deal mist geldige X+Y configuratie (v1).");
    } else {
      const rows = lines.map((row) => ({
        included: eligibleRefs.length === 0 ? true : eligibleRefs.includes(row.ref),
        ref: row.ref,
        qtyPaid: row.qtyPaid,
        unitPriceEx: unitPriceByRef.get(row.ref) ?? row.unitPriceEx,
      }));
      const { freeByRef: computed } = computeGratisFreeByRefFromPaidRows({
        rows,
        requiredQty,
        freeQty,
        eligibleRefs,
      });
      freeByRef = computed;
    }
  }

  // 4) Compute offer totals for product lines.
  let revenueEx = 0;
  let costEx = 0;
  for (const row of lines) {
    const unitPriceEx = unitPriceByRef.get(row.ref) ?? row.unitPriceEx;
    const freeQty = freeByRef.get(row.ref) ?? 0;
    if (freeQty > 0) {
      const totals = calcOfferLineTotalsWithGratis({
        kostprijsEx: row.costPriceEx,
        offerPriceEx: unitPriceEx,
        qty: row.qtyPaid,
        freeQty,
      });
      revenueEx += totals.omzet;
      costEx += totals.kosten;
      continue;
    }
    const totals = calcOfferLineTotals({
      kostprijsEx: row.costPriceEx,
      offerPriceEx: unitPriceEx,
      qty: row.qtyPaid,
      kortingPct: 0,
      feeExPerUnit: 0,
      retourPct: 0,
    });
    revenueEx += totals.omzet;
    costEx += totals.kosten;
  }

  // 5) Return/consignation (v1 conservative: reduce revenue only).
  const returnPct = returnBlock ? clampNumber(returnBlock.payload?.returnPct, 0) : 0;
  if (returnPct > 0) {
    const retourEur = revenueEx * Math.max(0, Math.min(100, returnPct)) / 100;
    revenueEx = Math.max(0, revenueEx - retourEur);
    notes.push("Retour-effect is conservatief: omzet wordt verlaagd, kosten blijven gelijk (v1).");
  }

  // 6) Transport and extras.
  let extraCostEx = 0;
  let transportCostEx = 0;
  for (const block of periodBlocks) {
    if (block.type === "Transport") {
      const charged = Boolean(block.payload?.chargedToCustomer ?? false);
      const amount = clampNumber(block.payload?.amountEx, 0);
      if (amount <= 0) continue;
      if (charged) revenueEx += amount;
      else transportCostEx += amount;
      continue;
    }

    if (block.type === "Proeverij" || block.type === "Tapverhuur") {
      const priceEx = clampNumber(block.payload?.priceEx, 0);
      const costLocal = clampNumber(block.payload?.costEx, 0);
      const isFree = Boolean(block.payload?.isFree ?? false);
      if (!isFree) revenueEx += priceEx;
      extraCostEx += costLocal;
      continue;
    }
  }

  costEx += extraCostEx + transportCostEx;
  const marginPct = revenueEx > 0 ? ((revenueEx - costEx) / revenueEx) * 100 : 0;

  return {
    revenueEx: Math.max(0, revenueEx),
    costEx: Math.max(0, costEx),
    extraCostEx,
    transportCostEx,
    marginPct,
    breakEvenCurrent: null,
    breakEvenProjected: null,
    notes,
  };
} */

export function OfferteSamenstellenApp({
  year,
  channels,
  bieren,
  kostprijsversies,
  kostprijsproductactiveringen,
  verkoopprijzen,
  basisproducten,
  samengesteldeProducten,
  initialMode,
  initialDraftId,
}: Props) {
  const router = useRouter();
  const [currentYear, setCurrentYear] = useState<number>(year);
  const [step, setStep] = useState<StepKey>("basis");
  const [activeScenario, setActiveScenario] = useState<ScenarioId>("A");
  const [unitMode, setUnitMode] = useState<UnitMode>("producten");
  const [vatMode, setVatMode] = useState<VatMode>("incl");
  const [draftMeta, setDraftMeta] = useState<QuoteDraft["meta"]>(() => createInitialQuoteDraft(year).meta);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [basis, setBasis] = useState<BasisData>(() => createInitialBasisData());

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
  ]);

  const [scenarios, setScenarios] = useState<Record<ScenarioId, Scenario>>(
    () => createInitialQuoteDraft(year).scenarios
  );

  const [selectedOption, setSelectedOption] = useState<OptionType | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  const [form, setForm] = useState<QuoteFormState>(() => createInitialQuoteFormState());
  const scenario = scenarios[activeScenario];
  const hasIntro = Boolean(scenario.intro && scenario.intro.start && scenario.intro.end);

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
    const result: Record<ScenarioId, { standard: ScenarioMetrics; intro: ScenarioMetrics | null }> = {
      A: { standard: calculateScenarioMetricsForScenario(scenarios.A, "standard"), intro: null },
      B: { standard: calculateScenarioMetricsForScenario(scenarios.B, "standard"), intro: null },
      C: { standard: calculateScenarioMetricsForScenario(scenarios.C, "standard"), intro: null },
    };
    for (const id of ids) {
      const sc = scenarios[id];
      result[id] = {
        standard: calculateScenarioMetricsForScenario(sc, "standard"),
        intro: sc.intro ? calculateScenarioMetricsForScenario(sc, "intro") : null,
      };
    }
    return result;
  }, [scenarios]);

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
      existingBlockId: editingBlockId,
    });

    setScenarios((prev) => {
      const existing = prev[activeScenario];

      // If no explicit product selection was captured for a pricing rule, default it to "all current product lines"
      // to avoid silent no-ops. This is an explicit v1 behavior (not hidden): the modal will show the selection later.
      if (type === "Staffel" || type === "Mix") {
        const payload = (block.payload ?? {}) as Record<string, unknown>;
        const eligibleRaw = Array.isArray(payload.eligibleRefs) ? (payload.eligibleRefs as unknown[]) : [];
        const eligible = eligibleRaw.map((r) => String(r ?? "")).filter(Boolean);
        if (eligible.length === 0) {
          const refs = (existing.products ?? [])
            .map((p) =>
              p.source?.bier_id && p.source?.product_id
                ? `beer:${String(p.source.bier_id)}:product:${String(p.source.product_id)}`
                : String(p.id ?? "")
            )
            .filter(Boolean);
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

  function duplicateScenario() {
    const base = scenarios[activeScenario];
    const targetId: ScenarioId = activeScenario === "A" ? "B" : activeScenario === "B" ? "C" : "A";
    setScenarios((prev) => ({
      ...prev,
      [targetId]: {
        ...base,
        id: targetId,
        name: `Scenario ${targetId}`,
        note: `Duplicaat van scenario ${activeScenario}`,
      },
    }));
    setActiveScenario(targetId);
    setStep("vergelijk");
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
    return buildQuoteDraftSnapshot({
      meta: nextMeta,
      year: currentYear,
      basis,
      scenarios,
      ui: {
        step,
        activeScenario,
        unitMode,
        vatMode,
      },
    });
  }

  function restoreScenarioPresentation(snapshot: QuoteDraftSnapshot): Record<ScenarioId, Scenario> {
    return {
      A: {
        ...snapshot.scenarios.A,
        blocks: snapshot.scenarios.A.blocks.map((block) => ({
          ...block,
          icon: icons[block.type] ?? null,
          tone: block.tone || tones[block.type],
        })),
      },
      B: {
        ...snapshot.scenarios.B,
        blocks: snapshot.scenarios.B.blocks.map((block) => ({
          ...block,
          icon: icons[block.type] ?? null,
          tone: block.tone || tones[block.type],
        })),
      },
      C: {
        ...snapshot.scenarios.C,
        blocks: snapshot.scenarios.C.blocks.map((block) => ({
          ...block,
          icon: icons[block.type] ?? null,
          tone: block.tone || tones[block.type],
        })),
      },
    };
  }

  function hydrateDraftSnapshot(snapshot: QuoteDraftSnapshot) {
    setCurrentYear(Number(snapshot.year || year) || year);
    setDraftMeta(snapshot.meta);
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
    setIsSavingDraft(true);
    setDraftError(null);
    try {
      const payload = buildQuotePersistencePayload(buildCurrentDraftSnapshot(draftMeta));
      const response = draftMeta.draftId
        ? await updateQuoteDraft(draftMeta.draftId, payload)
        : await createQuoteDraft(payload);
      const snapshot = response.record.payload?.draft;
      if (!snapshot) {
        throw new Error("Opslaan gaf geen geldige draft snapshot terug.");
      }
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
    { id: "builder", title: "Offerte maken", desc: "Producten, opties en scenario's" },
    { id: "vergelijk", title: "Vergelijken", desc: "Scenario's naast elkaar" },
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
            <button onClick={duplicateScenario} className="cpq-button cpq-button-secondary">
              Dupliceer scenario
            </button>
            <button
              className="cpq-button cpq-button-primary"
              type="button"
              onClick={() => void saveQuoteDraft()}
              disabled={isSavingDraft || isLoadingDraft}
            >
              {isSavingDraft ? "Opslaan..." : "Opslaan"}
            </button>
          </div>
        </div>

        {draftError ? <div className="cpq-alert cpq-alert-warn">{draftError}</div> : null}
        {isLoadingDraft ? <div className="cpq-alert">Offerte wordt geladen...</div> : null}

        <div className="cpq-grid">
          <aside className="cpq-left">
            <div className="cpq-left-title">Stappen</div>
            <div className="cpq-steps">
              {steps.map((item, idx) => {
                const active = item.id === step;
                const done = steps.findIndex((s) => s.id === step) > idx;
                return (
                  <button
                    key={item.id}
                    onClick={() => setStep(item.id)}
                    className={`cpq-step${active ? " active" : ""}${done ? " done" : ""}`}
                    type="button"
                  >
                    <div className="cpq-step-row">
                      <div className="cpq-step-dot">{done ? "✓" : idx + 1}</div>
                      <div>
                        <div className="cpq-step-title">{item.title}</div>
                        <div className="cpq-step-desc">{item.desc}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="cpq-quick">
              <div className="cpq-quick-title">Quick view</div>
              <div className="cpq-quick-grid">
                <QuickCell label="Klant" value={basis.klantNaam || "—"} />
                <QuickCell label="Kanaal" value={basis.kanaal} />
                <QuickCell label="Status" value={draftMeta.status === "definitief" ? "Definitief" : "Concept"} />
                <QuickCell label="Scenario" value={activeScenario} />
                <QuickCell label="Jaar" value={String(year)} />
                <QuickCell label="Versie" value={String(draftMeta.version)} />
                <QuickCell label="Bewaard" value={draftMeta.updatedAt ? new Date(draftMeta.updatedAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }) : "Nog niet"} />
              </div>
            </div>
          </aside>

          <main className="cpq-main">
            {step === "basis" ? (
              <BasisStep basis={basis} setBasis={setBasis} onNext={() => setStep("builder")} />
            ) : null}

            {step === "builder" ? (
              <BuilderStep
                unitMode={unitMode}
                vatMode={vatMode}
                hasIntro={hasIntro}
                scenario={scenario}
                activeScenario={activeScenario}
                setActiveScenario={setActiveScenario}
                updateProduct={updateProduct}
                addProductRow={addProductRow}
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
              />
            ) : null}

            {step === "afronden" ? (
              <FinalizeStep
                basis={basis}
                scenario={scenario}
                metrics={scenarioMetrics[activeScenario].standard}
                onBack={() => setStep("vergelijk")}
                onDownload={downloadQuoteStub}
              />
            ) : null}
          </main>

          <aside className="cpq-right">
            <h2 className="cpq-right-kicker">Live inzicht</h2>
            <div className="cpq-panel">
              <Kpi label="Omzet (ex)" value={euro(rightMetrics.revenueEx)} />
              <Kpi label="Kostprijs (ex)" value={euro(rightMetrics.costEx)} />
              <Kpi label="Transportkosten" value={rightMetrics.transportCostEx ? euro(rightMetrics.transportCostEx) : "—"} />
              <Kpi label="Extra kosten" value={rightMetrics.extraCostEx ? euro(rightMetrics.extraCostEx) : "—"} />
              <div className="cpq-divider" />
              <Kpi label="Netto marge" value={`${Math.round(rightMetrics.marginPct)}%`} strong />
            </div>

            <div className="cpq-panel cpq-panel-dark">
              <div className="cpq-panel-dark-title">
                <span>Break-even impact</span>
                <span className="cpq-pill">Placeholder</span>
              </div>
              <div className="cpq-panel-dark-body">
                <div className="cpq-kv"><span>Huidig</span><span>—</span></div>
                <div className="cpq-kv"><span>Na offerte</span><span>—</span></div>
                <div className="cpq-kv"><span>Impact</span><span className="cpq-accent">—</span></div>
              </div>
              <div className="cpq-panel-dark-note">
                Placeholder tot de juiste data beschikbaar is. Hier kan later break-even omzet of volume komen.
              </div>
            </div>

            <div className="cpq-panel">
              <h3 className="cpq-panel-title">Actieve scenario-notitie</h3>
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
}: {
  basis: BasisData;
  setBasis: React.Dispatch<React.SetStateAction<BasisData>>;
  onNext: () => void;
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

      <div className="cpq-actions">
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
  activeScenario,
  setActiveScenario,
  updateProduct,
  addProductRow,
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
}: {
  unitMode: UnitMode;
  vatMode: VatMode;
  hasIntro: boolean;
  scenario: Scenario;
  activeScenario: ScenarioId;
  setActiveScenario: (id: ScenarioId) => void;
  updateProduct: (productId: string, patch: Partial<QuoteProduct>) => void;
  addProductRow: () => void;
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
}) {
  const introBlocks = scenario.blocks.filter((block) => (block.appliesTo ?? "standard") === "intro");
  const standardBlocks = scenario.blocks.filter(
    (block) => (block.appliesTo ?? "standard") === "standard"
  );
  const globalBlocks = scenario.blocks.filter((block) => (block.appliesTo ?? "standard") === "global");

  return (
    <div className="cpq-stack">
      <div className="cpq-builder-header">
        <div>
          <h2 className="cpq-card-title">Offerte maken</h2>
          <p className="cpq-card-subtitle">
            Start simpel met producten en breid uit met blokken via de toolbar.
          </p>
        </div>
        <div className="cpq-toggle-strip" role="group" aria-label="Scenario">
          {(["A", "B", "C"] as ScenarioId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveScenario(id)}
              className={`cpq-toggle${activeScenario === id ? " active" : ""}`}
            >
              Scenario {id}
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
                <th>Verpakking</th>
                <th>Aantal</th>
                <th>Weergave</th>
                <th>Stukprijs</th>
                <th>Totaal</th>
              </tr>
            </thead>
            <tbody>
              {scenario.products.map((product) => {
                const display =
                  unitMode === "liters"
                    ? `${(product.qty * product.litersPerUnit).toFixed(1)} L`
                    : `${product.qty} ${product.unit}`;
                const vatFactor =
                  vatMode === "incl" ? 1 + Math.max(0, clampNumber(product.vatRatePct, 0)) / 100 : 1;
                const unitPrice = product.standardPriceEx * vatFactor;
                const totalPrice = product.qty * product.standardPriceEx * vatFactor;
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
                    <td className="cpq-muted">{product.pack || "—"}</td>
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
                    <td>{euro(unitPrice)}</td>
                    <td className="cpq-strong">{euro(totalPrice)}</td>
                  </tr>
                );
              })}
              {scenario.products.length === 0 ? (
                <tr>
                  <td colSpan={6} className="cpq-empty">
                    Nog geen producten toegevoegd.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

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

      <div className="cpq-actions">
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
}: {
  scenarios: Record<ScenarioId, Scenario>;
  metrics: Record<ScenarioId, { standard: ScenarioMetrics; intro: ScenarioMetrics | null }>;
  activeScenario: ScenarioId;
  setActiveScenario: (id: ScenarioId) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <section className="cpq-card">
      <div className="cpq-card-header">
        <div>
          <h2 className="cpq-card-title">Vergelijken</h2>
          <p className="cpq-card-subtitle">Vergelijk scenario's zonder verborgen aannames: we tonen standaard en (optioneel) introductie apart.</p>
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
              </div>

              {m.intro ? (
                <div className="cpq-compare-section">
                  <div className="cpq-compare-section-title">Introductie</div>
                  <Metric label="Omzet" value={euro(m.intro.revenueEx)} />
                  <Metric label="Kosten" value={euro(m.intro.costEx)} />
                  <Metric label="Marge" value={`${Math.round(m.intro.marginPct)}%`} />
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
        <button onClick={onNext} className="cpq-button cpq-button-primary" type="button">
          Verder naar afronden
        </button>
      </div>
    </section>
  );
}

function FinalizeStep({
  basis,
  scenario,
  metrics,
  onBack,
  onDownload,
}: {
  basis: BasisData;
  scenario: Scenario;
  metrics: ScenarioMetrics;
  onBack: () => void;
  onDownload: () => void;
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
          <Metric label="Scenario" value={scenario.name} />
          <Metric label="Omzet (ex)" value={euro(metrics.revenueEx)} />
          <Metric label="Marge" value={`${Math.round(metrics.marginPct)}%`} />
        </div>
        <div className="cpq-final-card">
          <h3 className="cpq-panel-title">Opmerking</h3>
          <div className="cpq-panel-text">{basis.opmerking || "Geen opmerking."}</div>
        </div>
      </div>

      <div className="cpq-actions cpq-actions-split">
        <button onClick={onBack} className="cpq-button cpq-button-secondary" type="button">
          Terug
        </button>
        <button onClick={onDownload} className="cpq-button cpq-button-primary" type="button">
          Concept downloaden (JSON stub)
        </button>
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

function Kpi({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="cpq-kpi">
      <span className="cpq-muted">{label}</span>
      <span className={strong ? "cpq-kpi-strong" : "cpq-kpi-value"}>{value}</span>
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



