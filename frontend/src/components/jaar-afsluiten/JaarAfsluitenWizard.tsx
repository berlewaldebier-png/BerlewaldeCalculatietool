"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { WizardSteps } from "@/components/WizardSteps";
import { API_BASE_URL } from "@/lib/api";
import { formatMoneyEUR } from "@/lib/formatters";
import { reconcileDatasetItems } from "@/lib/datasetItems";

type GenericRecord = Record<string, any>;
type Tone = "" | "success" | "error";

type ManualInputs = {
  fixed_cost_total: number;
  incidental_cost_total: number;
  purchase_liters: number;
  production_liters: number;
  sales_liters: number;
  inventory_note: string;
};

type FixedCostCloseRow = {
  uiId: string;
  sourceId: string;
  omschrijving: string;
  kostensoort: string;
  cost_pool: string;
  exact_rekening: string;
  planned_amount: number;
  realised_amount: number;
  isNew: boolean;
};

type IncidentalCloseRow = {
  id: string;
  jaar: number;
  datum: string;
  omschrijving: string;
  bedrag: number;
  toelichting: string;
  ignore: boolean;
};

const steps = [
  { id: "jaarset", label: "Jaarset", description: "Af te sluiten jaar en doel." },
  { id: "checks", label: "Checks", description: "Blokkades en waarschuwingen." },
  { id: "actuals", label: "Werkelijkheid", description: "Omzet, kostprijs en resultaat." },
  { id: "drivers", label: "Liters", description: "Inkoop, productie en verkoop." },
  { id: "costs", label: "Kosten", description: "ABC en incidenteel." },
  { id: "inventory", label: "Voorraad", description: "Begin/eindvoorraad." },
  { id: "inventory-control", label: "Voorraadcontrole", description: "Brug naar fysieke liters.", stepNumber: "6.1" },
  { id: "finish", label: "Afronden", description: "Snapshot vastleggen.", stepNumber: "7" },
] as const;

type StepId = (typeof steps)[number]["id"];

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { detail: text };
  }
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return formatMoneyEUR(num(value));
}

function liters(value: unknown) {
  return `${Math.round(num(value)).toLocaleString("nl-NL")} L`;
}

function bridgeLiters(value: unknown) {
  return `${num(value).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`;
}

function exportNumber(value: unknown) {
  return Math.round(num(value) * 100) / 100;
}

