"use client";

import { Fragment, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;

type InkoopFacturenManagerProps = {
  initialRows: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
};

const KOSTPRIJSVERSIES_API = `${API_BASE_URL}/data/kostprijsversies`;

type DraftMode = "new" | "edit";

type PendingAction = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
};

type DraftMode = "new" | "edit";

type PendingAction = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
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

function normalizeFactuurRegel(raw?: GenericRecord): GenericRecord {
  const row = raw ? cloneValue(raw) : {};
  return {
    id: String(row.id ?? createId()),
    aantal: Number(row.aantal ?? 0),
    eenheid: String(row.eenheid ?? ""),
    liters: Number(row.liters ?? 0),
    subfactuurbedrag: Number(row.subfactuurbedrag ?? 0)
  };
}

function normalizeFactuur(raw?: GenericRecord): GenericRecord {
  const factuur = raw ? cloneValue(raw) : {};
  const rows = Array.isArray(factuur.factuurregels)
    ? (factuur.factuurregels as GenericRecord[]).map((row) => normalizeFactuurRegel(row))
    : [];

  return {
    id: String(factuur.id ?? createId()),
    factuurnummer: String(factuur.factuurnummer ?? ""),
    factuurdatum: String(factuur.factuurdatum ?? ""),
    verzendkosten: Number(factuur.verzendkosten ?? 0),
    overige_kosten: Number(factuur.overige_kosten ?? 0),
    factuurregels: rows
  };
}

function normalizeBerekening(raw: GenericRecord): GenericRecord {
  const row = cloneValue(raw);
  const basisgegevens =
    typeof row.basisgegevens === "object" && row.basisgegevens !== null
      ? (row.basisgegevens as GenericRecord)
      : {};
  const soort =
    typeof row.soort_berekening === "object" && row.soort_berekening !== null
      ? (row.soort_berekening as GenericRecord)
      : {};
  const invoer =
    typeof row.invoer === "object" && row.invoer !== null ? (row.invoer as GenericRecord) : {};
  const inkoop =
    typeof invoer.inkoop === "object" && invoer.inkoop !== null
      ? (invoer.inkoop as GenericRecord)
      : {};

  row.id = String(row.id ?? createId());
  row.status = String(row.status ?? "concept");
  row.jaar = Number(row.jaar ?? basisgegevens.jaar ?? 0);
  row.versie_nummer = Number(row.versie_nummer ?? 0);
  row.brontype = String(row.brontype ?? "stam");
  row.bron_id = String(row.bron_id ?? "");
  row.bron_berekening_id = String(row.bron_berekening_id ?? "");
  row.is_actief = Boolean(row.is_actief ?? false);
  row.effectief_vanaf = String(row.effectief_vanaf ?? "");
  row.basisgegevens = {
    jaar: Number(basisgegevens.jaar ?? 0),
    biernaam: String(basisgegevens.biernaam ?? ""),
    stijl: String(basisgegevens.stijl ?? "")
  };
  row.soort_berekening = {
    type: String(soort.type ?? "")
  };
  row.invoer = {
    ...invoer,
    inkoop: {
      ...inkoop,
      facturen: Array.isArray(inkoop.facturen)
        ? (inkoop.facturen as GenericRecord[]).map((factuur) => normalizeFactuur(factuur))
        : [],
      factuurnummer: String(inkoop.factuurnummer ?? ""),
      factuurdatum: String(inkoop.factuurdatum ?? ""),
      verzendkosten: Number(inkoop.verzendkosten ?? 0),
      overige_kosten: Number(inkoop.overige_kosten ?? 0),
      factuurregels: Array.isArray(inkoop.factuurregels)
        ? (inkoop.factuurregels as GenericRecord[]).map((regel) => normalizeFactuurRegel(regel))
        : []
    }
  };
  return row;
}

function isInkoopRecord(row: GenericRecord) {
  return String(((row.soort_berekening as GenericRecord)?.type ?? "")).toLowerCase() === "inkoop";
}

