"use client";

import type { ReactNode } from "react";

import { API_BASE_URL } from "@/lib/api";

export function AfrondenStep({
  targetYear,
  isRunning,
  commitConflict,
  setCommitConflict,
  initializeYear,
  commitTargetYearForce,
  saveAndCloseButton,
  navigateToStep,
  saveDraftToServer,
  commitTargetYear,
}: {
  targetYear: number;
  isRunning: boolean;
  commitConflict: string;
  setCommitConflict: (next: string) => void;
  initializeYear: () => Promise<void>;
  commitTargetYearForce: () => Promise<void> | void;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  saveDraftToServer: (statusMessage: string) => Promise<void> | void;
  commitTargetYear: () => Promise<void> | void;
}) {
  return (
    <div>
      <div className="editor-status" style={{ marginBottom: 14 }}>
        Klik op <strong>Afronden</strong> om het doeljaar {targetYear} definitief weg te schrijven. Totdat je afrondt,
        blijft alles een concept en worden de echte jaar-tabellen niet aangepast.
      </div>

      {commitConflict ? (
        <div className="editor-status" style={{ marginBottom: 14 }}>
          <strong>Conflict:</strong> {commitConflict}
          <div className="muted" style={{ marginTop: 8 }}>
            Kies of je het concept opnieuw wilt baseren op het bronjaar, of force wilt afronden.
          </div>
          <div className="editor-actions" style={{ marginTop: 10 }}>
            <div className="editor-actions-group">
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={async () => {
                  await fetch(
                    `${API_BASE_URL}/meta/new-year-draft?target_year=${encodeURIComponent(String(targetYear))}`,
                    { method: "DELETE" }
                  );
                  setCommitConflict("");
                  await initializeYear();
                }}
                disabled={isRunning}
              >
                Concept opnieuw baseren
              </button>
            </div>
            <div className="editor-actions-group">
              <button type="button" className="editor-button" onClick={commitTargetYearForce} disabled={isRunning}>
                Toch afronden (force)
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(10)}
            disabled={isRunning}
          >
            Vorige
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void saveDraftToServer("Concept opgeslagen.")}
            disabled={isRunning}
          >
            Opslaan
          </button>
          <button
            type="button"
            className="editor-button"
            onClick={commitTargetYear}
            disabled={isRunning}
          >
            Afronden
          </button>
        </div>
      </div>
    </div>
  );
}

