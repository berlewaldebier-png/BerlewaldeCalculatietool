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
