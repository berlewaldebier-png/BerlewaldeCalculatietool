"use client";

import { useMemo, useState } from "react";

import { BerekeningenWizard } from "@/components/BerekeningenWizard";

type GenericRecord = Record<string, unknown>;

type KostprijsBeheerWorkspaceProps = {
  berekeningen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  productie: Record<string, GenericRecord>;
  vasteKosten: Record<string, GenericRecord[]>;
  tarievenHeffingen: GenericRecord[];
};

type WorkspaceMode = "landing" | "select-existing" | "wizard-new" | "wizard-edit";
type FilterMode = "all" | "concept" | "definitief";

export function KostprijsBeheerWorkspace({
  berekeningen,
  basisproducten,
  samengesteldeProducten,
  productie,
  vasteKosten,
  tarievenHeffingen
}: KostprijsBeheerWorkspaceProps) {
  const [currentBerekeningen, setCurrentBerekeningen] = useState<GenericRecord[]>(berekeningen);
  const [mode, setMode] = useState<WorkspaceMode>("landing");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const concept = currentBerekeningen.filter(
      (row) => String(row.status ?? "").trim().toLowerCase() === "concept"
    ).length;
    const definitief = currentBerekeningen.filter(
      (row) => String(row.status ?? "").trim().toLowerCase() === "definitief"
    ).length;

    return {
      all: currentBerekeningen.length,
      concept,
      definitief
    };
  }, [currentBerekeningen]);

  const filteredRows = useMemo(() => {
    return currentBerekeningen.filter((row) => {
      const status = String(row.status ?? "").trim().toLowerCase();
      if (filterMode === "concept") {
        return status === "concept";
      }
      if (filterMode === "definitief") {
        return status === "definitief";
      }
      return true;
    });
  }, [currentBerekeningen, filterMode]);

  if (mode === "wizard-new") {
    return (
      <BerekeningenWizard
        initialRows={currentBerekeningen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        productie={productie}
        vasteKosten={vasteKosten}
        tarievenHeffingen={tarievenHeffingen}
        startWithNew
        onRowsChange={setCurrentBerekeningen}
        onFinish={() => setMode("landing")}
        onBackToLanding={() => setMode("landing")}
      />
    );
  }

  if (mode === "wizard-edit" && selectedId) {
    return (
      <BerekeningenWizard
        initialRows={currentBerekeningen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        productie={productie}
        vasteKosten={vasteKosten}
        tarievenHeffingen={tarievenHeffingen}
        initialSelectedId={selectedId}
        onRowsChange={setCurrentBerekeningen}
        onFinish={() => setMode("landing")}
        onBackToLanding={() => setMode("select-existing")}
      />
    );
  }

  if (mode === "select-existing") {
    return (
      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Bestaande berekening aanpassen</div>
          <div className="module-card-text">
            Kies een concept of definitieve berekening en open daarna de wizard.
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
          {filteredRows.map((row) => {
            const basis = (row.basisgegevens as GenericRecord) ?? {};
            const type = (row.soort_berekening as GenericRecord) ?? {};
            return (
              <button
                key={String(row.id)}
                type="button"
                className="kostprijs-record-card"
                onClick={() => {
                  setSelectedId(String(row.id));
                  setMode("wizard-edit");
                }}
              >
                <div className="kostprijs-record-title">
                  {String(basis.biernaam ?? "Onbekende berekening")}
                </div>
                <div className="kostprijs-record-meta">
                  {String(basis.jaar ?? "-")} | {String(type.type ?? "-")} | {String(row.status ?? "-")}
                </div>
                <div className="kostprijs-record-text">
                  {String(basis.stijl ?? "Geen stijl opgegeven")}
                </div>
              </button>
            );
          })}
          {filteredRows.length === 0 ? (
            <div className="empty-state-card">
              Geen berekeningen gevonden voor deze selectie.
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Kostprijs beheren</div>
        <div className="module-card-text">
          Kies of je een nieuwe berekening wilt starten of een bestaande berekening wilt aanpassen.
        </div>
      </div>

      <div className="kostprijs-choice-grid">
        <button
          type="button"
          className="dashboard-quick-card kostprijs-choice-card"
          onClick={() => setMode("wizard-new")}
        >
          <div className="dashboard-quick-card-title">Nieuwe berekening</div>
          <div className="dashboard-quick-card-text">
            Start direct een nieuwe kostprijswizard voor een bier of productflow.
          </div>
        </button>

        <button
          type="button"
          className="dashboard-quick-card kostprijs-choice-card"
          onClick={() => setMode("select-existing")}
        >
          <div className="dashboard-quick-card-title">Bestaande aanpassen</div>
          <div className="dashboard-quick-card-text">
            Open een concept of definitieve berekening en werk deze verder uit in de wizard.
          </div>
        </button>
      </div>
    </section>
  );
}
