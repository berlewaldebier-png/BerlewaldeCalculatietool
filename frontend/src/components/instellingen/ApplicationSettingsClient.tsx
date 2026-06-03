"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type ApplicationSettings = {
  company_name?: string;
  currency?: string;
  support_email?: string;
};

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
      const response = await fetch(`${API_BASE_URL}/data/application-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Opslaan mislukt.");
      }
      window.dispatchEvent(new Event("calculatietool-settings-changed"));
      setStatus("Opgeslagen.");
      setTone("success");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Opslaan mislukt.");
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
