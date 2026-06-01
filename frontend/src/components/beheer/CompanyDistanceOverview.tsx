"use client";

import { useEffect, useMemo, useState } from "react";

type CompanyRow = {
  company_id: number;
  public_name?: string;
  name?: string;
  is_customer?: boolean;
  sales_price_class?: { id: number; name: string };
  invoice_address?: { address_line1: string; post_code: string; city: string; country: string };
  distance_cache?: { status: string; distance_km_one_way: number; updated_at: string };
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function formatKm(value: unknown) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num <= 0) return "-";
  return `${num.toFixed(2).replace(".", ",")} km`;
}

async function readJson(path: string) {
  const response = await fetch(path, { cache: "no-store", credentials: "include" });
  const text = await response.text().catch(() => "");
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const detail =
      typeof payload?.detail === "string"
        ? payload.detail
        : typeof payload?.error === "string"
          ? payload.error
          : response.statusText;
    const snippet = text && text.length > 0 ? text.trim().slice(0, 300) : "";
    throw new Error(`${detail || `Request faalde: ${response.status}`}${snippet ? `\n${snippet}` : ""}`);
  }
  return payload;
}

export function CompanyDistanceOverview() {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [query, setQuery] = useState<string>("");
  const [excludeParticulier, setExcludeParticulier] = useState<boolean>(true);

  async function load() {
    setStatus("Laden…");
    setTone("");
    try {
      const payload = await readJson("/api/integrations/douano/companies?only_customers=true&limit=2000");
      const items = Array.isArray((payload as any)?.items) ? ((payload as any).items as CompanyRow[]) : [];
      setRows(items);
      setStatus("Gereed");
      setTone("success");
    } catch (err) {
      setRows([]);
      setStatus(err instanceof Error ? err.message : "Kon companies niet laden.");
      setTone("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = normalizeText(query);
    const out = (rows ?? []).filter((row) => {
      if (!row || typeof row !== "object") return false;
      if (excludeParticulier && normalizeText(row.sales_price_class?.name) === "particulier") return false;
      if (!q) return true;
      const name = `${row.public_name ?? ""} ${row.name ?? ""}`.trim();
      const addr = `${row.invoice_address?.address_line1 ?? ""} ${row.invoice_address?.post_code ?? ""} ${row.invoice_address?.city ?? ""}`.trim();
      return normalizeText(name).includes(q) || normalizeText(addr).includes(q);
    });
    return out;
  }, [rows, query, excludeParticulier]);

  const pending = useMemo(() => {
    return filtered.filter((row) => {
      const st = normalizeText(row.distance_cache?.status);
      return !st;
    });
  }, [filtered]);

  const failed = useMemo(() => {
    return filtered.filter((row) => {
      const st = normalizeText(row.distance_cache?.status);
      return st === "geocode_failed" || st === "route_failed";
    });
  }, [filtered]);

  const okCount = useMemo(() => {
    return filtered.filter((row) => normalizeText(row.distance_cache?.status) === "ok").length;
  }, [filtered]);

  function renderTable(title: string, list: CompanyRow[]) {
    return (
      <section className="module-card" style={{ marginTop: 16 }}>
        <div className="module-card-header">
          <div className="module-card-title">{title}</div>
          <div className="module-card-text">
            {list.length} klanten
          </div>
        </div>
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>ID</th>
                <th>Klant</th>
                <th style={{ width: 140 }}>Prijsklasse</th>
                <th>Adres</th>
                <th style={{ width: 160 }}>Status</th>
                <th style={{ width: 160 }}>Km (enk.)</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td className="dataset-empty" colSpan={6}>
                    Geen resultaten.
                  </td>
                </tr>
              ) : null}
              {list.slice(0, 200).map((row) => {
                const name = String(row.public_name || row.name || "").trim() || String(row.company_id);
                const addr = row.invoice_address
                  ? `${row.invoice_address.address_line1 || ""}, ${row.invoice_address.post_code || ""} ${row.invoice_address.city || ""}`.trim()
                  : "-";
                const st = String(row.distance_cache?.status || "").trim() || "pending";
                return (
                  <tr key={String(row.company_id)}>
                    <td>{String(row.company_id)}</td>
                    <td>{name}</td>
                    <td>{String(row.sales_price_class?.name ?? "")}</td>
                    <td>{addr}</td>
                    <td>{st}</td>
                    <td>{formatKm(row.distance_cache?.distance_km_one_way)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {list.length > 200 ? (
          <div className="editor-toolbar">
            <div className="editor-toolbar-meta">
              <span className="muted">Toont eerste 200 resultaten. Gebruik zoekfilter om te verfijnen.</span>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section style={{ marginTop: 16 }}>
      <div className="editor-actions" style={{ marginTop: 0 }}>
        <div className="editor-actions-group">
          <input
            className="editor-input"
            style={{ width: 260 }}
            placeholder="Zoek klant/adres"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="editor-pill" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={excludeParticulier}
              onChange={(e) => setExcludeParticulier(e.target.checked)}
            />
            Particulier verbergen
          </label>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => void load()}>
            Herladen
          </button>
        </div>
        <div className="editor-actions-group">
          {status ? <span className={`editor-status ${tone}`}>{status}</span> : null}
          <span className="editor-pill" title="Aantal klanten met status ok binnen de filter">
            OK: {okCount}
          </span>
        </div>
      </div>

      {renderTable("Nog te berekenen", pending)}
      {renderTable("Mislukt", failed)}
    </section>
  );
}