function isMeaningfulFactuur(factuur: GenericRecord) {
  const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
  return (
    String(factuur.factuurnummer ?? "").trim() !== "" ||
    String(factuur.factuurdatum ?? "").trim() !== "" ||
    Number(factuur.verzendkosten ?? 0) > 0 ||
    Number(factuur.overige_kosten ?? 0) > 0 ||
    regels.some(
      (regel) =>
        Number(regel.aantal ?? 0) > 0 ||
        String(regel.eenheid ?? "").trim() !== "" ||
        Number(regel.liters ?? 0) > 0 ||
        Number(regel.subfactuurbedrag ?? 0) > 0
    )
  );
}

function sanitizeFacturen(facturen: GenericRecord[]) {
  return facturen.map((factuur) => normalizeFactuur(factuur)).filter((factuur) => isMeaningfulFactuur(factuur));
}

function isConceptFactuurVersie(row: GenericRecord) {
  return (
    String(row.status ?? "").toLowerCase() === "concept" &&
    String(row.brontype ?? "").toLowerCase() === "factuur"
  );
}

function getRecordYear(row: GenericRecord) {
  return Number(row.jaar ?? ((row.basisgegevens as GenericRecord | undefined)?.jaar ?? 0));
}

function setInkoopFacturen(row: GenericRecord, facturen: GenericRecord[]) {
  const invoer =
    typeof row.invoer === "object" && row.invoer !== null ? (row.invoer as GenericRecord) : {};
  const inkoop =
    typeof invoer.inkoop === "object" && invoer.inkoop !== null
      ? (invoer.inkoop as GenericRecord)
      : {};
  const normalized = facturen.map((factuur) => normalizeFactuur(factuur));
  const primary = normalized[0] ?? normalizeFactuur();
  row.invoer = {
    ...invoer,
    inkoop: {
      ...inkoop,
      facturen: normalized,
      factuurnummer: String(primary.factuurnummer ?? ""),
      factuurdatum: String(primary.factuurdatum ?? ""),
      verzendkosten: Number(primary.verzendkosten ?? 0),
      overige_kosten: Number(primary.overige_kosten ?? 0),
      factuurregels: Array.isArray(primary.factuurregels) ? primary.factuurregels : []
    }
  };
}

function getInkoopFacturen(row: GenericRecord) {
  const inkoop = (((row.invoer as GenericRecord)?.inkoop as GenericRecord) ?? {}) as GenericRecord;
  return Array.isArray(inkoop.facturen)
    ? (inkoop.facturen as GenericRecord[]).map((factuur) => normalizeFactuur(factuur))
    : [];
}

function createFactuurVersieFromSource(source: GenericRecord, factuur: GenericRecord) {
  const nowIso = new Date().toISOString();
  const draft = cloneValue(source);
  draft.id = createId();
  draft.status = "concept";
  draft.is_actief = false;
  draft.effectief_vanaf = "";
  draft.versie_nummer = Number(draft.versie_nummer ?? 0) || 0;
  draft.brontype = "factuur";
  draft.calculation_variant = "factuur";
  draft.bron_id = String(factuur.id ?? "");
  draft.bron_berekening_id = String(source.id ?? "");
  draft.created_at = nowIso;
  draft.updated_at = nowIso;
  draft.aangemaakt_op = nowIso;
  draft.aangepast_op = nowIso;
  draft.finalized_at = "";
  draft.resultaat_snapshot = {};
  setInkoopFacturen(draft, [factuur]);
  return normalizeBerekening(draft);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR"
  }).format(value || 0);
}

function getFactuurTotals(factuur: GenericRecord) {
  const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
  const liters = regels.reduce((sum, regel) => sum + Number(regel.liters ?? 0), 0);
  const bedrag =
    regels.reduce((sum, regel) => sum + Number(regel.subfactuurbedrag ?? 0), 0) +
    Number(factuur.verzendkosten ?? 0) +
    Number(factuur.overige_kosten ?? 0);
  return { liters, bedrag, regels: regels.length };
}

function isDraftValid(factuur: GenericRecord) {
  if (String(factuur.factuurnummer ?? "").trim() === "") {
    return false;
  }
  if (String(factuur.factuurdatum ?? "").trim() === "") {
    return false;
  }
  const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
  if (regels.length === 0) {
    return false;
  }
  return regels.every(
    (regel) =>
      Number(regel.aantal ?? 0) > 0 &&
      String(regel.eenheid ?? "").trim() !== "" &&
      Number(regel.liters ?? 0) > 0 &&
      Number(regel.subfactuurbedrag ?? 0) > 0
  );
}

