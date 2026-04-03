"use client";

import { useMemo, useState } from "react";

import { usePageShellWizardSidebar } from "@/components/PageShell";
import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;
type ProductieMap = Record<string, GenericRecord>;
type VasteKostenMap = Record<string, GenericRecord[]>;
type WizardStep = {
  id: string;
  label: string;
  description: string;
  panelTitle: string;
  panelDescription: string;
};

type NieuwJaarWizardProps = {
  initialBerekeningen: GenericRecord[];
  initialKostprijsproductactiveringen: GenericRecord[];
  initialBasisproducten: GenericRecord[];
  initialSamengesteldeProducten: GenericRecord[];
  initialBieren: GenericRecord[];
  initialProductie: ProductieMap;
  initialVasteKosten: VasteKostenMap;
  initialTarieven: GenericRecord[];
  initialVerpakkingsonderdelen: GenericRecord[];
  initialVerkoopprijzen: GenericRecord[];
};

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeBerekening(raw: GenericRecord): GenericRecord {
  const row = cloneValue(raw);
  const basis =
    typeof row.basisgegevens === "object" && row.basisgegevens !== null
      ? (row.basisgegevens as GenericRecord)
      : {};

  row.id = String(row.id ?? createId());
  row.status = String(row.status ?? "concept");
  row.basisgegevens = {
    ...basis,
    jaar: Number(basis.jaar ?? 0),
    biernaam: String(basis.biernaam ?? ""),
    stijl: String(basis.stijl ?? "")
  };
  return row;
}

function sourceRecordKey(row: GenericRecord) {
  const basis = (row.basisgegevens as GenericRecord) ?? {};
  const bierId = String(row.bier_id ?? "");
  const type = String(((row.soort_berekening as GenericRecord)?.type ?? "") || "");
  if (bierId) {
    return `${bierId}|${type}`;
  }

  return [String(basis.biernaam ?? ""), String(basis.stijl ?? ""), type].join("|");
}

function duplicateBerekening(row: GenericRecord, targetYear: number) {
  const draft = cloneValue(row);
  const basis = (draft.basisgegevens as GenericRecord) ?? {};
  const now = new Date().toISOString();
  draft.id = createId();
  draft.status = "concept";
  draft.finalized_at = "";
  draft.created_at = now;
  draft.updated_at = now;
  draft.last_completed_step = 4;
  draft.basisgegevens = {
    ...basis,
    jaar: targetYear
  };
  draft.jaarovergang = {
    bron_berekening_id: String(row.id ?? ""),
    bron_jaar: Number((row.basisgegevens as GenericRecord)?.jaar ?? 0),
    doel_jaar: targetYear,
    aangemaakt_via: "nieuw_jaar_voorbereiden",
    created_at: now
  };
  return draft;
}

