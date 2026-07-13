"use client";

import { useMemo, useState, type ReactNode } from "react";

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
  product_type: "basis" | "samengesteld" | "article";
  verpakkingseenheid: string;
  source_kostprijs: number;
  kostprijs: number;
  status: "ok" | "warning" | "blocking";
  status_text: string;
};

type KostprijsTargetRows = {
  basisRows: KostprijsPreviewRow[];
  samengRows: KostprijsPreviewRow[];
};

const LIST_PRICE_CODE = "list";
const PAGE_SIZE = 25;
const CHANNELS = [
  { code: "horeca", label: "Horeca" },
  { code: "retail", label: "Retail" },
  { code: "slijterij", label: "Slijterij" },
  { code: "zakelijk", label: "Speciaalzaak" },
] as const;

function safeNumber(value: unknown) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readListPrice(row: GenericRecord | undefined): number {
  const prices = row?.sell_in_prices;
  if (!prices || typeof prices !== "object") return 0;
  return safeNumber((prices as Record<string, unknown>)[LIST_PRICE_CODE]);
}

function adviceRangeFromCenter(formatEur: (value: number) => string, center: number) {
  if (!Number.isFinite(center) || center <= 0) return "-";
  const low = Math.max(0, Math.floor((center + 0.000001) * 10) / 10);
  const high = Math.ceil((center - 0.000001) * 10) / 10;
  return `${formatEur(low)} - ${formatEur(high)}`;
}

function adviceRange(formatEur: (value: number) => string, sellIn: number, opslagPct: number) {
  if (!Number.isFinite(sellIn) || sellIn <= 0) return "-";
  return adviceRangeFromCenter(formatEur, sellIn * (1 + opslagPct / 100));
}

function productSortRank(productType: string, label: string) {
  const text = String(label || "").toLowerCase();
  if (productType === "samengesteld" || text.includes("geschenk") || text.includes("onder de boom")) return 0;
  if (productType === "article") return 1;
  return 2;
}

