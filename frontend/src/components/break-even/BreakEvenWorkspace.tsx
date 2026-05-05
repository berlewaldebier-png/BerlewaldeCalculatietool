"use client";

import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";
import {
  buildBreakEvenProductLines,
  calculateBreakEvenPackSummaries,
  calculateBreakEvenResult,
  calculateStandaloneBreakEvenProducts,
  createBreakEvenConfig,
  createBreakEvenScenarioAdjustment,
  createScenarioFromBase,
  deriveScenarioTypeFromAdjustments,
  formatMoney,
  formatNumber,
  normalizeConfigList,
  type BreakEvenConfig,
  type BreakEvenScenarioAdjustment,
  type BreakEvenScenarioAdjustmentType,
  type BreakEvenScenarioType,
} from "@/components/break-even/breakEvenUtils";
import {
  buildProductLineWarnings,
  computeBreakEvenYears,
  groupBreakEvenConfigs,
  resolveActiveBaseConfig,
  withTimestamp,
} from "@/components/break-even/breakEvenDerivations";
import {
  formatAdjustmentTitle,
  formatAdjustmentValue,
  formatScenarioTypeLabel,
  parseSignedNumberInput,
} from "@/components/break-even/breakEvenFormatting";
import {
  BreakEvenAdjustmentModal,
  MetricCard,
  ScenarioSummary,
  formatDelta,
  formatMoneyOrMissing,
  formatStandaloneLiters,
  normalizePromotedBaseName,
} from "@/components/break-even/BreakEvenWorkspaceParts";
import {
  BreakEvenConfigList,
  BreakEvenConfigEditorSection,
  BreakEvenEmptyState,
  BreakEvenHeroSection,
  BreakEvenMixTableSection,
  BreakEvenStatusAlert,
} from "@/components/break-even/BreakEvenWorkspaceSections";

type GenericRecord = Record<string, unknown>;

type BreakEvenWorkspaceProps = {
  initialConfigs: unknown;
  vasteKosten: Record<string, unknown>;
  channels: GenericRecord[];
  bieren: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
};

type AdjustmentModalKind = "price" | "fixed" | "variable" | "volume" | "mix";

type AdjustmentModalState = {
  kind: AdjustmentModalKind;
  adjustmentId: string | null;
  draftType: BreakEvenScenarioAdjustmentType;
  value: number;
  valueInput: string;
  targetKey: string;
  targetLabel: string;
};

