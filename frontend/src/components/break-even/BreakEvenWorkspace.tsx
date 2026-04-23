"use client";

import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";
import {
  buildBreakEvenProductLines,
  calculateBreakEvenPackSummaries,
  calculateBreakEvenResult,
  createBreakEvenConfig,
  createBreakEvenScenarioAdjustment,
  createScenarioFromBase,
  formatMoney,
  formatNumber,
  normalizeConfigList,
  type BreakEvenScenarioAdjustment,
  type BreakEvenScenarioAdjustmentType,
  type BreakEvenConfig,
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
    return {
      ...config,
      ...patch,
      updated_at: new Date().toISOString(),
    };
  }

  function updateConfig(patch: Partial<BreakEvenConfig>) {
    if (!activeConfig) return;
    setConfigs((current) =>
      current.map((config) =>
        config.id === activeConfig.id
          ? withTimestamp(config, patch)
          : config
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

  function addScenarioAdjustment(type: BreakEvenScenarioAdjustmentType = "price_pct") {
    if (!activeConfig || activeConfig.kind !== "scenario") return;
    updateConfig({
      adjustments: [...activeConfig.adjustments, createBreakEvenScenarioAdjustment(type)],
    });
  }

  function updateScenarioAdjustment(
    adjustmentId: string,
    patch: Partial<BreakEvenScenarioAdjustment>
  ) {
    if (!activeConfig || activeConfig.kind !== "scenario") return;
    updateConfig({
      adjustments: activeConfig.adjustments.map((adjustment) =>
        adjustment.id === adjustmentId ? { ...adjustment, ...patch } : adjustment
      ),
    });
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
          <button className="cpq-button cpq-button-secondary" type="button" onClick={addBaseConfig}>
            Nieuwe basis
          </button>
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
                {scenarios.map((scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    className={`break-even-config-button break-even-config-button-child${scenario.id === activeConfigId ? " active" : ""}`}
                    onClick={() => setActiveConfigId(scenario.id)}
                  >
                    <span>{scenario.naam}</span>
                    <small>
                      {formatScenarioTypeLabel(scenario.scenario_type)}
                      {scenario.is_active_for_quotes ? " - actief voor offertes" : ""}
                    </small>
                  </button>
                ))}
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
                  <button className="cpq-button cpq-button-secondary" type="button" onClick={useForQuotes}>
                    Gebruik voor offertes
                  </button>
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
                  {activeConfig.kind === "scenario" ? (
                    <label className="cpq-field">
                      <span className="cpq-label">Scenariofocus</span>
                      <select
                        className="cpq-select"
                        value={activeConfig.scenario_type ?? "custom"}
                        onChange={(event) =>
                          updateConfig({
                            scenario_type: event.target.value as BreakEvenScenarioType,
                          })
                        }
                      >
                        <option value="pricing">Prijs</option>
                        <option value="costs">Kosten</option>
                        <option value="volume">Volume</option>
                        <option value="combined">Combinatie</option>
                        <option value="custom">Vrij</option>
                      </select>
                    </label>
                  ) : null}
                </div>
                {activeConfig.kind === "scenario" && activeBaseConfig ? (
                  <div className="cpq-alert">
                    Scenario gebaseerd op <strong>{activeBaseConfig.naam}</strong>. Als deze koers de nieuwe werkelijkheid wordt,
                    kun je dit scenario activeren voor offertes.
                  </div>
                ) : null}
                {activeConfig.kind === "scenario" ? (
                  <div className="cpq-actions" style={{ justifyContent: "flex-start", marginTop: 12 }}>
                    <button
                      className="cpq-button cpq-button-primary"
                      type="button"
                      onClick={promoteScenarioToBase}
                    >
                      Promoveer naar basis
                    </button>
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
                        Combineer prijs-, kosten- en volume-aanpassingen. De effectieve mix hieronder
                        wordt automatisch afgeleid uit de basis plus deze wijzigingen.
                      </div>
                      <div className="cpq-alert" style={{ marginBottom: 12 }}>
                        Focus: <strong>{formatScenarioTypeLabel(activeConfig.scenario_type)}</strong>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                        <button
                          className="cpq-button cpq-button-secondary"
                          type="button"
                          onClick={() => addScenarioAdjustment("price_pct")}
                        >
                          + Prijs %
                        </button>
                        <button
                          className="cpq-button cpq-button-secondary"
                          type="button"
                          onClick={() => addScenarioAdjustment("fixed_cost_eur")}
                        >
                          + Vaste kosten EUR
                        </button>
                        <button
                          className="cpq-button cpq-button-secondary"
                          type="button"
                          onClick={() => addScenarioAdjustment("fixed_cost_pct")}
                        >
                          + Vaste kosten %
                        </button>
                        <button
                          className="cpq-button cpq-button-secondary"
                          type="button"
                          onClick={() => addScenarioAdjustment("variable_cost_pct")}
                        >
                          + Variabele kosten %
                        </button>
                        <button
                          className="cpq-button cpq-button-secondary"
                          type="button"
                          onClick={() => addScenarioAdjustment("volume_mix_pct")}
                        >
                          + Volume
                        </button>
                      </div>
                      <div className="cpq-stack">
                        {activeConfig.adjustments.length === 0 ? (
                          <div className="cpq-empty">
                            Nog geen scenario-aanpassingen toegevoegd.
                          </div>
                        ) : (
                          activeConfig.adjustments.map((adjustment) => (
                            <ScenarioAdjustmentEditor
                              key={adjustment.id}
                              adjustment={adjustment}
                              mixMode={activeConfig.mix_mode}
                              productOptions={productLines.map((line) => ({
                                key: line.ref,
                                label: line.label,
                              }))}
                              packagingOptions={packTypes.map((pack) => ({
                                key: pack.key,
                                label: pack.label,
                              }))}
                              onChange={(patch) =>
                                updateScenarioAdjustment(adjustment.id, patch)
                              }
                              onRemove={() => removeScenarioAdjustment(adjustment.id)}
                            />
                          ))
                        )}
                      </div>
                    </div>

                    <div className="cpq-panel">
                      <div className="cpq-panel-title">Scenario-overzicht</div>
                      <div className="cpq-panel-subtitle" style={{ marginBottom: 12 }}>
                        Basisreferentie en toegepaste koerswijzigingen.
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
                              <div className="cpq-block-title">Type</div>
                              <div className="cpq-block-subtitle">
                                {formatScenarioTypeLabel(activeConfig.scenario_type)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <ScenarioSummary
                        adjustments={activeConfig.adjustments}
                        mixMode={activeConfig.mix_mode}
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

function ScenarioAdjustmentEditor({
  adjustment,
  mixMode,
  productOptions,
  packagingOptions,
  onChange,
  onRemove,
}: {
  adjustment: BreakEvenScenarioAdjustment;
  mixMode: "product" | "packaging";
  productOptions: Array<{ key: string; label: string }>;
  packagingOptions: Array<{ key: string; label: string }>;
  onChange: (patch: Partial<BreakEvenScenarioAdjustment>) => void;
  onRemove: () => void;
}) {
  const targetOptions = mixMode === "packaging" ? packagingOptions : productOptions;

  return (
    <div className="cpq-card" style={{ padding: 12 }}>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1.1fr 0.9fr auto" }}>
        <label className="cpq-field">
          <span className="cpq-label">Type</span>
          <select
            className="cpq-select"
            value={adjustment.type}
            onChange={(event) =>
              onChange({
                type: event.target.value as BreakEvenScenarioAdjustmentType,
                target_key: "",
                target_label: "",
              })
            }
          >
            <option value="price_pct">Verkoopprijs %</option>
            <option value="fixed_cost_eur">Vaste kosten EUR</option>
            <option value="fixed_cost_pct">Vaste kosten %</option>
            <option value="variable_cost_pct">Variabele kosten %</option>
            <option value="volume_mix_pct">
              {mixMode === "packaging" ? "Volume verpakking %" : "Volume product %"}
            </option>
          </select>
        </label>
        <label className="cpq-field">
          <span className="cpq-label">Waarde</span>
          <input
            className="cpq-input"
            type="number"
            value={adjustment.value}
            onChange={(event) =>
              onChange({ value: Number(event.target.value || 0) })
            }
          />
        </label>
        <button
          type="button"
          className="cpq-icon-action"
          onClick={onRemove}
          aria-label="Verwijder aanpassing"
          title="Verwijderen"
          style={{ alignSelf: "end" }}
        >
          ×
        </button>
      </div>

      {adjustment.type === "volume_mix_pct" ? (
        <label className="cpq-field">
          <span className="cpq-label">
            {mixMode === "packaging" ? "Verpakking" : "Product"}
          </span>
          <select
            className="cpq-select"
            value={adjustment.target_key ?? ""}
            onChange={(event) => {
              const option = targetOptions.find((item) => item.key === event.target.value);
              onChange({
                target_key: event.target.value,
                target_label: option?.label ?? "",
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
    </div>
  );
}

function ScenarioSummary({
  adjustments,
  mixMode,
}: {
  adjustments: BreakEvenScenarioAdjustment[];
  mixMode: "product" | "packaging";
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
          </div>
        </div>
      ))}
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
  return `${mixMode === "packaging" ? "Volume verpakking" : "Volume product"}${
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
