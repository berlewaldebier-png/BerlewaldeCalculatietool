"use client";

import { ActionStatus, type ActionStatusState } from "@/components/ActionStatus";
import { VatDisplayToggle, type VatDisplayMode } from "@/components/ui/VatDisplayToggle";
import {
  activeRecommendedPriceStatusLabel,
  type ActiveRecommendedPriceChannel,
  type ActiveRecommendedPriceDisplayRow,
  type ActiveRecommendedPriceProjection,
} from "@/features/recommended-price/activeRecommendedPriceModel";
import { getAdviceMarkupInputLabel } from "@/features/recommended-price/recommendedPriceFormModel";
import { formatMoneyEUR } from "@/lib/formatters";
import { round2 } from "@/lib/pricingEngine";

export type RecommendedPriceChannelGroup = {
  channel: ActiveRecommendedPriceChannel;
  adviceMarkupPct: number | null;
  rows: ActiveRecommendedPriceDisplayRow[];
};

type RecommendedPriceWorkspaceViewProps = {
  projection: ActiveRecommendedPriceProjection;
  vatDisplay: VatDisplayMode;
  drafts: Record<string, number | "">;
  filter: string;
  channelCodes: string[];
  openChannelCodes: string[];
  channelGroups: RecommendedPriceChannelGroup[];
  status: ActionStatusState | null;
  isSaving: boolean;
  dirtyCount: number;
  onVatDisplayChange: (mode: VatDisplayMode) => void;
  onMarkupChange: (channelCode: string, value: number | "") => void;
  onFilterChange: (value: string) => void;
  onSetOpenChannelCodes: (codes: string[]) => void;
  onToggleChannel: (code: string, open: boolean) => void;
  onSave: () => Promise<void>;
};

function money(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "Ontbreekt" : formatMoneyEUR(value);
}

