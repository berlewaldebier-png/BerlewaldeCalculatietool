"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TabId = "dashboard" | "pnl" | "break_even" | "contribution" | "plan_actual" | "variance" | "scenario" | "year_close";

type ProductRow = {
  id: string;
  style: string;
  skuType: string;
  sku: string;
  plannedUnits: number;
  actualUnitsYtd: number;
  reforecastUnits: number;
  litersPerUnit: number;
  plannedPrice: number;
  actualPrice: number;
  purchase: number;
  excise: number;
  packaging: number;
  abcAllocation: number;
};

type ScenarioState = {
  pricePct: number;
  volumePct: number;
  fixedCostPct: number;
};

const tabs: Array<{ id: TabId; title: string; description: string }> = [
  { id: "dashboard", title: "Dashboard", description: "Zijn we op koers?" },
  { id: "pnl", title: "Resultaatrekening", description: "Exact-achtige opbouw" },
  { id: "break_even", title: "Break-even", description: "Waar is resultaat nul?" },
  { id: "contribution", title: "Contributie", description: "Van verkoopprijs naar marge" },
  { id: "plan_actual", title: "Plan vs actual", description: "Volume en omzet" },
  { id: "variance", title: "Varianties", description: "Waarom wijken we af?" },
  { id: "scenario", title: "Scenario lab", description: "Wat als?" },
  { id: "year_close", title: "Jaarafsluiting", description: "Finale waarheid" },
];

const products: ProductRow[] = [
  { id: "blond-fust", style: "Blond", skuType: "Fust", sku: "Berlewalde Blond - Fust 20L", plannedUnits: 360, actualUnitsYtd: 170, reforecastUnits: 330, litersPerUnit: 20, plannedPrice: 89, actualPrice: 88.4, purchase: 60.5, excise: 9.7, packaging: 0, abcAllocation: 18.4 },
  { id: "blond-doos", style: "Blond", skuType: "Doos", sku: "Berlewalde Blond - Doos 24 x 33cl", plannedUnits: 720, actualUnitsYtd: 420, reforecastUnits: 800, litersPerUnit: 7.92, plannedPrice: 44.2, actualPrice: 44.8, purchase: 22.9, excise: 3.9, packaging: 0.8, abcAllocation: 10.2 },
  { id: "ipa-doos", style: "IPA", skuType: "Doos", sku: "Berlewalde IPA - Doos 24 x 33cl", plannedUnits: 540, actualUnitsYtd: 250, reforecastUnits: 500, litersPerUnit: 7.92, plannedPrice: 46.5, actualPrice: 45.6, purchase: 24.5, excise: 4.1, packaging: 0.8, abcAllocation: 10.7 },
  { id: "triple-doos", style: "Triple", skuType: "Doos", sku: "Berlewalde Triple - Doos 24 x 33cl", plannedUnits: 610, actualUnitsYtd: 330, reforecastUnits: 640, litersPerUnit: 7.92, plannedPrice: 48.8, actualPrice: 49.1, purchase: 25.9, excise: 5.2, packaging: 0.8, abcAllocation: 11.4 },
  { id: "weizen-fust", style: "Weizen", skuType: "Fust", sku: "Berlewalde Weizen - Fust 20L", plannedUnits: 260, actualUnitsYtd: 145, reforecastUnits: 290, litersPerUnit: 20, plannedPrice: 88.5, actualPrice: 88.5, purchase: 61.1, excise: 9.7, packaging: 0, abcAllocation: 18.1 },
  { id: "dubbel-fust", style: "Dubbel", skuType: "Fust", sku: "Berlewalde Dubbel - Fust 20L", plannedUnits: 210, actualUnitsYtd: 80, reforecastUnits: 170, litersPerUnit: 20, plannedPrice: 91, actualPrice: 89.8, purchase: 58.9, excise: 10.2, packaging: 0, abcAllocation: 18.8 },
  { id: "giftset", style: "Geschenken", skuType: "Geschenk", sku: "Geschenkverpakking 4 x 33cl", plannedUnits: 900, actualUnitsYtd: 260, reforecastUnits: 760, litersPerUnit: 1.32, plannedPrice: 16.49, actualPrice: 16.49, purchase: 7.9, excise: 0.8, packaging: 2.5, abcAllocation: 2.4 },
  { id: "glas", style: "Merchandise", skuType: "Merchandise", sku: "Berlewalde Glas 33cl", plannedUnits: 800, actualUnitsYtd: 300, reforecastUnits: 690, litersPerUnit: 0, plannedPrice: 3.95, actualPrice: 3.95, purchase: 1.95, excise: 0, packaging: 0, abcAllocation: 0.4 },
];

