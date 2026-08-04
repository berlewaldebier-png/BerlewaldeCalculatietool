"use client";

import { LockKeyhole } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { WizardSteps } from "@/components/WizardSteps";
import { QuickCell } from "@/components/nieuw-jaar/NieuwJaarWizardParts";
import { buildNieuwJaarWizardSteps } from "@/components/nieuw-jaar/nieuwJaarWizardSteps";
import type { YearsetDossierResponse } from "@/components/YearsetDossier";
import { API_BASE_URL } from "@/lib/apiShared";


type Fidelity = "exact" | "derived_exact" | "reconstructed" | "not_retained";

type HistoricalStep = {
  id: string;
  label: string;
  fidelity: Fidelity;
  source: string;
  detail: string;
};

type CostValues = {
  primary_cost: number | null;
  packaging_cost: number | null;
  overhead_cost: number | null;
  excise_cost: number | null;
  cost_price: number | null;
};

type HistoricalCostRow = {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  beer_name: string;
  product_type: string;
  product_label: string;
  cost_required: boolean;
  fidelity: string;
  source_kind: string;
  reference_count: number;
  source: CostValues | null;
  target: CostValues;
  list_price: number | null;
  provenance_kind: string;
};

type HistoricalWizardResponse = {
  version: string;
  status: "ready" | "missing";
  read_only: boolean;
  source_year: number;
  target_year: number;
  binding: YearsetDossierResponse["binding"];
  steps: HistoricalStep[];
  source_close: null | { id: string; status: string; closed_at: string };
  production: null | (Record<string, number | string> & { fidelity: Fidelity; updated_at: string });
  tariffs: null | {
    tarief_hoog: number;
    tarief_laag: number;
    verbruikersbelasting: number;
    updated_at: string;
    fidelity: Fidelity;
  };
  inflation: {
    value_pct: number | null;
    fidelity: Fidelity;
    source: string;
    detail: string;
    fixed_cost_matches: number;
    fixed_cost_comparable: number;
    packaging_matches: number;
    packaging_comparable: number;
  };
  fixed_costs: {
    fidelity: Fidelity;
    updated_at: string;
    rows: Array<{
      id: string;
      description: string;
      cost_type: string;
      cost_pool: string;
      domain_code: string;
      allocation_driver: string;
      allocation_scope: string;
      include_in_inventory_cost: boolean;
      include_in_quote_handling: boolean;
      basis_code: string;
      stand_code: string;
      annual_amount: number;
      source_annual_amount: number | null;
      expected_inflated_amount: number | null;
      delta_amount: number;
      matches_inflation: boolean;
      redistribution_pct: number;
      updated_at: string;
    }>;
  };
  packaging_prices: {
    fidelity: Fidelity;
    updated_at: string;
    rows: Array<{
      id: string;
      component_id: string;
      component_name: string;
      price_per_unit: number;
      source_price_per_unit: number | null;
      expected_inflated_price: number | null;
      delta_price: number;
      matches_inflation: boolean;
    }>;
  };
  recipes: {
    fidelity: Fidelity;
    rows: Array<{
      beer_id: string;
      beer_name: string;
      style: string;
      source_version_id: string;
      target_version_id: string;
      source_alcohol_pct: number | null;
      target_alcohol_pct: number | null;
      source_excise_rate: string;
      target_excise_rate: string;
      source_recipe_total: number;
      target_recipe_total: number;
      ingredients: Array<{
        id: string;
        ingredient: string;
        description: string;
        quantity: number | null;
        unit: string;
        needed_in_recipe: number | null;
        source_price: number | null;
        expected_inflated_price: number | null;
        target_price: number | null;
        source_recipe_cost: number | null;
        target_recipe_cost: number | null;
        matches_inflation: boolean;
      }>;
    }>;
  };
  cost_snapshot: null | {
    snapshot_at: string;
    raw_row_count: number;
    unique_sku_count: number;
    duplicate_sku_count: number;
    duplicate_reference_count: number;
    conflicting_duplicate_sku_count: number;
    canonical_row_count: number;
    canonical_exact_match_count: number;
    canonical_material_mismatch_count: number;
    canonical_without_legacy_count: number;
    allowed_without_legacy_count: number;
    rows: HistoricalCostRow[];
  };
  reason_codes: string[];
};


const money = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const amount = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});


