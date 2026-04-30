import Link from "next/link";

import { PageShell } from "@/components/PageShell";
import { DataTablePro } from "@/components/DataTablePro";
import type { QuoteDraftRecord } from "@/components/offerte-samenstellen/types";
import { getBootstrap, apiGetServer } from "@/lib/apiServer";

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
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
    minute: "2-digit"
  }).format(date);
}

function statusLabel(status: string) {
  return status === "definitief" ? "Definitief" : "Concept";
}

export default async function PrijsvoorstellenPage() {
  const [bootstrap, quotesResponse] = await Promise.all([
    getBootstrap([], true, "/prijsvoorstellen"),
    apiGetServer<{ items: QuoteDraftRecord[] }>("/quotes?limit=100", "/prijsvoorstellen")
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
              Start direct een nieuwe offerte in de CPQ builder. Je kiest producten, bouwt scenario&apos;s op en slaat
              het voorstel daarna op als concept.
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
            <DataTablePro<QuoteDraftRecord>
              rows={quotes}
              getRowKey={(row) => row.id}
              initialSortKey="updated_at"
              initialSortDir="desc"
              queryPlaceholder="Zoek offerte (nummer/titel/klant/kanaal)…"
              queryFilter={(row, q) => {
                const title = String(row.title || "").toLowerCase();
                const customer = String(row.customer_name || "").toLowerCase();
                const channel = String(row.channel_code || "").toLowerCase();
                const number = String(row.quote_number || "").toLowerCase();
                return title.includes(q) || customer.includes(q) || channel.includes(q) || number.includes(q);
              }}
              columns={[
                {
                  key: "quote_number",
                  header: "Offertenummer",
                  sortValue: (row) => String(row.quote_number || ""),
                  render: (row) => (
                    <div className="stack">
                      <strong>{row.quote_number}</strong>
                      <span className="muted">v{row.draft_version}</span>
                    </div>
                  )
                },
                {
                  key: "title",
                  header: "Titel",
                  sortValue: (row) => String(row.title || ""),
                  render: (row) => row.title || "—"
                },
                {
                  key: "customer_name",
                  header: "Klant",
                  sortValue: (row) => String(row.customer_name || ""),
                  render: (row) => row.customer_name || "—"
                },
                {
                  key: "channel_code",
                  header: "Kanaal",
                  sortValue: (row) => String(row.channel_code || ""),
                  render: (row) => row.channel_code || "—"
                },
                {
                  key: "status",
                  header: "Status",
                  sortValue: (row) => statusLabel(row.status),
                  render: (row) => <span className="pill">{statusLabel(row.status)}</span>
                },
                {
                  key: "valid_until",
                  header: "Geldig tot",
                  sortValue: (row) => String(row.valid_until || ""),
                  render: (row) => formatDate(row.valid_until)
                },
                {
                  key: "updated_at",
                  header: "Laatst bewerkt",
                  sortValue: (row) => String(row.updated_at || ""),
                  render: (row) => formatDateTime(row.updated_at)
                },
                {
                  key: "action",
                  header: "Actie",
                  render: (row) => (
                    <Link href={`/offerte-samenstellen?draft=${encodeURIComponent(row.id)}`} className="proposal-hub-link">
                      Openen
                    </Link>
                  )
                }
              ]}
            />
          )}
        </section>
      </div>
    </PageShell>
  );
}

