"use client";

import { useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  defaultHistoricalDate,
  missingRowKey,
  readDataSet,
  skuLabel,
  valuePreview,
  type GenericRecord,
} from "@/components/beheer/data-quality/DataQualityWorkbenchParts";
import {
  addHistoricalCost,
  loadInternalLotGroups,
  mapLotAlias,
  mapRowToInternalLot,
  mapRowsToSku,
  markRowsNoCostRequired,
  type ClassificationOption,
} from "@/components/beheer/data-quality/costSourceActions";
import {
  CostSourceActionSelect,
  HistoricalCostFields,
  InternalLotFields,
  MapToSkuFields,
  type CostSourceActionKind,
} from "@/components/beheer/data-quality/CostSourceActionFields";

export function CostSourceRowAction({
  row,
  scopeRows = [],
  skus,
  year,
}: {
  row: GenericRecord;
  scopeRows?: GenericRecord[];
  skus: GenericRecord[];
  year: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<CostSourceActionKind>("map_to_sku");
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const [modalSkus, setModalSkus] = useState<GenericRecord[]>(skus);
  const [productGroup, setProductGroup] = useState("");
  const [alcoholCategory, setAlcoholCategory] = useState("");
  const [packagingType, setPackagingType] = useState("");
  const [productGroups, setProductGroups] = useState<ClassificationOption[]>([]);
  const [alcoholCategories, setAlcoholCategories] = useState<ClassificationOption[]>([]);
  const [packagingTypes, setPackagingTypes] = useState<ClassificationOption[]>([]);
  const [selectedInternalLot, setSelectedInternalLot] = useState("");
  const [internalLots, setInternalLots] = useState<GenericRecord[]>([]);
  const [historicalCost, setHistoricalCost] = useState("");
  const [historicalSupplier, setHistoricalSupplier] = useState("Historisch");
  const [historicalDate, setHistoricalDate] = useState(defaultHistoricalDate(year));
  const [historicalNote, setHistoricalNote] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const actionRows = scopeRows.length ? scopeRows : [row];
  const isBulkAction = actionRows.length > 1;
  const rowHasSku = Boolean(String(row.sku_id || "").trim());
  const rowHasLot = Boolean(String(row.lot_number || "").trim());
  const historicalCostSkuIds = actionRows.map((item) => String(item.sku_id || "").trim()).filter(Boolean);
  const historicalCostMatchKeys = actionRows.map(missingRowKey);
  const canAddHistoricalCost =
    historicalCostSkuIds.length === actionRows.length &&
    new Set(historicalCostSkuIds).size === 1 &&
    new Set(historicalCostMatchKeys).size === 1 &&
    actionRows.every((item) => !String(item.lot_number || "").trim() && Boolean(item.missing_cost ?? true));

  const skuOptions = useMemo(() => {
    return (Array.isArray(modalSkus) ? modalSkus : [])
      .filter((sku) => Boolean((sku as any).active ?? (sku as any).actief ?? true))
      .map((sku) => {
        const id = String((sku as any).id || "").trim();
        return {
          id,
          value: id,
          label: skuLabel(sku),
          description: String((sku as any).code ?? (sku as any).sku_code ?? "").trim() || id,
          keywords: `${String((sku as any).code ?? "")} ${String((sku as any).kind ?? "")} ${String((sku as any).product_group ?? "")}`,
        };
      })
      .filter((sku) => sku.id && sku.label)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [modalSkus]);

  const activeProductGroups = useMemo(
    () => productGroups.filter((item) => item.active !== false).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)),
    [productGroups]
  );
  const activeAlcoholCategories = useMemo(
    () => alcoholCategories.filter((item) => item.active !== false).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)),
    [alcoholCategories]
  );
  const activePackagingTypes = useMemo(() => {
    const group = String(productGroup || "").trim();
    return packagingTypes
      .filter((item) => item.active !== false)
      .filter((item) => !group || !Array.isArray(item.allowed_product_groups) || item.allowed_product_groups.length === 0 || item.allowed_product_groups.includes(group))
      .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  }, [packagingTypes, productGroup]);

  const requiresPackaging = productGroup === "drank" || productGroup === "giftset";

  function applySkuDefaults(skuId: string) {
    const sku = (Array.isArray(modalSkus) ? modalSkus : []).find((item) => String((item as any)?.id ?? "").trim() === skuId);
    if (!sku) return;
    const payload = (sku as any).payload && typeof (sku as any).payload === "object" ? (sku as any).payload : {};
    const explicitGroup = String((sku as any).product_group ?? payload.product_group ?? "").trim();
    const kind = String((sku as any).kind ?? "").trim().toLowerCase();
    const nextGroup = explicitGroup || (kind === "beer_format" ? "drank" : kind === "article" ? "merchandise" : "");
    if (nextGroup) setProductGroup(nextGroup);
    const nextAlcohol = String((sku as any).alcohol_category ?? payload.alcohol_category ?? "").trim();
    if (nextAlcohol) setAlcoholCategory(nextAlcohol);
    const nextPackaging = String((sku as any).packaging_type ?? payload.packaging_type ?? "").trim();
    if (nextPackaging) setPackagingType(nextPackaging);
  }

  async function loadInternalLots() {
    try {
      setInternalLots(await loadInternalLotGroups(year));
    } catch {
      setInternalLots([]);
    }
  }

  async function loadModalData() {
    try {
      const [freshSkus, groups, alcohol, packaging] = await Promise.all([
        readDataSet<GenericRecord>("skus"),
        readDataSet<ClassificationOption>("productgroepen"),
        readDataSet<ClassificationOption>("alcoholcategorieen"),
        readDataSet<ClassificationOption>("verpakkingstypen"),
      ]);
      if (freshSkus.length) setModalSkus(freshSkus);
      setProductGroups(groups);
      setAlcoholCategories(alcohol);
      setPackagingTypes(packaging);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function openModal() {
    setOpen(true);
    setStatus("");
    if (scopeRows.length > 1 && action === "lot_alias") {
      setAction("map_to_sku");
    }
    const existingSkuId = String(row.sku_id || "").trim();
    if (existingSkuId) {
      setSelectedSkuId(existingSkuId);
      applySkuDefaults(existingSkuId);
    }
    setHistoricalDate(defaultHistoricalDate(year));
    void loadInternalLots();
    void loadModalData();
  }

  async function submit() {
    setSaving(true);
    setStatus("Opslaan...");
    try {
      if (action === "map_to_sku") {
        if (!selectedSkuId) throw new Error("Kies een SKU.");
        if (!productGroup) throw new Error("Kies een productgroep.");
        if (requiresPackaging && !packagingType) throw new Error("Kies een verpakkingstype voor drank/giftset.");
        await mapRowsToSku({
          rows: actionRows,
          row,
          selectedSkuId,
          productGroup,
          alcoholCategory,
          packagingType,
        });
      }

      if (action === "internal_lot") {
        if (isBulkAction) throw new Error("Koppel een interne LOT veilig per regel.");
        const skuId = String(row.sku_id || selectedSkuId || "").trim();
        if (!skuId) throw new Error("Deze regel mist nog een SKU. Koppel eerst aan een SKU.");
        if (!selectedInternalLot) throw new Error("Kies een interne LOT.");
        await mapRowToInternalLot({ row, skuId, selectedInternalLot });
      }

      if (action === "historical_cost") {
        const skuId = String(row.sku_id || selectedSkuId || "").trim();
        const costValue = Number(String(historicalCost || "").replace(",", "."));
        if (!skuId) throw new Error("Deze regel mist nog een SKU. Koppel eerst aan een SKU.");
        if (rowHasLot) throw new Error("Deze actie is alleen voor verkoopregels zonder LOT.");
        if (!Number.isFinite(costValue) || costValue < 0) throw new Error("Vul een geldige kostprijs per eenheid in.");
        await addHistoricalCost({
          row,
          skuId,
          year,
          supplier: String(historicalSupplier || "Historisch").trim() || "Historisch",
          effectiveFrom: historicalDate,
          purchasePriceInput: costValue,
          note: historicalNote,
        });
      }

      if (action === "no_cost_required") {
        const containsSkuLikeRows = actionRows.some((item) => String(item.sku_id || item.sku_code || item.sku || "").trim());
        if (
          !window.confirm(
            `Dit betekent dat ${actionRows.length} orderregel(s) wel meetellen in de omzet, maar geen kostprijs nodig hebben. Een SKU zoals bier en merchandise moet voorzien zijn van een SKU/LOT om de juiste kostprijs te bepalen.${containsSkuLikeRows ? " Deze selectie bevat regels met SKU-informatie; controleer extra goed of dit geen echte verkoopbare artikelen zijn." : ""} Doorgaan?`
          )
        ) {
          setStatus("");
          return;
        }
        await markRowsNoCostRequired(actionRows);
      }

      if (action === "lot_alias") {
        if (isBulkAction) throw new Error("LOT alias kan veilig per regel worden gekoppeld. Selecteer hiervoor één regel.");
        const externalLot = String(row.lot_number || "").trim();
        if (!externalLot) throw new Error("Externe LOT ontbreekt.");
        if (!selectedInternalLot) throw new Error("Kies een interne LOT.");
        await mapLotAlias({ row, externalLot, selectedInternalLot });
      }

      setStatus("Opgeslagen. Snapshot wordt ververst.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const internalLotOptions = internalLots
    .flatMap((group) =>
      Array.isArray((group as any).lots)
        ? (group as any).lots.map((lot: GenericRecord) => ({
            value: String(lot.lot_number || "").trim(),
            label: `${String(lot.lot_number || "").trim()} ${Array.isArray(lot.versions) ? lot.versions.join("/") : ""} - ${String(group.style_name || "").trim()}`.trim(),
          }))
        : []
    )
    .filter((option, index, all) => option.value && all.findIndex((item) => item.value === option.value) === index)
    .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));

  return (
    <>
      <button
        type="button"
        className="icon-button-table"
        aria-label="Actie kiezen"
        title="Actie kiezen"
        onClick={openModal}
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div className="cpq-modal-backdrop" role="dialog" aria-modal="true">
          <div className="cpq-modal">
            <div className="cpq-modal-header">
              <div>
                <div className="cpq-modal-title">Kostprijsbron oplossen</div>
                <div className="cpq-modal-subtitle">
                  {isBulkAction ? `${actionRows.length} geselecteerde regels` : valuePreview(row)}
                </div>
              </div>
              <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpen(false)}>
                Sluiten
              </button>
            </div>
            <div className="cpq-modal-body">
              <CostSourceActionSelect
                action={action}
                canAddHistoricalCost={canAddHistoricalCost}
                isBulkAction={isBulkAction}
                onChange={setAction}
              />
              {action === "map_to_sku" ? (
                <MapToSkuFields
                  selectedSkuId={selectedSkuId}
                  skuOptions={skuOptions}
                  productGroup={productGroup}
                  alcoholCategory={alcoholCategory}
                  packagingType={packagingType}
                  productGroups={activeProductGroups}
                  alcoholCategories={activeAlcoholCategories}
                  packagingTypes={activePackagingTypes}
                  onSkuChange={(nextSkuId) => {
                    setSelectedSkuId(nextSkuId);
                    applySkuDefaults(nextSkuId);
                  }}
                  onProductGroupChange={setProductGroup}
                  onAlcoholCategoryChange={setAlcoholCategory}
                  onPackagingTypeChange={setPackagingType}
                />
              ) : null}
              {action === "lot_alias" || action === "internal_lot" ? (
                <InternalLotFields
                  action={action}
                  selectedInternalLot={selectedInternalLot}
                  internalLotOptions={internalLotOptions}
                  onChange={setSelectedInternalLot}
                />
              ) : null}
              {action === "historical_cost" ? (
                <HistoricalCostFields
                  skuId={String(row.sku_id || selectedSkuId || "")}
                  historicalCost={historicalCost}
                  historicalDate={historicalDate}
                  historicalSupplier={historicalSupplier}
                  historicalNote={historicalNote}
                  onHistoricalCostChange={setHistoricalCost}
                  onHistoricalDateChange={setHistoricalDate}
                  onHistoricalSupplierChange={setHistoricalSupplier}
                  onHistoricalNoteChange={setHistoricalNote}
                />
              ) : null}
              {status ? <div className="editor-status">{status}</div> : null}
            </div>
            <div className="editor-actions" style={{ padding: "0 1.1rem 1rem" }}>
              <div />
              <div className="editor-actions-group">
                <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpen(false)}>
                  Annuleren
                </button>
                <button type="button" className="editor-button" onClick={() => void submit()} disabled={saving}>
                  {saving ? "Opslaan..." : "Opslaan"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
