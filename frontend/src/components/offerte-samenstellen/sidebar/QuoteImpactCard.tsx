"use client";

import React from "react";

function euro(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
    Number.isFinite(value) ? value : 0
  );
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function QuoteImpactCard({
  lostExistingEx,
  gainedGrowthEx,
  transportEx,
  netEffectEx,
  extraLitersNeeded,
}: {
  lostExistingEx: number;
  gainedGrowthEx: number;
  transportEx: number;
  netEffectEx: number;
  extraLitersNeeded: number;
}) {
  const isEmpty =
    Math.abs(lostExistingEx) < 0.0001 &&
    Math.abs(gainedGrowthEx) < 0.0001 &&
    Math.abs(transportEx) < 0.0001 &&
    Math.abs(netEffectEx) < 0.0001;
  const netPositive = netEffectEx >= 0;
  const maxBar = Math.max(lostExistingEx, gainedGrowthEx, transportEx, 1);
  const lossW = `${clamp((lostExistingEx / maxBar) * 100, 6, 100)}%`;
  const gainW = `${clamp((gainedGrowthEx / maxBar) * 100, 6, 100)}%`;
  const transportW = `${clamp((transportEx / maxBar) * 100, 6, 100)}%`;

  return (
    <div className="cpq-side-card">
      <div className="cpq-side-card-header">
        <div className="cpq-side-card-title">Impact offerte</div>
        {isEmpty ? (
          <span className="cpq-side-badge">Geen impact</span>
        ) : (
          <span className={`cpq-side-badge${netPositive ? " pos" : " neg"}`}>
            {netPositive ? "Netto positief" : "Extra nodig"}
          </span>
        )}
      </div>

      {isEmpty ? (
        <div className="cpq-side-callout pos" style={{ marginTop: 12 }}>
          Geen korting/toeslag impact t.o.v. standaardprijzen.
        </div>
      ) : (
        <>
          <div className="cpq-side-list">
            <div className="cpq-side-list-row">
              <span>Verlies bestaand volume</span>
              <span className="cpq-side-neg">-{euro(lostExistingEx)}</span>
            </div>
            <div className="cpq-side-list-row">
              <span>Winst extra volume</span>
              <span className="cpq-side-pos">+{euro(gainedGrowthEx)}</span>
            </div>
            <div className="cpq-side-list-row">
              <span>Transport</span>
              <span className="cpq-side-neg">-{euro(transportEx)}</span>
            </div>
          </div>

          <div className="cpq-side-divider" />

          <div className="cpq-side-list-row" style={{ fontWeight: 700 }}>
            <span>Netto effect</span>
            <span className={netPositive ? "cpq-side-pos" : "cpq-side-neg"}>
              {netPositive ? "+" : "-"}
              {euro(Math.abs(netEffectEx))}
            </span>
          </div>

          <div className={`cpq-side-callout${netPositive ? " pos" : " neg"}`}>
            {netPositive
              ? "Extra volume dekt verlies en transportimpact."
              : `Extra nodig: ${Math.round(extraLitersNeeded).toLocaleString("nl-NL")} L`}
          </div>

          <div className="cpq-side-bars">
            <div className="cpq-side-bar-row">
              <span className="cpq-side-muted">Verlies</span>
              <div className="cpq-side-bar">
                <div className="cpq-side-bar-fill loss" style={{ width: lossW }} />
              </div>
            </div>
            <div className="cpq-side-bar-row">
              <span className="cpq-side-muted">Winst</span>
              <div className="cpq-side-bar">
                <div className="cpq-side-bar-fill gain" style={{ width: gainW }} />
              </div>
            </div>
            <div className="cpq-side-bar-row">
              <span className="cpq-side-muted">Transport</span>
              <div className="cpq-side-bar">
                <div className="cpq-side-bar-fill transport" style={{ width: transportW }} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
