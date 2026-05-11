"use client";

import { useMemo, useState, useEffect } from "react";
import { toNumber } from "@/components/producten-verpakking/productenVerpakkingUtils";
import { PageSizeSelect, PaginationBar, SortButton, type PageSizeValue } from "@/components/table/TableControls";
import { clampPage, compareText, computeTotalPages, slicePage } from "@/lib/tableControls";

type GenericRecord = Record<string, unknown>;

export function YearPricesTab({
  packagingMasters,
  availablePriceYears,
  activeYearForPrices,
  setYearPricesYear,
  yearPricesDraft,
  setYearPricesDraft,
  isSavingYearPrices,
  handleSaveYearPricesLayer,
  yearPricesStatus,
}: {
  packagingMasters: GenericRecord[];
  availablePriceYears: number[];
  activeYearForPrices: number;
  setYearPricesYear: (next: number) => void;
  yearPricesDraft: Record<string, number>;
  setYearPricesDraft: (updater: (current: Record<string, number>) => Record<string, number>) => void;
  isSavingYearPrices: boolean;
  handleSaveYearPricesLayer: () => Promise<void>;
  yearPricesStatus: string;
}) {
  const [pageSize, setPageSize] = useState<PageSizeValue>(20);
  const [page, setPage] = useState(1);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    setPage(1);
  }, [activeYearForPrices, pageSize, sortDir]);

  const sortedMasters = useMemo(() => {
    const copy = [...packagingMasters];
    copy.sort((a, b) => {
      const al = String((a as any)?.omschrijving ?? (a as any)?.id ?? "");
      const bl = String((b as any)?.omschrijving ?? (b as any)?.id ?? "");
      return compareText(al, bl, sortDir);
    });
    return copy;
  }, [packagingMasters, sortDir]);

  const totalPages = useMemo(() => computeTotalPages(sortedMasters.length, pageSize), [pageSize, sortedMasters.length]);
  const currentPage = clampPage(page, totalPages);
  useEffect(() => {
    if (currentPage !== page) setPage(currentPage);
  }, [currentPage, page]);

  const pageRows = useMemo(() => slicePage(sortedMasters, currentPage, pageSize), [currentPage, pageSize, sortedMasters]);

  return (
    <div className="content-card">
      <div className="module-card-header">
        <div className="module-card-title">Jaarprijzen</div>
        <div className="module-card-text">Beheer per jaar de prijs per stuk voor alle verpakkingsonderdelen.</div>
      </div>

      {packagingMasters.length === 0 ? (
        <div className="editor-status" style={{ marginTop: 12 }}>
          Voeg eerst verpakkingsonderdelen toe. Daarna kun je jaarprijzen invullen.
        </div>
      ) : (
        <>
          <div className="wizard-form-grid" style={{ marginTop: 12 }}>
            <label className="nested-field" style={{ maxWidth: 220 }}>
              <span>Jaar</span>
              <select
                className="dataset-input"
                value={String(activeYearForPrices)}
                onChange={(e) => setYearPricesYear(Number(e.target.value))}
              >
                {availablePriceYears.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </label>

          </div>

          <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
            <table className="dataset-editor-table wizard-table-compact wizard-table-fit">
              <thead>
                <tr>
                  <th>
                    <SortButton
                      label="Onderdeel"
                      active
                      dir={sortDir}
                      onClick={() => setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))}
                    />
                  </th>
                  <th style={{ width: 180 }}>Prijs per stuk</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const id = String((row as any)?.id ?? "").trim();
                  const label = String((row as any)?.omschrijving ?? "").trim() || id;
                  return (
                    <tr key={id}>
                      <td>{label}</td>
                      <td>
                        <input
                          className="dataset-input"
                          type="number"
                          step="0.01"
                          value={String(yearPricesDraft[id] ?? 0)}
                          onChange={(e) =>
                            setYearPricesDraft((current) => ({
                              ...current,
                              [id]: toNumber(e.target.value, 0),
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ opacity: 0.75 }}>
              Pagina {currentPage} / {totalPages} (totaal {sortedMasters.length} onderdelen)
            </div>
            <div style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
              <PageSizeSelect value={pageSize} onChange={setPageSize} title="Aantal regels per pagina" />
              <PaginationBar page={currentPage} totalPages={totalPages} onChange={setPage} />
            </div>
          </div>

          <div className="editor-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="editor-button"
              disabled={isSavingYearPrices}
              onClick={() => void handleSaveYearPricesLayer()}
            >
              {isSavingYearPrices ? "Opslaan..." : "Opslaan"}
            </button>
            {yearPricesStatus ? <span className="editor-status">{yearPricesStatus}</span> : null}
          </div>
        </>
      )}
    </div>
  );
}

