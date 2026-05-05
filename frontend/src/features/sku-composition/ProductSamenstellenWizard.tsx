"use client";

import { useEffect, useMemo, useState } from "react";

import { WizardSteps } from "@/components/WizardSteps";
import { buildCentralSkuIndex } from "@/features/sku/centralSkuIndex";
import { API_BASE_URL } from "@/lib/api";
import { StepControle } from "@/features/sku-composition/steps/StepControle";
import { StepLijst } from "@/features/sku-composition/steps/StepLijst";
import {
  text,
  toNumber,
  type CompositionLine,
  type GenericRecord,
  type PackagingLine,
} from "@/features/sku-composition/skuCompositionUtils";
import { saveAfvuleenheidFormat, saveSellableSkuBundle } from "@/features/sku-composition/skuCompositionIo";

type FlowMode = "afvuleenheid" | "verkoopbaar";
type SellableKind = "product" | "dienst";

type Props = {
  year: number;
  initialMode?: FlowMode;
  editFormatId?: string;
  channels: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  bomLines: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  packagingComponents: GenericRecord[];
  packagingComponentPrices: GenericRecord[];
};

export function ProductSamenstellenWizard(props: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [mode, setMode] = useState<FlowMode>(props.initialMode ?? "verkoopbaar");
  const [sellableKind, setSellableKind] = useState<SellableKind>("product");

  const [name, setName] = useState("Nieuw artikel");
  const [uom, setUom] = useState<"stuk" | "pakket" | "uur" | "doos" | "fust">("pakket");
  const [contentLiter, setContentLiter] = useState<number>(0);

  const [composition, setComposition] = useState<CompositionLine[]>([]);
  const [packaging, setPackaging] = useState<PackagingLine[]>([]);
  const [afvulParts, setAfvulParts] = useState<PackagingLine[]>([]);

  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [manualRateEx, setManualRateEx] = useState<number>(125);
  const [createdSkuId, setCreatedSkuId] = useState<string>("");
  const [createdArticleId, setCreatedArticleId] = useState<string>("");
  const [didLoadEditFormat, setDidLoadEditFormat] = useState(false);

  const steps = useMemo(
    () => [
      { id: "type", label: "Type kiezen", description: "Afvuleenheid of verkoopbaar artikel" },
      { id: "samenstelling", label: "Samenstelling", description: "Items en aantallen" },
      { id: "extras", label: "Extra’s", description: "Verpakking en opties" },
      { id: "controle", label: "Controle", description: "Controleer voor je afrondt" },
      { id: "lijst", label: "Lijst", description: "Resultaat en vervolgstap" },
    ],
    []
  );
  const currentStep = steps[stepIndex] ?? steps[0];

  const central = useMemo(() => {
    return buildCentralSkuIndex({
      year: props.year,
      channels: props.channels,
      verkoopprijzen: props.verkoopprijzen,
      skus: props.skus,
      articles: props.articles,
      kostprijsversies: props.kostprijsversies,
      kostprijsproductactiveringen: props.kostprijsproductactiveringen,
    });
  }, [
    props.year,
    props.channels,
    props.verkoopprijzen,
    props.skus,
    props.articles,
    props.kostprijsversies,
    props.kostprijsproductactiveringen,
  ]);

  const selectableSkuOptions = useMemo(() => {
    // For composition we allow cost_plus items with active cost, and finalized services with manual rate.
    return central.rows
      .filter((row) => (row.pricingMethod === "cost_plus" ? row.hasActiveCost : row.manualRateEx > 0))
      .map((row) => ({ value: row.skuId, label: row.label, uom: row.uom }));
  }, [central.rows]);

  const packagingOptions = useMemo(() => {
    return (Array.isArray(props.packagingComponents) ? props.packagingComponents : [])
      .map((row) => ({ value: text((row as any).id), label: text((row as any).omschrijving || (row as any).name) }))
      .filter((row) => row.value && row.label)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [props.packagingComponents]);

  const formatOptions = useMemo(() => {
    return (Array.isArray(props.articles) ? props.articles : [])
      .filter((row) => text((row as any).kind).toLowerCase() === "format")
      .map((row) => ({
        value: text((row as any).id),
        label: text((row as any).name) || text((row as any).id),
        contentLiter: toNumber((row as any).content_liter, 0),
      }))
      .filter((row) => row.value && row.label)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [props.articles]);

  useEffect(() => {
    if (didLoadEditFormat) return;
    if (!props.editFormatId) return;
    const editId = text(props.editFormatId);
    if (!editId) return;

    const format = (Array.isArray(props.articles) ? props.articles : []).find((row) => text((row as any).id) === editId);
    if (!format) return;
    if (text((format as any).kind).toLowerCase() !== "format") return;

    const formatsById = new Map<string, GenericRecord>();
    (Array.isArray(props.articles) ? props.articles : []).forEach((row) => {
      const id = text((row as any).id);
      if (id) formatsById.set(id, row);
    });

    const lines = (Array.isArray(props.bomLines) ? props.bomLines : []).filter(
      (row) => text((row as any).parent_article_id) === editId
    );

    setMode("afvuleenheid");
    setSellableKind("product");
    setName(text((format as any).name) || editId);
    setUom((text((format as any).uom) as any) || "stuk");
    setContentLiter(toNumber((format as any).content_liter, 0));
    setAfvulParts(
      lines.map((row) => {
        const componentId = text((row as any).component_article_id);
        const component = formatsById.get(componentId);
        const kind = text((component as any)?.kind).toLowerCase() === "format" ? "format" : "packaging_component";
        return {
          id: `edit-${editId}-${text((row as any).id) || Math.random().toString(16).slice(2)}`,
          kind: kind as any,
          componentId,
          qty: Math.max(0, toNumber((row as any).quantity, 0)),
        };
      })
    );
    setCreatedArticleId(editId);
    setDidLoadEditFormat(true);
  }, [didLoadEditFormat, props.articles, props.bomLines, props.editFormatId]);

  const totals = useMemo(() => {
    let liters = 0;
    let cost = 0;
    if (mode === "verkoopbaar" && sellableKind === "dienst") {
      // Services are priced as a manual rate per UOM (e.g. €/uur) and do not have liters,
      // composition items, or packaging costs.
      liters = 0;
      cost = Math.max(0, toNumber(manualRateEx, 0));
      return { liters, cost, packagingCost: 0, totalCost: cost };
    }

    composition.forEach((line) => {
      const sku = central.bySkuId.get(line.componentSkuId);
      if (!sku) return;
      const qty = Math.max(0, toNumber(line.qty, 0));
      liters += qty * (sku.contentLiter || 0);
      cost += qty * (sku.pricingMethod === "manual_rate" ? sku.manualRateEx : sku.kostprijsEx);
    });
    const packagingCostById = new Map<string, number>();
    (Array.isArray(props.packagingComponentPrices) ? props.packagingComponentPrices : []).forEach((row) => {
      const year = toNumber((row as any).jaar, 0);
      if (year !== props.year) return;
      const id = text((row as any).verpakkingsonderdeel_id || (row as any).packaging_component_id);
      if (!id) return;
      packagingCostById.set(id, toNumber((row as any).prijs_per_stuk, 0));
    });

    const articlesById = new Map<string, GenericRecord>();
    (Array.isArray(props.articles) ? props.articles : []).forEach((row) => {
      const id = text((row as any).id);
      if (id) articlesById.set(id, row);
    });
    const bomByParent = new Map<string, GenericRecord[]>();
    (Array.isArray(props.bomLines) ? props.bomLines : []).forEach((row) => {
      const parent = text((row as any).parent_article_id);
      if (!parent) return;
      const next = bomByParent.get(parent) ?? [];
      next.push(row);
      bomByParent.set(parent, next);
    });
    const formatCostMemo = new Map<string, number>();
    const visiting = new Set<string>();
    const computeFormatPackagingCost = (formatId: string): number => {
      if (formatCostMemo.has(formatId)) return formatCostMemo.get(formatId)!;
      if (visiting.has(formatId)) return 0;
      visiting.add(formatId);
      const lines = bomByParent.get(formatId) ?? [];
      let subtotal = 0;
      lines.forEach((line) => {
        const componentArticleId = text((line as any).component_article_id);
        if (!componentArticleId) return;
        const qty = Math.max(0, toNumber((line as any).quantity, 0));
        if (qty === 0) return;
        const component = articlesById.get(componentArticleId);
        const kind = text((component as any)?.kind).toLowerCase();
        if (kind === "packaging_component") {
          subtotal += qty * (packagingCostById.get(componentArticleId) ?? 0);
          return;
        }
        if (kind === "format") {
          subtotal += qty * computeFormatPackagingCost(componentArticleId);
        }
      });
      visiting.delete(formatId);
      formatCostMemo.set(formatId, subtotal);
      return subtotal;
    };

    let packagingCost = 0;
    const allPackaging = mode === "afvuleenheid" ? afvulParts : packaging;
    allPackaging.forEach((line) => {
      const qty = Math.max(0, toNumber(line.qty, 0));
      if (mode === "afvuleenheid" && line.kind === "format") {
        packagingCost += qty * computeFormatPackagingCost(line.componentId);
      } else {
        packagingCost += qty * (packagingCostById.get(line.componentId) ?? 0);
      }
    });

    if (mode === "afvuleenheid") {
      liters =
        toNumber(contentLiter, 0) > 0
          ? Math.max(0, toNumber(contentLiter, 0))
          : afvulParts.reduce((sum, line) => {
              if (line.kind !== "format") return sum;
              const opt = formatOptions.find((candidate) => candidate.value === line.componentId);
              if (!opt) return sum;
              return sum + Math.max(0, toNumber(line.qty, 0)) * (opt.contentLiter || 0);
            }, 0);
    }
    return { liters, cost, packagingCost, totalCost: cost + packagingCost };
  }, [
    central.bySkuId,
    composition,
    packaging,
    afvulParts,
    props.packagingComponentPrices,
    props.articles,
    props.bomLines,
    props.year,
    mode,
    sellableKind,
    manualRateEx,
    contentLiter,
    formatOptions,
  ]);

  const blockingWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (!name.trim()) warnings.push("Naam is verplicht.");
    if (mode === "verkoopbaar" && sellableKind === "product" && composition.length === 0) {
      warnings.push("Samenstelling is leeg.");
    }
    if (mode === "afvuleenheid" && afvulParts.length === 0) {
      warnings.push("Samenstelling is leeg.");
    }
    if (mode === "verkoopbaar" && sellableKind === "dienst") {
      if (toNumber(manualRateEx, 0) <= 0) warnings.push("Tarief per uur is verplicht.");
    }
    return warnings;
  }, [composition.length, mode, name, sellableKind, afvulParts.length, manualRateEx]);

  async function createSellableAndRouteToKostprijs() {
    setIsSaving(true);
    setStatus("");
    try {
      const { skuId, articleId } = await saveSellableSkuBundle({
        apiBaseUrl: API_BASE_URL,
        name,
        uom,
        totalsLiters: totals.liters,
        sellableKind,
        manualRateEx,
        composition,
        packaging,
        existingArticles: Array.isArray(props.articles) ? props.articles : [],
        existingSkus: Array.isArray(props.skus) ? props.skus : [],
        existingBomLines: Array.isArray(props.bomLines) ? props.bomLines : [],
      });

      setCreatedSkuId(skuId);
      setCreatedArticleId(articleId);
      setStatus("Opgeslagen.");
      // Always land on the list step; from there the user can continue to kostprijsbeheer if needed.
      setStepIndex(4);
    } catch (err) {
      setStatus(`Opslaan mislukt: ${String((err as any)?.message ?? err)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function createAfvuleenheid() {
    setIsSaving(true);
    setStatus("");
    try {
      const { articleId } = await saveAfvuleenheidFormat({
        apiBaseUrl: API_BASE_URL,
        name,
        uom,
        totalsLiters: totals.liters,
        afvulParts,
        existingArticles: Array.isArray(props.articles) ? props.articles : [],
        existingBomLines: Array.isArray(props.bomLines) ? props.bomLines : [],
        editFormatId: props.editFormatId,
      });
      setStatus("Afvuleenheid opgeslagen.");
      setCreatedArticleId(articleId);
      setStepIndex(4);
    } catch (err) {
      setStatus(`Opslaan mislukt: ${String((err as any)?.message ?? err)}`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="cpq-frame">
      <div className="cpq-grid">
        <aside className="cpq-left">
          <WizardSteps
            title="Samenstellen"
            steps={steps.map((s) => ({ id: s.id, title: s.label, description: s.description }))}
            activeIndex={stepIndex}
            onSelect={(idx) => setStepIndex(idx)}
          />
        </aside>

        <main className="cpq-main">
          <div className="wizard-shell wizard-shell-single" style={{ marginTop: 0 }}>
            <div className="wizard-step-card wizard-step-stage-card">
              <div className="wizard-step-header">
                <div>
                  <div className="wizard-step-title">
                    Stap {stepIndex + 1}: {currentStep.label}
                  </div>
                  <div className="wizard-step-description">{currentStep.description}</div>
                </div>
              </div>

              <div className="wizard-step-body">
                {currentStep.id === "type" ? (
                  <div className="wizard-form-grid">
                    <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                      <span>Wat wil je maken?</span>
                      <select
                        className="dataset-input"
                        value={mode}
                        onChange={(e) => {
                          const next = e.target.value as FlowMode;
                          setMode(next);
                          if (next === "afvuleenheid") {
                            setSellableKind("product");
                            setUom("stuk");
                          } else {
                            setUom("pakket");
                          }
                        }}
                      >
                        <option value="afvuleenheid">Afvuleenheid</option>
                        <option value="verkoopbaar">Verkoopbaar artikel</option>
                      </select>
                    </label>

                    {mode === "verkoopbaar" ? (
                      <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                        <span>Soort</span>
                        <select
                          className="dataset-input"
                          value={sellableKind}
                          onChange={(e) => {
                            const next = e.target.value as SellableKind;
                            setSellableKind(next);
                            setUom(next === "dienst" ? "uur" : "pakket");
                          }}
                        >
                          <option value="product">Product</option>
                          <option value="dienst">Dienstverlening</option>
                        </select>
                      </label>
                    ) : null}
                  </div>
                ) : null}

                {currentStep.id === "samenstelling" ? (
                  <div className="wizard-form-grid">
                    <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                      <span>Naam</span>
                      <input className="dataset-input" value={name} onChange={(e) => setName(e.target.value)} />
                    </label>

                    {mode === "verkoopbaar" ? (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <div className="content-card-title" style={{ marginBottom: 8 }}>
                          Items
                        </div>
                        {composition.map((line) => (
                          <div key={line.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 40px", gap: 10, marginBottom: 10 }}>
                            <select
                              className="dataset-input"
                              value={line.componentSkuId}
                              onChange={(e) =>
                                setComposition((current) =>
                                  current.map((row) =>
                                    row.id === line.id ? { ...row, componentSkuId: e.target.value } : row
                                  )
                                )
                              }
                            >
                              <option value="">Kies item…</option>
                              {selectableSkuOptions
                                .filter(
                                  (opt) =>
                                    opt.value === line.componentSkuId ||
                                    !composition.some(
                                      (row) => row.id !== line.id && row.componentSkuId === opt.value
                                    )
                                )
                                .map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                            </select>
                            <input
                              className="dataset-input"
                              type="number"
                              min={0}
                              value={String(line.qty)}
                              onChange={(e) =>
                                setComposition((current) =>
                                  current.map((row) =>
                                    row.id === line.id ? { ...row, qty: toNumber(e.target.value, 0) } : row
                                  )
                                )
                              }
                            />
                            <button
                              type="button"
                              className="icon-button-table"
                              onClick={() => setComposition((current) => current.filter((row) => row.id !== line.id))}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          onClick={() =>
                            setComposition((current) => [
                              ...current,
                              { id: `c-${Date.now()}-${Math.random().toString(16).slice(2)}`, componentSkuId: "", qty: 1 },
                            ])
                          }
                        >
                          Item toevoegen
                        </button>
                      </div>
                    ) : (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <div className="content-card-title" style={{ marginBottom: 8 }}>
                          Verpakkingsonderdelen
                        </div>
                        {afvulParts.map((line) => (
                          <div
                            key={line.id}
                            style={{ display: "grid", gridTemplateColumns: "160px 1fr 120px 40px", gap: 10, marginBottom: 10 }}
                          >
                            <select
                              className="dataset-input"
                              value={line.kind}
                              onChange={(e) =>
                                setAfvulParts((current) =>
                                  current.map((row) =>
                                    row.id === line.id ? { ...row, kind: e.target.value as any, componentId: "" } : row
                                  )
                                )
                              }
                            >
                              <option value="format">Afvuleenheid</option>
                              <option value="packaging_component">Verpakkingsonderdeel</option>
                            </select>
                            <select
                              className="dataset-input"
                              value={line.componentId}
                              onChange={(e) =>
                                setAfvulParts((current) =>
                                  current.map((row) =>
                                    row.id === line.id ? { ...row, componentId: e.target.value } : row
                                  )
                                )
                              }
                            >
                              <option value="">Kies onderdeel…</option>
                              {(line.kind === "format" ? formatOptions : packagingOptions)
                                .filter((opt) => {
                                  const selected = afvulParts.some(
                                    (row) => row.id !== line.id && row.kind === line.kind && row.componentId === opt.value
                                  );
                                  return opt.value === line.componentId || !selected;
                                })
                                .map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                            </select>
                            <input
                              className="dataset-input"
                              type="number"
                              min={0}
                              value={String(line.qty)}
                              onChange={(e) =>
                                setAfvulParts((current) =>
                                  current.map((row) =>
                                    row.id === line.id ? { ...row, qty: toNumber(e.target.value, 0) } : row
                                  )
                                )
                              }
                            />
                            <button
                              type="button"
                              className="icon-button-table"
                              onClick={() => setAfvulParts((current) => current.filter((row) => row.id !== line.id))}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          onClick={() =>
                            setAfvulParts((current) => [
                              ...current,
                              { id: `ap-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind: "packaging_component", componentId: "", qty: 1 },
                            ])
                          }
                        >
                          Onderdeel toevoegen
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}

                {currentStep.id === "extras" ? (
                  <div className="wizard-form-grid">
                    {mode === "verkoopbaar" ? (
                      <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                        <span>Eenheid</span>
                        <select className="dataset-input" value={uom} onChange={(e) => setUom(e.target.value as any)}>
                          <option value="stuk">stuk</option>
                          <option value="pakket">pakket</option>
                          <option value="uur">uur</option>
                        </select>
                      </label>
                    ) : (
                      <>
                        <label className="nested-field">
                          <span>Eenheid</span>
                          <select className="dataset-input" value={uom} onChange={(e) => setUom(e.target.value as any)}>
                            <option value="stuk">stuk</option>
                            <option value="doos">doos</option>
                            <option value="fust">fust</option>
                          </select>
                        </label>
                        <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                          <span>Inhoud (L) (optioneel, anders afgeleid)</span>
                          <input
                            className="dataset-input"
                            type="number"
                            step="any"
                            value={String(contentLiter)}
                            onChange={(e) => setContentLiter(toNumber(e.target.value, 0))}
                          />
                        </label>
                      </>
                    )}

                    {mode === "verkoopbaar" && sellableKind === "dienst" ? (
                      <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                        <span>Tarief (ex) per uur</span>
                        <input
                          className="dataset-input"
                          type="number"
                          step="any"
                          value={String(manualRateEx)}
                          onChange={(e) => setManualRateEx(toNumber(e.target.value, 0))}
                        />
                      </label>
                    ) : null}

                    {mode === "verkoopbaar" ? (
                      <div style={{ gridColumn: "1 / -1" }}>
                      <div className="content-card-title" style={{ marginBottom: 8 }}>
                        Extra verpakking
                      </div>
                      {packaging.map((line) => (
                        <div key={line.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 40px", gap: 10, marginBottom: 10 }}>
                          <select
                            className="dataset-input"
                            value={line.componentId}
                            onChange={(e) =>
                              setPackaging((current) =>
                                current.map((row) =>
                                  row.id === line.id ? { ...row, componentId: e.target.value } : row
                                )
                              )
                            }
                          >
                            <option value="">Kies verpakking…</option>
                            {packagingOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <input
                            className="dataset-input"
                            type="number"
                            min={0}
                            value={String(line.qty)}
                            onChange={(e) =>
                              setPackaging((current) =>
                                current.map((row) =>
                                  row.id === line.id ? { ...row, qty: toNumber(e.target.value, 0) } : row
                                )
                              )
                            }
                          />
                          <button
                            type="button"
                            className="icon-button-table"
                            onClick={() => setPackaging((current) => current.filter((row) => row.id !== line.id))}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="editor-button editor-button-secondary"
                        onClick={() =>
                          setPackaging((current) => [
                            ...current,
                            { id: `p-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind: "packaging_component", componentId: "", qty: 1 },
                          ])
                        }
                      >
                        Verpakking toevoegen
                      </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {currentStep.id === "controle" ? (
                  <StepControle
                    mode={mode}
                    sellableKind={sellableKind}
                    name={name}
                    uom={uom}
                    totals={totals}
                    blockingWarnings={blockingWarnings}
                  />
                ) : null}

                {currentStep.id === "lijst" ? (
                  <StepLijst
                    mode={mode}
                    sellableKind={sellableKind}
                    name={name}
                    createdSkuId={createdSkuId}
                    createdArticleId={createdArticleId}
                    onBackToControle={() => setStepIndex(3)}
                  />
                ) : null}
              </div>

              <div className="editor-actions wizard-footer-actions">
                <div className="editor-actions-group">
                  {stepIndex > 0 ? (
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                    >
                      Vorige
                    </button>
                  ) : null}
                </div>
                <div className="editor-actions-group">
                  <button type="button" className="editor-button editor-button-secondary" onClick={() => window.history.back()}>
                    Terug
                  </button>
                  {currentStep.id === "lijst" ? null : (
                    <button
                      type="button"
                      className="editor-button"
                      disabled={isSaving || (currentStep.id === "controle" && blockingWarnings.length > 0)}
                      onClick={() => {
                        if (currentStep.id === "controle") {
                          if (mode === "afvuleenheid") {
                            void createAfvuleenheid();
                            return;
                          }
                          void createSellableAndRouteToKostprijs();
                          return;
                        }
                        setStepIndex((i) => Math.min(steps.length - 1, i + 1));
                      }}
                    >
                      {isSaving ? "Opslaan..." : currentStep.id === "controle" ? "Opslaan" : "Volgende"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          {status ? <div className="editor-status wizard-inline-status">{status}</div> : null}
        </main>
      </div>
    </div>
  );
}
