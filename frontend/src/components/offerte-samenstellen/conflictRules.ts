import type {
  BuilderBlock,
  OptionType,
  QuoteBlockContext,
  QuoteScenario,
} from "@/components/offerte-samenstellen/types";

export type OptionAvailability = {
  allowed: boolean;
  reasons: string[];
  context: QuoteBlockContext;
};

type EvaluateOptionParams = {
  scenario: QuoteScenario;
  type: OptionType;
  activePeriodView: "intro" | "standard";
  editingBlockId?: string | null;
};

const PRICING_RULE_TYPES: OptionType[] = ["Staffel", "Mix", "Korting"];

function isPricingRule(type: OptionType) {
  return PRICING_RULE_TYPES.includes(type);
}

function getContextForOption(
  type: OptionType,
  activePeriodView: "intro" | "standard"
): QuoteBlockContext {
  if (type === "Intro") return "intro";
  if (type === "Transport" || type === "Retour" || type === "Proeverij" || type === "Tapverhuur") {
    return "global";
  }
  return activePeriodView;
}

function getRelevantBlocks(scenario: QuoteScenario, editingBlockId?: string | null): BuilderBlock[] {
  return scenario.blocks.filter((block) => block.id !== editingBlockId);
}

export function evaluateOptionAvailability({
  scenario,
  type,
  activePeriodView,
  editingBlockId,
}: EvaluateOptionParams): OptionAvailability {
  const reasons: string[] = [];
  const context = getContextForOption(type, activePeriodView);
  const hasIntro = Boolean(scenario.intro?.start && scenario.intro?.end);
  const blocks = getRelevantBlocks(scenario, editingBlockId);
  const blocksInContext = blocks.filter((block) => (block.appliesTo ?? "standard") === context);
  const pricingRulesInContext = blocksInContext.filter((block) => isPricingRule(block.type));

  if (type === "Intro") {
    const hasStaffelWithoutIntro = !hasIntro && blocks.some(
      (block) => block.type === "Staffel" && (block.appliesTo ?? "standard") === "standard"
    );
    if (hasStaffelWithoutIntro) {
      reasons.push("Introductie kan pas terug als de bestaande Staffel in de standaardperiode is verwijderd.");
    }
  }

  if (isPricingRule(type) && pricingRulesInContext.length >= 2) {
    reasons.push(`${context === "intro" ? "Introductie" : "Standaardperiode"} heeft al het maximum van 2 prijsregels bereikt.`);
  }

  if (type === "Staffel" && pricingRulesInContext.some((block) => block.type === "Korting")) {
    reasons.push("Staffel en korting zijn niet combineerbaar binnen dezelfde prijscontext.");
  }

  if (type === "Korting" && pricingRulesInContext.some((block) => block.type === "Staffel")) {
    reasons.push("Korting en Staffel zijn niet combineerbaar binnen dezelfde prijscontext.");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    context,
  };
}

export function buildScenarioConflictHints(scenario: QuoteScenario): string[] {
  const hints: string[] = [];
  const hasIntro = Boolean(scenario.intro?.start && scenario.intro?.end);
  const standardPricing = scenario.blocks.filter(
    (block) =>
      (block.appliesTo ?? "standard") === "standard" &&
      isPricingRule(block.type)
  );

  if (standardPricing.length >= 2) {
    hints.push("Standaardperiode: max 2 prijsregels bereikt.");
  }

  const standardHasStaffel = standardPricing.some((block) => block.type === "Staffel");
  const standardHasKorting = standardPricing.some((block) => block.type === "Korting");

  if (standardHasStaffel && standardHasKorting) {
    hints.push("Standaardperiode: Staffel en korting zijn niet combineerbaar.");
  }

  if (!hasIntro && standardHasStaffel) {
    hints.push("Introductie toevoegen is geblokkeerd zolang Staffel actief is in de standaardperiode.");
  }

  return hints;
}

