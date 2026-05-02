"use client";

import { useMemo, useState } from "react";

import { usePageShellHeader } from "@/components/PageShell";
import { WizardSteps } from "@/components/WizardSteps";
import { API_BASE_URL } from "@/lib/api";
import { formatMoneyEUR } from "@/lib/formatters";

type GenericRecord = Record<string, unknown>;

export type ArticleKostprijsWizardPersistResult = {
  id: string;
  year: number;
  status: string;
};

type Props = {
  initialRows: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  bomLines: GenericRecord[];
  packagingComponentPrices: GenericRecord[];
  initialSelectedId?: string;
  startWithNew?: boolean;
  onRowsChange?: (rows: GenericRecord[]) => void;
  onPersisted?: (result: ArticleKostprijsWizardPersistResult) => void;
  onFinish?: () => void;
  onBackToLanding?: () => void;
};

const KOSTPRIJSVERSIES_API = `${API_BASE_URL}/data/kostprijsversies`;

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function unwrapDatasetListPayload(value: unknown): GenericRecord[] | null {
  if (Array.isArray(value)) return value as GenericRecord[];
  if (value && typeof value === "object") {
    const data = (value as any).data;
    if (Array.isArray(data)) return data as GenericRecord[];
  }
  return null;
}

type BomCostLine = {
  id: string;
  label: string;
  qty: number;
  productkosten: number;
  verpakkingskosten: number;
  opslag: number;
  accijnzen: number;
  kostprijs: number;
  warnings: string[];
};

type Summary = {
  productkosten: number;
  verpakkingskosten: number;
  opslag: number;
  accijnzen: number;
  kostprijs: number;
  warnings: string[];
};

