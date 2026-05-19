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
  editingBlockId?: string | null;
};

const PRICING_RULE_TYPES: OptionType[] = ["Staffel", "Mix", "Korting", "Groothandel"];
const BASE_OFFER_REQUIRED_TYPES: OptionType[] = ["Intro", "Staffel", "Mix", "Korting", "Groothandel"];
const DISALLOW_DUPLICATE_GLOBAL_TYPES: OptionType[] = ["Transport"];

function isPricingRule(type: OptionType) {
  return PRICING_RULE_TYPES.includes(type);
}

function getContextForOption(type: OptionType): QuoteBlockContext {
  if (type === "Intro") return "intro";
  if (
    type === "Transport" ||
    type === "Retour" ||
    type === "Proeverij" ||
    type === "Tapverhuur" ||
    type === "Palletopbouw"
  ) {
    return "global";
  }
  return "standard";
}

function getRelevantBlocks(scenario: QuoteScenario, editingBlockId?: string | null): BuilderBlock[] {
  return scenario.blocks.filter((block) => block.id !== editingBlockId);
}

function scenarioHasSelectableBaseOfferProducts(scenario: QuoteScenario) {
  return scenario.products.some((p) => {
    if (Boolean((p as any).isMixLiters)) return false;
    if (p.contributesToLiters === false) return false;
    const hasRef =
      Boolean((p as any)?.source?.sku_id) ||
      (Boolean((p as any)?.source?.bier_id) && Boolean((p as any)?.source?.product_id));
    if (!hasRef) return false;
    return Math.max(0, p.litersPerUnit ?? 0) > 0;
  });
}

export function evaluateOptionAvailability({
  scenario,
  type,
  editingBlockId,
}: EvaluateOptionParams): OptionAvailability {
  const reasons: string[] = [];
  const context = getContextForOption(type);
  const hasIntro = Boolean(scenario.intro?.start && scenario.intro?.end);
  const blocks = getRelevantBlocks(scenario, editingBlockId);
  const blocksInContext = blocks.filter((block) => (block.appliesTo ?? "standard") === context);
  const pricingRulesInContext = blocksInContext.filter((block) => isPricingRule(block.type));

  if (BASE_OFFER_REQUIRED_TYPES.includes(type) && !scenarioHasSelectableBaseOfferProducts(scenario)) {
    reasons.push("Voeg eerst producten toe aan de basisofferte om deze actie te gebruiken.");
  }

  if (DISALLOW_DUPLICATE_GLOBAL_TYPES.includes(type) && context === "global") {
    const hasExisting = blocks.some(
      (block) => block.type === type && (block.appliesTo ?? "standard") === "global"
    );
    if (hasExisting) {
      reasons.push(`${type} is al toegevoegd. Bewerk de kaart in de offerte.`);
    }
  }

  if (type === "Intro") {
    const hasStaffelWithoutIntro =
      !hasIntro &&
      blocks.some(
        (block) => block.type === "Staffel" && (block.appliesTo ?? "standard") === "standard"
      );
    if (hasStaffelWithoutIntro) {
      reasons.push(
        "Introductie kan pas terug als de bestaande Staffel in de standaardperiode is verwijderd."
      );
    }
  }

  if (isPricingRule(type) && pricingRulesInContext.length >= 1) {
    reasons.push("Een voorstel kan in de standaardperiode maar één pricingactie hebben.");
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
    (block) => (block.appliesTo ?? "standard") === "standard" && isPricingRule(block.type)
  );

  if (standardPricing.length >= 1) {
    hints.push("Standaardperiode: er kan maar één pricingactie actief zijn.");
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
