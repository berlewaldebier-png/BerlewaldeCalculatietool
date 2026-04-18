"use client";

import React from "react";

export function SourceBadge({
  kind,
  source,
  note
}: {
  kind: "inherit" | "override";
  source: "Kanaal" | "Producttype" | "Product";
  note?: string;
}) {
  const isOverride = kind === "override";
  const label = isOverride ? "Override" : "Erft";
  const bg = isOverride ? "#FFF5E6" : "#F3F7FF";
  const border = isOverride ? "#FFD9A8" : "#C6D5FF";
  const text = isOverride ? "#7A4A00" : "#2147A5";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.15rem 0.45rem",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        color: text,
        fontSize: "0.78rem",
        fontWeight: 650,
        whiteSpace: "nowrap"
      }}
      title={note ? `${label}: ${source} (${note})` : `${label}: ${source}`}
    >
      {label}: {source}
      {note ? <span style={{ fontWeight: 550, opacity: 0.9 }}>({note})</span> : null}
    </span>
  );
}

export function OverrideIndicator({
  active
}: {
  active: boolean;
}) {
  return (
    <span
      aria-label={active ? "Override actief" : "Erft waarde"}
      title={active ? "Override actief" : "Erft waarde"}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 999,
        background: active ? "#FFB74D" : "#9BB7FF"
      }}
    />
  );
}

export function ResetToParentButton({
  onClick,
  disabled
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="editor-button editor-button-secondary"
      onClick={onClick}
      disabled={disabled}
    >
      Reset
    </button>
  );
}

