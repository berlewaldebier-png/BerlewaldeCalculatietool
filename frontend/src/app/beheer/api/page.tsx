import Link from "next/link";

import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
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

function formatDate(value?: string) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("nl-NL");
}

export default async function ApiIntegratiesPage() {
  const bootstrap = await getBootstrap(["auth-status"], true, "/beheer/api");
  const navigation = bootstrap.navigation ?? [];

  let douano: DouanoStatus | null = null;
  let douanoError = "";
  try {
    douano = await apiGetServer<DouanoStatus>("/integrations/douano/status", "/beheer/api");
  } catch (error) {
    douanoError = error instanceof Error ? error.message : "Kon Douano status niet laden.";
    douano = null;
  }

  const calls = [
    { name: "Connect", method: "GET", path: "/api/integrations/douano/connect", note: "Start OAuth2 authorization code flow." },
    { name: "Callback", method: "GET", path: "/api/integrations/douano/callback", note: "Ontvangt code en wisselt token(s) om." },
    { name: "Status", method: "GET", path: "/api/integrations/douano/status", note: "Toont verbinding en token-metadata (zonder tokens)." }
  ];

  const datasets = [
    { domain: "Klanten", endpoint: "Douano API (nog te bouwen)", matching: "Nog niet", output: "—" },
    { domain: "Verkoopfacturen", endpoint: "Douano API (nog te bouwen)", matching: "Nog niet", output: "—" },
    { domain: "Producten", endpoint: "Douano API (nog te bouwen)", matching: "Nog niet", output: "—" }
  ];

  return (
    <PageShell
      title="API integraties"
      subtitle="Status van koppelingen met externe systemen en hoe we data mappen naar de CalculatieTool."
      activePath="/beheer"
      navigation={navigation}
    >
      <SectionCard
        title="Douano"
        description="OAuth2 verbinding en basisinformatie. Tokens worden server-side opgeslagen in PostgreSQL."
      >
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
              <small>{douano?.base_url || "—"}</small>
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

      <SectionCard title="Gebruikte aanroepen" description="Dit zijn de interne endpoints die we gebruiken voor de Douano OAuth flow.">
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

      <SectionCard
        title="Data die we ophalen"
        description='Overzicht van de datasets die we (straks) uit Douano ophalen. "Matching" beschrijft of en hoe we Douano items koppelen aan onze producten/bieren.'
      >
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>Domein</th>
                <th>Bron</th>
                <th>Matching</th>
                <th>Output in app</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((row) => (
                <tr key={row.domain}>
                  <td>{row.domain}</td>
                  <td>{row.endpoint}</td>
                  <td>{row.matching}</td>
                  <td>{row.output}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </PageShell>
  );
}
