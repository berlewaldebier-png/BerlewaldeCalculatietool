"use client";

import React from "react";

export type StepperItem = { id: string; title: string };

export function HorizontalStepper({
  steps,
  activeId,
  onSelect,
}: {
  steps: StepperItem[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="cpq-stepper" role="navigation" aria-label="Stappen">
      {steps.map((step, index) => {
        const active = step.id === activeId;
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onSelect(step.id)}
            className={`cpq-stepper-item${active ? " active" : ""}`}
          >
            <span className="cpq-stepper-index">{index + 1}</span>
            <span className="cpq-stepper-title">{step.title}</span>
          </button>
        );
      })}
    </div>
  );
}