const planFixedCosts = 80000;
const actualFixedCostsYtd = 41500;
const reforecastFixedCosts = 83500;
const plannedNormalLiters = 40000;

const revenuePhasing = [
  { month: "Jan", planPct: 0.05, actualPct: 0.052, reforecastPct: 0.052 },
  { month: "Feb", planPct: 0.11, actualPct: 0.105, reforecastPct: 0.105 },
  { month: "Mrt", planPct: 0.18, actualPct: 0.165, reforecastPct: 0.165 },
  { month: "Apr", planPct: 0.27, actualPct: 0.238, reforecastPct: 0.238 },
  { month: "Mei", planPct: 0.37, actualPct: 0.335, reforecastPct: 0.335 },
  { month: "Jun", planPct: 0.48, actualPct: 0.445, reforecastPct: 0.445 },
  { month: "Jul", planPct: 0.58, actualPct: null, reforecastPct: 0.545 },
  { month: "Aug", planPct: 0.67, actualPct: null, reforecastPct: 0.625 },
  { month: "Sep", planPct: 0.76, actualPct: null, reforecastPct: 0.715 },
  { month: "Okt", planPct: 0.86, actualPct: null, reforecastPct: 0.82 },
  { month: "Nov", planPct: 0.94, actualPct: null, reforecastPct: 0.91 },
  { month: "Dec", planPct: 1, actualPct: null, reforecastPct: 1 },
];

function money(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);
}

function money2(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number.isFinite(value) ? value : 0);
}

function number(value: number, digits = 0) {
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number.isFinite(value) ? value : 0);
}

function variableCost(row: ProductRow) {
  return row.purchase + row.excise + row.packaging;
}

function contributionUnit(row: ProductRow, mode: "plan" | "actual" | "reforecast" = "plan") {
  const price = mode === "actual" ? row.actualPrice : row.plannedPrice;
  return price - variableCost(row);
}

function allocatedMarginUnit(row: ProductRow, mode: "plan" | "actual" | "reforecast" = "plan") {
  return contributionUnit(row, mode) - row.abcAllocation;
}

function sumBy(rows: ProductRow[], unitsKey: "plannedUnits" | "actualUnitsYtd" | "reforecastUnits", mode: "plan" | "actual" | "reforecast") {
  const revenue = rows.reduce((sum, row) => sum + row[unitsKey] * (mode === "actual" ? row.actualPrice : row.plannedPrice), 0);
  const variable = rows.reduce((sum, row) => sum + row[unitsKey] * variableCost(row), 0);
  const abc = rows.reduce((sum, row) => sum + row[unitsKey] * row.abcAllocation, 0);
  const liters = rows.reduce((sum, row) => sum + row[unitsKey] * row.litersPerUnit, 0);
  return {
    revenue,
    variable,
    contribution: revenue - variable,
    abc,
    allocatedMargin: revenue - variable - abc,
    liters,
    units: rows.reduce((sum, row) => sum + row[unitsKey], 0),
  };
}

