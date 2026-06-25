"use client";

import { useMemo, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";
import { DouanoProductMappingCard } from "@/components/DouanoProductMappingCard";
import { DouanoSyncPanel } from "@/components/DouanoSyncPanel";
import { DouanoUnmappedRulesCard } from "@/components/DouanoUnmappedRulesCard";
import { LotKostenWorkspace } from "@/components/lot-kosten/LotKostenWorkspace";
import { SkuSearchSelect } from "@/components/SkuSearchSelect";
import { WizardSteps } from "@/components/WizardSteps";
import {
  ApiRunStatusTable,
  CheckGrid,
  DATA_QUALITY_WORKSTREAMS,
  ReliabilityBanner,
  WorkstreamIntro,
  YearSelector,
  checkById,
  defaultHistoricalDate,
  hasMissing,
  missingRowKey,
  readDataSet,
  rowMatchPayload,
  skuLabel,
  valuePreview,
  type GenericRecord,
  type SetupStatus,
} from "@/components/beheer/data-quality/DataQualityWorkbenchParts";

type ClassificationOption = {
  id: string;
  label: string;
  sort_order?: number;
  active?: boolean;
  allowed_product_groups?: string[];
};

function CostSourceRowAction({
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
  const [action, setAction] = useState<"map_to_sku" | "no_cost_required" | "lot_alias" | "internal_lot" | "historical_cost">("map_to_sku");
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
      const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/internal-summary?year=${encodeURIComponent(String(year || 0))}&limit=5000`, {
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
      setInternalLots(Array.isArray((payload as any)?.items) ? (payload as any).items : []);
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
        if (isBulkAction) {
          const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules/batch`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "map_to_sku",
              items: actionRows.map(rowMatchPayload),
              sku_id: selectedSkuId,
              product_group: productGroup,
              alcohol_category: alcoholCategory,
              packaging_type: packagingType,
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
          const errors = Array.isArray((payload as any)?.result?.errors) ? (payload as any).result.errors : [];
          if (errors.length) throw new Error(`${errors.length} regels konden niet worden opgeslagen.`);
        } else {
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
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
        } else {
          const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...rowMatchPayload(row), action: "map_to_sku", sku_id: selectedSkuId }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
        }
        }
      }

      if (action === "internal_lot") {
        if (isBulkAction) throw new Error("Koppel een interne LOT veilig per regel.");
        const skuId = String(row.sku_id || selectedSkuId || "").trim();
        if (!skuId) throw new Error("Deze regel mist nog een SKU. Koppel eerst aan een SKU.");
        if (!selectedInternalLot) throw new Error("Kies een interne LOT.");
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
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
      }

      if (action === "historical_cost") {
        const skuId = String(row.sku_id || selectedSkuId || "").trim();
        const costValue = Number(String(historicalCost || "").replace(",", "."));
        if (!skuId) throw new Error("Deze regel mist nog een SKU. Koppel eerst aan een SKU.");
        if (rowHasLot) throw new Error("Deze actie is alleen voor verkoopregels zonder LOT.");
        if (!Number.isFinite(costValue) || costValue < 0) throw new Error("Vul een geldige kostprijs per eenheid in.");
        const costResponse = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules/historical-cost`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...rowMatchPayload(row),
            sku_id: skuId,
            year,
            supplier: String(historicalSupplier || "Historisch").trim() || "Historisch",
            effective_from: historicalDate,
            purchase_price_input: costValue,
            note: historicalNote,
          }),
        });
        const costPayload = await costResponse.json().catch(() => ({}));
        if (!costResponse.ok) throw new Error(String((costPayload as any)?.detail || costResponse.statusText));
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
        if (isBulkAction) {
          const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules/batch`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "no_cost_required",
              items: actionRows.map(rowMatchPayload),
              category: "Geen kostprijs nodig",
              include_revenue: true,
              include_liters: false,
              include_break_even: false,
              note: "Geen kostprijs nodig vanuit datakwaliteit.",
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
          const errors = Array.isArray((payload as any)?.result?.errors) ? (payload as any).result.errors : [];
          if (errors.length) throw new Error(`${errors.length} regels konden niet worden opgeslagen.`);
        } else {
        const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...rowMatchPayload(row),
            action: "no_cost_required",
            category: "Geen kostprijs nodig",
            include_revenue: true,
            include_liters: false,
            include_break_even: false,
            note: "Geen kostprijs nodig vanuit datakwaliteit.",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
        }
      }

      if (action === "lot_alias") {
        if (isBulkAction) throw new Error("LOT alias kan veilig per regel worden gekoppeld. Selecteer hiervoor één regel.");
        const externalLot = String(row.lot_number || "").trim();
        if (!externalLot) throw new Error("Externe LOT ontbreekt.");
        if (!selectedInternalLot) throw new Error("Kies een interne LOT.");
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
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
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
              <label className="field-label">
                Actie
                <select className="editor-input" value={action} onChange={(event) => setAction(event.target.value as any)}>
                  <option value="map_to_sku">Koppel aan SKU</option>
                  {canAddHistoricalCost ? <option value="historical_cost">Kostprijs toevoegen</option> : null}
                  {!isBulkAction ? <option value="internal_lot">Koppel aan interne LOT</option> : null}
                  {!isBulkAction ? <option value="lot_alias">Koppel LOT alias</option> : null}
                  <option value="no_cost_required">Geen kostprijs nodig</option>
                </select>
              </label>
              {action === "map_to_sku" ? (
                <>
                  <label className="field-label">
                    SKU
                    <SkuSearchSelect
                      className="editor-input"
                      value={selectedSkuId}
                      placeholder="Zoek SKU"
                      options={skuOptions}
                      onChange={(nextSkuId) => {
                        setSelectedSkuId(nextSkuId);
                        applySkuDefaults(nextSkuId);
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Productgroep
                    <select className="editor-input" value={productGroup} onChange={(event) => setProductGroup(event.target.value)}>
                      <option value="">Kies productgroep</option>
                      {activeProductGroups.map((option) => (
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
                      onChange={(event) => setAlcoholCategory(event.target.value)}
                      disabled={productGroup !== "drank" && productGroup !== "giftset"}
                    >
                      <option value="">-</option>
                      {activeAlcoholCategories.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Verpakkingstype
                    <select className="editor-input" value={packagingType} onChange={(event) => setPackagingType(event.target.value)}>
                      <option value="">Kies verpakkingstype</option>
                      {activePackagingTypes.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              {action === "lot_alias" || action === "internal_lot" ? (
                <label className="field-label">
                  Interne LOT
                  <select className="editor-input" value={selectedInternalLot} onChange={(event) => setSelectedInternalLot(event.target.value)}>
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
              ) : null}
              {action === "historical_cost" ? (
                <>
                  <label className="field-label">
                    Interne SKU
                    <input className="editor-input" value={String(row.sku_id || selectedSkuId || "")} readOnly />
                  </label>
                  <label className="field-label">
                    Inkoopprijs per eenheid
                    <input
                      className="editor-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={historicalCost}
                      onChange={(event) => setHistoricalCost(event.target.value)}
                      placeholder="Bijvoorbeeld 66.20"
                    />
                  </label>
                  <label className="field-label">
                    Actief sinds
                    <input className="editor-input" type="date" value={historicalDate} onChange={(event) => setHistoricalDate(event.target.value)} />
                  </label>
                  <label className="field-label">
                    Leverancier / bron
                    <input className="editor-input" value={historicalSupplier} onChange={(event) => setHistoricalSupplier(event.target.value)} />
                  </label>
                  <label className="field-label">
                    Notitie
                    <input className="editor-input" value={historicalNote} onChange={(event) => setHistoricalNote(event.target.value)} />
                  </label>
                  <span className="module-card-text">
                    Gebruik dit alleen voor bekende verkoopbare SKU's zonder Douano LOT en zonder bestaande kostprijs. De app maakt een historische kostprijsversie aan en telt overhead en accijns automatisch op bij de inkoopprijs.
                  </span>
                </>
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

export function DataQualityIntegrationWorkspace({
  initialStatus,
  skus,
  articles = [],
  advanced,
}: {
  initialStatus: SetupStatus;
  skus: GenericRecord[];
  articles?: GenericRecord[];
  advanced: ReactNode;
}) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [openMissingId, setOpenMissingId] = useState("");

  const activeStep = DATA_QUALITY_WORKSTREAMS[activeStepIndex] ?? DATA_QUALITY_WORKSTREAMS[0];
  const overviewChecks = useMemo(() => checkById(initialStatus, ["product_mappings", "stock_history_lots", "sales_rows_cost_source"]), [initialStatus]);
  const syncChecks = useMemo(() => checkById(initialStatus, ["douano_products", "sales_invoices", "stock_history_sync"]), [initialStatus]);
  const productChecks = useMemo(() => checkById(initialStatus, ["product_mappings"]), [initialStatus]);
  const costSourceChecks = useMemo(() => checkById(initialStatus, ["sales_rows_cost_source"]), [initialStatus]);
  const lotChecks = useMemo(() => checkById(initialStatus, ["stock_history_lots"]), [initialStatus]);
  const exceptionChecks = useMemo(
    () => checkById(initialStatus, ["sales_rows_cost_source"]),
    [initialStatus]
  );

  function renderCostSourceRowAction(row: GenericRecord, scopeRows: GenericRecord[]) {
    return <CostSourceRowAction row={row} scopeRows={scopeRows} skus={skus} year={initialStatus.year} />;
  }

  function renderStepBody() {
    if (activeStep.id === "overview") {
      return (
        <div className="wizard-stack">
          <WorkstreamIntro step={activeStep} />
          <YearSelector status={initialStatus} />
          <ReliabilityBanner status={initialStatus} />
          <CheckGrid
            checks={overviewChecks}
            openId={openMissingId}
            setOpenId={setOpenMissingId}
            renderRowAction={renderCostSourceRowAction}
            title="Blokkeert margeanalyse"
            description="Deze kaarten tonen alleen wat Omzet & Marge voor dit jaar onbetrouwbaar maakt."
          />
        </div>
      );
    }

    if (activeStep.id === "products") {
      return (
        <div className="wizard-stack">
          <WorkstreamIntro step={activeStep} />
          <CheckGrid
            checks={productChecks}
            openId={openMissingId}
            setOpenId={setOpenMissingId}
            renderRowAction={renderCostSourceRowAction}
            title="Productkoppelingen"
            description="Verkochte Douano producten moeten naar een interne SKU wijzen voordat kostprijs en rapportage betrouwbaar zijn."
          />
          <DouanoProductMappingCard />
        </div>
      );
    }

    if (activeStep.id === "cost_sources") {
      return (
        <div className="wizard-stack">
          <WorkstreamIntro step={activeStep} />
          <CheckGrid
            checks={costSourceChecks}
            openId={openMissingId}
            setOpenId={setOpenMissingId}
            renderRowAction={renderCostSourceRowAction}
            title="Verkoopregels zonder kostprijsbron"
            description="Los regels op via SKU-koppeling, historische kostprijs, LOT alias of een expliciete categorie zonder kostprijs."
          />
        </div>
      );
    }

    if (activeStep.id === "lots") {
      return (
        <div className="wizard-stack">
          <WorkstreamIntro step={activeStep} />
          <CheckGrid
            checks={lotChecks}
            openId={openMissingId}
            setOpenId={setOpenMissingId}
            renderRowAction={renderCostSourceRowAction}
            title="LOT-dekking verkoopregels"
            description="Bier-SKU's moeten een bruikbare LOT-route hebben. Geschenkverpakkingen gebruiken de kostprijs uit hun samenstelling."
          />
          <LotKostenWorkspace skus={skus} articles={articles} year={initialStatus.year} />
        </div>
      );
    }

    if (activeStep.id === "exceptions") {
      return (
        <div className="wizard-stack">
          <WorkstreamIntro step={activeStep} />
          {hasMissing(exceptionChecks) ? (
            <CheckGrid
              checks={exceptionChecks}
              openId={openMissingId}
              setOpenId={setOpenMissingId}
              renderRowAction={renderCostSourceRowAction}
              title="Nog te categoriseren uitzonderingen"
              description="Regels die buiten de normale SKU/LOT-route lopen moeten expliciet verklaard zijn."
            />
          ) : (
            <div className="placeholder-block">Geen openstaande uitzonderingen voor het geselecteerde jaar.</div>
          )}
          <DouanoUnmappedRulesCard initialYear={initialStatus.year} />
        </div>
      );
    }

    if (activeStep.id === "api") {
      return (
        <div className="wizard-stack">
          <WorkstreamIntro step={activeStep} />
          <ApiRunStatusTable />
          <CheckGrid
            checks={syncChecks}
            openId={openMissingId}
            setOpenId={setOpenMissingId}
            renderRowAction={renderCostSourceRowAction}
            title="Sync voorwaarden"
            description="Deze checks laten zien of de benodigde Douano bronnen recent genoeg gevuld zijn."
          />
          <DouanoSyncPanel />
        </div>
      );
    }

    return (
      <div className="wizard-stack">
        <WorkstreamIntro step={activeStep} />
        {advanced}
      </div>
    );
  }

  return (
    <div className="cpq-shell data-quality-shell">
      <WizardSteps
        title="Werkstromen"
        steps={DATA_QUALITY_WORKSTREAMS.map((step) => ({
          id: step.id,
          title: step.title,
          description: step.description,
        }))}
        activeIndex={activeStepIndex}
        onSelect={(index) => {
          setOpenMissingId("");
          setActiveStepIndex(index);
        }}
      />
      <div className="cpq-main">
        <div className="wizard-step-card wizard-step-stage-card">
          <div className="wizard-step-header">
            <div className="wizard-step-title">
              {activeStep.title}
            </div>
            <div className="wizard-step-description">{activeStep.description}</div>
          </div>
          <div className="wizard-step-body">{renderStepBody()}</div>
        </div>
      </div>
    </div>
  );
}
