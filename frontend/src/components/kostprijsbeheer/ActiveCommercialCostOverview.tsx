"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type RefObject } from "react";

import { API_BASE_URL } from "@/lib/api";
import { ActionStatus } from "@/components/ActionStatus";
import { SortButton } from "@/components/table/TableControls";


type CostState = "ready" | "missing_cost" | "not_activated" | "not_applicable";

type ActiveCommercialCostItem = {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  beer_name: string;
  subject_type: string;
  scope_classification: string;
  calculation_method: string;
  cost_method: string;
  provenance_kind: string;
  provenance_source_year: number;
  primary_cost: number | null;
  packaging_cost: number | null;
  overhead_cost: number | null;
  excise_cost: number | null;
  cost_price: number | null;
  cost_state: CostState;
  cost_blocker_codes: string[];
  display_priority: number;
};

type ActiveCommercialCostGroup = {
  key: string;
  label: string;
  kind: string;
  priority: number;
  items: ActiveCommercialCostItem[];
};

type ActiveCommercialCostOverviewResponse = {
  version: string;
  status: "ready" | "missing";
  read_only: boolean;
  binding: null | {
    generation_id: string;
    run_id: string;
    operational_year: number;
    manifest_hash: string;
    validation_hash: string;
  };
  groups: ActiveCommercialCostGroup[];
  summary: {
    sku_count: number;
    group_count: number;
    ready_count: number;
    missing_cost_count: number;
    not_activated_count: number;
    not_applicable_count: number;
  };
  shadow_parity: null | {
    status: "match" | "different";
    generation_sku_count: number;
    legacy_activation_sku_count: number;
    shared_sku_count: number;
    only_generation_count: number;
    only_legacy_count: number;
  };
  reason_codes: string[];
};

type SortKey = "sku" | "method" | "cost";
type SortState = { key: SortKey; direction: "asc" | "desc" };


const money = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});


function methodLabel(value: string) {
  const labels: Record<string, string> = {
    purchase: "Inkoop",
    inkoop: "Inkoop",
    production: "Eigen productie",
    productie: "Eigen productie",
    "eigen productie": "Eigen productie",
    derived: "Afgeleid",
    composed: "Zelf samengesteld",
    year_transition: "Jaarovergang",
    bundle: "Zelf samengesteld",
    article: "Artikelkostprijs",
  };
  return labels[value] || value || "Onbekend";
}


function provenanceLabel(kind: string, sourceYear: number) {
  const year = sourceYear > 0 ? ` uit ${sourceYear}` : "";
  const labels: Record<string, string> = {
    source_anchor: `Actieve planningskostprijs${year}`,
    recalculated_from_source_year: `Overgenomen en herberekend${year}`,
    recovered_from_exact_target_anchor: "Hersteld uit exact vastgelegd doeljaaranker",
    target_operational_addition: "Toegevoegd in het actieve jaar",
    catalog_reference: "Alleen catalogusreferentie",
  };
  return labels[kind] || kind || "Herkomst onbekend";
}


function typeLabel(value: string) {
  const labels: Record<string, string> = {
    beer: "Bier-SKU",
    bundle: "Samengesteld product",
    service: "Dienst",
    article: "Artikel",
  };
  return labels[value] || value || "Product";
}


function costStateView(row: ActiveCommercialCostItem) {
  if (row.cost_state === "not_applicable") {
    return { label: "n.v.t.", className: "status-pill status-neutral", detail: "Voor dit product is geen kostprijs vereist." };
  }
  if (row.cost_state === "not_activated") {
    return { label: "Niet geactiveerd", className: "status-pill status-warning", detail: "De SKU bestaat, maar hoort niet bij de actieve jaarset." };
  }
  if (row.cost_state === "missing_cost") {
    return { label: "Kostprijs ontbreekt", className: "status-pill status-danger", detail: "Controleer de SKU in de actieve jaarset voordat je deze gebruikt." };
  }
  return { label: row.cost_price === null ? "—" : money.format(row.cost_price), className: "status-pill status-ok", detail: "Vastgelegd in de actieve commerciële jaarset." };
}