export function NieuwJaarWizard({
  initialBerekeningen,
  initialKostprijsproductactiveringen,
  initialBasisproducten,
  initialSamengesteldeProducten,
  initialBieren,
  initialProductie,
  initialVasteKosten,
  initialTarieven,
  initialVerpakkingsonderdelen,
  initialVerkoopprijzen
}: NieuwJaarWizardProps) {
  const berekeningen = useMemo(
    () => initialBerekeningen.map((row) => normalizeBerekening(row)),
    [initialBerekeningen]
  );

  const [currentBerekeningen, setCurrentBerekeningen] = useState<GenericRecord[]>(berekeningen);
  const [currentActivations, setCurrentActivations] = useState<GenericRecord[]>(
    Array.isArray(initialKostprijsproductactiveringen) ? initialKostprijsproductactiveringen : []
  );

  const yearOptions = useMemo(() => {
    const years = new Set<number>();

    Object.keys(initialProductie).forEach((year) => {
      if (/^\d+$/.test(year)) {
        years.add(Number(year));
      }
    });
    Object.keys(initialVasteKosten).forEach((year) => {
      if (/^\d+$/.test(year)) {
        years.add(Number(year));
      }
    });
    initialTarieven.forEach((row) => years.add(Number(row.jaar ?? 0)));
    initialVerpakkingsonderdelen.forEach((row) => years.add(Number(row.jaar ?? 0)));
    initialVerkoopprijzen.forEach((row) => years.add(Number(row.jaar ?? 0)));
    currentBerekeningen.forEach((row) =>
      years.add(Number((row.basisgegevens as GenericRecord)?.jaar ?? 0))
    );

    return Array.from(years).filter((year) => year > 0).sort((a, b) => a - b);
  }, [
    currentBerekeningen,
    initialProductie,
    initialTarieven,
    initialVasteKosten,
    initialVerkoopprijzen,
    initialVerpakkingsonderdelen
  ]);

  const defaultSource = yearOptions[yearOptions.length - 1] ?? new Date().getFullYear();
  const [sourceYear, setSourceYear] = useState(defaultSource);
  const [targetYear, setTargetYear] = useState(defaultSource + 1);
  const [copyProductie, setCopyProductie] = useState(true);
  const [copyVasteKosten, setCopyVasteKosten] = useState(true);
  const [copyTarieven, setCopyTarieven] = useState(true);
  const [copyVerpakkingsonderdelen, setCopyVerpakkingsonderdelen] = useState(true);
  const [copyVerkoopstrategie, setCopyVerkoopstrategie] = useState(true);
  const [copyBerekeningen, setCopyBerekeningen] = useState(true);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [status, setStatus] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const sourceBerekeningen = currentBerekeningen.filter(
    (row) =>
      Number((row.basisgegevens as GenericRecord)?.jaar ?? 0) === sourceYear &&
      String(row.status ?? "").toLowerCase() === "definitief"
  );
  const targetBerekeningen = currentBerekeningen.filter(
    (row) => Number((row.basisgegevens as GenericRecord)?.jaar ?? 0) === targetYear
  );
  const targetKeys = new Set(targetBerekeningen.map((row) => sourceRecordKey(row)));

  const previewRows = sourceBerekeningen.map((row) => ({
    biernaam: String(((row.basisgegevens as GenericRecord)?.biernaam ?? "") || "-"),
    stijl: String(((row.basisgegevens as GenericRecord)?.stijl ?? "") || "-"),
    soort: String((((row.soort_berekening as GenericRecord)?.type ?? "") || "-")),
    bestaatAl: targetKeys.has(sourceRecordKey(row))
  }));

  const canRun = sourceYear > 0 && targetYear > sourceYear;
  const [wizardRunId] = useState(() => createId());

  const basisproductenById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(initialBasisproducten) ? initialBasisproducten : []).forEach((row) => {
      const id = String((row as any)?.id ?? "");
      if (id) {
        map.set(id, row);
      }
    });
    return map;
  }, [initialBasisproducten]);

  const samengesteldeById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(initialSamengesteldeProducten) ? initialSamengesteldeProducten : []).forEach(
      (row) => {
        const id = String((row as any)?.id ?? "");
        if (id) {
          map.set(id, row);
        }
      }
    );
    return map;
  }, [initialSamengesteldeProducten]);

  const bierNaamById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(initialBieren) ? initialBieren : []).forEach((row) => {
      const id = String((row as any)?.id ?? "");
      const naam = String((row as any)?.naam ?? (row as any)?.biernaam ?? "");
      if (id && naam) {
        map.set(id, naam);
      }
    });
    return map;
  }, [initialBieren]);

  function versionLabel(record: GenericRecord | undefined) {
    if (!record) {
      return "-";
    }
    const versie = Number((record as any)?.versie_nummer ?? 0) || 0;
    const brontype = String((record as any)?.brontype ?? "");
    const type = String((record as any)?.type ?? "");
    const invoer = ((record as any)?.invoer ?? {}) as any;
    const factuur = (invoer?.inkoop ?? {}) as any;
    const factuurRef = factuur?.factuurnummer
      ? `${String(factuur.factuurnummer)} ${String(factuur.factuurdatum ?? "")}`.trim()
      : "";
    const bron = brontype === "factuur" && factuurRef ? `factuur ${factuurRef}` : brontype || "-";
    const parts = [`v${versie || 0}`, type || "-", bron].filter(Boolean);
    return parts.join(" · ");
  }

  function extractProductRefs(record: GenericRecord) {
    const refs = new Map<string, { product_id: string; product_type: string }>();

    const snapshot = ((record as any)?.resultaat_snapshot ?? {}) as any;
    const producten = (snapshot?.producten ?? {}) as any;
    const basis = Array.isArray(producten?.basisproducten) ? producten.basisproducten : [];
    const samengesteld = Array.isArray(producten?.samengestelde_producten)
      ? producten.samengestelde_producten
      : [];

    basis.forEach((row: any) => {
      const productId = String(row?.product_id ?? "");
      if (productId) {
        refs.set(productId, { product_id: productId, product_type: "basis" });
      }
    });
    samengesteld.forEach((row: any) => {
      const productId = String(row?.product_id ?? "");
      if (productId) {
        refs.set(productId, { product_id: productId, product_type: "samengesteld" });
      }
    });

    const invoer = ((record as any)?.invoer ?? {}) as any;
    const inkoop = (invoer?.inkoop ?? {}) as any;
    const facturen = Array.isArray(inkoop?.facturen) ? inkoop.facturen : [];
    facturen.forEach((factuur: any) => {
      const regels = Array.isArray(factuur?.factuurregels) ? factuur.factuurregels : [];
      regels.forEach((regel: any) => {
        const eenheid = String(regel?.eenheid ?? "").trim();
        if (!eenheid) {
          return;
        }
        if (basisproductenById.has(eenheid)) {
          refs.set(eenheid, { product_id: eenheid, product_type: "basis" });
          return;
        }
        if (samengesteldeById.has(eenheid)) {
          refs.set(eenheid, { product_id: eenheid, product_type: "samengesteld" });
        }
      });
    });

    return Array.from(refs.values());
  }

  const activationSuggestions = useMemo(() => {
    const versionById = new Map<string, GenericRecord>();
    currentBerekeningen.forEach((row) => {
      const id = String((row as any)?.id ?? "");
      if (id) {
        versionById.set(id, row);
      }
    });

    const activationByKey = new Map<string, GenericRecord>();
    (Array.isArray(currentActivations) ? currentActivations : []).forEach((row) => {
      const bierId = String((row as any)?.bier_id ?? "");
      const jaar = Number((row as any)?.jaar ?? 0) || 0;
      const productId = String((row as any)?.product_id ?? "");
      if (!bierId || !productId || jaar <= 0) {
        return;
      }
      activationByKey.set(`${bierId}|${jaar}|${productId}`, row);
    });

    type Candidate = {
      bierId: string;
      year: number;
      productId: string;
      productType: string;
      versionId: string;
      versieNummer: number;
      updatedAt: string;
    };

    const candidateByKey = new Map<string, Candidate>();
    const definitive = currentBerekeningen.filter(
      (row) =>
        Number((row.basisgegevens as GenericRecord)?.jaar ?? 0) === targetYear &&
        String((row as any)?.status ?? "").toLowerCase() === "definitief"
    );

    definitive.forEach((record) => {
      const bierId = String((record as any)?.bier_id ?? "");
      if (!bierId) {
        return;
      }
      const versionId = String((record as any)?.id ?? "");
      const versieNummer = Number((record as any)?.versie_nummer ?? 0) || 0;
      const updatedAt = String((record as any)?.updated_at ?? (record as any)?.finalized_at ?? "");

      extractProductRefs(record).forEach((ref) => {
        const productId = String(ref.product_id ?? "");
        if (!productId) {
          return;
        }
        const key = `${bierId}|${targetYear}|${productId}`;
        const next: Candidate = {
          bierId,
          year: targetYear,
          productId,
          productType: String(ref.product_type ?? ""),
          versionId,
          versieNummer,
          updatedAt
        };
        const current = candidateByKey.get(key);
        if (!current) {
          candidateByKey.set(key, next);
          return;
        }
        if (next.versieNummer > current.versieNummer) {
          candidateByKey.set(key, next);
          return;
        }
        if (next.versieNummer === current.versieNummer && next.updatedAt > current.updatedAt) {
          candidateByKey.set(key, next);
        }
      });
    });

    const rows = Array.from(candidateByKey.values()).map((candidate) => {
      const activationKey = `${candidate.bierId}|${candidate.year}|${candidate.productId}`;
      const currentActivation = activationByKey.get(activationKey);
      const currentVersionId = String((currentActivation as any)?.kostprijsversie_id ?? "");
      const currentVersion = currentVersionId ? versionById.get(currentVersionId) : undefined;
      const recommendedVersion = versionById.get(candidate.versionId);

      const bierNaam =
        bierNaamById.get(candidate.bierId) ||
        String(((recommendedVersion as any)?.basisgegevens as any)?.biernaam ?? "") ||
        candidate.bierId;

      const productLabel =
        String((basisproductenById.get(candidate.productId) as any)?.omschrijving ?? "") ||
        String((samengesteldeById.get(candidate.productId) as any)?.omschrijving ?? "") ||
        candidate.productId;

      return {
        bierId: candidate.bierId,
        bierNaam,
        year: candidate.year,
        productId: candidate.productId,
        productType: candidate.productType,
        productLabel,
        currentVersionId,
        currentVersionLabel: versionLabel(currentVersion),
        recommendedVersionId: candidate.versionId,
        recommendedVersionLabel: versionLabel(recommendedVersion),
        needsActivation: !currentVersionId || currentVersionId !== candidate.versionId
      };
    });

    rows.sort((a, b) => (a.bierNaam + a.productLabel).localeCompare(b.bierNaam + b.productLabel));
    return rows;
  }, [
    basisproductenById,
    bierNaamById,
    currentActivations,
    currentBerekeningen,
    samengesteldeById,
    targetYear
  ]);

  async function refreshKostprijsActiveringen() {
    try {
      const [berekeningenResponse, activationsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/data/berekeningen`, { cache: "no-store" }),
        fetch(`${API_BASE_URL}/data/dataset/kostprijsproductactiveringen`, { cache: "no-store" })
      ]);
      if (berekeningenResponse.ok) {
        const rows = (await berekeningenResponse.json()) as GenericRecord[];
        setCurrentBerekeningen(Array.isArray(rows) ? rows.map((row) => normalizeBerekening(row)) : []);
      }
      if (activationsResponse.ok) {
        const rows = (await activationsResponse.json()) as GenericRecord[];
        setCurrentActivations(Array.isArray(rows) ? rows : []);
      }
    } catch {
      // keep current state; wizard surface should show errors via status when applying changes
    }
  }

  async function applyActivationSuggestions() {
    const pending = activationSuggestions.filter((row) => row.needsActivation);
    if (pending.length === 0) {
      setStatus("Alle producten hebben al een actieve kostprijsversie voor dit jaar.");
      return;
    }

    setIsRunning(true);
    setStatus("");

    try {
      const grouped = new Map<string, string[]>();
      pending.forEach((row) => {
        const list = grouped.get(row.recommendedVersionId) ?? [];
        list.push(row.productId);
        grouped.set(row.recommendedVersionId, list);
      });

      for (const [versionId, productIds] of grouped.entries()) {
        const response = await fetch(`${API_BASE_URL}/data/kostprijsversies/${versionId}/activate-products`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_ids: productIds, run_id: wizardRunId })
        });
        if (!response.ok) {
          throw new Error("Activeren mislukt.");
        }
      }

      await refreshKostprijsActiveringen();
      setStatus(`Kostprijsactiveringen bijgewerkt voor ${targetYear}.`);
    } catch {
      setStatus("Activeren mislukt.");
    } finally {
      setIsRunning(false);
    }
  }

  async function putDataset(path: string, payload: unknown) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Opslaan mislukt voor ${path}`);
    }
  }

  async function runGeneration() {
    if (!canRun) {
      return;
    }

    setIsRunning(true);
    setStatus("");

    try {
      const nextProductie = cloneValue(initialProductie);
      const nextVasteKosten = cloneValue(initialVasteKosten);
      let nextTarieven = cloneValue(initialTarieven);
      let nextVerpakkingsonderdelen = cloneValue(initialVerpakkingsonderdelen);
      let nextVerkoopprijzen = cloneValue(initialVerkoopprijzen);
      let nextBerekeningen = cloneValue(currentBerekeningen);

      if (copyProductie && initialProductie[String(sourceYear)]) {
        if (overwriteExisting || !nextProductie[String(targetYear)]) {
          nextProductie[String(targetYear)] = cloneValue(initialProductie[String(sourceYear)]);
        }
      }

      if (copyVasteKosten && initialVasteKosten[String(sourceYear)]) {
        if (overwriteExisting || !nextVasteKosten[String(targetYear)]) {
          nextVasteKosten[String(targetYear)] = cloneValue(initialVasteKosten[String(sourceYear)]).map(
            (row) => ({
              ...row,
              id: createId()
            })
          );
        }
      }

      if (copyTarieven) {
        const source = initialTarieven.filter((row) => Number(row.jaar ?? 0) === sourceYear);
        if (overwriteExisting) {
          nextTarieven = nextTarieven.filter((row) => Number(row.jaar ?? 0) !== targetYear);
        }
        if (overwriteExisting || !nextTarieven.some((row) => Number(row.jaar ?? 0) === targetYear)) {
          nextTarieven.push(
            ...source.map((row) => ({
              ...cloneValue(row),
              id: createId(),
              jaar: targetYear
            }))
          );
        }
      }

      if (copyVerpakkingsonderdelen) {
        const source = initialVerpakkingsonderdelen.filter(
          (row) => Number(row.jaar ?? 0) === sourceYear
        );
        if (overwriteExisting) {
          nextVerpakkingsonderdelen = nextVerpakkingsonderdelen.filter(
            (row) => Number(row.jaar ?? 0) !== targetYear
          );
        }
        if (
          overwriteExisting ||
          !nextVerpakkingsonderdelen.some((row) => Number(row.jaar ?? 0) === targetYear)
        ) {
          nextVerpakkingsonderdelen.push(
            ...source.map((row) => ({
              ...cloneValue(row),
              id: createId(),
              jaar: targetYear
            }))
          );
        }
      }

      if (copyVerkoopstrategie) {
        const source = initialVerkoopprijzen.filter((row) => Number(row.jaar ?? 0) === sourceYear);
        if (overwriteExisting) {
          nextVerkoopprijzen = nextVerkoopprijzen.filter((row) => Number(row.jaar ?? 0) !== targetYear);
        }
        if (overwriteExisting || !nextVerkoopprijzen.some((row) => Number(row.jaar ?? 0) === targetYear)) {
          nextVerkoopprijzen.push(
            ...source.map((row) => ({
              ...cloneValue(row),
              id: createId(),
              jaar: targetYear,
              bron_jaar: sourceYear
            }))
          );
        }
      }

      if (copyBerekeningen) {
        const sourceRows = currentBerekeningen.filter(
          (row) =>
            Number((row.basisgegevens as GenericRecord)?.jaar ?? 0) === sourceYear &&
            String(row.status ?? "").toLowerCase() === "definitief"
        );

        if (overwriteExisting) {
          const keysToReplace = new Set(sourceRows.map((row) => sourceRecordKey(row)));
          nextBerekeningen = nextBerekeningen.filter((row) => {
            const isTargetYear = Number((row.basisgegevens as GenericRecord)?.jaar ?? 0) === targetYear;
            return !(isTargetYear && keysToReplace.has(sourceRecordKey(row)));
          });
        }

        const existingTargetKeys = new Set(
          nextBerekeningen
            .filter((row) => Number((row.basisgegevens as GenericRecord)?.jaar ?? 0) === targetYear)
            .map((row) => sourceRecordKey(row))
        );

        sourceRows.forEach((row) => {
          const key = sourceRecordKey(row);
          if (!existingTargetKeys.has(key)) {
            nextBerekeningen.push(duplicateBerekening(row, targetYear));
            existingTargetKeys.add(key);
          }
        });
      }

      await putDataset("/data/productie", nextProductie);
      await putDataset("/data/vaste-kosten", nextVasteKosten);
      await putDataset("/data/tarieven-heffingen", nextTarieven);
      await putDataset("/data/verpakkingsonderdelen", nextVerpakkingsonderdelen);
      await putDataset("/data/verkoopprijzen", nextVerkoopprijzen);
      await putDataset("/data/berekeningen", nextBerekeningen);

      setCurrentBerekeningen(nextBerekeningen);
      setStatus(`Jaar ${targetYear} voorbereid op basis van ${sourceYear}.`);
      setActiveStep(4);
    } catch {
      setStatus("Voorbereiden mislukt.");
    } finally {
      setIsRunning(false);
    }
  }

  const steps: WizardStep[] = [
    {
      id: "basis",
      label: "Basisgegevens",
      description: "Kies bronjaar, doeljaar en uitgangspunten",
      panelTitle: "Bronjaar kiezen",
      panelDescription: "Selecteer het bronjaar en geef aan naar welk doeljaar je wilt kopieren."
    },
    {
      id: "jaarset",
      label: "Jaarset",
      description: "Bepaal welke datasets meegaan naar het nieuwe jaar",
      panelTitle: "Jaarset samenstellen",
      panelDescription: "Kies welke datasets je wilt overnemen of opnieuw wilt opbouwen."
    },
    {
      id: "berekeningen",
      label: "Berekeningen",
      description: "Controleer definitieve bronrecords van het gekozen jaar",
      panelTitle: "Preview van berekeningen",
      panelDescription:
        "Bekijk welke definitieve berekeningen beschikbaar zijn en al in het doeljaar bestaan."
    },
    {
      id: "afronden",
      label: "Afronden",
      description: "Genereer de jaarset en schrijf hem direct weg",
      panelTitle: "Afronden",
      panelDescription: "Controleer de selectie en maak daarna de nieuwe jaarset aan."
    },
    {
      id: "kostprijs",
      label: "Kostprijs activeren",
      description: "Controleer en activeer kostprijzen per product voor het nieuwe jaar",
      panelTitle: "Kostprijs activeren",
      panelDescription:
        "Bekijk per bier/product welke kostprijsversie actief is en activeer aanbevolen versies voor dit jaar."
    }
  ];
  const currentStep = steps[activeStep] ?? steps[0];

  const wizardSidebar = useMemo(
    () => ({
      title: "Wizard",
      steps: steps.map((step) => ({
        id: step.id,
        label: step.label,
        description: step.description
      })),
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
          Maak een nieuwe jaarset aan op basis van een bestaand bronjaar en schrijf deze direct weg
          naar de centrale opslag.
        </div>
      </div>

      <div className="wizard-shell wizard-shell-single">
          {activeStep === 0 ? (
            <div className="wizard-step-card wizard-step-stage-card">
              <div className="wizard-step-header">
                <div>
                  <div className="wizard-step-title">Stap {activeStep + 1}: {currentStep.panelTitle}</div>
                  <div className="wizard-step-description">{currentStep.panelDescription}</div>
                </div>
              </div>

              <div className="wizard-form-grid">
                <label className="nested-field">
                  <span>Bronjaar</span>
                  <select
                    className="dataset-input"
                    value={String(sourceYear)}
                    onChange={(event) => setSourceYear(Number(event.target.value))}
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
                    onChange={(event) => setTargetYear(Number(event.target.value))}
                  />
                </label>
              </div>

              <div className="wizard-footer-actions">
                <span className="muted">Doeljaar moet hoger liggen dan het bronjaar.</span>
                <button type="button" className="editor-button" onClick={() => setActiveStep(1)}>
                  Volgende
                </button>
              </div>
            </div>
          ) : null}

          {activeStep === 1 ? (
            <div className="wizard-step-card wizard-step-stage-card">
              <div className="wizard-step-header">
                <div>
                  <div className="wizard-step-title">Stap {activeStep + 1}: {currentStep.panelTitle}</div>
                  <div className="wizard-step-description">
                    {currentStep.panelDescription} Doeljaar: {targetYear}.
                  </div>
                </div>
              </div>

              <div className="record-card-grid">
                {[
                  ["Productie", copyProductie, setCopyProductie],
                  ["Vaste kosten", copyVasteKosten, setCopyVasteKosten],
                  ["Tarieven en heffingen", copyTarieven, setCopyTarieven],
                  ["Verpakkingsonderdelen", copyVerpakkingsonderdelen, setCopyVerpakkingsonderdelen],
                  ["Verkoopstrategie", copyVerkoopstrategie, setCopyVerkoopstrategie],
                  ["Berekeningen", copyBerekeningen, setCopyBerekeningen],
                  ["Overschrijven", overwriteExisting, setOverwriteExisting]
                ].map(([label, value, setter]) => (
                  <label key={String(label)} className="wizard-toggle-card">
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) =>
                        (
                          setter as React.Dispatch<React.SetStateAction<boolean>>
                        )(event.target.checked)
                      }
                    />
                    <span>
                      <strong>{String(label)}</strong>
                      <small>{Boolean(value) ? "Ja" : "Nee"}</small>
                    </span>
                  </label>
                ))}
              </div>

              <div className="wizard-footer-actions">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setActiveStep(0)}
                >
                  Vorige
                </button>
                <button type="button" className="editor-button" onClick={() => setActiveStep(2)}>
                  Volgende
                </button>
              </div>
            </div>
          ) : null}

          {activeStep === 2 ? (
            <div className="wizard-step-card wizard-step-stage-card">
              <div className="wizard-step-header">
                <div>
                  <div className="wizard-step-title">Stap {activeStep + 1}: {currentStep.panelTitle}</div>
                  <div className="wizard-step-description">
                    {currentStep.panelDescription} Bronjaar: {sourceYear}, doeljaar: {targetYear}.
                  </div>
                </div>
              </div>

              <div className="dataset-editor-scroll">
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th>Bier</th>
                      <th>Stijl</th>
                      <th>Soort</th>
                      <th>Bestaat al</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.length > 0 ? (
                      previewRows.map((row, index) => (
                        <tr key={`${row.biernaam}-${index}`}>
                          <td>{row.biernaam}</td>
                          <td>{row.stijl}</td>
                          <td>{row.soort}</td>
                          <td>{row.bestaatAl ? "Ja" : "Nee"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="dataset-empty" colSpan={4}>
                          Geen definitieve berekeningen gevonden voor het gekozen bronjaar.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="wizard-footer-actions">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setActiveStep(1)}
                >
                  Vorige
                </button>
                <button type="button" className="editor-button" onClick={() => setActiveStep(3)}>
                  Volgende
                </button>
              </div>
            </div>
          ) : null}

          {activeStep === 3 ? (
            <div className="wizard-step-card wizard-step-stage-card">
              <div className="wizard-step-header">
                <div>
                  <div className="wizard-step-title">Stap {activeStep + 1}: {currentStep.panelTitle}</div>
                  <div className="wizard-step-description">{currentStep.panelDescription}</div>
                </div>
              </div>

              <div className="wizard-stats-grid">
                <div className="wizard-stat-card">
                  <span>Bronjaar</span>
                  <strong>{sourceYear}</strong>
                </div>
                <div className="wizard-stat-card">
                  <span>Doeljaar</span>
                  <strong>{targetYear}</strong>
                </div>
                <div className="wizard-stat-card">
                  <span>Bronberekeningen</span>
                  <strong>{sourceBerekeningen.length}</strong>
                </div>
              </div>

              <div className="editor-actions">
                <div className="editor-actions-group">
                  {status ? <span className="editor-status">{status}</span> : null}
                </div>
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => setActiveStep(2)}
                  >
                    Vorige
                  </button>
                  <button
                    type="button"
                    className="editor-button"
                    onClick={runGeneration}
                    disabled={!canRun || isRunning}
                  >
                    {isRunning ? "Voorbereiden..." : "Nieuw jaar voorbereiden"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeStep === 4 ? (
            <div className="wizard-step-card wizard-step-stage-card">
              <div className="wizard-step-header">
                <div>
                  <div className="wizard-step-title">
                    Stap {activeStep + 1}: {currentStep.panelTitle}
                  </div>
                  <div className="wizard-step-description">
                    {currentStep.panelDescription} Jaar: {targetYear}.
                  </div>
                </div>
              </div>

              <div className="dataset-editor-scroll">
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th>Bier</th>
                      <th>Product</th>
                      <th>Huidig actief</th>
                      <th>Aanbevolen</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activationSuggestions.length > 0 ? (
                      activationSuggestions.map((row) => (
                        <tr key={`${row.bierId}-${row.productId}`}>
                          <td>{row.bierNaam}</td>
                          <td>
                            {row.productLabel}
                            {row.productType ? ` (${row.productType})` : ""}
                          </td>
                          <td>{row.currentVersionLabel}</td>
                          <td>{row.recommendedVersionLabel}</td>
                          <td>{row.needsActivation ? "Niet actief" : "Actief"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="dataset-empty" colSpan={5}>
                          Geen definitieve berekeningen gevonden voor {targetYear}, of geen producten herkend in de snapshots.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="editor-actions">
                <div className="editor-actions-group">
                  {status ? <span className="editor-status">{status}</span> : null}
                </div>
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => setActiveStep(3)}
                    disabled={isRunning}
                  >
                    Vorige
                  </button>
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={refreshKostprijsActiveringen}
                    disabled={isRunning}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="editor-button"
                    onClick={applyActivationSuggestions}
                    disabled={isRunning}
                  >
                    {isRunning ? "Activeren..." : "Activeer aanbevelingen"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
      </div>
    </section>
  );
}
