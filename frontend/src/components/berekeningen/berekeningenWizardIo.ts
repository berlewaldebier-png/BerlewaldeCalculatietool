"use client";

import { ApiRequestError, apiRequestTextClient } from "@/lib/apiClient";
import type { GenericRecord } from "@/components/berekeningen/berekeningenWizardUtils";

export async function saveKostprijsversies(payload: GenericRecord[]) {
  await apiRequestTextClient("/data/kostprijsversies", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function activateKostprijsversie(versionId: string) {
  await apiRequestTextClient(`/data/kostprijsversies/${encodeURIComponent(versionId)}/activate`, {
    method: "POST",
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

