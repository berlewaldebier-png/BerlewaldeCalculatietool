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
