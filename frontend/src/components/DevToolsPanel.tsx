"use client";

import { useState } from "react";

import { API_BASE_URL } from "@/lib/apiShared";

type DevActionResult = {
  reset?: Record<string, unknown>;
  seed?: Record<string, unknown>;
};

async function postDevReset(mode: "all" | "year_setup", seed: boolean) {
  const response = await fetch(
    `${API_BASE_URL}/meta/dev/reset?mode=${mode}&seed=${seed ? "true" : "false"}`,
    {
    method: "POST",
    credentials: "include"
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Reset failed (${response.status}).`);
  }
  return (text ? JSON.parse(text) : {}) as DevActionResult;
}

export function DevToolsPanel() {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<null | "reset" | "seed">(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DevActionResult | null>(null);

  const confirmed = confirmText.trim().toUpperCase() === "RESET";

  async function handleReset(seed: boolean) {
    setError("");
    setResult(null);
    setBusy(seed ? "seed" : "reset");
    try {
      const res = await postDevReset("all", seed);
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
          “Eerste inrichting” of “Nieuw jaar voorbereiden” flows opnieuw te testen.
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
          onClick={() => void handleReset(false)}
        >
          {busy === "reset" ? "Bezig..." : "Reset data"}
        </button>
        <button
          type="button"
          className="editor-button"
          disabled={!confirmed || busy !== null}
          onClick={() => void handleReset(true)}
        >
          {busy === "seed" ? "Bezig..." : "Reset + seed demo"}
        </button>
        <button
          type="button"
          className="editor-button editor-button-secondary"
          disabled={!confirmed || busy !== null}
          onClick={() => {
            setError("");
            setResult(null);
            setBusy("reset");
            void postDevReset("year_setup", false)
              .then((res) => {
                setResult(res);
                setConfirmText("");
              })
              .catch((err) => {
                setError(err instanceof Error ? err.message : "Actie mislukt.");
              })
              .finally(() => setBusy(null));
          }}
        >
          {busy === "reset" ? "Bezig..." : "Reset jaar-inrichting (behoud kostprijzen)"}
        </button>
      </div>

      {error ? (
        <div className="placeholder-block" style={{ marginTop: 16 }}>
          <strong>Fout</strong>
          {error}
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
