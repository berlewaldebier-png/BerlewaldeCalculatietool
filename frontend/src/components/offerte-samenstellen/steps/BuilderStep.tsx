"use client";

import React, { useMemo } from "react";

import {
  getProductRef,
} from "@/components/offerte-samenstellen/quoteUtils";
import { normalizeQuantity } from "@/lib/quantityNormalization";
import type { DealContext, MixSource } from "@/components/offerte-samenstellen/types";
import type {
  BuilderBlock,
  OptionType,
  ProductOption,
  QuoteProduct,
  QuoteScenario,
  ScenarioMetrics,
  ToolbarGroup,
} from "@/components/offerte-samenstellen/types";
import { BuilderBlockCard } from "@/components/offerte-samenstellen/steps/BuilderBlockCard";
import { IconTrash } from "@/components/offerte-samenstellen/offerteSamenstellenConfig";
import { clampNumber, euro } from "@/components/offerte-samenstellen/offerteSamenstellenUi";
import { WarningIcon } from "@/components/kostprijsbeheer/KostprijsBeheerParts";

type ScenarioId = "A" | "B" | "C";
type UnitMode = "producten" | "liters";
type VatMode = "incl" | "excl";
type Scenario = QuoteScenario;

function isPricingActionBlock(block: BuilderBlock) {
  return (
    block.type === "Staffel" ||
    block.type === "Korting" ||
    block.type === "Mix" ||
    block.type === "Groothandel"
  );
}

function usesBaseOfferProducts(block: BuilderBlock | undefined) {
  return Boolean(block?.payload?.useBaseOfferProducts ?? true);
}

function readNumber(value: unknown, fallback: number) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stepForRoundingMode(mode: string, unitsPerLayer: number | null, unitsPerPallet: number | null) {
  if (mode === "full_pallets" && unitsPerPallet && unitsPerPallet > 0) return unitsPerPallet;
  if (mode === "full_layers" && unitsPerLayer && unitsPerLayer > 0) return unitsPerLayer;
  return 1;
}

