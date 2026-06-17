"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import { BerekeningenWizard } from "@/components/BerekeningenWizard";
import { saveKostprijsversies } from "@/components/berekeningen/berekeningenWizardIo";
import { formatCurrencyDisplay } from "@/components/berekeningen/berekeningenWizardFormatting";
import { TrashIcon } from "@/components/berekeningen/BerekeningenWizardParts";

type GenericRecord = Record<string, unknown>;

type InkoopFacturenWorkspaceProps = {
  kostprijsversies: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  skus: GenericRecord[];
  bieren: GenericRecord[];
  articles: GenericRecord[];
  bomLines: GenericRecord[];
  productie: Record<string, GenericRecord>;
  vasteKosten: Record<string, GenericRecord[]>;
  tarievenHeffingen: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  productgroepen: GenericRecord[];
  alcoholcategorieen: GenericRecord[];
  verpakkingstypen: GenericRecord[];
  packagingComponentPrices: GenericRecord[];
};

function isInkoopCostprice(row: GenericRecord) {
  const status = String((row as any)?.status ?? "").trim().toLowerCase();
  const type = String((((row as any)?.soort_berekening as GenericRecord | undefined)?.type ?? "")).trim();
  return status === "definitief" && type === "Inkoop";
}

function isFactuurVersion(row: GenericRecord) {
  const calculationVariant = String((row as any)?.calculation_variant ?? "").trim().toLowerCase();
  const brontype = String((row as any)?.brontype ?? "").trim().toLowerCase();
  const sourceId = String((row as any)?.bron_berekening_id ?? "").trim();
  return calculationVariant === "factuur" || (brontype === "factuur" && Boolean(sourceId));
}

function rowId(row: GenericRecord | undefined | null) {
  return String((row as any)?.id ?? "").trim();
}

function resolveRootSourceId(row: GenericRecord, byId: Map<string, GenericRecord>) {
  let current = row;
  const seen = new Set<string>();

  while (isFactuurVersion(current)) {
    const parentId = String((current as any)?.bron_berekening_id ?? "").trim();
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);

    const parent = byId.get(parentId);
    if (!parent) break;
    current = parent;
  }

  return rowId(current);
}

function rowBasis(row: GenericRecord) {
  return (((row as any)?.basisgegevens ?? {}) as GenericRecord) ?? {};
}

function rowBeerName(row: GenericRecord) {
  const basis = rowBasis(row);
  return String((basis as any)?.biernaam ?? (row as any)?.biernaam ?? "Onbekend").trim();
}

function rowYear(row: GenericRecord) {
  const basis = rowBasis(row);
  return Number((basis as any)?.jaar ?? (row as any)?.jaar ?? 0) || 0;
}

function rowSourceLabel(row: GenericRecord) {
  const inkoop = ((((row as any)?.invoer as GenericRecord | undefined)?.inkoop ?? {}) as GenericRecord) ?? {};
  const facturen = Array.isArray((inkoop as any)?.facturen) ? ((inkoop as any).facturen as GenericRecord[]) : [];
  const primary = facturen[0] ?? {};
  const invoiceNumber = String((primary as any)?.factuurnummer ?? (inkoop as any)?.factuurnummer ?? "").trim();
  const invoiceDate = String((primary as any)?.factuurdatum ?? (inkoop as any)?.factuurdatum ?? "").trim();
  if (invoiceNumber || invoiceDate) return [invoiceNumber, invoiceDate].filter(Boolean).join(" ");
  return String((row as any)?.bron_label ?? "").trim() || "-";
}

function rowCost(row: GenericRecord) {
  const cost = Number((row as any)?.kostprijs ?? 0);
  if (Number.isFinite(cost) && cost > 0) return cost;
  const lines = Array.isArray((row as any)?.cost_lines) ? ((row as any).cost_lines as GenericRecord[]) : [];
  return lines.reduce((sum, line) => sum + Number((line as any)?.kostprijs ?? 0), 0);
}

