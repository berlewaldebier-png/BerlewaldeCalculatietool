import type { Dispatch, SetStateAction } from "react";

import {
  ErrorField,
  Field,
  Idea,
} from "@/components/offerte-samenstellen/forms/FormControls";
import type { QuoteFormState } from "@/components/offerte-samenstellen/types";

type Props = {
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
};

function asNumber(value: string) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function getPalletopbouwFormError(form: QuoteFormState) {
  const doosLayer = asNumber(form.palletDoosUnitsPerLayer);
  const doosPallet = asNumber(form.palletDoosUnitsPerPallet);
  const fustLayer = asNumber(form.palletFustUnitsPerLayer);
  const fustPallet = asNumber(form.palletFustUnitsPerPallet);

  if (!Number.isFinite(doosLayer) || doosLayer <= 0) return "Dozen per laag moet groter zijn dan 0.";
  if (!Number.isFinite(doosPallet) || doosPallet <= 0) return "Dozen per pallet moet groter zijn dan 0.";
  if (!Number.isFinite(fustLayer) || fustLayer <= 0) return "Fusten per laag moet groter zijn dan 0.";
  if (!Number.isFinite(fustPallet) || fustPallet <= 0) return "Fusten per pallet moet groter zijn dan 0.";
  if (doosPallet < doosLayer) return "Dozen per pallet moet >= dozen per laag.";
  if (fustPallet < fustLayer) return "Fusten per pallet moet >= fusten per laag.";
  return "";
}

export function PalletopbouwForm({ form, setForm }: Props) {
  const error = getPalletopbouwFormError(form);

  return (
    <div className="space-y-5">
      {error ? <ErrorField text={error} /> : null}

      <div className="cpq-grid-2">
        <Field
          label="Dozen per laag"
          value={form.palletDoosUnitsPerLayer}
          onChange={(value) => setForm((prev) => ({ ...prev, palletDoosUnitsPerLayer: value }))}
        />
        <Field
          label="Dozen per pallet"
          value={form.palletDoosUnitsPerPallet}
          onChange={(value) => setForm((prev) => ({ ...prev, palletDoosUnitsPerPallet: value }))}
        />
        <Field
          label="Fusten per laag"
          value={form.palletFustUnitsPerLayer}
          onChange={(value) => setForm((prev) => ({ ...prev, palletFustUnitsPerLayer: value }))}
        />
        <Field
          label="Fusten per pallet"
          value={form.palletFustUnitsPerPallet}
          onChange={(value) => setForm((prev) => ({ ...prev, palletFustUnitsPerPallet: value }))}
        />
      </div>

      <Idea text="Deze defaults beïnvloeden afronden (volle lagen/pallets) en de palletopbouw onder de basisofferte. Standaard: laag 12 dozen / 20 fusten, pallet 72 dozen / 40 fusten." />
    </div>
  );
}

