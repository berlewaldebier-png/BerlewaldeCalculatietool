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
          Kies hoe je het voorstel wilt opbouwen en welk kanaal als prijsreferentie dient.
          Daarna werkt de offerte-stap verder met kostprijzen, producten en verkoopstrategie.
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
          <label className="nested-field">
            <span>Referentiekanaal</span>
            <select
              className="dataset-input"
              value={String(row.kanaal ?? "horeca")}
              onChange={(event) =>
                onChange((draft) => {
                  draft.kanaal = event.target.value;
                })
              }
            >
              {kanaalOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
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
          ) : (
            <div className="prijs-uitgangspunten-hint">
              De offerte wordt opgebouwd uit geselecteerde bieren en de bijbehorende producten van
              het gekozen jaar.
            </div>
          )}
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
