type GenericRecord = Record<string, unknown>;

export type CostpriceParts = {
  primaire_kosten: number;
  verpakkingskosten: number;
  vaste_kosten: number;
  accijns: number;
  kostprijs: number;
};

export type CostpriceCalculationStatus =
  | "ok"
  | "blocking";

export type CostpriceCalculationIssue = {
  code: string;
  message: string;
};

export type CostpriceCalculationTraceStep = {
  code: string;
  label: string;
  value?: number;
  source?: string;
};

export type CostpriceCalculationResult = CostpriceParts & {
  status: CostpriceCalculationStatus;
  issues: CostpriceCalculationIssue[];
  trace: CostpriceCalculationTraceStep[];
};

export type CostpriceComponentIssue = {
  code: string;
  message: string;
  component_sku_id?: string;
  component_article_id?: string;
};

export type CostpriceComponentLine = CostpriceParts & {
  label: string;
  quantity: number;
  component_sku_id?: string;
  component_article_id?: string;
  valid: boolean;
  issues: CostpriceComponentIssue[];
};

export type CostpriceComponentResult = CostpriceParts & {
  valid: boolean;
  issues: CostpriceComponentIssue[];
  component_count: number;
  components: CostpriceComponentLine[];
};

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createCostpriceParts(args: {
  primaire_kosten: number;
  verpakkingskosten: number;
  vaste_kosten: number;
  accijns: number;
}): CostpriceParts {
  const parts = {
    primaire_kosten: num(args.primaire_kosten),
    verpakkingskosten: num(args.verpakkingskosten),
    vaste_kosten: num(args.vaste_kosten),
    accijns: num(args.accijns),
    kostprijs: 0,
  };
  parts.kostprijs = parts.primaire_kosten + parts.verpakkingskosten + parts.vaste_kosten + parts.accijns;
  return parts;
}

function resultFromParts(
  parts: CostpriceParts,
  trace: CostpriceCalculationTraceStep[],
  issues: CostpriceCalculationIssue[] = [],
): CostpriceCalculationResult {
  return {
    ...parts,
    status: issues.length > 0 ? "blocking" : "ok",
    issues,
    trace,
  };
}

export function calculateDirectSkuCostprice(params: {
  primaryCost: number;
  packagingCost: number;
  overheadCost: number;
  exciseCost: number;
  liters: number;
  sourceLabel: string;
}): CostpriceCalculationResult {
  const issues: CostpriceCalculationIssue[] = [];
  const liters = num(params.liters);
  if (liters <= 0) {
    issues.push({ code: "missing_liters", message: "Geen liters per eenheid." });
  }
  const parts = createCostpriceParts({
    primaire_kosten: num(params.primaryCost),
    verpakkingskosten: num(params.packagingCost),
    vaste_kosten: num(params.overheadCost),
    accijns: num(params.exciseCost),
  });
  return resultFromParts(parts, [
    { code: "primary", label: "Inkoop/ingredienten", value: parts.primaire_kosten, source: params.sourceLabel },
    { code: "packaging", label: "Verpakking", value: parts.verpakkingskosten, source: params.sourceLabel },
    { code: "abc", label: "ABC/overhead", value: parts.vaste_kosten, source: params.sourceLabel },
    { code: "excise", label: "Accijns", value: parts.accijns, source: params.sourceLabel },
  ], issues);
}

export function calculateDerivedChildCostprice(params: {
  parent: CostpriceParts;
  factor: number;
  extraPackagingCost: number;
  parentLabel: string;
}): CostpriceCalculationResult {
  const factor = num(params.factor);
  const issues: CostpriceCalculationIssue[] = [];
  if (!Number.isFinite(factor) || factor <= 1) {
    issues.push({ code: "invalid_parent_factor", message: "Afgeleide SKU heeft geen geldige parent-factor." });
  }
  const divisor = issues.length > 0 ? 1 : factor;
  const parts = createCostpriceParts({
    primaire_kosten: num(params.parent.primaire_kosten) / divisor,
    verpakkingskosten: num(params.parent.verpakkingskosten) / divisor + num(params.extraPackagingCost),
    vaste_kosten: num(params.parent.vaste_kosten) / divisor,
    accijns: num(params.parent.accijns) / divisor,
  });
  return resultFromParts(parts, [
    { code: "parent_primary", label: "Parent inkoop/ingredienten gedeeld", value: parts.primaire_kosten, source: params.parentLabel },
    { code: "parent_packaging", label: "Parent verpakking gedeeld + eigen verpakking", value: parts.verpakkingskosten, source: params.parentLabel },
    { code: "parent_abc", label: "Parent ABC gedeeld", value: parts.vaste_kosten, source: params.parentLabel },
    { code: "parent_excise", label: "Parent accijns gedeeld", value: parts.accijns, source: params.parentLabel },
  ], issues);
}

