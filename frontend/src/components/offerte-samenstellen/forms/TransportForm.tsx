import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo } from "react";

import {
  BooleanField,
  Field,
  Idea,
  SelectField,
} from "@/components/offerte-samenstellen/forms/FormControls";
import type { QuoteFormState } from "@/components/offerte-samenstellen/types";

type Props = {
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
  basisAfstandKm: string;
};

export function TransportForm({ form, setForm, basisAfstandKm }: Props) {
  // Sync basis distance into form state so it gets persisted into the Transport block payload.
  useEffect(() => {
    const next = String(basisAfstandKm ?? "");
    setForm((prev) => (prev.transportDistanceKm === next ? prev : { ...prev, transportDistanceKm: next }));
  }, [basisAfstandKm, setForm]);

  const retourAfstandKm = useMemo(() => {
    const parsed = Number(String(basisAfstandKm ?? "").replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) return "";
    const value = Math.round(parsed * 2 * 100) / 100;
    return String(value).replace(".", ",");
  }, [basisAfstandKm]);

  return (
    <div className="space-y-5">
      <div className="cpq-two-col">
        <Field
          label="Gratis verzending tot"
          value={form.transportFreeShippingThresholdValue}
          onChange={(value) =>
            setForm((prev) => ({ ...prev, transportFreeShippingThresholdValue: value }))
          }
        />
        <SelectField
          label="Drempeltype"
          value={form.transportFreeShippingThresholdUnit}
          options={[
            { label: "Doos", value: "boxes" },
            { label: "Pallet", value: "pallets" },
            { label: "Laag", value: "layers" },
            { label: "Fles", value: "fles" },
            { label: "Fust", value: "fust" },
            { label: "Liters", value: "liters" },
            { label: "KM", value: "km" },
            { label: "Orderwaarde", value: "order_value" },
          ]}
          onChange={(value) =>
            setForm((prev) => ({
              ...prev,
              transportFreeShippingThresholdUnit: value as any,
            }))
          }
        />
      </div>

      <SelectField
        label="Transportkosten berekenen"
        value={form.transportCostType}
        options={[
          { label: "Vast bedrag", value: "fixed" },
          { label: "Per km", value: "per_km" },
        ]}
        onChange={(value) => setForm((prev) => ({ ...prev, transportCostType: value as any }))}
      />

      {form.transportCostType === "fixed" ? (
        <Field
          label="Transportkosten (ex)"
          value={form.transportCostEx}
          onChange={(value) => setForm((prev) => ({ ...prev, transportCostEx: value }))}
          placeholder="Bijv. 40"
        />
      ) : null}

      {form.transportCostType === "per_km" ? (
        <div className="cpq-two-col">
          <Field
            label="Interne kostprijs per km (ex)"
            value={form.transportRateEx}
            onChange={(value) => setForm((prev) => ({ ...prev, transportRateEx: value }))}
            placeholder="0,45"
          />
          <Field label="Retourafstand (km)" value={retourAfstandKm} onChange={() => {}} />
        </div>
      ) : null}
      <BooleanField
        label="Meenemen in netto effect & break-even"
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
      <Idea text="Transport bestaat uit 2 delen: (1) wat je eventueel doorbelast aan de klant (kan 0 zijn bij gratis verzending) en (2) je interne transportkosten op basis van afstand × tarief. Interne kosten worden altijd berekend; deze toggle bepaalt of transport meetelt in netto effect en break-even." />
    </div>
  );
}
