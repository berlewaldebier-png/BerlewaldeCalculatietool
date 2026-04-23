"use client";

import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";
import {
  buildBreakEvenProductLines,
  calculateBreakEvenPackSummaries,
  calculateBreakEvenResult,
  createBreakEvenConfig,
  formatMoney,
  formatNumber,
  normalizeConfigList,
  type BreakEvenConfig,
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
  const resultLineByKey = useMemo(
    () => new Map((result?.mixLines ?? []).map((line) => [line.key, line])),
    [result]
  );

  function updateConfig(patch: Partial<BreakEvenConfig>) {
    if (!activeConfig) return;
    setConfigs((current) =>
      current.map((config) =>
        config.id === activeConfig.id
          ? { ...config, ...patch, updated_at: new Date().toISOString() }
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
    if (Number.isFinite(parsed) && parsed > 0) {
      next[ref] = parsed;
    } else {
      delete next[ref];
    }
    updateConfig({ price_overrides: next });
  }

  function addConfig() {
    const config = createBreakEvenConfig(fallbackYear);
    setConfigs((current) => [config, ...current]);
    setActiveConfigId(config.id);
  }

  function useForQuotes() {
    if (!activeConfig) return;
    setConfigs((current) =>
      current.map((config) => ({
        ...config,
        is_active_for_quotes: config.jaar === activeConfig.jaar ? config.id === activeConfig.id : config.is_active_for_quotes,
        updated_at: new Date().toISOString(),
      }))
    );
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
      setStatus("Break-even configuraties opgeslagen.");
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
          <div className="module-card-title">Break-even configuraties</div>
          <div className="module-card-text">
            Handmatige mixscenario&apos;s op basis van liters. De actieve versie wordt later gebruikt
            door conceptoffertes en nieuwe offertes.
          </div>
        </div>
        <div className="break-even-actions">
          <button className="cpq-button cpq-button-secondary" type="button" onClick={addConfig}>
            Nieuwe configuratie
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
            <strong>Nog geen break-even configuraties</strong>
            Maak een eerste configuratie om productmix, prijs en vaste kosten te simuleren.
          </div>
        </section>
      ) : (
        <div className="break-even-layout">
          <aside className="module-card break-even-config-list">
            <div className="module-card-title">Configuraties</div>
            {configs.map((config) => (
              <button
                key={config.id}
                type="button"
                className={`break-even-config-button${config.id === activeConfigId ? " active" : ""}`}
                onClick={() => setActiveConfigId(config.id)}
              >
                <span>{config.naam}</span>
                <small>
                  {config.jaar}
                  {config.is_active_for_quotes ? " - actief voor offertes" : ""}
                </small>
              </button>
            ))}
          </aside>

          {activeConfig && result ? (
            <main className="break-even-main">
              <section className="module-card">
                <div className="module-card-header break-even-header">
                  <div>
                    <div className="module-card-title">Scenario-instellingen</div>
                    <div className="module-card-text">
                      Productmix is leidend als mixmodus op product staat. Verpakkingstype is bedoeld voor snelle scenario&apos;s.
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
                        updateConfig({ mix_mode: event.target.value === "packaging" ? "packaging" : "product" })
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
                      onChange={(event) => updateConfig({ fixed_cost_adjustment: Number(event.target.value) || 0 })}
                    />
                  </label>
                </div>
              </section>

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
                {result.warnings.length > 0 ? (
                  <div className="cpq-alert cpq-alert-warn break-even-warnings">
                    {result.warnings.map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="module-card">
                <div className="module-card-title">
                  {activeConfig.mix_mode === "packaging" ? "Mix per verpakkingstype" : "Mix per product"}
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
                      {(activeConfig.mix_mode === "packaging" ? packTypes.map((pack) => pack.key) : productLines.map((line) => line.ref)).map((key) => {
                        const line = productLines.find((candidate) => candidate.ref === key);
                        const packSummary = packTypes.find((pack) => pack.key === key);
                        const resultLine = resultLineByKey.get(key);
                        const displayLabel = activeConfig.mix_mode === "packaging" ? packSummary?.label ?? key : line?.label ?? key;
                        const mixValue =
                          activeConfig.mix_mode === "packaging"
                            ? activeConfig.packaging_mix[key] ?? 0
                            : activeConfig.product_mix[key] ?? 0;
                        const sellInPerLiter = resultLine?.sellInPerLiter ?? line?.sellInPerLiter ?? packSummary?.sellInPerLiter ?? 0;
                        const variableCostPerLiter =
                          resultLine?.variableCostPerLiter ?? line?.variableCostPerLiter ?? packSummary?.variableCostPerLiter ?? 0;
                        const contributionPerLiter =
                          resultLine?.contributionPerLiter ?? line?.contributionPerLiter ?? packSummary?.contributionPerLiter ?? 0;
                        return (
                          <tr key={key}>
                            <td>{displayLabel}</td>
                            <td>
                              <input
                                className="dataset-input"
                                type="number"
                                min={0}
                                max={100}
                                value={mixValue}
                                onChange={(event) => updateMix(key, event.target.value)}
                              />
                            </td>
                            {activeConfig.mix_mode === "product" ? (
                              <td>
                                <input
                                  className="dataset-input"
                                  type="number"
                                  min={0}
                                  placeholder={line ? formatNumber(line.sellInEx, 2) : ""}
                                  value={activeConfig.price_overrides[key] ?? ""}
                                  onChange={(event) => updatePriceOverride(key, event.target.value)}
                                />
                              </td>
                            ) : null}
                            <td>{formatMoney(sellInPerLiter)}</td>
                            <td>{formatMoney(variableCostPerLiter)}</td>
                            <td>{formatMoney(contributionPerLiter)}</td>
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
