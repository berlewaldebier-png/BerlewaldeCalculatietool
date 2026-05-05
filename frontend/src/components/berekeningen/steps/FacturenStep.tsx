"use client";

type GenericRecord = Record<string, unknown>;

type BerekeningSubjectType = "bier" | "artikel" | "dienst";

type ProductUnitOption = {
  id: string;
  label: string;
  litersPerUnit: number;
  source: GenericRecord;
};

type FacturenStepProps = {
  current: GenericRecord;
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  getProductUnitOptions: (
    jaar: number,
    basisproducten: GenericRecord[],
    samengesteldeProducten: GenericRecord[],
    fallbackRow?: GenericRecord
  ) => ProductUnitOption[];
  getProductUnitLabel: (unitId: string, options: ProductUnitOption[]) => string;
  getFactuurRegelLiters: (
    regel: GenericRecord,
    jaar: number,
    basisproducten: GenericRecord[],
    samengesteldeProducten: GenericRecord[]
  ) => number | null | undefined;
  formatCurrencyDisplay: (value: number) => string;
  formatDecimalValue: (value: number, decimals?: number) => string;
  calculateInkoopPrijsPerEenheid: (regel: GenericRecord, extraKostenPerRegel: number) => number;
  calculateInkoopPrijsPerLiter: (
    regel: GenericRecord,
    extraKostenPerRegel: number,
    jaar: number,
    basisproducten: GenericRecord[],
    samengesteldeProducten: GenericRecord[]
  ) => number;
};

export function FacturenStep({
  current,
  basisproducten,
  samengesteldeProducten,
  getProductUnitOptions,
  getProductUnitLabel,
  getFactuurRegelLiters,
  formatCurrencyDisplay,
  formatDecimalValue,
  calculateInkoopPrijsPerEenheid,
  calculateInkoopPrijsPerLiter
}: FacturenStepProps) {
  const inkoop = ((current.invoer as GenericRecord).inkoop as GenericRecord) ?? {};
  const facturen = Array.isArray(inkoop.facturen) ? (inkoop.facturen as GenericRecord[]) : [];
  const gekoppeldeFacturen = facturen.slice(1);
  const jaar = Number(((current.basisgegevens as GenericRecord)?.jaar ?? 0));
  const basis = (current.basisgegevens as GenericRecord) ?? {};
  const subjectType = (String(basis.sku_type ?? "bier").trim() || "bier") as BerekeningSubjectType;
  const unitOptions = getProductUnitOptions(jaar, basisproducten, samengesteldeProducten, current);
  const gekoppeldeRegels = gekoppeldeFacturen.flatMap((factuur, factuurIndex) => {
    const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
    const extraKostenPerRegel =
      regels.length > 0
        ? (Number(factuur.verzendkosten ?? 0) + Number(factuur.overige_kosten ?? 0)) / regels.length
        : 0;

    return regels.map((regel, regelIndex) => ({
      factuurnummer: String(factuur.factuurnummer ?? `Factuur ${factuurIndex + 2}`),
      regel,
      regelIndex,
      extraKostenPerRegel
    }));
  });

  return (
    <div className="nested-editor-list">
      <div className="module-card compact-card">
        <div className="module-card-title">
          {gekoppeldeFacturen.length === 1 ? "Gekoppelde factuur" : "Gekoppelde facturen"}
        </div>
        <div className="module-card-text">
          Hier zie je alleen de extra facturen die zijn toegevoegd via Inkoopfacturen. De eerste
          factuur beheer je in de stap Inkoopfactuur.
        </div>
      </div>
      {gekoppeldeFacturen.length === 0 ? (
        <div className="module-card compact-card">
          <div className="module-card-text">
            Nog geen extra facturen gekoppeld via Inkoopfacturen. De eerste factuur beheer je in
            de stap Inkoopfactuur.
          </div>
        </div>
      ) : null}
      {gekoppeldeRegels.length > 0 ? (
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact wizard-table-fit wizard-linked-facturen-table">
            <thead>
              <tr>
                <th>Factuurnummer</th>
                <th>Aantal</th>
                <th>Eenheid</th>
                <th>Factuurbedrag</th>
                {subjectType === "bier" ? <th>Liters</th> : null}
                <th>Extra kosten</th>
                <th>Prijs per eenheid</th>
                {subjectType === "bier" ? <th>Prijs per liter</th> : null}
              </tr>
            </thead>
            <tbody>
              {gekoppeldeRegels.map(({ factuurnummer, regel, regelIndex, extraKostenPerRegel }) => (
                <tr key={`${factuurnummer}-${String(regel.id ?? regelIndex)}`}>
                  <td>{factuurnummer}</td>
                  <td>{formatDecimalValue(Number(regel.aantal ?? 0), 0)}</td>
                  <td>
                    {subjectType === "bier"
                      ? getProductUnitLabel(String(regel.eenheid ?? ""), unitOptions) || "-"
                      : String(regel.eenheid ?? "-")}
                  </td>
                  <td>{formatCurrencyDisplay(Number(regel.subfactuurbedrag ?? 0))}</td>
                  {subjectType === "bier" ? (
                    <td>
                      {formatDecimalValue(
                        getFactuurRegelLiters(regel, jaar, basisproducten, samengesteldeProducten) ?? 0
                      )}
                    </td>
                  ) : null}
                  <td>{formatCurrencyDisplay(extraKostenPerRegel)}</td>
                  <td>{formatCurrencyDisplay(calculateInkoopPrijsPerEenheid(regel, extraKostenPerRegel))}</td>
                  {subjectType === "bier" ? (
                    <td>
                      {formatCurrencyDisplay(
                        calculateInkoopPrijsPerLiter(
                          regel,
                          extraKostenPerRegel,
                          jaar,
                          basisproducten,
                          samengesteldeProducten
                        )
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

