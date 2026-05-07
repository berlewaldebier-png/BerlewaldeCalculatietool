"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  BerekeningenWizard,
  type BerekeningenWizardPersistResult
} from "@/components/BerekeningenWizard";
import {
  ArticleKostprijsWizard,
  type ArticleKostprijsWizardPersistResult,
} from "@/components/ArticleKostprijsWizard";
import { API_BASE_URL } from "@/lib/api";
import {
  formatEuro,
  formatPct,
} from "@/components/kostprijsbeheer/kostprijsBeheerUtils";
import type { PendingActivationState } from "@/components/kostprijsbeheer/ActivationModal";
import { KostprijsBeheerHero } from "@/components/kostprijsbeheer/KostprijsBeheerHero";
import { ActiveKostprijzenSection } from "@/components/kostprijsbeheer/ActiveKostprijzenSection";
import { ExistingBerekeningenSection } from "@/components/kostprijsbeheer/ExistingBerekeningenSection";
import {
  buildActiveRows,
  buildExistingBerekeningenRows,
  type ActiveCostRow,
  type ExistingBerekeningRow,
} from "@/components/kostprijsbeheer/kostprijsBeheerDerivations";

type GenericRecord = Record<string, unknown>;

type KostprijsBeheerWorkspaceProps = {
  berekeningen: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  bieren: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  bomLines: GenericRecord[];
  productie: Record<string, GenericRecord>;
  vasteKosten: Record<string, GenericRecord[]>;
  tarievenHeffingen: GenericRecord[];
  packagingComponentPrices: GenericRecord[];
  productgroepen: GenericRecord[];
  alcoholcategorieen: GenericRecord[];
  verpakkingstypen: GenericRecord[];
  initialMode?: string;
  initialFocus?: string;
  initialWizardKind?: string;
  initialSkuId?: string;
};

type WorkspaceMode = "landing" | "wizard-new" | "wizard-edit";
type NewWizardKind = "beer" | "article";
type ExistingFilterMode = "all" | "concept" | "definitief";

