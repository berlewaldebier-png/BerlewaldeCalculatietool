import { formatMoneyEUR, formatPercent0to2 } from "@/lib/formatters";

type GenericRecord = Record<string, unknown>;

export function formatEuro(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return formatMoneyEUR(value);
}

export function formatPct(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  // Keep one-decimal formatting stable by rounding first; output still follows shared formatters.
  return formatPercent0to2(Math.round(value * 10) / 10);
}

export function getSnapshotPackagingLabel(row: GenericRecord) {
  return String((row as any)?.verpakking ?? (row as any)?.verpakkingseenheid ?? (row as any)?.omschrijving ?? "");
}

export function getSnapshotProductCost(row: GenericRecord) {
  const explicit = Number((row as any)?.kostprijs ?? Number.NaN);
  if (Number.isFinite(explicit)) {
    return explicit;
  }
  const primaire = Number((row as any)?.primaire_kosten ?? (row as any)?.variabele_kosten ?? 0);
  const verpakking = Number((row as any)?.verpakkingskosten ?? 0);
  const vaste = Number((row as any)?.vaste_kosten ?? (row as any)?.vaste_directe_kosten ?? 0);
  const accijns = Number((row as any)?.accijns ?? 0);
  return primaire + verpakking + vaste + accijns;
}

export function buildVersionLabel(version: GenericRecord | undefined) {
  if (!version) {
    return "Onbekende kostprijsversie";
  }
  const versieNummer = Number((version as any)?.versie_nummer ?? 0) || 0;
  const type = String((version as any)?.type ?? "");
  const brontype = String((version as any)?.brontype ?? "");
  const status = String((version as any)?.status ?? "");
  const invoer = ((version as any)?.invoer ?? {}) as any;
  const factuur = (invoer?.inkoop ?? {}) as any;
  const factuurRef = factuur?.factuurnummer
    ? `${String(factuur.factuurnummer)} ${String(factuur.factuurdatum ?? "")}`.trim()
    : "";
  const bron = brontype === "factuur" && factuurRef ? `factuur ${factuurRef}` : brontype || "-";
  const statusLabel = status ? status.toLowerCase() : "";
  const parts = [`v${versieNummer || 0}`, type || "-", bron].filter(Boolean);
  if (statusLabel && statusLabel !== "definitief") {
    parts.push(statusLabel);
  }
  return parts.join(" - ");
}

export function buildCostSourceLabel(version: GenericRecord | undefined) {
  const source = String((version as any)?.cost_source ?? "").trim();
  if (source === "purchase_invoice") return "Inkoopfactuur";
  if (source === "brew_moment") return "Brouwmoment";
  if (source === "recipe_recalculation") return "Recept/hercalculatie";
  if (source === "initial_calculation") return "Initiële kostprijs";
  const type = String((version as any)?.type ?? "").trim().toLowerCase();
  if (type === "inkoop") return "Inkoopfactuur";
  if (type === "hercalculatie") return "Recept/hercalculatie";
  return source || "-";
}

export function buildSupplierLabel(version: GenericRecord | undefined) {
  const supplierName = String(
    (version as any)?.supplier_name ??
      ((version as any)?.supplier && typeof (version as any).supplier === "object" ? (version as any).supplier.name : "") ??
      (version as any)?.leverancier ??
      ""
  ).trim();
  return supplierName || "-";
}

export function parseSortTimestamp(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