function formatMoney(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : money.format(value);
}


function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}


function fidelityMeta(value: Fidelity) {
  if (value === "exact") return { label: "Exact bewaard", className: "status-ok" };
  if (value === "derived_exact") return { label: "Afgeleid uit bevroren bronnen", className: "status-info" };
  if (value === "reconstructed") return { label: "Gereconstrueerd", className: "status-warning" };
  return { label: "Niet afzonderlijk bewaard", className: "status-neutral" };
}


function sourceKindLabel(value: string) {
  const labels: Record<string, string> = {
    stored_wizard_calculation: "Bewaarde wizardberekening",
    recovered_from_exact_target_anchor: "Exact doeljaaranker",
    catalog_reference: "Catalogusreferentie",
  };
  return labels[value] || value || "Bron niet afzonderlijk bewaard";
}


function FidelityNotice({ step }: { step: HistoricalStep }) {
  const meta = fidelityMeta(step.fidelity);
  return (
    <div className={`editor-status historical-wizard-fidelity ${step.fidelity === "exact" ? "success" : step.fidelity === "reconstructed" ? "warning" : ""}`}>
      <div className="historical-wizard-fidelity-heading">
        <span className={`status-pill ${meta.className}`}>{meta.label}</span>
        <strong>{step.source}</strong>
      </div>
      <div className="muted">{step.detail}</div>
    </div>
  );
}


function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="yearset-dossier-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}


function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <label className="nested-field">
      <span>{label}</span>
      <input className="dataset-input dataset-input-readonly" value={value} readOnly aria-readonly="true" />
    </label>
  );
}


