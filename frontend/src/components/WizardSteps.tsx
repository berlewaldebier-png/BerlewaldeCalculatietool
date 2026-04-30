"use client";

import type { ReactNode } from "react";

export type WizardStep = {
  id: string;
  title: string;
  description?: string;
  disabled?: boolean;
};

export function WizardSteps({
  title = "Stappen",
  steps,
  activeIndex,
  onSelect,
  className
}: {
  title?: string;
  steps: WizardStep[];
  activeIndex: number;
  onSelect?: (index: number) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="cpq-left-title">{title}</div>
      <div className="cpq-steps">
        {steps.map((step, idx) => {
          const active = idx === activeIndex;
          const done = idx < activeIndex;
          const dot: ReactNode = done ? "\u2713" : idx + 1;

          return (
            <button
              key={step.id}
              type="button"
              disabled={Boolean(step.disabled)}
              onClick={() => onSelect?.(idx)}
              className={`cpq-step${active ? " active" : ""}${done ? " done" : ""}`}
            >
              <div className="cpq-step-row">
                <div className="cpq-step-dot">{dot}</div>
                <div>
                  <div className="cpq-step-title">{step.title}</div>
                  {step.description ? <div className="cpq-step-desc">{step.description}</div> : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

