import Link from "next/link";

import { DataQualityIntegrationWorkspace } from "@/components/beheer/DataQualityIntegrationWorkspace";
import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { OrsDistanceRunner } from "@/components/instellingen/OrsDistanceRunner";
import { CompanyDistanceOverview } from "@/components/beheer/CompanyDistanceOverview";
import { CostpriceModelWorkspace } from "@/components/kostprijs-model/CostpriceModelWorkspace";
import { apiGetServer, getBootstrap } from "@/lib/apiServer";

type DouanoStatus = {
  connected: boolean;
  provider?: string;
  base_url?: string;
  scope?: string;
  token_type?: string;
  expires_at?: string;
  created_at?: string;
  updated_at?: string;
};

type SearchParams = Record<string, string | string[] | undefined>;

function formatDate(value?: string) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("nl-NL");
}

export default async function ApiIntegratiesPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const resolved = searchParams ? await searchParams : {};
  const yearRaw = typeof resolved.year === "string" ? resolved.year : "";
  const bootstrap = await getBootstrap(["auth-status", "skus", "articles", "productie"], true, "/beheer/api");
  const navigation = bootstrap.navigation ?? [];
  const skus = (bootstrap.datasets["skus"] as any[]) ?? [];
  const articles = (bootstrap.datasets["articles"] as any[]) ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const currentYear = new Date().getFullYear();
  const productionYears = Object.keys(productie ?? {})
    .map((key) => Number(key))
    .filter((year) => Number.isFinite(year) && year > 0)
    .sort((a, b) => a - b);
  const defaultYear = productionYears.includes(currentYear)
    ? currentYear
    : productionYears.filter((year) => year < currentYear).at(-1) ?? productionYears.at(-1) ?? currentYear;
  const statusYear = Number(yearRaw) || defaultYear;

  let douano: DouanoStatus | null = null;
  let douanoError = "";
  try {
    douano = await apiGetServer<DouanoStatus>("/integrations/douano/status", "/beheer/api");
  } catch (error) {
    douanoError = error instanceof Error ? error.message : "Kon Douano status niet laden.";
    douano = null;
  }

  const setupStatusPayload = await apiGetServer<{ result: any }>(
    `/meta/setup/status?year=${encodeURIComponent(String(statusYear))}`,
    "/beheer/api"
  );

  const calls = [
    { name: "Connect", method: "GET", path: "/api/integrations/douano/connect", note: "Start OAuth2 authorization code flow." },
    { name: "Callback", method: "GET", path: "/api/integrations/douano/callback", note: "Ontvangt code en wisselt token(s) om." },
    { name: "Status", method: "GET", path: "/api/integrations/douano/status", note: "Toont verbinding en token-metadata (zonder tokens)." },
    { name: "Companies (discover)", method: "GET", path: "/api/integrations/douano/discover-companies", note: "Probeert bekende paden om customers endpoint te vinden." },
    { name: "HTTP debug", method: "GET", path: "/api/integrations/douano/debug?path=/api", note: "Debug helper om te zien of je een HTML pagina of API JSON raakt." },
  ];

  return (
    <PageShell
      title="Datakwaliteit & integratie"
      subtitle="Werkvoorraad voor Douano data, productkoppelingen, LOT-dekking en kostprijsbronnen."
      activePath="/beheer"
      navigation={navigation}
    >
      <DataQualityIntegrationWorkspace
        initialStatus={setupStatusPayload.result}
        skus={skus}
        articles={articles}
        advanced={
          <>
            <SectionCard title="Douano verbinding" description="OAuth2 verbinding en basisinformatie. Tokens worden server-side opgeslagen in PostgreSQL.">
              <div className="record-card-grid">
                <div className="wizard-toggle-card">
                  <span>
                    <strong>Status</strong>
                    <small>{douanoError ? "Fout" : douano?.connected ? "Verbonden" : "Niet verbonden"}</small>
                  </span>
                </div>
                <div className="wizard-toggle-card">
                  <span>
                    <strong>Base URL</strong>
                    <small>{douano?.base_url || "-"}</small>
                  </span>
                </div>
                <div className="wizard-toggle-card">
                  <span>
                    <strong>Token geldig tot</strong>
                    <small>{formatDate(douano?.expires_at)}</small>
                  </span>
                </div>
                <div className="wizard-toggle-card">
                  <span>
                    <strong>Laatst bijgewerkt</strong>
                    <small>{formatDate(douano?.updated_at)}</small>
                  </span>
                </div>
              </div>

              {douanoError ? (
                <div className="placeholder-block">
                  <strong>Douano status niet beschikbaar</strong>
                  {douanoError}
                </div>
              ) : null}

              <div className="editor-actions" style={{ marginTop: 16 }}>
                <div className="editor-actions-group">
                  <Link href="/api/integrations/douano/connect" className="editor-button">
                    {douano?.connected ? "Opnieuw koppelen" : "Koppelen"}
                  </Link>
                  <Link href="/api/integrations/douano/status" className="editor-button editor-button-secondary">
                    Bekijk status JSON
                  </Link>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="OpenRouteService (ORS) afstanden"
              description="Bereken rijafstanden naar klanten (km enkele reis) op basis van Douano invoice-adres. Dit gebruikt ORS geocoding + routing en cached resultaten."
            >
              <OrsDistanceRunner defaultExcludeParticulier />
              <CompanyDistanceOverview />
              <div className="placeholder-block" style={{ marginTop: 12 }}>
                <strong>Configuratie</strong>
                <div className="muted">
                  Vereist backend env var <code>CALCULATIETOOL_ORS_API_KEY</code> (optioneel <code>CALCULATIETOOL_ORS_BASE_URL</code>).
                </div>
              </div>
            </SectionCard>

            <CostpriceModelWorkspace />

            <SectionCard title="Gebruikte aanroepen" description="Interne endpoints voor de Douano OAuth flow en technische diagnose.">
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>Naam</th>
                      <th>Methode</th>
                      <th>Endpoint</th>
                      <th>Doel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calls.map((row) => (
                      <tr key={row.path}>
                        <td>{row.name}</td>
                        <td>
                          <span className="pill">{row.method}</span>
                        </td>
                        <td>
                          <code>{row.path}</code>
                        </td>
                        <td>{row.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </>
        }
      />
    </PageShell>
  );
}

