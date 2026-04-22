import type { Dispatch, SetStateAction } from "react";

import { Field, Idea } from "@/components/offerte-samenstellen/forms/FormControls";
import { ProductPickerTable } from "@/components/offerte-samenstellen/forms/ProductPickerTable";
import type { ProductOption, QuoteFormState } from "@/components/offerte-samenstellen/types";

type Props = {
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
  products: ProductOption[];
};

export function MixDealForm({ form, setForm, products }: Props) {
  return (
    <div className="space-y-5">
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
        <ProductPickerTable
          products={products}
          selectedRefs={form.mixEligibleRefs}
          emptyHint="Voeg eerst een bierstijl en verpakking toe voor deze mixdeal."
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
