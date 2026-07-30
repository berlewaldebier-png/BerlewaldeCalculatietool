import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function run() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require("module") as any;
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (
    request: string,
    parent: unknown,
    isMain: boolean,
    options: unknown
  ) {
    if (typeof request === "string" && request.startsWith("@/")) {
      const compiledRoot = path.resolve(__dirname, "..");
      const mapped = path.join(compiledRoot, "src", request.slice(2));
      return originalResolveFilename.call(
        this,
        mapped,
        parent,
        isMain,
        options
      );
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const contextModule = require("../src/features/commercial-context/quoteCommercialContext") as typeof import("../src/features/commercial-context/quoteCommercialContext");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const persistence = require("../src/components/offerte-samenstellen/persistence") as typeof import("../src/components/offerte-samenstellen/persistence");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const quoteUtils = require("../src/components/offerte-samenstellen/quoteUtils") as typeof import("../src/components/offerte-samenstellen/quoteUtils");
  const response: import("../src/features/commercial-context/quoteCommercialContext").QuoteCommercialContextResponse =
    {
      version: "rf-012c1-v1",
      status: "ready",
      consumer_mode: "active_generation",
      binding: {
        mode: "active_generation",
        version: "rf-012c1-v1",
        generation_id: "generation-2026",
        run_id: "run-2026",
        operational_year: 2026,
        manifest_hash: "manifest-2026",
        validation_hash: "validation-2026",
      },
      items: [
        {
          sku_id: "sku-blond-case",
          scope_classification: "carried_forward",
          subject_type: "beer",
          subject_id: "beer-blond",
          canonical_beer_id: "beer-blond",
          format_article_id: "format-case",
          sku_kind: "composite",
          source_anchor_id: "anchor-2025",
          source_cost_version_id: "version-2025",
          source_cost_row_id: "row-2025",
          cost_version_id: "version-2026",
          cost_row_id: "row-2026",
          calculation_method: "engine-v1",
          provenance_kind: "recalculated_from_source_year",
          provenance_source_year: 2025,
          primary_cost: 10,
          packaging_cost: 1,
          overhead_cost: 9,
          excise_cost: 4,
          cost_price: 24,
          liters_per_unit: 7.92,
          cost_required: true,
          cost_readiness_status: "ready",
          price_id: "price-2026",
          source_pricing_id: "price-2025",
          target_pricing_id: "price-target-2026",
          list_price: 38,
          price_readiness_status: "ready",
          quote_readiness_status: "ready",
          reason_codes: [],
        },
        {
          sku_id: "sku-catalog-only",
          scope_classification: "catalog_reference_only",
          subject_type: "article",
          subject_id: "article-catalog",
          canonical_beer_id: "",
          format_article_id: "article-catalog",
          sku_kind: "article",
          source_anchor_id: "",
          source_cost_version_id: "",
          source_cost_row_id: "",
          cost_version_id: "version-catalog-2026",
          cost_row_id: "row-catalog-2026",
          calculation_method: "not-required",
          provenance_kind: "catalog_reference",
          provenance_source_year: 2026,
          primary_cost: null,
          packaging_cost: null,
          overhead_cost: null,
          excise_cost: null,
          cost_price: null,
          liters_per_unit: null,
          cost_required: false,
          cost_readiness_status: "not_required",
          price_id: "",
          source_pricing_id: "",
          target_pricing_id: "",
          list_price: null,
          price_readiness_status: "missing",
          quote_readiness_status: "excluded",
          reason_codes: [
            "quote_catalog_reference_only",
            "quote_sell_in_missing",
            "quote_sell_in_non_positive",
          ],
        },
      ],
      summary: {
        candidate_sku_count: 2,
        quote_ready_count: 1,
        excluded_count: 1,
        exclusion_counts: {
          quote_catalog_reference_only: 1,
          quote_sell_in_missing: 1,
          quote_sell_in_non_positive: 1,
        },
      },
      reason_codes: [],
      requested_generation_id: "",
    };

  const binding = contextModule.bindingFromResponse(response);
  assert(binding.mode === "active_generation", "Expected active binding.");
  assert(binding.generationId === "generation-2026", "Generation binding changed.");
  assert(binding.runId === "run-2026", "Run binding changed.");

  const result = contextModule.buildQuoteableActiveContextOptions({
    context: response,
    bieren: [{ id: "beer-blond", biernaam: "Berlewalde Blond" }],
    skus: [
      {
        id: "sku-blond-case",
        name: "Berlewalde Blond - Doos 24 * 33cl",
        beer_id: "beer-blond",
        format_article_id: "format-case",
      },
      { id: "sku-catalog-only", name: "Historisch artikel" },
    ],
    articles: [
      {
        id: "format-case",
        name: "Doos 24 * 33cl",
        uom: "stuk",
        content_liter: 7.92,
      },
      { id: "article-catalog", name: "Historisch artikel", uom: "stuk" },
    ],
    kostprijsversies: [
      { id: "version-2025", basisgegevens: { btw_tarief: "21%" } },
    ],
    verpakkingsonderdelen: [
      {
        id: "component-giftbox",
        omschrijving: "Geschenkdoos",
        beschikbaar_voor_offertes: true,
      },
    ],
    verpakkingsonderdeelPrijzen: [
      {
        verpakkingsonderdeel_id: "component-giftbox",
        jaar: 2026,
        prijs_per_stuk: 2.5,
      },
    ],
  });

  const product = result.options.find(
    (option) => option.optionId === "sku:sku-blond-case"
  );
  assert(product, "Active generation SKU disappeared.");
  assert(product.costPriceEx === 24, "Planning cost must come from active candidate.");
  assert(product.standardPriceEx === 38, "Sell-in must come from active candidate.");
  assert(product.standardPriceYear === 2026, "Operational year changed.");
  assert(
    product.kostprijsversieId === "version-2026",
    "Reserved active context cost-version identity changed."
  );
  assert(product.vatRatePct === 21, "VAT compatibility metadata changed.");
  assert(
    !result.options.some((option) => option.optionId === "sku:sku-catalog-only"),
    "Excluded catalog SKU became quote-selectable."
  );
  assert(
    result.options.some(
      (option) => option.optionId === "packaging:component-giftbox"
    ),
    "Existing quote packaging policy changed."
  );
  assert(
    result.warnings.some((warning) =>
      warning.includes("catalogusreferentie")
    ),
    "Typed exclusion did not reach the UI warning boundary."
  );

  const legacy = contextModule.bindingFromPersistedSnapshot(undefined, 2025);
  assert(
    legacy.mode === "legacy_persisted" && legacy.operationalYear === 2025,
    "Pre-RF-012C1 quote must retain persisted legacy year."
  );
  const restored = contextModule.bindingFromPersistedSnapshot(binding, 2026);
  assert(
    restored.mode === "active_generation" &&
      restored.generationId === "generation-2026",
    "Reopened quote lost its exact generation binding."
  );
  assert(
    contextModule.contextMatchesBinding(response, restored),
    "Matching persisted generation was not recognized."
  );
  const initialDraft = quoteUtils.createInitialQuoteDraft(2026);
  const persisted = persistence.buildQuotePersistencePayload({
    ...initialDraft,
    commercialContext: binding,
    ui: {
      step: "basis",
      activeScenario: "A",
      unitMode: "producten",
      vatMode: "excl",
    },
  });
  assert(persisted.schemaVersion === 3, "RF-012C1 quote schema version changed.");
  assert(
    persisted.draft.commercialContext?.mode === "active_generation" &&
      persisted.draft.commercialContext.generationId === "generation-2026",
    "Saved quote did not retain its exact commercial generation."
  );
  const rolledBack = {
    ...response,
    binding: {
      ...response.binding!,
      generation_id: "generation-2025",
      run_id: "run-2025",
      operational_year: 2025,
    },
  };
  assert(
    !contextModule.contextMatchesBinding(rolledBack, restored),
    "A different active/rollback generation silently rebound the quote."
  );
}

run();

console.log("quote active context contracttest OK");
