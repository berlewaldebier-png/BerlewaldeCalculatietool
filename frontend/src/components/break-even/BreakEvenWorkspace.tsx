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

type GenericRecord = Record<string, unknown>;

type BreakEvenWorkspaceProps = {
  initialConfigs: unknown;
  vasteKosten: Record<string, unknown>;
  channels: GenericRecord[];
  bieren: GenericRecord[];
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
  kostprijsversies,
  kostprijsproductactiveringen,
  verkoopprijzen,
  basisproducten,
  samengesteldeProducten,
}: BreakEvenWorkspaceProps) {
  const years = useMemo(() => {
    const set = new Set<number>();
    Object.keys(vasteKosten ?? {}).forEach((key) => {
      const year = Number(key);
      if (Number.isFinite(year) && year > 0) set.add(year);
    });
    kostprijsproductactiveringen.forEach((row) => {
      const year = Number((row as any).jaar ?? 0);
      if (Number.isFinite(year) && year > 0) set.add(year);
    });
    return Array.from(set).sort((a, b) => b - a);
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
    if (!activeConfig) return null;
    if (activeConfig.kind === "basis") return activeConfig;
    return configs.find((config) => config.id === activeConfig.parent_config_id) ?? null;
  }, [activeConfig, configs]);

  const selectedYear = activeConfig?.jaar ?? fallbackYear;
  const productLines = useMemo(
    () =>
      buildBreakEvenProductLines({
        year: selectedYear,
        channels,
        bieren,
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
    () =>
      productLines.flatMap((line) =>
        line.warnings.map((warning) => `${line.label}: ${warning}`)
      ),
    [productLines]
  );

  const groupedConfigs = useMemo(() => {
    const bases = configs
      .filter((config) => config.kind === "basis")
      .sort((a, b) => {
        if (b.jaar !== a.jaar) return b.jaar - a.jaar;
        return a.naam.localeCompare(b.naam);
      });

    return bases.map((base) => ({
      base,
      scenarios: configs
        .filter((config) => config.kind === "scenario" && config.parent_config_id === base.id)
        .sort((a, b) => a.naam.localeCompare(b.naam)),
    }));
  }, [configs]);

  function withTimestamp<T extends BreakEvenConfig>(config: T, patch: Partial<BreakEvenConfig>) {
    const nextConfig = {
      ...config,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    if (nextConfig.kind === "scenario") {
      return {
        ...nextConfig,
        scenario_type: deriveScenarioTypeFromAdjustments(nextConfig.adjustments),
      };
    }
    return nextConfig;
  }

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
      const response = await fetch(`${API_BASE_URL}/data/dataset/break-even-configuraties`, {
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
      <section className="module-card break-even-hero">
        <div>
          <div className="module-card-title">Break-even basis en scenario&apos;s</div>
          <div className="module-card-text">
            Leg eerst je verwachte basis voor het jaar vast. Maak daarna scenario&apos;s om koerswijzigingen
            te testen. De actieve versie van een jaar voedt conceptoffertes en nieuwe offertes.
          </div>
        </div>
        <div className="break-even-actions">
          {configs.length === 0 ? (
            <button className="cpq-button cpq-button-secondary" type="button" onClick={addBaseConfig}>
              Nieuwe basis
            </button>
          ) : null}
          <button
            className="cpq-button cpq-button-secondary"
            type="button"
            onClick={addScenarioConfig}
            disabled={!activeConfig}
          >
            Scenario maken
          </button>
          <button
            className="cpq-button cpq-button-primary"
            type="button"
            onClick={() => void saveConfigs()}
            disabled={isSaving}
          >
            {isSaving ? "Opslaan..." : "Opslaan"}
          </button>
        </div>
      </section>

      {status ? <div className="cpq-alert">{status}</div> : null}

      {configs.length === 0 ? (
        <section className="module-card">
          <div className="placeholder-block">
            <strong>Nog geen break-even basis</strong>
            Maak eerst een basis om de verwachte mix, prijs en vaste kosten voor een jaar vast te leggen.
          </div>
        </section>
      ) : (
        <div className="break-even-layout">
          <aside className="module-card break-even-config-list">
            <div className="module-card-title">Jaarbasis en scenario&apos;s</div>
            {groupedConfigs.map(({ base, scenarios }) => (
              <div key={base.id} className="break-even-config-group">
                <div className="break-even-config-base-row">
                  <button
                    type="button"
                    className={`break-even-config-button${base.id === activeConfigId ? " active" : ""}`}
                    onClick={() => setActiveConfigId(base.id)}
                  >
                    <span>{base.naam}</span>
                    <small>
                      {base.jaar}
                      {base.is_active_for_quotes ? " - actief voor offertes" : " - basis"}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="cpq-icon-action break-even-config-add"
                    aria-label={`Voeg scenario toe aan ${base.naam}`}
                    title="Scenario toevoegen"
                    onClick={() => addScenarioForBase(base)}
                  >
                    +
                  </button>
                </div>
                <div className="break-even-scenario-list">
                  {scenarios.map((scenario, index) => (
                    <div key={scenario.id} className="break-even-config-base-row">
                      <button
                        type="button"
                        className={`break-even-config-button break-even-config-button-child${scenario.id === activeConfigId ? " active" : ""}`}
                        onClick={() => setActiveConfigId(scenario.id)}
                      >
                        <span>{`Scenario ${String.fromCharCode(65 + index)}`}</span>
                        <small>
                          {formatScenarioTypeLabel(
                            deriveScenarioTypeFromAdjustments(scenario.adjustments)
                          )}
                          {scenario.is_active_for_quotes ? " - actief voor offertes" : ""}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="cpq-icon-action break-even-config-add"
                        aria-label={`Verwijder ${scenario.naam}`}
                        title="Scenario verwijderen"
                        onClick={() => removeScenarioConfig(scenario.id)}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </aside>

          {activeConfig && result ? (
            <main className="break-even-main">
              <section className="module-card">
                <div className="module-card-header break-even-header">
                  <div>
                    <div className="module-card-title">
                      {activeConfig.kind === "basis" ? "Basis-instellingen" : "Scenario-instellingen"}
                    </div>
                    <div className="module-card-text">
                      {activeConfig.kind === "basis"
                        ? "Dit is je verwachte break-even basis voor het gekozen jaar."
                        : `Dit scenario vergelijkt een koersvariant met ${activeBaseConfig?.naam ?? "de basis"}.`}
                    </div>
                  </div>
                  {activeConfig.kind === "basis" ? (
                    <button className="cpq-button cpq-button-secondary" type="button" onClick={useForQuotes}>
                      Gebruik voor offertes
                    </button>
                  ) : (
                    <button
                      className="cpq-button cpq-button-primary"
                      type="button"
                      onClick={promoteScenarioToBase}
                    >
                      Promoveer naar basis
                    </button>
                  )}
                </div>
                <div className="cpq-form-grid">
                  <label className="cpq-field">
                    <span className="cpq-label">Naam</span>
                    <input
                      className="cpq-input"
                      value={activeConfig.naam}
                      onChange={(event) => updateConfig({ naam: event.target.value })}
                    />
                  </label>
                  <label className="cpq-field">
                    <span className="cpq-label">Jaar</span>
                    <select
                      className="cpq-select"
                      value={activeConfig.jaar}
                      onChange={(event) => updateConfig({ jaar: Number(event.target.value) })}
                    >
                      {years.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="cpq-field">
                    <span className="cpq-label">Mixmodus</span>
                    <select
                      className="cpq-select"
                      value={activeConfig.mix_mode}
                      onChange={(event) =>
                        updateConfig({
                          mix_mode: event.target.value === "packaging" ? "packaging" : "product",
                        })
                      }
                    >
                      <option value="product">Productniveau</option>
                      <option value="packaging">Verpakkingstype</option>
                    </select>
                  </label>
                  {activeConfig.kind === "basis" ? (
                    <label className="cpq-field">
                      <span className="cpq-label">Vaste kosten correctie</span>
                      <input
                        className="cpq-input"
                        type="number"
                        value={activeConfig.fixed_cost_adjustment}
                        onChange={(event) =>
                          updateConfig({ fixed_cost_adjustment: Number(event.target.value) || 0 })
                        }
                      />
                    </label>
                  ) : null}
                </div>
                {activeConfig.kind === "scenario" && activeBaseConfig ? (
                  <div className="cpq-alert">
                    Scenario gebaseerd op <strong>{activeBaseConfig.naam}</strong>. Als deze koers klopt,
                    promoveer je hem naar een nieuwe basis voor offertes.
                  </div>
                ) : null}
              </section>

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

              <section className="module-card">
                <div className="module-card-title">
                  {activeConfig.mix_mode === "packaging"
                    ? "Verwachte mix per verpakkingstype"
                    : "Verwachte mix per product"}
                </div>
                <div className="module-card-text" style={{ marginBottom: 12 }}>
                  Deze mix vormt {activeConfig.kind === "basis" ? "de basisverwachting" : "de scenario-variant"} voor {activeConfig.jaar}.
                </div>
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{activeConfig.mix_mode === "packaging" ? "Verpakking" : "Product"}</th>
                        <th>Mix %</th>
                        {activeConfig.mix_mode === "product" ? <th>Prijs override</th> : null}
                        <th>Sell-in / L</th>
                        <th>Variabel / L</th>
                        <th>Contributie / L</th>
                        {activeConfig.mix_mode === "product" ? <th>Solo BE liters</th> : null}
                        {activeConfig.mix_mode === "product" ? <th>Solo BE omzet</th> : null}
                        <th>Gewogen bijdrage / L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeConfig.mix_mode === "packaging"
                        ? packTypes.map((pack) => pack.key)
                        : productLines.map((line) => line.ref)
                      ).map((key) => {
                        const line = productLines.find((candidate) => candidate.ref === key);
                        const packSummary = packTypes.find((pack) => pack.key === key);
                        const resultLine = resultLineByKey.get(key);
                        const displayLabel =
                          activeConfig.mix_mode === "packaging"
                            ? packSummary?.label ?? key
                            : line?.label ?? key;
                        const mixValue =
                          activeConfig.mix_mode === "packaging"
                            ? activeConfig.packaging_mix[key] ?? 0
                            : activeConfig.product_mix[key] ?? 0;
                        const sellInPerLiter =
                          resultLine?.sellInPerLiter ??
                          line?.sellInPerLiter ??
                          packSummary?.sellInPerLiter ??
                          0;
                        const variableCostPerLiter =
                          resultLine?.variableCostPerLiter ??
                          line?.variableCostPerLiter ??
                          packSummary?.variableCostPerLiter ??
                          0;
                        const contributionPerLiter =
                          resultLine?.contributionPerLiter ??
                          line?.contributionPerLiter ??
                          packSummary?.contributionPerLiter ??
                          0;
                        const standalone = line ? standaloneResultByRef.get(line.ref) : null;

                        return (
                          <tr key={key}>
                            <td>{displayLabel}</td>
                            <td>
                              {activeConfig.kind === "basis" ? (
                                <input
                                  className="dataset-input"
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={mixValue}
                                  onChange={(event) => updateMix(key, event.target.value)}
                                />
                              ) : (
                                <span>{formatNumber(resultLine?.mixPct ?? mixValue, 1)}%</span>
                              )}
                            </td>
                            {activeConfig.mix_mode === "product" ? (
                              <td>
                                {activeConfig.kind === "basis" ? (
                                  <input
                                    className="dataset-input"
                                    type="number"
                                    min={0}
                                    placeholder={line ? formatNumber(line.sellInEx, 2) : ""}
                                    value={activeConfig.price_overrides[key] ?? ""}
                                    onChange={(event) => updatePriceOverride(key, event.target.value)}
                                  />
                                ) : (
                                  <span>
                                    {activeConfig.price_overrides[key]
                                      ? formatMoney(activeConfig.price_overrides[key])
                                      : "Basisprijs"}
                                  </span>
                                )}
                              </td>
                            ) : null}
                            <td>{formatMoneyOrMissing(sellInPerLiter)}</td>
                            <td>{formatMoneyOrMissing(variableCostPerLiter)}</td>
                            <td>{formatMoneyOrMissing(contributionPerLiter)}</td>
                            {activeConfig.mix_mode === "product" ? (
                              <td>{formatStandaloneLiters(standalone?.breakEvenLiters ?? 0)}</td>
                            ) : null}
                            {activeConfig.mix_mode === "product" ? (
                              <td>{formatMoneyOrMissing(standalone?.breakEvenRevenue ?? 0)}</td>
                            ) : null}
                            <td>{formatMoney(resultLine?.weightedContributionPerLiter ?? 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="cpq-live-summary-metric">
      <div className="cpq-live-summary-metric-label">{label}</div>
      <div className="cpq-live-summary-metric-value">{value}</div>
    </div>
  );
}

function formatMoneyOrMissing(value: number) {
  return value > 0 ? formatMoney(value) : "Niet bekend";
}

function formatStandaloneLiters(value: number) {
  return value > 0 ? `${formatNumber(value, 0)} L` : "Niet bekend";
}

function formatDelta(value: number, suffix = "") {
  const prefix = value > 0 ? "+" : "";
  if (!Number.isFinite(value)) return "-";
  if (suffix) return `${prefix}${formatNumber(value, 0)}${suffix}`;
  return `${prefix}${formatMoney(value)}`;
}

function normalizePromotedBaseName(name: string, year: number) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return `Break-even basis ${year}`;
  return trimmed.replace(/\s+scenario$/i, "").trim() || `Break-even basis ${year}`;
}

function ScenarioSummary({
  adjustments,
  mixMode,
  onEdit,
  onRemove,
}: {
  adjustments: BreakEvenScenarioAdjustment[];
  mixMode: "product" | "packaging";
  onEdit: (adjustment: BreakEvenScenarioAdjustment) => void;
  onRemove: (adjustment: BreakEvenScenarioAdjustment) => void;
}) {
  if (adjustments.length === 0) {
    return <div className="cpq-empty">Nog geen wijzigingen toegepast.</div>;
  }

  return (
    <div className="cpq-stack">
      {adjustments.map((adjustment) => (
        <div key={adjustment.id} className="cpq-block tone-neutral">
          <div className="cpq-block-row">
            <div className="cpq-block-body">
              <div className="cpq-block-title">{formatAdjustmentTitle(adjustment, mixMode)}</div>
              <div className="cpq-block-subtitle">{formatAdjustmentValue(adjustment)}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="cpq-icon-action"
                onClick={() => onEdit(adjustment)}
                aria-label="Bewerk wijziging"
                title="Bewerken"
              >
                ✎
              </button>
              <button
                type="button"
                className="cpq-icon-action"
                onClick={() => onRemove(adjustment)}
                aria-label="Verwijder wijziging"
                title="Verwijderen"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BreakEvenAdjustmentModal({
  modal,
  mixMode,
  productOptions,
  packagingOptions,
  onChange,
  onClose,
  onSave,
}: {
  modal: AdjustmentModalState;
  mixMode: "product" | "packaging";
  productOptions: Array<{ key: string; label: string }>;
  packagingOptions: Array<{ key: string; label: string }>;
  onChange: (next: AdjustmentModalState | null) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const targetOptions = mixMode === "packaging" ? packagingOptions : productOptions;
  const needsTarget = modal.draftType === "volume_mix_pct";
  const title =
    modal.kind === "price"
      ? "Prijsaanpassing"
      : modal.kind === "fixed"
        ? "Vaste kosten aanpassen"
        : modal.kind === "variable"
          ? "Variabele kosten aanpassen"
          : modal.kind === "mix"
            ? "Mixverschuiving"
            : "Volumeverschuiving";
  const subtitle =
    modal.kind === "price"
      ? "Pas de verkoopprijs procentueel aan. Negatieve waarden zijn toegestaan."
      : modal.kind === "fixed"
        ? "Kies een euro- of procentcorrectie op de vaste kosten."
        : modal.kind === "variable"
          ? "Pas de variabele kosten procentueel aan. Negatieve waarden zijn toegestaan."
          : modal.kind === "mix"
            ? "Verplaats de mix richting een specifiek product of verpakking."
            : "Laat een product of verpakking harder of zachter meegroeien binnen de mix.";

  return (
    <div className="cpq-modal-backdrop" role="dialog" aria-modal="true">
      <div className="cpq-modal">
        <div className="cpq-modal-header">
          <div>
            <h3 className="cpq-modal-title">{title}</h3>
            <div className="cpq-modal-subtitle">{subtitle}</div>
          </div>
          <button
            type="button"
            className="cpq-icon-action"
            onClick={onClose}
            aria-label="Sluiten"
            title="Sluiten"
          >
            ×
          </button>
        </div>
        <div className="cpq-modal-body">
          {modal.kind === "fixed" ? (
            <label className="cpq-field">
              <span className="cpq-label">Eenheid</span>
              <select
                className="cpq-select"
                value={modal.draftType}
                onChange={(event) =>
                  onChange({
                    ...modal,
                    draftType: event.target.value as BreakEvenScenarioAdjustmentType,
                  })
                }
              >
                <option value="fixed_cost_eur">EUR</option>
                <option value="fixed_cost_pct">%</option>
              </select>
            </label>
          ) : null}

          {needsTarget ? (
            <label className="cpq-field">
              <span className="cpq-label">
                {mixMode === "packaging" ? "Verpakking" : "Product"}
              </span>
              <select
                className="cpq-select"
                value={modal.targetKey}
                onChange={(event) => {
                  const option = targetOptions.find((item) => item.key === event.target.value);
                  onChange({
                    ...modal,
                    targetKey: event.target.value,
                    targetLabel: option?.label ?? "",
                  });
                }}
              >
                <option value="">Selecteer...</option>
                {targetOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="cpq-field">
            <span className="cpq-label">
              Waarde {modal.draftType === "fixed_cost_eur" ? "(EUR)" : "(%)"}
            </span>
            <input
              className="cpq-input"
              type="text"
              inputMode="decimal"
              value={modal.valueInput}
              onChange={(event) => {
                const nextInput = event.target.value;
                const parsedValue = parseSignedNumberInput(nextInput);
                onChange({
                  ...modal,
                  valueInput: nextInput,
                  value: parsedValue ?? modal.value,
                });
              }}
            />
          </label>

          <div className="cpq-alert">
            Voorbeelden: <strong>-5</strong> verlaagt, <strong>+5</strong> verhoogt.
          </div>
        </div>
        <div className="cpq-modal-footer">
          <button type="button" className="cpq-button cpq-button-secondary" onClick={onClose}>
            Annuleren
          </button>
          <button type="button" className="cpq-button cpq-button-primary" onClick={onSave}>
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}

function formatAdjustmentTitle(
  adjustment: BreakEvenScenarioAdjustment,
  mixMode: "product" | "packaging"
) {
  if (adjustment.type === "price_pct") return "Verkoopprijs";
  if (adjustment.type === "fixed_cost_eur") return "Vaste kosten (EUR)";
  if (adjustment.type === "fixed_cost_pct") return "Vaste kosten (%)";
  if (adjustment.type === "variable_cost_pct") return "Variabele kosten (%)";
  return `${mixMode === "packaging" ? "Mix / volume verpakking" : "Mix / volume product"}${
    adjustment.target_label ? `: ${adjustment.target_label}` : ""
  }`;
}

function formatAdjustmentValue(adjustment: BreakEvenScenarioAdjustment) {
  if (adjustment.type === "fixed_cost_eur") {
    return `${adjustment.value >= 0 ? "+" : ""}${formatMoney(adjustment.value)}`;
  }
  return `${adjustment.value >= 0 ? "+" : ""}${formatNumber(adjustment.value, 1)}%`;
}

function formatScenarioTypeLabel(type: BreakEvenScenarioType | null) {
  if (type === "pricing") return "Scenario prijs";
  if (type === "costs") return "Scenario kosten";
  if (type === "volume") return "Scenario volume";
  if (type === "combined") return "Scenario combinatie";
  return "Scenario vrij";
}

function parseSignedNumberInput(value: string) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized || normalized === "-" || normalized === "+" || normalized === "." || normalized === "-.") {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
