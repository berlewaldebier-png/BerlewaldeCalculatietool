function clampNumber(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export type QuoteHandlingCostBreakdownRow = {
  cost_pool: string;
  allocation_driver: "SHIPMENTS" | "PICKS_OR_ORDER_LINES" | "PALLETS";
  rate: number;
  units: number;
  amount: number;
};

export type QuoteHandlingCostResult = {
  total: number;
  breakdown: QuoteHandlingCostBreakdownRow[];
  warnings: string[];
};

function normalizeDriver(value: unknown) {
  const text = String(value ?? "").trim().toUpperCase();
  if (text === "SHIPMENTS" || text === "PICKS_OR_ORDER_LINES" || text === "PALLETS") return text;
  return "";
}

function normalizeScope(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "all" || text === "purchased" || text === "own_production" || text === "contract_brew") return text;
  return "all";
}

function getNormalTotal(productionYear: Record<string, unknown>, key: string, fallbackKey: string) {
  const normal = Number((productionYear as any)[key] ?? 0);
  if (Number.isFinite(normal) && normal > 0) return normal;
  const actual = Number((productionYear as any)[fallbackKey] ?? 0);
  return Number.isFinite(actual) && actual > 0 ? actual : 0;
}

export function computeQuoteHandlingCost(params: {
  year: number;
  productionYear: Record<string, unknown> | null | undefined;
  vasteKostenRows: Array<Record<string, unknown>>;
  shipments: number;
  orderLines: number;
  pallets?: number;
  scope?: "all" | "purchased" | "own_production" | "contract_brew";
}): QuoteHandlingCostResult {
  const productionYear = params.productionYear ?? {};
  const shipments = clampNumber(params.shipments, 1);
  const orderLines = clampNumber(params.orderLines, 0);
  const pallets = clampNumber(params.pallets ?? 0, 0);
  const scope = params.scope ?? "all";

  const warnings: string[] = [];
  const breakdown: QuoteHandlingCostBreakdownRow[] = [];

  const normalShipments = getNormalTotal(productionYear, "normal_shipments", "shipments");
  const normalOrderLines = getNormalTotal(productionYear, "normal_orderlines", "orderlines");

  if (normalShipments <= 0) warnings.push("Normal shipments ontbreekt; SHIPMENTS handlingregels worden genegeerd.");
  if (normalOrderLines <= 0) warnings.push("Normal orderregels ontbreekt; ORDERLINES handlingregels worden genegeerd.");

  for (const raw of params.vasteKostenRows ?? []) {
    const include = Boolean((raw as any).include_in_quote_handling ?? false);
    if (!include) continue;

    const ruleScope = normalizeScope((raw as any).allocation_scope);
    if (!(ruleScope === "all" || ruleScope === scope)) continue;

    const driver = normalizeDriver((raw as any).allocation_driver);
    if (!driver) continue;

    const amountPerYear = Number((raw as any).bedrag_per_jaar ?? 0);
    if (!Number.isFinite(amountPerYear) || amountPerYear === 0) continue;

    let denom = 0;
    let units = 0;
    if (driver === "SHIPMENTS") {
      denom = normalShipments;
      units = shipments;
    } else if (driver === "PICKS_OR_ORDER_LINES") {
      denom = normalOrderLines;
      units = orderLines;
    } else if (driver === "PALLETS") {
      // Pallets not modeled as a normal total yet; treat as unsupported for MVP.
      denom = 0;
      units = pallets;
    }

    if (!(denom > 0)) continue;
    const rate = amountPerYear / denom;
    const amount = rate * units;
    if (!Number.isFinite(amount) || amount === 0) continue;

    breakdown.push({
      cost_pool: String((raw as any).cost_pool ?? "").trim() || String((raw as any).omschrijving ?? "").trim() || "Handeling",
      allocation_driver: driver as any,
      rate,
      units,
      amount
    });
  }

  const total = breakdown.reduce((sum, row) => sum + row.amount, 0);
  return {
    total: Math.max(0, total),
    breakdown,
    warnings
  };
}
