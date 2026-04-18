"use client";

export type VatDisplayMode = "excl" | "incl";

export function VatDisplayToggle({
  value,
  onChange,
  disabled
}: {
  value: VatDisplayMode;
  onChange: (next: VatDisplayMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="tab-strip" style={{ marginBottom: 0 }}>
      <button
        type="button"
        className={`tab-button${value === "excl" ? " active" : ""}`}
        onClick={() => onChange("excl")}
        disabled={disabled}
      >
        Excl. BTW
      </button>
      <button
        type="button"
        className={`tab-button${value === "incl" ? " active" : ""}`}
        onClick={() => onChange("incl")}
        disabled={disabled}
      >
        Incl. BTW
      </button>
    </div>
  );
}

