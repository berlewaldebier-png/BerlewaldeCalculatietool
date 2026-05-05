"use client";

import type { ReactNode } from "react";

export function SelectYearsStep({
  sourceYear,
  targetYear,
  yearOptions,
  defaultSource,
  clampInt,
  setSourceYear,
  setTargetYearWithDraft,
  saveAndCloseButton,
  navigateToStep,
}: {
  sourceYear: number;
  targetYear: number;
  yearOptions: number[];
  defaultSource: number;
  clampInt: (value: string, fallback: number) => number;
  setSourceYear: (next: number) => void;
  setTargetYearWithDraft: (next: number) => void;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
}) {
  return (
    <div className="wizard-form-grid">
      <label className="nested-field">
        <span>Bronjaar</span>
        <select
          className="dataset-input"
          value={String(sourceYear)}
          onChange={(event) => {
            const nextSource = clampInt(event.target.value, defaultSource);
            setSourceYear(nextSource);
            setTargetYearWithDraft(nextSource + 1);
          }}
        >
          {yearOptions.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </label>
      <label className="nested-field">
        <span>Doeljaar</span>
        <input
          className="dataset-input dataset-input-readonly"
          type="number"
          value={targetYear}
          readOnly
        />
      </label>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group" />
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button type="button" className="editor-button" onClick={() => void navigateToStep(1)}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}