export function ArticleKostprijsWizard(props: Props) {
  usePageShellHeader({
    title: "Artikel kostprijsberekening",
    subtitle: "Bereken de kostprijs voor een verkoopbaar artikel (bundle) op basis van de samenstelling.",
    badgeText: null,
    rightActions: null,
  });

  const rows = Array.isArray(props.initialRows) ? props.initialRows : [];
  const skus = Array.isArray(props.skus) ? props.skus : [];
  const articles = Array.isArray(props.articles) ? props.articles : [];
  const bomLines = Array.isArray(props.bomLines) ? props.bomLines : [];
  const packagingComponentPrices = Array.isArray(props.packagingComponentPrices)
    ? props.packagingComponentPrices
    : [];
  const activations = Array.isArray(props.kostprijsproductactiveringen)
    ? props.kostprijsproductactiveringen
    : [];

  const skuById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    skus.forEach((row) => {
      const id = text((row as any).id);
      if (id) map.set(id, row);
    });
    return map;
  }, [skus]);

  const articleById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    articles.forEach((row) => {
      const id = text((row as any).id);
      if (id) map.set(id, row);
    });
    return map;
  }, [articles]);

  const bundleOptions = useMemo(() => {
    const out: Array<{ articleId: string; skuId: string; label: string }> = [];
    const bundleArticleIds = new Set(
      articles
        .filter((row) => text((row as any).kind).toLowerCase() === "bundle")
        .map((row) => text((row as any).id))
        .filter(Boolean)
    );

    skus.forEach((sku) => {
      if (text((sku as any).kind).toLowerCase() !== "article") return;
      const articleId = text((sku as any).article_id);
      if (!articleId || !bundleArticleIds.has(articleId)) return;
      const skuId = text((sku as any).id);
      const article = articleById.get(articleId);
      const label =
        text((article as any)?.name ?? (article as any)?.naam) ||
        text((sku as any).name) ||
        articleId;
      if (skuId) out.push({ articleId, skuId, label });
    });
    out.sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
    return out;
  }, [articles, skus, articleById]);

  const defaultYear = useMemo(() => {
    const years = activations
      .map((row) => toNumber((row as any).jaar, 0))
      .filter((y) => y > 0)
      .sort((a, b) => a - b);
    return years[years.length - 1] ?? new Date().getFullYear();
  }, [activations]);

  const initialSelectedRecordId = text(props.initialSelectedId);
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);
  const [selectedBundleSkuId, setSelectedBundleSkuId] = useState<string>(() => {
    const initialSelected = text(props.initialSelectedId);
    if (initialSelected) {
      const found = rows.find((row) => text((row as any).id) === initialSelected) ?? null;
      const skuId =
        text(((found as any)?.resultaat_snapshot as any)?.producten?.basisproducten?.[0]?.sku_id) ||
        text((found as any)?.sku_id);
      if (skuId) return skuId;
    }
    return bundleOptions[0]?.skuId ?? "";
  });
  const [recordId, setRecordId] = useState<string>(() => initialSelectedRecordId || createId());
  const [status, setStatus] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  const selectedSku = selectedBundleSkuId ? skuById.get(selectedBundleSkuId) ?? null : null;
  const selectedArticleId = text((selectedSku as any)?.article_id);
  const selectedArticle = selectedArticleId ? articleById.get(selectedArticleId) ?? null : null;
  const selectedLabel =
    text((selectedArticle as any)?.name ?? (selectedArticle as any)?.naam) ||
    text((selectedSku as any)?.name) ||
    selectedArticleId ||
    "Artikel";

  const activeVersionIdBySku = useMemo(() => {
    const map = new Map<string, string>();
    activations.forEach((row) => {
      const year = toNumber((row as any).jaar, 0);
      if (year !== selectedYear) return;
      const tot = text((row as any).effectief_tot);
      if (tot) return;
      const skuId = text((row as any).sku_id);
      const versionId = text((row as any).kostprijsversie_id);
      if (skuId && versionId) map.set(skuId, versionId);
    });
    return map;
  }, [activations, selectedYear]);

  const versionById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    rows.forEach((row) => {
      const id = text((row as any).id);
      if (id) map.set(id, row);
    });
    return map;
  }, [rows]);

  const packagingPriceById = useMemo(() => {
    const map = new Map<string, number>();
    packagingComponentPrices.forEach((row) => {
      const year = toNumber((row as any).jaar, 0);
      if (year !== selectedYear) return;
      const id = text((row as any).verpakkingsonderdeel_id ?? (row as any).packaging_component_id);
      if (!id) return;
      map.set(id, toNumber((row as any).prijs_per_stuk, 0));
    });
    return map;
  }, [packagingComponentPrices, selectedYear]);

  function findSnapshotRowForSku(version: GenericRecord | null, skuId: string) {
    if (!version) return null;
    const products = ((version as any).resultaat_snapshot ?? {}).producten ?? {};
    const list = Array.isArray(products.basisproducten) ? products.basisproducten : [];
    return (list as any[]).find((row) => text(row?.sku_id) === skuId) ?? null;
  }

  const bomCostLines = useMemo<BomCostLine[]>(() => {
    if (!selectedArticleId) return [];
    const relevant = bomLines.filter(
      (row) => text((row as any).parent_article_id) === selectedArticleId
    );
    const out: BomCostLine[] = [];

    relevant.forEach((line) => {
      const qty = Math.max(0, toNumber((line as any).quantity, 0));
      const componentSkuId = text((line as any).component_sku_id);
      const componentArticleId = text((line as any).component_article_id);
      const warnings: string[] = [];

      if (componentSkuId) {
        const componentSku = skuById.get(componentSkuId) ?? null;
        const label = text((componentSku as any)?.name) || componentSkuId;
        const activeVid = activeVersionIdBySku.get(componentSkuId) ?? "";
        const version = activeVid ? versionById.get(activeVid) ?? null : null;
        if (!activeVid || !version) warnings.push("Geen actieve kostprijs gevonden voor component.");
        const snap = findSnapshotRowForSku(version, componentSkuId) ?? {};

        const inkoop = toNumber((snap as any).inkoop ?? (snap as any).primaire_kosten ?? (snap as any).variabele_kosten, 0);
        const verp = toNumber((snap as any).verpakkingskosten, 0);
        const opslag = toNumber((snap as any).vaste_kosten ?? (snap as any).vaste_directe_kosten ?? (snap as any).indirecte_kosten, 0);
        const accijns = toNumber((snap as any).accijns, 0);
        const kostprijs = toNumber((snap as any).kostprijs, inkoop + verp + opslag + accijns);

        out.push({
          id: text((line as any).id) || createId(),
          label,
          qty,
          productkosten: qty * (inkoop + verp),
          verpakkingskosten: 0,
          opslag: qty * opslag,
          accijnzen: qty * accijns,
          kostprijs: qty * kostprijs,
          warnings,
        });
        return;
      }

      if (componentArticleId) {
        const article = articleById.get(componentArticleId) ?? null;
        const label = text((article as any)?.name ?? (article as any)?.naam) || componentArticleId;
        const price = packagingPriceById.get(componentArticleId);
        if (price === undefined) warnings.push("Geen actieve jaarprijs gevonden voor verpakkingsonderdeel.");
        const unit = price ?? 0;
        out.push({
          id: text((line as any).id) || createId(),
          label,
          qty,
          productkosten: 0,
          verpakkingskosten: qty * unit,
          opslag: 0,
          accijnzen: 0,
          kostprijs: qty * unit,
          warnings,
        });
        return;
      }

      warnings.push("Onbekende BOM-regel: mist component_sku_id of component_article_id.");
      out.push({
        id: text((line as any).id) || createId(),
        label: text((line as any).omschrijving) || "Onbekend onderdeel",
        qty,
        productkosten: 0,
        verpakkingskosten: 0,
        opslag: 0,
        accijnzen: 0,
        kostprijs: 0,
        warnings,
      });
    });

    return out;
  }, [
    activeVersionIdBySku,
    articleById,
    bomLines,
    packagingPriceById,
    selectedArticleId,
    skuById,
    versionById,
  ]);

  const summary = useMemo<Summary>(() => {
    let productkosten = 0;
    let verpakkingskosten = 0;
    let opslag = 0;
    let accijnzen = 0;
    const warnings: string[] = [];
    bomCostLines.forEach((line) => {
      productkosten += line.productkosten;
      verpakkingskosten += line.verpakkingskosten;
      opslag += line.opslag;
      accijnzen += line.accijnzen;
      warnings.push(...line.warnings);
    });
    const kostprijs = productkosten + verpakkingskosten + opslag + accijnzen;
    if (!selectedBundleSkuId) warnings.push("Selecteer eerst een artikel.");
    if (bomCostLines.length === 0) warnings.push("Samenstelling (BOM) is leeg.");
    return { productkosten, verpakkingskosten, opslag, accijnzen, kostprijs, warnings };
  }, [bomCostLines, selectedBundleSkuId]);

  function buildRecordPayload(nextStatus: "concept" | "definitief") {
    const ts = nowIso();
    const snapshotRow =
      nextStatus === "definitief"
        ? [
            {
              id: `row-${recordId}`,
              sku_id: selectedBundleSkuId,
              product_id: selectedArticleId,
              product_type: "article",
              verpakking: selectedLabel,
              verpakking_label: selectedLabel,
              primaire_kosten: summary.productkosten,
              inkoop: summary.productkosten,
              verpakkingskosten: summary.verpakkingskosten,
              vaste_kosten: summary.opslag,
              indirecte_kosten: summary.opslag,
              accijns: summary.accijnzen,
              kostprijs: summary.kostprijs,
              liters_per_product: toNumber((selectedArticle as any)?.content_liter, 0),
            },
          ]
        : [];

    return {
      id: recordId,
      jaar: selectedYear,
      status: nextStatus,
      bier_id: "",
      versie_nummer: 1,
      created_at: ts,
      updated_at: ts,
      finalized_at: nextStatus === "definitief" ? ts : "",
      type: "bundle",
      brontype: "bundle_article",
      basisgegevens: {
        jaar: selectedYear,
        biernaam: selectedLabel,
        btw_tarief: "21%",
        article_id: selectedArticleId,
        sku_id: selectedBundleSkuId,
      },
      resultaat_snapshot:
        nextStatus === "definitief"
          ? { producten: { basisproducten: snapshotRow, samengestelde_producten: [] } }
          : {},
      kostprijs: summary.kostprijs,
    };
  }

  async function persist(nextStatus: "concept" | "definitief", opts: { activate?: boolean }) {
    if (!selectedBundleSkuId || !selectedArticleId) {
      setStatus("Selecteer eerst een artikel.");
      return;
    }
    setIsSaving(true);
    setStatus("");
    try {
      const record = buildRecordPayload(nextStatus);
      const nextRows = [...rows.filter((r) => text((r as any).id) !== text(record.id)), record];
      const response = await fetch(KOSTPRIJSVERSIES_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextRows),
      });
      if (!response.ok) {
        const body = await response.text();
        setStatus(`Opslaan mislukt (${response.status}): ${body || response.statusText}`);
        return;
      }
      const refreshedResponse = await fetch(KOSTPRIJSVERSIES_API, { cache: "no-store" });
      const refreshedRows = refreshedResponse.ok
        ? unwrapDatasetListPayload(await refreshedResponse.json()) ?? nextRows
        : nextRows;
      props.onRowsChange?.(refreshedRows);
      props.onPersisted?.({ id: record.id, year: selectedYear, status: nextStatus });

      if (nextStatus === "definitief" && opts.activate) {
        const actResp = await fetch(`${API_BASE_URL}/data/kostprijsversies/${encodeURIComponent(record.id)}/activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!actResp.ok) {
          const body = await actResp.text();
          setStatus(`Activeren mislukt (${actResp.status}): ${body || actResp.statusText}`);
          return;
        }
      }

      setStatus(nextStatus === "definitief" ? "Opgeslagen." : "Concept opgeslagen.");
      props.onFinish?.();
    } catch (err) {
      setStatus(`Opslaan mislukt: ${String((err as any)?.message ?? err)}`);
    } finally {
      setIsSaving(false);
    }
  }

  const steps = useMemo(
    () => [
      { id: "basis", label: "Basisgegevens", description: "Kies jaar en artikel" },
      { id: "samenstelling", label: "Samenstelling", description: "Controleer componenten en kosten" },
      { id: "samenvatting", label: "Samenvatting", description: "Controleer totalen en rond af" },
    ],
    []
  );

  return (
    <div className="cpq-frame">
      <div className="cpq-grid">
        <aside className="cpq-left">
          <WizardSteps
            title="Artikel wizard"
            steps={steps.map((s) => ({ id: s.id, title: s.label, description: s.description }))}
            activeIndex={stepIndex}
            onSelect={(idx) => setStepIndex(idx)}
          />
        </aside>

        <section className="cpq-main">
          <div className="content-card">
            <div className="content-card-header">
              <div className="content-card-title">{selectedLabel}</div>
              <div className="content-card-subtitle">
                Houd dezelfde structuur aan als bier-kostprijzen: Productkosten + Verpakkingskosten + Opslag + Accijnzen.
              </div>
            </div>

            {stepIndex === 0 ? (
              <div className="wizard-form-grid">
                <label className="nested-field">
                  <span>Jaar</span>
                  <input
                    className="dataset-input"
                    type="number"
                    value={String(selectedYear)}
                    onChange={(e) => setSelectedYear(toNumber(e.target.value, selectedYear))}
                  />
                </label>
                <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                  <span>Artikel</span>
                  <select
                    className="dataset-input"
                    value={selectedBundleSkuId}
                    onChange={(e) => {
                      setSelectedBundleSkuId(String(e.target.value));
                      if (!initialSelectedRecordId) {
                        setRecordId(createId());
                      }
                    }}
                  >
                    {bundleOptions.map((opt) => (
                      <option key={opt.skuId} value={opt.skuId}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            {stepIndex === 1 ? (
              <div className="dataset-editor-scroll">
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th>Onderdeel</th>
                      <th>Aantal</th>
                      <th style={{ whiteSpace: "nowrap" }}>Productkosten</th>
                      <th style={{ whiteSpace: "nowrap" }}>Verpakkingskosten</th>
                      <th style={{ whiteSpace: "nowrap" }}>Opslag direct/indirect</th>
                      <th style={{ whiteSpace: "nowrap" }}>Accijnzen (totaal)</th>
                      <th style={{ whiteSpace: "nowrap" }}>Kostprijs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bomCostLines.length > 0 ? (
                      bomCostLines.map((line) => (
                        <tr key={line.id}>
                          <td>
                            {line.label}
                            {line.warnings.length > 0 ? (
                              <div className="muted" style={{ marginTop: 4 }}>
                                {line.warnings.join(" ")}
                              </div>
                            ) : null}
                          </td>
                          <td>{line.qty}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(line.productkosten)}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(line.verpakkingskosten)}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(line.opslag)}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(line.accijnzen)}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(line.kostprijs)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="dataset-empty">
                          Geen samenstelling gevonden voor dit artikel.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}

            {stepIndex === 2 ? (
              <div>
                {summary.warnings.length > 0 ? (
                  <div className="editor-status" style={{ marginBottom: 12 }}>
                    {summary.warnings.slice(0, 4).join(" ")}
                  </div>
                ) : null}
                <div className="dataset-editor-scroll">
                  <table className="dataset-editor-table">
                    <thead>
                      <tr>
                        <th>Artikel</th>
                        <th style={{ whiteSpace: "nowrap" }}>Productkosten</th>
                        <th style={{ whiteSpace: "nowrap" }}>Verpakkingskosten</th>
                        <th style={{ whiteSpace: "nowrap" }}>Opslag direct/indirect</th>
                        <th style={{ whiteSpace: "nowrap" }}>Accijnzen (totaal)</th>
                        <th style={{ whiteSpace: "nowrap" }}>Kostprijs</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>{selectedLabel}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(summary.productkosten)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(summary.verpakkingskosten)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(summary.opslag)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(summary.accijnzen)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(summary.kostprijs)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="wizard-footer">
              <div className="wizard-footer-left">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => props.onBackToLanding?.()}
                >
                  Terug
                </button>
              </div>
              <div className="wizard-footer-right">
                {status ? <div className="editor-status">{status}</div> : null}
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  disabled={isSaving}
                  onClick={() => void persist("concept", { activate: false })}
                >
                  Opslaan
                </button>
                <button
                  type="button"
                  className="editor-button"
                  disabled={isSaving || summary.warnings.length > 0}
                  onClick={() => void persist("definitief", { activate: true })}
                >
                  Afronden & activeren
                </button>
              </div>
            </div>
          </div>

          <div className="cpq-toolbar" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="editor-button editor-button-secondary"
              disabled={stepIndex <= 0}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              Vorige
            </button>
            <button
              type="button"
              className="editor-button"
              disabled={stepIndex >= steps.length - 1}
              onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
            >
              Volgende
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