function getProductUnitOptions(
  basisproducten: GenericRecord[],
  samengesteldeProducten: GenericRecord[]
) {
  return [
    ...basisproducten.map((row) => ({
      id: String(row.id ?? ""),
      label: String(row.omschrijving ?? ""),
      litersPerUnit: Number(row.inhoud_per_eenheid_liter ?? 0)
    })),
    ...samengesteldeProducten.map((row) => ({
      id: String(row.id ?? ""),
      label: String(row.omschrijving ?? ""),
      litersPerUnit: Number(row.totale_inhoud_liter ?? 0)
    }))
  ]
    .filter((option) => option.id && option.label)
    .sort((left, right) => left.label.localeCompare(right.label, "nl-NL"));
}

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
        const key = `${String(row.bier_id ?? "")}::${getRecordYear(row)}`;
        const current = grouped.get(key);
        const next = current ?? {
          key,
          biernaam: String(basis.biernaam ?? "Onbekend bier"),
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

  function requestDelete(title: string, body: string, onConfirm: () => void) {
    setPendingDelete({ title, body, onConfirm });
  }

  function requestAction(next: PendingAction) {
    setPendingAction(next);
  }

  function startDraftForRecord(sourceRecord: GenericRecord | null) {
    if (!sourceRecord) {
      return;
    }
    setDraftMode("new");
    setDraftVersionId("");
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

    const productie = productieResp.ok ? ((await productieResp.json()) as Record<string, GenericRecord>) : {};
    const vasteKosten = vasteKostenResp.ok
      ? ((await vasteKostenResp.json()) as Record<string, GenericRecord[]>)
      : {};
    const tarievenHeffingen = tarievenResp.ok ? ((await tarievenResp.json()) as GenericRecord[]) : [];

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

    const totals = regels.reduce(
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

    return {
      integrale_kostprijs_per_liter: Number((variabeleKostenPerLiter + vasteKostenPerLiter).toFixed(6)),
      variabele_kosten_per_liter: Number(variabeleKostenPerLiter.toFixed(6)),
      directe_vaste_kosten_per_liter: Number(vasteKostenPerLiter.toFixed(6)),
      producten: {
        basisproducten: summaryRows.filter((row) => options.some((opt) => opt.id === String(row.id ?? ""))),
        samengestelde_producten: []
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

      const nextVersion =
        draftMode === "edit" && draftVersionId
          ? (() => {
              const existing = rows.find((row) => String(row.id ?? "") === String(draftVersionId));
              const updated = existing ? cloneValue(existing) : createFactuurVersieFromSource(selectedActiveRecord, normalizedDraft);
              updated.id = String(draftVersionId);
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
        throw new Error("Opslaan mislukt");
      }

      setRows(cleanedRows);
      setDraftMode("edit");
      setDraftVersionId(String(nextVersion.id ?? ""));
      setStatus("Factuurversie opgeslagen.");
    } catch {
      setStatus("Opslaan mislukt.");
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
        throw new Error("Afronden mislukt");
      }

      setRows(cleanedRows);
      setDraftFactuur(null);
      setDraftVersionId("");
      setDraftMode("new");
      setStatus("Factuurversie afgerond als definitief.");
    } catch {
      setStatus("Afronden mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Inkoopfacturen beheren</div>
        <div className="module-card-text">
          Klik op een bier om de onderliggende facturen te bekijken. Met `+` start je een nieuwe
          concept-factuurversie.
        </div>
      </div>

      <div className="wizard-shell wizard-shell-single">
        <div className="wizard-step-card">
          <div className="wizard-panel-header">
            <div className="wizard-panel-title">Inkoopbieren</div>
            <div className="wizard-panel-text">{bierGroups.length} bieren zichtbaar</div>
          </div>

          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table">
              <thead>
                <tr>
                  <th>Biernaam</th>
                  <th>Datum actief</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bierGroups.length > 0 ? (
                  bierGroups.map((group) => {
                    const activeRecord =
                      group.records.find(
                        (row) =>
                          String(row.status ?? "").toLowerCase() === "definitief" && Boolean(row.is_actief)
                      ) ??
                      group.records.find((row) => String(row.status ?? "").toLowerCase() === "definitief") ??
                      null;
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
                                startDraftForRecord(activeRecord);
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
                                            if (String((row as any).recordStatus ?? "").toLowerCase() === "definitief") {
                                              setStatus(
                                                "Definitieve factuurversies kun je niet bewerken. Start een nieuwe versie met +."
                                              );
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
                                        </tr>
                                      ))
                                    ) : (
                                      <tr>
                                        <td className="dataset-empty" colSpan={7}>
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

            <div className="wizard-form-grid">
              {[
                { label: "Factuurnummer", key: "factuurnummer", type: "text", required: true },
                { label: "Factuurdatum", key: "factuurdatum", type: "date", required: true },
                { label: "Verzendkosten", key: "verzendkosten", type: "number", required: false },
                { label: "Overige kosten", key: "overige_kosten", type: "number", required: false }
              ].map(({ label, key, type, required }) => (
                <label key={key} className="nested-field">
                  <span>
                    {label}
                    {required ? <span style={{ color: "#c62828" }}> *</span> : null}
                  </span>
                  <input
                    className="dataset-input"
                    type={type}
                    step={type === "number" ? "any" : undefined}
                    value={String(draftFactuur[key] ?? "")}
                    readOnly={!canEditDraft}
                    onChange={(event) =>
                      updateDraftField(
                        key,
                        type === "number"
                          ? event.target.value === ""
                            ? 0
                            : Number(event.target.value)
                          : event.target.value
                      )
                    }
                  />
                </label>
              ))}
            </div>

            <div className="dataset-editor-scroll">
              <table className="dataset-editor-table">
                <thead>
                  <tr>
                    <th>Aantal *</th>
                    <th>Eenheid *</th>
                    <th>Liters *</th>
                    <th>Subfactuurbedrag *</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(draftFactuur.factuurregels) &&
                  (draftFactuur.factuurregels as GenericRecord[]).length > 0 ? (
                    (draftFactuur.factuurregels as GenericRecord[]).map((regel) => (
                      <tr key={String(regel.id)}>
                        <td>
                          <input
                            className="dataset-input"
                            type="number"
                            step="any"
                            value={String(regel.aantal ?? "")}
                            readOnly={!canEditDraft}
                            onChange={(event) =>
                              updateDraftRegel(
                                String(regel.id),
                                "aantal",
                                event.target.value === "" ? 0 : Number(event.target.value)
                              )
                            }
                          />
                        </td>
                        <td>
                          <select
                            className="dataset-input"
                            value={String(regel.eenheid ?? "")}
                            disabled={!canEditDraft}
                            onChange={(event) =>
                              updateDraftRegel(String(regel.id), "eenheid", event.target.value)
                            }
                          >
                            <option value="">Selecteer product</option>
                            {unitOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="dataset-input dataset-input-readonly"
                            type="number"
                            step="any"
                            value={String(regel.liters ?? "")}
                            readOnly
                          />
                        </td>
                        <td>
                          <input
                            className="dataset-input"
                            type="number"
                            step="any"
                            value={String(regel.subfactuurbedrag ?? "")}
                            readOnly={!canEditDraft}
                            onChange={(event) =>
                              updateDraftRegel(
                                String(regel.id),
                                "subfactuurbedrag",
                                event.target.value === "" ? 0 : Number(event.target.value)
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="icon-button-table"
                            aria-label="Factuurregel verwijderen"
                            title="Factuurregel verwijderen"
                            disabled={!canEditDraft}
                            onClick={() =>
                              requestDelete(
                                "Factuurregel verwijderen",
                                "Weet je zeker dat je deze factuurregel wilt verwijderen?",
                                () => removeDraftRegel(String(regel.id))
                              )
                            }
                          >
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="dataset-empty" colSpan={5}>
                        Nog geen factuurregels.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="editor-actions">
              <div className="editor-actions-group">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={addDraftRegel}
                  disabled={!canEditDraft}
                >
                  Regel toevoegen
                </button>
              </div>
              <div className="editor-actions-group">
                {status ? <span className="editor-status">{status}</span> : null}
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
