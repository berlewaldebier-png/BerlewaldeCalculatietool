"use client";

import React, { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep console logging for local debugging; in T/P this should be routed to observability.
    console.error(error);
  }, [error]);

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Er ging iets mis</h1>
      <p style={{ marginBottom: 16 }}>
        Probeer opnieuw. Als dit blijft gebeuren: refresh de pagina of log opnieuw in.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button onClick={reset} style={{ padding: "8px 12px" }}>
          Opnieuw proberen
        </button>
        <a href="/login" style={{ padding: "8px 12px", display: "inline-block" }}>
          Naar login
        </a>
      </div>
      <details style={{ marginTop: 16 }}>
        <summary>Technische details</summary>
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
          {error.message}
          {error.digest ? `\nDigest: ${error.digest}` : ""}
        </pre>
      </details>
    </main>
  );
}

