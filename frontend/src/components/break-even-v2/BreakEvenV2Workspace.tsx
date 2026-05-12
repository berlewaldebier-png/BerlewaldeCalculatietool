"use client";

import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";
import {
  normalizeConfigList,
  type BreakEvenConfig,
  createBreakEvenConfig,
  createScenarioFromBase,
  type BreakEvenScenarioAdjustment,
  type BreakEvenScenarioAdjustmentType,
} from "@/components/break-even/breakEvenUtils";
import { calculateFixedCostsTotal } from "@/components/break-even/breakEvenUtils";
import { computeBreakEvenYears, groupBreakEvenConfigs, resolveActiveBaseConfig } from "@/components/break-even/breakEvenDerivations";
import { BreakEvenConfigList, BreakEvenHeroSection, BreakEvenStatusAlert } from "@/components/break-even/BreakEvenWorkspaceSections";

import {
  buildRealizedBreakEvenRows,
  applyScenarioToRealizedRows,
  calculateBreakEvenV2Summary,
  formatMoney,
  formatNumber,
  type RealizedSalesBySkuPayload,
} from "@/components/break-even-v2/breakEvenV2Utils";
import { MetricCard } from "@/components/break-even/BreakEvenWorkspaceParts";
import { BreakEvenAdjustmentModal, ScenarioSummary, formatDelta, normalizePromotedBaseName } from "@/components/break-even/BreakEvenWorkspaceParts";
import { formatScenarioTypeLabel, parseSignedNumberInput } from "@/components/break-even/breakEvenFormatting";
import { deriveScenarioTypeFromAdjustments } from "@/components/break-even/breakEvenUtils";

type GenericRecord = Record<string, unknown>;

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
};

