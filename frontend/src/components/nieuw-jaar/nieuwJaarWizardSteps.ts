export type NieuwJaarWizardStep = {
  id: string;
  label: string;
  description: string;
  panelTitle: string;
  panelDescription: string;
};


export function buildNieuwJaarWizardSteps(
  sourceYear: number,
  targetYear: number
): NieuwJaarWizardStep[] {
  return [
    {
      id: "basis",
      label: "Basisgegevens",
      description: "Kies bronjaar en doeljaar",
      panelTitle: "Jaarselectie",
      panelDescription: "Selecteer het bronjaar. Het doeljaar wordt automatisch ingesteld op bronjaar + 1."
    },
    {
      id: "init",
      label: "Jaarset",
      description: "Stel concept samen voor het doeljaar",
      panelTitle: "Jaarset initialiseren",
      panelDescription:
        "Kies welke stamdata je wilt klaarmaken voor het doeljaar. Totdat je afrondt schrijven we nog niets definitief weg."
    },
    {
      id: "productie",
      label: `Plan ${targetYear}`,
      description: "Omzet, kosten en volume voor het doeljaar",
      panelTitle: `Plan ${targetYear}`,
      panelDescription: `Bepaal het top-down doel voor ${targetYear}. Omzet is leidend; variabele kosten en volume worden afgeleid van ${sourceYear} en blijven bijstuurbaar.`
    },
    {
      id: "tarieven",
      label: "Tarieven",
      description: "Accijns en heffingen voor het doeljaar",
      panelTitle: "Tarieven & heffingen",
      panelDescription: `Controleer bronjaar ${sourceYear} en vul het doeljaar ${targetYear} in.`
    },
    {
      id: "vaste-kosten",
      label: "Vaste kosten",
      description: "Indirecte/directe kosten voor het doeljaar",
      panelTitle: `Vaste kosten ${targetYear}`,
      panelDescription: "Bekijk bronjaar (read-only) en vul vaste kosten voor het doeljaar bewust in; jaar is vastgezet op het doeljaar."
    },
    {
      id: "verpakking",
      label: "Verpakking",
      description: "Jaarprijzen voor verpakkingsonderdelen",
      panelTitle: `Verpakkingsonderdelen ${targetYear}`,
      panelDescription: "Werk de jaarprijzen bij. Dit stuurt basis- en samengestelde productkosten."
    },
    {
      id: "inkoop-scenario",
      label: "Inkoop scenario",
      description: "Scenario inkoopprijzen (niet opslaan)",
      panelTitle: `Inkoop scenario ${targetYear}`,
      panelDescription:
        "Vul scenario inkoopprijzen (primair/inkoopdeel) in om direct de impact op kostprijs en verkoopprijzen te zien. Deze waarden worden niet opgeslagen."
    },
    {
      id: "recepten",
      label: "Recepten",
      description: "Eigen productie (recept en ingrediënten)",
      panelTitle: `Recepten ${targetYear}`,
      panelDescription:
        "Voor bieren met eigen productie kun je recept/ingrediënten bijstellen. Dit doe je via Kostprijs beheren; de wizard toont hier alleen welke bieren dit betreft."
    },
    {
      id: "kostprijs",
      label: "Kostprijs",
      description: `Kostprijs ${targetYear} (opbouw)`,
      panelTitle: `Kostprijs ${targetYear}`,
      panelDescription: "Bekijk de opbouw per bier en verpakkingseenheid op basis van jouw doeljaar-invoer en scenario."
    },
    {
      id: "verkoopstrategie",
      label: "Verkoopstrategie",
      description: "Verkoopprijsinstellingen (opslag/prijs) voor het doeljaar",
      panelTitle: `Verkoopstrategie ${targetYear}`,
      panelDescription: "Controleer en pas marges/prijzen aan voor het doeljaar."
    },
    {
      id: "adviesprijzen",
      label: "Adviesprijzen",
      description: "Adviesopslag per kanaal (sell-out) voor het doeljaar",
      panelTitle: `Adviesprijzen ${targetYear}`,
      panelDescription:
        "Vul per kanaal de opslag in waarmee een adviesverkoopprijs (sell-out) wordt afgeleid uit onze verkoopprijs."
    },
    {
      id: "preview",
      label: "Preview",
      description: "Bekijk de impact op kostprijzen en verkoopprijzen",
      panelTitle: `Preview ${targetYear}`,
      panelDescription:
        "Indicatieve kostprijzen voor het doeljaar op basis van jouw ingevulde gegevens (en scenario inkoopprijzen)."
    },
    {
      id: "plan-hercontrole",
      label: `Plan ${targetYear} opnieuw`,
      description: "Laatste controle met voorraad",
      panelTitle: `Plan ${targetYear} opnieuw`,
      panelDescription:
        "Controleer het doeljaar opnieuw na kostprijs, verkoopstrategie, adviesprijzen en beginvoorraad. Voorraad verlaagt alleen de productie-/inkoopbehoefte."
    },
    {
      id: "afronden",
      label: "Afronden",
      description: "Controleer en ga terug naar de app",
      panelTitle: "Afronden",
      panelDescription:
        "Schrijf het doeljaar definitief weg (1 transactie) of bewaar je voortgang als concept."
    }
  ];
}
