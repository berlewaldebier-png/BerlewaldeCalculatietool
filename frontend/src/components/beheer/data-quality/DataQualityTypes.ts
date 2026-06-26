import type { ReactNode } from "react";

export type GenericRecord = Record<string, any>;

export type SetupCheck = {
  id: string;
  label: string;
  done: boolean;
  current: number;
  total: number;
  missing: GenericRecord[];
  group?: string;
  description?: string;
  href?: string;
};

export type SetupStatus = {
  year: number;
  can_complete: boolean;
  mode: string;
  summary: GenericRecord;
  checks: SetupCheck[];
};

export type WorkstreamKey = "overview" | "products" | "cost_sources" | "lots" | "exceptions" | "api" | "advanced";

export type WorkstreamDefinition = {
  id: WorkstreamKey;
  title: string;
  description: string;
};

export type RowActionRenderer = (row: GenericRecord, scopeRows: GenericRecord[]) => ReactNode;

export type SyncStateItem = {
  resource: string;
  last_success_at?: string;
  last_since_date?: string;
  last_error?: string;
  stats?: GenericRecord;
  updated_at?: string;
};
