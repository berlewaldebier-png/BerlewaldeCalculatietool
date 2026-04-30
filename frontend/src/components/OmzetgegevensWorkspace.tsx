"use client";

import { useEffect, useMemo, useState } from "react";

import { formatMoneyEUR } from "@/lib/formatters";

type Row = {
  company_id: number;
  company_name: string;
  omzet_ex: number;
  korting_ex: number;
  charges_ex: number;
  netto_omzet_ex: number;
  kostprijs_ex: number;
  brutomarge_ex: number;
  lines: number;
  unmapped_lines: number;
  ignored_lines?: number;
  missing_cost_lines: number;
};

type SortKey =
  | "company_name"
  | "omzet_ex"
  | "korting_ex"
  | "charges_ex"
  | "netto_omzet_ex"
  | "kostprijs_ex"
  | "brutomarge_ex"
  | "lines"
  | "unmapped_lines"
  | "ignored_lines"
  | "missing_cost_lines";

async function readJson(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return payload;
}

function euro(value: number) {
  if (!Number.isFinite(value)) return "-";
  return formatMoneyEUR(value);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function SortButton({
  label,
  active,
  dir,
  onClick
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Sorteren"
      style={{
        appearance: "none",
        background: "transparent",
        border: 0,
        padding: 0,
        margin: 0,
        font: "inherit",
        fontWeight: active ? 800 : 700,
        color: "inherit",
        cursor: "pointer",
        textDecoration: "none",
        opacity: active ? 1 : 0.9
      }}
    >
      {label}
      {active ? (dir === "asc" ? " ▲" : " ▼") : ""}
    </button>
  );
}

function buildPageItems(current: number, total: number) {
  const clamp = (value: number) => Math.min(Math.max(1, value), total);
  const c = clamp(current);
  const items: Array<number | "..."> = [];
  if (total <= 1) return [1];
  items.push(1);

  const windowStart = Math.max(2, c - 2);
  const windowEnd = Math.min(total - 1, c + 2);
  if (windowStart > 2) items.push("...");
  for (let p = windowStart; p <= windowEnd; p += 1) items.push(p);
  if (windowEnd < total - 1) items.push("...");
  items.push(total);
  return items;
}

export function OmzetgegevensWorkspace({ availableYears = [] }: { availableYears?: number[] }) {
  const [since, setSince] = useState<string>("");
  const [year, setYear] = useState<number>(0);
  const [basis, setBasis] = useState<"invoice" | "order">("invoice");

  const [query, setQuery] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  const [sortKey, setSortKey] = useState<SortKey>("netto_omzet_ex");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [rows, setRows] = useState<Row[]>([]);

  async function load() {
    setStatus("Laden…");
    setTone("");
    try {
      const params = new URLSearchParams();
      if (since.trim()) params.set("since", since.trim());
      if (year > 0) params.set("year", String(year));
      params.set("basis", basis);
      params.set("limit", "5000");
      const qs = params.toString() ? `?${params.toString()}` : "";
      const payload = await readJson(`/api/integrations/douano/margin-summary${qs}`);
      setRows(Array.isArray(payload?.items) ? payload.items : []);
      setPage(1);
      setStatus("Gereed");
      setTone("success");
    } catch (error) {
      setRows([]);
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis]);

  useEffect(() => {
    setPage(1);
  }, [query, pageSize, sortKey, sortDir, year, since]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.omzet += Number(row.omzet_ex ?? 0) || 0;
        acc.netto += Number(row.netto_omzet_ex ?? 0) || 0;
        acc.kostprijs += Number(row.kostprijs_ex ?? 0) || 0;
        acc.marge += Number(row.brutomarge_ex ?? 0) || 0;
        acc.unmapped += Number(row.unmapped_lines ?? 0) || 0;
        acc.missing_cost += Number(row.missing_cost_lines ?? 0) || 0;
        return acc;
      },
      { omzet: 0, netto: 0, kostprijs: 0, marge: 0, unmapped: 0, missing_cost: 0 }
    );
  }, [rows]);

  const normalizedQuery = normalizeText(query);

  const filteredSorted = useMemo(() => {
    const filtered = normalizedQuery
      ? rows.filter((row) => normalizeText(row.company_name).includes(normalizedQuery))
      : rows.slice();

    const dir = sortDir === "asc" ? 1 : -1;
    const key = sortKey;
    filtered.sort((a, b) => {
      if (key === "company_name") {
        return normalizeText(a.company_name).localeCompare(normalizeText(b.company_name)) * dir;
      }
      const av = Number((a as any)[key] ?? 0) || 0;
      const bv = Number((b as any)[key] ?? 0) || 0;
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * dir;
    });
    return filtered;
  }, [normalizedQuery, rows, sortDir, sortKey]);

  const safePageSize = Math.max(1, Math.min(Number(pageSize || 20) || 20, 5000));
  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pageRows = useMemo(() => {
    const start = (currentPage - 1) * safePageSize;
    return filteredSorted.slice(start, start + safePageSize);
  }, [currentPage, filteredSorted, safePageSize]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir(nextKey === "company_name" ? "asc" : "desc");
  }

  return (
    <section>
      <div className="editor-actions" style={{ marginTop: 8 }}>
        <div className="editor-actions-group">
          <select
            className="editor-input"
            style={{ width: 180 }}
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value || 0) || 0)}
            aria-label="Jaarfilter"
          >
            <option value="0">Alle jaren</option>
            {availableYears.slice().reverse().map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>

          <select
            className="editor-input"
            style={{ width: 180 }}
            value={basis}
            onChange={(e) => setBasis((e.target.value as any) === "order" ? "order" : "invoice")}
            aria-label="Basis"
            title="Douano export gebruikt factuurdatum (invoice)"
          >
            <option value="invoice">Factuurdatum</option>
            <option value="order">Orderdatum</option>
          </select>

          <input
            className="editor-input"
            style={{ width: 220 }}
            placeholder="Zoek klant (naam)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <select
            className="editor-input"
            style={{ width: 140 }}
            value={String(pageSize)}
            onChange={(e) => setPageSize(Math.max(1, Math.min(Number(e.target.value || 20) || 20, 5000)))}
            aria-label="Per pagina"
            title="Aantal klanten per pagina"
          >
            {[20, 50, 100, 200, 500, 1000, 2000, 5000].map((n) => (
              <option key={n} value={String(n)}>
                {n} / pagina
              </option>
            ))}
          </select>

          <input
            className="editor-input"
            style={{ width: 180 }}
            placeholder="Sinds (YYYY-MM-DD)"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />

          <button type="button" className="editor-button editor-button-secondary" onClick={() => void load()}>
            Ververs
          </button>
        </div>

        <div className="editor-actions-group">
          <span className="pill">Omzet {euro(totals.omzet)}</span>
          <span className="pill">Netto {euro(totals.netto)}</span>
          <span className="pill">Kostprijs {euro(totals.kostprijs)}</span>
          <span className="pill">Marge {euro(totals.marge)}</span>
        </div>
      </div>

      {status ? (
        <div className={`editor-status${tone ? ` ${tone}` : ""}`} style={{ marginTop: 12 }}>
          {status}
        </div>
      ) : null}

      <div className="data-table" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>
                <SortButton
                  label="Klant"
                  active={sortKey === "company_name"}
                  dir={sortDir}
                  onClick={() => toggleSort("company_name")}
                />
              </th>
              <th style={{ width: 150 }}>
                <SortButton label="Omzet" active={sortKey === "omzet_ex"} dir={sortDir} onClick={() => toggleSort("omzet_ex")} />
              </th>
              <th style={{ width: 150 }}>
                <SortButton
                  label="Kortingen"
                  active={sortKey === "korting_ex"}
                  dir={sortDir}
                  onClick={() => toggleSort("korting_ex")}
                />
              </th>
              <th style={{ width: 150 }}>
                <SortButton
                  label="Charges"
                  active={sortKey === "charges_ex"}
                  dir={sortDir}
                  onClick={() => toggleSort("charges_ex")}
                />
              </th>
              <th style={{ width: 160 }}>
                <SortButton
                  label="Netto omzet"
                  active={sortKey === "netto_omzet_ex"}
                  dir={sortDir}
                  onClick={() => toggleSort("netto_omzet_ex")}
                />
              </th>
              <th style={{ width: 150 }}>
                <SortButton
                  label="Kostprijs"
                  active={sortKey === "kostprijs_ex"}
                  dir={sortDir}
                  onClick={() => toggleSort("kostprijs_ex")}
                />
              </th>
              <th style={{ width: 150 }}>
                <SortButton
                  label="Brutomarge"
                  active={sortKey === "brutomarge_ex"}
                  dir={sortDir}
                  onClick={() => toggleSort("brutomarge_ex")}
                />
              </th>
              <th style={{ width: 100 }}>
                <SortButton label="Regels" active={sortKey === "lines"} dir={sortDir} onClick={() => toggleSort("lines")} />
              </th>
              <th style={{ width: 120 }}>
                <SortButton
                  label="Unmapped"
                  active={sortKey === "unmapped_lines"}
                  dir={sortDir}
                  onClick={() => toggleSort("unmapped_lines")}
                />
              </th>
              <th style={{ width: 110 }}>
                <SortButton
                  label="Ignored"
                  active={sortKey === "ignored_lines"}
                  dir={sortDir}
                  onClick={() => toggleSort("ignored_lines")}
                />
              </th>
              <th style={{ width: 130 }}>
                <SortButton
                  label="Missing cost"
                  active={sortKey === "missing_cost_lines"}
                  dir={sortDir}
                  onClick={() => toggleSort("missing_cost_lines")}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.company_id}>
                <td>
                  <a
                    href={`/omzet-en-marge/${encodeURIComponent(String(row.company_id))}?basis=${encodeURIComponent(basis)}`}
                    style={{ color: "inherit", textDecoration: "none", fontWeight: 700 }}
                    title="Open details"
                  >
                    {row.company_name || String(row.company_id)}
                  </a>
                </td>
                <td>{euro(row.omzet_ex)}</td>
                <td>{euro(row.korting_ex)}</td>
                <td>{euro(row.charges_ex)}</td>
                <td>{euro(row.netto_omzet_ex)}</td>
                <td>{euro(row.kostprijs_ex)}</td>
                <td>{euro(row.brutomarge_ex)}</td>
                <td>{row.lines}</td>
                <td>
                  {row.unmapped_lines > 0 ? (
                    <a
                      href={`/omzet-en-marge/${encodeURIComponent(String(row.company_id))}?only_unmapped=true&basis=${encodeURIComponent(basis)}`}
                      className="pill"
                      style={{ textDecoration: "none" }}
                      title="Bekijk unmapped regels"
                    >
                      {row.unmapped_lines}
                    </a>
                  ) : (
                    row.unmapped_lines
                  )}
                </td>
                <td>{Number(row.ignored_lines ?? 0) || 0}</td>
                <td>
                  {row.missing_cost_lines > 0 ? (
                    <a
                      href={`/omzet-en-marge/${encodeURIComponent(String(row.company_id))}?only_missing_cost=true&basis=${encodeURIComponent(basis)}`}
                      className="pill"
                      style={{ textDecoration: "none" }}
                      title="Bekijk regels zonder kostprijs"
                    >
                      {row.missing_cost_lines}
                    </a>
                  ) : (
                    row.missing_cost_lines
                  )}
                </td>
              </tr>
            ))}
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ opacity: 0.75 }}>
                  Geen resultaten.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          marginTop: 10
        }}
      >
        <div style={{ opacity: 0.85 }}>
          {filteredSorted.length ? (
            <span>
              Showing {(currentPage - 1) * safePageSize + 1} to{" "}
              {Math.min(currentPage * safePageSize, filteredSorted.length)} of {filteredSorted.length} entries
            </span>
          ) : (
            <span>Showing 0 entries</span>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
          {currentPage > 1 ? (
            <button
              type="button"
              className="editor-button editor-button-secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Vorige
            </button>
          ) : null}

          {buildPageItems(currentPage, totalPages).map((item, idx) =>
            item === "..." ? (
              <span key={`ellipsis-${idx}`} style={{ padding: "6px 8px", opacity: 0.7 }}>
                …
              </span>
            ) : (
              <button
                key={`page-${item}`}
                type="button"
                className={item === currentPage ? "editor-button" : "editor-button editor-button-secondary"}
                onClick={() => setPage(item)}
              >
                {item}
              </button>
            )
          )}

          {currentPage < totalPages ? (
            <button
              type="button"
              className="editor-button editor-button-secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Volgende
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
