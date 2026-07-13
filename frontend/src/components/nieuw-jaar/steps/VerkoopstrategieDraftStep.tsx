"use client";

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { calcSellInPrice } from "@/components/nieuw-jaar/nieuwJaarWizardPricing";

type GenericRecord = Record<string, unknown>;

type PricingMode = "keep_price" | "scale_cost_ratio" | "keep_margin" | "free";

type PreviewRow = {
  skuId?: string;
  bierId: string;
  biernaam: string;
  productId: string;
  productType: string;
  productLabel: string;
  sourceCost?: number;
  estimatedTargetCost: number;
  sellIn?: Record<string, unknown>;
};

type KostprijsPreviewRow = {
  bier_id: string;
  sku_id?: string;
  product_id: string;
  biernaam: string;
  soort: string;
  product_type: "basis" | "samengesteld" | "article";
  verpakkingseenheid: string;
  source_kostprijs: number;
  kostprijs: number;
  verschil: number;
  verschil_pct: number;
  status: "ok" | "warning" | "blocking";
  status_text: string;
};

type KostprijsTargetRows = {
  basisRows: KostprijsPreviewRow[];
  samengRows: KostprijsPreviewRow[];
};

type PlanTargets = {
  revenue?: number;
  liters?: number;
  contribution?: number;
};

type VerkoopstrategieDraftStepProps = {
  sourceYear: number;
  targetYear: number;
  isRunning: boolean;
  conceptStarted: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;

  pricingMode: PricingMode;
  setPricingMode: Dispatch<SetStateAction<PricingMode>>;
  applyPricingScenario: () => Promise<void> | void;

  wizardVerkoopprijzen: GenericRecord[];
  currentProductie: Record<string, GenericRecord>;
  initialBasisproducten: GenericRecord[];
  initialSamengesteldeProducten: GenericRecord[];
  initialBieren: GenericRecord[];
  currentBerekeningen: GenericRecord[];
  currentActivations: GenericRecord[];
  previewRows: PreviewRow[];
  kostprijsTargetRows: KostprijsTargetRows;
  draftPlanTargets: PlanTargets;
  sourceYearCloseReference?: Record<string, number>;
  formatEur: (value: number) => string;

  verkoopstrategieSave: null | (() => Promise<void>);
  setVerkoopstrategieSave: Dispatch<SetStateAction<null | (() => Promise<void>)>>;
  setDraftVerkoopstrategieTarget: Dispatch<SetStateAction<GenericRecord[]>>;
  setLiveVerkoopstrategieRows: Dispatch<SetStateAction<GenericRecord[]>>;
  setCompletedStepIds: Dispatch<SetStateAction<string[]>>;
  saveDraftToServer: (message?: string) => Promise<unknown> | unknown;
};

const LIST_PRICE_CODE = "list";

const STRATEGY_TYPES = new Set(["jaarstrategie", "verkoopstrategie_product", "verkoopstrategie_verpakking"]);

