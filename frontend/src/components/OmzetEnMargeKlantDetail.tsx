"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { formatMoneyEUR } from "@/lib/formatters";

type Basis = "invoice" | "order";

type OrderRow = {
  sales_order_id: number;
  order_date: string;
  transaction_number: string;
  status: string;
  lines: number;
  omzet_ex: number;
  korting_ex: number;
  charges_ex: number;
  netto_omzet_ex: number;
  kostprijs_ex: number;
  brutomarge_ex: number;
  ignored_lines: number;
  unmapped_lines: number;
  missing_cost_lines?: number;
};

type InvoiceRow = {
  sales_invoice_id: number;
  invoice_date: string;
  invoice_number: string;
  transaction_type: string;
  is_sent: boolean;
  lines: number;
  omzet_ex: number;
  korting_ex: number;
  charges_ex: number;
  netto_omzet_ex: number;
  kostprijs_ex: number;
  brutomarge_ex: number;
  ignored_lines: number;
  unmapped_lines: number;
  missing_cost_lines?: number;
};

type OrderLineRow = {
  line_id: number;
  sales_order_id: number;
  order_date: string;
  douano_product_id: number;
  douano_product_name: string;
  douano_sku: string;
  quantity: number;
  unit_price_ex: number;
  discount_ex: number;
  charges_ex: number;
  net_revenue_ex: number;
  bier_id: string;
  product_id: string;
  ignored: boolean;
  mapped: boolean;
  missing_cost: boolean;
  cost_price_ex: number | null;
  cost_total_ex: number;
  margin_ex: number;
};

type InvoiceLineRow = {
  line_id: number;
  sales_invoice_id: number;
  invoice_date: string;
  douano_product_id: number;
  douano_product_name: string;
  douano_sku: string;
  quantity: number;
  unit_price_ex: number;
  discount_ex: number;
  charges_ex: number;
  net_revenue_ex: number;
  bier_id: string;
  product_id: string;
  ignored: boolean;
  mapped: boolean;
  missing_cost: boolean;
  cost_price_ex: number | null;
  cost_total_ex: number;
  margin_ex: number;
};

async function readJson(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return payload;
}

function euro(value: number) {
  if (!Number.isFinite(value)) return "-";
  return formatMoneyEUR(value);
}

