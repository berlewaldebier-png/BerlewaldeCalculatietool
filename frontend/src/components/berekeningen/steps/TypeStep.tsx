"use client";

type GenericRecord = Record<string, unknown>;
type BerekeningSubjectType = "bier" | "artikel" | "dienst";

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

  return (
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
              (draft.soort_berekening as GenericRecord).type = option;
            });
            setActiveStepIndex(2);
          }}
        >
          <div className="wizard-choice-title">{option}</div>
          <div className="wizard-choice-text">{text}</div>
        </button>
      ))}
    </div>
  );
}

