"use client";

import type { SummaryProductRow } from "@/lib/kostprijsSnapshotEngine";
import { normalizeUnitLabel } from "@/lib/skuLabels";

type GenericRecord = Record<string, unknown>;
type BerekeningSubjectType = "bier" | "artikel" | "dienst";

function ArrowDownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

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

function cleanUnitLabel(label: unknown, beerName: unknown) {
  const raw = normalizeUnitLabel(label);
  const beer = String(beerName ?? "").trim();
  if (!raw) return "-";
  if (!beer) return raw;
  const escaped = beer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return raw
    .replace(new RegExp(`^${escaped}\\s*[-–—:]?\\s*`, "i"), "")
    .replace(/\s{2,}/g, " ")
    .trim() || raw;
}

function asRecord(value: unknown): GenericRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as GenericRecord) : {};
}

function rowProductKey(row: SummaryProductRow) {
  const productId = String((row as any).product_id ?? "").trim();
  if (productId) return `product:${productId}`;
  const unit = String((row as any).verpakkingseenheid ?? (row as any).verpakking ?? "").trim();
  return unit ? `unit:${unit}` : "";
}

function mergeStoredAmountsIntoLiveRows(liveRows: SummaryProductRow[], storedRows: SummaryProductRow[]) {
  const storedByProduct = new Map<string, SummaryProductRow>();
  storedRows.forEach((row) => {
    const key = rowProductKey(row);
    if (key && !storedByProduct.has(key)) {
      storedByProduct.set(key, row);
    }
  });

  const amountFields = [
    "primaire_kosten",
    "verpakkingskosten",
    "vaste_kosten",
    "manufacturing_overhead",
    "business_overhead",
    "overhead_breakdown",
    "accijns",
    "kostprijs",
  ];

  return liveRows.map((row) => {
    const stored = storedByProduct.get(rowProductKey(row));
    if (!stored) return row;
    const merged = { ...row } as GenericRecord;
    amountFields.forEach((field) => {
      if ((stored as any)[field] !== undefined) {
        merged[field] = (stored as any)[field];
      }
    });
    return merged as SummaryProductRow;
  });
}

function mergeStoredAmountsAndAppendMissingRows(liveRows: SummaryProductRow[], storedRows: SummaryProductRow[]) {
  const mergedRows = mergeStoredAmountsIntoLiveRows(liveRows, storedRows);
  const liveKeys = new Set(mergedRows.map(rowProductKey).filter(Boolean));
  const missingStoredRows = storedRows.filter((row) => {
    const key = rowProductKey(row);
    return key && !liveKeys.has(key);
  });
  return [...mergedRows, ...missingStoredRows];
}

function filterRowsByProductKeys(rows: SummaryProductRow[], excludedKeys: Set<string>) {
  return rows.filter((row) => {
    const key = rowProductKey(row);
    return !key || !excludedKeys.has(key);
  });
}

