"use client";

import { FormEvent, useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";
import type { AuthUser } from "@/lib/apiShared";

type UserRole = "admin" | "user";

type EditDraft = {
  display_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
};

type PendingDelete = {
  user: AuthUser;
};

type UpdateUserPayload = {
  display_name?: string;
  email?: string | null;
  role?: UserRole;
  is_active?: boolean;
};

type UserManagementTableProps = {
  initialUsers: AuthUser[];
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleString("nl-NL");
}

function asUserRole(value: string): UserRole {
  return value === "admin" ? "admin" : "user";
}

export function UserManagementTable({ initialUsers }: UserManagementTableProps) {
  const router = useRouter();
  const [users, setUsers] = useState<AuthUser[]>(initialUsers);
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const [draft, setDraft] = useState<EditDraft>({
    display_name: "",
    email: "",
    role: "user",
    is_active: true
  });
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  function openEdit(user: AuthUser) {
    setEditingUser(user);
    setDraft({
      display_name: user.display_name,
      email: user.email ?? "",
      role: asUserRole(user.role),
      is_active: user.is_active
    });
    setError("");
  }

  function closeEdit() {
    setEditingUser(null);
    setError("");
    setBusy(false);
  }

  async function updateUser(user: AuthUser, payload: UpdateUserPayload) {
    const response = await fetch(`${API_BASE_URL}/auth/users/${encodeURIComponent(user.username)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.detail ?? "Gebruiker bijwerken is niet gelukt.");
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser) return;

    setBusy(true);
    setError("");

    const payload = {
      display_name: draft.display_name.trim(),
      email: draft.email.trim() || null,
      role: draft.role,
      is_active: draft.is_active
    };

    try {
      await updateUser(editingUser, payload);
      setUsers((current) =>
        current.map((user) =>
          user.id === editingUser.id
            ? {
                ...user,
                ...payload,
                email: payload.email,
                updated_at: new Date().toISOString()
              }
            : user
        )
      );
      closeEdit();
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Gebruiker bijwerken is niet gelukt.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSoftDelete() {
    if (!pendingDelete) return;

    const user = pendingDelete.user;
    setBusy(true);
    setError("");

    try {
      await updateUser(user, { is_active: false });
      setUsers((current) =>
        current.map((item) =>
          item.id === user.id ? { ...item, is_active: false, updated_at: new Date().toISOString() } : item
        )
      );
      setPendingDelete(null);
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Gebruiker verwijderen is niet gelukt.");
    } finally {
      setBusy(false);
    }
  }

  if (users.length === 0) {
    return (
      <div className="placeholder-block">
        <strong>Nog geen users</strong>
        De auth-laag staat klaar, maar er is nog geen admin of gebruiker aangemaakt.
      </div>
    );
  }

  return (
    <>
      {error && !editingUser && !pendingDelete ? <div className="login-error">{error}</div> : null}

      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>Gebruikersnaam</th>
              <th>Naam</th>
              <th>Rol</th>
              <th>Email</th>
              <th>Status</th>
              <th>Aangemaakt</th>
              <th style={{ textAlign: "right" }}>Acties</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.username}</td>
                <td>{user.display_name}</td>
                <td>
                  <span className="pill">{user.role}</span>
                </td>
                <td>{user.email || "-"}</td>
                <td>{user.is_active ? "Actief" : "Inactief"}</td>
                <td>{formatDate(user.created_at)}</td>
                <td>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.45rem" }}>
                    <button
                      type="button"
                      className="editor-icon-button"
                      onClick={() => openEdit(user)}
                      title="Gebruiker bewerken"
                      aria-label={`Gebruiker ${user.username} bewerken`}
                    >
                      <Pencil size={17} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="editor-icon-button"
                      onClick={() => setPendingDelete({ user })}
                      title="Gebruiker verwijderen"
                      aria-label={`Gebruiker ${user.username} verwijderen`}
                      disabled={!user.is_active}
                    >
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingUser ? (
        <div className="confirm-modal-overlay" role="presentation">
          <form className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title" onSubmit={handleSave}>
            <div className="confirm-modal-title" id="edit-user-title">
              Gebruiker bewerken
            </div>
            <div className="confirm-modal-text">
              Pas de gegevens voor {editingUser.username} aan.
            </div>

            <div style={{ display: "grid", gap: "0.8rem", marginBottom: "1rem" }}>
              <label className="nested-field">
                <span>Gebruikersnaam</span>
                <input className="dataset-input dataset-input-readonly" value={editingUser.username} readOnly />
              </label>

              <label className="nested-field">
                <span>Naam</span>
                <input
                  className="dataset-input"
                  value={draft.display_name}
                  onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))}
                  autoComplete="name"
                />
              </label>

              <label className="nested-field">
                <span>Email</span>
                <input
                  className="dataset-input"
                  type="email"
                  value={draft.email}
                  onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                  autoComplete="email"
                />
              </label>

              <label className="nested-field">
                <span>Rol</span>
                <select
                  className="dataset-input"
                  value={draft.role}
                  onChange={(event) => setDraft((current) => ({ ...current, role: asUserRole(event.target.value) }))}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "0.55rem", fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={draft.is_active}
                  onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))}
                />
                Actief
              </label>
            </div>

            {error ? <div className="login-error">{error}</div> : null}

            <div className="confirm-modal-actions">
              <button type="button" className="editor-button editor-button-secondary" onClick={closeEdit} disabled={busy}>
                Annuleren
              </button>
              <button type="submit" className="editor-button" disabled={busy || draft.display_name.trim().length < 2}>
                {busy ? "Bezig..." : "Opslaan"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="confirm-modal-overlay" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-user-title">
            <div className="confirm-modal-title" id="delete-user-title">
              Gebruiker verwijderen
            </div>
            <div className="confirm-modal-text">
              {pendingDelete.user.username} wordt op inactief gezet. Historische gegevens blijven zichtbaar.
            </div>

            {error ? <div className="login-error">{error}</div> : null}

            <div className="confirm-modal-actions">
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => {
                  setPendingDelete(null);
                  setError("");
                }}
                disabled={busy}
              >
                Annuleren
              </button>
              <button type="button" className="editor-button" onClick={() => void handleSoftDelete()} disabled={busy}>
                {busy ? "Bezig..." : "Verwijderen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
