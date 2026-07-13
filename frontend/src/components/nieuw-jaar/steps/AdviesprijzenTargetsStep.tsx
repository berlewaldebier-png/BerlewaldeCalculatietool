"use client";

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

type GenericRecord = Record<string, unknown>;

type AdviesprijsRow = {
  id: string;
  jaar: number;
  channel_code: string;
  opslag_pct: number;
  sku_id?: string;
  adviesprijs?: number;
  record_type?: string;
};

type KostprijsPreviewRow = {
  bier_id: string;
  sku_id?: string;
  product_id: string;
  biernaam: string;
  soort: string;
  product_type: "basis" | "samengesteld" | "article";
  verpakkingseenheid: string;
  kostprijs: number;
  status: "ok" | "warning" | "blocking";
  status_text: string;
};

type KostprijsTargetRows = {
  basisRows: KostprijsPreviewRow[];
  samengRows: KostprijsPreviewRow[];
};

type AdviesprijzenTargetsStepProps = {
  sourceYear: number;
  targetYear: number;
  isRunning: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  formatEur: (value: number) => string;

  currentAdviesprijzen: AdviesprijsRow[];
  wizardVerkoopprijzen: GenericRecord[];
  draftVerkoopstrategieTarget: GenericRecord[];
  liveVerkoopstrategieRows: GenericRecord[];
  draftAdviesprijzenTarget: AdviesprijsRow[];
  kostprijsTargetRows: KostprijsTargetRows;

  adviesprijzenDraftInputs: Record<string, string>;
  setAdviesprijzenDraftInputs: Dispatch<SetStateAction<Record<string, string>>>;
  setDraftAdviesprijzenTarget: Dispatch<SetStateAction<AdviesprijsRow[]>>;
};

const LIST_PRICE_CODE = "list";
const CHANNELS = [
  { code: "horeca", label: "Horeca" },
  { code: "retail", label: "Supermarkt" },
  { code: "slijterij", label: "Slijterij" },
  { code: "zakelijk", label: "Speciaalzaak" },
] as const;

