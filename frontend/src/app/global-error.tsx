"use client";

import React, { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="nl">
      <body>
        <main style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Onverwachte fout</h1>
          <p style={{ marginBottom: 16 }}>
            De applicatie kon niet herstellen van een fout. Probeer opnieuw te laden of log opnieuw in.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button onClick={reset} style={{ padding: "8px 12px" }}>
              Opnieuw proberen
            </button>
            <a href="/" style={{ padding: "8px 12px", display: "inline-block" }}>
              Naar start
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
      </body>
    </html>
  );
}

