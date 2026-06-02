import { apiRequestTextClient } from "@/lib/apiClient";
import { reconcileDatasetItems } from "@/lib/datasetItems";

export async function putKostprijsversies(payload: unknown) {
  if (!Array.isArray(payload)) throw new Error("Kostprijsversies payload moet een lijst zijn.");
  return reconcileDatasetItems("kostprijsversies", payload as Array<Record<string, unknown>>);
}

export async function activateKostprijsversie(recordId: string, effectiveFrom?: string) {
  const effective_from = String(effectiveFrom ?? "").trim();
  return apiRequestTextClient(`/data/kostprijsversies/${encodeURIComponent(recordId)}/activate`, {
    method: "POST",
    ...(effective_from
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ effective_from }),
        }
      : {}),
  });
}

