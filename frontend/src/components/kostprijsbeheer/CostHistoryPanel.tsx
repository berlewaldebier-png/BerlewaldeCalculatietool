"use client";

import { useEffect, useMemo, useState } from "react";

import { ActionStatus } from "@/components/ActionStatus";
import { API_BASE_URL } from "@/lib/api";
import { costSourceLabel, formatDate, methodLabel, money, provenanceLabel } from "@/components/kostprijsbeheer/costPresentation";


type Components = {
  primary_cost: number | null;
  packaging_cost: number | null;
  overhead_cost: number | null;
  excise_cost: number | null;
  cost_price: number | null;
};

type HistoryLot = {
  lineage_id?: string;
  lot_number: string;
  source_type: string;
  source_ref: string;
  source_date: string;
  supplier: string;
  resolution_status: string;
  evidence_kind: "canonical_lot" | "version_declared_lot";
};

type ActiveAnchor = {
  record_id: string;
  record_kind: "active_planning_anchor";
  authority_status: "source_anchor_verified" | "target_anchor_verified" | "active_generation_only" | "not_applicable";
  planning_year: number;
  source_anchor_id: string;
  source_anchor_kind: string;
  source_anchor_year: number;
  source_anchor_effective_at: string;
  target_anchor_id: string;
  effective_at: string;
  cost_method: string;
  provenance_kind: string;
  provenance_source_year: number;
  component_state: "ready" | "missing_cost" | "not_applicable" | "component_mismatch";
  components: Components;
  cost_blocker_codes: string[];
};

type CostVersionRecord = {
  record_id: string;
  record_kind: "cost_version";
  relation_to_anchor: "anchor_source" | "target_anchor_source" | "registered_variant" | "superseded_anchor";
  source_year: number;
  version_number: number;
  version_status: string;
  cost_method: string;
  cost_source: string;
  source_ref: string;
  effective_at: string;
  supplier: string;
  component_state: "ready" | "missing_cost" | "component_mismatch";
  components: Components;
  lots: HistoryLot[];
  unverified_lots: HistoryLot[];
};

type UnresolvedEvidence = {
  evidence_id: string;
  evidence_kind: "direct_lot_without_canonical_lineage";
  source_type: string;
  source_ref: string;
  source_date: string;
  supplier: string;
  lot_number: string;
  product_name: string;
  reason_codes: string[];
  components: null;
};

type SkuHistory = {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  beer_name: string;
  subject_type: string;
  active_anchor: ActiveAnchor;
  cost_versions: CostVersionRecord[];
  unresolved_evidence: UnresolvedEvidence[];
  reason_codes: string[];
};

type CostHistoryResponse = {
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
  summary: {
    sku_count: number;
    source_anchor_verified_count: number;
    target_anchor_verified_count: number;
    active_generation_only_count: number;
    not_applicable_count: number;
    cost_version_count: number;
    additional_variant_count: number;
    canonical_lot_count: number;
    unverified_declared_lot_count: number;
    direct_lot_evidence_count: number;
    unresolved_evidence_count: number;
  };
  histories: SkuHistory[];
  reason_codes: string[];
};


