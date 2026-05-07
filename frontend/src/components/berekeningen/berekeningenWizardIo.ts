"use client";

import { ApiRequestError, apiGetClient, apiRequestTextClient } from "@/lib/apiClient";
import type { GenericRecord } from "@/components/berekeningen/berekeningenWizardUtils";

export async function saveKostprijsversies(payload: GenericRecord[]) {
  await apiRequestTextClient("/data/kostprijsversies", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function activateKostprijsversie(versionId: string, effectiveFrom?: string) {
  const effective_from = String(effectiveFrom ?? "").trim();
  await apiRequestTextClient(`/data/kostprijsversies/${encodeURIComponent(versionId)}/activate`, {
    method: "POST",
    ...(effective_from
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ effective_from }),
        }
      : {}),
  });
}

export async function loadSkus(): Promise<GenericRecord[]> {
  const result = await apiGetClient<{ data?: unknown }>(`/data/skus`);
  return Array.isArray(result?.data) ? (result.data as GenericRecord[]) : [];
}

export async function saveSkus(payload: GenericRecord[]) {
  await apiRequestTextClient("/data/skus", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function saveSkuClassification(skuId: string, payload: Record<string, unknown>) {
  await apiRequestTextClient(`/data/skus/${encodeURIComponent(skuId)}/classification`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function tryReadApiDetail(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "";
  try {
    const body = JSON.parse(error.bodyText || "{}") as { detail?: string };
    return typeof body?.detail === "string" ? body.detail : "";
  } catch {
    return "";
  }
}

