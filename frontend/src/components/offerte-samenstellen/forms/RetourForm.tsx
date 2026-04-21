import type { Dispatch, SetStateAction } from "react";

import { Field, Idea } from "@/components/offerte-samenstellen/forms/FormControls";
import type { QuoteFormState } from "@/components/offerte-samenstellen/types";

type Props = {
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
};

export function RetourForm({ form, setForm }: Props) {
  return (
    <div className="space-y-5">
      <Field
        label="Verwacht retourpercentage (%)"
        value={form.returnPct}
        onChange={(value) => setForm((prev) => ({ ...prev, returnPct: value }))}
      />
      <Idea text="V1 houdt retour conservatief: omzet daalt, maar kosten blijven gelijk." />
    </div>
  );
}
