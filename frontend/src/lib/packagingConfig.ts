export type PackagingDefaults = {
  unitsPerLayer: number | null;
  unitsPerPallet: number | null;
};

export type PackagingConfig = {
  bySalesUnitLabel: Record<string, PackagingDefaults>;
};

const DEFAULT_CONFIG: PackagingConfig = {
  bySalesUnitLabel: {
    doos: { unitsPerLayer: 12, unitsPerPallet: 72 },
    case: { unitsPerLayer: 12, unitsPerPallet: 72 },
    fust: { unitsPerLayer: 20, unitsPerPallet: 40 },
    keg: { unitsPerLayer: 20, unitsPerPallet: 40 },
  },
};

export function getPackagingDefaultsForLabel(
  salesUnitLabel: string
): PackagingDefaults {
  const key = String(salesUnitLabel ?? "").trim().toLowerCase();
  if (!key) return { unitsPerLayer: null, unitsPerPallet: null };
  return (
    DEFAULT_CONFIG.bySalesUnitLabel[key] ?? { unitsPerLayer: null, unitsPerPallet: null }
  );
}

