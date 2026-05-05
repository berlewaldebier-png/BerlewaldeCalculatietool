"use client";

import React from "react";

export function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="cpq-field">
      <div className="cpq-label">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="cpq-input" />
    </label>
  );
}

export function QuickCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="cpq-quick-label">{label}</div>
      <div className="cpq-quick-value">{value}</div>
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="cpq-metric">
      <span className="cpq-muted">{label}</span>
      <span className="cpq-strong">{value}</span>
    </div>
  );
}

export function LiveSummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="cpq-live-summary-metric">
      <div className="cpq-live-summary-metric-label">{label}</div>
      <div className="cpq-live-summary-metric-value">{value}</div>
    </div>
  );
}

