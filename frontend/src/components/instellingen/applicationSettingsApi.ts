import { apiRequestClient, apiRequestJsonClient } from "@/lib/apiClient";

export type ApplicationSettings = {
  company_name?: string;
  currency?: string;
  support_email?: string;
  [key: string]: unknown;
};

type ApplicationSettingsResponse = ApplicationSettings & {
  data?: ApplicationSettings;
};

const APPLICATION_SETTINGS_PATH = "/data/application-settings";

export async function loadApplicationSettings(): Promise<ApplicationSettings> {
  const payload = await apiRequestJsonClient<ApplicationSettingsResponse>(APPLICATION_SETTINGS_PATH, {
    cache: "no-store"
  });
  return payload.data && typeof payload.data === "object" ? payload.data : payload;
}

export async function saveApplicationSettings(payload: ApplicationSettings): Promise<void> {
  await apiRequestClient(APPLICATION_SETTINGS_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
