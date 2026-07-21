"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { ActionStatus, type ActionStatusState } from "@/components/ActionStatus";
import {
  saveApplicationSettings,
  type ApplicationSettings
} from "@/components/instellingen/applicationSettingsApi";
import {
  APPLICATION_SETTINGS_PENDING_STATUS,
  APPLICATION_SETTINGS_SUCCESS_STATUS,
  applicationSettingsSaveErrorStatus,
  buildApplicationSettingsPayload,
  createCompanySettingsDraft,
} from "@/features/company-settings/companySettingsFormModel";

export function ApplicationSettingsClient({ initial }: { initial: ApplicationSettings }) {
  const router = useRouter();
  const statusId = useId();
  const [draft, setDraft] = useState(() => createCompanySettingsDraft(initial));
  const [status, setStatus] = useState<ActionStatusState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    setStatus(APPLICATION_SETTINGS_PENDING_STATUS);
    try {
      const payload = buildApplicationSettingsPayload(initial, draft);
      await saveApplicationSettings(payload);
      window.dispatchEvent(new Event("calculatietool-settings-changed"));
      setStatus(APPLICATION_SETTINGS_SUCCESS_STATUS);
      router.refresh();
    } catch (error) {
      setStatus(applicationSettingsSaveErrorStatus(error));
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
          <input
            value={draft.companyName}
            onChange={(event) => setDraft((current) => ({ ...current, companyName: event.target.value }))}
          />
        </label>
        <label className="settings-field">
          <span>Valuta</span>
          <input value="EUR" disabled />
        </label>
        <label className="settings-field">
          <span>Support e-mail</span>
          <input
            value={draft.supportEmail}
            onChange={(event) => setDraft((current) => ({ ...current, supportEmail: event.target.value }))}
          />
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
