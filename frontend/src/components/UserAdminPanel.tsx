"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type CreateUserPayload = {
  username: string;
  password: string;
  display_name: string;
  role: "admin" | "user";
};

type BootstrapAdminPayload = {
  username: string;
  password: string;
  display_name: string;
};

type UserAdminPanelProps = {
  hasAdmin: boolean;
};

export function UserAdminPanel({ hasAdmin }: UserAdminPanelProps) {
  const router = useRouter();

  const [bootstrapToken, setBootstrapToken] = useState("");
  const [bootstrapUsername, setBootstrapUsername] = useState("admin");
  const [bootstrapDisplayName, setBootstrapDisplayName] = useState("Beheerder");
  const [bootstrapPassword, setBootstrapPassword] = useState("");
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const canBootstrap = useMemo(() => {
    return Boolean(bootstrapUsername.trim() && bootstrapDisplayName.trim() && bootstrapPassword);
  }, [bootstrapUsername, bootstrapDisplayName, bootstrapPassword]);

  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [createError, setCreateError] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const canCreate = useMemo(() => {
    return Boolean(newUsername.trim() && newDisplayName.trim() && newPassword);
  }, [newUsername, newDisplayName, newPassword]);

  async function handleBootstrap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBootstrapError("");
    setBootstrapBusy(true);

    const payload: BootstrapAdminPayload = {
      username: bootstrapUsername.trim(),
      password: bootstrapPassword,
      display_name: bootstrapDisplayName.trim()
    };

    try {
      const response = await fetch(`${API_BASE_URL}/auth/bootstrap-admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(bootstrapToken.trim() ? { "X-Bootstrap-Token": bootstrapToken.trim() } : {})
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setBootstrapError(detail?.detail ?? "Admin bootstrap is niet gelukt.");
        return;
      }

      router.refresh();
    } catch {
      setBootstrapError("De backend is niet bereikbaar.");
    } finally {
      setBootstrapBusy(false);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");
    setCreateBusy(true);

    const payload: CreateUserPayload = {
      username: newUsername.trim(),
      password: newPassword,
      display_name: newDisplayName.trim(),
      role: newRole
    };

    try {
      const response = await fetch(`${API_BASE_URL}/auth/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setCreateError(detail?.detail ?? "User aanmaken is niet gelukt.");
        return;
      }

      setNewUsername("");
      setNewDisplayName("");
      setNewPassword("");
      setNewRole("user");
      router.refresh();
    } catch {
      setCreateError("De backend is niet bereikbaar.");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div className="record-card-grid auth-admin-grid">
      {!hasAdmin ? (
        <div className="wizard-toggle-card auth-admin-card">
          <div className="module-card-title">Eerste admin aanmaken</div>
          <div className="module-card-text">
            In een testomgeving maak je eerst een admin aan met een bootstrap token. In local werkt dit zonder token.
          </div>
          <form className="login-form auth-admin-form" onSubmit={handleBootstrap}>
            <label className="nested-field">
              <span>Bootstrap token (T)</span>
              <input
                className="dataset-input"
                value={bootstrapToken}
                onChange={(event) => setBootstrapToken(event.target.value)}
                autoComplete="off"
              />
            </label>

            <label className="nested-field">
              <span>Gebruikersnaam</span>
              <input
                className="dataset-input"
                value={bootstrapUsername}
                onChange={(event) => setBootstrapUsername(event.target.value)}
                autoComplete="username"
              />
            </label>

            <label className="nested-field">
              <span>Naam</span>
              <input
                className="dataset-input"
                value={bootstrapDisplayName}
                onChange={(event) => setBootstrapDisplayName(event.target.value)}
                autoComplete="name"
              />
            </label>

            <label className="nested-field">
              <span>Wachtwoord</span>
              <input
                className="dataset-input"
                type="password"
                value={bootstrapPassword}
                onChange={(event) => setBootstrapPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>

            {bootstrapError ? <div className="login-error">{bootstrapError}</div> : null}

            <button type="submit" className="editor-button" disabled={!canBootstrap || bootstrapBusy}>
              {bootstrapBusy ? "Bezig..." : "Admin aanmaken"}
            </button>
          </form>
        </div>
      ) : null}

      <div className="wizard-toggle-card auth-admin-card">
        <div className="module-card-title">Nieuwe user</div>
        <div className="module-card-text">
          Maak een extra gebruiker aan. Dit vereist admin rechten.
        </div>
        <form className="login-form auth-admin-form" onSubmit={handleCreateUser}>
          <label className="nested-field">
            <span>Gebruikersnaam</span>
            <input
              className="dataset-input"
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
              autoComplete="off"
            />
          </label>

          <label className="nested-field">
            <span>Naam</span>
            <input
              className="dataset-input"
              value={newDisplayName}
              onChange={(event) => setNewDisplayName(event.target.value)}
              autoComplete="off"
            />
          </label>

          <label className="nested-field">
            <span>Rol</span>
            <select
              className="dataset-input"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value === "admin" ? "admin" : "user")}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <label className="nested-field">
            <span>Wachtwoord</span>
            <input
              className="dataset-input"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>

          {createError ? <div className="login-error">{createError}</div> : null}

          <button type="submit" className="editor-button" disabled={!canCreate || createBusy}>
            {createBusy ? "Bezig..." : "User opslaan"}
          </button>
        </form>
      </div>
    </div>
  );
}

