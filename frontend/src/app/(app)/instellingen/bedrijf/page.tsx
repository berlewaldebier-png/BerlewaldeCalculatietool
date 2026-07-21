import { CompanySettingsScreen } from "@/features/company-settings/CompanySettingsScreen";
import {
  buildCompanySettingsScreenModel,
  type CompanySettingsDatasets,
} from "@/features/company-settings/companySettingsScreenModel";
import { getBootstrap } from "@/lib/apiServer";

export default async function BedrijfsinstellingenPage() {
  const bootstrap = await getBootstrap<CompanySettingsDatasets>(
    ["application-settings", "tarieven-heffingen"],
    true,
    "/instellingen/bedrijf"
  );

  return <CompanySettingsScreen model={buildCompanySettingsScreenModel(bootstrap)} />;
}
