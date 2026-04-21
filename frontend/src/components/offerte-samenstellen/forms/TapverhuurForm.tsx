import type { Dispatch, SetStateAction } from "react";

import {
  BooleanField,
  Field,
  Idea,
} from "@/components/offerte-samenstellen/forms/FormControls";
import type { QuoteFormState } from "@/components/offerte-samenstellen/types";

type Props = {
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
};

export function TapverhuurForm({ form, setForm }: Props) {
  return (
    <div className="space-y-5">
      <Field
        label="Voorwaarde"
        value={form.tapCondition}
        onChange={(value) => setForm((prev) => ({ ...prev, tapCondition: value }))}
      />
      <Field
        label="Interne kost (ex)"
        value={form.tapCostEx}
        onChange={(value) => setForm((prev) => ({ ...prev, tapCostEx: value }))}
      />
      <BooleanField
        label="Gratis"
        checked={form.tapIsFree}
        onChange={(checked) => setForm((prev) => ({ ...prev, tapIsFree: checked }))}
      />
      {!form.tapIsFree ? (
        <Field
          label="Prijs (ex)"
          value={form.tapPriceEx}
          onChange={(value) => setForm((prev) => ({ ...prev, tapPriceEx: value }))}
        />
      ) : null}
      <Idea text="Tapverhuur blijft als losse extra zichtbaar zodat kosten en prijsafspraken transparant blijven." />
    </div>
  );
}