function formatDateNl(value: string) {
  const text = String(value || "").trim();
  if (!text) return "-";
  const dt = new Date(`${text}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return text;
  return dt.toLocaleDateString("nl-NL");
}

export function OmzetEnMargeKlantDetail({
  companyId,
  initialOnlyUnmapped = false,
  initialOnlyMissingCost = false,
  initialBasis = "invoice"
}: {
  companyId: number;
  initialOnlyUnmapped?: boolean;
  initialOnlyMissingCost?: boolean;
  initialBasis?: Basis;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [since, setSince] = useState<string>("");
  const [basis, setBasis] = useState<Basis>(initialBasis === "order" ? "order" : "invoice");
  const [onlyUnmapped, setOnlyUnmapped] = useState(Boolean(initialOnlyUnmapped));
  const [onlyMissingCost, setOnlyMissingCost] = useState(Boolean(initialOnlyMissingCost));
  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "success" | "error">("");

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [orderLines, setOrderLines] = useState<Record<number, OrderLineRow[]>>({});
  const [invoiceLines, setInvoiceLines] = useState<Record<number, InvoiceLineRow[]>>({});

  async function load() {
    setStatus("Laden…");
    setTone("");
    try {
      const qs = new URLSearchParams();
      qs.set("company_id", String(companyId));
      if (since.trim()) qs.set("since", since.trim());
      qs.set("limit", "500");

      if (basis === "invoice") {
        const payload = await readJson(`/api/integrations/douano/company-invoices?${qs.toString()}`);
        setInvoices(Array.isArray(payload?.items) ? payload.items : []);
        setOrders([]);
        setInvoiceLines({});
        setOrderLines({});
      } else {
        const payload = await readJson(`/api/integrations/douano/company-orders?${qs.toString()}`);
        setOrders(Array.isArray(payload?.items) ? payload.items : []);
        setInvoices([]);
        setOrderLines({});
        setInvoiceLines({});
      }

      setExpandedId(null);
      setStatus("Gereed");
      setTone("success");
    } catch (error) {
      setOrders([]);
      setInvoices([]);
      setOrderLines({});
      setInvoiceLines({});
      setExpandedId(null);
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis]);

  // Keep the URL in sync so copy/paste links remain stable.
  useEffect(() => {
    if (!pathname) return;
    const sp = new URLSearchParams(searchParams ? Array.from(searchParams.entries()) : []);
    if (sp.get("basis") !== basis) {
      sp.set("basis", basis);
      const qs = sp.toString();
      router.replace((qs ? `${pathname}?${qs}` : pathname) as any, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis, pathname]);

  const totals = useMemo(() => {
    const rows = basis === "invoice" ? invoices : orders;
    return rows.reduce(
      (acc, row: any) => {
        acc.netto += Number(row.netto_omzet_ex ?? 0) || 0;
        acc.omzet += Number(row.omzet_ex ?? 0) || 0;
        acc.kostprijs += Number(row.kostprijs_ex ?? 0) || 0;
        acc.marge += Number(row.brutomarge_ex ?? 0) || 0;
        acc.unmapped += Number(row.unmapped_lines ?? 0) || 0;
        return acc;
      },
      { omzet: 0, netto: 0, kostprijs: 0, marge: 0, unmapped: 0 }
    );
  }, [basis, invoices, orders]);

  async function toggleRow(id: number) {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (!next) return;
    if (basis === "invoice") {
      if (invoiceLines[next]) return;
    } else {
      if (orderLines[next]) return;
    }

    try {
      const qs = new URLSearchParams();
      if (basis === "invoice") qs.set("sales_invoice_id", String(next));
      else qs.set("sales_order_id", String(next));
      if (onlyUnmapped) qs.set("only_unmapped", "true");
      if (onlyMissingCost) qs.set("only_missing_cost", "true");
      qs.set("limit", "5000");

      const endpoint = basis === "invoice" ? "/api/integrations/douano/invoice-lines" : "/api/integrations/douano/order-lines";
      const payload = await readJson(`${endpoint}?${qs.toString()}`);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      if (basis === "invoice") setInvoiceLines((prev) => ({ ...prev, [next]: items }));
      else setOrderLines((prev) => ({ ...prev, [next]: items }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  const rows = basis === "invoice" ? invoices : orders;

  return (
    <section>
      <div className="editor-actions" style={{ marginTop: 8 }}>
        <div className="editor-actions-group">
          <select
            className="editor-input"
            style={{ width: 180 }}
            value={basis}
            onChange={(e) => setBasis(e.target.value === "order" ? "order" : "invoice")}
            aria-label="Basis"
            title="Douano export gebruikt factuurdatum"
          >
            <option value="invoice">Factuurdatum</option>
            <option value="order">Orderdatum</option>
          </select>
          <input
            className="editor-input"
            style={{ width: 180 }}
            placeholder="Sinds (YYYY-MM-DD)"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
            <input type="checkbox" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} />
            Alleen unmapped
          </label>
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
            <input type="checkbox" checked={onlyMissingCost} onChange={(e) => setOnlyMissingCost(e.target.checked)} />
            Alleen missing cost
          </label>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => void load()}>
            Ververs
          </button>
        </div>
        <div className="editor-actions-group">
          <span className="pill">Omzet {euro(totals.omzet)}</span>
          <span className="pill">Netto {euro(totals.netto)}</span>
          <span className="pill">Kostprijs {euro(totals.kostprijs)}</span>
          <span className="pill">Marge {euro(totals.marge)}</span>
          <span className="pill">Unmapped {totals.unmapped}</span>
        </div>
      </div>

      {status ? (
        <div className={`editor-status${tone ? ` ${tone}` : ""}`} style={{ marginTop: 12 }}>
          {status}
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>{basis === "invoice" ? "Facturen" : "Orders"}</div>
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Datum</th>
                <th style={{ width: 160 }}>{basis === "invoice" ? "Factuur" : "Order"}</th>
                <th style={{ width: 160 }}>Omzet</th>
                <th style={{ width: 160 }}>Netto</th>
                <th style={{ width: 160 }}>Kostprijs</th>
                <th style={{ width: 160 }}>Marge</th>
                <th style={{ width: 120 }}>Regels</th>
                <th style={{ width: 120 }}>Unmapped</th>
                <th style={{ width: 120 }}>Ignored</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((row: any) => {
                const rowId = basis === "invoice" ? Number(row.sales_invoice_id || 0) : Number(row.sales_order_id || 0);
                const dateValue = basis === "invoice" ? String(row.invoice_date || "") : String(row.order_date || "");
                const label =
                  basis === "invoice" ? String(row.invoice_number || rowId || "-") : String(row.transaction_number || rowId || "-");
                const isExpanded = expandedId === rowId;
                const details = basis === "invoice" ? invoiceLines[rowId] : orderLines[rowId];

                return (
                  <Fragment key={rowId}>
                    <tr>
                      <td>
                        <code>{formatDateNl(dateValue)}</code>
                      </td>
                      <td>
                        <strong>{label}</strong>
                      </td>
                      <td>{euro(Number(row.omzet_ex ?? 0) || 0)}</td>
                      <td>{euro(Number(row.netto_omzet_ex ?? 0) || 0)}</td>
                      <td>{euro(Number(row.kostprijs_ex ?? 0) || 0)}</td>
                      <td>{euro(Number(row.brutomarge_ex ?? 0) || 0)}</td>
                      <td>{Number(row.lines ?? 0) || 0}</td>
                      <td>{Number(row.unmapped_lines ?? 0) || 0}</td>
                      <td>{Number(row.ignored_lines ?? 0) || 0}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          onClick={() => void toggleRow(rowId)}
                        >
                          {isExpanded ? "Sluiten" : "Details"}
                        </button>
                      </td>
                    </tr>

                    {isExpanded ? (
                      <tr>
                        <td colSpan={10} style={{ background: "rgba(255,255,255,0.02)" }}>
                          <div style={{ padding: "10px 6px" }}>
                            {details && details.length ? (
                              <div className="data-table" style={{ marginTop: 6 }}>
                                <table>
                                  <thead>
                                    <tr>
                                      <th style={{ width: 140 }}>Product</th>
                                      <th style={{ width: 100 }}>SKU</th>
                                      <th style={{ width: 100, textAlign: "right" }}>Aantal</th>
                                      <th style={{ width: 120, textAlign: "right" }}>Prijs</th>
                                      <th style={{ width: 130, textAlign: "right" }}>Korting</th>
                                      <th style={{ width: 130, textAlign: "right" }}>Charges</th>
                                      <th style={{ width: 140, textAlign: "right" }}>Netto</th>
                                      <th style={{ width: 140, textAlign: "right" }}>Kostprijs</th>
                                      <th style={{ width: 140, textAlign: "right" }}>Marge</th>
                                      <th style={{ width: 110 }}>Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {details.map((line: any) => (
                                      <tr key={line.line_id}>
                                        <td style={{ fontWeight: 700 }}>
                                          {line.douano_product_name || String(line.douano_product_id)}
                                        </td>
                                        <td>
                                          <code>{line.douano_sku || "-"}</code>
                                        </td>
                                        <td style={{ textAlign: "right" }}>{line.quantity}</td>
                                        <td style={{ textAlign: "right" }}>{euro(line.unit_price_ex)}</td>
                                        <td style={{ textAlign: "right" }}>{euro(line.discount_ex)}</td>
                                        <td style={{ textAlign: "right" }}>{euro(line.charges_ex)}</td>
                                        <td style={{ textAlign: "right" }}>{euro(line.net_revenue_ex)}</td>
                                        <td style={{ textAlign: "right" }}>{line.cost_total_ex != null ? euro(line.cost_total_ex) : "-"}</td>
                                        <td style={{ textAlign: "right" }}>{line.margin_ex != null ? euro(line.margin_ex) : "-"}</td>
                                        <td>
                                          {line.ignored ? (
                                            <span className="pill" style={{ background: "rgba(255,255,255,0.08)" }}>
                                              ignored
                                            </span>
                                          ) : line.mapped ? (
                                            line.missing_cost ? (
                                              <span className="pill" style={{ background: "rgba(255,77,77,0.16)" }}>
                                                missing cost
                                              </span>
                                            ) : (
                                              <span className="pill" style={{ background: "rgba(95,255,156,0.16)" }}>
                                                ok
                                              </span>
                                            )
                                          ) : (
                                            <span className="pill" style={{ background: "rgba(255,206,77,0.16)" }}>
                                              unmapped
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div style={{ opacity: 0.8 }}>Geen regels gevonden.</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
