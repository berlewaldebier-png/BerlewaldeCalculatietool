"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import { formatMoneyEUR } from "@/lib/formatters";

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
  ignored_lines: number;
  unmapped_lines: number;
};

type LineRow = {
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
  initialOnlyMissingCost = false
}: {
  companyId: number;
  initialOnlyUnmapped?: boolean;
  initialOnlyMissingCost?: boolean;
}) {
  const [since, setSince] = useState<string>("");
  const [onlyUnmapped, setOnlyUnmapped] = useState(Boolean(initialOnlyUnmapped));
  const [onlyMissingCost, setOnlyMissingCost] = useState(Boolean(initialOnlyMissingCost));
  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [orderLines, setOrderLines] = useState<Record<number, LineRow[]>>({});

  async function load() {
    setStatus("Laden…");
    setTone("");
    try {
      const qs = new URLSearchParams();
      qs.set("company_id", String(companyId));
      if (since.trim()) qs.set("since", since.trim());
      qs.set("limit", "500");
      const orderPayload = await readJson(`/api/integrations/douano/company-orders?${qs.toString()}`);
      setOrders(Array.isArray(orderPayload?.items) ? orderPayload.items : []);
      setOrderLines({});
      setExpandedOrderId(null);
      setStatus("Gereed");
      setTone("success");
    } catch (error) {
      setOrders([]);
      setOrderLines({});
      setExpandedOrderId(null);
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    return orders.reduce(
      (acc, row) => {
        acc.netto += Number(row.netto_omzet_ex ?? 0) || 0;
        acc.omzet += Number(row.omzet_ex ?? 0) || 0;
        acc.unmapped += Number(row.unmapped_lines ?? 0) || 0;
        return acc;
      },
      { omzet: 0, netto: 0, unmapped: 0 }
    );
  }, [orders]);

  async function toggleOrder(orderId: number) {
    const next = expandedOrderId === orderId ? null : orderId;
    setExpandedOrderId(next);
    if (!next) return;
    if (orderLines[next]) return;
    try {
      const qs = new URLSearchParams();
      qs.set("sales_order_id", String(next));
      if (onlyUnmapped) qs.set("only_unmapped", "true");
      if (onlyMissingCost) qs.set("only_missing_cost", "true");
      qs.set("limit", "5000");
      const payload = await readJson(`/api/integrations/douano/order-lines?${qs.toString()}`);
      setOrderLines((prev) => ({ ...prev, [next]: Array.isArray(payload?.items) ? payload.items : [] }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  return (
    <section>
      <div className="editor-actions" style={{ marginTop: 8 }}>
        <div className="editor-actions-group">
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
            <input
              type="checkbox"
              checked={onlyMissingCost}
              onChange={(e) => setOnlyMissingCost(e.target.checked)}
            />
            Alleen missing cost
          </label>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => void load()}>
            Ververs
          </button>
        </div>
        <div className="editor-actions-group">
          <span className="pill">Omzet {euro(totals.omzet)}</span>
          <span className="pill">Netto {euro(totals.netto)}</span>
          <span className="pill">Unmapped {totals.unmapped}</span>
        </div>
      </div>

      {status ? (
        <div className={`editor-status${tone ? ` ${tone}` : ""}`} style={{ marginTop: 12 }}>
          {status}
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Orders</div>
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Datum</th>
                <th style={{ width: 140 }}>Order</th>
                <th style={{ width: 160 }}>Omzet</th>
                <th style={{ width: 160 }}>Netto</th>
                <th style={{ width: 120 }}>Regels</th>
                <th style={{ width: 120 }}>Unmapped</th>
                <th style={{ width: 120 }}>Ignored</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 500).map((row) => {
                const isExpanded = expandedOrderId === row.sales_order_id;
                return (
                  <Fragment key={row.sales_order_id}>
                    <tr key={row.sales_order_id}>
                      <td><code>{formatDateNl(row.order_date)}</code></td>
                      <td><strong>{row.transaction_number || String(row.sales_order_id)}</strong></td>
                      <td>{euro(row.omzet_ex)}</td>
                      <td>{euro(row.netto_omzet_ex)}</td>
                      <td>{row.lines}</td>
                      <td>{row.unmapped_lines}</td>
                      <td>{row.ignored_lines}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          onClick={() => void toggleOrder(row.sales_order_id)}
                        >
                          {isExpanded ? "Sluiten" : "Open"}
                        </button>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr key={`${row.sales_order_id}-lines`}>
                        <td colSpan={8}>
                          <div style={{ padding: "10px 0" }}>
                            <div style={{ fontWeight: 800, marginBottom: 6 }}>Orderregels</div>
                            <div className="data-table">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Product</th>
                                    <th style={{ width: 90 }}>Qty</th>
                                    <th style={{ width: 140 }}>Netto</th>
                                    <th style={{ width: 140 }}>Kostprijs</th>
                                    <th style={{ width: 140 }}>Marge</th>
                                    <th style={{ width: 140 }}>Status</th>
                                    <th style={{ width: 160 }} />
                                  </tr>
                                </thead>
                                <tbody>
                                  {(orderLines[row.sales_order_id] ?? []).map((line) => {
                                    const lineStatus = line.ignored
                                      ? "ignored"
                                      : !line.mapped
                                        ? "unmapped"
                                        : line.missing_cost
                                          ? "missing cost"
                                          : "ok";
                                    return (
                                      <tr key={line.line_id}>
                                        <td>
                                          <div style={{ fontWeight: 700 }}>
                                            {line.douano_product_name || String(line.douano_product_id)}
                                          </div>
                                          <div className="muted" style={{ fontSize: "0.85rem" }}>
                                            <code>{line.douano_sku}</code>{" "}
                                            {line.mapped ? (
                                              <code>
                                                {line.bier_id}::{line.product_id}
                                              </code>
                                            ) : null}
                                          </div>
                                        </td>
                                        <td>{line.quantity}</td>
                                        <td>{euro(line.net_revenue_ex)}</td>
                                        <td>{line.cost_price_ex === null ? "-" : euro(line.cost_total_ex)}</td>
                                        <td>{line.cost_price_ex === null ? "-" : euro(line.margin_ex)}</td>
                                        <td>
                                          <span className="pill">{lineStatus}</span>
                                        </td>
                                        <td style={{ textAlign: "right" }}>
                                          {!line.mapped && !line.ignored ? (
                                            <a
                                              className="editor-button editor-button-secondary"
                                              href={`/beheer/productkoppeling?q=${encodeURIComponent(
                                                line.douano_product_name || String(line.douano_product_id)
                                              )}`}
                                            >
                                              Koppel
                                            </a>
                                          ) : null}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  {(orderLines[row.sales_order_id] ?? []).length === 0 ? (
                                    <tr>
                                      <td colSpan={7} style={{ opacity: 0.75 }}>
                                        Geen regels of nog aan het laden.
                                      </td>
                                    </tr>
                                  ) : null}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ opacity: 0.75 }}>
                    Geen orders gevonden.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
