"use client";

import { FormEvent, useId, useState } from "react";

import { ActionStatus, type ActionStatusState } from "@/components/ActionStatus";
import { API_BASE_URL } from "@/lib/api";

type AccountSettingsClientProps = {
  username: string;
  displayName: string;
  role: string;
};

export function AccountSettingsClient({ username, displayName, role }: AccountSettingsClientProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const statusId = useId();
  const [status, setStatus] = useState<ActionStatusState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);

    if (password !== passwordConfirm) {
      setStatus({
        kind: "error",
        message: "Wachtwoorden komen niet overeen.",
        guidance: "Controleer beide nieuwe wachtwoorden en probeer opnieuw.",
      });
      return;
    }

    setIsSaving(true);
    setStatus({ kind: "pending", message: "Wachtwoord wordt opgeslagen." });
    try {
      const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          password,
          password_confirm: passwordConfirm,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = typeof payload?.detail === "string" ? payload.detail : "";
        const sessionExpired = response.status === 401;
        setStatus({
          kind: "error",
          message:
            response.status === 400 && detail
              ? detail
              : sessionExpired
                ? "Je sessie is verlopen. Het wachtwoord is niet gewijzigd."
                : "Wachtwoord wijzigen is niet gelukt.",
          guidance: sessionExpired
            ? "Log opnieuw in en probeer het daarna opnieuw."
            : "Controleer het huidige en nieuwe wachtwoord en probeer opnieuw.",
        });
        return;
      }

      setCurrentPassword("");
      setPassword("");
      setPasswordConfirm("");
      setStatus({ kind: "success", message: "Wachtwoord is gewijzigd." });
    } catch {
      setStatus({
        kind: "error",
        message: "Wachtwoord wijzigen kon niet worden bevestigd.",
        guidance: "Vernieuw de pagina en controleer je verbinding voordat je het opnieuw probeert.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <div className="record-card-grid">
        <div className="wizard-toggle-card">
          <span>
            <strong>Naam</strong>
            <small>{displayName || "-"}</small>
          </span>
        </div>
        <div className="wizard-toggle-card">
          <span>
            <strong>Gebruikersnaam</strong>
            <small>{username || "-"}</small>
          </span>
        </div>
        <div className="wizard-toggle-card">
          <span>
            <strong>Rol</strong>
            <small>{role || "-"}</small>
          </span>
        </div>
      </div>

      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Wachtwoord wijzigen</div>
          <div className="module-card-text">
            Wijzig je wachtwoord terwijl je bent ingelogd. Voor de tijdelijke lokale admin-login kan dit pas zodra die gebruiker in het gebruikersbeheer bestaat.
          </div>
        </div>

        <form className="settings-form-grid" onSubmit={handleChangePassword} aria-busy={isSaving}>
          <label className="settings-field">
            <span>Huidig wachtwoord</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label className="settings-field">
            <span>Nieuw wachtwoord</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="settings-field">
            <span>Nieuw wachtwoord herhalen</span>
            <input
              type="password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </label>

          <div className="editor-actions settings-form-actions">
            <div className="editor-actions-group">
              {status ? <ActionStatus id={statusId} {...status} /> : null}
            </div>
            <div className="editor-actions-group">
              <button
                type="submit"
                className="editor-button"
                disabled={isSaving || !currentPassword || !password || !passwordConfirm}
                aria-busy={isSaving}
                aria-describedby={status ? statusId : undefined}
              >
                Wachtwoord opslaan
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Beveiliging en voorkeuren</div>
          <div className="module-card-text">Voorbereid voor latere persoonlijke instellingen.</div>
        </div>
        <div className="record-card-grid">
          <div className="wizard-toggle-card">
            <span>
              <strong>2FA</strong>
              <small>Binnenkort</small>
            </span>
          </div>
          <div className="wizard-toggle-card">
            <span>
              <strong>Thema</strong>
              <small>Licht/donker volgt later</small>
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
