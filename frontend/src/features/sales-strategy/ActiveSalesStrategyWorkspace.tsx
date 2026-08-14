"use client";

import { useMemo, useState } from "react";

import { ActionStatus, type ActionStatusState } from "@/components/ActionStatus";
import {
  activeSalesStrategyMarkup,
  activeSalesStrategyStatusLabel,
  activeSalesStrategyStatusTone,
  filterActiveSalesStrategyGroups,
  type ActiveSalesStrategyItem,
  type ActiveSalesStrategyProjection,
} from "@/features/sales-strategy/activeSalesStrategyModel";
import { apiRequestJsonClient, ApiRequestError } from "@/lib/apiClient";

type DraftPrices = Record<string, number | "">;

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Ontbreekt";
  return value.toLocaleString("nl-NL", { style: "currency", currency: "EUR" });
}

function initialDrafts(projection: ActiveSalesStrategyProjection): DraftPrices {
  return Object.fromEntries(
    projection.groups.flatMap((group) => group.items.map((item) => [item.sku_id, item.list_price ?? ""]))
  );
}

function errorStatus(error: unknown): ActionStatusState {
  if (error instanceof ApiRequestError && error.status === 409) {
    return {
      kind: "error",
      message: error.detail || "De actieve prijslijst is intussen gewijzigd.",
      guidance: "Herlaad de pagina, controleer de nieuwe waarden en probeer opnieuw.",
    };
  }
  return {
    kind: "error",
    message: "Opslaan mislukt.",
    guidance: "Controleer de ingevoerde prijzen en je verbinding. Probeer daarna opnieuw.",
  };
}

