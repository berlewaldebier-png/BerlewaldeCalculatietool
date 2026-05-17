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
  quoteYear?: number;
};

export function getGroothandelFormError(form: QuoteFormState, baseOfferRefs: string[] = []) {
  const marginRaw = String(form.wholesaleMarginPct ?? "").trim();
  const marginValue = Number(marginRaw.replace(",", "."));

  if (!marginRaw) return "Vul een gewenste groothandelsmarge in.";
  if (!Number.isFinite(marginValue)) return "Groothandelsmarge is geen geldig getal.";
  if (marginValue <= 0) return "Groothandelsmarge moet groter zijn dan 0%.";
  if (marginValue >= 80) return "Groothandelsmarge is te hoog (max 80%).";

  if (form.wholesaleUseBaseOfferProducts && baseOfferRefs.length === 0) {
    return "Basisofferte bevat nog geen producten om de groothandelsmarge op toe te passen.";
  }

  if (!form.wholesaleUseBaseOfferProducts && form.wholesaleEligibleRefs.length === 0) {
    return "Selecteer minstens een product om de groothandelsmarge op toe te passen.";
  }

  return "";
}

export function GroothandelForm({ form, setForm, products, baseOfferRefs, quoteYear }: Props) {
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
        <Idea text="De groothandelsmarge wordt toegepast op de producten uit de basisofferte." />
      ) : (
        <div className="cpq-field">
          <div className="cpq-label">Producten</div>
          <ProductPickerTable
            products={products}
            selectedRefs={form.wholesaleEligibleRefs}
            emptyHint="Voeg eerst producten toe aan je voorstel om een groothandelsmarge te kunnen toepassen."
            quoteYear={quoteYear}
            onChange={(nextRefs) =>
              setForm((prev) => ({
                ...prev,
                wholesaleEligibleRefs: nextRefs,
              }))
            }
          />
        </div>
      )}

      <Field
        label="Gewenste groothandelsmarge (%)"
        value={form.wholesaleMarginPct}
        onChange={(value) => setForm((prev) => ({ ...prev, wholesaleMarginPct: value }))}
      />

      <EmptyHint text="De groothandelsprijs wordt teruggerekend vanaf de kanaalprijs (sell-in, ex). Verdere kortingen of uplift-velden worden automatisch via het offertevolume bepaald." />
    </div>
  );
}

