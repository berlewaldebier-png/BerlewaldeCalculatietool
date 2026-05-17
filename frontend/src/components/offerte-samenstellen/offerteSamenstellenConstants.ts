import type { StepKey, ToolbarGroup } from "@/components/offerte-samenstellen/types";
import { icons } from "@/components/offerte-samenstellen/offerteSamenstellenConfig";

export const offerteToolbarGroups: ToolbarGroup[] = [
  {
    title: "Pricing",
    items: [
      { icon: icons.Intro, label: "Intro" },
      { icon: icons.Staffel, label: "Staffel" },
      { icon: icons.Mix, label: "Mix" },
      { icon: icons.Korting, label: "Korting" },
      { icon: icons.Groothandel, label: "Groothandel" },
    ],
  },
  {
    title: "Logistiek",
    items: [
      { icon: icons.Transport, label: "Transport" },
      { icon: icons.Retour, label: "Retour" },
    ],
  },
  {
    title: "Extra's",
    items: [
      { icon: icons.Palletopbouw, label: "Palletopbouw" },
      { icon: icons.Proeverij, label: "Proeverij" },
      { icon: icons.Tapverhuur, label: "Tapverhuur" },
    ],
  },
];

export const offerteWizardSteps: { id: StepKey; title: string; desc: string }[] = [
  { id: "basis", title: "Basisgegevens", desc: "Klant, kanaal en naam" },
  { id: "builder", title: "Offerte maken", desc: "Producten, opties en voorstellen" },
  { id: "vergelijk", title: "Vergelijken", desc: "Voorstellen naast elkaar" },
  { id: "afronden", title: "Afronden", desc: "Export en notities" },
];

