import { apiRequestTextClient } from "@/lib/apiClient";

export async function putKostprijsversies(payload: unknown) {
  return apiRequestTextClient("/data/kostprijsversies", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function activateKostprijsversie(recordId: string) {
  return apiRequestTextClient(`/data/kostprijsversies/${encodeURIComponent(recordId)}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

