"use client";

import type { DealContext } from "@/components/offerte-samenstellen/types";

type Props = {
  value: DealContext;
  onChange: (next: DealContext) => void;
  targetVolumeLiters: number | null;
  onChangeTargetVolumeLiters: (next: number | null) => void;
  agreementVolumeLiters: number | null;
  onChangeAgreementVolumeLiters: (next: number | null) => void;
};

function toNumberOrNull(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

export function DealContextBar({
  value,
  onChange,
  targetVolumeLiters,
  onChangeTargetVolumeLiters,
  agreementVolumeLiters,
  onChangeAgreementVolumeLiters,
}: Props) {
  const options: Array<{ id: DealContext; title: string; meta: string }> = [
    { id: "growth", title: "Groei-afspraak", meta: "Vorig jaar → nieuw doel" },
    { id: "agreement", title: "Nieuwe afspraak", meta: "Nieuwe prijs op run-rate" },
    { id: "one_off", title: "One-off offerte", meta: "Eenmalige aanvraag" },
  ];

  return (
    <div className="cpq-card" style={{ padding: 14 }}>
      <div className="cpq-label" style={{ marginBottom: 8 }}>
        Deal-context
      </div>

      <div className="cpq-toggle-strip" role="group" aria-label="Deal-context" style={{ flexWrap: "wrap" }}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`cpq-toggle${value === option.id ? " active" : ""}`}
            title={option.meta}
          >
            {option.title}
          </button>
        ))}
      </div>

      {value === "growth" ? (
        <div style={{ marginTop: 10 }}>
          <label className="cpq-field">
            <div className="cpq-label">Doelvolume (L)</div>
            <input
              className="cpq-input"
              inputMode="decimal"
              placeholder="Bijv. 3000"
              value={targetVolumeLiters ?? ""}
              onChange={(e) => onChangeTargetVolumeLiters(toNumberOrNull(e.target.value))}
            />
            <div className="cpq-muted" style={{ marginTop: 6 }}>
              Nieuwe voorwaarden gelden alleen voor extra liters boven de historische baseline.
            </div>
          </label>
        </div>
      ) : null}

      {value === "agreement" ? (
        <div style={{ marginTop: 10 }}>
          <label className="cpq-field">
            <div className="cpq-label">Contractvolume (L)</div>
            <input
              className="cpq-input"
              inputMode="decimal"
              placeholder="Bijv. 5000"
              value={agreementVolumeLiters ?? ""}
              onChange={(e) => onChangeAgreementVolumeLiters(toNumberOrNull(e.target.value))}
            />
            <div className="cpq-muted" style={{ marginTop: 6 }}>
              Nieuwe voorwaarden gelden voor het volledige toekomstige contractvolume.
            </div>
          </label>
        </div>
      ) : null}

      {value === "growth" && targetVolumeLiters === null ? (
        <div className="cpq-alert cpq-alert-warn" style={{ marginTop: 10 }}>
          Doelvolume is leeg. We gebruiken het offertevolume als doelvolume (growth = offertevolume − baseline).
        </div>
      ) : null}

      {value === "agreement" && agreementVolumeLiters === null ? (
        <div className="cpq-alert cpq-alert-warn" style={{ marginTop: 10 }}>
          Contractvolume is leeg. We gebruiken het offertevolume als contractvolume voor de berekening.
        </div>
      ) : null}

      <div className="cpq-muted" style={{ marginTop: 10 }}>
        Let op: we passen nooit prijzen retroactief toe op reeds gefactureerde liters.
      </div>
    </div>
  );
}

