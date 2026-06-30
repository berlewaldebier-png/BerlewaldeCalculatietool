export type SearchResultType =
  | "invoice"
  | "order"
  | "customer"
  | "beer"
  | "product"
  | "recipe"
  | "report"
  | "setting"
  | "costprice"
  | "break-even";

export type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle?: string;
  meta?: string;
  href: string;
};

export type SearchGroup = {
  type: SearchResultType;
  label: string;
  count: number;
  items: SearchResult[];
  viewAllHref?: string;
};

export type FullSearchHit = SearchResult & {
  category: string;
  section?: string;
  snippet: string;
};

export type SearchResponse = {
  query: string;
  interpretedAs?: string;
  groups: SearchGroup[];
  fullResults?: FullSearchHit[];
};

const INTENT_MAP: Record<string, SearchResultType> = {
  factuur: "invoice",
  facturen: "invoice",
  invoice: "invoice",
  rekening: "invoice",
  order: "order",
  orders: "order",
  klant: "customer",
  klanten: "customer",
  customer: "customer",
  afnemer: "customer",
  bier: "beer",
  bieren: "beer",
  beer: "beer",
  product: "product",
  producten: "product",
  recept: "recipe",
  recepten: "recipe",
  marge: "report",
  margin: "report",
  omzet: "report",
  revenue: "report",
  kostprijs: "costprice",
  "cost price": "costprice",
  costprice: "costprice",
  "break-even": "break-even",
  breakeven: "break-even",
  kosten: "costprice",
  instellingen: "setting",
  setting: "setting",
  settings: "setting",
  support: "setting",
  account: "setting",
  accounts: "setting",
  profiel: "setting",
  username: "setting",
  user: "setting",
  gebruikers: "setting",
  api: "setting",
  beheer: "setting",
};

const GROUP_LABELS: Record<SearchResultType, string> = {
  invoice: "Facturen",
  order: "Orders",
  customer: "Klanten",
  beer: "Bieren",
  product: "Producten",
  recipe: "Recepten",
  report: "Rapportages",
  setting: "Instellingen",
  costprice: "Kostprijs",
  "break-even": "Break-even"
};

const GROUP_LINKS: Record<SearchResultType, string> = {
  invoice: "/inkoopfacturen",
  order: "/omzet-en-marge",
  customer: "/diensten",
  beer: "/bieren",
  product: "/producten-verpakking",
  recipe: "/recept-hercalculatie",
  report: "/omzet-en-marge",
  setting: "/instellingen",
  costprice: "/instellingen/kostprijsbeheer",
  "break-even": "/break-even"
};

const STRONG_TERMS: Record<SearchResultType, string[]> = {
  invoice: ["factuur", "facturen", "invoice", "rekening"],
  order: ["order", "orders"],
  customer: ["klant", "klanten", "customer", "afnemer"],
  beer: ["bier", "bieren", "beer"],
  product: ["product", "producten"],
  recipe: ["recept", "recepten", "recipe"],
  report: ["marge", "margin", "omzet", "revenue"],
  setting: [
    "instelling",
    "instellingen",
    "support",
    "helpcentrum",
    "help",
    "account",
    "accounts",
    "mijn account",
    "profiel",
    "username",
    "user",
    "gebruikers",
    "api",
    "beheer"
  ],
  costprice: ["kostprijs", "costprice", "cost price", "cost"],
  "break-even": ["break-even", "breakeven"],
};

type SearchIndexEntry = SearchResult & { keywords: string[] };

