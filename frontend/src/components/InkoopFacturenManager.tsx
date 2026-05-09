"use client";

import { Fragment, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";
import {
  cloneValue,
  normalizeFactuur,
  normalizeFactuurRegel,
} from "@/components/inkoopfacturen/inkoopFacturenUtils";
import { TrashIcon } from "@/components/inkoopfacturen/InkoopFacturenParts";
import { InkoopFactuurEditor } from "@/components/inkoopfacturen/InkoopFactuurEditor";
import {
  inferSkuType,
  normalizeBerekening,
  type GenericRecord,
} from "@/components/inkoopfacturen/inkoopFacturenManagerUtils";
import {
  calculateInkoopExtraKostenPerRegel,
  calculateInkoopPrijsPerEenheid,
  calculateInkoopPrijsPerLiter,
  createFactuurVersieFromSource,
  formatCurrency,
  formatCurrencyDisplay,
  formatDecimalValue,
  getFactuurRegelAfvulkostenFust,
  getFactuurRegelLiters,
  getFactuurTotals,
  getProductUnitOptions,
  getRecordYear,
  getInkoopFacturen,
  isConceptFactuurVersie,
  isDraftValid,
  isInkoopRecord,
  roundValue,
  sanitizeFacturen,
  setInkoopFacturen,
  type PendingAction,
} from "@/components/inkoopfacturen/inkoopFacturenManagerDerivations";

type InkoopFacturenManagerProps = {
  initialRows: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
};

const KOSTPRIJSVERSIES_API = `${API_BASE_URL}/data/kostprijsversies`;

type DraftMode = "new" | "edit";


export function InkoopFacturenManager({
  initialRows,
  basisproducten,
  samengesteldeProducten
}: InkoopFacturenManagerProps) {
  const initial = useMemo(() => initialRows.map((row) => normalizeBerekening(row)), [initialRows]);
  const [rows, setRows] = useState<GenericRecord[]>(initial);
  const [selectedBeerKey, setSelectedBeerKey] = useState("");
  const [draftFactuur, setDraftFactuur] = useState<GenericRecord | null>(null);
  const [draftMode, setDraftMode] = useState<DraftMode>("new");
  const [draftVersionId, setDraftVersionId] = useState<string>("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    title: string;
    body: string;
    onConfirm: () => void;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingNewTargetKey, setPendingNewTargetKey] = useState<string>("");
  const [showNewTargetPicker, setShowNewTargetPicker] = useState(false);
  const [draftSourceKey, setDraftSourceKey] = useState<string>("");

  const unitOptions = useMemo(
    () => getProductUnitOptions(basisproducten, samengesteldeProducten),
    [basisproducten, samengesteldeProducten]
  );
  const litersPerUnitById = useMemo(
    () => new Map(unitOptions.map((option) => [option.id, option.litersPerUnit])),
    [unitOptions]
  );

  const bierGroups = useMemo(() => {
    const grouped = new Map<
      string,
      { key: string; biernaam: string; stijl: string; jaar: number; records: GenericRecord[] }
    >();

    rows
      .filter((row) => isInkoopRecord(row))
      .forEach((row) => {
        const basis = (row.basisgegevens as GenericRecord) ?? {};
        const skuType = inferSkuType(row, basis);
        const baseKey = String(row.bier_id ?? "").trim() || String(basis.biernaam ?? "").trim();
        const key = `${skuType}::${baseKey}::${getRecordYear(row)}`;
        const current = grouped.get(key);
        const next = current ?? {
          key,
          biernaam: String(basis.biernaam ?? "Onbekend item"),
          stijl: String(basis.stijl ?? ""),
          jaar: getRecordYear(row),
          records: []
        };
        next.records.push(normalizeBerekening(row));
        grouped.set(key, next);
      });

    return [...grouped.values()]
      .map((group) => ({
        ...group,
        records: [...group.records].sort((left, right) =>
          String(right.aangepast_op ?? right.updated_at ?? "").localeCompare(
            String(left.aangepast_op ?? left.updated_at ?? "")
          )
        )
      }))
      .sort((left, right) => {
        const bierCompare = left.biernaam.localeCompare(right.biernaam, "nl-NL");
        if (bierCompare !== 0) {
          return bierCompare;
        }
        return right.jaar - left.jaar;
      });
  }, [rows]);

  const selectedGroup = bierGroups.find((group) => group.key === selectedBeerKey) ?? null;

  const selectedActiveRecord =
    selectedGroup?.records.find(
      (row) => String(row.status ?? "").toLowerCase() === "definitief" && Boolean(row.is_actief)
    ) ??
    selectedGroup?.records.find((row) => String(row.status ?? "").toLowerCase() === "definitief") ??
    null;

  const editingRecord =
    draftMode === "edit" && draftVersionId
      ? rows.find((row) => String(row.id ?? "") === String(draftVersionId))
      : null;
  const editingStatus = String((editingRecord as any)?.status ?? "").toLowerCase();
  const canEditDraft = Boolean(draftFactuur) && editingStatus !== "definitief";
  const draftContextRecord = draftMode === "edit" ? editingRecord : selectedActiveRecord ?? null;

  function requestDelete(title: string, body: string, onConfirm: () => void) {
    setPendingDelete({ title, body, onConfirm });
  }

  function requestAction(next: PendingAction) {
    setPendingAction(next);
  }

  function getActiveRecordForGroup(group: { records: GenericRecord[] }) {
    return (
      group.records.find(
        (row) => String(row.status ?? "").toLowerCase() === "definitief" && Boolean(row.is_actief)
      ) ??
      group.records.find((row) => String(row.status ?? "").toLowerCase() === "definitief") ??
      null
    );
  }

  function startDraftForRecord(sourceRecord: GenericRecord | null, sourceKey?: string) {
    if (!sourceRecord) {
      return;
    }
    setDraftMode("new");
    setDraftVersionId("");
    setDraftSourceKey(String(sourceKey ?? selectedBeerKey ?? ""));
    setDraftFactuur(
      normalizeFactuur({
        factuurregels: [normalizeFactuurRegel()]
      })
    );
    setStatus("");
  }

  function openExistingFactuurVersie(record: GenericRecord) {
    const facturen = getInkoopFacturen(record);
    const primary = facturen[0] ?? normalizeFactuur({ factuurregels: [normalizeFactuurRegel()] });
    setDraftMode("edit");
    setDraftVersionId(String(record.id ?? ""));
    setDraftFactuur(normalizeFactuur(primary));
    setStatus("");
  }

  function updateDraftField(key: string, value: unknown) {
    if (!draftFactuur) {
      return;
    }
    setDraftFactuur({
      ...draftFactuur,
      [key]: value
    });
  }

  function updateDraftRegel(rowId: string, key: string, value: unknown) {
    if (!draftFactuur) {
      return;
    }
    const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
    setDraftFactuur({
      ...draftFactuur,
      factuurregels: regels.map((regel) => {
        if (String(regel.id) !== rowId) {
          return regel;
        }
        const nextRegel = { ...regel, [key]: value };
        const aantal = Number(nextRegel.aantal ?? 0);
        const litersPerUnit = litersPerUnitById.get(String(nextRegel.eenheid ?? "").trim()) ?? 0;
        if (litersPerUnit > 0 && aantal > 0) {
          nextRegel.liters = Number((aantal * litersPerUnit).toFixed(6));
        } else if (key === "eenheid" || key === "aantal") {
          nextRegel.liters = 0;
        }
        return nextRegel;
      })
    });
  }

  function updateDraftRegelPatch(rowId: string, patch: Record<string, unknown>) {
    if (!draftFactuur) {
      return;
    }
    const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
    setDraftFactuur({
      ...draftFactuur,
      factuurregels: regels.map((regel) => {
        if (String(regel.id) !== rowId) {
          return regel;
        }
        const nextRegel = { ...regel, ...patch };
        const aantal = Number(nextRegel.aantal ?? 0);
        const litersPerUnit = litersPerUnitById.get(String(nextRegel.eenheid ?? "").trim()) ?? 0;
        if (litersPerUnit > 0 && aantal > 0) {
          nextRegel.liters = Number((aantal * litersPerUnit).toFixed(6));
        } else if ("eenheid" in patch || "aantal" in patch) {
          nextRegel.liters = 0;
        }
        return nextRegel;
      })
    });
  }

  function addDraftRegel() {
    if (!draftFactuur) {
      return;
    }
    const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
    setDraftFactuur({
      ...draftFactuur,
      factuurregels: [...regels, normalizeFactuurRegel()]
    });
  }

  function removeDraftRegel(rowId: string) {
    if (!draftFactuur) {
      return;
    }
    const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
    setDraftFactuur({
      ...draftFactuur,
      factuurregels: regels.filter((regel) => String(regel.id) !== rowId)
    });
  }

  function cancelDraft() {
    setDraftFactuur(null);
    setDraftVersionId("");
    setDraftMode("new");
    setDraftSourceKey("");
    setStatus("");
  }

  async function computeInkoopSnapshotForRecord(record: GenericRecord) {
    const year = getRecordYear(record);
    const basis = (record.basisgegevens as GenericRecord) ?? {};

    const [productieResp, vasteKostenResp, tarievenResp] = await Promise.all([
      fetch(`${API_BASE_URL}/data/productie`, { cache: "no-store" }),
      fetch(`${API_BASE_URL}/data/vaste-kosten`, { cache: "no-store" }),
      fetch(`${API_BASE_URL}/data/tarieven-heffingen`, { cache: "no-store" })
    ]);

    const productiePayload = productieResp.ok ? ((await productieResp.json()) as any) : {};
    const productie =
      productiePayload && typeof productiePayload === "object" && "data" in productiePayload
        ? (productiePayload.data as Record<string, GenericRecord>)
        : (productiePayload as Record<string, GenericRecord>);

    const vasteKostenPayload = vasteKostenResp.ok ? ((await vasteKostenResp.json()) as any) : {};
    const vasteKosten =
      vasteKostenPayload && typeof vasteKostenPayload === "object" && "data" in vasteKostenPayload
        ? (vasteKostenPayload.data as Record<string, GenericRecord[]>)
        : (vasteKostenPayload as Record<string, GenericRecord[]>);

    const tarievenPayload = tarievenResp.ok ? ((await tarievenResp.json()) as any) : [];
    const tarievenHeffingen = Array.isArray(tarievenPayload)
      ? (tarievenPayload as GenericRecord[])
      : Array.isArray(tarievenPayload?.data)
        ? (tarievenPayload.data as GenericRecord[])
        : [];

    const clampPct = (value: unknown) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return 0;
      return Math.min(100, Math.max(0, parsed));
    };

    const rowsForYear = Array.isArray(vasteKosten[String(year)]) ? vasteKosten[String(year)] : [];
    const directRows = rowsForYear.filter((row) => {
      const normalized = String(row.kostensoort ?? "").trim().toLowerCase();
      return normalized.includes("direct") && !normalized.includes("indirect");
    });
    const indirectRows = rowsForYear.filter((row) =>
      String(row.kostensoort ?? "").trim().toLowerCase().includes("indirect")
    );

    const directBase = directRows.reduce((sum, row) => sum + Number(row.bedrag_per_jaar ?? 0), 0);
    const indirectBase = indirectRows.reduce((sum, row) => sum + Number(row.bedrag_per_jaar ?? 0), 0);
    const directOut = directRows.reduce((sum, row) => {
      const amount = Number(row.bedrag_per_jaar ?? 0);
      const pct = clampPct(row.herverdeel_pct);
      return sum + (amount * pct) / 100;
    }, 0);
    const indirectOut = indirectRows.reduce((sum, row) => {
      const amount = Number(row.bedrag_per_jaar ?? 0);
      const pct = clampPct(row.herverdeel_pct);
      return sum + (amount * pct) / 100;
    }, 0);
    const indirectAfter = indirectBase - indirectOut + directOut;

    const productieGegevens = (productie[String(year)] as GenericRecord | undefined) ?? {};
    const deler = Number(productieGegevens.hoeveelheid_inkoop_l ?? 0);
    const vasteKostenPerLiter = deler > 0 ? indirectAfter / deler : 0;

    const facturen = getInkoopFacturen(record);
    const factuur = facturen[0] ?? normalizeFactuur();
    const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
    const extraPerRegel =
      regels.length > 0
        ? (Number(factuur.verzendkosten ?? 0) + Number(factuur.overige_kosten ?? 0)) / regels.length
        : 0;

    const options = getProductUnitOptions(basisproducten, samengesteldeProducten);
    const optionMap = new Map(options.map((option) => [option.id, option]));
    const basisOptionIds = new Set(
      basisproducten.map((row) => String((row as any)?.id ?? "")).filter(Boolean)
    );

    const totals = regels.reduce<{ liters: number; bedrag: number }>(
      (acc, regel) => {
        const liters = Number(regel.liters ?? 0);
        const bedrag = Number(regel.subfactuurbedrag ?? 0) + extraPerRegel;
        return { liters: acc.liters + liters, bedrag: acc.bedrag + bedrag };
      },
      { liters: 0, bedrag: 0 }
    );
    const variabeleKostenPerLiter = totals.liters > 0 ? totals.bedrag / totals.liters : 0;

    const tarieven = tarievenHeffingen.find((row) => Number(row.jaar ?? 0) === year) ?? {};
    const belastingsoort = String(basis.belastingsoort ?? "").trim().toLowerCase();
    const alcoholpercentage = Number(basis.alcoholpercentage ?? 0) / 100;
    const tariefAccijns = String(basis.tarief_accijns ?? "").trim().toLowerCase();
    const tarief =
      tariefAccijns === "laag" ? Number((tarieven as any).tarief_laag ?? 0) : Number((tarieven as any).tarief_hoog ?? 0);

    const summaryRows = regels
      .map((regel) => {
        const unitId = String(regel.eenheid ?? "").trim();
        const match = optionMap.get(unitId);
        if (!match) return null;
        const productType = basisOptionIds.has(unitId) ? "basis" : "samengesteld";
        const litersPerUnit = Number(match.litersPerUnit ?? 0);
        const aantal = Number(regel.aantal ?? 0);
        const prijsPerEenheid = aantal > 0 ? (Number(regel.subfactuurbedrag ?? 0) + extraPerRegel) / aantal : 0;
        const liters = litersPerUnit;
        const accijns =
          belastingsoort === "verbruiksbelasting"
            ? Number((tarieven as any).verbruikersbelasting ?? 0) * (liters / 100)
            : tarief * alcoholpercentage * liters;
        const vasteKosten = vasteKostenPerLiter * liters;
        return {
          id: unitId,
          product_id: unitId,
          product_type: productType,
          verpakkingseenheid: match.label,
          liters_per_product: liters,
          primaire_kosten: prijsPerEenheid,
          verpakkingskosten: 0,
          vaste_kosten: vasteKosten,
          accijns,
          kostprijs: prijsPerEenheid + vasteKosten + accijns
        } as GenericRecord;
      })
      .filter(Boolean) as GenericRecord[];

    const basisRows = summaryRows.filter((row) => String((row as any).product_type ?? "") === "basis");
    const samengesteldRows = summaryRows.filter((row) => String((row as any).product_type ?? "") === "samengesteld");

    return {
      integrale_kostprijs_per_liter: Number((variabeleKostenPerLiter + vasteKostenPerLiter).toFixed(6)),
      variabele_kosten_per_liter: Number(variabeleKostenPerLiter.toFixed(6)),
      directe_vaste_kosten_per_liter: Number(vasteKostenPerLiter.toFixed(6)),
      producten: {
        basisproducten: basisRows.filter((row) => options.some((opt) => opt.id === String(row.id ?? ""))),
        samengestelde_producten: samengesteldRows.filter((row) => options.some((opt) => opt.id === String(row.id ?? "")))
      }
    };
  }

  async function saveDraft() {
    if (!draftFactuur || !selectedActiveRecord) {
      return;
    }

    setStatus("");
    setIsSaving(true);
    try {
      const normalizedDraft = normalizeFactuur(draftFactuur);

      const groupRecords =
        selectedGroup?.records.filter((row) => String(row.brontype ?? "").toLowerCase() === "factuur") ??
        [];
      const maxVersion = groupRecords.reduce((max, row) => Math.max(max, Number(row.versie_nummer ?? 0) || 0), 0);

      async function readResponseError(response: Response): Promise<string> {
        try {
          const text = await response.text();
          if (!text) {
            return `HTTP ${response.status}`;
          }
          try {
            const parsed = JSON.parse(text) as any;
            const detail = typeof parsed?.detail === "string" ? parsed.detail : null;
            return detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}: ${text}`;
          } catch {
            return `HTTP ${response.status}: ${text}`;
          }
        } catch {
          return `HTTP ${response.status}`;
        }
      }

      const existingConceptForGroup =
        rows.find(
          (row) =>
            String(row.bier_id ?? "") === String(selectedActiveRecord.bier_id ?? "") &&
            getRecordYear(row) === getRecordYear(selectedActiveRecord) &&
            String(row.brontype ?? "").toLowerCase() === "factuur" &&
            isConceptFactuurVersie(row)
        ) ?? null;

      const nextVersion =
        (draftMode === "edit" && draftVersionId) || (existingConceptForGroup && !draftVersionId)
          ? (() => {
              const effectiveId = String(draftVersionId || existingConceptForGroup?.id || "");
              const existing =
                rows.find((row) => String(row.id ?? "") === effectiveId) ??
                (existingConceptForGroup && String(existingConceptForGroup.id ?? "") === effectiveId
                  ? existingConceptForGroup
                  : null);
              const updated = existing ? cloneValue(existing) : createFactuurVersieFromSource(selectedActiveRecord, normalizedDraft);
              updated.id = effectiveId || String(updated.id ?? "");
              updated.status = "concept";
              updated.updated_at = new Date().toISOString();
              updated.aangepast_op = updated.updated_at;
              setInkoopFacturen(updated, [normalizedDraft]);
              return normalizeBerekening(updated);
            })()
          : (() => {
              const created = createFactuurVersieFromSource(selectedActiveRecord, normalizedDraft);
              created.versie_nummer = maxVersion + 1;
              return normalizeBerekening(created);
            })();
      const cleanedRows = rows
        // Always drop the prior version when saving; we'll re-add the normalized `nextVersion`.
        .filter((row) => String(row.id ?? "") !== String(nextVersion.id ?? ""))
        .filter(
          (row) =>
            !(
              String(row.bier_id ?? "") === String(selectedActiveRecord.bier_id ?? "") &&
              getRecordYear(row) === getRecordYear(selectedActiveRecord) &&
              isConceptFactuurVersie(row) &&
              (draftMode !== "edit" || String(row.id ?? "") !== String(draftVersionId))
            )
        )
        .concat(nextVersion)
        .map((row) => normalizeBerekening(row))
        .filter((row) => !isConceptFactuurVersie(row) || sanitizeFacturen(getInkoopFacturen(row)).length > 0);

      const response = await fetch(KOSTPRIJSVERSIES_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanedRows)
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      setRows(cleanedRows);
      setDraftMode("edit");
      setDraftVersionId(String(nextVersion.id ?? ""));
      setStatus("Factuurversie opgeslagen.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setStatus(message ? `Opslaan mislukt: ${message}` : "Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  async function finalizeDraft() {
    if (!draftFactuur || !selectedActiveRecord) {
      return;
    }
    if (!isDraftValid(draftFactuur)) {
      setStatus("Vul eerst alle verplichte velden in voordat je afrondt.");
      return;
    }

    setStatus("");
    setIsSaving(true);
    try {
      const normalizedDraft = normalizeFactuur(draftFactuur);
      const nowIso = new Date().toISOString();

      async function readResponseError(response: Response): Promise<string> {
        try {
          const text = await response.text();
          if (!text) {
            return `HTTP ${response.status}`;
          }
          try {
            const parsed = JSON.parse(text) as any;
            const detail = typeof parsed?.detail === "string" ? parsed.detail : null;
            return detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}: ${text}`;
          } catch {
            return `HTTP ${response.status}: ${text}`;
          }
        } catch {
          return `HTTP ${response.status}`;
        }
      }

      const base =
        draftMode === "edit" && draftVersionId
          ? rows.find((row) => String(row.id ?? "") === String(draftVersionId))
          : null;

      const groupRecords =
        selectedGroup?.records.filter((row) => String(row.brontype ?? "").toLowerCase() === "factuur") ??
        [];
      const maxVersion = groupRecords.reduce((max, row) => Math.max(max, Number(row.versie_nummer ?? 0) || 0), 0);

      const nextVersion = base ? cloneValue(base) : createFactuurVersieFromSource(selectedActiveRecord, normalizedDraft);
      if (!base) {
        nextVersion.versie_nummer = maxVersion + 1;
      }
      nextVersion.status = "definitief";
      nextVersion.finalized_at = nowIso;
      nextVersion.updated_at = nowIso;
      nextVersion.aangepast_op = nowIso;
      nextVersion.effectief_vanaf = nowIso;
      setInkoopFacturen(nextVersion, [normalizedDraft]);
      nextVersion.resultaat_snapshot = await computeInkoopSnapshotForRecord(normalizeBerekening(nextVersion));

      const cleanedRows = rows
        .filter((row) => String(row.id ?? "") !== String(nextVersion.id ?? ""))
        .concat(normalizeBerekening(nextVersion))
        .map((row) => normalizeBerekening(row));

      const response = await fetch(KOSTPRIJSVERSIES_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanedRows)
      });
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      setRows(cleanedRows);
      setDraftFactuur(null);
      setDraftVersionId("");
      setDraftMode("new");
      setDraftSourceKey("");
      setStatus("Factuurversie afgerond als definitief.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setStatus(message ? `Afronden mislukt: ${message}` : "Afronden mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteDraftVersion(versionId: string) {
    if (!versionId) return;

    setStatus("");
    setIsSaving(true);
    try {
      const cleanedRows = rows
        .filter((row) => String(row.id ?? "") !== String(versionId))
        .map((row) => normalizeBerekening(row));

      const response = await fetch(KOSTPRIJSVERSIES_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanedRows)
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text ? `HTTP ${response.status}: ${text}` : `HTTP ${response.status}`);
      }

      setRows(cleanedRows);
      setDraftFactuur(null);
      setDraftVersionId("");
      setDraftMode("new");
      setDraftSourceKey("");
      setStatus("Conceptversie verwijderd.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setStatus(message ? `Verwijderen mislukt: ${message}` : "Verwijderen mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Inkoopfacturen beheren</div>
        <div className="module-card-text">
          Kies een artikel om de onderliggende facturen te bekijken. Voeg daarna een nieuwe concept-factuurversie toe.
        </div>
      </div>

      <div className="wizard-shell wizard-shell-single">
        <section className="module-card proposal-hub-hero" style={{ marginBottom: 14 }}>
          <div className="proposal-hub-hero-copy">
            <div className="module-card-title">Nieuwe factuur toevoegen</div>
            <div className="module-card-text">
              Kies eerst waarvoor je de factuur toevoegt (bier, artikel of dienst) en vul daarna de factuurregels in.
            </div>
          </div>
          <div className="proposal-hub-hero-actions">
            <button
              type="button"
              className="cpq-button cpq-button-primary"
              onClick={() => {
                if (!pendingNewTargetKey) {
                  setPendingNewTargetKey(selectedGroup?.key ?? bierGroups[0]?.key ?? "");
                }
                setShowNewTargetPicker(true);
              }}
              disabled={bierGroups.length === 0}
            >
              Nieuwe factuur toevoegen
            </button>
          </div>
        </section>

        <div className="wizard-step-card">
          <div className="wizard-panel-header">
            <div className="wizard-panel-title">Inkoopitems</div>
            <div className="wizard-panel-text">{bierGroups.length} items zichtbaar</div>
          </div>

          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table">
              <thead>
                <tr>
                  <th>Artikel</th>
                  <th>Datum actief</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bierGroups.length > 0 ? (
                  bierGroups.map((group) => {
                    const activeRecord = getActiveRecordForGroup(group);
                    const isSelected = group.key === (selectedGroup?.key ?? "");
                    const factuurRows = group.records.flatMap((record) =>
                      getInkoopFacturen(record).map((factuur) => ({
                        recordId: String(record.id ?? ""),
                        recordStatus: String(record.status ?? ""),
                        versie: `v${Number(record.versie_nummer ?? 0) || 1}`,
                        status: `${String(record.status ?? "")}${Boolean(record.is_actief) ? " · actief" : ""}`,
                        factuurnummer: String(factuur.factuurnummer ?? "").trim() || "-",
                        factuurdatum: String(factuur.factuurdatum ?? "").trim() || "-",
                        regels: getFactuurTotals(factuur).regels,
                        liters: getFactuurTotals(factuur).liters,
                        bedrag: getFactuurTotals(factuur).bedrag
                      }))
                    );

                    return (
                      <Fragment key={group.key}>
                        <tr
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            setSelectedBeerKey(isSelected ? "" : group.key);
                            setStatus("");
                          }}
                        >
                          <td>
                            <strong>{group.biernaam}</strong>
                            <div className="wizard-panel-text">{`${group.jaar} · ${group.stijl || "-"}`}</div>
                          </td>
                          <td>{String(activeRecord?.effectief_vanaf ?? activeRecord?.finalized_at ?? "").slice(0, 10) || "-"}</td>
                          <td>
                            <button
                              type="button"
                              className="editor-button editor-button-secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedBeerKey(group.key);
                                startDraftForRecord(activeRecord, group.key);
                              }}
                            >
                              +
                            </button>
                          </td>
                        </tr>
                        {isSelected ? (
                          <tr>
                            <td colSpan={3} style={{ background: "rgba(248, 251, 255, 0.9)" }}>
                              <div className="dataset-editor-scroll" style={{ marginTop: "0.2rem" }}>
                                <table className="dataset-editor-table wizard-table-compact">
                                  <thead>
                                    <tr>
                                      <th>Versie</th>
                                      <th>Status</th>
                                      <th>Factuurnummer</th>
                                      <th>Factuurdatum</th>
                                      <th>Regels</th>
                                      <th>Liters</th>
                                      <th>Bedrag</th>
                                      <th />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {factuurRows.length > 0 ? (
                                      factuurRows.map((row, index) => (
                                        <tr
                                          key={`${row.versie}-${row.factuurnummer}-${index}`}
                                          style={{ cursor: "pointer" }}
                                          title="Open factuurversie"
                                          onClick={() => {
                                            const record = group.records.find(
                                              (item) =>
                                                String(item.id ?? "") === String((row as any).recordId ?? "")
                                            );
                                            if (!record) {
                                              return;
                                            }
                                            openExistingFactuurVersie(record);
                                          }}
                                        >
                                          <td>{row.versie}</td>
                                          <td>{row.status}</td>
                                          <td>{row.factuurnummer}</td>
                                          <td>{row.factuurdatum}</td>
                                          <td>{row.regels}</td>
                                          <td>{Number(row.liters).toLocaleString("nl-NL")}</td>
                                          <td>{formatCurrency(Number(row.bedrag))}</td>
                                          <td style={{ whiteSpace: "nowrap" }}>
                                            {String((row as any).recordStatus ?? "").toLowerCase() === "concept" ? (
                                              <button
                                                type="button"
                                                className="icon-button-table icon-button-neutral"
                                                aria-label="Verwijder conceptversie"
                                                title="Verwijder conceptversie"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  requestDelete(
                                                    "Conceptversie verwijderen",
                                                    "Weet je zeker dat je deze concept-factuurversie wilt verwijderen?",
                                                    () => deleteDraftVersion(String((row as any).recordId ?? ""))
                                                  );
                                                }}
                                              >
                                                ×
                                              </button>
                                            ) : null}
                                          </td>
                                        </tr>
                                      ))
                                    ) : (
                                      <tr>
                                        <td className="dataset-empty" colSpan={8}>
                                          Nog geen facturen gevonden voor dit bier.
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td className="dataset-empty" colSpan={3}>
                      Nog geen actieve inkoopversies gevonden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {draftFactuur ? (
          <div className="wizard-step-card">
            <div className="wizard-step-header">
              <div>
                <div className="wizard-step-title">
                  {draftMode === "edit"
                    ? "Bestaande factuurversie bewerken of afronden"
                    : "Nieuwe factuurversie"}
                </div>
                {draftMode === "edit" && editingRecord ? (
                  <div className="wizard-panel-text">
                    {`v${Number((editingRecord as any).versie_nummer ?? 0) || 1} · ${String((editingRecord as any).status ?? "")}`}
                  </div>
                ) : null}
              </div>
            </div>

            <InkoopFactuurEditor
              subjectType={
                (String(((draftContextRecord as any)?.basisgegevens ?? {})?.sku_type ?? "bier").trim() || "bier") as any
              }
              uom={String(((draftContextRecord as any)?.basisgegevens ?? {})?.uom ?? "stuk")}
              uomValue={
                (String(((draftContextRecord as any)?.basisgegevens ?? {})?.sku_type ?? "bier").trim() || "bier") === "bier"
                  ? "stuk"
                  : String(
                      (Array.isArray(draftFactuur.factuurregels) && (draftFactuur.factuurregels as GenericRecord[])[0])
                        ? String(((draftFactuur.factuurregels as GenericRecord[])[0] as any)?.eenheid ?? "stuk")
                        : "stuk"
                    )
              }
              onChangeUomValue={(nextUom) => {
                const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
                regels.forEach((regel) => {
                  updateDraftRegel(String(regel.id), "eenheid", nextUom);
                  updateDraftRegel(String(regel.id), "liters", 0);
                  updateDraftRegel(String(regel.id), "afvulkosten_fust", null);
                });
              }}
              year={draftContextRecord ? getRecordYear(draftContextRecord) : 0}
              inkoop={draftFactuur}
              factuurregels={Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : []}
              unitOptions={unitOptions}
              basisproducten={basisproducten}
              samengesteldeProducten={samengesteldeProducten}
              canEdit={canEditDraft}
              onChangeInkoopField={(key, value) => updateDraftField(key, value)}
              onChangeRegel={(index, patch) => {
                const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
                const regel = regels[index];
                if (!regel) return;
                const id = String(regel.id);
                updateDraftRegelPatch(id, patch as Record<string, unknown>);
              }}
              onDeleteRegel={(index) => {
                const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
                const regel = regels[index];
                if (!regel) return;
                removeDraftRegel(String(regel.id));
              }}
              onAddRegel={(regel) => {
                const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
                setDraftFactuur({
                  ...draftFactuur,
                  factuurregels: [...regels, normalizeFactuurRegel(regel)],
                });
              }}
              requestDelete={(title, body, onConfirm) => requestDelete(title, body, onConfirm)}
              getFactuurRegelLiters={(regel) => getFactuurRegelLiters(regel, litersPerUnitById)}
              formatCurrencyDisplay={formatCurrencyDisplay}
              formatDecimalValue={formatDecimalValue}
              calculateInkoopExtraKostenPerRegel={calculateInkoopExtraKostenPerRegel}
              calculateInkoopPrijsPerEenheid={calculateInkoopPrijsPerEenheid}
              calculateInkoopPrijsPerLiter={(regel, extraPer) =>
                calculateInkoopPrijsPerLiter(regel, extraPer, litersPerUnitById)
              }
              getFactuurRegelAfvulkostenFust={getFactuurRegelAfvulkostenFust}
            />

            <div className="editor-actions">
              <div className="editor-actions-group" />
              <div className="editor-actions-group">
                {status ? <span className="editor-status">{status}</span> : null}
                {draftMode === "edit" && editingRecord && editingStatus === "concept" ? (
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() =>
                      requestDelete(
                        "Conceptversie verwijderen",
                        "Weet je zeker dat je deze concept-factuurversie wilt verwijderen?",
                        () => deleteDraftVersion(String(editingRecord.id ?? ""))
                      )
                    }
                    disabled={isSaving}
                  >
                    Verwijderen
                  </button>
                ) : null}
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={cancelDraft}
                  disabled={isSaving}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={saveDraft}
                  disabled={isSaving || !canEditDraft || !isDraftValid(draftFactuur)}
                >
                  {isSaving ? "Opslaan..." : "Opslaan"}
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={() =>
                    requestAction({
                      title: "Factuurversie afronden",
                      body: "Weet je zeker dat je deze factuurversie definitief wilt maken? Daarna kun je hem activeren als kostprijsbron.",
                      confirmLabel: "Afronden",
                      onConfirm: finalizeDraft
                    })
                  }
                  disabled={isSaving || !canEditDraft || !isDraftValid(draftFactuur)}
                >
                  Afronden
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showNewTargetPicker ? (
          <div className="confirm-modal-overlay" role="presentation">
            <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-new-factuur-title">
              <div className="confirm-modal-title" id="confirm-new-factuur-title">
                Nieuwe factuur toevoegen
              </div>
              <div className="confirm-modal-text">
                Kies waarvoor je de factuur toevoegt. Daarna kun je de factuurregels invullen.
              </div>
              <label className="nested-field" style={{ marginTop: 10 }}>
                <span>Artikel</span>
                <select
                  className="dataset-input"
                  value={pendingNewTargetKey}
                  onChange={(event) => setPendingNewTargetKey(event.target.value)}
                >
                  {bierGroups.map((group) => (
                    <option key={group.key} value={group.key}>
                      {`${group.biernaam} · ${group.jaar}${group.stijl ? ` · ${group.stijl}` : ""}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setShowNewTargetPicker(false)}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => {
                    const key = String(pendingNewTargetKey || "");
                    const target = bierGroups.find((g) => g.key === key) ?? null;
                    const record = target ? getActiveRecordForGroup(target) : null;
                    if (target && record) {
                      setSelectedBeerKey(key);
                      setShowNewTargetPicker(false);
                      setStatus("");
                      startDraftForRecord(record, key);
                    } else {
                      setShowNewTargetPicker(false);
                      setStatus("Kies eerst een artikel om een factuur toe te voegen.");
                    }
                  }}
                >
                  Doorgaan
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {pendingDelete ? (
          <div className="confirm-modal-overlay" role="presentation">
            <div
              className="confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-inkoopfacturen-title"
            >
              <div className="confirm-modal-title" id="confirm-inkoopfacturen-title">
                {pendingDelete.title}
              </div>
              <div className="confirm-modal-text">{pendingDelete.body}</div>
              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setPendingDelete(null)}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => {
                    pendingDelete.onConfirm();
                    setPendingDelete(null);
                  }}
                >
                  Verwijderen
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {pendingAction ? (
          <div className="confirm-modal-overlay" role="presentation">
            <div
              className="confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-inkoopfacturen-action-title"
            >
              <div className="confirm-modal-title" id="confirm-inkoopfacturen-action-title">
                {pendingAction.title}
              </div>
              <div className="confirm-modal-text">{pendingAction.body}</div>
              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setPendingAction(null)}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => {
                    pendingAction.onConfirm();
                    setPendingAction(null);
                  }}
                >
                  {pendingAction.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

