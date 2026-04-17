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
  channels: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  catalogusproducten: GenericRecord[];
  verpakkingsonderdelen: GenericRecord[];
  verpakkingsonderdeelPrijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  initialMode?: string;
  initialFilter?: string;
  initialFocus?: string;
};

type WorkspaceMode = "landing" | "select-existing" | "wizard-new" | "wizard-edit";
type FilterMode = "all" | "concept" | "definitief";

export function PrijsvoorstelWorkspace({
  voorstellen,
  yearOptions,
  bieren,
  berekeningen,
  verkoopprijzen,
  channels,
  kostprijsproductactiveringen,
  catalogusproducten,
  verpakkingsonderdelen,
  verpakkingsonderdeelPrijzen,
  basisproducten,
  samengesteldeProducten,
  initialMode,
  initialFilter,
  initialFocus
}: PrijsvoorstelWorkspaceProps) {
  const [currentVoorstellen, setCurrentVoorstellen] = useState<GenericRecord[]>(voorstellen);
  const normalizedInitialMode =
    initialMode === "select-existing" || initialMode === "wizard-new" || initialMode === "wizard-edit"
      ? (initialMode as WorkspaceMode)
      : "landing";
  const normalizedInitialFilter =
    initialFilter === "concept" || initialFilter === "definitief" ? (initialFilter as FilterMode) : "all";

  const [mode, setMode] = useState<WorkspaceMode>(normalizedInitialMode);
  const [filterMode, setFilterMode] = useState<FilterMode>(normalizedInitialFilter);
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

  const focusFilteredRows = useMemo(() => {
    if (String(initialFocus ?? "") !== "aflopend") {
      return filteredRows;
    }
    const today = new Date();
    const until = new Date(today);
    until.setDate(until.getDate() + 14);
    const parse = (value: unknown) => {
      const raw = String(value ?? "").trim();
      if (!raw) return null;
      // Expect YYYY-MM-DD from the date input.
      const date = new Date(`${raw}T00:00:00`);
      return Number.isFinite(date.getTime()) ? date : null;
    };
    return filteredRows.filter((row) => {
      const status = String(row.status ?? "").trim().toLowerCase();
      if (status !== "concept") return false;
      const verloopt = parse((row as any).verloopt_op);
      if (!verloopt) return false;
      return verloopt >= today && verloopt <= until;
    });
  }, [filteredRows, initialFocus]);

  if (mode === "wizard-new") {
    return (
      <PrijsvoorstelWizard
        initialRows={currentVoorstellen}
        yearOptions={yearOptions}
        bieren={bieren}
        berekeningen={berekeningen}
        verkoopprijzen={verkoopprijzen}
        channels={channels}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
        catalogusproducten={catalogusproducten}
        verpakkingsonderdelen={verpakkingsonderdelen}
        verpakkingsonderdeelPrijzen={verpakkingsonderdeelPrijzen}
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
        channels={channels}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
        catalogusproducten={catalogusproducten}
        verpakkingsonderdelen={verpakkingsonderdelen}
        verpakkingsonderdeelPrijzen={verpakkingsonderdeelPrijzen}
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
          {focusFilteredRows.map((row) => (
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
          {focusFilteredRows.length === 0 ? (
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
