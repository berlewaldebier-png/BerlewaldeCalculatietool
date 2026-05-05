"use client";

type FlowMode = "afvuleenheid" | "verkoopbaar";
type SellableKind = "product" | "dienst";

export function StepLijst(props: {
  mode: FlowMode;
  sellableKind: SellableKind;
  name: string;
  createdSkuId: string;
  createdArticleId: string;
  onBackToControle: () => void;
}) {
  const { mode, sellableKind, name, createdSkuId, createdArticleId, onBackToControle } = props;
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
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, justifyContent: "flex-end" }}>
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
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="cpq-button" onClick={onBackToControle}>
            Terug naar controle
          </button>
          <button
            type="button"
            className="cpq-button"
            onClick={() => {
              window.location.href = "/producten-verpakking";
            }}
          >
            Naar verkoopbare artikelen
          </button>
          <button
            type="button"
            className="cpq-button cpq-button-primary"
            onClick={() => {
              window.location.href = `/nieuwe-kostprijsberekening?mode=wizard-new&kind=article&sku_id=${encodeURIComponent(
                createdSkuId
              )}&focus=activations`;
            }}
          >
            Naar kostprijsbeheer
          </button>
        </div>
      ) : sellableKind === "dienst" ? (
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, justifyContent: "flex-end" }}>
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

