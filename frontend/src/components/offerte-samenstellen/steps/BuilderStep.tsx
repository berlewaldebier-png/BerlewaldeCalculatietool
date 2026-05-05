"use client";

import React, { useMemo } from "react";

import {
  getProductRef,
} from "@/components/offerte-samenstellen/quoteUtils";
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

export function BuilderStep({
  unitMode,
  vatMode,
  hasIntro,
  scenario,
  metrics,
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
  scenario: Scenario;
  metrics: ScenarioMetrics;
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

  return (
    <div className="cpq-stack">
      <div className="cpq-builder-header">
        <div>
          <h2 className="cpq-card-title">Offerte maken</h2>
          <p className="cpq-card-subtitle">Start simpel met producten en breid uit met blokken via de toolbar.</p>
        </div>
        <div className="cpq-toggle-strip" role="group" aria-label="Voorstel">
          {(["A", "B", "C"] as ScenarioId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveScenario(id)}
              className={`cpq-toggle${activeScenario === id ? " active" : ""}`}
            >
              Voorstel {id}
            </button>
          ))}
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
            <button onClick={addProductRow} className="cpq-button cpq-button-secondary" type="button">
              + Product toevoegen
            </button>
          </div>

          <div className="cpq-table-wrap">
            <table className="cpq-table">
              <thead>
                <tr>
                  <th>Bier</th>
                  <th>Aantal</th>
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
                  const qtyInputValue = unitMode === "liters" ? product.qty * product.litersPerUnit : product.qty;

                  return (
                    <tr key={product.id}>
                      <td>
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
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={Number.isFinite(qtyInputValue) ? qtyInputValue : 0}
                          onChange={(e) => {
                            const raw = Math.max(0, clampNumber(e.target.value, 0));
                            if (unitMode === "liters") {
                              const litersPerUnit = Math.max(0, clampNumber(product.litersPerUnit, 0));
                              const nextQty = litersPerUnit > 0 ? raw / litersPerUnit : 0;
                              updateProduct(product.id, { qty: nextQty });
                              return;
                            }
                            updateProduct(product.id, { qty: raw });
                          }}
                          className="cpq-input cpq-input-small"
                        />
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

