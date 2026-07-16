export type NavigationProjectionSource = {
  label: string;
  href: string;
};

export type ProjectedNavigationItem = NavigationProjectionSource & {
  active: boolean;
};

export type ProjectedNavigationGroup = {
  title: SidebarSectionTitle;
  items: ProjectedNavigationItem[];
};

export const FRONTEND_OWNED_NAVIGATION_ITEMS = [
  { label: "Scenario analyse", href: "/scenario-analyse" },
  { label: "Diensten", href: "/diensten" },
  { label: "Incidentele kosten", href: "/incidentele-kosten" },
  { label: "Instellingen", href: "/instellingen" },
] as const satisfies readonly NavigationProjectionSource[];

export const SIDEBAR_SECTION_SPECS = [
  {
    title: "Analyse",
    items: [
      { href: "/break-even", label: "Break-even analyseren" },
      { href: "/scenario-analyse", label: "Scenario analyseren" },
      { href: "/omzet-en-marge", label: "Omzet en marge" },
    ],
  },
  {
    title: "Prijsbeheer",
    items: [
      { href: "/prijsvoorstellen", label: "Prijsvoorstel maken" },
      { href: "/verkoopstrategie", label: "Verkoopstrategie" },
      { href: "/adviesprijzen", label: "Adviesprijzen" },
    ],
  },
  {
    title: "Aanbod",
    items: [
      { href: "/bieren", label: "Bieren" },
      { href: "/producten-verpakking", label: "Producten en verpakkingen" },
      { href: "/diensten", label: "Diensten" },
    ],
  },
  {
    title: "Kostenstructuur",
    items: [
      { href: "/nieuwe-kostprijsberekening", label: "Kostprijs beheer" },
      { href: "/vaste-kosten", label: "Vaste kosten (ABC)" },
      { href: "/incidentele-kosten", label: "Incidenteel" },
      { href: "/productie", label: "Productie en drivers" },
      { href: "/tarieven-heffingen", label: "Tarieven en heffingen" },
      { href: "/recept-hercalculatie", label: "Brouwmoment" },
      { href: "/inkoopfacturen", label: "Inkoopfacturen" },
      { href: "/instellingen", label: "Instellingen" },
    ],
  },
  {
    title: "Beheren",
    items: [
      { href: "/jaar-afsluiten", label: "Jaar afsluiten" },
      { href: "/setup", label: "Setup" },
      { href: "/nieuw-jaar-voorbereiden", label: "Nieuw jaar voorbereiden" },
      { href: "/beheer/productkoppeling", label: "Productkoppeling" },
      { href: "/beheer", label: "Beheer" },
    ],
  },
] as const;

export type SidebarSectionTitle = (typeof SIDEBAR_SECTION_SPECS)[number]["title"];

export function buildNavigationProjection(
  navigation: readonly NavigationProjectionSource[],
  activePath: string
): ProjectedNavigationGroup[] {
  const byHref = new Map(
    navigation.map((item) => [item.href, { label: item.label, href: item.href }])
  );

  // Only these routes are owned exclusively by the frontend. Backend-owned
  // routes must remain absent when its permission projection omits them.
  for (const item of FRONTEND_OWNED_NAVIGATION_ITEMS) {
    if (!byHref.has(item.href)) {
      byHref.set(item.href, item);
    }
  }

  const activeNormalized = String(activePath || "/").trim() || "/";
  return SIDEBAR_SECTION_SPECS.map((section) => {
    const items: ProjectedNavigationItem[] = [];
    for (const spec of section.items) {
      const found = byHref.get(spec.href);
      if (!found) continue;
      items.push({
        ...found,
        label: spec.label,
        active:
          activeNormalized === found.href
          || (found.href !== "/" && activeNormalized.startsWith(`${found.href}/`)),
      });
    }
    return { title: section.title, items };
  }).filter((group) => group.items.length > 0);
}
