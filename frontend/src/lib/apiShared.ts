export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

export type NavigationItem = {
  key: string;
  label: string;
  description: string;
  href: string;
  section: string;
};

export type DashboardSummary = {
  concept_berekeningen: number;
  definitieve_berekeningen: number;
  concept_prijsvoorstellen: number;
  definitieve_prijsvoorstellen: number;
  klaar_om_te_activeren?: number;
  klaar_om_te_activeren_waarschuwing?: number;
  aflopende_offertes?: number;
  aflopende_offertes_items?: Array<{
    id: string;
    offertenummer: string;
    klantnaam: string;
    verloopt_op: string;
    status: string;
  }>;
};

export type AuthStatus = {
  environment?: string;
  enabled: boolean;
  mode: string;
  postgres_configured: boolean;
  storage_provider: string;
  user_count: number;
  has_admin: boolean;
};

export type AuthUser = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type MeResponse = {
  authenticated: boolean;
  username: string;
  display_name: string;
  role: string;
};

export type GenericRecord = Record<string, unknown>;

export type BootstrapResponse = {
  navigation?: NavigationItem[];
  datasets: Record<string, unknown>;
};

export type ErpDashboardAlertTone = "default" | "warning" | "error";

export type ErpDashboardAlert = {
  key: string;
  title: string;
  description: string;
  tone: ErpDashboardAlertTone;
  count?: number;
  href?: string;
};

export type ErpDashboardKpis = {
  total_revenue_ex: number;
  total_orders: number;
  average_order_value_ex: number;
  total_cost_ex: number;
  total_margin_ex: number;
  margin_pct: number;
  mapped_lines: number;
  missing_cost_lines: number;
};

export type ErpDashboardTopCustomerRow = {
  company_id: number;
  company_name: string;
  revenue_ex: number;
  margin_ex: number;
  margin_pct: number;
};

export type ErpDashboardOrderRow = {
  order_number: string;
  order_date: string;
  status: string;
  company_id: number;
  company_name: string;
  revenue_ex: number;
  cost_ex: number;
  missing_cost_lines: number;
};

export type ErpDashboardUnderBreakEvenRow = {
  order_number: string;
  company_name: string;
  margin_ex: number;
};

export type ErpDashboardRevenueTrendPoint = {
  date: string;
  revenue_ex: number;
  break_even_ex?: number;
};

export type ErpDashboardOrdersTrendPoint = {
  date: string;
  orders: number;
  aov_ex: number;
};

export type ErpDashboardPayload = {
  range: { basis: "order" | "invoice"; since: string; until: string };
  available_years?: number[];
  empty_reason?: string;
  kpis: ErpDashboardKpis | null;
  trends: { revenue: ErpDashboardRevenueTrendPoint[]; orders: ErpDashboardOrdersTrendPoint[] };
  tables: {
    top_customers: ErpDashboardTopCustomerRow[];
    latest_orders: ErpDashboardOrderRow[];
    under_break_even: ErpDashboardUnderBreakEvenRow[];
    product_groups: Array<{ group: string; margin_pct: number; margin_ex: number }>;
    packaging_types?: Array<{ packaging_type: string; qty: number }>;
  };
  break_even: { year: number; active_config: unknown | null };
  alerts: ErpDashboardAlert[];
};
