"use client";

type FlowMode = "afvuleenheid" | "verkoopbaar";
type SellableKind = "product" | "dienst";

export function StepLijst(props: {
  mode: FlowMode;
  sellableKind: SellableKind;
  name: string;
  year: number;
  createdSkuId: string;
  createdArticleId: string;
  onBackToControle: () => void;
}) {
  const { mode, sellableKind, name, year, createdSkuId, createdArticleId, onBackToControle } = props;

  async function goToKostprijsWizard() {
    const skuId = String(createdSkuId ?? "").trim();
    if (!skuId) return;
    try {
      const response = await fetch("/api/data/kostprijsversies", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      const rows = Array.isArray((payload as any)?.data)
        ? ((payload as any).data as any[])
        : Array.isArray(payload)
          ? (payload as any[])
          : [];

      const matches = rows.filter((row) => {
        const rec = row as any;
        const recYear = Number(rec?.jaar ?? rec?.basisgegevens?.jaar ?? 0) || 0;
        if (recYear !== Number(year || 0)) return false;
        const recSku = String(rec?.basisgegevens?.sku_id ?? "").trim();
        return recSku === skuId;
      });

      const pick = matches
        .slice()
        .sort((a, b) => {
          const ta = String((a as any)?.aangepast_op ?? (a as any)?.updated_at ?? (a as any)?.created_at ?? "");
          const tb = String((b as any)?.aangepast_op ?? (b as any)?.updated_at ?? (b as any)?.created_at ?? "");
          return tb.localeCompare(ta);
        })[0] as any;

      if (pick && String(pick?.id ?? "").trim()) {
        window.location.href = `/nieuwe-kostprijsberekening?mode=wizard-edit&selected_id=${encodeURIComponent(
          String(pick.id)
        )}&focus=activations`;
        return;
      }
    } catch {
      // Fall back to wizard-new below.
    }

    window.location.href = `/nieuwe-kostprijsberekening?mode=wizard-new&kind=article&sku_id=${encodeURIComponent(
      skuId
    )}&focus=activations`;
  }
  return (
    <div className="wizard-form-grid">
      <div className="editor-status wizard-inline-status" style={{ gridColumn: "1 / -1" }}>
        <strong>Toegevoegd:</strong> {name}
        {createdSkuId ? (
          <div style={{ marginTop: 6 }} className="muted">
            SKU: <code>{createdSkuId}</code>
          </div>
        ) : null}
        {mode === "afvuleenheid" && createdArticleId ? (
          <div style={{ marginTop: 6 }} className="muted">
            Afvuleenheid: <code>{createdArticleId}</code>
          </div>
        ) : null}
      </div>

      {mode === "afvuleenheid" ? (
        <div className="dataset-empty" style={{ gridColumn: "1 / -1" }}>
          Afvuleenheden zijn intern en hoeven niet geactiveerd te worden. Ze zijn direct selecteerbaar als
          afvuleenheid/verpakkingseenheid in kostprijsbeheer.
        </div>
      ) : sellableKind === "dienst" ? (
        <div className="dataset-empty" style={{ gridColumn: "1 / -1" }}>
          Dienstverlening gebruikt een uur-tarief en is direct selecteerbaar in offertes zodra het tarief is ingevuld.
        </div>
      ) : (
        <div className="dataset-empty" style={{ gridColumn: "1 / -1" }}>
          Volgende stap: rond de kostprijs af en activeer dit verkoopbaar artikel in kostprijsbeheer.
        </div>
      )}

      {mode === "afvuleenheid" ? (
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, justifyContent: "space-between" }}>
          <button type="button" className="cpq-button" onClick={onBackToControle}>
            Terug naar controle
          </button>
          <button
            type="button"
            className="cpq-button cpq-button-primary"
            onClick={() => {
              window.location.href = "/producten-verpakking";
            }}
          >
            Naar afvuleenheden
          </button>
        </div>
      ) : sellableKind !== "dienst" && createdSkuId ? (
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, justifyContent: "space-between" }}>
          <button type="button" className="cpq-button" onClick={onBackToControle}>
            Terug naar controle
          </button>
          <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              className="cpq-button"
              onClick={() => {
                const ok = window.confirm(
                  "Je slaat het artikel wel op, maar de kostprijs is nog niet actief. Activeer de kostprijs via “Activeer kostprijs” of later via “Kostprijs beheren”."
                );
                if (!ok) return;
                window.location.href = "/producten-verpakking";
              }}
            >
              Naar verkoopbare artikelen
            </button>
            <button
              type="button"
              className="cpq-button cpq-button-primary"
              onClick={() => {
                void goToKostprijsWizard();
              }}
            >
              Activeer kostprijs
            </button>
          </span>
        </div>
      ) : sellableKind === "dienst" ? (
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, justifyContent: "space-between" }}>
          <button type="button" className="cpq-button" onClick={onBackToControle}>
            Terug naar controle
          </button>
          <button
            type="button"
            className="cpq-button cpq-button-primary"
            onClick={() => {
              window.location.href = "/producten-verpakking";
            }}
          >
            Naar verkoopbare artikelen
          </button>
        </div>
      ) : null}
    </div>
  );
}

