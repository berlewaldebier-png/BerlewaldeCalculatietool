"use client";

import { InkoopFactuurEditor } from "@/components/inkoopfacturen/InkoopFactuurEditor";

type GenericRecord = Record<string, unknown>;
type BerekeningSubjectType = "bier" | "artikel" | "dienst";

export function InkoopInputStep({
  current,
  basisproducten,
  samengesteldeProducten,
  updateCurrent,
  requestDelete,
  getProductUnitOptions,
  getFactuurRegelLiters,
  formatCurrencyDisplay,
  formatDecimalValue,
  calculateInkoopExtraKostenPerRegel,
  calculateInkoopPrijsPerEenheid,
  calculateInkoopPrijsPerLiter,
  getFactuurRegelAfvulkostenFust,
}: {
  current: GenericRecord;
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  updateCurrent: (updater: (draft: GenericRecord) => void) => void;
  requestDelete: (title: string, body: string, onConfirm: () => void) => void;
  getProductUnitOptions: (jaar: number, basisproducten: GenericRecord[], samengesteldeProducten: GenericRecord[], current: GenericRecord) => any[];
  getFactuurRegelLiters: (
    regel: GenericRecord,
    jaar: number,
    basisproducten: GenericRecord[],
    samengesteldeProducten: GenericRecord[],
    fallbackRow: GenericRecord
  ) => number | null;
  formatCurrencyDisplay: (value: unknown) => string;
  formatDecimalValue: (value: number | null | undefined, digits?: number) => string;
  calculateInkoopExtraKostenPerRegel: (inkoop: GenericRecord, regelCount: number) => number;
  calculateInkoopPrijsPerEenheid: (regel: GenericRecord, extra: number) => number;
  calculateInkoopPrijsPerLiter: (
    regel: GenericRecord,
    extra: number,
    jaar: number,
    basisproducten: GenericRecord[],
    samengesteldeProducten: GenericRecord[],
    fallbackRow: GenericRecord
  ) => number;
  getFactuurRegelAfvulkostenFust: (regel: GenericRecord) => number;
}) {
  const inkoop = ((current.invoer as GenericRecord).inkoop as GenericRecord) ?? {};
  const factuurregels = Array.isArray((inkoop as any).factuurregels) ? ((inkoop as any).factuurregels as GenericRecord[]) : [];
  const jaar = Number(((current.basisgegevens as GenericRecord)?.jaar ?? 0));
  const basis = (current.basisgegevens as GenericRecord) ?? {};
  const subjectType = (String((basis as any).sku_type ?? "bier").trim() || "bier") as BerekeningSubjectType;
  const uom =
    String((basis as any).uom ?? "").trim() ||
    (subjectType === "dienst" ? "uur" : subjectType === "artikel" ? "stuk" : "");
  const unitOptions = getProductUnitOptions(jaar, basisproducten, samengesteldeProducten, current);

  return (
    <InkoopFactuurEditor
      subjectType={subjectType}
      uom={uom}
      uomValue={String((current.basisgegevens as GenericRecord)?.uom ?? uom)}
      onChangeUomValue={(nextUom) =>
        updateCurrent((draft) => {
          (draft.basisgegevens as GenericRecord).uom = nextUom;
          const regels =
            ((((draft.invoer as GenericRecord).inkoop as GenericRecord).factuurregels as GenericRecord[]) ?? []);
          regels.forEach((regel) => {
            (regel as any).eenheid = nextUom;
            (regel as any).liters = 0;
            (regel as any).afvulkosten_fust = null;
          });
        })
      }
      year={jaar}
      inkoop={inkoop}
      factuurregels={factuurregels}
      unitOptions={unitOptions}
      basisproducten={basisproducten}
      samengesteldeProducten={samengesteldeProducten}
      fallbackRow={current}
      onChangeInkoopField={(key, value) =>
        updateCurrent((draft) => {
          (((draft.invoer as GenericRecord).inkoop as GenericRecord) as any)[key] = value as any;
        })
      }
      onChangeRegel={(index, patch) =>
        updateCurrent((draft) => {
          const regels =
            ((((draft.invoer as GenericRecord).inkoop as GenericRecord).factuurregels as GenericRecord[]) ?? []);
          regels[index] = { ...regels[index], ...patch };
        })
      }
      onDeleteRegel={(index) =>
        updateCurrent((draft) => {
          const regels =
            ((((draft.invoer as GenericRecord).inkoop as GenericRecord).factuurregels as GenericRecord[]) ?? []);
          regels.splice(index, 1);
        })
      }
      onAddRegel={(regel) =>
        updateCurrent((draft) => {
          const regels =
            ((((draft.invoer as GenericRecord).inkoop as GenericRecord).factuurregels as GenericRecord[]) ?? []);
          regels.push(regel);
        })
      }
      requestDelete={(title, body, onConfirm) => requestDelete(title, body, onConfirm)}
      getFactuurRegelLiters={(regel) =>
        getFactuurRegelLiters(regel, jaar, basisproducten, samengesteldeProducten, current) ?? 0
      }
      formatCurrencyDisplay={formatCurrencyDisplay}
      formatDecimalValue={formatDecimalValue}
      calculateInkoopExtraKostenPerRegel={calculateInkoopExtraKostenPerRegel}
      calculateInkoopPrijsPerEenheid={calculateInkoopPrijsPerEenheid}
      calculateInkoopPrijsPerLiter={(regel, extraPer) =>
        calculateInkoopPrijsPerLiter(regel, extraPer, jaar, basisproducten, samengesteldeProducten, current)
      }
      getFactuurRegelAfvulkostenFust={getFactuurRegelAfvulkostenFust}
    />
  );
}
