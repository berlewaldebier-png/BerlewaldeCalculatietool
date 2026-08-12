export const money = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});


export function methodLabel(value: string) {
  const labels: Record<string, string> = {
    purchase: "Inkoop",
    inkoop: "Inkoop",
    production: "Eigen productie",
    productie: "Eigen productie",
    "eigen productie": "Eigen productie",
    derived: "Afgeleid",
    composed: "Zelf samengesteld",
    year_transition: "Jaarovergang",
    bundle: "Zelf samengesteld",
    article: "Artikelkostprijs",
  };
  return labels[value] || value || "Onbekend";
}


export function provenanceLabel(kind: string, sourceYear: number) {
  const year = sourceYear > 0 ? ` uit ${sourceYear}` : "";
  const labels: Record<string, string> = {
    source_anchor: `Actieve planningskostprijs${year}`,
    recalculated_from_source_year: `Overgenomen en herberekend${year}`,
    recovered_from_exact_target_anchor: "Hersteld uit exact vastgelegd doeljaaranker",
    target_operational_addition: "Toegevoegd in het actieve jaar",
    catalog_reference: "Alleen catalogusreferentie",
  };
  return labels[kind] || kind || "Herkomst onbekend";
}


export function costSourceLabel(value: string) {
  const labels: Record<string, string> = {
    initial_calculation: "Initiële berekening",
    purchase_invoice: "Inkoopfactuur",
    brew_moment: "Brouwmoment",
    recipe_recalculation: "Recept-herberekening",
    historical_sku_cost: "Historische SKU-kostprijs",
    opening_stock: "Openingsvoorraad",
  };
  return labels[value] || value || "Bron onbekend";
}


export function formatDate(value: string) {
  if (!value) return "Datum onbekend";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed);
}
