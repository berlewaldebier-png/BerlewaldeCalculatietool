"use client";

import { useEffect, useMemo, useState } from "react";

import { createId } from "@/components/berekeningen/berekeningenWizardUtils";
import { CurrencyInput, TrashIcon } from "@/components/berekeningen/BerekeningenWizardParts";

type GenericRecord = Record<string, unknown>;

export type InkoopFactuurSubjectType = "bier" | "artikel" | "dienst";

export type ProductUnitOption = {
  id: string;
  label: string;
  litersPerUnit: number;
  source?: GenericRecord;
};

export type InkoopFactuurEditorProps = {
  subjectType: InkoopFactuurSubjectType;
  uom: string;
  year: number;
  inkoop: GenericRecord;
  factuurregels: GenericRecord[];
  unitOptions: ProductUnitOption[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  fallbackRow?: GenericRecord;
  canEdit?: boolean;
  onChangeInkoopField: (key: "factuurnummer" | "factuurdatum" | "verzendkosten" | "overige_kosten", value: unknown) => void;
  uomValue?: string;
  onChangeUomValue?: (nextUom: string) => void;
  onChangeRegel: (index: number, patch: Partial<GenericRecord>) => void;
  onDeleteRegel: (index: number) => void;
  onAddRegel: (regel: GenericRecord) => void;
  requestDelete: (title: string, body: string, onConfirm: () => void) => void;
  getFactuurRegelLiters: (regel: GenericRecord) => number;
  formatCurrencyDisplay: (value: number) => string;
  formatDecimalValue: (value: number, decimals?: number) => string;
  calculateInkoopExtraKostenPerRegel: (inkoop: GenericRecord, regelCount: number) => number;
  calculateInkoopPrijsPerEenheid: (regel: GenericRecord, extraKostenPerRegel: number) => number;
  calculateInkoopPrijsPerLiter: (regel: GenericRecord, extraKostenPerRegel: number) => number;
  getFactuurRegelAfvulkostenFust: (regel: GenericRecord) => number;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function isFustOption(option: ProductUnitOption | undefined | null) {
  if (!option) return false;
  const source = option.source ?? {};
  const haystack = [
    option.label,
    (source as any)?.omschrijving,
    (source as any)?.verpakking,
    (source as any)?.verpakkingstype,
    (source as any)?.pack_type,
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  return haystack.includes("fust");
}

export function InkoopFactuurEditor(props: InkoopFactuurEditorProps) {
  const canEdit = Boolean(props.canEdit ?? true);
  const [aantalDraftById, setAantalDraftById] = useState<Record<string, string>>({});

  useEffect(() => {
    // Seed draft values from incoming regels. Don't overwrite existing drafts so typing stays stable.
    setAantalDraftById((prev) => {
      const next: Record<string, string> = { ...prev };
      (Array.isArray(props.factuurregels) ? props.factuurregels : []).forEach((regel) => {
        const id = String((regel as any)?.id ?? "");
        if (!id) return;
        if (Object.prototype.hasOwnProperty.call(next, id)) return;
        const value = (regel as any)?.aantal;
        next[id] = value === null || value === undefined ? "" : String(value);
      });
      return next;
    });
  }, [props.factuurregels]);
  const extraKostenPerRegel = props.calculateInkoopExtraKostenPerRegel(
    props.inkoop,
    props.factuurregels.length
  );

  const unitOptionsById = useMemo(
    () => new Map(props.unitOptions.map((option) => [option.id, option])),
    [props.unitOptions]
  );

  const totaalSubfactuurbedrag = props.factuurregels.reduce(
    (sum, regel) => sum + Number(regel.subfactuurbedrag ?? 0),
    0
  );
  const totaalAfvulkostenFust =
    props.subjectType === "bier"
      ? props.factuurregels.reduce(
          (sum, regel) => sum + props.getFactuurRegelAfvulkostenFust(regel),
          0
        )
      : 0;
  const totaalFactuurbedrag = totaalSubfactuurbedrag + totaalAfvulkostenFust;
  const totaalExtraKosten =
    Number(props.inkoop.verzendkosten ?? 0) + Number(props.inkoop.overige_kosten ?? 0);
  const totaalBronkosten = totaalFactuurbedrag + totaalExtraKosten;

  const totaalLiters =
    props.subjectType === "bier"
      ? props.factuurregels.reduce((sum, regel) => sum + Number(props.getFactuurRegelLiters(regel) ?? 0), 0)
      : 0;
  const gemiddeldePrijsPerLiter = totaalLiters > 0 ? totaalBronkosten / totaalLiters : 0;

  const totaalAantal = props.factuurregels.reduce((sum, regel) => sum + Number(regel.aantal ?? 0), 0);
  const gemiddeldePrijsPerEenheid =
    totaalAantal > 0 ? (totaalFactuurbedrag + totaalExtraKosten) / totaalAantal : 0;

  const resolvedUomValue = String(props.uomValue ?? props.uom ?? "").trim();

  return (
    <div className="wizard-stack">
      <div className="wizard-form-grid">
        {(
          [
            ["Factuurnummer", "factuurnummer"],
            ["Factuurdatum", "factuurdatum"],
          ] as const
        ).map(([label, key]) => (
          <label key={key} className="nested-field">
            <span>{label}</span>
            <input
              className="dataset-input"
              type="text"
              value={String(props.inkoop[key] ?? "")}
              readOnly={!canEdit}
              onChange={(event) => props.onChangeInkoopField(key, event.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="stats-grid wizard-stats-grid wizard-inkoop-stats-grid">
        <div className="stat-card">
          <div className="stat-label">Factuurbedragen</div>
          <div className="stat-value small">{props.formatCurrencyDisplay(totaalFactuurbedrag)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Extra kosten</div>
          <div className="stat-value small">
            {props.formatCurrencyDisplay(totaalExtraKosten)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Totaal factuur</div>
          <div className="stat-value small">{props.formatCurrencyDisplay(totaalBronkosten)}</div>
        </div>

        {props.subjectType === "bier" ? (
          <>
            <div className="stat-card">
              <div className="stat-label">Totaal liters</div>
              <div className="stat-value small">
                {totaalLiters > 0 ? props.formatDecimalValue(totaalLiters, 2) : "-"}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Gem. prijs per liter</div>
              <div className="stat-value small">
                {totaalLiters > 0 ? props.formatCurrencyDisplay(gemiddeldePrijsPerLiter) : "-"}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="stat-card">
              <div className="stat-label">Totaal {props.uom || "eenheden"}</div>
              <div className="stat-value small">
                {totaalAantal > 0 ? props.formatDecimalValue(totaalAantal, 0) : "-"}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Gem. prijs per {props.uom || "eenheid"}</div>
              <div className="stat-value small">
                {totaalAantal > 0 ? props.formatCurrencyDisplay(gemiddeldePrijsPerEenheid) : "-"}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="wizard-form-grid">
        {(
          [
            ["Verzendkosten", "verzendkosten"],
            ["Overige kosten", "overige_kosten"],
          ] as const
        ).map(([label, key]) => (
          <label key={key} className="nested-field">
            <span>{label}</span>
            <CurrencyInput
              className="dataset-input"
              type="number"
              step="any"
              value={String(props.inkoop[key] ?? "")}
              readOnly={!canEdit}
              onChange={(event) =>
                props.onChangeInkoopField(
                  key,
                  event.target.value === "" ? null : Number(event.target.value)
                )
              }
            />
          </label>
        ))}
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table wizard-table-compact wizard-table-fit">
          <thead>
            <tr>
              <th>Aantal</th>
              <th>Eenheid</th>
              <th>Factuurbedrag</th>
              {props.subjectType === "bier" ? <th>Afvulkosten fust</th> : null}
              {props.subjectType === "bier" ? <th>Liters</th> : null}
              <th>Extra kosten</th>
              <th>Prijs per eenheid</th>
              {props.subjectType === "bier" ? <th>Prijs per liter</th> : null}
              <th />
            </tr>
          </thead>
          <tbody>
            {props.factuurregels.map((regel, index) => (
              <tr key={String(regel.id ?? index)}>
                <td>
                  <input
                    className="dataset-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={aantalDraftById[String(regel.id ?? "")] ?? String(regel.aantal ?? "")}
                    disabled={!canEdit}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const rowId = String(regel.id ?? "");
                      setAantalDraftById((prev) => ({ ...prev, [rowId]: raw }));

                      if (raw.trim() === "") {
                        // Allow empty while editing.
                        return;
                      }
                      const nextAantal = Number(raw);
                      if (!Number.isFinite(nextAantal)) return;
                      if (props.subjectType === "bier") {
                        const nextRegel = { ...regel, aantal: nextAantal };
                        props.onChangeRegel(index, {
                          aantal: nextAantal,
                          liters: props.getFactuurRegelLiters(nextRegel),
                        });
                        return;
                      }
                      props.onChangeRegel(index, {
                        aantal: nextAantal,
                        liters: 0,
                        afvulkosten_fust: null,
                        eenheid: text(props.uom),
                      });
                    }}
                    onBlur={() => {
                      const rowId = String(regel.id ?? "");
                      const raw = String(aantalDraftById[rowId] ?? "").trim();
                      const nextAantal = raw === "" ? 0 : Number(raw);
                      setAantalDraftById((prev) => ({ ...prev, [rowId]: String(Number.isFinite(nextAantal) ? nextAantal : 0) }));

                      if (!Number.isFinite(nextAantal)) return;
                      if (props.subjectType === "bier") {
                        const nextRegel = { ...regel, aantal: nextAantal };
                        props.onChangeRegel(index, {
                          aantal: nextAantal,
                          liters: props.getFactuurRegelLiters(nextRegel),
                        });
                        return;
                      }
                      props.onChangeRegel(index, {
                        aantal: nextAantal,
                        liters: 0,
                        afvulkosten_fust: null,
                        eenheid: text(props.uom),
                      });
                    }}
                  />
                </td>
                <td>
                  {props.subjectType === "bier" ? (
                    <select
                      className="dataset-input wizard-unit-select"
                      value={String(regel.eenheid ?? "")}
                      disabled={!canEdit}
                      onChange={(event) => {
                        const nextEenheid = event.target.value;
                        const nextRegel = { ...regel, eenheid: nextEenheid };
                        props.onChangeRegel(index, {
                          eenheid: nextEenheid,
                          liters: props.getFactuurRegelLiters(nextRegel),
                        });
                      }}
                    >
                      <option value="">Selecteer verpakking</option>
                      {props.unitOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      className="dataset-input wizard-unit-select"
                      value={resolvedUomValue}
                      disabled={!canEdit}
                      onChange={(event) => props.onChangeUomValue?.(event.target.value)}
                    >
                      <option value="stuk">stuk</option>
                      <option value="pakket">pakket</option>
                      <option value="uur">uur</option>
                      <option value="gram">gram</option>
                      <option value="kg">kg</option>
                      <option value="liter">liter</option>
                    </select>
                  )}
                </td>
                <td>
                  <CurrencyInput
                    className="dataset-input"
                    type="number"
                    step="0.01"
                    value={String(regel.subfactuurbedrag ?? "")}
                    readOnly={!canEdit}
                    onChange={(event) =>
                      props.onChangeRegel(index, {
                        subfactuurbedrag: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                  />
                </td>
                {props.subjectType === "bier" ? (
                  <td>
                    {(() => {
                      const selected = unitOptionsById.get(String(regel.eenheid ?? "")) ?? null;
                      const isFust = isFustOption(selected);
                      return (
                        <CurrencyInput
                          className="dataset-input"
                          type="number"
                          step="0.01"
                          value={isFust ? String(regel.afvulkosten_fust ?? "") : ""}
                          readOnly={!canEdit || !isFust}
                          onChange={(event) =>
                            props.onChangeRegel(index, {
                              afvulkosten_fust: event.target.value === "" ? null : Number(event.target.value),
                            })
                          }
                        />
                      );
                    })()}
                  </td>
                ) : null}
                {props.subjectType === "bier" ? (
                  <td>
                    <input
                      className="dataset-input dataset-input-readonly"
                      type="number"
                      step="0.01"
                      value={props.formatDecimalValue(props.getFactuurRegelLiters(regel) ?? 0)}
                      readOnly
                    />
                  </td>
                ) : null}
                <td>
                  <CurrencyInput
                    className="dataset-input dataset-input-readonly"
                    type="number"
                    step="0.01"
                    value={props.formatDecimalValue(extraKostenPerRegel)}
                    readOnly
                  />
                </td>
                <td>
                  <CurrencyInput
                    className="dataset-input dataset-input-readonly"
                    type="number"
                    step="0.01"
                    value={props.formatDecimalValue(
                      props.calculateInkoopPrijsPerEenheid(regel, extraKostenPerRegel)
                    )}
                    readOnly
                  />
                </td>
                {props.subjectType === "bier" ? (
                  <td>
                    <CurrencyInput
                      className="dataset-input dataset-input-readonly"
                      type="number"
                      step="0.01"
                      value={props.formatDecimalValue(
                        props.calculateInkoopPrijsPerLiter(regel, extraKostenPerRegel)
                      )}
                      readOnly
                    />
                  </td>
                ) : null}
                <td>
                  <button
                    type="button"
                    className="icon-button-table"
                    aria-label="Factuurregel verwijderen"
                    title="Verwijderen"
                    disabled={!canEdit}
                  onClick={() =>
                    props.requestDelete(
                      "Factuurregel verwijderen",
                      "Weet je zeker dat je deze factuurregel wilt verwijderen?",
                      () => props.onDeleteRegel(index)
                    )
                  }
                >
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
            {props.factuurregels.length === 0 ? (
              <tr>
                <td className="dataset-empty" colSpan={props.subjectType === "bier" ? 9 : 7}>
                  Nog geen factuurregels. Voeg hieronder een regel toe.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="editor-actions">
        <button
          type="button"
          className="editor-button editor-button-secondary"
          disabled={!canEdit}
          onClick={() =>
            props.onAddRegel({
              id: createId(),
              aantal: 0,
              eenheid: props.subjectType === "bier" ? "" : props.uom,
              liters: 0,
              subfactuurbedrag: 0,
              afvulkosten_fust: null,
            })
          }
        >
          Factuurregel toevoegen
        </button>
      </div>
    </div>
  );
}
