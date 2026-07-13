"use client";

import { useMemo, type ReactNode } from "react";

type GenericRecord = Record<string, unknown>;

type ProductieYear = {
  hoeveelheid_inkoop_l: number;
  hoeveelheid_productie_l: number;
};

type PlanTargets = {
  revenue: number;
  variable_cost: number;
  contribution: number;
  liters: number;
};

const LIST_PRICE_CODE = "list";

function num(value: unknown) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function liters(value: unknown) {
  return `${Math.round(num(value)).toLocaleString("nl-NL")} L`;
}

function readListPrice(row: GenericRecord | undefined): number {
  const prices = row?.sell_in_prices;
  if (!prices || typeof prices !== "object") return 0;
  return num((prices as GenericRecord)[LIST_PRICE_CODE]);
}

export function PlanHercontroleStep({
  sourceYear,
  targetYear,
  draftPlanTargets,
  draftProductieTarget,
  targetFixedCostTotal,
  targetIncidentalCostTotal,
  sourceYearCloseReference,
  currentVerkoopprijzen,
  draftVerkoopstrategieTarget,
  liveVerkoopstrategieRows,
  formatEur,
  saveAndCloseButton,
  navigateToStep,
}: {
  sourceYear: number;
  targetYear: number;
  draftPlanTargets: PlanTargets;
  draftProductieTarget: ProductieYear;
  targetFixedCostTotal: number;
  targetIncidentalCostTotal: number;
  sourceYearCloseReference?: Record<string, number>;
  currentVerkoopprijzen: GenericRecord[];
  draftVerkoopstrategieTarget: GenericRecord[];
  liveVerkoopstrategieRows: GenericRecord[];
  formatEur: (value: number) => string;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
}) {
  const priceIndex = useMemo(() => {
    const sourceBySku = new Map<string, number>();
    (Array.isArray(currentVerkoopprijzen) ? currentVerkoopprijzen : []).forEach((row) => {
      if (Number(row.jaar ?? 0) !== sourceYear) return;
      if (String(row.record_type ?? "") !== "verkoopstrategie_product") return;
      const skuId = String(row.sku_id ?? "").trim();
      const price = readListPrice(row);
      if (skuId && price > 0) sourceBySku.set(skuId, price);
    });

    const targetBySku = new Map<string, number>();
    const collectTarget = (rows: GenericRecord[]) => {
      rows.forEach((row) => {
        if (Number(row.jaar ?? 0) !== targetYear) return;
        if (String(row.record_type ?? "") !== "verkoopstrategie_product") return;
        const skuId = String(row.sku_id ?? "").trim();
        const price = readListPrice(row);
        if (skuId && price > 0) targetBySku.set(skuId, price);
      });
    };
    collectTarget(Array.isArray(draftVerkoopstrategieTarget) ? draftVerkoopstrategieTarget : []);
    collectTarget(Array.isArray(liveVerkoopstrategieRows) ? liveVerkoopstrategieRows : []);

    const ratios: number[] = [];
    targetBySku.forEach((targetPrice, skuId) => {
      const sourcePrice = sourceBySku.get(skuId) ?? 0;
      if (sourcePrice > 0 && targetPrice > 0) ratios.push(targetPrice / sourcePrice);
    });
    if (!ratios.length) return 1;
    return ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  }, [currentVerkoopprijzen, draftVerkoopstrategieTarget, liveVerkoopstrategieRows, sourceYear, targetYear]);

  const planRevenue = num(draftPlanTargets.revenue);
  const finalRevenue = planRevenue * priceIndex;
  const plannedSalesLiters = num(draftPlanTargets.liters);
  const finalSalesLiters = priceIndex > 0 ? plannedSalesLiters / priceIndex : plannedSalesLiters;
  const productionNeedBeforeStock = num(draftProductieTarget.hoeveelheid_inkoop_l) + num(draftProductieTarget.hoeveelheid_productie_l);
  const openingStockLiters = num(sourceYearCloseReference?.inventoryEndLiters);
  const productionNeedAfterStock = Math.max(0, productionNeedBeforeStock - openingStockLiters);
  const contribution = num(draftPlanTargets.contribution);
  const fixedCosts = num(targetFixedCostTotal);
  const incidentalCosts = num(targetIncidentalCostTotal);
  const result = contribution - fixedCosts - incidentalCosts;
  const contributionRatio = planRevenue > 0 ? contribution / planRevenue : 0;
  const breakEvenRevenue = contributionRatio > 0 ? (fixedCosts + incidentalCosts) / contributionRatio : 0;

  const rows = [
    { label: "Planomzet", value: formatEur(planRevenue), help: "Omzetdoel uit de eerste planstap." },
    { label: "Finale omzet na prijswijzigingen", value: formatEur(finalRevenue), help: `Indicatief via gemiddelde sell-in index ${(priceIndex * 100).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%.` },
    { label: "Benodigde verkoopliters", value: liters(finalSalesLiters), help: "Omzetdoel omgerekend met finale prijsindex. Variabele kosten wijzigen hierdoor nog niet." },
    { label: "Beginvoorraad doeljaar", value: liters(openingStockLiters), help: `Eindvoorraad uit jaarafsluiting ${sourceYear}.` },
    { label: "Productie-/inkoopbehoefte voor voorraad", value: liters(productionNeedBeforeStock), help: "Planvolume uit de eerste planstap." },
    { label: "Voorraadcorrectie", value: `-${liters(openingStockLiters)}`, help: "Voorraad verlaagt alleen de behoefte om nieuw te kopen/produceren." },
    { label: "Productie-/inkoopbehoefte na voorraad", value: liters(productionNeedAfterStock), help: "Voorlopige stuurwaarde voor capaciteit en inkoop." },
    { label: "Contributie", value: formatEur(contribution), help: "Blijft uit bestaande planlogica; voorraad heeft hier nu geen effect op." },
    { label: "Vaste kosten", value: formatEur(fixedCosts), help: "Uit stap Vaste kosten." },
    { label: "Incidentele kosten", value: formatEur(incidentalCosts), help: "Uit doeljaar-kostenstructuur indien aanwezig." },
    { label: "Break-even omzet", value: formatEur(breakEvenRevenue), help: "Vaste + incidentele kosten gedeeld door contributieratio." },
    { label: "Verwacht resultaat", value: formatEur(result), help: "Contributie minus vaste en incidentele kosten." },
  ];

  return (
    <div>
      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div className="module-card-title">Plan {targetYear} opnieuw</div>
        <div className="module-card-text">
          Laatste controle na kostprijs, verkoopstrategie, adviesprijzen en voorraad. Voorraad verlaagt hier alleen de
          productie-/inkoopbehoefte; variabele kosten blijven uit de bestaande planlogica komen.
        </div>
      </div>

      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: "260px" }}>Onderdeel</th>
              <th style={{ width: "180px" }}>Waarde</th>
              <th>Toelichting</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td><strong>{row.label}</strong></td>
                <td>{row.value}</td>
                <td className="muted">{row.help}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="editor-actions wizard-footer-actions">
        <button type="button" className="editor-button editor-button-secondary" onClick={() => navigateToStep(11)}>
          Vorige
        </button>
        {saveAndCloseButton}
        <button type="button" className="editor-button editor-button-primary" onClick={() => navigateToStep(13)}>
          Volgende
        </button>
      </div>
    </div>
  );
}
