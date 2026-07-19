"use client";

import type { SortDir } from "@/lib/tableControls";
import { buildPageItems, clampPage } from "@/lib/tableControls";

export function SortButton({
  label,
  active,
  dir,
  onClick,
  showInactiveIndicator = false,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  showInactiveIndicator?: boolean;
}) {
  const indicator = active ? (dir === "asc" ? "↑" : "↓") : "↕";
  const nextDirection = active && dir === "asc" ? "aflopend" : "oplopend";

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} ${nextDirection} sorteren`}
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
        opacity: active ? 1 : 0.9,
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
      }}
    >
      <span>{label}</span>
      {active || showInactiveIndicator ? (
        <span
          aria-hidden="true"
          data-sort-indicator={active ? dir : "none"}
          style={{ minWidth: "1em", opacity: active ? 1 : 0.62, textAlign: "center" }}
        >
          {indicator}
        </span>
      ) : null}
    </button>
  );
}

export type PageSizeValue = 5 | 10 | 20 | 50 | 100 | 0;

export const PAGE_SIZE_OPTIONS: Array<{ value: PageSizeValue; label: string }> = [
  { value: 5, label: "5" },
  { value: 10, label: "10" },
  { value: 20, label: "20" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
  { value: 0, label: "Alles" },
];

export function PageSizeSelect({
  value,
  onChange,
  ariaLabel = "Per pagina",
  title = "Aantal rijen per pagina",
}: {
  value: PageSizeValue;
  onChange: (next: PageSizeValue) => void;
  ariaLabel?: string;
  title?: string;
}) {
  return (
    <select
      className="editor-input"
      style={{ width: 140 }}
      value={String(value)}
      onChange={(e) => onChange((Number(e.target.value) as PageSizeValue) ?? 20)}
      aria-label={ariaLabel}
      title={title}
    >
      {PAGE_SIZE_OPTIONS.map((opt) => (
        <option key={String(opt.value)} value={String(opt.value)}>
          {opt.label === "Alles" ? "Alles" : `${opt.label} / pagina`}
        </option>
      ))}
    </select>
  );
}

export function PaginationBar({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) {
  const safePage = clampPage(page, totalPages);
  const items = buildPageItems(safePage, Math.max(1, totalPages));
  if (totalPages <= 1) return null;

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {safePage > 1 ? (
        <button
          type="button"
          className="editor-button editor-button-secondary"
          onClick={() => onChange(Math.max(1, safePage - 1))}
        >
          Vorige
        </button>
      ) : null}
      {items.map((item, idx) =>
        item === "..." ? (
          <span key={`dots-${idx}`} style={{ opacity: 0.7 }}>
            ...
          </span>
        ) : (
          <button
            key={String(item)}
            type="button"
            className={item === safePage ? "editor-button" : "editor-button editor-button-secondary"}
            onClick={() => onChange(item)}
            disabled={item === safePage}
            title={`Pagina ${item}`}
          >
            {item}
          </button>
        )
      )}
      {safePage < totalPages ? (
        <button
          type="button"
          className="editor-button editor-button-secondary"
          onClick={() => onChange(Math.min(totalPages, safePage + 1))}
        >
          Volgende
        </button>
      ) : null}
    </div>
  );
}
