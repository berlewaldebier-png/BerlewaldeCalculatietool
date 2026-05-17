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
        label="Gratis verzending vanaf"
        value={form.transportFreeShippingThresholdValue}
        onChange={(value) =>
          setForm((prev) => ({ ...prev, transportFreeShippingThresholdValue: value }))
        }
      />
      <Field
        label="Drempeltype"
        value={form.transportFreeShippingThresholdUnit}
        onChange={(value) =>
          setForm((prev) => ({
            ...prev,
            transportFreeShippingThresholdUnit: value as any,
          }))
        }
      />
      <Field
        label="Transportkosten (ex)"
        value={form.transportCostEx}
        onChange={(value) => setForm((prev) => ({ ...prev, transportCostEx: value }))}
      />
      <Field
        label="Kostentype"
        value={form.transportCostType}
        onChange={(value) =>
          setForm((prev) => ({ ...prev, transportCostType: value as any }))
        }
      />
      <BooleanField
        label="Meenemen in marge"
        checked={form.transportIncludeInMargin}
        onChange={(checked) =>
          setForm((prev) => ({ ...prev, transportIncludeInMargin: checked }))
        }
      />
      <BooleanField
        label="Doorbelasten aan klant"
        checked={form.transportChargedToCustomer}
        onChange={(checked) =>
          setForm((prev) => ({ ...prev, transportChargedToCustomer: checked }))
        }
      />
      <Idea text="Transport is een aparte actie. Als je doorbelast, telt het als omzet en heeft het geen negatieve marge-impact. Als je niet doorbelast, kun je aangeven of het meetelt in marge/break-even." />
    </div>
  );
}
