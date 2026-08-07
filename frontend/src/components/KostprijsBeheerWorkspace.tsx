"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
} from "@/components/kostprijsbeheer/kostprijsBeheerUtils";
import { KostprijsBeheerHero } from "@/components/kostprijsbeheer/KostprijsBeheerHero";
import { ActiveCommercialCostOverview } from "@/components/kostprijsbeheer/ActiveCommercialCostOverview";
import { ExistingBerekeningenSection } from "@/components/kostprijsbeheer/ExistingBerekeningenSection";
import {
  buildExistingBerekeningenRows,
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
  initialSelectedId?: string;
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
  initialSkuId,
  initialSelectedId
}: KostprijsBeheerWorkspaceProps) {
  const router = useRouter();
  const [currentBerekeningen, setCurrentBerekeningen] = useState<GenericRecord[]>(
    Array.isArray(berekeningen) ? berekeningen : []
  );
  const [currentBieren, setCurrentBieren] = useState<GenericRecord[]>(Array.isArray(bieren) ? bieren : []);
  const [currentSkus, setCurrentSkus] = useState<GenericRecord[]>(Array.isArray(skus) ? skus : []);
  const [currentActivations, setCurrentActivations] = useState<GenericRecord[]>(
    Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []
  );
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
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const seed = String(initialSelectedId ?? "").trim();
    return seed ? seed : null;
  });
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

  useEffect(() => {
    setCurrentSkus(Array.isArray(skus) ? skus : []);
  }, [skus]);

  useEffect(() => {
    setCurrentActivations(Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []);
  }, [kostprijsproductactiveringen]);

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

  async function refreshSkus() {
    try {
      const response = await fetch(`${API_BASE_URL}/data/skus`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as any;
      const next = Array.isArray(payload?.data) ? (payload.data as GenericRecord[]) : (payload as GenericRecord[]);
      setCurrentSkus(Array.isArray(next) ? next : []);
    } catch {
      // ignore
    }
  }

  async function refreshActivations() {
    try {
      const response = await fetch(`${API_BASE_URL}/data/kostprijsproductactiveringen`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as any;
      const next = Array.isArray(payload?.data) ? (payload.data as GenericRecord[]) : (payload as GenericRecord[]);
      setCurrentActivations(Array.isArray(next) ? next : []);
    } catch {
      // ignore
    }
  }

  function handleRowsChange(rows: GenericRecord[]) {
    setCurrentBerekeningen(Array.isArray(rows) ? rows : []);
    void refreshBieren();
    void refreshSkus();
    void refreshActivations();
  }

  function handlePersisted(result: BerekeningenWizardPersistResult) {
    if (result.year > 0) {
      setSelectedYear(result.year);
    }
    if (result.id) {
      setSelectedId(result.id);
      setMode("wizard-edit");
      router.replace(`/nieuwe-kostprijsberekening?mode=wizard-edit&selected_id=${encodeURIComponent(result.id)}`);
    }
    setExistingFilterMode(result.status === "definitief" ? "definitief" : "concept");
  }

  function handleArticlePersisted(result: ArticleKostprijsWizardPersistResult) {
    if (result.year > 0) {
      setSelectedYear(result.year);
    }
    if (result.id) {
      setSelectedId(result.id);
      setMode("wizard-edit");
      router.replace(`/nieuwe-kostprijsberekening?mode=wizard-edit&selected_id=${encodeURIComponent(result.id)}`);
    }
    setExistingFilterMode(result.status === "definitief" ? "definitief" : "concept");
  }

  function returnToLanding() {
    setMode("landing");
    setSelectedId(null);
    router.replace("/nieuwe-kostprijsberekening");
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

  if (mode === "wizard-new") {
    if (newWizardKind === "article") {
      return (
        <ArticleKostprijsWizard
          initialRows={currentBerekeningen}
          kostprijsproductactiveringen={currentActivations}
          skus={currentSkus}
          articles={articles}
          bomLines={bomLines}
          packagingComponentPrices={packagingComponentPrices}
          initialBundleSkuId={typeof initialSkuId === "string" ? initialSkuId : ""}
          startWithNew
          onRowsChange={handleRowsChange}
          onPersisted={handleArticlePersisted}
          onFinish={returnToLanding}
          onBackToLanding={returnToLanding}
        />
      );
    }

    return (
      <BerekeningenWizard
        initialRows={currentBerekeningen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        skus={currentSkus}
        bieren={currentBieren}
        articles={articles}
        bomLines={bomLines}
        productie={productie}
        vasteKosten={vasteKosten}
        tarievenHeffingen={tarievenHeffingen}
        packagingComponentPrices={packagingComponentPrices}
        kostprijsproductactiveringen={currentActivations}
        productgroepen={productgroepen}
        alcoholcategorieen={alcoholcategorieen}
        verpakkingstypen={verpakkingstypen}
        startWithNew
        onRowsChange={handleRowsChange}
        onPersisted={handlePersisted}
        onFinish={returnToLanding}
        onBackToLanding={returnToLanding}
      />
    );
  }

  if (mode === "wizard-edit" && selectedId) {
    const record = berekeningenById.get(selectedId) ?? null;
    const recordType = String((record as any)?.type ?? "").toLowerCase();
    const bronType = String((record as any)?.brontype ?? "").toLowerCase().trim();
    const basis = (record as any)?.basisgegevens ?? {};
    const skuType = String((basis as any)?.sku_type ?? "").toLowerCase();
    // Only composition-based article bundles use ArticleKostprijsWizard.
    // Some legacy/product-derived cost versions may still use `type: bundle` while being beer-linked.
    // Article bundles have no `bier_id` and carry `basisgegevens.article_id` + `basisgegevens.sku_id`.
    const bierId = String((record as any)?.bier_id ?? "").trim();
    const articleId = String((basis as any)?.article_id ?? "").trim();
    const isArticleBundle =
      recordType === "bundle" && (bronType === "bundle_article" || Boolean(articleId));
    if (isArticleBundle) {
      return (
        <ArticleKostprijsWizard
          initialRows={currentBerekeningen}
          kostprijsproductactiveringen={currentActivations}
          skus={currentSkus}
          articles={articles}
          bomLines={bomLines}
          packagingComponentPrices={packagingComponentPrices}
          initialSelectedId={selectedId}
          onRowsChange={handleRowsChange}
          onPersisted={handleArticlePersisted}
          onFinish={returnToLanding}
          onBackToLanding={returnToLanding}
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
          skus={currentSkus}
          bieren={currentBieren}
          articles={articles}
          bomLines={bomLines}
          productie={productie}
          vasteKosten={vasteKosten}
          tarievenHeffingen={tarievenHeffingen}
          packagingComponentPrices={packagingComponentPrices}
          kostprijsproductactiveringen={currentActivations}
          productgroepen={productgroepen}
          alcoholcategorieen={alcoholcategorieen}
          verpakkingstypen={verpakkingstypen}
          initialSelectedId={selectedId}
          onRowsChange={handleRowsChange}
          onPersisted={handlePersisted}
          onFinish={returnToLanding}
          onBackToLanding={returnToLanding}
        />
      );
    }

    return (
      <BerekeningenWizard
        initialRows={currentBerekeningen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        skus={currentSkus}
        bieren={currentBieren}
        articles={articles}
        bomLines={bomLines}
        productie={productie}
        vasteKosten={vasteKosten}
        tarievenHeffingen={tarievenHeffingen}
        packagingComponentPrices={packagingComponentPrices}
        kostprijsproductactiveringen={currentActivations}
        productgroepen={productgroepen}
        alcoholcategorieen={alcoholcategorieen}
        verpakkingstypen={verpakkingstypen}
        initialSelectedId={selectedId}
        onRowsChange={handleRowsChange}
        onPersisted={handlePersisted}
        onFinish={returnToLanding}
        onBackToLanding={returnToLanding}
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
          router.replace("/nieuwe-kostprijsberekening?mode=wizard-new");
        }}
      />

      <div style={{ marginTop: 18 }} />

      <ActiveCommercialCostOverview
        activeCostsRef={activeCostsRef}
        onOperationalYear={setSelectedYear}
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
        onOpenBerekening={(id) => {
          const cleanId = String(id || "").trim();
          if (!cleanId) return;
          setSelectedId(cleanId);
          setMode("wizard-edit");
          router.push(
            `/nieuwe-kostprijsberekening?mode=wizard-edit&selected_id=${encodeURIComponent(cleanId)}`
          );
        }}
      />
    </section>
  );
}
