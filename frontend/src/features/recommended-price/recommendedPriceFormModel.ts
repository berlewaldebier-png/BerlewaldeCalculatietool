import type { ActionStatusState } from "@/components/ActionStatus";
import type { ProductCostRow } from "@/components/adviesprijzen/adviesprijzenDerivations";
import type { VatDisplayMode } from "@/components/ui/VatDisplayToggle";
import {
  calcAdviesprijsInclBtwRange,
  fromInclBtw,
  toInclBtw,
} from "@/lib/pricingEngine";

export const RECOMMENDED_PRICE_SAVE_SUCCESS = "Opgeslagen.";
export const RECOMMENDED_PRICE_SAVE_ERROR = "Opslaan mislukt.";
export const RECOMMENDED_PRICE_PENDING_STATUS: ActionStatusState = {
  kind: "pending",
  message: "Adviesprijzen worden opgeslagen.",
};

export type RecommendedPriceDisplayRow = ProductCostRow & {
  kostprijsShown: number;
  sellInShown: number;
  adviesMinShown: number;
  adviesMaxShown: number;
  margeKlantPct: number;
};

export function getDefaultRecommendedPriceYear(years: number[], currentYear: number): number {
  return years[years.length - 1] ?? currentYear;
}

export function getAdviceMarkupInputLabel(channelName: string): string {
  return `Opslag (%) voor ${channelName}`;
}

export function buildRecommendedPriceDisplayRow({
  row,
  sellInEx,
  adviesOpslagPct,
  vatDisplay,
}: {
  row: ProductCostRow;
  sellInEx: number;
  adviesOpslagPct: number;
  vatDisplay: VatDisplayMode;
}): RecommendedPriceDisplayRow {
  const btwPct = Number.isFinite(row.btwPct) ? row.btwPct : 0;
  const { min: adviesMinIncl, max: adviesMaxIncl, margeKlantPct } = calcAdviesprijsInclBtwRange({
    kostprijsEx: row.kostprijsEx,
    sellInEx,
    adviesOpslagPct,
    btwPct,
  });

  return {
    ...row,
    btwPct,
    kostprijsShown: vatDisplay === "incl" ? toInclBtw(row.kostprijsEx, btwPct) : row.kostprijsEx,
    sellInShown: vatDisplay === "incl" ? toInclBtw(sellInEx, btwPct) : sellInEx,
    adviesMinShown: vatDisplay === "incl" ? adviesMinIncl : fromInclBtw(adviesMinIncl, btwPct),
    adviesMaxShown: vatDisplay === "incl" ? adviesMaxIncl : fromInclBtw(adviesMaxIncl, btwPct),
    margeKlantPct,
  };
}

export function getRecommendedPriceActionStatus(
  status: string,
  isSaving: boolean
): ActionStatusState | null {
  if (isSaving) return RECOMMENDED_PRICE_PENDING_STATUS;
  if (!status) return null;
  if (status === RECOMMENDED_PRICE_SAVE_SUCCESS) {
    return { kind: "success", message: status };
  }
  return {
    kind: "error",
    message: status || RECOMMENDED_PRICE_SAVE_ERROR,
    guidance: "Controleer de ingevoerde opslag en je verbinding. Probeer daarna opnieuw.",
  };
}
