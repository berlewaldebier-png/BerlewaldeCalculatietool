"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

export type SkuSearchOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
};

type Props = {
  value: string;
  options: SkuSearchOption[];
  onChange: (nextValue: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  maxResults?: number;
};

function norm(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function matches(option: SkuSearchOption, query: string) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = norm(`${option.label} ${option.description ?? ""} ${option.keywords ?? ""} ${option.value}`);
  return terms.every((term) => haystack.includes(term));
}

export function SkuSearchSelect({
  value,
  options,
  onChange,
  placeholder = "Zoek SKU",
  disabled = false,
  className = "editor-input",
  style,
  maxResults = 50,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);
  const [query, setQuery] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(selected?.label ?? "");
  }, [selected?.label]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const filtered = useMemo(() => {
    return options.filter((option) => matches(option, query)).slice(0, maxResults);
  }, [maxResults, options, query]);

  return (
    <div ref={rootRef} style={{ position: "relative", minWidth: 0, ...style }}>
      <input
        className={className}
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={(event) => {
          setOpen(true);
          event.currentTarget.select();
        }}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setOpen(true);
          if (!nextQuery.trim() && value) onChange("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setQuery(selected?.label ?? "");
          }
          if (event.key === "Enter" && open && filtered[0]) {
            event.preventDefault();
            onChange(filtered[0].value);
            setQuery(filtered[0].label);
            setOpen(false);
          }
        }}
        style={{ width: "100%" }}
      />
      {open && !disabled ? (
        <div
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 50,
            left: 0,
            right: 0,
            top: "calc(100% + 4px)",
            maxHeight: 260,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #d8e0ef",
            borderRadius: 8,
            boxShadow: "0 16px 40px rgba(15, 23, 42, 0.16)",
            padding: 4,
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: "10px 12px", color: "#51607a", fontSize: 13 }}>Geen SKU gevonden.</div>
          ) : (
            filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setQuery(option.label);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  border: 0,
                  borderRadius: 6,
                  background: option.value === value ? "#edf4ff" : "transparent",
                  padding: "8px 10px",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ display: "block", fontWeight: 800, color: "#071936" }}>{option.label}</span>
                {option.description ? (
                  <span style={{ display: "block", marginTop: 2, fontSize: 12, color: "#51607a" }}>{option.description}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
