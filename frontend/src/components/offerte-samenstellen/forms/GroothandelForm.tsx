import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  BooleanField,
  EmptyHint,
  ErrorField,
  Field,
  Idea,
} from "@/components/offerte-samenstellen/forms/FormControls";
import { ProductScopeChecklist } from "@/components/offerte-samenstellen/forms/ProductScopeChecklist";
import type { ProductOption, QuoteFormState } from "@/components/offerte-samenstellen/types";

type Props = {
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
  products: ProductOption[];
  baseOfferRefs: string[];
  quoteYear?: number;
};

export function getGroothandelFormError(form: QuoteFormState, baseOfferRefs: string[] = []) {
  const marginRaw = String(form.wholesaleMarginPct ?? "").trim();
  const marginValue = Number(marginRaw.replace(",", "."));

  if (baseOfferRefs.length === 0) {
    return "Basisofferte bevat nog geen producten om de groothandelsmarge op toe te passen.";
  }

  if (!form.wholesaleScopeAllProducts && form.wholesaleEligibleRefs.length === 0) {
    return "Selecteer minstens een product om de groothandelsmarge op toe te passen.";
  }

  if (form.wholesaleSameMarginAllProducts) {
    if (!marginRaw) return "Vul een gewenste groothandelsmarge in.";
    if (!Number.isFinite(marginValue)) return "Groothandelsmarge is geen geldig getal.";
    if (marginValue <= 0) return "Groothandelsmarge moet groter zijn dan 0%.";
    if (marginValue >= 80) return "Groothandelsmarge is te hoog (max 80%).";
  } else {
    const margins = form.wholesaleMarginsByRef ?? {};
    const refs = form.wholesaleScopeAllProducts ? baseOfferRefs : form.wholesaleEligibleRefs;
    const hasAny = refs.some((ref) => {
      const raw = String(margins[ref] ?? "").trim();
      const value = Number(raw.replace(",", "."));
      return raw && Number.isFinite(value) && value > 0 && value < 80;
    });
    if (!hasAny) return "Vul minstens één productmarge in (>0% en <80%).";
  }

  return "";
}

export function GroothandelForm({ form, setForm, products, baseOfferRefs, quoteYear }: Props) {
  const error = getGroothandelFormError(form, baseOfferRefs);
  const baseOfferCount = baseOfferRefs.length;
  const baseOfferProducts = useMemo(
    () => products.filter((p) => baseOfferRefs.includes(p.optionId)),
    [products, baseOfferRefs]
  );
  const effectiveRefs = form.wholesaleScopeAllProducts ? baseOfferRefs : form.wholesaleEligibleRefs;

  return (
    <div className="space-y-5">
      {error ? <ErrorField text={error} /> : null}

      <BooleanField
        label={`Geldt groothandel voor alle producten?${baseOfferCount > 0 ? ` (${baseOfferCount})` : ""}`}
        checked={form.wholesaleScopeAllProducts}
        onChange={(checked) =>
          setForm((prev) => ({
            ...prev,
            wholesaleScopeAllProducts: checked,
          }))
        }
      />

      {form.wholesaleScopeAllProducts ? (
        <Idea text="De groothandelsmarge geldt voor alle producten in de basisofferte." />
      ) : (
        <div className="cpq-field">
          <div className="cpq-label">Producten</div>
          <ProductScopeChecklist
            products={baseOfferProducts as any}
            selectedRefs={form.wholesaleEligibleRefs}
            emptyHint="Voeg eerst producten toe aan je basisofferte om een groothandelsmarge te kunnen toepassen."
            onChange={(nextRefs) =>
              setForm((prev) => ({
                ...prev,
                wholesaleEligibleRefs: nextRefs,
              }))
            }
          />
        </div>
      )}

      <BooleanField
        label="Zelfde marge voor alle (geselecteerde) producten?"
        checked={form.wholesaleSameMarginAllProducts}
        onChange={(checked) =>
          setForm((prev) => ({
            ...prev,
            wholesaleSameMarginAllProducts: checked,
          }))
        }
      />

      {form.wholesaleSameMarginAllProducts ? (
        <Field
          label="Gewenste groothandelsmarge (%)"
          value={form.wholesaleMarginPct}
          onChange={(value) => setForm((prev) => ({ ...prev, wholesaleMarginPct: value }))}
        />
      ) : null}

      {!form.wholesaleSameMarginAllProducts ? (
        <div className="cpq-field">
          <div className="cpq-label">Marge per product (%)</div>
          <div className="space-y-2">
            {effectiveRefs.map((ref) => {
              const label = products.find((p) => p.optionId === ref)?.label ?? ref;
              return (
                <div key={ref} className="flex items-center gap-3">
                  <div style={{ flex: 1 }} className="cpq-muted">
                    {label}
                  </div>
                  <input
                    className="cpq-input"
                    style={{ width: 120 }}
                    value={String((form.wholesaleMarginsByRef ?? {})[ref] ?? "")}
                    placeholder="bijv. 18"
                    onChange={(e) => {
                      const value = e.target.value;
                      setForm((prev) => ({
                        ...prev,
                        wholesaleMarginsByRef: {
                          ...(prev.wholesaleMarginsByRef ?? {}),
                          [ref]: value,
                        },
                      }));
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <EmptyHint text="De groothandelsprijs wordt teruggerekend vanaf de kanaalprijs (sell-in, ex). Verdere kortingen of uplift-velden worden automatisch via het offertevolume bepaald." />
    </div>
  );
}

