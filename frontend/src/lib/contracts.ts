// Step 0: shared product/UI contracts.
// This file is intentionally documentation-first: it encodes the intended "single truth"
// so multiple screens don't drift in behaviour.

export type PriceBasis = "excl_btw" | "incl_btw";

// Pricing math contract (UI uses opslag as the default input; margin is derived).
export type PricingInputs = {
  kostprijs_excl_btw: number; // cost per unit (piece or liter, depending on row context)
  opslag_pct: number; // markup percentage (input)
  korting_pct?: number; // optional discount on sell-in
  btw_pct?: number; // VAT rate for display
};

export type PricingOutputs = {
  verkoopprijs_excl_btw: number;
  omzet_excl_btw: number;
  kosten_excl_btw: number;
  winst_excl_btw: number;
  marge_pct: number; // derived result
};

// Year context contract:
// - Most screens should use the active set for a year.
// - "Year" is a context label unless the screen is explicitly "manage sets by year".
export type YearContextMode = "context_only" | "selectable";

