"use client";

import { parseOptionalNumberFromInput } from "@/components/berekeningen/berekeningenWizardUtils";

type GenericRecord = Record<string, unknown>;
type BerekeningSubjectType = "bier" | "artikel" | "dienst";

export function BasisStep({
  current,
  productieJaren,
  updateCurrent,
}: {
  current: GenericRecord;
  productieJaren: number[];
  updateCurrent: (updater: (draft: GenericRecord) => void) => void;
}) {
  const basis = (current.basisgegevens as GenericRecord) ?? {};
  const subjectType = (String((basis as any).sku_type ?? "bier").trim() || "bier") as BerekeningSubjectType;
  const belastingsoort = String((basis as any).belastingsoort ?? "Accijns");

  return (
    <div className="wizard-form-grid">
      <label className="nested-field">
        <span>Type</span>
        <select
          className="dataset-input"
          value={subjectType}
          onChange={(event) =>
            updateCurrent((draft) => {
              const nextType = event.target.value;
              const prevType = String(((draft.basisgegevens as GenericRecord) as any).sku_type ?? "bier");
              (draft.basisgegevens as GenericRecord).sku_type = nextType;
              if (nextType !== "bier") {
                (draft.soort_berekening as GenericRecord).type = "Inkoop";
                const nextUom = nextType === "dienst" ? "uur" : "stuk";
                if (!String(((draft.basisgegevens as GenericRecord) as any).uom ?? "").trim() || prevType === "bier") {
                  (draft.basisgegevens as GenericRecord).uom = nextUom;
                }
                const regels =
                  ((((draft.invoer as GenericRecord).inkoop as GenericRecord).factuurregels as GenericRecord[]) ?? []);
                regels.forEach((regel) => {
                  (regel as any).eenheid = String(((draft.basisgegevens as GenericRecord) as any).uom ?? nextUom);
                  (regel as any).liters = 0;
                  (regel as any).afvulkosten_fust = null;
                });
              }
            })
          }
        >
          <option value="bier">Bier</option>
          <option value="artikel">Artikel</option>
          <option value="dienst">Dienst</option>
        </select>
      </label>

      <label className="nested-field">
        <span>{subjectType === "bier" ? "Biernaam" : "Artikel"}</span>
        <input
          className="dataset-input"
          type="text"
          value={String((basis as any).biernaam ?? "")}
          onChange={(event) =>
            updateCurrent((draft) => {
              (draft.basisgegevens as GenericRecord).biernaam = event.target.value;
            })
          }
        />
      </label>

      <label className="nested-field">
        <span>Jaar</span>
        <select
          className="dataset-input"
          value={String((basis as any).jaar ?? "")}
          onChange={(event) =>
            updateCurrent((draft) => {
              (draft.basisgegevens as GenericRecord).jaar = Number(event.target.value);
            })
          }
        >
          <option value="" disabled>
            Kies productiejaar...
          </option>
          {productieJaren.map((year) => (
            <option key={year} value={String(year)}>
              {year}
            </option>
          ))}
        </select>
      </label>

      <label className="nested-field">
        <span>{subjectType === "bier" ? "Stijl" : "Categorie"}</span>
        <input
          className="dataset-input"
          type="text"
          value={String((basis as any).stijl ?? "")}
          onChange={(event) =>
            updateCurrent((draft) => {
              (draft.basisgegevens as GenericRecord).stijl = event.target.value;
            })
          }
        />
      </label>

      {subjectType === "bier" ? (
        <label className="nested-field">
          <span>Alcoholpercentage</span>
          <input
            className="dataset-input"
            type="number"
            step="any"
            value={String((basis as any).alcoholpercentage ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                (draft.basisgegevens as GenericRecord).alcoholpercentage = parseOptionalNumberFromInput(event.target.value);
              })
            }
          />
        </label>
      ) : null}

      <label className="nested-field">
        <span>BTW-tarief</span>
        <input
          className="dataset-input"
          type="text"
          value={String((basis as any).btw_tarief ?? "")}
          onChange={(event) =>
            updateCurrent((draft) => {
              (draft.basisgegevens as GenericRecord).btw_tarief = event.target.value;
            })
          }
        />
      </label>

      {subjectType === "bier" ? (
        <>
          <label className="nested-field">
            <span>Belastingsoort</span>
            <select
              className="dataset-input"
              value={belastingsoort}
              onChange={(event) =>
                updateCurrent((draft) => {
                  const basisgegevens = draft.basisgegevens as GenericRecord;
                  (basisgegevens as any).belastingsoort = event.target.value;
                  if (event.target.value === "Verbruiksbelasting") {
                    (basisgegevens as any).tarief_accijns = "";
                  } else if (String((basisgegevens as any).tarief_accijns ?? "").trim() === "") {
                    (basisgegevens as any).tarief_accijns = "Hoog";
                  }
                })
              }
            >
              <option value="Accijns">Accijns</option>
              <option value="Verbruiksbelasting">Verbruiksbelasting</option>
            </select>
          </label>
          {belastingsoort === "Accijns" ? (
            <label className="nested-field">
              <span>Tarief accijns</span>
              <select
                className="dataset-input"
                value={String((basis as any).tarief_accijns ?? "Hoog")}
                onChange={(event) =>
                  updateCurrent((draft) => {
                    (draft.basisgegevens as GenericRecord).tarief_accijns = event.target.value;
                  })
                }
              >
                <option value="Hoog">Hoog</option>
                <option value="Laag">Laag</option>
              </select>
            </label>
          ) : null}
        </>
      ) : null}

      <label className="nested-field">
        <span>Status</span>
        <input className="dataset-input" value={String((current as any).status ?? "concept")} readOnly />
      </label>
    </div>
  );
}

