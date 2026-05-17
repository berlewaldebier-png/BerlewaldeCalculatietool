export type TransportThresholdUnit = "pallets" | "layers" | "boxes" | "liters" | "order_value";
export type TransportCostType = "fixed" | "manual";

export type TransportRule = {
  freeShippingThresholdValue: number;
  freeShippingThresholdUnit: TransportThresholdUnit;
  transportCostType: TransportCostType;
  transportCostEx: number;
  includeInMargin: boolean;
  chargedToCustomer: boolean;
};

export type QuoteTotalsForTransport = {
  totalRevenueEx: number;
  totalLiters: number;
  totalBoxes: number;
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
      warnings: [],
    };
  }

  const thresholdValue = Math.max(0, num(rule.freeShippingThresholdValue));
  const thresholdUnit = rule.freeShippingThresholdUnit;
  const costEx = Math.max(0, num(rule.transportCostEx));

  const measure = (() => {
    if (thresholdUnit === "pallets") return params.totals.totalPallets;
    if (thresholdUnit === "layers") return params.totals.totalLayers;
    if (thresholdUnit === "boxes") return params.totals.totalBoxes;
    if (thresholdUnit === "liters") return params.totals.totalLiters;
    if (thresholdUnit === "order_value") return params.totals.totalRevenueEx;
    return 0;
  })();

  const isFreeShipping = thresholdValue > 0 ? measure >= thresholdValue : false;
  const appliedTransportCostEx = isFreeShipping ? 0 : costEx;

  const transportRevenueEx = rule.chargedToCustomer ? appliedTransportCostEx : 0;
  const transportCostInMarginEx =
    !rule.chargedToCustomer && rule.includeInMargin ? appliedTransportCostEx : 0;

  if (rule.transportCostType === "manual" && costEx <= 0) {
    warnings.push("Transportkosten staan op handmatig maar bedrag is 0.");
  }

  return {
    isActive: true,
    isFreeShipping,
    appliedTransportCostEx,
    transportCostInMarginEx,
    transportRevenueEx,
    warnings,
  };
}

