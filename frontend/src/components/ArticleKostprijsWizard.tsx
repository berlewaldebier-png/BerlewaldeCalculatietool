"use client";

import { useMemo, useState } from "react";

import { usePageShellHeader } from "@/components/PageShell";
import { WizardSteps } from "@/components/WizardSteps";
import { API_BASE_URL } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiClient";
import { formatMoneyEUR } from "@/lib/formatters";
import {
  createId,
  nowIso,
  text,
  toNumber,
  unwrapDatasetListPayload,
  type GenericRecord,
} from "@/components/article-kostprijs/articleKostprijsWizardUtils";
import {
  buildBundleKostprijsversieRecord,
  buildActiveVersionIdBySku,
  buildArticleById,
  buildBomCostLines,
  buildBundleOptions,
  buildDefaultYear,
  buildPackagingPriceById,
  buildSkuById,
  buildVersionById,
  summarizeBomCostLines,
  type BomCostLine,
  type Summary,
} from "@/components/article-kostprijs/articleKostprijsWizardDerivations";
import {
  activateKostprijsversie,
  putKostprijsversies,
} from "@/components/article-kostprijs/articleKostprijsWizardIo";
import {
  ArticleKostprijsBasisStep,
  ArticleKostprijsSamenstellingStep,
  ArticleKostprijsSamenvattingStep,
} from "@/components/article-kostprijs/ArticleKostprijsWizardSteps";

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
  initialBundleSkuId?: string;
  startWithNew?: boolean;
  onRowsChange?: (rows: GenericRecord[]) => void;
  onPersisted?: (result: ArticleKostprijsWizardPersistResult) => void;
  onFinish?: () => void;
  onBackToLanding?: () => void;
};

const KOSTPRIJSVERSIES_API = `${API_BASE_URL}/data/kostprijsversies`;

