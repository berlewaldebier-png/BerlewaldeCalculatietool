"use client";

import { formatMoneyEUR, formatPercent0to2 } from "@/lib/formatters";

type Totals = {
  omzet: number;
  kosten: number;
  margePct: number;
  transportMode?: "charge" | "cost";
  transportAmountEx?: number;
  extrasOmzet?: number;
  extrasKosten?: number;
};

export function QuoteBuilderRightPanel({
  totals,
  onGoCompare,
  onDownloadConcept,
  onAddNote
}: {
  totals: Totals | null;
  onGoCompare: () => void;
  onDownloadConcept: () => void;
  onAddNote: () => void;
}) {
  const omzet = totals?.omzet ?? 0;
  const kosten = totals?.kosten ?? 0;
  const transportAmount = totals?.transportAmountEx ?? 0;
  const extrasKosten = totals?.extrasKosten ?? 0;
  const margePct = totals?.margePct ?? 0;

  return (
    <aside className="quote-right-stack" aria-label="Live inzicht">
      <div className="module-card compact-card">
        <div className="module-card-title">Live inzicht</div>
        <div className="module-card-text">Op basis van het actieve scenario en de geselecteerde periode.</div>
        <div style={{ display: "grid", gap: "0.55rem", marginTop: "0.85rem" }}>
          <Kpi label="Omzet" value={formatMoneyEUR(omzet)} />
          <Kpi label="Kostprijs" value={formatMoneyEUR(kosten)} />
          <Kpi
            label="Transport"
            value={
              transportAmount > 0
                ? `${totals?.transportMode === "charge" ? "+" : "≈"} ${formatMoneyEUR(transportAmount)}`
                : "—"
            }
          />
          <Kpi label="Extra kosten" value={extrasKosten > 0 ? formatMoneyEUR(extrasKosten) : "—"} />
          <div style={{ borderTop: "1px solid var(--border)", marginTop: "0.5rem", paddingTop: "0.65rem" }} />
          <Kpi label="Netto marge" value={formatPercent0to2(margePct)} strong />
        </div>
      </div>

      <div className="module-card compact-card" aria-label="Break-even impact (placeholder)">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div className="module-card-title" style={{ marginBottom: 0 }}>
            Break-even impact
          </div>
          <span className="pill" title="Deze berekening is nog niet beschikbaar.">
            Placeholder
          </span>
        </div>
        <div className="module-card-text" style={{ marginTop: "0.4rem" }}>
          Hier tonen we later de impact van korting/gratis producten/extra kosten op break-even omzet of volume.
        </div>
      </div>

      <div className="module-card compact-card">
        <div className="module-card-title">Volgende acties</div>
        <div style={{ display: "grid", gap: "0.55rem", marginTop: "0.85rem" }}>
          <button type="button" className="editor-button" onClick={onGoCompare}>
            Naar vergelijken
          </button>
          <button type="button" className="editor-button editor-button-secondary" onClick={onDownloadConcept}>
            Concept downloaden
          </button>
          <button type="button" className="editor-button editor-button-secondary" onClick={onAddNote}>
            Opmerking toevoegen
          </button>
        </div>
      </div>
    </aside>
  );
}

function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span className="muted" style={{ fontWeight: 700 }}>
        {label}
      </span>
      <span style={{ fontWeight: strong ? 900 : 800 }}>{value}</span>
    </div>
  );
}

