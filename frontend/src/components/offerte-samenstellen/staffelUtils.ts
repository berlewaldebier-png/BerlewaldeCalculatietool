import type {
  ProductOption,
  StaffelDiscountMode,
  StaffelRowInput,
} from "@/components/offerte-samenstellen/types";

type StaffelValidationResult = {
  fieldErrors: Record<number, string>;
  formError: string;
};

type StaffelRowMetrics = {
  priceLabel: string;
  revenueLabel: string;
  costLabel: string;
  standardMarginLabel: string;
  newMarginLabel: string;
  customerAdvantageLabel: string;
  marginImpactLabel: string;
};

export function parseStaffelNumber(value: string) {
  if (!value.trim()) return null;

  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatStaffelInput(value: number) {
  return value.toFixed(2).replace(".", ",");
}

export function formatStaffelMoney(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function buildSelectableProducts(products: ProductOption[]) {
  return products.map((product) => ({
    id: product.optionId,
    label: product.label,
  }));
}

export function getStaffelCompatibilityInfo(products: ProductOption[], refs: string[]) {
  const selectedProducts = resolveSelectedProducts(products, refs);
  if (selectedProducts.length === 0) {
    return {
      compatibilityKey: null,
      compatibilityLabel: "",
      hasMixedCompatibility: false,
    };
  }

  const firstKey = selectedProducts[0]?.staffelCompatibilityKey ?? null;
  const firstLabel = selectedProducts[0]?.staffelCompatibilityLabel ?? "";
  const hasMixedCompatibility = selectedProducts.some(
    (product) => product.staffelCompatibilityKey !== firstKey
  );

  return {
    compatibilityKey: hasMixedCompatibility ? null : firstKey,
    compatibilityLabel: firstLabel,
    hasMixedCompatibility,
  };
}

export function filterProductsForStaffel(
  products: ProductOption[],
  refs: string[],
  compatibilityKey: string | null
) {
  return products.filter((product) => {
    if (refs.includes(product.optionId)) return true;
    if (!compatibilityKey) return true;
    return product.staffelCompatibilityKey === compatibilityKey;
  });
}

export function resolveSelectedProducts(products: ProductOption[], refs: string[]) {
  return products.filter((product) => refs.includes(product.optionId));
}

export function getSuggestedSharedPrice(products: ProductOption[]) {
  const prices = products
    .map((product) => product.standardPriceEx)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (prices.length === 0) return "";

  const average = prices.reduce((sum, value) => sum + value, 0) / prices.length;
  return formatStaffelInput(average);
}

function nextDerivedPrice(
  previousPrice: string,
  mode: StaffelDiscountMode,
  discountValue: string
) {
  if (mode === "free") return "";

  const previous = parseStaffelNumber(previousPrice);
  const step = parseStaffelNumber(discountValue);
  if (previous === null || step === null) return "";

  const next =
    mode === "percent" ? previous * (1 - step / 100) : previous - step;

  return formatStaffelInput(Math.max(0, next));
}

export function syncStaffelRows(
  inputRows: StaffelRowInput[],
  mode: StaffelDiscountMode,
  discountValue: string
) {
  const rows = inputRows.map((row) => ({
    from: String(row.from ?? ""),
    to: String(row.to ?? ""),
    price: String(row.price ?? ""),
  }));

  if (rows.length === 0) {
    rows.push({ from: "1", to: "", price: "" });
  }

  rows[0] = { ...rows[0], from: "1" };

  for (let index = 0; index < rows.length; index += 1) {
    const current = rows[index];
    const to = Number.parseInt(current.to, 10);

    if (!Number.isNaN(to)) {
      const nextFrom = String(to + 1);
      const hasNext = index < rows.length - 1;

      if (hasNext) {
        rows[index + 1] = { ...rows[index + 1], from: nextFrom };
      } else {
        rows.push({
          from: nextFrom,
          to: "",
          price: nextDerivedPrice(current.price, mode, discountValue),
        });
      }
      continue;
    }

    rows.splice(index + 1);
    break;
  }

  if (mode !== "free") {
    for (let index = 1; index < rows.length; index += 1) {
      rows[index] = {
        ...rows[index],
        price: nextDerivedPrice(rows[index - 1]?.price ?? "", mode, discountValue),
      };
    }
  }

  return rows;
}

export function validateStaffelRows(
  rows: StaffelRowInput[],
  options?: { requirePrice?: boolean }
): StaffelValidationResult {
  const requirePrice = options?.requirePrice ?? true;
  if (rows.length === 0) {
    return {
      fieldErrors: {},
      formError: "Voeg minstens een staffelregel toe.",
    };
  }

  const fieldErrors: Record<number, string> = {};
  let expectedIntervalSize: number | null = null;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const from = Number.parseInt(row.from, 10);
    const toText = String(row.to ?? "").trim();
    const priceText = String(row.price ?? "").trim();

    if (requirePrice && !priceText) {
      return {
        fieldErrors,
        formError: "Vul voor iedere staffelregel een prijs in.",
      };
    }

    if (!toText) {
      continue;
    }

    const to = Number.parseInt(toText, 10);
    if (Number.isNaN(to)) {
      fieldErrors[index] = "Gebruik alleen hele aantallen.";
      continue;
    }

    if (Number.isNaN(from) || to < from) {
      fieldErrors[index] = "'Tot en met' moet gelijk aan of groter dan 'Van' zijn.";
      continue;
    }

    const intervalSize = to - from + 1;
    if (expectedIntervalSize === null) {
      expectedIntervalSize = intervalSize;
      continue;
    }

    if (intervalSize !== expectedIntervalSize) {
      fieldErrors[index] = "Deze regel volgt niet dezelfde staffelgrootte.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      fieldErrors,
      formError:
        "De staffelblokken moeten allemaal dezelfde intervalgrootte hebben.",
    };
  }

  return { fieldErrors: {}, formError: "" };
}

export function getDerivedStaffelPrice(
  product: ProductOption,
  rowIndex: number,
  row: StaffelRowInput,
  mode: StaffelDiscountMode,
  discountValue: string
) {
  if (mode === "free") {
    return parseStaffelNumber(row.price);
  }

  const step = parseStaffelNumber(discountValue);
  if (step === null) {
    return null;
  }

  if (mode === "percent") {
    return Math.max(0, product.standardPriceEx * Math.pow(1 - step / 100, rowIndex));
  }

  return Math.max(0, product.standardPriceEx - rowIndex * step);
}

export function calculateProductStaffelMetrics(
  product: ProductOption,
  row: StaffelRowInput,
  rowIndex: number,
  mode: StaffelDiscountMode,
  discountValue: string
): StaffelRowMetrics {
  const qtyCandidate = Number.parseInt(String(row.to || row.from), 10);
  const price = getDerivedStaffelPrice(product, rowIndex, row, mode, discountValue);

  if (Number.isNaN(qtyCandidate) || price === null) {
    return {
      priceLabel: "-",
      revenueLabel: "-",
      costLabel: "-",
      standardMarginLabel: "-",
      newMarginLabel: "-",
      customerAdvantageLabel: "-",
      marginImpactLabel: "-",
    };
  }

  const revenue = qtyCandidate * price;
  const costPricePerUnit = Math.max(0, product.costPriceEx);
  const standardMarginPerUnit = Math.max(0, product.standardPriceEx - costPricePerUnit);
  const newMarginPerUnit = Math.max(0, price - costPricePerUnit);
  const customerAdvantagePerUnit = Math.max(0, product.standardPriceEx - price);
  const marginImpactPerUnit = Math.max(0, standardMarginPerUnit - newMarginPerUnit);

  return {
    priceLabel: formatStaffelMoney(price),
    revenueLabel: formatStaffelMoney(revenue),
    costLabel: formatStaffelMoney(costPricePerUnit),
    standardMarginLabel: formatStaffelMoney(standardMarginPerUnit),
    newMarginLabel: formatStaffelMoney(newMarginPerUnit),
    customerAdvantageLabel: formatStaffelMoney(customerAdvantagePerUnit),
    marginImpactLabel: formatStaffelMoney(marginImpactPerUnit),
  };
}