function buildScenario(rows: ProductRow[], scenario: ScenarioState) {
  const priceFactor = 1 + scenario.pricePct / 100;
  const volumeFactor = 1 + scenario.volumePct / 100;
  const fixedFactor = 1 + scenario.fixedCostPct / 100;
  const revenue = rows.reduce((sum, row) => sum + row.reforecastUnits * volumeFactor * row.plannedPrice * priceFactor, 0);
  const variable = rows.reduce((sum, row) => sum + row.reforecastUnits * volumeFactor * variableCost(row), 0);
  const contribution = revenue - variable;
  const fixedCosts = reforecastFixedCosts * fixedFactor;
  return {
    revenue,
    variable,
    contribution,
    fixedCosts,
    result: contribution - fixedCosts,
    breakEvenRevenue: contribution > 0 && revenue > 0 ? fixedCosts / (contribution / revenue) : 0,
  };
}

function buildRevenueTimeline(planRevenue: number, actualRevenue: number, reforecastRevenue: number) {
  return revenuePhasing.map((point) => ({
    month: point.month,
    plan: planRevenue * point.planPct,
    actual: point.actualPct === null ? null : actualRevenue * (point.actualPct / 0.445),
    reforecast: reforecastRevenue * point.reforecastPct,
  }));
}

function estimateBreakEvenMonth(timeline: Array<{ month: string; reforecast: number }>, breakEvenRevenue: number) {
  const hit = timeline.find((point) => point.reforecast >= breakEvenRevenue);
  return hit?.month ?? "niet binnen dit jaar";
}

