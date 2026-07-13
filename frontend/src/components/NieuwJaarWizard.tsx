"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { usePageShellHeader } from "@/components/PageShell";
import { VerkoopstrategieWorkspace } from "@/components/VerkoopstrategieWorkspace";
import { WizardSteps } from "@/components/WizardSteps";
import { API_BASE_URL } from "@/lib/api";
import {
  clampInt,
  clampNumber,
  formatEur,
  normalizePackagingComponent,
  normalizePackagingPriceRow,
  normalizeTariefRow,
  snapshotProductCostFromRecord,
  type PackagingComponent,
  type PackagingPriceRow,
  type TariefRow,
} from "@/components/nieuw-jaar/nieuwJaarWizardUtils";
import { buildPreviewRows, type PreviewRow } from "@/components/nieuw-jaar/nieuwJaarWizardPreview";
import {
  buildActiveRows,
  type ActiveCostRow,
} from "@/components/kostprijsbeheer/kostprijsBeheerDerivations";
import { PreviewStep } from "@/components/nieuw-jaar/steps/PreviewStep";
import { AfrondenStep } from "@/components/nieuw-jaar/steps/AfrondenStep";
import { SelectYearsStep } from "@/components/nieuw-jaar/steps/SelectYearsStep";
import { InitializeConceptStep } from "@/components/nieuw-jaar/steps/InitializeConceptStep";
import { ProductieTargetsStep } from "@/components/nieuw-jaar/steps/ProductieTargetsStep";
import { TarievenTargetsStep } from "@/components/nieuw-jaar/steps/TarievenTargetsStep";
import { VasteKostenTargetsStep } from "@/components/nieuw-jaar/steps/VasteKostenTargetsStep";
import { PackagingPricesTargetsStep } from "@/components/nieuw-jaar/steps/PackagingPricesTargetsStep";
import { InkoopScenarioStep } from "@/components/nieuw-jaar/steps/InkoopScenarioStep";
import { EigenProductieReceptenStep } from "@/components/nieuw-jaar/steps/EigenProductieReceptenStep";
import { KostprijsReadOnlyStep } from "@/components/nieuw-jaar/steps/KostprijsReadOnlyStep";
import { VerkoopstrategieDraftStep } from "@/components/nieuw-jaar/steps/VerkoopstrategieDraftStep";
import { AdviesprijzenTargetsStep } from "@/components/nieuw-jaar/steps/AdviesprijzenTargetsStep";
import { PlanHercontroleStep } from "@/components/nieuw-jaar/steps/PlanHercontroleStep";
import {
  buildKostprijsTargetRows,
  type KostprijsPreviewRow,
} from "@/components/nieuw-jaar/nieuwJaarWizardKostprijsTarget";
import {
  commitNewYear,
  deleteNewYearDraft,
  fetchBootstrap,
  getNewYearDraft,
  putNewYearDraft,
} from "@/components/nieuw-jaar/nieuwJaarWizardIo";
import { QuickCell as NieuwJaarQuickCell, TrashIcon as NieuwJaarTrashIcon } from "@/components/nieuw-jaar/NieuwJaarWizardParts";
import { createUiId, sanitizeVasteKostenTarget, vasteKostenKey } from "@/components/nieuw-jaar/nieuwJaarWizardDerivations";
import {
  calcSellInPrice as calcSellInPriceFromMargin,
  computeAccijnsForLiters as computeAccijnsForLitersDerived,
  computeDirectFixedCostPerProductieLiter as computeDirectFixedCostPerProductieLiterForYear,
  computeFixedCostPerLiter,
  computeHerverdelingTotals,
  computeIndirectFixedCostPerInkoopLiter as computeIndirectFixedCostPerInkoopLiterForYear,
} from "@/components/nieuw-jaar/nieuwJaarWizardPricing";
import {
  buildBasisParentForStrategy,
} from "@/components/nieuw-jaar/nieuwJaarWizardStrategy";
import {
  calculateEigenProductieKostenRecept as calculateEigenProductieKostenReceptDerived,
  calculateEigenProductiePrijsPerEenheid as calculateEigenProductiePrijsPerEenheidDerived,
  computeEigenProductieReceptTotals as computeEigenProductieReceptTotalsDerived,
  computeMarginFromSellIn as computeMarginFromSellInDerived,
  computeSellInPrice as computeSellInPriceDerived,
} from "@/components/nieuw-jaar/nieuwJaarWizardScenarioMath";

type GenericRecord = Record<string, unknown>;
type ProductieMap = Record<string, GenericRecord>;
type VasteKostenMap = Record<string, GenericRecord[]>;

type YearCloseSnapshot = {
  id: string;
  jaar: number;
  status: string;
  closed_at: string;
  payload?: Record<string, unknown>;
};

const calcSellInPrice = calcSellInPriceFromMargin;

type VasteKostenUiRow = {
  uiId: string;
  omschrijving: string;
  kostensoort: string;
  exact_rekening: string;
  cost_pool: string;
  domain: string;
  allocation_driver: string;
  allocation_scope: string;
  bedrag_per_jaar: number;
  herverdeel_pct: number;
  ignored: boolean;
  isNew: boolean;
};

type ProductieYear = {
  normal_sales_l?: number;
  sales_l?: number;
  normal_shipments?: number;
  shipments?: number;
  normal_orderlines?: number;
  orderlines?: number;
  hoeveelheid_inkoop_l: number;
  hoeveelheid_productie_l: number;
  batchgrootte_eigen_productie_l: number;
};

type PlanTargets = {
  revenue: number;
  variable_cost: number;
  contribution: number;
  liters: number;
  units: number;
  price_change_pct: number;
  volume_change_pct: number;
  fixed_cost_inflation_pct: number;
  mix_assumption: string;
};

type WizardStep = {
  id: string;
  label: string;
  description: string;
  panelTitle: string;
  panelDescription: string;
};

type PricingMode = "keep_price" | "scale_cost_ratio" | "keep_margin" | "free";

type IngredientRule = {
  id: string;
  ingredient: string;
  omschrijving: string;
  hoeveelheid: number; // inhoud verpakking
  eenheid: string;
  prijs: number; // leveranciersprijs (totaal per verpakking)
  source_prijs?: number;
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
  initialSkus: GenericRecord[];
  initialArticles: GenericRecord[];
  initialBomLines: GenericRecord[];
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
  /** Optional: year-close snapshots so the wizard can show whether the source year is final reality. */
  initialYearCloseSnapshots?: YearCloseSnapshot[];
};

type AdviesprijsRow = {
  id: string;
  jaar: number;
  channel_code: string;
  opslag_pct: number;
  sku_id?: string;
  adviesprijs?: number;
  record_type?: string;
};

