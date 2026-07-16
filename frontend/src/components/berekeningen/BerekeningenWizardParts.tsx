"use client";

import { type InputHTMLAttributes } from "react";

export function CurrencyInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`currency-input-wrapper${props.readOnly ? " readonly" : ""}`}>
      <span className="currency-input-prefix">€</span>
      <input {...props} className={className} />
    </div>
  );
}

export function QuickCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="cpq-quick-label">{label}</div>
      <div className="cpq-quick-value">{value || "—"}</div>
    </div>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M9 4h6" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

export function SavingIndicator({ label = "Opslaan..." }: { label?: string }) {
  return (
    <span className="editor-saving-indicator" role="status" aria-live="polite">
      <svg className="editor-saving-spinner" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span>{label}</span>
    </span>
  );
}
