import { BreakEvenNextMockup } from "@/components/break-even-next/BreakEvenNextMockup";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function BreakEvenNextPage() {
  const bootstrap = await getBootstrap(["auth-status"], true, "/break-even-next");

  return (
    <PageShell
      title="Break-even next"
      subtitle="Tijdelijke mock-up voor plan, actuals, reforecast, variantie en jaarafsluiting."
      activePath="/break-even"
      navigation={bootstrap.navigation ?? []}
    >
      <BreakEvenNextMockup />
    </PageShell>
  );
}
