import type { Dispatch, SetStateAction } from "react";

import { Field, Idea, MultiSelectField } from "@/components/offerte-samenstellen/forms/FormControls";
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

      <MultiSelectField
        label="Deelnemende producten"
        items={products.map((product) => ({ id: product.optionId, label: product.label }))}
        selected={form.mixEligibleRefs}
        onToggle={(id) =>
          setForm((prev) => ({
            ...prev,
            mixEligibleRefs: prev.mixEligibleRefs.includes(id)
              ? prev.mixEligibleRefs.filter((item) => item !== id)
              : [...prev.mixEligibleRefs, id],
          }))
        }
      />
      <Idea text="V1: mix deals worden berekend als eenvoudige X+Y gratis configuratie over de geselecteerde producten." />
    </div>
  );
}
