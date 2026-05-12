export type GenericRecord = Record<string, unknown>;

export type ChannelRow = {
  id: string;
  code: string;
  naam: string;
  actief: boolean;
  volgorde: number;
  default_marge_pct: number;
};

export type StrategyRow = {
  id: string;
  record_type: string;
  jaar: number;
  sku_id?: string;
  bier_id: string;
  biernaam: string;
  product_id: string;
  product_type: "basis" | "samengesteld" | "";
  verpakking: string;
  strategie_type: string;
  kostprijs: number;
  sell_in_margins: Record<string, number>;
  sell_in_prices: Record<string, number | "">;
  _uiId: string;
};

export const STRATEGY_RECORD_TYPES = new Set([
  "jaarstrategie",
  "verkoopstrategie_product",
  "verkoopstrategie_verpakking",
]);

export const DEFAULT_CHANNELS: ChannelRow[] = [
  { id: "horeca", code: "horeca", naam: "Horeca", actief: true, volgorde: 10, default_marge_pct: 50 },
  { id: "retail", code: "retail", naam: "Supermarkt", actief: true, volgorde: 20, default_marge_pct: 30 },
  { id: "slijterij", code: "slijterij", naam: "Slijterij", actief: true, volgorde: 30, default_marge_pct: 40 },
  { id: "zakelijk", code: "zakelijk", naam: "Speciaalzaak", actief: true, volgorde: 40, default_marge_pct: 45 },
  { id: "particulier", code: "particulier", naam: "Particulier", actief: false, volgorde: 50, default_marge_pct: 50 },
];

export const createUiId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const normalizeLabel = (value: unknown) => String(value ?? "").trim().toLowerCase();

export function computeDraftSignature(records: GenericRecord[], channelCodes: string[]) {
  const mapToSortedPairs = (raw: unknown) => {
    const src = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    return channelCodes
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .flatMap((code) => {
        const value = src[code];
        if (value === "" || value === null || value === undefined) return [];
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return [];
        return [[code, parsed] as const];
      });
  };

  const normalized = (Array.isArray(records) ? records : [])
    .map((row) => ({
      id: String(row.id ?? ""),
      record_type: String(row.record_type ?? ""),
      jaar: Number(row.jaar ?? 0),
      sku_id: String((row as any).sku_id ?? ""),
      bier_id: String((row as any).bier_id ?? ""),
      product_id: String((row as any).product_id ?? ""),
      sell_in_margins: mapToSortedPairs((row as any).sell_in_margins ?? (row as any).kanaalmarges ?? {}),
      sell_in_prices: mapToSortedPairs((row as any).sell_in_prices ?? (row as any).kanaalprijzen ?? {}),
    }))
    .sort((a, b) => {
      const rt = a.record_type.localeCompare(b.record_type);
      if (rt !== 0) return rt;
      const y = a.jaar - b.jaar;
      if (y !== 0) return y;
      const bi = a.bier_id.localeCompare(b.bier_id);
      if (bi !== 0) return bi;
      const pi = a.product_id.localeCompare(b.product_id);
      if (pi !== 0) return pi;
      return a.id.localeCompare(b.id);
    });

  return JSON.stringify(normalized);
}

export function normalizeChannels(raw: GenericRecord[]) {
  const source = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_CHANNELS;
  const byCode = new Map(DEFAULT_CHANNELS.map((row) => [row.code, row]));
  source.forEach((row) => {
    const code = String(row.code ?? row.id ?? "").trim().toLowerCase();
    if (!code) return;
    byCode.set(code, {
      id: String(row.id ?? row.code ?? createUiId()),
      code,
      naam: String(row.naam ?? ("label" in row ? row.label : undefined) ?? row.code ?? "").trim(),
      actief: Boolean(row.actief ?? true),
      volgorde: Number(row.volgorde ?? 999),
      default_marge_pct: Number(row.default_marge_pct ?? byCode.get(code)?.default_marge_pct ?? 50),
    });
  });
  return [...byCode.values()]
    .map((row) => ({
      id: String(row.id ?? row.code ?? createUiId()),
      code: String(row.code ?? row.id ?? "").trim().toLowerCase(),
      naam: String(row.naam ?? ("label" in row ? row.label : undefined) ?? row.code ?? "").trim(),
      actief: Boolean(row.actief ?? true),
      volgorde: Number(row.volgorde ?? 999),
      default_marge_pct: Number(row.default_marge_pct ?? 50),
    }))
    .filter((row) => row.code && row.naam && row.code !== "groothandel")
    .sort((a, b) => (a.volgorde === b.volgorde ? a.naam.localeCompare(b.naam, "nl-NL") : a.volgorde - b.volgorde));
}