function safeNumber(value: unknown) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(value: number) {
  return `${Number(value || 0).toLocaleString("nl-NL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function productSortRank(productType: string, label: string) {
  const text = String(label || "").toLowerCase();
  if (productType === "samengesteld" || text.includes("geschenk") || text.includes("onder de boom")) return 0;
  if (productType === "article") return 1;
  return 2;
}

function readListPrice(row: GenericRecord | undefined): number {
  const prices = row?.sell_in_prices;
  if (!prices || typeof prices !== "object") return 0;
  return safeNumber((prices as Record<string, unknown>)[LIST_PRICE_CODE]);
}

function adviceRange(formatEur: (value: number) => string, sellIn: number, opslagPct: number) {
  if (!Number.isFinite(sellIn) || sellIn <= 0) return "-";
  const center = sellIn * (1 + opslagPct / 100);
  return adviceRangeFromCenter(formatEur, center);
}

function adviceRangeFromCenter(formatEur: (value: number) => string, center: number) {
  if (!Number.isFinite(center) || center <= 0) return "-";
  const low = Math.max(0, Math.floor((center + 0.000001) * 10) / 10);
  const high = Math.ceil((center - 0.000001) * 10) / 10;
  return `${formatEur(low)} - ${formatEur(high)}`;
}

function upsertAdviceRows(
  current: AdviesprijsRow[],
  targetYear: number,
  channelCode: string,
  opslagPct: number
) {
  const rows = Array.isArray(current) ? [...current] : [];
  const idx = rows.findIndex(
    (row) =>
      row.channel_code === channelCode &&
      Number(row.jaar ?? 0) === targetYear &&
      !String(row.sku_id ?? "").trim()
  );
  const nextRow: AdviesprijsRow = {
    id: idx >= 0 ? String(rows[idx].id ?? "") : "",
    jaar: targetYear,
    channel_code: channelCode,
    opslag_pct: opslagPct,
  };
  if (idx >= 0) rows[idx] = nextRow;
  else rows.push(nextRow);
  return rows;
}

function upsertAdviceOverrideRows(
  current: AdviesprijsRow[],
  targetYear: number,
  skuId: string,
  channelCode: string,
  adviesprijs: number | null
) {
  const rows = Array.isArray(current) ? [...current] : [];
  const idx = rows.findIndex(
    (row) =>
      Number(row.jaar ?? 0) === targetYear &&
      String(row.channel_code ?? "") === channelCode &&
      String(row.sku_id ?? "") === skuId
  );
  if (adviesprijs === null) {
    if (idx >= 0) rows.splice(idx, 1);
    return rows;
  }
  const nextRow: AdviesprijsRow = {
    id: idx >= 0 ? String(rows[idx].id ?? "") : "",
    record_type: "adviesprijs_product",
    jaar: targetYear,
    channel_code: channelCode,
    opslag_pct: 0,
    sku_id: skuId,
    adviesprijs,
  };
  if (idx >= 0) rows[idx] = nextRow;
  else rows.push(nextRow);
  return rows;
}

function manualKey(skuId: string, channelCode: string) {
  return `${skuId}::${channelCode}`;
}

export function AdviesprijzenTargetsStep({
  sourceYear,
  targetYear,
  isRunning,
  saveAndCloseButton,
  navigateToStep,
  formatEur,
  currentAdviesprijzen,
  wizardVerkoopprijzen,
  draftVerkoopstrategieTarget,
  liveVerkoopstrategieRows,
  draftAdviesprijzenTarget,
  kostprijsTargetRows,
  adviesprijzenDraftInputs,
  setAdviesprijzenDraftInputs,
  setDraftAdviesprijzenTarget,
}: AdviesprijzenTargetsStepProps) {
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [manualAdviceInputs, setManualAdviceInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    setManualAdviceInputs(
      Object.fromEntries(
        (Array.isArray(draftAdviesprijzenTarget) ? draftAdviesprijzenTarget : [])
          .filter((row) => String(row.sku_id ?? "").trim() && Number(row.adviesprijs ?? 0) > 0)
          .map((row) => [manualKey(String(row.sku_id ?? "").trim(), String(row.channel_code ?? "")), String(row.adviesprijs ?? "")])
      )
    );
  }, [draftAdviesprijzenTarget]);

  const sellInBySku = useMemo(() => {
    const map = new Map<string, number>();
    (Array.isArray(wizardVerkoopprijzen) ? wizardVerkoopprijzen : []).forEach((row) => {
      if (Number(row.jaar ?? 0) !== targetYear) return;
      if (String(row.record_type ?? "") !== "verkoopstrategie_product") return;
      const skuId = String(row.sku_id ?? "").trim();
      if (!skuId) return;
      const price = readListPrice(row);
      if (price > 0) map.set(skuId, price);
    });
    (Array.isArray(draftVerkoopstrategieTarget) ? draftVerkoopstrategieTarget : []).forEach((row) => {
      if (Number(row.jaar ?? 0) !== targetYear) return;
      const skuId = String(row.sku_id ?? "").trim();
      if (!skuId) return;
      const price = readListPrice(row);
      if (price > 0) map.set(skuId, price);
    });
    (Array.isArray(liveVerkoopstrategieRows) ? liveVerkoopstrategieRows : []).forEach((row) => {
      if (Number(row.jaar ?? 0) !== targetYear) return;
      const skuId = String(row.sku_id ?? "").trim();
      if (!skuId) return;
      const price = readListPrice(row);
      if (price > 0) map.set(skuId, price);
    });
    return map;
  }, [draftVerkoopstrategieTarget, liveVerkoopstrategieRows, targetYear, wizardVerkoopprijzen]);

  const rows = useMemo(() => {
    const kostRows = [
      ...(Array.isArray(kostprijsTargetRows.samengRows) ? kostprijsTargetRows.samengRows : []),
      ...(Array.isArray(kostprijsTargetRows.basisRows) ? kostprijsTargetRows.basisRows : []),
    ];
    return kostRows
      .filter((row) => String(row.sku_id ?? "").trim())
      .map((row) => {
        const skuId = String(row.sku_id ?? "").trim();
        return {
          key: skuId,
          skuId,
          biernaam: row.biernaam || "Zonder stijl",
          productId: row.product_id,
          productType: row.product_type,
          productLabel: row.verpakkingseenheid,
          costprice: safeNumber(row.kostprijs),
          sellIn: sellInBySku.get(skuId) ?? 0,
          status: row.status,
          statusText: row.status_text,
        };
      });
  }, [kostprijsTargetRows.basisRows, kostprijsTargetRows.samengRows, sellInBySku]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.biernaam, row.productLabel, row.productType, row.statusText].join(" ").toLowerCase().includes(needle)
    );
  }, [query, rows]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, typeof filteredRows>();
    filteredRows.forEach((row) => {
      groups.set(row.biernaam, [...(groups.get(row.biernaam) ?? []), row]);
    });
    return Array.from(groups.entries())
      .map(([name, groupRows]) => ({
        name,
        rows: groupRows.sort(
          (a, b) =>
            productSortRank(a.productType, a.productLabel) - productSortRank(b.productType, b.productLabel) ||
            a.productLabel.localeCompare(b.productLabel, "nl-NL")
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "nl-NL"));
  }, [filteredRows]);

  function sourceOpslag(channelCode: string) {
    return safeNumber(
      currentAdviesprijzen.find((row) => Number(row.jaar ?? 0) === sourceYear && row.channel_code === channelCode)?.opslag_pct
    );
  }

  function targetOpslag(channelCode: string) {
    const draftValue = String(adviesprijzenDraftInputs[channelCode] ?? "");
    if (draftValue.trim() === "") return 0;
    return safeNumber(draftValue);
  }

  function updateChannel(channelCode: string, nextValue: string) {
    setAdviesprijzenDraftInputs((current) => ({ ...current, [channelCode]: nextValue }));
    const parsed = nextValue.trim() === "" ? 0 : safeNumber(nextValue);
    setDraftAdviesprijzenTarget((current) => upsertAdviceRows(current, targetYear, channelCode, parsed));
  }

  function updateManualAdvice(skuId: string, channelCode: string, nextValue: string) {
    const key = manualKey(skuId, channelCode);
    setManualAdviceInputs((current) => ({ ...current, [key]: nextValue }));
    const trimmed = nextValue.trim();
    const parsed = trimmed === "" ? null : safeNumber(trimmed);
    setDraftAdviesprijzenTarget((current) =>
      upsertAdviceOverrideRows(current, targetYear, skuId, channelCode, parsed && parsed > 0 ? parsed : null)
    );
  }

  function isOpen(name: string) {
    return openGroups[name] ?? false;
  }

  function setAll(open: boolean) {
    setOpenGroups(Object.fromEntries(groupedRows.map((group) => [group.name, open])));
  }

  return (
    <div>
      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div className="module-card-title">Adviesprijzen {targetYear}</div>
        <div className="module-card-text">
          Adviesprijzen zijn sell-out ranges op basis van onze sell-in prijs uit Verkoopstrategie. Zonder opslag blijft de
          adviesprijs gelijk aan de sell-in prijs; de range toont 10 cent onder en boven het adviespunt.
        </div>
      </div>

      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div className="module-card-title">Opslag per kanaal</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
            marginTop: 12,
            alignItems: "end",
          }}
        >
          {CHANNELS.map((channel) => (
            <label key={channel.code} className="nested-field">
              <span>{channel.label}</span>
              <input
                className="dataset-input"
                type="number"
                step="0.1"
                value={adviesprijzenDraftInputs[channel.code] ?? ""}
                placeholder="0"
                onChange={(event) => updateChannel(channel.code, event.target.value)}
                disabled={isRunning}
              />
              <small className="muted">Bron {sourceYear}: {pct(sourceOpslag(channel.code))}</small>
            </label>
          ))}
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
              placeholder="Zoek stijl, SKU of status..."
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
            <strong>Geen adviesprijsregels beschikbaar</strong>
            <div className="muted">Controleer eerst Kostprijs en Verkoopstrategie; deze stap leest beide als bron.</div>
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
                <span className="editor-pill">{group.rows.length} SKU&apos;s</span>
              </button>
              {isOpen(group.name) ? (
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Artikel / SKU</th>
                        <th>Kostprijs {targetYear}</th>
                        <th>Sell-in {targetYear}</th>
                        {CHANNELS.map((channel) => (
                          <th key={channel.code}>{channel.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={row.key}>
                          <td>
                            <strong>{row.productLabel}</strong>
                            <div className="muted">{row.skuId || row.productId}</div>
                          </td>
                          <td>{formatEur(row.costprice)}</td>
                          <td>{row.sellIn > 0 ? formatEur(row.sellIn) : <span className="badge badge-warning">Geen sell-in</span>}</td>
                          {CHANNELS.map((channel) => {
                            const key = manualKey(row.skuId, channel.code);
                            const manualValue = manualAdviceInputs[key] ?? "";
                            const manualPrice = manualValue.trim() === "" ? 0 : safeNumber(manualValue);
                            const calculatedRange = adviceRange(formatEur, row.sellIn, targetOpslag(channel.code));
                            const shownRange = manualPrice > 0 ? adviceRangeFromCenter(formatEur, manualPrice) : calculatedRange;
                            return (
                              <td key={channel.code}>
                                <input
                                  className="dataset-input"
                                  type="number"
                                  step="0.01"
                                  value={manualValue}
                                  placeholder={row.sellIn > 0 ? formatEur(row.sellIn * (1 + targetOpslag(channel.code) / 100)) : "-"}
                                  onChange={(event) => updateManualAdvice(row.skuId, channel.code, event.target.value)}
                                  disabled={isRunning || row.sellIn <= 0}
                                  style={{ maxWidth: 120, marginBottom: 4 }}
                                />
                                <div>{shownRange}</div>
                              </td>
                            );
                          })}
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

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(9)}
            disabled={isRunning}
          >
            Vorige
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button type="button" className="editor-button" onClick={() => void navigateToStep(11)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}
