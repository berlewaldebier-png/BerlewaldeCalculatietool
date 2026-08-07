"use client";

import Link from "next/link";
import { ArrowLeft, CalendarPlus, LockKeyhole } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DataTablePro, type DataTableProColumn } from "@/components/DataTablePro";
import { HistoricalYearsetWizard } from "@/components/HistoricalYearsetWizard";
import { API_BASE_URL } from "@/lib/apiShared";


export type DossierTargets = {
  revenue: number;
  variable_cost: number;
  contribution: number;
  liters: number;
  units: number;
};

export type DossierPeriod = DossierTargets & { period: string };

export type DossierSku = {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  beer_name: string;
  sku_kind: string;
  subject_type: string;
  scope_classification: string;
  calculation_method: string;
  provenance_kind: string;
  provenance_source_year: number;
  primary_cost: number | null;
  packaging_cost: number | null;
  overhead_cost: number | null;
  excise_cost: number | null;
  cost_price: number | null;
  liters_per_unit: number | null;
  cost_required: boolean;
  cost_readiness_status: string;
  cost_blocker_codes: string[];
  list_price: number | null;
  price_readiness_status: string;
  price_blocker_codes: string[];
  planned_revenue: number;
  planned_units: number;
  planned_liters: number;
  source: {
    anchor_id: string;
    cost_version_id: string;
    cost_row_id: string;
    target_cost_row_id: string;
    target_price_id: string;
    cost_hash: string;
    price_hash: string;
  };
};

export type DossierEvent = {
  event_type: string;
  actor: string;
  reason: string;
  occurred_at: string;
};

export type YearsetDossierResponse = {
  version: string;
  status: "ready" | "missing";
  read_only: boolean;
  operational_year: number;
  reason_codes: string[];
  binding: null | {
    generation_id: string;
    generation_status: string;
    generation_revision: number;
    generation_validation_hash: string;
    run_id: string;
    run_status: string;
    manifest_hash: string;
    validation_hash: string;
    plan_id: string;
    plan_contract_hash: string;
  };
  summary: null | {
    sku_count: number;
    required_cost_count: number;
    ready_cost_count: number;
    price_count: number;
    channel_count: number;
    plan_sku_count: number;
  };
  plan: null | {
    source: string;
    source_record_id: string;
    immutable: boolean;
    targets: DossierTargets;
    period_allocations: DossierPeriod[];
  };
  sku_items: DossierSku[];
  channels: Array<{
    channel_code: string;
    advice_markup_pct: number | null;
    readiness_status: string;
    blocker_codes: string[];
    source_hash: string;
  }>;
  audit: null | {
    generation: {
      source_year: number;
      source_generation_id: string;
      cost_source_year: number;
      pricing_source_year: number;
      advice_source_year: number;
      created_at: string;
      activated_at: string;
      activated_by: string;
      superseded_at: string;
    };
    reconciliation: {
      planner_version: string;
      source_snapshot_hash: string;
      target_input_hash: string;
      created_by: string;
      created_at: string;
      approved_by: string;
      approved_at: string;
      activated_by: string;
      activated_at: string;
    };
    generation_events: DossierEvent[];
    reconciliation_events: DossierEvent[];
  };
};


const money = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const amount = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});


function formatMoney(value: number | null) {
  return value === null ? "—" : money.format(value);
}


function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("nl-NL", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}


function sourceLabel(value: string) {
  const labels: Record<string, string> = {
    new_year_preparation: "Nieuw jaar voorbereiden",
    source_anchor: "Actieve planningskostprijs bronjaar",
    year_transition: "Overgenomen en herberekend",
    target_operational_addition: "Toegevoegd in doeljaar",
    carried_forward: "Overgenomen uit bronjaar",
    sellable_without_anchor: "Verkoopbaar zonder kostprijsanker",
    catalog_reference_only: "Alleen catalogusreferentie",
  };
  return labels[value] || value || "Onbekend";
}


function productType(row: DossierSku) {
  if (row.subject_type === "beer") return "Bier-SKU";
  if (row.subject_type === "bundle") return "Samengesteld product";
  if (row.subject_type === "service") return "Dienst";
  if (row.subject_type === "article") return "Artikel";
  return row.sku_kind || "Product";
}


function readStatus(row: DossierSku) {
  if (!row.cost_required) return { text: "n.v.t.", className: "status-neutral" };
  if (row.cost_readiness_status !== "ready" || row.cost_price === null || row.cost_price <= 0) {
    return { text: "Kostprijs ontbreekt", className: "status-danger" };
  }
  return { text: "Vastgelegd", className: "status-ok" };
}


