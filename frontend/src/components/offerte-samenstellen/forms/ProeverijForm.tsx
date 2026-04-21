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

export function ProeverijForm({ form, setForm }: Props) {
  return (
    <div className="space-y-5">
      <Field
        label="Voorwaarde"
        value={form.tastingCondition}
        onChange={(value) => setForm((prev) => ({ ...prev, tastingCondition: value }))}
      />
      <Field
        label="Interne kost (ex)"
        value={form.tastingCostEx}
        onChange={(value) => setForm((prev) => ({ ...prev, tastingCostEx: value }))}
      />
      <BooleanField
        label="Gratis"
        checked={form.tastingIsFree}
        onChange={(checked) => setForm((prev) => ({ ...prev, tastingIsFree: checked }))}
      />
      {!form.tastingIsFree ? (
        <Field
          label="Prijs (ex)"
          value={form.tastingPriceEx}
          onChange={(value) => setForm((prev) => ({ ...prev, tastingPriceEx: value }))}
        />
      ) : null}
      <Idea text="Proeverij blijft altijd toegestaan als extra. Gratis of betaald hangt af van de ingestelde voorwaarde." />
    </div>
  );
}
