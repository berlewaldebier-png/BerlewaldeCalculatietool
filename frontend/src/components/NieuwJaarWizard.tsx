"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { usePageShellHeader } from "@/components/PageShell";
import { VerkoopstrategieWorkspace } from "@/components/VerkoopstrategieWorkspace";
import { WizardSteps } from "@/components/WizardSteps";
import { API_BASE_URL } from "@/lib/api";
import { computeVasteKostenTotals } from "@/lib/kostprijsEngine";
import {
  createPackagingResolvers,
  computeAccijnsForLiters as computeAccijnsForLitersEngine,
  computeFixedCostPerLiter as computeFixedCostPerLiterEngine
} from "@/lib/kostprijsSnapshotEngine";

type GenericRecord = Record<string, unknown>;
type ProductieMap = Record<string, GenericRecord>;
type VasteKostenMap = Record<string, GenericRecord[]>;

type VasteKostenUiRow = {
  uiId: string;
  omschrijving: string;
  kostensoort: string;
  bedrag_per_jaar: number;
  herverdeel_pct: number;
  isNew: boolean;
};

type PackagingComponent = {
  id: string;
  omschrijving: string;
};

type PackagingPriceRow = {
  id: string;
  verpakkingsonderdeel_id: string;
  jaar: number;
  prijs_per_stuk: number;
};

type TariefRow = {
  id: string;
  jaar: number;
  tarief_hoog: number;
  tarief_laag: number;
  verbruikersbelasting: number;
};

type ProductieYear = {
  hoeveelheid_inkoop_l: number;
  hoeveelheid_productie_l: number;
  batchgrootte_eigen_productie_l: number;
};

type WizardStep = {
  id: string;
  label: string;
  description: string;
  panelTitle: string;
  panelDescription: string;
};

type PreviewRow = {
  bierId: string;
  biernaam: string;
  productId: string;
  productType: "basis" | "samengesteld" | "";
  calcType: "inkoop" | "eigen_productie";
  productLabel: string;
  sourcePrimaryCost: number;
  sourceCost: number;
  estimatedTargetCost: number;
  delta: number;
  sellIn: Record<string, number>;
};

type KostprijsPreviewRow = {
  biernaam: string;
  soort: string;
  product_type: "basis" | "samengesteld";
  verpakkingseenheid: string;
  primaire_kosten: number;
  verpakkingskosten: number;
  vaste_kosten: number;
  accijns: number;
  kostprijs: number;
};

type PricingMode = "keep_price" | "scale_cost_ratio" | "keep_margin" | "free";

type IngredientRule = {
  id: string;
  ingredient: string;
  omschrijving: string;
  hoeveelheid: number; // inhoud verpakking
  eenheid: string;
  prijs: number; // leveranciersprijs (totaal per verpakking)
  benodigd_in_recept: number; // hoeveelheid gebruikt per batch
};

type EigenProductieOverride = {
  alcoholpercentage: number;
  tarief_accijns: "Hoog" | "Laag";
  ingredienten: IngredientRule[];
};

export type NieuwJaarWizardProps = {
  initialBerekeningen: GenericRecord[];
  initialKostprijsproductactiveringen: GenericRecord[];
  initialBasisproducten: GenericRecord[];
  initialSamengesteldeProducten: GenericRecord[];
  initialBieren: GenericRecord[];
  initialProductie: ProductieMap;
  initialVasteKosten: VasteKostenMap;
  initialTarieven: GenericRecord[];
  initialPackagingComponents: GenericRecord[];
  initialPackagingComponentPrices: GenericRecord[];
  initialVerkoopprijzen: GenericRecord[];
  initialAdviesprijzen: GenericRecord[];
  /** Optional: force the wizard to load/resume a specific target year draft (e.g. via /nieuw-jaar-voorbereiden?target_year=2026). */
  initialTargetYear?: number;
  /** Optional: force the initial source year in the wizard (rarely needed; draft load may override). */
  initialSourceYear?: number;
};

type AdviesprijsRow = {
  id: string;
  jaar: number;
  channel_code: string;
  opslag_pct: number;
};

function normalizeTariefRow(raw: GenericRecord): TariefRow {
  return {
    id: String(raw.id ?? ""),
    jaar: Number(raw.jaar ?? 0),
    tarief_hoog: Number(raw.tarief_hoog ?? 0),
    tarief_laag: Number(raw.tarief_laag ?? 0),
    verbruikersbelasting: Number(raw.verbruikersbelasting ?? 0)
  };
}

function normalizePackagingComponent(raw: GenericRecord): PackagingComponent {
  return {
    id: String(raw.id ?? ""),
    omschrijving: String(raw.omschrijving ?? "")
  };
}

function normalizePackagingPriceRow(raw: GenericRecord): PackagingPriceRow {
  return {
    id: String(raw.id ?? ""),
    verpakkingsonderdeel_id: String(raw.verpakkingsonderdeel_id ?? ""),
    jaar: Number(raw.jaar ?? 0),
    prijs_per_stuk: Number(raw.prijs_per_stuk ?? 0)
  };
}

function clampInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function clampNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function formatEur(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value);
}

function snapshotProductCostFromRecord(record: any, productId: string) {
  const producten = record?.resultaat_snapshot?.producten;
  const rows = [
    ...(Array.isArray(producten?.basisproducten) ? producten.basisproducten : []),
    ...(Array.isArray(producten?.samengestelde_producten) ? producten.samengestelde_producten : [])
  ];
  const found = rows.find((row: any) => String(row.product_id ?? "") === productId) ?? null;
  if (!found) return null;
  return {
    kostprijs: Number(found.kostprijs ?? 0),
    primaireKosten: Number(found.primaire_kosten ?? found.primaireKosten ?? 0),
    productType: String(found.product_type ?? ""),
    productLabel: String(found.verpakking ?? found.verpakkingseenheid ?? found.omschrijving ?? productId)
  };
}

