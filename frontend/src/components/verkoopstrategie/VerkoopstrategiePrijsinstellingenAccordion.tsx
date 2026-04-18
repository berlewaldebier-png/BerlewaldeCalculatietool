import React from "react";

import {
  calcMarginPctFromOpslagPct,
  calcOpslagPctFromSellInPrice,
  calcSellPriceFromOpslagPct,
  parseNumberLoose,
  round2
} from "@/lib/verkoopstrategieMath";
import { inputClass, money, num } from "@/components/verkoopstrategie/verkoopstrategieUi";
import { SourceBadge, ResetToParentButton } from "@/components/ui/Overrides";
import type {
  BeerGroup,
  BeerViewRow,
  ChannelLite,
  ChannelYearDefaults,
  ProductOverrideGroup,
  ProductViewRow
} from "@/components/verkoopstrategie/verkoopstrategieTypes";

type Props = {
  activeChannels: ChannelLite[];
  openChannelCodes: string[];
  setOpenChannelCodes: React.Dispatch<React.SetStateAction<string[]>>;
  effectiveSelectedYear: number;
  channelMasterDefaults: ChannelYearDefaults;
  channelYearDefaults: ChannelYearDefaults;
  groupedProductOverrideRows: ProductOverrideGroup[];
  groupedBeerRows: BeerGroup[];
  getDraft: (key: string) => string | undefined;
  setDraft: (key: string, value: string) => void;
  clearDraft: (key: string) => void;
  updateYearSellInPrice: (channelCode: string, value: number | "") => void;
  updateYearMargin: (channelCode: string, value: number | "") => void; // value is opslag%
  updateProductSellInPrice: (productId: string, channelCode: string, value: number | "") => void;
  updateProductMargin: (productId: string, channelCode: string, value: number | "") => void; // value is opslag%
  updateBeerSellInPrice: (row: BeerViewRow, channelCode: string, value: number | "") => void;
  updateBeerMargin: (row: BeerViewRow, channelCode: string, value: number | "") => void; // value is opslag%
  resetChannelOverrides: (channelCode: string) => void;
};

