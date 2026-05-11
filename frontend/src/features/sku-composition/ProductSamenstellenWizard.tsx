"use client";

import { useEffect, useMemo, useState } from "react";

import { WizardSteps } from "@/components/WizardSteps";
import { buildCentralSkuIndex } from "@/features/sku/centralSkuIndex";
import { API_BASE_URL } from "@/lib/api";
import { StepControle } from "@/features/sku-composition/steps/StepControle";
import { StepLijst } from "@/features/sku-composition/steps/StepLijst";
import { StepClassificeren } from "@/features/sku-composition/steps/StepClassificeren";
import { StepExtras } from "@/features/sku-composition/steps/StepExtras";
import { StepSamenstelling } from "@/features/sku-composition/steps/StepSamenstelling";
import { StepType } from "@/features/sku-composition/steps/StepType";
import {
  text,
  toNumber,
  type CompositionLine,
  type GenericRecord,
  type PackagingLine,
} from "@/features/sku-composition/skuCompositionUtils";
import { saveAfvuleenheidFormat, saveSellableSkuBundle } from "@/features/sku-composition/skuCompositionIo";
import { useSkuCompositionIndexes } from "@/features/sku-composition/skuCompositionIndexes";
import { computeTotals } from "@/features/sku-composition/skuCompositionDerivations";

type FlowMode = "afvuleenheid" | "verkoopbaar";
type SellableKind = "product" | "dienst";

