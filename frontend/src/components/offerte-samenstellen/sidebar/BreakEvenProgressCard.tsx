"use client";

import React from "react";

function euro(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
    Number.isFinite(value) ? value : 0
  );
}

function liters(value: number) {
  return `${Math.round(Number.isFinite(value) ? value : 0).toLocaleString("nl-NL")} L`;
}

export function BreakEvenProgressCard({
  breakEvenTargetLiters,
  alreadySoldLitersYtd,
  customerAlreadyBoughtLiters,
  growthFromDealLiters,
  discountEffectLitersEquivalent,
  transportEffectLitersEquivalent,
  progressPct,
  newTotalProgressLiters,
  remainingLitersToBreakEven,
  theoreticalCurrentLiters,
  theoreticalDealLiters,
  theoreticalDeltaLiters,
}: {
  breakEvenTargetLiters: number;
  alreadySoldLitersYtd: number;
  customerAlreadyBoughtLiters: number;
  growthFromDealLiters: number;
  discountEffectLitersEquivalent: number;
  transportEffectLitersEquivalent: number;
  progressPct: number;
  newTotalProgressLiters: number;
  remainingLitersToBreakEven: number;
  theoreticalCurrentLiters?: number | null;
  theoreticalDealLiters?: number | null;
  theoreticalDeltaLiters?: number | null;
}) {
  const delta = Number.isFinite(theoreticalDeltaLiters as number)
    ? (theoreticalDeltaLiters as number)
    : null;

  return (
    <div className="cpq-side-card">
      <div className="cpq-side-card-title">Break-even voortgang</div>

      <div className="cpq-side-row">
        <span className="cpq-side-muted">Break-even doel</span>
        <span className="cpq-side-muted">{liters(breakEvenTargetLiters)}</span>
      </div>
      <div className="cpq-side-progress">
        <div className="cpq-side-progress-bar" style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }} />
      </div>

      <div className="cpq-side-list">
        <div className="cpq-side-list-row">
          <span>Reeds verkocht (alle klanten)</span>
          <span>{liters(alreadySoldLitersYtd)}</span>
        </div>
        <div className="cpq-side-list-row">
          <span>Klant had al</span>
          <span>{liters(customerAlreadyBoughtLiters)}</span>
        </div>
        <div className="cpq-side-list-row">
          <span>Groei door deal</span>
          <span className="cpq-side-pos">+{liters(growthFromDealLiters)}</span>
        </div>
        <div className="cpq-side-list-row">
          <span>Kortingseffect</span>
          <span className="cpq-side-neg">-{liters(discountEffectLitersEquivalent)} eq.</span>
        </div>
        <div className="cpq-side-list-row">
          <span>Transporteffect</span>
          <span className="cpq-side-neg">-{liters(transportEffectLitersEquivalent)} eq.</span>
        </div>
      </div>

      <div className="cpq-side-subcard">
        <div className="cpq-side-subcard-kicker">Nieuwe status</div>
        <div className="cpq-side-subcard-value">
          {liters(newTotalProgressLiters)} / {liters(breakEvenTargetLiters)}
        </div>
        <div className="cpq-side-muted">
          Nog nodig tot break-even: <strong>{liters(remainingLitersToBreakEven)}</strong>
        </div>
      </div>

      <div className="cpq-side-subcard">
        <div className="cpq-side-subcard-kicker">Prijsimpact op break-even</div>
        <div className="cpq-side-muted" style={{ marginTop: 4 }}>
          Alleen theoretisch: alsof alle portfolio tegen deze dealmarge zou lopen.
        </div>
        <div className="cpq-side-list" style={{ marginTop: 10 }}>
          <div className="cpq-side-list-row">
            <span>Huidig doel</span>
            <span>{theoreticalCurrentLiters ? liters(theoreticalCurrentLiters) : "—"}</span>
          </div>
          <div className="cpq-side-list-row">
            <span>Bij deze dealmarge</span>
            <span>{theoreticalDealLiters ? liters(theoreticalDealLiters) : "—"}</span>
          </div>
          <div className="cpq-side-list-row">
            <span>Prijsdruk-equivalent</span>
            <span className={delta !== null && delta > 0 ? "cpq-side-neg" : "cpq-side-pos"}>
              {delta === null ? "—" : `${delta > 0 ? "+" : ""}${liters(delta)}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

