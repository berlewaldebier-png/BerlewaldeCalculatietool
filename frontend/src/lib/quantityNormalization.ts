export type QuantityInputUnit = "sales_units" | "liters";
export type RoundingMode = "none" | "exact_units" | "full_layers" | "full_pallets";

export type SalesUnitMeta = {
  salesUnitLabel: string;
  litersPerSalesUnit: number | null;
  unitsPerLayer: number | null;
  unitsPerPallet: number | null;
  contributesToLiters: boolean;
};

export type QuantityNormalizationResult = {
  rawUnits: number;
  normalizedUnits: number;
  rawLiters: number | null;
  normalizedLiters: number | null;
  roundedUpUnits: number;
  roundedUpLiters: number | null;
  warnings: string[];
};

function clampNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

export function normalizeQuantity(params: {
  inputValue: unknown;
  inputUnit: QuantityInputUnit;
  roundingMode: RoundingMode;
  salesUnit: SalesUnitMeta;
}): QuantityNormalizationResult {
  const warnings: string[] = [];
  const inputValue = clampNumber(params.inputValue, 0);
  const litersPerUnit =
    params.salesUnit.litersPerSalesUnit && params.salesUnit.litersPerSalesUnit > 0
      ? params.salesUnit.litersPerSalesUnit
      : null;

  const rawUnits =
    params.inputUnit === "liters"
      ? litersPerUnit
        ? inputValue / litersPerUnit
        : 0
      : inputValue;

  const rawLiters =
    params.salesUnit.contributesToLiters && litersPerUnit ? rawUnits * litersPerUnit : null;

  let normalizedUnits = rawUnits;

  if (params.roundingMode === "exact_units") {
    normalizedUnits = Math.ceil(rawUnits);
  } else if (params.roundingMode === "full_layers") {
    if (!params.salesUnit.unitsPerLayer || params.salesUnit.unitsPerLayer <= 0) {
      warnings.push(
        "Afronden op volle lagen is niet mogelijk: units_per_layer ontbreekt."
      );
    } else {
      normalizedUnits =
        Math.ceil(rawUnits / params.salesUnit.unitsPerLayer) *
        params.salesUnit.unitsPerLayer;
    }
  } else if (params.roundingMode === "full_pallets") {
    if (!params.salesUnit.unitsPerPallet || params.salesUnit.unitsPerPallet <= 0) {
      warnings.push(
        "Afronden op volle pallets is niet mogelijk: units_per_pallet ontbreekt."
      );
    } else {
      normalizedUnits =
        Math.ceil(rawUnits / params.salesUnit.unitsPerPallet) *
        params.salesUnit.unitsPerPallet;
    }
  }

  const normalizedLiters =
    params.salesUnit.contributesToLiters && litersPerUnit
      ? normalizedUnits * litersPerUnit
      : null;

  const roundedUpUnits = Math.max(0, normalizedUnits - rawUnits);
  const roundedUpLiters =
    normalizedLiters !== null && rawLiters !== null
      ? Math.max(0, normalizedLiters - rawLiters)
      : null;

  if (params.inputUnit === "liters" && !litersPerUnit && params.salesUnit.contributesToLiters) {
    warnings.push("Liter-invoer kan niet: liters_per_sales_unit ontbreekt.");
  }

  return {
    rawUnits,
    normalizedUnits,
    rawLiters,
    normalizedLiters,
    roundedUpUnits,
    roundedUpLiters,
    warnings,
  };
}

