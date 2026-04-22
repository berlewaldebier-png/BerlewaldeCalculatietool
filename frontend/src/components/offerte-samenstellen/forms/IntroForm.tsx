import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useMemo, useState } from "react";

import {
  EmptyHint,
  ErrorField,
  Field,
  Idea,
  SelectField,
} from "@/components/offerte-samenstellen/forms/FormControls";
import { ProductPickerTable } from "@/components/offerte-samenstellen/forms/ProductPickerTable";
import {
  buildIntroFinancialLines,
  buildIntroFinancialSummary,
} from "@/components/offerte-samenstellen/introUtils";
import type { ProductOption, QuoteFormState } from "@/components/offerte-samenstellen/types";

type Props = {
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
  products: ProductOption[];
};

function todayIso() {
  return new Date().toISOString().split("T")[0] ?? "";
}

function formatNumberNl(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

function resolveSelectedProducts(products: ProductOption[], refs: string[]) {
  return products.filter((product) => refs.includes(product.optionId));
}

export function getIntroFormError(form: QuoteFormState, today: string = todayIso()) {
  if (!form.introStart || !form.introEnd) {
    return "Begindatum en einddatum zijn verplicht.";
  }
  if (form.introStart < today) {
    return "Begindatum mag niet in het verleden liggen.";
  }
  if (form.introEnd < today) {
    return "Einddatum mag niet in het verleden liggen.";
  }
  if (form.introEnd === form.introStart) {
    return "Einddatum mag niet gelijk zijn aan begindatum.";
  }
  if (form.introEnd < form.introStart) {
    return "Einddatum moet na begindatum liggen.";
  }
  if (form.introEligibleRefs.length === 0) {
    return "Selecteer minstens een product voor de introductie.";
  }

  if (form.introPromoType === "discount") {
    if (form.introDiscountMode === "all" && !form.introDiscountPercent.trim()) {
      return "Vul een kortingspercentage in.";
    }
    if (form.introDiscountMode === "per_product") {
      const missingDiscount = form.introEligibleRefs.some(
        (ref) => !String(form.introDiscountsByProduct[ref] ?? "").trim()
      );
      if (missingDiscount) {
        return "Vul per geselecteerd product een kortingspercentage in.";
      }
    }
  }

  if (form.introPromoType === "x_plus_y") {
    if (!form.introXValue.trim() || !form.introYValue.trim()) {
      return "Vul zowel X als Y in voor de actie.";
    }
    if (form.introApplyMode === "single" && !form.introSingleProductRef.trim()) {
      return "Kies het product waarop de X + Y actie geldt.";
    }
  }

  if (form.introPromoType === "threshold_discount") {
    if (!form.introThresholdValue.trim() || !form.introThresholdDiscount.trim()) {
      return "Vul de drempelwaarde en het kortingspercentage in.";
    }
    if (
      form.introThresholdApplyMode === "single" &&
      !form.introThresholdSingleProductRef.trim()
    ) {
      return "Kies het product waarop de drempelkorting geldt.";
    }
  }

  return "";
}

function buildPreviewLines(form: QuoteFormState, selectedProducts: ProductOption[]) {
  const productSummary =
    selectedProducts.length > 0
      ? selectedProducts.map((product) => product.label).join(", ")
      : "Nog niets geselecteerd";

  if (form.introPromoType === "discount") {
    return [
      "Actie: % korting",
      form.introDiscountMode === "all"
        ? `Korting: ${form.introDiscountPercent || "—"}% voor alle geselecteerde producten`
        : `Korting per product: ${
            selectedProducts.length > 0
              ? selectedProducts
                  .map(
                    (product) =>
                      `${product.label}: ${form.introDiscountsByProduct[product.optionId] || "—"}%`
                  )
                  .join(" | ")
              : "—"
          }`,
      `Producten: ${productSummary}`,
    ];
  }

  if (form.introPromoType === "x_plus_y") {
    const singleProductLabel =
      selectedProducts.find((product) => product.optionId === form.introSingleProductRef)?.label ??
      "";

    return [
      "Actie: X + Y",
      `Uitleg: klant betaalt ${form.introXValue || "—"} en krijgt ${form.introYValue || "—"} gratis`,
      `Toepassing: ${
        form.introApplyMode === "combined"
          ? "Combineren mag binnen geselecteerde producten"
          : `Specifiek product: ${singleProductLabel || "—"}`
      }`,
      `Producten: ${productSummary}`,
    ];
  }

  const thresholdProductLabel =
    selectedProducts.find(
      (product) => product.optionId === form.introThresholdSingleProductRef
    )?.label ?? "";

  return [
    "Actie: Drempelkorting",
    `Drempel: ${form.introThresholdValue || "—"} ${form.introThresholdType}`,
    `Toepassing: ${
      form.introThresholdApplyMode === "all"
        ? "Alle geselecteerde producten"
        : `Één product: ${thresholdProductLabel || "—"}`
    }`,
    `Korting: ${form.introThresholdDiscount || "—"}%`,
    `Producten: ${productSummary}`,
  ];
}

function IntroPromoCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="cpq-intro-promo-card">
      <div className="cpq-intro-promo-header">
        <div className="cpq-intro-promo-title">{title}</div>
        <div className="cpq-intro-promo-description">{description}</div>
      </div>
      <div className="cpq-intro-promo-content">{children}</div>
    </div>
  );
}

function IntroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="cpq-intro-metric">
      <div className="cpq-intro-metric-label">{label}</div>
      <div className="cpq-intro-metric-value">{value}</div>
    </div>
  );
}

function IntroSummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="cpq-intro-summary-metric">
      <div className="cpq-intro-summary-metric-label">{label}</div>
      <div className="cpq-intro-summary-metric-value">{value}</div>
    </div>
  );
}

export function IntroForm({ form, setForm, products }: Props) {
  const [showHelp, setShowHelp] = useState(false);
  const today = todayIso();
  const selectedProducts = useMemo(
    () => resolveSelectedProducts(products, form.introEligibleRefs),
    [products, form.introEligibleRefs]
  );
  const error = getIntroFormError(form, today);
  const previewLines = useMemo(
    () => buildPreviewLines(form, selectedProducts),
    [form, selectedProducts]
  );
  const financialLines = useMemo(
    () => buildIntroFinancialLines(selectedProducts, form),
    [selectedProducts, form]
  );
  const financialSummary = useMemo(
    () => buildIntroFinancialSummary(financialLines),
    [financialLines]
  );

  return (
    <div className="cpq-intro-layout">
      <div className="cpq-intro-main">
        {error ? <ErrorField text={error} /> : null}

        <div className="cpq-staffel-toolbar">
          <div className="cpq-label">Introductie-instellingen</div>
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

        <div className="cpq-intro-date-grid">
          <Field
            label="Begindatum"
            type="date"
            min={today}
            required
            value={form.introStart}
            onChange={(value) => setForm((prev) => ({ ...prev, introStart: value }))}
          />
          <Field
            label="Einddatum"
            type="date"
            min={form.introStart || today}
            required
            value={form.introEnd}
            onChange={(value) => setForm((prev) => ({ ...prev, introEnd: value }))}
          />
        </div>

        <div className="cpq-intro-section">
          <div className="cpq-label">Producten die meedoen</div>
          <ProductPickerTable
            products={products}
            selectedRefs={form.introEligibleRefs}
            emptyHint="Voeg eerst een bierstijl en verpakking toe voor deze introductie."
            onChange={(nextEligibleRefs) => {
              setForm((prev) => {
                const nextDiscountsByProduct = Object.fromEntries(
                  Object.entries(prev.introDiscountsByProduct).filter(([key]) =>
                    nextEligibleRefs.includes(key)
                  )
                );

                return {
                  ...prev,
                  introEligibleRefs: nextEligibleRefs,
                  introDiscountsByProduct: nextDiscountsByProduct,
                  introSingleProductRef: nextEligibleRefs.includes(prev.introSingleProductRef)
                    ? prev.introSingleProductRef
                    : "",
                  introThresholdSingleProductRef: nextEligibleRefs.includes(
                    prev.introThresholdSingleProductRef
                  )
                    ? prev.introThresholdSingleProductRef
                    : "",
                };
              });
            }}
          />
        </div>

        <div className="cpq-intro-section cpq-intro-promo-stack">
          <SelectField
            label="Actievorm"
            value={form.introPromoType}
            options={[
              { label: "% korting", value: "discount" },
              { label: "X + Y", value: "x_plus_y" },
              { label: "Drempelkorting", value: "threshold_discount" },
            ]}
            onChange={(value) =>
              setForm((prev) => ({
                ...prev,
                introPromoType: value as QuoteFormState["introPromoType"],
              }))
            }
          />

          {form.introPromoType === "discount" ? (
            <IntroPromoCard
              title="% korting"
              description="Bepaal of alle geselecteerde producten dezelfde korting krijgen of elk product een eigen korting."
            >
              <SelectField
                label="Korting toepassen"
                value={form.introDiscountMode}
                options={[
                  {
                    label: "Één korting voor alle geselecteerde producten",
                    value: "all",
                  },
                  {
                    label: "Per product een andere korting",
                    value: "per_product",
                  },
                ]}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    introDiscountMode: value as QuoteFormState["introDiscountMode"],
                  }))
                }
              />

              {form.introDiscountMode === "all" ? (
                <Field
                  label="Korting (%)"
                  value={form.introDiscountPercent}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, introDiscountPercent: value }))
                  }
                />
              ) : selectedProducts.length === 0 ? (
                <EmptyHint text="Selecteer eerst een of meer producten." />
              ) : (
                <div className="cpq-intro-field-stack">
                  {selectedProducts.map((product) => (
                    <Field
                      key={product.optionId}
                      label={`${product.label} - korting (%)`}
                      value={form.introDiscountsByProduct[product.optionId] || ""}
                      onChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          introDiscountsByProduct: {
                            ...prev.introDiscountsByProduct,
                            [product.optionId]: value,
                          },
                        }))
                      }
                    />
                  ))}
                </div>
              )}
            </IntroPromoCard>
          ) : null}

          {form.introPromoType === "x_plus_y" ? (
            <IntroPromoCard
              title="X + Y"
              description="Leg vast hoeveel de klant betaalt en hoeveel er gratis wordt geleverd."
            >
              <div className="cpq-intro-note">
                <strong>X</strong> = klant betaalt hiervoor
                <br />
                <strong>Y</strong> = klant krijgt dit gratis
              </div>

              <div className="cpq-intro-two-col">
                <Field
                  label="X (betaald)"
                  value={form.introXValue}
                  onChange={(value) => setForm((prev) => ({ ...prev, introXValue: value }))}
                />
                <Field
                  label="Y (gratis)"
                  value={form.introYValue}
                  onChange={(value) => setForm((prev) => ({ ...prev, introYValue: value }))}
                />
              </div>

              <SelectField
                label="Toepassing"
                value={form.introApplyMode}
                options={[
                  {
                    label: "Combineren mag binnen geselecteerde producten",
                    value: "combined",
                  },
                  {
                    label: "Geldt voor één specifiek product",
                    value: "single",
                  },
                ]}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    introApplyMode: value as QuoteFormState["introApplyMode"],
                    introSingleProductRef:
                      value === "combined" ? "" : prev.introSingleProductRef,
                  }))
                }
              />

              {form.introApplyMode === "combined" ? (
                <div className="cpq-intro-note">
                  Deze actie mag alleen gecombineerd worden met de producten die bovenaan zijn geselecteerd.
                </div>
              ) : null}

              {form.introApplyMode === "single" ? (
                selectedProducts.length === 0 ? (
                  <EmptyHint text="Selecteer eerst bovenaan een of meer producten." />
                ) : (
                  <SelectField
                    label="Kies product"
                    value={form.introSingleProductRef}
                    options={[
                      { label: "Selecteer...", value: "" },
                      ...selectedProducts.map((product) => ({
                        label: product.label,
                        value: product.optionId,
                      })),
                    ]}
                    onChange={(value) =>
                      setForm((prev) => ({ ...prev, introSingleProductRef: value }))
                    }
                  />
                )
              ) : null}
            </IntroPromoCard>
          ) : null}

          {form.introPromoType === "threshold_discount" ? (
            <IntroPromoCard
              title="Drempelkorting"
              description="Laat de korting afhangen van liters of dozen, voor alle geselecteerde producten of voor één gekozen product."
            >
              <div className="cpq-intro-two-col">
                <SelectField
                  label="Drempel type"
                  value={form.introThresholdType}
                  options={[
                    { label: "Liters", value: "liters" },
                    { label: "Dozen", value: "dozen" },
                  ]}
                  onChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      introThresholdType: value as QuoteFormState["introThresholdType"],
                    }))
                  }
                />
                <Field
                  label="Drempelwaarde"
                  value={form.introThresholdValue}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, introThresholdValue: value }))
                  }
                />
              </div>

              <SelectField
                label="Toepassing"
                value={form.introThresholdApplyMode}
                options={[
                  {
                    label: "Geldt voor alle geselecteerde producten",
                    value: "all",
                  },
                  {
                    label: "Geldt voor 1 product",
                    value: "single",
                  },
                ]}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    introThresholdApplyMode:
                      value as QuoteFormState["introThresholdApplyMode"],
                    introThresholdSingleProductRef:
                      value === "all" ? "" : prev.introThresholdSingleProductRef,
                  }))
                }
              />

              {form.introThresholdApplyMode === "single" ? (
                selectedProducts.length === 0 ? (
                  <EmptyHint text="Selecteer eerst bovenaan een of meer producten." />
                ) : (
                  <SelectField
                    label="Kies product"
                    value={form.introThresholdSingleProductRef}
                    options={[
                      { label: "Selecteer...", value: "" },
                      ...selectedProducts.map((product) => ({
                        label: product.label,
                        value: product.optionId,
                      })),
                    ]}
                    onChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        introThresholdSingleProductRef: value,
                      }))
                    }
                  />
                )
              ) : null}

              <Field
                label="Korting (%)"
                value={form.introThresholdDiscount}
                onChange={(value) =>
                  setForm((prev) => ({ ...prev, introThresholdDiscount: value }))
                }
              />
            </IntroPromoCard>
          ) : null}
        </div>

        <div className="cpq-intro-section">
          <Field
            label="Aanvulling"
            value={form.introNote}
            onChange={(value) => setForm((prev) => ({ ...prev, introNote: value }))}
            placeholder="Eventuele toelichting of afspraak"
          />
        </div>
      </div>

      <div className="cpq-intro-side">
        {showHelp ? (
          <div className="cpq-staffel-side-card cpq-staffel-side-card-muted">
            <div className="cpq-intro-help-head">
              <div className="cpq-intro-card-title">Hoe lees je deze impact?</div>
              <button
                type="button"
                className="cpq-button cpq-button-secondary cpq-staffel-hide-help"
                onClick={() => setShowHelp(false)}
              >
                Uitleg verbergen
              </button>
            </div>
            <div className="cpq-intro-copy-stack">
              <p>
                We tonen de impact bewust per verpakking en per glas. Daardoor zie je direct
                wat een introductie commercieel doet, zonder te doen alsof we al een volumeprognose kennen.
              </p>
              <p>
                Voor dozen en flessen rekenen we met een standaardglas van <strong>33 cl</strong>.
                Voor fusten rekenen we met <strong>25 cl</strong>.
              </p>
              <p>
                Na opslaan wordt de introductie als aparte kaart toegevoegd. Daaronder ontstaat
                automatisch de standaardperiode met de normale prijs- en voorwaardenbasis.
              </p>
            </div>
          </div>
        ) : null}

        <div className="cpq-intro-side-card">
          <div className="cpq-intro-card-title">Preview introductieblok</div>
          <div className="cpq-intro-copy-stack cpq-intro-preview">
            <div>
              <strong>Periode:</strong> {form.introStart || "—"} t/m {form.introEnd || "—"}
            </div>
            {previewLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>

        <div className="cpq-intro-side-card">
          <div className="cpq-intro-card-title">Financiële impact</div>
          {!financialSummary ? (
            <EmptyHint text="Selecteer producten om de impact per verpakking en per glas te tonen." />
          ) : (
            <div className="cpq-intro-impact-stack">
              <div className="cpq-intro-summary-card">
                <div className="cpq-intro-summary-head">
                  <div>
                    <div className="cpq-intro-card-title">Totaal</div>
                    <div className="cpq-intro-summary-subtitle">
                      {financialSummary.productCount} product
                      {financialSummary.productCount === 1 ? "" : "en"}
                    </div>
                  </div>
                </div>
                <div className="cpq-intro-summary-grid">
                  <IntroSummaryMetric
                    label="Omzet zonder actie"
                    value={financialSummary.revenueBeforeLabel}
                  />
                  <IntroSummaryMetric
                    label="Omzet met actie"
                    value={financialSummary.revenueAfterLabel}
                  />
                  <IntroSummaryMetric
                    label="Actiekosten"
                    value={financialSummary.promoCostLabel}
                  />
                  <IntroSummaryMetric
                    label="Kostprijs"
                    value={financialSummary.costTotalLabel}
                  />
                  <IntroSummaryMetric
                    label="Brutomarge"
                    value={financialSummary.grossMarginLabel}
                  />
                  <IntroSummaryMetric
                    label="Marge %"
                    value={financialSummary.marginPctLabel}
                  />
                </div>
                <div className="cpq-intro-summary-grid cpq-intro-summary-grid-glass">
                  <IntroSummaryMetric
                    label="Glasprijs zonder actie"
                    value={financialSummary.standardGlassRevenueLabel}
                  />
                  <IntroSummaryMetric
                    label="Glasprijs met actie"
                    value={financialSummary.introGlassRevenueLabel}
                  />
                  <IntroSummaryMetric
                    label="Kostprijs per glas"
                    value={financialSummary.glassCostLabel}
                  />
                </div>
              </div>

              {financialLines.length > 1 ? (
                <div className="cpq-intro-section-label">Per product</div>
              ) : null}

              {financialLines.map((line) => (
                <div key={line.optionId} className="cpq-intro-impact-product-card">
                  <div className="cpq-intro-impact-product-head">
                    <div className="cpq-intro-card-title">{line.label}</div>
                    <div className="cpq-intro-impact-product-subtitle">
                      {line.promoSummary} · Eenheid: {line.unitLabel}
                    </div>
                  </div>

                  <div className="cpq-intro-impact-sections">
                    <div>
                      <div className="cpq-intro-section-label">Per verpakking</div>
                      <div className="cpq-intro-metric-grid">
                        <IntroMetric label="Omzet zonder actie" value={line.standardPriceLabel} />
                        <IntroMetric label="Omzet met actie" value={line.introPriceLabel} />
                        <IntroMetric label="Actiekosten" value={line.customerAdvantageLabel} />
                        <IntroMetric label="Kostprijs" value={line.costPriceLabel} />
                        <IntroMetric label="Brutomarge" value={line.newMarginLabel} />
                        <IntroMetric
                          label="Marge %"
                          value={`${formatNumberNl(line.marginPct, 1)}%`}
                        />
                        <IntroMetric label="Standaard marge" value={line.standardMarginLabel} />
                        <IntroMetric label="Marge-impact" value={line.marginImpactLabel} />
                      </div>
                    </div>

                    <div>
                      <div className="cpq-intro-section-label">Per glas</div>
                      <div className="cpq-intro-metric-grid">
                        <IntroMetric label="Standaard glas" value={line.glassLabel} />
                        <IntroMetric label="Glazen / verpakking" value={line.glassesPerPackLabel} />
                        <IntroMetric
                          label="Glasprijs zonder actie"
                          value={line.standardGlassRevenueLabel}
                        />
                        <IntroMetric
                          label="Glasprijs met actie"
                          value={line.revenuePerGlassLabel}
                        />
                        <IntroMetric label="Kostprijs per glas" value={line.costPerGlassLabel} />
                        <IntroMetric label="Marge per glas" value={line.marginPerGlassLabel} />
                        <IntroMetric
                          label="Klantvoordeel per glas"
                          value={line.customerAdvantagePerGlassLabel}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Idea text="De financiële impact is afgeleid uit de bestaande verkoopprijs, kostprijs, liters per verpakking en de standaard glasmaat. Deze inzichten slaan we niet apart op in de offerte." />
      </div>
    </div>
  );
}