export function BreakEvenWorkspace({
  initialConfigs,
  vasteKosten,
  channels,
  bieren,
  skus,
  articles,
  kostprijsversies,
  kostprijsproductactiveringen,
  verkoopprijzen,
  basisproducten,
  samengesteldeProducten,
}: BreakEvenWorkspaceProps) {
  const years = useMemo(() => {
    return computeBreakEvenYears({ vasteKosten, kostprijsproductactiveringen });
  }, [vasteKosten, kostprijsproductactiveringen]);

  const fallbackYear = years[0] ?? new Date().getFullYear();
  const [configs, setConfigs] = useState<BreakEvenConfig[]>(() =>
    normalizeConfigList(initialConfigs, fallbackYear)
  );
  const [activeConfigId, setActiveConfigId] = useState<string>(() => {
    const normalized = normalizeConfigList(initialConfigs, fallbackYear);
    return normalized.find((config) => config.is_active_for_quotes)?.id ?? normalized[0]?.id ?? "";
  });
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [adjustmentModal, setAdjustmentModal] = useState<AdjustmentModalState | null>(null);

  const activeConfig = configs.find((config) => config.id === activeConfigId) ?? null;
  const activeBaseConfig = useMemo(() => {
    return resolveActiveBaseConfig({ activeConfig, configs });
  }, [activeConfig, configs]);

  const selectedYear = activeConfig?.jaar ?? fallbackYear;
  const productLines = useMemo(
    () =>
      buildBreakEvenProductLines({
        year: selectedYear,
        channels,
        bieren,
        skus,
        articles,
        kostprijsversies,
        kostprijsproductactiveringen,
        verkoopprijzen,
        basisproducten,
        samengesteldeProducten,
      }),
    [
      selectedYear,
      channels,
      bieren,
      skus,
      articles,
      kostprijsversies,
      kostprijsproductactiveringen,
      verkoopprijzen,
      basisproducten,
      samengesteldeProducten,
    ]
  );

  const packTypes = useMemo(
    () => calculateBreakEvenPackSummaries(productLines, activeConfig?.price_overrides ?? {}),
    [productLines, activeConfig?.price_overrides]
  );

  const result = activeConfig
    ? calculateBreakEvenResult(activeConfig, productLines, vasteKosten)
    : null;
  const standaloneResults = useMemo(
    () =>
      activeConfig
        ? calculateStandaloneBreakEvenProducts(activeConfig, productLines, vasteKosten)
        : [],
    [activeConfig, productLines, vasteKosten]
  );
  const standaloneResultByRef = useMemo(
    () => new Map(standaloneResults.map((entry) => [entry.ref, entry])),
    [standaloneResults]
  );
  const baseResult = useMemo(() => {
    if (!activeBaseConfig) return null;
    return calculateBreakEvenResult(activeBaseConfig, productLines, vasteKosten);
  }, [activeBaseConfig, productLines, vasteKosten]);
  const resultLineByKey = useMemo(
    () => new Map((result?.mixLines ?? []).map((line) => [line.key, line])),
    [result]
  );
  const productLineWarnings = useMemo(
    () => buildProductLineWarnings(productLines),
    [productLines]
  );

  const groupedConfigs = useMemo(() => {
    return groupBreakEvenConfigs(configs);
  }, [configs]);

  function updateConfig(patch: Partial<BreakEvenConfig>) {
    if (!activeConfig) return;
    setConfigs((current) =>
      current.map((config) =>
        config.id === activeConfig.id ? withTimestamp(config, patch) : config
      )
    );
  }

  function updateMix(key: string, value: string) {
    if (!activeConfig) return;
    const nextValue = Math.max(0, Number(String(value || "0").replace(",", ".")) || 0);
    const field = activeConfig.mix_mode === "packaging" ? "packaging_mix" : "product_mix";
    updateConfig({
      [field]: {
        ...activeConfig[field],
        [key]: nextValue,
      },
    } as Partial<BreakEvenConfig>);
  }

  function updatePriceOverride(ref: string, value: string) {
    if (!activeConfig) return;
    const next = { ...activeConfig.price_overrides };
    const parsed = Number(String(value || "").replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0) next[ref] = parsed;
    else delete next[ref];
    updateConfig({ price_overrides: next });
  }

  function openAdjustmentModal(
    kind: AdjustmentModalKind,
    adjustment?: BreakEvenScenarioAdjustment | null
  ) {
    const resolvedType = adjustment
      ? adjustment.type
      : kind === "price"
        ? "price_pct"
        : kind === "fixed"
          ? "fixed_cost_eur"
          : kind === "variable"
            ? "variable_cost_pct"
            : "volume_mix_pct";

    setAdjustmentModal({
      kind,
      adjustmentId: adjustment?.id ?? null,
      draftType: resolvedType,
      value: adjustment?.value ?? 0,
      valueInput: adjustment ? String(adjustment.value).replace(".", ",") : "",
      targetKey: adjustment?.target_key ?? "",
      targetLabel: adjustment?.target_label ?? "",
    });
  }

  function closeAdjustmentModal() {
    setAdjustmentModal(null);
  }

  function saveAdjustmentModal() {
    if (!activeConfig || activeConfig.kind !== "scenario" || !adjustmentModal) return;

    const needsTarget = adjustmentModal.draftType === "volume_mix_pct";
    if (needsTarget && !adjustmentModal.targetKey) {
      setStatus("Kies eerst een product of verpakking voor deze scenario-aanpassing.");
      return;
    }

    const nextAdjustment: BreakEvenScenarioAdjustment = {
      id:
        adjustmentModal.adjustmentId ??
        createBreakEvenScenarioAdjustment(adjustmentModal.draftType).id,
      type: adjustmentModal.draftType,
      value: parseSignedNumberInput(adjustmentModal.valueInput) ?? 0,
      target_key: adjustmentModal.targetKey,
      target_label: adjustmentModal.targetLabel,
    };

    const nextAdjustments = adjustmentModal.adjustmentId
      ? activeConfig.adjustments.map((adjustment) =>
          adjustment.id === adjustmentModal.adjustmentId ? nextAdjustment : adjustment
        )
      : [...activeConfig.adjustments, nextAdjustment];

    updateConfig({ adjustments: nextAdjustments });
    setStatus("");
    closeAdjustmentModal();
  }

  function addBaseConfig() {
    const config = createBreakEvenConfig(fallbackYear, "basis");
    setConfigs((current) => [config, ...current]);
    setActiveConfigId(config.id);
  }

  function addScenarioConfig() {
    const base = activeBaseConfig ?? activeConfig;
    if (!base) return;
    const scenario = createScenarioFromBase(base);
    setConfigs((current) => [scenario, ...current]);
    setActiveConfigId(scenario.id);
  }

  function addScenarioForBase(base: BreakEvenConfig) {
    const scenario = createScenarioFromBase(base);
    setConfigs((current) => [scenario, ...current]);
    setActiveConfigId(scenario.id);
  }

  function removeScenarioConfig(configId: string) {
    const scenario = configs.find((config) => config.id === configId && config.kind === "scenario");
    if (!scenario) return;
    const confirmed = window.confirm(`Verwijder "${scenario.naam}"?`);
    if (!confirmed) return;

    const fallbackId =
      configs.find((config) => config.id === scenario.parent_config_id)?.id ??
      configs.find((config) => config.kind === "basis")?.id ??
      "";

    setConfigs((current) => current.filter((config) => config.id !== configId));
    if (activeConfigId === configId) {
      setActiveConfigId(fallbackId);
    }
  }

  function removeScenarioAdjustment(adjustmentId: string) {
    if (!activeConfig || activeConfig.kind !== "scenario") return;
    updateConfig({
      adjustments: activeConfig.adjustments.filter(
        (adjustment) => adjustment.id !== adjustmentId
      ),
    });
  }

  function useForQuotes() {
    if (!activeConfig) return;
    setConfigs((current) =>
      current.map((config) => ({
        ...withTimestamp(config, {
          is_active_for_quotes:
            config.jaar === activeConfig.jaar
              ? config.id === activeConfig.id
              : config.is_active_for_quotes,
        }),
      }))
    );
  }

  function resolveAdjustmentModalKind(
    adjustment: BreakEvenScenarioAdjustment
  ): AdjustmentModalKind {
    if (adjustment.type === "price_pct") return "price";
    if (
      adjustment.type === "fixed_cost_eur" ||
      adjustment.type === "fixed_cost_pct"
    ) {
      return "fixed";
    }
    if (adjustment.type === "variable_cost_pct") return "variable";
    return "volume";
  }

  function promoteScenarioToBase() {
    if (!activeConfig || activeConfig.kind !== "scenario") return;
    const confirmed = window.confirm(
      [
        `Promoveer "${activeConfig.naam}" naar nieuwe break-even basis?`,
        "",
        "Gevolgen:",
        "- deze versie wordt een basisvariant",
        "- deze versie wordt actief voor nieuwe offertes in dit jaar",
        "- bestaande offertes houden hun eigen snapshot",
      ].join("\n")
    );
    if (!confirmed) return;

    setConfigs((current) =>
      current.map((config) => {
        if (config.id === activeConfig.id) {
          return withTimestamp(config, {
            kind: "basis" as const,
            parent_config_id: null,
            naam: normalizePromotedBaseName(config.naam, config.jaar),
            is_active_for_quotes: true,
          });
        }

        if (config.jaar === activeConfig.jaar && config.id !== activeConfig.id) {
          return withTimestamp(config, {
            is_active_for_quotes: false,
          });
        }

        return config;
      })
    );
    setStatus(`"${activeConfig.naam}" is gepromoveerd naar break-even basis.`);
  }

  async function saveConfigs() {
    setIsSaving(true);
    setStatus("");
    try {
      const response = await fetch(`${API_BASE_URL}/data/break-even-configuraties`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configs),
      });
      if (!response.ok) throw new Error(await response.text());
      setStatus("Break-even basis en scenario's opgeslagen.");
    } catch (error) {
      setStatus(`Opslaan mislukt: ${error instanceof Error ? error.message : "onbekende fout"}`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="break-even-page">
      <BreakEvenHeroSection
        hasConfigs={configs.length > 0}
        canAddScenario={Boolean(activeConfig)}
        isSaving={isSaving}
        onAddBase={addBaseConfig}
        onAddScenario={addScenarioConfig}
        onSave={() => void saveConfigs()}
      />

      <BreakEvenStatusAlert status={status} />

      {configs.length === 0 ? (
        <BreakEvenEmptyState onAddBase={addBaseConfig} />
      ) : (
        <div className="break-even-layout">
          <BreakEvenConfigList
            groupedConfigs={groupedConfigs}
            activeConfigId={activeConfigId}
            onSelectConfig={(id) => setActiveConfigId(id)}
            onAddScenarioForBase={(base) => addScenarioForBase(base)}
            onRemoveScenario={(id) => removeScenarioConfig(id)}
          />

          {activeConfig && result ? (
            <main className="break-even-main">
              <BreakEvenConfigEditorSection
                activeConfig={activeConfig}
                activeBaseConfig={activeBaseConfig}
                years={years}
                onUpdateConfig={updateConfig}
                onUseForQuotes={useForQuotes}
                onPromoteScenarioToBase={promoteScenarioToBase}
              />

              {activeConfig.kind === "scenario" ? (
                <section className="module-card">
                  <div
                    style={{
                      display: "grid",
                      gap: 16,
                      gridTemplateColumns: "minmax(0, 1.35fr) minmax(260px, 0.65fr)",
                    }}
                  >
                    <div>
                      <div className="module-card-title">Scenario-aanpassingen</div>
                      <div className="module-card-text" style={{ marginBottom: 12 }}>
                        Start vanuit de toolbar. Elke actie opent een compacte modal; na opslaan zie je
                        de wijziging direct rechts terug en verversen de break-even metrics automatisch.
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                        <button
                          className="cpq-icon-action"
                          type="button"
                          aria-label="Prijsaanpassing toevoegen"
                          title="Prijsaanpassing"
                          onClick={() => openAdjustmentModal("price")}
                        >
                          %
                        </button>
                        <button
                          className="cpq-icon-action"
                          type="button"
                          aria-label="Vaste kosten aanpassen"
                          title="Vaste kosten"
                          onClick={() => openAdjustmentModal("fixed")}
                        >
                          EUR
                        </button>
                        <button
                          className="cpq-icon-action"
                          type="button"
                          aria-label="Variabele kosten aanpassen"
                          title="Variabele kosten"
                          onClick={() => openAdjustmentModal("variable")}
                        >
                          ~
                        </button>
                        <button
                          className="cpq-icon-action"
                          type="button"
                          aria-label="Volumeverschuiving toevoegen"
                          title="Volume"
                          onClick={() => openAdjustmentModal("volume")}
                        >
                          V
                        </button>
                        <button
                          className="cpq-icon-action"
                          type="button"
                          aria-label="Mixverschuiving toevoegen"
                          title="Mix"
                          onClick={() => openAdjustmentModal("mix")}
                        >
                          M
                        </button>
                      </div>
                      <div className="cpq-alert" style={{ marginBottom: 12 }}>
                        Afgeleide focus:{" "}
                        <strong>
                          {formatScenarioTypeLabel(
                            deriveScenarioTypeFromAdjustments(activeConfig.adjustments)
                          )}
                        </strong>
                      </div>
                      <div className="module-card-text">
                        Positieve en negatieve waarden zijn toegestaan. Gebruik bijvoorbeeld `-5%`
                        voor prijsdruk of `-EUR 2.000` voor een lagere vaste kostenbasis.
                      </div>
                    </div>

                    <div className="cpq-panel">
                      <div className="cpq-panel-title">Scenario-overzicht</div>
                      <div className="cpq-panel-subtitle" style={{ marginBottom: 12 }}>
                        Basisreferentie en alle toegepaste koerswijzigingen.
                      </div>
                      <div className="cpq-stack" style={{ marginBottom: 12 }}>
                        <div className="cpq-block tone-neutral">
                          <div className="cpq-block-row">
                            <div className="cpq-block-body">
                              <div className="cpq-block-title">Gebaseerd op</div>
                              <div className="cpq-block-subtitle">
                                {activeBaseConfig?.naam ?? "Geen basis gekoppeld"}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="cpq-block tone-neutral">
                          <div className="cpq-block-row">
                            <div className="cpq-block-body">
                              <div className="cpq-block-title">Afgeleide focus</div>
                              <div className="cpq-block-subtitle">
                                {formatScenarioTypeLabel(
                                  deriveScenarioTypeFromAdjustments(activeConfig.adjustments)
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <ScenarioSummary
                        adjustments={activeConfig.adjustments}
                        mixMode={activeConfig.mix_mode}
                        onEdit={(adjustment) =>
                          openAdjustmentModal(resolveAdjustmentModalKind(adjustment), adjustment)
                        }
                        onRemove={(adjustment) => removeScenarioAdjustment(adjustment.id)}
                      />
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="module-card">
                <div className="module-card-title">Resultaat</div>
                <div className="break-even-metric-grid">
                  <MetricCard label="Break-even liters" value={`${formatNumber(result.breakEvenLiters, 0)} L`} />
                  <MetricCard label="Break-even omzet" value={formatMoney(result.breakEvenRevenue)} />
                  <MetricCard label="Vaste kosten" value={formatMoney(result.adjustedFixedCostsTotal)} />
                  <MetricCard label="Verkoopprijs / liter" value={formatMoney(result.weightedSellInPerLiter)} />
                  <MetricCard label="Variabele kosten / liter" value={formatMoney(result.weightedVariableCostPerLiter)} />
                  <MetricCard label="Contributie / liter" value={formatMoney(result.weightedContributionPerLiter)} />
                  <MetricCard label="Contributiemarge" value={`${formatNumber(result.contributionMarginPct, 1)}%`} />
                </div>
                {activeConfig.kind === "scenario" && baseResult ? (
                  <div className="break-even-metric-grid" style={{ marginTop: 16 }}>
                    <MetricCard
                      label="Delta BE omzet"
                      value={formatDelta(result.breakEvenRevenue - baseResult.breakEvenRevenue)}
                    />
                    <MetricCard
                      label="Delta BE liters"
                      value={formatDelta(result.breakEvenLiters - baseResult.breakEvenLiters, " L")}
                    />
                    <MetricCard
                      label="Delta contributie / L"
                      value={formatDelta(
                        result.weightedContributionPerLiter - baseResult.weightedContributionPerLiter
                      )}
                    />
                  </div>
                ) : null}
                {result.warnings.length > 0 ? (
                  <div className="cpq-alert cpq-alert-warn break-even-warnings">
                    {result.warnings.map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                  </div>
                ) : null}
                {productLineWarnings.length > 0 ? (
                  <div className="cpq-alert cpq-alert-warn break-even-warnings">
                    {productLineWarnings.slice(0, 6).map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                    {productLineWarnings.length > 6 ? (
                      <div>En nog {productLineWarnings.length - 6} productwaarschuwing(en).</div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="module-card">
                <div className="module-card-text">
                  Solo break-even liters en omzet staan hieronder direct in de mix-tabel per product.
                </div>
              </section>

              <BreakEvenMixTableSection
                activeConfig={activeConfig}
                packTypes={packTypes}
                productLines={productLines}
                resultLineByKey={resultLineByKey}
                standaloneResultByRef={standaloneResultByRef}
                onMixChange={updateMix}
                onPriceOverrideChange={updatePriceOverride}
              />
            </main>
          ) : null}
        </div>
      )}

      {activeConfig && activeConfig.kind === "scenario" && adjustmentModal ? (
        <BreakEvenAdjustmentModal
          modal={adjustmentModal}
          mixMode={activeConfig.mix_mode}
          productOptions={productLines.map((line) => ({
            key: line.ref,
            label: line.label,
          }))}
          packagingOptions={packTypes.map((pack) => ({
            key: pack.key,
            label: pack.label,
          }))}
          onChange={setAdjustmentModal}
          onClose={closeAdjustmentModal}
          onSave={saveAdjustmentModal}
        />
      ) : null}
    </div>
  );
}

