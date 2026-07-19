"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { ActionStatus, type ActionStatusState } from "@/components/ActionStatus";
import {
  saveApplicationSettings,
  type ApplicationSettings
} from "@/components/instellingen/applicationSettingsApi";
import { ApiRequestError } from "@/lib/apiClient";

export function ApplicationSettingsClient({ initial }: { initial: ApplicationSettings }) {
  const router = useRouter();
  const statusId = useId();
  const [companyName, setCompanyName] = useState(initial.company_name || "Berlewalde Brouwerij");
  const [supportEmail, setSupportEmail] = useState(initial.support_email || "info@berlewaldebier.nl");
  const [status, setStatus] = useState<ActionStatusState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    setStatus({ kind: "pending", message: "Bedrijfsinstellingen worden opgeslagen." });
    try {
      const payload: ApplicationSettings = {
        ...initial,
        company_name: companyName.trim() || "Berlewalde Brouwerij",
        currency: "EUR",
        support_email: supportEmail.trim() || "info@berlewaldebier.nl",
      };
      await saveApplicationSettings(payload);
      window.dispatchEvent(new Event("calculatietool-settings-changed"));
      setStatus({ kind: "success", message: "Bedrijfsinstellingen zijn opgeslagen." });
      router.refresh();
    } catch (error) {
      const outcomeUncertain =
        !(error instanceof ApiRequestError) || error.category !== "http" || error.status >= 500;
      setStatus({
        kind: "error",
        message: outcomeUncertain
          ? "Opslaan kon niet worden bevestigd."
          : "Bedrijfsinstellingen zijn niet opgeslagen.",
        guidance: outcomeUncertain
          ? "De wijzigingen kunnen al zijn opgeslagen. Vernieuw de pagina om de actuele instellingen te controleren."
          : "Controleer de bedrijfsgegevens en probeer opnieuw.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="module-card" aria-busy={isSaving}>
      <div className="module-card-header">
        <div className="module-card-title">Bedrijfsgegevens</div>
        <div className="module-card-text">
          De bedrijfsnaam wordt gebruikt in de header en centrale app-context. Valuta staat bewust vast op euro.
        </div>
      </div>

      <div className="settings-form-grid">
        <label className="settings-field">
          <span>Bedrijfsnaam</span>
          <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
        </label>
        <label className="settings-field">
          <span>Valuta</span>
          <input value="EUR" disabled />
        </label>
        <label className="settings-field">
          <span>Support e-mail</span>
          <input value={supportEmail} onChange={(event) => setSupportEmail(event.target.value)} />
        </label>
      </div>

      <div className="editor-actions">
        <div className="editor-actions-group">
          {status ? <ActionStatus id={statusId} {...status} /> : null}
        </div>
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button"
            disabled={isSaving}
            onClick={handleSave}
            aria-busy={isSaving}
            aria-describedby={status ? statusId : undefined}
          >
            Bedrijfsinstellingen opslaan
          </button>
        </div>
      </div>
    </section>
  );
}