function pct(value: number, digits = 1) {
  return `${Number(value || 0).toLocaleString("nl-NL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function roundMoney(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function marginFromPrice(cost: number, price: number) {
  const p = Number(price || 0);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.round(((1 - Number(cost || 0) / p) * 100) * 100) / 100;
}

function groupForProduct(label: string, productType: string) {
  const text = String(label || "").toLowerCase();
  if (text.includes("fust")) return "Fust";
  if (text.includes("geschenk") || text.includes("onder de boom")) return "Geschenk";
  if (text.includes("doos")) return "Doos";
  if (text.includes("fles")) return "Doos";
  if (text.includes("glas") || text.includes("opener") || text.includes("merch")) return "Merchandise";
  if (productType === "samengesteld") return "Samengesteld";
  return "Overig";
}

function safeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function productSortRank(productType: string, label: string) {
  const text = String(label || "").toLowerCase();
  if (productType === "samengesteld" || text.includes("geschenk") || text.includes("onder de boom")) return 0;
  if (productType === "article") return 1;
  return 2;
}

function readListPrice(row: any): number | null {
  const prices = row?.sell_in_prices ?? row?.kanaalprijzen ?? {};
  if (!prices || typeof prices !== "object") return null;
  const raw = (prices as any)[LIST_PRICE_CODE];
  if (raw === "" || raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function strategyKeyFromParts(skuId: string) {
  const sku = String(skuId || "").trim();
  return sku;
}

function strategyKeyFromRow(row: any) {
  return strategyKeyFromParts(String(row?.sku_id ?? row?.skuId ?? ""));
}

export function VerkoopstrategieDraftStep({
  sourceYear,
  targetYear,
  isRunning,
  conceptStarted,
  saveAndCloseButton,
  navigateToStep,
  wizardVerkoopprijzen,
  initialSamengesteldeProducten,
  previewRows,
  kostprijsTargetRows,
  draftPlanTargets,
  sourceYearCloseReference,
  formatEur,
  setDraftVerkoopstrategieTarget,
  setLiveVerkoopstrategieRows,
  setCompletedStepIds,
  saveDraftToServer,
}: VerkoopstrategieDraftStepProps) {
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [groupRaises, setGroupRaises] = useState<Record<string, number>>({
    Doos: 0,
    Fust: 0,
    Geschenk: 0,
    Merchandise: 0,
    Samengesteld: 0,
    Overig: 0,
  });
  const [volumeImpactPct, setVolumeImpactPct] = useState(0);
  const [manualTargetPrices, setManualTargetPrices] = useState<Record<string, number | "">>({});
  const [localStatus, setLocalStatus] = useState("");
  const [hydratedFromDraft, setHydratedFromDraft] = useState(false);

  const previewByKey = useMemo(() => {
    const map = new Map<string, PreviewRow>();
    (Array.isArray(previewRows) ? previewRows : []).forEach((row) => {
      const key = strategyKeyFromParts(String(row.skuId ?? ""));
      if (key) map.set(key, row);
    });
    return map;
  }, [previewRows]);

  const strategyRows = useMemo(
    () =>
      (Array.isArray(wizardVerkoopprijzen) ? wizardVerkoopprijzen : []).filter(
        (row) => row && typeof row === "object" && STRATEGY_TYPES.has(String((row as any).record_type ?? ""))
      ),
    [wizardVerkoopprijzen]
  );

  const explicitTargetListPriceBySku = useMemo(() => {
    const map = new Map<string, number>();
    strategyRows.forEach((row) => {
      if (Number((row as any).jaar ?? 0) !== targetYear) return;
      if (String((row as any).strategie_type ?? "") === "new_year_price_scenario") return;
      const skuId = String((row as any).sku_id ?? "").trim();
      if (!skuId) return;
      const price = readListPrice(row);
      if (price !== null) map.set(skuId, price);
    });
    return map;
  }, [strategyRows, targetYear]);

  useEffect(() => {
    if (hydratedFromDraft) return;
    const targetRows = strategyRows.filter(
      (row) =>
        String((row as any).record_type ?? "") === "verkoopstrategie_product" &&
        Number((row as any).jaar ?? 0) === targetYear &&
        String((row as any).strategie_type ?? "") === "new_year_price_scenario" &&
        String((row as any).draft_source ?? "") !== "live_preview"
    );
    if (targetRows.length === 0) return;

    const grouped = new Map<string, number[]>();
    let volumeImpact: number | null = null;
    targetRows.forEach((row) => {
      const group = String((row as any).price_group ?? "").trim();
      if (!group) return;
      const current = grouped.get(group) ?? [];
      current.push(safeNumber((row as any).price_raise_pct));
      grouped.set(group, current);
      if (volumeImpact === null) volumeImpact = safeNumber((row as any).volume_impact_pct);
    });
    if (grouped.size === 0) return;

    setGroupRaises((current) => {
      const next = { ...current };
      grouped.forEach((values, group) => {
        next[group] = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      });
      return next;
    });
    if (volumeImpact !== null) setVolumeImpactPct(volumeImpact);
    setManualTargetPrices(
      Object.fromEntries(
        targetRows.flatMap((row) => {
          const skuId = String((row as any).sku_id ?? "").trim();
          const key = strategyKeyFromRow(row);
          if (!key || (skuId && explicitTargetListPriceBySku.has(skuId))) return [];
          const price = safeNumber(((row as any).sell_in_prices ?? {})[LIST_PRICE_CODE]);
          return key && price > 0 ? [[key, price]] : [];
        })
      )
    );
    setHydratedFromDraft(true);
  }, [explicitTargetListPriceBySku, hydratedFromDraft, strategyRows, targetYear]);

  const rows = useMemo(() => {
    const kostRows = [
      ...(Array.isArray(kostprijsTargetRows.samengRows) ? kostprijsTargetRows.samengRows : []),
      ...(Array.isArray(kostprijsTargetRows.basisRows) ? kostprijsTargetRows.basisRows : []),
    ];
    return kostRows.flatMap((row) => {
      const productType = row.product_type;
      const productLabel = row.verpakkingseenheid;
      const group = groupForProduct(productLabel, productType);
      const raisePct = safeNumber(groupRaises[group]);
      const sourceCost = safeNumber(row.source_kostprijs);
      const targetCost = safeNumber(row.kostprijs);
      const skuId = String(row.sku_id ?? "").trim();
      if (!skuId) return [];
      const rowKey = strategyKeyFromParts(skuId);
      const preview = previewByKey.get(rowKey);
      const bySku = skuId
        ? strategyRows.find(
            (strategyRow) =>
              Number((strategyRow as any).jaar ?? 0) === sourceYear &&
              String((strategyRow as any).sku_id ?? "") === skuId
          )
        : null;
      const explicitBySku = readListPrice(bySku);
      const previewSellIn = safeNumber((preview?.sellIn ?? {})[LIST_PRICE_CODE]);
      const sourcePrice = roundMoney(explicitBySku ?? previewSellIn);
      const explicitTargetPrice = explicitTargetListPriceBySku.get(skuId);
      const calculatedTargetPrice = roundMoney(
        explicitTargetPrice ?? (sourcePrice > 0 ? sourcePrice * (1 + raisePct / 100) : calcSellInPrice(targetCost, 50))
      );
      const manualPrice = manualTargetPrices[rowKey];
      const targetPrice = manualPrice === "" || manualPrice === undefined ? calculatedTargetPrice : roundMoney(Number(manualPrice));
      const marginPct = marginFromPrice(targetCost, targetPrice);

      return [{
        key: rowKey,
        skuId,
        bierId: row.bier_id,
        biernaam: row.biernaam || "Zonder stijl",
        productId: row.product_id,
        productType,
        productLabel,
        group,
        sourceCost,
        targetCost,
        sourcePrice,
        targetPrice,
        calculatedTargetPrice,
        priceSource: explicitTargetPrice !== undefined ? "Prijslijst" : "Scenario",
        targetPrices: { [LIST_PRICE_CODE]: targetPrice },
        margins: { [LIST_PRICE_CODE]: marginPct },
        raisePct,
        marginPct,
        contribution: targetPrice - targetCost,
      }];
    });
  }, [
    explicitTargetListPriceBySku,
    groupRaises,
    kostprijsTargetRows.basisRows,
    kostprijsTargetRows.samengRows,
    manualTargetPrices,
    previewByKey,
    sourceYear,
    strategyRows,
  ]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.biernaam, row.productLabel, row.group, row.productType].join(" ").toLowerCase().includes(needle)
    );
  }, [query, rows]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, typeof filteredRows>();
    filteredRows.forEach((row) => {
      const key = row.biernaam || "Zonder stijl";
      groups.set(key, [...(groups.get(key) ?? []), row]);
    });
    return Array.from(groups.entries())
      .map(([name, groupRows]) => ({
        name,
        rows: groupRows.sort(
          (a, b) =>
            productSortRank(a.productType, a.productLabel) - productSortRank(b.productType, b.productLabel) ||
            a.group.localeCompare(b.group, "nl-NL") ||
            a.productLabel.localeCompare(b.productLabel, "nl-NL")
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "nl-NL"));
  }, [filteredRows]);

  const summary = useMemo(() => {
    const avgRaise = rows.length > 0 ? rows.reduce((sum, row) => sum + row.raisePct, 0) / rows.length : 0;
    const planRevenue = safeNumber(draftPlanTargets.revenue ?? sourceYearCloseReference?.revenue ?? 0);
    const scenarioRevenue = planRevenue * (1 + avgRaise / 100) * (1 + safeNumber(volumeImpactPct) / 100);
    const targetCostAvg = rows.length > 0 ? rows.reduce((sum, row) => sum + row.targetCost, 0) / rows.length : 0;
    const targetPriceAvg = rows.length > 0 ? rows.reduce((sum, row) => sum + row.targetPrice, 0) / rows.length : 0;
    const marginPct = targetPriceAvg > 0 ? (1 - targetCostAvg / targetPriceAvg) * 100 : 0;
    const estimatedContribution = scenarioRevenue * Math.max(0, Math.min(1, marginPct / 100));
    return {
      avgRaise,
      planRevenue,
      scenarioRevenue,
      deltaRevenue: scenarioRevenue - planRevenue,
      marginPct,
      estimatedContribution,
      warnings: rows.filter((row) => row.targetPrice <= row.targetCost || row.marginPct < 20).length,
    };
  }, [draftPlanTargets.revenue, rows, sourceYearCloseReference?.revenue, volumeImpactPct]);

  useEffect(() => {
    const nextRows = rows.map((row) => ({
      id: "",
      record_type: "verkoopstrategie_product",
      jaar: targetYear,
      bron_jaar: sourceYear,
      sku_id: row.skuId,
      bier_id: row.bierId,
      biernaam: row.biernaam,
      product_id: row.productId,
      product_type: row.productType,
      verpakking: row.productLabel,
      strategie_type: "new_year_price_scenario",
      price_group: row.group,
      price_raise_pct: row.raisePct,
      volume_impact_pct: safeNumber(volumeImpactPct),
      sell_in_prices: row.targetPrices,
      sell_in_margins: row.margins,
    }));
    const nextJson = JSON.stringify(nextRows);
    setLiveVerkoopstrategieRows((current) => {
      const currentRows = Array.isArray(current) ? current : [];
      return JSON.stringify(currentRows) === nextJson ? currentRows : nextRows;
    });
  }, [rows, setLiveVerkoopstrategieRows, sourceYear, targetYear, volumeImpactPct]);

  function isOpen(name: string) {
    return openGroups[name] ?? false;
  }

  function setAll(open: boolean) {
    setOpenGroups(Object.fromEntries(groupedRows.map((group) => [group.name, open])));
  }

  async function saveStrategy() {
    if (!conceptStarted) {
      setLocalStatus("Start eerst het nieuw-jaar concept.");
      return;
    }
    const nextRows = rows.map((row) => ({
      id: "",
      record_type: "verkoopstrategie_product",
      jaar: targetYear,
      bron_jaar: sourceYear,
      sku_id: row.skuId,
      bier_id: row.bierId,
      biernaam: row.biernaam,
      product_id: row.productId,
      product_type: row.productType,
      verpakking: row.productLabel,
      strategie_type: "new_year_price_scenario",
      price_group: row.group,
      price_raise_pct: row.raisePct,
      volume_impact_pct: safeNumber(volumeImpactPct),
      sell_in_prices: row.targetPrices,
      sell_in_margins: row.margins,
    }));

    setDraftVerkoopstrategieTarget(nextRows);
    setCompletedStepIds((current) =>
      current.includes("verkoopstrategie") ? current : [...current, "verkoopstrategie"]
    );
    await saveDraftToServer(`Verkoopstrategie (concept) voor ${targetYear} opgeslagen.`);
    setLocalStatus(`Verkoopstrategie voor ${targetYear} opgeslagen als concept.`);
  }

  return (
    <div>
      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div className="module-card-title">Verkoopstrategie {targetYear}</div>
        <div className="module-card-text">
          Stuur hier op prijs en volume. Een prijsverhoging verhoogt eerst de verwachte omzet; volume-impact is een expliciete
          aanname. Zo blijft duidelijk wat prijs doet en wat volume doet.
        </div>
      </div>

      <div className="record-card-grid" style={{ marginBottom: 14 }}>
        <div className="wizard-toggle-card">
          <span><strong>Plan omzet</strong><small>{formatEur(summary.planRevenue)}</small></span>
        </div>
        <div className="wizard-toggle-card">
          <span><strong>Scenario omzet</strong><small>{formatEur(summary.scenarioRevenue)}</small></span>
        </div>
        <div className="wizard-toggle-card">
          <span><strong>Omzetverschil</strong><small>{formatEur(summary.deltaRevenue)}</small></span>
        </div>
        <div className="wizard-toggle-card">
          <span><strong>Gem. prijsstijging</strong><small>{pct(summary.avgRaise)}</small></span>
        </div>
        <div className="wizard-toggle-card">
          <span><strong>Indicatieve marge</strong><small>{pct(summary.marginPct)}</small></span>
        </div>
        <div className="wizard-toggle-card">
          <span><strong>Aandachtspunten</strong><small>{summary.warnings}</small></span>
        </div>
      </div>

      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div className="module-card-title">Prijsregels per groep</div>
        <div className="module-card-text">
          Pas prijsverhogingen toe per verkoopgroep. Doos geldt ook voor losse flessen die uit dezelfde prijsfamilie volgen.
          Geschenk zijn giftsets en kerstpakketten, Samengesteld zijn overige combinaties, Overig is alleen vangnet. Volume-impact
          past de verwachte omzet aan, niet de prijs per SKU.
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 10,
            marginTop: 12,
            alignItems: "end",
          }}
        >
          {Object.keys(groupRaises).map((group) => (
            <label key={group} className="nested-field">
              <span>{group}</span>
              <input
                className="dataset-input"
                type="number"
                step="0.1"
                value={String(groupRaises[group] ?? 0)}
                onChange={(event) =>
                  setGroupRaises((current) => ({ ...current, [group]: safeNumber(event.target.value) }))
                }
              />
            </label>
          ))}
          <label className="nested-field">
            <span>Volume-impact %</span>
            <input
              className="dataset-input"
              type="number"
              step="0.1"
              value={String(volumeImpactPct)}
              onChange={(event) => setVolumeImpactPct(safeNumber(event.target.value))}
            />
          </label>
        </div>
      </div>

      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div className="editor-grid two" style={{ marginBottom: 12 }}>
          <label className="nested-field">
            <span>Zoeken</span>
            <input
              className="dataset-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Zoek stijl, SKU of groep..."
            />
          </label>
          <div className="editor-actions" style={{ alignItems: "end" }}>
            <button type="button" className="editor-button editor-button-secondary" onClick={() => setAll(true)}>
              Alles openen
            </button>
            <button type="button" className="editor-button editor-button-secondary" onClick={() => setAll(false)}>
              Alles sluiten
            </button>
          </div>
        </div>

        {groupedRows.length === 0 ? (
          <div className="placeholder-block">
            <strong>Geen verkoopbare regels beschikbaar</strong>
            <div className="muted">Controleer eerst de kostprijsstap; deze verkoopstrategie gebruikt die regels als bron.</div>
          </div>
        ) : null}

        <div className="wizard-stack">
          {groupedRows.map((group) => (
            <section key={group.name} className="module-card nested-module-card">
              <button
                type="button"
                className="active-cost-group-header"
                onClick={() => setOpenGroups((current) => ({ ...current, [group.name]: !isOpen(group.name) }))}
              >
                <span>{isOpen(group.name) ? "v" : ">"} {group.name}</span>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  {Array.from(new Set(group.rows.map((row) => row.group))).map((label) => (
                    <span key={label} className="pill">{label}</span>
                  ))}
                  <span className="editor-pill">{group.rows.length} SKU&apos;s</span>
                </span>
              </button>
              {isOpen(group.name) ? (
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Artikel / SKU</th>
                        <th>Groep</th>
                        <th>Kostprijs {targetYear}</th>
                        <th>Prijs {sourceYear}</th>
                        <th>Prijsstijging</th>
                        <th>Prijs {targetYear}</th>
                        <th>Marge</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={row.key}>
                          <td>
                            <strong>{row.productLabel}</strong>
                            <div className="muted">{row.productId}</div>
                          </td>
                          <td>{row.group}</td>
                          <td>{formatEur(row.targetCost)}</td>
                          <td>{formatEur(row.sourcePrice)}</td>
                          <td>{pct(row.raisePct)}</td>
                          <td>
                            <input
                              className="dataset-input"
                              type="number"
                              step="0.01"
                              value={row.targetPrice || ""}
                              onChange={(event) =>
                                setManualTargetPrices((current) => ({
                                  ...current,
                                  [row.key]: event.target.value === "" ? "" : safeNumber(event.target.value),
                                }))
                              }
                              style={{ maxWidth: 130 }}
                            />
                            {row.targetPrice !== row.calculatedTargetPrice ? (
                              <div className="muted">handmatig</div>
                            ) : (
                              <div className="muted">{row.priceSource}</div>
                            )}
                          </td>
                          <td>
                            {formatEur(row.contribution)}
                            <div className="muted">{pct(row.marginPct)}</div>
                          </td>
                          <td>
                            <span className={`status-pill ${row.targetPrice > row.targetCost && row.marginPct >= 20 ? "status-ok" : "status-warning"}`}>
                              {row.targetPrice <= row.targetCost ? "onder kostprijs" : row.marginPct < 20 ? "lage marge" : "ok"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </div>

      {localStatus ? <div className="editor-status" style={{ marginBottom: 14 }}>{localStatus}</div> : null}

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(8)}
            disabled={isRunning}
          >
            Vorige
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void saveStrategy()}
            disabled={isRunning || !conceptStarted}
          >
            Opslaan
          </button>
          <button type="button" className="editor-button" onClick={() => void navigateToStep(10)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}
