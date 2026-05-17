import { formatStaffelInput, getDerivedStaffelPrice } from "../../components/offerte-samenstellen/staffelUtils";
import type { ProductOption } from "../../components/offerte-samenstellen/types";

type CalculationLine = {
  ref: string;
  qtyPaid: number;
  litersPerUnit: number;
  baseUnitPriceEx: number;
  offerUnitPriceEx: number;
  costPriceEx: number;
};

function clampNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function asArrayOfRecords(value: unknown) {
  return Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : [];
}

export function applyStaffelToLines(params: {
  lines: CalculationLine[];
  payload: Record<string, unknown> | null | undefined;
  resolveEligibleRefs: (value: unknown) => Set<string>;
  notes: string[];
}) {
  const payload = params.payload ?? {};
  const tiersRaw = asArrayOfRecords((payload as any).tiers);
  const discountMode = String((payload as any).discountMode ?? "absolute");
  const discountValue = formatStaffelInput(clampNumber((payload as any).discountValue, 0));
  const eligibleRefs = params.resolveEligibleRefs((payload as any).eligibleRefs);

  if (tiersRaw.length === 0 || eligibleRefs.size === 0) {
    params.notes.push("Staffel is actief maar mist tiers of productselectie.");
    return params.lines;
  }

  return params.lines.map((line) => {
    if (!eligibleRefs.has(line.ref)) return line;

    const tierIndex = tiersRaw.findIndex((candidate) => {
      const from = clampNumber((candidate as any).from, 0);
      const to =
        (candidate as any).to === null ||
        (candidate as any).to === undefined ||
        String((candidate as any).to).trim() === ""
          ? Number.POSITIVE_INFINITY
          : clampNumber((candidate as any).to, Number.POSITIVE_INFINITY);

      return line.qtyPaid >= from && line.qtyPaid <= to;
    });

    if (tierIndex < 0) return line;

    const tier = tiersRaw[tierIndex] as any;
    const nextPrice =
      getDerivedStaffelPrice(
        {
          optionId: line.ref,
          bierId: "",
          productId: "",
          label: line.ref,
          bierName: "",
          packLabel: "",
          salesUnitLabel: "stuk",
          unitsPerLayer: null,
          unitsPerPallet: null,
          contributesToLiters: line.litersPerUnit > 0,
          contributesToMargin: true,
          litersPerUnit: line.litersPerUnit,
          staffelCompatibilityKey: "",
          staffelCompatibilityLabel: "",
          costPriceEx: line.costPriceEx,
          standardPriceEx: line.baseUnitPriceEx,
          vatRatePct: 0,
          kostprijsversieId: "",
        } satisfies ProductOption,
        tierIndex,
        {
          from: String(tier.from ?? ""),
          to: tier.to === null || tier.to === undefined ? "" : String(tier.to),
          price: String(tier.priceEx ?? ""),
        },
        discountMode as "percent" | "absolute" | "free",
        discountValue
      ) ?? 0;

    return nextPrice > 0 ? { ...line, offerUnitPriceEx: nextPrice } : line;
  });
}
