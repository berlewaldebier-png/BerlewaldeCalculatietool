import { BreakEvenWorkspace } from "@/components/break-even/BreakEvenWorkspace";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function BreakEvenPage() {
  const bootstrap = await getBootstrap(
    [
      "break-even-configuraties",
      "vaste-kosten",
      "channels",
      "bieren",
      "skus",
      "articles",
      "kostprijsversies",
      "kostprijsproductactiveringen",
      "verkoopprijzen",
      "basisproducten",
      "samengestelde-producten",
    ],
    true,
    "/break-even"
  );

  const datasets = bootstrap.datasets ?? {};

  return (
    <PageShell
      title="Break-even analyseren"
      subtitle="Leg eerst de break-even basis vast en test daarna scenario's voor mix, prijs en kosten. De actieve versie voedt offertes."
      activePath="/break-even"
      navigation={bootstrap.navigation ?? []}
    >
      <BreakEvenWorkspace
        initialConfigs={datasets["break-even-configuraties"] ?? []}
        vasteKosten={(datasets["vaste-kosten"] as Record<string, unknown>) ?? {}}
        channels={(datasets.channels as Record<string, unknown>[]) ?? []}
        bieren={(datasets.bieren as Record<string, unknown>[]) ?? []}
        skus={(datasets.skus as Record<string, unknown>[]) ?? []}
        articles={(datasets.articles as Record<string, unknown>[]) ?? []}
        kostprijsversies={(datasets.kostprijsversies as Record<string, unknown>[]) ?? []}
        kostprijsproductactiveringen={(datasets.kostprijsproductactiveringen as Record<string, unknown>[]) ?? []}
        verkoopprijzen={(datasets.verkoopprijzen as Record<string, unknown>[]) ?? []}
        basisproducten={(datasets.basisproducten as Record<string, unknown>[]) ?? []}
        samengesteldeProducten={(datasets["samengestelde-producten"] as Record<string, unknown>[]) ?? []}
      />
    </PageShell>
  );
}
