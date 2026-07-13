"use client";

import type { ReactNode } from "react";

type ProductieYear = {
  normal_sales_l?: number;
  sales_l?: number;
  normal_shipments?: number;
  shipments?: number;
  normal_orderlines?: number;
  orderlines?: number;
  hoeveelheid_inkoop_l: number;
  hoeveelheid_productie_l: number;
  batchgrootte_eigen_productie_l: number;
};

type PlanTargets = {
  revenue: number;
  variable_cost: number;
  contribution: number;
  liters: number;
  units: number;
  price_change_pct: number;
  volume_change_pct: number;
  fixed_cost_inflation_pct: number;
  mix_assumption: string;
};

type ProductieTargetsStepProps = {
  sourceYear: number;
  targetYear: number;
  sourceProductie: unknown;
  sourceYearCloseReference?: Record<string, number>;
  sourceSalesLiters: number;
  targetFixedCostTotal: number;
  draftProductieTarget: ProductieYear;
  setDraftProductieTarget: (setter: (current: ProductieYear) => ProductieYear) => void;
  draftPlanTargets: PlanTargets;
  setDraftPlanTargets: (setter: (current: PlanTargets) => PlanTargets) => void;
  copyProductieFromSource: () => void;
  saveProductieTarget: () => void;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  saveAndCloseButton: ReactNode;
  isRunning: boolean;
  formatEur: (value: number) => string;
};

