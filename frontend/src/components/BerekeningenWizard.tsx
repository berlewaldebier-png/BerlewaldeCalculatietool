"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { usePageShellHeader } from "@/components/PageShell";
import { WizardSteps } from "@/components/WizardSteps";
import { API_BASE_URL } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiClient";
import {
  activateKostprijsversie,
  saveKostprijsversies,
  tryReadApiDetail,
} from "@/components/berekeningen/berekeningenWizardIo";
import { vasteKostenPerLiter } from "@/lib/kostprijsEngine";
import {
  createPackagingResolvers,
  computeResultaatSnapshot,
  type ResultaatSnapshot,
  type SummaryProductRow
} from "@/lib/kostprijsSnapshotEngine";
import {
  cloneRecord,
  createId,
  parseOptionalNumber,
  parseOptionalNumberFromInput,
  syncPrimaryInkoopFactuur,
  unwrapDatasetListPayload,
} from "@/components/berekeningen/berekeningenWizardUtils";
import {
  buildResultaatSnapshotFromWizard,
  validateCurrentBeforePersistFromWizard,
} from "@/components/berekeningen/berekeningenWizardDerivations";
import { CurrencyInput, TrashIcon } from "@/components/berekeningen/BerekeningenWizardParts";
import {
  formatCurrencyDisplay,
  formatDecimalValue,
  roundValue,
  toSummaryValue,
} from "@/components/berekeningen/berekeningenWizardFormatting";
import { BasisStep } from "@/components/berekeningen/steps/BasisStep";
import { TypeStep } from "@/components/berekeningen/steps/TypeStep";
import { SummaryStep } from "@/components/berekeningen/steps/SummaryStep";
import { InkoopInputStep } from "@/components/berekeningen/steps/InkoopInputStep";
import { FacturenStep } from "@/components/berekeningen/steps/FacturenStep";
import { EigenProductieInputStep } from "@/components/berekeningen/steps/EigenProductieInputStep";
import {
  buildWizardSteps,
  calculateEigenProductieKostenRecept,
  calculateEigenProductiePrijsPerEenheid,
  calculateInkoopExtraKostenPerRegel,
  calculateInkoopPrijsPerEenheid,
  calculateInkoopPrijsPerLiter,
  calculateVariabeleKostenPerLiter,
  createEmptyBerekening,
  expandSelectedInkoopProductsToBasisproducten,
  getBerekeningProcessType,
  getDirecteVasteKostenPerLiter,
  getFactuurRegelAfvulkostenFust,
  getFactuurRegelLiters,
  getIngredientType,
  getInkoopFactuurregels,
  getProductDisplayName,
  getProductUnitLabel,
  getProductUnitOptions,
  getSelectedInkoopProducts,
  getSelectedInkoopProductRows,
  getYearProduction,
  hasMeaningfulFacturen,
  isFustOption,
  normalizeBerekening
} from "@/components/berekeningen/berekeningenWizardLegacyHelpers";

type GenericRecord = Record<string, unknown>;

type StepDefinition = {
  id: string;
  label: string;
  description: string;
};

type BerekeningProcessType = "Eigen productie" | "Inkoop";
type BerekeningSubjectType = "bier" | "artikel" | "dienst";

export type BerekeningenWizardPersistResult = {
  id: string;
  year: number;
  status: string;
};

type BerekeningenWizardProps = {
  initialRows: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  productie: Record<string, GenericRecord>;
  vasteKosten: Record<string, GenericRecord[]>;
  tarievenHeffingen: GenericRecord[];
  packagingComponentPrices: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  initialSelectedId?: string;
  startWithNew?: boolean;
  onBackToLanding?: () => void;
  onRowsChange?: (rows: GenericRecord[]) => void;
  onPersisted?: (result: BerekeningenWizardPersistResult) => void;
  onFinish?: () => void;
};

type PendingDeleteDialog = {
  title: string;
  body: string;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  hideCancel?: boolean;
};