async function getDossier(year: number): Promise<YearsetDossierResponse> {
  const response = await fetch(
    `${API_BASE_URL}/meta/commercial-yearsets/${encodeURIComponent(String(year))}/dossier`,
    { credentials: "include", cache: "no-store" }
  );
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(
      String(payload?.detail || payload?.error || `Jaarset ophalen mislukt (${response.status}).`)
    );
  }
  return payload as YearsetDossierResponse;
}


function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="yearset-dossier-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}


export function YearsetDossier({ year }: { year: number }) {
  const [dossier, setDossier] = useState<YearsetDossierResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"overview" | "wizard">("overview");

  useEffect(() => {
    setView("overview");
    setLoading(true);
    setError("");
    void getDossier(year)
      .then(setDossier)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Jaarset ophalen mislukt."))
      .finally(() => setLoading(false));
  }, [year]);

  const columns = useMemo<Array<DataTableProColumn<DossierSku>>>(() => [
    {
      key: "sku",
      header: "SKU",
      sortValue: (row) => `${row.beer_name} ${row.sku_name}`,
      render: (row) => (
        <div>
          <strong>{row.sku_name}</strong>
          <div className="muted">{row.sku_code || row.sku_id}</div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortValue: productType,
      render: (row) => productType(row),
    },
    {
      key: "bron",
      header: "Bron",
      sortValue: (row) => `${row.provenance_source_year} ${row.provenance_kind}`,
      render: (row) => (
        <div>
          <span>{sourceLabel(row.provenance_kind)}</span>
          <div className="muted">{row.provenance_source_year || "—"} · {sourceLabel(row.calculation_method)}</div>
          <details className="yearset-dossier-source-details">
            <summary>Bron-ID&apos;s</summary>
            <code>anker: {row.source.anchor_id || "—"}</code>
            <code>kostprijsversie: {row.source.cost_version_id || "—"}</code>
            <code>doelregel: {row.source.target_cost_row_id || "—"}</code>
          </details>
        </div>
      ),
    },
    {
      key: "inkoop",
      header: "Inkoop",
      align: "right",
      sortValue: (row) => row.primary_cost ?? -1,
      render: (row) => formatMoney(row.primary_cost),
    },
    {
      key: "verpakking",
      header: "Verpakking",
      align: "right",
      sortValue: (row) => row.packaging_cost ?? -1,
      render: (row) => formatMoney(row.packaging_cost),
    },
    {
      key: "overhead",
      header: "Overhead",
      align: "right",
      sortValue: (row) => row.overhead_cost ?? -1,
      render: (row) => formatMoney(row.overhead_cost),
    },
    {
      key: "accijns",
      header: "Accijns",
      align: "right",
      sortValue: (row) => row.excise_cost ?? -1,
      render: (row) => formatMoney(row.excise_cost),
    },
    {
      key: "kostprijs",
      header: "Kostprijs",
      align: "right",
      sortValue: (row) => row.cost_price ?? -1,
      render: (row) => row.cost_required ? formatMoney(row.cost_price) : "n.v.t.",
    },
    {
      key: "sellin",
      header: "Verkoopprijs",
      align: "right",
      sortValue: (row) => row.list_price ?? -1,
      render: (row) => row.list_price === null ? "n.v.t." : formatMoney(row.list_price),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => readStatus(row).text,
      render: (row) => {
        const status = readStatus(row);
        return <span className={`status-pill ${status.className}`}>{status.text}</span>;
      },
    },
  ], []);

  if (loading) {
    return (
      <section className="module-card" aria-live="polite">
        <div className="placeholder-block">
          <strong>Jaarset wordt geladen</strong>
          De vastgelegde gegevens worden alleen-lezen opgehaald.
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="module-card">
        <div className="placeholder-block" role="alert">
          <strong>Jaarset kon niet worden geopend</strong>
          {error} Ga terug naar Jaarbeheer en probeer het opnieuw.
        </div>
        <div className="editor-actions">
          <div className="editor-actions-group">
            <Link className="editor-button editor-button-secondary" href="/beheer/jaarsets">
              <ArrowLeft size={16} aria-hidden="true" /> Terug naar Jaarbeheer
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (!dossier || dossier.status !== "ready" || !dossier.plan || !dossier.summary || !dossier.binding) {
    return (
      <section className="module-card">
        <div className="placeholder-block" role="status">
          <strong>Geen afgerond jaarsetdossier beschikbaar voor {year}</strong>
          De brondata zijn niet aangepast. Technische reden: {dossier?.reason_codes?.join(", ") || "onbekend"}.
        </div>
        <div className="editor-actions">
          <div className="editor-actions-group">
            <Link className="editor-button editor-button-secondary" href="/beheer/jaarsets">
              <ArrowLeft size={16} aria-hidden="true" /> Terug naar Jaarbeheer
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const { plan, summary, binding, audit } = dossier;

  return (
    <div className="yearset-dossier-shell">
      <section className="module-card">
        <div className="yearset-dossier-heading">
          <div>
            <div className="module-card-title">Jaarset {year}</div>
            <div className="module-card-text">
              Vastgelegd commercieel dossier. De bedragen en bronverwijzingen op deze pagina kunnen niet worden gewijzigd.
            </div>
          </div>
          <span className="status-pill status-ok">
            <LockKeyhole size={14} aria-hidden="true" /> Alleen-lezen
          </span>
        </div>
        <div className="editor-actions yearset-dossier-actions">
          <div className="editor-actions-group">
            <Link className="editor-button editor-button-secondary" href="/beheer/jaarsets">
              <ArrowLeft size={16} aria-hidden="true" /> Terug naar Jaarbeheer
            </Link>
          </div>
          <div className="editor-actions-group">
            {binding.generation_status === "active" ? (
              <Link
                className="editor-button editor-button-primary"
                href={`/nieuw-jaar-voorbereiden?source_year=${year}&target_year=${year + 1}` as any}
              >
                <CalendarPlus size={16} aria-hidden="true" /> Nieuw jaar voorbereiden
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="module-card yearset-dossier-view-toggle-card">
        <div className="yearset-dossier-view-toggle" role="tablist" aria-label="Weergave van Jaarset">
          <button
            type="button"
            role="tab"
            aria-selected={view === "overview"}
            className={`editor-button ${view === "overview" ? "editor-button-primary" : "editor-button-secondary"}`}
            onClick={() => setView("overview")}
          >
            Jaarsetoverzicht
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "wizard"}
            className={`editor-button ${view === "wizard" ? "editor-button-primary" : "editor-button-secondary"}`}
            onClick={() => setView("wizard")}
          >
            Wizardweergave
          </button>
        </div>
        <div className="module-card-text">
          {view === "overview"
            ? "Samenvatting van het definitieve dossier."
            : "De 14 oorspronkelijke stappen, gevuld vanuit uitsluitend bewaarde bronnen en zonder wijzigingsmogelijkheden."}
        </div>
      </section>

      {view === "wizard" ? (
        <HistoricalYearsetWizard dossier={dossier} onShowOverview={() => setView("overview")} />
      ) : (
        <>
      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Vastgelegd plan</div>
          <div className="module-card-text">
            Dezelfde onveranderlijke Plan-bron die Break-even voor {year} gebruikt. Actual en Forecast horen niet bij dit dossier.
          </div>
        </div>
        <div className="yearset-dossier-metrics">
          <Metric label="Planomzet" value={money.format(plan.targets.revenue)} detail="exclusief btw" />
          <Metric label="Variabele kosten" value={money.format(plan.targets.variable_cost)} detail="planbasis" />
          <Metric label="Contributie" value={money.format(plan.targets.contribution)} detail="omzet minus variabele kosten" />
          <Metric label="Volume" value={`${amount.format(plan.targets.liters)} liter`} detail={`${amount.format(plan.targets.units)} eenheden`} />
          <Metric label="SKU's" value={String(summary.sku_count)} detail={`${summary.ready_cost_count}/${summary.required_cost_count} vereiste kostprijzen gereed`} />
          <Metric label="Verkoopprijzen" value={String(summary.price_count)} detail={`${summary.channel_count} advieskanalen`} />
        </div>
      </section>

      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Plan per maand</div>
          <div className="module-card-text">Vastgelegde maandverdeling uit Nieuw jaar voorbereiden.</div>
        </div>
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th>Maand</th>
                <th style={{ textAlign: "right" }}>Omzet</th>
                <th style={{ textAlign: "right" }}>Variabele kosten</th>
                <th style={{ textAlign: "right" }}>Contributie</th>
                <th style={{ textAlign: "right" }}>Liter</th>
                <th style={{ textAlign: "right" }}>Eenheden</th>
              </tr>
            </thead>
            <tbody>
              {plan.period_allocations.map((row) => (
                <tr key={row.period}>
                  <td>{row.period}</td>
                  <td style={{ textAlign: "right" }}>{money.format(row.revenue)}</td>
                  <td style={{ textAlign: "right" }}>{money.format(row.variable_cost)}</td>
                  <td style={{ textAlign: "right" }}>{money.format(row.contribution)}</td>
                  <td style={{ textAlign: "right" }}>{amount.format(row.liters)}</td>
                  <td style={{ textAlign: "right" }}>{amount.format(row.units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Vastgelegde SKU&apos;s en prijzen</div>
          <div className="module-card-text">
            Eén regel per stabiele SKU uit generatie {binding.generation_id}. “n.v.t.” betekent dat een kostprijs volgens het vastgelegde beleid niet vereist is.
          </div>
        </div>
        <DataTablePro
          rows={dossier.sku_items}
          columns={columns}
          getRowKey={(row) => row.sku_id}
          initialSortKey="sku"
          initialSortDir="asc"
          initialPageSize={50}
          pageSizeOptions={[20, 50, 100]}
          maxPageSize={500}
          query={query}
          onQueryChange={setQuery}
          queryPlaceholder="Zoek op bier, SKU, code of bron…"
          queryFilter={(row, normalizedQuery) =>
            `${row.beer_name} ${row.sku_name} ${row.sku_code} ${row.sku_id} ${row.provenance_kind} ${row.calculation_method}`
              .toLocaleLowerCase("nl-NL")
              .includes(normalizedQuery)
          }
          footerLeft={`${dossier.sku_items.length} vastgelegde SKU's`}
        />
      </section>

      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Adviesprijsbeleid</div>
          <div className="module-card-text">Vastgelegde opslagpercentages per kanaal.</div>
        </div>
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th>Kanaal</th>
                <th style={{ textAlign: "right" }}>Opslag</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {dossier.channels.map((channel) => (
                <tr key={channel.channel_code}>
                  <td>{channel.channel_code}</td>
                  <td style={{ textAlign: "right" }}>
                    {channel.advice_markup_pct === null ? "—" : `${amount.format(channel.advice_markup_pct)}%`}
                  </td>
                  <td>
                    <span className={`status-pill ${channel.readiness_status === "ready" ? "status-ok" : "status-danger"}`}>
                      {channel.readiness_status === "ready" ? "Vastgelegd" : "Niet gereed"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Herkomst en controle</div>
          <div className="module-card-text">Technische sleutels maken later exact herleidbaar welke generatie en bronwaarden zijn gelezen.</div>
        </div>
        <dl className="yearset-dossier-audit-grid">
          <div><dt>Generatie</dt><dd><code>{binding.generation_id}</code></dd></div>
          <div><dt>Reconciliatierun</dt><dd><code>{binding.run_id}</code></dd></div>
          <div><dt>Plan</dt><dd><code>{binding.plan_id}</code></dd></div>
          <div><dt>Bronjaar</dt><dd>{audit?.generation.source_year || "—"}</dd></div>
          <div><dt>Geactiveerd</dt><dd>{formatDate(audit?.generation.activated_at || "")}</dd></div>
          <div><dt>Geactiveerd door</dt><dd>{audit?.generation.activated_by || "—"}</dd></div>
          <div><dt>Planbron</dt><dd>{sourceLabel(plan.source)}</dd></div>
          <div><dt>Contractversie</dt><dd>{dossier.version}</dd></div>
        </dl>
        <details className="yearset-dossier-audit-details">
          <summary>Hashes en gebeurtenissen tonen</summary>
          <dl className="yearset-dossier-audit-grid">
            <div><dt>Manifest-hash</dt><dd><code>{binding.manifest_hash}</code></dd></div>
            <div><dt>Validatie-hash</dt><dd><code>{binding.validation_hash}</code></dd></div>
            <div><dt>Plan-hash</dt><dd><code>{binding.plan_contract_hash}</code></dd></div>
            <div><dt>Bron-snapshot</dt><dd><code>{audit?.reconciliation.source_snapshot_hash || "—"}</code></dd></div>
          </dl>
          <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
            <table className="dataset-editor-table">
              <thead><tr><th>Gebeurtenis</th><th>Door</th><th>Datum</th><th>Reden</th></tr></thead>
              <tbody>
                {[...(audit?.generation_events || []), ...(audit?.reconciliation_events || [])].map((event, index) => (
                  <tr key={`${event.event_type}:${event.occurred_at}:${index}`}>
                    <td>{event.event_type}</td>
                    <td>{event.actor || "—"}</td>
                    <td>{formatDate(event.occurred_at)}</td>
                    <td>{event.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
        </>
      )}
    </div>
  );
}
