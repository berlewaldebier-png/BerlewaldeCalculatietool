import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";
import { BreakEvenV2Workspace } from "@/components/break-even-v2/BreakEvenV2Workspace";

export default async function BreakEvenV2Page() {
  const bootstrap = await getBootstrap(
    [
      "auth-status",
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
    "/break-even-v2"
  );

  const datasets = bootstrap.datasets ?? {};

  return (
    <PageShell
      title="Break-even (v2)"
      subtitle="Break-even op basis van gerealiseerde verkoop (Douano facturen) + scenario’s."
      activePath="/break-even-v2"
      navigation={bootstrap.navigation ?? []}
    >
      <BreakEvenV2Workspace
        initialConfigs={datasets["break-even-configuraties"] ?? []}
        vasteKosten={(datasets["vaste-kosten"] as any) ?? {}}
        channels={(datasets.channels as any) ?? []}
        bieren={(datasets.bieren as any) ?? []}
        skus={(datasets.skus as any) ?? []}
        articles={(datasets.articles as any) ?? []}
        kostprijsversies={(datasets.kostprijsversies as any) ?? []}
        kostprijsproductactiveringen={(datasets.kostprijsproductactiveringen as any) ?? []}
        verkoopprijzen={(datasets.verkoopprijzen as any) ?? []}
        basisproducten={(datasets.basisproducten as any) ?? []}
        samengesteldeProducten={(datasets["samengestelde-producten"] as any) ?? []}
      />
    </PageShell>
  );
}