function firstNumber(source: GenericRecord, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return num(value);
  }
  return 0;
}

export function costpriceOverheadValue(row: unknown) {
  const source = row && typeof row === "object" ? (row as GenericRecord) : {};
  const explicit = source.vaste_kosten ?? source.vasteKosten ?? source.overhead ?? source.abc;
  if (explicit !== undefined && explicit !== null && explicit !== "") return num(explicit);
  return (
    num(source.manufacturing_overhead ?? source.manufacturingOverhead) +
    num(source.business_overhead ?? source.businessOverhead)
  );
}

export function costpricePartsFromSummaryRow(row: unknown): CostpriceParts | null {
  if (!row || typeof row !== "object") return null;
  const source = row as GenericRecord;
  const primaireKosten = firstNumber(source, [
    "primaire_kosten",
    "primaireKosten",
    "inkoop_ingrediënten",
    "inkoopIngredienten",
    "inkoop",
    "primary_cost",
    "primaryCost",
  ]);
  const packagingCosts = firstNumber(source, [
    "verpakkingskosten",
    "verpakkingsKosten",
    "packaging_cost",
    "packagingCost",
  ]);
  const overheadCosts = costpriceOverheadValue(source);
  const excise = firstNumber(source, ["accijns", "excise", "excise_cost", "exciseCost"]);
  return {
    primaire_kosten: primaireKosten,
    verpakkingskosten: packagingCosts,
    vaste_kosten: overheadCosts,
    accijns: excise,
    kostprijs: primaireKosten + packagingCosts + overheadCosts + excise,
  };
}

export function addCostpriceParts(total: CostpriceParts, parts: CostpriceParts, qty: number) {
  total.primaire_kosten += parts.primaire_kosten * qty;
  total.verpakkingskosten += parts.verpakkingskosten * qty;
  total.vaste_kosten += parts.vaste_kosten * qty;
  total.accijns += parts.accijns * qty;
  total.kostprijs += parts.kostprijs * qty;
}

function hasMeaningfulParts(parts: CostpriceParts | null) {
  if (!parts) return false;
  return (
    Math.abs(parts.primaire_kosten) > 0.000001 ||
    Math.abs(parts.verpakkingskosten) > 0.000001 ||
    Math.abs(parts.vaste_kosten) > 0.000001 ||
    Math.abs(parts.accijns) > 0.000001 ||
    Math.abs(parts.kostprijs) > 0.000001
  );
}

export function buildCostpriceSummaryByProductId(rows: unknown[]) {
  const out = new Map<string, GenericRecord>();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const source = row && typeof row === "object" ? (row as GenericRecord) : {};
    [
      source.product_id,
      source.productId,
      source.article_id,
      source.articleId,
      source.format_article_id,
      source.formatArticleId,
    ].forEach((rawId) => {
      const productId = String(rawId ?? "").trim();
      if (productId) out.set(productId, source);
    });
  });
  return out;
}

export function buildCostpriceSummaryBySkuId(rows: unknown[]) {
  const out = new Map<string, GenericRecord>();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const source = row && typeof row === "object" ? (row as GenericRecord) : {};
    [source.sku_id, source.skuId, source.id].forEach((rawId) => {
      const skuId = String(rawId ?? "").trim();
      if (skuId) out.set(skuId, source);
    });
  });
  return out;
}

export function buildSkusByArticleId(skus: unknown[]) {
  const out = new Map<string, GenericRecord[]>();
  (Array.isArray(skus) ? skus : []).forEach((sku) => {
    const source = sku && typeof sku === "object" ? (sku as GenericRecord) : {};
    const skuId = String(source.id ?? "").trim();
    if (!skuId) return;
    [source.article_id, source.format_article_id].forEach((rawId) => {
      const articleId = String(rawId ?? "").trim();
      if (!articleId) return;
      out.set(articleId, [...(out.get(articleId) ?? []), source]);
    });
  });
  return out;
}

