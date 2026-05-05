"use client";

import type { BuilderBlock, OptionType, QuoteFormState, QuoteScenario } from "@/components/offerte-samenstellen/types";

export function openNewOption({
  type,
  scenario,
  setEditingBlockId,
  setForm,
  setSelectedOption,
  evaluateOptionAvailability,
  createInitialQuoteFormState,
}: {
  type: OptionType;
  scenario: QuoteScenario;
  setEditingBlockId: (next: string | null) => void;
  setForm: (next: QuoteFormState) => void;
  setSelectedOption: (next: OptionType | null) => void;
  evaluateOptionAvailability: (args: { scenario: QuoteScenario; type: OptionType }) => { allowed: boolean };
  createInitialQuoteFormState: () => QuoteFormState;
}) {
  const availability = evaluateOptionAvailability({
    scenario,
    type,
  });
  if (!availability.allowed) return;
  setEditingBlockId(null);
  setForm(createInitialQuoteFormState());
  setSelectedOption(type);
}

export function openEditOption({
  block,
  setEditingBlockId,
  setForm,
  setSelectedOption,
  hydrateFormFromBlock,
}: {
  block: BuilderBlock;
  setEditingBlockId: (next: string | null) => void;
  setForm: (next: QuoteFormState) => void;
  setSelectedOption: (next: OptionType | null) => void;
  hydrateFormFromBlock: (block: BuilderBlock) => QuoteFormState;
}) {
  setEditingBlockId(block.id);
  setForm(hydrateFormFromBlock(block));
  setSelectedOption(block.type);
}

export function closeOptionDialog({
  setSelectedOption,
  setEditingBlockId,
  setForm,
  createInitialQuoteFormState,
}: {
  setSelectedOption: (next: OptionType | null) => void;
  setEditingBlockId: (next: string | null) => void;
  setForm: (next: QuoteFormState) => void;
  createInitialQuoteFormState: () => QuoteFormState;
}) {
  setSelectedOption(null);
  setEditingBlockId(null);
  setForm(createInitialQuoteFormState());
}