export function InkoopFacturenWorkspace(props: InkoopFacturenWorkspaceProps) {
  const [rows, setRows] = useState<GenericRecord[]>(Array.isArray(props.kostprijsversies) ? props.kostprijsversies : []);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [viewVersionId, setViewVersionId] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string>("");
  const [showQuickSelect, setShowQuickSelect] = useState(false);
  const [quickSelectId, setQuickSelectId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error" | null>(null);

  useEffect(() => {
    if (selectedSourceId || viewVersionId) return;
    setRows(Array.isArray(props.kostprijsversies) ? props.kostprijsversies : []);
  }, [props.kostprijsversies, selectedSourceId, viewVersionId]);

  const activeVersionIds = useMemo(
    () =>
      new Set(
        (Array.isArray(props.kostprijsproductactiveringen) ? props.kostprijsproductactiveringen : [])
          .map((row) => String((row as any)?.kostprijsversie_id ?? "").trim())
          .filter(Boolean)
      ),
    [props.kostprijsproductactiveringen]
  );

  const sourceRows = useMemo(
    () => {
      const byId = new Map(
        rows
          .map((row) => [String((row as any)?.id ?? "").trim(), row] as const)
          .filter(([id]) => Boolean(id))
      );
      const activeRows = [...activeVersionIds]
        .map((id) => byId.get(id))
        .filter((row): row is GenericRecord => Boolean(row))
        .map((row) => byId.get(resolveRootSourceId(row, byId)) ?? row)
        .filter(isInkoopCostprice)
        .filter((row) => !isFactuurVersion(row));
      const fallbackRows = activeRows.length > 0
        ? []
        : rows
            .filter((row) => Boolean((row as any)?.is_actief))
            .map((row) => byId.get(resolveRootSourceId(row, byId)) ?? row)
            .filter(isInkoopCostprice)
            .filter((row) => !isFactuurVersion(row));
      const seen = new Set<string>();
      return [...activeRows, ...fallbackRows]
        .filter((row) => {
          const id = String((row as any)?.id ?? "").trim();
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .sort((a, b) => rowBeerName(a).localeCompare(rowBeerName(b), "nl-NL") || rowYear(b) - rowYear(a));
    },
    [activeVersionIds, rows]
  );

  const versionsBySourceId = useMemo(() => {
    const out = new Map<string, GenericRecord[]>();
    const byId = new Map(
      rows
        .map((row) => [rowId(row), row] as const)
        .filter(([id]) => Boolean(id))
    );
    rows.filter(isFactuurVersion).forEach((row) => {
      const sourceId = resolveRootSourceId(row, byId);
      if (!sourceId) return;
      const current = out.get(sourceId) ?? [];
      current.push(row);
      out.set(sourceId, current);
    });
    out.forEach((versionRows, key) => {
      out.set(
        key,
        [...versionRows].sort((a, b) => String((b as any)?.updated_at ?? "").localeCompare(String((a as any)?.updated_at ?? "")))
      );
    });
    return out;
  }, [rows]);

  async function deleteVersion(version: GenericRecord) {
    const id = String((version as any)?.id ?? "").trim();
    if (!id || activeVersionIds.has(id)) return;
    const confirmed = window.confirm("Weet je zeker dat je deze niet-actieve factuurversie wilt verwijderen?");
    if (!confirmed) return;
    setDeletingId(id);
    setStatus("");
    setStatusTone(null);
    try {
      const nextRows = rows.filter((row) => String((row as any)?.id ?? "").trim() !== id);
      await saveKostprijsversies(nextRows);
      setRows(nextRows);
      setStatus("Factuurversie verwijderd.");
      setStatusTone("success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Verwijderen mislukt: ${message}`);
      setStatusTone("error");
    } finally {
      setDeletingId("");
    }
  }

  if (selectedSourceId) {
    return (
      <BerekeningenWizard
        key={selectedSourceId}
        initialRows={rows}
        basisproducten={props.basisproducten}
        samengesteldeProducten={props.samengesteldeProducten}
        skus={props.skus}
        bieren={props.bieren}
        articles={props.articles}
        bomLines={props.bomLines}
        productie={props.productie}
        vasteKosten={props.vasteKosten}
        tarievenHeffingen={props.tarievenHeffingen}
        kostprijsproductactiveringen={props.kostprijsproductactiveringen}
        productgroepen={props.productgroepen}
        alcoholcategorieen={props.alcoholcategorieen}
        verpakkingstypen={props.verpakkingstypen}
        packagingComponentPrices={props.packagingComponentPrices}
        mode="invoice-version"
        initialSelectedId={selectedSourceId}
        onBackToLanding={() => setSelectedSourceId("")}
        onRowsChange={setRows}
        onFinish={() => setSelectedSourceId("")}
      />
    );
  }

  if (viewVersionId) {
    return (
      <BerekeningenWizard
        key={`view-${viewVersionId}`}
        initialRows={rows}
        basisproducten={props.basisproducten}
        samengesteldeProducten={props.samengesteldeProducten}
        skus={props.skus}
        bieren={props.bieren}
        articles={props.articles}
        bomLines={props.bomLines}
        productie={props.productie}
        vasteKosten={props.vasteKosten}
        tarievenHeffingen={props.tarievenHeffingen}
        kostprijsproductactiveringen={props.kostprijsproductactiveringen}
        productgroepen={props.productgroepen}
        alcoholcategorieen={props.alcoholcategorieen}
        verpakkingstypen={props.verpakkingstypen}
        packagingComponentPrices={props.packagingComponentPrices}
        initialSelectedId={viewVersionId}
        onBackToLanding={() => setViewVersionId("")}
        onRowsChange={setRows}
        onFinish={() => setViewVersionId("")}
      />
    );
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div>
          <div className="module-card-title">Inkoopfacturen</div>
          <div className="module-card-text">
            Kies een bestaande actieve inkoopkostprijs en voeg een nieuwe factuurversie toe.
          </div>
        </div>
        <button
          type="button"
          className="cpq-button cpq-button-primary"
          onClick={() => {
            const firstId = sourceRows[0] ? String(sourceRows[0].id ?? "") : "";
            setQuickSelectId((current) => current || firstId);
            setShowQuickSelect((current) => !current);
          }}
          disabled={sourceRows.length === 0}
        >
          Nieuwe inkoopfactuur toevoegen
        </button>
      </div>

      {showQuickSelect ? (
        <div className="module-card compact-card" style={{ marginBottom: 12 }}>
          <div className="module-card-title">Kies kostprijs</div>
          <div className="wizard-form-grid" style={{ alignItems: "end", marginTop: 12 }}>
            <label className="nested-field">
              <span>Actieve kostprijs</span>
              <select
                className="dataset-input"
                value={quickSelectId}
                onChange={(event) => setQuickSelectId(event.target.value)}
              >
                <option value="" disabled>
                  Selecteer een actieve kostprijs...
                </option>
                {sourceRows.map((row) => {
                  const id = String((row as any)?.id ?? "").trim();
                  return (
                    <option key={id} value={id}>
                      {`${rowBeerName(row)} (${rowYear(row) || "-"}) - ${rowSourceLabel(row)}`}
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="editor-actions-group">
              <button type="button" className="editor-button editor-button-secondary" onClick={() => setShowQuickSelect(false)}>
                Annuleren
              </button>
              <button
                type="button"
                className="cpq-button cpq-button-primary"
                disabled={!quickSelectId}
                onClick={() => {
                  if (quickSelectId) setSelectedSourceId(quickSelectId);
                }}
              >
                Factuur toevoegen
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>Bier</th>
              <th>Jaar</th>
              <th>Stijl</th>
              <th>Bron</th>
              <th>Kostprijs</th>
              <th>Versies</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sourceRows.length === 0 ? (
              <tr>
                <td className="dataset-empty" colSpan={7}>
                  Nog geen actieve inkoopkostprijzen gevonden.
                </td>
              </tr>
            ) : null}
            {sourceRows.map((row) => {
              const id = String((row as any)?.id ?? "").trim();
              const basis = rowBasis(row);
              const versions = versionsBySourceId.get(id) ?? [];
              const expanded = expandedId === id;
              return (
                <Fragment key={id}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setExpandedId(expanded ? "" : id)}
                        aria-expanded={expanded}
                      >
                        {expanded ? "v" : ">"} {rowBeerName(row)}
                      </button>
                    </td>
                    <td>{rowYear(row) || "-"}</td>
                    <td>{String((basis as any)?.stijl ?? "-")}</td>
                    <td>{rowSourceLabel(row)}</td>
                    <td>{formatCurrencyDisplay(rowCost(row))}</td>
                    <td>{versions.length}</td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="cpq-button cpq-button-primary" onClick={() => setSelectedSourceId(id)}>
                        Factuur toevoegen
                      </button>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr key={`${id}-versions`}>
                      <td colSpan={7}>
                        <div className="data-table nested-table">
                          <table>
                            <thead>
                              <tr>
                                <th>Versie</th>
                                <th>Status</th>
                                <th>Factuur</th>
                                <th>Laatst gewijzigd</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {versions.length === 0 ? (
                                <tr>
                                  <td className="dataset-empty" colSpan={5}>
                                    Nog geen factuurversies voor deze kostprijs.
                                  </td>
                                </tr>
                              ) : null}
                              {versions.map((version) => {
                                const versionId = String((version as any)?.id ?? "").trim();
                                const isActive = activeVersionIds.has(versionId);
                                return (
                                  <tr key={versionId}>
                                    <td>{`v${Number((version as any)?.versie_nummer ?? 0) || 1}`}</td>
                                    <td>
                                      <span className={`status-pill ${isActive ? "status-ok" : "status-warning"}`}>
                                        {isActive ? "actief" : String((version as any)?.status ?? "-")}
                                      </span>
                                    </td>
                                    <td>{rowSourceLabel(version)}</td>
                                    <td>{String((version as any)?.updated_at ?? "-")}</td>
                                    <td style={{ textAlign: "right" }}>
                                      <div className="editor-actions-group" style={{ justifyContent: "flex-end" }}>
                                        <button
                                          type="button"
                                          className="editor-button editor-button-secondary"
                                          onClick={() => setViewVersionId(versionId)}
                                        >
                                          Openen
                                        </button>
                                        <button
                                          type="button"
                                          className="icon-button-table"
                                          aria-label="Factuurversie verwijderen"
                                          title={isActive ? "Actieve versies kun je niet verwijderen." : "Factuurversie verwijderen"}
                                          disabled={isActive || deletingId === versionId}
                                          onClick={() => void deleteVersion(version)}
                                        >
                                          <TrashIcon />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {status ? (
        <div className={`editor-status wizard-inline-status${statusTone ? ` ${statusTone}` : ""}`}>{status}</div>
      ) : null}
    </section>
  );
}
