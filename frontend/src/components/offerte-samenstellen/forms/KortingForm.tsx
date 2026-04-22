import type { Dispatch, SetStateAction } from "react";

import {
  Field,
  Idea,
  SelectField,
} from "@/components/offerte-samenstellen/forms/FormControls";
import { ProductPickerTable } from "@/components/offerte-samenstellen/forms/ProductPickerTable";
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
        <div className="cpq-field">
          <div className="cpq-label">Producten</div>
          <ProductPickerTable
            products={products}
            selectedRefs={form.kortingEligibleRefs}
            emptyHint="Voeg eerst een bierstijl en verpakking toe voor deze korting."
            onChange={(nextRefs) =>
              setForm((prev) => ({
                ...prev,
                kortingEligibleRefs: nextRefs,
              }))
            }
          />
        </div>
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
