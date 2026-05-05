"use client";

import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Euro,
  Filter,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";

import { NavigationSidebar } from "@/components/NavigationSidebar";
import { formatMoneyEUR } from "@/lib/formatters";
import type { ErpDashboardPayload, NavigationItem } from "@/lib/apiShared";

type Props = {
  navigation: NavigationItem[];
  payload: ErpDashboardPayload;
};

type KpiDef = {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
};

function clampPct(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function euro(value: number) {
  if (!Number.isFinite(value)) return "€ 0";
  return formatMoneyEUR(value);
}

function pct(value: number, digits = 1) {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(digits).replace(".", ",")}%`;
}

function shortDateLabel(iso: string) {
  const text = String(iso || "").trim();
  if (!text) return "-";
  const parts = text.split("-");
  if (parts.length !== 3) return text;
  return `${parts[2]}-${parts[1]}`;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`erp-card ${className}`}>
      {children}
    </section>
  );
}

function ProgressBar({ value }: { value: number }) {
  const width = clampPct(value);
  return (
    <div className="h-2 w-20 rounded-full bg-slate-100">
      <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${width}%` }} />
    </div>
  );
}

function EmptyState({ title, body, href, hrefLabel }: { title: string; body: string; href?: string; hrefLabel?: string }) {
  return (
    <div className="erp-empty">
      <div className="erp-empty-title">{title}</div>
      <div className="erp-empty-body">{body}</div>
      {href ? (
        <Link href={href as Route} className="erp-empty-link">
          {hrefLabel || "Bekijk"} <ArrowRight className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  );
}

export function ErpDashboard({ navigation, payload }: Props) {
  const router = useRouter();
  const [showFilters, setShowFilters] = useState(false);
  const [sinceInput, setSinceInput] = useState(payload.range?.since || "");
  const [untilInput, setUntilInput] = useState(payload.range?.until || "");

  const kpis = useMemo<KpiDef[]>(() => {
    const k = payload.kpis;
    if (!k) return [];
    const breakEvenSub = payload.break_even?.active_config ? "Break-even configuratie actief" : "Geen break-even configuratie actief";
    const breakEvenValue = payload.break_even?.active_config ? "Actief" : "—";

    return [
      {
        label: "Omzet (netto, ex)",
        value: euro(k.total_revenue_ex),
        sub: `${payload.range.since} t/m ${payload.range.until}`,
        icon: Euro,
      },
      {
        label: "Aantal orders",
        value: String(k.total_orders),
        sub: "Orders op basis van Douano",
        icon: ShoppingCart,
      },
      {
        label: "Gem. orderwaarde",
        value: euro(k.average_order_value_ex),
        sub: "Netto omzet / orders",
        icon: TrendingUp,
      },
      {
        label: "Marge",
        value: euro(k.total_margin_ex),
        sub: `${pct(k.margin_pct, 1)} marge`,
        icon: BarChart3,
      },
      {
        label: "Break-even status",
        value: breakEvenValue,
        sub: breakEvenSub,
        icon: CheckCircle2,
      },
      {
        label: "Kostprijs ontbreekt",
        value: String(k.missing_cost_lines),
        sub: "Mapped regels zonder kostprijs",
        icon: AlertTriangle,
      },
    ];
  }, [payload]);

  const revenueData = useMemo(() => {
    return (payload.trends?.revenue ?? []).map((row) => ({
      date: shortDateLabel(row.date),
      omzet: Number(row.revenue_ex || 0),
      breakEven: Number(row.break_even_ex || 0),
    }));
  }, [payload.trends?.revenue]);

  const ordersData = useMemo(() => {
    return (payload.trends?.orders ?? []).map((row) => ({
      date: shortDateLabel(row.date),
      orders: Number(row.orders || 0),
      aov: Number(row.aov_ex || 0),
    }));
  }, [payload.trends?.orders]);

  const topCustomers = payload.tables?.top_customers ?? [];
  const underBreakEven = payload.tables?.under_break_even ?? [];
  const latestOrders = payload.tables?.latest_orders ?? [];
  const alerts = payload.alerts ?? [];

  const pieData = useMemo(() => {
    const groups = payload.tables?.product_groups ?? [];
    if (!groups.length) return [];
    const palette = ["#2563eb", "#22c55e", "#8b5cf6", "#f97316", "#94a3b8"];
    return groups.slice(0, 5).map((row, idx) => ({
      name: row.group,
      value: Number(row.margin_pct || 0),
      fill: palette[idx % palette.length],
    }));
  }, [payload.tables?.product_groups]);

  return (
    <main className="dashboard-page erp-dashboard-page">
      <div className="dashboard-shell">
        <NavigationSidebar navigation={navigation} activePath="/" />

        <div className="dashboard-main-content">
          <div className="erp-dashboard-container">
            <header className="erp-dashboard-header">
              <div>
                <p className="dashboard-hero-eyebrow">Overzicht</p>
                <h1 className="erp-dashboard-title">Welkom terug</h1>
                <p className="dashboard-hero-description">Belangrijkste prestaties, marges en break-even inzichten.</p>
              </div>
              <div className="erp-dashboard-header-actions">
                <button
                  type="button"
                  className="erp-dashboard-pill"
                  title="Periode (read-only in deze versie)"
                >
                  <CalendarDays className="h-4 w-4" /> {payload.range.since} - {payload.range.until}
                </button>
                <button
                  type="button"
                  className="erp-dashboard-pill"
                  title="Filters (volgt)"
                  onClick={() => setShowFilters((prev) => !prev)}
                >
                  <Filter className="h-4 w-4" /> Filters
                </button>
              </div>
            </header>

            {showFilters ? (
              <Card className="erp-pad" aria-label="Filters">
                <div className="module-card-title">Filters</div>
                <div className="module-card-text" style={{ marginTop: 4 }}>
                  Kies een periode (YYYY-MM-DD). Basis is altijd Douano orders.
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                  <label className="editor-field" style={{ minWidth: 220 }}>
                    <div className="editor-label">Sinds</div>
                    <input
                      className="editor-input"
                      type="date"
                      value={sinceInput}
                      onChange={(e) => setSinceInput(e.target.value)}
                    />
                  </label>
                  <label className="editor-field" style={{ minWidth: 220 }}>
                    <div className="editor-label">Tot</div>
                    <input
                      className="editor-input"
                      type="date"
                      value={untilInput}
                      onChange={(e) => setUntilInput(e.target.value)}
                    />
                  </label>

                  <div className="editor-actions" style={{ marginTop: 22 }}>
                    <button
                      type="button"
                      className="editor-button"
                      onClick={() => {
                        const params = new URLSearchParams();
                        if (sinceInput.trim()) params.set("since", sinceInput.trim());
                        if (untilInput.trim()) params.set("until", untilInput.trim());
                        const qs = params.toString();
                        router.push(qs ? `/?${qs}` : "/");
                        setShowFilters(false);
                      }}
                    >
                      Toepassen
                    </button>
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      onClick={() => {
                        setSinceInput(payload.range?.since || "");
                        setUntilInput(payload.range?.until || "");
                        setShowFilters(false);
                      }}
                    >
                      Annuleren
                    </button>
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      onClick={() => {
                        router.push("/");
                        setSinceInput(payload.range?.since || "");
                        setUntilInput(payload.range?.until || "");
                        setShowFilters(false);
                      }}
                      title="Verwijder filters"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </Card>
            ) : null}

            {payload.kpis ? (
              <section className="erp-kpi-grid" aria-label="KPI's">
                {kpis.map((kpi) => {
                  const Icon = kpi.icon;
                  return (
                    <Card key={kpi.label} className="erp-kpi-card">
                      <div className="erp-kpi-icon">
                          <Icon className="h-5 w-5" />
                      </div>
                      <p className="erp-kpi-label">{kpi.label}</p>
                      <p className="erp-kpi-value">{kpi.value}</p>
                      <p className="erp-kpi-sub">{kpi.sub}</p>
                    </Card>
                  );
                })}
              </section>
            ) : (
              <EmptyState
                title="Nog geen ERP data"
                body={payload.empty_reason || "Geen Douano orders gevonden voor de gekozen periode."}
                href="/beheer/api"
                hrefLabel="Naar Douano koppeling"
              />
            )}

            <section className="erp-grid-2">
              <Card className="erp-pad">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="module-card-title">Omzet over tijd</h2>
                  <span className="erp-chip">Maand</span>
                </div>
                <div className="h-72">
                  {revenueData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={revenueData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" fontSize={12} />
                        <YAxis fontSize={12} tickFormatter={(v) => `€ ${Math.round(Number(v) / 1000)}k`} />
                        <Tooltip formatter={(v) => euro(Number(v))} />
                        <Legend />
                        <Area type="monotone" dataKey="omzet" stroke="currentColor" fill="currentColor" fillOpacity={0.08} className="text-blue-600" />
                        <Line type="monotone" dataKey="breakEven" stroke="currentColor" strokeDasharray="5 5" className="text-slate-400" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState title="Geen trenddata" body="Geen omzetpunten gevonden in deze periode." />
                  )}
                </div>
              </Card>

              <Card className="erp-pad">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="module-card-title">Orders & gem. orderwaarde</h2>
                  <span className="erp-chip">Maand</span>
                </div>
                <div className="h-72">
                  {ordersData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ordersData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" fontSize={12} />
                        <YAxis yAxisId="left" fontSize={12} />
                        <YAxis yAxisId="right" orientation="right" fontSize={12} tickFormatter={(v) => `€ ${Math.round(Number(v))}`} />
                        <Tooltip formatter={(v) => (typeof v === "number" ? v.toLocaleString("nl-NL") : String(v))} />
                        <Legend />
                        <Bar yAxisId="left" dataKey="orders" fill="currentColor" radius={[8, 8, 0, 0]} className="text-blue-500" />
                        <Line yAxisId="right" type="monotone" dataKey="aov" stroke="currentColor" strokeWidth={3} className="text-purple-500" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState title="Geen ordertrend" body="Geen orderpunten gevonden in deze periode." />
                  )}
                </div>
              </Card>
            </section>

            <section className="erp-grid-3">
              <Card className="erp-pad">
                <h2 className="module-card-title">
                  Top 5 klanten <span className="erp-muted-inline">op marge</span>
                </h2>
                {topCustomers.length ? (
                  <>
                    <div className="erp-stack">
                      {topCustomers.map((row, index) => (
                        <div key={String(row.company_id)} className="erp-row-grid">
                          <span className="erp-rank">{index + 1}</span>
                          <span className="erp-strong">{row.company_name || "-"}</span>
                          <span>{euro(row.margin_ex)}</span>
                          <ProgressBar value={clampPct(row.margin_pct)} />
                        </div>
                      ))}
                    </div>
                    <Link href={"/omzet-en-marge" as Route} className="erp-link">
                      Bekijk omzet & marge <ArrowRight className="h-4 w-4" />
                    </Link>
                  </>
                ) : (
                  <EmptyState title="Geen klanten" body="Geen klantmarges gevonden in deze periode." href="/omzet-en-marge" hrefLabel="Open omzet & marge" />
                )}
              </Card>

              <Card className="erp-pad">
                <h2 className="module-card-title">
                  Productgroepen <span className="erp-muted-inline">op marge %</span>
                </h2>
                <EmptyState
                  title="Nog geen productgroepen"
                  body="Productgroepen volgen zodra SKU's een productgroep hebben (Product samenstellen → stap 1)."
                  href="/product-samenstellen"
                  hrefLabel="Naar product samenstellen"
                />
              </Card>

              <Card className="erp-pad">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="module-card-title">Orders onder break-even</h2>
                  <span className="erp-badge-danger">{underBreakEven.length}</span>
                </div>
                {underBreakEven.length ? (
                  <>
                    <div className="erp-stack">
                      {underBreakEven.map((row) => (
                        <div key={row.order_number} className="erp-row-grid-be">
                          <span className="erp-strong">{row.order_number}</span>
                          <span className="muted">{row.company_name}</span>
                          <span className="erp-danger">{euro(row.margin_ex)}</span>
                        </div>
                      ))}
                    </div>
                    <Link href={"/omzet-en-marge" as Route} className="erp-link">
                      Bekijk details <ArrowRight className="h-4 w-4" />
                    </Link>
                  </>
                ) : (
                  <EmptyState title="Geen negatieve marge" body="Geen orders met negatieve marge gevonden in deze periode." />
                )}
              </Card>
            </section>

            <section className="erp-grid-2">
              <Card className="erp-pad">
                <h2 className="module-card-title">Aandacht nodig</h2>
                {alerts.length ? (
                  <div className="erp-stack">
                    {alerts.map((item) => (
                      <div key={item.key} className="erp-alert-row">
                        <div>
                          <p className="erp-strong">{item.title}</p>
                          <p className="muted">{item.description}</p>
                        </div>
                        {item.href ? (
                          <Link href={(item.href as Route) ?? ("/" as Route)} className="editor-button editor-button-secondary">
                            Bekijk
                          </Link>
                        ) : (
                          <span className="editor-button editor-button-secondary" aria-disabled="true">
                            OK
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Geen alerts" body="Geen belangrijke aandachtspunten voor deze periode." />
                )}
                <Link href={"/beheer" as Route} className="erp-link">
                  Bekijk beheer <ArrowRight className="h-4 w-4" />
                </Link>
              </Card>

              <Card className="erp-pad">
                <h2 className="module-card-title">Financieel overzicht</h2>
                {payload.kpis ? (
                  <div className="erp-metric-grid">
                    {[
                      ["Totale omzet", euro(payload.kpis.total_revenue_ex), payload.range.since],
                      ["Totale kostprijs", euro(payload.kpis.total_cost_ex), payload.range.until],
                      ["Totale marge", euro(payload.kpis.total_margin_ex), pct(payload.kpis.margin_pct, 1)],
                      ["Break-even (config)", payload.break_even?.active_config ? "Actief" : "—", String(payload.break_even?.year || "")],
                    ].map((item) => (
                      <div key={item[0]} className="erp-metric">
                        <p className="erp-metric-label">{item[0]}</p>
                        <p className="erp-metric-value">{item[1]}</p>
                        <p className="erp-metric-sub">{item[2]}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Geen cijfers" body="Zodra orders zijn gesynchroniseerd verschijnt hier het financieel overzicht." href="/beheer/api" hrefLabel="Koppel Douano" />
                )}
              </Card>
            </section>

            <section className="erp-grid-2wide">
              <Card className="erp-pad">
                <h2 className="module-card-title">Laatste orders</h2>
                {latestOrders.length ? (
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-table" style={{ marginTop: 12 }}>
                      <thead>
                        <tr>
                          <th>Order</th>
                          <th>Klant</th>
                          <th>Datum</th>
                          <th>Bedrag</th>
                          <th>Marge %</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latestOrders.map((row) => {
                          const revenueEx = Number(row.revenue_ex || 0);
                          const costEx = Number(row.cost_ex || 0);
                          const marginEx = revenueEx - costEx;
                          const marginPct = revenueEx > 0 ? (marginEx / revenueEx) * 100 : 0;
                          const status = String(row.status || "").toLowerCase();
                          const label = status || "—";
                          return (
                            <tr key={`${row.order_number}-${row.order_date}`}>
                              <td className="erp-strong">{row.order_number || "-"}</td>
                              <td>{row.company_name || "-"}</td>
                              <td>{row.order_date || "-"}</td>
                              <td>{euro(revenueEx)}</td>
                              <td>{pct(marginPct, 1)}</td>
                              <td>
                                <span
                                  className={`erp-status-pill ${label.includes("def") ? "ok" : "info"}`}
                                >
                                  {label}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="Geen orders" body="Geen recente orders gevonden in deze periode." />
                )}
                <Link href={"/omzet-en-marge" as Route} className="erp-link">
                  Bekijk omzet & marge <ArrowRight className="h-4 w-4" />
                </Link>
              </Card>

              <Card className="erp-pad">
                <h2 className="module-card-title">Omzet per productgroep</h2>
                {pieData.length ? (
                  <>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} innerRadius={58} outerRadius={92} dataKey="value" paddingAngle={3}>
                            {pieData.map((entry, index) => (
                              <Cell key={`cell-${entry.name}`} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => `${v}%`} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="erp-stack">
                      {pieData.map((item) => (
                        <div key={item.name} className="erp-row-space-between">
                          <span>{item.name}</span>
                          <span className="erp-strong">{pct(item.value, 0)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState
                    title="Nog geen productgroepen"
                    body="Productgroepen volgen zodra SKU's een productgroep hebben."
                    href="/product-samenstellen"
                    hrefLabel="Vul productgroepen"
                  />
                )}
              </Card>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
