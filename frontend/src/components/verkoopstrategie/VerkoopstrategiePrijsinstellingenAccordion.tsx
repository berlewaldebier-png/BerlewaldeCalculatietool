import React from "react";

import {
  calcMarginPctFromOpslagPct,
  calcMarginPctFromSellInPrice,
  calcOpslagPctFromMarginPct,
  calcOpslagPctFromSellInPrice,
  parseNumberLoose,
  round2
} from "@/lib/verkoopstrategieMath";
import { inputClass, money, num } from "@/components/verkoopstrategie/verkoopstrategieUi";

type Channel = { code: string; naam: string };

type Props = {
  activeChannels: Channel[];
  selectedChannelCode: string;
  setSelectedChannelCode: React.Dispatch<React.SetStateAction<string>>;
  effectiveSelectedYear: number;
  channelYearDefaults: Record<string, { margin?: number; factor?: number }>;
  groupedProductOverrideRows: Array<{ key: string; rows: any[] }>;
  groupedBeerRows: Array<{ biernaam: string; rows: any[] }>;
  getDraft: (key: string) => string | undefined;
  setDraft: (key: string, value: string) => void;
  clearDraft: (key: string) => void;
  updateYearSellInPrice: (channelCode: string, value: number | "") => void;
  updateYearMargin: (channelCode: string, value: number | "") => void;
  updateProductSellInPrice: (productId: string, channelCode: string, value: number | "") => void;
  updateProductMargin: (productId: string, channelCode: string, value: number | "") => void;
  updateBeerSellInPrice: (row: any, channelCode: string, value: number | "") => void;
  updateBeerMargin: (row: any, channelCode: string, value: number | "") => void;
};

