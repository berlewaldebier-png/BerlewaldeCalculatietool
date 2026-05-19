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

export function getKortingFormError(form: QuoteFormState, baseOfferRefs: string[] = []) {
  if (baseOfferRefs.length === 0) {
    return "Basisofferte bevat nog geen producten om korting op toe te passen.";
  }

  if (!form.kortingScopeAllProducts && form.kortingEligibleRefs.length === 0) {
    return "Selecteer minstens een product voor deze regelkorting.";
  }

  return "";
}

export function KortingForm({ form, setForm, products, baseOfferRefs, quoteYear }: Props) {
  const error = getKortingFormError(form, baseOfferRefs);
  const baseOfferCount = baseOfferRefs.length;
  const baseOfferProducts = useMemo(
    () => products.filter((p) => baseOfferRefs.includes(p.optionId)),
    [products, baseOfferRefs]
  );

  return (
    <div className="space-y-5">
      {error ? <ErrorField text={error} /> : null}

      <BooleanField
        label={`Geldt korting voor alle producten?${baseOfferCount > 0 ? ` (${baseOfferCount})` : ""}`}
        checked={form.kortingScopeAllProducts}
        onChange={(checked) =>
          setForm((prev) => ({
            ...prev,
            kortingScopeAllProducts: checked,
          }))
        }
      />

      {!form.kortingScopeAllProducts ? (
        <div className="cpq-field">
          <div className="cpq-label">Producten</div>
          <ProductScopeChecklist
            products={baseOfferProducts as any}
            selectedRefs={form.kortingEligibleRefs}
            emptyHint="Voeg eerst producten toe aan de basisofferte om korting toe te kunnen passen."
            onChange={(nextRefs) =>
              setForm((prev) => ({
                ...prev,
                kortingEligibleRefs: nextRefs,
              }))
            }
          />
        </div>
      ) : (
        <EmptyHint text="Deze korting geldt voor alle producten die je in dit voorstel opneemt." />
      )}

      <Field
        label="Waarde (%)"
        value={form.discountValue}
        onChange={(value) => setForm((prev) => ({ ...prev, discountValue: value }))}
      />
      <Idea text="Regelkorting mag op meerdere producten tegelijk. V1 behandelt de korting als percentage op de verkoopprijs." />
    </div>
  );
}
