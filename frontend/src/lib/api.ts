export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";

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
};

export type AuthStatus = {
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

export type GenericRecord = Record<string, unknown>;

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${path}`);
  }

  return (await response.json()) as T;
}

export function getNavigation() {
  return apiGet<NavigationItem[]>("/meta/navigation");
}

export function getDashboardSummary() {
  return apiGet<DashboardSummary>("/meta/dashboard-summary");
}

export function getAuthStatus() {
  return apiGet<AuthStatus>("/auth/status");
}

export function getAuthUsers() {
  return apiGet<AuthUser[]>("/auth/users");
}

export function getProductie() {
  return apiGet<Record<string, GenericRecord>>("/data/productie");
}

export function getVasteKosten() {
  return apiGet<Record<string, GenericRecord[]>>("/data/vaste-kosten");
}

export function getTarievenHeffingen() {
  return apiGet<GenericRecord[]>("/data/tarieven-heffingen");
}

export function getVerpakkingsonderdelen() {
  return apiGet<GenericRecord[]>("/data/verpakkingsonderdelen");
}

export function getBasisproducten() {
  return apiGet<GenericRecord[]>("/data/basisproducten");
}

export function getSamengesteldeProducten() {
  return apiGet<GenericRecord[]>("/data/samengestelde-producten");
}

export function getBieren() {
  return apiGet<GenericRecord[]>("/data/bieren");
}

export function getBerekeningen() {
  return apiGet<GenericRecord[]>("/data/berekeningen");
}

export function getPrijsvoorstellen() {
  return apiGet<GenericRecord[]>("/data/prijsvoorstellen");
}

export function getVerkoopprijzen() {
  return apiGet<GenericRecord[]>("/data/verkoopprijzen");
}

export function getVariabeleKosten() {
  return apiGet<Record<string, unknown>>("/data/variabele-kosten");
}

export function getDataset(name: string) {
  return apiGet<GenericRecord[]>(`/data/dataset/${name}`);
}
