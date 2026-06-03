"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  User
} from "lucide-react";

import { API_BASE_URL } from "@/lib/api";
import { fetchMe, writeAuthSession } from "@/lib/auth";

type LoginResponse = {
  authenticated: boolean;
  username: string;
  display_name: string;
  role: string;
};

type PasswordForgotResponse = {
  requested: boolean;
  code_sent: boolean;
  debug_code?: string | null;
};

type PasswordResetResponse = {
  reset: boolean;
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [email, setEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [forgotMode, setForgotMode] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const authTitle = forgotMode ? (resetRequested ? "Nieuwe toegang instellen" : "Wachtwoord herstellen") : "Welkom terug";
  const authText = forgotMode
    ? resetRequested
      ? "Vul de resetcode uit je mail in en kies een nieuw wachtwoord."
      : "Vul je gebruikersmail in om een resetcode aan te vragen."
    : "Log in om verder te gaan met je calculaties en kostprijsbeheer.";
  const featureItems = [
    "Kostprijzen beheren",
    "Receptcalculaties",
    "Break-even analyses",
    "Scenario's simuleren",
    "Verkoopprijzen optimaliseren"
  ];

  useEffect(() => {
    let cancelled = false;

    async function redirectIfAuthenticated() {
      const session = await fetchMe();
      if (!cancelled && session) {
        router.replace("/");
      }
    }

    void redirectIfAuthenticated();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInfo("");
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

  async function handleRequestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInfo("");
    setResetCode("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setResetRequested(false);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email })
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setError(detail?.detail ?? "Reset aanvragen is niet gelukt.");
        return;
      }

      const payload = (await response.json()) as PasswordForgotResponse;
      setResetRequested(true);
      setInfo(
        payload.debug_code
          ? `Lokale testcode: ${payload.debug_code}`
          : "Als het emailadres bekend is, is er een resetcode verstuurd."
      );
      setResetCode(payload.debug_code ?? "");
    } catch {
      setError("De resetservice is niet bereikbaar.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInfo("");
    if (newPassword !== newPasswordConfirm) {
      setError("Wachtwoorden komen niet overeen.");
      return;
    }
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          code: resetCode,
          password: newPassword,
          password_confirm: newPasswordConfirm
        })
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setError(detail?.detail ?? "Wachtwoord resetten is niet gelukt.");
        return;
      }

      const payload = (await response.json()) as PasswordResetResponse;
      if (payload.reset) {
        setInfo("Wachtwoord is opnieuw ingesteld. Je kunt nu opnieuw inloggen.");
        setForgotMode(false);
        setNewPassword("");
        setNewPasswordConfirm("");
        setResetCode("");
        setResetRequested(false);
      }
    } catch {
      setError("De resetservice is niet bereikbaar.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-frame">
        <header className="login-header">
          <div className="login-brand-lockup">
            <img className="login-brand-logo" src="/brand/berlewalde.png" alt="" />
            <div>
              <h1>BERLEWALDE</h1>
              <p>Het is goed!</p>
            </div>
          </div>

          <div className="login-header-actions" aria-label="Systeemstatus">
            <div className="login-status" aria-label="Systeemstatus online">
              <span className="login-status-dot" aria-hidden="true" />
              <span>
                <strong>Systeemstatus</strong>
                <small>Online</small>
              </span>
            </div>
          </div>
        </header>

        <section className="login-content">
          <aside className="login-story-panel">
            <div className="login-story-copy">
              <h2>BROUWERIJ BERLEWALDE</h2>
              <p>Calculatie & kostprijsbeheer.</p>
              <div className="login-story-rule" />
              <ul>
                {featureItems.map((item) => (
                  <li key={item}>
                    <span aria-hidden="true">
                      <Check size={16} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <img className="login-illustration" src="/images/login-illustration.png" alt="" />
            <p className="login-version">Versie 0.1.0 • © 2026 Berlewalde</p>
          </aside>

          <section className="login-form-panel" aria-labelledby="login-auth-title">
            <div className="login-card">
              <div className="login-card-heading">
                <h3 id="login-auth-title">
                  <span aria-hidden="true">👋</span>
                  {authTitle}
                </h3>
                <p>{authText}</p>
              </div>

              {forgotMode ? (
                <>
                  <form className="login-form" onSubmit={handleRequestReset}>
                    <label className="login-field">
                      <span>E-mailadres</span>
                      <div className="login-input-wrap">
                        <Mail size={20} aria-hidden="true" />
                        <input
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          autoComplete="email"
                        />
                      </div>
                    </label>

                    {error ? <div className="login-error">{error}</div> : null}
                    {info ? <div className="login-info">{info}</div> : null}

                    <button type="submit" className="login-primary-button" disabled={isSubmitting}>
                      {isSubmitting ? "Verzenden..." : "Resetcode aanvragen"}
                      <ArrowRight size={22} aria-hidden="true" />
                    </button>
                  </form>

                  {resetRequested ? (
                    <form className="login-form login-reset-form" onSubmit={handleResetPassword}>
                      <label className="login-field">
                        <span>Resetcode</span>
                        <div className="login-input-wrap">
                          <Lock size={20} aria-hidden="true" />
                          <input
                            value={resetCode}
                            onChange={(event) => setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                          />
                        </div>
                      </label>

                      <label className="login-field">
                        <span>Nieuw wachtwoord</span>
                        <div className="login-input-wrap">
                          <Lock size={20} aria-hidden="true" />
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            autoComplete="new-password"
                          />
                        </div>
                      </label>

                      <label className="login-field">
                        <span>Nieuw wachtwoord herhalen</span>
                        <div className="login-input-wrap">
                          <Lock size={20} aria-hidden="true" />
                          <input
                            type="password"
                            value={newPasswordConfirm}
                            onChange={(event) => setNewPasswordConfirm(event.target.value)}
                            autoComplete="new-password"
                          />
                        </div>
                      </label>

                      <button
                        type="submit"
                        className="login-primary-button"
                        disabled={isSubmitting || resetCode.length !== 6 || !newPassword || !newPasswordConfirm}
                      >
                        {isSubmitting ? "Resetten..." : "Wachtwoord resetten"}
                        <ArrowRight size={22} aria-hidden="true" />
                      </button>
                    </form>
                  ) : null}

                  <button
                    className="login-link-button login-back-button"
                    type="button"
                    onClick={() => {
                      setForgotMode(false);
                      setError("");
                      setInfo("");
                      setResetCode("");
                      setNewPassword("");
                      setNewPasswordConfirm("");
                      setResetRequested(false);
                    }}
                  >
                    Terug naar inloggen
                  </button>
                </>
              ) : (
                <form className="login-form" onSubmit={handleSubmit}>
                  <label className="login-field">
                    <span>Gebruikersnaam</span>
                    <div className="login-input-wrap">
                      <User size={20} aria-hidden="true" />
                      <input
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        autoComplete="username"
                      />
                    </div>
                  </label>

                  <label className="login-field">
                    <span>Wachtwoord</span>
                    <div className="login-input-wrap">
                      <Lock size={20} aria-hidden="true" />
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        className="login-password-toggle"
                        onClick={() => setShowPassword((current) => !current)}
                        aria-label={showPassword ? "Wachtwoord verbergen" : "Wachtwoord tonen"}
                      >
                        {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
                      </button>
                    </div>
                  </label>

                  <div className="login-form-row">
                    <label className="login-remember">
                      <input type="checkbox" />
                      Onthoud mij
                    </label>
                    <button
                      className="login-link-button"
                      type="button"
                      onClick={() => {
                        setForgotMode(true);
                        setError("");
                        setInfo("");
                        setResetRequested(false);
                      }}
                    >
                      Wachtwoord vergeten?
                    </button>
                  </div>

                  {error ? <div className="login-error">{error}</div> : null}
                  {info ? <div className="login-info">{info}</div> : null}

                  <button type="submit" className="login-primary-button" disabled={isSubmitting}>
                    {isSubmitting ? "Inloggen..." : "Inloggen"}
                    <ArrowRight size={22} aria-hidden="true" />
                  </button>

                  <p className="login-security-note">
                    <ShieldCheck size={18} aria-hidden="true" />
                    Verbinding beveiligd met 256-bit SSL
                  </p>
                </form>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