function getCanonicalSnapshot(current: GenericRecord, buildResultaatSnapshot: (row: GenericRecord) => any) {
  const liveSnapshot = buildResultaatSnapshot(current);
  const status = String((current as any).status ?? "").trim().toLowerCase();
  const costLinesRaw = (current as any).cost_lines ?? (current as any).costLines ?? [];
  const costLines = Array.isArray(costLinesRaw) ? (costLinesRaw as SummaryProductRow[]) : [];

  if (status !== "definitief" || costLines.length === 0) {
    return liveSnapshot;
  }

  const storedSnapshot = asRecord((current as any).resultaat_snapshot);
  const storedProducts = asRecord((storedSnapshot as any).producten);
  const storedBasisRows = Array.isArray((storedProducts as any).basisproducten)
    ? ((storedProducts as any).basisproducten as SummaryProductRow[])
    : [];
  const storedCompositeRows = Array.isArray((storedProducts as any).samengestelde_producten)
    ? ((storedProducts as any).samengestelde_producten as SummaryProductRow[])
    : [];
  const storedBasisSourceRows = storedBasisRows.length > 0 ? storedBasisRows : costLines;
  const liveProducts = asRecord((liveSnapshot as any).producten);
  const liveBasisRows = Array.isArray((liveProducts as any).basisproducten)
    ? ((liveProducts as any).basisproducten as SummaryProductRow[])
    : [];
  const liveCompositeRows = Array.isArray((liveProducts as any).samengestelde_producten)
    ? ((liveProducts as any).samengestelde_producten as SummaryProductRow[])
    : [];
  const liveBasisKeys = new Set(liveBasisRows.map(rowProductKey).filter(Boolean));
  const liveCompositeKeys = new Set(liveCompositeRows.map(rowProductKey).filter(Boolean));
  const storedBasisForBasis = filterRowsByProductKeys(storedBasisSourceRows, liveCompositeKeys);
  const storedCompositeForComposite = filterRowsByProductKeys(
    [...storedCompositeRows, ...storedBasisSourceRows.filter((row) => liveCompositeKeys.has(rowProductKey(row)))],
    liveBasisKeys
  );

  return {
    ...liveSnapshot,
    ...storedSnapshot,
    producten: {
      basisproducten:
        liveBasisRows.length > 0
          ? mergeStoredAmountsAndAppendMissingRows(liveBasisRows, storedBasisForBasis)
          : storedBasisForBasis,
      samengestelde_producten:
        liveCompositeRows.length > 0
          ? mergeStoredAmountsAndAppendMissingRows(liveCompositeRows, storedCompositeForComposite)
          : storedCompositeForComposite,
    },
  };
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
  const snapshot = getCanonicalSnapshot(current, buildResultaatSnapshot);
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

  function getOverheadCell(row: SummaryProductRow) {
    const manufacturing = Number((row as any).manufacturing_overhead ?? 0);
    const business = Number((row as any).business_overhead ?? 0);
    const hasBuckets =
      (row as any).manufacturing_overhead !== undefined || (row as any).business_overhead !== undefined;

    const legacy = Number((row as any).vaste_kosten ?? 0);
    const total = hasBuckets ? manufacturing + business : legacy;

    const breakdown = Array.isArray((row as any).overhead_breakdown) ? ((row as any).overhead_breakdown as any[]) : [];
    const breakdownText =
      breakdown.length > 0
        ? breakdown
            .map((line) => {
              const pool = String(line?.cost_pool ?? "").trim() || "Overhead";
              const driver = String(line?.allocation_driver ?? "").trim() || "LEGACY";
              const amount = Number(line?.amount ?? 0);
              return `${pool} (${driver}): ${formatCurrencyDisplay(amount)}`;
            })
            .join("\n")
        : "";

    const title = hasBuckets
      ? [
          `Productie-overhead: ${formatCurrencyDisplay(manufacturing)}`,
          `Business-overhead: ${formatCurrencyDisplay(business)}`,
          breakdownText ? "" : null,
          breakdownText || null,
        ]
          .filter((v) => typeof v === "string" && v.length > 0)
          .join("\n")
      : breakdownText;

    return { total, title, manufacturing, business, hasBuckets, breakdown };
  }

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
              snapshot.methodology_version === "abc_v1"
                ? ["All-in kostprijs / L", formatDecimalValue(snapshot.kostendekkend_per_liter, 2)]
                : ["Integrale kostprijs / L", formatDecimalValue(snapshot.integrale_kostprijs_per_liter, 2)],
              snapshot.methodology_version === "abc_v1"
                ? ["Voorraad-kostprijs / L", formatDecimalValue(snapshot.productkost_per_liter, 2)]
                : [
                    soort === "Inkoop" ? "Indirecte vaste kosten / L" : "Directe vaste kosten / L",
                    formatDecimalValue(snapshot.directe_vaste_kosten_per_liter, 2),
                  ],
              snapshot.methodology_version === "abc_v1"
                ? ["Productkosten / L", formatDecimalValue(snapshot.variabele_kosten_per_liter, 2)]
                : ["Variabele kosten / L", formatDecimalValue(snapshot.variabele_kosten_per_liter, 2)],
              snapshot.methodology_version === "abc_v1"
                ? ["Productie-overhead / L", formatDecimalValue(snapshot.manufacturing_overhead_per_liter, 2)]
                : null,
              snapshot.methodology_version === "abc_v1"
                ? ["Business-overhead / L", formatDecimalValue(snapshot.business_overhead_per_liter, 2)]
                : null,
            ]
              .filter(Boolean) as [string, unknown][])).map(([label, value]) => (
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
                  <th>Overhead</th>
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
                  <th>{snapshot.methodology_version === "abc_v1" ? "Overhead (ABC)" : soort === "Inkoop" ? "Indirecte kosten" : "Directe kosten"}</th>
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
                      <td>{cleanUnitLabel((row as any).verpakkingseenheid, (row as any).biernaam)}</td>
                      <td>{formatCurrencyDisplay((row as any).primaire_kosten)}</td>
                      <td>{formatCurrencyDisplay((row as any).verpakkingskosten)}</td>
                      {(() => {
                        const overhead = getOverheadCell(row);
                        const hasDetails = snapshot.methodology_version === "abc_v1" && overhead.hasBuckets;
                        const hasBreakdown = overhead.breakdown.length > 0;
                        if (!hasDetails || !hasBreakdown) {
                          return (
                            <td title={overhead.title || undefined}>
                              {formatCurrencyDisplay(overhead.total)}
                            </td>
                          );
                        }
                        return (
                          <td title={overhead.title || undefined}>
                            <details>
                              <summary style={{ cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" }}>
                                <span>{formatCurrencyDisplay(overhead.total)}</span>
                                <span style={{ opacity: 0.7 }} aria-hidden>
                                  <ArrowDownIcon />
                                </span>
                              </summary>
                              <div style={{ paddingTop: 8, minWidth: 240 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                                    <span>Productie-overhead</span>
                                    <span>{formatCurrencyDisplay(overhead.manufacturing)}</span>
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                                    <span>Business-overhead</span>
                                    <span>{formatCurrencyDisplay(overhead.business)}</span>
                                  </div>
                                </div>
                                <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 8 }}>
                                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>ABC breakdown</div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    {overhead.breakdown.map((line: any, idx: number) => {
                                      const pool = String(line?.cost_pool ?? "").trim() || "Overhead";
                                      const driver = String(line?.allocation_driver ?? "").trim() || "LEGACY";
                                      const amount = Number(line?.amount ?? 0);
                                      return (
                                        <div
                                          key={`${pool}-${driver}-${idx}`}
                                          style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                                        >
                                          <span>
                                            {pool} <span style={{ opacity: 0.7 }}>({driver})</span>
                                          </span>
                                          <span>{formatCurrencyDisplay(amount)}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            </details>
                          </td>
                        );
                      })()}
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
