"use client";

type GenericRecord = Record<string, unknown>;

type Option = {
  value: string;
  label: string;
  description?: string;
};

type UitgangspuntenStepProps = {
  row: GenericRecord;
  kanaalOptions: Option[];
  litersBasisOptions: Option[];
  onChange: (updater: (draft: GenericRecord) => void) => void;
};

function isLitersMode(row: GenericRecord) {
  return String(row.voorsteltype ?? "").trim() === "Op basis van liters";
}

export default function UitgangspuntenStep({
  row,
  kanaalOptions,
  litersBasisOptions,
  onChange
}: UitgangspuntenStepProps) {
  const litersMode = isLitersMode(row);
  const pricingMethod = String(row.pricing_method ?? "sell_in");
  const offerLevel = String(row.offer_level ?? "samengesteld");
  const pricingChannel = String(
    row.pricing_channel ??
      row.kanaal ??
      (Array.isArray(row.selected_kanalen) ? (row.selected_kanalen as unknown[])[0] : "") ??
      kanaalOptions[0]?.value ??
      ""
  );
  const referenceChannels = Array.isArray(row.reference_channels)
    ? (row.reference_channels as unknown[]).map((value) => String(value ?? "")).filter(Boolean)
    : [];
  const selectableReferenceChannels = kanaalOptions.filter((option) => option.value !== pricingChannel);

  function setVoorsteltype(value: "Op basis van liters" | "Op basis van producten") {
    onChange((draft) => {
      draft.voorsteltype = value;
      if (value !== "Op basis van liters") {
        draft.liters_basis = "een_bier";
      }
    });
  }

  return (
    <section className="prijs-uitgangspunten">
      <div className="module-card prijs-uitgangspunten-card">
        <div className="module-card-title">Rekenkader</div>
        <div className="module-card-text">
          Kies hoe je het voorstel wilt opbouwen en welke prijsmethode de offerte moet volgen.
        </div>

        <div className="wizard-choice-grid prijs-uitgangspunten-choice-grid">
          <button
            type="button"
            className={`wizard-choice-card${litersMode ? " active" : ""}`}
            onClick={() => setVoorsteltype("Op basis van liters")}
          >
            <div className="wizard-choice-title">Op basis van liters</div>
            <div className="wizard-choice-text">
              Geschikt voor scenario&apos;s waarin je eerst op literkostprijs en referentiekanaal
              wilt sturen.
            </div>
          </button>

          <button
            type="button"
            className={`wizard-choice-card${!litersMode ? " active" : ""}`}
            onClick={() => setVoorsteltype("Op basis van producten")}
          >
            <div className="wizard-choice-title">Op basis van producten</div>
            <div className="wizard-choice-text">
              Geschikt als je direct wilt offreren op verpakkingen zoals dozen, flessen of
              fusten.
            </div>
          </button>
        </div>

        <div className="wizard-form-grid prijs-uitgangspunten-form-grid">
          <div className="nested-field">
            <span>Prijsmethode</span>
            <div className="wizard-choice-grid">
              <button
                type="button"
                className={`wizard-choice-card${pricingMethod === "sell_in" ? " active" : ""}`}
                onClick={() =>
                  onChange((draft) => {
                    draft.pricing_method = "sell_in";
                    const activePricingChannel = String(
                      draft.pricing_channel ??
                        draft.kanaal ??
                        kanaalOptions[0]?.value ??
                        ""
                    );
                    draft.pricing_channel = activePricingChannel;
                    draft.kanaal = activePricingChannel;
                    draft.reference_channels = [];
                    draft.selected_kanalen = [activePricingChannel];
                  })
                }
              >
                <div className="wizard-choice-title">Standaard (Sell-in)</div>
                <div className="wizard-choice-text">Gebruik de sell-in prijs van de gekozen kanalen als basis voor de offerte.</div>
              </button>
              <button
                type="button"
                className={`wizard-choice-card${pricingMethod === "sell_out" ? " active" : ""}`}
                onClick={() =>
                  onChange((draft) => {
                    draft.pricing_method = "sell_out";
                    const currentPricingChannel = String(
                      draft.pricing_channel ??
                        draft.kanaal ??
                        kanaalOptions.find((option) => option.value === "horeca")?.value ??
                        kanaalOptions[0]?.value ??
                        ""
                    );
                    draft.pricing_channel = currentPricingChannel;
                    draft.kanaal = currentPricingChannel;
                    const currentReferences = Array.isArray(draft.reference_channels)
                      ? (draft.reference_channels as unknown[]).map((value) => String(value ?? "")).filter(Boolean)
                      : [];
                    draft.reference_channels = currentReferences.filter((value) => value !== currentPricingChannel);
                    draft.selected_kanalen = [currentPricingChannel, ...((draft.reference_channels as string[]) ?? [])];
                  })
                }
              >
                <div className="wizard-choice-title">Via groothandel</div>
                <div className="wizard-choice-text">Bereken de groothandelprijs vanuit de standaard sell-in prijs van elk gekozen kanaal.</div>
              </button>
            </div>
          </div>

          {pricingMethod === "sell_out" ? (
            <label className="nested-field">
              <span>Gewenste marge groothandel %</span>
              <input
                className="dataset-input"
                type="number"
                min={0}
                step="0.1"
                value={String(row.groothandel_marge_pct ?? 0)}
                onChange={(event) =>
                  onChange((draft) => {
                    draft.groothandel_marge_pct = Number(event.target.value || 0);
                  })
                }
              />
            </label>
          ) : null}

          <div className="nested-field">
            <span>{pricingMethod === "sell_out" ? "Prijsbepalend kanaal" : "Kanaal"}</span>
            <select
              className="dataset-input"
              value={pricingChannel}
              onChange={(event) =>
                onChange((draft) => {
                  const nextChannel = event.target.value;
                  const currentReferenceChannels = Array.isArray(draft.reference_channels)
                    ? (draft.reference_channels as unknown[]).map((value) => String(value ?? "")).filter(Boolean)
                    : [];
                  draft.pricing_channel = nextChannel;
                  draft.kanaal = nextChannel;
                  draft.reference_channels = currentReferenceChannels.filter((value) => value !== nextChannel);
                  draft.selected_kanalen =
                    String(draft.pricing_method ?? "sell_in") === "sell_out"
                      ? [nextChannel, ...((draft.reference_channels as string[]) ?? [])]
                      : [nextChannel];
                })
              }
            >
              {kanaalOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {pricingMethod === "sell_out" ? (
            <div className="nested-field">
              <span>Referentiekanalen</span>
              <div className="prijs-selector-list">
                {selectableReferenceChannels.map((option) => {
                  const checked = referenceChannels.includes(option.value);
                  return (
                    <label key={option.value} className="prijs-selector-row">
                      <span className="prijs-checkbox-line">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            onChange((draft) => {
                              const currentValues = Array.isArray(draft.reference_channels)
                                ? (draft.reference_channels as unknown[]).map((value) => String(value ?? "")).filter(Boolean)
                                : [];
                              const nextReferences = checked
                                ? currentValues.filter((value) => value !== option.value)
                                : [...currentValues, option.value];
                              const activePricingChannel = String(
                                draft.pricing_channel ??
                                  draft.kanaal ??
                                  kanaalOptions[0]?.value ??
                                  ""
                              );
                              draft.reference_channels = nextReferences;
                              draft.selected_kanalen = [activePricingChannel, ...nextReferences];
                            })
                          }
                        />
                        <span>{option.label}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          <label className="nested-field">
            <span>Offerteniveau</span>
            <select
              className="dataset-input"
              value={offerLevel}
              onChange={(event) =>
                onChange((draft) => {
                  draft.offer_level = event.target.value;
                })
              }
            >
              <option value="samengesteld">Samengestelde producten</option>
              <option value="basis">Basisproducten</option>
            </select>
          </label>

          {litersMode ? (
            <label className="nested-field">
              <span>Liters berekenen op basis van</span>
              <select
                className="dataset-input"
                value={String(row.liters_basis ?? "een_bier")}
                onChange={(event) =>
                  onChange((draft) => {
                    draft.liters_basis = event.target.value;
                  })
                }
              >
                {litersBasisOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="prijs-uitgangspunten-hint">
            {offerLevel === "samengesteld"
              ? "Samengestelde producten tellen mee in omzet en winst. Basisproducten worden alleen readonly afgeleid."
              : "De offerte rekent rechtstreeks op basisproducten."}
          </div>
        </div>

        {litersMode ? (
          <div className="prijs-uitgangspunten-summary">
            {litersBasisOptions.map((option) => (
              <span
                key={option.value}
                className={
                  String(row.liters_basis ?? "een_bier") === option.value
                    ? "prijs-uitgangspunten-summary-active"
                    : ""
                }
              >
                {option.label}
                {option.description ? `: ${option.description}` : ""}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