export function ActiveSalesStrategyWorkspace({ initialProjection }: { initialProjection: ActiveSalesStrategyProjection }) {
  const [projection, setProjection] = useState(initialProjection);
  const [drafts, setDrafts] = useState<DraftPrices>(() => initialDrafts(initialProjection));
  const [dirtySkuIds, setDirtySkuIds] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<ActionStatusState | null>(null);

  const visibleGroups = useMemo(
    () => filterActiveSalesStrategyGroups(projection.groups, filter),
    [projection.groups, filter]
  );
  const allOpen = useMemo(
    () => Object.fromEntries(visibleGroups.map((group) => [group.key, true])),
    [visibleGroups]
  );

  function setPrice(item: ActiveSalesStrategyItem, value: number | "") {
    setDrafts((current) => ({ ...current, [item.sku_id]: value }));
    setDirtySkuIds((current) => new Set(current).add(item.sku_id));
    setStatus(null);
  }

  async function save() {
    if (!projection.binding || dirtySkuIds.size === 0) return;
    setIsSaving(true);
    setStatus({ kind: "pending", message: "Verkoopstrategie wordt opgeslagen." });
    try {
      const rows = projection.groups.flatMap((group) => group.items);
      const bySku = new Map(rows.map((item) => [item.sku_id, item]));
      const changes = [...dirtySkuIds].map((skuId) => {
        const item = bySku.get(skuId);
        const listPrice = drafts[skuId];
        if (!item || listPrice === "" || !Number.isFinite(listPrice) || listPrice <= 0) {
          throw new Error("invalid-price");
        }
        return {
          sku_id: skuId,
          list_price: listPrice,
          pricing_record_id: item.pricing_record_id,
          expected_record_hash: item.pricing_record_hash,
        };
      });
      const next = await apiRequestJsonClient<ActiveSalesStrategyProjection>(
        "/meta/commercial-yearsets/active/sales-strategy",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generation_id: projection.binding.generation_id,
            run_id: projection.binding.run_id,
            manifest_hash: projection.binding.manifest_hash,
            changes,
          }),
        },
        { timeoutMs: 30_000 }
      );
      setProjection(next);
      setDrafts(initialDrafts(next));
      setDirtySkuIds(new Set());
      setStatus({ kind: "success", message: "Verkoopstrategie opgeslagen." });
    } catch (error) {
      if (error instanceof Error && error.message === "invalid-price") {
        setStatus({
          kind: "error",
          message: "Vul voor iedere gewijzigde SKU een lijstprijs groter dan nul in.",
          guidance: "Niet-gewijzigde ontbrekende prijzen blijven zichtbaar en worden niet automatisch ingevuld.",
        });
      } else {
        setStatus(errorStatus(error));
      }
    } finally {
      setIsSaving(false);
    }
  }

  if (projection.status !== "ready" || !projection.binding) {
    return (
      <section className="module-card">
        <div className="module-card-title">Geen actieve verkoopstrategie</div>
        <div className="module-card-text">
          Er is geen gereed geactiveerde jaarset. Rond eerst Nieuw jaar voorbereiden af of controleer de Jaarsets.
        </div>
        {projection.reason_codes.length > 0 ? (
          <ActionStatus kind="warning" message={projection.reason_codes.join(", ")} />
        ) : null}
      </section>
    );
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Verkoopstrategie</div>
        <div className="module-card-text">
          De actieve jaarset bepaalt welke SKU&apos;s en kostprijzen worden getoond. De actuele lijstprijs per SKU is de centrale sell-inprijs.
        </div>
      </div>

      <div className="editor-toolbar">
        <div className="editor-toolbar-meta">
          <span className="editor-pill">{projection.summary.sku_count} SKU&apos;s</span>
          <span className="editor-pill">{projection.summary.ready_price_count} geprijsd</span>
          {projection.summary.missing_price_count + projection.summary.non_positive_price_count > 0 ? (
            <span className="editor-pill">
              {projection.summary.missing_price_count + projection.summary.non_positive_price_count} prijsacties
            </span>
          ) : null}
          <span className="muted">Actieve jaarset {projection.binding.operational_year}</span>
        </div>
        <div className="editor-actions-group">
          <label className="nested-field">
            <span>Jaar</span>
            <select className="dataset-input" value={projection.binding.operational_year} disabled>
              <option value={projection.binding.operational_year}>{projection.binding.operational_year}</option>
            </select>
          </label>
          <label className="nested-field">
            <span>Zoeken</span>
            <input
              className="dataset-input"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Zoek stijl, SKU of code..."
            />
          </label>
        </div>
      </div>

      {projection.summary.compatibility_only_price_count > 0 ? (
        <ActionStatus
          kind="warning"
          message={`${projection.summary.compatibility_only_price_count} oude prijsregels vallen buiten de actieve jaarset en worden hier niet gebruikt.`}
          guidance="Deze compatibiliteitsregels blijven opgeslagen; RF-012C4A verwijdert of wijzigt ze niet."
        />
      ) : null}

      <div className="editor-actions" style={{ marginTop: 12, marginBottom: 12 }}>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpenGroups(allOpen)}>
            Alles openen
          </button>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpenGroups({})}>
            Alles sluiten
          </button>
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <div className="dataset-empty" style={{ padding: "1rem" }}>Geen SKU&apos;s gevonden.</div>
      ) : (
        <div className="wizard-stack">
          {visibleGroups.map((group) => {
            const isOpen = openGroups[group.key] ?? false;
            return (
              <section key={group.key} className="module-card compact-card">
                <button
                  type="button"
                  className="module-card-title"
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    textAlign: "left",
                  }}
                  aria-expanded={isOpen}
                  aria-controls={`active-sales-group-${group.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                  onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !isOpen }))}
                >
                  <span>{isOpen ? "v" : ">"} {group.label}</span>
                  <span className="editor-pill">{group.items.length} SKU&apos;s</span>
                </button>

                {isOpen ? (
                  <div
                    id={`active-sales-group-${group.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                    className="dataset-editor-scroll"
                    style={{ marginTop: 12 }}
                  >
                    <table className="dataset-editor-table">
                      <caption className="sr-only">
                        Actieve verkoopprijzen voor {group.label} in {projection.binding?.operational_year}
                      </caption>
                      <thead>
                        <tr>
                          <th>Artikel</th>
                          <th>Kostprijs</th>
                          <th>Lijstprijs {projection.binding?.operational_year}</th>
                          <th>Opslag</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((item) => {
                          const draft = drafts[item.sku_id];
                          const numericDraft = draft === "" ? null : Number(draft);
                          const markup = activeSalesStrategyMarkup(item, numericDraft);
                          return (
                            <tr key={item.sku_id}>
                              <td>
                                <strong>{item.sku_name}</strong>
                                <div className="muted">{item.sku_code || item.sku_id}</div>
                              </td>
                              <td>
                                {item.cost_state === "not_applicable" ? "n.v.t." : money(item.cost_price)}
                              </td>
                              <td>
                                {item.price_required ? (
                                  <input
                                    className="dataset-input"
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={draft ?? ""}
                                    disabled={!item.editable || isSaving}
                                    aria-label={`Lijstprijs ${projection.binding?.operational_year} voor ${item.sku_name}`}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setPrice(item, value === "" ? "" : Number(value));
                                    }}
                                    style={{ maxWidth: 140 }}
                                  />
                                ) : (
                                  "n.v.t."
                                )}
                              </td>
                              <td>
                                {markup === null
                                  ? "n.v.t."
                                  : `${markup.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                              </td>
                              <td>
                                <span className={`status-pill status-${activeSalesStrategyStatusTone(item)}`}>
                                  {activeSalesStrategyStatusLabel(item)}
                                </span>
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

      <div className="editor-actions">
        <div className="editor-actions-group" />
        <div className="editor-actions-group">
          {status ? <ActionStatus {...status} /> : null}
          {!projection.can_edit ? (
            <span className="muted">Alleen een Administrator kan de actieve lijstprijzen wijzigen.</span>
          ) : (
            <button
              type="button"
              className="editor-button"
              onClick={() => void save()}
              disabled={isSaving || dirtySkuIds.size === 0}
            >
              {isSaving ? "Opslaan..." : `Opslaan${dirtySkuIds.size > 0 ? ` (${dirtySkuIds.size})` : ""}`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
