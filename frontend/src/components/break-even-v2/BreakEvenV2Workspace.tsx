"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { API_BASE_URL } from "@/lib/api";
import { reconcileDatasetItems } from "@/lib/datasetItems";
import {
  normalizeConfigList,
  type BreakEvenConfig,
  createBreakEvenConfig,
  createScenarioFromBase,
} from "@/components/break-even/breakEvenUtils";
import { calculateFixedCostsTotal } from "@/components/break-even/breakEvenUtils";
import { computeBreakEvenYears, resolveActiveBaseConfig } from "@/components/break-even/breakEvenDerivations";
import {
  buildRealizedBreakEvenRows,
  applyScenarioToRealizedRows,
  calculateBreakEvenV2Summary,
  formatMoney,
  formatNumber,
  buildContributionTimeline,
  estimateBreakEvenMoment,
  formatBreakEvenMoment,
  buildFixedCostBuckets,
  buildWaterfallSteps,
  applySimulator,
  type BreakEvenSimulatorInput,
  type RealizedSalesBySkuPayload,
} from "@/components/break-even-v2/breakEvenV2Utils";

type GenericRecord = Record<string, unknown>;

type Props = {
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
  initialSales?: RealizedSalesBySkuPayload | null;
  initialSalesError?: string;
  initialSalesYear?: number;
  initialSalesBasis?: "invoice" | "order";
};

