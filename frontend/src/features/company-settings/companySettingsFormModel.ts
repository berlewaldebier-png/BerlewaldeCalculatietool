import type { ActionStatusState } from "../../components/ActionStatus";
import type { ApplicationSettings } from "../../components/instellingen/applicationSettingsApi";
import { ApiRequestError } from "../../lib/apiClient";

export const DEFAULT_COMPANY_NAME = "Berlewalde Brouwerij";
export const DEFAULT_SUPPORT_EMAIL = "info@berlewaldebier.nl";

export type CompanySettingsDraft = {
  companyName: string;
  supportEmail: string;
};

export const APPLICATION_SETTINGS_PENDING_STATUS: ActionStatusState = {
  kind: "pending",
  message: "Bedrijfsinstellingen worden opgeslagen.",
};

export const APPLICATION_SETTINGS_SUCCESS_STATUS: ActionStatusState = {
  kind: "success",
  message: "Bedrijfsinstellingen zijn opgeslagen.",
};

export function createCompanySettingsDraft(initial: ApplicationSettings): CompanySettingsDraft {
  return {
    companyName: initial.company_name || DEFAULT_COMPANY_NAME,
    supportEmail: initial.support_email || DEFAULT_SUPPORT_EMAIL,
  };
}

export function buildApplicationSettingsPayload(
  initial: ApplicationSettings,
  draft: CompanySettingsDraft
): ApplicationSettings {
  return {
    ...initial,
    company_name: draft.companyName.trim() || DEFAULT_COMPANY_NAME,
    currency: "EUR",
    support_email: draft.supportEmail.trim() || DEFAULT_SUPPORT_EMAIL,
  };
}

export function applicationSettingsSaveErrorStatus(error: unknown): ActionStatusState {
  const outcomeUncertain =
    !(error instanceof ApiRequestError) || error.category !== "http" || error.status >= 500;

  return {
    kind: "error",
    message: outcomeUncertain
      ? "Opslaan kon niet worden bevestigd."
      : "Bedrijfsinstellingen zijn niet opgeslagen.",
    guidance: outcomeUncertain
      ? "De wijzigingen kunnen al zijn opgeslagen. Vernieuw de pagina om de actuele instellingen te controleren."
      : "Controleer de bedrijfsgegevens en probeer opnieuw.",
  };
}
