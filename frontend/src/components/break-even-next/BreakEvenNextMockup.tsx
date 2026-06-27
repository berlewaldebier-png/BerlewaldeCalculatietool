"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TabId = "dashboard" | "pnl" | "contribution" | "plan_actual" | "variance" | "scenario" | "year_close";

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
