import Link from "next/link";

import { PageShell } from "@/components/PageShell";
import { JaarsetsPanel } from "@/components/JaarsetsPanel";
import { getBootstrap } from "@/lib/apiServer";

export default async function JaarsetsPage() {
  const bootstrap = await getBootstrap(["auth-status"], true, "/beheer/jaarsets");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Jaarbeheer"
      subtitle="Beheer jaarsets, frozen break-even plannen, nieuw-jaar-concepten en jaarafsluitingen."
      activePath="/beheer"
      navigation={navigation}
    >
      <div className="placeholder-block" style={{ marginBottom: 16 }}>
        <strong>Let op</strong>
        Rollback verwijdert alleen de jaarset-data van het doeljaar. Kostprijzen, activaties en prijsvoorstellen worden niet verwijderd.
        <div className="muted" style={{ marginTop: 8 }}>
          Concepten kun je altijd verwijderen. Een definitief jaar kun je alleen terugdraaien als het het hoogste jaar is. First-use backfill legt een eerste break-even plan vast voor bestaande jaren.
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