async function getHistoricalWizard(year: number): Promise<HistoricalWizardResponse> {
  const response = await fetch(
    `${API_BASE_URL}/meta/commercial-yearsets/${encodeURIComponent(String(year))}/historical-wizard`,
    { credentials: "include", cache: "no-store" }
  );
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Historische wizard ophalen mislukt (${response.status}).`));
  }
  return payload as HistoricalWizardResponse;
}


function planMetrics(dossier: YearsetDossierResponse) {
  const targets = dossier.plan?.targets;
  if (!targets) return null;
  return (
    <div className="yearset-dossier-metrics">
      <Metric label="Planomzet" value={money.format(targets.revenue)} detail="exclusief btw" />
      <Metric label="Variabele kosten" value={money.format(targets.variable_cost)} />
      <Metric label="Contributie" value={money.format(targets.contribution)} />
      <Metric label="Volume" value={`${amount.format(targets.liters)} liter`} />
      <Metric label="Eenheden" value={amount.format(targets.units)} />
    </div>
  );
}


function PlanTable({ dossier }: { dossier: YearsetDossierResponse }) {
  return (
    <>
      {planMetrics(dossier)}
      <div className="dataset-editor-scroll" style={{ marginTop: 14 }}>
        <table className="dataset-editor-table">
          <thead><tr><th>Maand</th><th>Omzet</th><th>Variabele kosten</th><th>Contributie</th><th>Liter</th><th>Eenheden</th></tr></thead>
          <tbody>
            {(dossier.plan?.period_allocations || []).map((row) => (
              <tr key={row.period}>
                <td>{row.period}</td>
                <td>{money.format(row.revenue)}</td>
                <td>{money.format(row.variable_cost)}</td>
                <td>{money.format(row.contribution)}</td>
                <td>{amount.format(row.liters)}</td>
                <td>{amount.format(row.units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}


function filterRows(rows: HistoricalCostRow[], query: string) {
  const needle = query.trim().toLocaleLowerCase("nl-NL");
  if (!needle) return rows;
  return rows.filter((row) =>
    `${row.beer_name} ${row.sku_name} ${row.sku_code} ${row.sku_id} ${row.product_label}`
      .toLocaleLowerCase("nl-NL")
      .includes(needle)
  );
}


function InflationSummary({ wizard }: { wizard: HistoricalWizardResponse }) {
  const inflation = wizard.inflation;
  return (
    <div className="module-card compact-card historical-wizard-inflation">
      <div className="module-card-title">Verwachte inflatie</div>
      <div className="historical-wizard-inflation-value">
        {inflation.value_pct === null ? "Niet betrouwbaar afleidbaar" : `${amount.format(inflation.value_pct)}%`}
        <span className={`status-pill ${inflation.fidelity === "derived_exact" ? "status-info" : "status-neutral"}`}>
          {inflation.fidelity === "derived_exact" ? "Afgeleid" : "Niet bewaard"}
        </span>
      </div>
      <div className="module-card-text">{inflation.detail}</div>
      <div className="muted" style={{ marginTop: 8 }}>
        Onderbouwing: {inflation.fixed_cost_matches}/{inflation.fixed_cost_comparable} vergelijkbare vaste-kostenregels en {" "}
        {inflation.packaging_matches}/{inflation.packaging_comparable} verpakkingsprijzen volgen dit percentage na afronding.
      </div>
    </div>
  );
}


function RecipeHistory({ wizard }: { wizard: HistoricalWizardResponse }) {
  if (wizard.recipes.rows.length === 0) {
    return <div className="placeholder-block"><strong>Geen gekoppelde productierecepten bewaard</strong>Er is niets uit actuele recepten aangevuld.</div>;
  }
  return (
    <div className="wizard-stack">
      <InflationSummary wizard={wizard} />
      {wizard.recipes.rows.map((recipe) => (
        <details className="module-card compact-card historical-wizard-group" key={recipe.target_version_id} open>
          <summary className="module-card-title historical-wizard-group-summary">
            <span>{recipe.beer_name}</span>
            <span className="editor-actions-group">
              {recipe.style ? <span className="pill">{recipe.style}</span> : null}
              <span className="editor-pill">{recipe.ingredients.length} ingrediënten</span>
            </span>
          </summary>
          <div className="module-card-text" style={{ marginTop: 10 }}>
            Exact gekoppeld via de definitieve jaarovergang. De kolom “Bron + inflatie” is een controleberekening en wijzigt niets.
          </div>
          <div className="historical-wizard-recipe-meta" style={{ marginTop: 12 }}>
            <ReadOnlyValue label={`Alcohol bronjaar ${wizard.source_year}`} value={recipe.source_alcohol_pct === null ? "—" : `${amount.format(recipe.source_alcohol_pct)}%`} />
            <ReadOnlyValue label={`Alcohol doeljaar ${wizard.target_year}`} value={recipe.target_alcohol_pct === null ? "—" : `${amount.format(recipe.target_alcohol_pct)}%`} />
            <ReadOnlyValue label={`Accijnstarief bronjaar ${wizard.source_year}`} value={recipe.source_excise_rate || "—"} />
            <ReadOnlyValue label={`Accijnstarief doeljaar ${wizard.target_year}`} value={recipe.target_excise_rate || "—"} />
          </div>
          <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
            <table className="dataset-editor-table">
              <thead><tr><th>Ingrediënt</th><th>Verpakking</th><th>In recept</th><th>Bronprijs</th><th>Bron + inflatie</th><th>Opgeslagen doelprijs</th><th>Receptkosten bron</th><th>Receptkosten doel</th><th>Controle</th></tr></thead>
              <tbody>{recipe.ingredients.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.ingredient || row.description || "Onbenoemd ingrediënt"}</strong>{row.description && row.description !== row.ingredient ? <div className="muted">{row.description}</div> : null}</td>
                  <td>{row.quantity === null ? "—" : amount.format(row.quantity)} {row.unit}</td>
                  <td>{row.needed_in_recipe === null ? "—" : amount.format(row.needed_in_recipe)} {row.unit}</td>
                  <td>{formatMoney(row.source_price)}</td>
                  <td>{formatMoney(row.expected_inflated_price)}</td>
                  <td><strong>{formatMoney(row.target_price)}</strong></td>
                  <td>{formatMoney(row.source_recipe_cost)}</td>
                  <td><strong>{formatMoney(row.target_recipe_cost)}</strong></td>
                  <td><span className={`status-pill ${row.matches_inflation ? "status-ok" : "status-warning"}`}>{row.matches_inflation ? "Volgt inflatie" : "Handmatig/ongewijzigd"}</span></td>
                </tr>
              ))}</tbody>
              <tfoot><tr><th colSpan={6}>Totale receptkosten</th><th>{formatMoney(recipe.source_recipe_total)}</th><th>{formatMoney(recipe.target_recipe_total)}</th><th /></tr></tfoot>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}


function StrategyGroups({ rows }: { rows: HistoricalCostRow[] }) {
  const groups = useMemo(() => {
    const byBeer = new Map<string, HistoricalCostRow[]>();
    rows.filter((row) => row.list_price !== null).forEach((row) => {
      const key = row.beer_name || "Overige producten";
      byBeer.set(key, [...(byBeer.get(key) || []), row]);
    });
    return Array.from(byBeer, ([name, groupRows]) => ({ name, rows: groupRows }))
      .sort((a, b) => a.name.localeCompare(b.name, "nl-NL"));
  }, [rows]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const setAll = (open: boolean) => setOpenGroups(Object.fromEntries(groups.map((group) => [group.name, open])));
  return (
    <div>
      <div className="editor-actions" style={{ paddingTop: 0 }}>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={() => setAll(true)}>Alles openen</button>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => setAll(false)}>Alles sluiten</button>
        </div>
      </div>
      <div className="wizard-stack">
        {groups.map((group) => {
          const open = Boolean(openGroups[group.name]);
          return (
            <section className="module-card compact-card historical-wizard-group" key={group.name}>
              <button type="button" className="module-card-title historical-wizard-group-button" onClick={() => setOpenGroups((current) => ({ ...current, [group.name]: !open }))} aria-expanded={open}>
                <span>{open ? "⌄" : ">"} {group.name}</span><span className="editor-pill">{group.rows.length} SKU&apos;s</span>
              </button>
              {open ? <div className="dataset-editor-scroll" style={{ marginTop: 12 }}><table className="dataset-editor-table"><thead><tr><th>SKU</th><th>Kostprijs</th><th>Sell-in</th><th>Status</th></tr></thead><tbody>{group.rows.map((row) => <tr key={row.sku_id}><td><strong>{row.sku_name}</strong><div className="muted">{row.sku_code || row.sku_id}</div></td><td>{formatMoney(row.target.cost_price)}</td><td>{formatMoney(row.list_price)}</td><td><span className="status-pill status-ok">Vastgelegd</span></td></tr>)}</tbody></table></div> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}


function CostTable({ rows, sourceYear }: { rows: HistoricalCostRow[]; sourceYear: number }) {
  return (
    <div className="dataset-editor-scroll">
      <table className="dataset-editor-table historical-wizard-cost-table">
        <thead>
          <tr>
            <th>SKU</th><th>Herkomst</th><th>Inkoop/ingred.</th><th>Verpakking</th><th>ABC</th><th>Accijns</th><th>Kostprijs</th><th>Controle</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.sku_id}>
              <td><strong>{row.sku_name}</strong><div className="muted">{row.beer_name || row.sku_code || row.sku_id}</div></td>
              <td>{sourceKindLabel(row.source_kind)}<div className="muted">{row.reference_count > 1 ? `${row.reference_count} oorspronkelijke weergaveregels` : row.reference_count === 1 ? "1 stabiele SKU" : "Buiten de oude wizardbatch"}</div></td>
              <td><strong>{formatMoney(row.target.primary_cost)}</strong><div className="muted">{sourceYear}: {formatMoney(row.source?.primary_cost)}</div></td>
              <td><strong>{formatMoney(row.target.packaging_cost)}</strong><div className="muted">{sourceYear}: {formatMoney(row.source?.packaging_cost)}</div></td>
              <td><strong>{formatMoney(row.target.overhead_cost)}</strong><div className="muted">{sourceYear}: {formatMoney(row.source?.overhead_cost)}</div></td>
              <td><strong>{formatMoney(row.target.excise_cost)}</strong><div className="muted">{sourceYear}: {formatMoney(row.source?.excise_cost)}</div></td>
              <td><strong>{row.cost_required ? formatMoney(row.target.cost_price) : "n.v.t."}</strong>{row.source ? <div className="muted">{sourceYear}: {formatMoney(row.source.cost_price)}</div> : null}</td>
              <td><span className={`status-pill ${row.fidelity === "exact" || row.fidelity === "exact_anchor" ? "status-ok" : "status-neutral"}`}>{row.fidelity === "exact" ? "Exact gelijk" : row.fidelity === "exact_anchor" ? "Exact 2026-anker" : row.cost_required ? "Niet bewaard" : "n.v.t."}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


export function HistoricalYearsetWizard({
  dossier,
  onShowOverview,
}: {
  dossier: YearsetDossierResponse;
  onShowOverview: () => void;
}) {
  const year = dossier.operational_year;
  const [wizard, setWizard] = useState<HistoricalWizardResponse | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    void getHistoricalWizard(year)
      .then(setWizard)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Historische wizard ophalen mislukt."))
      .finally(() => setLoading(false));
  }, [year]);

  const sharedSteps = useMemo(
    () => buildNieuwJaarWizardSteps(wizard?.source_year || year - 1, wizard?.target_year || year),
    [wizard?.source_year, wizard?.target_year, year]
  );
  const currentStep = sharedSteps[activeStep] || sharedSteps[0];
  const stepEvidence = wizard?.steps.find((step) => step.id === currentStep.id);
  const costRows = useMemo(
    () => filterRows(wizard?.cost_snapshot?.rows || [], query),
    [query, wizard?.cost_snapshot?.rows]
  );

  if (loading) {
    return <section className="module-card"><div className="placeholder-block"><strong>Historische wizard wordt geladen</strong>Alle bronnen worden alleen-lezen gecontroleerd.</div></section>;
  }
  if (error || !wizard || wizard.status !== "ready" || !wizard.cost_snapshot) {
    return (
      <section className="module-card">
        <div className="placeholder-block" role="alert">
          <strong>Historische wizard is niet beschikbaar</strong>
          {error || wizard?.reason_codes.join(", ") || "Onbekende reden"}. De Jaarset zelf is niet gewijzigd.
        </div>
        <button type="button" className="editor-button editor-button-secondary" onClick={onShowOverview}>Terug naar Jaarsetoverzicht</button>
      </section>
    );
  }

  const sourceYear = wizard.source_year;
  const targetYear = wizard.target_year;
  const activeEvidence = stepEvidence || wizard.steps[activeStep];
  const fixedTotal = wizard.fixed_costs.rows.reduce((sum, row) => sum + row.annual_amount, 0);
  const sourceFixedTotal = wizard.fixed_costs.rows.reduce((sum, row) => sum + (row.source_annual_amount || 0), 0);
  const next = () => setActiveStep((value) => Math.min(sharedSteps.length - 1, value + 1));
  const previous = () => setActiveStep((value) => Math.max(0, value - 1));

  function renderStepBody() {
    // The asynchronous view can be replaced while this closure exists. Keep the
    // read-only projection guarded inside the renderer as well as above it.
    if (!wizard || !wizard.cost_snapshot) return null;
    switch (currentStep.id) {
      case "basis":
        return (
          <div className="editor-grid two">
            <ReadOnlyValue label="Bronjaar" value={String(sourceYear)} />
            <ReadOnlyValue label="Doeljaar" value={String(targetYear)} />
            <ReadOnlyValue label="Bronstatus" value={wizard.source_close ? "Afgesloten" : "Niet aantoonbaar afgesloten"} />
            <ReadOnlyValue label="Doelstatus" value="Geactiveerde Jaarset" />
          </div>
        );
      case "init": {
        const sources = [
          ["Plan", "exact", "Bevroren in commerciële generatie"],
          ["Productie en drivers", wizard.production?.fidelity || "not_retained", wizard.production ? `Laatst opgeslagen ${formatDate(wizard.production.updated_at)}` : "Niet bewaard"],
          ["Tarieven", wizard.tariffs?.fidelity || "not_retained", wizard.tariffs ? `Laatst opgeslagen ${formatDate(wizard.tariffs.updated_at)}` : "Niet bewaard"],
          ["Vaste kosten", wizard.fixed_costs.fidelity, `${wizard.fixed_costs.rows.length} regels`],
          ["Verpakking", wizard.packaging_prices.fidelity, `${wizard.packaging_prices.rows.length} prijzen`],
          ["Kostprijzen", "exact", `${wizard.cost_snapshot.unique_sku_count} unieke bewaarde wizard-SKU's`],
          ["Verkoopstrategie", "exact", `${dossier.summary?.price_count || 0} definitieve prijzen`],
          ["Adviesprijzen", "exact", `${dossier.summary?.channel_count || 0} kanalen`],
        ] as Array<[string, Fidelity, string]>;
        return (
          <div className="record-card-grid historical-wizard-source-grid">
            {sources.map(([label, fidelity, detail]) => {
              const meta = fidelityMeta(fidelity);
              return <div className="wizard-toggle-card" key={label}><span><strong>{label}</strong><small>{detail}</small></span><span className={`status-pill ${meta.className}`}>{meta.label}</span></div>;
            })}
          </div>
        );
      }
      case "productie":
        return <PlanTable dossier={dossier} />;
      case "tarieven":
        return wizard.tariffs ? (
          <div className="editor-grid three">
            <ReadOnlyValue label="Accijnstarief hoog" value={formatMoney(wizard.tariffs.tarief_hoog)} />
            <ReadOnlyValue label="Accijnstarief laag" value={formatMoney(wizard.tariffs.tarief_laag)} />
            <ReadOnlyValue label="Verbruikersbelasting" value={formatMoney(wizard.tariffs.verbruikersbelasting)} />
          </div>
        ) : <div className="placeholder-block">Geen afzonderlijke doeljaartarieven bewaard.</div>;
      case "vaste-kosten":
        return (
          <>
            <InflationSummary wizard={wizard} />
            <div className="yearset-dossier-metrics" style={{ marginTop: 14 }}>
              <Metric label={`Totaal bronjaar ${sourceYear}`} value={money.format(sourceFixedTotal)} detail="vergelijkbare regels" />
              <Metric label={`Totaal doeljaar ${targetYear}`} value={money.format(fixedTotal)} detail={`${wizard.fixed_costs.rows.length} regels`} />
            </div>
            <div className="dataset-editor-scroll" style={{ marginTop: 14 }}><table className="dataset-editor-table"><thead><tr><th>Omschrijving</th><th>Soort / verdeling</th><th>Bronjaar {sourceYear}</th><th>Bron + inflatie</th><th>Doeljaar {targetYear}</th><th>Verschil</th><th>Controle</th></tr></thead><tbody>{wizard.fixed_costs.rows.map((row) => <tr key={row.id}><td><strong>{row.description}</strong><div className="muted">{row.cost_pool || "Geen pool"}</div></td><td>{row.cost_type}<div className="muted">{row.allocation_driver || "Geen driver"} · {row.allocation_scope}</div></td><td>{formatMoney(row.source_annual_amount)}</td><td>{formatMoney(row.expected_inflated_amount)}</td><td><strong>{money.format(row.annual_amount)}</strong></td><td>{formatMoney(row.delta_amount)}</td><td><span className={`status-pill ${row.matches_inflation ? "status-ok" : "status-warning"}`}>{row.source_annual_amount === null ? "Nieuwe regel" : row.matches_inflation ? "Volgt inflatie" : "Handmatig aangepast"}</span></td></tr>)}</tbody></table></div>
          </>
        );
      case "verpakking":
        return <><InflationSummary wizard={wizard} /><div className="dataset-editor-scroll" style={{ marginTop: 14 }}><table className="dataset-editor-table"><thead><tr><th>Onderdeel</th><th>Bronjaar {sourceYear}</th><th>Bron + inflatie</th><th>Doeljaar {targetYear}</th><th>Verschil</th><th>Controle</th></tr></thead><tbody>{wizard.packaging_prices.rows.map((row) => <tr key={row.id}><td><strong>{row.component_name}</strong><div className="muted"><code>{row.component_id}</code></div></td><td>{formatMoney(row.source_price_per_unit)}</td><td>{formatMoney(row.expected_inflated_price)}</td><td><strong>{money.format(row.price_per_unit)}</strong></td><td>{formatMoney(row.delta_price)}</td><td><span className={`status-pill ${row.matches_inflation ? "status-ok" : "status-warning"}`}>{row.matches_inflation ? "Volgt inflatie" : "Handmatig aangepast"}</span></td></tr>)}</tbody></table></div></>;
      case "inkoop-scenario":
        return (
          <>
            <label className="nested-field historical-wizard-search"><span>Zoeken</span><input className="dataset-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Zoek bier of SKU…" /></label>
            <div className="dataset-editor-scroll"><table className="dataset-editor-table"><thead><tr><th>SKU</th><th>Inkoop/ingrediënten {sourceYear}</th><th>Gebruikt scenario {targetYear}</th><th>Verschil</th></tr></thead><tbody>{costRows.filter((row) => row.source).map((row) => <tr key={row.sku_id}><td><strong>{row.sku_name}</strong><div className="muted">{row.beer_name}</div></td><td>{formatMoney(row.source?.primary_cost)}</td><td>{formatMoney(row.target.primary_cost)}</td><td>{formatMoney((row.target.primary_cost || 0) - (row.source?.primary_cost || 0))}</td></tr>)}</tbody></table></div>
          </>
        );
      case "recepten":
        return <RecipeHistory wizard={wizard} />;
      case "kostprijs":
        return (
          <>
            <div className="yearset-dossier-metrics">
              <Metric label="Oorspronkelijke regels" value={String(wizard.cost_snapshot.raw_row_count)} detail="wizardpresentatie" />
              <Metric label="Unieke SKU's" value={String(wizard.cost_snapshot.unique_sku_count)} detail="stabiele identiteit" />
              <Metric label="Exact gelijk" value={String(wizard.cost_snapshot.canonical_exact_match_count)} detail="op zes decimalen" />
              <Metric label="Dubbele verwijzingen" value={String(wizard.cost_snapshot.duplicate_reference_count)} detail="geen financieel conflict" />
            </div>
            <label className="nested-field historical-wizard-search"><span>Zoeken</span><input className="dataset-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Zoek bier of SKU…" /></label>
            <CostTable rows={costRows} sourceYear={sourceYear} />
          </>
        );
      case "verkoopstrategie":
        return <><label className="nested-field historical-wizard-search"><span>Zoeken</span><input className="dataset-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Zoek bier of SKU…" /></label><StrategyGroups rows={costRows} /></>;
      case "adviesprijzen":
        return <div className="dataset-editor-scroll"><table className="dataset-editor-table"><thead><tr><th>Kanaal</th><th>Opslag</th><th>Status</th></tr></thead><tbody>{dossier.channels.map((channel) => <tr key={channel.channel_code}><td>{channel.channel_code}</td><td>{channel.advice_markup_pct === null ? "—" : `${amount.format(channel.advice_markup_pct)}%`}</td><td><span className="status-pill status-ok">Vastgelegd</span></td></tr>)}</tbody></table></div>;
      case "preview":
        return <div className="dataset-editor-scroll"><table className="dataset-editor-table"><thead><tr><th>SKU</th><th>Kostprijs</th><th>Sell-in</th>{dossier.channels.map((channel) => <th key={channel.channel_code}>{channel.channel_code}</th>)}</tr></thead><tbody>{costRows.filter((row) => row.list_price !== null).map((row) => <tr key={row.sku_id}><td><strong>{row.sku_name}</strong><div className="muted">{row.beer_name}</div></td><td>{formatMoney(row.target.cost_price)}</td><td>{formatMoney(row.list_price)}</td>{dossier.channels.map((channel) => <td key={channel.channel_code}>{channel.advice_markup_pct === null || row.list_price === null ? "—" : formatMoney(row.list_price * (1 + channel.advice_markup_pct / 100))}</td>)}</tr>)}</tbody></table></div>;
      case "plan-hercontrole":
        return (
          <>
            <PlanTable dossier={dossier} />
            {wizard.production ? <div className="module-card compact-card historical-wizard-production"><div className="module-card-title">Later opgeslagen productie- en driverwaarden</div><div className="module-card-text">Deze regel is herkenbaar als gereconstrueerd omdat de bron na de oorspronkelijke wizardbatch is bijgewerkt.</div><div className="editor-grid three"><ReadOnlyValue label="Inkoop (L)" value={amount.format(Number(wizard.production.hoeveelheid_inkoop_l || 0))} /><ReadOnlyValue label="Productie (L)" value={amount.format(Number(wizard.production.hoeveelheid_productie_l || 0))} /><ReadOnlyValue label="Normale sales (L)" value={amount.format(Number(wizard.production.normal_sales_l || 0))} /><ReadOnlyValue label="Shipments" value={amount.format(Number(wizard.production.normal_shipments || 0))} /><ReadOnlyValue label="Orderregels" value={amount.format(Number(wizard.production.normal_orderlines || 0))} /><ReadOnlyValue label="Batchgrootte" value={amount.format(Number(wizard.production.batchgrootte_eigen_productie_l || 0))} /></div></div> : null}
          </>
        );
      case "afronden":
        return (
          <div className="wizard-stack">
            <div className="editor-status success"><strong>Jaarset {targetYear} is definitief geactiveerd</strong><div className="muted">Deze historische weergave kan niet opslaan, afronden, activeren of herstellen.</div></div>
            <dl className="yearset-dossier-audit-grid">
              <div><dt>Generatie</dt><dd><code>{dossier.binding?.generation_id}</code></dd></div>
              <div><dt>Reconciliatierun</dt><dd><code>{dossier.binding?.run_id}</code></dd></div>
              <div><dt>Bronjaar afgesloten</dt><dd>{formatDate(wizard.source_close?.closed_at || "")}</dd></div>
              <div><dt>Wizardbatch</dt><dd>{formatDate(wizard.cost_snapshot.snapshot_at)}</dd></div>
              <div><dt>Geactiveerd</dt><dd>{formatDate(dossier.audit?.generation.activated_at || "")}</dd></div>
              <div><dt>Geactiveerd door</dt><dd>{dossier.audit?.generation.activated_by || "—"}</dd></div>
              <div><dt>Plancontract</dt><dd><code>{dossier.binding?.plan_contract_hash}</code></dd></div>
              <div><dt>Contractversie</dt><dd>{wizard.version}</dd></div>
            </dl>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div className="cpq-root historical-yearset-wizard">
      <div className="cpq-frame">
        <div className="cpq-topbar">
          <div>
            <div className="cpq-kicker">Historische nieuwjaarwizard</div>
            <h2 className="cpq-title">Nieuw jaar {targetYear} voorbereiden</h2>
            <div className="module-card-text" style={{ marginTop: 6, maxWidth: 760 }}>
              Dezelfde 14 stappen als de actieve wizard, gevuld met de bewaarde Jaarset {targetYear}. Niet-bewaarde tussentoestanden worden niet met actuele defaults ingevuld.
            </div>
          </div>
          <div className="cpq-topbar-actions">
            <button type="button" className="editor-button editor-button-secondary" onClick={onShowOverview}>Terug naar overzicht</button>
            <span className="status-pill status-ok"><LockKeyhole size={14} aria-hidden="true" /> Alleen-lezen</span>
            <span className="pill">Bronjaar {sourceYear} → Doeljaar {targetYear}</span>
          </div>
        </div>

        <div className="cpq-grid cpq-grid-two">
          <aside className="cpq-left">
            <WizardSteps
              title={`Nieuw jaar ${targetYear} voorbereiden`}
              className="nieuw-jaar-wizard-steps"
              steps={sharedSteps.map((step) => ({ id: step.id, title: step.label, description: step.description }))}
              activeIndex={activeStep}
              onSelect={setActiveStep}
            />
            <div className="cpq-quick">
              <div className="cpq-quick-title">Quick view</div>
              <div className="cpq-quick-grid">
                <QuickCell label="Bronjaar" value={String(sourceYear)} />
                <QuickCell label="Doeljaar" value={String(targetYear)} />
                <QuickCell label="Jaarset" value="Definitief" />
                <QuickCell label="Bronstatus" value={wizard.source_close ? "Afgesloten" : "Onbekend"} />
                <QuickCell label="Actieve stap" value={`Stap ${activeStep + 1}`} />
              </div>
            </div>
          </aside>

          <main className="cpq-main">
            <div className="wizard-shell wizard-shell-single" style={{ marginTop: 0 }}>
              <div className="wizard-step-card wizard-step-stage-card">
                <div className="wizard-step-header">
                  <div><div className="wizard-step-title">Stap {activeStep + 1}: {currentStep.panelTitle}</div><div className="wizard-step-description">{currentStep.panelDescription}</div></div>
                </div>
                {activeEvidence ? <FidelityNotice step={activeEvidence} /> : null}
                <div className="wizard-step-body">{renderStepBody()}</div>
                <div className="editor-actions wizard-footer-actions">
                  <div className="editor-actions-group"><button type="button" className="editor-button editor-button-secondary" onClick={previous} disabled={activeStep === 0}>Vorige</button></div>
                  <div className="editor-actions-group">
                    {activeStep === sharedSteps.length - 1 ? <button type="button" className="editor-button editor-button-secondary" onClick={onShowOverview}>Terug naar Jaarsetoverzicht</button> : null}
                    <button type="button" className="editor-button" onClick={next} disabled={activeStep === sharedSteps.length - 1}>Volgende</button>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
