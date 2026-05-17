export type BreakEvenProgressInput = {
  breakEvenTargetLiters: number;
  alreadySoldLitersYtd: number;
  customerAlreadyBoughtLiters?: number | null;
  growthFromDealLiters: number;
  discountEffectLitersEquivalent: number;
  transportEffectLitersEquivalent: number;
};

export type BreakEvenProgressOutput = {
  effectiveProgressFromDealLiters: number;
  newTotalProgressLiters: number;
  remainingLitersToBreakEven: number;
  progressPct: number;
};

function num(value: unknown) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

export function calculateBreakEvenProgress(
  input: BreakEvenProgressInput
): BreakEvenProgressOutput {
  const breakEvenTargetLiters = Math.max(0, num(input.breakEvenTargetLiters));
  const alreadySoldLitersYtd = Math.max(0, num(input.alreadySoldLitersYtd));
  const growthFromDealLiters = Math.max(0, num(input.growthFromDealLiters));
  const discountEffectLitersEquivalent = Math.max(
    0,
    num(input.discountEffectLitersEquivalent)
  );
  const transportEffectLitersEquivalent = Math.max(
    0,
    num(input.transportEffectLitersEquivalent)
  );

  const effectiveProgressFromDealLiters = Math.max(
    0,
    growthFromDealLiters - discountEffectLitersEquivalent - transportEffectLitersEquivalent
  );

  const newTotalProgressLiters =
    alreadySoldLitersYtd + effectiveProgressFromDealLiters;

  const remainingLitersToBreakEven = Math.max(
    0,
    breakEvenTargetLiters - newTotalProgressLiters
  );

  const progressPct =
    breakEvenTargetLiters > 0
      ? Math.min(100, (newTotalProgressLiters / breakEvenTargetLiters) * 100)
      : 0;

  return {
    effectiveProgressFromDealLiters,
    newTotalProgressLiters,
    remainingLitersToBreakEven,
    progressPct,
  };
}

