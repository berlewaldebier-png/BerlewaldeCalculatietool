"use client";

import { SkuSearchSelect } from "@/components/SkuSearchSelect";
import type { ClassificationOption } from "@/components/beheer/data-quality/costSourceActions";

export type CostSourceActionKind = "map_to_sku" | "no_cost_required" | "lot_alias" | "internal_lot" | "historical_cost";

export type SearchOption = {
  id: string;
  value: string;
  label: string;
  description: string;
  keywords: string;
};

export type SelectOption = {
  value: string;
  label: string;
};

export function CostSourceActionSelect({
  action,
  canAddHistoricalCost,
  isBulkAction,
  onChange,
}: {
  action: CostSourceActionKind;
  canAddHistoricalCost: boolean;
  isBulkAction: boolean;
  onChange: (action: CostSourceActionKind) => void;
}) {
  return (
    <label className="field-label">
      Actie
      <select className="editor-input" value={action} onChange={(event) => onChange(event.target.value as CostSourceActionKind)}>
        <option value="map_to_sku">Koppel aan SKU</option>
        {canAddHistoricalCost ? <option value="historical_cost">Kostprijs toevoegen</option> : null}
        {!isBulkAction ? <option value="internal_lot">Koppel aan interne LOT</option> : null}
        {!isBulkAction ? <option value="lot_alias">Koppel LOT alias</option> : null}
        <option value="no_cost_required">Geen kostprijs nodig</option>
      </select>
    </label>
  );
}

export function MapToSkuFields({
  selectedSkuId,
  skuOptions,
  productGroup,
  alcoholCategory,
  packagingType,
  productGroups,
  alcoholCategories,
  packagingTypes,
  onSkuChange,
  onProductGroupChange,
  onAlcoholCategoryChange,
  onPackagingTypeChange,
}: {
  selectedSkuId: string;
  skuOptions: SearchOption[];
  productGroup: string;
  alcoholCategory: string;
  packagingType: string;
  productGroups: ClassificationOption[];
  alcoholCategories: ClassificationOption[];
  packagingTypes: ClassificationOption[];
  onSkuChange: (skuId: string) => void;
  onProductGroupChange: (productGroup: string) => void;
  onAlcoholCategoryChange: (alcoholCategory: string) => void;
  onPackagingTypeChange: (packagingType: string) => void;
}) {
  return (
    <>
      <label className="field-label">
        SKU
        <SkuSearchSelect className="editor-input" value={selectedSkuId} placeholder="Zoek SKU" options={skuOptions} onChange={onSkuChange} />
      </label>
      <label className="field-label">
        Productgroep
        <select className="editor-input" value={productGroup} onChange={(event) => onProductGroupChange(event.target.value)}>
          <option value="">Kies productgroep</option>
          {productGroups.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        Alcohol
        <select
          className="editor-input"
          value={alcoholCategory}
          onChange={(event) => onAlcoholCategoryChange(event.target.value)}
          disabled={productGroup !== "drank" && productGroup !== "giftset"}
        >
          <option value="">-</option>
          {alcoholCategories.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        Verpakkingstype
        <select className="editor-input" value={packagingType} onChange={(event) => onPackagingTypeChange(event.target.value)}>
          <option value="">Kies verpakkingstype</option>
          {packagingTypes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export function InternalLotFields({
  action,
  selectedInternalLot,
  internalLotOptions,
  onChange,
}: {
  action: CostSourceActionKind;
  selectedInternalLot: string;
  internalLotOptions: SelectOption[];
  onChange: (lot: string) => void;
}) {
  return (
    <label className="field-label">
      Interne LOT
      <select className="editor-input" value={selectedInternalLot} onChange={(event) => onChange(event.target.value)}>
        <option value="">Kies interne LOT</option>
        {internalLotOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {action === "internal_lot" ? (
        <span className="module-card-text">
          Gebruik dit voor verkoopregels zonder Douano LOT. De gekozen interne LOT wordt expliciet op deze productregel toegepast.
        </span>
      ) : null}
    </label>
  );
}

export function HistoricalCostFields({
  skuId,
  historicalCost,
  historicalDate,
  historicalSupplier,
  historicalNote,
  onHistoricalCostChange,
  onHistoricalDateChange,
  onHistoricalSupplierChange,
  onHistoricalNoteChange,
}: {
  skuId: string;
  historicalCost: string;
  historicalDate: string;
  historicalSupplier: string;
  historicalNote: string;
  onHistoricalCostChange: (value: string) => void;
  onHistoricalDateChange: (value: string) => void;
  onHistoricalSupplierChange: (value: string) => void;
  onHistoricalNoteChange: (value: string) => void;
}) {
  return (
    <>
      <label className="field-label">
        Interne SKU
        <input className="editor-input" value={skuId} readOnly />
      </label>
      <label className="field-label">
        Inkoopprijs per eenheid
        <input
          className="editor-input"
          type="number"
          min="0"
          step="0.01"
          value={historicalCost}
          onChange={(event) => onHistoricalCostChange(event.target.value)}
          placeholder="Bijvoorbeeld 66.20"
        />
      </label>
      <label className="field-label">
        Actief sinds
        <input className="editor-input" type="date" value={historicalDate} onChange={(event) => onHistoricalDateChange(event.target.value)} />
      </label>
      <label className="field-label">
        Leverancier / bron
        <input className="editor-input" value={historicalSupplier} onChange={(event) => onHistoricalSupplierChange(event.target.value)} />
      </label>
      <label className="field-label">
        Notitie
        <input className="editor-input" value={historicalNote} onChange={(event) => onHistoricalNoteChange(event.target.value)} />
      </label>
      <span className="module-card-text">
        Gebruik dit alleen voor bekende verkoopbare SKU's zonder Douano LOT en zonder bestaande kostprijs. De app maakt een historische kostprijsversie aan en telt overhead en accijns automatisch op bij de inkoopprijs.
      </span>
    </>
  );
}
