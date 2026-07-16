"use client";

import { useMemo, useState } from "react";
import { API_BASE_URL } from "@/lib/api";
import { TrashIcon } from "@/components/berekeningen/BerekeningenWizardParts";
import { saveBaseBeerSku, saveSellableSkuBundle } from "@/features/sku-composition/skuCompositionIo";
import { makeBeerSkuLabel, normalizeUnitLabel } from "@/lib/skuLabels";
import { selectExplicitBeerVariantSkus } from "@/components/berekeningen/sellableVariantProjection";

type GenericRecord = Record<string, unknown>;

export type CostProductCandidate = {
  id: string;
  productId: string;
  productType: string;
  label: string;
  liters: number;
  kindLabel: string;
};

type VariantDraft = {
  id: string;
  name: string;
  baseSkuId: string;
  quantity: string;
  uom: string;
  packagingType: string;
  packagingComponentId: string;
  packagingQty: string;
  savedSkuId?: string;
  savedArticleId?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function stripBeerPrefix(label: unknown, beerName: unknown) {
  const raw = normalizeUnitLabel(label);
  const beer = text(beerName);
  if (!raw || !beer) return raw;
  const escaped = beer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return raw.replace(new RegExp(`^${escaped}\\s*[-–—:]?\\s*`, "i"), "").trim() || raw;
}

function num(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function labelForSku(sku: GenericRecord, articleById: Map<string, GenericRecord>) {
  const articleId = text((sku as any).article_id || (sku as any).format_article_id);
  const article = articleId ? articleById.get(articleId) : null;
  return (
    text((sku as any).name) ||
    text((sku as any).label) ||
    text((article as any)?.name) ||
    text((article as any)?.omschrijving) ||
    text((sku as any).id)
  );
}

function inferUom(label: string) {
  const value = label.toLowerCase();
  if (value.includes("fust")) return "fust";
  if (value.includes("doos") || value.includes("x") || value.includes("*")) return "pakket";
  return "stuk";
}

function optionLabel(row: GenericRecord) {
  return (
    text((row as any).omschrijving) ||
    text((row as any).naam) ||
    text((row as any).name) ||
    text((row as any).label) ||
    text((row as any).id)
  );
}

function variantId() {
  return `variant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 7.5l3 3" />
    </svg>
  );
}

export function SellableVariantsStep({
  current,
  skus,
  articles,
  bomLines,
  verpakkingstypen,
  costProductRows,
  onRefreshSkus,
  onEnableProductId,
}: {
  current: GenericRecord;
  skus: GenericRecord[];
  articles: GenericRecord[];
  bomLines: GenericRecord[];
  verpakkingstypen: GenericRecord[];
  costProductRows: CostProductCandidate[];
  onRefreshSkus: () => Promise<void>;
  onEnableProductId: (productId: string) => void;
}) {
  const basis = ((current as any).basisgegevens ?? {}) as GenericRecord;
  const beerId = text((current as any).bier_id || (basis as any).bier_id);
  const beerName = text((basis as any).biernaam) || "Nieuw artikel";
  const productGroup = text((basis as any).product_group) || "drank";
  const alcoholCategory = text((basis as any).alcohol_category);
  const packagingType = text((basis as any).packaging_type);

  const articleById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(articles) ? articles : []).forEach((row) => {
      const id = text((row as any).id);
      if (id) map.set(id, row);
    });
    return map;
  }, [articles]);

  function displaySkuLabel(sku: GenericRecord) {
    return makeBeerSkuLabel(beerName, labelForSku(sku, articleById));
  }

  const skuByFormatId = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(skus) ? skus : []).forEach((sku) => {
      const kind = text((sku as any).kind).toLowerCase();
      const skuBeerId = text((sku as any).beer_id);
      const formatId = text((sku as any).format_article_id);
      if (kind === "beer_format" && skuBeerId === beerId && formatId) {
        map.set(formatId, sku);
      }
    });
    return map;
  }, [beerId, skus]);

  const baseOptions = useMemo(() => {
    if (!beerId) return [];
    const litersByProductId = new Map(
      (Array.isArray(costProductRows) ? costProductRows : []).map((row) => [row.productId, row.liters] as const)
    );
    return (Array.isArray(skus) ? skus : [])
      .filter((sku) => {
        const kind = text((sku as any).kind).toLowerCase();
        const skuBeerId = text((sku as any).beer_id);
        if (kind !== "beer_format") return false;
        if (beerId && skuBeerId && skuBeerId !== beerId) return false;
        return true;
      })
      .map((sku) => {
        const id = text((sku as any).id);
        const articleId = text((sku as any).article_id || (sku as any).format_article_id);
        const article = articleId ? articleById.get(articleId) : null;
        return {
          id,
          label: displaySkuLabel(sku),
          liters: num((article as any)?.content_liter ?? (sku as any).content_liter ?? litersByProductId.get(articleId), 0),
        };
      })
      .filter((row) => row.id)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [articleById, beerId, beerName, costProductRows, skus]);

  const packagingComponents = useMemo(
    () =>
      (Array.isArray(articles) ? articles : [])
        .filter((row) => text((row as any).kind).toLowerCase() === "packaging_component")
        .map((row) => ({ id: text((row as any).id), label: text((row as any).name || (row as any).omschrijving || (row as any).id) }))
        .filter((row) => row.id)
        .sort((a, b) => a.label.localeCompare(b.label, "nl-NL")),
    [articles]
  );

  const packagingTypeOptions = useMemo(
    () =>
      (Array.isArray(verpakkingstypen) ? verpakkingstypen : [])
        .map((row) => ({ id: text((row as any).id), label: optionLabel(row) }))
        .filter((row) => row.id)
        .sort((a, b) => a.label.localeCompare(b.label, "nl-NL")),
    [verpakkingstypen]
  );

  function createEmptyVariantDraft(): VariantDraft {
    return {
      id: variantId(),
      name: "",
      baseSkuId: "",
      quantity: "",
      uom: "pakket",
      packagingType: "",
      packagingComponentId: "",
      packagingQty: "1",
    };
  }

  const [variantRows, setVariantRows] = useState<VariantDraft[]>([createEmptyVariantDraft()]);
  const [editingVariant, setEditingVariant] = useState<VariantDraft | null>(null);
  const [status, setStatus] = useState("");
  const [savingKey, setSavingKey] = useState("");

  const savedVariantRows = useMemo(() => {
    return selectExplicitBeerVariantSkus({
      beerId,
      skus: Array.isArray(skus) ? skus : [],
      bomLines: Array.isArray(bomLines) ? bomLines : [],
    })
      .map((sku) => {
        const articleId = text((sku as any).article_id);
        const article = articleId ? articleById.get(articleId) : null;
        const composition = (Array.isArray(bomLines) ? bomLines : []).filter((line) => {
          if (text((line as any).parent_article_id) !== articleId) return false;
          const componentSkuId = text((line as any).component_sku_id);
          if (!componentSkuId) return false;
          const componentSku = (Array.isArray(skus) ? skus : []).find((candidate) => text((candidate as any).id) === componentSkuId);
          return text((componentSku as any)?.kind).toLowerCase() === "beer_format";
        });
        const packagingLine =
          (Array.isArray(bomLines) ? bomLines : []).find((line) => {
            if (text((line as any).parent_article_id) !== articleId) return false;
            return Boolean(text((line as any).component_article_id)) && !text((line as any).component_sku_id);
          }) ?? {};
        const firstComponent = composition[0] ?? {};
        return {
          sku,
          skuId: text((sku as any).id),
          articleId,
          label: displaySkuLabel(sku),
          code: text((sku as any).code),
          liters: num((article as any)?.content_liter ?? (sku as any).content_liter, 0),
          baseSkuId: text((firstComponent as any).component_sku_id),
          quantity: text((firstComponent as any).quantity ?? (firstComponent as any).qty) || "1",
          uom: text((article as any)?.uom ?? (sku as any).uom) || "pakket",
          packagingType: text((sku as any).packaging_type),
          packagingComponentId: text((packagingLine as any).component_article_id),
          packagingQty: text((packagingLine as any).quantity ?? (packagingLine as any).qty) || "1",
        };
      })
      .filter((row) => row.skuId)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [articleById, beerId, beerName, bomLines, skus]);

  async function saveCostProductAsSku(row: CostProductCandidate) {
    if (!beerId) {
      setStatus("Bier/stijl ontbreekt. Sla eerst de basisgegevens op.");
      return;
    }
    if (!row.productId) {
      setStatus("Product-id ontbreekt voor deze kostprijsrij.");
      return;
    }
    const formatName = normalizeUnitLabel(stripBeerPrefix(row.label, beerName));
    const name = makeBeerSkuLabel(beerName, formatName);
    const liters = Math.max(0, row.liters);
    if (liters <= 0) {
      setStatus("Inhoud in liters ontbreekt voor deze kostprijsrij.");
      return;
    }

    setSavingKey(row.id);
    setStatus("");
    try {
      const result = await saveBaseBeerSku({
        apiBaseUrl: API_BASE_URL,
        name,
        formatName,
        uom: inferUom(row.label),
        totalsLiters: liters,
        beerId,
        productGroup,
        alcoholCategory,
        packagingType,
        editFormatId: row.productId,
      });
      onEnableProductId(row.productId);
      setStatus(`SKU opgeslagen: ${result.skuId}`);
      await onRefreshSkus();
    } catch (err) {
      setStatus(`Opslaan mislukt: ${String((err as any)?.message ?? err)}`);
    } finally {
      setSavingKey("");
    }
  }

  function updateVariant(id: string, patch: Partial<VariantDraft>) {
    setVariantRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addVariant() {
    setVariantRows((rows) => [...rows, createEmptyVariantDraft()]);
  }

  function packagingTypeLabel(packagingTypeId: string) {
    return packagingTypeOptions.find((option) => option.id === packagingTypeId)?.label || packagingTypeId;
  }

  function packagingComponentLabel(packagingComponentId: string) {
    return packagingComponents.find((option) => option.id === packagingComponentId)?.label || "";
  }

  function derivedVariantName(row: VariantDraft) {
    const componentLabel = packagingComponentLabel(row.packagingComponentId).trim();
    const typeLabel = packagingTypeLabel(row.packagingType).trim();
    const normalizedType = `${row.packagingType} ${typeLabel}`.toLowerCase();
    const shouldAppendType = normalizedType.includes("geschenk") || normalizedType.includes("gift");
    const unitLabel = componentLabel
      ? shouldAppendType && typeLabel
        ? `${componentLabel} - ${typeLabel}`
        : componentLabel
      : typeLabel;
    return unitLabel ? makeBeerSkuLabel(beerName, unitLabel) : "";
  }

  function canSaveVariant(row: VariantDraft) {
    return Boolean(
      text(row.baseSkuId) &&
        num(row.quantity, 0) > 0 &&
        text(row.uom) &&
        text(row.packagingType) &&
        derivedVariantName(row)
    );
  }

  function editSavedVariant(row: (typeof savedVariantRows)[number]) {
    setEditingVariant({
      id: variantId(),
      name: row.label,
      baseSkuId: row.baseSkuId || "",
      quantity: row.quantity || "1",
      uom: row.uom || "pakket",
      packagingType: row.packagingType || packagingType,
      packagingComponentId: row.packagingComponentId || "",
      packagingQty: row.packagingQty || "1",
      savedSkuId: row.skuId,
      savedArticleId: row.articleId,
    });
  }

  async function deleteSavedVariant(row: (typeof savedVariantRows)[number]) {
    if (!row.skuId) return;
    const ok = window.confirm(`Verkoopbare variant verwijderen?\n\n${row.label}`);
    if (!ok) return;
    setSavingKey(row.skuId);
    setStatus("");
    try {
      const response = await fetch(`${API_BASE_URL}/meta/delete-sellable?sku_id=${encodeURIComponent(row.skuId)}&dry_run=false`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = (payload as any)?.detail ?? payload;
        const reasons = (detail as any)?.reasons;
        if (Array.isArray(reasons) && reasons.length > 0) {
          throw new Error(`Verwijderen geblokkeerd: ${reasons.join(", ")}`);
        }
        throw new Error(typeof detail === "string" && detail ? detail : "Verwijderen mislukt.");
      }
      setStatus("Variant verwijderd.");
      await onRefreshSkus();
    } catch (err) {
      setStatus(`Verwijderen mislukt: ${String((err as any)?.message ?? err)}`);
    } finally {
      setSavingKey("");
    }
  }

  async function saveVariant(row: VariantDraft) {
    const selectedBase = baseOptions.find((option) => option.id === row.baseSkuId) ?? null;
    const qty = Math.max(0, num(row.quantity, 0));
    const name = derivedVariantName(row);
    if (!selectedBase) {
      setStatus("Selecteer eerst de basis-SKU.");
      return;
    }
    if (!name) {
      setStatus("Naam variant is verplicht.");
      return;
    }
    if (qty <= 0) {
      setStatus("Aantal moet groter zijn dan 0.");
      return;
    }
    if (!text(row.packagingType)) {
      setStatus("Verpakkingstype is verplicht voor verkoopbare varianten.");
      return;
    }

    const packagingQty = row.packagingComponentId ? Math.max(1, num(row.packagingQty, 1)) : 0;
    const packaging =
      row.packagingComponentId && packagingQty > 0
        ? [{ id: `pkg-${row.id}`, kind: "packaging_component" as const, componentId: row.packagingComponentId, qty: packagingQty }]
        : [];

    setSavingKey(row.id);
    setStatus("");
    try {
      const result = await saveSellableSkuBundle({
        apiBaseUrl: API_BASE_URL,
        name,
        uom: row.uom.trim() || "pakket",
        totalsLiters: selectedBase.liters * qty,
        sellableKind: "product",
        bundleContext: "beer_variant",
        beerId,
        manualRateEx: 0,
        productGroup,
        alcoholCategory,
        packagingType: row.packagingType,
        composition: [{ id: `component-${row.id}`, componentSkuId: row.baseSkuId, qty }],
        packaging,
        editArticleId: row.savedArticleId,
        editSkuId: row.savedSkuId,
      });
      setVariantRows((rows) => {
        const nextRows = rows.filter((item) => item.id !== row.id);
        return nextRows.length > 0 ? nextRows : [createEmptyVariantDraft()];
      });
      if (row.savedSkuId) setEditingVariant(null);
      setStatus(`Variant opgeslagen: ${result.skuId}`);
      await onRefreshSkus();
    } catch (err) {
      setStatus(`Opslaan mislukt: ${String((err as any)?.message ?? err)}`);
    } finally {
      setSavingKey("");
    }
  }

  return (
    <div className="wizard-stack">
      <div className="module-card compact-card">
        <div className="module-card-title">Kostprijsproducten uit stap 4</div>
        <div className="module-card-text">
          Sla de berekende producten op als verkoopbare SKU. Deze vormen daarna de bron voor varianten en de Douano-koppeling.
        </div>
        <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Product</th>
                <th>Type</th>
                <th>Liter</th>
                <th>SKU</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {costProductRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="dataset-empty">
                    Geen kostprijsproducten gevonden. Controleer eerst stap 3 en stap 4.
                  </td>
                </tr>
              ) : null}
              {costProductRows.map((row) => {
                const existingSku = skuByFormatId.get(row.productId);
                return (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 700 }}>{row.label}</td>
                    <td>{row.kindLabel}</td>
                    <td>{row.liters ? row.liters.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}</td>
                    <td>{existingSku ? <code>{text((existingSku as any).code) || text((existingSku as any).id)}</code> : "-"}</td>
                    <td>
                      {existingSku ? (
                        <span className="status-pill status-ok">SKU opgeslagen</span>
                      ) : (
                        <span className="status-pill status-warning">nog niet opgeslagen</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="editor-button editor-button-secondary"
                        onClick={() => void saveCostProductAsSku(row)}
                        disabled={savingKey === row.id}
                      >
                        {existingSku ? "Bijwerken" : "Opslaan als SKU"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="module-card compact-card">
        <div className="module-card-title">Verkoopbare varianten</div>
        <div className="module-card-text">
          Maak afgeleide SKU's vanuit een basis-SKU, bijvoorbeeld een doos 12 x 33cl vanuit 12 losse flesjes.
        </div>
        {savedVariantRows.length > 0 ? (
          <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
            <table className="dataset-editor-table wizard-table-compact">
              <thead>
                <tr>
                  <th>Opgeslagen variant</th>
                  <th>Code</th>
                  <th>Basis-SKU</th>
                  <th>Aantal</th>
                  <th>Verpakkingstype</th>
                  <th>Verpakkingscomponent</th>
                  <th>Liters</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {savedVariantRows.map((row) => {
                  const isEditing = editingVariant?.savedSkuId === row.skuId;
                  const draft = isEditing && editingVariant ? editingVariant : null;
                  const totalLiters = draft
                    ? (baseOptions.find((option) => option.id === draft.baseSkuId)?.liters ?? 0) * Math.max(0, num(draft.quantity, 0))
                    : row.liters;
                  return (
                    <tr key={row.skuId}>
                      <td style={{ fontWeight: 700 }}>{draft ? derivedVariantName(draft) : row.label}</td>
                      <td>{row.code || "-"}</td>
                      <td>
                        {draft ? (
                          <select className="dataset-input" value={draft.baseSkuId} onChange={(event) => setEditingVariant({ ...draft, baseSkuId: event.target.value })}>
                            <option value="">Selecteer basis-SKU</option>
                            {baseOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          baseOptions.find((option) => option.id === row.baseSkuId)?.label || "-"
                        )}
                      </td>
                      <td>
                        {draft ? (
                          <input className="dataset-input" type="number" min="0" step="1" value={draft.quantity} onChange={(event) => setEditingVariant({ ...draft, quantity: event.target.value })} />
                        ) : (
                          row.quantity || "-"
                        )}
                      </td>
                      <td>
                        {draft ? (
                          <select className="dataset-input" value={draft.packagingType} onChange={(event) => setEditingVariant({ ...draft, packagingType: event.target.value })}>
                            <option value="">Selecteer type...</option>
                            {packagingTypeOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          packagingTypeLabel(row.packagingType) || "-"
                        )}
                      </td>
                      <td>
                        {draft ? (
                          <select
                            className="dataset-input"
                            value={draft.packagingComponentId}
                            onChange={(event) => setEditingVariant({ ...draft, packagingComponentId: event.target.value, packagingQty: "1" })}
                          >
                            <option value="">Geen</option>
                            {packagingComponents.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          packagingComponentLabel(row.packagingComponentId) || "-"
                        )}
                      </td>
                      <td>{totalLiters ? totalLiters.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}</td>
                      <td style={{ textAlign: "right" }}>
                        <div className="editor-actions-group" style={{ justifyContent: "flex-end" }}>
                          {draft ? (
                            <>
                              <button type="button" className="editor-button" onClick={() => void saveVariant(draft)} disabled={savingKey === draft.id}>
                                Opslaan
                              </button>
                              <button type="button" className="editor-button editor-button-secondary" onClick={() => setEditingVariant(null)}>
                                Annuleren
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="icon-button-table" title="Bewerken" aria-label="Variant bewerken" onClick={() => editSavedVariant(row)}>
                                <EditIcon />
                              </button>
                              <button
                                type="button"
                                className="icon-button-table"
                                title="Verwijderen"
                                aria-label="Variant verwijderen"
                                disabled={savingKey === row.skuId}
                                onClick={() => void deleteSavedVariant(row)}
                              >
                                <TrashIcon />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Basis-SKU</th>
                <th>Aantal</th>
                <th>Eenheid</th>
                <th>Verpakkingstype</th>
                <th>Verpakkingscomponent</th>
                <th>Liters</th>
                <th>Naam variant</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {variantRows.map((row) => {
                const selectedBase = baseOptions.find((option) => option.id === row.baseSkuId) ?? null;
                const totalLiters = selectedBase ? selectedBase.liters * Math.max(0, num(row.quantity, 0)) : 0;
                return (
                  <tr key={row.id}>
                    <td>
                      <select className="dataset-input" value={row.baseSkuId} onChange={(event) => updateVariant(row.id, { baseSkuId: event.target.value })}>
                        <option value="">Selecteer basis-SKU</option>
                        {baseOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="dataset-input" type="number" min="0" step="1" value={row.quantity} onChange={(event) => updateVariant(row.id, { quantity: event.target.value })} />
                    </td>
                    <td>
                      <select className="dataset-input" value={row.uom} onChange={(event) => updateVariant(row.id, { uom: event.target.value })}>
                        <option value="pakket">pakket</option>
                        <option value="doos">doos</option>
                        <option value="stuk">stuk</option>
                      </select>
                    </td>
                    <td>
                      <select className="dataset-input" value={row.packagingType} onChange={(event) => updateVariant(row.id, { packagingType: event.target.value })}>
                        <option value="">Selecteer type...</option>
                        {packagingTypeOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1fr)", gap: 8 }}>
                        <select
                          className="dataset-input"
                          value={row.packagingComponentId}
                          onChange={(event) => updateVariant(row.id, { packagingComponentId: event.target.value, packagingQty: "1" })}
                        >
                          <option value="">Geen</option>
                          {packagingComponents.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td>{totalLiters ? totalLiters.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}</td>
                    <td>
                      <input className="dataset-input" value={derivedVariantName(row) || "-"} readOnly />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="editor-actions-group" style={{ justifyContent: "flex-end" }}>
                        <button type="button" className="editor-button" onClick={() => void saveVariant(row)} disabled={savingKey === row.id || !canSaveVariant(row)}>
                          {row.savedSkuId ? "Bijwerken" : "Variant opslaan"}
                        </button>
                        <button
                          type="button"
                          className="icon-button-table"
                          aria-label="Variantregel verwijderen"
                          title="Rij verwijderen"
                          onClick={() => setVariantRows((rows) => rows.filter((item) => item.id !== row.id))}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="editor-actions">
          <button type="button" className="editor-button editor-button-secondary" onClick={addVariant}>
            Rij toevoegen
          </button>
        </div>
      </div>

      {status ? (
        <div className={status.includes("mislukt") || status.includes("Selecteer") || status.includes("ontbreekt") ? "form-error" : "form-success"}>
          {status}
        </div>
      ) : null}
    </div>
  );
}
