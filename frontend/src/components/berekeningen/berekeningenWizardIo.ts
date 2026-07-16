"use client";

import { ApiRequestError, apiGetClient, apiRequestTextClient } from "@/lib/apiClient";
import { reconcileDatasetItems, saveDatasetItem } from "@/lib/datasetItems";
import type { GenericRecord } from "@/components/berekeningen/berekeningenWizardUtils";

export async function saveKostprijsversies(payload: GenericRecord[]) {
  await reconcileDatasetItems("kostprijsversies", payload);
}

type TargetedSaveOptions = {
  knownExisting?: boolean;
};

export async function saveKostprijsversie(
  payload: GenericRecord,
  options: TargetedSaveOptions = {}
): Promise<GenericRecord> {
  return saveDatasetItem("kostprijsversies", payload, options);
}

export async function saveBierRow(
  payload: GenericRecord,
  options: TargetedSaveOptions = {}
): Promise<GenericRecord> {
  try {
    return await saveDatasetItem("bieren", payload, options);
  } catch (error) {
    if (error instanceof Error && error.message === "API request mislukt") {
      throw new Error("Bierstamdata opslaan mislukt.");
    }
    throw error;
  }
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

export async function activateKostprijsversieProducts(versionId: string, productIds: string[]) {
  await apiRequestTextClient(`/data/kostprijsversies/${encodeURIComponent(versionId)}/activate-products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_ids: productIds }),
  });
}

export async function loadSkus(): Promise<GenericRecord[]> {
  const result = await apiGetClient<{ data?: unknown }>(`/data/skus`);
  return Array.isArray(result?.data) ? (result.data as GenericRecord[]) : [];
}

export async function loadArticles(): Promise<GenericRecord[]> {
  const result = await apiGetClient<{ data?: unknown }>(`/data/articles`);
  return Array.isArray(result?.data) ? (result.data as GenericRecord[]) : [];
}

export async function loadBomLines(): Promise<GenericRecord[]> {
  const result = await apiGetClient<{ data?: unknown }>(`/data/bom-lines`);
  return Array.isArray(result?.data) ? (result.data as GenericRecord[]) : [];
}

export async function saveSkus(payload: GenericRecord[]) {
  await reconcileDatasetItems("skus", payload);
}

export async function saveSkuClassification(skuId: string, payload: Record<string, unknown>) {
  await apiRequestTextClient(`/data/skus/${encodeURIComponent(skuId)}/classification`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export type DouanoProductMapping = {
  douano_product_id: number;
  sku_id: string;
  product_group?: string;
  alcohol_category?: string;
  packaging_type?: string;
  created_at?: string;
  updated_at?: string;
};

export async function loadDouanoProductMappings(limit = 10000): Promise<DouanoProductMapping[]> {
  const result = await apiGetClient<{ items?: unknown }>(
    `/integrations/douano/product-mappings?limit=${encodeURIComponent(String(limit))}`
  );
  return Array.isArray(result?.items) ? (result.items as DouanoProductMapping[]) : [];
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