async function fetchCostHistory(): Promise<CostHistoryResponse> {
  const response = await fetch(`${API_BASE_URL}/meta/commercial-yearsets/active/cost-history`, {
    credentials: "include",
    cache: "no-store",
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Kostprijshistorie ophalen mislukt (${response.status}).`));
  }
  return payload as CostHistoryResponse;
}


function authorityView(anchor: ActiveAnchor) {
  if (anchor.authority_status === "source_anchor_verified") {
    return { label: `Bronjaaranker ${anchor.source_anchor_year} geverifieerd`, className: "status-pill status-ok" };
  }
  if (anchor.authority_status === "target_anchor_verified") {
    return { label: `Doeljaaranker ${anchor.planning_year} geverifieerd`, className: "status-pill status-ok" };
  }
  if (anchor.authority_status === "not_applicable") {
    return { label: "Kostprijs n.v.t.", className: "status-pill status-neutral" };
  }
  return { label: "Alleen actieve-generatiebewijs", className: "status-pill status-warning" };
}


function relationLabel(value: CostVersionRecord["relation_to_anchor"]) {
  const labels: Record<CostVersionRecord["relation_to_anchor"], string> = {
    anchor_source: "Bron van het actieve anker",
    target_anchor_source: "Doeljaarrecord van het actieve anker",
    registered_variant: "Geregistreerde variant",
    superseded_anchor: "Vervangen planningsanker",
  };
  return labels[value];
}


function componentStateView(state: ActiveAnchor["component_state"] | CostVersionRecord["component_state"], total: number | null) {
  if (state === "not_applicable") return { label: "n.v.t.", className: "status-pill status-neutral" };
  if (state === "missing_cost") return { label: "Kostprijs ontbreekt", className: "status-pill status-danger" };
  if (state === "component_mismatch") return { label: "Componenten sluiten niet aan", className: "status-pill status-warning" };
  return { label: total === null ? "—" : money.format(total), className: "status-pill status-ok" };
}


function ComponentsTable({ components, state }: { components: Components; state: ActiveAnchor["component_state"] | CostVersionRecord["component_state"] }) {
  const status = componentStateView(state, components.cost_price);
  return (
    <div className="dataset-editor-scroll">
      <table className="dataset-editor-table">
        <thead>
          <tr>
            <th>Inkoop/productie</th>
            <th>Verpakking</th>
            <th>Overhead</th>
            <th>Accijns</th>
            <th>Kostprijs</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{components.primary_cost === null ? "—" : money.format(components.primary_cost)}</td>
            <td>{components.packaging_cost === null ? "—" : money.format(components.packaging_cost)}</td>
            <td>{components.overhead_cost === null ? "—" : money.format(components.overhead_cost)}</td>
            <td>{components.excise_cost === null ? "—" : money.format(components.excise_cost)}</td>
            <td><span className={status.className}>{status.label}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


function LotList({ lots, unresolved = false }: { lots: HistoryLot[]; unresolved?: boolean }) {
  if (lots.length === 0) return <span className="muted">Geen LOT vastgelegd</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {lots.map((lot, index) => (
        <span
          key={`${lot.lot_number}-${lot.source_ref}-${index}`}
          className={`status-pill ${unresolved ? "status-warning" : "status-neutral"}`}
          title={unresolved ? "LOT staat op de kostversie, maar is niet exact aan deze SKU-kostregel gekoppeld." : "Exacte canonieke LOT-koppeling."}
        >
          LOT {lot.lot_number}{unresolved ? " · niet exact gekoppeld" : ""}
        </span>
      ))}
    </div>
  );
}


function SkuHistoryDetails({ history }: { history: SkuHistory }) {
  const anchorView = authorityView(history.active_anchor);
  return (
    <div className="wizard-stack" style={{ padding: "0.75rem 0" }}>
      <section className="module-card compact-card">
        <div className="editor-actions" style={{ marginBottom: 10 }}>
          <div>
            <div className="module-card-title">Actief planningsanker {history.active_anchor.planning_year}</div>
            <div className="module-card-text">
              {methodLabel(history.active_anchor.cost_method)} · {provenanceLabel(history.active_anchor.provenance_kind, history.active_anchor.provenance_source_year)}
            </div>
          </div>
          <span className={anchorView.className}>{anchorView.label}</span>
        </div>
        <ComponentsTable components={history.active_anchor.components} state={history.active_anchor.component_state} />
      </section>

      <section className="module-card compact-card">
        <div className="module-card-title">Vastgelegde kostprijsversies</div>
        <div className="module-card-text" style={{ marginBottom: 10 }}>
          Bronrecords blijven zichtbaar, maar vervangen het actieve planningsanker niet automatisch.
        </div>
        {history.cost_versions.length === 0 ? (
          <div className="dataset-empty">Geen afzonderlijke kostprijsversie beschikbaar.</div>
        ) : (
          <div className="wizard-stack">
            {history.cost_versions.map((record) => {
              const status = componentStateView(record.component_state, record.components.cost_price);
              return (
                <section key={record.record_id} className="module-card compact-card">
                  <div className="editor-actions" style={{ marginBottom: 8 }}>
                    <div>
                      <strong>{relationLabel(record.relation_to_anchor)}</strong>
                      <div className="muted">
                        Bronjaar {record.source_year || "onbekend"} · {costSourceLabel(record.cost_source)} · {methodLabel(record.cost_method)} · {formatDate(record.effective_at)}
                        {record.source_ref ? ` · ${record.source_ref}` : ""}
                      </div>
                    </div>
                    <span className={status.className}>{status.label}</span>
                  </div>
                  <ComponentsTable components={record.components} state={record.component_state} />
                  <div style={{ marginTop: 8 }}><LotList lots={record.lots} /></div>
                  {record.unverified_lots.length > 0 ? (
                    <div style={{ marginTop: 8 }}><LotList lots={record.unverified_lots} unresolved /></div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </section>

      {history.unresolved_evidence.length > 0 ? (
        <section className="module-card compact-card">
          <ActionStatus
            kind="warning"
            message={`${history.unresolved_evidence.length} LOT-bewijsregel${history.unresolved_evidence.length === 1 ? "" : "s"} zonder canonieke kostversielijn.`}
            guidance="Geen bedrag: canonieke kostversielijn ontbreekt. Laat een Administrator de SKU/LOT-koppeling beoordelen; dit overzicht doet geen automatische reparatie."
          />
          <div className="dataset-editor-scroll" style={{ marginTop: 8 }}>
            <table className="dataset-editor-table">
              <thead><tr><th>LOT</th><th>Bron</th><th>Datum</th><th>Leverancier</th><th>Status</th></tr></thead>
              <tbody>
                {history.unresolved_evidence.map((evidence) => (
                  <tr key={evidence.evidence_id}>
                    <td>{evidence.lot_number || "Onbekend"}</td>
                    <td>{costSourceLabel(evidence.source_type)}{evidence.source_ref ? ` · ${evidence.source_ref}` : ""}</td>
                    <td>{formatDate(evidence.source_date)}</td>
                    <td>{evidence.supplier || "Onbekend"}</td>
                    <td><span className="status-pill status-warning">Niet canoniek gekoppeld</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}


export function CostHistoryPanel({ id }: { id: string }) {
  const [payload, setPayload] = useState<CostHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [search, setSearch] = useState("");
  const [openSku, setOpenSku] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchCostHistory()
      .then((next) => {
        if (!cancelled) setPayload(next);
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
  }, [retryKey]);

  const histories = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("nl-NL");
    return (payload?.histories || []).filter((history) => {
      if (!query) return true;
      return `${history.beer_name} ${history.sku_name} ${history.sku_code}`.toLocaleLowerCase("nl-NL").includes(query);
    });
  }, [payload, search]);

  const allOpen = useMemo(() => Object.fromEntries(histories.map((history) => [history.sku_id, true])), [histories]);

  return (
    <section id={id} className="module-card cost-history-panel" style={{ marginTop: 18 }} aria-busy={loading}>
      <div className="module-card-header">
        <div className="module-card-title">Alle varianten / historie</div>
        <div className="module-card-text">
          Read-only overzicht van het actieve planningsanker, vastgelegde kostprijsversies en exacte of nog onopgeloste LOT-lineage per SKU.
        </div>
      </div>

      {loading ? (
        <ActionStatus kind="pending" message="Kostprijshistorie laden…" guidance="De bestaande ankers, versies en LOT-bewijzen worden uitsluitend gelezen." />
      ) : error ? (
        <div className="wizard-stack">
          <ActionStatus kind="error" message="Kostprijshistorie kon niet worden geladen." guidance={error} />
          <button type="button" className="editor-button editor-button-secondary" onClick={() => setRetryKey((value) => value + 1)}>Opnieuw proberen</button>
        </div>
      ) : payload?.status !== "ready" || !payload.binding ? (
        <ActionStatus kind="warning" message="Geen betrouwbare kostprijshistorie beschikbaar." guidance={(payload?.reason_codes || []).join(", ") || "De actieve-generatiebinding kon niet worden bewezen."} />
      ) : (
        <div className="wizard-stack">
          <div className="editor-actions">
            <div className="editor-actions-group">
              <span className="status-pill status-ok">Planningsjaar {payload.binding.operational_year}</span>
              <span className="editor-pill">{payload.summary.cost_version_count} kostprijsregels</span>
              <span className="editor-pill">{payload.summary.additional_variant_count} aanvullende varianten</span>
              <span className="editor-pill">{payload.summary.canonical_lot_count} exacte LOT-koppelingen</span>
            </div>
          </div>

          {payload.summary.active_generation_only_count > 0 ? (
            <ActionStatus
              kind="error"
              message={`${payload.summary.active_generation_only_count} actieve SKU's missen relationele ankerlineage.`}
              guidance="Gebruik deze regels niet voor herstel of herberekening voordat de databinding expliciet is beoordeeld."
            />
          ) : null}

          {payload.summary.unresolved_evidence_count > 0 ? (
            <ActionStatus
              kind="warning"
              message={`${payload.summary.unresolved_evidence_count} LOT-bewijsrelaties zijn nog niet exact aan een canonieke SKU-kostregel gekoppeld.`}
              guidance={`${payload.summary.unverified_declared_lot_count} staan alleen op versieniveau en ${payload.summary.direct_lot_evidence_count} zijn directe LOT-bewijzen. Ze blijven zichtbaar zonder als bedrag te worden gebruikt.`}
            />
          ) : null}

          <div className="editor-actions">
            <label className="nested-field" style={{ minWidth: 260 }}>
              <span>Zoeken in historie</span>
              <input className="dataset-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Zoek bier of SKU…" />
            </label>
            <div className="editor-actions-group">
              <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpenSku(allOpen)}>Alles openen</button>
              <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpenSku({})}>Alles sluiten</button>
            </div>
          </div>

          {histories.length === 0 ? (
            <div className="dataset-empty">Geen SKU-historie past bij je zoekopdracht.</div>
          ) : (
            histories.map((history) => {
              const isOpen = Boolean(openSku[history.sku_id]);
              const panelId = `cost-history-${history.sku_id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
              return (
                <section key={history.sku_id} className="module-card compact-card">
                  <button
                    type="button"
                    className="module-card-title cost-history-sku-toggle"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: "transparent", border: 0, padding: 0, textAlign: "left", gap: 12 }}
                    onClick={() => setOpenSku((current) => ({ ...current, [history.sku_id]: !isOpen }))}
                  >
                    <span className="cost-history-sku-name">{isOpen ? "⌄" : ">"} {history.sku_name}</span>
                    <span className="editor-pill">{history.cost_versions.length} versie{history.cost_versions.length === 1 ? "" : "s"}</span>
                  </button>
                  {history.sku_code ? <div className="muted" style={{ marginTop: 4 }}>{history.sku_code}</div> : null}
                  {isOpen ? <div id={panelId}><SkuHistoryDetails history={history} /></div> : null}
                </section>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