const COST_COLORS = ["#2563eb", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#94a3b8", "#64748b"];

function pct(value: number, digits = 1) {
  return `${formatNumber(value, digits)}%`;
}

function euroCompact(value: number) {
  if (!Number.isFinite(value)) return formatMoney(0);
  return formatMoney(value);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function getMonthDistance(period: string | null, year: number) {
  if (!period) return null;
  const month = Number(String(period).slice(5, 7));
  if (!Number.isFinite(month) || month <= 0) return null;
  return Math.max(0, month - 1);
}

export function BreakEvenV2Workspace(props: Props) {
  const years = useMemo(() => {
    return computeBreakEvenYears({
      vasteKosten: props.vasteKosten,
      kostprijsproductactiveringen: props.kostprijsproductactiveringen,
    });
  }, [props.vasteKosten, props.kostprijsproductactiveringen]);

  const fallbackYear = years[0] ?? new Date().getFullYear();
  const [configs, setConfigs] = useState<BreakEvenConfig[]>(() =>
    normalizeConfigList(props.initialConfigs, fallbackYear)
  );
  const [activeConfigId, setActiveConfigId] = useState<string>(() => {
    const normalized = normalizeConfigList(props.initialConfigs, fallbackYear);
    return normalized.find((config) => config.is_active_for_quotes)?.id ?? normalized[0]?.id ?? "";
  });
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [sales, setSales] = useState<RealizedSalesBySkuPayload | null>(props.initialSales ?? null);
  const [salesStatus, setSalesStatus] = useState(props.initialSalesError ?? "");
  const [loadedSalesKey, setLoadedSalesKey] = useState(() =>
    props.initialSales && props.initialSalesYear && props.initialSalesBasis
      ? `${props.initialSalesYear}:${props.initialSalesBasis}`
      : ""
  );
  const [selectedProductId, setSelectedProductId] = useState("");
  const [simulator, setSimulator] = useState<BreakEvenSimulatorInput>({
    pricePct: 5,
    volumePct: 10,
    fixedCostPct: -10,
  });

  const activeConfig = configs.find((config) => config.id === activeConfigId) ?? null;
  const activeBaseConfig = useMemo(() => resolveActiveBaseConfig({ activeConfig, configs }), [activeConfig, configs]);
  const selectedYear = activeConfig?.jaar ?? fallbackYear;
  const channelCode = (activeConfig?.active_channel ?? "horeca").toLowerCase();

  const sortedConfigs = useMemo(() => {
    return [...configs].sort((a, b) => {
      if (b.jaar !== a.jaar) return b.jaar - a.jaar;
      if (a.kind !== b.kind) return a.kind === "basis" ? -1 : 1;
      return a.naam.localeCompare(b.naam, "nl-NL");
    });
  }, [configs]);

  useEffect(() => {
    let cancelled = false;
    const basis = activeConfig?.basis ?? "invoice";
    const salesKey = `${selectedYear}:${basis}`;

    if (sales && loadedSalesKey === salesKey) {
      setSalesStatus("");
      return () => {
        cancelled = true;
      };
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);

    async function loadSales() {
      setSalesStatus("Gerealiseerde verkoop laden...");
      try {
        const response = await fetch(
          `${API_BASE_URL}/integrations/douano/sales-by-sku?year=${encodeURIComponent(String(selectedYear))}&basis=${encodeURIComponent(String(basis))}`,
          { cache: "no-store", signal: controller.signal }
        );
        const payload = await response.json();
        if (!response.ok) {
          const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
          throw new Error(`${response.status} ${detail}`);
        }
        const result = (payload?.result ?? payload) as RealizedSalesBySkuPayload;
        if (!cancelled) {
          setSales(result);
          setLoadedSalesKey(salesKey);
          setSalesStatus("");
        }
      } catch (error) {
        if (!cancelled) {
          setSales(null);
          const message =
            error instanceof DOMException && error.name === "AbortError"
              ? "Gerealiseerde verkoop laden duurde langer dan 60 seconden."
              : error instanceof Error
                ? error.message
                : String(error);
          setSalesStatus(message);
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void loadSales();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [selectedYear, activeConfig?.basis, sales, loadedSalesKey]);

  const realizedBase = useMemo(() => {
    if (!sales) return null;
    return buildRealizedBreakEvenRows({
      year: selectedYear,
      channelCode,
      sales,
      channels: props.channels,
      bieren: props.bieren,
      skus: props.skus,
      articles: props.articles,
      kostprijsversies: props.kostprijsversies,
      kostprijsproductactiveringen: props.kostprijsproductactiveringen,
      verkoopprijzen: props.verkoopprijzen,
      basisproducten: props.basisproducten,
      samengesteldeProducten: props.samengesteldeProducten,
    });
  }, [
    sales,
    selectedYear,
    channelCode,
    props.channels,
    props.bieren,
    props.skus,
    props.articles,
    props.kostprijsversies,
    props.kostprijsproductactiveringen,
    props.verkoopprijzen,
    props.basisproducten,
    props.samengesteldeProducten,
  ]);

  const realized = useMemo(() => {
    if (!realizedBase || !activeConfig) return realizedBase;
    if (activeConfig.kind !== "scenario") return realizedBase;
    const applied = applyScenarioToRealizedRows({
      baseRows: realizedBase.rows,
      adjustments: activeConfig.adjustments,
    });
    return {
      ...realizedBase,
      rows: applied.rows,
      totalSoldLiters: applied.totalSoldLiters,
      totalSoldUnitsNonLiter: applied.totalSoldUnitsNonLiter,
    };
  }, [realizedBase, activeConfig]);

  const fixedCostsTotal = useMemo(() => {
    return calculateFixedCostsTotal(props.vasteKosten as any, selectedYear);
  }, [props.vasteKosten, selectedYear]);

  const summary = useMemo(() => {
    if (!realized || !activeConfig) return null;
    return calculateBreakEvenV2Summary({
      year: selectedYear,
      fixedCostsTotal,
      fixedCostAdjustment: activeConfig.fixed_cost_adjustment ?? 0,
      adjustments: activeConfig.adjustments ?? [],
      rows: realized.rows,
      totalSoldLiters: realized.totalSoldLiters,
    });
  }, [realized, activeConfig, selectedYear, fixedCostsTotal]);

  const baseSummary = useMemo(() => {
    if (!realizedBase || !activeBaseConfig) return null;
    return calculateBreakEvenV2Summary({
      year: selectedYear,
      fixedCostsTotal,
      fixedCostAdjustment: activeBaseConfig.fixed_cost_adjustment ?? 0,
      adjustments: activeBaseConfig.adjustments ?? [],
      rows: realizedBase.rows,
      totalSoldLiters: realizedBase.totalSoldLiters,
    });
  }, [realizedBase, activeBaseConfig, selectedYear, fixedCostsTotal]);

  const topRows = useMemo(() => {
    return [...(realized?.rows ?? [])].sort((a, b) => b.actualContributionTotalEx - a.actualContributionTotalEx).slice(0, 10);
  }, [realized]);

  useEffect(() => {
    if (selectedProductId && topRows.some((row) => row.skuId === selectedProductId)) return;
    setSelectedProductId(topRows[0]?.skuId ?? "");
  }, [selectedProductId, topRows]);

  const selectedProduct = useMemo(() => {
    return (realized?.rows ?? []).find((row) => row.skuId === selectedProductId) ?? topRows[0] ?? null;
  }, [realized, selectedProductId, topRows]);

  const timeline = useMemo(() => {
    if (!summary || !realized) return [];
    return buildContributionTimeline({ sales, rows: realized.rows, summary });
  }, [sales, realized, summary]);

  const breakEvenPeriod = useMemo(() => estimateBreakEvenMoment(timeline), [timeline]);
  const fixedCostBuckets = useMemo(() => {
    return buildFixedCostBuckets(props.vasteKosten, selectedYear, summary?.adjustedFixedCostsTotal ?? fixedCostsTotal);
  }, [props.vasteKosten, selectedYear, summary, fixedCostsTotal]);

  const waterfallSteps = useMemo(() => buildWaterfallSteps(selectedProduct), [selectedProduct]);
  const simulatedSummary = useMemo(() => {
    if (!summary || !realized) return null;
    return applySimulator({ rows: realized.rows, summary, input: simulator });
  }, [summary, realized, simulator]);

  const achievedPct =
    summary && summary.adjustedFixedCostsTotal > 0
      ? clamp((summary.totalContributionEx / summary.adjustedFixedCostsTotal) * 100, 0, 999)
      : 0;
  const progressPct = clamp(achievedPct, 0, 100);
  const totalContribution = summary?.totalContributionEx ?? 0;
  const totalContributionPct = totalContribution > 0 ? totalContribution : 1;
  const basis = activeConfig?.basis ?? "invoice";
  const monthsToBreakEven = getMonthDistance(breakEvenPeriod, selectedYear);
  const simulatedDeltaRevenue =
    simulatedSummary && summary ? simulatedSummary.breakEvenRevenueOverall - summary.breakEvenRevenueOverall : 0;
  const simulatedDeltaSafety =
    simulatedSummary && summary ? simulatedSummary.marginOfSafetyEx - summary.marginOfSafetyEx : 0;

  function updateConfig(patch: Partial<BreakEvenConfig>) {
    if (!activeConfig) return;
    setConfigs((current) =>
      current.map((config) =>
        config.id === activeConfig.id ? { ...config, ...patch, updated_at: new Date().toISOString() } : config
      )
    );
  }

  function addBaseConfig() {
    const config = createBreakEvenConfig(fallbackYear, "basis");
    config.is_active_for_quotes = configs.length === 0;
    setConfigs((current) => [config, ...current]);
    setActiveConfigId(config.id);
  }

  function addScenarioConfig() {
    const base = activeBaseConfig ?? activeConfig;
    if (!base) {
      addBaseConfig();
      return;
    }
    const scenario = createScenarioFromBase(base);
    setConfigs((current) => [scenario, ...current]);
    setActiveConfigId(scenario.id);
  }

  async function saveConfigs() {
    setIsSaving(true);
    setStatus("");
    try {
      await reconcileDatasetItems("break-even-configuraties", configs);
      setStatus("Break-even basis en scenario's opgeslagen.");
    } catch (error) {
      setStatus(`Opslaan mislukt: ${error instanceof Error ? error.message : "onbekende fout"}`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="be3-page">
      <div className="be3-toolbar">
        <div />
        <div className="be3-toolbar-actions">
          <div className="be3-segmented" aria-label="Basis">
            <button
              type="button"
              className={basis === "invoice" ? "is-active" : ""}
              onClick={() => updateConfig({ basis: "invoice" })}
            >
              Facturen
            </button>
            <button
              type="button"
              className={basis === "order" ? "is-active" : ""}
              onClick={() => updateConfig({ basis: "order" })}
            >
              Orders
            </button>
          </div>
          <label className="be3-select-label">
            <span>Scenario</span>
            <select
              className="editor-input be3-scenario-select"
              value={activeConfigId}
              onChange={(event) => setActiveConfigId(event.target.value)}
            >
              {sortedConfigs.length === 0 ? <option value="">Geen scenario</option> : null}
              {sortedConfigs.map((config) => (
                <option key={config.id} value={config.id}>
                  {config.kind === "basis" ? "Basis" : "Scenario"} {config.jaar} - {config.naam}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="editor-button editor-button-secondary" onClick={addScenarioConfig}>
            Scenario maken
          </button>
          <button type="button" className="editor-button" onClick={() => void saveConfigs()} disabled={isSaving}>
            {isSaving ? "Opslaan..." : "Opslaan"}
          </button>
        </div>
      </div>

      {status ? <div className="cpq-alert">{status}</div> : null}
      {salesStatus ? <div className="cpq-alert cpq-alert-warn">{salesStatus}</div> : null}

      {configs.length === 0 ? (
        <section className="module-card be3-empty">
          <div>
            <div className="module-card-title">Nog geen break-even basis</div>
            <div className="module-card-text">Maak een basis voor {fallbackYear} om de analyse te starten.</div>
          </div>
          <button type="button" className="editor-button" onClick={addBaseConfig}>
            Basis maken
          </button>
        </section>
      ) : null}

      {summary ? (
        <>
          <div className="be3-grid be3-grid-top">
            <section className="module-card be3-status-card">
              <div className="module-card-title">Break-even status ({summary.year})</div>
              <div className="be3-status-content">
                <div
                  className="be3-ring"
                  style={{ background: `conic-gradient(#22c55e ${progressPct * 3.6}deg, #e5e7eb 0deg)` }}
                >
                  <div>
                    <strong>{formatNumber(achievedPct, 0)}%</strong>
                    <span>bereikt</span>
                  </div>
                </div>
                <div className="be3-status-metrics">
                  <Metric label="Totale vaste kosten" value={euroCompact(summary.adjustedFixedCostsTotal)} />
                  <Metric label="Inkoop + variabel" value={euroCompact(summary.totalInkoopEx + summary.totalPackagingEx)} />
                  <Metric label="Accijns" value={euroCompact(summary.totalExciseEx)} />
                  <Metric label="Totale contributie" value={euroCompact(summary.totalContributionEx)} tone="positive" />
                  <Metric label="Strategie omzet" value={euroCompact(summary.totalStrategyRevenueEx)} />
                  <Metric label="Prijs-/kortingseffect" value={euroCompact(summary.strategyRevenueDeltaEx)} tone={summary.strategyRevenueDeltaEx >= 0 ? "positive" : "negative"} />
                  <Metric label="Margin of safety" value={euroCompact(summary.marginOfSafetyEx)} tone={summary.marginOfSafetyEx >= 0 ? "positive" : "negative"} />
                  <div className="be3-wide-progress">
                    <span style={{ width: `${progressPct}%` }} />
                  </div>
                  <Metric label="Break-even omzet" value={euroCompact(summary.breakEvenRevenueOverall)} />
                  <Metric label="Huidige omzet Douano" value={euroCompact(summary.totalSoldRevenueNetEx)} />
                </div>
              </div>
            </section>

            <section className="module-card be3-chart-card">
              <div className="module-card-title">Break-even in tijd</div>
              <div className="be3-chart-layout">
                <div className="be3-line-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeline}>
                      <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `EUR ${Math.round(Number(value) / 1000)}k`} />
                      <Tooltip formatter={(value: number) => euroCompact(Number(value))} />
                      <Line type="monotone" dataKey="cumulativeContribution" name="Cumulatieve contributie" stroke="#2563eb" strokeWidth={3} dot={false} />
                      <Line type="monotone" dataKey="breakEvenPoint" name="Break-even punt" stroke="#0f172a" strokeDasharray="5 5" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="be3-time-summary">
                  <div>
                    <span>Geschatte break-even</span>
                    <strong>{formatBreakEvenMoment(breakEvenPeriod)}</strong>
                  </div>
                  <div className="be3-soft-success">
                    <strong>{monthsToBreakEven === null ? "-" : `${formatNumber(monthsToBreakEven, 1)} maanden`}</strong>
                    <span>om break-even te bereiken</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="be3-grid be3-grid-middle">
            <section className="module-card">
              <div className="module-card-title">
                Van verkoopprijs naar contributie
                {selectedProduct ? <span className="be3-title-sub"> voorbeeld: {selectedProduct.label}</span> : null}
              </div>
              <div className="be3-waterfall">
                <div className="be3-waterfall-bars">
                  {waterfallSteps.map((step) => {
                    const max = Math.max(...waterfallSteps.map((item) => Math.abs(item.value)), 1);
                    const width = clamp((Math.abs(step.value) / max) * 100, 7, 100);
                    return (
                      <div key={step.key} className={`be3-waterfall-row ${step.kind}`}>
                        <span>{step.label}</span>
                        <div className="be3-waterfall-track">
                          <i style={{ width: `${width}%` }} />
                        </div>
                        <strong>{euroCompact(step.value)}</strong>
                      </div>
                    );
                  })}
                </div>
              <div className="be3-side-metrics">
                <Metric label="Verkoopprijs (sell-in)" value={euroCompact(selectedProduct?.sellInEx ?? 0)} />
                  <Metric label="Realisatie p/e" value={euroCompact(selectedProduct?.soldUnits ? (selectedProduct.soldRevenueNetEx / selectedProduct.soldUnits) : 0)} />
                  <Metric label="Inkoop + variabel" value={euroCompact((selectedProduct?.inkoopUnitEx ?? 0) + (selectedProduct?.packagingUnitEx ?? 0))} />
                  <Metric label="Accijns" value={euroCompact(selectedProduct?.exciseUnitEx ?? 0)} />
                  <Metric label="Kostprijs (totaal)" value={euroCompact(selectedProduct?.costUnitEx ?? 0)} />
                  <Metric label="Contributie p/e (actueel)" value={euroCompact(selectedProduct?.actualContributionUnitEx ?? 0)} tone={(selectedProduct?.actualContributionUnitEx ?? 0) >= 0 ? "positive" : "negative"} />
                  <Metric label="Contributiemarge" value={selectedProduct?.soldRevenueNetEx ? pct((((selectedProduct.actualContributionTotalEx) / selectedProduct.soldRevenueNetEx) * 100), 1) : "0,0%"} />
                </div>
              </div>
            </section>

            <section className="module-card">
              <div className="module-card-title">Grootste vaste kosten (ABC)</div>
              <div className="be3-cost-layout">
                <div className="be3-donut">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={fixedCostBuckets} dataKey="amount" nameKey="label" innerRadius="58%" outerRadius="88%" paddingAngle={1}>
                        {fixedCostBuckets.map((entry, index) => (
                          <Cell key={entry.key} fill={COST_COLORS[index % COST_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => euroCompact(Number(value))} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div>
                    <strong>{euroCompact(summary.adjustedFixedCostsTotal)}</strong>
                    <span>totaal</span>
                  </div>
                </div>
                <div className="be3-cost-list">
                  {fixedCostBuckets.slice(0, 7).map((bucket, index) => (
                    <div key={bucket.key}>
                      <span style={{ background: COST_COLORS[index % COST_COLORS.length] }} />
                      <em>{bucket.label}</em>
                      <strong>{euroCompact(bucket.amount)}</strong>
                      <small>{pct(bucket.pct, 1)}</small>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="be3-grid be3-grid-bottom">
            <section className="module-card be3-products-card">
              <div className="module-card-title">Top 10 producten op basis van bijdrage</div>
              {sales?.unmapped?.total_net_revenue_ex ? (
                <div className="cpq-alert cpq-alert-warn" style={{ marginBottom: 12 }}>
                  Ongekoppelde omzet: {formatMoney(Number(sales.unmapped.total_net_revenue_ex) || 0)}{" "}
                  (<a className="cpq-link" href="/beheer/productkoppeling?tab=unmapped">oplossen</a> in Beheer - productkoppeling).
                </div>
              ) : null}
              <div className="data-table be3-table">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product</th>
                      <th>Verkochte liters</th>
                      <th>Verkoopprijs</th>
                      <th>Omzet p/e</th>
                      <th>Kostprijs</th>
                      <th>Contributie</th>
                      <th>Bijdrage totaal</th>
                      <th>% totaal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topRows.map((row, index) => {
                      const actualShare = (row.actualContributionTotalEx / totalContributionPct) * 100;
                      return (
                        <tr
                          key={row.skuId}
                          className={row.skuId === selectedProductId ? "is-selected" : ""}
                          onClick={() => setSelectedProductId(row.skuId)}
                        >
                          <td>{index + 1}</td>
                          <td>{row.label}</td>
                          <td>{row.kind === "liter" ? `${formatNumber(row.soldLiters, 0)} L` : "-"}</td>
                          <td>{euroCompact(row.sellInEx)}</td>
                          <td>{euroCompact(row.soldUnits > 0 ? row.soldRevenueNetEx / row.soldUnits : 0)}</td>
                          <td>{euroCompact(row.costUnitEx)}</td>
                          <td>{euroCompact(row.actualContributionUnitEx)}</td>
                          <td>{euroCompact(row.actualContributionTotalEx)}</td>
                          <td>
                            <div className="be3-share-cell">
                              <span>{pct(actualShare, 1)}</span>
                              <i><b style={{ width: `${clamp(actualShare, 0, 100)}%` }} /></i>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="module-card be3-simulator">
              <div className="module-card-title">Scenario impact simulator</div>
              <SliderControl label="Verkoopprijs gemiddeld" min={-20} max={20} value={simulator.pricePct} onChange={(value) => setSimulator((current) => ({ ...current, pricePct: value }))} />
              <SliderControl label="Volume (liters)" min={-30} max={30} value={simulator.volumePct} onChange={(value) => setSimulator((current) => ({ ...current, volumePct: value }))} />
              <SliderControl label="Vaste kosten" min={-30} max={30} value={simulator.fixedCostPct} onChange={(value) => setSimulator((current) => ({ ...current, fixedCostPct: value }))} />
              <div className="be3-sim-result">
                <Metric label="Nieuw break-even omzet" value={euroCompact(simulatedSummary?.breakEvenRevenueOverall ?? 0)} />
                <Metric label="Nieuw break-even moment" value={formatBreakEvenMoment(breakEvenPeriod)} />
                <Metric label="Nieuwe margin of safety" value={euroCompact(simulatedSummary?.marginOfSafetyEx ?? 0)} tone={(simulatedSummary?.marginOfSafetyEx ?? 0) >= 0 ? "positive" : "negative"} />
                <small>{simulatedDeltaRevenue <= 0 ? "" : "+"}{formatNumber((simulatedDeltaRevenue / Math.max(1, summary.breakEvenRevenueOverall)) * 100, 1)}% break-even omzet</small>
                <small>{simulatedDeltaSafety >= 0 ? "+" : ""}{euroCompact(simulatedDeltaSafety)} safety</small>
              </div>
              <button type="button" className="editor-button editor-button-secondary" onClick={() => setSimulator({ pricePct: 0, volumePct: 0, fixedCostPct: 0 })}>
                Reset simulatie
              </button>
            </section>
          </div>

          {summary.warnings.length > 0 ? (
            <div className="cpq-alert cpq-alert-warn">
              {summary.warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className={`be3-metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SliderControl({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="be3-slider">
      <div>
        <span>{label}</span>
        <strong>{value > 0 ? "+" : ""}{formatNumber(value, 0)}%</strong>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <small>
        {min}% <span>{max}%</span>
      </small>
    </label>
  );
}
