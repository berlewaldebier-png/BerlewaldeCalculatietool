import Link from "next/link";

import { PageShell } from "@/components/PageShell";
import { JaarsetsPanel } from "@/components/JaarsetsPanel";
import { getBootstrap } from "@/lib/apiServer";

export default async function JaarsetsPage() {
  const bootstrap = await getBootstrap(["auth-status"], true, "/beheer/jaarsets");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Jaarsets"
      subtitle="Overzicht van concepten en definitieve productie-jaren. Rollback is alleen mogelijk voor het laatste jaar."
      activePath="/beheer"
      navigation={navigation}
    >
      <div className="placeholder-block" style={{ marginBottom: 16 }}>
        <strong>Let op</strong>
        Rollback verwijdert alleen de jaarset-data (productie, tarieven, vaste kosten, verpakkingsprijzen en verkoopstrategie)
        van het doeljaar. Kostprijzen, activaties en prijsvoorstellen worden niet verwijderd.
        <div className="muted" style={{ marginTop: 8 }}>
          Concepten kun je altijd verwijderen. Een definitief jaar kun je alleen terugdraaien als het het hoogste jaar is.
        </div>
      </div>

      <JaarsetsPanel />

      <div className="editor-actions" style={{ justifyContent: "flex-start", marginTop: 16 }}>
        <Link href="/nieuw-jaar-voorbereiden" className="editor-button">
          Nieuw jaar voorbereiden
        </Link>
        <Link href="/beheer" className="editor-button editor-button-secondary">
          Terug naar beheer
        </Link>
      </div>
    </PageShell>
  );
}

