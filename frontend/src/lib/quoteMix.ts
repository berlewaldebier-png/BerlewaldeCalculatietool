export type MixSource = "quote" | "customer" | "portfolio";

export function resolveMixPctForRef(input: {
  mixSource: MixSource;
  ref: string;
  quoteMixPctByRef: Record<string, number>;
  customerMixPctByRef: Record<string, number>;
  portfolioMixPctByRef: Record<string, number>;
}): number | null {
  const ref = String(input.ref || "").trim();
  if (!ref) return null;

  if (input.mixSource === "quote") {
    return typeof input.quoteMixPctByRef[ref] === "number" ? input.quoteMixPctByRef[ref] : null;
  }

  if (input.mixSource === "customer") {
    const customer = input.customerMixPctByRef[ref];
    if (typeof customer === "number") return customer;
    const portfolio = input.portfolioMixPctByRef[ref];
    return typeof portfolio === "number" ? portfolio : null;
  }

  const portfolio = input.portfolioMixPctByRef[ref];
  return typeof portfolio === "number" ? portfolio : null;
}

