"use client";

import { useMemo, useState } from "react";

import { PrijsvoorstelWizard } from "@/components/PrijsvoorstelWizard";

type GenericRecord = Record<string, unknown>;

type PrijsvoorstelWorkspaceProps = {
  voorstellen: GenericRecord[];
  yearOptions: number[];
  bieren: GenericRecord[];
  berekeningen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
};

type WorkspaceMode = "landing" | "select-existing" | "wizard-new" | "wizard-edit";
type FilterMode = "all" | "concept" | "definitief";

export function PrijsvoorstelWorkspace({
  voorstellen,
  yearOptions,
  bieren,
  berekeningen,
  verkoopprijzen,
  basisproducten,
  samengesteldeProducten
}: PrijsvoorstelWorkspaceProps) {
  const [currentVoorstellen, setCurrentVoorstellen] = useState<GenericRecord[]>(voorstellen);
  const [mode, setMode] = useState<WorkspaceMode>("landing");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const concept = currentVoorstellen.filter(
      (row) => String(row.status ?? "").trim().toLowerCase() === "concept"
    ).length;
    const definitief = currentVoorstellen.filter(
      (row) => String(row.status ?? "").trim().toLowerCase() === "definitief"
    ).length;

    return {
      all: currentVoorstellen.length,
      concept,
      definitief
    };
  }, [currentVoorstellen]);

  const filteredRows = useMemo(() => {
    return currentVoorstellen.filter((row) => {
      const status = String(row.status ?? "").trim().toLowerCase();
      if (filterMode === "concept") {
        return status === "concept";
      }
      if (filterMode === "definitief") {
        return status === "definitief";
      }
      return true;
    });
  }, [currentVoorstellen, filterMode]);

  if (mode === "wizard-new") {
    return (
      <PrijsvoorstelWizard
        initialRows={currentVoorstellen}
        yearOptions={yearOptions}
        bieren={bieren}
        berekeningen={berekeningen}
        verkoopprijzen={verkoopprijzen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        startWithNew
        onRowsChange={setCurrentVoorstellen}
        onFinish={() => setMode("landing")}
        onBackToLanding={() => setMode("landing")}
      />
    );
  }

  if (mode === "wizard-edit" && selectedId) {
    return (
      <PrijsvoorstelWizard
        initialRows={currentVoorstellen}
        yearOptions={yearOptions}
        bieren={bieren}
        berekeningen={berekeningen}
        verkoopprijzen={verkoopprijzen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        initialSelectedId={selectedId}
        onRowsChange={setCurrentVoorstellen}
        onFinish={() => setMode("landing")}
        onBackToLanding={() => setMode("select-existing")}
      />
    );
  }

  if (mode === "select-existing") {
    return (
      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Bestaand prijsvoorstel aanpassen</div>
          <div className="module-card-text">
            Kies een concept of definitief prijsvoorstel en open daarna de wizard.
          </div>
        </div>

        <div className="kostprijs-toolbar">
          <div className="kostprijs-filter-tabs">
            {[
              ["all", `Alles (${counts.all})`],
              ["concept", `Concept (${counts.concept})`],
              ["definitief", `Definitief (${counts.definitief})`]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`tab-button${filterMode === value ? " active" : ""}`}
                onClick={() => setFilterMode(value as FilterMode)}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => setMode("landing")}
          >
            Terug
          </button>
        </div>

        <div className="kostprijs-record-grid">
          {filteredRows.map((row) => (
            <button
              key={String(row.id ?? "")}
              type="button"
              className="kostprijs-record-card"
              onClick={() => {
                setSelectedId(String(row.id ?? ""));
                setMode("wizard-edit");
              }}
            >
              <div className="kostprijs-record-title">
                {String(row.offertenummer ?? row.klantnaam ?? "Nieuw prijsvoorstel")}
              </div>
              <div className="kostprijs-record-meta">
                {String(row.jaar ?? "-")} | {String(row.status ?? "-")} | {String(row.kanaal ?? "-")}
              </div>
              <div className="kostprijs-record-text">
                {String(row.klantnaam ?? "Geen klantnaam opgegeven")}
              </div>
            </button>
          ))}
          {filteredRows.length === 0 ? (
            <div className="empty-state-card">Geen prijsvoorstellen gevonden voor deze selectie.</div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Prijsvoorstel beheren</div>
        <div className="module-card-text">
          Kies of je een nieuw prijsvoorstel wilt starten of een bestaand voorstel wilt aanpassen.
        </div>
      </div>

      <div className="kostprijs-choice-grid">
        <button
          type="button"
          className="dashboard-quick-card kostprijs-choice-card"
          onClick={() => setMode("wizard-new")}
        >
          <div className="dashboard-quick-card-title">Nieuw prijsvoorstel</div>
          <div className="dashboard-quick-card-text">
            Start een lege wizard voor een nieuw prijsvoorstel.
          </div>
        </button>

        <button
          type="button"
          className="dashboard-quick-card kostprijs-choice-card"
          onClick={() => setMode("select-existing")}
        >
          <div className="dashboard-quick-card-title">Bestaande aanpassen</div>
          <div className="dashboard-quick-card-text">
            Open een bestaand prijsvoorstel in een gevulde wizard.
          </div>
        </button>
      </div>
    </section>
  );
}
