"use client";

import { useState } from "react";

import { SectionCard } from "@/components/SectionCard";

type SyncResult = Record<string, unknown>;

async function postJson(path: string): Promise<SyncResult> {
  const response = await fetch(path, { method: "POST", cache: "no-store" });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return (payload ?? {}) as SyncResult;
}

async function getJson(path: string): Promise<SyncResult> {
  const response = await fetch(path, { method: "GET", cache: "no-store" });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return (payload ?? {}) as SyncResult;
}

export function DouanoSyncPanel() {
  const [status, setStatus] = useState("");
  const [output, setOutput] = useState<string>("");

  async function run(label: string, fn: () => Promise<SyncResult>) {
    setStatus(`${label}…`);
    try {
      const result = await fn();
      setOutput(JSON.stringify(result, null, 2));
      setStatus(`${label}: klaar`);
    } catch (error) {
      setOutput("");
      setStatus(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <SectionCard
      title="Douano sync (fase 1)"
      description="Handmatige import van companies/products/sales-orders naar PostgreSQL (raw + normalized)."
    >

      <div className="editor-actions" style={{ marginTop: 8 }}>
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button"
            onClick={() => run("Sync companies", () => postJson("/api/integrations/douano/sync/companies"))}
          >
            Sync companies
          </button>
          <button
            type="button"
            className="editor-button"
            onClick={() => run("Sync products", () => postJson("/api/integrations/douano/sync/products"))}
          >
            Sync products
          </button>
          <button
            type="button"
            className="editor-button"
            onClick={() => run("Sync sales-orders", () => postJson("/api/integrations/douano/sync/sales-orders"))}
          >
            Sync sales-orders
          </button>
        </div>
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => run("Sync status", () => getJson("/api/integrations/douano/sync-status"))}
          >
            Sync status
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => run("Revenue summary", () => getJson("/api/integrations/douano/revenue-summary"))}
          >
            Revenue summary
          </button>
        </div>
      </div>

      {status ? <div className="editor-status" style={{ marginTop: 12 }}>{status}</div> : null}
      {output ? (
        <pre className="code-block" style={{ marginTop: 12, maxHeight: 360, overflow: "auto" }}>
          {output}
        </pre>
      ) : null}
    </SectionCard>
  );
}
