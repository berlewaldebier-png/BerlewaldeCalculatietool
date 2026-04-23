import type { Dispatch, SetStateAction } from "react";

import {
  BooleanField,
  EmptyHint,
  ErrorField,
  Field,
  Idea,
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

      <Idea text="V1 rekent terug vanaf de huidige horeca-sell-in prijs: groothandelsprijs = horeca prijs / (1 + marge%)." />
    </div>
  );
}
