"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type SortDir = "asc" | "desc";

export type DataTableProColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  width?: string;
  headerTitle?: string;
};

export type DataTableProProps<T> = {
  rows: T[];
  columns: Array<DataTableProColumn<T>>;
  getRowKey?: (row: T, index: number) => string;

  initialSortKey?: string;
  initialSortDir?: SortDir;
  initialPageSize?: number;
  pageSizeOptions?: number[];
  maxPageSize?: number;

  query?: string;
  onQueryChange?: (value: string) => void;
  queryPlaceholder?: string;
  queryFilter?: (row: T, normalizedQuery: string) => boolean;

  emptyState?: ReactNode;
  footerLeft?: ReactNode;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
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

function SortButton({
  label,
  active,
  dir,
  onClick,
  title
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || "Sorteren"}
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

export function DataTablePro<T>({
  rows,
  columns,
  getRowKey,
  initialSortKey,
  initialSortDir = "desc",
  initialPageSize = 20,
  pageSizeOptions = [20, 50, 100, 200, 500, 1000],
  maxPageSize = 5000,
  query,
  onQueryChange,
  queryPlaceholder = "Zoeken…",
  queryFilter,
  emptyState,
  footerLeft
}: DataTableProProps<T>) {
  const sortableKeys = useMemo(() => new Set(columns.map((c) => c.key)), [columns]);
  const defaultSortKey = initialSortKey && sortableKeys.has(initialSortKey) ? initialSortKey : columns[0]?.key || "";

  const [internalQuery, setInternalQuery] = useState<string>(query ?? "");
  const effectiveQuery = query ?? internalQuery;

  const [pageSize, setPageSize] = useState<number>(
    Math.max(1, Math.min(Number(initialPageSize || 20) || 20, maxPageSize))
  );
  const [page, setPage] = useState<number>(1);
  const [sortKey, setSortKey] = useState<string>(defaultSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);

  useEffect(() => {
    if (query !== undefined) setInternalQuery(query);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [effectiveQuery, pageSize, sortKey, sortDir, rows]);

  const normalizedQuery = useMemo(() => normalizeText(effectiveQuery), [effectiveQuery]);

  const filteredSorted = useMemo(() => {
    const q = normalizedQuery;
    const filtered = q
      ? rows.filter((row) => (queryFilter ? queryFilter(row, q) : normalizeText(row).includes(q)))
      : rows.slice();

    const column = columns.find((c) => c.key === sortKey);
    const dir = sortDir === "asc" ? 1 : -1;
    if (!column) return filtered;

    filtered.sort((a, b) => {
      if (!column.sortValue) return 0;
      const av = column.sortValue(a);
      const bv = column.sortValue(b);
      if (typeof av === "string" || typeof bv === "string") {
        return normalizeText(av).localeCompare(normalizeText(bv)) * dir;
      }
      const an = Number(av ?? 0) || 0;
      const bn = Number(bv ?? 0) || 0;
      if (an === bn) return 0;
      return (an < bn ? -1 : 1) * dir;
    });

    return filtered;
  }, [columns, normalizedQuery, queryFilter, rows, sortDir, sortKey]);

  const safePageSize = Math.max(1, Math.min(Number(pageSize || 20) || 20, maxPageSize));
  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pageRows = useMemo(() => {
    const start = (currentPage - 1) * safePageSize;
    return filteredSorted.slice(start, start + safePageSize);
  }, [currentPage, filteredSorted, safePageSize]);

  function toggleSort(nextKey: string) {
    if (!sortableKeys.has(nextKey)) return;
    if (sortKey === nextKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    const isText = typeof columns.find((c) => c.key === nextKey)?.sortValue?.(rows[0] as any) === "string";
    setSortDir(isText ? "asc" : "desc");
  }

  const startEntry = filteredSorted.length ? (currentPage - 1) * safePageSize + 1 : 0;
  const endEntry = filteredSorted.length ? Math.min(currentPage * safePageSize, filteredSorted.length) : 0;

  const showPrev = currentPage > 1;
  const showNext = currentPage < totalPages;

  const canSearch = Boolean(onQueryChange) || query !== undefined;

  const resolvedEmpty =
    emptyState ?? (
      <tr>
        <td colSpan={columns.length} style={{ opacity: 0.75 }}>
          Geen resultaten.
        </td>
      </tr>
    );

  return (
    <section>
      {canSearch || pageSizeOptions.length ? (
        <div className="editor-actions" style={{ marginTop: 8 }}>
          <div className="editor-actions-group">
            {canSearch ? (
              <input
                className="editor-input"
                style={{ width: 240 }}
                placeholder={queryPlaceholder}
                value={effectiveQuery}
                onChange={(e) => {
                  const next = e.target.value;
                  if (onQueryChange) onQueryChange(next);
                  else setInternalQuery(next);
                }}
              />
            ) : null}
            {pageSizeOptions.length ? (
              <select
                className="editor-input"
                style={{ width: 160 }}
                value={String(pageSize)}
                onChange={(e) => setPageSize(Math.max(1, Math.min(Number(e.target.value || initialPageSize) || initialPageSize, maxPageSize)))}
                aria-label="Per pagina"
                title="Aantal regels per pagina"
              >
                {pageSizeOptions.map((n) => (
                  <option key={n} value={String(n)}>
                    {n} / pagina
                  </option>
                ))}
                {!pageSizeOptions.includes(maxPageSize) ? (
                  <option value={String(maxPageSize)}>{maxPageSize} / pagina</option>
                ) : null}
              </select>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="data-table" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              {columns.map((col) => {
                const isActive = sortKey === col.key;
                const sortable = Boolean(col.sortValue);
                const align = col.align ?? "left";
                return (
                  <th key={col.key} style={{ width: col.width, textAlign: align }}>
                    {sortable ? (
                      <SortButton
                        label={col.header}
                        active={isActive}
                        dir={sortDir}
                        onClick={() => toggleSort(col.key)}
                        title={col.headerTitle || "Sorteren"}
                      />
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              resolvedEmpty
            ) : (
              pageRows.map((row, index) => (
                <tr key={getRowKey ? getRowKey(row, index) : String(index)}>
                  {columns.map((col) => {
                    const align = col.align ?? "left";
                    return (
                      <td key={col.key} style={{ textAlign: align }}>
                        {col.render(row)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
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
          {footerLeft ?? (
            <span>
              Showing {startEntry} to {endEntry} of {filteredSorted.length} entries
            </span>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
          {showPrev ? (
            <button type="button" className="editor-button editor-button-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))}>
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

          {showNext ? (
            <button type="button" className="editor-button editor-button-secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              Volgende
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
