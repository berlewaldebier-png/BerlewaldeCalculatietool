"use client";

import { useMemo, useState } from "react";

import { WizardSteps } from "@/components/WizardSteps";
import { buildCentralSkuIndex } from "@/features/sku/centralSkuIndex";
import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;

type FlowMode = "afvuleenheid" | "verkoopbaar";
type SellableKind = "product" | "dienst";

type Props = {
  year: number;
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

function text(value: unknown) {
  return String(value ?? "").trim();
}

function toNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slugifyId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return normalized || `new-${Date.now()}`;
}

type CompositionLine = {
  id: string;
  componentSkuId: string;
  qty: number;
};

type PackagingLine = {
  id: string;
  componentId: string;
  qty: number;
};

export function ProductSamenstellenWizard(props: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [mode, setMode] = useState<FlowMode>("verkoopbaar");
  const [sellableKind, setSellableKind] = useState<SellableKind>("product");

  const [name, setName] = useState("Nieuw artikel");
  const [uom, setUom] = useState<"stuk" | "pakket" | "uur">("pakket");
  const [contentLiter, setContentLiter] = useState<number>(0);

  const [composition, setComposition] = useState<CompositionLine[]>([]);
  const [packaging, setPackaging] = useState<PackagingLine[]>([]);
  const [afvulParts, setAfvulParts] = useState<PackagingLine[]>([]);

  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [manualRateEx, setManualRateEx] = useState<number>(125);
  const [createdSkuId, setCreatedSkuId] = useState<string>("");
  const [createdArticleId, setCreatedArticleId] = useState<string>("");

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

  const totals = useMemo(() => {
    let liters = 0;
    let cost = 0;
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
    let packagingCost = 0;
    const allPackaging = mode === "afvuleenheid" ? afvulParts : packaging;
    allPackaging.forEach((line) => {
      const qty = Math.max(0, toNumber(line.qty, 0));
      packagingCost += qty * (packagingCostById.get(line.componentId) ?? 0);
    });
    return { liters, cost, packagingCost, totalCost: cost + packagingCost };
  }, [central.bySkuId, composition, packaging, afvulParts, props.packagingComponentPrices, props.year, mode]);

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
      const articleId = `bundle-${slugifyId(name)}`;
      const skuId = `sku-${articleId}`;

      const articlePayload: GenericRecord = {
        id: articleId,
        name,
        kind: "bundle",
        uom,
        content_liter: totals.liters,
        sellable_subtype: sellableKind === "dienst" ? "dienst" : "product",
        pricing_method: sellableKind === "dienst" ? "manual_rate" : "cost_plus",
        manual_rate_ex: sellableKind === "dienst" ? toNumber(manualRateEx, 0) : 0,
      };

      const nextArticles = [...(Array.isArray(props.articles) ? props.articles : []), articlePayload];
      const nextSkus = [
        ...(Array.isArray(props.skus) ? props.skus : []),
        { id: skuId, kind: "article", article_id: articleId, name, pricing_method: articlePayload.pricing_method, manual_rate_ex: articlePayload.manual_rate_ex },
      ];

      const nextBomLines: GenericRecord[] = [];
      composition.forEach((line, idx) => {
        nextBomLines.push({
          id: `bom-${articleId}-sku-${idx}`,
          parent_article_id: articleId,
          component_sku_id: line.componentSkuId,
          component_article_id: "",
          quantity: line.qty,
          uom: "stuk",
        });
      });
      packaging.forEach((line, idx) => {
        nextBomLines.push({
          id: `bom-${articleId}-pkg-${idx}`,
          parent_article_id: articleId,
          component_article_id: line.componentId,
          component_sku_id: "",
          quantity: line.qty,
          uom: "stuk",
        });
      });
      const mergedBom = [
        ...(Array.isArray(props.bomLines) ? props.bomLines : []),
        ...nextBomLines,
      ];

      const saveList = async (endpoint: string, payload: unknown) => {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || `Opslaan mislukt (${endpoint})`);
        }
      };

      await saveList("/data/articles", nextArticles);
      await saveList("/data/skus", nextSkus);
      await saveList("/data/bom-lines", mergedBom);

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
      const articleId = `fmt-${slugifyId(name)}`;
      const articlePayload: GenericRecord = {
        id: articleId,
        name,
        kind: "format",
        uom: "stuk",
        content_liter: Math.max(0, Number(contentLiter) || 0),
      };

      const nextArticles = [...(Array.isArray(props.articles) ? props.articles : []), articlePayload];
      const nextBomLines: GenericRecord[] = afvulParts.map((line, idx) => ({
        id: `bom-${articleId}-pc-${idx}`,
        parent_article_id: articleId,
        component_article_id: line.componentId,
        component_sku_id: "",
        quantity: line.qty,
        uom: "stuk",
      }));
      const mergedBom = [...(Array.isArray(props.bomLines) ? props.bomLines : []), ...nextBomLines];

      const saveList = async (endpoint: string, payload: unknown) => {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || `Opslaan mislukt (${endpoint})`);
        }
      };

      await saveList("/data/articles", nextArticles);
      await saveList("/data/bom-lines", mergedBom);

      setStatus("Afvuleenheid opgeslagen.");
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
                              {selectableSkuOptions.map((opt) => (
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
                          <div key={line.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 40px", gap: 10, marginBottom: 10 }}>
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
                              { id: `ap-${Date.now()}-${Math.random().toString(16).slice(2)}`, componentId: "", qty: 1 },
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
                      <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                        <span>Inhoud (liter) (optioneel)</span>
                        <input
                          className="dataset-input"
                          type="number"
                          step="any"
                          value={String(contentLiter)}
                          onChange={(e) => setContentLiter(toNumber(e.target.value, 0))}
                        />
                      </label>
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
                            { id: `p-${Date.now()}-${Math.random().toString(16).slice(2)}`, componentId: "", qty: 1 },
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
                  <div className="wizard-form-grid">
                    <div className="nested-field" style={{ gridColumn: "1 / -1" }}>
                      <span>Samenvatting</span>
                      <div className="dataset-editor-scroll" style={{ borderRadius: 12 }}>
                        <table className="dataset-editor-table">
                          <thead>
                            <tr>
                              <th>Naam</th>
                              <th>UoM</th>
                              <th>Liters (afgeleid)</th>
                              <th>Kostprijs items</th>
                              <th>Verpakking</th>
                              <th>Totaal</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>{name}</td>
                              <td>{uom}</td>
                              <td>{totals.liters.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td>{totals.cost.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}</td>
                              <td>{totals.packagingCost.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}</td>
                              <td>{totals.totalCost.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {blockingWarnings.length > 0 ? (
                      <div className="editor-status wizard-inline-status" style={{ gridColumn: "1 / -1" }}>
                        <strong>Kan niet afronden:</strong> {blockingWarnings.join(" ")}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {currentStep.id === "lijst" ? (
                  <div className="wizard-form-grid">
                    <div className="editor-status wizard-inline-status" style={{ gridColumn: "1 / -1" }}>
                      <strong>Toegevoegd:</strong> {name}
                      {createdSkuId ? (
                        <div style={{ marginTop: 6 }} className="muted">
                          SKU: <code>{createdSkuId}</code>
                        </div>
                      ) : null}
                    </div>

                    {sellableKind === "dienst" ? (
                      <div className="dataset-empty" style={{ gridColumn: "1 / -1" }}>
                        Dienstverlening gebruikt een uur-tarief en is direct selecteerbaar in offertes zodra het tarief is ingevuld.
                      </div>
                    ) : (
                      <div className="dataset-empty" style={{ gridColumn: "1 / -1" }}>
                        Volgende stap: rond de kostprijs af en activeer dit verkoopbaar artikel in kostprijsbeheer.
                      </div>
                    )}

                    {sellableKind !== "dienst" && createdSkuId ? (
                      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="cpq-button cpq-button-primary"
                          onClick={() => {
                            window.location.href = `/nieuwe-kostprijsberekening?mode=wizard-new&kind=article&sku_id=${encodeURIComponent(
                              createdSkuId
                            )}&focus=activations`;
                          }}
                        >
                          Naar kostprijsbeheer
                        </button>
                      </div>
                    ) : null}
                  </div>
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
                    {isSaving ? "Opslaan..." : currentStep.id === "controle" ? "Afronden" : "Volgende"}
                  </button>
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
