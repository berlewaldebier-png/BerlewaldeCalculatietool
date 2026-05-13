"use client";

type FlowMode = "afvuleenheid" | "verkoopbaar";
type SellableKind = "product" | "dienst";
type BundleContext = "giftset" | "beer_variant";

type Props = {
  mode: FlowMode;
  sellableKind: SellableKind;
  bundleContext: BundleContext;
  beerId: string;
  beerOptions: Array<{ value: string; label: string }>;
  onModeChange: (next: FlowMode) => void;
  onSellableKindChange: (next: SellableKind) => void;
  onBundleContextChange: (next: BundleContext) => void;
  onBeerIdChange: (next: string) => void;
};

export function StepType(props: Props) {
  return (
    <div className="wizard-form-grid">
      <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
        <span>Wat wil je maken?</span>
        <select className="dataset-input" value={props.mode} onChange={(e) => props.onModeChange(e.target.value as FlowMode)}>
          <option value="afvuleenheid">Afvuleenheid</option>
          <option value="verkoopbaar">Verkoopbaar artikel</option>
        </select>
      </label>

      {props.mode === "verkoopbaar" ? (
        <>
          <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
            <span>Soort</span>
            <select className="dataset-input" value={props.sellableKind} onChange={(e) => props.onSellableKindChange(e.target.value as SellableKind)}>
              <option value="product">Product</option>
              <option value="dienst">Dienstverlening</option>
            </select>
          </label>

          {props.sellableKind === "product" ? (
            <>
              <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                <span>Type samenstelling</span>
                <select
                  className="dataset-input"
                  value={props.bundleContext}
                  onChange={(e) => props.onBundleContextChange(e.target.value as BundleContext)}
                >
                  <option value="giftset">Giftset / assortiment (meerdere bieren)</option>
                  <option value="beer_variant">Bier-variant (één bier)</option>
                </select>
              </label>

              {props.bundleContext === "beer_variant" ? (
                <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                  <span>Bier</span>
                  <select
                    className="dataset-input"
                    value={props.beerId}
                    onChange={(e) => props.onBeerIdChange(e.target.value)}
                  >
                    <option value="">Kies bier...</option>
                    {props.beerOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