export function BreakEvenNextMockup() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [query, setQuery] = useState("");
  const [scenario, setScenario] = useState<ScenarioState>({ pricePct: 5, volumePct: 8, fixedCostPct: 0 });

  const plan = useMemo(() => sumBy(products, "plannedUnits", "plan"), []);
  const actual = useMemo(() => sumBy(products, "actualUnitsYtd", "actual"), []);
  const reforecast = useMemo(() => sumBy(products, "reforecastUnits", "reforecast"), []);
  const scenarioResult = useMemo(() => buildScenario(products, scenario), [scenario]);
  const fixedRate = planFixedCosts / plannedNormalLiters;
  const occupancyResult = (reforecast.liters - plannedNormalLiters) * fixedRate;
  const planResult = plan.contribution - planFixedCosts;
  const reforecastResult = reforecast.contribution - reforecastFixedCosts;
  const revenueTimeline = useMemo(() => buildRevenueTimeline(plan.revenue, actual.revenue, reforecast.revenue), [actual.revenue, plan.revenue, reforecast.revenue]);
  const revenueGap = reforecast.revenue - plan.revenue;
  const revenueGapPct = plan.revenue > 0 ? (revenueGap / plan.revenue) * 100 : 0;
  const contributionGap = plan.contribution - reforecast.contribution;
  const resultGap = planResult - reforecastResult;
  const neededPricePct = reforecast.revenue > 0 ? Math.max(0, (plan.revenue / reforecast.revenue - 1) * 100) : 0;
  const neededVolumePct = reforecast.contribution > 0 ? Math.max(0, ((plan.contribution / reforecast.contribution) - 1) * 100) : 0;
  const neededResultPricePct = reforecast.revenue > 0 ? Math.max(0, resultGap / reforecast.revenue * 100) : 0;
  const neededResultVolumePct = reforecast.contribution > 0 ? Math.max(0, resultGap / reforecast.contribution * 100) : 0;
  const balancedPricePct = neededResultPricePct / 2;
  const balancedVolumePct = neededResultVolumePct / 2;
  const reforecastContributionRatio = reforecast.revenue > 0 ? reforecast.contribution / reforecast.revenue : 0;
  const reforecastVariableRatio = reforecast.revenue > 0 ? reforecast.variable / reforecast.revenue : 0;
  const contributionPerLiter = reforecast.liters > 0 ? reforecast.contribution / reforecast.liters : 0;
  const contributionPerUnit = reforecast.units > 0 ? reforecast.contribution / reforecast.units : 0;
  const breakEvenRevenue = reforecastContributionRatio > 0 ? reforecastFixedCosts / reforecastContributionRatio : 0;
  const breakEvenVariableCost = breakEvenRevenue * reforecastVariableRatio;
  const breakEvenContribution = breakEvenRevenue - breakEvenVariableCost;
  const breakEvenLiters = contributionPerLiter > 0 ? reforecastFixedCosts / contributionPerLiter : 0;
  const breakEvenUnits = contributionPerUnit > 0 ? reforecastFixedCosts / contributionPerUnit : 0;
  const breakEvenResultCheck = breakEvenRevenue - breakEvenVariableCost - reforecastFixedCosts;
  const remainingContributionYtd = Math.max(0, reforecastFixedCosts - actual.contribution);
  const expectedBreakEvenMonth = estimateBreakEvenMonth(revenueTimeline, breakEvenRevenue);

  const varianceRows = useMemo(() => {
    const priceVariance = products.reduce((sum, row) => sum + (row.actualPrice - row.plannedPrice) * row.reforecastUnits, 0);
    const volumeVariance = products.reduce((sum, row) => sum + (row.reforecastUnits - row.plannedUnits) * contributionUnit(row, "plan"), 0);
    const variableCostVariance = products.reduce((sum, row) => sum + (row.purchase * 0.02) * row.reforecastUnits * -1, 0);
    const mixVariance = reforecastResult - planResult - priceVariance - volumeVariance - variableCostVariance - occupancyResult;
    return [
      { key: "plan", label: "Gepland resultaat", value: planResult, kind: "result" },
      { key: "price", label: "Prijsverschil", value: priceVariance, kind: priceVariance >= 0 ? "positive" : "negative" },
      { key: "volume", label: "Volumeverschil", value: volumeVariance, kind: volumeVariance >= 0 ? "positive" : "negative" },
      { key: "mix", label: "Mixverschil", value: mixVariance, kind: mixVariance >= 0 ? "positive" : "negative" },
      { key: "cost", label: "Kostprijsverschil", value: variableCostVariance, kind: variableCostVariance >= 0 ? "positive" : "negative" },
      { key: "occupancy", label: "Bezettingsresultaat", value: occupancyResult, kind: occupancyResult >= 0 ? "positive" : "negative" },
      { key: "result", label: "Reforecast resultaat", value: reforecastResult, kind: "result" },
    ];
  }, [fixedRate, occupancyResult, planResult, reforecastResult, reforecast.liters]);

  const contributionRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return products
      .filter((row) => {
        if (!normalized) return true;
        return `${row.style} ${row.skuType} ${row.sku}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => b.reforecastUnits * contributionUnit(b, "reforecast") - a.reforecastUnits * contributionUnit(a, "reforecast"));
  }, [query]);

  const progressPct = Math.max(0, Math.min(130, (reforecast.contribution / reforecastFixedCosts) * 100));
  const largestVariance = [...varianceRows.filter((row) => row.key !== "plan" && row.key !== "result")].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];

  return (
    <div className="be-next-page">
      <section className="module-card">
        <div className="module-card-header be-next-hero">
          <div>
            <div className="module-card-title">Mock-up: break-even als stuurinstrument</div>
            <div className="module-card-text">
              Tijdelijke frontend-prototype met voorbeelddata. Dit scherm schrijft niets weg en verandert de bestaande break-even analyse niet.
            </div>
          </div>
          <span className="status-pill status-warning">mock-up</span>
        </div>
      </section>

      <div className="data-quality-tabs" role="tablist" aria-label="Break-even next onderdelen">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTab}
            className={`data-quality-tab${tab.id === activeTab ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.title}</span>
            <small>{tab.description}</small>
          </button>
        ))}
      </div>

      {activeTab === "dashboard" ? (
        <div className="wizard-stack">
          <div className="be-next-grid be-next-grid-3">
            <MetricCard label="Plan omzet" value={money(plan.revenue)} helper={`${number(plan.liters)} liter gepland`} />
            <MetricCard label="Actual YTD omzet" value={money(actual.revenue)} helper={`${number(actual.liters)} liter tot nu`} />
            <MetricCard label="Reforecast omzet" value={money(reforecast.revenue)} helper={`${number(reforecast.liters)} liter verwacht`} />
            <MetricCard label="Plan break-even omzet" value={money(planFixedCosts / (plan.contribution / plan.revenue))} helper="op basis van frozen plan" />
            <MetricCard label="Huidige break-even omzet" value={money(reforecastFixedCosts / (reforecast.contribution / reforecast.revenue))} helper="op basis van reforecast" />
            <MetricCard label="Verwacht resultaat" value={money(reforecastResult)} tone={reforecastResult >= 0 ? "positive" : "negative"} helper={`grootste driver: ${largestVariance?.label ?? "-"}`} />
          </div>

          <section className="module-card">
            <div className="module-card-title">Break-even voortgang</div>
            <div className="be-next-progress-row">
              <div className="be3-ring" style={{ background: `conic-gradient(#22c55e ${Math.min(100, progressPct) * 3.6}deg, #e5e7eb 0deg)` }}>
                <div>
                  <strong>{number(progressPct, 0)}%</strong>
                  <span>contributie</span>
                </div>
              </div>
              <div className="be-next-explain">
                <strong>Dit vertelt of de verwachte contributie genoeg is om vaste kosten te dragen.</strong>
                <p>
                  De mock-up houdt de geplande kostprijs vast en verklaart het verschil via prijs, volume, mix, kostprijs en bezettingsresultaat.
                </p>
              </div>
            </div>
          </section>

          <section className="module-card">
            <div className="module-card-header be-next-table-header">
              <div>
                <div className="module-card-title">Omzet over tijd: plan, actual en reforecast</div>
                <div className="module-card-text">Blauw is het oorspronkelijke plan. De actuele/reforecast lijn kleurt groen als we boven plan eindigen en rood als we eronder blijven.</div>
              </div>
              <span className={`status-pill ${revenueGap >= 0 ? "status-ok" : "status-error"}`}>
                {revenueGap >= 0 ? "boven plan" : "onder plan"} {number(revenueGapPct, 1)}%
              </span>
            </div>
            <div className="be-next-chart be-next-revenue-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueTimeline} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `€ ${Math.round(Number(value) / 1000)}k`} />
                  <Tooltip formatter={(value: number) => money(Number(value))} />
                  <Legend />
                  <Line type="monotone" dataKey="plan" name="Plan" stroke="#2563eb" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="actual" name="Actual YTD" stroke={revenueGap >= 0 ? "#16a34a" : "#dc2626"} strokeWidth={3} connectNulls={false} />
                  <Line type="monotone" dataKey="reforecast" name="Reforecast" stroke={revenueGap >= 0 ? "#16a34a" : "#dc2626"} strokeWidth={3} strokeDasharray="7 7" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className={`module-card be-next-advice ${revenueGap >= 0 ? "positive" : "negative"}`}>
            <div>
              <div className="module-card-title">Conclusie</div>
              <p>
                {revenueGap >= 0
                  ? `De reforecast ligt ${money(Math.abs(revenueGap))} boven plan. Stuur vooral op behoud van mix en contributie, niet alleen op extra omzet.`
                  : `De reforecast ligt ${money(Math.abs(revenueGap))} onder plan. Om het plan te halen is indicatief ${number(neededPricePct, 1)}% prijsverhoging of ${number(neededVolumePct, 1)}% extra contributievolume nodig.`}
              </p>
            </div>
            <div className="be-next-advice-actions">
              <span>Stuurgetal</span>
              <strong>Contributie</strong>
              <small>omzet blijft referentie</small>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "pnl" ? (
        <div className="be-next-grid be-next-grid-2">
          <PnlCard title="Plan" revenue={plan.revenue} variable={plan.variable} fixedCosts={planFixedCosts} />
          <PnlCard title="Reforecast" revenue={reforecast.revenue} variable={reforecast.variable} fixedCosts={reforecastFixedCosts} />
          <section className="module-card be-next-wide">
            <div className="module-card-title">Van resultaatrekening naar verklaard resultaat</div>
            <VarianceBridge rows={varianceRows} />
          </section>
        </div>
      ) : null}

      {activeTab === "break_even" ? (
        <div className="wizard-stack">
          <div className="be-next-grid be-next-grid-3">
            <MetricCard label="Break-even omzet" value={money(breakEvenRevenue)} helper="om vaste kosten te dekken" />
            <MetricCard label="Break-even liters" value={`${number(breakEvenLiters)} L`} helper="op huidige reforecast mix" />
            <MetricCard label="Break-even units" value={number(breakEvenUnits)} helper="gewogen gemiddelde units" />
            <MetricCard label="Nog contributie nodig" value={money(remainingContributionYtd)} helper="vanaf actual YTD tot vaste kosten" />
            <MetricCard label="Verwachte break-even maand" value={expectedBreakEvenMonth} helper="op basis van reforecast omzetlijn" />
            <MetricCard label="Controle resultaat" value={money(breakEvenResultCheck)} tone={Math.abs(breakEvenResultCheck) < 1 ? "positive" : "negative"} helper="moet rond nul zijn" />
          </div>

          <section className="module-card">
            <div className="module-card-header be-next-table-header">
              <div>
                <div className="module-card-title">Controleberekening bij break-even</div>
                <div className="module-card-text">Deze berekening bewijst dat de break-even omzet precies genoeg contributie oplevert om de vaste kosten te dragen.</div>
              </div>
              <span className="status-pill status-ok">resultaat = 0</span>
            </div>
            <div className="data-table">
              <table>
                <tbody>
                  <PnlRow label="Omzet op break-even" value={breakEvenRevenue} />
                  <PnlRow label="Variabele kosten bij huidige mix" value={-breakEvenVariableCost} />
                  <PnlRow label="Contributie" value={breakEvenContribution} strong />
                  <PnlRow label="Vaste kosten" value={-reforecastFixedCosts} />
                  <PnlRow label="Resultaat" value={breakEvenResultCheck} strong />
                </tbody>
              </table>
            </div>
          </section>

          <section className="module-card be-next-advice">
            <div>
              <div className="module-card-title">Interpretatie</div>
              <p>
                Bij de huidige mix levert elke euro omzet gemiddeld {number(reforecastContributionRatio * 100, 1)}% contributie op.
                Daardoor is {money(breakEvenRevenue)} omzet nodig om {money(reforecastFixedCosts)} vaste kosten te dekken.
              </p>
            </div>
            <div className="be-next-advice-actions">
              <span>Rekenbasis</span>
              <strong>{money2(contributionPerLiter)} / L</strong>
              <small>contributie per liter</small>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "contribution" ? (
        <section className="module-card">
          <div className="module-card-header be-next-table-header">
            <div>
              <div className="module-card-title">Van verkoopprijs naar contributie</div>
              <div className="module-card-text">Groepeerbaar per stijl/SKU-type; start met contributors en risico's, niet met alle 90 SKU's tegelijk.</div>
            </div>
            <input className="editor-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Zoek stijl, type of SKU" />
          </div>
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Prijs</th>
                  <th>Inkoop/productie</th>
                  <th>Accijns</th>
                  <th>Verpakking</th>
                  <th>Contributie</th>
                  <th>ABC allocatie</th>
                  <th>Marge na allocatie</th>
                </tr>
              </thead>
              <tbody>
                {contributionRows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.sku}</strong><br /><small>{row.style} - {row.skuType}</small></td>
                    <td>{money2(row.plannedPrice)}</td>
                    <td>{money2(row.purchase)}</td>
                    <td>{money2(row.excise)}</td>
                    <td>{money2(row.packaging)}</td>
                    <td><strong>{money2(contributionUnit(row))}</strong></td>
                    <td>{money2(row.abcAllocation)}</td>
                    <td>{money2(allocatedMarginUnit(row))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "plan_actual" ? (
        <section className="module-card">
          <div className="module-card-title">Plan vs actual vs reforecast</div>
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Stijl/type</th>
                  <th>Plan volume</th>
                  <th>Actual YTD</th>
                  <th>Reforecast</th>
                  <th>Plan contributie</th>
                  <th>Reforecast contributie</th>
                </tr>
              </thead>
              <tbody>
                {products.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.style}</strong><br /><small>{row.skuType}</small></td>
                    <td>{number(row.plannedUnits)} st / {number(row.plannedUnits * row.litersPerUnit)} L</td>
                    <td>{number(row.actualUnitsYtd)} st / {number(row.actualUnitsYtd * row.litersPerUnit)} L</td>
                    <td>{number(row.reforecastUnits)} st / {number(row.reforecastUnits * row.litersPerUnit)} L</td>
                    <td>{money(row.plannedUnits * contributionUnit(row))}</td>
                    <td>{money(row.reforecastUnits * contributionUnit(row, "reforecast"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "variance" ? (
        <div className="be-next-grid be-next-grid-2">
          <section className="module-card">
            <div className="module-card-title">Variance bridge</div>
            <div className="be-next-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={varianceRows}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} angle={-18} textAnchor="end" height={80} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `€ ${Math.round(Number(value) / 1000)}k`} />
                  <Tooltip formatter={(value: number) => money(Number(value))} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {varianceRows.map((entry) => (
                      <Cell key={entry.key} fill={entry.kind === "result" ? "#2563eb" : entry.value >= 0 ? "#22c55e" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="module-card">
            <div className="module-card-title">Bezettingsresultaat</div>
            <div className="placeholder-block">
              <strong>{money(occupancyResult)}</strong>
              <div className="muted">
                Formule: ({number(reforecast.liters)} L reforecast - {number(plannedNormalLiters)} L normale bezetting) x {money2(fixedRate)} vaste kosten per liter.
              </div>
            </div>
            <div className="module-card-text">
              Dit resultaat verklaart dat vaste kosten over minder of meer volume worden terugverdiend dan gepland. De geplande kostprijs blijft dus intact.
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "scenario" ? (
        <div className="wizard-stack">
          <div className="be-next-grid be-next-grid-2">
            <section className="module-card">
              <div className="module-card-title">Scenario lab</div>
              <ScenarioSlider label="Prijs" value={scenario.pricePct} min={-10} max={15} onChange={(pricePct) => setScenario((current) => ({ ...current, pricePct }))} />
              <ScenarioSlider label="Volume" value={scenario.volumePct} min={-25} max={30} onChange={(volumePct) => setScenario((current) => ({ ...current, volumePct }))} />
              <ScenarioSlider label="Vaste kosten" value={scenario.fixedCostPct} min={-20} max={20} onChange={(fixedCostPct) => setScenario((current) => ({ ...current, fixedCostPct }))} />
            </section>
            <section className="module-card">
              <div className="module-card-title">Scenario uitkomst</div>
              <div className="record-card-grid">
                <MetricCard label="Omzet" value={money(scenarioResult.revenue)} />
                <MetricCard label="Contributie" value={money(scenarioResult.contribution)} />
                <MetricCard label="Vaste kosten" value={money(scenarioResult.fixedCosts)} />
                <MetricCard label="Resultaat" value={money(scenarioResult.result)} tone={scenarioResult.result >= 0 ? "positive" : "negative"} />
                <MetricCard label="Break-even omzet" value={money(scenarioResult.breakEvenRevenue)} />
              </div>
            </section>
          </div>

          <section className="module-card">
            <div className="module-card-header">
              <div className="module-card-title">Advieskaarten om het gat te sluiten</div>
              <div className="module-card-text">Indicatief op basis van huidige reforecast. Deze kaarten schrijven niets weg en zijn bedoeld als stuurinformatie.</div>
            </div>
            <div className="be-next-grid be-next-grid-4">
              <AdviceCard
                title="Prijs"
                value={`+${number(neededResultPricePct, 1)}%`}
                helper={`prijs nodig om ${money(Math.max(0, resultGap))} resultaatgat te sluiten`}
                mutedValue={`omzetgat: +${number(neededPricePct, 1)}%`}
              />
              <AdviceCard
                title="Volume"
                value={`+${number(neededResultVolumePct, 1)}%`}
                helper="extra contributievolume bij gelijke prijs en mix"
                mutedValue={`contributiegat: ${money(Math.max(0, contributionGap))}`}
              />
              <AdviceCard
                title="Gebalanceerd"
                value={`+${number(balancedPricePct, 1)}% / +${number(balancedVolumePct, 1)}%`}
                helper="helft via prijs, helft via volume"
                mutedValue="eerste realistische stuurvariant"
              />
              <AdviceCard
                title="Vaste kosten"
                value={money(Math.max(0, resultGap))}
                helper="kostenreductie nodig als prijs en volume gelijk blijven"
                mutedValue={`huidige vaste kosten: ${money(reforecastFixedCosts)}`}
              />
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "year_close" ? (
        <div className="be-next-grid be-next-grid-2">
          <section className="module-card">
            <div className="module-card-title">Jaarafsluiting preview</div>
            <div className="data-table">
              <table>
                <tbody>
                  <PnlRow label="Omzet" value={reforecast.revenue} />
                  <PnlRow label="Variabele kosten" value={-reforecast.variable} />
                  <PnlRow label="Contributie" value={reforecast.contribution} strong />
                  <PnlRow label="Vaste kosten" value={-reforecastFixedCosts} />
                  <PnlRow label="Operationeel resultaat" value={reforecastResult} strong />
                  <PnlRow label="Bezettingsresultaat t.o.v. plan" value={occupancyResult} />
                </tbody>
              </table>
            </div>
          </section>
          <section className="module-card">
            <div className="module-card-title">Handoff naar Nieuw jaar voorbereiden</div>
            <div className="placeholder-block">
              <strong>Expliciete keuze nodig</strong>
              <div className="muted">
                Na jaarafsluiting kan de gebruiker kiezen of gesloten actuals worden gebruikt als basis voor het nieuwe conceptjaar. Niets wordt stil overschreven.
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value, helper, tone }: { label: string; value: string; helper?: string; tone?: "positive" | "negative" }) {
  return (
    <section className={`module-card be-next-metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </section>
  );
}

function AdviceCard({ title, value, helper, mutedValue }: { title: string; value: string; helper: string; mutedValue: string }) {
  return (
    <section className="be-next-advice-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
      <small>{mutedValue}</small>
    </section>
  );
}

function PnlCard({ title, revenue, variable, fixedCosts }: { title: string; revenue: number; variable: number; fixedCosts: number }) {
  const contribution = revenue - variable;
  const result = contribution - fixedCosts;
  return (
    <section className="module-card">
      <div className="module-card-title">{title}</div>
      <div className="data-table">
        <table>
          <tbody>
            <PnlRow label="Omzet" value={revenue} />
            <PnlRow label="Kostprijs verkopen / variabel" value={-variable} />
            <PnlRow label="Brutomarge / contributie" value={contribution} strong />
            <PnlRow label="Vaste kosten" value={-fixedCosts} />
            <PnlRow label="Operationeel resultaat" value={result} strong />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PnlRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr>
      <td>{strong ? <strong>{label}</strong> : label}</td>
      <td style={{ textAlign: "right" }}>{strong ? <strong>{money(value)}</strong> : money(value)}</td>
    </tr>
  );
}

function VarianceBridge({ rows }: { rows: Array<{ key: string; label: string; value: number; kind: string }> }) {
  return (
    <div className="data-table">
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.kind === "result" ? <strong>{row.label}</strong> : row.label}</td>
              <td style={{ textAlign: "right" }}>
                <strong className={row.value >= 0 ? "be-next-positive" : "be-next-negative"}>{money(row.value)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioSlider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="be3-slider">
      <div>
        <span>{label}</span>
        <strong>{value > 0 ? "+" : ""}{number(value, 0)}%</strong>
      </div>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
