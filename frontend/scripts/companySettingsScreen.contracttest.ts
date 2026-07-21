import path from "node:path";

type ScreenModelModule = typeof import("../src/features/company-settings/companySettingsScreenModel");
type FormModelModule = typeof import("../src/features/company-settings/companySettingsFormModel");
type ApiClientModule = typeof import("../src/lib/apiClient");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function installAtAliasResolverForCompiledTests() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require("module") as any;
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options: unknown) {
    if (typeof request === "string" && request.startsWith("@/")) {
      const compiledRoot = path.resolve(__dirname, "..");
      const mapped = path.join(compiledRoot, "src", request.slice(2));
      return originalResolveFilename.call(this, mapped, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}

function run() {
  installAtAliasResolverForCompiledTests();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildCompanySettingsScreenModel } = require("../src/features/company-settings/companySettingsScreenModel") as ScreenModelModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    APPLICATION_SETTINGS_PENDING_STATUS,
    APPLICATION_SETTINGS_SUCCESS_STATUS,
    applicationSettingsSaveErrorStatus,
    buildApplicationSettingsPayload,
    createCompanySettingsDraft,
  } = require("../src/features/company-settings/companySettingsFormModel") as FormModelModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ApiRequestError } = require("../src/lib/apiClient") as ApiClientModule;

  const model = buildCompanySettingsScreenModel({
    navigation: [{ key: "settings", label: "Instellingen", description: "", href: "/instellingen", section: "Beheer" }],
    datasets: {
      "application-settings": {
        company_name: "Brouwerij Test",
        currency: "USD",
        support_email: "support@example.test",
        retained_compatibility_field: "keep-me",
      },
      "tarieven-heffingen": [
        { jaar: 2025, tarief_hoog: "21", tarief_laag: "9", verbruikersbelasting: "1.5" },
        { jaar: 0, tarief_hoog: 99, tarief_laag: 99, verbruikersbelasting: 99 },
        { jaar: 2026, tarief_hoog: "22", tarief_laag: "10", verbruikersbelasting: "2.5" },
      ],
    },
  });

  assert(model.navigation.length === 1, "Company-settings navigation projection changed.");
  assert(model.settings.company_name === "Brouwerij Test", "Application settings changed during screen projection.");
  assert(
    model.settings.retained_compatibility_field === "keep-me",
    "Unknown application-settings fields were removed during screen projection."
  );
  assert(model.latestTariff?.jaar === 2026, "The newest positive tariff year is no longer selected.");
  assert(model.latestTariff.tarief_hoog === 22, "High tariff numeric coercion changed.");
  assert(model.latestTariff.tarief_laag === 10, "Low tariff numeric coercion changed.");
  assert(model.latestTariff.verbruikersbelasting === 2.5, "Consumer-tax numeric coercion changed.");

  const emptyTariffModel = buildCompanySettingsScreenModel({ datasets: {} });
  assert(emptyTariffModel.latestTariff === null, "Missing tariffs no longer produce the existing empty state.");
  assert(Object.keys(emptyTariffModel.settings).length === 0, "Missing settings no longer produce an empty object.");

  const initialized = createCompanySettingsDraft({ company_name: "", support_email: "" });
  assert(initialized.companyName === "Berlewalde Brouwerij", "Blank company-name default changed.");
  assert(initialized.supportEmail === "info@berlewaldebier.nl", "Blank support-email default changed.");

  const payload = buildApplicationSettingsPayload(
    {
      company_name: "Old",
      currency: "USD",
      support_email: "old@example.test",
      retained_compatibility_field: "keep-me",
    },
    { companyName: "  New name  ", supportEmail: "  new@example.test  " }
  );
  assert(payload.company_name === "New name", "Company-name trimming changed.");
  assert(payload.support_email === "new@example.test", "Support-email trimming changed.");
  assert(payload.currency === "EUR", "The fixed EUR currency policy changed.");
  assert(payload.retained_compatibility_field === "keep-me", "Unknown settings fields were removed from the PUT payload.");

  const blankPayload = buildApplicationSettingsPayload(
    { retained_compatibility_field: "keep-me" },
    { companyName: "   ", supportEmail: "   " }
  );
  assert(blankPayload.company_name === "Berlewalde Brouwerij", "Whitespace company-name fallback changed.");
  assert(blankPayload.support_email === "info@berlewaldebier.nl", "Whitespace support-email fallback changed.");

  assert(
    APPLICATION_SETTINGS_PENDING_STATUS.message === "Bedrijfsinstellingen worden opgeslagen.",
    "Pending save feedback changed."
  );
  assert(
    APPLICATION_SETTINGS_SUCCESS_STATUS.message === "Bedrijfsinstellingen zijn opgeslagen.",
    "Successful save feedback changed."
  );

  const validationFailure = applicationSettingsSaveErrorStatus(new ApiRequestError({
    status: 422,
    path: "/data/application-settings",
    bodyText: "",
  }));
  assert(
    validationFailure.message === "Bedrijfsinstellingen zijn niet opgeslagen.",
    "Known client/validation failure feedback changed."
  );
  assert(
    validationFailure.guidance === "Controleer de bedrijfsgegevens en probeer opnieuw.",
    "Known client/validation recovery guidance changed."
  );

  const serverFailure = applicationSettingsSaveErrorStatus(new ApiRequestError({
    status: 500,
    path: "/data/application-settings",
    bodyText: "",
  }));
  assert(serverFailure.message === "Opslaan kon niet worden bevestigd.", "Uncertain save feedback changed.");
  assert(
    serverFailure.guidance?.includes("kunnen al zijn opgeslagen") === true,
    "Uncertain save recovery guidance changed."
  );

  const networkFailure = applicationSettingsSaveErrorStatus(new TypeError("Failed to fetch"));
  assert(networkFailure.message === serverFailure.message, "Network uncertainty is no longer reported conservatively.");
}

try {
  run();
  console.log("companySettingsScreen contracttest OK (SCREEN-029)");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
