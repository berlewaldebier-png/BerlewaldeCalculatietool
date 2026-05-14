import type { Dispatch, SetStateAction } from "react";

import {
  BooleanField,
  EmptyHint,
  ErrorField,
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
  baseOfferRefs: string[];
};

export function getKortingFormError(form: QuoteFormState, baseOfferRefs: string[] = []) {
  if (form.kortingUseBaseOfferProducts && baseOfferRefs.length === 0) {
    return "Basisofferte bevat nog geen producten om korting op toe te passen.";
  }

  if (
    !form.kortingUseBaseOfferProducts &&
    form.discountMode === "Regel" &&
    form.kortingEligibleRefs.length === 0
  ) {
    return "Selecteer minstens een product voor deze regelkorting.";
  }

  const upliftLitersRaw = String(form.discountUpliftLiters ?? "").trim();
  if (upliftLitersRaw) {
    const upliftLiters = Number(upliftLitersRaw.replace(",", "."));
    if (!Number.isFinite(upliftLiters) || upliftLiters < 0) {
      return "Vul een geldige uplift in liters in.";
    }
  }
  const upliftPctRaw = String(form.discountUpliftPct ?? "").trim();
  if (upliftPctRaw) {
    const upliftPct = Number(upliftPctRaw.replace(",", "."));
    if (!Number.isFinite(upliftPct) || upliftPct < 0) {
      return "Vul een geldige uplift in procenten in.";
    }
  }

  return "";
}

export function KortingForm({ form, setForm, products, baseOfferRefs }: Props) {
  const isLineScope = form.discountMode === "Regel";
  const error = getKortingFormError(form, baseOfferRefs);
  const baseOfferCount = baseOfferRefs.length;

  return (
    <div className="space-y-5">
      {error ? <ErrorField text={error} /> : null}

      <BooleanField
        label={`Gebruik basisofferte-producten${baseOfferCount > 0 ? ` (${baseOfferCount})` : ""}`}
        checked={form.kortingUseBaseOfferProducts}
        onChange={(checked) =>
          setForm((prev) => ({
            ...prev,
            kortingUseBaseOfferProducts: checked,
          }))
        }
      />

      <SelectField
        label="Scope"
        value={form.discountMode}
        options={[
          { label: "Totaal", value: "Totaal" },
          { label: "Regel", value: "Regel" },
        ]}
        onChange={(value) => setForm((prev) => ({ ...prev, discountMode: value }))}
      />

      {form.kortingUseBaseOfferProducts ? (
        <Idea text="De korting gebruikt de producten uit de basisofferte. Pas daar de productscope aan als je andere producten wilt meenemen." />
      ) : isLineScope ? (
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
      ) : (
        <EmptyHint text="Deze korting geldt voor alle producten die je in dit voorstel opneemt." />
      )}

      <Field
        label="Waarde (%)"
        value={form.discountValue}
        onChange={(value) => setForm((prev) => ({ ...prev, discountValue: value }))}
      />

      <SelectField
        label="Actie geldt voor"
        value={form.discountAppliesToVolume}
        options={[
          { label: "Uplift (extra volume)", value: "uplift" },
          { label: "Bestaand volume", value: "existing" },
          { label: "Bestaand + uplift", value: "both" },
        ]}
        onChange={(value) =>
          setForm((prev) => ({
            ...prev,
            discountAppliesToVolume: value as any,
          }))
        }
      />

      <div className="cpq-form-grid" style={{ marginTop: -8 }}>
        <Field
          label="Uplift (liters)"
          value={form.discountUpliftLiters}
          onChange={(value) => setForm((prev) => ({ ...prev, discountUpliftLiters: value }))}
          placeholder="Bijv. 100"
          type="number"
          min="0"
        />
        <Field
          label="Uplift (%)"
          value={form.discountUpliftPct}
          onChange={(value) => setForm((prev) => ({ ...prev, discountUpliftPct: value }))}
          placeholder="Bijv. 10"
          type="number"
          min="0"
        />
      </div>
      <Idea text="Regelkorting mag op meerdere producten tegelijk. V1 behandelt de korting als percentage op de verkoopprijs." />
      <Idea text="Uplift is extra volume dat je verwacht door de actie (bovenop baseline). Als je een klant selecteert in basisgegevens, tonen we daar de baseline liters." />
    </div>
  );
}
