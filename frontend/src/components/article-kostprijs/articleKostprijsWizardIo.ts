import { apiRequestTextClient } from "@/lib/apiClient";

export async function putKostprijsversies(payload: unknown) {
  return apiRequestTextClient("/data/kostprijsversies", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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