export function KostprijsBeheerWorkspace({
  berekeningen,
  kostprijsproductactiveringen,
  basisproducten,
  samengesteldeProducten,
  bieren,
  skus,
  articles,
  bomLines,
  productie,
  vasteKosten,
  tarievenHeffingen,
  packagingComponentPrices,
  productgroepen,
  alcoholcategorieen,
  verpakkingstypen,
  initialMode,
  initialFocus,
  initialWizardKind,
  initialSkuId
}: KostprijsBeheerWorkspaceProps) {
  const [currentBerekeningen, setCurrentBerekeningen] = useState<GenericRecord[]>(
    Array.isArray(berekeningen) ? berekeningen : []
  );
  const [currentBieren, setCurrentBieren] = useState<GenericRecord[]>(Array.isArray(bieren) ? bieren : []);
  const normalizedInitialMode =
    initialMode === "wizard-new" || initialMode === "wizard-edit"
      ? (initialMode as WorkspaceMode)
      : "landing";

  const [mode, setMode] = useState<WorkspaceMode>(normalizedInitialMode);
  const normalizedInitialWizardKind =
    normalizedInitialMode === "wizard-new" && String(initialWizardKind ?? "") === "article"
      ? "article"
      : "beer";
  const [newWizardKind, setNewWizardKind] = useState<NewWizardKind>(normalizedInitialWizardKind);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeSort, setActiveSort] = useState<{
    key: "bron";
    direction: "asc" | "desc";
  }>({ key: "bron", direction: "desc" });
  const [pendingActivation, setPendingActivation] = useState<PendingActivationState | null>(null);
  const [activationStatus, setActivationStatus] = useState("");

  // Lightweight "focus" hook for deep links from the dashboard (no UI changes, only initial scroll).
  const focusActivations = String(initialFocus ?? "") === "activations";
  const activeCostsRef = useRef<HTMLDivElement | null>(null);
  const existingRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!focusActivations) {
      return;
    }
    // Defer to allow the landing UI to mount first.
    const handle = window.setTimeout(() => {
      activeCostsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    return () => window.clearTimeout(handle);
  }, [focusActivations]);



  const productionYears = useMemo(() => {
    const years = Object.keys(productie)
      .filter((value) => /^\d+$/.test(value))
      .map((value) => Number(value))
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
    return years;
  }, [productie]);

  const activationYears = useMemo(() => {
    const years = new Set<number>();
    (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []).forEach(
      (row) => {
        const year = Number((row as any)?.jaar ?? 0) || 0;
        if (year > 0) {
          years.add(year);
        }
      }
    );
    return Array.from(years).sort((a, b) => a - b);
  }, [kostprijsproductactiveringen]);

  const yearOptions = useMemo(() => {
    const merged = new Set<number>([...productionYears, ...activationYears]);
    return Array.from(merged).sort((a, b) => a - b);
  }, [activationYears, productionYears]);

  const defaultYear = useMemo(() => {
    const now = new Date().getFullYear();
    if (productionYears.includes(now)) {
      return now;
    }
    if (productionYears.length > 0) {
      return productionYears[productionYears.length - 1];
    }
    if (activationYears.length > 0) {
      return activationYears[activationYears.length - 1];
    }
    return now;
  }, [activationYears, productionYears]);

  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);
  const [existingFilterMode, setExistingFilterMode] = useState<ExistingFilterMode>("concept");
  const [existingSearch, setExistingSearch] = useState("");

  useEffect(() => {
    setCurrentBerekeningen(Array.isArray(berekeningen) ? berekeningen : []);
  }, [berekeningen]);

  useEffect(() => {
    setCurrentBieren(Array.isArray(bieren) ? bieren : []);
  }, [bieren]);

  async function refreshBieren() {
    try {
      const response = await fetch(`${API_BASE_URL}/data/bieren`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const nextBieren = (await response.json()) as GenericRecord[];
      setCurrentBieren(Array.isArray(nextBieren) ? nextBieren : []);
    } catch {
      // Keep the current UI responsive; a later bootstrap refresh will still recover.
    }
  }

  function handleRowsChange(rows: GenericRecord[]) {
    setCurrentBerekeningen(Array.isArray(rows) ? rows : []);
    void refreshBieren();
  }

  function handlePersisted(result: BerekeningenWizardPersistResult) {
    if (result.year > 0) {
      setSelectedYear(result.year);
    }
    if (result.id) {
      setSelectedId(result.id);
    }
    setExistingFilterMode(result.status === "definitief" ? "definitief" : "concept");
  }

  function handleArticlePersisted(result: ArticleKostprijsWizardPersistResult) {
    if (result.year > 0) {
      setSelectedYear(result.year);
    }
    if (result.id) {
      setSelectedId(result.id);
    }
    setExistingFilterMode(result.status === "definitief" ? "definitief" : "concept");
  }

  const bierenById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(currentBieren) ? currentBieren : []).forEach((row) => {
      const id = String((row as any)?.id ?? "");
      const naam = String((row as any)?.naam ?? (row as any)?.biernaam ?? "");
      if (id && naam) {
        map.set(id, naam);
      }
    });
    return map;
  }, [currentBieren]);

  const basisById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(basisproducten) ? basisproducten : []).forEach((row) => {
      const id = String((row as any)?.id ?? "");
      const label = String((row as any)?.omschrijving ?? "");
      if (id && label) {
        map.set(id, label);
      }
    });
    return map;
  }, [basisproducten]);

  const skuById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(skus) ? skus : []).forEach((row) => {
      const id = String((row as any)?.id ?? "");
      if (id) {
        map.set(id, row);
      }
    });
    return map;
  }, [skus]);

  const articleById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(articles) ? articles : []).forEach((row) => {
      const id = String((row as any)?.id ?? "");
      if (id) {
        map.set(id, row);
      }
    });
    return map;
  }, [articles]);

  const samengesteldById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(samengesteldeProducten) ? samengesteldeProducten : []).forEach((row) => {
      const id = String((row as any)?.id ?? "");
      const label = String((row as any)?.omschrijving ?? "");
      if (id && label) {
        map.set(id, label);
      }
    });
    return map;
  }, [samengesteldeProducten]);

  const berekeningenById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(currentBerekeningen) ? currentBerekeningen : []).forEach((row) => {
      const id = String((row as any)?.id ?? "");
      if (id) {
        map.set(id, row);
      }
    });
    return map;
  }, [currentBerekeningen]);

  const existingBerekeningenRows: ExistingBerekeningRow[] = useMemo(() => {
    return buildExistingBerekeningenRows({
      currentBerekeningen,
      bierenById,
      existingSearch,
      existingFilterMode,
      selectedYear,
    });
  }, [bierenById, currentBerekeningen, existingFilterMode, existingSearch, selectedYear]);

  const activeRows: ActiveCostRow[] = useMemo(() => {
    return buildActiveRows({
      kostprijsproductactiveringen,
      selectedYear,
      search,
      activeSort,
      bierenById,
      basisById,
      skuById,
      articleById,
      samengesteldById,
      berekeningenById,
      currentBerekeningen,
    });
  }, [
    activeSort.direction,
    activeSort.key,
    basisById,
    berekeningenById,
    bierenById,
    currentBerekeningen,
    kostprijsproductactiveringen,
    search,
    samengesteldById,
    selectedYear,
  ]);

  if (mode === "wizard-new") {
    if (newWizardKind === "article") {
      return (
        <ArticleKostprijsWizard
          initialRows={currentBerekeningen}
          kostprijsproductactiveringen={kostprijsproductactiveringen}
          skus={skus}
          articles={articles}
          bomLines={bomLines}
          packagingComponentPrices={packagingComponentPrices}
          initialBundleSkuId={typeof initialSkuId === "string" ? initialSkuId : ""}
          startWithNew
          onRowsChange={handleRowsChange}
          onPersisted={handleArticlePersisted}
          onFinish={() => setMode("landing")}
          onBackToLanding={() => setMode("landing")}
        />
      );
    }

    return (
      <BerekeningenWizard
        initialRows={currentBerekeningen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        skus={skus}
        bieren={currentBieren}
        productie={productie}
        vasteKosten={vasteKosten}
        tarievenHeffingen={tarievenHeffingen}
        packagingComponentPrices={packagingComponentPrices}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
        productgroepen={productgroepen}
        alcoholcategorieen={alcoholcategorieen}
        verpakkingstypen={verpakkingstypen}
        startWithNew
        onRowsChange={handleRowsChange}
        onPersisted={handlePersisted}
        onFinish={() => setMode("landing")}
        onBackToLanding={() => setMode("landing")}
      />
    );
  }

  if (mode === "wizard-edit" && selectedId) {
    const record = berekeningenById.get(selectedId) ?? null;
    const recordType = String((record as any)?.type ?? "").toLowerCase();
    const basis = (record as any)?.basisgegevens ?? {};
    const skuType = String((basis as any)?.sku_type ?? "").toLowerCase();
    // Only composition-based bundles use ArticleKostprijsWizard.
    if (recordType === "bundle") {
      return (
        <ArticleKostprijsWizard
          initialRows={currentBerekeningen}
          kostprijsproductactiveringen={kostprijsproductactiveringen}
          skus={skus}
          articles={articles}
          bomLines={bomLines}
          packagingComponentPrices={packagingComponentPrices}
          initialSelectedId={selectedId}
          onRowsChange={handleRowsChange}
          onPersisted={handleArticlePersisted}
          onFinish={() => setMode("landing")}
          onBackToLanding={() => setMode("landing")}
        />
      );
    }

    // Non-beer (artikel/dienst) cost versions are handled in the main BerekeningenWizard.
    if (skuType === "artikel" || skuType === "dienst") {
      return (
        <BerekeningenWizard
          initialRows={currentBerekeningen}
          basisproducten={basisproducten}
          samengesteldeProducten={samengesteldeProducten}
          skus={skus}
          bieren={currentBieren}
          productie={productie}
          vasteKosten={vasteKosten}
          tarievenHeffingen={tarievenHeffingen}
          packagingComponentPrices={packagingComponentPrices}
          kostprijsproductactiveringen={kostprijsproductactiveringen}
          productgroepen={productgroepen}
          alcoholcategorieen={alcoholcategorieen}
          verpakkingstypen={verpakkingstypen}
          initialSelectedId={selectedId}
          onRowsChange={handleRowsChange}
          onPersisted={handlePersisted}
          onFinish={() => setMode("landing")}
          onBackToLanding={() => setMode("landing")}
        />
      );
    }

    return (
      <BerekeningenWizard
        initialRows={currentBerekeningen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        skus={skus}
        bieren={currentBieren}
        productie={productie}
        vasteKosten={vasteKosten}
        tarievenHeffingen={tarievenHeffingen}
        packagingComponentPrices={packagingComponentPrices}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
        productgroepen={productgroepen}
        alcoholcategorieen={alcoholcategorieen}
        verpakkingstypen={verpakkingstypen}
        initialSelectedId={selectedId}
        onRowsChange={handleRowsChange}
        onPersisted={handlePersisted}
        onFinish={() => setMode("landing")}
        onBackToLanding={() => setMode("landing")}
      />
    );
  }

  return (
    <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Kostprijs beheren</div>
          <div className="module-card-text">
          Start een nieuwe kostprijsberekening, en beheer welke versies actief zijn per bier/product/jaar.
          </div>
        </div>

      <KostprijsBeheerHero
        onStartNew={() => {
          setNewWizardKind("beer");
          setMode("wizard-new");
        }}
      />

      <div style={{ marginTop: 18 }} />

      <ActiveKostprijzenSection
        activeCostsRef={activeCostsRef}
        selectedYear={selectedYear}
        setSelectedYear={setSelectedYear}
        yearOptions={yearOptions}
        search={search}
        setSearch={setSearch}
        activeSort={activeSort}
        setActiveSort={setActiveSort}
        activeRows={activeRows}
        formatEuro={formatEuro}
        pendingActivation={pendingActivation}
        activationStatus={activationStatus}
        setPendingActivation={setPendingActivation}
        setActivationStatus={setActivationStatus}
      />

      <ExistingBerekeningenSection
        existingRef={existingRef}
        existingSearch={existingSearch}
        setExistingSearch={setExistingSearch}
        existingFilterMode={existingFilterMode}
        setExistingFilterMode={setExistingFilterMode}
        existingBerekeningenRows={existingBerekeningenRows}
        selectedYear={selectedYear}
        formatEuro={formatEuro}
        setSelectedId={(next) => setSelectedId(next)}
        setMode={(next) => setMode(next)}
      />
    </section>
  );
}