export function PreviewStep({
  sourceYear,
  targetYear,
  formatEur,
  isRunning,
  conceptStarted,
  saveAndCloseButton,
  navigateToStep,
  saveDraftToServer,
  wizardVerkoopprijzen,
  draftVerkoopstrategieTarget,
  liveVerkoopstrategieRows,
  draftAdviesprijzenTarget,
  adviesprijzenDraftInputs,
  kostprijsTargetRows,
}: {
  sourceYear: number;
  targetYear: number;
  formatEur: (value: number) => string;
  isRunning: boolean;
  conceptStarted: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  saveDraftToServer: (statusMessage?: string) => Promise<unknown> | unknown;
  wizardVerkoopprijzen: GenericRecord[];
  draftVerkoopstrategieTarget: GenericRecord[];
  liveVerkoopstrategieRows: GenericRecord[];
  draftAdviesprijzenTarget: AdviesprijsRow[];
  adviesprijzenDraftInputs: Record<string, string>;
  kostprijsTargetRows: KostprijsTargetRows;
}) {
  const [page, setPage] = useState(1);

  const sellInBySku = useMemo(() => {
    const map = new Map<string, number>();
    const collect = (rows: GenericRecord[]) => {
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (Number(row.jaar ?? 0) !== targetYear) return;
        if (String(row.record_type ?? "") !== "verkoopstrategie_product") return;
        const skuId = String(row.sku_id ?? "").trim();
        if (!skuId) return;
        const price = readListPrice(row);
        if (price > 0) map.set(skuId, price);
      });
    };
    collect(wizardVerkoopprijzen);
    collect(draftVerkoopstrategieTarget);
    collect(liveVerkoopstrategieRows);
    return map;
  }, [draftVerkoopstrategieTarget, liveVerkoopstrategieRows, targetYear, wizardVerkoopprijzen]);

  const manualAdviceBySkuChannel = useMemo(() => {
    const map = new Map<string, number>();
    (Array.isArray(draftAdviesprijzenTarget) ? draftAdviesprijzenTarget : []).forEach((row) => {
      const skuId = String(row.sku_id ?? "").trim();
      const channel = String(row.channel_code ?? "").trim();
      const value = safeNumber(row.adviesprijs);
      if (skuId && channel && value > 0) map.set(`${skuId}::${channel}`, value);
    });
    return map;
  }, [draftAdviesprijzenTarget]);

  function targetOpslag(channelCode: string) {
    const input = String(adviesprijzenDraftInputs[channelCode] ?? "");
    if (input.trim() !== "") return safeNumber(input);
    return safeNumber(
      draftAdviesprijzenTarget.find(
        (row) =>
          Number(row.jaar ?? 0) === targetYear &&
          String(row.channel_code ?? "") === channelCode &&
          !String(row.sku_id ?? "").trim()
      )?.opslag_pct
    );
  }

  const rows = useMemo(() => {
    const allRows = [
      ...(Array.isArray(kostprijsTargetRows.samengRows) ? kostprijsTargetRows.samengRows : []),
      ...(Array.isArray(kostprijsTargetRows.basisRows) ? kostprijsTargetRows.basisRows : []),
    ];
    return allRows
      .filter((row) => String(row.sku_id ?? "").trim())
      .map((row) => {
        const skuId = String(row.sku_id ?? "").trim();
        return {
          key: `${skuId}::${row.bier_id}::${row.product_id}`,
          skuId,
          biernaam: row.biernaam || "Zonder stijl",
          productId: row.product_id,
          productType: row.product_type,
          productLabel: row.verpakkingseenheid,
          sourceCost: safeNumber(row.source_kostprijs),
          targetCost: safeNumber(row.kostprijs),
          sellIn: sellInBySku.get(skuId) ?? 0,
          status: row.status,
          statusText: row.status_text,
        };
      })
      .sort(
        (a, b) =>
          a.biernaam.localeCompare(b.biernaam, "nl-NL") ||
          productSortRank(a.productType, a.productLabel) - productSortRank(b.productType, b.productLabel) ||
          a.productLabel.localeCompare(b.productLabel, "nl-NL")
      );
  }, [kostprijsTargetRows.basisRows, kostprijsTargetRows.samengRows, sellInBySku]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div>
      <div className="editor-status" style={{ marginBottom: 14 }}>
        Hieronder zie je de read-only controle voor {targetYear}. Kostprijzen komen uit de stap Kostprijs, sell-in uit
        Verkoopstrategie en adviesprijzen uit Adviesprijzen.
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "230px" }}>Bier</th>
              <th style={{ width: "280px" }}>Product</th>
              <th style={{ width: "150px" }}>Kostprijs {sourceYear}</th>
              <th style={{ width: "150px" }}>Kostprijs {targetYear}</th>
              <th style={{ width: "150px" }}>Sell-in {targetYear}</th>
              {CHANNELS.map((channel) => (
                <th key={channel.code} style={{ width: "180px" }}>{channel.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, index) => (
              <tr key={`${row.key}::${index}`}>
                <td>{row.biernaam}</td>
                <td>
                  <strong>{row.productLabel}</strong>
                  <div className="muted">{row.skuId || row.productId}</div>
                </td>
                <td>{formatEur(row.sourceCost)}</td>
                <td>{formatEur(row.targetCost)}</td>
                <td>{row.sellIn > 0 ? formatEur(row.sellIn) : <span className="badge badge-warning">Geen sell-in</span>}</td>
                {CHANNELS.map((channel) => {
                  const manual = manualAdviceBySkuChannel.get(`${row.skuId}::${channel.code}`) ?? 0;
                  return (
                    <td key={channel.code}>
                      {manual > 0
                        ? adviceRangeFromCenter(formatEur, manual)
                        : adviceRange(formatEur, row.sellIn, targetOpslag(channel.code))}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="muted">
                  Geen preview-rijen beschikbaar.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="editor-actions" style={{ justifyContent: "space-between", marginTop: 12 }}>
        <span className="muted">
          Pagina {currentPage} van {totalPages} - {rows.length} regels
        </span>
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={currentPage <= 1}
          >
            Vorige pagina
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={currentPage >= totalPages}
          >
            Volgende pagina
          </button>
        </div>
      </div>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(10)}
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
            onClick={() => void saveDraftToServer("Concept opgeslagen.")}
            disabled={isRunning || !conceptStarted}
          >
            Opslaan
          </button>
          <button type="button" className="editor-button" onClick={() => void navigateToStep(12)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}
