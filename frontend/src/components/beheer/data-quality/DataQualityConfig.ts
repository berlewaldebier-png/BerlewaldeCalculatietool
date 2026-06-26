import type { WorkstreamDefinition, WorkstreamKey } from "@/components/beheer/data-quality/DataQualityTypes";

export const DATA_QUALITY_WORKSTREAMS: WorkstreamDefinition[] = [
  {
    id: "overview",
    title: "Overzicht",
    description: "Werkvoorraad en betrouwbaarheid",
  },
  {
    id: "products",
    title: "Producten & SKU's",
    description: "Douano koppelen aan intern",
  },
  {
    id: "cost_sources",
    title: "Kostprijsbronnen",
    description: "Verkoopregels verwerkbaar maken",
  },
  {
    id: "lots",
    title: "LOT-register",
    description: "Interne en Douano LOTs",
  },
  {
    id: "exceptions",
    title: "Uitvalregels",
    description: "Bewuste uitzonderingen",
  },
  {
    id: "api",
    title: "API-status",
    description: "Sync runs en delta's",
  },
  {
    id: "advanced",
    title: "Geavanceerd",
    description: "Technische status en fallback",
  },
];

export const API_RESOURCES = [
  { id: "companies", label: "Companies" },
  { id: "products", label: "Products" },
  { id: "sales_orders", label: "Sales orders" },
  { id: "sales_invoices", label: "Invoices" },
  { id: "stock_history_lots", label: "Stock-history LOTs" },
];

export const STEP_HELP: Record<WorkstreamKey, { title: string; description: string; outcome: string }> = {
  overview: {
    title: "Datakwaliteit workbench",
    description:
      "Dit scherm is geen lineaire wizard. Het toont welke werkvoorraad nog voorkomt dat Omzet & Marge betrouwbaar is voor het gekozen jaar.",
    outcome: "Doel: alle blokkerende kaarten op ok, met zichtbare acties voor wat nog open staat.",
  },
  products: {
    title: "Producten en SKU's",
    description:
      "Hier los je Douano producten op die nog niet naar een interne SKU wijzen. Douano blijft de bron voor verkochte producten; de app gebruikt de interne SKU voor kostprijs en rapportage.",
    outcome: "Na oplossen verdwijnen nieuwe/onbekende producten uit de werkvoorraad en kunnen verkoopregels naar kostprijsbronnen zoeken.",
  },
  cost_sources: {
    title: "Kostprijsbronnen",
    description:
      "Hier los je verkoopregels op die nog geen bruikbare kostprijsbron hebben. Denk aan SKU koppelen, historische kostprijs toevoegen, LOT alias koppelen of bewust geen kostprijs nodig.",
    outcome: "Na opslaan worden alleen de geraakte snapshots ververst en hoort de rij uit de blokkade te verdwijnen.",
  },
  lots: {
    title: "LOT-register",
    description:
      "Hier beheer je de relatie tussen interne LOTs uit kostprijzen/inkoopfacturen/opening voorraad en externe Douano LOTs. Matching is jaaroverstijgend; het jaar bepaalt alleen urgentie.",
    outcome: "Exacte matches en expliciete aliases zorgen dat Omzet & Marge de juiste kostprijsversie gebruikt.",
  },
  exceptions: {
    title: "Uitvalregels en bewuste uitzonderingen",
    description:
      "Hier staan regels die niet via de normale bier/SKU/LOT-route lopen, zoals afrondingen, diensten, giftsets en overige omzetregels.",
    outcome: "Elke uitzondering moet expliciet gecategoriseerd zijn, zodat niets stilletjes uit de margeanalyse verdwijnt.",
  },
  api: {
    title: "API-status",
    description:
      "Hier zie je de technische Douano runs en kun je syncs starten. Datakwaliteit zelf gebruikt vooral de laatste run en de nieuwe delta's.",
    outcome: "Na nieuwe API-runs ontstaan alleen nieuwe issues; bestaande expliciete oplossingen blijven staan.",
  },
  advanced: {
    title: "Geavanceerd beheer",
    description: "Technische controles, verbindingen en fallback-tools die niet in de dagelijkse datakwaliteit-flow horen.",
    outcome: "Alleen gebruiken voor diagnose, configuratie of uitzonderlijke onderhoudsacties.",
  },
};

