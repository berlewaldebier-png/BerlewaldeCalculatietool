"use client";

import type { CostProductCandidate } from "@/components/berekeningen/steps/SellableVariantsStep";

type GenericRecord = Record<string, unknown>;

export type SupplierConfigState = {
  supplier_id: string;
  supplier_name: string;
  production_location: string;
  cost_source: string;
  supplier_config: {
    packaging_costs_apply_by_sku: Record<string, boolean>;
    excise_included_in_purchase_price: boolean;
    transport_included: boolean;
    deposit_included: boolean;
    extra_handling_fee: boolean;
    supplier_specific_overhead_rule: boolean;
  };
};

const SUPPLIERS = [
  { id: "beerselect", name: "Beerselect" },
  { id: "brouwersnos", name: "Brouwersnos" },
  { id: "eigen-productie", name: "Eigen productie" },
];

const DEFAULT_SUPPLIER_CONFIG = {
  packaging_costs_apply_by_sku: {},
  excise_included_in_purchase_price: false,
  transport_included: false,
  deposit_included: false,
  extra_handling_fee: false,
  supplier_specific_overhead_rule: false,
};

export function supplierNameForId(id: string) {
  const cleanId = String(id || "").trim();
  return SUPPLIERS.find((supplier) => supplier.id === cleanId)?.name || "Beerselect";
}

export function normalizeSupplierConfigState(raw?: Partial<SupplierConfigState> | GenericRecord | null): SupplierConfigState {
  const source = (raw ?? {}) as GenericRecord;
  const supplierObject = source.supplier && typeof source.supplier === "object" ? (source.supplier as GenericRecord) : {};
  const soort = source.soort_berekening && typeof source.soort_berekening === "object" ? (source.soort_berekening as GenericRecord) : {};
  const processType = String(soort.type ?? "").trim();
  const sourceKind = String(source.cost_source ?? "").trim();
  const shouldDefaultOwnProduction =
    processType === "Eigen productie" ||
    sourceKind === "recipe_estimate" ||
    sourceKind === "recipe_recalculation" ||
    sourceKind === "brew_moment";
  const defaultSupplierId = shouldDefaultOwnProduction ? "eigen-productie" : "beerselect";
  const supplierId = String(source.supplier_id ?? supplierObject.id ?? defaultSupplierId).trim() || defaultSupplierId;
  const supplierName = String(source.supplier_name ?? source.leverancier ?? supplierObject.name ?? supplierNameForId(supplierId)).trim() || supplierNameForId(supplierId);
  const config = source.supplier_config && typeof source.supplier_config === "object" ? (source.supplier_config as GenericRecord) : {};
  const packaging = config.packaging_costs_apply_by_sku && typeof config.packaging_costs_apply_by_sku === "object"
    ? (config.packaging_costs_apply_by_sku as Record<string, boolean>)
    : {};

  return {
    supplier_id: supplierId,
    supplier_name: supplierName,
    production_location: String(source.production_location ?? supplierName).trim() || supplierName,
    cost_source: String(source.cost_source ?? "").trim(),
    supplier_config: {
      ...DEFAULT_SUPPLIER_CONFIG,
      packaging_costs_apply_by_sku: Object.fromEntries(
        Object.entries(packaging).map(([key, value]) => [key, Boolean(value)])
      ),
      excise_included_in_purchase_price: Boolean(config.excise_included_in_purchase_price),
      transport_included: Boolean(config.transport_included),
      deposit_included: Boolean(config.deposit_included),
      extra_handling_fee: Boolean(config.extra_handling_fee),
      supplier_specific_overhead_rule: Boolean(config.supplier_specific_overhead_rule),
    },
  };
}

export function applySupplierMetadataToRecord(record: GenericRecord, state: SupplierConfigState, fallbackCostSource = "") {
  const normalized = normalizeSupplierConfigState({
    ...state,
    cost_source: state.cost_source || fallbackCostSource,
  });
  record.cost_source = normalized.cost_source || fallbackCostSource;
  record.supplier_id = normalized.supplier_id;
  record.supplier_name = normalized.supplier_name;
  record.supplier = { id: normalized.supplier_id, name: normalized.supplier_name };
  record.leverancier = normalized.supplier_name;
  record.production_location = normalized.production_location;
  record.supplier_config = normalized.supplier_config;
  record.supplier_config_version = 1;
}

export function supplierDefaultPackagingApplies(supplierId: string) {
  return String(supplierId || "").trim().toLowerCase() === "brouwersnos";
}