export function RecommendedPriceWorkspaceView({
  projection,
  vatDisplay,
  drafts,
  filter,
  channelCodes,
  openChannelCodes,
  channelGroups,
  status,
  isSaving,
  dirtyCount,
  onVatDisplayChange,
  onMarkupChange,
  onFilterChange,
  onSetOpenChannelCodes,
  onToggleChannel,
  onSave,
}: RecommendedPriceWorkspaceViewProps) {
  if (projection.status !== "ready" || !projection.binding) {
    return (
      <section className="module-card">
        <div className="module-card-title">Geen actieve adviesprijzen</div>
        <div className="module-card-text">
          Er is geen gereed geactiveerde jaarset. Rond eerst Nieuw jaar voorbereiden af of controleer de Jaarsets.
        </div>
        {projection.reason_codes.length > 0 ? (
          <ActionStatus kind="warning" message={projection.reason_codes.join(", ")} />
        ) : null}
      </section>
    );
  }

  const actionCount =
    projection.summary.missing_cost_count +
    projection.summary.missing_sell_in_count +
    projection.summary.missing_vat_count +
    projection.summary.missing_channel_markup_count;

  return (
    <section>
      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div className="module-card-header">
          <div>
            <div className="module-card-title">Adviesopslag per kanaal</div>
            <div className="module-card-text">
              De actieve jaarset bepaalt de SKU&apos;s en kostprijzen. De actuele sell-inprijs uit Verkoopstrategie vormt de vaste basis voor de adviesprijs.
            </div>
          </div>
        </div>
        <div className="editor-toolbar" style={{ marginTop: 12 }}>
          <div className="editor-toolbar-meta">
            <span className="editor-pill">{projection.summary.sku_count} SKU&apos;s</span>
            <span className="editor-pill">{projection.summary.ready_advice_sku_count} berekenbaar</span>
            {actionCount > 0 ? <span className="editor-pill">{actionCount} bronacties</span> : null}
          </div>
          <div className="editor-actions-group">
            <label className="nested-field" style={{ minWidth: 140 }}>
              <span>Jaar</span>
              <select className="dataset-input" value={projection.binding.operational_year} disabled>
                <option value={projection.binding.operational_year}>{projection.binding.operational_year}</option>
              </select>
            </label>
            <label className="nested-field">
              <span>Zoeken</span>
              <input
                className="dataset-input"
                value={filter}
                onChange={(event) => onFilterChange(event.target.value)}
                placeholder="Zoek stijl, SKU of code..."
              />
            </label>
          </div>
        </div>
      </div>

      {projection.summary.missing_vat_count > 0 ? (
        <ActionStatus
          kind="warning"
          message={`${projection.summary.missing_vat_count} SKU's missen een aantoonbaar btw-tarief.`}
          guidance="Deze regels blijven zichtbaar maar krijgen geen berekende adviesprijs totdat de brondata afzonderlijk is hersteld."
        />
      ) : null}

      <div className="editor-actions" style={{ marginBottom: 14 }}>
        <div className="editor-actions-group">
          <VatDisplayToggle value={vatDisplay} onChange={onVatDisplayChange} disabled={isSaving} />
        </div>
        <div className="editor-actions-group" />
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <caption className="sr-only">Actieve adviesopslag per verkoopkanaal</caption>
          <thead>
            <tr>
              <th style={{ width: "260px" }}>Kanaal</th>
              <th style={{ width: "220px" }}>Opslag (%)</th>
              <th>Activatiesnapshot</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {projection.channels.map((channel) => (
              <tr key={channel.channel_code}>
                <td>
                  <strong>{channel.channel_name}</strong>
                  <div className="muted">{channel.channel_code}</div>
                </td>
                <td>
                  <input
                    className="dataset-input"
                    type="number"
                    min="0"
                    step="0.1"
                    aria-label={getAdviceMarkupInputLabel(channel.channel_name)}
                    value={drafts[channel.channel_code] ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      onMarkupChange(
                        channel.channel_code,
                        value === "" ? "" : Number(value)
                      );
                    }}
                    disabled={!channel.editable || isSaving}
                  />
                </td>
                <td>
                  {channel.activation_advice_markup_pct === null
                    ? "Ontbreekt"
                    : `${round2(channel.activation_advice_markup_pct).toLocaleString("nl-NL")}%`}
                </td>
                <td>
                  <span className={`status-pill status-${channel.markup_state === "ready" ? "ok" : "warning"}`}>
                    {channel.markup_state === "ready" ? "opslag gezet" : "controle nodig"}
                  </span>
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
        {channelGroups.map(({ channel, adviceMarkupPct, rows }) => {
          const code = channel.channel_code;
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
                <span>{channel.channel_name}</span>
                <span className="muted">
                  Opslag: {adviceMarkupPct === null ? "ontbreekt" : `${round2(adviceMarkupPct).toLocaleString("nl-NL")}%`}
                </span>
              </summary>
              <div className="module-card-text" style={{ marginTop: "0.4rem" }}>
                Read-only berekening vanuit de actuele SKU-sell-inprijs; afronding blijft op vijf cent inclusief btw naar beneden.
              </div>

              <div className="data-table" style={{ marginTop: "0.8rem" }}>
                <table>
                  <caption className="sr-only">
                    Actieve adviesprijzen voor {channel.channel_name} in {projection.binding?.operational_year}
                  </caption>
                  <thead>
                    <tr>
                      <th style={{ width: "220px" }}>Eigenaar</th>
                      <th style={{ width: "240px" }}>SKU</th>
                      <th style={{ width: "150px" }}>Kostprijs ({vatDisplay === "incl" ? "incl" : "ex"})</th>
                      <th style={{ width: "150px" }}>Sell-in ({vatDisplay === "incl" ? "incl" : "ex"})</th>
                      <th style={{ width: "230px" }}>Adviesprijs ({vatDisplay === "incl" ? "incl" : "ex"})</th>
                      <th style={{ width: "130px" }}>Marge klant</th>
                      <th style={{ width: "190px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={7}>Geen SKU&apos;s gevonden.</td></tr>
                    ) : rows.map((row) => (
                      <tr key={`${code}:${row.skuId}`}>
                        <td>
                          <strong>{row.ownerLabel}</strong>
                          <div className="muted">{row.subjectType}</div>
                        </td>
                        <td>
                          <strong>{row.skuName}</strong>
                          <div className="muted">{row.skuCode || row.skuId}</div>
                        </td>
                        <td>{row.status === "not_applicable" ? "n.v.t." : money(row.kostprijsShown)}</td>
                        <td>{row.status === "not_applicable" ? "n.v.t." : money(row.sellInShown)}</td>
                        <td>
                          {row.adviesMinShown === null || row.adviesMaxShown === null
                            ? row.status === "not_applicable" ? "n.v.t." : "Niet berekenbaar"
                            : `${money(row.adviesMinShown)} - ${money(row.adviesMaxShown)}`}
                          {row.btwPct !== null ? (
                            <div className="muted">BTW {round2(row.btwPct)}% (afronding 5 cent incl, naar beneden)</div>
                          ) : null}
                        </td>
                        <td>{row.margeKlantPct === null ? "n.v.t." : `${round2(row.margeKlantPct).toLocaleString("nl-NL")}%`}</td>
                        <td>
                          <span className={`status-pill status-${row.status === "ready" || row.status === "not_applicable" ? "ok" : "warning"}`}>
                            {activeRecommendedPriceStatusLabel(row.status)}
                          </span>
                        </td>
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
          {status ? <ActionStatus {...status} /> : null}
          {!projection.can_edit ? (
            <span className="muted">Alleen een Administrator kan adviesopslagen wijzigen.</span>
          ) : (
            <button
              type="button"
              className="editor-button"
              onClick={() => void onSave()}
              disabled={isSaving || dirtyCount === 0}
            >
              {isSaving ? "Opslaan..." : `Opslaan${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
