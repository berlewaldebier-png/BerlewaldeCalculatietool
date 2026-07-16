"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  saveApplicationSettings,
  type ApplicationSettings
} from "@/components/instellingen/applicationSettingsApi";
import { apiErrorMessage } from "@/lib/apiClient";

export function ApplicationSettingsClient({ initial }: { initial: ApplicationSettings }) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState(initial.company_name || "Berlewalde Brouwerij");
  const [supportEmail, setSupportEmail] = useState(initial.support_email || "info@berlewaldebier.nl");
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    setStatus("");
    setTone("");
    try {
      const payload: ApplicationSettings = {
        ...initial,
        company_name: companyName.trim() || "Berlewalde Brouwerij",
        currency: "EUR",
        support_email: supportEmail.trim() || "info@berlewaldebier.nl",
      };
      await saveApplicationSettings(payload);
      window.dispatchEvent(new Event("calculatietool-settings-changed"));
      setStatus("Opgeslagen.");
      setTone("success");
      router.refresh();
    } catch (error) {
      setStatus(apiErrorMessage(error, "Opslaan mislukt."));
      setTone("error");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="module-card">
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
          {status ? <span className={`editor-status ${tone}`}>{status}</span> : null}
        </div>
        <div className="editor-actions-group">
          <button type="button" className="editor-button" disabled={isSaving} onClick={handleSave}>
            {isSaving ? "Opslaan..." : "Bedrijfsinstellingen opslaan"}
          </button>
        </div>
      </div>
    </section>
  );
}
