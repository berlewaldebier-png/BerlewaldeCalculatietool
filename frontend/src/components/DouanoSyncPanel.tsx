"use client";

import { useEffect, useMemo, useState } from "react";

import { SectionCard } from "@/components/SectionCard";

type SyncResult = Record<string, unknown>;

type SyncStateItem = {
  resource: string;
  last_success_at: string;
  last_since_date: string;
  last_error: string;
  stats: Record<string, unknown>;
  updated_at: string;
};

async function requestJson(path: string, method: "GET" | "POST"): Promise<SyncResult> {
  const response = await fetch(path, { method, cache: "no-store" });
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

function formatDate(value?: string) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("nl-NL");
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function safeString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function DouanoSyncPanel() {
  const [status, setStatus] = useState("");
  const [output, setOutput] = useState<string>("");
  const [syncItems, setSyncItems] = useState<SyncStateItem[] | null>(null);
  const [syncError, setSyncError] = useState("");

  async function run(label: string, fn: () => Promise<SyncResult>) {
    setStatus(`${label}...`);
    try {
      const result = await fn();
      setOutput(JSON.stringify(result, null, 2));
      setStatus(`${label}: klaar`);
    } catch (error) {
      setOutput("");
      setStatus(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function refreshSyncStatus() {
    setSyncError("");
    try {
      const result = await requestJson("/api/integrations/douano/sync-status", "GET");
      const rawItems = Array.isArray((result as any)?.items) ? ((result as any).items as any[]) : [];
      const cleaned: SyncStateItem[] = rawItems
        .filter((row) => row && typeof row === "object")
        .map((row) => ({
          resource: safeString((row as any).resource),
          last_success_at: safeString((row as any).last_success_at),
          last_since_date: safeString((row as any).last_since_date),
          last_error: safeString((row as any).last_error),
          stats: (row as any).stats && typeof (row as any).stats === "object" ? ((row as any).stats as Record<string, unknown>) : {},
          updated_at: safeString((row as any).updated_at),
        }));
      setSyncItems(cleaned);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
      setSyncItems(null);
    }
  }

  useEffect(() => {
    void refreshSyncStatus();
  }, []);

  const rows = useMemo(() => {
    const items = syncItems ?? [];
    return items.map((item) => {
      const fetchMeta = item.stats.fetch && typeof item.stats.fetch === "object" ? (item.stats.fetch as any) : null;
      const maxPages = asNumber(fetchMeta?.max_pages_requested);
      const lastPage = asNumber(fetchMeta?.last_page_fetched);
      const maxReached = Boolean(fetchMeta?.max_pages_reached);
      const stopReason = safeString(fetchMeta?.stop_reason);

      const fetched = asNumber(item.stats.fetched);
      const upserted = asNumber(item.stats.upserted);
      const orders = asNumber(item.stats.orders);
      const lines = asNumber(item.stats.lines);

      const minOrderDate = safeString(item.stats.min_order_date);
      const maxOrderDate = safeString(item.stats.max_order_date);
      const sinceDate = item.last_since_date || safeString((item.stats as any)?.filters?.since_date);

      const countsText =
        orders != null || lines != null
          ? `${orders ?? 0} orders / ${lines ?? 0} regels`
          : fetched != null || upserted != null
            ? `${fetched ?? 0} fetched / ${upserted ?? 0} upserted`
            : "-";

      const pagesText =
        maxPages != null || lastPage != null
          ? `${lastPage ?? "?"}/${maxPages ?? "?"}${maxReached ? " (max)" : ""}`
          : "-";

      const completeness = maxReached
        ? `WARN: max_pages geraakt (stop=${stopReason || "?"})`
        : stopReason
          ? `stop=${stopReason}`
          : "-";

      const dateRange = minOrderDate || maxOrderDate ? `${minOrderDate || "?"} -> ${maxOrderDate || "?"}` : "-";

      return {
        resource: item.resource,
        lastSuccess: item.last_success_at,
        sinceDate,
        pagesText,
        countsText,
        dateRange,
        completeness,
        lastError: item.last_error,
      };
    });
  }, [syncItems]);

  return (
    <SectionCard title="Douano sync (fase 1)" description="Handmatige import van companies/products/sales-orders naar PostgreSQL (raw + normalized).">
      <div className="editor-actions" style={{ marginTop: 8 }}>
        <div className="editor-actions-group">
          <button type="button" className="editor-button" onClick={() => run("Sync companies", () => requestJson("/api/integrations/douano/sync/companies", "POST"))}>
            Sync companies
          </button>
          <button type="button" className="editor-button" onClick={() => run("Sync products", () => requestJson("/api/integrations/douano/sync/products", "POST"))}>
            Sync products
          </button>
          <button
            type="button"
            className="editor-button"
            onClick={() => run("Sync sales-orders", () => requestJson("/api/integrations/douano/sync/sales-orders", "POST"))}
          >
            Sync sales-orders
          </button>
        </div>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={() => run("Sync status", () => requestJson("/api/integrations/douano/sync-status", "GET"))}>
            Sync status
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() =>
              run("Ververs status", async () => {
                await refreshSyncStatus();
                return { ok: true };
              })
            }
          >
            Ververs status
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => run("Revenue summary", () => requestJson("/api/integrations/douano/revenue-summary", "GET"))}
          >
            Revenue summary
          </button>
        </div>
      </div>

      {status ? (
        <div className="editor-status" style={{ marginTop: 12 }}>
          {status}
        </div>
      ) : null}

      {syncError ? (
        <div className="placeholder-block" style={{ marginTop: 12 }}>
          <strong>Sync status niet beschikbaar</strong>
          {syncError}
        </div>
      ) : null}

      <div className="data-table" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Laatst succes</th>
              <th>Since</th>
              <th>Pages</th>
              <th>Counts</th>
              <th>Order-dates</th>
              <th>Completeness</th>
              <th>Laatste fout</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.resource}>
                  <td>
                    <code>{row.resource}</code>
                  </td>
                  <td>{row.lastSuccess ? formatDate(row.lastSuccess) : "-"}</td>
                  <td>{row.sinceDate || "-"}</td>
                  <td>{row.pagesText}</td>
                  <td>{row.countsText}</td>
                  <td>{row.dateRange}</td>
                  <td>{row.completeness}</td>
                  <td>{row.lastError || "-"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8}>Nog geen sync-status. Klik "Sync ..." en daarna "Ververs status".</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {output ? (
        <pre className="code-block" style={{ marginTop: 12, maxHeight: 360, overflow: "auto" }}>
          {output}
        </pre>
      ) : null}
    </SectionCard>
  );
}