export function VerkoopstrategiePrijsinstellingenAccordion(props: Props) {
  const {
    activeChannels,
    openChannelCodes,
    setOpenChannelCodes,
    effectiveSelectedYear,
    channelMasterDefaults,
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
    updateBeerMargin,
    resetChannelOverrides
  } = props;

  const [showOnlyOverrides, setShowOnlyOverrides] = React.useState(false);

  const rowHasOverrideForChannel = (row: { opslagOverrides?: Record<string, unknown>; sellInPriceOverrides?: Record<string, unknown> }, code: string) =>
    row.opslagOverrides?.[code] !== "" || row.sellInPriceOverrides?.[code] !== "";

  const channelHasAnyOverrides = React.useCallback(
    (code: string) => {
      const master = Number(channelMasterDefaults[code]?.opslag ?? 0);
      const current = Number(channelYearDefaults[code]?.opslag ?? 0);
      if (Number.isFinite(master) && Number.isFinite(current) && Math.abs(master - current) > 1e-9) return true;

      for (const group of groupedProductOverrideRows) {
        for (const row of group.rows) {
          if (rowHasOverrideForChannel(row, code)) return true;
          const draftKey = `year:${effectiveSelectedYear}:channel:${code}:product:${row.productId}:opslag`;
          const draft = getDraft(draftKey);
          if (draft !== undefined && draft !== "") return true;
        }
      }

      for (const beer of groupedBeerRows) {
        for (const row of beer.rows) {
          if (rowHasOverrideForChannel(row, code)) return true;
          const draftKey = `year:${effectiveSelectedYear}:channel:${code}:beer:${row.id}:opslag`;
          const draft = getDraft(draftKey);
          if (draft !== undefined && draft !== "") return true;
        }
      }

      const yearDraftKey = `year:${effectiveSelectedYear}:channel:${code}:defaults`;
      const yearDraft = getDraft(yearDraftKey);
      if (yearDraft !== undefined && yearDraft !== "") return true;

      return false;
    },
    [channelMasterDefaults, channelYearDefaults, effectiveSelectedYear, getDraft, groupedBeerRows, groupedProductOverrideRows]
  );

  const visibleChannels = React.useMemo(() => {
    if (!showOnlyOverrides) return activeChannels;
    return activeChannels.filter((channel) => channelHasAnyOverrides(channel.code));
  }, [activeChannels, channelHasAnyOverrides, showOnlyOverrides]);

  const collapseAll = () => setOpenChannelCodes([]);
  const expandAll = () => setOpenChannelCodes(visibleChannels.map((ch) => ch.code));
  const toggleChannel = (code: string) =>
    setOpenChannelCodes((current) => (current.includes(code) ? current.filter((c) => c !== code) : [...current, code]));

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
            onClick={collapseAll}
            disabled={openChannelCodes.length === 0}
          >
            Alles inklappen
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={expandAll}
            disabled={openChannelCodes.length === visibleChannels.length}
          >
            Alles uitklappen
          </button>
          <label className="nested-field" style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
            <input
              type="checkbox"
              checked={showOnlyOverrides}
              onChange={(event) => setShowOnlyOverrides(event.target.checked)}
            />
            <span className="muted">Toon alleen overrides</span>
          </label>
        </div>
      </div>

      <div className="stack" style={{ gap: "0.75rem" }}>
        {visibleChannels.map((channel) => {
          const isActive = openChannelCodes.includes(channel.code);
          const opslag = round2(Number(channelYearDefaults[channel.code]?.opslag ?? 0));
          const opslagKey = `year:${effectiveSelectedYear}:channel:${channel.code}:defaults`;
          const opslagDraftValue = getDraft(opslagKey);

          return (
            <div key={channel.code} className="module-card compact-card" style={{ padding: 0 }}>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  padding: "0.9rem 1rem",
                  width: "100%",
                  borderRadius: 0,
                  borderColor: isActive ? "#C6D5FF" : undefined,
                  background: isActive ? "#F3F7FF" : undefined
                }}
                onClick={() => toggleChannel(channel.code)}
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
                  <span className="muted" style={{ fontWeight: 650 }}>
                    Opslag:
                  </span>
                  <input
                    className="dataset-input"
                    type="number"
                    step="any"
                    value={opslagDraftValue ?? String(opslag)}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setDraft(opslagKey, raw);
                      if (raw === "") {
                        // Empty = reset to the channel's default (no override) once the draft clears.
                        updateYearSellInPrice(channel.code, "");
                        updateYearMargin(channel.code, "");
                        return;
                      }
                      const parsed = parseNumberLoose(raw);
                      if (!Number.isFinite(parsed)) return;
                      updateYearSellInPrice(channel.code, "");
                      updateYearMargin(channel.code, round2(parsed));
                    }}
                    onBlur={(event) => {
                      const raw = event.target.value;
                      if (raw === "") {
                        clearDraft(opslagKey);
                        updateYearSellInPrice(channel.code, "");
                        updateYearMargin(channel.code, "");
                        return;
                      }
                      const parsed = parseNumberLoose(raw);
                      if (!Number.isFinite(parsed)) {
                        clearDraft(opslagKey);
                        return;
                      }
                      setDraft(opslagKey, String(parsed));
                    }}
                    style={{ width: 96, textAlign: "right" }}
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
                  <div className="editor-actions" style={{ marginBottom: "0.9rem" }}>
                    <div className="editor-actions-group" />
                    <div className="editor-actions-group">
                      <button
                        type="button"
                        className="editor-button editor-button-secondary"
                        onClick={() => resetChannelOverrides(channel.code)}
                      >
                        Reset overrides (kanaal)
                      </button>
                    </div>
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
                                {group.rows.flatMap((row: ProductViewRow, idx) => {
                                  const code = channel.code;
                                  const derivedOpslagRaw = Number(row.activeOpslags?.[code] ?? 0);
                                  const derivedOpslag = round2(derivedOpslagRaw);
                                  const derivedMargin = round2(calcMarginPctFromOpslagPct(derivedOpslagRaw));
                                  const opslagValue = !code ? "" : String(derivedOpslag);
                                  const opslagKey2 = code
                                    ? `year:${effectiveSelectedYear}:channel:${code}:product:${row.productId}:opslag`
                                    : "";
                                  const opslagDraftValue2 = opslagKey2 ? getDraft(opslagKey2) : undefined;
                                  const hasOverride =
                                    Boolean(code) &&
                                    (row.opslagOverrides?.[code] !== "" ||
                                      row.sellInPriceOverrides?.[code] !== "" ||
                                      (opslagDraftValue2 !== undefined && opslagDraftValue2 !== ""));
                                  if (showOnlyOverrides && !hasOverride) return [];

                                  const badge = hasOverride ? (
                                    <SourceBadge kind="override" source="Producttype" />
                                  ) : (
                                    <SourceBadge kind="inherit" source="Kanaal" />
                                  );

                                  return (
                                    <tr key={`${row.productId}::${idx}`}>
                                      <td>
                                        <div style={{ fontWeight: 650 }}>{row.product}</div>
                                        {row.isReadOnly ? <div className="muted">Volgt {row.followsProductLabel}</div> : null}
                                        <div style={{ marginTop: "0.25rem" }}>{badge}</div>
                                      </td>
                                      <td>
                                        <div className="stack" style={{ gap: "0.35rem" }}>
                                          <input
                                            className={`${inputClass(hasOverride)} ${row.isReadOnly ? "dataset-input-readonly" : ""}`.trim()}
                                            type="number"
                                            step="any"
                                            placeholder={code ? String(round2(channelYearDefaults[code]?.opslag ?? 0)) : ""}
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
                                                return;
                                              }
                                              if (!Number.isFinite(nextOpslag)) return;
                                              updateProductSellInPrice(row.productId, code, "");
                                              updateProductMargin(row.productId, code, round2(nextOpslag));
                                            }}
                                            onBlur={(event) => {
                                              if (!opslagKey2) return;
                                              const raw = event.target.value;
                                              if (raw === "") {
                                                clearDraft(opslagKey2);
                                                return;
                                              }
                                              const parsed = parseNumberLoose(raw);
                                              if (!Number.isFinite(parsed)) {
                                                clearDraft(opslagKey2);
                                                return;
                                              }
                                              setDraft(opslagKey2, String(parsed));
                                            }}
                                          />
                                        </div>
                                      </td>
                                      <td>{num(derivedMargin)}%</td>
                                      <td>
                                        {hasOverride && !row.isReadOnly ? (
                                          <ResetToParentButton
                                            onClick={() => {
                                              if (!code) return;
                                              updateProductSellInPrice(row.productId, code, "");
                                              updateProductMargin(row.productId, code, "");
                                              clearDraft(opslagKey2);
                                            }}
                                          />
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
                                {beer.rows.flatMap((row: BeerViewRow, idx) => {
                                  const code = channel.code;
                                  const derivedOpslagRaw = Number(row.activeOpslags?.[code] ?? 0);
                                  // "Volgt"-producten mogen geen eigen prijs-override erven; ze volgen altijd de (eventueel afgeleide) marge/opslag van de "moeder".
                                  const hasPriceOverride = !row.isReadOnly && row.sellInPriceOverrides?.[code] !== "";
                                  const computedSellIn = row.isReadOnly
                                    ? calcSellPriceFromOpslagPct(row.kostprijs ?? 0, derivedOpslagRaw)
                                    : (row.sellInPrices?.[code] ?? 0);
                                  const derivedOpslag = hasPriceOverride
                                    ? calcOpslagPctFromSellInPrice(row.kostprijs ?? 0, computedSellIn)
                                    : derivedOpslagRaw;
                                  const opslagKey3 = code
                                    ? `year:${effectiveSelectedYear}:channel:${code}:beer:${row.id}:opslag`
                                    : "";
                                  const opslagDraftValue3 = opslagKey3 ? getDraft(opslagKey3) : undefined;
                                  const hasOverride =
                                    Boolean(code) &&
                                    (row.opslagOverrides?.[code] !== "" ||
                                      row.sellInPriceOverrides?.[code] !== "" ||
                                      (opslagDraftValue3 !== undefined && opslagDraftValue3 !== ""));
                                  if (showOnlyOverrides && !hasOverride) return [];

                                  const channelDefault = Number(channelYearDefaults[code]?.opslag ?? 0);
                                  const producttypeOpslag = Number(row.productOpslags?.[code] ?? channelDefault);
                                  const inheritsFromProducttype = Math.abs(producttypeOpslag - channelDefault) > 1e-9;
                                  const badge = hasOverride ? (
                                    <SourceBadge
                                      kind="override"
                                      source="Product"
                                      note={hasPriceOverride ? "Prijs" : "Opslag"}
                                    />
                                  ) : inheritsFromProducttype ? (
                                    <SourceBadge kind="inherit" source="Producttype" />
                                  ) : (
                                    <SourceBadge kind="inherit" source="Kanaal" />
                                  );
                                  const opslagValue = !code ? "" : String(round2(derivedOpslag));
                                  const priceValue =
                                    row.isReadOnly || row.sellInPriceOverrides?.[code] === ""
                                      ? ""
                                      : String(row.sellInPriceOverrides?.[code] ?? "");
                                  const derivedMargin = round2(calcMarginPctFromOpslagPct(derivedOpslag));

                                  return (
                                    <tr key={`${row.id ?? row.productId ?? row.product ?? "row"}::${idx}`}>
                                      <td>
                                        <div style={{ fontWeight: 650 }}>{row.product}</div>
                                        {row.isReadOnly ? <div className="muted">Volgt {row.followsProductLabel}</div> : null}
                                        <div style={{ marginTop: "0.25rem" }}>{badge}</div>
                                      </td>
                                      <td>{money(row.kostprijs ?? 0)}</td>
                                      <td>
                                        <div className="stack" style={{ gap: "0.35rem" }}>
                                          <input
                                            className={`${inputClass(hasOverride)} ${row.isReadOnly ? "dataset-input-readonly" : ""}`.trim()}
                                            type="number"
                                            step="any"
                                            placeholder={code ? String(round2(channelYearDefaults[code]?.opslag ?? 0)) : ""}
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
                                                return;
                                              }
                                              if (!Number.isFinite(nextOpslag)) return;
                                              updateBeerSellInPrice(row, code, "");
                                              updateBeerMargin(row, code, round2(nextOpslag));
                                            }}
                                            onBlur={(event) => {
                                              if (!opslagKey3) return;
                                              const raw = event.target.value;
                                              if (raw === "") {
                                                clearDraft(opslagKey3);
                                                return;
                                              }
                                              const parsed = parseNumberLoose(raw);
                                              if (!Number.isFinite(parsed)) {
                                                clearDraft(opslagKey3);
                                                return;
                                              }
                                              setDraft(opslagKey3, String(parsed));
                                            }}
                                          />
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
                                              const nextOpslag = calcOpslagPctFromSellInPrice(row.kostprijs, nextPrice);
                                              updateBeerSellInPrice(row, code, Math.round(nextPrice * 100) / 100);
                                              updateBeerMargin(row, code, round2(nextOpslag));
                                            }}
                                          />
                                      </td>
                                      <td>
                                        {hasOverride && !row.isReadOnly ? (
                                          <ResetToParentButton
                                            onClick={() => {
                                              if (!code) return;
                                              updateBeerSellInPrice(row, code, "");
                                              updateBeerMargin(row, code, "");
                                              clearDraft(opslagKey3);
                                            }}
                                          />
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
