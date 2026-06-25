"use client";

type GenericRecord = Record<string, unknown>;
type BerekeningSubjectType = "bier" | "artikel" | "dienst";
type ProductionStatus = "planned_recipe" | "brewed_batch";

export function TypeStep({
  current,
  updateCurrent,
  setActiveStepIndex,
}: {
  current: GenericRecord;
  updateCurrent: (updater: (draft: GenericRecord) => void) => void;
  setActiveStepIndex: (next: number) => void;
}) {
  const basis = (current.basisgegevens as GenericRecord) ?? {};
  const subjectType = (String((basis as any).sku_type ?? "bier").trim() || "bier") as BerekeningSubjectType;
  const storedType = String((((current as any).soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
  const type = subjectType !== "bier" ? "Inkoop" : storedType;
  const soort = (((current as any).soort_berekening as GenericRecord | undefined) ?? {}) as GenericRecord;
  const productionStatus = (String((current as any).production_status ?? (soort as any).production_status ?? "").trim() ===
  "brewed_batch"
    ? "brewed_batch"
    : "planned_recipe") as ProductionStatus;
  const brouwmoment = (((current as any).brouwmoment as GenericRecord | undefined) ?? {}) as GenericRecord;
  const inkoop = ((((current as any).invoer as GenericRecord | undefined)?.inkoop as GenericRecord | undefined) ?? {}) as GenericRecord;
  const lotnummer = String((brouwmoment as any).lotnummer ?? (inkoop as any).lotnummer ?? "").trim();
  const brouwdatum = String((brouwmoment as any).brouwdatum ?? "").slice(0, 10);

  const setProductionStatus = (nextStatus: ProductionStatus) => {
    updateCurrent((draft) => {
      const draftSoort = (((draft as any).soort_berekening as GenericRecord | undefined) ?? {}) as GenericRecord;
      draftSoort.type = "Eigen productie";
      draftSoort.production_status = nextStatus;
      draftSoort.productiestatus = nextStatus === "brewed_batch" ? "Al gebrouwen" : "Nog niet gebrouwen";
      (draft as any).soort_berekening = draftSoort;
      (draft as any).production_status = nextStatus;
      (draft as any).is_brewed = nextStatus === "brewed_batch";
      if (nextStatus === "planned_recipe") {
        const bm = (((draft as any).brouwmoment as GenericRecord | undefined) ?? {}) as GenericRecord;
        bm.lotnummer = "";
        bm.brouwdatum = "";
        (draft as any).brouwmoment = bm;
        const invoer = (((draft as any).invoer as GenericRecord | undefined) ?? {}) as GenericRecord;
        const draftInkoop = ((invoer.inkoop as GenericRecord | undefined) ?? {}) as GenericRecord;
        draftInkoop.lotnummer = "";
        const facturen = Array.isArray(draftInkoop.facturen) ? [...(draftInkoop.facturen as GenericRecord[])] : [];
        if (facturen[0] && typeof facturen[0] === "object") {
          facturen[0] = { ...facturen[0], lotnummer: "" };
          draftInkoop.facturen = facturen;
        }
        invoer.inkoop = draftInkoop;
        (draft as any).invoer = invoer;
      }
    });
  };

  const updateBrouwmomentField = (field: "lotnummer" | "brouwdatum" | "notitie", value: string) => {
    updateCurrent((draft) => {
      const bm = (((draft as any).brouwmoment as GenericRecord | undefined) ?? {}) as GenericRecord;
      bm[field] = value;
      (draft as any).brouwmoment = bm;
      if (field === "lotnummer") {
        const invoer = (((draft as any).invoer as GenericRecord | undefined) ?? {}) as GenericRecord;
        const draftInkoop = ((invoer.inkoop as GenericRecord | undefined) ?? {}) as GenericRecord;
        draftInkoop.lotnummer = value;
        const facturen = Array.isArray(draftInkoop.facturen) ? [...(draftInkoop.facturen as GenericRecord[])] : [];
        if (facturen[0] && typeof facturen[0] === "object") {
          facturen[0] = { ...facturen[0], lotnummer: value };
          draftInkoop.facturen = facturen;
        }
        invoer.inkoop = draftInkoop;
        (draft as any).invoer = invoer;
      }
    });
  };

  return (
    <div className="wizard-stack">
      <div className="wizard-choice-grid">
        {[
          ["Eigen productie", "Gebruik ingredienten en receptregels als basis voor de kostprijs."],
          ["Inkoop", "Gebruik facturen, liters en bijkomende kosten als basis voor de kostprijs."],
        ].map(([option, text]) => (
          <button
            key={option}
            type="button"
            className={`wizard-choice-card${type === option ? " active" : ""}${
              subjectType !== "bier" && option === "Eigen productie" ? " disabled" : ""
            }`}
            disabled={subjectType !== "bier" && option === "Eigen productie"}
            aria-disabled={subjectType !== "bier" && option === "Eigen productie"}
            onClick={() => {
              if (subjectType !== "bier" && option === "Eigen productie") {
                return;
              }
              updateCurrent((draft) => {
                const draftSoort = (((draft as any).soort_berekening as GenericRecord | undefined) ?? {}) as GenericRecord;
                draftSoort.type = option;
                if (option === "Eigen productie" && !draftSoort.production_status) {
                  draftSoort.production_status = "planned_recipe";
                  draftSoort.productiestatus = "Nog niet gebrouwen";
                  (draft as any).production_status = "planned_recipe";
                  (draft as any).is_brewed = false;
                } else if (option === "Inkoop") {
                  delete draftSoort.production_status;
                  delete draftSoort.productiestatus;
                  delete (draft as any).production_status;
                  delete (draft as any).is_brewed;
                }
                (draft as any).soort_berekening = draftSoort;
              });
              setActiveStepIndex(2);
            }}
          >
            <div className="wizard-choice-title">{option}</div>
            <div className="wizard-choice-text">{text}</div>
          </button>
        ))}
      </div>

      {type === "Eigen productie" && subjectType === "bier" ? (
        <div className="module-card compact-card">
          <div className="module-card-title">Productiestatus</div>
          <div className="module-card-text">
            Kies of deze kostprijs alleen een receptprijs is, of al hoort bij een echte gebrouwen batch.
          </div>
          <div className="wizard-choice-grid" style={{ marginTop: 12 }}>
            <button
              type="button"
              className={`wizard-choice-card${productionStatus === "planned_recipe" ? " active" : ""}`}
              onClick={() => setProductionStatus("planned_recipe")}
            >
              <div className="wizard-choice-title">Nog niet gebrouwen</div>
              <div className="wizard-choice-text">Bewaar als geplande receptprijs. Geen LOT, SKU of Douano-koppeling nodig.</div>
            </button>
            <button
              type="button"
              className={`wizard-choice-card${productionStatus === "brewed_batch" ? " active" : ""}`}
              onClick={() => setProductionStatus("brewed_batch")}
            >
              <div className="wizard-choice-title">Al gebrouwen</div>
              <div className="wizard-choice-text">Leg direct de echte batch vast met LOT en brouwdatum.</div>
            </button>
          </div>

          {productionStatus === "brewed_batch" ? (
            <div className="form-grid two" style={{ marginTop: 12 }}>
              <label className="form-field">
                <span>LOT nummer *</span>
                <input
                  value={lotnummer}
                  placeholder="Bijvoorbeeld BZB0001"
                  onChange={(event) => updateBrouwmomentField("lotnummer", event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Brouwdatum *</span>
                <input
                  type="date"
                  value={brouwdatum}
                  onChange={(event) => updateBrouwmomentField("brouwdatum", event.target.value)}
                />
              </label>
              <label className="form-field form-field-wide">
                <span>Notitie</span>
                <input
                  value={String((brouwmoment as any).notitie ?? "")}
                  onChange={(event) => updateBrouwmomentField("notitie", event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

