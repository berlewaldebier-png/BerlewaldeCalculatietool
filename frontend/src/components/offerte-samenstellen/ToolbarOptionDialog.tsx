import type { Dispatch, SetStateAction } from "react";

import type { OptionAvailability } from "@/components/offerte-samenstellen/conflictRules";
import { IntroForm, getIntroFormError } from "@/components/offerte-samenstellen/forms/IntroForm";
import { KortingForm } from "@/components/offerte-samenstellen/forms/KortingForm";
import { MixDealForm } from "@/components/offerte-samenstellen/forms/MixDealForm";
import { ProeverijForm } from "@/components/offerte-samenstellen/forms/ProeverijForm";
import { RetourForm } from "@/components/offerte-samenstellen/forms/RetourForm";
import { StaffelForm, getStaffelFormError } from "@/components/offerte-samenstellen/forms/StaffelForm";
import { TapverhuurForm } from "@/components/offerte-samenstellen/forms/TapverhuurForm";
import { TransportForm } from "@/components/offerte-samenstellen/forms/TransportForm";
import type {
  OptionType,
  ProductOption,
  QuoteFormState,
} from "@/components/offerte-samenstellen/types";

type Props = {
  selectedOption: OptionType;
  hasIntro: boolean;
  incompatibilityHints: string[];
  selectedOptionAvailability: OptionAvailability;
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
  productOptions: ProductOption[];
  onClose: () => void;
  onSave: () => void;
};

function getContextLabel(selectedOption: OptionType, hasIntro: boolean) {
  if (selectedOption === "Intro") {
    return "Introductieperiode";
  }
  if (hasIntro) {
    return "Standaardperiode na introductie";
  }
  return "Standaardperiode";
}

export function ToolbarOptionDialog({
  selectedOption,
  hasIntro,
  incompatibilityHints,
  selectedOptionAvailability,
  form,
  setForm,
  productOptions,
  onClose,
  onSave,
}: Props) {
  const introError = selectedOption === "Intro" ? getIntroFormError(form) : "";
  const staffelError =
    selectedOption === "Staffel" ? getStaffelFormError(form, productOptions) : "";
  const saveBlockedReason =
    introError || staffelError || selectedOptionAvailability.reasons[0] || "";
  const canSave = selectedOptionAvailability.allowed && !introError && !staffelError;
  const contextLabel = getContextLabel(selectedOption, hasIntro);

  return (
    <div className="cpq-modal-backdrop" role="dialog" aria-modal="true">
      <div className={`cpq-modal${selectedOption === "Intro" || selectedOption === "Staffel" ? " cpq-modal-wide" : ""}`}>
        <div className="cpq-modal-header">
          <div>
            <div className="cpq-kicker">Optie toevoegen</div>
            <h3 className="cpq-modal-title">
              {selectedOption} <span className="cpq-muted">({contextLabel})</span>
            </h3>
          </div>
          <button onClick={onClose} className="cpq-icon-button" type="button">
            ×
          </button>
        </div>

        <div className="cpq-modal-body">
          {incompatibilityHints.length > 0 ? (
            <div className="cpq-alert cpq-alert-warn">
              {incompatibilityHints.map((hint) => (
                <div key={hint}>{hint}</div>
              ))}
            </div>
          ) : null}

          {selectedOptionAvailability.reasons.length > 0 ? (
            <div className="cpq-alert cpq-alert-warn">
              {selectedOptionAvailability.reasons.map((reason) => (
                <div key={reason}>{reason}</div>
              ))}
            </div>
          ) : null}

          {selectedOption === "Intro" ? (
            <IntroForm form={form} setForm={setForm} products={productOptions} />
          ) : null}
          {selectedOption === "Staffel" ? (
            <StaffelForm form={form} setForm={setForm} products={productOptions} />
          ) : null}
          {selectedOption === "Mix" ? (
            <MixDealForm form={form} setForm={setForm} products={productOptions} />
          ) : null}
          {selectedOption === "Korting" ? (
            <KortingForm form={form} setForm={setForm} products={productOptions} />
          ) : null}
          {selectedOption === "Transport" ? (
            <TransportForm form={form} setForm={setForm} />
          ) : null}
          {selectedOption === "Retour" ? (
            <RetourForm form={form} setForm={setForm} />
          ) : null}
          {selectedOption === "Proeverij" ? (
            <ProeverijForm form={form} setForm={setForm} />
          ) : null}
          {selectedOption === "Tapverhuur" ? (
            <TapverhuurForm form={form} setForm={setForm} />
          ) : null}
        </div>

        <div className="cpq-modal-footer">
          <button onClick={onClose} className="cpq-button cpq-button-secondary" type="button">
            Annuleren
          </button>
          <button
            onClick={onSave}
            className="cpq-button cpq-button-primary"
            type="button"
            disabled={!canSave}
            title={canSave ? "Opslaan" : saveBlockedReason}
          >
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}
