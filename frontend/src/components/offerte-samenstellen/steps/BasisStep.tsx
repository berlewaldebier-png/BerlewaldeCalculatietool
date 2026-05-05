"use client";

import React from "react";

import type { BasisData, QuoteChannel } from "@/components/offerte-samenstellen/types";
import { Field } from "@/components/offerte-samenstellen/OfferteSamenstellenParts";

export function BasisStep({
  basis,
  setBasis,
  onNext,
  onSave,
  isSaving,
}: {
  basis: BasisData;
  setBasis: React.Dispatch<React.SetStateAction<BasisData>>;
  onNext: () => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  return (
    <section className="cpq-card">
      <div className="cpq-card-header">
        <div>
          <h2 className="cpq-card-title">Basisgegevens</h2>
          <p className="cpq-card-subtitle">Vul klant, kanaal en context van de offerte in.</p>
        </div>
      </div>

      <div className="cpq-form-grid">
        <Field label="Klantnaam" value={basis.klantNaam} onChange={(v) => setBasis((prev) => ({ ...prev, klantNaam: v }))} />
        <Field label="Contactpersoon" value={basis.contactpersoon} onChange={(v) => setBasis((prev) => ({ ...prev, contactpersoon: v }))} />
        <Field label="Offertenaam" value={basis.offerteNaam} onChange={(v) => setBasis((prev) => ({ ...prev, offerteNaam: v }))} />
        <Field label="Geldig tot" value={basis.geldigTot} onChange={(v) => setBasis((prev) => ({ ...prev, geldigTot: v }))} />
      </div>

      <div className="cpq-form-row">
        <div className="cpq-label">Kanaal</div>
        <div className="cpq-toggle-strip" role="group" aria-label="Kanaal">
          {(["Horeca", "Retail", "Events"] as QuoteChannel[]).map((kanaal) => (
            <button
              key={kanaal}
              type="button"
              onClick={() => setBasis((prev) => ({ ...prev, kanaal }))}
              className={`cpq-toggle${basis.kanaal === kanaal ? " active" : ""}`}
            >
              {kanaal}
            </button>
          ))}
        </div>
      </div>

      <div className="cpq-form-row">
        <label className="cpq-field">
          <div className="cpq-label">Opmerking</div>
          <textarea
            value={basis.opmerking}
            onChange={(e) => setBasis((prev) => ({ ...prev, opmerking: e.target.value }))}
            className="cpq-textarea"
          />
        </label>
      </div>

      <div className="cpq-actions cpq-actions-split">
        <button onClick={onSave} className="cpq-button cpq-button-secondary" type="button" disabled={isSaving}>
          {isSaving ? "Opslaan..." : "Opslaan"}
        </button>
        <button onClick={onNext} className="cpq-button cpq-button-primary" type="button">
          Verder naar offerte maken
        </button>
      </div>
    </section>
  );
}