export function VerkoopstrategiePrijsinstellingenAccordion(props: Props) {
  const {
    activeChannels,
    selectedChannelCode,
    setSelectedChannelCode,
    effectiveSelectedYear,
    channelYearDefaults,
    groupedProductOverrideRows,
    groupedBeerRows,
    getDraft,
    setDraft,
    clearDraft,
    updateYearSellInPrice,
    updateYearMargin,
    updateProductSellInPrice,
    updateProductMargin,
    updateBeerSellInPrice,
    updateBeerMargin
  } = props;

  return (
    <div className="module-card compact-card">
      <div className="module-card-header" style={{ marginBottom: "0.7rem" }}>
        <div className="module-card-title">Prijsinstellingen</div>
        <div className="module-card-text">Pas prijsinstellingen aan per kanaal, producttype en bier.</div>
      </div>
      <div className="editor-actions" style={{ marginBottom: "0.75rem" }}>
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => setSelectedChannelCode("")}
            disabled={!selectedChannelCode}
          >
            Alles inklappen
          </button>
        </div>
      </div>

      <div className="stack" style={{ gap: "0.75rem" }}>
        {activeChannels.map((channel) => {
          const isActive = selectedChannelCode === channel.code;
          const opslag = calcOpslagPctFromMarginPct(channelYearDefaults[channel.code]?.margin ?? 0);
          const opslagKey = `year:${effectiveSelectedYear}:channel:${channel.code}:defaults`;
          const opslagDraftValue = getDraft(opslagKey);

          return (
            <div key={channel.code} className="module-card compact-card" style={{ padding: 0 }}>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                style={{
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  padding: "0.9rem 1rem",
                  width: "100%",
                  borderRadius: 0,
                  borderColor: isActive ? "#C6D5FF" : undefined,
                  background: isActive ? "#F3F7FF" : undefined
                }}
                onClick={() => setSelectedChannelCode((current) => (current === channel.code ? "" : channel.code))}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontWeight: 750 }}>
                  <span className="muted" style={{ fontSize: "1rem" }}>
                    {isActive ? "v" : ">"}
                  </span>
                  {channel.naam}
                </span>
                <span
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="muted">Standaard:</span>
                  <span className="muted">+</span>
                  <input
                    className="dataset-input"
                    type="number"
                    step="any"
                    value={opslagDraftValue ?? String(round2(opslag))}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setDraft(opslagKey, raw);
                      const parsed = parseNumberLoose(raw);
                      if (!Number.isFinite(parsed)) return;
                      const nextMargin = calcMarginPctFromOpslagPct(parsed);
                      updateYearSellInPrice(channel.code, "");
                      updateYearMargin(channel.code, round2(nextMargin));
                    }}
                    onBlur={(event) => {
                      const raw = event.target.value;
                      const parsed = parseNumberLoose(raw);
                      if (!Number.isFinite(parsed)) {
                        clearDraft(opslagKey);
                        return;
                      }
                      setDraft(opslagKey, String(parsed));
                    }}
                    style={{ width: 96 }}
                  />
                  <span className="muted">%</span>
                </span>
              </button>

              {isActive ? (
                <div style={{ padding: "0.9rem 1rem", borderTop: "1px solid #E5EAF5" }}>
                  <div className="module-card-text" style={{ marginBottom: "0.8rem" }}>
                    Vul <strong>opslag</strong> in om een verkoopprijs te laten berekenen. Je kunt ook de verkoopprijs
                    invullen (psychologische prijs); opslag en marge worden dan afgeleid.
                  </div>

                  <details open className="module-card compact-card" style={{ marginBottom: "0.9rem" }}>
                    <summary className="module-card-title" style={{ cursor: "pointer" }}>
                      Producttypes
                    </summary>
                    <div className="module-card-text" style={{ marginTop: "0.35rem", marginBottom: "0.8rem" }}>
                      Producttypes zijn generiek. We tonen een voorbeeld-kostprijs van EUR 1,00 om opslag en marge te
                      visualiseren.
                    </div>
                    {groupedProductOverrideRows.length === 0 ? (
                      <div className="dataset-empty">Geen producttypes gevonden.</div>
                    ) : (
                      groupedProductOverrideRows.map((group) => (
                        <details key={group.key} open style={{ marginBottom: "0.75rem" }}>
                          <summary className="muted" style={{ cursor: "pointer" }}>
                            {group.key} ({group.rows.length})
                          </summary>
                          <div className="data-table" style={{ marginTop: "0.6rem" }}>
                            <table>
                              <thead>
                                <tr>
                                  <th>Product</th>
                                  <th>Opslag</th>
                                  <th>Marge</th>
                                  <th />
                                </tr>
                              </thead>
                              <tbody>
                                {group.rows.map((row, idx) => {
                                  const code = channel.code;
                                  const derivedMargin = row.activeMargins?.[code] ?? 0;
                                  const derivedOpslag = calcOpslagPctFromMarginPct(derivedMargin);
                                  const opslagValue = !code ? "" : String(round2(derivedOpslag));
                                  const hasOverride =
                                    Boolean(code) &&
                                    (row.marginOverrides?.[code] !== "" || row.sellInPriceOverrides?.[code] !== "");
                                  const opslagKey2 = code
                                    ? `year:${effectiveSelectedYear}:channel:${code}:product:${row.productId}:opslag`
                                    : "";
                                  const opslagDraftValue2 = opslagKey2 ? getDraft(opslagKey2) : undefined;

                                  return (
                                    <tr key={`${row.productId}::${idx}`}>
                                      <td>
                                        <div style={{ fontWeight: 650 }}>{row.product}</div>
                                        {row.isReadOnly ? <div className="muted">Volgt {row.followsProductLabel}</div> : null}
                                      </td>
                                      <td>
                                        <div className="stack" style={{ gap: "0.35rem" }}>
                                          <input
                                            className={`${inputClass(hasOverride)} ${row.isReadOnly ? "dataset-input-readonly" : ""}`.trim()}
                                            type="number"
                                            step="any"
                                            placeholder={code ? String(round2(calcOpslagPctFromMarginPct(channelYearDefaults[code]?.margin ?? 0))) : ""}
                                            value={opslagDraftValue2 ?? opslagValue}
                                            readOnly={row.isReadOnly}
                                            onChange={(event) => {
                                              if (!code) return;
                                              const raw = event.target.value;
                                              if (opslagKey2) setDraft(opslagKey2, raw);
                                              const parsed = parseNumberLoose(raw);
                                              const nextOpslag = raw === "" ? "" : parsed;
                                              if (nextOpslag === "") {
                                                updateProductSellInPrice(row.productId, code, "");
                                                updateProductMargin(row.productId, code, "");
                                                clearDraft(opslagKey2);
                                                return;
                                              }
                                              if (!Number.isFinite(nextOpslag)) return;
                                              const nextMargin = calcMarginPctFromOpslagPct(nextOpslag);
                                              updateProductSellInPrice(row.productId, code, "");
                                              updateProductMargin(row.productId, code, round2(nextMargin));
                                            }}
                                            onBlur={(event) => {
                                              if (!opslagKey2) return;
                                              const raw = event.target.value;
                                              const parsed = parseNumberLoose(raw);
                                              if (!Number.isFinite(parsed)) {
                                                clearDraft(opslagKey2);
                                                return;
                                              }
                                              setDraft(opslagKey2, String(parsed));
                                            }}
                                          />
                                          {!hasOverride ? <div className="muted">Erft standaard</div> : null}
                                        </div>
                                      </td>
                                      <td>{num(derivedMargin)}%</td>
                                      <td>
                                        {hasOverride && !row.isReadOnly ? (
                                          <button
                                            type="button"
                                            className="editor-button editor-button-secondary"
                                            onClick={() => {
                                              if (!code) return;
                                              updateProductSellInPrice(row.productId, code, "");
                                              updateProductMargin(row.productId, code, "");
                                            }}
                                          >
                                            Reset
                                          </button>
                                        ) : null}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      ))
                    )}
                  </details>

                  <details open className="module-card compact-card">
                    <summary className="module-card-title" style={{ cursor: "pointer" }}>
                      Bieren
                    </summary>
                    {groupedBeerRows.length === 0 ? (
                      <div className="dataset-empty">Nog geen actieve kostprijsversies gevonden voor {effectiveSelectedYear}.</div>
                    ) : (
                      groupedBeerRows.map((beer) => (
                        <details key={beer.biernaam} open style={{ marginBottom: "0.75rem" }}>
                          <summary style={{ cursor: "pointer", fontWeight: 650 }}>
                            {beer.biernaam} ({beer.rows.length})
                          </summary>
                          <div className="data-table" style={{ marginTop: "0.6rem" }}>
                            <table>
                              <thead>
                                <tr>
                                  <th>Product</th>
                                  <th>Kostprijs</th>
                                  <th>Opslag</th>
                                  <th>Marge</th>
                                  <th>Verkoopprijs</th>
                                  <th />
                                </tr>
                              </thead>
                              <tbody>
                                {beer.rows.map((row, idx) => {
                                  const code = channel.code;
                                  const derivedMargin = row.activeMargins?.[code] ?? 0;
                                  // "Volgt"-producten mogen geen eigen prijs-override erven; ze volgen altijd de (eventueel afgeleide) marge/opslag van de "moeder".
                                  const hasPriceOverride = !row.isReadOnly && row.sellInPriceOverrides?.[code] !== "";
                                  const computedSellIn = row.isReadOnly
                                    ? calcSellPrice(row.kostprijs ?? 0, derivedMargin)
                                    : (row.sellInPrices?.[code] ?? 0);
                                  const derivedOpslag = hasPriceOverride
                                    ? calcOpslagPctFromSellInPrice(row.kostprijs ?? 0, computedSellIn)
                                    : calcOpslagPctFromMarginPct(derivedMargin);
                                  const hasOverride =
                                    Boolean(code) &&
                                    (row.marginOverrides?.[code] !== "" || row.sellInPriceOverrides?.[code] !== "");
                                  const opslagValue = !code ? "" : String(round2(derivedOpslag));
                                  const opslagKey3 = code
                                    ? `year:${effectiveSelectedYear}:channel:${code}:beer:${row.id}:opslag`
                                    : "";
                                  const opslagDraftValue3 = opslagKey3 ? getDraft(opslagKey3) : undefined;
                                  const priceValue =
                                    row.isReadOnly || row.sellInPriceOverrides?.[code] === ""
                                      ? ""
                                      : String(row.sellInPriceOverrides?.[code] ?? "");

                                  return (
                                    <tr key={`${row.id ?? row.productId ?? row.product ?? "row"}::${idx}`}>
                                      <td>
                                        <div style={{ fontWeight: 650 }}>{row.product}</div>
                                        {row.isReadOnly ? <div className="muted">Volgt {row.followsProductLabel}</div> : null}
                                      </td>
                                      <td>{money(row.kostprijs ?? 0)}</td>
                                      <td>
                                        <div className="stack" style={{ gap: "0.35rem" }}>
                                          <input
                                            className={`${inputClass(hasOverride)} ${row.isReadOnly ? "dataset-input-readonly" : ""}`.trim()}
                                            type="number"
                                            step="any"
                                            placeholder={code ? String(round2(calcOpslagPctFromMarginPct(channelYearDefaults[code]?.margin ?? 0))) : ""}
                                            value={opslagDraftValue3 ?? opslagValue}
                                            readOnly={row.isReadOnly || hasPriceOverride}
                                            onChange={(event) => {
                                              if (hasPriceOverride) return;
                                              if (!code) return;
                                              const raw = event.target.value;
                                              if (opslagKey3) setDraft(opslagKey3, raw);
                                              const parsed = parseNumberLoose(raw);
                                              const nextOpslag = raw === "" ? "" : parsed;
                                              if (nextOpslag === "") {
                                                updateBeerSellInPrice(row, code, "");
                                                updateBeerMargin(row, code, "");
                                                clearDraft(opslagKey3);
                                                return;
                                              }
                                              if (!Number.isFinite(nextOpslag)) return;
                                              const nextMargin = calcMarginPctFromOpslagPct(nextOpslag);
                                              updateBeerSellInPrice(row, code, "");
                                              updateBeerMargin(row, code, round2(nextMargin));
                                            }}
                                            onBlur={(event) => {
                                              if (!opslagKey3) return;
                                              const raw = event.target.value;
                                              const parsed = parseNumberLoose(raw);
                                              if (!Number.isFinite(parsed)) {
                                                clearDraft(opslagKey3);
                                                return;
                                              }
                                              setDraft(opslagKey3, String(parsed));
                                            }}
                                          />
                                          {!hasOverride ? <div className="muted">Erft standaard</div> : null}
                                        </div>
                                      </td>
                                      <td>{num(derivedMargin)}%</td>
                                      <td>
                                        <input
                                          className={`${inputClass(priceValue !== "")} ${row.isReadOnly ? "dataset-input-readonly" : ""}`.trim()}
                                          type="number"
                                          step="any"
                                          placeholder={String(Math.round(computedSellIn * 100) / 100)}
                                          value={priceValue}
                                          readOnly={row.isReadOnly}
                                          onChange={(event) => {
                                            if (!code) return;
                                            const nextPrice = event.target.value === "" ? "" : Number(event.target.value);
                                            if (nextPrice === "") {
                                              updateBeerSellInPrice(row, code, "");
                                              return;
                                            }
                                            const nextMargin = calcMarginPctFromSellInPrice(row.kostprijs, nextPrice);
                                            updateBeerSellInPrice(row, code, Math.round(nextPrice * 100) / 100);
                                            updateBeerMargin(row, code, Math.round(nextMargin * 100) / 100);
                                          }}
                                        />
                                      </td>
                                      <td>
                                        {hasOverride && !row.isReadOnly ? (
                                          <button
                                            type="button"
                                            className="editor-button editor-button-secondary"
                                            onClick={() => {
                                              if (!code) return;
                                              updateBeerSellInPrice(row, code, "");
                                              updateBeerMargin(row, code, "");
                                            }}
                                          >
                                            Reset
                                          </button>
                                        ) : null}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      ))
                    )}
                  </details>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
