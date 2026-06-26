import { API_BASE_URL } from "@/lib/api";
import { rowMatchPayload, type GenericRecord } from "@/components/beheer/data-quality/DataQualityWorkbenchParts";

export type ClassificationOption = {
  id: string;
  label: string;
  sort_order?: number;
  active?: boolean;
  allowed_product_groups?: string[];
};

async function readActionJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
  return payload;
}

export async function loadInternalLotGroups(year: number) {
  const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/internal-summary?year=${encodeURIComponent(String(year || 0))}&limit=5000`, {
    credentials: "include",
  });
  const payload = await readActionJson(response);
  return Array.isArray((payload as any)?.items) ? (payload as any).items : [];
}

export async function mapRowsToSku({
  rows,
  row,
  selectedSkuId,
  productGroup,
  alcoholCategory,
  packagingType,
}: {
  rows: GenericRecord[];
  row: GenericRecord;
  selectedSkuId: string;
  productGroup: string;
  alcoholCategory: string;
  packagingType: string;
}) {
  if (rows.length > 1) {
    const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules/batch`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "map_to_sku",
        items: rows.map(rowMatchPayload),
        sku_id: selectedSkuId,
        product_group: productGroup,
        alcohol_category: alcoholCategory,
        packaging_type: packagingType,
      }),
    });
    const payload = await readActionJson(response);
    const errors = Array.isArray((payload as any)?.result?.errors) ? (payload as any).result.errors : [];
    if (errors.length) throw new Error(`${errors.length} regels konden niet worden opgeslagen.`);
    return payload;
  }

  const douanoProductId = Number(row.douano_product_id ?? 0) || 0;
  if (douanoProductId > 0) {
    const response = await fetch(`${API_BASE_URL}/integrations/douano/product-mappings/${encodeURIComponent(String(douanoProductId))}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku_id: selectedSkuId,
        product_group: productGroup,
        alcohol_category: alcoholCategory,
        packaging_type: packagingType,
      }),
    });
    return readActionJson(response);
  }

  const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...rowMatchPayload(row), action: "map_to_sku", sku_id: selectedSkuId }),
  });
  return readActionJson(response);
}

export async function mapRowToInternalLot({ row, skuId, selectedInternalLot }: { row: GenericRecord; skuId: string; selectedInternalLot: string }) {
  const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...rowMatchPayload(row),
      action: "map_to_sku",
      sku_id: skuId,
      internal_lot_number: selectedInternalLot,
      note: "Interne LOT expliciet gekoppeld voor verkoopregel zonder Douano LOT.",
    }),
  });
  return readActionJson(response);
}

export async function addHistoricalCost({
  row,
  skuId,
  year,
  supplier,
  effectiveFrom,
  purchasePriceInput,
  note,
}: {
  row: GenericRecord;
  skuId: string;
  year: number;
  supplier: string;
  effectiveFrom: string;
  purchasePriceInput: number;
  note: string;
}) {
  const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules/historical-cost`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...rowMatchPayload(row),
      sku_id: skuId,
      year,
      supplier,
      effective_from: effectiveFrom,
      purchase_price_input: purchasePriceInput,
      note,
    }),
  });
  return readActionJson(response);
}

export async function markRowsNoCostRequired(rows: GenericRecord[]) {
  if (rows.length > 1) {
    const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules/batch`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "no_cost_required",
        items: rows.map(rowMatchPayload),
        category: "Geen kostprijs nodig",
        include_revenue: true,
        include_liters: false,
        include_break_even: false,
        note: "Geen kostprijs nodig vanuit datakwaliteit.",
      }),
    });
    const payload = await readActionJson(response);
    const errors = Array.isArray((payload as any)?.result?.errors) ? (payload as any).result.errors : [];
    if (errors.length) throw new Error(`${errors.length} regels konden niet worden opgeslagen.`);
    return payload;
  }

  const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...rowMatchPayload(rows[0]),
      action: "no_cost_required",
      category: "Geen kostprijs nodig",
      include_revenue: true,
      include_liters: false,
      include_break_even: false,
      note: "Geen kostprijs nodig vanuit datakwaliteit.",
    }),
  });
  return readActionJson(response);
}

export async function mapLotAlias({
  row,
  externalLot,
  selectedInternalLot,
}: {
  row: GenericRecord;
  externalLot: string;
  selectedInternalLot: string;
}) {
  const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/aliases`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sku_ids: String(row.sku_id || "").trim() ? [String(row.sku_id || "").trim()] : [],
      sku_codes: String(row.sku_code || row.sku || "").trim() ? [String(row.sku_code || row.sku || "").trim()] : [],
      douano_lot_number: externalLot,
      internal_lot_number: selectedInternalLot,
      reason: "data_quality_sales_row_action",
      source: "data_quality_missing_cost_source",
    }),
  });
  return readActionJson(response);
}
