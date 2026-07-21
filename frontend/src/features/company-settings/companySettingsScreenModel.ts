import type { ApplicationSettings } from "../../components/instellingen/applicationSettingsApi";
import type { BootstrapResponse, NavigationItem } from "../../lib/apiShared";

export type CompanySettingsDatasets = Record<string, unknown> & {
  "application-settings"?: ApplicationSettings;
  "tarieven-heffingen"?: unknown[];
};

export type LatestTariffSummary = {
  jaar: number;
  tarief_hoog: number;
  tarief_laag: number;
  verbruikersbelasting: number;
};

export type CompanySettingsScreenModel = {
  navigation: NavigationItem[];
  settings: ApplicationSettings;
  latestTariff: LatestTariffSummary | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function buildCompanySettingsScreenModel(
  bootstrap: BootstrapResponse<CompanySettingsDatasets>
): CompanySettingsScreenModel {
  const settings = asRecord(bootstrap.datasets["application-settings"]) ?? {};
  const tariffs = (bootstrap.datasets["tarieven-heffingen"] ?? [])
    .map((value) => asRecord(value))
    .filter((value): value is Record<string, unknown> => value !== null)
    .map((row) => ({
      jaar: Number(row.jaar ?? 0),
      tarief_hoog: Number(row.tarief_hoog ?? 0),
      tarief_laag: Number(row.tarief_laag ?? 0),
      verbruikersbelasting: Number(row.verbruikersbelasting ?? 0),
    }))
    .filter((row) => row.jaar > 0)
    .sort((left, right) => right.jaar - left.jaar);

  return {
    navigation: bootstrap.navigation ?? [],
    settings,
    latestTariff: tariffs[0] ?? null,
  };
}