export function NieuwJaarWizard(props: NieuwJaarWizardProps) {
  const router = useRouter();
  const {
    initialBerekeningen,
    initialKostprijsproductactiveringen,
    initialBasisproducten,
    initialSamengesteldeProducten,
    initialBieren,
    initialSkus,
    initialArticles,
    initialBomLines,
    initialProductie,
    initialVasteKosten,
    initialTarieven,
    initialPackagingComponents,
    initialPackagingComponentPrices,
    initialVerkoopprijzen,
    initialAdviesprijzen,
    initialTargetYear,
    initialSourceYear,
    initialYearCloseSnapshots
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

  const bierenByIdForActiveRows = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(initialBieren) ? initialBieren : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      const naam = String((row as any)?.naam ?? (row as any)?.biernaam ?? "").trim();
      if (id && naam) map.set(id, naam);
    });
    return map;
  }, [initialBieren]);

  const basisByIdForActiveRows = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(initialBasisproducten) ? initialBasisproducten : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      const label = String((row as any)?.omschrijving ?? (row as any)?.naam ?? "").trim();
      if (id && label) map.set(id, label);
    });
    return map;
  }, [initialBasisproducten]);

  const samengesteldByIdForActiveRows = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(initialSamengesteldeProducten) ? initialSamengesteldeProducten : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      const label = String((row as any)?.omschrijving ?? (row as any)?.naam ?? "").trim();
      if (id && label) map.set(id, label);
    });
    return map;
  }, [initialSamengesteldeProducten]);

  const skuByIdForActiveRows = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(initialSkus) ? initialSkus : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (id) map.set(id, row);
    });
    return map;
  }, [initialSkus]);

  const articleByIdForActiveRows = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(initialArticles) ? initialArticles : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (id) map.set(id, row);
    });
    return map;
  }, [initialArticles]);

  const berekeningenByIdForActiveRows = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(currentBerekeningen) ? currentBerekeningen : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (id) map.set(id, row);
    });
    return map;
  }, [currentBerekeningen]);

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
  const [draftPlanTargets, setDraftPlanTargets] = useState<PlanTargets>({
    revenue: 0,
    variable_cost: 0,
    contribution: 0,
    liters: 0,
    units: 0,
    price_change_pct: 0,
    volume_change_pct: 0,
    fixed_cost_inflation_pct: 0,
    mix_assumption: ""
  });
  const [draftVasteKostenTarget, setDraftVasteKostenTarget] = useState<VasteKostenUiRow[]>([]);
  const [draftPackagingPricesTarget, setDraftPackagingPricesTarget] = useState<PackagingPriceRow[]>([]);
  const [draftVerkoopstrategieTarget, setDraftVerkoopstrategieTarget] = useState<GenericRecord[]>([]);
  const [liveVerkoopstrategieRows, setLiveVerkoopstrategieRows] = useState<GenericRecord[]>([]);
  const [draftAdviesprijzenTarget, setDraftAdviesprijzenTarget] = useState<AdviesprijsRow[]>([]);
  const [adviesprijzenDraftInputs, setAdviesprijzenDraftInputs] = useState<Record<string, string>>({});
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([]);
  const [draftStatus, setDraftStatus] = useState<"" | "idle" | "loading" | "saving" | "committing">("idle");
  const [commitConflict, setCommitConflict] = useState<string>("");
  const conceptStarted = completedStepIds.includes("init");
  const yearCloseSnapshots = useMemo(
    () => (Array.isArray(initialYearCloseSnapshots) ? initialYearCloseSnapshots : []),
    [initialYearCloseSnapshots]
  );
  const sourceYearClose = useMemo(() => {
    return yearCloseSnapshots.find((snapshot) => Number(snapshot.jaar ?? 0) === sourceYear) ?? null;
  }, [sourceYear, yearCloseSnapshots]);
  const sourceYearCloseTotals = useMemo(() => {
    const payload = sourceYearClose?.payload ?? {};
    const actuals = (payload.actuals ?? {}) as GenericRecord;
    return ((actuals.totals ?? {}) as GenericRecord) ?? {};
  }, [sourceYearClose]);
  const sourceYearCloseReference = useMemo(() => {
    if (!sourceYearClose) return undefined;
    const payload = sourceYearClose.payload ?? {};
    const drivers = (payload.drivers ?? {}) as GenericRecord;
    const inventory = (payload.inventory ?? {}) as GenericRecord;
    const inventoryTotals = (inventory.totals ?? {}) as GenericRecord;
    return {
      revenue: Number(sourceYearCloseTotals.revenue ?? 0),
      variableCost: Number(sourceYearCloseTotals.variable_cost ?? 0),
      contribution: Number(sourceYearCloseTotals.contribution ?? 0),
      fixedAlloc: Number(sourceYearCloseTotals.fixed_alloc ?? 0),
      fixedCost: Number((payload as any).fixed_cost_total ?? 0),
      purchaseLiters: Number(inventoryTotals.purchase_liters ?? (drivers.purchase_liters as any)?.value ?? 0),
      productionLiters: Number(inventoryTotals.production_liters ?? (drivers.production_liters as any)?.value ?? 0),
      salesLiters: Number(inventoryTotals.sold_liters ?? (drivers.sales_liters as any)?.value ?? 0),
      inventoryEndLiters: Number(inventoryTotals.end_liters ?? 0),
      inventoryEndValuePrimary: Number(inventoryTotals.end_value_primary ?? 0),
      inventoryEndValueWithExcise: Number(inventoryTotals.end_value_with_excise ?? 0),
    };
  }, [sourceYearClose, sourceYearCloseTotals]);
  const sourceYearCloseUnits = useMemo(() => {
    const payload = sourceYearClose?.payload ?? {};
    const actuals = (payload.actuals ?? {}) as GenericRecord;
    const rows = Array.isArray(actuals.rows) ? actuals.rows : [];
    return rows.reduce((sum, row) => sum + Number((row as any)?.units ?? 0), 0);
  }, [sourceYearClose]);

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

  const sourceVasteKostenRows = useMemo(() => {
    const rawRows = ((currentVasteKosten as any)?.[String(sourceYear)] ?? []) as any[];
    if (!Array.isArray(rawRows)) return [] as Array<{ idx: number; key: string; omschrijving: string; kostensoort: string; exact_rekening: string; cost_pool: string; domain: string; allocation_driver: string; allocation_scope: string; bedrag_per_jaar: number; herverdeel_pct: number }>;
    return rawRows
      .filter((row) => row && typeof row === "object")
      .map((row, idx) => ({
        idx,
        key: vasteKostenKey(row),
        omschrijving: String((row as any).omschrijving ?? ""),
        kostensoort: String((row as any).kostensoort ?? ""),
        exact_rekening: String((row as any).exact_rekening ?? (row as any).exact_account ?? ""),
        cost_pool: String((row as any).cost_pool ?? ""),
        domain: String((row as any).domain ?? (row as any).domein ?? "production") || "production",
        allocation_driver: String((row as any).allocation_driver ?? ""),
        allocation_scope: String((row as any).allocation_scope ?? "all") || "all",
        bedrag_per_jaar: Number((row as any).bedrag_per_jaar ?? 0),
        herverdeel_pct: Number((row as any).herverdeel_pct ?? 0)
      }));
  }, [currentVasteKosten, sourceYear]);

  // Ensure the target-year draft has a 1:1 structural row for each source row.
  // The rows stay draft-only until the wizard is finished; they are initialized from source-year values
  // so target-year planning starts as a copy that can be adjusted.
  useEffect(() => {
    if (!copyVasteKosten) return;
    if (!conceptStarted && activeStep !== 4) return;

    setDraftVasteKostenTarget((current) => {
      const nonNewRows = current.filter((row) => !row.isNew);
      const newRows = current.filter((row) => row.isNew);
      const migrateZeroInitializedRows =
        nonNewRows.length > 0 &&
        sourceVasteKostenRows.length > 0 &&
        nonNewRows.every((row) => Number(row.bedrag_per_jaar ?? 0) === 0 && !row.ignored);

      let changed = false;
      const nextExisting = nonNewRows.map((row, index) => {
        const sourceRow = sourceVasteKostenRows[index];
        if (!sourceRow) return row;
        const needsMetadataMigration =
          !row.exact_rekening ||
          !row.cost_pool ||
          !row.domain ||
          !row.allocation_driver ||
          !row.allocation_scope;
        if (!migrateZeroInitializedRows && !needsMetadataMigration) return row;
        changed = true;
        return {
          ...row,
          exact_rekening: row.exact_rekening || String(sourceRow.exact_rekening ?? ""),
          cost_pool: row.cost_pool || String(sourceRow.cost_pool ?? ""),
          domain: row.domain || String(sourceRow.domain ?? "production"),
          allocation_driver: row.allocation_driver || String(sourceRow.allocation_driver ?? ""),
          allocation_scope: row.allocation_scope || String(sourceRow.allocation_scope ?? "all"),
          bedrag_per_jaar: migrateZeroInitializedRows ? Number(sourceRow.bedrag_per_jaar ?? 0) : Number(row.bedrag_per_jaar ?? 0),
          herverdeel_pct: migrateZeroInitializedRows ? Number(sourceRow.herverdeel_pct ?? 0) : Number(row.herverdeel_pct ?? 0),
        };
      });

      if (nextExisting.length < sourceVasteKostenRows.length) {
        changed = true;
        for (let i = nextExisting.length; i < sourceVasteKostenRows.length; i += 1) {
          const exemplar = sourceVasteKostenRows[i];
          nextExisting.push({
            uiId: createUiId(),
            omschrijving: exemplar?.omschrijving ?? "",
            kostensoort: exemplar?.kostensoort ?? "",
            exact_rekening: String(exemplar?.exact_rekening ?? ""),
            cost_pool: String(exemplar?.cost_pool ?? ""),
            domain: String(exemplar?.domain ?? "production") || "production",
            allocation_driver: String(exemplar?.allocation_driver ?? ""),
            allocation_scope: String(exemplar?.allocation_scope ?? "all") || "all",
            bedrag_per_jaar: Number(exemplar?.bedrag_per_jaar ?? 0),
            herverdeel_pct: Number(exemplar?.herverdeel_pct ?? 0),
            ignored: false,
            isNew: false
          });
        }
      }
      const next = [...nextExisting, ...newRows];
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
        exact_rekening: "",
        cost_pool: "",
        domain: "production",
        allocation_driver: "",
        allocation_scope: "all",
        bedrag_per_jaar: 0,
        herverdeel_pct: 0,
        ignored: false,
        isNew: true
      }
    ]);
  }

  function removeVasteKostenRow(uiId: string) {
    setDraftVasteKostenTarget((current) => current.filter((row) => row.uiId !== uiId));
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

  function applyIngredientInflation(bierId: string) {
    if (!bierId) return;
    const inflationPct = Number(draftPlanTargets.fixed_cost_inflation_pct ?? 0);
    if (!Number.isFinite(inflationPct)) return;
    setEigenProductieOverrides((current) => {
      const base = current[bierId] ?? { alcoholpercentage: 0, tarief_accijns: "Hoog", ingredienten: [] };
      const nextRules = (Array.isArray(base.ingredienten) ? base.ingredienten : []).map((row) => {
        const sourcePrice = Number(row.source_prijs ?? row.prijs ?? 0);
        return {
          ...row,
          source_prijs: sourcePrice,
          prijs: Number((sourcePrice * (1 + inflationPct / 100)).toFixed(2)),
        };
      });
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
          source_prijs: 0,
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
        normal_sales_l: Number((draftProductieTarget as any).normal_sales_l ?? draftPlanTargets.liters ?? 0),
        sales_l: Number((draftProductieTarget as any).sales_l ?? draftPlanTargets.liters ?? 0),
        normal_shipments: Number((draftProductieTarget as any).normal_shipments ?? 0),
        shipments: Number((draftProductieTarget as any).shipments ?? (draftProductieTarget as any).normal_shipments ?? 0),
        normal_orderlines: Number((draftProductieTarget as any).normal_orderlines ?? 0),
        orderlines: Number((draftProductieTarget as any).orderlines ?? (draftProductieTarget as any).normal_orderlines ?? 0),
        hoeveelheid_inkoop_l: Number(draftProductieTarget.hoeveelheid_inkoop_l ?? 0),
        hoeveelheid_productie_l: Number(draftProductieTarget.hoeveelheid_productie_l ?? 0),
        batchgrootte_eigen_productie_l: Number(draftProductieTarget.batchgrootte_eigen_productie_l ?? 0)
      },
      plan_targets: {
        revenue: Number(draftPlanTargets.revenue ?? 0),
        variable_cost: Number(draftPlanTargets.variable_cost ?? 0),
        contribution: Number(draftPlanTargets.contribution ?? 0),
        liters: Number(draftPlanTargets.liters ?? 0),
        units: Number(draftPlanTargets.units ?? 0),
        price_change_pct: Number(draftPlanTargets.price_change_pct ?? 0),
        volume_change_pct: Number(draftPlanTargets.volume_change_pct ?? 0),
        fixed_cost_inflation_pct: Number(draftPlanTargets.fixed_cost_inflation_pct ?? 0),
        mix_assumption: String(draftPlanTargets.mix_assumption ?? "")
      },
      tarieven_target: {
        id: String(draftTariefTarget.id ?? ""),
        jaar: targetYear,
        tarief_hoog: Number(draftTariefTarget.tarief_hoog ?? 0),
        tarief_laag: Number(draftTariefTarget.tarief_laag ?? 0),
        verbruikersbelasting: Number(draftTariefTarget.verbruikersbelasting ?? 0)
      },
      vaste_kosten_target: copyVasteKosten ? sanitizeVasteKostenTarget(draftVasteKostenTarget as any) : undefined,
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
                source_prijs: Number(regel.source_prijs ?? regel.prijs ?? 0),
                benodigd_in_recept: Number(regel.benodigd_in_recept ?? 0)
              }))
            }
          ])
      ),
      costprice_engine_target_rows: [...kostprijsTargetRows.basisRows, ...kostprijsTargetRows.samengRows].map((row) => ({
        engine_version: "costprice-ssot-v1",
        bier_id: String(row.bier_id ?? ""),
        biernaam: String(row.biernaam ?? ""),
        sku_id: String(row.sku_id ?? ""),
        source_version_id: String(row.source_version_id ?? ""),
        product_id: String(row.product_id ?? ""),
        product_type: String(row.product_type ?? ""),
        product_label: String(row.verpakkingseenheid ?? ""),
        cost_origin: String(row.cost_origin ?? ""),
        source_kind: String(row.source_kind ?? ""),
        parent_sku_id: String(row.parent_sku_id ?? ""),
        parent_product_id: String(row.parent_product_id ?? ""),
        parent_quantity: Number(row.parent_quantity ?? 0),
        source_cost: Number(row.source_kostprijs ?? 0),
        source_primary: Number(row.source_primaire_kosten ?? 0),
        source_packaging: Number(row.source_verpakkingskosten ?? 0),
        source_overhead: Number(row.source_vaste_kosten ?? 0),
        source_excise: Number(row.source_accijns ?? 0),
        scenario_primary: Number(row.primaire_kosten ?? 0),
        target_packaging: Number(row.verpakkingskosten ?? 0),
        target_overhead: Number(row.vaste_kosten ?? 0),
        target_excise: Number(row.accijns ?? 0),
        target_cost: Number(row.kostprijs ?? 0),
        delta: Number(row.verschil ?? 0),
        status: String(row.status ?? ""),
        status_text: String(row.status_text ?? "")
      }))
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
      const result = await putNewYearDraft({
        apiBaseUrl: API_BASE_URL,
        sourceYear,
        targetYear,
        payload: buildDraftPayload(),
      });
      if (!result.ok) throw new Error(result.text || "Concept opslaan mislukt.");
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
      const result = await getNewYearDraft({ apiBaseUrl: API_BASE_URL, targetYear });
      if (!result.ok) return;
      const json = result.json as any;
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
        const sourceProductieForDraft = getProductieForYear(effectiveSource) as any;
        const positiveOrFallback = (value: unknown, ...fallbacks: unknown[]) => {
          const parsed = Number(value ?? 0);
          if (Number.isFinite(parsed) && parsed > 0) return parsed;
          for (const fallback of fallbacks) {
            const next = Number(fallback ?? 0);
            if (Number.isFinite(next) && next > 0) return next;
          }
          return 0;
        };
        setDraftProductieTarget({
          normal_sales_l: Number(data.productie_target.normal_sales_l ?? data.productie_target.sales_l ?? 0),
          sales_l: Number(data.productie_target.sales_l ?? data.productie_target.normal_sales_l ?? 0),
          normal_shipments: positiveOrFallback(
            data.productie_target.normal_shipments,
            data.productie_target.shipments,
            sourceProductieForDraft?.normal_shipments,
            sourceProductieForDraft?.shipments
          ),
          shipments: positiveOrFallback(
            data.productie_target.shipments,
            data.productie_target.normal_shipments,
            sourceProductieForDraft?.shipments,
            sourceProductieForDraft?.normal_shipments
          ),
          normal_orderlines: positiveOrFallback(
            data.productie_target.normal_orderlines,
            data.productie_target.orderlines,
            sourceProductieForDraft?.normal_orderlines,
            sourceProductieForDraft?.orderlines
          ),
          orderlines: positiveOrFallback(
            data.productie_target.orderlines,
            data.productie_target.normal_orderlines,
            sourceProductieForDraft?.orderlines,
            sourceProductieForDraft?.normal_orderlines
          ),
          hoeveelheid_inkoop_l: Number(data.productie_target.hoeveelheid_inkoop_l ?? 0),
          hoeveelheid_productie_l: Number(data.productie_target.hoeveelheid_productie_l ?? 0),
          batchgrootte_eigen_productie_l: Number(data.productie_target.batchgrootte_eigen_productie_l ?? 0)
        });
      }
      if (data?.plan_targets && typeof data.plan_targets === "object") {
        const raw = data.plan_targets as any;
        setDraftPlanTargets({
          revenue: Number(raw.revenue ?? 0),
          variable_cost: Number(raw.variable_cost ?? 0),
          contribution: Number(raw.contribution ?? 0),
          liters: Number(raw.liters ?? 0),
          units: Number(raw.units ?? 0),
          price_change_pct: Number(raw.price_change_pct ?? 0),
          volume_change_pct: Number(raw.volume_change_pct ?? 0),
          fixed_cost_inflation_pct: Number(raw.fixed_cost_inflation_pct ?? 0),
          mix_assumption: String(raw.mix_assumption ?? "")
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
        const sourceRowsForDraft = ((currentVasteKosten as any)?.[String(effectiveSource)] ?? []) as any[];
        const sourceRowCount = Array.isArray(sourceRowsForDraft)
          ? sourceRowsForDraft.filter((row) => row && typeof row === "object").length
          : 0;

        const nextUiRows: VasteKostenUiRow[] = (data.vaste_kosten_target as any[])
          .filter((row) => row && typeof row === "object")
          .map((row, index) => {
            const omschrijving = String((row as any).omschrijving ?? "");
            const kostensoort = String((row as any).kostensoort ?? "");

            return {
              uiId: createUiId(),
              omschrijving,
              kostensoort,
              exact_rekening: String((row as any).exact_rekening ?? ""),
              cost_pool: String((row as any).cost_pool ?? ""),
              domain: String((row as any).domain ?? (row as any).domein ?? "production") || "production",
              allocation_driver: String((row as any).allocation_driver ?? ""),
              allocation_scope: String((row as any).allocation_scope ?? "all") || "all",
              bedrag_per_jaar: Number((row as any).bedrag_per_jaar ?? 0),
              herverdeel_pct: Number((row as any).herverdeel_pct ?? 0),
              ignored: Boolean((row as any).ignored ?? false),
              isNew: index >= sourceRowCount
            };
          });
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
        setDraftVerkoopstrategieTarget((data.verkoopstrategie_target as any[]).filter((row) => String(row?.draft_source ?? "") !== "live_preview"));
      }
      if (Array.isArray(data?.adviesprijzen_target)) {
        const rows = (data.adviesprijzen_target as any[])
          .filter((row) => row && typeof row === "object")
          .map((row: any) => ({
            id: String(row.id ?? ""),
            record_type: String(row.record_type ?? ""),
            jaar: effectiveTarget,
            channel_code: String(row.channel_code ?? row.code ?? "").toLowerCase(),
            opslag_pct: Number(row.opslag_pct ?? row.opslag ?? 0),
            sku_id: String(row.sku_id ?? ""),
            adviesprijs: Number(row.adviesprijs ?? 0)
          }))
          .filter((row) => row.jaar > 0 && row.channel_code);
        setDraftAdviesprijzenTarget(rows);
        setAdviesprijzenDraftInputs(
          Object.fromEntries(
            rows
              .filter((row) => !String(row.sku_id ?? "").trim())
              .map((row) => [row.channel_code, String(row.opslag_pct ?? 0)])
          )
        );
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
                source_prijs: Number((row as any).source_prijs ?? (row as any).prijs ?? 0),
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
      const plannedSalesLiters = Number(draftPlanTargets.liters ?? 0);
      return {
        normal_sales_l: Number((draftProductieTarget as any).normal_sales_l ?? (draftProductieTarget as any).sales_l ?? plannedSalesLiters),
        sales_l: Number((draftProductieTarget as any).sales_l ?? plannedSalesLiters),
        normal_shipments: Number((draftProductieTarget as any).normal_shipments ?? (draftProductieTarget as any).shipments ?? 0),
        shipments: Number((draftProductieTarget as any).shipments ?? (draftProductieTarget as any).normal_shipments ?? 0),
        normal_orderlines: Number((draftProductieTarget as any).normal_orderlines ?? (draftProductieTarget as any).orderlines ?? 0),
        orderlines: Number((draftProductieTarget as any).orderlines ?? (draftProductieTarget as any).normal_orderlines ?? 0),
        hoeveelheid_inkoop_l: Number(draftProductieTarget.hoeveelheid_inkoop_l ?? 0),
        hoeveelheid_productie_l: Number(draftProductieTarget.hoeveelheid_productie_l ?? 0),
        batchgrootte_eigen_productie_l: Number(draftProductieTarget.batchgrootte_eigen_productie_l ?? 0)
      };
    }
    const raw = (currentProductie as any)?.[String(year)];
    if (!raw || typeof raw !== "object") return null;
    return {
      normal_sales_l: Number((raw as any).normal_sales_l ?? (raw as any).sales_l ?? 0),
      sales_l: Number((raw as any).sales_l ?? 0),
      normal_shipments: Number((raw as any).normal_shipments ?? (raw as any).shipments ?? 0),
      shipments: Number((raw as any).shipments ?? (raw as any).normal_shipments ?? 0),
      normal_orderlines: Number((raw as any).normal_orderlines ?? (raw as any).orderlines ?? 0),
      orderlines: Number((raw as any).orderlines ?? (raw as any).normal_orderlines ?? 0),
      hoeveelheid_inkoop_l: Number((raw as any).hoeveelheid_inkoop_l ?? 0),
      hoeveelheid_productie_l: Number((raw as any).hoeveelheid_productie_l ?? 0),
      batchgrootte_eigen_productie_l: Number((raw as any).batchgrootte_eigen_productie_l ?? 0)
    };
  }

  async function refreshFromServer() {
    const result = await fetchBootstrap({
      apiBaseUrl: API_BASE_URL,
      datasets: [
        "productie",
        "vaste-kosten",
        "tarieven-heffingen",
        "packaging-component-prices",
        "verkoopprijzen",
        "adviesprijzen",
        "berekeningen",
        "kostprijsproductactiveringen"
      ],
      navigation: false,
    });
    if (!result.ok) return;
    const data = result.json as any;
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
        setDraftProductieTarget({
          ...sourceProductie,
          hoeveelheid_inkoop_l: Number(sourceYearCloseReference?.purchaseLiters ?? (sourceProductie as any).hoeveelheid_inkoop_l ?? 0),
          hoeveelheid_productie_l: Number(sourceYearCloseReference?.productionLiters ?? (sourceProductie as any).hoeveelheid_productie_l ?? 0),
          normal_shipments: Number((sourceProductie as any).normal_shipments ?? (sourceProductie as any).shipments ?? 0),
          shipments: Number((sourceProductie as any).shipments ?? (sourceProductie as any).normal_shipments ?? 0),
          normal_orderlines: Number((sourceProductie as any).normal_orderlines ?? (sourceProductie as any).orderlines ?? 0),
          orderlines: Number((sourceProductie as any).orderlines ?? (sourceProductie as any).normal_orderlines ?? 0),
        });
      }
      setDraftPlanTargets({
        revenue: Number(sourceYearCloseReference?.revenue ?? 0),
        variable_cost: Number(sourceYearCloseReference?.variableCost ?? 0),
        contribution: Number(sourceYearCloseReference?.contribution ?? 0),
        liters: Number(sourceYearCloseReference?.salesLiters ?? sourceSalesLiters ?? 0),
        units: Number(sourceYearCloseUnits ?? 0),
        price_change_pct: 0,
        volume_change_pct: 0,
        fixed_cost_inflation_pct: 0,
        mix_assumption: sourceYearClose
          ? `Afgesloten mix ${sourceYear} als startpunt voor ${targetYear}.`
          : `Bronjaar ${sourceYear} als startpunt voor ${targetYear}.`
      });
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
              exact_rekening: String(row.exact_rekening ?? ""),
              cost_pool: String(row.cost_pool ?? ""),
              domain: String(row.domain ?? "production") || "production",
              allocation_driver: String(row.allocation_driver ?? ""),
              allocation_scope: String(row.allocation_scope ?? "all") || "all",
              bedrag_per_jaar: Number(row.bedrag_per_jaar ?? 0),
              herverdeel_pct: Number(row.herverdeel_pct ?? 0),
              ignored: false,
              isNew: false
            }))
          : []
      );
      setDraftPackagingPrices({});
      setDraftPackagingPricesTarget([]);
      setDraftVerkoopstrategieTarget([]);
      setLiveVerkoopstrategieRows([]);
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
      const result = await deleteNewYearDraft({ apiBaseUrl: API_BASE_URL, targetYear });
      if (!result.ok) throw new Error(result.text || "Concept verwijderen mislukt.");
      setCompletedStepIds([]);
      setScenarioPrimaryCosts({});
      setDraftPackagingPrices({});
      setDraftPackagingPricesTarget([]);
      setDraftProductieTarget({
        hoeveelheid_inkoop_l: 0,
        hoeveelheid_productie_l: 0,
        batchgrootte_eigen_productie_l: 0,
        normal_shipments: 0,
        shipments: 0,
        normal_orderlines: 0,
        orderlines: 0
      });
      setDraftPlanTargets({
        revenue: 0,
        variable_cost: 0,
        contribution: 0,
        liters: 0,
        units: 0,
        price_change_pct: 0,
        volume_change_pct: 0,
        fixed_cost_inflation_pct: 0,
        mix_assumption: ""
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
      setLiveVerkoopstrategieRows([]);
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
    const invalidCostRows = [...kostprijsTargetRows.basisRows, ...kostprijsTargetRows.samengRows].filter(
      (row) => String(row.status ?? "") !== "ok"
    );
    if (invalidCostRows.length > 0) {
      setStatus(`Afronden geblokkeerd: ${invalidCostRows.length} kostprijsregel(s) in stap Kostprijs zijn onvolledig.`);
      return;
    }
    const confirmText = `Weet je zeker dat je het doeljaar ${targetYear} definitief wilt aanmaken? Dit schrijft alles in 1 keer weg naar de database.`;
    if (!confirm(confirmText)) return;

    setDraftStatus("committing");
    setIsRunning(true);
    setStatus("");
    setCommitConflict("");
    try {
      const result = await commitNewYear({
        apiBaseUrl: API_BASE_URL,
        sourceYear,
        targetYear,
        copyProductie,
        copyVasteKosten,
        copyTarieven,
        copyVerpakkingsonderdelen,
        copyVerkoopstrategie,
        copyBerekeningen: false,
        force: false,
        payload: buildDraftPayload(),
      });
      if (!result.ok && result.status === 409) {
        setCommitConflict(result.text || "Bronjaar is gewijzigd sinds dit concept is gestart.");
        throw new Error("Conflict bij afronden. Zie melding hieronder.");
      }
      if (!result.ok) throw new Error(result.text || "Afronden mislukt.");
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
    const invalidCostRows = [...kostprijsTargetRows.basisRows, ...kostprijsTargetRows.samengRows].filter(
      (row) => String(row.status ?? "") !== "ok"
    );
    if (invalidCostRows.length > 0) {
      setStatus(`Afronden geblokkeerd: ${invalidCostRows.length} kostprijsregel(s) in stap Kostprijs zijn onvolledig.`);
      return;
    }
    const confirmText = `Bronjaar is gewijzigd. Weet je zeker dat je tóch wilt afronden met de huidige bronjaar-stand?`;
    if (!confirm(confirmText)) return;
    setDraftStatus("committing");
    setIsRunning(true);
    setStatus("");
    try {
      const result = await commitNewYear({
        apiBaseUrl: API_BASE_URL,
        sourceYear,
        targetYear,
        copyProductie,
        copyVasteKosten,
        copyTarieven,
        copyVerpakkingsonderdelen,
        copyVerkoopstrategie,
        copyBerekeningen: false,
        force: true,
        payload: buildDraftPayload(),
      });
      if (!result.ok) throw new Error(result.text || "Afronden mislukt.");
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
    const sourceSalesForDrivers = Number(
      sourceYearCloseReference?.salesLiters ??
      (sourceProductie as any).normal_sales_l ??
      (sourceProductie as any).sales_l ??
      0
    );
    setDraftProductieTarget({
      ...sourceProductie,
      normal_sales_l: sourceSalesForDrivers,
      sales_l: sourceSalesForDrivers,
      hoeveelheid_inkoop_l: Number(sourceYearCloseReference?.purchaseLiters ?? (sourceProductie as any).hoeveelheid_inkoop_l ?? 0),
      hoeveelheid_productie_l: Number(sourceYearCloseReference?.productionLiters ?? (sourceProductie as any).hoeveelheid_productie_l ?? 0),
      normal_shipments: Number((sourceProductie as any).normal_shipments ?? (sourceProductie as any).shipments ?? 0),
      shipments: Number((sourceProductie as any).shipments ?? (sourceProductie as any).normal_shipments ?? 0),
      normal_orderlines: Number((sourceProductie as any).normal_orderlines ?? (sourceProductie as any).orderlines ?? 0),
      orderlines: Number((sourceProductie as any).orderlines ?? (sourceProductie as any).normal_orderlines ?? 0),
    });
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
    const sourceByComponent = new Map<string, number>();
    currentPackagingPrices
      .filter((row) => row.jaar === sourceYear)
      .forEach((row) => sourceByComponent.set(row.verpakkingsonderdeel_id, row.prijs_per_stuk));
    const inflationPct = Number(draftPlanTargets.fixed_cost_inflation_pct ?? 0);
    packagingRowsForTarget.forEach((row) => {
      const sourcePrice = sourceByComponent.get(row.componentId) ?? 0;
      next[row.componentId] =
        row.prijs_per_stuk > 0
          ? row.prijs_per_stuk
          : Number((sourcePrice * (1 + (Number.isFinite(inflationPct) ? inflationPct : 0) / 100)).toFixed(2));
    });
    setDraftPackagingPrices(next);
  }


  function copyPackagingPricesFromSource() {
    const sourceByComponent = new Map<string, number>();
    currentPackagingPrices
      .filter((row) => row.jaar === sourceYear)
      .forEach((row) => sourceByComponent.set(row.verpakkingsonderdeel_id, row.prijs_per_stuk));

    const inflationPct = Number(draftPlanTargets.fixed_cost_inflation_pct ?? 0);
    const next: Record<string, number> = {};
    packagingComponents.forEach((component) => {
      const sourcePrice = sourceByComponent.get(component.id) ?? 0;
      next[component.id] = Number((sourcePrice * (1 + (Number.isFinite(inflationPct) ? inflationPct : 0) / 100)).toFixed(2));
    });
    setDraftPackagingPrices(next);
  }

  useEffect(() => {
    if (!copyVerpakkingsonderdelen) return;
    if (activeStep !== 5) return;
    if (packagingComponents.length === 0) return;
    if (Object.keys(draftPackagingPrices).length > 0) return;
    copyPackagingPricesFromSource();
  }, [
    activeStep,
    copyVerpakkingsonderdelen,
    currentPackagingPrices,
    draftPackagingPrices,
    draftPlanTargets.fixed_cost_inflation_pct,
    packagingComponents,
    sourceYear,
  ]);

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

  function fixedCostRowsForYear(year: number): Array<Record<string, unknown>> {
    const rows =
      year === targetYear
        ? sanitizeVasteKostenTarget(draftVasteKostenTarget).filter((row) => !Boolean((row as any).ignored))
        : ((currentVasteKosten as any)?.[String(year)] as unknown);
    return Array.isArray(rows) ? (rows as any) : [];
  }

  function computeIndirectFixedCostPerInkoopLiter(year: number) {
    return computeIndirectFixedCostPerInkoopLiterForYear({
      year,
      productieYear: getProductieForYear(year),
      vasteKostenRows: fixedCostRowsForYear(year)
    });
  }

  function computeDirectFixedCostPerProductieLiter(year: number) {
    return computeDirectFixedCostPerProductieLiterForYear({
      year,
      productieYear: getProductieForYear(year),
      vasteKostenRows: fixedCostRowsForYear(year)
    });
  }

  function computeAccijnsForLiters(year: number, record: any, liters: number) {
    const tariefRow = year === targetYear ? draftTariefTarget : getTariefForYear(year);
    return computeAccijnsForLitersDerived({ year, record, liters, tarievenHeffingenRow: tariefRow });
  }

  function calculateEigenProductiePrijsPerEenheid(regel: Partial<IngredientRule>) {
    return calculateEigenProductiePrijsPerEenheidDerived(regel as any);
  }

  function calculateEigenProductieKostenRecept(regel: Partial<IngredientRule>) {
    return calculateEigenProductieKostenReceptDerived(regel as any);
  }

  function computeEigenProductieReceptTotals(override: EigenProductieOverride | null, batchGrootteLiters: number) {
    return computeEigenProductieReceptTotalsDerived(override as any, batchGrootteLiters);
  }

  // NOTE: In verkoopstrategie we persist opslag% as the source of truth (legacy field name `sell_in_margins`).
  function computeSellInPrice(cost: number, opslagPct: number) {
    return computeSellInPriceDerived(cost, opslagPct);
  }

  function computeMarginFromSellIn(cost: number, sellIn: number) {
    // Backwards-compatible name; this now returns opslag% derived from sell-in price.
    return computeMarginFromSellInDerived(cost, sellIn);
  }

  const basisParentForStrategy = useMemo(() => {
    return buildBasisParentForStrategy(Array.isArray(initialSamengesteldeProducten) ? initialSamengesteldeProducten : []);
  }, [initialSamengesteldeProducten]);

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

      const upsertBeerOverride = (
        skuId: string,
        bierId: string,
        biernaam: string,
        productId: string,
        productType: string,
        productLabel: string
      ) => {
        const existingIndex = nextRows.findIndex(
          (row) =>
            String(row.record_type ?? "") === "verkoopstrategie_product" &&
            Number(row.jaar ?? 0) === targetYear &&
            String(row.sku_id ?? "") === skuId
        );
        const base =
          existingIndex >= 0
            ? { ...(nextRows[existingIndex] as any) }
            : {
                id: "",
                record_type: "verkoopstrategie_product",
                jaar: targetYear,
                bron_jaar: sourceYear,
                sku_id: skuId,
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
        const skuId = String(row.skuId ?? "").trim();
        if (!skuId) return;
        const bierId = row.bierId;
        const biernaam = row.biernaam;
        const productId = row.productId;
        const productType = row.productType;
        const sourceCost = clampNumber(row.sourceCost, 0);
        const targetCost = clampNumber(row.estimatedTargetCost, 0);

        channels.forEach((channel) => {
          const sourceStrategyRow = (Array.isArray(currentVerkoopprijzen) ? currentVerkoopprijzen : []).find(
            (strategyRow) =>
              STRATEGY_RECORD_TYPES.has(String((strategyRow as any).record_type ?? "")) &&
              Number((strategyRow as any).jaar ?? 0) === sourceYear &&
              String((strategyRow as any).sku_id ?? "") === skuId
          );
          const marginRaw = (sourceStrategyRow as any)?.sell_in_margins?.[channel.code];
          const marginSource = Number.isFinite(Number(marginRaw)) ? Number(marginRaw) : channel.defaultMargin;
          const priceRaw = (sourceStrategyRow as any)?.sell_in_prices?.[channel.code];
          const explicitSellIn = Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : null;
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

          const overrideRow = upsertBeerOverride(skuId, bierId, biernaam, productId, productType, row.productLabel);
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

  const sourceYearActiveRows = useMemo<ActiveCostRow[]>(() => {
    return buildActiveRows({
      kostprijsproductactiveringen: currentActivations,
      selectedYear: sourceYear,
      search: "",
      activeSort: { key: "artikel", direction: "asc" },
      bierenById: bierenByIdForActiveRows,
      basisById: basisByIdForActiveRows,
      skuById: skuByIdForActiveRows,
      articleById: articleByIdForActiveRows,
      bomLines: Array.isArray(initialBomLines) ? initialBomLines : [],
      samengesteldById: samengesteldByIdForActiveRows,
      berekeningenById: berekeningenByIdForActiveRows,
      currentBerekeningen,
      packagingComponentPrices: currentPackagingPrices,
    });
  }, [
    articleByIdForActiveRows,
    basisByIdForActiveRows,
    berekeningenByIdForActiveRows,
    bierenByIdForActiveRows,
    currentActivations,
    currentBerekeningen,
    currentPackagingPrices,
    initialBomLines,
    samengesteldByIdForActiveRows,
    skuByIdForActiveRows,
    sourceYear,
  ]);

  const inkoopScenarioRows = useMemo(() => {
    return sourceYearActiveRows
      .map((row) => {
        const productId = String(row.productId ?? "").trim();
        if (!productId) return null;
        const versionRecord = row.versieId ? berekeningenByIdForActiveRows.get(row.versieId) ?? null : null;
        const snap = versionRecord ? snapshotProductCostFromRecord(versionRecord, productId) : null;
        const calcTypeRaw = String(
          (versionRecord as any)?.type ?? (versionRecord as any)?.soort_berekening?.type ?? ""
        ).trim().toLowerCase();
        const costSource = String((versionRecord as any)?.cost_source ?? "").trim().toLowerCase();
        const productType = samengesteldByIdForActiveRows.has(productId)
          ? "samengesteld"
          : basisByIdForActiveRows.has(productId)
            ? "basis"
            : String(row.productType ?? "");
        const isBasisLike = productType === "basis" || productType === "sku";
        const hasParentComposite = isBasisLike && basisParentForStrategy.has(productId);
        const sourceCost =
          typeof row.currentCost === "number" && Number.isFinite(row.currentCost)
            ? row.currentCost
            : Number((snap as any)?.kostprijs ?? 0);
        const sourcePrimaryCost = Number((snap as any)?.primaireKosten ?? sourceCost) || 0;
        const isInkoopVersion = calcTypeRaw === "inkoop" || costSource === "historical_sku_cost";
        const isReadOnlyComponentArticle = !versionRecord && String(row.sourceLabel ?? "").toLowerCase() === "componenten";
        if (!isInkoopVersion && !isReadOnlyComponentArticle) return null;
        const recordBasis =
          typeof (versionRecord as any)?.basisgegevens === "object" && (versionRecord as any)?.basisgegevens
            ? (versionRecord as any).basisgegevens
            : {};
        const canonicalBeerId = String(
          (versionRecord as any)?.bier_id ?? recordBasis?.bier_id ?? row.groupLabel ?? row.bierNaam ?? "Zonder stijl"
        ).trim();
        const displayBeerName = String(row.groupLabel || row.bierNaam || recordBasis?.biernaam || canonicalBeerId || "Zonder stijl");
        return {
          skuId: String(row.skuId ?? "").trim(),
          bierId: canonicalBeerId,
          biernaam: displayBeerName,
          productId,
          productType,
          isDerived: hasParentComposite,
          canEdit: isInkoopVersion && (productType === "samengesteld" || (isBasisLike && !hasParentComposite)),
          productLabel: row.artikelNaam || row.productNaam || productId,
          sourcePrimaryCost,
          sourceCost,
          estimatedTargetCost: sourceCost,
          sourceLabel: row.sourceLabel,
          supplierLabel: row.supplierLabel,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a: any, b: any) => (a.biernaam + a.productLabel).localeCompare(b.biernaam + b.productLabel, "nl-NL"));
  }, [
    basisByIdForActiveRows,
    basisParentForStrategy,
    berekeningenByIdForActiveRows,
    samengesteldByIdForActiveRows,
    sourceYearActiveRows,
  ]);
  const sourceSalesLiters = useMemo(() => {
    const explicitSalesLiters = Number((sourceProductie as any)?.sales_l ?? 0);
    if (explicitSalesLiters > 0) return explicitSalesLiters;
    return Number((sourceProductie as any)?.normal_sales_l ?? 0);
  }, [sourceProductie]);

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
              source_prijs: Number(row.prijs ?? 0),
              prijs: Number((Number(row.prijs ?? 0) * (1 + Number(draftPlanTargets.fixed_cost_inflation_pct ?? 0) / 100)).toFixed(2)),
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
    draftPlanTargets.fixed_cost_inflation_pct,
    eigenProductieBieren,
    sourceEigenProductieVersionByBierId
  ]);

  const kostprijsTargetRows = useMemo(() => {
    return buildKostprijsTargetRows({
      initialBasisproducten,
      initialSamengesteldeProducten,
      initialBieren,
      initialSkus,
      initialArticles,
      initialBomLines,
      currentPackagingPrices,
      draftPackagingPrices,
      sourceYear,
      targetYear,
      currentBerekeningen,
      currentActivations,
      sourceActiveRows: sourceYearActiveRows,
      eigenProductieOverrides,
      scenarioPrimaryCosts,
      getProductieForYear,
      fixedCostRowsForYear,
      computeFixedCostPerLiter,
      computeAccijnsForLiters,
      computeEigenProductieReceptTotals,
    });
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
    initialSkus,
    initialArticles,
    initialBomLines,
    initialBieren,
    initialSamengesteldeProducten,
    eigenProductieOverrides,
    scenarioPrimaryCosts,
    sourceYearActiveRows,
    sourceYear,
    targetYear
  ]);

  const previewRows = useMemo<PreviewRow[]>(() => {
    return buildPreviewRows({
      kostprijsTargetRows,
      currentVerkoopprijzen,
      draftVerkoopstrategieTarget,
      targetYear,
      calcSellInPrice,
    });
  }, [
    currentVerkoopprijzen,
    draftVerkoopstrategieTarget,
    kostprijsTargetRows,
    targetYear,
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
        label: `Plan ${targetYear}`,
        description: "Omzet, kosten en volume voor het doeljaar",
        panelTitle: `Plan ${targetYear}`,
        panelDescription: `Bepaal het top-down doel voor ${targetYear}. Omzet is leidend; variabele kosten en volume worden afgeleid van ${sourceYear} en blijven bijstuurbaar.`
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
        id: "plan-hercontrole",
        label: `Plan ${targetYear} opnieuw`,
        description: "Laatste controle met voorraad",
        panelTitle: `Plan ${targetYear} opnieuw`,
        panelDescription:
          "Controleer het doeljaar opnieuw na kostprijs, verkoopstrategie, adviesprijzen en beginvoorraad. Voorraad verlaagt alleen de productie-/inkoopbehoefte."
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
  const targetFixedCostTotal = useMemo(
    () =>
      (Array.isArray(draftVasteKostenTarget) ? draftVasteKostenTarget : []).reduce(
        (sum, row) => sum + (Boolean((row as any)?.ignored) ? 0 : Number((row as any)?.bedrag_per_jaar ?? 0)),
        0
      ),
    [draftVasteKostenTarget]
  );

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

  const rightRail = useMemo(() => {
    const validations: Array<{ tone: "ok" | "warn" | "error"; label: string; detail: string }> = [];

    validations.push({
      tone: conceptStarted ? "ok" : "warn",
      label: "Concept",
      detail: conceptStarted ? "Gestart" : "Nog niet gestart (stap Jaarset)"
    });

    if (draftStatus && draftStatus !== "idle") {
      validations.push({ tone: "warn", label: "Opslaan", detail: `Bezig: ${draftStatus}` });
    }

    if (commitConflict) {
      validations.push({ tone: "error", label: "Conflict", detail: commitConflict });
    }

    if (status) {
      const inferredTone: "ok" | "warn" | "error" = /mislukt|error|fout|conflict/i.test(status)
        ? "error"
        : /start eerst|uitgeschakeld|let op/i.test(status)
          ? "warn"
          : "ok";
      validations.push({ tone: inferredTone, label: "Status", detail: status });
    }

    const changes: Array<{ label: string; before: string; after: string; delta?: string; changed: boolean }> = [];

    if (copyProductie && sourceProductie) {
      const sourceInkoop = Number((sourceProductie as any)?.hoeveelheid_inkoop_l ?? 0);
      const sourceProductieLiters = Number((sourceProductie as any)?.hoeveelheid_productie_l ?? 0);
      const sourceBatch = Number((sourceProductie as any)?.batchgrootte_eigen_productie_l ?? 0);
      const targetInkoop = Number(draftProductieTarget.hoeveelheid_inkoop_l ?? 0);
      const targetProductieLiters = Number(draftProductieTarget.hoeveelheid_productie_l ?? 0);
      const targetBatch = Number(draftProductieTarget.batchgrootte_eigen_productie_l ?? 0);

      changes.push({
        label: "Inkoop (L)",
        before: String(sourceInkoop),
        after: String(targetInkoop),
        delta: String(targetInkoop - sourceInkoop),
        changed: sourceInkoop !== targetInkoop
      });
      changes.push({
        label: "Productie (L)",
        before: String(sourceProductieLiters),
        after: String(targetProductieLiters),
        delta: String(targetProductieLiters - sourceProductieLiters),
        changed: sourceProductieLiters !== targetProductieLiters
      });
      changes.push({
        label: "Batchgrootte (L)",
        before: String(sourceBatch),
        after: String(targetBatch),
        delta: String(targetBatch - sourceBatch),
        changed: sourceBatch !== targetBatch
      });
    }

    if (copyTarieven && sourceTarief) {
      const sHigh = Number(sourceTarief.tarief_hoog ?? 0);
      const sLow = Number(sourceTarief.tarief_laag ?? 0);
      const sVb = Number(sourceTarief.verbruikersbelasting ?? 0);
      const tHigh = Number(draftTariefTarget.tarief_hoog ?? 0);
      const tLow = Number(draftTariefTarget.tarief_laag ?? 0);
      const tVb = Number(draftTariefTarget.verbruikersbelasting ?? 0);

      changes.push({
        label: "Accijns hoog",
        before: formatEur(sHigh),
        after: formatEur(tHigh),
        changed: sHigh !== tHigh
      });
      changes.push({
        label: "Accijns laag",
        before: formatEur(sLow),
        after: formatEur(tLow),
        changed: sLow !== tLow
      });
      changes.push({
        label: "Verbruikersbelasting",
        before: formatEur(sVb),
        after: formatEur(tVb),
        changed: sVb !== tVb
      });
    }

    if (copyVasteKosten) {
      const sourceTotal = sourceVasteKostenRows.reduce((sum, row) => sum + Number(row.bedrag_per_jaar ?? 0), 0);
      const targetTotal = (Array.isArray(draftVasteKostenTarget) ? draftVasteKostenTarget : []).reduce(
        (sum, row) => sum + (Boolean((row as any)?.ignored) ? 0 : Number((row as any)?.bedrag_per_jaar ?? 0)),
        0
      );
      changes.push({
        label: "Vaste kosten totaal",
        before: formatEur(sourceTotal),
        after: formatEur(targetTotal),
        delta: formatEur(targetTotal - sourceTotal),
        changed: Math.abs(targetTotal - sourceTotal) > 0.0001
      });
    }

    if (copyVerpakkingsonderdelen) {
      const sourcePrices = (Array.isArray(currentPackagingPrices) ? currentPackagingPrices : [])
        .filter((row) => Number((row as any)?.jaar ?? 0) === sourceYear)
        .reduce<Record<string, number>>((acc, row) => {
          acc[String((row as any)?.verpakkingsonderdeel_id ?? "")] = Number((row as any)?.prijs_per_stuk ?? 0);
          return acc;
        }, {});

      const changedCount = packagingComponents.reduce((count, component) => {
        const key = String(component.id);
        const before = Number(sourcePrices[key] ?? 0);
        const after = Number(draftPackagingPrices[key] ?? before);
        return count + (Math.abs(after - before) > 0.0001 ? 1 : 0);
      }, 0);

      changes.push({
        label: "Verpakkingsprijzen",
        before: `${packagingComponents.length} onderdelen`,
        after: `${changedCount} gewijzigd`,
        changed: changedCount > 0
      });
    }

    if (copyVerkoopstrategie) {
      const draftCount = Array.isArray(draftVerkoopstrategieTarget) ? draftVerkoopstrategieTarget.length : 0;
      const draftAdviesCount = Array.isArray(draftAdviesprijzenTarget) ? draftAdviesprijzenTarget.length : 0;
      changes.push({
        label: "Verkoopstrategie records",
        before: "-",
        after: String(draftCount),
        changed: draftCount > 0
      });
      changes.push({
        label: "Adviesprijzen records",
        before: "-",
        after: String(draftAdviesCount),
        changed: draftAdviesCount > 0
      });
    }

    const changedItems = changes.filter((item) => item.changed);

    return {
      validations,
      changes: changedItems.length > 0 ? changedItems : [],
      changedCount: changedItems.length
    };
  }, [
    commitConflict,
    conceptStarted,
    copyProductie,
    copyTarieven,
    copyVasteKosten,
    copyVerkoopstrategie,
    copyVerpakkingsonderdelen,
    currentPackagingPrices,
    draftAdviesprijzenTarget,
    draftPackagingPrices,
    draftProductieTarget,
    draftStatus,
    draftTariefTarget,
    draftVerkoopstrategieTarget,
    draftVasteKostenTarget,
    packagingComponents,
    sourceProductie,
    sourceTarief,
    sourceVasteKostenRows,
    sourceYear,
    status,
    // status tone is inferred from status text
  ]);

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
                <NieuwJaarTrashIcon />
              </button>
            ) : null}
            <span className="pill">
              Bronjaar {sourceYear} -&gt; Doeljaar {targetYear}
            </span>
          </div>
        </div>

        <div className="cpq-grid cpq-grid-two">
          <aside className="cpq-left">
            <WizardSteps
              title={wizardSidebar.title}
              className="nieuw-jaar-wizard-steps"
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
                <NieuwJaarQuickCell label="Bronjaar" value={String(sourceYear)} />
                <NieuwJaarQuickCell label="Doeljaar" value={String(targetYear)} />
                <NieuwJaarQuickCell label="Concept" value={conceptStarted ? "Ja" : "Nee"} />
                <NieuwJaarQuickCell label="Bronstatus" value={sourceYearClose ? "Afgesloten" : "Open"} />
                <NieuwJaarQuickCell label="Actieve stap" value={`Stap ${activeStep + 1}`} />
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

          <div className={`editor-status ${sourceYearClose ? "success" : "warning"}`} style={{ marginBottom: 14 }}>
            <strong>
              {sourceYearClose
                ? `Bronjaar ${sourceYear} is afgesloten`
                : `Bronjaar ${sourceYear} is nog niet afgesloten`}
            </strong>
            <div className="muted" style={{ marginTop: 6 }}>
              {sourceYearClose
                ? `Deze jaarafsluiting is vastgelegd op ${sourceYearClose.closed_at || "-"}. Gebruik dit als referentie voor ${targetYear}: omzet ${formatEur(Number(sourceYearCloseTotals.revenue ?? 0))}, contributie ${formatEur(Number(sourceYearCloseTotals.contribution ?? 0))}.`
                : `Je kunt ${targetYear} alvast voorbereiden, maar de referentie voor ${sourceYear} is nog een open jaarset. Sluit het jaar af in Jaarbeheer zodra Omzet & Marge compleet is.`}
            </div>
          </div>

            <div className="wizard-step-body">
              {activeStep === 0 ? (
              <SelectYearsStep
                sourceYear={sourceYear}
                targetYear={targetYear}
                yearOptions={yearOptions}
                defaultSource={defaultSource}
                clampInt={clampInt}
                setSourceYear={setSourceYear}
                setTargetYearWithDraft={setTargetYearWithDraft}
                saveAndCloseButton={saveAndCloseButton}
                navigateToStep={navigateToStep}
              />
            ) : null}

            {activeStep === 1 ? (
              <InitializeConceptStep
                sourceYear={sourceYear}
                targetYear={targetYear}
                copyProductie={copyProductie}
                setCopyProductie={setCopyProductie}
                copyVasteKosten={copyVasteKosten}
                setCopyVasteKosten={setCopyVasteKosten}
                copyTarieven={copyTarieven}
                setCopyTarieven={setCopyTarieven}
                copyVerpakkingsonderdelen={copyVerpakkingsonderdelen}
                setCopyVerpakkingsonderdelen={setCopyVerpakkingsonderdelen}
                copyVerkoopstrategie={copyVerkoopstrategie}
                setCopyVerkoopstrategie={setCopyVerkoopstrategie}
                saveAndCloseButton={saveAndCloseButton}
                navigateToStep={navigateToStep}
                initializeYear={initializeYear}
                isRunning={isRunning}
                canInitialize={canInitialize}
                conceptStarted={conceptStarted}
              />
            ) : null}

          {activeStep === 2 ? (
            <ProductieTargetsStep
              sourceYear={sourceYear}
              targetYear={targetYear}
              sourceProductie={sourceProductie}
              sourceYearCloseReference={sourceYearCloseReference}
              sourceSalesLiters={sourceSalesLiters}
              targetFixedCostTotal={targetFixedCostTotal}
              draftProductieTarget={draftProductieTarget}
              setDraftProductieTarget={setDraftProductieTarget}
              draftPlanTargets={draftPlanTargets}
              setDraftPlanTargets={setDraftPlanTargets}
              copyProductieFromSource={copyProductieFromSource}
              saveProductieTarget={saveProductieTarget}
              navigateToStep={navigateToStep}
              saveAndCloseButton={saveAndCloseButton}
              isRunning={isRunning}
              formatEur={formatEur}
            />
          ) : null}

          {activeStep === 3 ? (
            <TarievenTargetsStep
              sourceYear={sourceYear}
              targetYear={targetYear}
              sourceTarief={sourceTarief}
              draftTariefTarget={draftTariefTarget}
              setDraftTariefTarget={setDraftTariefTarget}
              copyTariefFromSource={copyTariefFromSource}
              saveTariefTarget={saveTariefTarget}
              navigateToStep={navigateToStep}
              saveAndCloseButton={saveAndCloseButton}
              isRunning={isRunning}
            />
          ) : null}

          {activeStep === 4 ? (
            <VasteKostenTargetsStep
              sourceYear={sourceYear}
              targetYear={targetYear}
              isRunning={isRunning}
              saveAndCloseButton={saveAndCloseButton}
              navigateToStep={navigateToStep}
              sourceVasteKostenRows={sourceVasteKostenRows}
              draftVasteKostenTarget={draftVasteKostenTarget}
              sourceYearCloseReference={sourceYearCloseReference}
              draftPlanTargets={draftPlanTargets}
              updateVasteKostenRow={updateVasteKostenRow}
              updatePlanTargets={(patch) => setDraftPlanTargets((current) => ({ ...current, ...patch }))}
              removeVasteKostenRow={removeVasteKostenRow}
              addVasteKostenRow={addVasteKostenRow}
              fixedCostRowsForYear={fixedCostRowsForYear}
              computeHerverdelingTotals={computeHerverdelingTotals}
              formatEur={formatEur}
              saveDraftToServer={saveDraftToServer}
            />
          ) : null}

          {activeStep === 5 ? (
            <PackagingPricesTargetsStep
              sourceYear={sourceYear}
              targetYear={targetYear}
              isRunning={isRunning}
              saveAndCloseButton={saveAndCloseButton}
              navigateToStep={navigateToStep}
              formatEur={formatEur}
              packagingComponentsCount={packagingComponents.length}
              packagingRowsForTarget={packagingRowsForTarget}
              currentPackagingPrices={currentPackagingPrices}
              draftPackagingPrices={draftPackagingPrices}
              setDraftPackagingPrices={setDraftPackagingPrices}
              inflationPct={Number(draftPlanTargets.fixed_cost_inflation_pct ?? 0)}
              copyPackagingPricesFromSource={copyPackagingPricesFromSource}
              savePackagingPricesTarget={savePackagingPricesTarget}
            />
          ) : null}

          {activeStep === 6 ? (
            <InkoopScenarioStep
              sourceYear={sourceYear}
              isRunning={isRunning}
              saveAndCloseButton={saveAndCloseButton}
              navigateToStep={navigateToStep}
              formatEur={formatEur}
              inkoopScenarioRows={inkoopScenarioRows}
              scenarioPrimaryCosts={scenarioPrimaryCosts}
              setScenarioPrimaryCosts={setScenarioPrimaryCosts}
            />
          ) : null}

          {activeStep === 7 ? (
            <>
              <EigenProductieReceptenStep
                sourceYear={sourceYear}
                targetYear={targetYear}
                isRunning={isRunning}
                saveAndCloseButton={saveAndCloseButton}
                navigateToStep={navigateToStep}
                formatEur={formatEur}
                eigenProductieBieren={eigenProductieBieren}
                sourceEigenProductieVersionByBierId={sourceEigenProductieVersionByBierId}
                ensureEigenOverride={ensureEigenOverride}
                updateEigenOverride={updateEigenOverride}
                updateEigenIngredient={updateEigenIngredient}
                deleteEigenIngredient={deleteEigenIngredient}
                addEigenIngredient={addEigenIngredient}
                applyIngredientInflation={applyIngredientInflation}
                inflationPct={Number(draftPlanTargets.fixed_cost_inflation_pct ?? 0)}
                getProductieForYear={getProductieForYear}
                computeEigenProductieReceptTotals={computeEigenProductieReceptTotals}
                calculateEigenProductieKostenRecept={calculateEigenProductieKostenRecept}
              />
              
            </>
          ) : null}

          {activeStep === 8 ? (
            <>
              <KostprijsReadOnlyStep
                sourceYear={sourceYear}
                targetYear={targetYear}
                isRunning={isRunning}
                saveAndCloseButton={saveAndCloseButton}
                navigateToStep={navigateToStep}
                formatEur={formatEur}
                kostprijsTargetRows={kostprijsTargetRows}
              />
              
            </>
          ) : null}

          {activeStep === 9 ? (
            <>
              <VerkoopstrategieDraftStep
                sourceYear={sourceYear}
                targetYear={targetYear}
                isRunning={isRunning}
                conceptStarted={conceptStarted}
                saveAndCloseButton={saveAndCloseButton}
                navigateToStep={navigateToStep}
                pricingMode={pricingMode}
                setPricingMode={setPricingMode}
                applyPricingScenario={applyPricingScenario}
                wizardVerkoopprijzen={wizardVerkoopprijzen}
                currentProductie={currentProductie}
                initialBasisproducten={Array.isArray(initialBasisproducten) ? initialBasisproducten : []}
                initialSamengesteldeProducten={Array.isArray(initialSamengesteldeProducten) ? initialSamengesteldeProducten : []}
                initialBieren={Array.isArray(initialBieren) ? initialBieren : []}
                currentBerekeningen={Array.isArray(currentBerekeningen) ? currentBerekeningen : []}
                currentActivations={Array.isArray(currentActivations) ? currentActivations : []}
                previewRows={previewRows}
                kostprijsTargetRows={kostprijsTargetRows}
                draftPlanTargets={draftPlanTargets}
                sourceYearCloseReference={sourceYearCloseReference}
                formatEur={formatEur}
                verkoopstrategieSave={verkoopstrategieSave}
                setVerkoopstrategieSave={setVerkoopstrategieSave}
                setDraftVerkoopstrategieTarget={setDraftVerkoopstrategieTarget}
                setLiveVerkoopstrategieRows={setLiveVerkoopstrategieRows}
                setCompletedStepIds={setCompletedStepIds}
                saveDraftToServer={saveDraftToServer}
              />
              
            </>
          ) : null}

          {activeStep === 10 ? (
            <>
              <AdviesprijzenTargetsStep
                sourceYear={sourceYear}
                targetYear={targetYear}
                isRunning={isRunning}
                saveAndCloseButton={saveAndCloseButton}
                navigateToStep={navigateToStep}
                formatEur={formatEur}
                currentAdviesprijzen={currentAdviesprijzen}
                wizardVerkoopprijzen={wizardVerkoopprijzen}
                draftVerkoopstrategieTarget={draftVerkoopstrategieTarget}
                liveVerkoopstrategieRows={liveVerkoopstrategieRows}
                draftAdviesprijzenTarget={draftAdviesprijzenTarget}
                kostprijsTargetRows={kostprijsTargetRows}
                adviesprijzenDraftInputs={adviesprijzenDraftInputs}
                setAdviesprijzenDraftInputs={setAdviesprijzenDraftInputs}
                setDraftAdviesprijzenTarget={setDraftAdviesprijzenTarget}
              />
              
            </>
          ) : null}

          {activeStep === 11 ? (
            <PreviewStep
              sourceYear={sourceYear}
              targetYear={targetYear}
              formatEur={formatEur}
              isRunning={isRunning}
              conceptStarted={conceptStarted}
              saveAndCloseButton={saveAndCloseButton}
              navigateToStep={navigateToStep}
              saveDraftToServer={saveDraftToServer}
              wizardVerkoopprijzen={wizardVerkoopprijzen}
              draftVerkoopstrategieTarget={draftVerkoopstrategieTarget}
              liveVerkoopstrategieRows={liveVerkoopstrategieRows}
              draftAdviesprijzenTarget={draftAdviesprijzenTarget}
              adviesprijzenDraftInputs={adviesprijzenDraftInputs}
              kostprijsTargetRows={kostprijsTargetRows}
            />
          ) : null}

          {activeStep === 12 ? (
            <PlanHercontroleStep
              sourceYear={sourceYear}
              targetYear={targetYear}
              draftPlanTargets={draftPlanTargets}
              draftProductieTarget={draftProductieTarget}
              targetFixedCostTotal={targetFixedCostTotal}
              targetIncidentalCostTotal={0}
              sourceYearCloseReference={sourceYearCloseReference}
              currentVerkoopprijzen={currentVerkoopprijzen}
              draftVerkoopstrategieTarget={draftVerkoopstrategieTarget}
              liveVerkoopstrategieRows={liveVerkoopstrategieRows}
              formatEur={formatEur}
              saveAndCloseButton={saveAndCloseButton}
              navigateToStep={navigateToStep}
            />
          ) : null}

          {activeStep === 13 ? (
            <AfrondenStep
              targetYear={targetYear}
              isRunning={isRunning}
              commitConflict={commitConflict}
              setCommitConflict={setCommitConflict}
              initializeYear={initializeYear}
              commitTargetYearForce={commitTargetYearForce}
              saveAndCloseButton={saveAndCloseButton}
              navigateToStep={navigateToStep}
              saveDraftToServer={saveDraftToServer}
              commitTargetYear={commitTargetYear}
            />
          ) : null}
          </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

