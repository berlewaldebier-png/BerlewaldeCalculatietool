import type { Dispatch, SetStateAction } from "react";

import { Field, Idea, MultiSelectField } from "@/components/offerte-samenstellen/forms/FormControls";
import type { ProductOption, QuoteFormState } from "@/components/offerte-samenstellen/types";

type Props = {
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
  products: ProductOption[];
};

function updateStaffelField(
  setForm: Dispatch<SetStateAction<QuoteFormState>>,
  index: number,
  key: "from" | "to" | "price",
  value: string
) {
  setForm((prev) => {
    const rows = [...prev.staffelRows];
    rows[index] = { ...rows[index], [key]: value };
    return { ...prev, staffelRows: rows };
  });
}

export function StaffelForm({ form, setForm, products }: Props) {
  return (
    <div className="space-y-5">
      <Field
        label="Productlabel"
        value={form.staffelProduct}
        onChange={(value) => setForm((prev) => ({ ...prev, staffelProduct: value }))}
      />

      <MultiSelectField
        label="Producten voor staffel"
        items={products.map((product) => ({ id: product.optionId, label: product.label }))}
        selected={form.staffelEligibleRefs}
        onToggle={(id) =>
          setForm((prev) => ({
            ...prev,
            staffelEligibleRefs: prev.staffelEligibleRefs.includes(id)
              ? prev.staffelEligibleRefs.filter((item) => item !== id)
              : [...prev.staffelEligibleRefs, id],
          }))
        }
      />

      <div className="cpq-field">
        <div className="cpq-label">Staffelregels</div>
        <div className="cpq-staffel-grid">
          {form.staffelRows.map((row, index) => (
            <div key={`${row.from}-${row.to}-${index}`} className="cpq-staffel-row">
              <input
                value={row.from}
                onChange={(e) => updateStaffelField(setForm, index, "from", e.target.value)}
                className="cpq-input"
                placeholder="Vanaf"
              />
              <input
                value={row.to}
                onChange={(e) => updateStaffelField(setForm, index, "to", e.target.value)}
                className="cpq-input"
                placeholder="Tot"
              />
              <input
                value={row.price}
                onChange={(e) => updateStaffelField(setForm, index, "price", e.target.value)}
                className="cpq-input"
                placeholder="Prijs ex"
              />
            </div>
          ))}
        </div>
      </div>
      <Idea text="V1: staffelregels worden als block opgeslagen en gebruikt voor een eenvoudige prijs-override per range." />
    </div>
  );
}