const SEARCH_INDEX: SearchIndexEntry[] = [
  {
    id: "setting-account",
    type: "setting",
    title: "Mijn account",
    subtitle: "Profiel, wachtwoord, 2FA",
    meta: "Accountinstellingen",
    href: "/account",
    keywords: ["account", "mijn account", "profiel", "wachtwoord", "2fa", "gebruikers", "username", "user"]
  },
  {
    id: "setting-company",
    type: "setting",
    title: "Bedrijfsinstellingen",
    subtitle: "Bedrijf, BTW, valuta",
    meta: "Instellingen",
    href: "/instellingen/bedrijf",
    keywords: ["bedrijfsinstellingen", "bedrijf", "btw", "valuta", "organisatie", "handelsnaam"]
  },
  {
    id: "setting-costprice",
    type: "costprice",
    title: "Kostprijsbeheer",
    subtitle: "Kosten, overhead, ABC-kosten",
    meta: "Instellingen",
    href: "/instellingen/kostprijsbeheer",
    keywords: ["kostprijs", "kosten", "overhead", "abc", "kostprijsberekening", "variabele kosten", "vaste kosten"]
  },
  {
    id: "setting-api",
    type: "setting",
    title: "Beheer > Datakwaliteit",
    subtitle: "Productkoppeling, LOT-dekking en kostprijsbronnen",
    meta: "Instellingen",
    href: "/beheer/api",
    keywords: ["datakwaliteit", "douano", "lot", "productkoppeling", "kostprijsbron", "beheer"]
  },
  {
    id: "setting-api-integratie",
    type: "setting",
    title: "Beheer > API-integratie",
    subtitle: "Douano verbinding, sync-runs en technische status",
    meta: "Instellingen",
    href: "/beheer/api-integratie",
    keywords: ["api", "integratie", "integraties", "douano", "sync", "stock history", "orders", "invoices", "beheer"]
  },
  {
    id: "break-even-analysis",
    type: "report",
    title: "Break-even analyse",
    subtitle: "Plan, actuals, reforecast en variantie-analyse",
    meta: "Analyse",
    href: "/break-even",
    keywords: ["break-even", "reforecast", "variantie", "bezettingsresultaat", "resultaatrekening"]
  },
  {
    id: "help-manual",
    type: "setting",
    title: "Helpcentrum",
    subtitle: "Handleiding en productdocumentatie",
    meta: "Support",
    href: "/beheer/handleiding",
    keywords: ["handleiding", "manual", "documentatie", "faq", "support", "motorfiets", "uitleg", "gebruiksaanwijzing"]
  },
  {
    id: "report-margin",
    type: "report",
    title: "Omzet & marge",
    subtitle: "Omzet, marge en winst",
    meta: "Analyse",
    href: "/omzet-en-marge",
    keywords: ["omzet", "marge", "winst", "bruto", "netto", "rapport", "analyse"]
  },
  {
    id: "invoice-index",
    type: "invoice",
    title: "Inkoopfacturen",
    subtitle: "Facturen zoeken en beheren",
    meta: "Financiën",
    href: "/inkoopfacturen",
    keywords: ["factuur", "facturen", "inkoopfacturen", "betaling", "openstaand", "betaald"]
  },
  {
    id: "order-index",
    type: "order",
    title: "Orders",
    subtitle: "Orders en verkoopoverzicht",
    meta: "Omzet",
    href: "/omzet-en-marge",
    keywords: ["order", "orders", "bestelling", "verzonden", "openstaand", "klantorder"]
  },
  {
    id: "customer-index",
    type: "customer",
    title: "Klanten",
    subtitle: "Klantbeheer en relaties",
    meta: "CRM",
    href: "/diensten",
    keywords: ["klant", "klanten", "relatie", "debiteur", "afnemer", "klantenbestand"]
  },
  {
    id: "beer-index",
    type: "beer",
    title: "Bieren",
    subtitle: "Productenlijst voor brouwerijen",
    meta: "Catalogus",
    href: "/bieren",
    keywords: ["bier", "bieren", "brouwerij", "stijl", "alcohol"]
  },
  {
    id: "product-index",
    type: "product",
    title: "Producten & verpakking",
    subtitle: "Verpakkingen, SKU's en productdetails",
    meta: "Catalogus",
    href: "/producten-verpakking",
    keywords: ["product", "producten", "verpakking", "sku", "artikel"]
  },
  {
    id: "recipe-index",
    type: "recipe",
    title: "Brouwmoment",
    subtitle: "LOT-gebonden batchversies maken",
    meta: "Productie",
    href: "/recept-hercalculatie",
    keywords: ["recept", "recepten", "brouwformule", "ingrediënten"]
  }
];

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

