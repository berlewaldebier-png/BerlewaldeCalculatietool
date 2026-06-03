"use client";

import { FormEvent, useMemo, useState } from "react";

type SupportIssueFormProps = {
  supportEmail: string;
  username: string;
  displayName: string;
  role: string;
  environment: string;
  version: string;
};

function recentClientContext() {
  if (typeof window === "undefined") {
    return "";
  }
  const nav = window.performance?.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
  return [
    `URL: ${window.location.href}`,
    `User agent: ${window.navigator.userAgent}`,
    nav ? `Pagina geladen: ${Math.round(nav.duration)} ms` : "",
    `Tijdstip: ${new Date().toISOString()}`,
  ].filter(Boolean).join("\n");
}

export function SupportIssueForm({
  supportEmail,
  username,
  displayName,
  role,
  environment,
  version,
}: SupportIssueFormProps) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [impact, setImpact] = useState("Normaal");

  const context = useMemo(
    () => [
      `Gebruiker: ${displayName || username || "-"} (${username || "-"})`,
      `Rol: ${role || "-"}`,
      `Omgeving: ${environment || "-"}`,
      `Versie: ${version}`,
    ].join("\n"),
    [displayName, environment, role, username, version]
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = [
      "Probleem",
      description.trim() || "-",
      "",
      `Impact: ${impact}`,
      "",
      "App-context",
      context,
      recentClientContext(),
    ].join("\n");
    const href = `mailto:${encodeURIComponent(supportEmail || "info@berlewaldebier.nl")}?subject=${encodeURIComponent(
      subject.trim() || "Melding CalculatieTool"
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Meld probleem</div>
        <div className="module-card-text">
          Maakt een e-mail klaar met jouw melding en app-context. Later kan dit dezelfde informatie naar een ticketsysteem sturen.
        </div>
      </div>

      <form className="settings-form-grid" onSubmit={handleSubmit}>
        <label className="settings-field settings-field-wide">
          <span>Onderwerp</span>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Bijvoorbeeld: prijsvoorstel laadt niet" />
        </label>
        <label className="settings-field">
          <span>Impact</span>
          <select value={impact} onChange={(event) => setImpact(event.target.value)}>
            <option>Laag</option>
            <option>Normaal</option>
            <option>Hoog</option>
            <option>Blokkerend</option>
          </select>
        </label>
        <label className="settings-field settings-field-wide">
          <span>Beschrijving</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={6}
            placeholder="Wat deed je, wat verwachtte je, en wat gebeurde er?"
          />
        </label>

        <div className="support-context settings-field-wide">
          <strong>Wordt meegestuurd</strong>
          <pre>{context}</pre>
        </div>

        <div className="editor-actions settings-form-actions">
          <div className="editor-actions-group" />
          <div className="editor-actions-group">
            <button type="submit" className="editor-button" disabled={!subject.trim() || !description.trim()}>
              E-mail opstellen
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