export function supplierPackagingAppliesForProduct(raw: Partial<SupplierConfigState> | GenericRecord | null | undefined, productId: string) {
  const state = normalizeSupplierConfigState(raw);
  const id = String(productId || "").trim();
  const configured = state.supplier_config.packaging_costs_apply_by_sku;
  if (id && Object.prototype.hasOwnProperty.call(configured, id)) {
    return Boolean(configured[id]);
  }
  return supplierDefaultPackagingApplies(state.supplier_id);
}

export function SupplierConfigStep({
  value,
  productRows,
  onChange,
  title = "Leverancier configureren",
}: {
  value: SupplierConfigState;
  productRows: CostProductCandidate[];
  onChange: (next: SupplierConfigState) => void;
  title?: string;
}) {
  const state = normalizeSupplierConfigState(value);

  function update(patch: Partial<SupplierConfigState>) {
    onChange(normalizeSupplierConfigState({ ...state, ...patch }));
  }

  function updateConfig(key: keyof SupplierConfigState["supplier_config"], checked: boolean) {
    update({
      supplier_config: {
        ...state.supplier_config,
        [key]: checked,
      },
    });
  }

  function updatePackaging(productId: string, checked: boolean) {
    update({
      supplier_config: {
        ...state.supplier_config,
        packaging_costs_apply_by_sku: {
          ...state.supplier_config.packaging_costs_apply_by_sku,
          [productId]: checked,
        },
      },
    });
  }

  return (
    <div className="wizard-stack">
      <section className="module-card compact-card">
        <div className="module-card-title">{title}</div>
        <div className="module-card-text">
          Leg vast welke leverancier of productieroute deze kostprijsversie voedt. De keuzes worden opgeslagen op de versie; de rekenregels volgen in de volgende fase.
        </div>
        <div className="wizard-form-grid" style={{ marginTop: 12 }}>
          <label className="nested-field">
            <span>Leverancier</span>
            <select
              className="dataset-input"
              value={state.supplier_id}
              onChange={(event) => {
                const supplierId = event.target.value;
                const supplierName = supplierNameForId(supplierId);
                update({
                  supplier_id: supplierId,
                  supplier_name: supplierName,
                  production_location: supplierName,
                });
              }}
            >
              {SUPPLIERS.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label className="nested-field">
            <span>Productielocatie</span>
            <input
              className="dataset-input"
              value={state.production_location}
              onChange={(event) => update({ production_location: event.target.value })}
            />
          </label>
          <label className="nested-field">
            <span>Accijns in inkoopprijs</span>
            <select
              className="dataset-input"
              value={state.supplier_config.excise_included_in_purchase_price ? "yes" : "no"}
              onChange={(event) => updateConfig("excise_included_in_purchase_price", event.target.value === "yes")}
            >
              <option value="no">Nee</option>
              <option value="yes">Ja</option>
            </select>
          </label>
        </div>
      </section>

      <section className="module-card compact-card">
        <div className="module-card-title">Verpakkingskosten per SKU</div>
        <div className="module-card-text">
          Kies per verkoopbare variant of verpakkingskosten moeten meetellen. Standaard staat dit uit.
        </div>
        <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th>SKU / variant</th>
                <th style={{ width: 180 }}>Verpakkingskosten</th>
              </tr>
            </thead>
            <tbody>
              {productRows.length ? (
                productRows.map((row) => {
                  const productId = String(row.productId || row.id || "").trim();
                  const checked = supplierPackagingAppliesForProduct(state, productId);
                  return (
                    <tr key={productId || row.id}>
                      <td>
                        <strong>{row.label}</strong>
                        <div className="module-card-text">{row.kindLabel || row.productType || "-"}</div>
                      </td>
                      <td>
                        <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => updatePackaging(productId, event.target.checked)}
                          />
                          <span>{checked ? "Ja" : "Nee"}</span>
                        </label>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="dataset-empty" colSpan={2}>
                    Nog geen SKU's of varianten gekozen.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="module-card compact-card">
        <div className="module-card-title">Later uitbreiden</div>
        <div className="wizard-form-grid" style={{ marginTop: 12 }}>
          {[
            ["Transport inbegrepen", state.supplier_config.transport_included],
            ["Statiegeld inbegrepen", state.supplier_config.deposit_included],
            ["Extra handling fee", state.supplier_config.extra_handling_fee],
            ["Leveranciersspecifieke overhead", state.supplier_config.supplier_specific_overhead_rule],
          ].map(([label, checked]) => (
            <label key={String(label)} className="nested-field">
              <span>{String(label)}</span>
              <select className="dataset-input" value={checked ? "yes" : "no"} disabled>
                <option value="no">Nee</option>
                <option value="yes">Ja</option>
              </select>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
