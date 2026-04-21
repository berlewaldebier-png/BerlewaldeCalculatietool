import type { Dispatch, SetStateAction } from "react";

import type { OptionAvailability } from "@/components/offerte-samenstellen/conflictRules";
import { IntroForm } from "@/components/offerte-samenstellen/forms/IntroForm";
import { KortingForm } from "@/components/offerte-samenstellen/forms/KortingForm";
import { MixDealForm } from "@/components/offerte-samenstellen/forms/MixDealForm";
import { ProeverijForm } from "@/components/offerte-samenstellen/forms/ProeverijForm";
import { RetourForm } from "@/components/offerte-samenstellen/forms/RetourForm";
import { StaffelForm } from "@/components/offerte-samenstellen/forms/StaffelForm";
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
  activePeriodView: "intro" | "standard";
  incompatibilityHints: string[];
  selectedOptionAvailability: OptionAvailability;
  form: QuoteFormState;
  setForm: Dispatch<SetStateAction<QuoteFormState>>;
  productOptions: ProductOption[];
  onClose: () => void;
  onSave: () => void;
};

export function ToolbarOptionDialog({
  selectedOption,
  hasIntro,
  activePeriodView,
  incompatibilityHints,
  selectedOptionAvailability,
  form,
  setForm,
  productOptions,
  onClose,
  onSave,
}: Props) {
  const contextLabel =
    selectedOption === "Intro"
      ? "Introductieperiode"
      : hasIntro
        ? activePeriodView === "intro"
          ? "Introductie"
          : "Standaard"
        : "Standaard";

  return (
    <div className="cpq-modal-backdrop" role="dialog" aria-modal="true">
      <div className="cpq-modal">
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
            disabled={!selectedOptionAvailability.allowed}
            title={selectedOptionAvailability.allowed ? "Opslaan" : selectedOptionAvailability.reasons.join(" ")}
          >
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}
