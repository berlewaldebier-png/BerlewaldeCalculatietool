"use client";

import type { OptionType, QuoteScenario } from "@/components/offerte-samenstellen/types";

export const OPTION_TYPES_ORDER: OptionType[] = [
  "Intro",
  "Staffel",
  "Mix",
  "Korting",
  "Groothandel",
  "Palletopbouw",
  "Transport",
  "Retour",
  "Proeverij",
  "Tapverhuur",
];

export function buildOptionAvailabilityMap<R>({
  scenario,
  evaluateOptionAvailability,
}: {
  scenario: QuoteScenario;
  evaluateOptionAvailability: (args: { scenario: QuoteScenario; type: OptionType; editingBlockId?: string | null }) => R;
}) {
  const entries = OPTION_TYPES_ORDER.map((type) => [
    type,
    evaluateOptionAvailability({
      scenario,
      type,
    }),
  ]);

  return Object.fromEntries(entries) as Record<OptionType, R>;
}
