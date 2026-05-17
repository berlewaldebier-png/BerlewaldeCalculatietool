import { computeGratisFreeByRefFromPaidRows } from "../pricingEngine";

type CalculationLine = {
  ref: string;
  qtyPaid: number;
  qtyFree: number;
  offerUnitPriceEx: number;
};

function clampNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

export function applyMixDealToLines(params: {
  lines: CalculationLine[];
  payload: Record<string, unknown> | null | undefined;
  resolveEligibleRefs: (value: unknown) => Set<string>;
  notes: string[];
}) {
  const payload = params.payload ?? {};
  const requiredQty = clampNumber((payload as any).requiredQty, 0);
  const freeQty = clampNumber((payload as any).freeQty, 0);
  const eligibleRefs = params.resolveEligibleRefs((payload as any).eligibleRefs);

  if (requiredQty <= 0 || freeQty <= 0) {
    params.notes.push("Mix deal mist een geldige X+Y configuratie.");
    return params.lines;
  }

  const { freeByRef } = computeGratisFreeByRefFromPaidRows({
    rows: params.lines.map((line) => ({
      included: eligibleRefs.has(line.ref),
      ref: line.ref,
      qtyPaid: line.qtyPaid,
      unitPriceEx: line.offerUnitPriceEx,
    })),
    requiredQty,
    freeQty,
    eligibleRefs: Array.from(eligibleRefs),
  });

  return params.lines.map((line) => ({
    ...line,
    qtyFree: line.qtyFree + (freeByRef.get(line.ref) ?? 0),
  }));
}