export function NieuwJaarWizard(props: NieuwJaarWizardProps) {
  const router = useRouter();
  const {
    initialBerekeningen,
    initialKostprijsproductactiveringen,
    initialBasisproducten,
    initialSamengesteldeProducten,
    initialBieren,
    initialProductie,
    initialVasteKosten,
    initialTarieven,
    initialPackagingComponents,
    initialPackagingComponentPrices,
    initialVerkoopprijzen,
    initialAdviesprijzen,
    initialTargetYear,
    initialSourceYear
  } = props;

  const [activeStep, setActiveStep] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("");

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    Object.keys(initialProductie ?? {}).forEach((key) => {
      if (/^\d+$/.test(key)) years.add(Number(key));
    });
    Object.keys(initialVasteKosten ?? {}).forEach((key) => {
      if (/^\d+$/.test(key)) years.add(Number(key));
    });
    (Array.isArray(initialTarieven) ? initialTarieven : []).forEach((row) =>
      years.add(Number((row as any)?.jaar ?? 0))
    );
    (Array.isArray(initialPackagingComponentPrices) ? initialPackagingComponentPrices : []).forEach((row) =>
      years.add(Number((row as any)?.jaar ?? 0))
    );
    (Array.isArray(initialVerkoopprijzen) ? initialVerkoopprijzen : []).forEach((row) =>
      years.add(Number((row as any)?.jaar ?? 0))
    );
    (Array.isArray(initialAdviesprijzen) ? initialAdviesprijzen : []).forEach((row) =>
      years.add(Number((row as any)?.jaar ?? 0))
    );
    (Array.isArray(initialBerekeningen) ? initialBerekeningen : []).forEach((row) =>
      years.add(Number(((row as any)?.basisgegevens ?? {})?.jaar ?? 0))
    );
    return Array.from(years).filter((year) => year > 0).sort((a, b) => a - b);
  }, [
    initialBerekeningen,
    initialAdviesprijzen,
    initialPackagingComponentPrices,
    initialProductie,
    initialTarieven,
    initialVasteKosten,
    initialVerkoopprijzen
  ]);

  const defaultSource = yearOptions[yearOptions.length - 1] ?? new Date().getFullYear();
  const requestedSourceYear = clampInt(initialSourceYear, 0);
  const requestedTargetYear = clampInt(initialTargetYear, 0);
  const initialSource = requestedSourceYear > 0 ? requestedSourceYear : defaultSource;
  const initialTarget = requestedTargetYear > 0 ? requestedTargetYear : initialSource + 1;

  // Note: source/target might temporarily be "inconsistent" (e.g. when opening a draft by target_year),
  // but `loadDraftFromServer()` will correct them from the stored draft.
  const [sourceYear, setSourceYear] = useState(initialSource);
  const [targetYear, setTargetYear] = useState(initialTarget);

  const [copyProductie, setCopyProductie] = useState(true);
  const [copyVasteKosten, setCopyVasteKosten] = useState(true);
  const [copyTarieven, setCopyTarieven] = useState(true);
  const [copyVerpakkingsonderdelen, setCopyVerpakkingsonderdelen] = useState(true);
  const [copyVerkoopstrategie, setCopyVerkoopstrategie] = useState(true);

  const [currentProductie, setCurrentProductie] = useState<ProductieMap>(initialProductie ?? {});
  const [currentVasteKosten, setCurrentVasteKosten] = useState<VasteKostenMap>(initialVasteKosten ?? {});
  const [currentTarieven, setCurrentTarieven] = useState<TariefRow[]>(
    (Array.isArray(initialTarieven) ? initialTarieven : []).map((row) => normalizeTariefRow(row as any))
  );

  const packagingComponents = useMemo(() => {
    return (Array.isArray(initialPackagingComponents) ? initialPackagingComponents : [])
      .map((row) => normalizePackagingComponent(row as any))
      .filter((row) => row.id);
  }, [initialPackagingComponents]);

  const [currentPackagingPrices, setCurrentPackagingPrices] = useState<PackagingPriceRow[]>(
    (Array.isArray(initialPackagingComponentPrices) ? initialPackagingComponentPrices : [])
      .map((row) => normalizePackagingPriceRow(row as any))
      .filter((row) => row.verpakkingsonderdeel_id && row.jaar > 0)
  );

  const [currentVerkoopprijzen, setCurrentVerkoopprijzen] = useState<GenericRecord[]>(
    Array.isArray(initialVerkoopprijzen) ? initialVerkoopprijzen : []
  );
  const [currentAdviesprijzen, setCurrentAdviesprijzen] = useState<AdviesprijsRow[]>(
    (Array.isArray(initialAdviesprijzen) ? initialAdviesprijzen : [])
      .filter((row) => row && typeof row === "object")
      .map((row: any) => ({
        id: String(row.id ?? ""),
        jaar: Number(row.jaar ?? 0),
        channel_code: String(row.channel_code ?? row.code ?? "").toLowerCase(),
        opslag_pct: Number(row.opslag_pct ?? row.opslag ?? 0)
      }))
  );

  const [currentBerekeningen, setCurrentBerekeningen] = useState<GenericRecord[]>(
    Array.isArray(initialBerekeningen) ? initialBerekeningen : []
  );
  const [currentActivations, setCurrentActivations] = useState<GenericRecord[]>(
    Array.isArray(initialKostprijsproductactiveringen) ? initialKostprijsproductactiveringen : []
  );

  const [scenarioPrimaryCosts, setScenarioPrimaryCosts] = useState<Record<string, number>>({});
  const [eigenProductieOverrides, setEigenProductieOverrides] = useState<Record<string, EigenProductieOverride>>({});
  const [pricingMode, setPricingMode] = useState<PricingMode>("scale_cost_ratio");
  const [verkoopstrategieSave, setVerkoopstrategieSave] = useState<null | (() => Promise<void>)>(null);
  const [draftPackagingPrices, setDraftPackagingPrices] = useState<Record<string, number>>({});
  const [draftProductieTarget, setDraftProductieTarget] = useState<ProductieYear>({
    hoeveelheid_inkoop_l: 0,
    hoeveelheid_productie_l: 0,
    batchgrootte_eigen_productie_l: 0
  });
  const [draftVasteKostenTarget, setDraftVasteKostenTarget] = useState<VasteKostenUiRow[]>([]);
  const [draftPackagingPricesTarget, setDraftPackagingPricesTarget] = useState<PackagingPriceRow[]>([]);
  const [draftVerkoopstrategieTarget, setDraftVerkoopstrategieTarget] = useState<GenericRecord[]>([]);
  const [draftAdviesprijzenTarget, setDraftAdviesprijzenTarget] = useState<AdviesprijsRow[]>([]);
  const [adviesprijzenDraftInputs, setAdviesprijzenDraftInputs] = useState<Record<string, string>>({});
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([]);
  const [draftStatus, setDraftStatus] = useState<"" | "idle" | "loading" | "saving" | "committing">("idle");
  const [commitConflict, setCommitConflict] = useState<string>("");
  const conceptStarted = completedStepIds.includes("init");

  const STRATEGY_RECORD_TYPES = useMemo(() => new Set(["jaarstrategie", "verkoopstrategie_product", "verkoopstrategie_verpakking"]), []);

  const wizardVerkoopprijzen = useMemo(() => {
    // In wizard draft mode we keep strategy edits local (draftVerkoopstrategieTarget) but still need passthrough records
    // (product_pricing etc) so VerkoopstrategieWorkspace can preserve the dataset shape on save.
    const passthrough = (Array.isArray(currentVerkoopprijzen) ? currentVerkoopprijzen : []).filter(
      (row) => !STRATEGY_RECORD_TYPES.has(String((row as any)?.record_type ?? ""))
    );
    const otherStrategy = (Array.isArray(currentVerkoopprijzen) ? currentVerkoopprijzen : []).filter((row) => {
      const rt = String((row as any)?.record_type ?? "");
      const jaar = Number((row as any)?.jaar ?? 0);
      if (!STRATEGY_RECORD_TYPES.has(rt)) return false;
      if (jaar === targetYear && Array.isArray(draftVerkoopstrategieTarget) && draftVerkoopstrategieTarget.length > 0) {
        // We'll replace targetYear strategy with the draft.
        return false;
      }
      return true;
    });
    const draft = Array.isArray(draftVerkoopstrategieTarget) ? draftVerkoopstrategieTarget : [];
    return [...passthrough, ...otherStrategy, ...draft];
  }, [STRATEGY_RECORD_TYPES, currentVerkoopprijzen, draftVerkoopstrategieTarget, targetYear]);

  function createUiId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function vasteKostenKey(row: { omschrijving?: unknown; kostensoort?: unknown }) {
    return `${String(row.omschrijving ?? "").trim().toLowerCase()}||${String(row.kostensoort ?? "")
      .trim()
      .toLowerCase()}`;
  }

  const sourceVasteKostenRows = useMemo(() => {
    const rawRows = ((currentVasteKosten as any)?.[String(sourceYear)] ?? []) as any[];
    if (!Array.isArray(rawRows)) return [] as Array<{ idx: number; key: string; omschrijving: string; kostensoort: string; bedrag_per_jaar: number; herverdeel_pct: number }>;
    return rawRows
      .filter((row) => row && typeof row === "object")
      .map((row, idx) => ({
        idx,
        key: vasteKostenKey(row),
        omschrijving: String((row as any).omschrijving ?? ""),
        kostensoort: String((row as any).kostensoort ?? ""),
        bedrag_per_jaar: Number((row as any).bedrag_per_jaar ?? 0),
        herverdeel_pct: Number((row as any).herverdeel_pct ?? 0)
      }));
  }, [currentVasteKosten, sourceYear]);

  // Ensure the target-year draft has a 1:1 structural row for each source row (with 0 defaults),
  // so the combined table can always show editable target columns without copying source amounts.
  useEffect(() => {
    // Note: this is a UI-structure initializer only (0/0 defaults). It does not copy source amounts.
    // We intentionally allow this to run when the user is on the fixed-costs step, even if the
    // draft's `completed_step_ids` is temporarily out of sync, to avoid a non-editable UI.
    if (!copyVasteKosten) return;
    if (!conceptStarted && activeStep !== 4) return;

    const requiredCounts = new Map<string, number>();
    sourceVasteKostenRows.forEach((row) => {
      requiredCounts.set(row.key, (requiredCounts.get(row.key) ?? 0) + 1);
    });

    setDraftVasteKostenTarget((current) => {
      const currentCounts = new Map<string, number>();
      current
        .filter((row) => !row.isNew)
        .forEach((row) => {
          const key = vasteKostenKey(row);
          currentCounts.set(key, (currentCounts.get(key) ?? 0) + 1);
        });

      let changed = false;
      const next = [...current];
      for (const [key, required] of requiredCounts.entries()) {
        const have = currentCounts.get(key) ?? 0;
        if (have >= required) continue;
        const missing = required - have;
        changed = true;
        const exemplar = sourceVasteKostenRows.find((row) => row.key === key);
        const exemplarOmschrijving = exemplar?.omschrijving ?? "";
        const exemplarSoort = exemplar?.kostensoort ?? "";
        for (let i = 0; i < missing; i += 1) {
          next.push({
            uiId: createUiId(),
            omschrijving: exemplarOmschrijving,
            kostensoort: exemplarSoort,
            bedrag_per_jaar: 0,
            herverdeel_pct: 0,
            isNew: false
          });
        }
      }
      return changed ? next : current;
    });
  }, [conceptStarted, activeStep, copyVasteKosten, sourceVasteKostenRows]);

  function updateVasteKostenRow(uiId: string, patch: Partial<VasteKostenUiRow>) {
    setDraftVasteKostenTarget((current) =>
      current.map((row) => (row.uiId === uiId ? { ...row, ...patch } : row))
    );
  }

  function addVasteKostenRow() {
    setDraftVasteKostenTarget((current) => [
      ...current,
      {
        uiId: createUiId(),
        omschrijving: "",
        kostensoort: "",
        bedrag_per_jaar: 0,
        herverdeel_pct: 0,
        isNew: true
      }
    ]);
  }

  function sanitizeVasteKostenTarget(rows: VasteKostenUiRow[]): GenericRecord[] {
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => row && typeof row === "object")
      .map((row) => ({
        id: "",
        omschrijving: String(row.omschrijving ?? ""),
        kostensoort: String(row.kostensoort ?? ""),
        bedrag_per_jaar: Number(row.bedrag_per_jaar ?? 0),
        herverdeel_pct: Number(row.herverdeel_pct ?? 0)
      }));
  }

  function ensureEigenOverride(bierId: string): EigenProductieOverride {
    const existing = eigenProductieOverrides[bierId];
    if (existing) return existing;
    return { alcoholpercentage: 0, tarief_accijns: "Hoog", ingredienten: [] };
  }

  function updateEigenOverride(bierId: string, patch: Partial<EigenProductieOverride>) {
    if (!bierId) return;
    setEigenProductieOverrides((current) => {
      const base = current[bierId] ?? { alcoholpercentage: 0, tarief_accijns: "Hoog", ingredienten: [] };
      return { ...current, [bierId]: { ...base, ...patch } };
    });
  }

  function updateEigenIngredient(bierId: string, rowId: string, patch: Partial<IngredientRule>) {
    if (!bierId || !rowId) return;
    setEigenProductieOverrides((current) => {
      const base = current[bierId] ?? { alcoholpercentage: 0, tarief_accijns: "Hoog", ingredienten: [] };
      const nextRules = (Array.isArray(base.ingredienten) ? base.ingredienten : []).map((row) =>
        row.id === rowId ? { ...row, ...patch } : row
      );
      return { ...current, [bierId]: { ...base, ingredienten: nextRules } };
    });
  }

  function addEigenIngredient(bierId: string) {
    if (!bierId) return;
    setEigenProductieOverrides((current) => {
      const base = current[bierId] ?? { alcoholpercentage: 0, tarief_accijns: "Hoog", ingredienten: [] };
      const nextRules = [
        ...(Array.isArray(base.ingredienten) ? base.ingredienten : []),
        {
          id: createUiId(),
          ingredient: "",
          omschrijving: "",
          hoeveelheid: 0,
          eenheid: "",
          prijs: 0,
          benodigd_in_recept: 0
        }
      ];
      return { ...current, [bierId]: { ...base, ingredienten: nextRules } };
    });
  }

  function deleteEigenIngredient(bierId: string, rowId: string) {
    if (!bierId || !rowId) return;
    setEigenProductieOverrides((current) => {
      const base = current[bierId] ?? { alcoholpercentage: 0, tarief_accijns: "Hoog", ingredienten: [] };
      const nextRules = (Array.isArray(base.ingredienten) ? base.ingredienten : []).filter((row) => row.id !== rowId);
      return { ...current, [bierId]: { ...base, ingredienten: nextRules } };
    });
  }

  function buildDraftPayload() {
    const packagingRows: PackagingPriceRow[] = packagingComponents.map((component) => ({
      id: "",
      verpakkingsonderdeel_id: component.id,
      jaar: targetYear,
      prijs_per_stuk: Number(draftPackagingPrices[component.id] ?? 0)
    }));
    const data: Record<string, unknown> = {
      productie_target: {
        hoeveelheid_inkoop_l: Number(draftProductieTarget.hoeveelheid_inkoop_l ?? 0),
        hoeveelheid_productie_l: Number(draftProductieTarget.hoeveelheid_productie_l ?? 0),
        batchgrootte_eigen_productie_l: Number(draftProductieTarget.batchgrootte_eigen_productie_l ?? 0)
      },
      tarieven_target: {
        id: String(draftTariefTarget.id ?? ""),
        jaar: targetYear,
        tarief_hoog: Number(draftTariefTarget.tarief_hoog ?? 0),
        tarief_laag: Number(draftTariefTarget.tarief_laag ?? 0),
        verbruikersbelasting: Number(draftTariefTarget.verbruikersbelasting ?? 0)
      },
      vaste_kosten_target: copyVasteKosten ? sanitizeVasteKostenTarget(draftVasteKostenTarget) : undefined,
      packaging_prices_target: copyVerpakkingsonderdelen ? packagingRows : undefined,
      verkoopstrategie_target: copyVerkoopstrategie ? draftVerkoopstrategieTarget : undefined,
      adviesprijzen_target: copyVerkoopstrategie ? draftAdviesprijzenTarget : undefined,
      // Scenario inkoop (primair) per bier+product. We store only explicit overrides; missing entries mean "use bronjaar".
      scenario_primary_costs: Object.fromEntries(
        Object.entries(scenarioPrimaryCosts).filter(([, value]) => Number.isFinite(Number(value)))
      ),
      eigen_productie_overrides: Object.fromEntries(
        Object.entries(eigenProductieOverrides)
          .filter(([bierId]) => !!bierId)
          .map(([bierId, override]) => [
            bierId,
            {
              alcoholpercentage: Number(override?.alcoholpercentage ?? 0),
              tarief_accijns: (override?.tarief_accijns === "Laag" ? "Laag" : "Hoog") as "Hoog" | "Laag",
              ingredienten: (Array.isArray(override?.ingredienten) ? override.ingredienten : []).map((regel) => ({
                id: String(regel.id ?? ""),
                ingredient: String(regel.ingredient ?? ""),
                omschrijving: String(regel.omschrijving ?? ""),
                hoeveelheid: Number(regel.hoeveelheid ?? 0),
                eenheid: String(regel.eenheid ?? ""),
                prijs: Number(regel.prijs ?? 0),
                benodigd_in_recept: Number(regel.benodigd_in_recept ?? 0)
              }))
            }
          ])
      )
    };
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) {
        delete data[key];
      }
    }
    return {
      data,
      active_step: activeStep,
      completed_step_ids: completedStepIds
    };
  }

  async function saveDraftToServer(message?: string): Promise<boolean> {
    setDraftStatus("saving");
    setIsRunning(true);
    setStatus("");
    try {
      const response = await fetch(`${API_BASE_URL}/meta/new-year-draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_year: sourceYear,
          target_year: targetYear,
          payload: buildDraftPayload()
        })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Concept opslaan mislukt.");
      }
      setStatus(message ?? "Concept opgeslagen.");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Concept opslaan mislukt.");
      return false;
    } finally {
      setDraftStatus("idle");
      setIsRunning(false);
    }
  }

  async function navigateToStep(nextIndex: number) {
    if (isRunning) return;

    const nextStep = steps[nextIndex];
    if (!nextStep) return;

    if (!conceptStarted) {
      if (!isStepEnabled(nextStep.id)) {
        setStatus(`Start eerst het concept voor ${targetYear} via stap 2 (Jaarset).`);
        return;
      }
      setActiveStep(nextIndex);
      return;
    }

    if (!isStepEnabled(nextStep.id)) {
      // For prev/next navigation we skip disabled steps so the wizard never lands on a greyed-out step.
      const direction: -1 | 1 = nextIndex > activeStep ? 1 : -1;
      const nearest = findNearestEnabledStepIndex(nextIndex, direction);
      const nearestStep = steps[nearest];
      if (!nearestStep || !isStepEnabled(nearestStep.id)) {
        setStatus(`Deze stap is uitgeschakeld omdat je hem in Jaarset niet hebt aangevinkt.`);
        return;
      }
      nextIndex = nearest;
    }

    // Silent save: avoid noisy status updates while still persisting user work.
    const ok = await saveDraftToServer("");
    if (!ok) return;
    if (activeStep === 9 && nextIndex !== 9) {
      // Avoid retaining a save callback tied to an unmounted VerkoopstrategieWorkspace.
      setVerkoopstrategieSave(null);
    }
    setActiveStep(nextIndex);
  }

  async function loadDraftFromServer() {
    setDraftStatus("loading");
    try {
      const response = await fetch(`${API_BASE_URL}/meta/new-year-draft?target_year=${encodeURIComponent(String(targetYear))}`, {
        cache: "no-store"
      });
      if (!response.ok) return;
      const json = (await response.json()) as any;
      const draft = json?.draft ?? null;
      if (!draft) return;
      const payload = draft?.payload ?? {};
      const data = payload?.data ?? {};
      const source = Number(draft.source_year ?? payload?.source_year ?? sourceYear);
      const effectiveSource = Number.isFinite(source) && source > 0 ? source : sourceYear;
      const effectiveTarget = effectiveSource + 1;
      if (effectiveSource !== sourceYear) setSourceYear(effectiveSource);
      if (effectiveTarget !== targetYear) setTargetYearWithDraft(effectiveTarget);

      if (data?.productie_target && typeof data.productie_target === "object") {
        setDraftProductieTarget({
          hoeveelheid_inkoop_l: Number(data.productie_target.hoeveelheid_inkoop_l ?? 0),
          hoeveelheid_productie_l: Number(data.productie_target.hoeveelheid_productie_l ?? 0),
          batchgrootte_eigen_productie_l: Number(data.productie_target.batchgrootte_eigen_productie_l ?? 0)
        });
      }
      if (data?.tarieven_target && typeof data.tarieven_target === "object") {
        setDraftTariefTarget((current) => ({
          ...current,
          id: String(data.tarieven_target.id ?? ""),
          jaar: effectiveTarget,
          tarief_hoog: Number(data.tarieven_target.tarief_hoog ?? 0),
          tarief_laag: Number(data.tarieven_target.tarief_laag ?? 0),
          verbruikersbelasting: Number(data.tarieven_target.verbruikersbelasting ?? 0)
        }));
      }
      if (Array.isArray(data?.vaste_kosten_target)) {
        const nextUiRows: VasteKostenUiRow[] = (data.vaste_kosten_target as any[])
          .filter((row) => row && typeof row === "object")
          .map((row) => ({
            uiId: createUiId(),
            omschrijving: String((row as any).omschrijving ?? ""),
            kostensoort: String((row as any).kostensoort ?? ""),
            bedrag_per_jaar: Number((row as any).bedrag_per_jaar ?? 0),
            herverdeel_pct: Number((row as any).herverdeel_pct ?? 0),
            // Rows loaded from draft are existing target-year rows (not "new" rows added in the UI).
            // Marking these as new breaks the 1:1 matching with the bronjaar table, which then makes
            // the target-year columns non-editable (rendered as '-').
            isNew: false
          }));
        setDraftVasteKostenTarget(nextUiRows);
      }
      if (Array.isArray(data?.packaging_prices_target)) {
        setDraftPackagingPricesTarget(
          (data.packaging_prices_target as any[])
            .filter((row) => row && typeof row === "object")
            .map((row) => ({
              id: String((row as any).id ?? ""),
              verpakkingsonderdeel_id: String((row as any).verpakkingsonderdeel_id ?? ""),
              jaar: Number((row as any).jaar ?? effectiveTarget),
              prijs_per_stuk: Number((row as any).prijs_per_stuk ?? 0)
            }))
        );
        // Also keep the map in sync for the packaging editor.
        const nextMap: Record<string, number> = {};
        (data.packaging_prices_target as any[]).forEach((row: any) => {
          const cid = String(row?.verpakkingsonderdeel_id ?? "");
          if (!cid) return;
          nextMap[cid] = Number(row?.prijs_per_stuk ?? 0);
        });
        setDraftPackagingPrices(nextMap);
      }
      if (Array.isArray(data?.verkoopstrategie_target)) {
        setDraftVerkoopstrategieTarget(data.verkoopstrategie_target as any);
      }
      if (Array.isArray(data?.adviesprijzen_target)) {
        const rows = (data.adviesprijzen_target as any[])
          .filter((row) => row && typeof row === "object")
          .map((row: any) => ({
            id: String(row.id ?? ""),
            jaar: effectiveTarget,
            channel_code: String(row.channel_code ?? row.code ?? "").toLowerCase(),
            opslag_pct: Number(row.opslag_pct ?? row.opslag ?? 0)
          }))
          .filter((row) => row.jaar > 0 && row.channel_code);
        setDraftAdviesprijzenTarget(rows);
        setAdviesprijzenDraftInputs(Object.fromEntries(rows.map((row) => [row.channel_code, String(row.opslag_pct ?? 0)])));
      }
      if (data?.scenario_primary_costs && typeof data.scenario_primary_costs === "object") {
        const raw = data.scenario_primary_costs as Record<string, unknown>;
        const next: Record<string, number> = {};
        Object.entries(raw).forEach(([key, value]) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) return;
          next[key] = parsed;
        });
        setScenarioPrimaryCosts(next);
      }
      if (data?.eigen_productie_overrides && typeof data.eigen_productie_overrides === "object") {
        const raw = data.eigen_productie_overrides as Record<string, any>;
        const next: Record<string, EigenProductieOverride> = {};
        Object.entries(raw).forEach(([bierId, value]) => {
          if (!bierId) return;
          if (!value || typeof value !== "object") return;
          const alcoholpercentage = Number((value as any).alcoholpercentage ?? 0);
          const tarief = String((value as any).tarief_accijns ?? "Hoog");
          const ingredienten = Array.isArray((value as any).ingredienten) ? ((value as any).ingredienten as any[]) : [];
          next[bierId] = {
            alcoholpercentage: Number.isFinite(alcoholpercentage) ? alcoholpercentage : 0,
            tarief_accijns: tarief === "Laag" ? "Laag" : "Hoog",
            ingredienten: ingredienten
              .filter((row) => row && typeof row === "object")
              .map((row) => ({
                id: String((row as any).id ?? createUiId()),
                ingredient: String((row as any).ingredient ?? ""),
                omschrijving: String((row as any).omschrijving ?? ""),
                hoeveelheid: Number((row as any).hoeveelheid ?? 0),
                eenheid: String((row as any).eenheid ?? ""),
                prijs: Number((row as any).prijs ?? 0),
                benodigd_in_recept: Number((row as any).benodigd_in_recept ?? 0)
              }))
          };
        });
        setEigenProductieOverrides(next);
      }
      if (Array.isArray(payload?.completed_step_ids)) {
        setCompletedStepIds(payload.completed_step_ids as any);
      }
      if (Number.isFinite(Number(payload?.active_step ?? 0))) {
        const parsed = Number(payload.active_step ?? 0);
        // Keep drafts resilient across wizard step inserts/reorders.
        setActiveStep(Math.max(0, Math.min(steps.length - 1, Number.isFinite(parsed) ? parsed : 0)));
      }

      setStatus(`Concept geladen voor doeljaar ${effectiveTarget}.`);
    } finally {
      setDraftStatus("idle");
    }
  }

  // Let the user decide whether to copy packaging prices from the source year.

  const canInitialize = useMemo(() => {
    if (sourceYear <= 0 || targetYear <= 0) return false;
    return true;
  }, [sourceYear, targetYear]);

  // If a draft exists for the selected target year, auto-load it so you can continue later.
  useEffect(() => {
    if (!canInitialize) return;
    void loadDraftFromServer();
  }, [canInitialize, targetYear]);

  function getProductieForYear(year: number): ProductieYear | null {
    if (year === targetYear) {
      return {
        hoeveelheid_inkoop_l: Number(draftProductieTarget.hoeveelheid_inkoop_l ?? 0),
        hoeveelheid_productie_l: Number(draftProductieTarget.hoeveelheid_productie_l ?? 0),
        batchgrootte_eigen_productie_l: Number(draftProductieTarget.batchgrootte_eigen_productie_l ?? 0)
      };
    }
    const raw = (currentProductie as any)?.[String(year)];
    if (!raw || typeof raw !== "object") return null;
    return {
      hoeveelheid_inkoop_l: Number((raw as any).hoeveelheid_inkoop_l ?? 0),
      hoeveelheid_productie_l: Number((raw as any).hoeveelheid_productie_l ?? 0),
      batchgrootte_eigen_productie_l: Number((raw as any).batchgrootte_eigen_productie_l ?? 0)
    };
  }

  async function refreshFromServer() {
    const bootstrap = await fetch(
      `${API_BASE_URL}/meta/bootstrap?datasets=${encodeURIComponent(
        [
          "productie",
          "vaste-kosten",
          "tarieven-heffingen",
          "packaging-component-prices",
          "verkoopprijzen",
          "adviesprijzen",
          "berekeningen",
          "kostprijsproductactiveringen"
        ].join(",")
      )}&navigation=false`,
      { cache: "no-store" }
    );
    if (!bootstrap.ok) return;
    const data = (await bootstrap.json()) as any;
    const datasets = (data?.datasets ?? {}) as Record<string, unknown>;

    setCurrentProductie((datasets["productie"] as any) ?? {});
    setCurrentVasteKosten((datasets["vaste-kosten"] as any) ?? {});
    setCurrentTarieven(((datasets["tarieven-heffingen"] as any[]) ?? []).map((row) => normalizeTariefRow(row)));
    setCurrentPackagingPrices(
      (((datasets["packaging-component-prices"] as any[]) ?? []) as any[])
        .map((row) => normalizePackagingPriceRow(row))
        .filter((row) => row.verpakkingsonderdeel_id && row.jaar > 0)
    );
    setCurrentVerkoopprijzen(((datasets["verkoopprijzen"] as any[]) ?? []) as any[]);
    setCurrentAdviesprijzen(
      (((datasets["adviesprijzen"] as any[]) ?? []) as any[])
        .filter((row) => row && typeof row === "object")
        .map((row: any) => ({
          id: String(row.id ?? ""),
          jaar: Number(row.jaar ?? 0),
          channel_code: String(row.channel_code ?? row.code ?? "").toLowerCase(),
          opslag_pct: Number(row.opslag_pct ?? row.opslag ?? 0)
        }))
    );
    setCurrentBerekeningen(((datasets["berekeningen"] as any[]) ?? []) as any[]);
    setCurrentActivations(((datasets["kostprijsproductactiveringen"] as any[]) ?? []) as any[]);
  }

  async function initializeYear() {
    if (!canInitialize) return;
    try {
      if (copyProductie && sourceProductie) {
        setDraftProductieTarget(sourceProductie);
      }
      if (copyTarieven && sourceTarief) {
        setDraftTariefTarget((current) => ({
          ...current,
          jaar: targetYear,
          tarief_hoog: sourceTarief.tarief_hoog,
          tarief_laag: sourceTarief.tarief_laag,
          verbruikersbelasting: sourceTarief.verbruikersbelasting
        }));
      } else {
        setDraftTariefTarget((current) => ({ ...current, jaar: targetYear }));
      }
      // Bewuste keuze: we nemen vaste kosten niet over, maar we zetten wel de structuur klaar (0/0) zodat je bewust kunt invullen.
      setDraftVasteKostenTarget(
        copyVasteKosten
          ? sourceVasteKostenRows.map((row) => ({
              uiId: createUiId(),
              omschrijving: row.omschrijving,
              kostensoort: row.kostensoort,
              bedrag_per_jaar: 0,
              herverdeel_pct: 0,
              isNew: false
            }))
          : []
      );
      setDraftPackagingPrices({});
      setDraftPackagingPricesTarget([]);
      setDraftVerkoopstrategieTarget([]);
      setDraftAdviesprijzenTarget([]);
      setAdviesprijzenDraftInputs({});

      if (copyVerkoopstrategie) {
        const existingTarget = currentAdviesprijzen.filter((row) => Number(row.jaar ?? 0) === targetYear);
        const sourceRows = currentAdviesprijzen.filter((row) => Number(row.jaar ?? 0) === sourceYear);
        const base = existingTarget.length > 0 ? existingTarget : sourceRows;
        const nextRows = base
          .filter((row) => row && row.channel_code)
          .map((row) => ({
            id: existingTarget.length > 0 ? String(row.id ?? "") : "",
            jaar: targetYear,
            channel_code: String(row.channel_code ?? "").toLowerCase(),
            opslag_pct: Number(row.opslag_pct ?? 0)
          }));
        setDraftAdviesprijzenTarget(nextRows);
        setAdviesprijzenDraftInputs(Object.fromEntries(nextRows.map((row) => [row.channel_code, String(row.opslag_pct ?? 0)])));
      }

      setCompletedStepIds(["basis", "init"]);
      const ok = await saveDraftToServer(`Concept gestart: bronjaar ${sourceYear} -> doeljaar ${targetYear}.`);
      if (ok) setActiveStep(2);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Concept starten mislukt.");
    }
  }

  async function saveAndClose() {
    if (isRunning) return;
    if (conceptStarted) {
      await saveDraftToServer("Concept opgeslagen.");
    }
    router.push("/beheer/jaarsets");
  }

  async function deleteConcept() {
    if (isRunning) return;
    if (!conceptStarted) return;

    const confirmText = `Weet je zeker dat je het concept voor ${targetYear} wilt verwijderen? Dit verwijdert alleen het concept (draft), niet je bestaande data.`;
    if (!confirm(confirmText)) return;

    setIsRunning(true);
    setStatus("");
    try {
      await fetch(`${API_BASE_URL}/meta/new-year-draft?target_year=${encodeURIComponent(String(targetYear))}`, {
        method: "DELETE"
      });
      setCompletedStepIds([]);
      setScenarioPrimaryCosts({});
      setDraftPackagingPrices({});
      setDraftPackagingPricesTarget([]);
      setDraftProductieTarget({
        hoeveelheid_inkoop_l: 0,
        hoeveelheid_productie_l: 0,
        batchgrootte_eigen_productie_l: 0
      });
      setDraftTariefTarget({
        id: "",
        jaar: targetYear,
        tarief_hoog: 0,
        tarief_laag: 0,
        verbruikersbelasting: 0
      });
      setDraftVasteKostenTarget([]);
      setDraftVerkoopstrategieTarget([]);
      setDraftAdviesprijzenTarget([]);
      setAdviesprijzenDraftInputs({});
      setCommitConflict("");
      setStatus(`Concept verwijderd voor doeljaar ${targetYear}.`);
      setActiveStep(1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Concept verwijderen mislukt.");
    } finally {
      setIsRunning(false);
    }
  }

  async function commitTargetYear() {
    if (!canInitialize) return;
    const confirmText = `Weet je zeker dat je het doeljaar ${targetYear} definitief wilt aanmaken? Dit schrijft alles in 1 keer weg naar de database.`;
    if (!confirm(confirmText)) return;

    setDraftStatus("committing");
    setIsRunning(true);
    setStatus("");
    setCommitConflict("");
    try {
      const response = await fetch(`${API_BASE_URL}/meta/commit-new-year`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_year: sourceYear,
          target_year: targetYear,
          copy_productie: copyProductie,
          copy_vaste_kosten: copyVasteKosten,
          copy_tarieven: copyTarieven,
          copy_verpakkingsonderdelen: copyVerpakkingsonderdelen,
          copy_verkoopstrategie: copyVerkoopstrategie,
          copy_berekeningen: false,
          force: false,
          payload: buildDraftPayload()
        })
      });
      if (response.status === 409) {
        const text = await response.text();
        setCommitConflict(text || "Bronjaar is gewijzigd sinds dit concept is gestart.");
        throw new Error("Conflict bij afronden. Zie melding hieronder.");
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Afronden mislukt.");
      }
      await refreshFromServer();
      setStatus(`Definitief opgeslagen: jaar ${targetYear} is aangemaakt.`);
      // Next step in the workflow: activate cost prices for the new year.
      router.push(
        `/kostprijs-activatie?source_year=${encodeURIComponent(String(sourceYear))}&target_year=${encodeURIComponent(
          String(targetYear)
        )}`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Afronden mislukt.");
    } finally {
      setDraftStatus("idle");
      setIsRunning(false);
    }
  }

  async function commitTargetYearForce() {
    if (!canInitialize) return;
    const confirmText = `Bronjaar is gewijzigd. Weet je zeker dat je tóch wilt afronden met de huidige bronjaar-stand?`;
    if (!confirm(confirmText)) return;
    setDraftStatus("committing");
    setIsRunning(true);
    setStatus("");
    try {
      const response = await fetch(`${API_BASE_URL}/meta/commit-new-year`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_year: sourceYear,
          target_year: targetYear,
          copy_productie: copyProductie,
          copy_vaste_kosten: copyVasteKosten,
          copy_tarieven: copyTarieven,
          copy_verpakkingsonderdelen: copyVerpakkingsonderdelen,
          copy_verkoopstrategie: copyVerkoopstrategie,
          copy_berekeningen: false,
          force: true,
          payload: buildDraftPayload()
        })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Afronden mislukt.");
      }
      await refreshFromServer();
      setCommitConflict("");
      setStatus(`Definitief opgeslagen: jaar ${targetYear} is aangemaakt.`);
      setActiveStep(9);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Afronden mislukt.");
    } finally {
      setDraftStatus("idle");
      setIsRunning(false);
    }
  }

  function getTariefForYear(year: number): TariefRow | null {
    return currentTarieven.find((row) => row.jaar === year) ?? null;
  }

  const sourceTarief = useMemo(() => getTariefForYear(sourceYear), [currentTarieven, sourceYear]);
  const serverTargetTarief = useMemo(() => getTariefForYear(targetYear), [currentTarieven, targetYear]);

  const [draftTariefTarget, setDraftTariefTarget] = useState<TariefRow>(() => ({
    id: "",
    jaar: defaultSource + 1,
    tarief_hoog: 0,
    tarief_laag: 0,
    verbruikersbelasting: 0
  }));

  function setTargetYearWithDraft(nextYear: number) {
    setTargetYear(nextYear);
    setDraftTariefTarget((current) => ({ ...current, jaar: nextYear }));
  }

  const sourceProductie = useMemo(() => getProductieForYear(sourceYear), [currentProductie, sourceYear]);
  const serverTargetProductie = useMemo(() => getProductieForYear(targetYear), [currentProductie, targetYear]);

  function copyProductieFromSource() {
    if (!sourceProductie) return;
    setDraftProductieTarget(sourceProductie);
  }

  async function saveProductieTarget() {
    try {
      await saveDraftToServer(`Productie (concept) voor ${targetYear} opgeslagen.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Opslaan mislukt.");
    }
  }

  function copyTariefFromSource() {
    if (!sourceTarief) return;
    setDraftTariefTarget((current) => ({
      ...current,
      tarief_hoog: sourceTarief.tarief_hoog,
      tarief_laag: sourceTarief.tarief_laag,
      verbruikersbelasting: sourceTarief.verbruikersbelasting
    }));
  }

  async function saveTariefTarget() {
    try {
      const nextRow: TariefRow = {
        ...draftTariefTarget,
        id: String(draftTariefTarget.id ?? serverTargetTarief?.id ?? ""),
        jaar: targetYear,
        tarief_hoog: Number(draftTariefTarget.tarief_hoog ?? 0),
        tarief_laag: Number(draftTariefTarget.tarief_laag ?? 0),
        verbruikersbelasting: Number(draftTariefTarget.verbruikersbelasting ?? 0)
      };
      setDraftTariefTarget(nextRow);
      await saveDraftToServer(`Tarieven (concept) voor ${targetYear} opgeslagen.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Opslaan mislukt.");
    }
  }

  const packagingRowsForTarget = useMemo(() => {
    const byComponentId = new Map<string, PackagingPriceRow>();
    currentPackagingPrices
      .filter((row) => row.jaar === targetYear)
      .forEach((row) => byComponentId.set(row.verpakkingsonderdeel_id, row));

    return packagingComponents
      .map((component) => {
        const existing = byComponentId.get(component.id);
        return {
          componentId: component.id,
          omschrijving: component.omschrijving,
          prijs_per_stuk: Number(existing?.prijs_per_stuk ?? 0)
        };
      })
      .sort((a, b) => a.omschrijving.localeCompare(b.omschrijving, "nl-NL"));
  }, [currentPackagingPrices, packagingComponents, targetYear]);

  function loadDraftPackagingFromServer() {
    const next: Record<string, number> = {};
    packagingRowsForTarget.forEach((row) => {
      next[row.componentId] = row.prijs_per_stuk;
    });
    setDraftPackagingPrices(next);
  }


  function copyPackagingPricesFromSource() {
    const sourceByComponent = new Map<string, number>();
    currentPackagingPrices
      .filter((row) => row.jaar === sourceYear)
      .forEach((row) => sourceByComponent.set(row.verpakkingsonderdeel_id, row.prijs_per_stuk));

    const next: Record<string, number> = {};
    packagingComponents.forEach((component) => {
      next[component.id] = sourceByComponent.get(component.id) ?? 0;
    });
    setDraftPackagingPrices(next);
  }

  async function savePackagingPricesTarget() {
    try {
      const nextRows: PackagingPriceRow[] = packagingComponents.map((component) => ({
        id: "",
        verpakkingsonderdeel_id: component.id,
        jaar: targetYear,
        prijs_per_stuk: Number(draftPackagingPrices[component.id] ?? 0)
      }));
      setDraftPackagingPricesTarget(nextRows);
      await saveDraftToServer(`Verpakkingsprijzen (concept) voor ${targetYear} opgeslagen.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Opslaan mislukt.");
    }
  }

  function calcSellInPrice(cost: number, marginPct: number) {
    const margin = Number(marginPct ?? 0);
    if (!Number.isFinite(margin)) return cost;
    if (margin >= 100) return cost;
    return cost / Math.max(0.0001, 1 - margin / 100);
  }

  function computeHerverdelingTotals(rows: Array<Record<string, unknown>>) {
    return computeVasteKostenTotals(rows as any);
  }

  function fixedCostRowsForYear(year: number): Array<Record<string, unknown>> {
    const rows =
      year === targetYear
        ? sanitizeVasteKostenTarget(draftVasteKostenTarget)
        : ((currentVasteKosten as any)?.[String(year)] as unknown);
    return Array.isArray(rows) ? (rows as any) : [];
  }

  function computeIndirectFixedCostPerInkoopLiter(year: number) {
    return computeFixedCostPerLiterEngine({
      calcType: "inkoop",
      year,
      productieYear: getProductieForYear(year) as any,
      vasteKostenRows: fixedCostRowsForYear(year) as any
    });
  }

  function computeDirectFixedCostPerProductieLiter(year: number) {
    return computeFixedCostPerLiterEngine({
      calcType: "eigen_productie",
      year,
      productieYear: getProductieForYear(year) as any,
      vasteKostenRows: fixedCostRowsForYear(year) as any
    });
  }

  function computeAccijnsForLiters(year: number, record: any, liters: number) {
    const basis = typeof record?.basisgegevens === "object" && record?.basisgegevens ? record.basisgegevens : {};
    const bierSnap = typeof record?.bier_snapshot === "object" && record?.bier_snapshot ? record.bier_snapshot : {};
    if (!Number.isFinite(liters) || liters <= 0) return 0;

    const tariefRow =
      year === targetYear
        ? draftTariefTarget
        : getTariefForYear(year);
    if (!tariefRow) return 0;

    return computeAccijnsForLitersEngine({
      year,
      liters,
      basisgegevens: basis,
      bierSnapshot: bierSnap,
      tarievenHeffingenRow: tariefRow
    });
  }

  function calculateEigenProductiePrijsPerEenheid(regel: Partial<IngredientRule>) {
    const prijs = Number(regel.prijs ?? 0);
    const hoeveelheid = Number(regel.hoeveelheid ?? 0);
    if (!Number.isFinite(prijs) || !Number.isFinite(hoeveelheid) || hoeveelheid <= 0) return 0;
    return prijs / hoeveelheid;
  }

  function calculateEigenProductieKostenRecept(regel: Partial<IngredientRule>) {
    return calculateEigenProductiePrijsPerEenheid(regel) * Number(regel.benodigd_in_recept ?? 0);
  }

  function computeEigenProductieReceptTotals(override: EigenProductieOverride | null, batchGrootteLiters: number) {
    const regels = override?.ingredienten ?? [];
    const leveranciersTotaal = regels.reduce((sum, regel) => sum + Number(regel.prijs ?? 0), 0);
    const receptTotaal = regels.reduce((sum, regel) => sum + calculateEigenProductieKostenRecept(regel), 0);
    const literPrijs = batchGrootteLiters > 0 ? receptTotaal / batchGrootteLiters : 0;
    return {
      leveranciersTotaal,
      receptTotaal,
      literPrijs
    };
  }

  // NOTE: In verkoopstrategie we persist opslag% as the source of truth (legacy field name `sell_in_margins`).
  function computeSellInPrice(cost: number, opslagPct: number) {
    const c = clampNumber(cost, 0);
    const o = clampNumber(opslagPct, 0);
    return c * (1 + o / 100);
  }

  function computeMarginFromSellIn(cost: number, sellIn: number) {
    // Backwards-compatible name; this now returns opslag% derived from sell-in price.
    const c = clampNumber(cost, 0);
    const p = clampNumber(sellIn, 0);
    if (!Number.isFinite(c) || !Number.isFinite(p) || c <= 0) return 0;
    const opslag = (p / c - 1) * 100;
    if (!Number.isFinite(opslag)) return 0;
    return Math.max(0, opslag);
  }

  const basisParentForStrategy = useMemo(() => {
    const compositeDefs = (Array.isArray(initialSamengesteldeProducten) ? initialSamengesteldeProducten : [])
      .filter((row) => typeof row === "object" && row !== null)
      .map((row) => row as any);

    const basisParentMap = new Map<string, { productId: string; label: string; score: number }[]>();
    compositeDefs.forEach((row) => {
      const compositeId = String(row.id ?? "");
      const compositeLabel = String(row.omschrijving ?? "");
      const basisRows = Array.isArray(row.basisproducten) ? row.basisproducten : [];
      basisRows.forEach((basisRow: any) => {
        const basisId = String(basisRow.basisproduct_id ?? "");
        if (!basisId || basisId.startsWith("verpakkingsonderdeel:")) return;
        const current = basisParentMap.get(basisId) ?? [];
        const scoreRaw = Number(basisRow.aantal ?? 0);
        const score = Number.isFinite(scoreRaw) ? scoreRaw : 0;
        current.push({ productId: compositeId, label: compositeLabel, score });
        basisParentMap.set(basisId, current);
      });
    });

    const resolved = new Map<string, { productId: string; label: string }>();
    for (const [basisId, items] of basisParentMap.entries()) {
      if (!items || items.length === 0) continue;
      const sorted = [...items].sort((left, right) => {
        const scoreDiff = Number(right.score ?? 0) - Number(left.score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        const labelDiff = String(left.label ?? "").localeCompare(String(right.label ?? ""), "nl-NL");
        if (labelDiff !== 0) return labelDiff;
        return String(left.productId ?? "").localeCompare(String(right.productId ?? ""));
      });
      resolved.set(basisId, { productId: sorted[0].productId, label: sorted[0].label });
    }
    return resolved;
  }, [initialSamengesteldeProducten]);

  function followProductIdForStrategy(productId: string, productType: string) {
    if (productType !== "basis") return "";
    return basisParentForStrategy.get(productId)?.productId ?? "";
  }

  function getStrategyRowsForYear(year: number) {
    const rows = Array.isArray(currentVerkoopprijzen) ? currentVerkoopprijzen : [];
    return rows.filter((row) => STRATEGY_RECORD_TYPES.has(String((row as any)?.record_type ?? "")) && Number((row as any)?.jaar ?? 0) === year) as any[];
  }

  function readMarginFromStrategyRow(row: any, channel: string): number | null {
    const margins = row?.sell_in_margins ?? row?.kanaalmarges ?? {};
    if (!margins || typeof margins !== "object") return null;
    const raw = (margins as any)[channel];
    if (raw === "" || raw === null || raw === undefined) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  }

  function readSellInPriceFromStrategyRow(row: any, channel: string): number | null {
    const prices = row?.sell_in_prices ?? row?.kanaalprijzen ?? {};
    if (!prices || typeof prices !== "object") return null;
    const raw = (prices as any)[channel];
    if (raw === "" || raw === null || raw === undefined) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  }

  function effectiveSourceMargin(bierId: string, productId: string, productType: string, channel: string, defaultMargin: number) {
    const followId = followProductIdForStrategy(productId, productType);
    const keyProductId = followId || productId;
    const rows = getStrategyRowsForYear(sourceYear);
    const beerRow =
      rows.find((row) => String(row.record_type ?? "") === "verkoopstrategie_product" && String(row.bier_id ?? "") === bierId && String(row.product_id ?? "") === keyProductId) ??
      null;
    const beerMargin = readMarginFromStrategyRow(beerRow, channel);
    if (beerMargin !== null) return beerMargin;
    const packRow =
      rows.find((row) => String(row.record_type ?? "") === "verkoopstrategie_verpakking" && String(row.product_id ?? "") === keyProductId) ?? null;
    const packMargin = readMarginFromStrategyRow(packRow, channel);
    if (packMargin !== null) return packMargin;
    const yearRow = rows.find((row) => String(row.record_type ?? "") === "jaarstrategie") ?? null;
    const yearMargin = readMarginFromStrategyRow(yearRow, channel);
    if (yearMargin !== null) return yearMargin;
    return defaultMargin;
  }

  function explicitSourceSellInPrice(bierId: string, productId: string, productType: string, channel: string): number | null {
    const followId = followProductIdForStrategy(productId, productType);
    const keyProductId = followId || productId;
    const rows = getStrategyRowsForYear(sourceYear);
    const beerRow =
      rows.find((row) => String(row.record_type ?? "") === "verkoopstrategie_product" && String(row.bier_id ?? "") === bierId && String(row.product_id ?? "") === keyProductId) ??
      null;
    return readSellInPriceFromStrategyRow(beerRow, channel);
  }

  async function applyPricingScenario() {
    if (!conceptStarted) return;
    if (pricingMode === "free") {
      setStatus("Vrij invullen: geen automatische aanpassing toegepast.");
      return;
    }

    const channels = [
      { code: "horeca", label: "Horeca", defaultMargin: 50 },
      { code: "retail", label: "Supermarkt", defaultMargin: 30 },
      { code: "slijterij", label: "Slijterij", defaultMargin: 40 },
      { code: "zakelijk", label: "Speciaalzaak", defaultMargin: 45 }
    ] as const;

    setIsRunning(true);
    setStatus("");
    try {
      const nextRows = [...(Array.isArray(draftVerkoopstrategieTarget) ? (draftVerkoopstrategieTarget as any[]) : [])];

      const upsertBeerOverride = (bierId: string, biernaam: string, productId: string, productType: string, productLabel: string) => {
        const existingIndex = nextRows.findIndex(
          (row) =>
            String(row.record_type ?? "") === "verkoopstrategie_product" &&
            Number(row.jaar ?? 0) === targetYear &&
            String(row.bier_id ?? "") === bierId &&
            String(row.product_id ?? "") === productId
        );
        const base =
          existingIndex >= 0
            ? { ...(nextRows[existingIndex] as any) }
            : {
                id: "",
                record_type: "verkoopstrategie_product",
                jaar: targetYear,
                bron_jaar: sourceYear,
                bier_id: bierId,
                biernaam,
                product_id: productId,
                product_type: productType,
                verpakking: productLabel,
                strategie_type: "override",
                sell_in_margins: {},
                // Sell-out is being redesigned; store only sell-in pricing inputs for now.
              };
        if (!base.sell_in_margins || typeof base.sell_in_margins !== "object") base.sell_in_margins = {};
        if (existingIndex >= 0) nextRows[existingIndex] = base;
        else nextRows.push(base);
        return base as any;
      };

      previewRows.forEach((row) => {
        const bierId = row.bierId;
        const biernaam = row.biernaam;
        const productId = row.productId;
        const productType = row.productType;
        const followId = followProductIdForStrategy(productId, productType);
        const keyProductId = followId || productId;
        const sourceCost = clampNumber(row.sourceCost, 0);
        const targetCost = clampNumber(row.estimatedTargetCost, 0);

        channels.forEach((channel) => {
          const marginSource = effectiveSourceMargin(bierId, productId, productType, channel.code, channel.defaultMargin);
          const explicitSellIn = explicitSourceSellInPrice(bierId, productId, productType, channel.code);
          const sellInSource =
            explicitSellIn !== null ? explicitSellIn : computeSellInPrice(sourceCost, marginSource);

          let marginTarget = marginSource;
          if (pricingMode === "keep_price") {
            marginTarget = computeMarginFromSellIn(targetCost, sellInSource);
          } else if (pricingMode === "scale_cost_ratio") {
            const scaled =
              sourceCost > 0 ? sellInSource * (targetCost / Math.max(0.0001, sourceCost)) : sellInSource;
            marginTarget = computeMarginFromSellIn(targetCost, scaled);
          } else if (pricingMode === "keep_margin") {
            marginTarget = marginSource;
          }

          const overrideRow = upsertBeerOverride(bierId, biernaam, keyProductId, productType, row.productLabel);
          overrideRow.sell_in_margins[channel.code] = Math.round(clampNumber(marginTarget, 0) * 100) / 100;
        });
      });

      setDraftVerkoopstrategieTarget(nextRows);
      setCompletedStepIds((current) => (current.includes("verkoopstrategie") ? current : [...current, "verkoopstrategie"]));
      await saveDraftToServer(`Prijsstrategie toegepast voor ${targetYear}.`);
      setStatus(
        pricingMode === "scale_cost_ratio"
          ? "Toegepast: verkoopprijs stijgt mee (2B)."
          : pricingMode === "keep_margin"
            ? "Toegepast: marge% blijft gelijk (2A)."
            : "Toegepast: verkoopprijs blijft gelijk (1)."
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Toepassen mislukt.");
    } finally {
      setIsRunning(false);
    }
  }

  const previewRows = useMemo<PreviewRow[]>(() => {
    // Preview is intentionally "indicative": we adjust source-year cost by deltas we can derive
    // from the yearset (fixed costs per liter + packaging component prices).

    const baseDefs = (Array.isArray(initialBasisproducten) ? initialBasisproducten : [])
      .filter((row) => typeof row === "object" && row !== null)
      .map((row) => row as any);
    const compositeDefs = (Array.isArray(initialSamengesteldeProducten) ? initialSamengesteldeProducten : [])
      .filter((row) => typeof row === "object" && row !== null)
      .map((row) => row as any);

    const { packagingCost, litersPerUnit } = createPackagingResolvers({
      baseDefs,
      compositeDefs,
      packagingPrices: currentPackagingPrices as any,
      draftPackagingPrices,
      draftYear: targetYear
    });

    const versionById = new Map<string, any>();
    (Array.isArray(currentBerekeningen) ? currentBerekeningen : []).forEach((record: any) => {
      const basis = typeof record.basisgegevens === "object" && record.basisgegevens !== null ? record.basisgegevens : {};
      const jaar = Number(record.jaar ?? basis.jaar ?? 0);
      const statusVal = String(record.status ?? "").toLowerCase();
      if (jaar !== sourceYear || statusVal !== "definitief") return;
      const id = String(record.id ?? "");
      if (id) versionById.set(id, record);
    });

    const latestActivationByKey = new Map<string, any>();
    (Array.isArray(currentActivations) ? currentActivations : []).forEach((row: any) => {
      if (Number(row.jaar ?? 0) !== sourceYear) return;
      const bierId = String(row.bier_id ?? "");
      const productId = String(row.product_id ?? "");
      if (!bierId || !productId) return;
      const key = `${bierId}::${productId}`;
      const current = latestActivationByKey.get(key);
      const ts = String(row.effectief_vanaf ?? row.updated_at ?? "");
      const curTs = String(current?.effectief_vanaf ?? current?.updated_at ?? "");
      if (!current || ts.localeCompare(curTs) > 0) {
        latestActivationByKey.set(key, row);
      }
    });

    const bierNameById = new Map<string, string>();
    (Array.isArray(initialBieren) ? initialBieren : []).forEach((row: any) => {
      const id = String(row.id ?? "");
      const naam = String(row.naam ?? row.biernaam ?? "");
      if (id && naam) bierNameById.set(id, naam);
    });

    const channels = [
      { code: "horeca", naam: "Horeca", defaultMargin: 50 },
      { code: "retail", naam: "Supermarkt", defaultMargin: 30 },
      { code: "slijterij", naam: "Slijterij", defaultMargin: 40 },
      { code: "zakelijk", naam: "Speciaalzaak", defaultMargin: 45 }
    ] as const;

    // Map basisproducten -> "primary" composed product so basis rows can follow their composite strategy defaults.
    const compositeById = new Map<string, any>();
    compositeDefs.forEach((row) => {
      const id = String(row.id ?? "");
      if (id) compositeById.set(id, row);
    });
    const basisParentMap = new Map<string, { productId: string; label: string; score: number }[]>();
    compositeDefs.forEach((row) => {
      const compositeId = String(row.id ?? "");
      const compositeLabel = String(row.omschrijving ?? "");
      const basisRows = Array.isArray(row.basisproducten) ? row.basisproducten : [];
      basisRows.forEach((basisRow: any) => {
        const basisId = String(basisRow.basisproduct_id ?? "");
        if (!basisId || basisId.startsWith("verpakkingsonderdeel:")) return;
        const current = basisParentMap.get(basisId) ?? [];
        const scoreRaw = Number(basisRow.aantal ?? 0);
        const score = Number.isFinite(scoreRaw) ? scoreRaw : 0;
        current.push({ productId: compositeId, label: compositeLabel, score });
        basisParentMap.set(basisId, current);
      });
    });
    const resolvedBasisParent = new Map<string, { productId: string; label: string }>();
    for (const [basisId, items] of basisParentMap.entries()) {
      if (!items || items.length === 0) continue;
      const sorted = [...items].sort((left, right) => {
        const scoreDiff = Number(right.score ?? 0) - Number(left.score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        const labelDiff = String(left.label ?? "").localeCompare(String(right.label ?? ""), "nl-NL");
        if (labelDiff !== 0) return labelDiff;
        return String(left.productId ?? "").localeCompare(String(right.productId ?? ""));
      });
      resolvedBasisParent.set(basisId, { productId: sorted[0].productId, label: sorted[0].label });
    }

    const STRATEGY_TYPES = new Set(["jaarstrategie", "verkoopstrategie_product", "verkoopstrategie_verpakking"]);
    const verkoopStrategyRows = (Array.isArray(draftVerkoopstrategieTarget) && draftVerkoopstrategieTarget.length > 0
      ? draftVerkoopstrategieTarget
      : currentVerkoopprijzen
    )
      .filter((row) => row && typeof row === "object" && STRATEGY_TYPES.has(String((row as any).record_type ?? "")))
      .map((row) => row as any);

    function followProductIdFor(productId: string, productType: string) {
      if (productType !== "basis") return "";
      return resolvedBasisParent.get(productId)?.productId ?? "";
    }

    function getYearStrategyRow(year: number) {
      return verkoopStrategyRows.find((row) => String(row.record_type ?? "") === "jaarstrategie" && Number(row.jaar ?? 0) === year) ?? null;
    }

    function getPackagingStrategyRow(year: number, productId: string) {
      return verkoopStrategyRows.find(
        (row) =>
          String(row.record_type ?? "") === "verkoopstrategie_verpakking" &&
          Number(row.jaar ?? 0) === year &&
          String(row.product_id ?? "") === productId
      ) ?? null;
    }

    function getBeerStrategyRow(year: number, bierId: string, productId: string) {
      return verkoopStrategyRows.find(
        (row) =>
          String(row.record_type ?? "") === "verkoopstrategie_product" &&
          Number(row.jaar ?? 0) === year &&
          String(row.bier_id ?? "") === bierId &&
          String(row.product_id ?? "") === productId
      ) ?? null;
    }

    function marginFromStrategy(row: any, code: string): number | null {
      const margins = row?.sell_in_margins ?? row?.kanaalmarges ?? {};
      if (!margins || typeof margins !== "object") return null;
      const raw = (margins as any)[code];
      if (raw === "" || raw === null || raw === undefined) return null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return null;
      return parsed;
    }

    function effectiveMargin(year: number, bierId: string, productId: string, productType: string, code: string, defaultMargin: number) {
      const followId = followProductIdFor(productId, productType);
      const keyProductId = followId || productId;
      const beerRow = getBeerStrategyRow(year, bierId, keyProductId);
      const beerMargin = marginFromStrategy(beerRow, code);
      if (beerMargin !== null) return beerMargin;
      const packRow = getPackagingStrategyRow(year, keyProductId);
      const packMargin = marginFromStrategy(packRow, code);
      if (packMargin !== null) return packMargin;
      const yearRow = getYearStrategyRow(year);
      const yearMargin = marginFromStrategy(yearRow, code);
      if (yearMargin !== null) return yearMargin;
      return defaultMargin;
    }

    const out: PreviewRow[] = [];

    latestActivationByKey.forEach((activation) => {
      const bierId = String(activation.bier_id ?? "");
      const productId = String(activation.product_id ?? "");
      const versionId = String(activation.kostprijsversie_id ?? "");
      const record = versionById.get(versionId);
      if (!record) return;
      const snap = snapshotProductCostFromRecord(record, productId);
      if (!snap) return;

      const sourceCost = Number(snap.kostprijs ?? 0);
      const sourcePrimary = Number(snap.primaireKosten ?? 0);
      const otherCost = sourceCost - sourcePrimary;
      const scenarioKey = `${bierId}::${productId}`;
      const scenarioPrimaryRaw = Object.prototype.hasOwnProperty.call(scenarioPrimaryCosts, scenarioKey)
        ? Number(scenarioPrimaryCosts[scenarioKey] ?? sourcePrimary)
        : sourcePrimary;
      const scenarioPrimary = Number.isFinite(scenarioPrimaryRaw) ? scenarioPrimaryRaw : sourcePrimary;
      const productType = String(snap.productType ?? "");
      const basePackaging = packagingCost(productId, productType as any, sourceYear);
      const targetPackaging = packagingCost(productId, productType as any, targetYear);
      const packagingDelta = targetPackaging - basePackaging;
      const liters = litersPerUnit(productId, productType as any, targetYear);
      const calcTypeRaw = String(record?.type ?? record?.soort_berekening?.type ?? "").trim().toLowerCase();
      const calcType = calcTypeRaw === "inkoop" ? "inkoop" : "eigen_productie";
      const fixedPerLiterSource =
        calcType === "inkoop"
          ? computeIndirectFixedCostPerInkoopLiter(sourceYear)
          : computeDirectFixedCostPerProductieLiter(sourceYear);
      const fixedPerLiterTarget =
        calcType === "inkoop"
          ? computeIndirectFixedCostPerInkoopLiter(targetYear)
          : computeDirectFixedCostPerProductieLiter(targetYear);
      const fixedDelta = (fixedPerLiterTarget - fixedPerLiterSource) * Number(liters ?? 0);

      const litersValue = Number(liters ?? 0);
      const override = eigenProductieOverrides[bierId] ?? null;
      const recordTarget =
        calcType === "eigen_productie" && override
          ? {
              ...record,
              basisgegevens: {
                ...(typeof record?.basisgegevens === "object" && record?.basisgegevens ? record.basisgegevens : {}),
                alcoholpercentage: Number(override.alcoholpercentage ?? 0),
                tarief_accijns: override.tarief_accijns
              },
              bier_snapshot: {
                ...(typeof record?.bier_snapshot === "object" && record?.bier_snapshot ? record.bier_snapshot : {}),
                alcoholpercentage: Number(override.alcoholpercentage ?? 0),
                tarief_accijns: override.tarief_accijns
              }
            }
          : record;

      const accijnsSource = computeAccijnsForLiters(sourceYear, record, litersValue);
      const accijnsTarget = computeAccijnsForLiters(targetYear, recordTarget, litersValue);

      let estimatedTargetCost = 0;
      if (calcType === "inkoop") {
        const scenarioBaseCost = scenarioPrimary + otherCost;
        const accijnsDelta = accijnsTarget - accijnsSource;
        estimatedTargetCost = scenarioBaseCost + packagingDelta + fixedDelta + accijnsDelta;
      } else {
        const batchGrootte = Number(getProductieForYear(targetYear)?.batchgrootte_eigen_productie_l ?? 0);
        const totals = override ? computeEigenProductieReceptTotals(override, batchGrootte) : null;
        const primaireTarget = totals ? totals.literPrijs * litersValue : sourcePrimary;
        const vasteTarget = fixedPerLiterTarget * litersValue;
        estimatedTargetCost = primaireTarget + targetPackaging + vasteTarget + accijnsTarget;
      }
      const sellIn = Object.fromEntries(
        channels.map((channel) => {
          const margin = effectiveMargin(targetYear, bierId, productId, productType, channel.code, channel.defaultMargin);
          return [channel.code, calcSellInPrice(estimatedTargetCost, margin)];
        })
      ) as Record<string, number>;

      out.push({
        bierId,
        biernaam: bierNameById.get(bierId) ?? String(((record.basisgegevens ?? {}) as any)?.biernaam ?? bierId),
        productId,
        productType: productType === "basis" || productType === "samengesteld" ? (productType as any) : "",
        calcType,
        productLabel: snap.productLabel,
        sourcePrimaryCost: sourcePrimary,
        sourceCost,
        estimatedTargetCost,
        delta: estimatedTargetCost - sourceCost,
        sellIn
      });
    });

    out.sort((a, b) => (a.biernaam + a.productLabel).localeCompare(b.biernaam + b.productLabel, "nl-NL"));
    return out;
  }, [
    currentActivations,
    currentBerekeningen,
    currentTarieven,
    currentPackagingPrices,
    currentProductie,
    currentVasteKosten,
    currentVerkoopprijzen,
    draftVerkoopstrategieTarget,
    draftPackagingPrices,
    draftProductieTarget,
    draftTariefTarget,
    draftVasteKostenTarget,
    initialBasisproducten,
    initialBieren,
    initialSamengesteldeProducten,
    eigenProductieOverrides,
    scenarioPrimaryCosts,
    sourceYear,
    targetYear
  ]);

  const inkoopScenarioRows = useMemo(() => previewRows.filter((row) => row.calcType === "inkoop"), [previewRows]);

  const eigenProductieBieren = useMemo(() => {
    const out = new Map<string, { bierId: string; biernaam: string; stijl: string; alcoholpercentage: number }>();
    (Array.isArray(currentBerekeningen) ? currentBerekeningen : []).forEach((record: any) => {
      const basis = typeof record.basisgegevens === "object" && record.basisgegevens !== null ? record.basisgegevens : {};
      const jaar = Number(record.jaar ?? basis.jaar ?? 0);
      const statusVal = String(record.status ?? "").toLowerCase();
      if (jaar !== sourceYear || statusVal !== "definitief") return;
      const calcTypeRaw = String(record?.type ?? record?.soort_berekening?.type ?? "").trim().toLowerCase();
      if (calcTypeRaw === "inkoop") return;
      const bierId = String(record.bier_id ?? basis.bier_id ?? "");
      const biernaam = String(basis.biernaam ?? "");
      if (!bierId || !biernaam) return;
      if (out.has(bierId)) return;
      out.set(bierId, {
        bierId,
        biernaam,
        stijl: String(basis.stijl ?? ""),
        alcoholpercentage: Number(basis.alcoholpercentage ?? 0)
      });
    });
    return Array.from(out.values()).sort((a, b) => a.biernaam.localeCompare(b.biernaam, "nl-NL"));
  }, [currentBerekeningen, sourceYear]);

  const sourceEigenProductieVersionByBierId = useMemo(() => {
    const out = new Map<string, any>();
    (Array.isArray(currentBerekeningen) ? currentBerekeningen : []).forEach((record: any) => {
      const basis = typeof record.basisgegevens === "object" && record.basisgegevens !== null ? record.basisgegevens : {};
      const jaar = Number(record.jaar ?? basis.jaar ?? 0);
      const statusVal = String(record.status ?? "").toLowerCase();
      if (jaar !== sourceYear || statusVal !== "definitief") return;
      const calcTypeRaw = String(record?.type ?? record?.soort_berekening?.type ?? "").trim().toLowerCase();
      if (calcTypeRaw === "inkoop") return;
      const bierId = String(record.bier_id ?? basis.bier_id ?? "");
      if (!bierId) return;
      if (out.has(bierId)) return;
      out.set(bierId, record);
    });
    return out;
  }, [currentBerekeningen, sourceYear]);

  // Initialize missing overrides from the bronjaar recipes so the user can tweak right away.
  useEffect(() => {
    if (!conceptStarted) return;
    if (!copyProductie) return;
    const batch = Number(draftProductieTarget.batchgrootte_eigen_productie_l ?? 0);
    if (!Number.isFinite(batch)) return;
    setEigenProductieOverrides((current) => {
      let changed = false;
      const next = { ...current };
      eigenProductieBieren.forEach((bier) => {
        const bierId = bier.bierId;
        if (!bierId || next[bierId]) return;
        const sourceVersion = sourceEigenProductieVersionByBierId.get(bierId);
        const basis = typeof sourceVersion?.basisgegevens === "object" && sourceVersion?.basisgegevens ? sourceVersion.basisgegevens : {};
        const invoer = typeof sourceVersion?.invoer === "object" && sourceVersion?.invoer ? sourceVersion.invoer : {};
        const ingredienten = (((invoer as any).ingredienten ?? {}) as any).regels;
        next[bierId] = {
          alcoholpercentage: Number(basis.alcoholpercentage ?? bier.alcoholpercentage ?? 0) || 0,
          tarief_accijns: String(basis.tarief_accijns ?? "Hoog") === "Laag" ? "Laag" : "Hoog",
          ingredienten: (Array.isArray(ingredienten) ? ingredienten : [])
            .filter((row) => row && typeof row === "object")
            .map((row: any) => ({
              id: String(row.id ?? createUiId()),
              ingredient: String(row.ingredient ?? ""),
              omschrijving: String(row.omschrijving ?? ""),
              hoeveelheid: Number(row.hoeveelheid ?? 0),
              eenheid: String(row.eenheid ?? ""),
              prijs: Number(row.prijs ?? 0),
              benodigd_in_recept: Number(row.benodigd_in_recept ?? 0)
            }))
        };
        changed = true;
      });
      return changed ? next : current;
    });
  }, [
    conceptStarted,
    copyProductie,
    draftProductieTarget.batchgrootte_eigen_productie_l,
    eigenProductieBieren,
    sourceEigenProductieVersionByBierId
  ]);

  const kostprijsTargetRows = useMemo(() => {
    const baseDefs = (Array.isArray(initialBasisproducten) ? initialBasisproducten : [])
      .filter((row) => typeof row === "object" && row !== null)
      .map((row) => row as any);
    const compositeDefs = (Array.isArray(initialSamengesteldeProducten) ? initialSamengesteldeProducten : [])
      .filter((row) => typeof row === "object" && row !== null)
      .map((row) => row as any);

    const { packagingCost, litersPerUnit } = createPackagingResolvers({
      baseDefs,
      compositeDefs,
      packagingPrices: currentPackagingPrices as any,
      draftPackagingPrices,
      draftYear: targetYear
    });

    const versionById = new Map<string, any>();
    (Array.isArray(currentBerekeningen) ? currentBerekeningen : []).forEach((record: any) => {
      const basis = typeof record.basisgegevens === "object" && record.basisgegevens !== null ? record.basisgegevens : {};
      const jaar = Number(record.jaar ?? basis.jaar ?? 0);
      const statusVal = String(record.status ?? "").toLowerCase();
      if (jaar !== sourceYear || statusVal !== "definitief") return;
      const id = String(record.id ?? "");
      if (id) versionById.set(id, record);
    });

    const latestActivationByKey = new Map<string, any>();
    (Array.isArray(currentActivations) ? currentActivations : []).forEach((row: any) => {
      if (Number(row.jaar ?? 0) !== sourceYear) return;
      const bierId = String(row.bier_id ?? "");
      const productId = String(row.product_id ?? "");
      if (!bierId || !productId) return;
      const key = `${bierId}::${productId}`;
      const current = latestActivationByKey.get(key);
      const ts = String(row.effectief_vanaf ?? row.updated_at ?? "");
      const curTs = String(current?.effectief_vanaf ?? current?.updated_at ?? "");
      if (!current || ts.localeCompare(curTs) > 0) {
        latestActivationByKey.set(key, row);
      }
    });

    const bierNameById = new Map<string, string>();
    (Array.isArray(initialBieren) ? initialBieren : []).forEach((row: any) => {
      const id = String(row.id ?? "");
      const naam = String(row.naam ?? row.biernaam ?? "");
      if (id && naam) bierNameById.set(id, naam);
    });

    const basisRows: KostprijsPreviewRow[] = [];
    const samengRows: KostprijsPreviewRow[] = [];

    latestActivationByKey.forEach((activation) => {
      const bierId = String(activation.bier_id ?? "");
      const productId = String(activation.product_id ?? "");
      const versionId = String(activation.kostprijsversie_id ?? "");
      const record = versionById.get(versionId);
      if (!record) return;
      const snap = snapshotProductCostFromRecord(record, productId);
      if (!snap) return;

      const productType = String(snap.productType ?? "");
      if (productType !== "basis" && productType !== "samengesteld") return;

      const calcType = String(record?.type ?? record?.soort_berekening?.type ?? "").trim().toLowerCase();
      const soortLabel = calcType === "inkoop" ? "Inkoop" : "Eigen productie";

      const liters = Number(litersPerUnit(productId, productType as any, targetYear) ?? 0) || 0;
      const sourcePrimary = Number(snap.primaireKosten ?? 0);
      const scenarioKey = `${bierId}::${productId}`;
      const scenarioPrimary = Object.prototype.hasOwnProperty.call(scenarioPrimaryCosts, scenarioKey)
        ? Number(scenarioPrimaryCosts[scenarioKey] ?? sourcePrimary)
        : sourcePrimary;
      let primaireKosten = Number.isFinite(scenarioPrimary) ? scenarioPrimary : sourcePrimary;
      const override = eigenProductieOverrides[bierId] ?? null;
      const recordTarget =
        calcType !== "inkoop" && override
          ? {
              ...record,
              basisgegevens: {
                ...(typeof record?.basisgegevens === "object" && record?.basisgegevens ? record.basisgegevens : {}),
                alcoholpercentage: Number(override.alcoholpercentage ?? 0),
                tarief_accijns: override.tarief_accijns
              },
              bier_snapshot: {
                ...(typeof record?.bier_snapshot === "object" && record?.bier_snapshot ? record.bier_snapshot : {}),
                alcoholpercentage: Number(override.alcoholpercentage ?? 0),
                tarief_accijns: override.tarief_accijns
              }
            }
          : record;
      if (calcType !== "inkoop" && override) {
        const batchGrootte = Number(getProductieForYear(targetYear)?.batchgrootte_eigen_productie_l ?? 0);
        const totals = computeEigenProductieReceptTotals(override, batchGrootte);
        primaireKosten = totals.literPrijs * liters;
      }

      const verpakkingskosten = calcType === "inkoop" ? 0 : packagingCost(productId, productType as any, targetYear);
      const vastePerLiter = computeFixedCostPerLiterEngine({
        calcType: calcType === "inkoop" ? "inkoop" : "eigen_productie",
        year: targetYear,
        productieYear: getProductieForYear(targetYear) as any,
        vasteKostenRows: fixedCostRowsForYear(targetYear) as any
      });
      const vasteKosten = vastePerLiter * liters;
      const accijns = computeAccijnsForLiters(targetYear, recordTarget, liters);
      const kostprijs = primaireKosten + verpakkingskosten + vasteKosten + accijns;

      const row: KostprijsPreviewRow = {
        biernaam:
          bierNameById.get(bierId) ??
          String(((record.basisgegevens ?? {}) as any)?.biernaam ?? bierId),
        soort: soortLabel,
        product_type: productType as any,
        verpakkingseenheid: String(snap.productLabel ?? productId),
        primaire_kosten: primaireKosten,
        verpakkingskosten,
        vaste_kosten: vasteKosten,
        accijns,
        kostprijs
      };

      if (productType === "samengesteld") {
        samengRows.push(row);
      } else {
        basisRows.push(row);
      }
    });

    function sortKey(row: KostprijsPreviewRow) {
      return `${row.biernaam}::${row.verpakkingseenheid}`;
    }

    basisRows.sort((a, b) => sortKey(a).localeCompare(sortKey(b), "nl-NL"));
    samengRows.sort((a, b) => sortKey(a).localeCompare(sortKey(b), "nl-NL"));

    return { basisRows, samengRows };
  }, [
    currentActivations,
    currentBerekeningen,
    currentPackagingPrices,
    currentProductie,
    currentTarieven,
    currentVasteKosten,
    draftPackagingPrices,
    draftProductieTarget,
    draftTariefTarget,
    draftVasteKostenTarget,
    initialBasisproducten,
    initialBieren,
    initialSamengesteldeProducten,
    eigenProductieOverrides,
    scenarioPrimaryCosts,
    sourceYear,
    targetYear
  ]);

  const steps: WizardStep[] = useMemo(
    () => [
      {
        id: "basis",
        label: "Basisgegevens",
        description: "Kies bronjaar en doeljaar",
        panelTitle: "Jaarselectie",
        panelDescription: "Selecteer het bronjaar. Het doeljaar wordt automatisch ingesteld op bronjaar + 1."
      },
      {
        id: "init",
        label: "Jaarset",
        description: "Stel concept samen voor het doeljaar",
        panelTitle: "Jaarset initialiseren",
        panelDescription:
          "Kies welke stamdata je wilt klaarmaken voor het doeljaar. Totdat je afrondt schrijven we nog niets definitief weg."
      },
      {
        id: "productie",
        label: "Productie",
        description: "Productie-instellingen voor het doeljaar",
        panelTitle: "Productie",
        panelDescription: `Controleer bronjaar ${sourceYear} en vul de productiegegevens voor ${targetYear} in.`
      },
      {
        id: "tarieven",
        label: "Tarieven",
        description: "Accijns en heffingen voor het doeljaar",
        panelTitle: "Tarieven & heffingen",
        panelDescription: `Controleer bronjaar ${sourceYear} en vul het doeljaar ${targetYear} in.`
      },
      {
        id: "vaste-kosten",
        label: "Vaste kosten",
        description: "Indirecte/directe kosten voor het doeljaar",
        panelTitle: `Vaste kosten ${targetYear}`,
        panelDescription: "Bekijk bronjaar (read-only) en vul vaste kosten voor het doeljaar bewust in; jaar is vastgezet op het doeljaar."
      },
      {
        id: "verpakking",
        label: "Verpakking",
        description: "Jaarprijzen voor verpakkingsonderdelen",
        panelTitle: `Verpakkingsonderdelen ${targetYear}`,
        panelDescription: "Werk de jaarprijzen bij. Dit stuurt basis- en samengestelde productkosten."
      },
      {
        id: "inkoop-scenario",
        label: "Inkoop scenario",
        description: "Scenario inkoopprijzen (niet opslaan)",
        panelTitle: `Inkoop scenario ${targetYear}`,
        panelDescription:
          "Vul scenario inkoopprijzen (primair/inkoopdeel) in om direct de impact op kostprijs en verkoopprijzen te zien. Deze waarden worden niet opgeslagen."
      },
      {
        id: "recepten",
        label: "Recepten",
        description: "Eigen productie (recept en ingredienten)",
        panelTitle: `Recepten ${targetYear}`,
        panelDescription:
          "Voor bieren met eigen productie kun je recept/ingredienten bijstellen. Dit doe je via Kostprijs beheren; de wizard toont hier alleen welke bieren dit betreft."
      },
      {
        id: "kostprijs",
        label: "Kostprijs",
        description: `Kostprijs ${targetYear} (opbouw)`,
        panelTitle: `Kostprijs ${targetYear}`,
        panelDescription: "Bekijk de opbouw per bier en verpakkingseenheid op basis van jouw doeljaar-invoer en scenario."
      },
      {
        id: "verkoopstrategie",
        label: "Verkoopstrategie",
        description: "Verkoopprijsinstellingen (opslag/prijs) voor het doeljaar",
        panelTitle: `Verkoopstrategie ${targetYear}`,
        panelDescription: "Controleer en pas marges/prijzen aan voor het doeljaar."
      },
      {
        id: "adviesprijzen",
        label: "Adviesprijzen",
        description: "Adviesopslag per kanaal (sell-out) voor het doeljaar",
        panelTitle: `Adviesprijzen ${targetYear}`,
        panelDescription:
          "Vul per kanaal de opslag in waarmee een adviesverkoopprijs (sell-out) wordt afgeleid uit onze verkoopprijs."
      },
      {
        id: "preview",
        label: "Preview",
        description: "Bekijk de impact op kostprijzen en verkoopprijzen",
        panelTitle: `Preview ${targetYear}`,
        panelDescription:
          "Indicatieve kostprijzen voor het doeljaar op basis van jouw ingevulde gegevens (en scenario inkoopprijzen)."
      },
      {
        id: "afronden",
        label: "Afronden",
        description: "Controleer en ga terug naar de app",
        panelTitle: "Afronden",
        panelDescription:
          "Schrijf het doeljaar definitief weg (1 transactie) of bewaar je voortgang als concept."
      }
    ],
    [sourceYear, targetYear]
  );

  const currentStep = steps[activeStep] ?? steps[0];

  function isStepEnabled(stepId: string) {
    if (stepId === "basis" || stepId === "init") return true;
    if (!conceptStarted) return false;
    if (stepId === "productie") return copyProductie;
    if (stepId === "tarieven") return copyTarieven;
    if (stepId === "vaste-kosten") return copyVasteKosten;
    if (stepId === "verpakking") return copyVerpakkingsonderdelen;
    if (stepId === "verkoopstrategie") return copyVerkoopstrategie;
    if (stepId === "adviesprijzen") return copyVerkoopstrategie;
    return true;
  }

  function findNearestEnabledStepIndex(fromIndex: number, direction: -1 | 1) {
    let idx = fromIndex;
    while (idx >= 0 && idx < steps.length) {
      const step = steps[idx];
      if (step && isStepEnabled(step.id)) return idx;
      idx += direction;
    }
    return fromIndex;
  }
  const wizardSidebar = useMemo(
    () => ({
      title: `Nieuw jaar ${targetYear} voorbereiden`,
      steps: steps.map((step) => {
        return { id: step.id, label: step.label, description: step.description, disabled: !isStepEnabled(step.id) };
      }),
      activeIndex: activeStep,
      onStepSelect: (nextIndex: number) => {
        const nextStep = steps[nextIndex];
        if (!nextStep) return;
        if (nextStep.id === "basis" || nextStep.id === "init") {
          void navigateToStep(nextIndex);
          return;
        }
        if (!conceptStarted) {
          setStatus(`Start eerst het concept voor ${targetYear} via stap 2 (Jaarset).`);
          return;
        }
        if (!isStepEnabled(nextStep.id)) {
          setStatus(`Deze stap is uitgeschakeld omdat je hem in Jaarset niet hebt aangevinkt.`);
          return;
        }
        void navigateToStep(nextIndex);
      }
    }),
    [
      activeStep,
      conceptStarted,
      copyProductie,
      copyTarieven,
      copyVasteKosten,
      copyVerpakkingsonderdelen,
      copyVerkoopstrategie,
      steps,
      targetYear
    ]
  );

  const pageHeader = useMemo(
    () => ({
      title: `Nieuw jaar ${targetYear} voorbereiden`,
      subtitle: `Maak een nieuwe jaarset aan op basis van bronjaar ${sourceYear}.`
    }),
    [sourceYear, targetYear]
  );

  usePageShellHeader(pageHeader);

  const saveAndCloseButton = (
    <button
      type="button"
      className="editor-button editor-button-secondary"
      onClick={() => void saveAndClose()}
      disabled={isRunning}
    >
      Opslaan en sluiten
    </button>
  );

  return (
    <div className="cpq-root">
      <div className="cpq-frame">
        <div className="cpq-topbar">
          <div>
            <div className="cpq-kicker">Nieuw jaar wizard</div>
            <h1 className="cpq-title">Nieuw jaar {targetYear} voorbereiden</h1>
            <div className="module-card-text" style={{ marginTop: 6, maxWidth: 760 }}>
              Bouw een nieuw productiejaar op basis van een bronjaar. Je kunt tussentijds opslaan als concept; pas bij
              afronden schrijven we alles in 1 keer definitief weg. Een concept kun je verwijderen; rollback van een
              definitieve jaarset doe je via Beheer.
            </div>
          </div>
          <div className="cpq-topbar-actions">
            <button
              type="button"
              className="editor-button editor-button-secondary"
              onClick={() => router.push("/")}
              disabled={isRunning}
            >
              Terug
            </button>
            {conceptStarted ? (
              <button
                type="button"
                className="editor-button editor-button-secondary editor-button-icon"
                onClick={() => void deleteConcept()}
                disabled={isRunning}
                aria-label="Verwijder concept"
                title="Verwijder concept"
              >
                <TrashIcon />
              </button>
            ) : null}
            <span className="pill">
              Bronjaar {sourceYear} -&gt; Doeljaar {targetYear}
            </span>
          </div>
        </div>

        <div className="cpq-grid">
          <aside className="cpq-left">
            <WizardSteps
              title={wizardSidebar.title}
              steps={wizardSidebar.steps.map((step) => ({
                id: step.id,
                title: step.label,
                description: step.description,
                disabled: step.disabled
              }))}
              activeIndex={wizardSidebar.activeIndex}
              onSelect={(index) => wizardSidebar.onStepSelect?.(index)}
            />

            <div className="cpq-quick">
              <div className="cpq-quick-title">Quick view</div>
              <div className="cpq-quick-grid">
                <QuickCell label="Bronjaar" value={String(sourceYear)} />
                <QuickCell label="Doeljaar" value={String(targetYear)} />
                <QuickCell label="Concept" value={conceptStarted ? "Ja" : "Nee"} />
                <QuickCell label="Actieve stap" value={`Stap ${activeStep + 1}`} />
              </div>
            </div>
          </aside>

          <main className="cpq-main">
            <div className="wizard-shell wizard-shell-single" style={{ marginTop: 0 }}>
              <div className="wizard-step-card wizard-step-stage-card">
          <div className="wizard-step-header">
            <div>
              <div className="wizard-step-title">
                Stap {activeStep + 1}: {currentStep.panelTitle}
              </div>
              <div className="wizard-step-description">{currentStep.panelDescription}</div>
            </div>
          </div>

          {status ? <div className="wizard-step-status">{status}</div> : null}

          <div className="wizard-step-body">
            {activeStep === 0 ? (
              <div className="wizard-form-grid">
              <label className="nested-field">
                <span>Bronjaar</span>
                <select
                  className="dataset-input"
                  value={String(sourceYear)}
                  onChange={(event) => {
                    const nextSource = clampInt(event.target.value, defaultSource);
                    setSourceYear(nextSource);
                    setTargetYearWithDraft(nextSource + 1);
                  }}
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="nested-field">
                <span>Doeljaar</span>
                <input
                  className="dataset-input dataset-input-readonly"
                  type="number"
                  value={targetYear}
                  readOnly
                />
              </label>

              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group" />
                <div className="editor-actions-group">
                  {saveAndCloseButton}
                  <button type="button" className="editor-button" onClick={() => void navigateToStep(1)}>
                    Volgende
                  </button>
                </div>
              </div>
              </div>
            ) : null}

            {activeStep === 1 ? (
              <div>
              <div className="editor-status" style={{ marginBottom: 14 }}>
                Selecteer de stamdata die klaargezet moet worden voor <strong>{targetYear}</strong> op basis van bronjaar{" "}
                <strong>{sourceYear}</strong>. Daarna vul je per onderdeel de nieuwe parameters voor {targetYear} in. Pas bij{" "}
                <strong>Afronden</strong> wordt de data definitief opgeslagen en zichtbaar in de applicatie.
                <div className="muted" style={{ marginTop: 8 }}>
                  Niet aangevinkt: dat onderdeel wordt niet voorbereid in dit concept en de bijbehorende stap blijft uitgeschakeld.
                </div>
              </div>
              <div className="record-card-grid">
                {[
                  ["Productie", copyProductie, setCopyProductie],
                  ["Vaste kosten (nieuw invullen)", copyVasteKosten, setCopyVasteKosten],
                  ["Tarieven en heffingen", copyTarieven, setCopyTarieven],
                  ["Verpakkingsonderdelen (jaarprijzen)", copyVerpakkingsonderdelen, setCopyVerpakkingsonderdelen],
                  ["Verkoopstrategie", copyVerkoopstrategie, setCopyVerkoopstrategie]
                ].map(([label, value, setter]) => (
                  <label key={String(label)} className="wizard-toggle-card">
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) => (setter as any)(event.target.checked)}
                    />
                    <span>{String(label)}</span>
                  </label>
                ))}
              </div>

              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => void navigateToStep(0)}
                    disabled={isRunning}
                  >
                    Vorige
                  </button>
                </div>
                <div className="editor-actions-group">
                  {saveAndCloseButton}
                  <button
                    type="button"
                    className="editor-button primary"
                    onClick={initializeYear}
                    disabled={isRunning || !canInitialize || conceptStarted}
                  >
                    Start concept {targetYear}
                  </button>
                </div>
              </div>
              </div>
            ) : null}

          {activeStep === 2 ? (
            <div>
              <div className="dataset-editor-scroll">
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th style={{ width: "260px" }}></th>
                      <th style={{ width: "260px" }}>Bronjaar {sourceYear}</th>
                      <th style={{ width: "260px" }}>Doeljaar {targetYear}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Hoeveelheid inkoop (L)", "hoeveelheid_inkoop_l"],
                      ["Hoeveelheid productie (L)", "hoeveelheid_productie_l"],
                      ["Batchgrootte eigen productie (L)", "batchgrootte_eigen_productie_l"]
                    ].map(([label, key]) => (
                      <tr key={String(key)}>
                        <td>
                          <strong>{String(label)}</strong>
                        </td>
                        <td>
                          <input
                            className="dataset-input dataset-input-readonly"
                            type="number"
                            value={String(Number((sourceProductie as any)?.[key] ?? 0))}
                            readOnly
                          />
                        </td>
                        <td>
                          <input
                            className="dataset-input"
                            type="number"
                            value={String(Number((draftProductieTarget as any)?.[key] ?? 0))}
                            onChange={(event) =>
                              setDraftProductieTarget((current) => ({
                                ...current,
                                [key]: Number(event.target.value)
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => void navigateToStep(1)}
                    disabled={isRunning}
                  >
                    Vorige
                  </button>
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={copyProductieFromSource}
                    disabled={!sourceProductie}
                  >
                    Kopieer bronjaar
                  </button>
                </div>
                <div className="editor-actions-group">
                  {saveAndCloseButton}
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={saveProductieTarget}
                    disabled={isRunning}
                  >
                    Opslaan
                  </button>
                  <button type="button" className="editor-button" onClick={() => void navigateToStep(3)} disabled={isRunning}>
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 3 ? (
            <div>
              <div className="dataset-editor-scroll">
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th style={{ width: "260px" }}></th>
                      <th style={{ width: "260px" }}>Bronjaar {sourceYear}</th>
                      <th style={{ width: "260px" }}>Doeljaar {targetYear}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Tarief hoog", "tarief_hoog"],
                      ["Tarief laag", "tarief_laag"],
                      ["Verbruikersbelasting", "verbruikersbelasting"]
                    ].map(([label, key]) => (
                      <tr key={String(key)}>
                        <td>
                          <strong>{String(label)}</strong>
                        </td>
                        <td>
                          <input
                            className="dataset-input dataset-input-readonly"
                            type="number"
                            value={String(Number((sourceTarief as any)?.[key] ?? 0))}
                            readOnly
                          />
                        </td>
                        <td>
                          <input
                            className="dataset-input"
                            type="number"
                            value={String(Number((draftTariefTarget as any)?.[key] ?? 0))}
                            onChange={(event) =>
                              setDraftTariefTarget((current) => ({
                                ...current,
                                [key]: Number(event.target.value)
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => void navigateToStep(2)}
                    disabled={isRunning}
                  >
                    Vorige
                  </button>
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={copyTariefFromSource}
                    disabled={!sourceTarief}
                  >
                    Kopieer bronjaar
                  </button>
                </div>
                <div className="editor-actions-group">
                  {saveAndCloseButton}
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={saveTariefTarget}
                    disabled={isRunning}
                  >
                    Opslaan
                  </button>
                  <button type="button" className="editor-button" onClick={() => void navigateToStep(4)} disabled={isRunning}>
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 4 ? (
            <div>
              <div className="editor-status" style={{ marginBottom: 14 }}>
                Links zie je de vaste kosten van bronjaar {sourceYear} (read-only). Rechts vul je de vaste kosten voor doeljaar{" "}
                {targetYear} in.
              </div>

              <div className="dataset-editor-scroll" style={{ marginBottom: 14 }}>
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th style={{ width: "120px" }}>Jaar</th>
                      <th style={{ width: "220px" }}>Directe kosten</th>
                      <th style={{ width: "220px" }}>Indirecte kosten</th>
                      <th style={{ width: "220px" }}>Totale kosten</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const sourceTotals = computeHerverdelingTotals(fixedCostRowsForYear(sourceYear));
                      const targetTotals = computeHerverdelingTotals(fixedCostRowsForYear(targetYear));
                      return [
                        { year: targetYear, totals: targetTotals },
                        { year: sourceYear, totals: sourceTotals },
                      ].map(({ year, totals }) => (
                        <tr key={String(year)}>
                          <td>
                            <strong>{year}</strong>
                          </td>
                          <td>
                            {formatEur(totals.directAfter)}{" "}
                            <span className="muted">(herverdeeld uit direct: {formatEur(totals.directOut)})</span>
                          </td>
                          <td>
                            {formatEur(totals.indirectAfter)}{" "}
                            <span className="muted">(herverdeeld uit indirect: {formatEur(totals.indirectOut)})</span>
                          </td>
                          <td>
                            {formatEur(totals.directAfter + totals.indirectAfter)}{" "}
                            <span className="muted">(totaal herverdeeld: {formatEur(totals.redistributedTotal)})</span>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>

              <div className="dataset-editor-scroll" style={{ marginBottom: 14 }}>
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th style={{ width: "320px" }}>Omschrijving</th>
                      <th style={{ width: "180px" }}>Kostensoort</th>
                      <th style={{ width: "170px" }}>Kosten {sourceYear}</th>
                      <th style={{ width: "150px" }}>Herverdelen %</th>
                      <th style={{ width: "170px" }}>Kosten {targetYear}</th>
                      <th style={{ width: "170px" }}>Herverdelen % {targetYear}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Match each source row to exactly one target-draft row.
                      // We use a normalized key + queue to make it stable even with duplicates
                      // and to avoid "no input rendered" due to spacing/casing differences.
                      const queues = new Map<string, VasteKostenUiRow[]>();
                      draftVasteKostenTarget
                        .filter((row) => !row.isNew)
                        .forEach((row) => {
                          const key = vasteKostenKey(row);
                          const current = queues.get(key) ?? [];
                          current.push(row);
                          queues.set(key, current);
                        });

                      return sourceVasteKostenRows.map((srcRow, idx) => {
                        const queue = queues.get(srcRow.key) ?? [];
                        const draftRow = queue.shift();
                        queues.set(srcRow.key, queue);

                        if (!draftRow) {
                          return (
                            <tr key={`${srcRow.key}-${idx}`}>
                              <td>{srcRow.omschrijving}</td>
                              <td>{srcRow.kostensoort}</td>
                              <td>{formatEur(srcRow.bedrag_per_jaar)}</td>
                              <td>{String(Number(srcRow.herverdeel_pct ?? 0))}</td>
                              <td className="muted">-</td>
                              <td className="muted">-</td>
                            </tr>
                          );
                        }

                        return (
                          <tr key={draftRow.uiId}>
                            <td>{srcRow.omschrijving}</td>
                            <td>{srcRow.kostensoort}</td>
                            <td>{formatEur(srcRow.bedrag_per_jaar)}</td>
                            <td>{String(Number(srcRow.herverdeel_pct ?? 0))}</td>
                            <td>
                              <input
                                className="dataset-input"
                                type="number"
                                value={String(Number(draftRow.bedrag_per_jaar ?? 0))}
                                onChange={(event) =>
                                  updateVasteKostenRow(draftRow.uiId, { bedrag_per_jaar: Number(event.target.value) })
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="dataset-input"
                                type="number"
                                value={String(Number(draftRow.herverdeel_pct ?? 0))}
                                onChange={(event) =>
                                  updateVasteKostenRow(draftRow.uiId, { herverdeel_pct: Number(event.target.value) })
                                }
                              />
                            </td>
                          </tr>
                        );
                      });
                    })()}

                    {draftVasteKostenTarget.filter((row) => row.isNew).map((row) => (
                      <tr key={row.uiId}>
                        <td>
                          <input
                            className="dataset-input"
                            value={row.omschrijving}
                            onChange={(event) => updateVasteKostenRow(row.uiId, { omschrijving: event.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            className="dataset-input"
                            value={row.kostensoort}
                            onChange={(event) => updateVasteKostenRow(row.uiId, { kostensoort: event.target.value })}
                          >
                            <option value="">(kies)</option>
                            <option value="Directe kosten">Directe kosten</option>
                            <option value="Indirecte kosten">Indirecte kosten</option>
                          </select>
                        </td>
                        <td className="muted">0</td>
                        <td className="muted">0</td>
                        <td>
                          <input
                            className="dataset-input"
                            type="number"
                            value={String(Number(row.bedrag_per_jaar ?? 0))}
                            onChange={(event) =>
                              updateVasteKostenRow(row.uiId, { bedrag_per_jaar: Number(event.target.value) })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="dataset-input"
                            type="number"
                            value={String(Number(row.herverdeel_pct ?? 0))}
                            onChange={(event) =>
                              updateVasteKostenRow(row.uiId, { herverdeel_pct: Number(event.target.value) })
                            }
                          />
                        </td>
                      </tr>
                    ))}

                    {sourceVasteKostenRows.length === 0 && draftVasteKostenTarget.filter((row) => row.isNew).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="muted">
                          Geen vaste kosten gevonden voor bronjaar {sourceYear}. Voeg een rij toe voor {targetYear}.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="editor-actions" style={{ marginTop: 0 }}>
                <div className="editor-actions-group">
                  <button type="button" className="editor-button editor-button-secondary" onClick={addVasteKostenRow}>
                    Rij toevoegen
                  </button>
                </div>
                <div className="editor-actions-group" />
              </div>
              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => void navigateToStep(3)}
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
                    onClick={() => void saveDraftToServer(`Vaste kosten (concept) voor ${targetYear} opgeslagen.`)}
                    disabled={isRunning}
                  >
                    Opslaan
                  </button>
                  <button
                    type="button"
                    className="editor-button"
                    onClick={() => void navigateToStep(5)}
                    disabled={isRunning}
                  >
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 5 ? (
            <div>
              <div className="editor-toolbar">
                <div className="editor-toolbar-meta">
                  <span className="editor-pill">{packagingComponents.length} onderdelen</span>
                  <span className="muted">Links bronjaar, rechts doeljaar</span>
                </div>
              </div>

              <div className="editor-status" style={{ marginBottom: 14 }}>
                Vul de jaarprijzen voor {targetYear} in. Je kunt optioneel starten vanuit bronjaar {sourceYear} via de knop
                hieronder. Basis- en samengestelde producten blijven hetzelfde; alleen de jaarprijzen van verpakkingsonderdelen
                sturen de kostprijs door.
              </div>

              <div className="dataset-editor-scroll">
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th style={{ width: "320px" }}>Onderdeel</th>
                      <th style={{ width: "180px" }}>Bronjaar {sourceYear}</th>
                      <th style={{ width: "180px" }}>Doeljaar {targetYear}</th>
                      <th style={{ width: "160px" }}>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packagingRowsForTarget.map((row) => {
                      const sourcePrice =
                        currentPackagingPrices.find(
                          (priceRow) =>
                            priceRow.jaar === sourceYear && priceRow.verpakkingsonderdeel_id === row.componentId
                        )?.prijs_per_stuk ?? 0;
                      const targetPrice = Number(draftPackagingPrices[row.componentId] ?? 0);
                      const delta = targetPrice - Number(sourcePrice ?? 0);
                      return (
                        <tr key={row.componentId}>
                          <td>{row.omschrijving}</td>
                          <td>
                            <input
                              className="dataset-input dataset-input-readonly"
                              type="number"
                              value={String(Number(sourcePrice ?? 0))}
                              readOnly
                            />
                          </td>
                          <td>
                            <input
                              className="dataset-input"
                              type="number"
                              value={String(targetPrice)}
                              onChange={(event) =>
                                setDraftPackagingPrices((current) => ({
                                  ...current,
                                  [row.componentId]: Number(event.target.value)
                                }))
                              }
                            />
                          </td>
                          <td>{formatEur(delta)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => void navigateToStep(4)}
                    disabled={isRunning}
                  >
                    Vorige
                  </button>
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={copyPackagingPricesFromSource}
                    disabled={isRunning}
                  >
                    Kopieer bronjaar {sourceYear} naar {targetYear}
                  </button>
                </div>
                <div className="editor-actions-group">
                  {saveAndCloseButton}
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={savePackagingPricesTarget}
                    disabled={isRunning || packagingComponents.length === 0}
                  >
                    Opslaan
                  </button>
                  <button type="button" className="editor-button" onClick={() => void navigateToStep(6)} disabled={isRunning}>
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 6 ? (
            <div>
              <div className="editor-status" style={{ marginBottom: 14 }}>
                <strong>Scenario</strong>: deze inkoopprijzen zijn alleen voor de preview in deze wizard en worden niet
                opgeslagen. De echte inkoopprijzen komen later via inkoopfacturen.
              </div>

              <div className="dataset-editor-scroll">
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th style={{ width: "260px" }}>Bier</th>
                      <th style={{ width: "280px" }}>Product</th>
                      <th style={{ width: "160px" }}>Bron kostprijs</th>
                      <th style={{ width: "160px" }}>Bron inkoop</th>
                      <th style={{ width: "160px" }}>Scenario inkoop</th>
                      <th style={{ width: "160px" }}>Scenario kostprijs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inkoopScenarioRows.map((row) => {
                      const scenarioKey = `${row.bierId}::${row.productId}`;
                      const scenarioValue = Object.prototype.hasOwnProperty.call(scenarioPrimaryCosts, scenarioKey)
                        ? Number(scenarioPrimaryCosts[scenarioKey] ?? 0)
                        : row.sourcePrimaryCost;

                      return (
                        <tr key={scenarioKey}>
                          <td>{row.biernaam}</td>
                          <td>{row.productLabel}</td>
                          <td>{formatEur(row.sourceCost)}</td>
                          <td>{formatEur(row.sourcePrimaryCost)}</td>
                          <td>
                            <input
                              className="dataset-input"
                              type="number"
                              value={String(scenarioValue)}
                              placeholder="(bron)"
                              onChange={(event) => {
                                const raw = event.target.value;
                                if (raw.trim() === "") {
                                  setScenarioPrimaryCosts((current) => {
                                    const next = { ...current };
                                    delete next[scenarioKey];
                                    return next;
                                  });
                                  return;
                                }
                                const parsed = Number(raw);
                                setScenarioPrimaryCosts((current) => ({ ...current, [scenarioKey]: parsed }));
                              }}
                            />
                          </td>
                          <td>{formatEur(row.estimatedTargetCost)}</td>
                        </tr>
                      );
                    })}
                    {inkoopScenarioRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="muted">
                          Geen inkoop-bieren gevonden (controleer of er actieve inkoop-kostprijzen zijn voor {sourceYear}).
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => void navigateToStep(5)}
                    disabled={isRunning}
                  >
                    Vorige
                  </button>
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => setScenarioPrimaryCosts({})}
                    disabled={isRunning}
                  >
                    Reset scenario
                  </button>
                </div>
                <div className="editor-actions-group">
                  {saveAndCloseButton}
                  <button
                    type="button"
                    className="editor-button"
                    onClick={() => void navigateToStep(7)}
                    disabled={isRunning}
                  >
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 7 ? (
            <div>
              <div className="module-card compact-card" style={{ marginBottom: 14 }}>
                <div className="module-card-title">Recepten {targetYear}</div>
                <div className="module-card-text">
                  Pas hier voor bieren met <strong>eigen productie</strong> de doeljaar-gegevens aan. Bij afronden en daarna
                  activeren worden deze instellingen de nieuwe waarheid voor {targetYear} (oude activaties voor {targetYear}
                  worden dan gedeactiveerd).
                </div>
              </div>

              {eigenProductieBieren.length === 0 ? (
                <div className="editor-status" style={{ marginBottom: 14 }}>
                  Geen bieren met eigen productie gevonden in bronjaar {sourceYear}.
                </div>
              ) : null}

              {eigenProductieBieren.map((bier) => {
                const bierId = bier.bierId;
                const sourceVersion = sourceEigenProductieVersionByBierId.get(bierId);
                const sourceBasis =
                  typeof sourceVersion?.basisgegevens === "object" && sourceVersion?.basisgegevens
                    ? sourceVersion.basisgegevens
                    : {};
                const sourceAlcohol = Number(sourceBasis?.alcoholpercentage ?? bier.alcoholpercentage ?? 0) || 0;
                const sourceTarief = String(sourceBasis?.tarief_accijns ?? "Hoog") === "Laag" ? "Laag" : "Hoog";

                const override = ensureEigenOverride(bierId);
                const batchGrootte = Number(getProductieForYear(targetYear)?.batchgrootte_eigen_productie_l ?? 0);
                const totals = computeEigenProductieReceptTotals(override, batchGrootte);

                return (
                  <div key={bierId} className="module-card compact-card" style={{ marginBottom: 14 }}>
                    <div className="module-card-title">{bier.biernaam}</div>
                    <div className="module-card-text">
                      {bier.stijl ? `${bier.stijl} · ` : ""}
                      bronjaar {sourceYear} (read-only) links, doeljaar {targetYear} rechts.
                    </div>

                    <div className="data-table" style={{ marginTop: 12 }}>
                      <table>
                        <thead>
                          <tr>
                            <th style={{ width: "280px" }}>Veld</th>
                            <th style={{ width: "220px" }}>Bronjaar {sourceYear}</th>
                            <th style={{ width: "220px" }}>Doeljaar {targetYear}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>Alcoholpercentage</td>
                            <td>
                              <input className="dataset-input dataset-input-readonly" type="number" value={String(sourceAlcohol)} readOnly />
                            </td>
                            <td>
                              <input
                                className="dataset-input"
                                type="number"
                                value={String(Number(override.alcoholpercentage ?? 0))}
                                onChange={(event) => updateEigenOverride(bierId, { alcoholpercentage: Number(event.target.value) })}
                              />
                            </td>
                          </tr>
                          <tr>
                            <td>Accijnstarief</td>
                            <td>
                              <input className="dataset-input dataset-input-readonly" type="text" value={sourceTarief} readOnly />
                            </td>
                            <td>
                              <select
                                className="dataset-input"
                                value={override.tarief_accijns}
                                onChange={(event) =>
                                  updateEigenOverride(bierId, { tarief_accijns: event.target.value === "Laag" ? "Laag" : "Hoog" })
                                }
                              >
                                <option value="Hoog">Hoog</option>
                                <option value="Laag">Laag</option>
                              </select>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="stats-grid wizard-stats-grid" style={{ marginTop: 14, marginBottom: 14 }}>
                      <div className="stat-card">
                        <div className="stat-label">Leveranciersprijzen</div>
                        <div className="stat-value small">{formatEur(totals.leveranciersTotaal)}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Receptkosten</div>
                        <div className="stat-value small">{formatEur(totals.receptTotaal)}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Batchgrootte (L)</div>
                        <div className="stat-value small">{batchGrootte > 0 ? String(batchGrootte) : "-"}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Literprijs</div>
                        <div className="stat-value small">{batchGrootte > 0 ? formatEur(totals.literPrijs) : "-"}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Ingredienten</div>
                        <div className="stat-value small">{String((override.ingredienten ?? []).length)}</div>
                      </div>
                    </div>

                    <div className="dataset-editor-scroll">
                      <table className="dataset-editor-table wizard-table-compact">
                        <thead>
                          <tr>
                            <th>Ingredient</th>
                            <th>Omschrijving</th>
                            <th>Inhoud verpakking</th>
                            <th>Eenheid</th>
                            <th>Leveranciersprijs</th>
                            <th>Hoeveel in recept</th>
                            <th>Kosten recept</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {(override.ingredienten ?? []).length === 0 ? (
                            <tr>
                              <td className="dataset-empty" colSpan={8}>
                                Nog geen ingredienten. Voeg een regel toe.
                              </td>
                            </tr>
                          ) : null}
                          {(override.ingredienten ?? []).map((regel) => (
                            <tr key={regel.id}>
                              <td>
                                <input
                                  className="dataset-input"
                                  value={regel.ingredient ?? ""}
                                  onChange={(event) => updateEigenIngredient(bierId, regel.id, { ingredient: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  className="dataset-input"
                                  value={regel.omschrijving ?? ""}
                                  onChange={(event) => updateEigenIngredient(bierId, regel.id, { omschrijving: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  className="dataset-input"
                                  type="number"
                                  value={String(Number(regel.hoeveelheid ?? 0))}
                                  onChange={(event) =>
                                    updateEigenIngredient(bierId, regel.id, { hoeveelheid: Number(event.target.value) })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  className="dataset-input"
                                  value={regel.eenheid ?? ""}
                                  onChange={(event) => updateEigenIngredient(bierId, regel.id, { eenheid: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  className="dataset-input"
                                  type="number"
                                  value={String(Number(regel.prijs ?? 0))}
                                  onChange={(event) => updateEigenIngredient(bierId, regel.id, { prijs: Number(event.target.value) })}
                                />
                              </td>
                              <td>
                                <input
                                  className="dataset-input"
                                  type="number"
                                  value={String(Number(regel.benodigd_in_recept ?? 0))}
                                  onChange={(event) =>
                                    updateEigenIngredient(bierId, regel.id, { benodigd_in_recept: Number(event.target.value) })
                                  }
                                />
                              </td>
                              <td>{formatEur(calculateEigenProductieKostenRecept(regel))}</td>
                              <td>
                                <button
                                  type="button"
                                  className="editor-button editor-button-secondary"
                                  onClick={() => deleteEigenIngredient(bierId, regel.id)}
                                  disabled={isRunning}
                                >
                                  Verwijderen
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="editor-actions" style={{ marginTop: 10 }}>
                      <div className="editor-actions-group">
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          onClick={() => addEigenIngredient(bierId)}
                          disabled={isRunning}
                        >
                          Ingrediënt toevoegen
                        </button>
                      </div>
                      <div className="editor-actions-group" />
                    </div>
                  </div>
                );
              })}

              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => void navigateToStep(6)}
                    disabled={isRunning}
                  >
                    Vorige
                  </button>
                </div>
                <div className="editor-actions-group">
                  {saveAndCloseButton}
                  <button type="button" className="editor-button" onClick={() => void navigateToStep(8)} disabled={isRunning}>
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 8 ? (
            <div>
              <div className="module-card compact-card" style={{ marginBottom: 14 }}>
                <div className="module-card-title">Kostprijs {targetYear}</div>
                <div className="module-card-text">
                  Read-only opbouw per bier en verpakkingseenheid op basis van jouw doeljaar-invoer en inkoopscenario.
                </div>
              </div>

              {(
                [
                  ["Basisproducten", kostprijsTargetRows.basisRows],
                  ["Samengestelde producten", kostprijsTargetRows.samengRows]
                ] as [string, KostprijsPreviewRow[]][]
              ).map(([label, records]) => (
                <div key={label} className="module-card compact-card" style={{ marginBottom: 14 }}>
                  <div className="module-card-title">{label}</div>
                  <div className="data-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Biernaam</th>
                          <th>Soort</th>
                          <th>Verpakkingseenheid</th>
                          <th>Inkoop/Ingrediënten</th>
                          <th>Verpakkingskosten</th>
                          <th>Indirecte/Directe kosten</th>
                          <th>Accijns</th>
                          <th>Kostprijs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.length === 0 ? (
                          <tr>
                            <td className="dataset-empty" colSpan={8}>
                              Geen regels beschikbaar (controleer of er actieve kostprijzen zijn voor {sourceYear}).
                            </td>
                          </tr>
                        ) : null}
                        {records.map((row, index) => (
                          <tr key={`${row.biernaam}::${row.verpakkingseenheid}::${index}`}>
                            <td>{row.biernaam}</td>
                            <td>{row.soort}</td>
                            <td>{row.verpakkingseenheid}</td>
                            <td>{formatEur(row.primaire_kosten)}</td>
                            <td>{formatEur(row.verpakkingskosten)}</td>
                            <td>{formatEur(row.vaste_kosten)}</td>
                            <td>{formatEur(row.accijns)}</td>
                            <td>{formatEur(row.kostprijs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => void navigateToStep(7)}
                    disabled={isRunning}
                  >
                    Vorige
                  </button>
                </div>
                <div className="editor-actions-group">
                  {saveAndCloseButton}
                  <button
                    type="button"
                    className="editor-button"
                    onClick={() => void navigateToStep(9)}
                    disabled={isRunning}
                  >
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 9 ? (
            <div>
              <div className="placeholder-block" style={{ marginBottom: 14 }}>
                <strong>Prijsstrategie (wizard)</strong>
                <div className="muted" style={{ marginTop: 8 }}>
                  Kies hoe we van bronjaar {sourceYear} naar doeljaar {targetYear} bewegen. Dit zet concept-overrides
                  klaar in verkoopstrategie op bier+product niveau. Je kunt daarna nog vrij bijstellen.
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
                    Let op: als je geen expliciete sell-in prijzen hebt opgeslagen (alleen marges), dan zijn 2A en 2B
                    in deze tool wiskundig vrijwel gelijk. 2B wordt pas onderscheidend als er echte bronprijzen bestaan.
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
                  productType: row.productType,
                  productLabel: row.productLabel,
                  kostprijs: row.estimatedTargetCost
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
                  setCompletedStepIds((current) => (current.includes("verkoopstrategie") ? current : [...current, "verkoopstrategie"]));
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
                  <button
                    type="button"
                    className="editor-button"
                    onClick={() => void navigateToStep(10)}
                    disabled={isRunning}
                  >
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 10 ? (
            <div>
              <div className="editor-status" style={{ marginBottom: 14 }}>
                Vul per kanaal een opslag in voor adviesprijzen (sell-out). We leiden hiermee een adviesverkoopprijs af uit onze
                verkoopprijs. Bronjaar {sourceYear} is read-only; doeljaar {targetYear} kun je aanpassen.
              </div>

              <div className="dataset-editor-scroll">
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th style={{ width: "220px" }}>Kanaal</th>
                      <th style={{ width: "180px" }}>Opslag {sourceYear} (%)</th>
                      <th style={{ width: "180px" }}>Opslag {targetYear} (%)</th>
                      <th style={{ width: "260px" }}>Advies Doos 24*33cl</th>
                      <th style={{ width: "260px" }}>Advies Fust 20L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        { code: "horeca", label: "Horeca" },
                        { code: "retail", label: "Supermarkt" },
                        { code: "slijterij", label: "Slijterij" },
                        { code: "zakelijk", label: "Speciaalzaak" }
                      ] as const
                    ).map((channel) => {
                      const sourceRow = currentAdviesprijzen.find(
                        (row) => Number(row.jaar ?? 0) === sourceYear && row.channel_code === channel.code
                      );
                      const sourceOpslag = Number(sourceRow?.opslag_pct ?? 0);
                      const draftValue = String(adviesprijzenDraftInputs[channel.code] ?? "");
                      const parsed = Number(String(draftValue).replace(",", "."));
                      const opslagPct = draftValue.trim() === "" || !Number.isFinite(parsed) ? sourceOpslag : parsed;

                      const avgSellInDoos = previewRows
                        .filter((row) => String(row.productLabel ?? "").includes("Doos 24*33cl"))
                        .map((row) => Number((row.sellIn as any)?.[channel.code] ?? 0))
                        .filter((n) => Number.isFinite(n) && n > 0);
                      const avgSellInFust = previewRows
                        .filter((row) => String(row.productLabel ?? "").includes("Fust 20L"))
                        .map((row) => Number((row.sellIn as any)?.[channel.code] ?? 0))
                        .filter((n) => Number.isFinite(n) && n > 0);
                      const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
                      const sellInDoos = mean(avgSellInDoos);
                      const sellInFust = mean(avgSellInFust);

                      const advicePrice = (sellIn: number) => {
                        const base = Number.isFinite(sellIn) ? sellIn : 0;
                        return base * (1 + opslagPct / 100);
                      };
                      const rangeLabel = (base: number) => {
                        if (!Number.isFinite(base) || base <= 0) return "-";
                        const low = Math.max(0, base - 0.05);
                        const high = base + 0.05;
                        return `${formatEur(low)} - ${formatEur(high)}`;
                      };

                      const doosAdvice = advicePrice(sellInDoos);
                      const fustAdvice = advicePrice(sellInFust);

                      return (
                        <tr key={channel.code}>
                          <td>
                            <strong>{channel.label}</strong>
                          </td>
                          <td>
                            <input className="dataset-input dataset-input-readonly" value={String(sourceOpslag)} readOnly />
                          </td>
                          <td>
                            <input
                              className="dataset-input"
                              type="number"
                              value={draftValue}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                setAdviesprijzenDraftInputs((current) => ({ ...current, [channel.code]: nextValue }));
                                const nextParsed = Number(String(nextValue).replace(",", "."));
                                if (!Number.isFinite(nextParsed)) return;
                                setDraftAdviesprijzenTarget((current) => {
                                  const rows = Array.isArray(current) ? [...current] : [];
                                  const idx = rows.findIndex((row) => row.channel_code === channel.code && Number(row.jaar ?? 0) === targetYear);
                                  const nextRow: AdviesprijsRow = {
                                    id: idx >= 0 ? String(rows[idx].id ?? "") : "",
                                    jaar: targetYear,
                                    channel_code: channel.code,
                                    opslag_pct: nextParsed
                                  };
                                  if (idx >= 0) rows[idx] = nextRow;
                                  else rows.push(nextRow);
                                  return rows;
                                });
                              }}
                              onBlur={() => {
                                if (draftValue.trim() !== "") return;
                                setAdviesprijzenDraftInputs((current) => ({ ...current, [channel.code]: String(sourceOpslag) }));
                                setDraftAdviesprijzenTarget((current) => {
                                  const rows = Array.isArray(current) ? [...current] : [];
                                  const idx = rows.findIndex((row) => row.channel_code === channel.code && Number(row.jaar ?? 0) === targetYear);
                                  const nextRow: AdviesprijsRow = {
                                    id: idx >= 0 ? String(rows[idx].id ?? "") : "",
                                    jaar: targetYear,
                                    channel_code: channel.code,
                                    opslag_pct: sourceOpslag
                                  };
                                  if (idx >= 0) rows[idx] = nextRow;
                                  else rows.push(nextRow);
                                  return rows;
                                });
                              }}
                              disabled={isRunning}
                            />
                          </td>
                          <td>{rangeLabel(doosAdvice)}</td>
                          <td>{rangeLabel(fustAdvice)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => void navigateToStep(11)}
                    disabled={isRunning}
                  >
                    Vorige
                  </button>
                </div>
                <div className="editor-actions-group">
                  {saveAndCloseButton}
                  <button type="button" className="editor-button" onClick={() => void navigateToStep(11)} disabled={isRunning}>
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 11 ? (
            <div>
              <div className="editor-status" style={{ marginBottom: 14 }}>
                Hieronder zie je de indicatieve kostprijzen voor het doeljaar {targetYear}. Pas als recepten of
                inkoopfacturen aan producten worden gekoppeld en geactiveerd, is een kostprijs definitief. We rekenen hier
                met de gegevens die je in deze wizard hebt ingevuld; de inkoopprijzen zijn een scenario totdat ze later via
                inkoopfacturen definitief worden.
              </div>

              <div className="dataset-editor-scroll">
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th style={{ width: "240px" }}>Bier</th>
                      <th style={{ width: "260px" }}>Product</th>
                      <th style={{ width: "160px" }}>Kostprijs {sourceYear}</th>
                      <th style={{ width: "160px" }}>Kostprijs {targetYear} (indicatief)</th>
                      <th style={{ width: "160px" }}>Delta</th>
                      <th style={{ width: "180px" }}>Sell-in Horeca</th>
                      <th style={{ width: "180px" }}>Sell-in Retail</th>
                      <th style={{ width: "180px" }}>Sell-in Slijterij</th>
                      <th style={{ width: "180px" }}>Sell-in Speciaalzaak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={`${row.bierId}::${row.productId}`}>
                        <td>{row.biernaam}</td>
                        <td>{row.productLabel}</td>
                        <td>{formatEur(row.sourceCost)}</td>
                        <td>{formatEur(row.estimatedTargetCost)}</td>
                        <td>{formatEur(row.delta)}</td>
                        <td>{formatEur(row.sellIn.horeca ?? 0)}</td>
                        <td>{formatEur(row.sellIn.retail ?? 0)}</td>
                        <td>{formatEur(row.sellIn.slijterij ?? 0)}</td>
                        <td>{formatEur(row.sellIn.zakelijk ?? 0)}</td>
                      </tr>
                    ))}
                    {previewRows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="muted">
                          Geen preview-rijen beschikbaar.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => void navigateToStep(9)}
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
                    onClick={() => void saveDraftToServer("Concept opgeslagen.")}
                    disabled={isRunning || !conceptStarted}
                  >
                    Opslaan
                  </button>
                  <button type="button" className="editor-button" onClick={() => void navigateToStep(12)} disabled={isRunning}>
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 12 ? (
            <div>
              <div className="editor-status" style={{ marginBottom: 14 }}>
                Klik op <strong>Afronden</strong> om het doeljaar {targetYear} definitief weg te schrijven. Totdat je afrondt,
                blijft alles een concept en worden de echte jaar-tabellen niet aangepast.
              </div>

              {commitConflict ? (
                <div className="editor-status" style={{ marginBottom: 14 }}>
                  <strong>Conflict:</strong> {commitConflict}
                  <div className="muted" style={{ marginTop: 8 }}>
                    Kies of je het concept opnieuw wilt baseren op het bronjaar, of force wilt afronden.
                  </div>
                  <div className="editor-actions" style={{ marginTop: 10 }}>
                    <div className="editor-actions-group">
                      <button
                        type="button"
                        className="editor-button editor-button-secondary"
                        onClick={async () => {
                          await fetch(
                            `${API_BASE_URL}/meta/new-year-draft?target_year=${encodeURIComponent(String(targetYear))}`,
                            { method: "DELETE" }
                          );
                          setCommitConflict("");
                          await initializeYear();
                        }}
                        disabled={isRunning}
                      >
                        Concept opnieuw baseren
                      </button>
                    </div>
                    <div className="editor-actions-group">
                      <button type="button" className="editor-button" onClick={commitTargetYearForce} disabled={isRunning}>
                        Toch afronden (force)
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => void navigateToStep(10)}
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
                    onClick={() => void saveDraftToServer("Concept opgeslagen.")}
                    disabled={isRunning}
                  >
                    Opslaan
                  </button>
                  <button
                    type="button"
                    className="editor-button"
                    onClick={commitTargetYear}
                    disabled={isRunning}
                  >
                    Afronden
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          </div>
              </div>
            </div>
          </main>

          <aside className="cpq-right">
            <div className="cpq-right-kicker">Status</div>
            <div className="placeholder-block" style={{ margin: 0 }}>
              <strong>{conceptStarted ? "Concept gestart" : "Concept nog niet gestart"}</strong>
              Gebruik de stappen links om het doeljaar op te bouwen. Verwijder het concept via de prullenbak in de
              topbar.
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M9 4h6" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function QuickCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="cpq-quick-label">{label}</div>
      <div className="cpq-quick-value">{value || "—"}</div>
    </div>
  );
}
