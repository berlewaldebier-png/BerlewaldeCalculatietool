"use client";

import type { WorkstreamDefinition } from "@/components/beheer/data-quality/DataQualityTypes";

export function DataQualityTabs({
  steps,
  activeIndex,
  onSelect,
}: {
  steps: WorkstreamDefinition[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="data-quality-tabs" role="tablist" aria-label="Datakwaliteit onderdelen">
      {steps.map((step, index) => (
        <button
          key={step.id}
          type="button"
          role="tab"
          aria-selected={index === activeIndex}
          className={`data-quality-tab${index === activeIndex ? " active" : ""}`}
          onClick={() => onSelect(index)}
        >
          <span>{step.title}</span>
          <small>{step.description}</small>
        </button>
      ))}
    </div>
  );
}