export function BreakEvenV2Workspace(props: Props) {
  const years = useMemo(() => {
    return computeBreakEvenYears({ vasteKosten: props.vasteKosten, kostprijsproductactiveringen: props.kostprijsproductactiveringen });
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
  const [adjustmentModal, setAdjustmentModal] = useState<AdjustmentModalState | null>(null);

  const activeConfig = configs.find((config) => config.id === activeConfigId) ?? null;
  const activeBaseConfig = useMemo(() => {
    return resolveActiveBaseConfig({ activeConfig, configs });
  }, [activeConfig, configs]);

  const selectedYear = activeConfig?.jaar ?? fallbackYear;
  const channelCode = (activeConfig?.active_channel ?? "horeca").toLowerCase();
  const channelOptions = useMemo(() => {
    const fallback = [{ code: "horeca", label: "Horeca" }];
    const rows = Array.isArray(props.channels) ? props.channels : [];
    const out = rows
      .map((row) => ({
        code: String((row as any).code ?? (row as any).id ?? "").trim().toLowerCase(),
        label: String((row as any).naam ?? (row as any).name ?? (row as any).code ?? "").trim(),
        active: Boolean((row as any).actief ?? (row as any).active ?? true),
      }))
      .filter((row) => row.code);
    const filtered = out.filter((row) => row.active);
    return (filtered.length > 0 ? filtered : out.length > 0 ? out : fallback).sort((a, b) =>
      a.label.localeCompare(b.label, "nl-NL")
    );
  }, [props.channels]);

  const [sales, setSales] = useState<RealizedSalesBySkuPayload | null>(null);
  const [salesStatus, setSalesStatus] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function loadSales() {
      setSalesStatus("Gerealiseerde verkoop laden…");
      try {
        const basis = activeConfig?.basis ?? "invoice";
        const response = await fetch(
          `${API_BASE_URL}/integrations/douano/sales-by-sku?year=${encodeURIComponent(String(selectedYear))}&basis=${encodeURIComponent(String(basis))}`,
          { cache: "no-store" }
        );
        const payload = await response.json();
        if (!response.ok) {
          const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
          throw new Error(`${response.status} ${detail}`);
        }
        const result = (payload?.result ?? payload) as RealizedSalesBySkuPayload;
        if (!cancelled) {
          setSales(result);
          setSalesStatus("");
        }
      } catch (error) {
        if (!cancelled) {
          setSales(null);
          setSalesStatus(error instanceof Error ? error.message : String(error));
        }
      }
    }
    void loadSales();
    return () => {
      cancelled = true;
    };
  }, [selectedYear, activeConfig?.basis]);

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
  }, [sales, selectedYear, channelCode, props.channels, props.bieren, props.skus, props.articles, props.kostprijsversies, props.kostprijsproductactiveringen, props.verkoopprijzen, props.basisproducten, props.samengesteldeProducten]);

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
  }, [realized, activeConfig, selectedYear, fixedCostsTotal, props.vasteKosten]);

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
  }, [realizedBase, activeBaseConfig, selectedYear, fixedCostsTotal, props.vasteKosten]);

  const groupedConfigs = useMemo(() => groupBreakEvenConfigs(configs), [configs]);

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

  function updateChannelMix(channel: string, value: string) {
    if (!activeConfig) return;
    const nextValue = Math.max(0, Number(String(value || "0").replace(",", ".")) || 0);
    const next = { ...(activeConfig.channel_mix ?? {}) };
    next[channel] = nextValue;
    updateConfig({ channel_mix: next });
  }

  function normalizeChannelMixTo100() {
    if (!activeConfig) return;
    const mix = { ...(activeConfig.channel_mix ?? {}) };
    const entries = Object.entries(mix).filter(([code]) => code.trim());
    if (entries.length === 0) {
      updateConfig({ channel_mix: { horeca: 100 } });
      return;
    }
    const total = entries.reduce((sum, [, v]) => sum + (Number(v) || 0), 0);
    if (total <= 0) {
      updateConfig({ channel_mix: { horeca: 100 } });
      return;
    }
    updateConfig({
      channel_mix: Object.fromEntries(entries.map(([k, v]) => [k, ((Number(v) || 0) / total) * 100])),
    });
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
      setStatus("Kies eerst een product (SKU) voor deze scenario-aanpassing.");
      return;
    }

    const nextAdjustment: BreakEvenScenarioAdjustment = {
      id: adjustmentModal.adjustmentId ?? `adj-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
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

  function promoteScenarioToBase() {
    if (!activeConfig || activeConfig.kind !== "scenario") return;
    const confirmed = window.confirm(
      [
        `Promoveer \"${activeConfig.naam}\" naar nieuwe break-even basis?`,
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
          return {
            ...config,
            kind: "basis" as const,
            parent_config_id: null,
            scenario_type: null,
            naam: normalizePromotedBaseName(config.naam, config.jaar),
            is_active_for_quotes: true,
            updated_at: new Date().toISOString(),
          };
        }

        if (config.jaar === activeConfig.jaar && config.id !== activeConfig.id) {
          return { ...config, is_active_for_quotes: false, updated_at: new Date().toISOString() };
        }

        return config;
      })
    );
    setStatus(`\"${activeConfig.naam}\" is gepromoveerd naar break-even basis.`);
  }

  function useForQuotes() {
    if (!activeConfig) return;
    setConfigs((current) =>
      current.map((config) => ({
        ...config,
        is_active_for_quotes:
          config.jaar === activeConfig.jaar ? config.id === activeConfig.id : config.is_active_for_quotes,
        updated_at: new Date().toISOString(),
      }))
    );
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

      {configs.length === 0 ? null : (
        <div className="break-even-layout">
          <BreakEvenConfigList
            groupedConfigs={groupedConfigs}
            activeConfigId={activeConfigId}
            onSelectConfig={(id) => setActiveConfigId(id)}
            onAddScenarioForBase={(base) => {
              const scenario = createScenarioFromBase(base);
              setConfigs((current) => [scenario, ...current]);
              setActiveConfigId(scenario.id);
            }}
            onRemoveScenario={(id) => {
              const scenario = configs.find((config) => config.id === id && config.kind === "scenario");
              if (!scenario) return;
              const confirmed = window.confirm(`Verwijder \"${scenario.naam}\"?`);
              if (!confirmed) return;
              setConfigs((current) => current.filter((c) => c.id !== id));
              if (activeConfigId === id) setActiveConfigId(activeBaseConfig?.id ?? "");
            }}
          />

          <main className="break-even-main">
            {salesStatus ? <div className="cpq-alert">{salesStatus}</div> : null}

            {activeConfig ? (
              <section className="module-card">
                <div className="module-card-title">Kanaal (voor sell-in)</div>
                <div className="module-card-text" style={{ marginBottom: 12 }}>
                  Break-even v2 gebruikt verkoopstrategie (sell-in) van het geselecteerde kanaal. Kanaalmix wordt alvast opgeslagen (default 100% horeca) voor later.
                </div>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(240px, 360px) 1fr" }}>
                  <label className="cpq-field">
                    <div className="cpq-field-label">Actief kanaal</div>
                    <select
                      className="editor-input"
                      value={activeConfig.active_channel ?? "horeca"}
                      onChange={(e) => updateConfig({ active_channel: String(e.target.value || "horeca") })}
                    >
                      {channelOptions.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div>
                    <div className="cpq-field-label" style={{ marginBottom: 6 }}>
                      Kanaalmix (%)
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {channelOptions.map((opt) => (
                        <label key={opt.code} className="cpq-field" style={{ margin: 0 }}>
                          <div className="cpq-field-label" style={{ fontSize: 12 }}>
                            {opt.label}
                          </div>
                          <input
                            className="editor-input"
                            style={{ width: 110 }}
                            type="number"
                            min={0}
                            value={String((activeConfig.channel_mix ?? { horeca: 100 })[opt.code] ?? (opt.code === "horeca" ? 100 : 0))}
                            onChange={(e) => updateChannelMix(opt.code, e.target.value)}
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        className="editor-button editor-button-secondary"
                        onClick={normalizeChannelMixTo100}
                        title="Normaliseer kanaalmix naar 100%"
                      >
                        Normaliseer
                      </button>
                    </div>
                    <div className="module-card-text" style={{ marginTop: 8 }}>
                      Let op: kanaalmix heeft nu nog geen invloed op gerealiseerde volumes (Douano bevat nog geen kanaalindeling). Dit komt later zodra klanten aan kanalen gekoppeld zijn.
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {activeConfig?.kind === "scenario" ? (
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
                      Deze scenario-aanpassingen worden toegepast op de gerealiseerde baseline van {selectedYear}.
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
                    <ScenarioSummary
                      adjustments={activeConfig.adjustments}
                      mixMode={"product"}
                      onEdit={(adjustment) => openAdjustmentModal("mix", adjustment)}
                      onRemove={(adjustment) =>
                        updateConfig({
                          adjustments: activeConfig.adjustments.filter((a) => a.id !== adjustment.id),
                        })
                      }
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button type="button" className="editor-button editor-button-secondary" onClick={useForQuotes}>
                        Actief voor offertes
                      </button>
                      <button type="button" className="editor-button" onClick={promoteScenarioToBase}>
                        Promoveer naar basis
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {summary ? (
              <section className="module-card">
                <div className="module-card-title">Resultaat (EUR – primair)</div>
                <div className="break-even-metric-grid" style={{ marginBottom: 12 }}>
                  <MetricCard label="Vaste kosten" value={formatMoney(summary.adjustedFixedCostsTotal)} />
                  <MetricCard label="Strategie-omzet (ex)" value={formatMoney(summary.totalStrategyRevenueEx)} />
                  <MetricCard label="Totale contributie" value={formatMoney(summary.totalContributionEx)} />
                  <MetricCard label="Contributiemarge" value={`${formatNumber(summary.contributionMarginPct, 1)}%`} />
                  <MetricCard label="Break-even omzet (EUR)" value={formatMoney(summary.breakEvenRevenueOverall)} />
                  <MetricCard label="Margin of safety" value={formatMoney(summary.marginOfSafetyEx)} />
                </div>

                <div className="module-card-title">Resultaat (drivers)</div>
                <div className="break-even-metric-grid">
                  <MetricCard label="Verkochte liters" value={`${formatNumber(summary.totalSoldLiters, 0)} L`} />
                  <MetricCard label="Break-even liters" value={`${formatNumber(summary.breakEvenLiters, 0)} L`} />
                  <MetricCard label="Break-even omzet (bier)" value={formatMoney(summary.breakEvenRevenue)} />
                  <MetricCard label="Gewogen sell-in / L" value={formatMoney(summary.weightedSellInPerLiter)} />
                  <MetricCard label="Gewogen variabel / L" value={formatMoney(summary.weightedVariableCostPerLiter)} />
                  <MetricCard label="Gewogen contributie / L" value={formatMoney(summary.weightedContributionPerLiter)} />
                </div>
                {activeConfig?.kind === "scenario" && baseSummary ? (
                  <div className="break-even-metric-grid" style={{ marginTop: 16 }}>
                    <MetricCard
                      label="Delta BE omzet"
                      value={formatDelta(summary.breakEvenRevenue - baseSummary.breakEvenRevenue)}
                    />
                    <MetricCard
                      label="Delta BE liters"
                      value={formatDelta(summary.breakEvenLiters - baseSummary.breakEvenLiters, " L")}
                    />
                    <MetricCard
                      label="Delta contributie / L"
                      value={formatDelta(
                        summary.weightedContributionPerLiter - baseSummary.weightedContributionPerLiter
                      )}
                    />
                  </div>
                ) : null}
                {summary.warnings.length > 0 ? (
                  <div className="cpq-alert cpq-alert-warn break-even-warnings">
                    {summary.warnings.map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {realized ? (
              <section className="module-card">
                <div className="module-card-title">Gerealiseerde verkoop (per SKU)</div>
                {sales?.unmapped?.total_net_revenue_ex ? (
                  <div className="cpq-alert cpq-alert-warn" style={{ marginBottom: 12 }}>
                    Ongekoppelde omzet: {formatMoney(Number(sales.unmapped.total_net_revenue_ex) || 0)} (koppel in Beheer → productkoppelingen).
                  </div>
                ) : null}
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Stuks</th>
                        <th>Liters</th>
                        <th>Mix %</th>
                        <th>Sell-in (strategie)</th>
                        <th>Sell-in / L</th>
                        <th>Variabel / L</th>
                        <th>Contributie / L</th>
                        <th>Bijdrage totaal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {realized.rows
                        .filter((row) => row.kind === "liter")
                        .map((row) => (
                          <tr key={row.skuId}>
                            <td>{row.label}</td>
                            <td>{formatNumber(row.soldUnits, 0)}</td>
                            <td>{formatNumber(row.soldLiters, 0)}</td>
                            <td>{formatNumber(row.mixPct, 1)}%</td>
                            <td>{formatMoney(row.sellInEx)}</td>
                            <td>{formatMoney(row.sellInPerLiter)}</td>
                            <td>{formatMoney(row.variablePerLiter)}</td>
                            <td>{formatMoney(row.contributionPerLiter)}</td>
                            <td>{formatMoney(row.contributionTotalEx)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {realized.rows.some((row) => row.kind === "unit") ? (
                  <div style={{ marginTop: 16 }}>
                    <div className="module-card-title">Non-bier (per stuk)</div>
                    <div className="data-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>Stuks</th>
                            <th>Mix %</th>
                            <th>Sell-in (strategie)</th>
                            <th>Variabel / stuk</th>
                            <th>Contributie / stuk</th>
                            <th>Bijdrage totaal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {realized.rows
                            .filter((row) => row.kind === "unit")
                            .map((row) => (
                              <tr key={row.skuId}>
                                <td>{row.label}</td>
                                <td>{formatNumber(row.soldUnits, 0)}</td>
                                <td>{formatNumber(row.mixPct, 1)}%</td>
                                <td>{formatMoney(row.sellInEx)}</td>
                                <td>{formatMoney(row.variableUnitEx)}</td>
                                <td>{formatMoney(row.contributionUnitEx)}</td>
                                <td>{formatMoney(row.contributionTotalEx)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
          </main>
        </div>
      )}

      {activeConfig && activeConfig.kind === "scenario" && adjustmentModal ? (
        <BreakEvenAdjustmentModal
          modal={adjustmentModal}
          mixMode={"product"}
          productOptions={(realizedBase?.rows ?? []).map((row) => ({
            key: row.skuId,
            label: row.label,
          }))}
          packagingOptions={[]}
          onChange={setAdjustmentModal}
          onClose={closeAdjustmentModal}
          onSave={saveAdjustmentModal}
        />
      ) : null}
    </div>
  );
}