type ProductUnitOption = {
  id: string;
  label: string;
  litersPerUnit: number;
  source: GenericRecord;
};

type SelectedInkoopProduct = {
  product: GenericRecord;
  prijsPerEenheid: number;
};

type EnrichedFactuurRegel = {
  regel: GenericRecord;
  extraKostenPerRegel: number;
};

const KOSTPRIJSVERSIES_API = `${API_BASE_URL}/data/kostprijsversies`;

export function BerekeningenWizard({
  initialRows,
  basisproducten,
  samengesteldeProducten,
  productie,
  vasteKosten,
  tarievenHeffingen,
  packagingComponentPrices,
  kostprijsproductactiveringen,
  initialSelectedId,
  startWithNew = false,
  onBackToLanding,
  onRowsChange,
  onPersisted,
  onFinish
}: BerekeningenWizardProps) {
  const productieJaren = useMemo(
    () =>
      Object.keys(productie ?? {})
        .map((year) => Number(year))
        .filter((year) => Number.isFinite(year) && year > 0)
        .sort((a, b) => b - a),
    [productie]
  );
  const defaultProductieJaar = productieJaren[0] ?? new Date().getFullYear();

  const initialState = useMemo(() => {
    const normalizedRows = initialRows.map((row) => normalizeBerekening(row));

    if (startWithNew || normalizedRows.length === 0) {
      const next = createEmptyBerekening();
      // Default new calculations to a valid production year (keeps UI consistent with stamdata).
      if (productieJaren.length > 0) {
        (next.basisgegevens as GenericRecord).jaar = defaultProductieJaar;
      }
      return {
        rows: [next, ...normalizedRows],
        selectedId: String(next.id)
      };
    }

    const matchedRow = initialSelectedId
      ? normalizedRows.find((row) => String(row.id) === String(initialSelectedId))
      : normalizedRows[0];

    return {
      rows: normalizedRows,
      selectedId: String(matchedRow?.id ?? normalizedRows[0]?.id ?? createEmptyBerekening().id)
    };
  }, [defaultProductieJaar, initialRows, initialSelectedId, productieJaren.length, startWithNew]);

  const [rows, setRows] = useState<GenericRecord[]>(initialState.rows);
  const rowsRef = useRef<GenericRecord[]>(initialState.rows);
  const [selectedId, setSelectedId] = useState<string>(initialState.selectedId);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteDialog | null>(null);
  const [persistedIds, setPersistedIds] = useState<string[]>(
    startWithNew ? [] : initialRows.map((row) => String((row as GenericRecord)?.id ?? "")).filter(Boolean)
  );

  const effectiveSelectedId = useMemo(() => {
    if (rows.some((row) => String(row.id) === String(selectedId))) {
      return String(selectedId);
    }
    return String(rows[0]?.id ?? "");
  }, [rows, selectedId]);

  useEffect(() => {
    if (effectiveSelectedId && effectiveSelectedId !== String(selectedId)) {
      setSelectedId(effectiveSelectedId);
    }
  }, [effectiveSelectedId, selectedId]);

  const current =
    rows.find((row) => String(row.id) === effectiveSelectedId) ?? rows[0] ?? createEmptyBerekening();
  const isEditingExisting = !startWithNew || persistedIds.includes(effectiveSelectedId);
  const processType = getBerekeningProcessType(current);
  const steps = buildWizardSteps(current);
  const currentIndex = Math.min(activeStepIndex, steps.length - 1);
  const currentStep = steps[currentIndex] ?? steps[0];
  const isCurrentDefinitive = String(current.status ?? "").trim().toLowerCase() === "definitief";
  const isCurrentReferencedByActivation = useMemo(
    () =>
      (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []).some(
        (row) => String((row as any)?.kostprijsversie_id ?? "") === String(current.id ?? "")
      ),
    [current.id, kostprijsproductactiveringen]
  );
  const canDeleteCurrent = isEditingExisting && !isCurrentDefinitive && !isCurrentReferencedByActivation;
  const pageHeader = useMemo(
    () => ({
      title: String((current.basisgegevens as GenericRecord)?.biernaam ?? "").trim() || "Nieuwe kostprijsberekening",
      subtitle:
        processType === "Inkoop"
          ? "Werk de inkoopkostprijs stap voor stap uit, inclusief producten, facturen en samenvatting."
          : "Werk de kostprijs stap voor stap uit vanuit recept, ingredienten en verpakkingen."
    }),
    [current.basisgegevens, processType]
  );

  usePageShellHeader(pageHeader);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  function requestDelete(
    title: string,
    body: string,
    onConfirm: () => void,
    options?: Pick<PendingDeleteDialog, "confirmLabel" | "cancelLabel" | "hideCancel">
  ) {
    setPendingDelete({ title, body, onConfirm, ...options });
  }

  const buildResultaatSnapshot = (row: GenericRecord): ResultaatSnapshot =>
    buildResultaatSnapshotFromWizard({
      row,
      productie,
      vasteKosten,
      tarievenHeffingen: Array.isArray(tarievenHeffingen) ? (tarievenHeffingen as any[]) : [],
      packagingComponentPrices: Array.isArray(packagingComponentPrices) ? (packagingComponentPrices as any[]) : [],
      basisproducten: Array.isArray(basisproducten) ? (basisproducten as any[]) : [],
      samengesteldeProducten: Array.isArray(samengesteldeProducten) ? (samengesteldeProducten as any[]) : [],
      getYearProduction,
      getProductDisplayName,
      calculateVariabeleKostenPerLiter,
      getSelectedInkoopProducts,
      expandSelectedInkoopProductsToBasisproducten,
    });

  function updateCurrent(updater: (draft: GenericRecord) => void) {
    setRows((currentRows) =>
      {
        const nextRows = currentRows.map((row) => {
        if (String(row.id) !== String(current.id)) {
          return row;
        }
        const next = cloneRecord(row);
        updater(next);
        syncPrimaryInkoopFactuur(next);
        next.updated_at = new Date().toISOString();
        return next;
      });
        rowsRef.current = nextRows;
        return nextRows;
      }
    );
  }

  async function handleSave() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);
    try {
      const validationError = validateCurrentBeforePersist();
      if (validationError) {
        setStatus(validationError);
        setStatusTone("error");
        return false;
      }
      const sourceRows = rowsRef.current;
      const payload = sourceRows.map((row) => {
        const next = cloneRecord(row);
        next.bier_snapshot = cloneRecord((row.basisgegevens as GenericRecord) ?? {});
        next.resultaat_snapshot = buildResultaatSnapshot(row);
        return next;
      });
      await saveKostprijsversies(payload);
      const refreshedResponse = await fetch(KOSTPRIJSVERSIES_API, {
        cache: "no-store"
      });
      const refreshedRows = refreshedResponse.ok
        ? unwrapDatasetListPayload(await refreshedResponse.json()) ?? payload
        : payload;
      rowsRef.current = refreshedRows;
      setRows(refreshedRows);
      setPersistedIds((currentIds) =>
        currentIds.includes(String(current.id ?? "")) ? currentIds : [...currentIds, String(current.id ?? "")]
      );
      onRowsChange?.(refreshedRows);
      onPersisted?.({
        id: String(current.id ?? ""),
        year: Number(((current.basisgegevens as GenericRecord)?.jaar ?? current.jaar ?? 0) || 0),
        status: String(current.status ?? "concept")
      });
      setStatus("Kostprijsversies opgeslagen.");
      setStatusTone("success");
      return true;
    } catch {
      setStatus("Opslaan mislukt.");
      setStatusTone("error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleFinalize() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);
    try {
      const validationError = validateCurrentBeforePersist();
      if (validationError) {
        setStatus(validationError);
        setStatusTone("error");
        return false;
      }
      const basis = (current.basisgegevens as GenericRecord) ?? {};
      const biernaam = String(basis.biernaam ?? "").trim();
      const alcoholpercentage = parseOptionalNumber(basis.alcoholpercentage);
      if (biernaam && alcoholpercentage === null) {
        setStatus("Alcoholpercentage is verplicht en moet een geldig getal zijn voordat je kunt afronden.");
        setStatusTone("error");
        return false;
      }

      const nowIso = new Date().toISOString();
      const payload = rowsRef.current.map((row) => {
        const next = cloneRecord(row);
        if (String(next.id) === String(current.id)) {
          next.status = "definitief";
          next.finalized_at = nowIso;
          next.updated_at = nowIso;
        }
        next.bier_snapshot = cloneRecord((next.basisgegevens as GenericRecord) ?? {});
        next.resultaat_snapshot = buildResultaatSnapshot(next);
        return next;
      });
      await saveKostprijsversies(payload);
      const refreshedResponse = await fetch(KOSTPRIJSVERSIES_API, {
        cache: "no-store"
      });
      const refreshedRows = refreshedResponse.ok
        ? unwrapDatasetListPayload(await refreshedResponse.json()) ?? payload
        : payload;
      rowsRef.current = refreshedRows;
      setRows(refreshedRows);
      setPersistedIds((currentIds) =>
        currentIds.includes(String(current.id ?? "")) ? currentIds : [...currentIds, String(current.id ?? "")]
      );
      onRowsChange?.(refreshedRows);
      onPersisted?.({
        id: String(current.id ?? ""),
        year: Number(((current.basisgegevens as GenericRecord)?.jaar ?? current.jaar ?? 0) || 0),
        status: "definitief"
      });
      // Auto-activate after finalize: a definitive version should be immediately quoteable.
      const updatedCurrent =
        refreshedRows.find((row) => String((row as any).id ?? "") === String(current.id ?? "")) ?? current;
      const isAlreadyActive = Boolean((updatedCurrent as any)?.is_actief);
      if (!isAlreadyActive) {
        try {
          await activateKostprijsversie(String(current.id ?? ""));
        } catch (error) {
          const detail = tryReadApiDetail(error);
          setStatus(detail ? `Afronden gelukt, activeren mislukt: ${detail}` : "Afronden gelukt, activeren mislukt.");
          setStatusTone("error");
          return false;
        }
        const afterActivate = await fetch(KOSTPRIJSVERSIES_API, { cache: "no-store" });
        const activatedRows = afterActivate.ok
          ? unwrapDatasetListPayload(await afterActivate.json()) ?? refreshedRows
          : refreshedRows;
        rowsRef.current = activatedRows;
        setRows(activatedRows);
        onRowsChange?.(activatedRows);
      }

      setStatus("Kostprijsversie definitief + actief.");
      setStatusTone("success");
      return true;
    } catch {
      setStatus("Afronden mislukt.");
      setStatusTone("error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  const validateCurrentBeforePersist = () =>
    validateCurrentBeforePersistFromWizard({
      current,
      basisproducten: Array.isArray(basisproducten) ? (basisproducten as any[]) : [],
      samengesteldeProducten: Array.isArray(samengesteldeProducten) ? (samengesteldeProducten as any[]) : [],
      getProductUnitOptions,
      isFustOption,
    });

  async function handleDeleteCurrent() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);
    try {
      const payload = rowsRef.current.filter((row) => String(row.id) !== String(current.id));
      await saveKostprijsversies(payload);
      rowsRef.current = payload;
      setRows(payload);
      onRowsChange?.(payload);
      setStatus("Berekening verwijderd.");
      setStatusTone("success");
      onBackToLanding?.();
    } catch (error) {
      let message = error instanceof Error ? error.message : "";
      const detail = tryReadApiDetail(error);
      if (detail) message = detail;
      setStatus(message || "Verwijderen mislukt.");
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleActivate() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);
    try {
      await activateKostprijsversie(String(current.id ?? ""));
      const refreshedResponse = await fetch(KOSTPRIJSVERSIES_API, { cache: "no-store" });
      const refreshedRows = refreshedResponse.ok
        ? unwrapDatasetListPayload(await refreshedResponse.json()) ?? rowsRef.current
        : rowsRef.current;
      rowsRef.current = refreshedRows;
      setRows(refreshedRows);
      onRowsChange?.(refreshedRows);
      setStatus("Kostprijsversie geactiveerd.");
      setStatusTone("success");
      return true;
    } catch {
      setStatus("Activeren mislukt.");
      setStatusTone("error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  function renderBasisStep() {
    return <BasisStep current={current} productieJaren={productieJaren} updateCurrent={updateCurrent} />;
  }

  function renderTypeStep() {
    return <TypeStep current={current} updateCurrent={updateCurrent} setActiveStepIndex={setActiveStepIndex} />;
  }

  function renderLegacyEigenProductieInput() {
    const ingredienten =
      ((((current.invoer as GenericRecord).ingredienten as GenericRecord).regels as GenericRecord[]) ??
        []);
    return (
      <div className="wizard-stack">
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Omschrijving</th>
                <th>Hoeveelheid</th>
                <th>Eenheid</th>
                <th>Prijs</th>
                <th>Benodigd in recept</th>
                <th>Actie</th>
              </tr>
            </thead>
            <tbody>
              {ingredienten.map((regel, index) => (
                <tr key={String(regel.id ?? index)}>
                  {[
                    [getIngredientType(regel), "ingredient"],
                    [String(regel.omschrijving ?? ""), "omschrijving"],
                    [String(regel.hoeveelheid ?? ""), "hoeveelheid"],
                    [String(regel.eenheid ?? ""), "eenheid"],
                    [String(regel.prijs ?? ""), "prijs"],
                    [String(regel.benodigd_in_recept ?? ""), "benodigd_in_recept"]
                  ].map(([value, key], cellIndex) => (
                    <td key={`${key}-${cellIndex}`}>
                      <input
                        className="dataset-input"
                        type={
                          key === "hoeveelheid" || key === "prijs" || key === "benodigd_in_recept"
                            ? "number"
                            : "text"
                        }
                        step={
                          key === "hoeveelheid" || key === "prijs" || key === "benodigd_in_recept"
                            ? "any"
                            : undefined
                        }
                        value={value}
                        onChange={(event) =>
                          updateCurrent((draft) => {
                            const regels =
                              ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                                .regels as GenericRecord[]) ?? []);
                            const nextValue =
                              key === "hoeveelheid" || key === "prijs" || key === "benodigd_in_recept"
                                ? event.target.value === ""
                                  ? null
                                  : Number(event.target.value)
                                : event.target.value;
                            if (key === "ingredient") {
                              regels[index]["ingredient"] = nextValue;
                            } else {
                              regels[index][key] = nextValue;
                            }
                          })
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      onClick={() =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                              .regels as GenericRecord[]) ?? []);
                          regels.splice(index, 1);
                        })
                      }
                    >
                      Verwijderen
                    </button>
                  </td>
                </tr>
              ))}
              {ingredienten.length === 0 ? (
                <tr>
                  <td className="dataset-empty" colSpan={7}>
                    Nog geen ingredientregels. Voeg hieronder een regel toe.
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
            onClick={() =>
              updateCurrent((draft) => {
                const regels =
                  ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                    .regels as GenericRecord[]) ?? []);
                regels.push({
                  id: createId(),
                  ingredient: "Overig",
                  omschrijving: "",
                  hoeveelheid: 0,
                  eenheid: "KG",
                  prijs: 0,
                  benodigd_in_recept: 0
                });
              })
            }
          >
            Ingredient toevoegen
          </button>
        </div>
      </div>
    );
  }

  function renderEigenProductieInputModern() {
    return (
      <EigenProductieInputStep
        current={current}
        rows={rows}
        productie={productie}
        updateCurrent={updateCurrent}
        requestDelete={requestDelete}
        createId={createId}
        getIngredientType={getIngredientType}
        getYearProduction={getYearProduction}
        calculateEigenProductieKostenRecept={calculateEigenProductieKostenRecept}
        calculateEigenProductiePrijsPerEenheid={calculateEigenProductiePrijsPerEenheid}
        formatCurrencyDisplay={formatCurrencyDisplay}
        formatDecimalValue={formatDecimalValue}
      />
    );
  }

  function renderInkoopInput() {
    return (
      <InkoopInputStep
        current={current}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        updateCurrent={updateCurrent}
        requestDelete={requestDelete}
        getProductUnitOptions={getProductUnitOptions}
        getFactuurRegelLiters={getFactuurRegelLiters}
        formatCurrencyDisplay={formatCurrencyDisplay}
        formatDecimalValue={formatDecimalValue}
        calculateInkoopExtraKostenPerRegel={calculateInkoopExtraKostenPerRegel}
        calculateInkoopPrijsPerEenheid={calculateInkoopPrijsPerEenheid}
        calculateInkoopPrijsPerLiter={calculateInkoopPrijsPerLiter}
        getFactuurRegelAfvulkostenFust={getFactuurRegelAfvulkostenFust}
      />
    );
  }

  function renderFacturenStep() {
    return (
      <FacturenStep
        current={current}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        getProductUnitOptions={getProductUnitOptions}
        getProductUnitLabel={getProductUnitLabel}
        getFactuurRegelLiters={getFactuurRegelLiters}
        formatCurrencyDisplay={formatCurrencyDisplay}
        formatDecimalValue={formatDecimalValue}
        calculateInkoopPrijsPerEenheid={calculateInkoopPrijsPerEenheid}
        calculateInkoopPrijsPerLiter={calculateInkoopPrijsPerLiter}
      />
    );
  }

  function renderSummaryStep() {
    return (
      <SummaryStep
        current={current}
        buildResultaatSnapshot={buildResultaatSnapshot}
        formatCurrencyDisplay={formatCurrencyDisplay}
        formatDecimalValue={formatDecimalValue}
      />
    );
  }

  function renderStepContent() {
    if (currentStep.id === "basis") return renderBasisStep();
    if (currentStep.id === "type") return renderTypeStep();
    if (currentStep.id === "input") {
      const type = String(((current.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
      return type === "Inkoop" ? renderInkoopInput() : renderEigenProductieInputModern();
    }
    if (currentStep.id === "facturen") return renderFacturenStep();
    return renderSummaryStep();
  }

  const headerBiernaam = String((current.basisgegevens as GenericRecord).biernaam ?? "").trim();
  const headerTitle = headerBiernaam || "Nieuwe kostprijsberekening";
  const headerYear = Number(((current.basisgegevens as GenericRecord)?.jaar ?? 0)) || 0;
  const headerType = String(((current.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
  const headerStatus = String(current.status ?? "concept");
  const headerActive = Boolean(current.is_actief);
  return (
    <div className="cpq-root">
      <div className="cpq-frame">
        <div className="cpq-topbar">
          <div>
            <div className="cpq-kicker">Kostprijswizard</div>
            <h1 className="cpq-title">{headerTitle}</h1>
          </div>
          <div className="cpq-topbar-actions">
            {onBackToLanding ? (
              <button type="button" className="editor-button editor-button-secondary" onClick={onBackToLanding}>
                Terug
              </button>
            ) : null}
            {isEditingExisting ? (
              <button
                type="button"
                className="icon-button-table"
                aria-label="Kostprijs verwijderen"
                aria-disabled={!canDeleteCurrent || isSaving}
                title={
                  !canDeleteCurrent
                    ? isCurrentDefinitive
                      ? "Definitieve kostprijsversies kun je niet verwijderen."
                      : "Deze kostprijsversie wordt nog gebruikt en kun je daarom niet verwijderen."
                    : "Verwijderen"
                }
                disabled={isSaving}
                onClick={() => {
                  if (!canDeleteCurrent) {
                    requestDelete(
                      "Kostprijs verwijderen niet mogelijk",
                      isCurrentDefinitive
                        ? "Definitieve kostprijsversies kun je niet verwijderen. Activeer een andere versie of maak een nieuwe conceptversie."
                        : "Deze kostprijsversie wordt nog gebruikt (bijv. door product-activaties) en kun je daarom niet verwijderen.",
                      () => {},
                      { confirmLabel: "Ok", hideCancel: true }
                    );
                    return;
                  }

                  requestDelete(
                    "Kostprijs verwijderen",
                    `Weet je zeker dat je de kostprijs voor ${String(
                      (current.basisgegevens as GenericRecord)?.biernaam ?? "dit bier"
                    )} wilt verwijderen? Dit kan alleen bij conceptversies.`,
                    () => {
                      void handleDeleteCurrent();
                    }
                  );
                }}
              >
                <TrashIcon />
              </button>
            ) : null}
            <span className="pill">
              {headerStatus}
              {headerActive ? " | actief" : ""}
            </span>
          </div>
        </div>

        <div className="cpq-grid cpq-grid-two">
          <aside className="cpq-left">
            <WizardSteps
              title="Stappen"
              steps={steps.map((step) => ({ id: step.id, title: step.label, description: step.description }))}
              activeIndex={currentIndex}
              onSelect={(index) => setActiveStepIndex(index)}
            />

          </aside>

          <main className="cpq-main">
            <div className="wizard-shell wizard-shell-single" style={{ marginTop: 0 }}>
              <div className="wizard-step-card wizard-step-stage-card">
                <div className="wizard-step-header">
                  <div>
                    <div className="wizard-step-title">
                      Stap {currentIndex + 1}: {currentStep.label}
                    </div>
                    <div className="wizard-step-description">{currentStep.description}</div>
                  </div>
                </div>

                <div className="wizard-step-body">{renderStepContent()}</div>

                <div className="editor-actions wizard-footer-actions">
                  <div className="editor-actions-group">
                    {currentIndex > 0 ? (
                      <button
                        type="button"
                        className="editor-button editor-button-secondary"
                        onClick={() => setActiveStepIndex(Math.max(0, currentIndex - 1))}
                      >
                        Vorige
                      </button>
                    ) : null}
                  </div>
                  <div className="editor-actions-group">
                    <button type="button" className="editor-button editor-button-secondary" onClick={handleSave}>
                      Opslaan
                    </button>
                    <button
                      type="button"
                      className="editor-button"
                      onClick={async () => {
                        if (currentStep.id === "summary") {
                          const saved = await handleFinalize();
                          if (saved) {
                            onFinish?.();
                          }
                          return;
                        }

                        setActiveStepIndex(Math.min(steps.length - 1, currentIndex + 1));
                      }}
                      disabled={isSaving}
                    >
                      {isSaving ? "Opslaan..." : currentStep.id === "summary" ? "Afronden" : "Volgende"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {status ? (
              <div className={`editor-status wizard-inline-status${statusTone ? ` ${statusTone}` : ""}`}>{status}</div>
            ) : null}
          </main>

        </div>

        {pendingDelete ? (
          <div className="confirm-modal-overlay" role="presentation">
            <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
              <div className="confirm-modal-title" id="confirm-title">
                {pendingDelete.title}
              </div>
              <div className="confirm-modal-text">{pendingDelete.body}</div>
              <div className="confirm-modal-actions">
                {!pendingDelete.hideCancel ? (
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => setPendingDelete(null)}
                  >
                    {pendingDelete.cancelLabel ?? "Annuleren"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => {
                    pendingDelete.onConfirm();
                    setPendingDelete(null);
                  }}
                >
                  {pendingDelete.confirmLabel ?? "Verwijderen"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}