type Props = {
  year: number;
  initialMode?: FlowMode;
  editFormatId?: string;
  editArticleId?: string;
  channels: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  bomLines: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  packagingComponents: GenericRecord[];
  packagingComponentPrices: GenericRecord[];
  productgroepen: GenericRecord[];
  alcoholcategorieen: GenericRecord[];
  verpakkingstypen: GenericRecord[];
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
  const [didLoadEditArticle, setDidLoadEditArticle] = useState(false);

  const [productGroup, setProductGroup] = useState<string>("giftset");
  const [alcoholCategory, setAlcoholCategory] = useState<string>("normaal");
  const [packagingType, setPackagingType] = useState<string>("");
  const [packagingTypeOptIn, setPackagingTypeOptIn] = useState<boolean>(false);
  const [douanoMappedSkuIds, setDouanoMappedSkuIds] = useState<Set<string>>(new Set());
  const [douanoMappingBySkuId, setDouanoMappingBySkuId] = useState<Map<string, any>>(new Map());

  const indexes = useSkuCompositionIndexes({
    year: props.year,
    packagingComponentPrices: Array.isArray(props.packagingComponentPrices) ? props.packagingComponentPrices : [],
    articles: Array.isArray(props.articles) ? props.articles : [],
    bomLines: Array.isArray(props.bomLines) ? props.bomLines : [],
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/integrations/douano/product-mappings?limit=10000`, { cache: "no-store" });
        const payload = await response.json();
        const items = Array.isArray((payload as any)?.items) ? (((payload as any).items as any[]) ?? []) : [];
        const next = new Set<string>();
        const mapping = new Map<string, any>();
        items.forEach((row) => {
          const sid = String((row as any)?.sku_id ?? "").trim();
          if (!sid) return;
          next.add(sid);
          const prev = mapping.get(sid);
          const nextUpdated = String((row as any)?.updated_at ?? "").trim();
          const prevUpdated = String(prev?.updated_at ?? "").trim();
          if (!prev || (nextUpdated && (!prevUpdated || nextUpdated > prevUpdated))) {
            mapping.set(sid, row);
          }
        });
        if (!cancelled) {
          setDouanoMappedSkuIds(next);
          setDouanoMappingBySkuId(mapping);
        }
      } catch {
        if (!cancelled) {
          setDouanoMappedSkuIds(new Set());
          setDouanoMappingBySkuId(new Map());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const showClassificeren = useMemo(() => {
    if (mode !== "verkoopbaar") return false;
    const skuId = String(createdSkuId ?? "").trim();
    if (!skuId) return false;
    return douanoMappedSkuIds.has(skuId);
  }, [createdSkuId, douanoMappedSkuIds, mode]);

  const steps = useMemo(() => {
    const base = [
      { id: "type", label: "Type kiezen", description: "Afvuleenheid of verkoopbaar artikel" },
      { id: "samenstelling", label: "Samenstelling", description: "Items en aantallen" },
      { id: "extras", label: "Extra’s", description: "Verpakking en opties" },
    ];

    const extra =
      mode === "verkoopbaar" && showClassificeren
        ? [
            {
              id: "classificeren",
              label: "Classificeren",
              description: "Productgroep, alcoholcategorie en verpakkingstype",
            },
          ]
        : [];

    return [
      ...base,
      ...extra,
      { id: "controle", label: "Controle", description: "Controleer voor je afrondt" },
      { id: "lijst", label: "Lijst", description: "Resultaat en vervolgstap" },
    ];
  }, [mode, showClassificeren]);
  const currentStep = steps[stepIndex] ?? steps[0];

  useEffect(() => {
    if (stepIndex >= steps.length) {
      setStepIndex(0);
    }
  }, [stepIndex, steps.length]);

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

  const productgroepOptions = useMemo(() => {
    return (Array.isArray(props.productgroepen) ? props.productgroepen : [])
      .filter((row) => (row as any)?.active !== false)
      .map((row) => ({ value: text((row as any).id), label: text((row as any).label) }))
      .filter((row) => row.value && row.label)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [props.productgroepen]);

  const alcoholOptions = useMemo(() => {
    return (Array.isArray(props.alcoholcategorieen) ? props.alcoholcategorieen : [])
      .filter((row) => (row as any)?.active !== false)
      .map((row) => ({ value: text((row as any).id), label: text((row as any).label) }))
      .filter((row) => row.value && row.label)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [props.alcoholcategorieen]);

  const verpakkingstypeOptions = useMemo(() => {
    return (Array.isArray(props.verpakkingstypen) ? props.verpakkingstypen : [])
      .filter((row) => (row as any)?.active !== false)
      .map((row) => ({
        value: text((row as any).id),
        label: text((row as any).label),
        allowed: Array.isArray((row as any).allowed_product_groups)
          ? ((row as any).allowed_product_groups as any[]).map((v) => text(v)).filter(Boolean)
          : [],
      }))
      .filter((row) => row.value && row.label)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [props.verpakkingstypen]);

  const packagingRequired = mode === "verkoopbaar" && (productGroup === "drank" || productGroup === "giftset");
  const packagingAllowedOptions = useMemo(() => {
    if (!packagingRequired) return verpakkingstypeOptions;
    return verpakkingstypeOptions.filter((row) => row.allowed.length === 0 || row.allowed.includes(productGroup));
  }, [packagingRequired, productGroup, verpakkingstypeOptions]);

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

  useEffect(() => {
    if (didLoadEditArticle) return;
    if (!props.editArticleId) return;
    const editId = text(props.editArticleId);
    if (!editId) return;

    const article = (Array.isArray(props.articles) ? props.articles : []).find((row) => text((row as any).id) === editId);
    if (!article) return;
    if (text((article as any).kind).toLowerCase() !== "bundle") return;

    const existingSku = (Array.isArray(props.skus) ? props.skus : []).find((row) => text((row as any).article_id) === editId);
    const skuId = text((existingSku as any)?.id);

    const subtype = text((article as any).sellable_subtype).toLowerCase();
    setMode("verkoopbaar");
    setSellableKind(subtype === "dienst" ? "dienst" : "product");
    setName(text((article as any).name) || text((article as any).naam) || "Nieuw artikel");
    setUom((() => {
      const value = text((article as any).uom).toLowerCase();
      if (value === "uur") return "uur";
      if (value === "stuk") return "stuk";
      if (value === "doos") return "doos";
      if (value === "fust") return "fust";
      return "pakket";
    })());
    setContentLiter(toNumber((article as any).content_liter, 0));
    setManualRateEx(toNumber((article as any).manual_rate_ex, 125));

    setProductGroup(text((article as any).product_group) || "giftset");
    setAlcoholCategory(text((article as any).alcohol_category) || "normaal");
    setPackagingType(text((article as any).packaging_type) || "");
    setPackagingTypeOptIn(Boolean(text((article as any).packaging_type)));

    const lines = (Array.isArray(props.bomLines) ? props.bomLines : []).filter((row) => text((row as any).parent_article_id) === editId);
    const nextComposition: CompositionLine[] = [];
    const nextPackaging: PackagingLine[] = [];
    lines.forEach((row) => {
      const componentSkuId = text((row as any).component_sku_id);
      const componentArticleId = text((row as any).component_article_id);
      const qty = Math.max(0, toNumber((row as any).quantity, 0));
      if (componentSkuId) {
        nextComposition.push({
          id: `edit-${editId}-sku-${text((row as any).id) || Math.random().toString(16).slice(2)}`,
          componentSkuId,
          qty,
        });
        return;
      }
      if (componentArticleId) {
        nextPackaging.push({ id: `edit-${editId}-${text((row as any).id) || Math.random().toString(16).slice(2)}`, kind: "packaging_component", componentId: componentArticleId, qty });
      }
    });
    setComposition(nextComposition);
    setPackaging(nextPackaging);

    setCreatedArticleId(editId);
    setCreatedSkuId(skuId);
    setDidLoadEditArticle(true);
    setStepIndex(0);
  }, [didLoadEditArticle, props.articles, props.bomLines, props.editArticleId, props.skus]);

  const totals = useMemo(() => {
    const allPackaging = mode === "afvuleenheid" ? afvulParts : packaging;
    return computeTotals({
      mode,
      sellableKind,
      manualRateEx,
      composition,
      packagingLines: allPackaging,
      contentLiter,
      formatOptions,
      centralSkuById: central.bySkuId,
      bomByParent: indexes.bomByParent,
      articlesById: indexes.articlesById,
      packagingCostById: indexes.packagingCostById,
    });
  }, [
    central.bySkuId,
    composition,
    packaging,
    afvulParts,
    mode,
    sellableKind,
    manualRateEx,
    contentLiter,
    formatOptions,
    indexes,
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
  }, [
    composition.length,
    mode,
    name,
    sellableKind,
    afvulParts.length,
    manualRateEx,
  ]);

  const beheerClassificationWarning = useMemo(() => {
    if (mode !== "verkoopbaar") return "";
    if (sellableKind !== "product") return "";
    const skuId = String(createdSkuId ?? "").trim();
    if (!skuId) return "";
    const mapping = douanoMappingBySkuId.get(skuId) ?? null;
    if (!mapping) return "Koppeling ontbreekt in Beheer → productkoppeling. Koppel dit SKU om Douano-export/omzetregels/dashboards te kunnen gebruiken.";
    const productGroupValue = String((mapping as any)?.product_group ?? "").trim();
    const packagingTypeValue = String((mapping as any)?.packaging_type ?? "").trim();
    if (!productGroupValue) return "Productgroep ontbreekt in Beheer → productkoppeling. Vul dit aan voor Douano-export/omzetregels/dashboards.";
    if ((productGroupValue === "drank" || productGroupValue === "giftset") && !packagingTypeValue) {
      return "Verpakkingstype is verplicht voor Drank/Giftset. Vul dit aan in Beheer → productkoppeling voor Douano-export/omzetregels/dashboards.";
    }
    return "";
  }, [createdSkuId, douanoMappingBySkuId, mode, sellableKind]);

  const kostprijsIsActive = useMemo(() => {
    if (mode !== "verkoopbaar") return false;
    if (sellableKind === "dienst") return true;
    const skuId = String(createdSkuId ?? "").trim();
    if (!skuId) return false;
    const year = Number(props.year || 0) || 0;
    return (Array.isArray(props.kostprijsproductactiveringen) ? props.kostprijsproductactiveringen : []).some((row) => {
      const recYear = Number((row as any)?.jaar ?? 0) || 0;
      if (recYear !== year) return false;
      const recSku = String((row as any)?.sku_id ?? "").trim();
      if (recSku !== skuId) return false;
      const effectiefTot = String((row as any)?.effectief_tot ?? "").trim();
      return !effectiefTot;
    });
  }, [createdSkuId, mode, props.kostprijsproductactiveringen, props.year, sellableKind]);

  const bomSaved = useMemo(() => {
    if (mode === "afvuleenheid") return Boolean(String(createdArticleId ?? "").trim());
    return Boolean(String(createdSkuId ?? "").trim() && String(createdArticleId ?? "").trim());
  }, [createdArticleId, createdSkuId, mode]);

  async function saveSellable(options?: { goToList?: boolean }) {
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
        productGroup,
        alcoholCategory,
        packagingType: packagingRequired || packagingTypeOptIn ? packagingType : "",
        composition,
        packaging,
        editArticleId: createdArticleId || props.editArticleId || "",
        editSkuId: createdSkuId || "",
      });

      setCreatedSkuId(skuId);
      setCreatedArticleId(articleId);
      setStatus("Opgeslagen.");
      if (options?.goToList) {
        // Land on the list step; from there the user can continue to kostprijsbeheer if needed.
        setStepIndex(steps.findIndex((s) => s.id === "lijst"));
      }
    } catch (err) {
      const raw = String((err as any)?.message ?? err);
      setStatus(raw.startsWith("{") ? "Opslaan mislukt: controleer invoer (validatiefout)." : `Opslaan mislukt: ${raw}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveAfvuleenheid(options?: { goToList?: boolean }) {
    setIsSaving(true);
    setStatus("");
    try {
      const { articleId } = await saveAfvuleenheidFormat({
        apiBaseUrl: API_BASE_URL,
        name,
        uom,
        totalsLiters: totals.liters,
        afvulParts,
        editFormatId: props.editFormatId,
      });
      setStatus("Afvuleenheid opgeslagen.");
      setCreatedArticleId(articleId);
      if (options?.goToList) {
        setStepIndex(steps.findIndex((s) => s.id === "lijst"));
      }
    } catch (err) {
      const raw = String((err as any)?.message ?? err);
      setStatus(raw.startsWith("{") ? "Opslaan mislukt: controleer invoer (validatiefout)." : `Opslaan mislukt: ${raw}`);
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
                  <>
                    <StepType
                      mode={mode}
                      sellableKind={sellableKind}
                      onModeChange={(next) => {
                        setMode(next);
                        if (next === "afvuleenheid") {
                          setSellableKind("product");
                          setUom("stuk");
                        } else {
                          setUom("pakket");
                        }
                      }}
                      onSellableKindChange={(next) => {
                        setSellableKind(next);
                        setUom(next === "dienst" ? "uur" : "pakket");
                        if (next === "dienst") {
                          setProductGroup("dienst");
                          setPackagingTypeOptIn(false);
                          setPackagingType("");
                        }
                      }}
                    />
                    
                    
                  </>
                ) : null}

                {currentStep.id === "classificeren" ? (
                  <StepClassificeren
                    mode={mode}
                    sellableKind={sellableKind}
                    name={name}
                    uom={uom}
                    productGroup={productGroup}
                    alcoholCategory={alcoholCategory}
                    packagingType={packagingType}
                    packagingTypeOptIn={packagingTypeOptIn}
                    productgroepen={props.productgroepen}
                    alcoholcategorieen={props.alcoholcategorieen}
                    verpakkingstypen={props.verpakkingstypen}
                    setProductGroup={setProductGroup}
                    setAlcoholCategory={setAlcoholCategory}
                    setPackagingType={setPackagingType}
                    setPackagingTypeOptIn={setPackagingTypeOptIn}
                  />
                ) : null}

                {currentStep.id === "samenstelling" ? (
                  <>
                    <StepSamenstelling
                      mode={mode}
                      sellableKind={sellableKind}
                      name={name}
                      setName={setName}
                      composition={composition}
                      setComposition={setComposition}
                      selectableSkuOptions={selectableSkuOptions}
                      afvulParts={afvulParts}
                      setAfvulParts={setAfvulParts}
                      formatOptions={formatOptions}
                      packagingOptions={packagingOptions}
                    />
                    
                  </>
                ) : null}

                {currentStep.id === "extras" ? (
                  <>
                    <StepExtras
                      mode={mode}
                      sellableKind={sellableKind}
                      uom={uom}
                      setUom={setUom}
                      contentLiter={contentLiter}
                      setContentLiter={setContentLiter}
                      manualRateEx={manualRateEx}
                      setManualRateEx={setManualRateEx}
                      packaging={packaging}
                      setPackaging={setPackaging}
                      packagingOptions={packagingOptions}
                    />
                    
                  </>
                ) : null}

                {currentStep.id === "controle" ? (
                  <StepControle
                    mode={mode}
                    sellableKind={sellableKind}
                    name={name}
                    uom={uom}
                    totals={totals}
                    blockingWarnings={blockingWarnings}
                    beheerWarning={beheerClassificationWarning}
                    onGoToBeheer={() => {
                      const skuId = String(createdSkuId ?? "").trim();
                      window.location.href = skuId
                        ? `/beheer/productkoppeling?sku_id=${encodeURIComponent(skuId)}`
                        : "/beheer/productkoppeling";
                    }}
                  />
                ) : null}

                {currentStep.id === "lijst" ? (
                  <StepLijst
                    mode={mode}
                    sellableKind={sellableKind}
                    name={name}
                    year={props.year}
                    createdSkuId={createdSkuId}
                    createdArticleId={createdArticleId}
                    bomSaved={bomSaved}
                    beheerClassificationWarning={beheerClassificationWarning}
                    kostprijsIsActive={kostprijsIsActive}
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
                  {currentStep.id === "lijst" ? null : (
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      onClick={() => window.history.back()}
                    >
                      Terug
                    </button>
                  )}

                  {currentStep.id === "controle" ? (
                    <>
                      <button
                        type="button"
                        className="editor-button"
                        disabled={isSaving || blockingWarnings.length > 0}
                        onClick={() => {
                          if (mode === "afvuleenheid") {
                            void saveAfvuleenheid();
                            return;
                          }
                          void saveSellable();
                        }}
                      >
                        {isSaving ? "Opslaan..." : "Opslaan"}
                      </button>
                      <button
                        type="button"
                        className="editor-button editor-button-primary"
                        disabled={isSaving || blockingWarnings.length > 0}
                        onClick={() => {
                          if (mode === "afvuleenheid") {
                            void saveAfvuleenheid({ goToList: true });
                            return;
                          }
                          void saveSellable({ goToList: true });
                        }}
                      >
                        {isSaving ? "Opslaan..." : "Opslaan & verder"}
                      </button>
                    </>
                  ) : currentStep.id === "lijst" ? null : (
                    <>
                      <button
                        type="button"
                        className="editor-button"
                        disabled={isSaving || blockingWarnings.length > 0}
                        onClick={() => {
                          if (mode === "afvuleenheid") {
                            void saveAfvuleenheid();
                            return;
                          }
                          void saveSellable();
                        }}
                      >
                        {isSaving ? "Opslaan..." : "Opslaan"}
                      </button>
                      <button
                        type="button"
                        className="editor-button editor-button-primary"
                        disabled={isSaving}
                        onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
                      >
                        Volgende
                      </button>
                    </>
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
