"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";
import { writeAuthSession } from "@/lib/auth";

type LoginResponse = {
  authenticated: boolean;
  username: string;
  display_name: string;
  role: string;
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setError(detail?.detail ?? "Inloggen is niet gelukt.");
        return;
      }

      const payload = (await response.json()) as LoginResponse;
      writeAuthSession({
        username: payload.username,
        display_name: payload.display_name,
        role: payload.role
      });
      window.location.replace(nextPath);
      router.refresh();
    } catch {
      setError("De loginservice is niet bereikbaar.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="section-label">Beveiligde toegang</div>
        <h1 className="page-title">Inloggen</h1>
        <p className="page-text">
          Tijdelijke login voor de nieuwe webomgeving. Gebruik voorlopig
          <strong> admin </strong>
          met wachtwoord
          <strong> admin</strong>.
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="nested-field">
            <span>Gebruikersnaam</span>
            <input
              className="dataset-input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>

          <label className="nested-field">
            <span>Wachtwoord</span>
            <input
              className="dataset-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error ? <div className="login-error">{error}</div> : null}

          <button type="submit" className="editor-button" disabled={isSubmitting}>
            {isSubmitting ? "Inloggen..." : "Inloggen"}
          </button>
        </form>
      </div>
    </div>
  );
}
