"use client";

import type { WorkstreamDefinition } from "@/components/beheer/data-quality/DataQualityTypes";

export function DataQualityTabs({
  steps,
  activeIndex,
  onSelect,
  badges = {},
}: {
  steps: WorkstreamDefinition[];
  activeIndex: number;
  onSelect: (index: number) => void;
  badges?: Record<string, { label: string; tone: "ok" | "warning" | "neutral" }>;
}) {
  return (
    <div className="data-quality-tabs" role="tablist" aria-label="Datakwaliteit onderdelen">
      {steps.map((step, index) => {
        const badge = badges[step.id];
        return (
          <button
            key={step.id}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            className={`data-quality-tab${index === activeIndex ? " active" : ""}`}
            onClick={() => onSelect(index)}
          >
            <span className="data-quality-tab-title">
              {step.title}
              {badge ? <em className={`data-quality-tab-badge ${badge.tone}`}>{badge.label}</em> : null}
            </span>
            <small>{step.description}</small>
          </button>
        );
      })}
    </div>
  );
}
