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

export function TransportForm({ form, setForm }: Props) {
  return (
    <div className="space-y-5">
      <Field
        label="Afstand (km enkele rit)"
        value={form.transportDistanceKm}
        onChange={(value) => setForm((prev) => ({ ...prev, transportDistanceKm: value }))}
      />
      <Field
        label="Kosten per km (ex)"
        value={form.transportRateEx}
        onChange={(value) => setForm((prev) => ({ ...prev, transportRateEx: value }))}
      />
      <Field
        label="Aantal leveringen"
        value={form.transportDeliveries}
        onChange={(value) => setForm((prev) => ({ ...prev, transportDeliveries: value }))}
      />
      <Field
        label="Drempel km"
        value={form.transportThresholdKm}
        onChange={(value) => setForm((prev) => ({ ...prev, transportThresholdKm: value }))}
      />
      <BooleanField
        label="Doorbelasten aan klant"
        checked={form.transportChargedToCustomer}
        onChange={(checked) =>
          setForm((prev) => ({ ...prev, transportChargedToCustomer: checked }))
        }
      />
      <Idea text="Bij meer dan de ingestelde drempel rekenen we transportkosten. Als je niet doorbelast, blijft de marge-impact intern zichtbaar." />
    </div>
  );
}
