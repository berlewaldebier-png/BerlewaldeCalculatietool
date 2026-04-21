import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";

import {
  EmptyHint,
  ErrorField,
  Idea,
  SearchableMultiSelectField,
} from "@/components/offerte-samenstellen/forms/FormControls";
import { euro } from "@/components/offerte-samenstellen/quoteUtils";
import {
  buildSelectableProducts,
  calculateProductStaffelMetrics,
  filterProductsForStaffel,
  getStaffelCompatibilityInfo,
  getSuggestedSharedPrice,
  resolveSelectedProducts,
  syncStaffelRows,
  validateStaffelRows,
} from "@/components/offerte-samenstellen/staffelUtils";
import type {
  ProductOption,
  QuoteFormState,
  StaffelDiscountMode,
  StaffelRowInput,
} from "@/components/offerte-samenstellen/types";

type Props = {
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
  products: ProductOption[];
};

function updateRows(
  prev: QuoteFormState,
  nextRows: StaffelRowInput[],
  discountMode: StaffelDiscountMode = prev.staffelDiscountMode,
  discountValue: string = prev.staffelDiscountValue
) {
  return {
    ...prev,
    staffelRows: syncStaffelRows(nextRows, discountMode, discountValue),
  };
}

function ensureSuggestedFirstPrice(
  rows: StaffelRowInput[],
  products: ProductOption[],
  discountMode: StaffelDiscountMode,
  discountValue: string
) {
  if (String(rows[0]?.price ?? "").trim()) {
    return rows;
  }

  const suggestedPrice = getSuggestedSharedPrice(products);
  if (!suggestedPrice) {
    return rows;
  }

  const nextRows = [...rows];
  nextRows[0] = { ...nextRows[0], price: suggestedPrice };
  return syncStaffelRows(nextRows, discountMode, discountValue);
}

function applyDiscountMode(
  prev: QuoteFormState,
  nextMode: StaffelDiscountMode,
  products: ProductOption[]
) {
  const nextRows = ensureSuggestedFirstPrice(
    prev.staffelRows,
    products,
    nextMode,
    prev.staffelDiscountValue
  );

  return {
    ...prev,
    staffelDiscountMode: nextMode,
    staffelRows: syncStaffelRows(nextRows, nextMode, prev.staffelDiscountValue),
  };
}

function removeStaffelRow(prev: QuoteFormState, index: number) {
  if (prev.staffelRows.length <= 1) {
    return prev;
  }

  const nextRows = prev.staffelRows.filter((_, rowIndex) => rowIndex !== index);
  return updateRows(prev, nextRows);
}

export function getStaffelFormError(form: QuoteFormState, products: ProductOption[] = []) {
  if (form.staffelEligibleRefs.length === 0) {
    return "Selecteer minstens een product voor de staffel.";
  }

  const compatibility = getStaffelCompatibilityInfo(products, form.staffelEligibleRefs);
  if (compatibility.hasMixedCompatibility) {
    return "De gekozen producten vallen niet binnen dezelfde staffelcategorie.";
  }

  if (form.staffelDiscountMode === "free" && form.staffelEligibleRefs.length > 1) {
    return "Vrij invullen is voorlopig alleen beschikbaar voor een product tegelijk.";
  }

  if (form.staffelDiscountMode !== "free" && !form.staffelDiscountValue.trim()) {
    return "Vul de daling per volgende regel in.";
  }

  return validateStaffelRows(form.staffelRows, {
    requirePrice: form.staffelDiscountMode === "free",
  }).formError;
}

function StaffelModeButton({
  active,
  label,
  description,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`cpq-staffel-mode-button${active ? " active" : ""}`}
      onClick={onClick}
    >
      <span className="cpq-staffel-mode-title">{label}</span>
      <span className="cpq-staffel-mode-description">{description}</span>
    </button>
  );
}

