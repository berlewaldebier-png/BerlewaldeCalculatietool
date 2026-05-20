"use client";

import type { SummaryProductRow } from "@/lib/kostprijsSnapshotEngine";

type GenericRecord = Record<string, unknown>;
type BerekeningSubjectType = "bier" | "artikel" | "dienst";

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function SummaryStep({
  current,
  buildResultaatSnapshot,
  formatCurrencyDisplay,
  formatDecimalValue,
  enabledFormatIds,
  onToggleFormat,
}: {
  current: GenericRecord;
  buildResultaatSnapshot: (row: GenericRecord) => any;
  formatCurrencyDisplay: (value: unknown) => string;
  formatDecimalValue: (value: number | null | undefined, digits?: number) => string;
  enabledFormatIds: string[] | null;
  onToggleFormat: (formatId: string, enabled: boolean) => void;
}) {
  const snapshot = buildResultaatSnapshot(current);
  const basisproductenRows = snapshot.producten.basisproducten;
  const samengesteldeRows = snapshot.producten.samengestelde_producten;
  const basis = (current.basisgegevens as GenericRecord) ?? {};
  const subjectType = (String((basis as any).sku_type ?? "bier").trim() || "bier") as BerekeningSubjectType;
  const uom = String((basis as any).uom ?? "").trim();
  const soort = String((((current as any).soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
  const inkoop = (((current.invoer as GenericRecord) as any).inkoop as GenericRecord) ?? {};
  const factuurregels = Array.isArray((inkoop as any).factuurregels) ? ((inkoop as any).factuurregels as GenericRecord[]) : [];
  const totaalFactuurbedrag = factuurregels.reduce((sum, regel) => sum + Number((regel as any).subfactuurbedrag ?? 0), 0);
  const totaalExtraKosten = Number((inkoop as any).verzendkosten ?? 0) + Number((inkoop as any).overige_kosten ?? 0);
  const totaalAantal = factuurregels.reduce((sum, regel) => sum + Number((regel as any).aantal ?? 0), 0);
  const gemiddeldePrijsPerEenheid = totaalAantal > 0 ? (totaalFactuurbedrag + totaalExtraKosten) / totaalAantal : 0;

  return (
    <div className="wizard-stack">
      <div className="stats-grid wizard-stats-grid">
        {(subjectType !== "bier"
          ? ([
              [`Kostprijs / ${uom || "eenheid"}`, formatCurrencyDisplay(gemiddeldePrijsPerEenheid)],
              ["Extra kosten", formatCurrencyDisplay(totaalExtraKosten)],
              ["Factuurbedragen", formatCurrencyDisplay(totaalFactuurbedrag)],
            ] as [string, unknown][])
          : ([
              ["Integrale kostprijs / L", snapshot.integrale_kostprijs_per_liter],
              ["Variabele kosten / L", snapshot.variabele_kosten_per_liter],
              [
                soort === "Inkoop" ? "Indirecte vaste kosten / L" : "Directe vaste kosten / L",
                snapshot.directe_vaste_kosten_per_liter,
              ],
            ] as [string, unknown][])).map(([label, value]) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value small">{String(value ?? "-")}</div>
          </div>
        ))}
      </div>
      {subjectType !== "bier" ? (
        <div className="module-card compact-card">
          <div className="module-card-title">Samenvatting</div>
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Artikel</th>
                  <th>Soort</th>
                  <th>Eenheid</th>
                  <th>Inkoop</th>
                  <th>Verpakkingskosten</th>
                  <th>Opslag direct/indirect</th>
                  <th>Accijns</th>
                  <th>Kostprijs</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{String((basis as any).biernaam ?? "-")}</td>
                  <td>Inkoop</td>
                  <td>{uom || "-"}</td>
                  <td>{formatCurrencyDisplay(gemiddeldePrijsPerEenheid)}</td>
                  <td>{formatCurrencyDisplay(0)}</td>
                  <td>{formatCurrencyDisplay(0)}</td>
                  <td>{formatCurrencyDisplay(0)}</td>
                  <td>{formatCurrencyDisplay(gemiddeldePrijsPerEenheid)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        (
          [
            ["Basisproducten", basisproductenRows],
            ["Samengestelde producten", samengesteldeRows],
          ] as [string, SummaryProductRow[]][]
        ).map(([label, records]) => (
          <div key={label} className="module-card compact-card">
            <div className="module-card-title">{label}</div>
            <div className="data-table">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 46 }} title="Meenemen in activatie/offertes">
                      Zichtbaar
                    </th>
                    <th>Biernaam</th>
                    <th>Soort</th>
                    <th>Verpakkingseenheid</th>
                    <th>{soort === "Inkoop" ? "Inkoop" : "Ingredienten"}</th>
                    <th>Verpakkingskosten</th>
                    <th>{soort === "Inkoop" ? "Indirecte kosten" : "Directe kosten"}</th>
                    <th>Accijns</th>
                    <th>Kostprijs</th>
                  </tr>
                </thead>
                <tbody>
                  {records.length === 0 ? (
                    <tr>
                      <td className="dataset-empty" colSpan={9}>
                        {soort === "Inkoop"
                          ? "Er zijn nog geen producten opgebouwd vanuit de huidige inkoopinvoer."
                          : "Er zijn nog geen producten opgebouwd vanuit het huidige recept en de verpakkingselectie."}
                      </td>
                    </tr>
                  ) : null}
                  {records.map((row, index) => (
                    <tr key={`${String((row as any).verpakkingseenheid ?? index)}-${index}`}>
                      <td>
                        {(() => {
                          const formatId = String((row as any).product_id ?? "").trim();
                          const isEnabled = enabledFormatIds ? enabledFormatIds.includes(formatId) : true;
                          const canToggle = Boolean(formatId);
                          return (
                            <button
                              type="button"
                              className={`visibility-toggle-button ${isEnabled ? "is-included" : "is-excluded"}`}
                              disabled={!canToggle}
                              title={
                                isEnabled
                                  ? "Wordt geactiveerd en is zichtbaar/selecteerbaar in o.a. offertes."
                                  : "Krijgt geen kostprijs en is niet selecteerbaar in o.a. offertes."
                              }
                              onClick={() => {
                                if (!formatId) return;
                                onToggleFormat(formatId, !isEnabled);
                              }}
                            >
                              <span className="visibility-toggle-icon">
                                {isEnabled ? <EyeIcon /> : <EyeOffIcon />}
                              </span>
                            </button>
                          );
                        })()}
                      </td>
                      <td>{String((row as any).biernaam ?? "-")}</td>
                      <td>{String((row as any).soort ?? "-")}</td>
                      <td>{String((row as any).verpakkingseenheid ?? "-")}</td>
                      <td>{formatCurrencyDisplay((row as any).primaire_kosten)}</td>
                      <td>{formatCurrencyDisplay((row as any).verpakkingskosten)}</td>
                      <td>{formatCurrencyDisplay((row as any).vaste_kosten)}</td>
                      <td>{formatCurrencyDisplay((row as any).accijns)}</td>
                      <td>{formatCurrencyDisplay((row as any).kostprijs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
