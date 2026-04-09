"use client";

import { useState } from "react";

import { API_BASE_URL } from "@/lib/apiShared";

type DevActionResult = {
  reset?: Record<string, unknown>;
  seed?: Record<string, unknown>;
};

type SeedProfile = "" | "demo_foundation" | "demo_full";

async function postDevReset(mode: "all" | "year_setup", seedProfile: SeedProfile) {
  const response = await fetch(
    `${API_BASE_URL}/meta/dev/reset?mode=${mode}&seed_profile=${encodeURIComponent(seedProfile)}`,
    {
      method: "POST",
      credentials: "include",
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Reset failed (${response.status}).`);
  }
  return (text ? JSON.parse(text) : {}) as DevActionResult;
}

async function postDevSeedExport(profile: Exclude<SeedProfile, "">) {
  const response = await fetch(
    `${API_BASE_URL}/meta/dev/seed/export?profile=${encodeURIComponent(profile)}&year=2025`,
    { method: "POST", credentials: "include" }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Export failed (${response.status}).`);
  }
  return (text ? JSON.parse(text) : {}) as Record<string, unknown>;
}

async function getDevSeedAudit() {
  const response = await fetch(`${API_BASE_URL}/meta/dev/seed/audit?year=2025`, {
    credentials: "include",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Audit failed (${response.status}).`);
  }
  return (text ? JSON.parse(text) : {}) as Record<string, unknown>;
}

export function DevToolsPanel() {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<null | "reset" | "seed" | "export" | "audit">(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DevActionResult | null>(null);
  const [seedInfo, setSeedInfo] = useState<Record<string, unknown> | null>(null);

  const confirmed = confirmText.trim().toUpperCase() === "RESET";

  async function handleReset(seedProfile: SeedProfile) {
    setError("");
    setSeedInfo(null);
    setResult(null);
    setBusy(seedProfile ? "seed" : "reset");
    try {
      const res = await postDevReset("all", seedProfile);
      setResult(res);
      setConfirmText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Actie mislukt.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Reset / seed (local)</div>
        <div className="module-card-text">
          Dit wist alleen data (rows) en houdt alle tabellen in PostgreSQL intact. Gebruik dit om de
          "Eerste inrichting" of "Nieuw jaar voorbereiden" flows opnieuw te testen.
        </div>
      </div>

      <div className="placeholder-block" style={{ marginBottom: 16 }}>
        <strong>Let op</strong>
        Dit is onomkeerbaar. Type <code>RESET</code> om de knoppen te activeren.
      </div>

      <div className="editor-actions" style={{ justifyContent: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label
            htmlFor="dev-reset-confirm"
            style={{ display: "block", marginBottom: 8, fontWeight: 800, color: "var(--muted)" }}
          >
            Bevestiging
          </label>
          <input
            id="dev-reset-confirm"
            className="dataset-input"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder="Type RESET"
          />
        </div>

        <button
          type="button"
          className="editor-button"
          disabled={!confirmed || busy !== null}
          onClick={() => void handleReset("")}
        >
          {busy === "reset" ? "Bezig..." : "Reset data"}
        </button>
        <button
          type="button"
          className="editor-button"
          disabled={!confirmed || busy !== null}
          onClick={() => void handleReset("demo_foundation")}
        >
          {busy === "seed" ? "Bezig..." : "Reset + seed demo"}
        </button>
        <button
          type="button"
          className="editor-button editor-button-secondary"
          disabled={!confirmed || busy !== null}
          onClick={() => void handleReset("demo_full")}
        >
          {busy === "seed" ? "Bezig..." : "Reset + seed golden (incl. kostprijzen)"}
        </button>
      </div>

      <div className="placeholder-block" style={{ marginTop: 16 }}>
        <strong>Seed bestanden</strong>
        <div className="muted" style={{ marginTop: 8 }}>
          Exporteer de huidige Postgres data naar een seed bundle bestand. Deze export is alleen voor
          local/dev en wijzigt geen data.
        </div>
        <div className="editor-actions" style={{ justifyContent: "flex-start", marginTop: 12 }}>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            disabled={busy !== null}
            onClick={() => {
              setError("");
              setSeedInfo(null);
              setBusy("audit");
              void getDevSeedAudit()
                .then((res) => setSeedInfo(res))
                .catch((err) => setError(err instanceof Error ? err.message : "Actie mislukt."))
                .finally(() => setBusy(null));
            }}
          >
            {busy === "audit" ? "Bezig..." : "Audit live data (2025)"}
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            disabled={busy !== null}
            onClick={() => {
              setError("");
              setSeedInfo(null);
              setBusy("export");
              void postDevSeedExport("demo_foundation")
                .then((res) => setSeedInfo(res))
                .catch((err) => setError(err instanceof Error ? err.message : "Actie mislukt."))
                .finally(() => setBusy(null));
            }}
          >
            {busy === "export" ? "Bezig..." : "Export seed demo (foundation)"}
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            disabled={busy !== null}
            onClick={() => {
              setError("");
              setSeedInfo(null);
              setBusy("export");
              void postDevSeedExport("demo_full")
                .then((res) => setSeedInfo(res))
                .catch((err) => setError(err instanceof Error ? err.message : "Actie mislukt."))
                .finally(() => setBusy(null));
            }}
          >
            {busy === "export" ? "Bezig..." : "Export seed demo (full)"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="placeholder-block" style={{ marginTop: 16 }}>
          <strong>Fout</strong>
          {error}
        </div>
      ) : null}

      {seedInfo ? (
        <div className="placeholder-block" style={{ marginTop: 16 }}>
          <strong>Seed info</strong>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(seedInfo, null, 2)}</pre>
        </div>
      ) : null}

      {result ? (
        <div className="placeholder-block" style={{ marginTop: 16 }}>
          <strong>Resultaat</strong>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}