export function buildPackagingPriceByComponent(packagingComponentPrices: unknown[], year: number) {
  const out = new Map<string, number>();
  (Array.isArray(packagingComponentPrices) ? packagingComponentPrices : []).forEach((row) => {
    const source = row && typeof row === "object" ? (row as GenericRecord) : {};
    const componentId = String(source.verpakkingsonderdeel_id ?? source.packaging_component_id ?? "").trim();
    const rowYear = num(source.jaar);
    if (!componentId || rowYear !== year) return;
    out.set(componentId, num(source.prijs_per_stuk));
  });
  return out;
}

export function calculateComponentCostprice(params: {
  parentArticleId: string;
  bomLines: unknown[];
  skus: unknown[];
  articles: unknown[];
  summaryRows: unknown[];
  packagingComponentPrices: unknown[];
  year: number;
}): CostpriceComponentResult {
  const bomLines = Array.isArray(params.bomLines) ? params.bomLines : [];
  const skuById = new Map<string, GenericRecord>();
  (Array.isArray(params.skus) ? params.skus : []).forEach((sku) => {
    const source = sku && typeof sku === "object" ? (sku as GenericRecord) : {};
    const id = String(source.id ?? "").trim();
    if (id) skuById.set(id, source);
  });
  const skusByArticleId = buildSkusByArticleId(params.skus);
  const articleById = new Map<string, GenericRecord>();
  (Array.isArray(params.articles) ? params.articles : []).forEach((article) => {
    const source = article && typeof article === "object" ? (article as GenericRecord) : {};
    const id = String(source.id ?? "").trim();
    if (id) articleById.set(id, source);
  });
  const summaryByProductId = buildCostpriceSummaryByProductId(params.summaryRows);
  const summaryBySkuId = buildCostpriceSummaryBySkuId(params.summaryRows);
  const packagingPriceByComponent = buildPackagingPriceByComponent(params.packagingComponentPrices, params.year);
  const linesByParent = new Map<string, GenericRecord[]>();
  bomLines.forEach((line) => {
    const source = line && typeof line === "object" ? (line as GenericRecord) : {};
    const parentId = String(source.parent_article_id ?? "").trim();
    if (!parentId) return;
    const current = linesByParent.get(parentId) ?? [];
    current.push(source);
    linesByParent.set(parentId, current);
  });

  function skuProductId(sku: GenericRecord | undefined) {
    const formatArticleId = String(sku?.format_article_id ?? "").trim();
    if (formatArticleId) return formatArticleId;
    return String(sku?.article_id ?? "").trim();
  }

  function isArticleSku(sku: GenericRecord | undefined) {
    return String(sku?.kind ?? "").trim().toLowerCase() === "article";
  }

  function summaryRowForSku(skuId: string, sku: GenericRecord | undefined): GenericRecord | undefined {
    if (skuId && summaryBySkuId.has(skuId)) return summaryBySkuId.get(skuId);
    const productId = skuProductId(sku);
    if (productId && summaryByProductId.has(productId)) return summaryByProductId.get(productId);
    return undefined;
  }

  function isComposedSummaryRow(row: GenericRecord | undefined) {
    if (!row) return false;
    return (
      String(row.product_type ?? row.productType ?? "").trim() === "article" ||
      String(row.cost_origin ?? row.costOrigin ?? "").trim() === "composed_sellable"
    );
  }

  function resolveSummaryForSku(skuId: string, sku: GenericRecord | undefined): CostpriceParts | null {
    const parts = costpricePartsFromSummaryRow(summaryRowForSku(skuId, sku));
    return hasMeaningfulParts(parts) ? parts : null;
  }

  function walk(articleId: string, visited: Set<string>): CostpriceComponentResult {
    const cleanArticleId = String(articleId ?? "").trim();
    const result: CostpriceComponentResult = {
      primaire_kosten: 0,
      verpakkingskosten: 0,
      vaste_kosten: 0,
      accijns: 0,
      kostprijs: 0,
      valid: true,
      issues: [],
      component_count: 0,
      components: [],
    };
    if (!cleanArticleId) {
      result.valid = false;
      result.issues.push({ code: "missing_parent_article", message: "Parent article ontbreekt." });
      return result;
    }
    if (visited.has(cleanArticleId)) {
      result.valid = false;
      result.issues.push({ code: "component_cycle", message: `Samenstelling bevat een cyclus bij ${cleanArticleId}.`, component_article_id: cleanArticleId });
      return result;
    }
    const lines = linesByParent.get(cleanArticleId) ?? [];
    if (lines.length === 0) {
      result.valid = false;
      result.issues.push({ code: "missing_bom", message: `Geen componentregels gevonden voor ${cleanArticleId}.`, component_article_id: cleanArticleId });
      return result;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(cleanArticleId);

    for (const line of lines) {
      const qty = Math.max(0, num(line.qty ?? line.quantity ?? line.aantal));
      if (qty <= 0) {
        result.valid = false;
        result.issues.push({ code: "invalid_quantity", message: "Component heeft geen geldig aantal.", component_article_id: String(line.component_article_id ?? "").trim() });
        continue;
      }

      const componentSkuId = String(line.component_sku_id ?? "").trim();
      const componentArticleId = String(line.component_article_id ?? "").trim();
      const componentSku = componentSkuId ? skuById.get(componentSkuId) : undefined;
      const componentSkuArticleId = skuProductId(componentSku);
      const componentSkuSummary = summaryRowForSku(componentSkuId, componentSku);
      const componentSkuParts = resolveSummaryForSku(componentSkuId, componentSku);
      if (componentSkuParts) {
        addCostpriceParts(result, componentSkuParts, qty);
        result.components.push({
          label:
            String(componentSku?.name ?? "").trim() ||
            String(componentSku?.sku_name ?? "").trim() ||
            componentSkuId ||
            componentArticleId,
          quantity: qty,
          component_sku_id: componentSkuId || String(componentSku?.id ?? "").trim() || undefined,
          component_article_id: componentArticleId || undefined,
          primaire_kosten: componentSkuParts.primaire_kosten * qty,
          verpakkingskosten: componentSkuParts.verpakkingskosten * qty,
          vaste_kosten: componentSkuParts.vaste_kosten * qty,
          accijns: componentSkuParts.accijns * qty,
          kostprijs: componentSkuParts.kostprijs * qty,
          valid: true,
          issues: [],
        });
        result.component_count += 1;
        continue;
      }
      if (
        componentSkuArticleId &&
        linesByParent.has(componentSkuArticleId) &&
        (isComposedSummaryRow(componentSkuSummary) || isArticleSku(componentSku))
      ) {
        const nested = walk(componentSkuArticleId, nextVisited);
        result.valid = result.valid && nested.valid;
        result.issues.push(...nested.issues);
        addCostpriceParts(result, nested, qty);
        result.components.push({
          label:
            String(componentSku?.name ?? "").trim() ||
            String(componentSku?.sku_name ?? "").trim() ||
            componentSkuId ||
            componentSkuArticleId,
          quantity: qty,
          component_sku_id: componentSkuId || undefined,
          component_article_id: componentSkuArticleId,
          primaire_kosten: nested.primaire_kosten * qty,
          verpakkingskosten: nested.verpakkingskosten * qty,
          vaste_kosten: nested.vaste_kosten * qty,
          accijns: nested.accijns * qty,
          kostprijs: nested.kostprijs * qty,
          valid: nested.valid,
          issues: nested.issues,
        });
        result.component_count += nested.component_count;
        continue;
      }

      if (!componentSkuId && componentArticleId) {
        const matchingSkus = (skusByArticleId.get(componentArticleId) ?? []).filter((sku) => {
          const id = String(sku?.id ?? "").trim();
          return Boolean(id && summaryBySkuId.has(id));
        });
        if (matchingSkus.length === 1) {
          const matchedSku = matchingSkus[0];
          const matchedSkuId = String(matchedSku?.id ?? "").trim();
          const matchedProductId = skuProductId(matchedSku);
          const matchedSummary = summaryRowForSku(matchedSkuId, matchedSku);
          const matchedParts = resolveSummaryForSku(matchedSkuId, matchedSku);
          if (matchedParts) {
            addCostpriceParts(result, matchedParts, qty);
            result.components.push({
              label:
                String(matchedSku?.name ?? "").trim() ||
                String(matchedSku?.sku_name ?? "").trim() ||
                matchedSkuId ||
                componentArticleId,
              quantity: qty,
              component_sku_id: matchedSkuId || undefined,
              component_article_id: componentArticleId || undefined,
              primaire_kosten: matchedParts.primaire_kosten * qty,
              verpakkingskosten: matchedParts.verpakkingskosten * qty,
              vaste_kosten: matchedParts.vaste_kosten * qty,
              accijns: matchedParts.accijns * qty,
              kostprijs: matchedParts.kostprijs * qty,
              valid: true,
              issues: [],
            });
            result.component_count += 1;
            continue;
          }
          if (
            matchedProductId &&
            linesByParent.has(matchedProductId) &&
            (isComposedSummaryRow(matchedSummary) || isArticleSku(matchedSku))
          ) {
            const nested = walk(matchedProductId, nextVisited);
            result.valid = result.valid && nested.valid;
            result.issues.push(...nested.issues);
            addCostpriceParts(result, nested, qty);
            result.components.push({
              label:
                String(matchedSku?.name ?? "").trim() ||
                String(matchedSku?.sku_name ?? "").trim() ||
                matchedSkuId ||
                componentArticleId,
              quantity: qty,
              component_sku_id: matchedSkuId || undefined,
              component_article_id: matchedProductId,
              primaire_kosten: nested.primaire_kosten * qty,
              verpakkingskosten: nested.verpakkingskosten * qty,
              vaste_kosten: nested.vaste_kosten * qty,
              accijns: nested.accijns * qty,
              kostprijs: nested.kostprijs * qty,
              valid: nested.valid,
              issues: nested.issues,
            });
            result.component_count += nested.component_count;
            continue;
          }
        }
        if (matchingSkus.length > 1) {
          result.valid = false;
          const issue = {
            code: "ambiguous_component_article",
            message: "Component verwijst naar een artikel/afvuleenheid met meerdere mogelijke SKU's. Kies een expliciete component-SKU.",
            component_article_id: componentArticleId,
          };
          result.issues.push(issue);
          result.components.push({
            label: componentArticleId,
            quantity: qty,
            component_article_id: componentArticleId,
            primaire_kosten: 0,
            verpakkingskosten: 0,
            vaste_kosten: 0,
            accijns: 0,
            kostprijs: 0,
            valid: false,
            issues: [issue],
          });
          continue;
        }
      }

      if (componentArticleId) {
        const componentArticle = articleById.get(componentArticleId);
        const directPackagingPrice =
          packagingPriceByComponent.get(componentArticleId) ??
          num(componentArticle?.prijs_per_stuk ?? componentArticle?.manual_rate_ex ?? componentArticle?.kostprijs);
        const hasNestedBom = linesByParent.has(componentArticleId);
        const articleKind = String(componentArticle?.kind ?? "").toLowerCase();
        if (directPackagingPrice > 0 && (articleKind === "packaging_component" || !hasNestedBom)) {
          result.verpakkingskosten += directPackagingPrice * qty;
          result.kostprijs += directPackagingPrice * qty;
          result.components.push({
            label:
              String(componentArticle?.name ?? componentArticle?.naam ?? "").trim() ||
              componentArticleId,
            quantity: qty,
            component_article_id: componentArticleId,
            primaire_kosten: 0,
            verpakkingskosten: directPackagingPrice * qty,
            vaste_kosten: 0,
            accijns: 0,
            kostprijs: directPackagingPrice * qty,
            valid: true,
            issues: [],
          });
          result.component_count += 1;
          continue;
        }
        if (hasNestedBom) {
          const nested = walk(componentArticleId, nextVisited);
          result.valid = result.valid && nested.valid;
          result.issues.push(...nested.issues);
          addCostpriceParts(result, nested, qty);
          result.components.push({
            label:
              String(componentArticle?.name ?? componentArticle?.naam ?? "").trim() ||
              componentArticleId,
            quantity: qty,
            component_article_id: componentArticleId,
            primaire_kosten: nested.primaire_kosten * qty,
            verpakkingskosten: nested.verpakkingskosten * qty,
            vaste_kosten: nested.vaste_kosten * qty,
            accijns: nested.accijns * qty,
            kostprijs: nested.kostprijs * qty,
            valid: nested.valid,
            issues: nested.issues,
          });
          result.component_count += nested.component_count;
          continue;
        }
      }

      result.valid = false;
      const issue = {
        code: "component_cost_missing",
        message: "Component heeft geen kostprijsbron.",
        component_sku_id: componentSkuId || undefined,
        component_article_id: componentArticleId || undefined,
      };
      result.issues.push(issue);
      result.components.push({
        label: componentSkuId || componentArticleId || "Onbekend onderdeel",
        quantity: qty,
        component_sku_id: componentSkuId || undefined,
        component_article_id: componentArticleId || undefined,
        primaire_kosten: 0,
        verpakkingskosten: 0,
        vaste_kosten: 0,
        accijns: 0,
        kostprijs: 0,
        valid: false,
        issues: [issue],
      });
    }

    return result;
  }

  return walk(params.parentArticleId, new Set());
}
