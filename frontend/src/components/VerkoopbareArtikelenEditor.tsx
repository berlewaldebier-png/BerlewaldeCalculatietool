"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;

function unwrapListPayload(value: unknown): GenericRecord[] {
  if (Array.isArray(value)) return value as GenericRecord[];
  if (value && typeof value === "object") {
    const data = (value as any).data;
    if (Array.isArray(data)) return data as GenericRecord[];
  }
  return [];
}

type CatalogProductLineKind = "beer" | "packaging_component" | "labor" | "other";

type CatalogProductLine = {
  id: string;
  line_kind: CatalogProductLineKind;
  quantity: number;
  bier_id?: string;
  product_id?: string;
  product_type?: "basis" | "samengesteld";
  packaging_component_id?: string;
  omschrijving?: string;
  unit_cost_ex?: number | null;
  beer_choice?: string;
};

type CatalogProduct = {
  id: string;
  naam: string;
  code?: string;
  kind: string;
  actief: boolean;
  bom_lines: CatalogProductLine[];
};

type ProductMaster = {
  id: string;
  omschrijving: string;
  inhoud_liter: number;
};

function createLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("nl-NL", { style: "currency", currency: "EUR" });
}

function formatLiters(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function IconButton({
  label,
  title,
  onClick
}: {
  label: string;
  title: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="icon-button-table"
      aria-label={label}
      title={title}
      onClick={onClick}
    >
      {label === "Bewerken" ? (
        <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 20h4l10-10-4-4L4 16v4Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m12 6 4 4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 7V5h6v2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l1 12h8l1-12" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 11v5M14 11v5" />
        </svg>
      )}
    </button>
  );
}

function normalizeCatalogProduct(raw: GenericRecord): CatalogProduct {
  const id = String(raw.id ?? "") || createLocalId();
  const bom = Array.isArray(raw.bom_lines) ? (raw.bom_lines as GenericRecord[]) : [];
  return {
    id,
    naam: String(raw.naam ?? raw.name ?? ""),
    code: String(raw.code ?? ""),
    kind: String(raw.kind ?? "giftpack"),
    actief: Boolean(raw.actief ?? raw.active ?? true),
    bom_lines: bom
      .filter((row) => row && typeof row === "object")
      .map((row: any) => ({
        id: String(row.id ?? "") || createLocalId(),
        line_kind: (String(row.line_kind ?? "beer") === "beer_product" ? "beer" : String(row.line_kind ?? "beer")) as CatalogProductLineKind,
        quantity: toNumber(row.quantity ?? 1, 1),
        bier_id: String(row.bier_id ?? ""),
        product_id: String(row.product_id ?? ""),
        product_type: String(row.product_type ?? "basis") as any,
        packaging_component_id: String(row.packaging_component_id ?? ""),
        omschrijving: String(row.omschrijving ?? ""),
        unit_cost_ex:
          row.unit_cost_ex === null || row.unit_cost_ex === undefined ? null : toNumber(row.unit_cost_ex, 0)
      }))
      .map((line) => {
        // Rehydrate the UI-only select value so the "Onderdeel" dropdown shows the saved choice.
        if (line.line_kind === "beer") {
          const bierId = String(line.bier_id ?? "");
          const productType = String(line.product_type ?? "basis");
          const productId = String(line.product_id ?? "");
          if (bierId && productId) {
            return { ...line, beer_choice: `${bierId}|${productType}|${productId}` };
          }
        }
        return line;
      })
  };
}

function stripUiFields(rows: CatalogProduct[]) {
  return rows.map((row) => ({
    id: row.id,
    naam: row.naam,
    code: row.code ?? "",
    kind: row.kind,
    actief: row.actief,
    bom_lines: (row.bom_lines ?? []).map((line) => {
      const { beer_choice, ...rest } = line;
      return rest;
    })
  }));
}

function findProductRowInSnapshot(version: GenericRecord, productType: string, productId: string) {
  const snapshot = (version as any).resultaat_snapshot ?? {};
  const producten = snapshot.producten ?? {};
  const list =
    productType === "samengesteld" ? (producten.samengestelde_producten as any[]) : (producten.basisproducten as any[]);
  if (!Array.isArray(list)) return null;
  return list.find((row) => String((row as any).product_id ?? (row as any).productId ?? "") === String(productId)) ?? null;
}

export function VerkoopbareArtikelenEditor(props: {
  initialRows: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  verpakkingsonderdelen: GenericRecord[];
  verpakkingsonderdeelPrijzen: GenericRecord[];
  productie: Record<string, any>;
  bieren: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
}) {
  const router = useRouter();

  const basisMasters = useMemo<ProductMaster[]>(
    () =>
      (Array.isArray(props.basisproducten) ? props.basisproducten : [])
        .filter((row) => row && typeof row === "object")
        .map((row: any) => ({
          id: String(row.id ?? ""),
          omschrijving: String(row.omschrijving ?? ""),
          inhoud_liter: toNumber(row.inhoud_per_eenheid_liter ?? 0, 0)
        }))
        .filter((row) => row.id && row.omschrijving),
    [props.basisproducten]
  );

  const samengesteldMasters = useMemo<ProductMaster[]>(
    () =>
      (Array.isArray(props.samengesteldeProducten) ? props.samengesteldeProducten : [])
        .filter((row) => row && typeof row === "object")
        .map((row: any) => ({
          id: String(row.id ?? ""),
          omschrijving: String(row.omschrijving ?? ""),
          inhoud_liter: toNumber(row.totale_inhoud_liter ?? 0, 0)
        }))
        .filter((row) => row.id && row.omschrijving),
    [props.samengesteldeProducten]
  );

  const productById = useMemo(() => {
    const map = new Map<string, ProductMaster>();
    basisMasters.forEach((p) => map.set(p.id, p));
    samengesteldMasters.forEach((p) => map.set(p.id, p));
    return map;
  }, [basisMasters, samengesteldMasters]);

  const packagingComponents = useMemo(
    () =>
      (Array.isArray(props.verpakkingsonderdelen) ? props.verpakkingsonderdelen : [])
        .filter((row) => row && typeof row === "object")
        .map((row: any) => ({ id: String(row.id ?? ""), omschrijving: String(row.omschrijving ?? "") }))
        .filter((row) => row.id && row.omschrijving),
    [props.verpakkingsonderdelen]
  );

  const packagingPrices = useMemo(
    () =>
      (Array.isArray(props.verpakkingsonderdeelPrijzen) ? props.verpakkingsonderdeelPrijzen : [])
        .filter((row) => row && typeof row === "object")
        .map((row: any) => ({
          jaar: toNumber(row.jaar ?? 0, 0),
          verpakkingsonderdeel_id: String(row.verpakkingsonderdeel_id ?? ""),
          prijs_per_stuk: toNumber(row.prijs_per_stuk ?? 0, 0)
        }))
        .filter((row) => row.jaar > 0 && row.verpakkingsonderdeel_id),
    [props.verpakkingsonderdeelPrijzen]
  );

  const productionYears = useMemo(
    () =>
      Object.keys(props.productie ?? {})
        .filter((key) => /^\\d+$/.test(key))
        .map((key) => Number(key))
        .filter((y) => y > 0)
        .sort((a, b) => a - b),
    [props.productie]
  );

  const years = useMemo(() => {
    const set = new Set<number>(productionYears);
    packagingPrices.forEach((row) => set.add(row.jaar));
    return Array.from(set).filter((y) => y > 0).sort((a, b) => a - b);
  }, [productionYears, packagingPrices]);

  const selectedYear = useMemo(() => years[years.length - 1] ?? new Date().getFullYear(), [years]);

  const packagingPriceById = useMemo(() => {
    const map = new Map<string, number>();
    packagingPrices
      .filter((row) => row.jaar === selectedYear)
      .forEach((row) => map.set(row.verpakkingsonderdeel_id, row.prijs_per_stuk));
    return map;
  }, [packagingPrices, selectedYear]);

  const beerById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(props.bieren) ? props.bieren : []).filter((row) => row && typeof row === "object").forEach((row: any) => {
      const id = String(row.id ?? "");
      if (!id) return;
      map.set(id, String(row.biernaam ?? row.naam ?? id));
    });
    return map;
  }, [props.bieren]);

  const kostprijsversieById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(props.kostprijsversies) ? props.kostprijsversies : []).filter((row) => row && typeof row === "object").forEach((row: any) => {
      const id = String(row.id ?? "");
      if (!id) return;
      map.set(id, row as any);
    });
    return map;
  }, [props.kostprijsversies]);

  const activeBeerCostsByKey = useMemo(() => {
    const best = new Map<string, { versieId: string; effectiefVanaf: string }>();
    (Array.isArray(props.kostprijsproductactiveringen) ? props.kostprijsproductactiveringen : []).filter((row) => row && typeof row === "object").forEach((row: any) => {
      const year = toNumber(row.jaar ?? 0, 0);
      if (year !== selectedYear) return;
      const bierId = String(row.bier_id ?? "");
      const productId = String(row.product_id ?? "");
      const productType = String(row.product_type ?? "").toLowerCase();
      const versieId = String(row.kostprijsversie_id ?? "");
      const effectiefVanaf = String(row.effectief_vanaf ?? row.created_at ?? "");
      if (!bierId || !productId || !productType || !versieId) return;
      const key = `${bierId}:${productType}:${productId}`;
      const existing = best.get(key);
      if (!existing || effectiefVanaf > existing.effectiefVanaf) best.set(key, { versieId, effectiefVanaf });
    });

    const out = new Map<string, { costEx: number; biernaam: string }>();
    for (const [key, picked] of best.entries()) {
      const [bierId, productType, productId] = key.split(":");
      const version = kostprijsversieById.get(picked.versieId);
      if (!version) continue;
      const row = findProductRowInSnapshot(version, productType, productId);
      const costEx = toNumber((row as any)?.kostprijs ?? 0, 0);
      out.set(key, { costEx, biernaam: beerById.get(bierId) ?? bierId });
    }
    return out;
  }, [beerById, kostprijsversieById, props.kostprijsproductactiveringen, selectedYear]);

  const activeSkuIds = useMemo(() => {
    const out = new Set<string>();
    (Array.isArray(props.kostprijsproductactiveringen) ? props.kostprijsproductactiveringen : [])
      .filter((row) => row && typeof row === "object")
      .forEach((row: any) => {
        const year = toNumber(row.jaar ?? 0, 0);
        if (year !== selectedYear) return;
        const tot = String(row.effectief_tot ?? "");
        if (tot) return;
        const skuId = String(row.sku_id ?? "");
        if (skuId) out.add(skuId);
      });
    return out;
  }, [props.kostprijsproductactiveringen, selectedYear]);

  const beerProductOptions = useMemo(() => {
    const out: { value: string; label: string; payload: Partial<CatalogProductLine> }[] = [];
    for (const [key, val] of activeBeerCostsByKey.entries()) {
      const [bierId, productType, productId] = key.split(":");
      const productLabel = productById.get(productId)?.omschrijving ?? productId;
      out.push({
        value: `${bierId}|${productType}|${productId}`,
        label: `${val.biernaam} - ${productLabel}`,
        payload: { bier_id: bierId, product_type: productType as any, product_id: productId }
      });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [activeBeerCostsByKey, productById]);

  const packagingComponentOptions = useMemo(
    () => packagingComponents.map((row) => ({ value: row.id, label: row.omschrijving })),
    [packagingComponents]
  );

  const [rows, setRows] = useState<CatalogProduct[]>(() => {
    const src = unwrapListPayload(props.initialRows);
    return src
      .filter((row) => row && typeof row === "object")
      .map((row) => normalizeCatalogProduct(row as any));
  });

  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activationPrompt, setActivationPrompt] = useState<null | { articleId: string; skuId: string; naam: string }>(
    null
  );

  function addCatalogProduct() {
    const id = createLocalId();
    setRows((current) => [...current, { id, naam: "", code: "", kind: "giftpack", actief: true, bom_lines: [] }]);
    setExpandedId(id);
  }

  function deleteCatalogProduct(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
    setExpandedId((current) => (current === id ? null : current));
  }

  function addLine(parentId: string) {
    setRows((current) =>
      current.map((row) =>
        row.id !== parentId
          ? row
          : {
              ...row,
              bom_lines: [
                ...(row.bom_lines ?? []),
                {
                  id: createLocalId(),
                  line_kind: "beer",
                  quantity: 1,
                  bier_id: "",
                  product_id: "",
                  product_type: "basis",
                  packaging_component_id: "",
                  omschrijving: "",
                  unit_cost_ex: null,
                  beer_choice: ""
                }
              ]
            }
      )
    );
  }

  function deleteLine(parentId: string, lineId: string) {
    setRows((current) =>
      current.map((row) => (row.id !== parentId ? row : { ...row, bom_lines: (row.bom_lines ?? []).filter((l) => l.id !== lineId) }))
    );
  }

  function updateLine(parentId: string, lineId: string, patch: Partial<CatalogProductLine>) {
    setRows((current) =>
      current.map((row) =>
        row.id !== parentId
          ? row
          : { ...row, bom_lines: (row.bom_lines ?? []).map((l) => (l.id === lineId ? { ...l, ...patch } : l)) }
      )
    );
  }

  function resolveLineOmschrijving(line: CatalogProductLine) {
    if (line.line_kind === "beer") {
      const product = line.product_id ? productById.get(String(line.product_id)) : null;
      const bier = line.bier_id ? beerById.get(String(line.bier_id)) : null;
      if (bier && product) return `${bier} - ${product.omschrijving}`;
      return "";
    }
    if (line.line_kind === "packaging_component") {
      const pc = line.packaging_component_id
        ? packagingComponents.find((row) => row.id === String(line.packaging_component_id))
        : null;
      return pc?.omschrijving ?? "";
    }
    return String(line.omschrijving ?? "");
  }

  function resolveUnitCost(line: CatalogProductLine) {
    if (line.line_kind === "beer") {
      const bierId = String(line.bier_id ?? "");
      const productType = String(line.product_type ?? "basis");
      const productId = String(line.product_id ?? "");
      return activeBeerCostsByKey.get(`${bierId}:${productType}:${productId}`)?.costEx ?? 0;
    }
    if (line.line_kind === "packaging_component") {
      const id = String(line.packaging_component_id ?? "");
      return packagingPriceById.get(id) ?? 0;
    }
    if (line.line_kind === "labor" || line.line_kind === "other") {
      return toNumber(line.unit_cost_ex ?? 0, 0);
    }
    return 0;
  }

  function computeHeaderTotals(row: CatalogProduct) {
    const lines = Array.isArray(row.bom_lines) ? row.bom_lines : [];
    let liters = 0;
    let cost = 0;
    for (const line of lines) {
      const qty = toNumber(line.quantity ?? 0, 0);
      if (qty <= 0) continue;
      if (line.line_kind === "beer") {
        const product = line.product_id ? productById.get(String(line.product_id)) : null;
        liters += qty * (product?.inhoud_liter ?? 0);
      }
      cost += qty * resolveUnitCost(line);
    }
    return { liters, cost, lineCount: lines.length };
  }

  async function handleSave() {
    setStatus("");
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/data/catalog-products`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stripUiFields(rows))
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Opslaan mislukt");
      }
      // Re-fetch canonical rows from the server so the UI always shows what is persisted.
      const fresh = await fetch(`${API_BASE_URL}/data/catalog-products`, { method: "GET" });
      if (fresh.ok) {
        const nextPayload = await fresh.json();
        const normalized = unwrapListPayload(nextPayload)
          .filter((row) => row && typeof row === "object")
          .map((row) => normalizeCatalogProduct(row as any));
        setRows(normalized);

        const candidateId = expandedId ? String(expandedId) : normalized[normalized.length - 1]?.id ?? "";
        const candidate = candidateId ? normalized.find((row) => row.id === candidateId) ?? null : null;
        if (candidate) {
          const skuId = `sku-${candidate.id}`;
          if (!activeSkuIds.has(skuId)) {
            setActivationPrompt({
              articleId: candidate.id,
              skuId,
              naam: String(candidate.naam ?? "") || candidate.id
            });
          }
        }
      }
      setStatus("Opgeslagen.");
    } catch {
      setStatus("Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="module-card">
      {activationPrompt ? (
        <div className="cpq-modal-backdrop" role="dialog" aria-modal="true">
          <div className="cpq-modal">
            <div className="cpq-modal-header">
              <div>
                <h3 className="cpq-modal-title">Kostprijs activeren?</h3>
                <div className="cpq-modal-subtitle">
                  <strong>{activationPrompt.naam}</strong> is opgeslagen, maar heeft nog geen actieve kostprijs in {selectedYear}. Wil je nu de kostprijsberekening starten?
                </div>
              </div>
              <button
                type="button"
                className="cpq-icon-action"
                onClick={() => setActivationPrompt(null)}
                aria-label="Sluiten"
                title="Sluiten"
              >
                ×
              </button>
            </div>
            <div className="cpq-modal-body">
              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button type="button" className="cpq-button cpq-button-secondary" onClick={() => setActivationPrompt(null)}>
                  Later
                </button>
                <button
                  type="button"
                  className="cpq-button cpq-button-primary"
                  onClick={() => {
                    const url = `/nieuwe-kostprijsberekening?mode=wizard-new&kind=article&sku_id=${encodeURIComponent(
                      activationPrompt.skuId
                    )}&focus=activations`;
                    window.location.href = url;
                  }}
                >
                  Naar kostprijsbeheer
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <div className="module-card-header">
        <div className="module-card-title">Verkoopbare artikelen</div>
        <div className="module-card-text">
          Regels: onderdeel, omschrijving, aantal en kostprijs. Bier/onderdeel-kostprijzen zijn readonly en komen uit actieve kostprijzen ({selectedYear}).
        </div>
      </div>

      <div className="editor-toolbar">
        <div className="editor-toolbar-meta">
          <span className="editor-pill">{rows.length} artikelen</span>
        </div>
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th>Naam</th>
              <th style={{ width: "140px" }}>Inhoud (L)</th>
              <th style={{ width: "160px" }}>Kostprijs (ex)</th>
              <th style={{ width: "110px" }}>Regels</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="dataset-empty" colSpan={5}>
                  Nog geen artikelen.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const isExpanded = expandedId === row.id;
              const totals = computeHeaderTotals(row);
              return (
                <Fragment key={row.id}>
                  <tr>
                    <td style={{ fontWeight: 600 }}>
                      <input
                        className="dataset-input"
                        placeholder="Naam invullen..."
                        value={row.naam}
                        onChange={(e) =>
                          setRows((current) =>
                            current.map((item) =>
                              item.id === row.id ? { ...item, naam: e.target.value } : item
                            )
                          )
                        }
                      />
                    </td>
                    <td>{formatLiters(totals.liters)}</td>
                    <td>{money(totals.cost)}</td>
                    <td>{totals.lineCount}</td>
                    <td style={{ textAlign: "right" }}>
                      <IconButton
                        label="Bewerken"
                        title="Bewerken"
                        onClick={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
                      />
                      <IconButton
                        label="Artikel verwijderen"
                        title="Artikel verwijderen"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCatalogProduct(row.id);
                        }}
                      />
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "1rem" }}>
                        <div className="nested-editor-grid" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
                          <label className="nested-field">
                            <span>Naam</span>
                            <input className="dataset-input" value={row.naam} readOnly />
                          </label>
                          <label className="nested-field">
                            <span>Inhoud (liter)</span>
                            <input className="dataset-input dataset-input-readonly" value={formatLiters(totals.liters)} readOnly />
                          </label>
                          <label className="nested-field">
                            <span>Kostprijs (ex)</span>
                            <input className="dataset-input dataset-input-readonly" value={money(totals.cost)} readOnly />
                          </label>
                          <label className="nested-field">
                            <span>Aantal regels</span>
                            <input className="dataset-input dataset-input-readonly" value={String(totals.lineCount)} readOnly />
                          </label>
                        </div>

                        <div className="nested-subsection" style={{ marginTop: "1rem" }}>
                          <div className="nested-subsection-header">
                            <div className="nested-subsection-title">Regels</div>
                          </div>

                          <div className="dataset-editor-scroll" style={{ borderRadius: "12px" }}>
                            <table className="dataset-editor-table">
                              <thead>
                                <tr>
                                  <th style={{ width: "180px" }}>Type</th>
                                  <th>Onderdeel</th>
                                  <th>Omschrijving</th>
                                  <th style={{ width: "110px" }}>Aantal</th>
                                  <th style={{ width: "140px" }}>Kostprijs (ex)</th>
                                  <th style={{ width: "60px" }} />
                                </tr>
                              </thead>
                              <tbody>
                                {(row.bom_lines ?? []).length === 0 ? (
                                  <tr>
                                    <td className="dataset-empty" colSpan={6}>
                                      Nog geen regels.
                                    </td>
                                  </tr>
                                ) : null}
                                {(row.bom_lines ?? []).map((line) => {
                                  const resolvedOmschrijving = resolveLineOmschrijving(line);
                                  const unitCost = resolveUnitCost(line);
                                  const kind = line.line_kind;

                                  return (
                                    <tr key={line.id}>
                                      <td>
                                        <select
                                          className="dataset-input"
                                          value={kind}
                                          onChange={(e) => {
                                            const next = String(e.target.value) as CatalogProductLineKind;
                                            updateLine(row.id, line.id, {
                                              line_kind: next,
                                              bier_id: "",
                                              product_id: "",
                                              product_type: "basis",
                                              packaging_component_id: "",
                                              omschrijving: "",
                                              unit_cost_ex: null,
                                              beer_choice: ""
                                            });
                                          }}
                                        >
                                          <option value="beer">Bier</option>
                                          <option value="packaging_component">Verpakkingsonderdeel</option>
                                          <option value="labor">Loon</option>
                                          <option value="other">Overig</option>
                                        </select>
                                      </td>
                                      <td>
                                        {kind === "beer" ? (
                                          <select
                                            className="dataset-input"
                                            value={line.beer_choice ?? ""}
                                            onChange={(e) => {
                                              const value = String(e.target.value);
                                              const option = beerProductOptions.find((o) => o.value === value);
                                              updateLine(row.id, line.id, {
                                                beer_choice: value,
                                                bier_id: option?.payload.bier_id ?? "",
                                                product_id: option?.payload.product_id ?? "",
                                                product_type: (option?.payload.product_type as any) ?? "basis",
                                                omschrijving: "",
                                                unit_cost_ex: null
                                              });
                                            }}
                                          >
                                            <option value="">Kies...</option>
                                            {beerProductOptions.map((option) => (
                                              <option key={option.value} value={option.value}>
                                                {option.label}
                                              </option>
                                            ))}
                                          </select>
                                        ) : null}
                                        {kind === "packaging_component" ? (
                                          <select
                                            className="dataset-input"
                                            value={String(line.packaging_component_id ?? "")}
                                            onChange={(e) => updateLine(row.id, line.id, { packaging_component_id: String(e.target.value) })}
                                          >
                                            <option value="">Kies...</option>
                                            {packagingComponentOptions.map((option) => (
                                              <option key={option.value} value={option.value}>
                                                {option.label}
                                              </option>
                                            ))}
                                          </select>
                                        ) : null}
                                        {kind === "labor" || kind === "other" ? <span className="muted">Vrij</span> : null}
                                      </td>
                                      <td>
                                        {kind === "labor" || kind === "other" ? (
                                          <input className="dataset-input" value={String(line.omschrijving ?? "")} onChange={(e) => updateLine(row.id, line.id, { omschrijving: e.target.value })} />
                                        ) : (
                                          <input className="dataset-input dataset-input-readonly" value={resolvedOmschrijving} readOnly />
                                        )}
                                      </td>
                                      <td>
                                        <input className="dataset-input" type="number" step="any" value={String(line.quantity ?? 0)} onChange={(e) => updateLine(row.id, line.id, { quantity: toNumber(e.target.value, 0) })} />
                                      </td>
                                      <td>
                                        {kind === "labor" || kind === "other" ? (
                                          <input className="dataset-input" type="number" step="any" value={String(line.unit_cost_ex ?? "")} onChange={(e) => updateLine(row.id, line.id, { unit_cost_ex: e.target.value === "" ? null : toNumber(e.target.value, 0) })} />
                                        ) : (
                                          <input className="dataset-input dataset-input-readonly" value={money(unitCost)} readOnly />
                                        )}
                                      </td>
                                      <td style={{ textAlign: "right" }}>
                                        <IconButton
                                          label="Regel verwijderen"
                                          title="Regel verwijderen"
                                          onClick={() => deleteLine(row.id, line.id)}
                                        />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          <div style={{ marginTop: "0.75rem" }}>
                            <button type="button" className="editor-button editor-button-secondary" onClick={() => addLine(row.id)}>
                              Regel toevoegen
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="editor-actions">
        <button type="button" className="editor-button editor-button-secondary" onClick={addCatalogProduct}>
          Artikel toevoegen
        </button>
        <button type="button" className="editor-button editor-button-primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Opslaan..." : "Opslaan"}
        </button>
        {status ? <div className="editor-status">{status}</div> : null}
      </div>
    </section>
  );
}
