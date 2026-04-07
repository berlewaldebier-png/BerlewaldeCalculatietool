"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { usePageShellWizardSidebar } from "@/components/PageShell";
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

type WizardStep = {
  id: string;
  label: string;
  description: string;
  panelTitle: string;
  panelDescription: string;
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
  const [overwriteExisting, setOverwriteExisting] = useState(false);

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

  const canInitialize = useMemo(() => {
    if (sourceYear <= 0 || targetYear <= 0) return false;
    if (targetYear <= sourceYear) return false;
    return true;
  }, [sourceYear, targetYear]);

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
    setIsRunning(true);
    setStatus("");
    try {
      const response = await fetch(`${API_BASE_URL}/meta/prepare-new-year`, {
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
          overwrite_existing: overwriteExisting,
          include_datasets: true
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Voorbereiden mislukt.");
      }

      const result = (await response.json()) as any;
      const datasets = (result?.datasets ?? {}) as Record<string, unknown>;
      setCurrentProductie((datasets["productie"] as any) ?? {});
      setCurrentVasteKosten((datasets["vaste-kosten"] as any) ?? {});
      {
        const nextTariefRows = ((datasets["tarieven-heffingen"] as any[]) ?? []).map((row) =>
          normalizeTariefRow(row)
        );
        setCurrentTarieven(nextTariefRows);
        const existingTarget = nextTariefRows.find((row) => row.jaar === targetYear) ?? null;
        if (existingTarget) {
          setDraftTariefTarget(existingTarget);
        } else {
          setDraftTariefTarget((current) => ({ ...current, jaar: targetYear }));
        }
      }
      setCurrentPackagingPrices(
        (((datasets["packaging-component-prices"] as any[]) ?? []) as any[])
          .map((row) => normalizePackagingPriceRow(row))
          .filter((row) => row.verpakkingsonderdeel_id && row.jaar > 0)
      );
      setCurrentVerkoopprijzen(((datasets["verkoopprijzen"] as any[]) ?? []) as any[]);
      setCurrentBerekeningen(((datasets["berekeningen"] as any[]) ?? []) as any[]);
      setCurrentActivations(((datasets["kostprijsproductactiveringen"] as any[]) ?? []) as any[]);

      setStatus(`Jaar ${targetYear} voorbereid op basis van ${sourceYear}.`);
      setActiveStep(2);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Voorbereiden mislukt.");
    } finally {
      setIsRunning(false);
    }
  }

  async function rollbackTargetYear() {
    if (!canInitialize) return;
    const confirmText = `Weet je zeker dat je alle data van ${targetYear} wilt verwijderen? Dit raakt ${sourceYear} niet.`;
    if (!confirm(confirmText)) return;

    setIsRunning(true);
    setStatus("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/meta/rollback-year?year=${encodeURIComponent(String(targetYear))}`,
        { method: "POST" }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Rollback mislukt.");
      }
      await refreshFromServer();
      setStatus(`Rollback uitgevoerd: jaar ${targetYear} is verwijderd.`);
      setActiveStep(1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Rollback mislukt.");
    } finally {
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
    setIsRunning(true);
    setStatus("");
    try {
      const nextRow: TariefRow = {
        ...draftTariefTarget,
        id: String(draftTariefTarget.id ?? serverTargetTarief?.id ?? ""),
        jaar: targetYear,
        tarief_hoog: Number(draftTariefTarget.tarief_hoog ?? 0),
        tarief_laag: Number(draftTariefTarget.tarief_laag ?? 0),
        verbruikersbelasting: Number(draftTariefTarget.verbruikersbelasting ?? 0)
      };

      const merged = [...currentTarieven.filter((row) => row.jaar !== targetYear), nextRow].sort(
        (a, b) => a.jaar - b.jaar
      );
      const response = await fetch(`${API_BASE_URL}/data/tarieven-heffingen`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged)
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Opslaan mislukt.");
      }
      setCurrentTarieven(merged);
      setStatus(`Tarieven voor ${targetYear} opgeslagen.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Opslaan mislukt.");
    } finally {
      setIsRunning(false);
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

  const [draftPackagingPrices, setDraftPackagingPrices] = useState<Record<string, number>>({});

  function loadDraftPackagingFromServer() {
    const next: Record<string, number> = {};
    packagingRowsForTarget.forEach((row) => {
      next[row.componentId] = row.prijs_per_stuk;
    });
    setDraftPackagingPrices(next);
  }

  const hasDraftPackaging = useMemo(() => Object.keys(draftPackagingPrices).length > 0, [draftPackagingPrices]);

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
    setIsRunning(true);
    setStatus("");
    try {
      const base = currentPackagingPrices.filter((row) => row.jaar !== targetYear);
      const nextRows: PackagingPriceRow[] = packagingComponents.map((component) => ({
        id: "",
        verpakkingsonderdeel_id: component.id,
        jaar: targetYear,
        prijs_per_stuk: Number(draftPackagingPrices[component.id] ?? 0)
      }));
      const merged = [...base, ...nextRows];
      const response = await fetch(`${API_BASE_URL}/data/dataset/packaging-component-prices`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged)
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Opslaan mislukt.");
      }
      setCurrentPackagingPrices(merged);
      setStatus(`Verpakkingsprijzen voor ${targetYear} opgeslagen.`);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Opslaan mislukt.");
    } finally {
      setIsRunning(false);
    }
  }

  const steps: WizardStep[] = [
    {
      id: "basis",
      label: "Basisgegevens",
      description: "Kies bronjaar en doeljaar",
      panelTitle: "Jaarselectie",
      panelDescription: "Selecteer het bronjaar en het doeljaar dat je wilt voorbereiden."
    },
    {
      id: "init",
      label: "Jaarset",
      description: "Kopieer datasets naar het nieuwe jaar",
      panelTitle: "Jaarset initialiseren",
      panelDescription:
        "Maak een startset voor het doeljaar. Je kunt daarna per stap details aanpassen. Rollback kan altijd."
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
      panelDescription: "Beheer vaste kosten per regel; jaar is vastgezet op het doeljaar."
    },
    {
      id: "verpakking",
      label: "Verpakking",
      description: "Jaarprijzen voor verpakkingsonderdelen",
      panelTitle: `Verpakkingsonderdelen ${targetYear}`,
      panelDescription: "Werk de jaarprijzen bij. Dit stuurt basis- en samengestelde productkosten."
    },
    {
      id: "verkoopstrategie",
      label: "Verkoopstrategie",
      description: "Sell-in en sell-out defaults/overrides voor het doeljaar",
      panelTitle: `Verkoopstrategie ${targetYear}`,
      panelDescription: "Controleer en pas marges/prijzen aan voor het doeljaar."
    },
    {
      id: "afronden",
      label: "Afronden",
      description: "Controleer en ga terug naar de app",
      panelTitle: "Afronden",
      panelDescription:
        "De jaarset is opgeslagen per stap. Je kunt nu kostprijzen hercalculeren en later activeren."
    }
  ];

  const currentStep = steps[activeStep] ?? steps[0];
  const wizardSidebar = useMemo(
    () => ({
      title: "Wizard",
      steps: steps.map((step) => ({ id: step.id, label: step.label, description: step.description })),
      activeIndex: activeStep,
      onStepSelect: setActiveStep
    }),
    [activeStep, steps]
  );

  usePageShellWizardSidebar(wizardSidebar);

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Nieuw jaar voorbereiden</div>
        <div className="module-card-text">
          Bouw een nieuw productiejaar op basis van een bronjaar. Elke stap schrijft expliciet weg naar de database;
          rollback van het doeljaar is altijd mogelijk.
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
            <div className="wizard-step-header-actions">
              <button type="button" className="editor-button" onClick={rollbackTargetYear} disabled={isRunning}>
                Rollback {targetYear}
              </button>
            </div>
          </div>

          {status ? <div className="wizard-step-status">{status}</div> : null}

          {activeStep === 0 ? (
            <div className="wizard-form-grid">
              <label className="nested-field">
                <span>Bronjaar</span>
                <select
                  className="dataset-input"
                  value={String(sourceYear)}
                  onChange={(event) => setSourceYear(clampInt(event.target.value, defaultSource))}
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
                  className="dataset-input"
                  type="number"
                  value={targetYear}
                  onChange={(event) => setTargetYearWithDraft(clampInt(event.target.value, defaultSource + 1))}
                />
              </label>

              <div className="wizard-footer-actions">
                <span className="muted">Doeljaar moet hoger zijn dan het bronjaar.</span>
                <button type="button" className="editor-button" onClick={() => setActiveStep(1)}>
                  Volgende
                </button>
              </div>
            </div>
          ) : null}

          {activeStep === 1 ? (
            <div>
              <div className="record-card-grid">
                {[
                  ["Productie", copyProductie, setCopyProductie],
                  ["Vaste kosten", copyVasteKosten, setCopyVasteKosten],
                  ["Tarieven en heffingen", copyTarieven, setCopyTarieven],
                  ["Verpakkingsonderdelen (jaarprijzen)", copyVerpakkingsonderdelen, setCopyVerpakkingsonderdelen],
                  ["Verkoopstrategie", copyVerkoopstrategie, setCopyVerkoopstrategie],
                  ["Overschrijven bestaande data", overwriteExisting, setOverwriteExisting]
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

              <div className="wizard-footer-actions">
                <button type="button" className="editor-button" onClick={() => setActiveStep(0)} disabled={isRunning}>
                  Vorige
                </button>
                <button
                  type="button"
                  className="editor-button primary"
                  onClick={initializeYear}
                  disabled={isRunning || !canInitialize}
                >
                  Initialiseer {targetYear}
                </button>
              </div>
            </div>
          ) : null}

          {activeStep === 2 ? (
            <div>
              <div className="record-card-grid">
                <div className="wizard-summary-card">
                  <div className="wizard-summary-card-title">Bronjaar {sourceYear}</div>
                  <div className="wizard-summary-card-value">
                    {sourceTarief
                      ? `Hoog ${sourceTarief.tarief_hoog} · Laag ${sourceTarief.tarief_laag} · VB ${sourceTarief.verbruikersbelasting}`
                      : "Geen record"}
                  </div>
                </div>
                <div className="wizard-summary-card">
                  <div className="wizard-summary-card-title">Doeljaar {targetYear}</div>
                  <div className="wizard-summary-card-value">
                    {serverTargetTarief
                      ? `Hoog ${serverTargetTarief.tarief_hoog} · Laag ${serverTargetTarief.tarief_laag} · VB ${serverTargetTarief.verbruikersbelasting}`
                      : "Nog geen record"}
                  </div>
                </div>
              </div>

              <div className="wizard-form-grid">
                <label className="nested-field">
                  <span>Tarief hoog</span>
                  <input
                    className="dataset-input"
                    type="number"
                    value={draftTariefTarget.tarief_hoog}
                    onChange={(event) =>
                      setDraftTariefTarget((current) => ({
                        ...current,
                        tarief_hoog: Number(event.target.value)
                      }))
                    }
                  />
                </label>
                <label className="nested-field">
                  <span>Tarief laag</span>
                  <input
                    className="dataset-input"
                    type="number"
                    value={draftTariefTarget.tarief_laag}
                    onChange={(event) =>
                      setDraftTariefTarget((current) => ({
                        ...current,
                        tarief_laag: Number(event.target.value)
                      }))
                    }
                  />
                </label>
                <label className="nested-field">
                  <span>Verbruikersbelasting</span>
                  <input
                    className="dataset-input"
                    type="number"
                    value={draftTariefTarget.verbruikersbelasting}
                    onChange={(event) =>
                      setDraftTariefTarget((current) => ({
                        ...current,
                        verbruikersbelasting: Number(event.target.value)
                      }))
                    }
                  />
                </label>
              </div>

              <div className="wizard-footer-actions">
                <button type="button" className="editor-button" onClick={copyTariefFromSource} disabled={!sourceTarief}>
                  Kopieer bronjaar
                </button>
                <button type="button" className="editor-button" onClick={saveTariefTarget} disabled={isRunning}>
                  Opslaan
                </button>
                <button type="button" className="editor-button" onClick={() => setActiveStep(3)} disabled={isRunning}>
                  Volgende
                </button>
              </div>
            </div>
          ) : null}

          {activeStep === 3 ? (
            <div>
              <VasteKostenClient
                vasteKosten={currentVasteKosten as any}
                productie={currentProductie as any}
                initialSelectedYear={targetYear}
                lockYear
                titleSuffix={String(targetYear)}
              />
              <div className="wizard-footer-actions">
                <button type="button" className="editor-button" onClick={() => setActiveStep(2)} disabled={isRunning}>
                  Vorige
                </button>
                <button type="button" className="editor-button" onClick={() => setActiveStep(4)} disabled={isRunning}>
                  Volgende
                </button>
              </div>
            </div>
          ) : null}

          {activeStep === 4 ? (
            <div>
              <div className="record-card-grid">
                <div className="wizard-summary-card">
                  <div className="wizard-summary-card-title">Bronjaar {sourceYear}</div>
                  <div className="wizard-summary-card-value">
                    {formatEur(
                      currentPackagingPrices
                        .filter((row) => row.jaar === sourceYear)
                        .reduce((sum, row) => sum + Number(row.prijs_per_stuk ?? 0), 0)
                    )}
                  </div>
                </div>
                <div className="wizard-summary-card">
                  <div className="wizard-summary-card-title">Doeljaar {targetYear}</div>
                  <div className="wizard-summary-card-value">
                    {formatEur(
                      (hasDraftPackaging ? Object.values(draftPackagingPrices) : packagingRowsForTarget.map((r) => r.prijs_per_stuk)).reduce(
                        (sum, value) => sum + Number(value ?? 0),
                        0
                      )
                    )}
                  </div>
                </div>
              </div>

              {!hasDraftPackaging ? (
                <div className="wizard-footer-actions">
                  <span className="muted">Laad eerst de huidige jaarlaag om te bewerken.</span>
                  <button type="button" className="editor-button" onClick={loadDraftPackagingFromServer}>
                    Bewerk jaarlaag {targetYear}
                  </button>
                </div>
              ) : null}

              {hasDraftPackaging ? (
                <div className="dataset-editor-grid">
                  <div className="dataset-editor-grid-header">
                    <div className="dataset-editor-grid-title">Jaarprijzen verpakkingsonderdelen</div>
                    <div className="dataset-editor-grid-subtitle">
                      Jaar {targetYear} · {packagingComponents.length} onderdelen
                    </div>
                  </div>
                  <div className="dataset-editor-grid-body">
                    <div className="dataset-editor-grid-table">
                      <div className="dataset-editor-grid-row dataset-editor-grid-row-header">
                        <div className="dataset-editor-grid-cell">Onderdeel</div>
                        <div className="dataset-editor-grid-cell">Prijs per stuk</div>
                      </div>
                      {packagingRowsForTarget.map((row) => (
                        <div key={row.componentId} className="dataset-editor-grid-row">
                          <div className="dataset-editor-grid-cell">{row.omschrijving}</div>
                          <div className="dataset-editor-grid-cell">
                            <input
                              className="dataset-input"
                              type="number"
                              value={Number(draftPackagingPrices[row.componentId] ?? 0)}
                              onChange={(event) =>
                                setDraftPackagingPrices((current) => ({
                                  ...current,
                                  [row.componentId]: Number(event.target.value)
                                }))
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="wizard-footer-actions">
                    <button type="button" className="editor-button" onClick={copyPackagingPricesFromSource}>
                      Kopieer bronjaar
                    </button>
                    <button type="button" className="editor-button" onClick={savePackagingPricesTarget} disabled={isRunning}>
                      Opslaan
                    </button>
                    <button type="button" className="editor-button" onClick={() => setActiveStep(5)} disabled={isRunning}>
                      Volgende
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeStep === 5 ? (
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
              />

              <div className="wizard-footer-actions">
                <button type="button" className="editor-button" onClick={() => setActiveStep(4)} disabled={isRunning}>
                  Vorige
                </button>
                <button type="button" className="editor-button" onClick={() => setActiveStep(6)} disabled={isRunning}>
                  Volgende
                </button>
              </div>
            </div>
          ) : null}

          {activeStep === 6 ? (
            <div>
              <div className="record-card-grid">
                <div className="wizard-summary-card">
                  <div className="wizard-summary-card-title">Doeljaar {targetYear}</div>
                  <div className="wizard-summary-card-value">Stamdata opgeslagen.</div>
                </div>
                <div className="wizard-summary-card">
                  <div className="wizard-summary-card-title">Volgende stap</div>
                  <div className="wizard-summary-card-value">
                    Maak kostprijsberekeningen voor {targetYear} en activeer daarna kostprijzen per product.
                  </div>
                </div>
              </div>

              <div className="wizard-footer-actions">
                <button type="button" className="editor-button" onClick={() => router.push("/")}>
                  Naar dashboard
                </button>
                <button type="button" className="editor-button" onClick={() => router.push("/nieuwe-kostprijsberekening")}>
                  Naar kostprijs beheren
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
