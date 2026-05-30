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
import {
  calculateBreakEvenResult,
  normalizeConfigList,
  buildBreakEvenProductLines,
  type BreakEvenConfig,
} from "@/components/break-even/breakEvenUtils";

type Props = {
  navigation: NavigationItem[];
  payload: ErpDashboardPayload;
  initialFilters?: { since: string; until: string; year: string; basis?: string; sku_id?: string };
  breakEvenContext?: {
    configs?: unknown;
    vasteKosten?: unknown;
    channels?: unknown;
    bieren?: unknown;
    kostprijsversies?: unknown;
    kostprijsproductactiveringen?: unknown;
    verkoopprijzen?: unknown;
    skus?: unknown;
    articles?: unknown;
    basisproducten?: unknown;
    samengesteldeProducten?: unknown;
  };
};

type KpiDef = {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
};

const CHART_COLORS = {
  blue: "#2563eb",
  blueFill: "rgba(37, 99, 235, 0.12)",
  slate: "#94a3b8",
  purple: "#8b5cf6",
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

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function inferPresetFromRange(input: { since: string; until: string; basis: string; skuId: string }) {
  const skuId = String(input.skuId || "").trim();
  if (skuId) return "sku";

  const basis = String(input.basis || "").trim().toLowerCase() || "invoice";
  const since = String(input.since || "").trim();
  const until = String(input.until || "").trim();
  if (!since || !until) return "";

  const today = toISODate(new Date());
  const currentYear = new Date().getFullYear();

  const thisYearSince = `${currentYear}-01-01`;
  if (basis === "invoice" && since === thisYearSince && until === today) return "this-year";

  const lastYear = currentYear - 1;
  if (basis === "invoice" && since === `${lastYear}-01-01` && until === `${lastYear}-12-31`) return "last-year";

  const now = new Date();
  const thisMonthSince = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  if (basis === "invoice" && since === thisMonthSince && until === today) return "this-month";

  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthSince = `${prevMonthStart.getFullYear()}-${String(prevMonthStart.getMonth() + 1).padStart(2, "0")}-01`;
  const prevMonthUntil = toISODate(new Date(prevMonthStart.getFullYear(), prevMonthStart.getMonth() + 1, 0));
  if (basis === "invoice" && since === prevMonthSince && until === prevMonthUntil) return "last-month";

  if (since && until) return "custom";
  return "";
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

export function ErpDashboard({ navigation, payload, breakEvenContext, initialFilters }: Props) {
  const router = useRouter();
  const [showFilters, setShowFilters] = useState(false);
  const [chartView, setChartView] = useState<"revenue" | "orders">("revenue");
  const [sinceInput, setSinceInput] = useState((initialFilters?.since || payload.range?.since || "").trim());
  const [untilInput, setUntilInput] = useState((initialFilters?.until || payload.range?.until || "").trim());
  const [yearInput, setYearInput] = useState<string>((initialFilters?.year || "").trim());
  const [basisInput, setBasisInput] = useState<string>(
    (initialFilters?.basis || payload.range?.basis || "invoice").trim() || "invoice"
  );
  const [skuInput, setSkuInput] = useState<string>(initialFilters?.sku_id || "");
  const [activePreset, setActivePreset] = useState<string>(() =>
    inferPresetFromRange({
      since: (initialFilters?.since || payload.range?.since || "").trim(),
      until: (initialFilters?.until || payload.range?.until || "").trim(),
      basis: (initialFilters?.basis || payload.range?.basis || "invoice").trim() || "invoice",
      skuId: String(initialFilters?.sku_id || "").trim(),
    })
  );

  const availableYears = (payload.available_years ?? []).filter((y) => Number.isFinite(y) && y > 0);

  const availableSkus = useMemo(() => {
    const rows = Array.isArray((breakEvenContext as any)?.skus) ? ((breakEvenContext as any).skus as any[]) : [];
    return rows
      .filter((row) => row && typeof row === "object")
      .map((row) => ({
        id: String((row as any).id || "").trim(),
        name: String((row as any).name || (row as any).naam || "").trim(),
      }))
      .filter((row) => row.id)
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  }, [breakEvenContext]);

  const applyFilters = (next?: { since?: string; until?: string; year?: string; basis?: string; sku_id?: string }) => {
    const params = new URLSearchParams();
    const nextYear = String(next?.year ?? yearInput).trim();
    const nextSince = String(next?.since ?? sinceInput).trim();
    const nextUntil = String(next?.until ?? untilInput).trim();
    const nextBasis = String(next?.basis ?? basisInput).trim();
    const nextSku = String(next?.sku_id ?? skuInput).trim();
    if (nextYear) params.set("year", nextYear);
    if (nextSince) params.set("since", nextSince);
    if (nextUntil) params.set("until", nextUntil);
    if (nextBasis) params.set("basis", nextBasis);
    if (nextSku) params.set("sku_id", nextSku);
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/");
  };

  const setPresetAndApply = (preset: string, next: { since: string; until: string; year: string }) => {
    setActivePreset(preset);
    setSinceInput(next.since);
    setUntilInput(next.until);
    setYearInput(next.year);
    applyFilters({ ...next, basis: basisInput, sku_id: skuInput });
  };

  const resetToCurrentYear = () => {
    const now = new Date();
    const y = now.getFullYear();
    const since = `${y}-01-01`;
    const until = toISODate(now);
    setActivePreset("this-year");
    setBasisInput("invoice");
    setSkuInput("");
    setSinceInput(since);
    setUntilInput(until);
    setYearInput(String(y));
    applyFilters({ since, until, year: String(y), basis: "invoice", sku_id: "" });
  };

  const hasValidRange = useMemo(() => {
    if (!sinceInput.trim() || !untilInput.trim()) return true;
    return sinceInput.trim() <= untilInput.trim();
  }, [sinceInput, untilInput]);

  const breakEvenTrend = useMemo(() => {
    const ctx = breakEvenContext ?? {};
    const configsRaw = ctx.configs;
    const vasteKostenRaw = ctx.vasteKosten;
    const channels = Array.isArray(ctx.channels) ? (ctx.channels as any[]) : [];
    const bieren = Array.isArray(ctx.bieren) ? (ctx.bieren as any[]) : [];
    const skus = Array.isArray(ctx.skus) ? (ctx.skus as any[]) : [];
    const articles = Array.isArray(ctx.articles) ? (ctx.articles as any[]) : [];
    const kostprijsversies = Array.isArray(ctx.kostprijsversies) ? (ctx.kostprijsversies as any[]) : [];
    const kostprijsproductactiveringen = Array.isArray(ctx.kostprijsproductactiveringen)
      ? (ctx.kostprijsproductactiveringen as any[])
      : [];
    const verkoopprijzen = Array.isArray(ctx.verkoopprijzen) ? (ctx.verkoopprijzen as any[]) : [];
    const basisproducten = Array.isArray(ctx.basisproducten) ? (ctx.basisproducten as any[]) : [];
    const samengesteldeProducten = Array.isArray(ctx.samengesteldeProducten) ? (ctx.samengesteldeProducten as any[]) : [];

    const yearFromRange = Number(String(payload.range?.since || "").slice(0, 4)) || new Date().getFullYear();
    const year = Number(yearInput || yearFromRange) || yearFromRange;

    const configs = normalizeConfigList(configsRaw, year);
    const active =
      configs.find((c) => c.is_active_for_quotes && c.jaar === year) ??
      configs.find((c) => c.jaar === year) ??
      null;
    if (!active) return { breakEvenRevenue: 0, scaled: 0, line: [] as Array<{ date: string; breakEven: number }> };

    const lines = buildBreakEvenProductLines({
      year,
      channels,
      bieren,
      skus,
      articles,
      kostprijsversies,
      kostprijsproductactiveringen,
      verkoopprijzen,
      basisproducten,
      samengesteldeProducten,
    });

    const vasteKosten = (vasteKostenRaw && typeof vasteKostenRaw === "object") ? (vasteKostenRaw as any) : {};
    const result = calculateBreakEvenResult(active as BreakEvenConfig, lines as any, vasteKosten);
    const breakEvenRevenueYear = Number(result.breakEvenRevenue || 0) || 0;

    const since = payload.range?.since ? new Date(payload.range.since) : new Date();
    const until = payload.range?.until ? new Date(payload.range.until) : new Date();
    const periodDays = Math.max(1, Math.round((until.getTime() - since.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const yearDays = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
    const scaled = breakEvenRevenueYear * (periodDays / yearDays);

    const points = (payload.trends?.revenue ?? []).map((row) => row.date).filter(Boolean);
    const totalPoints = Math.max(1, points.length);
    const line = points.map((d, idx) => ({
      date: shortDateLabel(d),
      breakEven: scaled * ((idx + 1) / totalPoints),
    }));

    return { breakEvenRevenue: breakEvenRevenueYear, scaled, line };
  }, [breakEvenContext, payload.range?.since, payload.range?.until, payload.trends?.revenue, yearInput]);

  const kpis = useMemo<KpiDef[]>(() => {
    const k = payload.kpis;
    if (!k) return [];
    const hasBreakEven = Boolean(payload.break_even?.active_config);
    const delta = hasBreakEven ? k.total_revenue_ex - (breakEvenTrend.scaled || 0) : 0;
    const breakEvenValue = hasBreakEven ? (delta >= 0 ? `+${euro(delta)}` : `-${euro(Math.abs(delta))}`) : "—";
    const breakEvenSub = hasBreakEven ? "t.o.v. break-even (geschaald)" : "Geen break-even configuratie actief";

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
  }, [payload, breakEvenTrend.scaled]);

  const revenueData = useMemo(() => {
    const beByDate = new Map((breakEvenTrend.line ?? []).map((p) => [p.date, p.breakEven]));
    return (payload.trends?.revenue ?? []).map((row) => {
      const dateLabel = shortDateLabel(row.date);
      const forecast = typeof row.forecast_ex === "number" ? row.forecast_ex : null;
      return {
        date: dateLabel,
        omzet: Number(row.revenue_ex || 0),
        breakEven: Number(beByDate.get(dateLabel) || 0),
        prognose: forecast,
      };
    });
  }, [payload.trends?.revenue, breakEvenTrend.line]);

  const ordersData = useMemo(() => {
    return (payload.trends?.orders ?? []).map((row) => ({
      date: shortDateLabel(row.date),
      orders: Number(row.orders || 0),
      aov: Number(row.aov_ex || 0),
      prognoseOrders: typeof row.forecast_orders === "number" ? Number(row.forecast_orders) : Number(row.orders || 0),
    }));
  }, [payload.trends?.orders]);

  const topCustomers = payload.tables?.top_customers ?? [];
  const underBreakEven = payload.tables?.under_break_even ?? [];
  const latestOrders = payload.tables?.latest_orders ?? [];
  const alerts = payload.alerts ?? [];

  const packagingTypes = useMemo(() => {
    const rows = (payload.tables as any)?.packaging_types ?? [];
    const normalized = Array.isArray(rows)
      ? rows
          .filter((row) => row && typeof row === "object")
          .map((row) => ({
            packaging_type: String((row as any).packaging_type || "").trim() || "-",
            qty: Number((row as any).qty || 0) || 0,
          }))
          .filter((row) => row.qty > 0)
      : [];
    const total = normalized.reduce((sum, row) => sum + row.qty, 0);
    const withPct = normalized.map((row) => ({
      ...row,
      pct: total > 0 ? (row.qty / total) * 100 : 0,
    }));
    return { rows: withPct, total };
  }, [payload.tables]);

  const pieData = useMemo(() => {
    const groups = payload.tables?.product_groups ?? [];
    if (!groups.length) return [];
    const palette = ["#2563eb", "#22c55e", "#8b5cf6", "#f97316", "#94a3b8"];
    return groups.slice(0, 5).map((row, idx) => ({
      name: row.group,
      value: Math.max(0, Number(row.margin_ex || 0)),
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
              <div className="erp-dashboard-header-actions">
                <button
                  type="button"
                  className={`erp-dashboard-pill${activePreset === "this-year" ? " is-active" : ""}`}
                  onClick={() => {
                    const now = new Date();
                    const y = now.getFullYear();
                    setPresetAndApply("this-year", {
                      since: `${y}-01-01`,
                      until: toISODate(now),
                      year: String(y),
                    });
                  }}
                  title="Zet filters op dit jaar (YTD)"
                >
                  Dit jaar
                </button>
                <button
                  type="button"
                  className={`erp-dashboard-pill${activePreset === "last-year" ? " is-active" : ""}`}
                  onClick={() => {
                    const now = new Date();
                    const y = now.getFullYear() - 1;
                    setPresetAndApply("last-year", {
                      since: `${y}-01-01`,
                      until: `${y}-12-31`,
                      year: String(y),
                    });
                  }}
                  title="Zet filters op vorig jaar"
                >
                  Vorig jaar
                </button>
                <button
                  type="button"
                  className={`erp-dashboard-pill${activePreset === "this-month" ? " is-active" : ""}`}
                  onClick={() => {
                    const now = new Date();
                    const y = now.getFullYear();
                    const m = now.getMonth();
                    const mm = String(m + 1).padStart(2, "0");
                    setPresetAndApply("this-month", {
                      since: `${y}-${mm}-01`,
                      until: toISODate(now),
                      year: String(y),
                    });
                  }}
                  title="Zet filters op deze maand (t/m vandaag)"
                >
                  Deze maand
                </button>
                <button
                  type="button"
                  className={`erp-dashboard-pill${activePreset === "last-month" ? " is-active" : ""}`}
                  onClick={() => {
                    const now = new Date();
                    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    const y = d.getFullYear();
                    const m = d.getMonth();
                    const mm = String(m + 1).padStart(2, "0");
                    setPresetAndApply("last-month", {
                      since: `${y}-${mm}-01`,
                      until: toISODate(new Date(y, m + 1, 0)),
                      year: String(y),
                    });
                  }}
                  title="Zet filters op vorige maand"
                >
                  Vorige maand
                </button>

                <label className="erp-dashboard-pill erp-dashboard-pill-select" title="Filter op SKU">
                  <span>Alleen SKU</span>
                  <select
                    aria-label="Alleen SKU"
                    value={skuInput}
                    onChange={(e) => {
                      const next = e.target.value;
                      setSkuInput(next);
                      setActivePreset(next ? "sku" : "");
                      applyFilters({ sku_id: next });
                    }}
                  >
                    <option value="">Alle</option>
                    {availableSkus.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name ? `${row.name} (${row.id})` : row.id}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className={`erp-dashboard-pill${activePreset === "custom" ? " is-active" : ""}`}
                  title="Open eigen filters"
                  onClick={() => {
                    setActivePreset("custom");
                    setShowFilters(true);
                  }}
                >
                  Eigen selectie/filter
                </button>
                <button type="button" className="erp-dashboard-pill" title="(placeholder)">
                  Vergelijken
                </button>

              </div>

              <div className="erp-dashboard-subbar" aria-label="Datum basis en reset">
                <div className="erp-dashboard-segment" role="group" aria-label="Basis">
                  <button
                    type="button"
                    className={`erp-dashboard-segment-pill${basisInput === "invoice" ? " is-active" : ""}`}
                    onClick={() => {
                      setBasisInput("invoice");
                      applyFilters({ basis: "invoice" });
                    }}
                  >
                    Factuurdatum
                  </button>
                  <button
                    type="button"
                    className={`erp-dashboard-segment-pill${basisInput === "order" ? " is-active" : ""}`}
                    onClick={() => {
                      setBasisInput("order");
                      applyFilters({ basis: "order" });
                    }}
                  >
                    Orderdatum
                  </button>
                </div>

                <button
                  type="button"
                  className="erp-dashboard-reset"
                  onClick={() => resetToCurrentYear()}
                  title="Reset naar huidig jaar (factuurdatum)"
                >
                  Reset filter
                </button>
              </div>
            </header>

            {showFilters ? (
              <Card className="erp-pad" aria-label="Filters">
                <div className="module-card-title">Filters</div>
                <div className="module-card-text" style={{ marginTop: 4 }}>
                  Kies een periode (YYYY-MM-DD). Jaar is optioneel.
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                  <label className="editor-field" style={{ minWidth: 180 }}>
                    <div className="editor-label">Jaar</div>
                    <select
                      className="editor-input"
                      value={yearInput}
                      onChange={(e) => setYearInput(e.target.value)}
                      aria-label="Jaar"
                    >
                      <option value="">Auto</option>
                      {availableYears.slice().reverse().map((y) => (
                        <option key={y} value={String(y)}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </label>
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
                      disabled={!hasValidRange}
                      onClick={() => {
                        setActivePreset("custom");
                        applyFilters({
                          year: yearInput,
                          since: sinceInput,
                          until: untilInput,
                          basis: basisInput,
                          sku_id: skuInput,
                        });
                        setShowFilters(false);
                      }}
                    >
                      Toepassen
                    </button>
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      onClick={() => {
                        const nextSince = (initialFilters?.since || payload.range?.since || "").trim();
                        const nextUntil = (initialFilters?.until || payload.range?.until || "").trim();
                        const nextYear = (initialFilters?.year || "").trim();
                        const nextBasis = (initialFilters?.basis || payload.range?.basis || "invoice").trim() || "invoice";
                        const nextSku = String(initialFilters?.sku_id || "").trim();
                        setSinceInput(nextSince);
                        setUntilInput(nextUntil);
                        setYearInput(nextYear);
                        setBasisInput(nextBasis);
                        setSkuInput(nextSku);
                        setActivePreset(
                          inferPresetFromRange({ since: nextSince, until: nextUntil, basis: nextBasis, skuId: nextSku })
                        );
                        setShowFilters(false);
                      }}
                    >
                      Annuleren
                    </button>
                  </div>
                </div>
                {!hasValidRange ? (
                  <div className="editor-status error" style={{ marginTop: 10 }}>
                    Ongeldige periode: “Tot” moet op of na “Sinds” liggen.
                  </div>
                ) : null}

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

            <section>
              <Card className="erp-pad">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <h2 className="module-card-title">
                      {chartView === "revenue" ? "Omzet over tijd" : "Orders & gem. orderwaarde"}
                    </h2>
                    <span className="erp-chip">Maand</span>
                  </div>
                  <div className="erp-dashboard-segment" aria-label="Grafiek kiezen">
                    <button
                      type="button"
                      className={`erp-dashboard-segment-pill${chartView === "revenue" ? " is-active" : ""}`}
                      onClick={() => setChartView("revenue")}
                    >
                      Omzet over tijd
                    </button>
                    <button
                      type="button"
                      className={`erp-dashboard-segment-pill${chartView === "orders" ? " is-active" : ""}`}
                      onClick={() => setChartView("orders")}
                    >
                      Orders & gem.
                    </button>
                  </div>
                </div>
                <div className="erp-chart-area">
                  {revenueData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={revenueData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" fontSize={12} />
                        <YAxis fontSize={12} tickFormatter={(v) => `€ ${Math.round(Number(v) / 1000)}k`} />
                        <Tooltip formatter={(v) => euro(Number(v))} />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="omzet"
                          stroke={CHART_COLORS.blue}
                          fill={CHART_COLORS.blueFill}
                          fillOpacity={1}
                        />
                        <Line
                          type="monotone"
                          dataKey="prognose"
                          stroke={CHART_COLORS.purple}
                          strokeDasharray="6 6"
                          dot={false}
                          connectNulls
                        />
                        <Line
                          type="monotone"
                          dataKey="breakEven"
                          stroke={CHART_COLORS.slate}
                          strokeDasharray="5 5"
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState title="Geen trenddata" body="Geen omzetpunten gevonden in deze periode." />
                  )}
                </div>
              </Card>

              <Card className={`erp-pad${chartView === "orders" ? "" : " hidden"}`}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <h2 className="module-card-title">Orders & gem. orderwaarde</h2>
                    <span className="erp-chip">Maand</span>
                  </div>
                  <div className="erp-dashboard-segment" aria-label="Grafiek kiezen">
                    <button
                      type="button"
                      className={`erp-dashboard-segment-pill${chartView === "revenue" ? " is-active" : ""}`}
                      onClick={() => setChartView("revenue")}
                    >
                      Omzet over tijd
                    </button>
                    <button
                      type="button"
                      className={`erp-dashboard-segment-pill${chartView === "orders" ? " is-active" : ""}`}
                      onClick={() => setChartView("orders")}
                    >
                      Orders & gem.
                    </button>
                  </div>
                </div>
                <div className="erp-chart-area">
                  {ordersData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ordersData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" fontSize={12} />
                        <YAxis yAxisId="left" fontSize={12} />
                        <YAxis yAxisId="right" orientation="right" fontSize={12} tickFormatter={(v) => `€ ${Math.round(Number(v))}`} />
                        <Tooltip formatter={(v) => (typeof v === "number" ? v.toLocaleString("nl-NL") : String(v))} />
                        <Legend />
                        <Bar yAxisId="left" dataKey="orders" fill={CHART_COLORS.blue} radius={[8, 8, 0, 0]} />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="prognoseOrders"
                          stroke={CHART_COLORS.purple}
                          strokeDasharray="6 6"
                          dot={false}
                          connectNulls
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="aov"
                          stroke={CHART_COLORS.purple}
                          strokeWidth={3}
                          dot={false}
                        />
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
                  Verpakkingstypen <span className="erp-muted-inline">op aantallen</span>
                </h2>
                {packagingTypes.rows.length ? (
                  <>
                    <div className="erp-stack">
                      {packagingTypes.rows.map((row, index) => (
                        <div key={`${row.packaging_type}-${index}`} className="erp-row-grid">
                          <span className="erp-rank">{index + 1}</span>
                          <span className="erp-strong">{row.packaging_type}</span>
                          <span>{row.qty.toLocaleString("nl-NL")}</span>
                          <span className="erp-strong">{pct(row.pct, 1)}</span>
                        </div>
                      ))}
                      <div className="erp-row-grid">
                        <span className="erp-rank">—</span>
                        <span className="erp-strong">Totaal</span>
                        <span>{packagingTypes.total.toLocaleString("nl-NL")}</span>
                        <span className="erp-strong">{pct(100, 0)}</span>
                      </div>
                    </div>
                    <Link href={"/beheer/productkoppeling" as Route} className="erp-link">
                      Beheer productkoppelingen <ArrowRight className="h-4 w-4" />
                    </Link>
                  </>
                ) : (
                  <EmptyState
                    title="Nog geen verpakkingstypen"
                    body="Koppel Douano producten aan SKU's en vul verpakkingstype in Beheer → Productkoppeling."
                    href="/beheer/productkoppeling"
                    hrefLabel="Naar productkoppeling"
                  />
                )}
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
                <h2 className="module-card-title">Marge per productgroep</h2>
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
                          <Tooltip formatter={(v) => euro(Number(v))} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="erp-stack">
                      {pieData.map((item) => (
                        <div key={item.name} className="erp-row-space-between">
                          <span>{item.name}</span>
                          <span className="erp-strong">{euro(item.value)}</span>
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