export function ProductieTargetsStep({
  sourceYear,
  targetYear,
  sourceProductie,
  sourceYearCloseReference,
  sourceSalesLiters,
  targetFixedCostTotal,
  draftProductieTarget,
  setDraftProductieTarget,
  draftPlanTargets,
  setDraftPlanTargets,
  copyProductieFromSource,
  saveProductieTarget,
  navigateToStep,
  saveAndCloseButton,
  isRunning,
  formatEur
}: ProductieTargetsStepProps) {
  const sourceRevenue = Number(sourceYearCloseReference?.revenue ?? 0);
  const sourceVariableCost = Number(sourceYearCloseReference?.variableCost ?? 0);
  const sourceContribution = Number(sourceYearCloseReference?.contribution ?? 0);
  const sourceFixedCost = Number(sourceYearCloseReference?.fixedCost ?? 0);
  const sourceInkoopLiters = Number(sourceYearCloseReference?.purchaseLiters ?? (sourceProductie as any)?.hoeveelheid_inkoop_l ?? 0);
  const sourceProductieLiters = Number(sourceYearCloseReference?.productionLiters ?? (sourceProductie as any)?.hoeveelheid_productie_l ?? 0);
  const sourceSalesLitersEffective = Number(sourceYearCloseReference?.salesLiters ?? sourceSalesLiters ?? 0);
  const sourceNormalShipments = Number((sourceProductie as any)?.normal_shipments ?? (sourceProductie as any)?.shipments ?? 0);
  const sourceShipments = Number((sourceProductie as any)?.shipments ?? (sourceProductie as any)?.normal_shipments ?? 0);
  const sourceNormalOrderlines = Number((sourceProductie as any)?.normal_orderlines ?? (sourceProductie as any)?.orderlines ?? 0);
  const sourceOrderlines = Number((sourceProductie as any)?.orderlines ?? (sourceProductie as any)?.normal_orderlines ?? 0);
  const sourceTotalLiters = sourceInkoopLiters + sourceProductieLiters;
  const targetProductionPlanLiters =
    Number(draftProductieTarget.hoeveelheid_inkoop_l ?? 0) + Number(draftProductieTarget.hoeveelheid_productie_l ?? 0);
  const targetRevenue = Number(draftPlanTargets.revenue ?? 0);
  const revenueDeltaPct = sourceRevenue > 0 ? ((targetRevenue - sourceRevenue) / sourceRevenue) * 100 : 0;
  const variableRatio = sourceRevenue > 0 ? sourceVariableCost / sourceRevenue : 0;
  const contributionRatio = sourceRevenue > 0 ? sourceContribution / sourceRevenue : 0;
  const salesLiterMultiplier = sourceRevenue > 0 ? targetRevenue / sourceRevenue : 1;
  const targetSalesLiters = sourceSalesLitersEffective > 0
    ? sourceSalesLitersEffective * salesLiterMultiplier
    : Number(draftPlanTargets.liters ?? 0);
  const targetNormalSalesLiters = Number(draftProductieTarget.normal_sales_l ?? draftProductieTarget.sales_l ?? 0);

  function wholeLiters(value: number) {
    return `${Math.round(Number(value || 0)).toLocaleString("nl-NL")} L`;
  }

  function plainNumber(value: number) {
    return Math.round(Number(value || 0)).toLocaleString("nl-NL");
  }

  function numberInput(value: number, onChange: (value: number) => void) {
    return (
      <input
        className="dataset-input"
        type="number"
        value={String(Math.round(Number(value || 0)))}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    );
  }

  function deriveFromRevenue(nextRevenue: number) {
    const cleanRevenue = Number(nextRevenue || 0);
    const multiplier = sourceRevenue > 0 ? cleanRevenue / sourceRevenue : 1;
    const nextVariableCost = cleanRevenue * variableRatio;
    const nextContribution = cleanRevenue - nextVariableCost;
    const nextSalesLiters = sourceSalesLitersEffective > 0 ? sourceSalesLitersEffective * multiplier : Number(draftPlanTargets.liters ?? 0);
    const nextUnits = Number(draftPlanTargets.units ?? 0) > 0
      ? Number(draftPlanTargets.units ?? 0)
      : 0;

    setDraftPlanTargets((current) => ({
      ...current,
      revenue: cleanRevenue,
      variable_cost: nextVariableCost,
      contribution: nextContribution,
      liters: nextSalesLiters,
      units: nextUnits
    }));

    setDraftProductieTarget((current) => ({
      ...current,
      normal_sales_l: nextSalesLiters,
      sales_l: nextSalesLiters,
      hoeveelheid_inkoop_l: sourceInkoopLiters > 0 ? sourceInkoopLiters * multiplier : Number(current.hoeveelheid_inkoop_l ?? 0),
      hoeveelheid_productie_l: sourceProductieLiters > 0 ? sourceProductieLiters * multiplier : Number(current.hoeveelheid_productie_l ?? 0),
      normal_shipments: sourceNormalShipments > 0 ? sourceNormalShipments * multiplier : Number(current.normal_shipments ?? 0),
      shipments: sourceShipments > 0 ? sourceShipments * multiplier : Number(current.shipments ?? current.normal_shipments ?? 0),
      normal_orderlines: sourceNormalOrderlines > 0 ? sourceNormalOrderlines * multiplier : Number(current.normal_orderlines ?? 0),
      orderlines: sourceOrderlines > 0 ? sourceOrderlines * multiplier : Number(current.orderlines ?? current.normal_orderlines ?? 0)
    }));
  }

  function updateProductieTarget(key: keyof ProductieYear, value: number) {
    const cleanValue = Number(value || 0);
    setDraftProductieTarget((current) => ({ ...current, [key]: cleanValue }));
  }

  function updateSalesDriver(value: number) {
    const cleanValue = Number(value || 0);
    setDraftProductieTarget((current) => ({
      ...current,
      normal_sales_l: cleanValue,
      sales_l: cleanValue
    }));
  }

  const sourceRealityRows = [
    { label: "Omzet", value: formatEur(sourceRevenue), help: "Werkelijke omzet uit de afgesloten jaarset." },
    { label: "Variabele kosten", value: formatEur(sourceVariableCost), help: "Uit Omzet & Marge: integrale kostprijs minus ABC." },
    { label: "Contributie", value: formatEur(sourceContribution), help: "Omzet minus variabele kosten." },
    { label: "Vaste kosten", value: formatEur(sourceFixedCost), help: "Werkelijke vaste kosten uit de jaarafsluiting." },
    { label: "Inkoop in L", value: wholeLiters(sourceInkoopLiters), help: "Werkelijke inkoopliters uit de voorraadbrug." },
    { label: "Productie in L", value: wholeLiters(sourceProductieLiters), help: "Werkelijke afvul-/productieliters uit de voorraadbrug." },
    { label: "Sales in L", value: wholeLiters(sourceSalesLitersEffective), help: "Werkelijke verkoopliters uit de voorraadbrug." },
    { label: "Shipments", value: plainNumber(sourceShipments), help: "Werkelijke shipments uit het bronjaar." },
    { label: "Orderregels", value: plainNumber(sourceOrderlines), help: "Werkelijke orderregels uit het bronjaar." }
  ];

  const costDriverRows = [
    {
      label: "Plan omzet",
      source: formatEur(sourceRevenue),
      target: (
        <input
          className="dataset-input"
          type="number"
          value={String(Number(draftPlanTargets.revenue ?? 0))}
          onChange={(event) => deriveFromRevenue(Number(event.target.value))}
        />
      ),
      help: "Startpunt voor het doeljaar. Bij wijziging worden resultaatwaarden en kostprijsdrivers afgeleid van de bronjaarverhouding; je kunt drivers daarna handmatig bijsturen."
    },
    {
      label: "Normale sales L voor ABC",
      source: wholeLiters(sourceSalesLitersEffective),
      target: numberInput(targetNormalSalesLiters, updateSalesDriver),
      help: "Deze waarde gebruikt de kostprijsengine voor sales-driven ABC-regels. Meer prijs verandert deze driver niet automatisch."
    },
    {
      label: "Inkoop in L",
      source: wholeLiters(sourceInkoopLiters),
      target: numberInput(Number(draftProductieTarget.hoeveelheid_inkoop_l ?? 0), (value) => updateProductieTarget("hoeveelheid_inkoop_l", value)),
      help: "Driver voor purchased/productie-gerelateerde inkoopliters in het doeljaar."
    },
    {
      label: "Productie in L",
      source: wholeLiters(sourceProductieLiters),
      target: numberInput(Number(draftProductieTarget.hoeveelheid_productie_l ?? 0), (value) => updateProductieTarget("hoeveelheid_productie_l", value)),
      help: "Driver voor eigen productie en productie-gerelateerde ABC-regels."
    },
    {
      label: "Normale shipments",
      source: plainNumber(sourceNormalShipments),
      target: numberInput(Number(draftProductieTarget.normal_shipments ?? 0), (value) => updateProductieTarget("normal_shipments", value)),
      help: "Driver voor vaste kosten met SHIPMENTS, zoals autokosten."
    },
    {
      label: "Shipments",
      source: plainNumber(sourceShipments),
      target: numberInput(Number(draftProductieTarget.shipments ?? draftProductieTarget.normal_shipments ?? 0), (value) => updateProductieTarget("shipments", value)),
      help: "Actuele/verwachte shipments voor het doeljaar. Meestal gelijk aan normale shipments."
    },
    {
      label: "Normale orderregels",
      source: plainNumber(sourceNormalOrderlines),
      target: numberInput(Number(draftProductieTarget.normal_orderlines ?? 0), (value) => updateProductieTarget("normal_orderlines", value)),
      help: "Driver voor orderregel/pick-logica."
    },
    {
      label: "Orderregels",
      source: plainNumber(sourceOrderlines),
      target: numberInput(Number(draftProductieTarget.orderlines ?? draftProductieTarget.normal_orderlines ?? 0), (value) => updateProductieTarget("orderlines", value)),
      help: "Actuele/verwachte orderregels voor het doeljaar. Meestal gelijk aan normale orderregels."
    },
    {
      label: "Batchgrootte eigen productie",
      source: wholeLiters(Number((sourceProductie as any)?.batchgrootte_eigen_productie_l ?? 0)),
      target: numberInput(Number(draftProductieTarget.batchgrootte_eigen_productie_l ?? 0), (value) => updateProductieTarget("batchgrootte_eigen_productie_l", value)),
      help: "Technische batchgrootte voor eigen productie."
    }
  ];

  const resultRows = [
    {
      label: "Omzet",
      source: formatEur(sourceRevenue),
      target: formatEur(Number(draftPlanTargets.revenue ?? 0)),
      help: "Read-only weergave van de planomzet uit Kostprijsparameters."
    },
    {
      label: "Plan variabele kosten",
      source: formatEur(sourceVariableCost),
      target: formatEur(Number(draftPlanTargets.variable_cost ?? 0)),
      help: `Afgeleid uit bronjaar-ratio ${Number.isFinite(variableRatio) ? (variableRatio * 100).toFixed(1) : "0.0"}%.`
    },
    {
      label: "Plan contributie",
      source: formatEur(sourceContribution),
      target: formatEur(Number(draftPlanTargets.contribution ?? 0)),
      help: `Omzet minus variabele kosten. Bronjaar-ratio ${Number.isFinite(contributionRatio) ? (contributionRatio * 100).toFixed(1) : "0.0"}%.`
    },
    {
      label: "Plan vaste kosten",
      source: formatEur(sourceFixedCost),
      target: formatEur(Number(targetFixedCostTotal ?? 0)),
      help: "Komt uit stap Vaste kosten. Hier read-only zodat ABC-overhead de enige bron blijft."
    },
    {
      label: "Verwachte sales in L",
      source: wholeLiters(sourceSalesLitersEffective),
      target: wholeLiters(targetSalesLiters),
      help: "Resultaatverwachting bij gelijke gemiddelde prijs per liter. Dit is niet automatisch de ABC-driver."
    },
    {
      label: "Plan resultaat",
      source: formatEur(sourceContribution - sourceFixedCost),
      target: formatEur(Number(draftPlanTargets.contribution ?? 0) - Number(targetFixedCostTotal ?? 0)),
      help: "Contributie minus vaste kosten, nog zonder latere prijs-/mixcorrecties."
    },
    {
      label: "Plan break-even omzet",
      source: contributionRatio > 0 ? formatEur(sourceFixedCost / contributionRatio) : formatEur(0),
      target: contributionRatio > 0 ? formatEur(Number(targetFixedCostTotal ?? 0) / contributionRatio) : formatEur(0),
      help: "Gebaseerd op de contributieratio van het bronjaar."
    },
    {
      label: "Productie/inkoop totaal",
      source: wholeLiters(sourceTotalLiters),
      target: wholeLiters(targetProductionPlanLiters),
      help: "Capaciteits-/voorraadplan. Dit staat naast sales liters en mag bewust afwijken."
    }
  ];

  return (
    <div>
      <div className="placeholder-block" style={{ marginBottom: 14 }}>
        <strong>Bronjaar werkelijkheid {sourceYear}</strong>
        <div className="muted" style={{ marginTop: 8 }}>
          Deze waarden zijn read-only en vormen de reality check voor je plan. Ze komen uit de jaarafsluiting en voorraadbrug
          waar die beschikbaar zijn.
        </div>
        <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
          <table className="dataset-editor-table wizard-table-compact nieuw-jaar-plan-table">
            <thead>
              <tr>
                <th style={{ width: "220px" }}>Waarde</th>
                <th style={{ width: "180px" }}>{sourceYear}</th>
                <th>Toelichting</th>
              </tr>
            </thead>
            <tbody>
              {sourceRealityRows.map((row) => (
                <tr key={row.label}>
                  <td><strong>{row.label}</strong></td>
                  <td className="muted">{row.value}</td>
                  <td className="muted">{row.help}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="placeholder-block" style={{ marginBottom: 14 }}>
        <strong>Kostprijsparameters {targetYear}</strong>
        <div className="muted" style={{ marginTop: 8 }}>
          Deze waarden sturen de kostprijs en ABC-overhead. Meer prijs geeft een beter resultaat, maar verlaagt de kostprijs niet.
          Meer volume of meer driver-eenheden verdeelt vaste kosten over meer liters of regels. Pas de omzet aan om drivers af te leiden,
          of stuur de drivers daarna handmatig bij.
        </div>
        <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
          <table className="dataset-editor-table wizard-table-compact nieuw-jaar-plan-table">
            <thead>
              <tr>
                <th style={{ width: "220px" }}>Driver</th>
                <th style={{ width: "180px" }}>Waarde {sourceYear}</th>
                <th style={{ width: "220px" }}>Waarde {targetYear}</th>
                <th>Toelichting</th>
              </tr>
            </thead>
            <tbody>
              {costDriverRows.map((row) => (
                <tr key={row.label}>
                  <td><strong>{row.label}</strong></td>
                  <td className="muted">{row.source}</td>
                  <td>{row.target}</td>
                  <td className="muted">{row.help}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="placeholder-block" style={{ marginBottom: 14 }}>
        <strong>Verwacht resultaat {targetYear}</strong>
        <div className="muted" style={{ marginTop: 8 }}>
          Dit blok laat zien wat je verwacht op basis van omzet, variabele-kostenratio en vaste kosten. Het is de resultaatkant
          van het plan, niet de verborgen bron voor ABC.
        </div>
        <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
          <table className="dataset-editor-table wizard-table-compact nieuw-jaar-plan-table">
            <thead>
              <tr>
                <th style={{ width: "220px" }}>Resultaat</th>
                <th style={{ width: "180px" }}>Waarde {sourceYear}</th>
                <th style={{ width: "220px" }}>Waarde {targetYear}</th>
                <th>Toelichting</th>
              </tr>
            </thead>
            <tbody>
              {resultRows.map((row) => (
                <tr key={row.label}>
                  <td><strong>{row.label}</strong></td>
                  <td className="muted">{row.source}</td>
                  <td>{row.target}</td>
                  <td className="muted">{row.help}</td>
                </tr>
              ))}
              <tr>
                <td><strong>Mix-aanname</strong></td>
                <td className="muted">Bronmix {sourceYear}</td>
                <td>
                  <input
                    className="dataset-input"
                    value={String(draftPlanTargets.mix_assumption ?? "")}
                    onChange={(event) => setDraftPlanTargets((current) => ({ ...current, mix_assumption: event.target.value }))}
                  />
                </td>
                <td className="muted">Beschrijf kort of de verkoopmix gelijk blijft of bewust verschuift.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          Omzetverschil t.o.v. afgesloten bronjaar: {Number.isFinite(revenueDeltaPct) ? revenueDeltaPct.toFixed(1) : "0.0"}%.
        </div>
      </div>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(1)}
            disabled={isRunning}
          >
            Vorige
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={copyProductieFromSource}
            disabled={!sourceProductie}
          >
            Kopieer bronjaar
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={saveProductieTarget}
            disabled={isRunning}
          >
            Opslaan
          </button>
          <button
            type="button"
            className="editor-button"
            onClick={() => void navigateToStep(3)}
            disabled={isRunning}
          >
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}

