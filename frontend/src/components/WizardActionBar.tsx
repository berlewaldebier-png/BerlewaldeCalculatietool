import type { ReactNode } from "react";

type WizardActionBarProps = {
  leadingActions?: ReactNode;
  trailingActions?: ReactNode;
  ariaLabel?: string;
};

export function WizardActionBar({
  leadingActions,
  trailingActions,
  ariaLabel = "Wizardacties",
}: WizardActionBarProps) {
  return (
    <div className="editor-actions wizard-footer-actions" role="group" aria-label={ariaLabel}>
      <div className="editor-actions-group" role="group" aria-label="Terug navigeren">
        {leadingActions}
      </div>
      <div className="editor-actions-group" role="group" aria-label="Vervolgacties">
        {trailingActions}
      </div>
    </div>
  );
}
