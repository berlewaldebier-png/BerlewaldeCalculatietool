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

export function getGroothandelFormError(form: QuoteFormState, baseOfferRefs: string[] = []) {
  if (form.wholesaleUseBaseOfferProducts && baseOfferRefs.length === 0) {
    return "Basisofferte bevat nog geen producten om een groothandelsprijs voor te berekenen.";
  }

  if (!form.wholesaleUseBaseOfferProducts && form.wholesaleEligibleRefs.length === 0) {
    return "Selecteer minstens een product voor de groothandelsactie.";
  }

  const marginPct = Number(String(form.wholesaleMarginPct ?? "").replace(",", "."));
  if (!Number.isFinite(marginPct) || marginPct < 0) {
    return "Vul een geldige groothandelsmarge in.";
  }

  const expectedLitersRaw = String(form.wholesaleExpectedLiters ?? "").trim();
  if (expectedLitersRaw) {
    const expectedLiters = Number(expectedLitersRaw.replace(",", "."));
    if (!Number.isFinite(expectedLiters) || expectedLiters < 0) {
      return "Vul een geldige verwachte afname in liters in.";
    }
  }

  const upliftLitersRaw = String(form.wholesaleUpliftLiters ?? "").trim();
  if (upliftLitersRaw) {
    const upliftLiters = Number(upliftLitersRaw.replace(",", "."));
    if (!Number.isFinite(upliftLiters) || upliftLiters < 0) {
      return "Vul een geldige uplift in liters in.";
    }
  }
  const upliftPctRaw = String(form.wholesaleUpliftPct ?? "").trim();
  if (upliftPctRaw) {
    const upliftPct = Number(upliftPctRaw.replace(",", "."));
    if (!Number.isFinite(upliftPct) || upliftPct < 0) {
      return "Vul een geldige uplift in procenten in.";
    }
  }

  return "";
}

export function GroothandelForm({ form, setForm, products, baseOfferRefs }: Props) {
  const error = getGroothandelFormError(form, baseOfferRefs);
  const baseOfferCount = baseOfferRefs.length;

  return (
    <div className="space-y-5">
      {error ? <ErrorField text={error} /> : null}

      <BooleanField
        label={`Gebruik basisofferte-producten${baseOfferCount > 0 ? ` (${baseOfferCount})` : ""}`}
        checked={form.wholesaleUseBaseOfferProducts}
        onChange={(checked) =>
          setForm((prev) => ({
            ...prev,
            wholesaleUseBaseOfferProducts: checked,
          }))
        }
      />

      {form.wholesaleUseBaseOfferProducts ? (
        <Idea text="De groothandelsprijs wordt berekend op de producten uit de basisofferte." />
      ) : (
        <div className="cpq-field">
          <div className="cpq-label">Producten</div>
          <ProductPickerTable
            products={products}
            selectedRefs={form.wholesaleEligibleRefs}
            emptyHint="Voeg eerst een bierstijl en verpakking toe voor deze groothandelsactie."
            onChange={(nextRefs) =>
              setForm((prev) => ({
                ...prev,
                wholesaleEligibleRefs: nextRefs,
              }))
            }
          />
        </div>
      )}

      {!form.wholesaleUseBaseOfferProducts && form.wholesaleEligibleRefs.length === 0 ? (
        <EmptyHint text="Selecteer de producten waarvoor je een groothandelsprijs wilt tonen." />
      ) : null}

      <Field
        label="Gewenste marge groothandel (%)"
        value={form.wholesaleMarginPct}
        onChange={(value) => setForm((prev) => ({ ...prev, wholesaleMarginPct: value }))}
      />

      <Field
        label="Actie-volume (liters)"
        value={form.wholesaleExpectedLiters}
        onChange={(value) => setForm((prev) => ({ ...prev, wholesaleExpectedLiters: value }))}
        placeholder="Bijv. 10000"
        type="number"
        min="0"
      />

      <Idea text="V1 rekent terug vanaf de huidige horeca-sell-in prijs: groothandelsprijs = horeca prijs / (1 + marge%)." />

      <SelectField
        label="Actie geldt voor"
        value={form.wholesaleAppliesToVolume}
        options={[
          { label: "Bestaand volume", value: "existing" },
          { label: "Uplift (extra volume)", value: "uplift" },
          { label: "Bestaand + uplift", value: "both" },
        ]}
        onChange={(value) =>
          setForm((prev) => ({
            ...prev,
            wholesaleAppliesToVolume: value as any,
          }))
        }
      />

      <div className="cpq-form-grid" style={{ marginTop: -8 }}>
        <Field
          label="Uplift (liters)"
          value={form.wholesaleUpliftLiters}
          onChange={(value) => setForm((prev) => ({ ...prev, wholesaleUpliftLiters: value }))}
          placeholder="Bijv. 500"
          type="number"
          min="0"
        />
        <Field
          label="Uplift (%)"
          value={form.wholesaleUpliftPct}
          onChange={(value) => setForm((prev) => ({ ...prev, wholesaleUpliftPct: value }))}
          placeholder="Bijv. 5"
          type="number"
          min="0"
        />
      </div>

      <Idea text="Actie-volume = liters waarop de groothandelsprijs van toepassing is. Uplift = extra liters die je verwacht door de deal. Als je een klant selecteert in basisgegevens, tonen we daar baseline liters." />
    </div>
  );
}