export function ArticleKostprijsWizard(props: Props) {
  usePageShellHeader({
    title: "Artikel kostprijsberekening",
    subtitle: "Bereken de kostprijs voor een verkoopbaar artikel (bundle) op basis van de samenstelling.",
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

  const skuById = useMemo(() => buildSkuById(skus), [skus]);

  const articleById = useMemo(() => buildArticleById(articles), [articles]);

  const bundleOptions = useMemo(
    () => buildBundleOptions({ articles, skus, articleById }),
    [articles, skus, articleById]
  );

  const defaultYear = useMemo(() => buildDefaultYear(activations), [activations]);

  const initialSelectedRecordId = text(props.initialSelectedId);
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);
  const [selectedBundleSkuId, setSelectedBundleSkuId] = useState<string>(() => {
    const forcedSkuId = text(props.initialBundleSkuId);
    if (forcedSkuId) {
      const exists = skuById.get(forcedSkuId);
      if (exists) return forcedSkuId;
    }
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

  const activeVersionIdBySku = useMemo(
    () => buildActiveVersionIdBySku(activations, selectedYear),
    [activations, selectedYear]
  );

  const versionById = useMemo(() => buildVersionById(rows), [rows]);

  const packagingPriceById = useMemo(
    () => buildPackagingPriceById(packagingComponentPrices, selectedYear),
    [packagingComponentPrices, selectedYear]
  );

  const bomCostLines = useMemo<BomCostLine[]>(() => {
    return buildBomCostLines({
      selectedArticleId,
      bomLines,
      skuById,
      articleById,
      activeVersionIdBySku,
      versionById,
      packagingPriceById,
    });
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
    return summarizeBomCostLines({ bomCostLines, selectedBundleSkuId });
  }, [bomCostLines, selectedBundleSkuId]);

  const hasBlockingIssues = summary.warnings.length > 0;

  function buildRecordPayload(nextStatus: "concept" | "definitief") {
    return buildBundleKostprijsversieRecord({
      recordId,
      selectedYear,
      nextStatus,
      selectedBundleSkuId,
      selectedArticleId,
      selectedLabel,
      selectedArticle,
      summary,
      nowIso,
    });
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
      try {
        await putKostprijsversies(nextRows);
      } catch (error) {
        if (error instanceof ApiRequestError) {
          setStatus(`Opslaan mislukt (${error.status}): ${error.bodyText || "Opslaan mislukt."}`);
          return;
        }
        throw error;
      }
      const refreshedResponse = await fetch(KOSTPRIJSVERSIES_API, { cache: "no-store" });
      const refreshedRows = refreshedResponse.ok
        ? unwrapDatasetListPayload(await refreshedResponse.json()) ?? nextRows
        : nextRows;
      props.onRowsChange?.(refreshedRows);
      props.onPersisted?.({ id: record.id, year: selectedYear, status: nextStatus });

      if (nextStatus === "definitief" && opts.activate) {
        try {
          await activateKostprijsversie(String(record.id ?? ""));
        } catch (error) {
          if (error instanceof ApiRequestError) {
            setStatus(`Activeren mislukt (${error.status}): ${error.bodyText || "Activeren mislukt."}`);
            return;
          }
          throw error;
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
  const currentStep = steps[stepIndex] ?? steps[0];

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
                <div className="content-card-header">
                  <div className="content-card-title">{selectedLabel}</div>
                  <div className="content-card-subtitle">
                    Houd dezelfde structuur aan als bier-kostprijzen: Productkosten + Verpakkingskosten + Opslag + Accijnzen.
                  </div>
                </div>

            {stepIndex === 0 ? (
              <ArticleKostprijsBasisStep
                selectedYear={selectedYear}
                onSelectedYearChange={(next) => setSelectedYear(next)}
                selectedBundleSkuId={selectedBundleSkuId}
                onSelectedBundleSkuIdChange={(nextSkuId) => {
                  setSelectedBundleSkuId(nextSkuId);
                  if (!initialSelectedRecordId) {
                    setRecordId(createId());
                  }
                }}
                bundleOptions={bundleOptions}
              />
            ) : null}

            {stepIndex === 1 ? <ArticleKostprijsSamenstellingStep bomCostLines={bomCostLines} /> : null}

            {stepIndex === 2 ? (
              <ArticleKostprijsSamenvattingStep selectedLabel={selectedLabel} summary={summary} />
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
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => props.onBackToLanding?.()}
                  >
                    Terug
                  </button>
                </div>
                <div className="editor-actions-group">
                  <button type="button" className="editor-button editor-button-secondary" onClick={() => void persist("concept", { activate: false })}>
                    Opslaan
                  </button>
                  <button
                    type="button"
                    className="editor-button"
                    disabled={isSaving || (currentStep.id === "samenvatting" && hasBlockingIssues)}
                    onClick={() => {
                      if (currentStep.id === "samenvatting") {
                        void persist("definitief", { activate: true });
                        return;
                      }
                      setStepIndex((i) => Math.min(steps.length - 1, i + 1));
                    }}
                  >
                    {isSaving ? "Opslaan..." : currentStep.id === "samenvatting" ? "Afronden" : "Volgende"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {currentStep.id === "samenvatting" && hasBlockingIssues ? (
            <div className="editor-status wizard-inline-status" style={{ background: "rgba(245, 158, 11, 0.08)", borderColor: "rgba(245, 158, 11, 0.3)" }}>
              <strong>Afronden is geblokkeerd.</strong> Los eerst dit op: {summary.warnings.slice(0, 4).join(" ")}
              {summary.warnings.includes("Samenstelling (BOM) is leeg.") ? (
                <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => setStepIndex(1)}
                  >
                    Naar samenstelling
                  </button>
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => {
                      window.location.href = "/producten-verpakking";
                    }}
                  >
                    Naar artikelen
                  </button>
                </div>
              ) : null}
            </div>
          ) : status ? (
            <div className="editor-status wizard-inline-status">{status}</div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