export function BuilderStep({
  unitMode,
  vatMode,
  hasIntro,
  quoteYear,
  scenario,
  metrics,
  dealContext,
  setDealContext,
  mixSource,
  setMixSource,
  customerMixPctByRef,
  portfolioMixPctByRef,
  targetVolumeLiters,
  setTargetVolumeLiters,
  agreementVolumeLiters,
  setAgreementVolumeLiters,
  mixLiters,
  onChangeMixLiters,
  activeScenario,
  setActiveScenario,
  updateProduct,
  addProductRow,
  removeProductRow,
  removeBlock,
  toolbarGroups,
  openOption,
  editOption,
  optionAvailability,
  onNext,
  productOptions,
  onSelectRowOption,
  warnings,
  incompatibilityHints,
  onSave,
  isSaving,
}: {
  unitMode: UnitMode;
  vatMode: VatMode;
  hasIntro: boolean;
  quoteYear: number;
  scenario: Scenario;
  metrics: ScenarioMetrics;
  dealContext: DealContext;
  setDealContext: (next: DealContext) => void;
  mixSource: MixSource;
  setMixSource: (next: MixSource) => void;
  customerMixPctByRef: Record<string, number>;
  portfolioMixPctByRef: Record<string, number>;
  targetVolumeLiters: number | null;
  setTargetVolumeLiters: (next: number | null) => void;
  agreementVolumeLiters: number | null;
  setAgreementVolumeLiters: (next: number | null) => void;
  mixLiters: number;
  onChangeMixLiters: (liters: number) => void;
  activeScenario: ScenarioId;
  setActiveScenario: (id: ScenarioId) => void;
  updateProduct: (productId: string, patch: Partial<QuoteProduct>) => void;
  addProductRow: () => void;
  removeProductRow: (productId: string) => void;
  removeBlock: (blockId: string) => void;
  toolbarGroups: ToolbarGroup[];
  openOption: (type: OptionType) => void;
  editOption: (block: BuilderBlock) => void;
  optionAvailability: Record<OptionType, { allowed: boolean; reasons: string[] }>;
  onNext: () => void;
  productOptions: ProductOption[];
  onSelectRowOption: (rowId: string, optionId: string) => void;
  warnings: string[];
  incompatibilityHints: string[];
  onSave: () => void;
  isSaving: boolean;
}) {
  const productOptionIds = useMemo(() => {
    return new Set(productOptions.map((option) => option.optionId));
  }, [productOptions]);

  const introBlocks = scenario.blocks.filter((block) => (block.appliesTo ?? "standard") === "intro");
  const standardBlocks = scenario.blocks.filter((block) => (block.appliesTo ?? "standard") === "standard");
  const globalBlocks = scenario.blocks.filter((block) => (block.appliesTo ?? "standard") === "global");
  const standardPricingBlock = standardBlocks.find((block) => isPricingActionBlock(block));
  const basisOfferteActive = !standardPricingBlock || usesBaseOfferProducts(standardPricingBlock);

  const palletDefaults = useMemo(() => {
    const block = globalBlocks.find((b) => b.type === "Palletopbouw");
    const payload = (block?.payload ?? {}) as Record<string, unknown>;
    return {
      doosUnitsPerLayer: readNumber(payload.doosUnitsPerLayer, 12),
      doosUnitsPerPallet: readNumber(payload.doosUnitsPerPallet, 72),
      fustUnitsPerLayer: readNumber(payload.fustUnitsPerLayer, 20),
      fustUnitsPerPallet: readNumber(payload.fustUnitsPerPallet, 40),
    };
  }, [globalBlocks]);

  const quoteMixPctByRef = useMemo(() => {
    const out: Record<string, number> = {};
    const rows = scenario.products.filter((p) => !Boolean((p as any).isMixLiters));
    const withRef = rows
      .map((row) => {
        const ref = getProductRef(row);
        const liters = Math.max(0, (row.qty ?? 0) * Math.max(0, row.litersPerUnit ?? 0));
        return { ref, liters };
      })
      .filter((row) => Boolean(row.ref) && row.liters > 0) as Array<{ ref: string; liters: number }>;
    const total = withRef.reduce((sum, row) => sum + row.liters, 0);
    if (total <= 0) return out;
    withRef.forEach((row) => {
      out[row.ref] = (row.liters / total) * 100;
    });
    return out;
  }, [scenario.products]);

  return (
    <div className="cpq-stack">
      <div className="cpq-builder-header">
        <div>
          <h2 className="cpq-card-title">Offerte maken</h2>
          <p className="cpq-card-subtitle">Start simpel met producten en breid uit met blokken via de toolbar.</p>
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="cpq-alert">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      {incompatibilityHints.length > 0 ? (
        <div className="cpq-alert cpq-alert-warn">
          {incompatibilityHints.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      <div className="cpq-card" style={{ padding: 14 }}>
        <div className="cpq-label" style={{ marginBottom: 8 }}>
          Mix voor berekening
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className={`cpq-toggle${mixSource === "quote" ? " active" : ""}`}
            onClick={() => setMixSource("quote")}
            title="Gebruik de verdeling van de producten in deze offerte."
          >
            Quote-mix
          </button>
          <button
            type="button"
            className={`cpq-toggle${mixSource === "customer" ? " active" : ""}`}
            onClick={() => setMixSource("customer")}
            title={Object.keys(customerMixPctByRef).length > 0 ? "Gebruik de historische klantmix." : "Geen klantmix beschikbaar; valt terug op portfolio."}
          >
            Klantmix
          </button>
          <button
            type="button"
            className={`cpq-toggle${mixSource === "portfolio" ? " active" : ""}`}
            onClick={() => setMixSource("portfolio")}
            title="Gebruik de totale portfolio mix (gerealiseerd)."
          >
            Portfolio-mix
          </button>
          <span className="cpq-muted" style={{ marginLeft: 6 }}>
            Percentages zijn informatief en sturen de berekening alleen als je geen productspecificatie hebt.
          </span>
        </div>
      </div>

      <div className="cpq-toolbar">
        <div className="cpq-toolbar-inner">
          {toolbarGroups.map((group) => (
            <div key={group.title} className="cpq-toolbar-group">
              <div className="cpq-toolbar-title">{group.title}</div>
              {group.items.map((item) => {
                const availability = optionAvailability[item.label];
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => openOption(item.label)}
                    className="cpq-tool"
                    title={availability.allowed ? item.label : `${item.label} — ${availability.reasons.join(" ")}`}
                    disabled={!availability.allowed}
                  >
                    <span className="cpq-tool-icon">{item.icon}</span>
                    <span className="cpq-tool-tooltip">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {basisOfferteActive ? (
        <section className="cpq-card">
          <div className="cpq-card-header cpq-card-header-row">
            <div>
              <h3 className="cpq-card-title">Basisofferte</h3>
              <p className="cpq-card-subtitle">Basisprijs komt uit verkoopstrategie (sell-in, ex). BTW-toggle is alleen weergave.</p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              {mixLiters <= 0 ? (
                <button
                  type="button"
                  className="cpq-button cpq-button-secondary"
                  onClick={() => onChangeMixLiters(1)}
                  title="Voeg een regel toe om totale liters (mix) op te geven zonder productselectie."
                >
                  + Liters toevoegen
                </button>
              ) : null}
              <button onClick={addProductRow} className="cpq-button cpq-button-secondary" type="button">
                + Product toevoegen
              </button>
            </div>
          </div>

          <div className="cpq-table-wrap">
            <table className="cpq-table">
              <thead>
                <tr>
                  <th>Bier</th>
                  <th>Aantal</th>
                  <th>Afronden</th>
                  <th>Weergave</th>
                  <th>Kostprijs</th>
                  <th>Verkoopprijs</th>
                  <th>Verkoopprijs actie</th>
                  <th>Totaal</th>
                  <th className="cpq-table-action-cell" aria-label="Acties" />
                </tr>
              </thead>
              <tbody>
                {scenario.products.map((product) => {
                  const productRef = getProductRef(product);
                  const hasCurrentOption = productRef ? productOptionIds.has(productRef) : false;
                  const pricing = metrics.pricingByRef[productRef];
                  const mixPct = (() => {
                    if (!productRef) return null;
                    if (mixSource === "customer") return customerMixPctByRef[productRef] ?? portfolioMixPctByRef[productRef] ?? null;
                    if (mixSource === "portfolio") return portfolioMixPctByRef[productRef] ?? null;
                    return quoteMixPctByRef[productRef] ?? null;
                  })();
                  const display =
                    unitMode === "liters"
                      ? `${(product.qty * product.litersPerUnit).toFixed(1)} L`
                      : `${product.qty} ${product.unit}`;
                  const vatFactor = vatMode === "incl" ? 1 + Math.max(0, clampNumber(product.vatRatePct, 0)) / 100 : 1;
                  const baseUnitPriceEx = pricing?.baseUnitPriceEx ?? product.standardPriceEx;
                  const offerUnitPriceEx = pricing?.offerUnitPriceEx ?? product.standardPriceEx;
                  const costUnitPrice = product.costPriceEx * vatFactor;
                  const baseUnitPrice = baseUnitPriceEx * vatFactor;
                  const offerUnitPrice = offerUnitPriceEx * vatFactor;
                  const totalPrice = product.qty * offerUnitPriceEx * vatFactor;
                  const isMixLiters = Boolean((product as any).isMixLiters);
                  const qtyInputValue = isMixLiters
                    ? product.qty
                    : unitMode === "liters"
                      ? product.qty * product.litersPerUnit
                      : product.qty;
                  const roundingModeForRow = String((product as any).roundingMode ?? "none");
                  const unitLabelForRow = String(product.unit ?? "stuk");
                  const unitsPerLayerForRow =
                    unitLabelForRow === "doos"
                      ? palletDefaults.doosUnitsPerLayer
                      : unitLabelForRow === "fust"
                        ? palletDefaults.fustUnitsPerLayer
                        : (typeof (product as any).unitsPerLayer === "number" ? (product as any).unitsPerLayer : null);
                  const unitsPerPalletForRow =
                    unitLabelForRow === "doos"
                      ? palletDefaults.doosUnitsPerPallet
                      : unitLabelForRow === "fust"
                        ? palletDefaults.fustUnitsPerPallet
                        : (typeof (product as any).unitsPerPallet === "number" ? (product as any).unitsPerPallet : null);
                  const stepUnits = stepForRoundingMode(roundingModeForRow, unitsPerLayerForRow, unitsPerPalletForRow);
                  const stepValue = (() => {
                    if (unitMode !== "liters") return stepUnits;
                    if (isMixLiters) {
                      const packUnit = String((product as any).mixPackUnit ?? "doos");
                      const litersPerUnit = packUnit === "fust" ? 20 : 7.92;
                      const unitsPerLayer = packUnit === "fust" ? palletDefaults.fustUnitsPerLayer : palletDefaults.doosUnitsPerLayer;
                      const unitsPerPallet = packUnit === "fust" ? palletDefaults.fustUnitsPerPallet : palletDefaults.doosUnitsPerPallet;
                      const stepUnitsForMix = stepForRoundingMode(roundingModeForRow, unitsPerLayer, unitsPerPallet);
                      return stepUnitsForMix * litersPerUnit;
                    }
                    return stepUnits * Math.max(0, product.litersPerUnit);
                  })();

                  return (
                    <tr key={product.id}>
                      <td>
                        {isMixLiters ? (
                          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            <div className="cpq-muted" style={{ fontWeight: 700 }}>
                              Totaal liters (mix)
                            </div>
                            <select
                              className="cpq-select"
                              value={String((product as any).mixPackUnit ?? "doos")}
                              onChange={(e) => updateProduct(product.id, { mixPackUnit: e.target.value as any })}
                              title="Gebruik dit alleen voor logistiek (palletopbouw/afronden). Financiële berekening blijft per liter."
                            >
                              <option value="doos">Verzenden als: doos</option>
                              <option value="fust">Verzenden als: fust</option>
                            </select>
                          </div>
                        ) : (
                        <select
                          className="cpq-select"
                          value={productRef || ""}
                          onChange={(e) => onSelectRowOption(product.id, e.target.value)}
                        >
                          <option value="">Kies product…</option>
                          {!hasCurrentOption && productRef ? (
                            <option value={productRef}>
                              {(product.name || "Geselecteerd product") + (product.pack ? ` · ${product.pack}` : "")} (niet actief)
                            </option>
                          ) : null}
                          {productOptions.map((opt) => (
                            <option key={opt.optionId} value={opt.optionId}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        )}
                        {!isMixLiters && productRef ? (
                          <div className="cpq-muted" style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
                            <span>Mix:</span>
                            {mixPct === null ? (
                              <span title="Geen mix-percentage beschikbaar voor dit product.">
                                —
                              </span>
                            ) : (
                              <span>{mixPct.toFixed(1)}%</span>
                            )}
                            {mixSource !== "quote" && mixPct === null ? (
                              <span title="Mixdata ontbreekt; gebruik quote-mix of portfolio-mix." style={{ color: "#d97706", display: "inline-flex", alignItems: "center" }}>
                                <WarningIcon />
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={stepValue > 0 ? stepValue : 1}
                          value={Number.isFinite(qtyInputValue) ? qtyInputValue : 0}
                          onChange={(e) => {
                            const raw = Math.max(0, clampNumber(e.target.value, 0));
                            if (isMixLiters) {
                              const packUnit = String((product as any).mixPackUnit ?? "doos");
                              const assumedLitersPerUnit = packUnit === "fust" ? 20 : 7.92;
                              const effectiveUnitsPerLayer = packUnit === "fust" ? palletDefaults.fustUnitsPerLayer : palletDefaults.doosUnitsPerLayer;
                              const effectiveUnitsPerPallet = packUnit === "fust" ? palletDefaults.fustUnitsPerPallet : palletDefaults.doosUnitsPerPallet;
                              const normalized = normalizeQuantity({
                                inputValue: raw,
                                inputUnit: "liters",
                                roundingMode: roundingModeForRow as any,
                                salesUnit: {
                                  salesUnitLabel: packUnit,
                                  litersPerSalesUnit: assumedLitersPerUnit,
                                  unitsPerLayer: effectiveUnitsPerLayer,
                                  unitsPerPallet: effectiveUnitsPerPallet,
                                  contributesToLiters: true,
                                },
                              });
                              const roundedLiters = (normalized.normalizedUnits ?? 0) * assumedLitersPerUnit;
                              updateProduct(product.id, { qty: roundedLiters });
                              return;
                            }

                            const litersPerUnit = Math.max(0, clampNumber(product.litersPerUnit, 0));
                            const roundingMode = roundingModeForRow as any;
                            const unitLabel = String(product.unit ?? "stuk");
                            const effectiveUnitsPerLayer =
                              unitLabel === "doos"
                                ? palletDefaults.doosUnitsPerLayer
                                : unitLabel === "fust"
                                  ? palletDefaults.fustUnitsPerLayer
                                  : ((product as any).unitsPerLayer ?? null);
                            const effectiveUnitsPerPallet =
                              unitLabel === "doos"
                                ? palletDefaults.doosUnitsPerPallet
                                : unitLabel === "fust"
                                  ? palletDefaults.fustUnitsPerPallet
                                  : ((product as any).unitsPerPallet ?? null);

                            const normalized = normalizeQuantity({
                              inputValue: raw,
                              inputUnit: unitMode === "liters" ? "liters" : "sales_units",
                              roundingMode,
                              salesUnit: {
                                salesUnitLabel: unitLabel,
                                litersPerSalesUnit: litersPerUnit > 0 ? litersPerUnit : null,
                                unitsPerLayer: effectiveUnitsPerLayer ?? null,
                                unitsPerPallet: effectiveUnitsPerPallet ?? null,
                                contributesToLiters: litersPerUnit > 0,
                              },
                            });

                            const nextQty = normalized.normalizedUnits ?? 0;
                            updateProduct(product.id, { qty: nextQty });
                          }}
                          className="cpq-input cpq-input-small"
                        />
                      </td>
                      <td>
                        {isMixLiters ? (
                          <select
                            className="cpq-select"
                            value={String((product as any).roundingMode ?? "none")}
                            onChange={(e) => {
                              const nextMode = e.target.value as any;
                              const packUnit = String((product as any).mixPackUnit ?? "doos");
                              const assumedLitersPerUnit = packUnit === "fust" ? 20 : 7.92;
                              const effectiveUnitsPerLayer =
                                packUnit === "fust"
                                  ? palletDefaults.fustUnitsPerLayer
                                  : palletDefaults.doosUnitsPerLayer;
                              const effectiveUnitsPerPallet =
                                packUnit === "fust"
                                  ? palletDefaults.fustUnitsPerPallet
                                  : palletDefaults.doosUnitsPerPallet;
                              const normalized = normalizeQuantity({
                                inputValue: Math.max(0, product.qty ?? 0),
                                inputUnit: "liters",
                                roundingMode: nextMode,
                                salesUnit: {
                                  salesUnitLabel: packUnit,
                                  litersPerSalesUnit: assumedLitersPerUnit,
                                  unitsPerLayer: effectiveUnitsPerLayer,
                                  unitsPerPallet: effectiveUnitsPerPallet,
                                  contributesToLiters: true,
                                },
                              });
                              const roundedLiters = (normalized.normalizedUnits ?? 0) * assumedLitersPerUnit;
                              updateProduct(product.id, { roundingMode: nextMode, qty: roundedLiters });
                            }}
                          >
                            <option value="none">Niet afronden</option>
                            <option value="exact_units">Exacte eenheden</option>
                            <option value="full_layers">Volle lagen</option>
                            <option value="full_pallets">Volle pallets</option>
                          </select>
                        ) : (
                          <select
                            className="cpq-select"
                            value={String((product as any).roundingMode ?? "none")}
                            onChange={(e) => {
                              const nextMode = e.target.value as any;
                              const litersPerUnit = Math.max(0, clampNumber(product.litersPerUnit, 0));
                              const unitLabel = String(product.unit ?? "stuk");
                              const effectiveUnitsPerLayer =
                                unitLabel === "doos"
                                  ? palletDefaults.doosUnitsPerLayer
                                  : unitLabel === "fust"
                                    ? palletDefaults.fustUnitsPerLayer
                                    : ((product as any).unitsPerLayer ?? null);
                              const effectiveUnitsPerPallet =
                                unitLabel === "doos"
                                  ? palletDefaults.doosUnitsPerPallet
                                  : unitLabel === "fust"
                                    ? palletDefaults.fustUnitsPerPallet
                                    : ((product as any).unitsPerPallet ?? null);
                              const inputValue =
                                unitMode === "liters"
                                  ? Math.max(0, (product.qty ?? 0) * litersPerUnit)
                                  : Math.max(0, product.qty ?? 0);

                              const normalized = normalizeQuantity({
                                inputValue,
                                inputUnit: unitMode === "liters" ? "liters" : "sales_units",
                                roundingMode: nextMode,
                                salesUnit: {
                                  salesUnitLabel: unitLabel,
                                  litersPerSalesUnit: litersPerUnit > 0 ? litersPerUnit : null,
                                  unitsPerLayer: effectiveUnitsPerLayer ?? null,
                                  unitsPerPallet: effectiveUnitsPerPallet ?? null,
                                  contributesToLiters: litersPerUnit > 0,
                                },
                              });

                              updateProduct(product.id, {
                                roundingMode: nextMode,
                                qty: normalized.normalizedUnits ?? 0,
                              });
                            }}
                          >
                            <option value="none">Niet afronden</option>
                            <option value="exact_units">Exacte eenheden</option>
                            <option value="full_layers">Volle lagen</option>
                            <option value="full_pallets">Volle pallets</option>
                          </select>
                        )}
                      </td>
                      <td className="cpq-muted">{display}</td>
                      <td>{euro(costUnitPrice)}</td>
                      <td>{euro(baseUnitPrice)}</td>
                      <td>{euro(offerUnitPrice)}</td>
                      <td className="cpq-strong">{euro(totalPrice)}</td>
                      <td className="cpq-table-action-cell">
                        <button
                          type="button"
                          className="cpq-icon-action"
                          onClick={() => removeProductRow(product.id)}
                          aria-label={`Verwijder ${product.name || "productregel"}`}
                          title="Verwijderen"
                        >
                          <IconTrash />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {scenario.products.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="cpq-empty">
                      Nog geen producten toegevoegd.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {scenario.products.some((p) => !Boolean((p as any).isMixLiters) && String((p as any).roundingMode ?? "none") !== "none") ? (
          <div style={{ marginTop: 14 }}>
            <div className="cpq-label" style={{ marginBottom: 8 }}>
              Levering & palletopbouw
            </div>
            <div className="cpq-alert">
              Afronden werkt per regel (kolom “Afronden”). Gebruik “Volle lagen/pallets” om altijd op logistieke eenheden uit te komen.
            </div>
            <div className="cpq-table-wrap" style={{ marginTop: 10 }}>
              <table className="cpq-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Eenheden</th>
                    <th>Pallets</th>
                    <th>Lagen</th>
                    <th>Los</th>
                  </tr>
                </thead>
                <tbody>
                  {scenario.products
                    .filter((product) => product.qty > 0 && !Boolean((product as any).isMixLiters))
                    .map((product) => {
                      const label = (product.name || "Product") + (product.pack ? ` · ${product.pack}` : "");
                      const units = Math.max(0, clampNumber(product.qty, 0));
                      const unitLabel = String(product.unit ?? "stuk");
                      const unitsPerPalletRaw = typeof (product as any).unitsPerPallet === "number" ? (product as any).unitsPerPallet : null;
                      const unitsPerLayerRaw = typeof (product as any).unitsPerLayer === "number" ? (product as any).unitsPerLayer : null;
                      const unitsPerPallet =
                        unitLabel === "doos"
                          ? palletDefaults.doosUnitsPerPallet
                          : unitLabel === "fust"
                            ? palletDefaults.fustUnitsPerPallet
                            : unitsPerPalletRaw;
                      const unitsPerLayer =
                        unitLabel === "doos"
                          ? palletDefaults.doosUnitsPerLayer
                          : unitLabel === "fust"
                            ? palletDefaults.fustUnitsPerLayer
                            : unitsPerLayerRaw;

                      if (!unitsPerPallet || !unitsPerLayer) {
                        return (
                          <tr key={`log-${product.id}`}>
                            <td>{label}</td>
                            <td>{units.toLocaleString("nl-NL")}</td>
                            <td colSpan={3} className="cpq-muted">
                              Geen palletdata voor dit product.
                            </td>
                          </tr>
                        );
                      }

                      const palletsExact = unitsPerPallet > 0 ? units / unitsPerPallet : 0;
                      const palletsFull = Math.floor(palletsExact);
                      const remainingAfterPallets = units - palletsFull * unitsPerPallet;
                      const layersFull = unitsPerLayer > 0 ? Math.floor(remainingAfterPallets / unitsPerLayer) : 0;
                      const looseUnits = Math.round(remainingAfterPallets - layersFull * unitsPerLayer);

                      return (
                        <tr key={`log-${product.id}`}>
                          <td>{label}</td>
                          <td>{units.toLocaleString("nl-NL")}</td>
                          <td>{palletsFull}</td>
                          <td>{layersFull}</td>
                          <td>{looseUnits}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
          ) : null}
        </section>
      ) : (
        <section className="cpq-card">
          <div className="cpq-card-header">
            <div>
              <h3 className="cpq-card-title">Basisofferte</h3>
              <p className="cpq-card-subtitle">
                Dit voorstel gebruikt de productscope uit {standardPricingBlock?.type?.toLowerCase() ?? "de pricingactie"} in plaats van de basisofferte.
              </p>
            </div>
          </div>
          <div className="cpq-alert">
            De producten in de basisofferte zijn in dit voorstel niet leidend voor de actieve pricingactie. Pas de productscope aan in de {standardPricingBlock?.type?.toLowerCase() ?? "pricingactie"}-kaart.
          </div>
        </section>
      )}

      <div className="cpq-stack">
        {hasIntro ? (
          <section className="cpq-card">
            <div className="cpq-card-header">
              <div>
                <h3 className="cpq-card-title">Introductie</h3>
                <p className="cpq-card-subtitle">Deze periode staat boven de standaardperiode en loopt tijdelijk mee.</p>
              </div>
            </div>
            <div className="cpq-stack">
              {introBlocks.map((block) => (
                <BuilderBlockCard key={block.id} block={block} onEdit={editOption} onRemove={removeBlock} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="cpq-card">
          <div className="cpq-card-header">
            <div>
              <h3 className="cpq-card-title">Standaardperiode</h3>
              <p className="cpq-card-subtitle">
                {hasIntro
                  ? "Na de introductie gelden automatisch de standaardprijzen en voorwaarden. Extra afspraken kun je hieronder toevoegen."
                  : "Hier gelden de standaardprijzen en voorwaarden van de offerte."}
              </p>
            </div>
          </div>

          <div className="cpq-stack">
            <section className="cpq-block tone-neutral">
              <div className="cpq-block-row">
                <div className="cpq-block-body">
                  <div className="cpq-block-title">Standaardafspraken</div>
                  <div className="cpq-block-subtitle">{hasIntro ? "Na de introductie" : "Direct actief"}</div>
                  <ul className="cpq-block-list">
                    <li>Standaardprijzen uit verkoopstrategie blijven van toepassing.</li>
                    <li>Standaardvoorwaarden blijven gelden totdat extra afspraken worden toegevoegd.</li>
                  </ul>
                </div>
              </div>
            </section>

            {standardBlocks.map((block) => (
              <BuilderBlockCard key={block.id} block={block} onEdit={editOption} onRemove={removeBlock} />
            ))}

            {standardBlocks.length === 0 && globalBlocks.length === 0 ? (
              <div className="cpq-empty">Nog geen extra afspraken toegevoegd.</div>
            ) : null}
          </div>
        </section>

        {globalBlocks.length > 0 ? (
          <section className="cpq-card">
            <div className="cpq-card-header">
              <div>
                <h3 className="cpq-card-title">Quotebrede afspraken</h3>
                <p className="cpq-card-subtitle">Deze afspraken gelden bovenop de standaardperiode.</p>
              </div>
            </div>
            <div className="cpq-stack">
              {globalBlocks.map((block) => (
                <BuilderBlockCard key={block.id} block={block} onEdit={editOption} onRemove={removeBlock} />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <div className="cpq-actions cpq-actions-split">
        <button onClick={onSave} className="cpq-button cpq-button-secondary" type="button" disabled={isSaving}>
          {isSaving ? "Opslaan..." : "Opslaan"}
        </button>
        <button onClick={onNext} className="cpq-button cpq-button-primary" type="button">
          Verder naar vergelijken
        </button>
      </div>
    </div>
  );
}