export function StaffelForm({ form, setForm, products }: Props) {
  const [showHelp, setShowHelp] = useState(false);
  const compatibilityInfo = useMemo(
    () => getStaffelCompatibilityInfo(products, form.staffelEligibleRefs),
    [products, form.staffelEligibleRefs]
  );
  const availableProducts = useMemo(
    () =>
      filterProductsForStaffel(
        products,
        form.staffelEligibleRefs,
        compatibilityInfo.compatibilityKey
      ),
    [products, form.staffelEligibleRefs, compatibilityInfo.compatibilityKey]
  );
  const selectableProducts = useMemo(
    () => buildSelectableProducts(availableProducts),
    [availableProducts]
  );
  const selectedProducts = useMemo(
    () => resolveSelectedProducts(products, form.staffelEligibleRefs),
    [products, form.staffelEligibleRefs]
  );
  const validation = useMemo(
    () =>
      validateStaffelRows(form.staffelRows, {
        requirePrice: form.staffelDiscountMode === "free",
      }),
    [form.staffelDiscountMode, form.staffelRows]
  );
  const error = getStaffelFormError(form, products);
  const showMasterPriceColumn = form.staffelDiscountMode === "free";

  return (
    <div className={`cpq-staffel-layout${showHelp ? " is-help-open" : ""}`}>
      <div className="cpq-staffel-main">
        {error ? <ErrorField text={error} /> : null}

        <div className="cpq-staffel-toolbar">
          <div className="cpq-label">Staffelinstellingen</div>
          <button
            type="button"
            className={`cpq-staffel-info-button${showHelp ? " is-active" : ""}`}
            aria-label={showHelp ? "Verberg uitleg" : "Toon uitleg"}
            title={showHelp ? "Verberg uitleg" : "Toon uitleg"}
            onClick={() => setShowHelp((prev) => !prev)}
          >
            i
          </button>
        </div>

        <div className="cpq-staffel-section cpq-staffel-picker">
          <SearchableMultiSelectField
            label="Producten voor deze staffel"
            items={selectableProducts}
            selected={form.staffelEligibleRefs}
            onToggle={(id) => {
              setForm((prev) => {
                const exists = prev.staffelEligibleRefs.includes(id);
                const nextRefs = exists
                  ? prev.staffelEligibleRefs.filter((item) => item !== id)
                  : [...prev.staffelEligibleRefs, id];
                const nextSelectedProducts = resolveSelectedProducts(products, nextRefs);
                const nextRows =
                  nextSelectedProducts.length > 0
                    ? ensureSuggestedFirstPrice(
                        prev.staffelRows,
                        nextSelectedProducts,
                        prev.staffelDiscountMode,
                        prev.staffelDiscountValue
                      )
                    : prev.staffelRows;

                return {
                  ...prev,
                  staffelEligibleRefs: nextRefs,
                  staffelRows: nextRows,
                };
              });
            }}
          />
        </div>

        {selectedProducts.length > 0 ? (
          <div className="cpq-staffel-section">
            <div className="cpq-staffel-summary-card">
              {compatibilityInfo.compatibilityLabel ? (
                <div className="cpq-staffel-summary-line">
                  Staffel geldt voor: <strong>{compatibilityInfo.compatibilityLabel}</strong>
                </div>
              ) : null}
              <div className="cpq-staffel-selected-summary">
                {selectedProducts.map((product) => (
                  <div key={product.optionId} className="cpq-staffel-selected-card">
                    <div className="cpq-staffel-selected-name">{product.label}</div>
                    <div className="cpq-staffel-selected-meta">
                      <span>Verkoopprijs {euro(product.standardPriceEx)}</span>
                      <span>Kostprijs {euro(product.costPriceEx)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="cpq-staffel-section">
          <div className="cpq-label">Prijslogica</div>
          <div className="cpq-staffel-mode-grid">
            <StaffelModeButton
              active={form.staffelDiscountMode === "percent"}
              label="% daling"
              description="Elke volgende regel daalt in procenten ten opzichte van de vorige prijs."
              onClick={() => setForm((prev) => applyDiscountMode(prev, "percent", selectedProducts))}
            />
            <StaffelModeButton
              active={form.staffelDiscountMode === "absolute"}
              label="EUR daling"
              description="Elke volgende regel daalt met een vast eurobedrag."
              onClick={() => setForm((prev) => applyDiscountMode(prev, "absolute", selectedProducts))}
            />
            <StaffelModeButton
              active={form.staffelDiscountMode === "free"}
              label="Vrij invullen"
              description="Je vult alle staffelprijzen handmatig in."
              onClick={() => setForm((prev) => applyDiscountMode(prev, "free", selectedProducts))}
            />
          </div>
        </div>

        {form.staffelDiscountMode !== "free" ? (
          <div className="cpq-staffel-section">
            <label className="cpq-field">
              <div className="cpq-label">
                {form.staffelDiscountMode === "percent"
                  ? "Daling per volgende regel (%)"
                  : "Daling per volgende regel (EUR)"}
              </div>
              <input
                value={form.staffelDiscountValue}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    staffelDiscountValue: event.target.value,
                    staffelRows: syncStaffelRows(
                      prev.staffelRows,
                      prev.staffelDiscountMode,
                      event.target.value
                    ),
                  }))
                }
                className="cpq-input"
                placeholder={form.staffelDiscountMode === "percent" ? "Bijv. 2,5" : "Bijv. 0,50"}
              />
            </label>
          </div>
        ) : null}

        <div className="cpq-staffel-section">
          {selectedProducts.length === 0 ? (
            <EmptyHint text="Selecteer eerst een of meer producten om de staffel op te bouwen." />
          ) : (
            <div className="cpq-staffel-table-wrap cpq-staffel-master-wrap">
              <table className="cpq-staffel-table cpq-staffel-master-table">
                <thead>
                  <tr>
                    <th>Van</th>
                    <th>Tot en met</th>
                    {showMasterPriceColumn ? <th>Prijs</th> : null}
                    <th className="cpq-staffel-action-cell" aria-label="Acties" />
                  </tr>
                </thead>
                <tbody>
                  {form.staffelRows.map((row, index) => {
                    const rowError = validation.fieldErrors[index];
                    const priceDisabled = form.staffelDiscountMode !== "free" && index > 0;

                    return (
                      <tr key={`${row.from}-${index}`}>
                        <td>
                          <input value={row.from} className="cpq-input cpq-input-small" disabled />
                        </td>
                        <td>
                          <input
                            value={row.to}
                            onChange={(event) =>
                              setForm((prev) => {
                                const nextRows = [...prev.staffelRows];
                                nextRows[index] = { ...nextRows[index], to: event.target.value };
                                return updateRows(prev, nextRows);
                              })
                            }
                            className={`cpq-input cpq-input-small${rowError ? " cpq-staffel-cell-error" : ""}`}
                            placeholder="Laatste regel open laten"
                            inputMode="numeric"
                          />
                          {rowError ? (
                            <div className="cpq-staffel-row-error">{rowError}</div>
                          ) : null}
                        </td>
                        {showMasterPriceColumn ? (
                          <td>
                            <input
                              value={row.price}
                              onChange={(event) =>
                                setForm((prev) => {
                                  const nextRows = [...prev.staffelRows];
                                  nextRows[index] = { ...nextRows[index], price: event.target.value };
                                  return updateRows(prev, nextRows);
                                })
                              }
                              className="cpq-input cpq-input-small"
                              placeholder="0,00"
                              disabled={priceDisabled}
                            />
                          </td>
                        ) : null}
                        <td className="cpq-staffel-action-cell">
                          <button
                            type="button"
                            className="cpq-staffel-delete-button"
                            aria-label={`Verwijder staffelregel vanaf ${row.from}`}
                            title="Regel verwijderen"
                            onClick={() => setForm((prev) => removeStaffelRow(prev, index))}
                            disabled={form.staffelRows.length <= 1}
                          >
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedProducts.length > 0 ? (
          <div className="cpq-staffel-section">
            <div className="cpq-label">
              {selectedProducts.length === 1
                ? "Staffel voor geselecteerd product"
                : "Staffels per geselecteerd product"}
            </div>
            <div className="cpq-staffel-readonly-stack">
              {selectedProducts.map((product) => (
                <div key={product.optionId} className="cpq-staffel-product-card">
                  <div className="cpq-staffel-product-card-header">
                    <div>
                      <div className="cpq-staffel-product-card-title">{product.label}</div>
                      <div className="cpq-staffel-product-card-subtitle">
                        Verkoopprijs {euro(product.standardPriceEx)} · Kostprijs {euro(product.costPriceEx)}
                      </div>
                    </div>
                  </div>

                  <div className="cpq-staffel-table-wrap cpq-staffel-product-scroll">
                    <table className="cpq-staffel-table cpq-staffel-product-table cpq-staffel-product-metrics-table">
                      <thead>
                        <tr>
                          <th>Van</th>
                          <th>Tot en met</th>
                          <th>Staffelprijs</th>
                          <th>Kostprijs p/e</th>
                          <th>Std. marge</th>
                          <th>Nieuwe marge</th>
                          <th>Klantvoordeel</th>
                          <th>Marge-impact</th>
                          <th>Omzet</th>
                        </tr>
                      </thead>
                      <tbody>
                        {form.staffelRows.map((row, index) => {
                          const metrics = calculateProductStaffelMetrics(
                            product,
                            row,
                            index,
                            form.staffelDiscountMode,
                            form.staffelDiscountValue
                          );

                          return (
                            <tr key={`${product.optionId}-${row.from}-${index}`}>
                              <td>{row.from}</td>
                              <td>{row.to || "-"}</td>
                              <td>{metrics.priceLabel}</td>
                              <td>{metrics.costLabel}</td>
                              <td>{metrics.standardMarginLabel}</td>
                              <td>{metrics.newMarginLabel}</td>
                              <td>{metrics.customerAdvantageLabel}</td>
                              <td>{metrics.marginImpactLabel}</td>
                              <td>{metrics.revenueLabel}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {showHelp ? (
        <div className="cpq-staffel-side">
          <div className="cpq-staffel-side-actions">
            <button
              type="button"
              className="cpq-button cpq-button-secondary cpq-staffel-hide-help"
              onClick={() => setShowHelp(false)}
            >
              Uitleg verbergen
            </button>
          </div>
          <div className="cpq-staffel-side-card cpq-staffel-side-card-muted">
            <div className="text-sm font-semibold text-slate-900">Hoe werkt deze staffel?</div>
            <div className="mt-3 space-y-2 text-sm text-slate-600">
              <p>
                De staffel volgt de verpakking en liters van het eerst gekozen product. Daarna
                kun je alleen compatibele producten toevoegen.
              </p>
              <p>
                Zodra je een waarde invult bij <strong>Tot en met</strong>, maken we automatisch
                de volgende regel aan met de eerstvolgende aantallen.
              </p>
              <p>
                De intervalgrootte moet overal gelijk blijven. Wijkt een regel af, dan blokkeren
                we opslaan bewust.
              </p>
            </div>
          </div>

          <div className="cpq-staffel-side-card">
            <div className="mb-3 text-sm font-semibold text-slate-900">Uitleg marge</div>
            <div className="space-y-2 text-sm text-slate-600">
              <p>
                <strong>Standaard marge p/e</strong> is de normale verkoopprijs minus kostprijs.
              </p>
              <p>
                <strong>Nieuwe marge p/e</strong> laat zien wat er overblijft bij de staffelprijs.
              </p>
              <p>
                <strong>Klantvoordeel</strong> en <strong>Marge-impact</strong> laten samen zien
                wat de klant wint en wat wij weggeven.
              </p>
            </div>
          </div>

          <Idea text="De staffel wordt als een gedeelde prijsafspraak opgeslagen. De producttabellen hieronder zijn afgeleide controles, geen extra opgeslagen waarheid." />
        </div>
      ) : null}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="cpq-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 7h14" />
      <path d="M9 7V5.8c0-.4.4-.8.8-.8h4.4c.4 0 .8.4.8.8V7" />
      <path d="M8 7l.7 11.2c0 .5.4.8.9.8h4.8c.5 0 .9-.3.9-.8L16 7" />
      <path d="M10 10.2v5.6" />
      <path d="M14 10.2v5.6" />
    </svg>
  );
}