function qty(value: unknown) {
  return num(value).toLocaleString("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function bridgeQtyLiters(quantity: unknown, litersValue: unknown) {
  return (
    <>
      <strong>{qty(quantity)}</strong>
      <small className="muted" style={{ display: "block" }}>{bridgeLiters(litersValue)}</small>
    </>
  );
}

function spreadsheetCell(value: unknown) {
  const text = String(value ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadWorkbook(filename: string, sheets: { name: string; headers: string[]; rows: unknown[][] }[]) {
  if (typeof window === "undefined") return;
  const cellXml = (cell: unknown) => {
    if (typeof cell === "number" && Number.isFinite(cell)) {
      return `<Cell><Data ss:Type="Number">${cell}</Data></Cell>`;
    }
    return `<Cell><Data ss:Type="String">${spreadsheetCell(cell)}</Data></Cell>`;
  };
  const worksheets = sheets
    .map((sheet) => {
      const xmlRows = [
        sheet.headers,
        ...sheet.rows,
      ].map((row) => (
        `<Row>${row.map(cellXml).join("")}</Row>`
      )).join("");
      return `<Worksheet ss:Name="${spreadsheetCell(sheet.name).slice(0, 31)}"><Table>${xmlRows}</Table></Worksheet>`;
    })
    .join("");
  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
    <?mso-application progid="Excel.Sheet"?>
    <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
      xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
      ${worksheets}
    </Workbook>`;
  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function impactValue(key: string, value: unknown) {
  if (key.includes("liters")) return liters(value);
  if (key.includes("rows")) return Math.round(num(value)).toLocaleString("nl-NL");
  return money(value);
}

function valueFromSource(record: GenericRecord | undefined) {
  return num(record?.value);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fixedRowFromSource(row: GenericRecord, index: number): FixedCostCloseRow {
  const sourceId = String(row.id ?? "").trim();
  return {
    uiId: sourceId ? `fixed-${sourceId}-${index}` : makeId("fixed"),
    sourceId,
    omschrijving: String(row.omschrijving ?? ""),
    kostensoort: String(row.kostensoort ?? ""),
    cost_pool: String(row.cost_pool ?? ""),
    exact_rekening: String(row.exact_rekening ?? row.exact_account ?? ""),
    planned_amount: num(row.bedrag_per_jaar),
    realised_amount: 0,
    isNew: false,
  };
}

function createEmptyFixedRow(): FixedCostCloseRow {
  return {
    uiId: makeId("fixed"),
    sourceId: "",
    omschrijving: "",
    kostensoort: "",
    cost_pool: "",
    exact_rekening: "",
    planned_amount: 0,
    realised_amount: 0,
    isNew: true,
  };
}

function incidentalRowFromSource(row: GenericRecord, fallbackYear: number): IncidentalCloseRow {
  const id = String(row.id ?? "").trim() || makeId("incident");
  return {
    id,
    jaar: Number(row.jaar ?? row.year ?? fallbackYear) || fallbackYear,
    datum: String(row.datum ?? row.date ?? today()),
    omschrijving: String(row.omschrijving ?? row.description ?? ""),
    bedrag: num(row.bedrag ?? row.amount),
    toelichting: String(row.toelichting ?? row.explanation ?? ""),
    ignore: Boolean(row.ignore ?? row.negeren ?? false),
  };
}

function createEmptyIncidentalRow(year: number): IncidentalCloseRow {
  return {
    id: makeId("incident"),
    jaar: year,
    datum: today(),
    omschrijving: "",
    bedrag: 0,
    toelichting: "",
    ignore: false,
  };
}

function fixedRowFromClosed(row: GenericRecord, index: number): FixedCostCloseRow {
  const sourceId = String(row.source_id ?? row.sourceId ?? "").trim();
  return {
    uiId: sourceId ? `fixed-${sourceId}-${index}` : makeId("fixed"),
    sourceId,
    omschrijving: String(row.omschrijving ?? ""),
    kostensoort: String(row.kostensoort ?? ""),
    cost_pool: String(row.cost_pool ?? ""),
    exact_rekening: String(row.exact_rekening ?? row.exact_account ?? ""),
    planned_amount: num(row.planned_amount),
    realised_amount: num(row.realised_amount),
    isNew: Boolean(row.is_new ?? row.isNew ?? false),
  };
}

function incidentalRowFromClosed(row: GenericRecord, fallbackYear: number): IncidentalCloseRow {
  return {
    id: String(row.id ?? "").trim() || makeId("incident"),
    jaar: Number(row.jaar ?? row.year ?? fallbackYear) || fallbackYear,
    datum: String(row.datum ?? row.date ?? today()),
    omschrijving: String(row.omschrijving ?? row.description ?? ""),
    bedrag: num(row.bedrag ?? row.amount),
    toelichting: String(row.toelichting ?? row.explanation ?? ""),
    ignore: Boolean(row.ignore ?? row.negeren ?? false),
  };
}

function sourceLabel(record: GenericRecord | undefined) {
  const source = String(record?.source ?? "").trim();
  if (source === "manual_year_close_input") return "Handmatig";
  if (source === "production_years") return "Productie en drivers";
  if (source === "cost_versions_purchase_invoice_liters") return "Kostprijzen/inkoopfacturen";
  if (source === "cost_versions_purchase_invoice_liters_empty") return "Geen factuurliters gevonden";
  if (source === "douano_sales_line_cost_snapshots_liters") return "Omzet & Marge";
  if (source === "inventory_bridge_stock_movements_purchase_liters") return "Voorraadbrug inkoop";
  if (source === "inventory_bridge_stock_movements_afvullen_liters") return "Voorraadbrug afvullen";
  if (source === "inventory_rows_omzet_en_marge_sales_liters") return "Voorraadbrug verkoop";
  if (source === "manual_required_brew_moments_missing") return "Handmatig tot brouwmomenten compleet zijn";
  if (source === "production_years_plan") return "Productie en drivers plan";
  if (source === "fixed_costs_by_year") return "Vaste kosten ABC";
  if (source === "incidental_costs_by_year") return "Incidenteel";
  return source || "Bron";
}

function buildManualFromPreview(preview: GenericRecord | null): ManualInputs {
  const drivers = preview?.drivers ?? {};
  const costs = preview?.costs ?? {};
  return {
    fixed_cost_total: valueFromSource(costs.fixed_cost_total) || num(preview?.fixed_cost_total),
    incidental_cost_total: valueFromSource(costs.incidental_cost_total) || num(preview?.incidental_cost_total),
    purchase_liters: valueFromSource(drivers.purchase_liters),
    production_liters: valueFromSource(drivers.production_liters),
    sales_liters: valueFromSource(drivers.sales_liters),
    inventory_note: String(preview?.inventory?.note ?? ""),
  };
}

function deriveDashboard(preview: GenericRecord | null, manual: ManualInputs) {
  const totals = preview?.actuals?.totals ?? {};
  const revenue = num(totals.revenue);
  const variableCost = num(totals.variable_cost);
  const contribution = num(totals.contribution) || revenue - variableCost;
  const controllableCosts = manual.fixed_cost_total + manual.incidental_cost_total;
  const result = contribution - controllableCosts;
  const contributionRatio = revenue > 0 ? contribution / revenue : 0;
  const breakEvenRevenue = contributionRatio > 0 ? controllableCosts / contributionRatio : 0;
  return {
    revenue,
    variableCost,
    contribution,
    fixedCosts: manual.fixed_cost_total,
    incidentalCosts: manual.incidental_cost_total,
    controllableCosts,
    result,
    contributionRatio,
    breakEvenRevenue,
  };
}

function dashboardRows(dashboard: ReturnType<typeof deriveDashboard>) {
  return [
    {
      label: "Omzet",
      value: dashboard.revenue,
      source: "Omzet & Marge",
      formula: "Netto omzet exclusief btw.",
    },
    {
      label: "Variabele kosten",
      value: -dashboard.variableCost,
      source: "Omzet & Marge kostprijssnapshot",
      formula: "All-in kostprijs minus geabsorbeerde ABC-overhead.",
    },
    {
      label: "Brutowinst / contributie",
      value: dashboard.contribution,
      source: "Afgeleid",
      formula: "Omzet - variabele kosten.",
    },
    {
      label: "Vaste kosten ABC",
      value: -dashboard.fixedCosts,
      source: "Vaste kosten ABC of handmatige afsluitcorrectie",
      formula: "Jaarbasis vaste kosten.",
    },
    {
      label: "Incidentele kosten",
      value: -dashboard.incidentalCosts,
      source: "Kostenstructuur > Incidenteel of handmatige afsluitcorrectie",
      formula: "Eenmalige kosten buiten normale SKU-kostprijs.",
    },
    {
      label: "Resultaat",
      value: dashboard.result,
      source: "Afgeleid",
      formula: "Contributie - vaste kosten - incidentele kosten.",
    },
    {
      label: "Break-even omzet",
      value: dashboard.breakEvenRevenue,
      source: "Afgeleid",
      formula: "Totale beheersbare kosten / contributieratio.",
    },
  ];
}

function planActualRows(preview: GenericRecord | null, dashboard: ReturnType<typeof deriveDashboard>) {
  const plan = preview?.plan_baseline && typeof preview.plan_baseline === "object" ? (preview.plan_baseline as GenericRecord) : {};
  const available = Boolean(plan.available);
  const rows = [
    ["Omzet", num(plan.revenue), dashboard.revenue],
    ["Variabele kosten", num(plan.variable_cost), dashboard.variableCost],
    ["Brutowinst / contributie", num(plan.contribution), dashboard.contribution],
    ["Vaste kosten ABC", num(plan.fixed_costs), dashboard.fixedCosts],
    ["Incidentele kosten", num(plan.incidental_costs), dashboard.incidentalCosts],
    ["Resultaat", num(plan.result), dashboard.result],
    ["Break-even omzet", num(plan.break_even_revenue), dashboard.breakEvenRevenue],
  ] as const;
  return {
    available,
    source: String(plan.source ?? "missing"),
    scenarioName: String(plan.scenario_name ?? ""),
    snapshotId: String(plan.snapshot_id ?? ""),
    rows: rows.map(([label, planned, actual]) => ({
      label,
      planned,
      actual,
      delta: actual - planned,
      deltaPct: planned ? (actual - planned) / Math.abs(planned) : 0,
    })),
  };
}

export function JaarAfsluitenWizard({
  vasteKosten = {},
  incidenteleKosten = [],
  productie = {},
}: {
  vasteKosten?: Record<string, GenericRecord[]>;
  incidenteleKosten?: GenericRecord[];
  productie?: Record<string, GenericRecord>;
}) {
  const router = useRouter();
  const closeYearDefault = String(new Date().getFullYear() - 1);
  const [year] = useState(closeYearDefault);
  const basis = "invoice";
  const [activeStep, setActiveStep] = useState(0);
  const [preview, setPreview] = useState<GenericRecord | null>(null);
  const [closed, setClosed] = useState<GenericRecord | null>(null);
  const [manual, setManual] = useState<ManualInputs>({
    fixed_cost_total: 0,
    incidental_cost_total: 0,
    purchase_liters: 0,
    production_liters: 0,
    sales_liters: 0,
    inventory_note: "",
  });
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<Tone>("");
  const [busy, setBusy] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [fixedCostRows, setFixedCostRows] = useState<FixedCostCloseRow[]>([]);
  const [incidentalRows, setIncidentalRows] = useState<IncidentalCloseRow[]>([]);
  const [refreshPreview, setRefreshPreview] = useState<GenericRecord | null>(null);
  const [refreshReason, setRefreshReason] = useState("");

  const selectedYearNumber = Number(year) || 0;
  const yearExistsInProductie = selectedYearNumber > 0 && Object.prototype.hasOwnProperty.call(productie ?? {}, String(selectedYearNumber));
  const fixedCostTotal = useMemo(
    () => fixedCostRows.reduce((sum, row) => sum + num(row.realised_amount), 0),
    [fixedCostRows]
  );
  const incidentalCostTotal = useMemo(
    () => incidentalRows.filter((row) => !row.ignore).reduce((sum, row) => sum + num(row.bedrag), 0),
    [incidentalRows]
  );
  const effectiveManual = useMemo(
    () => ({ ...manual, fixed_cost_total: fixedCostTotal, incidental_cost_total: incidentalCostTotal }),
    [fixedCostTotal, incidentalCostTotal, manual]
  );
  const dashboard = useMemo(() => deriveDashboard(preview, effectiveManual), [preview, effectiveManual]);
  const planComparison = useMemo(() => planActualRows(preview, dashboard), [dashboard, preview]);
  const currentStep = steps[activeStep] ?? steps[0];
  const currentStepId = currentStep.id;
  const isLastStep = activeStep >= steps.length - 1;
  const checks = preview?.checks ?? {};
  const inventory = preview?.inventory && typeof preview.inventory === "object" ? preview.inventory as GenericRecord : {};
  const inventoryRows = Array.isArray(inventory.rows) ? inventory.rows as GenericRecord[] : [];
  const inventoryTotals = inventory.totals && typeof inventory.totals === "object" ? inventory.totals as GenericRecord : {};
  const actuals = preview?.actuals && typeof preview.actuals === "object" ? preview.actuals as GenericRecord : {};
  const variableCostRows = Array.isArray(actuals.variable_cost_rows) ? actuals.variable_cost_rows as GenericRecord[] : [];
  const inventoryValuationExportRows = useMemo(() => inventoryRows.map((row) => [
    String(row.product_name ?? row.sku_id ?? "-"),
    money(row.primary_cost_per_unit),
    money(row.excise_per_unit),
    qty(row.begin_quantity),
    money(row.begin_value_primary),
    money(row.begin_value_with_excise),
    qty(row.end_quantity),
    money(row.end_value_primary),
    money(row.end_value_with_excise),
    qty(row.purchased_or_produced_quantity),
    qty(row.sold_quantity),
    qty(row.unpack_quantity),
    qty(row.repack_quantity),
    qty(row.correction_other_quantity ?? row.other_movement_quantity),
    String(row.status ?? "") === "ok" ? "OK" : String((row.warnings as string[] | undefined)?.join(", ") || "Controle"),
  ]), [inventoryRows]);
  const inventoryBridgeExportRows = useMemo(() => inventoryRows.map((row) => [
    String(row.product_name ?? row.sku_id ?? "-"),
    exportNumber(row.begin_quantity),
    exportNumber(row.begin_liters),
    exportNumber(row.purchase_quantity),
    exportNumber(row.purchase_liters),
    exportNumber(row.production_quantity),
    exportNumber(row.production_liters),
    exportNumber(row.sold_quantity),
    exportNumber(row.sold_liters),
    exportNumber(row.unpack_quantity),
    exportNumber(row.unpack_liters),
    exportNumber(row.repack_quantity),
    exportNumber(row.repack_liters),
    exportNumber(row.correction_other_quantity ?? row.other_movement_quantity),
    exportNumber(row.correction_liters),
    exportNumber(row.end_quantity),
    exportNumber(row.end_liters),
  ]), [inventoryRows]);
  const variableCostTotals = useMemo(() => variableCostRows.reduce(
    (acc, row) => {
      acc.quantity += num(row.quantity);
      acc.netRevenue += num(row.net_revenue_ex);
      acc.purchase += num(row.purchase_total_ex);
      acc.packaging += num(row.packaging_total_ex);
      acc.abc += num(row.abc_total_ex);
      acc.excise += num(row.excise_total_ex);
      acc.cost += num(row.cost_total_ex);
      acc.variable += num(row.variabel_ex);
      acc.variableWithExcise += num(row.variabel_accijns_ex);
      return acc;
    },
    { quantity: 0, netRevenue: 0, purchase: 0, packaging: 0, abc: 0, excise: 0, cost: 0, variable: 0, variableWithExcise: 0 }
  ), [variableCostRows]);
  const variableCostExportRows = useMemo(() => [
    [
      "Totaal",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      exportNumber(variableCostTotals.quantity),
      exportNumber(variableCostTotals.netRevenue),
      exportNumber(variableCostTotals.purchase),
      exportNumber(variableCostTotals.packaging),
      exportNumber(variableCostTotals.abc),
      exportNumber(variableCostTotals.excise),
      exportNumber(variableCostTotals.cost),
      exportNumber(variableCostTotals.variable),
      exportNumber(variableCostTotals.variableWithExcise),
      "",
      "",
    ],
    ...variableCostRows.map((row) => [
      String(row.document_number ?? ""),
      String(row.document_date ?? ""),
      String(row.company_name ?? ""),
      String(row.product_name ?? ""),
      String(row.douano_sku ?? ""),
      String(row.sku_id ?? ""),
      String(row.lot_number ?? ""),
      String(row.lot_internal_number ?? ""),
      String(row.cost_version ?? ""),
      exportNumber(row.quantity),
      exportNumber(row.net_revenue_ex),
      exportNumber(row.purchase_total_ex),
      exportNumber(row.packaging_total_ex),
      exportNumber(row.abc_total_ex),
      exportNumber(row.excise_total_ex),
      exportNumber(row.cost_total_ex),
      exportNumber(row.variabel_ex),
      exportNumber(row.variabel_accijns_ex),
      String(row.cost_status ?? ""),
      String(row.cost_source ?? ""),
    ]),
  ], [variableCostRows, variableCostTotals]);
  const criticalErrors = (preview?.critical_errors ?? []).filter((row: unknown) => typeof row === "object" && row !== null) as GenericRecord[];
  const warnings = useMemo(() => {
    const out: string[] = [];
    if (Number(checks.missing_cost_lines ?? 0) > 0) out.push(`${checks.missing_cost_lines} verkoopregels missen kostprijs.`);
    if (Number(checks.unmapped_revenue ?? 0) > 0) out.push(`${money(checks.unmapped_revenue)} omzet is nog niet gekoppeld.`);
    if (!preview) out.push("Laad eerst de jaarafsluiting.");
    return out;
  }, [checks, preview]);

  function stepIndex(stepId: StepId) {
    const index = steps.findIndex((step) => step.id === stepId);
    return index >= 0 ? index : 0;
  }

  function downloadInventoryWorkbook() {
    downloadWorkbook(`jaarafsluiting-${year}-voorraad.xls`, [
      {
        name: "Voorraad",
        headers: [
          "Product / SKU",
          "Inkoop/ingr.",
          "Accijns",
          "Voorraad 01-01",
          "Waarde 01-01",
          "Waarde incl. accijns 01-01",
          "Voorraad 31-12",
          "Waarde 31-12",
          "Waarde incl. accijns 31-12",
          "Gekocht/geproduceerd",
          "Verkocht",
          "Uitpakking",
          "Herverpakking",
          "Correcties/overig",
          "Status",
        ],
        rows: inventoryValuationExportRows,
      },
      {
        name: "Voorraadcontrole",
        headers: [
          "Product / SKU",
          "Begin aantal",
          "Begin liters (L)",
          "Inkoop aantal",
          "Inkoop liters (L)",
          "Afvullen aantal",
          "Afvullen liters (L)",
          "Verkoop aantal",
          "Verkoop liters (L)",
          "Uitpakking aantal",
          "Uitpakking liters (L)",
          "Herverpakking aantal",
          "Herverpakking liters (L)",
          "Correcties aantal",
          "Correcties liters (L)",
          "Eind aantal",
          "Eind liters (L)",
        ],
        rows: [
          [
            "Totaal",
            "",
            exportNumber(inventoryTotals.begin_liters),
            "",
            exportNumber(inventoryTotals.purchase_liters),
            "",
            exportNumber(inventoryTotals.production_liters),
            "",
            exportNumber(inventoryTotals.sold_liters),
            "",
            exportNumber(inventoryTotals.unpack_liters),
            "",
            exportNumber(inventoryTotals.repack_liters),
            "",
            exportNumber(inventoryTotals.correction_liters),
            "",
            exportNumber(inventoryTotals.end_liters),
          ],
          ...inventoryBridgeExportRows,
        ],
      },
      {
        name: "Variabele kosten controle",
        headers: [
          "Factuur/order",
          "Datum",
          "Klant",
          "Product",
          "Douano SKU",
          "Interne SKU",
          "LOT",
          "Interne LOT",
          "Kostprijsversie",
          "Aantal",
          "Netto omzet",
          "Inkoop/ingrediënten",
          "Verpakkingskosten",
          "ABC/overhead",
          "Accijns",
          "Totale kostprijs",
          "Variabel",
          "Variabel accijns",
          "Kostprijsstatus",
          "Kostprijsbron",
        ],
        rows: variableCostExportRows,
      },
    ]);
  }

  function hydrateCostRows(nextYear: string | number) {
    const yearNumber = Number(nextYear) || 0;
    const sourceFixedRows = Array.isArray(vasteKosten?.[String(yearNumber)]) ? vasteKosten[String(yearNumber)] : [];
    setFixedCostRows(sourceFixedRows.map((row, index) => fixedRowFromSource(row, index)));
    setIncidentalRows(
      (Array.isArray(incidenteleKosten) ? incidenteleKosten : [])
        .map((row) => incidentalRowFromSource(row, yearNumber))
        .filter((row) => row.jaar === yearNumber)
    );
  }

  function draftKey(nextYear = year) {
    return `jaar-afsluiten-draft-${nextYear}`;
  }

  function restoreDraft(nextYear = year) {
    if (typeof window === "undefined") return false;
    const raw = window.localStorage.getItem(draftKey(nextYear));
    if (!raw) return false;
    try {
      const draft = JSON.parse(raw) as Partial<{
        manual: ManualInputs;
        fixedCostRows: FixedCostCloseRow[];
        incidentalRows: IncidentalCloseRow[];
        overrideReason: string;
      }>;
      if (draft.manual) setManual(draft.manual);
      if (Array.isArray(draft.fixedCostRows)) setFixedCostRows(draft.fixedCostRows);
      if (Array.isArray(draft.incidentalRows)) setIncidentalRows(draft.incidentalRows);
      if (typeof draft.overrideReason === "string") setOverrideReason(draft.overrideReason);
      return true;
    } catch {
      return false;
    }
  }

  function removeDraft(nextYear = year) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(draftKey(nextYear));
  }

  function applyClosedSnapshot(item: GenericRecord) {
    const payload = item?.payload && typeof item.payload === "object" ? item.payload as GenericRecord : {};
    const manualInputs = payload.manual_inputs && typeof payload.manual_inputs === "object" ? payload.manual_inputs as GenericRecord : {};
    const drivers = payload.drivers && typeof payload.drivers === "object" ? payload.drivers as GenericRecord : {};
    const costs = payload.costs && typeof payload.costs === "object" ? payload.costs as GenericRecord : {};
    const fixedRows = Array.isArray(costs.fixed_cost_rows)
      ? costs.fixed_cost_rows
      : Array.isArray(manualInputs.fixed_cost_rows)
        ? manualInputs.fixed_cost_rows
        : [];
    const incidentRows = Array.isArray(costs.incidental_cost_rows)
      ? costs.incidental_cost_rows
      : Array.isArray(manualInputs.incidental_cost_rows)
        ? manualInputs.incidental_cost_rows
        : [];
    const inventory = payload.inventory && typeof payload.inventory === "object" ? payload.inventory as GenericRecord : {};

    setPreview(payload);
    setManual({
      fixed_cost_total: num(payload.fixed_cost_total ?? costs.fixed_cost_total?.value ?? manualInputs.fixed_cost_total),
      incidental_cost_total: num(payload.incidental_cost_total ?? costs.incidental_cost_total?.value ?? manualInputs.incidental_cost_total),
      purchase_liters: num(drivers.purchase_liters?.value ?? manualInputs.purchase_liters),
      production_liters: num(drivers.production_liters?.value ?? manualInputs.production_liters),
      sales_liters: num(drivers.sales_liters?.value ?? manualInputs.sales_liters),
      inventory_note: String(inventory.note ?? manualInputs.inventory_note ?? ""),
    });
    setFixedCostRows(
      fixedRows
        .filter((row: unknown) => row && typeof row === "object")
        .map((row: any, index: number) => fixedRowFromClosed(row, index))
    );
    setIncidentalRows(
      incidentRows
        .filter((row: unknown) => row && typeof row === "object")
        .map((row: any) => incidentalRowFromClosed(row, Number(payload.year ?? year)))
    );
    setClosed(item);
    setRefreshPreview(null);
    removeDraft(String(payload.year ?? year));
    setStatus("Jaarafsluiting is definitief. De vastgelegde snapshot wordt getoond.");
    setTone("success");
  }

  async function loadPreview(nextYear = year, nextBasis = basis) {
    setBusy(true);
    setStatus("");
    setTone("");
    try {
      const closedResponse = await fetch(
        `${API_BASE_URL}/integrations/break-even/year-closes?year=${encodeURIComponent(nextYear)}`,
        { credentials: "include", cache: "no-store" }
      );
      const closedPayload = await readJson(closedResponse);
      if (!closedResponse.ok) throw new Error(String(closedPayload?.detail || closedResponse.statusText));
      const closedItems = Array.isArray(closedPayload?.items) ? closedPayload.items : [];
      const closedItem = closedItems.find((row: any) => Number(row?.jaar ?? row?.year ?? 0) === Number(nextYear));
      if (closedItem) {
        applyClosedSnapshot(closedItem);
        return;
      }

      const response = await fetch(
        `${API_BASE_URL}/integrations/break-even/year-close-preview?year=${encodeURIComponent(nextYear)}&basis=${encodeURIComponent(nextBasis)}`,
        { credentials: "include", cache: "no-store" }
      );
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      const nextPreview = payload.preview ?? null;
      setPreview(nextPreview);
      setManual({ ...buildManualFromPreview(nextPreview), fixed_cost_total: 0, incidental_cost_total: 0 });
      hydrateCostRows(nextYear);
      setClosed(null);
      setRefreshPreview(null);
      const restored = restoreDraft(nextYear);
      setStatus(restored ? "Jaarafsluiting vooringevuld. Concept uit je browser hersteld." : "Jaarafsluiting vooringevuld.");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  async function calculateRefreshImpact() {
    if (!closed) return;
    setBusy(true);
    setStatus("");
    setTone("");
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/break-even/year-closes/${encodeURIComponent(year)}/refresh-preview`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basis }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      setRefreshPreview(payload.result ?? null);
      setStatus("Impact-preview berekend. Controleer de verschillen voordat je de snapshot ververst.");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  async function applySnapshotRefresh() {
    if (!closed) return;
    const ok = window.confirm(
      "Jaarafsluiting verversen? Hiermee vervang je alleen de afsluit-snapshot door de huidige brondata. Onderliggende Omzet & Marge, LOT-data en kostprijzen blijven ongemoeid."
    );
    if (!ok) return;
    setBusy(true);
    setStatus("");
    setTone("");
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/break-even/year-closes/${encodeURIComponent(year)}/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basis, reason: refreshReason.trim() }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      applyClosedSnapshot(payload.item ?? {});
      setRefreshReason("");
      setStatus("Jaarafsluiting ververst en opnieuw vastgelegd.");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadPreview(closeYearDefault, "invoice");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (closed) return;
    hydrateCostRows(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closed, year, vasteKosten, incidenteleKosten]);

  function setManualNumber(key: keyof ManualInputs, value: string) {
    setManual((current) => ({ ...current, [key]: value === "" ? 0 : Number(value) }));
  }

  function updateFixedCostRow(uiId: string, patch: Partial<FixedCostCloseRow>) {
    if (closed) return;
    setFixedCostRows((current) => current.map((row) => (row.uiId === uiId ? { ...row, ...patch } : row)));
  }

  function addFixedCostRow() {
    if (closed) return;
    setFixedCostRows((current) => [...current, createEmptyFixedRow()]);
  }

  function deleteFixedCostRow(uiId: string) {
    if (closed) return;
    const row = fixedCostRows.find((item) => item.uiId === uiId);
    if (!row?.isNew) {
      window.alert("Planregels uit Kostenstructuur kunnen niet worden verwijderd in de jaarafsluiting. Laat het gerealiseerde bedrag op 0 als deze kost niet gerealiseerd is.");
      return;
    }
    const ok = window.confirm("Nieuwe vaste-kostenregel verwijderen?");
    if (!ok) return;
    setFixedCostRows((current) => current.filter((item) => item.uiId !== uiId));
  }

  function updateIncidentalRow(rowId: string, patch: Partial<IncidentalCloseRow>) {
    if (closed) return;
    setIncidentalRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function addIncidentalRow() {
    if (closed) return;
    if (!selectedYearNumber) return;
    setIncidentalRows((current) => [...current, createEmptyIncidentalRow(selectedYearNumber)]);
  }

  function deleteIncidentalRow(rowId: string) {
    if (closed) return;
    const ok = window.confirm("Incidentele kostenregel verwijderen?");
    if (!ok) return;
    setIncidentalRows((current) => current.filter((row) => row.id !== rowId));
  }

  function validateCostRows() {
    for (const row of fixedCostRows) {
      if (!row.isNew && num(row.realised_amount) === 0) continue;
      if (!String(row.omschrijving || "").trim()) return "Omschrijving is verplicht bij vaste kosten.";
      if (!String(row.kostensoort || "").trim()) return "Kostensoort is verplicht bij vaste kosten.";
    }
    for (const row of incidentalRows) {
      if (!String(row.omschrijving || "").trim()) return "Omschrijving is verplicht bij incidentele kosten.";
      if (!String(row.toelichting || "").trim()) return "Toelichting is verplicht bij incidentele kosten.";
    }
    return "";
  }

  async function persistIncidentalRowsForYear() {
    const yearNumber = Number(year) || 0;
    const otherYears = (Array.isArray(incidenteleKosten) ? incidenteleKosten : [])
      .map((row) => incidentalRowFromSource(row, yearNumber))
      .filter((row) => row.jaar !== yearNumber);
    const nextRows = [
      ...otherYears,
      ...incidentalRows.map((row) => ({
        ...row,
        jaar: yearNumber,
        datum: String(row.datum || today()),
        omschrijving: String(row.omschrijving || "").trim(),
        bedrag: num(row.bedrag),
        toelichting: String(row.toelichting || "").trim(),
        ignore: Boolean(row.ignore),
      })),
    ];
    await reconcileDatasetItems("incidentele-kosten", nextRows);
  }

  async function closeYear({ redirect }: { redirect: boolean }) {
    if (!preview) return;
    const validationMessage = validateCostRows();
    if (validationMessage) {
      setStatus(validationMessage);
      setTone("error");
      setActiveStep(stepIndex("costs"));
      return;
    }
    if (warnings.length > 0 && !overrideReason.trim()) {
      setStatus("Los de waarschuwingen op of vul een override-reden in voordat je afsluit.");
      setTone("error");
      setActiveStep(stepIndex("checks"));
      return;
    }
    const ok = window.confirm(
      "Jaarafsluiting vastleggen? De onderliggende Omzet & Marge, kostprijzen en LOT-data blijven ongemoeid; alleen de afsluit-snapshot wordt opgeslagen."
    );
    if (!ok) return;
    setBusy(true);
    setStatus("");
    setTone("");
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/break-even/close-year`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: Number(year),
          basis,
          overwrite: true,
          override_reason: overrideReason.trim(),
          manual_inputs: {
            ...effectiveManual,
            fixed_cost_rows: fixedCostRows.map((row) => ({
              source_id: row.sourceId,
              omschrijving: row.omschrijving,
              kostensoort: row.kostensoort,
              cost_pool: row.cost_pool,
              exact_rekening: row.exact_rekening,
              planned_amount: num(row.planned_amount),
              realised_amount: num(row.realised_amount),
              is_new: Boolean(row.isNew),
            })),
            incidental_cost_rows: incidentalRows.map((row) => ({
              id: row.id,
              jaar: Number(year),
              datum: row.datum,
              omschrijving: row.omschrijving,
              bedrag: num(row.bedrag),
              toelichting: row.toelichting,
              ignore: Boolean(row.ignore),
            })),
          },
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      await persistIncidentalRowsForYear();
      removeDraft();
      setClosed(payload.item ?? null);
      setActiveStep(stepIndex("finish"));
      setStatus("Jaarafsluiting opgeslagen.");
      setTone("success");
      setOverrideReason("");
      if (redirect) router.push("/");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  function saveDraft({ redirect }: { redirect: boolean }) {
    const validationMessage = validateCostRows();
    if (validationMessage) {
      setStatus(validationMessage);
      setTone("error");
      setActiveStep(stepIndex("costs"));
      return;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        draftKey(),
        JSON.stringify({
          manual,
          fixedCostRows,
          incidentalRows,
          overrideReason,
          savedAt: new Date().toISOString(),
        })
      );
    }
    setStatus("Concept opgeslagen in je browser. Afronden bevriest het jaar pas op de laatste stap.");
    setTone("success");
    if (redirect) router.push("/");
  }

  function previousStep() {
    setActiveStep((value) => Math.max(0, value - 1));
  }

  function nextStep() {
    setActiveStep((value) => Math.min(steps.length - 1, value + 1));
  }

  return (
    <div className="cpq-root">
      <div className="cpq-frame">
        <div className="cpq-topbar">
          <div>
            <div className="cpq-kicker">Jaarafsluiting</div>
            <h1 className="cpq-title">Jaar {year} afsluiten</h1>
            <div className="module-card-text" style={{ marginTop: 6, maxWidth: 760 }}>
              Leg de gerealiseerde werkelijkheid vast als afsluit-snapshot. Nieuw jaar voorbereiden kan deze snapshot daarna als bronjaar gebruiken.
            </div>
          </div>
          <div className="cpq-topbar-actions">
            <button
              type="button"
              className="editor-button editor-button-secondary"
              onClick={() => router.push("/")}
              disabled={busy}
            >
              Terug
            </button>
            <span className="pill">Jaar {year}</span>
          </div>
        </div>

        <div className="cpq-grid cpq-grid-two">
          <aside className="cpq-left">
            <WizardSteps
              title={`Jaar ${year} afsluiten`}
              className="nieuw-jaar-wizard-steps"
              steps={steps.map((step) => ({
                id: step.id,
                title: step.label,
                description: step.description,
                stepNumber: "stepNumber" in step ? step.stepNumber : undefined,
              }))}
              activeIndex={activeStep}
              onSelect={(index) => setActiveStep(index)}
            />

            <div className="cpq-quick">
              <div className="cpq-quick-title">Quick view</div>
              <div className="cpq-quick-grid">
                <div className="cpq-quick-cell">
                  <span>Afsluitjaar</span>
                  <strong>{year}</strong>
                </div>
                <div className="cpq-quick-cell">
                  <span>Bron</span>
                  <strong>Facturen</strong>
                </div>
                <div className="cpq-quick-cell">
                  <span>Stap</span>
                  <strong>{activeStep + 1}</strong>
                </div>
                <div className="cpq-quick-cell">
                  <span>Status</span>
                  <strong>{closed ? "Afgesloten" : "Concept"}</strong>
                </div>
              </div>
            </div>
          </aside>

          <main className="cpq-main">
            <div className="wizard-shell wizard-shell-single" style={{ marginTop: 0 }}>
              <div className="wizard-step-card wizard-step-stage-card">
          <div className="wizard-step-header">
            <div>
              <div className="wizard-step-title">{currentStep.label}</div>
              <div className="wizard-step-description">{currentStep.description}</div>
            </div>
            <span className="pill">Jaar {year}</span>
          </div>

          {status ? <div className={`wizard-step-status ${tone ? `status-${tone}` : ""}`}>{status}</div> : null}

          <div className="wizard-step-body">
            {currentStepId === "jaarset" ? (
              <div className="wizard-stack">
                <div className="editor-grid two">
                  <label className="nested-field">
                    <span>Af te sluiten jaar</span>
                    <input className="dataset-input" value={year} readOnly inputMode="numeric" />
                  </label>
                  <div className="placeholder-block">
                    <strong>Bron voor actuals</strong>
                    <div className="muted">Facturen uit Omzet & Marge zijn de vaste bron voor de jaarafsluiting.</div>
                  </div>
                </div>
                <div className="placeholder-block">
                  <strong>Wat doet deze wizard?</strong>
                  <div className="muted">
                    Jaar afsluiten controleert eerst of de data schoon genoeg is, legt daarna omzet, kostprijs, liters, vaste kosten en incidentele kosten vast als afsluit-snapshot en bevriest het jaar pas wanneer je op Afronden klikt.
                  </div>
                </div>
                {closed ? (
                  <section className="module-card nested-module-card">
                    <div className="module-card-header">
                      <div>
                        <div className="module-card-title">Gesloten snapshot</div>
                        <div className="module-card-text">
                          Deze jaarafsluiting is vastgelegd op {String(closed.closed_at ?? "-")}. Openen ververst niets automatisch; gebruik verversen alleen na bewuste correcties over {year}.
                        </div>
                      </div>
                      <span className="pill">read-only</span>
                    </div>
                    <div className="editor-actions">
                      <button type="button" className="editor-button editor-button-secondary" onClick={calculateRefreshImpact} disabled={busy}>
                        Impact berekenen
                      </button>
                    </div>
                    {refreshPreview ? (
                      <div className="wizard-stack" style={{ marginTop: 12 }}>
                        <div className="data-table">
                          <table>
                            <thead>
                              <tr>
                                <th>Onderdeel</th>
                                <th>Snapshot</th>
                                <th>Nieuwe berekening</th>
                                <th>Verschil</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(Array.isArray(refreshPreview.impact) ? refreshPreview.impact : []).map((row: GenericRecord) => (
                                <tr key={String(row.key ?? row.label)}>
                                  <td>{String(row.label ?? row.key ?? "-")}</td>
                                  <td>{impactValue(String(row.key ?? ""), row.old)}</td>
                                  <td>{impactValue(String(row.key ?? ""), row.new)}</td>
                                  <td>
                                    <span className={`status-pill ${Math.abs(num(row.delta)) < 0.005 ? "status-ok" : "status-warning"}`}>
                                      {impactValue(String(row.key ?? ""), row.delta)}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <label className="nested-field">
                          <span>Reden voor verversen</span>
                          <textarea
                            className="dataset-input"
                            rows={3}
                            value={refreshReason}
                            onChange={(event) => setRefreshReason(event.target.value)}
                            placeholder="Bijvoorbeeld: voorraadstap toegevoegd of correctie over afgesloten jaar verwerkt."
                          />
                        </label>
                        <div className="editor-actions">
                          <button type="button" className="editor-button editor-button-primary" onClick={applySnapshotRefresh} disabled={busy}>
                            Snapshot verversen
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                <div className="editor-actions">
                  <button type="button" className="editor-button" onClick={() => loadPreview()} disabled={busy}>Jaar opnieuw laden</button>
                </div>
              </div>
            ) : null}

            {currentStepId === "actuals" ? (
              <div className="wizard-stack">
                <div className="record-card-grid">
                  <div className="wizard-toggle-card"><span><strong>Omzet</strong><small>{money(dashboard.revenue)}</small></span></div>
                  <div className="wizard-toggle-card"><span><strong>Variabele kosten</strong><small>{money(dashboard.variableCost)}</small></span></div>
                  <div className="wizard-toggle-card"><span><strong>Brutowinst / contributie</strong><small>{money(dashboard.contribution)}</small></span></div>
                  <div className="wizard-toggle-card"><span><strong>Resultaat na kosten</strong><small>{money(dashboard.result)}</small></span></div>
                </div>
                <div className="data-table">
                  <table>
                    <thead><tr><th>Stuurlaag</th><th>Waarde</th><th>Bron</th></tr></thead>
                    <tbody>
                      <tr><td>Omzet</td><td>{money(dashboard.revenue)}</td><td>Omzet & Marge ({basis})</td></tr>
                      <tr><td>Variabele kosten</td><td>{money(dashboard.variableCost)}</td><td>Omzet & Marge kostprijssnapshot</td></tr>
                      <tr><td>Break-even omzet</td><td>{money(dashboard.breakEvenRevenue)}</td><td>Afgeleid uit contributieratio en kosten</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {currentStepId === "drivers" ? (
              <div className="wizard-stack">
                <div className="data-table">
                  <table>
                    <thead><tr><th>Driver</th><th>Afgeleid uit bron</th><th>Vast te leggen</th><th>Bron</th></tr></thead>
                    <tbody>
                      <tr>
                        <td>Inkoop in L</td>
                        <td>{liters(preview?.drivers?.purchase_liters?.value)}</td>
                        <td><input className="dataset-input" type="number" value={manual.purchase_liters || ""} disabled={!!closed} onChange={(event) => setManualNumber("purchase_liters", event.target.value)} /></td>
                        <td>{sourceLabel(preview?.drivers?.purchase_liters)}</td>
                      </tr>
                      <tr>
                        <td>Productie in L</td>
                        <td>{liters(preview?.drivers?.production_liters?.value)}</td>
                        <td><input className="dataset-input" type="number" value={manual.production_liters || ""} disabled={!!closed} onChange={(event) => setManualNumber("production_liters", event.target.value)} /></td>
                        <td>{sourceLabel(preview?.drivers?.production_liters)}</td>
                      </tr>
                      <tr>
                        <td>Verkoop in L</td>
                        <td>{liters(preview?.drivers?.sales_liters?.value)}</td>
                        <td><input className="dataset-input" type="number" value={manual.sales_liters || ""} disabled={!!closed} onChange={(event) => setManualNumber("sales_liters", event.target.value)} /></td>
                        <td>{sourceLabel(preview?.drivers?.sales_liters)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="placeholder-block">
                  <strong>Plan blijft plan</strong>
                  <div className="muted">
                    Deze waarden worden bij afronden als gerealiseerd vastgelegd in Productie en drivers. De planwaarden uit Nieuw jaar voorbereiden worden niet overschreven.
                  </div>
                </div>
              </div>
            ) : null}

            {currentStepId === "costs" ? (
              <div className="wizard-stack">
                <section className="module-card nested-module-card">
                  <div className="module-card-header">
                    <div>
                      <div className="module-card-title">Vaste kosten ABC {year}</div>
                      <div className="module-card-text">
                        Plan komt read-only uit Kostenstructuur. Vul hier de gerealiseerde bedragen in voor de afsluit-snapshot.
                      </div>
                    </div>
                    <span className="pill">{money(fixedCostTotal)} gerealiseerd</span>
                  </div>
                  <div className="dataset-editor-scroll">
                    <table className="dataset-editor-table">
                      <thead>
                        <tr>
                          <th style={{ width: "260px" }}>Omschrijving</th>
                          <th style={{ width: "180px" }}>Kostensoort</th>
                          <th style={{ width: "180px" }}>Pool</th>
                          <th style={{ width: "160px" }}>Exact rekening</th>
                          <th style={{ width: "160px" }}>Plan</th>
                          <th style={{ width: "170px" }}>Gerealiseerd</th>
                          <th style={{ width: "70px" }} />
                        </tr>
                      </thead>
                      <tbody>
                        {fixedCostRows.length === 0 ? (
                          <tr>
                            <td className="dataset-empty" colSpan={7}>
                              Geen vaste-kostenregels voor {year}. Voeg regels toe als er wel gerealiseerde vaste kosten zijn.
                            </td>
                          </tr>
                        ) : null}
                        {fixedCostRows.map((row) => (
                          <tr key={row.uiId}>
                            <td>
                              <input
                                className="dataset-input"
                                value={row.omschrijving}
                                readOnly={!row.isNew}
                                disabled={!!closed}
                                onChange={(event) => updateFixedCostRow(row.uiId, { omschrijving: event.target.value })}
                              />
                            </td>
                            <td>
                              {row.isNew ? (
                                <select
                                  className="dataset-input"
                                  value={row.kostensoort}
                                  disabled={!!closed}
                                  onChange={(event) => updateFixedCostRow(row.uiId, { kostensoort: event.target.value })}
                                >
                                  <option value="">Kies...</option>
                                  <option value="Indirecte kosten">Indirecte kosten</option>
                                  <option value="Directe kosten">Directe kosten</option>
                                </select>
                              ) : (
                                <input className="dataset-input" value={row.kostensoort} readOnly />
                              )}
                            </td>
                            <td>
                              <input
                                className="dataset-input"
                                value={row.cost_pool}
                                readOnly={!row.isNew}
                                disabled={!!closed}
                                onChange={(event) => updateFixedCostRow(row.uiId, { cost_pool: event.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                className="dataset-input"
                                value={row.exact_rekening}
                                readOnly={!row.isNew}
                                disabled={!!closed}
                                onChange={(event) => updateFixedCostRow(row.uiId, { exact_rekening: event.target.value })}
                              />
                            </td>
                            <td>{money(row.planned_amount)}</td>
                            <td>
                              <input
                                className="dataset-input"
                                type="number"
                                step="any"
                                value={Number.isFinite(row.realised_amount) ? String(row.realised_amount) : "0"}
                                disabled={!!closed}
                                onChange={(event) => updateFixedCostRow(row.uiId, { realised_amount: Number(event.target.value || 0) })}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="icon-button-table"
                                aria-label="Verwijderen"
                                title={row.isNew ? "Nieuwe regel verwijderen" : "Planregel kan niet worden verwijderd in de afsluiting"}
                                disabled={!!closed}
                                onClick={() => deleteFixedCostRow(row.uiId)}
                              >
                                x
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="editor-actions">
                    <button type="button" className="editor-button editor-button-secondary" onClick={addFixedCostRow} disabled={!!closed}>
                      Rij toevoegen
                    </button>
                  </div>
                </section>

                <section className="module-card nested-module-card">
                  <div className="module-card-header">
                    <div>
                      <div className="module-card-title">Incidentele kosten {year}</div>
                      <div className="module-card-text">
                        Deze regels komen uit Kostenstructuur &gt; Incidenteel. Wijzigingen worden bij afronden voor dit jaar teruggeschreven.
                      </div>
                    </div>
                    <span className="pill">{money(incidentalCostTotal)} actief</span>
                  </div>
                  {!yearExistsInProductie ? (
                    <div className="placeholder-block">
                      <strong>Productiejaar ontbreekt</strong>
                      <div className="muted">Incidentele kosten kunnen pas worden vastgelegd als {year} bestaat in Productie en drivers.</div>
                    </div>
                  ) : null}
                  <div className="dataset-editor-scroll">
                    <table className="dataset-editor-table">
                      <thead>
                        <tr>
                          <th style={{ width: "150px" }}>Datum</th>
                          <th style={{ width: "260px" }}>Omschrijving</th>
                          <th style={{ width: "160px" }}>Bedrag</th>
                          <th>Toelichting</th>
                          <th style={{ width: "100px" }}>Negeer</th>
                          <th style={{ width: "70px" }} />
                        </tr>
                      </thead>
                      <tbody>
                        {incidentalRows.length === 0 ? (
                          <tr>
                            <td className="dataset-empty" colSpan={6}>
                              Geen incidentele kosten voor {year}. Voeg alleen uitzonderingen toe die niet in ABC of SKU-kostprijs horen.
                            </td>
                          </tr>
                        ) : null}
                        {incidentalRows.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <input
                                className="dataset-input"
                                type="date"
                                value={row.datum}
                                disabled={!!closed}
                                onChange={(event) => updateIncidentalRow(row.id, { datum: event.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                className="dataset-input"
                                value={row.omschrijving}
                                disabled={!!closed}
                                onChange={(event) => updateIncidentalRow(row.id, { omschrijving: event.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                className="dataset-input"
                                type="number"
                                step="any"
                                value={Number.isFinite(row.bedrag) ? String(row.bedrag) : "0"}
                                disabled={!!closed}
                                onChange={(event) => updateIncidentalRow(row.id, { bedrag: Number(event.target.value || 0) })}
                              />
                            </td>
                            <td>
                              <textarea
                                className="dataset-input"
                                rows={2}
                                value={row.toelichting}
                                disabled={!!closed}
                                onChange={(event) => updateIncidentalRow(row.id, { toelichting: event.target.value })}
                              />
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <input
                                type="checkbox"
                                checked={row.ignore}
                                disabled={!!closed}
                                onChange={(event) => updateIncidentalRow(row.id, { ignore: event.target.checked })}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="icon-button-table"
                                aria-label="Verwijderen"
                                title="Verwijderen"
                                disabled={!!closed}
                                onClick={() => deleteIncidentalRow(row.id)}
                              >
                                x
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="editor-actions">
                    <button type="button" className="editor-button editor-button-secondary" onClick={addIncidentalRow} disabled={!yearExistsInProductie || !!closed}>
                      Rij toevoegen
                    </button>
                  </div>
                </section>
                <div className="record-card-grid">
                  <div className="wizard-toggle-card"><span><strong>Totale beheersbare kosten</strong><small>{money(dashboard.controllableCosts)}</small></span></div>
                  <div className="wizard-toggle-card"><span><strong>Resultaat</strong><small>{money(dashboard.result)}</small></span></div>
                </div>
              </div>
            ) : null}

            {currentStepId === "inventory" ? (
              <div className="wizard-stack">
                <div className={`editor-status ${String(inventory.status ?? "") === "ok" ? "success" : "warning"}`}>
                  <strong>Voorraad {year}</strong>
                  <div className="muted" style={{ marginTop: 6 }}>
                    {String(inventory.source_note ?? "") ||
                      "Voorraad wordt vastgelegd als begin- en eindstand met waardering op inkoop/ingredienten en apart inclusief accijns."}
                  </div>
                </div>
                <div className="record-card-grid">
                  <div className="wizard-toggle-card"><span><strong>Beginvoorraad</strong><small>{liters(inventoryTotals.begin_liters)}</small></span></div>
                  <div className="wizard-toggle-card"><span><strong>Eindvoorraad</strong><small>{liters(inventoryTotals.end_liters)}</small></span></div>
                  <div className="wizard-toggle-card"><span><strong>Waarde eind</strong><small>{money(inventoryTotals.end_value_primary)}</small></span></div>
                  <div className="wizard-toggle-card"><span><strong>Waarde eind incl. accijns</strong><small>{money(inventoryTotals.end_value_with_excise)}</small></span></div>
                </div>
                <div className="dataset-editor-scroll">
                  <table className="dataset-editor-table wizard-table-compact">
                    <thead>
                      <tr>
                        <th style={{ width: "260px" }}>Product / SKU</th>
                        <th style={{ width: "135px" }}>Inkoop/ingr.</th>
                        <th style={{ width: "120px" }}>Accijns</th>
                        <th style={{ width: "120px" }}>Voorraad 01-01</th>
                        <th style={{ width: "140px" }}>Waarde 01-01</th>
                        <th style={{ width: "160px" }}>Waarde incl. accijns 01-01</th>
                        <th style={{ width: "120px" }}>Voorraad 31-12</th>
                        <th style={{ width: "140px" }}>Waarde 31-12</th>
                        <th style={{ width: "160px" }}>Waarde incl. accijns 31-12</th>
                        <th style={{ width: "120px" }}>Gekocht/geproduceerd</th>
                        <th style={{ width: "100px" }}>Verkocht</th>
                        <th style={{ width: "130px" }}>Uitpakking / herverpakking</th>
                        <th style={{ width: "120px" }}>Correcties/overig</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventoryRows.length === 0 ? (
                        <tr>
                          <td colSpan={14} className="dataset-empty">
                            Geen voorraadregels beschikbaar. Draai eerst Douano sync stock movements en laad daarna de jaarafsluiting opnieuw.
                          </td>
                        </tr>
                      ) : null}
                      {inventoryRows.map((row, index) => (
                        <tr key={`${row.sku_id || row.sku_code || row.product_name || "inventory"}-${index}`}>
                          <td>
                            <strong>{String(row.product_name ?? row.sku_id ?? "-")}</strong>
                          </td>
                          <td>{money(row.primary_cost_per_unit)}</td>
                          <td>{money(row.excise_per_unit)}</td>
                          <td>{qty(row.begin_quantity)}</td>
                          <td>{money(row.begin_value_primary)}</td>
                          <td>{money(row.begin_value_with_excise)}</td>
                          <td>{qty(row.end_quantity)}</td>
                          <td>{money(row.end_value_primary)}</td>
                          <td>{money(row.end_value_with_excise)}</td>
                          <td>{qty(row.purchased_or_produced_quantity)}</td>
                          <td>{qty(row.sold_quantity)}</td>
                          <td>{qty(row.unpack_quantity)} / {qty(row.repack_quantity)}</td>
                          <td>{qty(row.correction_other_quantity ?? row.other_movement_quantity)}</td>
                          <td>
                            <span className={`status-pill ${String(row.status ?? "") === "ok" ? "status-ok" : "status-warning"}`}>
                              {String(row.status ?? "") === "ok" ? "OK" : String((row.warnings as string[] | undefined)?.join(", ") || "Controle")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="nested-field">
                  <span>Notitie voorraad</span>
                  <textarea
                    className="dataset-input"
                    rows={4}
                    value={manual.inventory_note}
                    disabled={!!closed}
                    onChange={(event) => setManual((current) => ({ ...current, inventory_note: event.target.value }))}
                  />
                </label>
              </div>
            ) : null}

            {currentStepId === "inventory-control" ? (
              <div className="wizard-stack">
                <section className="placeholder-block">
                  <strong>Voorraadcontrole {year}</strong>
                  <div className="muted" style={{ marginTop: 6 }}>
                    Controlelaag voor fysieke liters: beginvoorraad + inkoop + afvullen/productie - verkoop + uitpakking/herverpakking + correcties = eindvoorraad.
                  </div>
                  <div className="record-card-grid" style={{ marginTop: 12 }}>
                    <div className="wizard-toggle-card"><span><strong>Begin</strong><small>{bridgeLiters(inventoryTotals.begin_liters)}</small></span></div>
                    <div className="wizard-toggle-card"><span><strong>Inkoop</strong><small>{bridgeLiters(inventoryTotals.purchase_liters)}</small></span></div>
                    <div className="wizard-toggle-card"><span><strong>Afvullen/productie</strong><small>{bridgeLiters(inventoryTotals.production_liters)}</small></span></div>
                    <div className="wizard-toggle-card"><span><strong>Verkoop</strong><small>{bridgeLiters(inventoryTotals.sold_liters)}</small></span></div>
                    <div className="wizard-toggle-card"><span><strong>Uit/her</strong><small>{bridgeLiters(inventoryTotals.unpack_repack_liters)}</small></span></div>
                    <div className="wizard-toggle-card"><span><strong>Correcties</strong><small>{bridgeLiters(inventoryTotals.correction_liters)}</small></span></div>
                    <div className="wizard-toggle-card"><span><strong>Eind</strong><small>{bridgeLiters(inventoryTotals.end_liters)}</small></span></div>
                  </div>
                  <div className="muted" style={{ marginTop: 8 }}>
                    Brugcontrole: {bridgeLiters(inventoryTotals.stock_bridge_liters)}. Eindvoorraad: {bridgeLiters(inventoryTotals.end_liters)}.
                  </div>
                  <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
                    <table className="dataset-editor-table wizard-table-compact">
                      <thead>
                        <tr>
                          <th style={{ width: "260px" }}>Product / SKU</th>
                          <th>Begin</th>
                          <th>Inkoop</th>
                          <th>Afvullen</th>
                          <th>Verkoop</th>
                          <th>Uit/her</th>
                          <th>Correcties</th>
                          <th>Eind</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventoryRows.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="dataset-empty">
                              Geen voorraadcontrole beschikbaar. Draai eerst Douano sync stock movements en laad daarna de jaarafsluiting opnieuw.
                            </td>
                          </tr>
                        ) : null}
                        {inventoryRows.map((row, index) => (
                          <tr key={`bridge-${row.sku_id || row.sku_code || row.product_name || "inventory"}-${index}`}>
                            <td><strong>{String(row.product_name ?? row.sku_id ?? "-")}</strong></td>
                            <td>{bridgeQtyLiters(row.begin_quantity, row.begin_liters)}</td>
                            <td>{bridgeQtyLiters(row.purchase_quantity, row.purchase_liters)}</td>
                            <td>{bridgeQtyLiters(row.production_quantity, row.production_liters)}</td>
                            <td>{bridgeQtyLiters(row.sold_quantity, row.sold_liters)}</td>
                            <td>{bridgeQtyLiters(row.unpack_repack_quantity, row.unpack_repack_liters)}</td>
                            <td>{bridgeQtyLiters(row.correction_other_quantity ?? row.other_movement_quantity, row.correction_liters)}</td>
                            <td>{bridgeQtyLiters(row.end_quantity, row.end_liters)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            ) : null}

            {currentStepId === "checks" ? (
              <div className="wizard-stack">
                <div className="data-table">
                  <table>
                    <thead><tr><th>Check</th><th>Status</th><th>Waarde</th></tr></thead>
                    <tbody>
                      <tr><td>Ontbrekende kostprijsregels</td><td>{Number(checks.missing_cost_lines ?? 0) === 0 ? "OK" : "Blokkerend"}</td><td>{checks.missing_cost_lines ?? 0}</td></tr>
                      <tr><td>Ongekoppelde omzet</td><td>{Number(checks.unmapped_revenue ?? 0) === 0 ? "OK" : "Blokkerend"}</td><td>{money(checks.unmapped_revenue)}</td></tr>
                      <tr><td>Vaste kosten vastgelegd</td><td>{fixedCostTotal > 0 ? "OK" : "Aandacht"}</td><td>{money(fixedCostTotal)}</td></tr>
                      <tr><td>Incidentele kosten gecontroleerd</td><td>OK</td><td>{money(incidentalCostTotal)}</td></tr>
                    </tbody>
                  </table>
                </div>
                {warnings.length ? (
                  <div className="placeholder-block">
                    <strong>Override nodig bij blokkades</strong>
                    <ul>
                      {warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                    {criticalErrors.length ? <div className="muted">Kritische fouten blokkeren afsluiten zonder expliciete reden.</div> : null}
                    <label className="nested-field" style={{ marginTop: 12 }}>
                      <span>Override-reden</span>
                      <textarea
                        className="dataset-input"
                        value={overrideReason}
                        disabled={!!closed}
                        onChange={(event) => setOverrideReason(event.target.value)}
                        rows={3}
                        placeholder="Leg vast waarom je ondanks deze waarschuwingen toch afsluit."
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            ) : null}

            {currentStepId === "finish" ? (
              <div className="wizard-stack">
                <div className="placeholder-block">
                  <strong>Snapshot klaar om vast te leggen</strong>
                  <div className="muted">
                    De snapshot bevriest de realisatie voor {year}. Onderliggende verkoopregels, kostprijzen en LOT-historie worden niet aangepast.
                  </div>
                  {closed ? <div className="muted">Laatst opgeslagen snapshot: <code>{closed.id}</code></div> : null}
                  <div className="editor-actions" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      onClick={downloadInventoryWorkbook}
                      disabled={!preview || inventoryRows.length === 0}
                    >
                      Download voorraad
                    </button>
                  </div>
                </div>
                <div className="record-card-grid">
                  <div className="wizard-toggle-card"><span><strong>Omzet</strong><small>{money(dashboard.revenue)}</small></span></div>
                  <div className="wizard-toggle-card"><span><strong>Resultaat</strong><small>{money(dashboard.result)}</small></span></div>
                  <div className="wizard-toggle-card"><span><strong>Break-even omzet</strong><small>{money(dashboard.breakEvenRevenue)}</small></span></div>
                </div>
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Stuurlaag</th>
                        <th>Plan</th>
                        <th>Werkelijk</th>
                        <th>Verschil</th>
                        <th>Verschil %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!planComparison.available ? (
                        <tr>
                          <td colSpan={5} className="dataset-empty">
                            Geen planbasis gevonden voor {year}. Maak eerst een first-use backfill of nieuw-jaarplan.
                          </td>
                        </tr>
                      ) : null}
                      {planComparison.available
                        ? planComparison.rows.map((row) => (
                            <tr key={row.label}>
                              <td>{row.label}</td>
                              <td>{money(row.planned)}</td>
                              <td>{money(row.actual)}</td>
                              <td>{money(row.delta)}</td>
                              <td>{`${(row.deltaPct * 100).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`}</td>
                            </tr>
                          ))
                        : null}
                    </tbody>
                  </table>
                  {planComparison.available ? (
                    <div className="muted" style={{ marginTop: 8 }}>
                      Planbron: {planComparison.source}
                      {planComparison.scenarioName ? ` - ${planComparison.scenarioName}` : ""}
                    </div>
                  ) : null}
                </div>
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Stuurlaag</th>
                        <th>Waarde</th>
                        <th>Formule</th>
                        <th>Bron</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardRows(dashboard).map((row) => (
                        <tr key={row.label}>
                          <td>{row.label}</td>
                          <td>{money(row.value)}</td>
                          <td>{row.formula}</td>
                          <td>{row.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {closed ? (
                  <div className="editor-actions">
                    <Link className="editor-button editor-button-secondary" href={`/nieuw-jaar-voorbereiden?source_year=${encodeURIComponent(year)}&target_year=${encodeURIComponent(String(Number(year) + 1))}`}>
                      Nieuw jaar voorbereiden
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="editor-actions" style={{ justifyContent: "space-between", marginTop: 18 }}>
              {isLastStep ? (
                <>
                  <div className="editor-actions">
                    <button type="button" className="editor-button editor-button-secondary" onClick={previousStep} disabled={activeStep === 0 || busy}>
                      Vorige
                    </button>
                  </div>
                  <div className="editor-actions">
                    <button type="button" className="editor-button editor-button-primary" onClick={() => closeYear({ redirect: true })} disabled={busy || !preview || !!closed}>
                      Afronden
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="editor-actions">
                    <button type="button" className="editor-button editor-button-secondary" onClick={previousStep} disabled={activeStep === 0 || busy}>
                      Vorige
                    </button>
                    <button type="button" className="editor-button editor-button-secondary" onClick={() => saveDraft({ redirect: false })} disabled={busy || !preview || !!closed}>
                      Opslaan
                    </button>
                    <button type="button" className="editor-button editor-button-secondary" onClick={() => saveDraft({ redirect: true })} disabled={busy || !preview || !!closed}>
                      Opslaan en sluiten
                    </button>
                  </div>
                  <div className="editor-actions">
                    <button type="button" className="editor-button editor-button-primary" onClick={nextStep} disabled={busy || !preview}>
                      Volgende
                    </button>
                  </div>
                </>
              )}
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
