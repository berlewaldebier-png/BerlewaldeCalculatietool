import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";

import { Field, Idea } from "@/components/offerte-samenstellen/forms/FormControls";
import { ProductScopeChecklist } from "@/components/offerte-samenstellen/forms/ProductScopeChecklist";
import type { ProductOption, QuoteFormState } from "@/components/offerte-samenstellen/types";

type Props = {
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
  products: ProductOption[];
  baseOfferRefs: string[];
  quoteYear?: number;
};

export function MixDealForm({ form, setForm, products, baseOfferRefs }: Props) {
  const baseOfferProducts = useMemo(
    () => products.filter((p) => baseOfferRefs.includes(p.optionId)),
    [products, baseOfferRefs]
  );
  return (
    <div className="space-y-5">
      {baseOfferProducts.length === 0 ? (
        <Idea text="Voeg eerst producten toe aan de basisofferte om een mixdeal te kunnen opzetten." />
      ) : null}
      <Field
        label="Voorwaarde"
        value={form.mixCondition}
        onChange={(value) => setForm((prev) => ({ ...prev, mixCondition: value }))}
      />
      <Field
        label="Mixstructuur"
        value={form.mixStructure}
        onChange={(value) => setForm((prev) => ({ ...prev, mixStructure: value }))}
        placeholder="Bijv. 3+2"
      />

      <div className="cpq-field">
        <div className="cpq-label">Deelnemende producten</div>
        <ProductScopeChecklist
          products={baseOfferProducts as any}
          selectedRefs={form.mixEligibleRefs}
          emptyHint="Voeg eerst producten toe aan de basisofferte om een mixdeal te kunnen opzetten."
          onChange={(nextRefs) =>
            setForm((prev) => ({
              ...prev,
              mixEligibleRefs: nextRefs,
            }))
          }
        />
      </div>
      <Idea text="V1: mix deals worden berekend als eenvoudige X+Y gratis configuratie over de geselecteerde producten." />
    </div>
  );
}