export const DATA_QUALITY_CHECK_GROUPS: Record<WorkstreamKey, string[]> = {
  overview: ["product_mappings", "stock_history_lots", "sales_rows_cost_source"],
  products: ["product_mappings"],
  cost_sources: ["sales_rows_cost_source"],
  lots: ["stock_history_lots"],
  exceptions: [],
  api: ["douano_products", "sales_invoices", "stock_history_sync"],
  advanced: [],
};

export const DATA_QUALITY_SECTION_COPY: Record<
  WorkstreamKey,
  {
    title: string;
    description: string;
    emptyText?: string;
  }
> = {
  overview: {
    title: "Blokkeert margeanalyse",
    description: "Deze kaarten tonen alleen wat Omzet & Marge voor dit jaar onbetrouwbaar maakt.",
  },
  products: {
    title: "Productkoppelingen",
    description: "Verkochte Douano producten moeten naar een interne SKU wijzen voordat kostprijs en rapportage betrouwbaar zijn.",
  },
  cost_sources: {
    title: "Verkoopregels zonder kostprijsbron",
    description: "Los regels op via SKU-koppeling, historische kostprijs, LOT alias of een expliciete categorie zonder kostprijs.",
  },
  lots: {
    title: "LOT-dekking verkoopregels",
    description: "Bier-SKU's moeten een bruikbare LOT-route hebben. Geschenkverpakkingen gebruiken de kostprijs uit hun samenstelling.",
  },
  exceptions: {
    title: "Bewuste uitzonderingen",
    description: "Regels zonder normale bier/SKU/LOT-route beheer je hier als expliciete categorie, zodat omzet wel meetelt en marge niet stilletjes vervuilt.",
    emptyText: "Uitzonderingen staan hieronder in de uitvalregelskaart.",
  },
  api: {
    title: "Sync voorwaarden",
    description: "Deze checks laten zien of de benodigde Douano bronnen recent genoeg gevuld zijn.",
  },
  advanced: {
    title: "Technische hulpmiddelen",
    description: "Gebruik deze onderdelen alleen voor diagnose of onderhoud.",
  },
};

export const DATA_QUALITY_CHECK_PANEL_COPY: Record<string, { title: string; description: string; searchPlaceholder?: string }> = {
  product_mappings: {
    title: "Douano producten zonder goede SKU-koppeling",
    description: "Koppel deze Douano producten aan een interne SKU voordat kostprijs en rapportage betrouwbaar kunnen rekenen.",
  },
  stock_history_lots: {
    title: "LOT-plichtige regels zonder bruikbare LOT",
    description: "Deze bierregels missen nog een LOT-route uit Douano of een expliciete interne oplossing.",
  },
  sales_rows_cost_source: {
    title: "Te verwerken verkoopregels",
    description: "Deze regels hebben nog geen bruikbare kostprijsbron of bewuste categorie. Kies per rij of selectie de passende actie.",
    searchPlaceholder: "Zoek op product, SKU, LOT, transactie of oorzaak",
  },
  douano_products: {
    title: "Douano productsync ontbreekt",
    description: "Synchroniseer de Douano productcatalogus voordat productkoppelingen compleet kunnen zijn.",
  },
  sales_invoices: {
    title: "Factuursync ontbreekt",
    description: "Synchroniseer sales invoices zodat Omzet & Marge de verkoopregels voor dit jaar ziet.",
  },
  stock_history_sync: {
    title: "Stock-history LOT sync ontbreekt",
    description: "Synchroniseer stock-history LOTs om verkoopregels met Douano LOTs te verrijken.",
  },
};
