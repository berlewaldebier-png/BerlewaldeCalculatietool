"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";

type AdviesprijsRow = {
  id: string;
  jaar: number;
  channel_code: string;
  opslag_pct: number;
};

type PreviewRow = {
  productLabel: string;
  sellIn?: Record<string, unknown>;
};

type AdviesprijzenTargetsStepProps = {
  sourceYear: number;
  targetYear: number;
  isRunning: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  formatEur: (value: number) => string;

  currentAdviesprijzen: AdviesprijsRow[];
  previewRows: PreviewRow[];

  adviesprijzenDraftInputs: Record<string, string>;
  setAdviesprijzenDraftInputs: Dispatch<SetStateAction<Record<string, string>>>;
  setDraftAdviesprijzenTarget: Dispatch<SetStateAction<AdviesprijsRow[]>>;
};

export function AdviesprijzenTargetsStep({
  sourceYear,
  targetYear,
  isRunning,
  saveAndCloseButton,
  navigateToStep,
  formatEur,
  currentAdviesprijzen,
  previewRows,
  adviesprijzenDraftInputs,
  setAdviesprijzenDraftInputs,
  setDraftAdviesprijzenTarget,
}: AdviesprijzenTargetsStepProps) {
  return (
    <div>
      <div className="editor-status" style={{ marginBottom: 14 }}>
        Vul per kanaal een opslag in voor adviesprijzen (sell-out). We leiden hiermee een adviesverkoopprijs af uit onze verkoopprijs.
        Bronjaar {sourceYear} is read-only; doeljaar {targetYear} kun je aanpassen.
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "220px" }}>Kanaal</th>
              <th style={{ width: "180px" }}>Opslag {sourceYear} (%)</th>
              <th style={{ width: "180px" }}>Opslag {targetYear} (%)</th>
              <th style={{ width: "260px" }}>Advies Doos 24*33cl</th>
              <th style={{ width: "260px" }}>Advies Fust 20L</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                { code: "horeca", label: "Horeca" },
                { code: "retail", label: "Supermarkt" },
                { code: "slijterij", label: "Slijterij" },
                { code: "zakelijk", label: "Speciaalzaak" },
              ] as const
            ).map((channel) => {
              const sourceRow = currentAdviesprijzen.find(
                (row) => Number(row.jaar ?? 0) === sourceYear && row.channel_code === channel.code
              );
              const sourceOpslag = Number(sourceRow?.opslag_pct ?? 0);
              const draftValue = String(adviesprijzenDraftInputs[channel.code] ?? "");
              const parsed = Number(String(draftValue).replace(",", "."));
              const opslagPct = draftValue.trim() === "" || !Number.isFinite(parsed) ? sourceOpslag : parsed;

              const avgSellInDoos = previewRows
                .filter((row) => String(row.productLabel ?? "").includes("Doos 24*33cl"))
                .map((row) => Number((row.sellIn as any)?.[channel.code] ?? 0))
                .filter((n) => Number.isFinite(n) && n > 0);
              const avgSellInFust = previewRows
                .filter((row) => String(row.productLabel ?? "").includes("Fust 20L"))
                .map((row) => Number((row.sellIn as any)?.[channel.code] ?? 0))
                .filter((n) => Number.isFinite(n) && n > 0);
              const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
              const sellInDoos = mean(avgSellInDoos);
              const sellInFust = mean(avgSellInFust);

              const advicePrice = (sellIn: number) => {
                const base = Number.isFinite(sellIn) ? sellIn : 0;
                return base * (1 + opslagPct / 100);
              };
              const rangeLabel = (base: number) => {
                if (!Number.isFinite(base) || base <= 0) return "-";
                const low = Math.max(0, base - 0.05);
                const high = base + 0.05;
                return `${formatEur(low)} - ${formatEur(high)}`;
              };

              const doosAdvice = advicePrice(sellInDoos);
              const fustAdvice = advicePrice(sellInFust);

              return (
                <tr key={channel.code}>
                  <td>
                    <strong>{channel.label}</strong>
                  </td>
                  <td>
                    <input className="dataset-input dataset-input-readonly" value={String(sourceOpslag)} readOnly />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      value={draftValue}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setAdviesprijzenDraftInputs((current) => ({ ...current, [channel.code]: nextValue }));
                        const nextParsed = Number(String(nextValue).replace(",", "."));
                        if (!Number.isFinite(nextParsed)) return;
                        setDraftAdviesprijzenTarget((current) => {
                          const rows = Array.isArray(current) ? [...current] : [];
                          const idx = rows.findIndex(
                            (row) => row.channel_code === channel.code && Number(row.jaar ?? 0) === targetYear
                          );
                          const nextRow: AdviesprijsRow = {
                            id: idx >= 0 ? String(rows[idx].id ?? "") : "",
                            jaar: targetYear,
                            channel_code: channel.code,
                            opslag_pct: nextParsed,
                          };
                          if (idx >= 0) rows[idx] = nextRow;
                          else rows.push(nextRow);
                          return rows;
                        });
                      }}
                      onBlur={() => {
                        if (draftValue.trim() !== "") return;
                        setAdviesprijzenDraftInputs((current) => ({ ...current, [channel.code]: String(sourceOpslag) }));
                        setDraftAdviesprijzenTarget((current) => {
                          const rows = Array.isArray(current) ? [...current] : [];
                          const idx = rows.findIndex(
                            (row) => row.channel_code === channel.code && Number(row.jaar ?? 0) === targetYear
                          );
                          const nextRow: AdviesprijsRow = {
                            id: idx >= 0 ? String(rows[idx].id ?? "") : "",
                            jaar: targetYear,
                            channel_code: channel.code,
                            opslag_pct: sourceOpslag,
                          };
                          if (idx >= 0) rows[idx] = nextRow;
                          else rows.push(nextRow);
                          return rows;
                        });
                      }}
                      disabled={isRunning}
                    />
                  </td>
                  <td>{rangeLabel(doosAdvice)}</td>
                  <td>{rangeLabel(fustAdvice)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(11)}
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

