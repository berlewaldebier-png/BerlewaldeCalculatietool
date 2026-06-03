"use client";

import { FormEvent, useState } from "react";

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
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setTone("");

    if (password !== passwordConfirm) {
      setStatus("Wachtwoorden komen niet overeen.");
      setTone("error");
      return;
    }

    setIsSaving(true);
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
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.detail || "Wachtwoord wijzigen is niet gelukt.");
      }

      setCurrentPassword("");
      setPassword("");
      setPasswordConfirm("");
      setStatus("Wachtwoord is gewijzigd.");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Wachtwoord wijzigen is niet gelukt.");
      setTone("error");
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

        <form className="settings-form-grid" onSubmit={handleChangePassword}>
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
              {status ? <span className={`editor-status ${tone}`}>{status}</span> : null}
            </div>
            <div className="editor-actions-group">
              <button
                type="submit"
                className="editor-button"
                disabled={isSaving || !currentPassword || !password || !passwordConfirm}
              >
                {isSaving ? "Opslaan..." : "Wachtwoord opslaan"}
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
