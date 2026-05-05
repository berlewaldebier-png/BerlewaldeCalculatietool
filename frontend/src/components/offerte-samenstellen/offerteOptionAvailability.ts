"use client";

import type { OptionType, QuoteScenario } from "@/components/offerte-samenstellen/types";

export const OPTION_TYPES_ORDER: OptionType[] = [
  "Intro",
  "Staffel",
  "Mix",
  "Korting",
  "Groothandel",
  "Transport",
  "Retour",
  "Proeverij",
  "Tapverhuur",
];

export function buildOptionAvailabilityMap({
  scenario,
  evaluateOptionAvailability,
}: {
  scenario: QuoteScenario;
  evaluateOptionAvailability: (args: { scenario: QuoteScenario; type: OptionType; editingBlockId?: string | null }) => unknown;
}) {
  const entries = OPTION_TYPES_ORDER.map((type) => [
    type,
    evaluateOptionAvailability({
      scenario,
      type,
    }),
  ]);

  return Object.fromEntries(entries) as Record<OptionType, ReturnType<typeof evaluateOptionAvailability>>;
}
