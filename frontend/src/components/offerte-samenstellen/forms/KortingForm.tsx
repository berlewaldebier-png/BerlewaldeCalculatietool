import type { Dispatch, SetStateAction } from "react";

import {
  Field,
  Idea,
  MultiSelectField,
  SelectField,
} from "@/components/offerte-samenstellen/forms/FormControls";
import type { ProductOption, QuoteFormState } from "@/components/offerte-samenstellen/types";

type Props = {
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
  products: ProductOption[];
};

export function KortingForm({ form, setForm, products }: Props) {
  const isLineScope = form.discountMode === "Regel";

  return (
    <div className="space-y-5">
      <SelectField
        label="Scope"
        value={form.discountMode}
        options={[
          { label: "Totaal", value: "Totaal" },
          { label: "Regel", value: "Regel" },
        ]}
        onChange={(value) => setForm((prev) => ({ ...prev, discountMode: value }))}
      />

      {isLineScope ? (
        <MultiSelectField
          label="Producten"
          items={products.map((product) => ({ id: product.optionId, label: product.label }))}
          selected={form.kortingEligibleRefs}
          onToggle={(id) =>
            setForm((prev) => ({
              ...prev,
              kortingEligibleRefs: prev.kortingEligibleRefs.includes(id)
                ? prev.kortingEligibleRefs.filter((item) => item !== id)
                : [...prev.kortingEligibleRefs, id],
            }))
          }
        />
      ) : null}

      <Field
        label="Waarde (%)"
        value={form.discountValue}
        onChange={(value) => setForm((prev) => ({ ...prev, discountValue: value }))}
      />
      <Idea text="Regelkorting mag op meerdere producten tegelijk. V1 behandelt de korting als percentage op de verkoopprijs." />
    </div>
  );
}