async function fetchOverview(): Promise<ActiveCommercialCostOverviewResponse> {
  const response = await fetch(`${API_BASE_URL}/meta/commercial-yearsets/active/cost-overview`, {
    credentials: "include",
    cache: "no-store",
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Actieve kostprijzen ophalen mislukt (${response.status}).`));
  }
  return payload as ActiveCommercialCostOverviewResponse;
}


export function ActiveCommercialCostOverview({
  activeCostsRef,
  onOperationalYear,
}: {
  activeCostsRef: RefObject<HTMLDivElement | null>;
  onOperationalYear?: (year: number) => void;
}) {
  const [payload, setPayload] = useState<ActiveCommercialCostOverviewResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<SortState>({ key: "sku", direction: "asc" });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchOverview()
      .then((next) => {
        if (cancelled) return;
        setPayload(next);
        const year = Number(next.binding?.operational_year || 0);
        if (year > 0) onOperationalYear?.(year);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setPayload(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onOperationalYear, reloadKey]);

  const groups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("nl-NL");
    const direction = sort.direction === "asc" ? 1 : -1;
    return (payload?.groups || [])
      .map((group) => {
        const items = group.items
          .filter((row) => {
            if (!query) return true;
            return `${group.label} ${row.sku_name} ${row.sku_code} ${row.subject_type} ${row.cost_method} ${row.provenance_kind}`
              .toLocaleLowerCase("nl-NL")
              .includes(query);
          })
          .sort((a, b) => {
            if (sort.key === "cost") {
              const left = a.cost_state === "ready" && a.cost_price !== null ? a.cost_price : Number.NEGATIVE_INFINITY;
              const right = b.cost_state === "ready" && b.cost_price !== null ? b.cost_price : Number.NEGATIVE_INFINITY;
              const delta = (left - right) * direction;
              if (delta !== 0) return delta;
            } else if (sort.key === "method") {
              const delta = methodLabel(a.cost_method).localeCompare(methodLabel(b.cost_method), "nl-NL") * direction;
              if (delta !== 0) return delta;
            } else {
              const priorityDelta = (a.display_priority - b.display_priority) * direction;
              if (priorityDelta !== 0) return priorityDelta;
              const delta = a.sku_name.localeCompare(b.sku_name, "nl-NL") * direction;
              if (delta !== 0) return delta;
            }
            return a.sku_id.localeCompare(b.sku_id) * direction;
          });
        return { ...group, items };
      })
      .filter((group) => group.items.length > 0);
  }, [payload, search, sort]);

  const allOpen = useMemo(() => Object.fromEntries(groups.map((group) => [group.key, true])), [groups]);

  function toggleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  return (
    <section className="module-card" ref={activeCostsRef} aria-busy={loading}>
      <div className="module-card-header">
        <div className="module-card-title">Actieve kostprijzen</div>
        <div className="module-card-text">
          Eén actuele planningskostprijs per concrete SKU uit de actieve commerciële jaarset.
        </div>
      </div>

      {loading ? (
        <ActionStatus kind="pending" message="Actieve jaarset laden…" guidance="De vastgelegde SKU-kostprijzen worden read-only opgehaald." />
      ) : error ? (
        <div className="wizard-stack">
          <ActionStatus kind="error" message="Actieve kostprijzen konden niet worden geladen." guidance={error} />
          <button type="button" className="editor-button editor-button-secondary" onClick={() => setReloadKey((value) => value + 1)}>
            Opnieuw proberen
          </button>
        </div>
      ) : payload?.status !== "ready" || !payload.binding ? (
        <ActionStatus
          kind="warning"
          message="Er is geen bruikbare actieve commerciële jaarset."
          guidance="Rond eerst ‘Nieuw jaar voorbereiden’ volledig af en activeer de gevalideerde jaarset."
        />
      ) : (
        <>
          <div className="editor-actions" style={{ marginBottom: 12 }}>
            <div className="editor-actions-group">
              <span className="status-pill status-ok">Actieve jaarset {payload.binding.operational_year}</span>
              <span className="editor-pill">{payload.summary.sku_count} SKU&apos;s</span>
              <Link className="editor-button editor-button-secondary" href={`/beheer/jaarsets/${payload.binding.operational_year}`}>
                Jaarset bekijken
              </Link>
            </div>
          </div>

          {payload.shadow_parity?.status === "different" ? (
            <ActionStatus
              kind="warning"
              message="De oude activatielijst wijkt af van de actieve jaarset."
              guidance="Dit overzicht volgt bewust de actieve commerciële jaarset; er zijn geen gegevens aangepast."
            />
          ) : null}

          {payload.summary.missing_cost_count > 0 ? (
            <ActionStatus
              kind="error"
              message={`${payload.summary.missing_cost_count} SKU's missen een geldige kostprijs.`}
              guidance="Open de actieve jaarset om de betrokken SKU's en blokkades te controleren."
            />
          ) : null}

          <div className="wizard-form-grid" style={{ alignItems: "end" }}>
            <label className="nested-field">
              <span>Zoeken</span>
              <input
                className="dataset-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Zoek bier, SKU, type of herkomst…"
              />
            </label>
          </div>

          <div className="editor-actions" style={{ marginTop: 12, marginBottom: 12 }}>
            <div className="editor-actions-group">
              <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpenGroups(allOpen)}>
                Alles openen
              </button>
              <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpenGroups({})}>
                Alles sluiten
              </button>
            </div>
            <div className="editor-toolbar-actions" style={{ gap: 8, display: "flex", alignItems: "center" }}>
              <SortButton label="SKU" active={sort.key === "sku"} dir={sort.direction} onClick={() => toggleSort("sku")} />
              <SortButton label="Kostmethode" active={sort.key === "method"} dir={sort.direction} onClick={() => toggleSort("method")} />
              <SortButton label="Kostprijs" active={sort.key === "cost"} dir={sort.direction} onClick={() => toggleSort("cost")} />
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="dataset-empty" style={{ padding: "1rem" }}>Geen actieve kostprijzen passen bij je zoekopdracht.</div>
          ) : (
            <div className="wizard-stack">
              {groups.map((group) => {
                const isOpen = Boolean(openGroups[group.key]);
                return (
                  <section key={group.key} className="module-card compact-card">
                    <button
                      type="button"
                      className="module-card-title"
                      aria-expanded={isOpen}
                      aria-controls={`active-cost-group-${group.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                      style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: "transparent", border: 0, padding: 0, textAlign: "left" }}
                      onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !isOpen }))}
                    >
                      <span>{isOpen ? "⌄" : ">"} {group.label}</span>
                      <span className="editor-pill">{group.items.length} SKU&apos;s</span>
                    </button>

                    {isOpen ? (
                      <div id={`active-cost-group-${group.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`} className="dataset-editor-scroll" style={{ marginTop: 12 }}>
                        <table className="dataset-editor-table">
                          <thead>
                            <tr>
                              <th>SKU</th>
                              <th>Type</th>
                              <th>Kostmethode</th>
                              <th>Herkomst</th>
                              <th>Kostprijs</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.items.map((row) => {
                              const state = costStateView(row);
                              return (
                                <tr key={row.sku_id}>
                                  <td>
                                    <strong>{row.sku_name}</strong>
                                    {row.sku_code ? <div className="muted">{row.sku_code}</div> : null}
                                  </td>
                                  <td>{typeLabel(row.subject_type)}</td>
                                  <td>{methodLabel(row.cost_method)}</td>
                                  <td>{provenanceLabel(row.provenance_kind, row.provenance_source_year)}</td>
                                  <td style={{ whiteSpace: "nowrap" }}>
                                    <span className={state.className} title={state.detail}>{state.label}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
