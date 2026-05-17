export type DealContext = "one_off" | "growth" | "agreement";

export function resolvePricedLitersTotal(input: {
  dealContext: DealContext;
  selectionLitersTotal: number;
  customerBaselineLiters: number;
  targetVolumeLiters: number | null;
  agreementVolumeLiters: number | null;
}): number {
  const selectionLitersTotal = Math.max(0, input.selectionLitersTotal);
  const customerBaselineLiters = Math.max(0, input.customerBaselineLiters);

  if (selectionLitersTotal <= 0) return 0;

  if (input.dealContext === "growth") {
    const target = typeof input.targetVolumeLiters === "number" ? input.targetVolumeLiters : null;
    if (target !== null) return Math.max(0, target - customerBaselineLiters);
    return Math.max(0, selectionLitersTotal - customerBaselineLiters);
  }

  if (input.dealContext === "agreement") {
    const agreement = typeof input.agreementVolumeLiters === "number" ? input.agreementVolumeLiters : null;
    return Math.max(0, agreement ?? selectionLitersTotal);
  }

  return selectionLitersTotal;
}

