export type TransportThresholdUnit =
  | "pallets"
  | "layers"
  | "boxes"
  | "fust"
  | "fles"
  | "liters"
  | "km"
  | "order_value";
export type TransportCostType = "fixed" | "per_km" | "manual";

export type TransportRule = {
  freeShippingThresholdValue: number;
  freeShippingThresholdUnit: TransportThresholdUnit;
  transportCostType: TransportCostType;
  transportCostEx: number;
  distanceKm: number;
  ratePerKmEx: number;
  includeInMargin: boolean;
  chargedToCustomer: boolean;
};

export type QuoteTotalsForTransport = {
  totalRevenueEx: number;
  totalLiters: number;
  totalBoxes: number;
  totalFust: number;
  totalFles: number;
  totalLayers: number;
  totalPallets: number;
  warnings: string[];
};

export type TransportImpact = {
  isActive: boolean;
  isFreeShipping: boolean;
  appliedTransportCostEx: number;
  transportCostInMarginEx: number;
  transportRevenueEx: number;
  internalTransportCostEx: number;
  internalTransportCostInMarginEx: number;
  netEffectEx: number;
  warnings: string[];
};

function num(value: unknown) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateTransportImpact(params: {
  rule: TransportRule | null;
  totals: QuoteTotalsForTransport;
}): TransportImpact {
  const warnings: string[] = [...(params.totals.warnings ?? [])];
  const rule = params.rule;

  if (!rule) {
    return {
      isActive: false,
      isFreeShipping: false,
      appliedTransportCostEx: 0,
      transportCostInMarginEx: 0,
      transportRevenueEx: 0,
      internalTransportCostEx: 0,
      internalTransportCostInMarginEx: 0,
      netEffectEx: 0,
      warnings: [],
    };
  }

  const thresholdValue = Math.max(0, num(rule.freeShippingThresholdValue));
  const thresholdUnit = rule.freeShippingThresholdUnit;
  const costEx = Math.max(0, num(rule.transportCostEx));
  const distanceKm = Math.max(0, num(rule.distanceKm));
  const ratePerKmEx = Math.max(0, num(rule.ratePerKmEx));

  const measure = (() => {
    if (thresholdUnit === "pallets") return params.totals.totalPallets;
    if (thresholdUnit === "layers") return params.totals.totalLayers;
    if (thresholdUnit === "boxes") return params.totals.totalBoxes;
    if (thresholdUnit === "fust") return params.totals.totalFust;
    if (thresholdUnit === "fles") return params.totals.totalFles;
    if (thresholdUnit === "liters") return params.totals.totalLiters;
    if (thresholdUnit === "km") return distanceKm;
    if (thresholdUnit === "order_value") return params.totals.totalRevenueEx;
    return 0;
  })();

  const isFreeShipping =
    thresholdValue > 0
      ? thresholdUnit === "km"
        ? measure <= thresholdValue
        : measure >= thresholdValue
      : false;

  const roundTripKm = distanceKm * 2;

  // Internal cost: always exists (even when shipping is free for the customer).
  // We always model internal cost as round-trip km × internal rate.
  const internalTransportCostEx = roundTripKm * ratePerKmEx;
  const internalTransportCostInMarginEx = rule.includeInMargin ? internalTransportCostEx : 0;

  const appliedTransportCostEx = (() => {
    if (isFreeShipping) return 0;
    // What the customer would pay if we choose to charge it:
    // - per_km: internal cost proxy
    // - fixed/manual: the fixed amount
    if (rule.transportCostType === "per_km") return Math.max(0, internalTransportCostEx);
    return Math.max(0, costEx);
  })();

  // Quote impact rule (as requested):
  // - Transport impact is ALWAYS based on internal transport cost (never 0).
  // - If shipping is free (threshold met) -> negative for us (red).
  // - If not free: positive if we charge the customer, negative if we choose not to.
  const transportRevenueEx =
    !isFreeShipping && rule.chargedToCustomer ? internalTransportCostEx : 0;
  const transportCostInMarginEx =
    rule.includeInMargin && (isFreeShipping || !rule.chargedToCustomer) ? internalTransportCostEx : 0;
  const netEffectEx =
    isFreeShipping || !rule.chargedToCustomer ? -internalTransportCostEx : internalTransportCostEx;

  // Internal cost: always exists (even when shipping is free for the customer).
  if (rule.transportCostType === "manual" && costEx <= 0) {
    warnings.push("Transportkosten staan op handmatig maar bedrag is 0.");
  }
  if (rule.transportCostType === "per_km" && costEx <= 0) {
    // In per-km mode we use ratePerKmEx for internal cost; costEx is unused.
  }
  if (thresholdUnit === "km" && distanceKm <= 0) {
    warnings.push("Afstand (km) ontbreekt; gratis verzending o.b.v. km kan niet worden bepaald.");
  }
  if (rule.transportCostType === "per_km" && ratePerKmEx <= 0) {
    warnings.push("Interne kostprijs per km is 0; interne transportkosten worden 0 berekend.");
  }

  return {
    isActive: true,
    isFreeShipping,
    appliedTransportCostEx,
    transportCostInMarginEx,
    transportRevenueEx,
    internalTransportCostEx,
    internalTransportCostInMarginEx,
    netEffectEx,
    warnings,
  };
}