export function buildEmptyYearStrategyRow({
  year,
  channelDefaults,
}: {
  year: number;
  channelDefaults: Record<string, { opslag: number }>;
}): StrategyRow {
  // This is a year-specific defaults record. It becomes the single source of truth for default margins/factors per year.
  return {
    id: "",
    record_type: "jaarstrategie",
    jaar: year,
    bier_id: "",
    biernaam: "",
    product_id: "",
    product_type: "",
    verpakking: "",
    strategie_type: "default",
    kostprijs: 0,
    // NOTE: despite the legacy field name `sell_in_margins`, we now persist opslag% as the source of truth.
    sell_in_margins: Object.fromEntries(
      Object.entries(channelDefaults).map(([code, def]) => [code, Number(def.opslag ?? 50)]),
    ),
    sell_in_prices: {},
    _uiId: createUiId(),
  };
}

export function normalizeStrategyRow(row: GenericRecord, channelCodes: string[]): StrategyRow {
  const marginsSrcRaw = (row.sell_in_margins ?? row.kanaalmarges ?? {}) as unknown;
  const marginsSrc =
    typeof marginsSrcRaw === "object" && marginsSrcRaw !== null
      ? (marginsSrcRaw as Record<string, unknown>)
      : {};
  const pricesSrcRaw = (row.sell_in_prices ?? row.kanaalprijzen ?? {}) as unknown;
  const pricesSrc =
    typeof pricesSrcRaw === "object" && pricesSrcRaw !== null
      ? (pricesSrcRaw as Record<string, unknown>)
      : {};
  return {
    id: String(row.id ?? ""),
    record_type: String(row.record_type ?? "verkoopstrategie_verpakking"),
    jaar: Number(row.jaar ?? new Date().getFullYear()),
    bier_id: String((row as any).bier_id ?? ""),
    biernaam: String((row as any).biernaam ?? ""),
    product_id: String((row as any).product_id ?? ""),
    product_type:
      String((row as any).product_type ?? "") === "basis" || String((row as any).product_type ?? "") === "samengesteld"
        ? (String((row as any).product_type ?? "") as "basis" | "samengesteld")
        : "",
    verpakking: String((row as any).verpakking ?? ""),
    strategie_type: String((row as any).strategie_type ?? "default"),
    kostprijs: Number((row as any).kostprijs ?? 0),
    sell_in_margins: (() => {
      const allowed = new Set(channelCodes);
      const out: Record<string, number> = {};
      Object.entries(marginsSrc).forEach(([key, value]) => {
        if (!allowed.has(key)) return;
        const parsed = Number(value);
        out[key] = Number.isFinite(parsed) ? parsed : 0;
      });
      channelCodes.forEach((code) => {
        if (!(code in out)) out[code] = 0;
      });
      return out;
    })(),
    sell_in_prices: (() => {
      const allowed = new Set(channelCodes);
      const out: Record<string, number | ""> = {};
      Object.entries(pricesSrc).forEach(([key, value]) => {
        if (!allowed.has(key)) return;
        if (value === "" || value === null || value === undefined) return;
        const parsed = Number(value);
        out[key] = Number.isFinite(parsed) ? parsed : "";
      });
      channelCodes.forEach((code) => {
        if (!(code in out)) out[code] = "";
      });
      return out;
    })(),
    _uiId: createUiId(),
  };
}

