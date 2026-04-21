import type { Dispatch, SetStateAction } from "react";

import { Field, Idea, MultiSelectField, SelectField } from "@/components/offerte-samenstellen/forms/FormControls";
import type { ProductOption, QuoteFormState } from "@/components/offerte-samenstellen/types";

type Props = {
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
  products: ProductOption[];
};

export function IntroForm({ form, setForm, products }: Props) {
  return (
    <div className="space-y-5">
      <Field
        label="Startdatum"
        value={form.introStart}
        onChange={(value) => setForm((prev) => ({ ...prev, introStart: value }))}
      />
      <Field
        label="Einddatum"
        value={form.introEnd}
        onChange={(value) => setForm((prev) => ({ ...prev, introEnd: value }))}
      />

      <MultiSelectField
        label="Producten die meedoen"
        items={products.map((product) => ({ id: product.optionId, label: product.label }))}
        selected={form.introEligibleRefs}
        onToggle={(id) =>
          setForm((prev) => ({
            ...prev,
            introEligibleRefs: prev.introEligibleRefs.includes(id)
              ? prev.introEligibleRefs.filter((item) => item !== id)
              : [...prev.introEligibleRefs, id],
            introProducts: products
              .filter((product) =>
                prev.introEligibleRefs.includes(id)
                  ? product.optionId !== id && prev.introEligibleRefs.includes(product.optionId)
                  : product.optionId === id || prev.introEligibleRefs.includes(product.optionId)
              )
              .map((product) => product.label)
              .join(", "),
          }))
        }
      />

      <SelectField
        label="Actievorm"
        value={form.introPromoType}
        options={[
          { label: "% korting", value: "discount" },
          { label: "X + Y", value: "x_plus_y" },
          { label: "Drempelkorting", value: "threshold_discount" },
        ]}
        onChange={(value) => setForm((prev) => ({ ...prev, introPromoType: value }))}
      />

      <Field
        label="Actie"
        value={form.introAction}
        onChange={(value) => setForm((prev) => ({ ...prev, introAction: value }))}
      />
      <Field
        label="Aanvulling"
        value={form.introValue}
        onChange={(value) => setForm((prev) => ({ ...prev, introValue: value }))}
      />
      <Idea text="V1: introductievarianten worden nog beperkt doorgerekend, maar de configuratie wordt wel volledig als block opgeslagen." />
    </div>
  );
}
