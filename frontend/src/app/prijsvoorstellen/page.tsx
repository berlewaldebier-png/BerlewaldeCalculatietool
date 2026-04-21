import Link from "next/link";

import { PageShell } from "@/components/PageShell";
import type { QuoteDraftRecord } from "@/components/offerte-samenstellen/types";
import { getBootstrap, apiGetServer } from "@/lib/apiServer";


function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusLabel(status: string) {
  return status === "definitief" ? "Definitief" : "Concept";
}

export default async function PrijsvoorstellenPage() {
  const [bootstrap, quotesResponse] = await Promise.all([
    getBootstrap([], true, "/prijsvoorstellen"),
    apiGetServer<{ items: QuoteDraftRecord[] }>("/quotes?limit=100", "/prijsvoorstellen"),
  ]);

  const navigation = bootstrap.navigation ?? [];
  const quotes = Array.isArray(quotesResponse.items) ? quotesResponse.items : [];

  return (
    <PageShell
      title="Prijsvoorstellen"
      subtitle="Start een nieuw prijsvoorstel of werk een bestaand voorstel verder uit."
      activePath="/prijsvoorstellen"
      navigation={navigation}
    >
      <div className="proposal-hub-stack">
        <section className="module-card proposal-hub-hero">
          <div className="proposal-hub-hero-copy">
            <div className="module-card-title">Nieuw prijsvoorstel</div>
            <div className="module-card-text">
              Start direct een nieuwe offerte in de CPQ builder. Je kiest producten,
              bouwt scenario&apos;s op en slaat het voorstel daarna op als concept.
            </div>
          </div>
          <div className="proposal-hub-hero-actions">
            <Link href="/offerte-samenstellen" className="cpq-button cpq-button-primary">
              Nieuw prijsvoorstel starten
            </Link>
          </div>
        </section>

        <section className="module-card">
          <div className="module-card-header proposal-hub-header">
            <div>
              <div className="module-card-title">Bestaande offertes</div>
              <div className="module-card-text">
                Open een bestaand concept of definitief voorstel en werk verder vanuit dezelfde builder.
              </div>
            </div>
            <div className="pill">{quotes.length} offertes</div>
          </div>

          {quotes.length === 0 ? (
            <div className="placeholder-block">
              <strong>Nog geen offertes opgeslagen</strong>
              Zodra je een prijsvoorstel opslaat, verschijnt het hier in het overzicht.
            </div>
          ) : (
            <div className="data-table">
              <table>
                <thead>
                  <tr>
                    <th>Offertenummer</th>
                    <th>Titel</th>
                    <th>Klant</th>
                    <th>Kanaal</th>
                    <th>Status</th>
                    <th>Geldig tot</th>
                    <th>Laatst bewerkt</th>
                    <th>Actie</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id}>
                      <td>
                        <div className="stack">
                          <strong>{quote.quote_number}</strong>
                          <span className="muted">v{quote.draft_version}</span>
                        </div>
                      </td>
                      <td>{quote.title || "—"}</td>
                      <td>{quote.customer_name || "—"}</td>
                      <td>{quote.channel_code || "—"}</td>
                      <td>
                        <span className="pill">{statusLabel(quote.status)}</span>
                      </td>
                      <td>{formatDate(quote.valid_until)}</td>
                      <td>{formatDateTime(quote.updated_at)}</td>
                      <td>
                        <Link
                          href={`/offerte-samenstellen?draft=${encodeURIComponent(quote.id)}`}
                          className="proposal-hub-link"
                        >
                          Openen
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
