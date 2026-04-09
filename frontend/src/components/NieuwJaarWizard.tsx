"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { usePageShellHeader, usePageShellWizardSidebar } from "@/components/PageShell";
import { VasteKostenClient } from "@/components/VasteKostenClient";
import { VerkoopstrategieWorkspace } from "@/components/VerkoopstrategieWorkspace";
import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;
type ProductieMap = Record<string, GenericRecord>;
type VasteKostenMap = Record<string, GenericRecord[]>;

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
  productLabel: string;
  sourcePrimaryCost: number;
  sourceCost: number;
  estimatedTargetCost: number;
  delta: number;
  sellIn: Record<string, number>;
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

function formatEur(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value);
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
    initialVerkoopprijzen
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
    (Array.isArray(initialBerekeningen) ? initialBerekeningen : []).forEach((row) =>
      years.add(Number(((row as any)?.basisgegevens ?? {})?.jaar ?? 0))
    );
    return Array.from(years).filter((year) => year > 0).sort((a, b) => a - b);
  }, [
    initialBerekeningen,
    initialPackagingComponentPrices,
    initialProductie,
    initialTarieven,
    initialVasteKosten,
    initialVerkoopprijzen
  ]);

  const defaultSource = yearOptions[yearOptions.length - 1] ?? new Date().getFullYear();
  const [sourceYear, setSourceYear] = useState(defaultSource);
  const [targetYear, setTargetYear] = useState(defaultSource + 1);

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

  const [currentBerekeningen, setCurrentBerekeningen] = useState<GenericRecord[]>(
    Array.isArray(initialBerekeningen) ? initialBerekeningen : []
  );
  const [currentActivations, setCurrentActivations] = useState<GenericRecord[]>(
    Array.isArray(initialKostprijsproductactiveringen) ? initialKostprijsproductactiveringen : []
  );

  const [scenarioPrimaryCosts, setScenarioPrimaryCosts] = useState<Record<string, number>>({});
  const [verkoopstrategieSave, setVerkoopstrategieSave] = useState<null | (() => Promise<void>)>(null);
  const [draftPackagingPrices, setDraftPackagingPrices] = useState<Record<string, number>>({});
  const [draftProductieTarget, setDraftProductieTarget] = useState<ProductieYear>({
    hoeveelheid_inkoop_l: 0,
    hoeveelheid_productie_l: 0,
    batchgrootte_eigen_productie_l: 0
  });
  const [draftVasteKostenTarget, setDraftVasteKostenTarget] = useState<GenericRecord[]>([]);
  const [draftPackagingPricesTarget, setDraftPackagingPricesTarget] = useState<PackagingPriceRow[]>([]);
  const [draftVerkoopstrategieTarget, setDraftVerkoopstrategieTarget] = useState<GenericRecord[]>([]);
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([]);
  const [draftStatus, setDraftStatus] = useState<"" | "idle" | "loading" | "saving" | "committing">("idle");
  const [commitConflict, setCommitConflict] = useState<string>("");

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
      vaste_kosten_target: copyVasteKosten ? draftVasteKostenTarget : undefined,
      packaging_prices_target: copyVerpakkingsonderdelen ? packagingRows : undefined,
      verkoopstrategie_target: copyVerkoopstrategie ? draftVerkoopstrategieTarget : undefined
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

  async function saveDraftToServer(message?: string) {
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Concept opslaan mislukt.");
    } finally {
      setDraftStatus("idle");
      setIsRunning(false);
    }
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
        setDraftVasteKostenTarget(data.vaste_kosten_target as any);
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
      if (Array.isArray(payload?.completed_step_ids)) {
        setCompletedStepIds(payload.completed_step_ids as any);
      }
      if (Number.isFinite(Number(payload?.active_step ?? 0))) {
        setActiveStep(Number(payload.active_step ?? 0));
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
      // Bewuste keuze: vaste kosten / verpakkingsprijzen nemen we niet automatisch over.
      // De bronwaarden blijven zichtbaar (read-only), maar het doeljaar start leeg/0 zodat de gebruiker bewust invult.
      setDraftVasteKostenTarget([]);
      setDraftPackagingPrices({});
      setDraftPackagingPricesTarget([]);
      setDraftVerkoopstrategieTarget([]);

      setCompletedStepIds(["basis", "init"]);
      await saveDraftToServer(`Concept gestart: bronjaar ${sourceYear} -> doeljaar ${targetYear}.`);
      setActiveStep(2);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Concept starten mislukt.");
    }
  }

  const conceptStarted = completedStepIds.includes("init");

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
      setActiveStep(9);
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

  function computeFixedCostsTotalForYear(year: number) {
    const rows =
      year === targetYear
        ? draftVasteKostenTarget
        : ((currentVasteKosten as any)?.[String(year)] as unknown);
    if (!Array.isArray(rows)) return 0;
    return rows.reduce((sum, row) => sum + Number((row as any)?.bedrag_per_jaar ?? 0), 0);
  }

  function computeFixedCostsPerLiter(year: number) {
    const productieRow = getProductieForYear(year);
    const liters =
      Number(productieRow?.hoeveelheid_inkoop_l ?? 0) + Number(productieRow?.hoeveelheid_productie_l ?? 0);
    if (!Number.isFinite(liters) || liters <= 0) return 0;
    return computeFixedCostsTotalForYear(year) / liters;
  }

  const previewRows = useMemo<PreviewRow[]>(() => {
    // Preview is intentionally "indicative": we adjust source-year cost by deltas we can derive
    // from the yearset (fixed costs per liter + packaging component prices).
    const fixedDeltaPerLiter = computeFixedCostsPerLiter(targetYear) - computeFixedCostsPerLiter(sourceYear);

    const priceByYearComponent = new Map<string, number>();
    currentPackagingPrices.forEach((row) => {
      const key = `${row.jaar}|${row.verpakkingsonderdeel_id}`;
      priceByYearComponent.set(key, Number(row.prijs_per_stuk ?? 0));
    });

    function packagingComponentPrice(year: number, componentId: string) {
      if (year === targetYear) {
        return Number(draftPackagingPrices[componentId] ?? 0);
      }
      return Number(priceByYearComponent.get(`${year}|${componentId}`) ?? 0);
    }

    const baseDefs = (Array.isArray(initialBasisproducten) ? initialBasisproducten : [])
      .filter((row) => typeof row === "object" && row !== null)
      .map((row) => row as any);
    const compositeDefs = (Array.isArray(initialSamengesteldeProducten) ? initialSamengesteldeProducten : [])
      .filter((row) => typeof row === "object" && row !== null)
      .map((row) => row as any);

    const baseByIdYear = new Map<string, any>();
    baseDefs.forEach((row) => {
      const id = String(row.id ?? "");
      const jaar = Number(row.jaar ?? 0);
      if (!id || !jaar) return;
      baseByIdYear.set(`${jaar}|${id}`, row);
    });
    const compositeByIdYear = new Map<string, any>();
    compositeDefs.forEach((row) => {
      const id = String(row.id ?? "");
      const jaar = Number(row.jaar ?? 0);
      if (!id || !jaar) return;
      compositeByIdYear.set(`${jaar}|${id}`, row);
    });

    function getBaseDef(id: string, year: number) {
      return baseByIdYear.get(`${year}|${id}`) ?? baseDefs.find((row) => String(row.id ?? "") === id) ?? null;
    }
    function getCompositeDef(id: string, year: number) {
      return (
        compositeByIdYear.get(`${year}|${id}`) ??
        compositeDefs.find((row) => String(row.id ?? "") === id) ??
        null
      );
    }

    function packagingCostForBase(productId: string, year: number) {
      const def = getBaseDef(productId, year);
      if (!def) return 0;
      const onderdelen = Array.isArray(def.onderdelen) ? def.onderdelen : [];
      return onderdelen.reduce((sum: number, onderdeel: any) => {
        const componentId = String(onderdeel.verpakkingsonderdeel_id ?? "");
        const qty = Number(onderdeel.hoeveelheid ?? 0);
        const price = packagingComponentPrice(year, componentId);
        return sum + qty * price;
      }, 0);
    }

    function litersPerUnit(productId: string, productType: string, year: number) {
      if (productType === "basis") {
        const def = getBaseDef(productId, year);
        return Number(def?.inhoud_per_eenheid_liter ?? 0);
      }
      if (productType === "samengesteld") {
        const def = getCompositeDef(productId, year);
        return Number(def?.totale_inhoud_liter ?? 0);
      }
      return 0;
    }

    function packagingCostForComposite(productId: string, year: number) {
      const def = getCompositeDef(productId, year);
      if (!def) return 0;
      const basisproducten = Array.isArray(def.basisproducten) ? def.basisproducten : [];
      return basisproducten.reduce((sum: number, row: any) => {
        const baseId = String(row.basisproduct_id ?? "");
        const count = Number(row.aantal ?? 0);
        return sum + count * packagingCostForBase(baseId, year);
      }, 0);
    }

    function packagingCost(productId: string, productType: string, year: number) {
      if (productType === "basis") return packagingCostForBase(productId, year);
      if (productType === "samengesteld") return packagingCostForComposite(productId, year);
      return 0;
    }

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

    function snapshotProductCost(record: any, productId: string) {
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

    const channels = [
      { code: "horeca", naam: "Horeca", margin: 50 },
      { code: "retail", naam: "Supermarkt", margin: 30 },
      { code: "slijterij", naam: "Slijterij", margin: 40 },
      { code: "zakelijk", naam: "Speciaalzaak", margin: 45 }
    ];

    const out: PreviewRow[] = [];

    latestActivationByKey.forEach((activation) => {
      const bierId = String(activation.bier_id ?? "");
      const productId = String(activation.product_id ?? "");
      const versionId = String(activation.kostprijsversie_id ?? "");
      const record = versionById.get(versionId);
      if (!record) return;
      const snap = snapshotProductCost(record, productId);
      if (!snap) return;

      const sourceCost = Number(snap.kostprijs ?? 0);
      const sourcePrimary = Number(snap.primaireKosten ?? 0);
      const otherCost = sourceCost - sourcePrimary;
      const scenarioKey = `${bierId}::${productId}`;
      const scenarioPrimary = Object.prototype.hasOwnProperty.call(scenarioPrimaryCosts, scenarioKey)
        ? Number(scenarioPrimaryCosts[scenarioKey] ?? sourcePrimary)
        : sourcePrimary;
      const scenarioBaseCost = Number.isFinite(scenarioPrimary) ? scenarioPrimary + otherCost : sourceCost;
      const productType = String(snap.productType ?? "");
      const basePackaging = packagingCost(productId, productType, sourceYear);
      const targetPackaging = packagingCost(productId, productType, targetYear);
      const packagingDelta = targetPackaging - basePackaging;
      const liters = litersPerUnit(productId, productType, sourceYear);
      const fixedDelta = fixedDeltaPerLiter * Number(liters ?? 0);

      const estimatedTargetCost = scenarioBaseCost + packagingDelta + fixedDelta;
      const sellIn = Object.fromEntries(
        channels.map((channel) => [channel.code, calcSellInPrice(estimatedTargetCost, channel.margin)])
      ) as Record<string, number>;

      out.push({
        bierId,
        biernaam: bierNameById.get(bierId) ?? String(((record.basisgegevens ?? {}) as any)?.biernaam ?? bierId),
        productId,
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
    currentPackagingPrices,
    currentProductie,
    currentVasteKosten,
    draftPackagingPrices,
    draftProductieTarget,
    draftVasteKostenTarget,
    initialBasisproducten,
    initialBieren,
    initialSamengesteldeProducten,
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
        id: "verkoopstrategie",
        label: "Verkoopstrategie",
        description: "Sell-in en sell-out defaults/overrides voor het doeljaar",
        panelTitle: `Verkoopstrategie ${targetYear}`,
        panelDescription: "Controleer en pas marges/prijzen aan voor het doeljaar."
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
  const wizardSidebar = useMemo(
    () => ({
      title: `Nieuw jaar ${targetYear} voorbereiden`,
      steps: steps.map((step) => {
        const enabled =
          step.id === "basis" || step.id === "init"
            ? true
            : !conceptStarted
              ? false
              : step.id === "productie"
                ? copyProductie
                : step.id === "tarieven"
                  ? copyTarieven
                  : step.id === "vaste-kosten"
                    ? copyVasteKosten
                    : step.id === "verpakking"
                      ? copyVerpakkingsonderdelen
                      : step.id === "verkoopstrategie"
                        ? copyVerkoopstrategie
                        : true;
        return { id: step.id, label: step.label, description: step.description, disabled: !enabled };
      }),
      activeIndex: activeStep,
      onStepSelect: (nextIndex: number) => {
        const nextStep = steps[nextIndex];
        if (!nextStep) return;
        if (nextStep.id === "basis" || nextStep.id === "init") {
          setActiveStep(nextIndex);
          return;
        }
        if (!conceptStarted) {
          setStatus(`Start eerst het concept voor ${targetYear} via stap 2 (Jaarset).`);
          return;
        }
        const enabled =
          nextStep.id === "productie"
            ? copyProductie
            : nextStep.id === "tarieven"
              ? copyTarieven
              : nextStep.id === "vaste-kosten"
                ? copyVasteKosten
                : nextStep.id === "verpakking"
                  ? copyVerpakkingsonderdelen
                  : nextStep.id === "verkoopstrategie"
                    ? copyVerkoopstrategie
                    : true;
        if (!enabled) {
          setStatus(`Deze stap is uitgeschakeld omdat je hem in Jaarset niet hebt aangevinkt.`);
          return;
        }
        setActiveStep(nextIndex);
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

  usePageShellWizardSidebar(wizardSidebar);
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
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Nieuw jaar {targetYear} voorbereiden</div>
        <div className="module-card-text">
          Bouw een nieuw productiejaar op basis van een bronjaar. Je kunt tussentijds opslaan als concept; pas bij
          afronden schrijven we alles in 1 keer definitief weg. Een concept kun je verwijderen; rollback van een definitieve jaarset doe je via Beheer.
        </div>
      </div>

      <div className="editor-actions" style={{ marginBottom: 18 }}>
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => router.push("/")}
            disabled={isRunning}
          >
            Terug
          </button>
        </div>
        <div className="editor-actions-group">
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

      <div className="wizard-shell wizard-shell-single">
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
                  <button type="button" className="editor-button" onClick={() => setActiveStep(1)}>
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
                    onClick={() => setActiveStep(0)}
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
                    onClick={() => setActiveStep(1)}
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
                  <button type="button" className="editor-button" onClick={() => setActiveStep(3)} disabled={isRunning}>
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
                    onClick={() => setActiveStep(2)}
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
                  <button type="button" className="editor-button" onClick={() => setActiveStep(4)} disabled={isRunning}>
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 4 ? (
            <div>
              <div className="editor-status" style={{ marginBottom: 14 }}>
                Bronjaar {sourceYear} (read-only) ter referentie. Doeljaar {targetYear} vul je bewust zelf in.
              </div>
              <div className="dataset-editor-scroll" style={{ marginBottom: 14 }}>
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th style={{ width: "360px" }}>Omschrijving</th>
                      <th style={{ width: "180px" }}>Kostensoort</th>
                      <th style={{ width: "180px" }}>Bedrag/jaar</th>
                      <th style={{ width: "160px" }}>Herverdelen %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(((currentVasteKosten as any)?.[String(sourceYear)] ?? []) as any[]).map((row: any, idx: number) => (
                      <tr key={`${String(row?.id ?? "")}-${idx}`}>
                        <td>{String(row?.omschrijving ?? "")}</td>
                        <td>{String(row?.kostensoort ?? "")}</td>
                        <td>{formatEur(Number(row?.bedrag_per_jaar ?? 0))}</td>
                        <td>{String(Number(row?.herverdeel_pct ?? 0))}</td>
                      </tr>
                    ))}
                    {Array.isArray((currentVasteKosten as any)?.[String(sourceYear)]) &&
                    (((currentVasteKosten as any)?.[String(sourceYear)] ?? []) as any[]).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="muted">
                          Geen vaste kosten gevonden voor bronjaar {sourceYear}.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <VasteKostenClient
                vasteKosten={{ ...(currentVasteKosten as any), [String(targetYear)]: draftVasteKostenTarget } as any}
                productie={currentProductie as any}
                availableYears={[sourceYear, targetYear]}
                initialSelectedYear={targetYear}
                lockYear
                titleSuffix={String(targetYear)}
                mode="draft"
                syncOnPropsChange
                onDraftChange={(payload) => {
                  const rows = (payload as any)?.[String(targetYear)];
                  if (Array.isArray(rows)) {
                    setDraftVasteKostenTarget(rows as any);
                  }
                }}
                onDraftSave={() => saveDraftToServer(`Vaste kosten (concept) voor ${targetYear} opgeslagen.`)}
              />
              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => setActiveStep(3)}
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
                    onClick={() => setActiveStep(5)}
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
                    onClick={() => setActiveStep(4)}
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
                  <button type="button" className="editor-button" onClick={() => setActiveStep(6)} disabled={isRunning}>
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
                    {previewRows.map((row) => {
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
                    {previewRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="muted">
                          Geen preview-rijen beschikbaar (controleer of er actieve kostprijzen zijn voor {sourceYear}).
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
                    onClick={() => setActiveStep(5)}
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
                    onClick={() => setActiveStep(7)}
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
              <VerkoopstrategieWorkspace
                endpoint="/data/verkoopprijzen"
                verkoopprijzen={currentVerkoopprijzen}
                basisproducten={Array.isArray(initialBasisproducten) ? initialBasisproducten : []}
                samengesteldeProducten={Array.isArray(initialSamengesteldeProducten) ? initialSamengesteldeProducten : []}
                bieren={Array.isArray(initialBieren) ? initialBieren : []}
                berekeningen={Array.isArray(currentBerekeningen) ? currentBerekeningen : []}
                channels={[]}
                kostprijsproductactiveringen={Array.isArray(currentActivations) ? currentActivations : []}
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
                    onClick={() => setActiveStep(6)}
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
                    onClick={() => setActiveStep(8)}
                    disabled={isRunning}
                  >
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 8 ? (
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
                    onClick={() => setActiveStep(7)}
                    disabled={isRunning}
                  >
                    Vorige
                  </button>
                </div>
                <div className="editor-actions-group">
                  {saveAndCloseButton}
                  <button type="button" className="editor-button" onClick={() => setActiveStep(9)} disabled={isRunning}>
                    Volgende
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 9 ? (
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
                    onClick={() => setActiveStep(8)}
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
                    onClick={() => saveDraftToServer()}
                    disabled={isRunning}
                  >
                    Concept opslaan
                  </button>
                  <button
                    type="button"
                    className="editor-button"
                    onClick={commitTargetYear}
                    disabled={isRunning}
                  >
                    Afronden
                  </button>
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => router.push("/")}
                    disabled={isRunning}
                  >
                    Naar overzicht
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          </div>
        </div>
      </div>
    </section>
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