function scoreSearchEntry(entry: SearchIndexEntry, queryText: string, tokens: string[]) {
  let score = 0;
  const haystack = [entry.title, entry.subtitle, entry.meta, ...entry.keywords]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const token of tokens) {
    if (entry.keywords.includes(token)) {
      score += 12;
    }

    if (haystack.includes(` ${token} `)) {
      score += 8;
    }

    if (haystack.includes(token)) {
      score += 4;
    }
  }

  if (queryText === entry.title.toLowerCase()) {
    score += 20;
  }

  return score;
}

function queryContains(query: string, terms: string[]) {
  return terms.some((term) => query.includes(term));
}

function parseSearchQuery(query: string) {
  const normalized = normalizeQuery(query);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const intent = tokens.map((token) => INTENT_MAP[token]).find(Boolean) as SearchResultType | undefined;
  const isNumeric = /^[0-9\-]+$/.test(normalized);
  return { query, normalized, tokens, intent, isNumeric };
}

function buildItem(options: {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle?: string;
  meta?: string;
  href: string;
}): SearchResult {
  return { ...options };
}

export function createSearchResponse(query: string, _options?: { mode?: string; scope?: string }): SearchResponse {
  const parsed = parseSearchQuery(query);
  const groups: SearchGroup[] = [];
  const queryText = parsed.normalized;
  const items: SearchResult[] = [];

  if (!queryText || queryText.length < 3) {
    return { query, groups: [] };
  }

  const interpretedAs = parsed.intent ? `${GROUP_LABELS[parsed.intent]} zoeken` : undefined;

  const genericCount = (count: number) => Math.min(count, 999);

  if (parsed.isNumeric && queryText.length <= 4) {
    groups.push({
      type: "invoice",
      label: GROUP_LABELS.invoice,
      count: 128,
      items: [],
      viewAllHref: `${GROUP_LINKS.invoice}?q=${encodeURIComponent(queryText)}`
    });
    groups.push({
      type: "order",
      label: GROUP_LABELS.order,
      count: 42,
      items: [],
      viewAllHref: `${GROUP_LINKS.order}?q=${encodeURIComponent(queryText)}`
    });
    groups.push({
      type: "product",
      label: GROUP_LABELS.product,
      count: 6,
      items: [],
      viewAllHref: `${GROUP_LINKS.product}?q=${encodeURIComponent(queryText)}`
    });
    return { query, interpretedAs, groups };
  }

  const scored = SEARCH_INDEX
    .map((entry) => ({ entry, score: scoreSearchEntry(entry, queryText, parsed.tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ entry }) => entry);

  const fallbackItem = buildItem({
    id: "help-search",
    type: "setting",
    title: "Zoek in de handleiding",
    subtitle: "Vind woorden uit de productdocumentatie",
    meta: "Handleiding",
    href: "/beheer/handleiding"
  });

  const matchedItems = scored.length ? scored : [fallbackItem];

  for (const item of matchedItems) {
    items.push(item);
  }

  const groupsByType: Partial<Record<SearchResultType, SearchGroup>> = {};
  for (const item of items) {
    const existing = groupsByType[item.type];
    if (existing) {
      existing.items.push(item);
      existing.count += 1;
      continue;
    }
    groupsByType[item.type] = {
      type: item.type,
      label: GROUP_LABELS[item.type],
      count: 1,
      items: [item],
      viewAllHref: GROUP_LINKS[item.type] ? `${GROUP_LINKS[item.type]}?q=${encodeURIComponent(queryText)}` : undefined
    };
  }

  const groupList = Object.values(groupsByType);
  if (groupList.length > 0) {
    const fullResults = items.map((item) => ({
      ...item,
      category: GROUP_LABELS[item.type],
      section: item.meta,
      snippet: [item.title, item.subtitle, item.meta].filter(Boolean).join(" · "),
    }));
    return {
      query,
      interpretedAs,
      groups: groupList,
      fullResults,
    };
  }

  return {
    query,
    interpretedAs,
    groups: [
      {
        type: "setting",
        label: "Snel zoeken",
        count: 0,
        items: [],
        viewAllHref: "/instellingen"
      }
    ]
  };
}
