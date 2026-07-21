"use client";

import { ActionStatus } from "@/components/ActionStatus";
import type {
  AdviesprijsRow,
  Channel,
} from "@/components/adviesprijzen/adviesprijzenDerivations";
import { money } from "@/components/adviesprijzen/adviesprijzenUtils";
import { VatDisplayToggle, type VatDisplayMode } from "@/components/ui/VatDisplayToggle";
import {
  getAdviceMarkupInputLabel,
  getRecommendedPriceActionStatus,
  type RecommendedPriceDisplayRow,
} from "@/features/recommended-price/recommendedPriceFormModel";
import { round2 } from "@/lib/pricingEngine";

export type RecommendedPriceChannelGroup = {
  channel: Channel;
  adviesOpslag: number;
  rows: RecommendedPriceDisplayRow[];
};

type RecommendedPriceWorkspaceViewProps = {
  years: number[];
  selectedYear: number;
  vatDisplay: VatDisplayMode;
  yearRows: Array<{ channel: Channel; row: AdviesprijsRow }>;
  channelCodes: string[];
  openChannelCodes: string[];
  channelGroups: RecommendedPriceChannelGroup[];
  status: string;
  isSaving: boolean;
  onYearChange: (year: number) => void;
  onVatDisplayChange: (mode: VatDisplayMode) => void;
  onMarkupChange: (channel: Channel, row: AdviesprijsRow, value: number) => void;
  onSetOpenChannelCodes: (codes: string[]) => void;
  onToggleChannel: (code: string, open: boolean) => void;
  onSave: () => Promise<void>;
};

export function RecommendedPriceWorkspaceView({
  years,
  selectedYear,
  vatDisplay,
  yearRows,
  channelCodes,
  openChannelCodes,
  channelGroups,
  status,
  isSaving,
  onYearChange,
  onVatDisplayChange,
  onMarkupChange,
  onSetOpenChannelCodes,
  onToggleChannel,
  onSave,
}: RecommendedPriceWorkspaceViewProps) {
  if (years.length === 0) {
    return (
      <div className="module-card">
        <div className="module-card-title">Adviesprijzen</div>
        <div className="module-card-text">Nog geen productiejaar gevonden. Maak eerst een productiejaar aan.</div>
      </div>
    );
  }

  const actionStatus = getRecommendedPriceActionStatus(status, isSaving);

  return (
    <section>
      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="module-card-title">Adviesopslag per kanaal</div>
            <div className="module-card-text">Deze opslag gebruiken we om adviesprijzen (sell-out) af te leiden.</div>
          </div>
          <label className="nested-field" style={{ minWidth: 160 }}>
            <span>Jaar</span>
            <select
              className="dataset-input"
              value={String(selectedYear)}
              onChange={(event) => onYearChange(Number(event.target.value))}
              disabled={isSaving}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="editor-actions" style={{ marginBottom: 14 }}>
        <div className="editor-actions-group">
          <VatDisplayToggle value={vatDisplay} onChange={onVatDisplayChange} disabled={isSaving} />
        </div>
        <div className="editor-actions-group" />
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "260px" }}>Kanaal</th>
              <th style={{ width: "220px" }}>Opslag (%)</th>
            </tr>
          </thead>
          <tbody>
            {yearRows.map(({ channel, row }) => (
              <tr key={channel.code}>
                <td>
                  <strong>{channel.naam}</strong>
                  <div className="muted">{channel.code}</div>
                </td>
                <td>
                  <input
                    className="dataset-input"
                    type="number"
                    aria-label={getAdviceMarkupInputLabel(channel.naam)}
                    value={String(row.opslag_pct ?? 0)}
                    onChange={(event) => {
                      const nextValue = Number(event.target.value);
                      onMarkupChange(channel, row, Number.isFinite(nextValue) ? nextValue : 0);
                    }}
                    disabled={isSaving}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="editor-actions" style={{ marginTop: "0.85rem" }}>
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => onSetOpenChannelCodes(channelCodes)}
            disabled={isSaving}
          >
            Alles uitklappen
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => onSetOpenChannelCodes([])}
            disabled={isSaving}
          >
            Alles inklappen
          </button>
        </div>
        <div className="editor-actions-group" />
      </div>

      <div style={{ marginTop: "1rem" }}>
        {channelGroups.map(({ channel, adviesOpslag, rows }) => {
          const code = channel.code;
          const open = openChannelCodes.includes(code);
          return (
            <details
              key={code}
              open={open}
              className="module-card compact-card"
              style={{ marginBottom: "0.9rem" }}
              onToggle={(event) => onToggleChannel(code, event.currentTarget.open)}
            >
              <summary className="module-card-title" style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>{channel.naam}</span>
                <span className="muted">Opslag: {round2(adviesOpslag).toLocaleString("nl-NL")}%</span>
              </summary>
              <div className="module-card-text" style={{ marginTop: "0.4rem" }}>
                Read-only overzicht: berekeningen blijven op excl. BTW; de weergave kan wisselen.
              </div>

              <div className="data-table" style={{ marginTop: "0.8rem" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "220px" }}>Bier</th>
                      <th style={{ width: "200px" }}>Product</th>
                      <th style={{ width: "160px" }}>Kostprijs ({vatDisplay === "incl" ? "incl" : "ex"})</th>
                      <th style={{ width: "160px" }}>Verkoopprijs ({vatDisplay === "incl" ? "incl" : "ex"})</th>
                      <th style={{ width: "240px" }}>Adviesprijs ({vatDisplay === "incl" ? "incl" : "ex"})</th>
                      <th style={{ width: "140px" }}>Opslag</th>
                      <th style={{ width: "140px" }}>Marge klant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${code}:${row.bierId}:${row.productType}:${row.productId}:${row.verpakking}`}>
                        <td>
                          <strong>{row.biernaam}</strong>
                          <div className="muted">{row.productType}</div>
                        </td>
                        <td>{row.verpakking}</td>
                        <td>{money(row.kostprijsShown)}</td>
                        <td>{money(row.sellInShown)}</td>
                        <td>
                          {money(row.adviesMinShown)} - {money(row.adviesMaxShown)}
                          <div className="muted">BTW {round2(row.btwPct)}% (afronding 5 cent incl, naar beneden)</div>
                        </td>
                        <td>{round2(adviesOpslag).toLocaleString("nl-NL")}%</td>
                        <td>{round2(row.margeKlantPct).toLocaleString("nl-NL")}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group" />
        <div className="editor-actions-group">
          {actionStatus ? <ActionStatus {...actionStatus} /> : null}
          <button type="button" className="editor-button" onClick={onSave} disabled={isSaving}>
            {isSaving ? "Opslaan..." : "Opslaan"}
          </button>
        </div>
      </div>
    </section>
  );
}
