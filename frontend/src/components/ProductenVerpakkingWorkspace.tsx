"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DatasetTableEditor } from "@/components/DatasetTableEditor";
import { VerkoopbareArtikelenWorkspace } from "@/components/VerkoopbareArtikelenWorkspace";
import { API_BASE_URL } from "@/lib/api";
import { reconcileDatasetItems } from "@/lib/datasetItems";
import { determineDefaultYear, type GenericRecord } from "@/components/producten-verpakking/productenVerpakkingUtils";
import {
  buildAvailablePriceYears,
  buildYearPricesDraft,
  buildYearPricesPayload,
  saveYearPricesLayer,
} from "@/components/producten-verpakking/productenVerpakkingYearPrices";
import { ProductenVerpakkingHero } from "@/components/producten-verpakking/ProductenVerpakkingHero";
import { ProductenVerpakkingTabs } from "@/components/producten-verpakking/ProductenVerpakkingTabs";
import { AfvuleenhedenTab } from "@/components/producten-verpakking/AfvuleenhedenTab";
import { YearPricesTab } from "@/components/producten-verpakking/YearPricesTab";

type TabKey = "verkoopbaar" | "verpakking" | "afvuleenheden" | "jaarprijzen" | "glasmaten";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function makeDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `component-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function PackagingComponentsEditor({
  rows,
  bieren,
}: {
  rows: GenericRecord[];
  bieren: GenericRecord[];
}) {
  const router = useRouter();
  const [draftRows, setDraftRows] = useState<GenericRecord[]>(() => rows.map((row) => ({ ...row })));
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [modalRowId, setModalRowId] = useState("");
  const [categoryType, setCategoryType] = useState<"merchandise" | "beer">("merchandise");
  const [categoryId, setCategoryId] = useState("");

  useEffect(() => {
    setDraftRows(rows.map((row) => ({ ...row })));
  }, [rows]);

  const beerOptions = useMemo(() => {
    return (Array.isArray(bieren) ? bieren : [])
      .map((row) => ({
        id: text((row as any).id),
        label: text((row as any).biernaam || (row as any).naam || (row as any).name),
      }))
      .filter((row) => row.id && row.label)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [bieren]);

  const modalRow = useMemo(
    () => draftRows.find((row) => text((row as any).id) === modalRowId) ?? null,
    [draftRows, modalRowId]
  );

  function updateRow(rowId: string, patch: GenericRecord) {
    setDraftRows((current) =>
      current.map((row) => (text((row as any).id) === rowId ? { ...row, ...patch } : row))
    );
  }

  function addRow() {
    setDraftRows((current) => [
      ...current,
      {
        id: makeDraftId(),
        component_key: "",
        omschrijving: "",
        beschikbaar_voor_samengesteld: true,
        beschikbaar_voor_offertes: false,
      },
    ]);
  }

  function deleteRow(rowId: string) {
    setDraftRows((current) => current.filter((row) => text((row as any).id) !== rowId));
  }

  function toggleOffertes(row: GenericRecord, checked: boolean) {
    const rowId = text((row as any).id);
    if (!checked) {
      updateRow(rowId, { beschikbaar_voor_offertes: false });
      return;
    }
    const existingType = text((row as any).sellable_category_type);
    const existingCategory = text((row as any).sellable_category_id);
    setCategoryType(existingType === "beer" ? "beer" : "merchandise");
    setCategoryId(existingType === "beer" ? existingCategory : "");
    setModalRowId(rowId);
  }

  async function saveRows(nextRows = draftRows) {
    setStatus("");
    setIsSaving(true);
    try {
      await reconcileDatasetItems("packaging-components", nextRows as Array<Record<string, unknown>>);
      setStatus("Opgeslagen.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? `Opslaan mislukt: ${error.message}` : "Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmSellableSku() {
    if (!modalRow) return;
    const componentId = text((modalRow as any).id);
    if (!componentId) return;
    if (categoryType === "beer" && !categoryId) {
      setStatus("Kies een stijl of gebruik Merchandise.");
      return;
    }
    setIsSaving(true);
    setStatus("Verkoopbare SKU maken...");
    try {
      const response = await fetch(`${API_BASE_URL}/data/packaging-components/${encodeURIComponent(componentId)}/sellable-sku`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_type: categoryType,
          category_id: categoryType === "beer" ? categoryId : "",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String((payload as any)?.detail || response.statusText));
      }
      const nextRows = draftRows.map((row) =>
        text((row as any).id) === componentId
          ? {
              ...row,
              beschikbaar_voor_offertes: true,
              sellable_sku_id: text((payload as any).sku_id),
              sellable_category_type: categoryType,
              sellable_category_id: categoryType === "beer" ? categoryId : "",
            }
          : row
      );
      setDraftRows(nextRows);
      setModalRowId("");
      setStatus("Verkoopbare SKU aangemaakt.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? `SKU maken mislukt: ${error.message}` : "SKU maken mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Verpakkingsonderdelen</div>
        <div className="module-card-text">
          Onderdelen die je gebruikt in afvuleenheden en samengestelde artikelen. Zet `In offertes` aan om er ook een verkoopbare SKU van te maken.
        </div>
      </div>
      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>Omschrijving</th>
              <th style={{ width: 170 }}>In samenstellingen</th>
              <th style={{ width: 140 }}>In offertes</th>
              <th style={{ width: 170 }}>Categorie</th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {draftRows.map((row) => {
              const rowId = text((row as any).id);
              const categoryLabel =
                text((row as any).sellable_category_type) === "beer"
                  ? beerOptions.find((beer) => beer.id === text((row as any).sellable_category_id))?.label || "Stijl"
                  : Boolean((row as any).beschikbaar_voor_offertes)
                    ? "Merchandise"
                    : "-";
              return (
                <tr key={rowId}>
                  <td>
                    <input
                      className="dataset-input"
                      value={text((row as any).omschrijving)}
                      onChange={(event) => updateRow(rowId, { omschrijving: event.target.value })}
                    />
                  </td>
                  <td>
                    <label className="dataset-checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean((row as any).beschikbaar_voor_samengesteld)}
                        onChange={(event) => updateRow(rowId, { beschikbaar_voor_samengesteld: event.target.checked })}
                      />
                      <span>{Boolean((row as any).beschikbaar_voor_samengesteld) ? "Ja" : "Nee"}</span>
                    </label>
                  </td>
                  <td>
                    <label className="dataset-checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean((row as any).beschikbaar_voor_offertes)}
                        onChange={(event) => toggleOffertes(row, event.target.checked)}
                      />
                      <span>{Boolean((row as any).beschikbaar_voor_offertes) ? "Ja" : "Nee"}</span>
                    </label>
                  </td>
                  <td>{categoryLabel}</td>
                  <td>
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      onClick={() => deleteRow(rowId)}
                      style={{ minWidth: 0 }}
                    >
                      Wis
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="editor-actions">
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={addRow}>
            Rij toevoegen
          </button>
        </div>
        <div className="editor-actions-group">
          {status ? <span className="editor-status">{status}</span> : null}
          <button type="button" className="editor-button" onClick={() => void saveRows()} disabled={isSaving}>
            {isSaving ? "Opslaan..." : "Opslaan"}
          </button>
        </div>
      </div>

      {modalRow ? (
        <div className="cpq-modal-backdrop" role="dialog" aria-modal="true">
          <div className="cpq-modal">
            <div className="cpq-modal-header">
              <div>
                <div className="cpq-modal-title">Verkoopbare SKU maken</div>
                <div className="cpq-modal-subtitle">{text((modalRow as any).omschrijving)}</div>
              </div>
              <button type="button" className="editor-button editor-button-secondary" onClick={() => setModalRowId("")}>
                Sluiten
              </button>
            </div>
            <div className="cpq-modal-body">
              <label className="field-label">
                Categorie
                <select
                  className="editor-input"
                  value={categoryType === "merchandise" ? "merchandise" : categoryId}
                  onChange={(event) => {
                    if (event.target.value === "merchandise") {
                      setCategoryType("merchandise");
                      setCategoryId("");
                      return;
                    }
                    setCategoryType("beer");
                    setCategoryId(event.target.value);
                  }}
                >
                  <option value="merchandise">Merchandise</option>
                  {beerOptions.map((beer) => (
                    <option key={beer.id} value={beer.id}>
                      {beer.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="editor-actions" style={{ padding: "0 1.1rem 1rem" }}>
              <div />
              <div className="editor-actions-group">
                <button type="button" className="editor-button editor-button-secondary" onClick={() => setModalRowId("")}>
                  Annuleren
                </button>
                <button type="button" className="editor-button" onClick={() => void confirmSellableSku()} disabled={isSaving}>
                  SKU maken
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function ProductenVerpakkingWorkspace({
  productie,
  channels,
  verkoopprijzen,
  verpakkingsonderdelen,
  glasmaten,
  verpakkingsonderdeelPrijzen,
  articles,
  skus,
  bomLines,
  bieren,
  skuStyleLinks,
  kostprijsversies,
  kostprijsproductactiveringen,
}: {
  productie: Record<string, unknown>;
  channels: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  verpakkingsonderdelen: GenericRecord[];
  glasmaten: GenericRecord[];
  verpakkingsonderdeelPrijzen: GenericRecord[];
  articles: GenericRecord[];
  skus: GenericRecord[];
  bomLines: GenericRecord[];
  bieren: GenericRecord[];
  skuStyleLinks: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("verkoopbaar");
  const [yearPricesYear, setYearPricesYear] = useState<number | null>(null);
  const [yearPricesDraft, setYearPricesDraft] = useState<Record<string, number>>({});
  const [yearPricesStatus, setYearPricesStatus] = useState<string>("");
  const [isSavingYearPrices, setIsSavingYearPrices] = useState<boolean>(false);
  const [formatsYear, setFormatsYear] = useState<number | null>(null);

  const packagingMasters = Array.isArray(verpakkingsonderdelen) ? verpakkingsonderdelen : [];
  const packagingPrices = Array.isArray(verpakkingsonderdeelPrijzen) ? verpakkingsonderdeelPrijzen : [];
  const canonicalArticles = Array.isArray(articles) ? articles : [];
  const canonicalBomLines = Array.isArray(bomLines) ? bomLines : [];

  const formatArticles = useMemo(() => {
    return canonicalArticles
      .filter((row) => String((row as any)?.kind ?? "").toLowerCase() === "format")
      .slice()
      .sort((a, b) => String((a as any)?.name ?? "").localeCompare(String((b as any)?.name ?? ""), "nl-NL"));
  }, [canonicalArticles]);

  const productieYears = useMemo(() => {
    return buildAvailablePriceYears({ productie, packagingPrices }).productieYears;
  }, [packagingPrices, productie]);

  const year = useMemo(() => buildAvailablePriceYears({ productie, packagingPrices }).defaultYear, [packagingPrices, productie]);

  const availablePriceYears = useMemo(() => buildAvailablePriceYears({ productie, packagingPrices }).availablePriceYears, [packagingPrices, productie]);

  const sellableYear = useMemo(() => {
    const yearsFromActivations = (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : [])
      .map((row) => Number((row as any)?.jaar ?? 0) || 0)
      .filter((y) => y > 0);
    const yearsFromVersions = (Array.isArray(kostprijsversies) ? kostprijsversies : [])
      .map((row) => Number((row as any)?.jaar ?? (row as any)?.basisgegevens?.jaar ?? 0) || 0)
      .filter((y) => y > 0);
    const candidates = [...yearsFromActivations, ...yearsFromVersions];
    const maxYear = candidates.length ? Math.max(...candidates) : 0;
    return maxYear || year;
  }, [kostprijsproductactiveringen, kostprijsversies, year]);

  useEffect(() => {
    if (yearPricesYear !== null) return;
    setYearPricesYear(year);
  }, [year, yearPricesYear]);

  const activeYearForPrices = yearPricesYear ?? year;
  const activeYearForFormats = formatsYear ?? year;

  useEffect(() => {
    setYearPricesDraft(buildYearPricesDraft({ packagingMasters, packagingPrices, activeYearForPrices }));
  }, [activeYearForPrices, packagingMasters, packagingPrices]);

  async function handleSaveYearPricesLayer() {
    setYearPricesStatus("");
    setIsSavingYearPrices(true);
    try {
      const payload = buildYearPricesPayload({
        packagingMasters,
        packagingPrices,
        activeYearForPrices,
        yearPricesDraft,
      });
      const status = await saveYearPricesLayer({ activeYearForPrices, payload });
      setYearPricesStatus(status);
      router.refresh();
    } catch (err) {
      setYearPricesStatus(`Opslaan mislukt: ${String((err as any)?.message ?? err)}`);
    } finally {
      setIsSavingYearPrices(false);
    }
  }

  return (
    <div className="workspace">
      <div className="workspace-intro">
        <div className="muted">
          Stamdata, glasmaten en jaarprijzen. Verkoopbare artikelen komen uit de centrale SKU-lijst (actieve
          kostprijzen).
        </div>
      </div>

      <ProductenVerpakkingHero />

      <ProductenVerpakkingTabs activeTab={activeTab} setActiveTab={setActiveTab} />

      {activeTab === "verkoopbaar" ? (
        <div className="content-card">
          <VerkoopbareArtikelenWorkspace
            year={sellableYear}
            channels={Array.isArray(channels) ? channels : []}
            verkoopprijzen={Array.isArray(verkoopprijzen) ? verkoopprijzen : []}
            skus={Array.isArray(skus) ? skus : []}
            articles={Array.isArray(articles) ? articles : []}
            bomLines={Array.isArray(bomLines) ? bomLines : []}
            bieren={Array.isArray(bieren) ? bieren : []}
            skuStyleLinks={Array.isArray(skuStyleLinks) ? skuStyleLinks : []}
            kostprijsversies={Array.isArray(kostprijsversies) ? kostprijsversies : []}
            kostprijsproductactiveringen={
              Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []
            }
          />
        </div>
      ) : null}

      {activeTab === "verpakking" ? (
        <div className="content-card">
          <PackagingComponentsEditor
            rows={Array.isArray(verpakkingsonderdelen) ? (verpakkingsonderdelen as any) : []}
            bieren={Array.isArray(bieren) ? (bieren as any) : []}
          />
        </div>
      ) : null}

      {activeTab === "afvuleenheden" ? (
        <AfvuleenhedenTab
          formatArticles={formatArticles}
          activeYearForFormats={activeYearForFormats}
          availablePriceYears={availablePriceYears}
          setFormatsYear={setFormatsYear}
          packagingPrices={packagingPrices}
          canonicalBomLines={canonicalBomLines}
          canonicalArticles={canonicalArticles}
        />
      ) : null}

      {activeTab === "jaarprijzen" ? (
        <YearPricesTab
          packagingMasters={packagingMasters}
          availablePriceYears={availablePriceYears}
          activeYearForPrices={activeYearForPrices}
          setYearPricesYear={setYearPricesYear}
          yearPricesDraft={yearPricesDraft}
          setYearPricesDraft={setYearPricesDraft}
          isSavingYearPrices={isSavingYearPrices}
          handleSaveYearPricesLayer={handleSaveYearPricesLayer}
          yearPricesStatus={yearPricesStatus}
        />
      ) : null}

      {activeTab === "glasmaten" ? (
        <div className="content-card">
          <DatasetTableEditor
            endpoint="/data/glasmaten"
            title="Glasmaten"
            description="Gebruik glasmaten in offertes/bijlagen (bijv. proefglas 15cl)."
            columns={[
              { key: "id", label: "ID", type: "text", width: "220px" },
              { key: "omschrijving", label: "Omschrijving", type: "text" },
              { key: "inhoud_liter", label: "Inhoud (L)", type: "number", width: "160px" },
            ]}
            initialRows={Array.isArray(glasmaten) ? (glasmaten as any) : []}
            addRowTemplate={{
              id: "",
              omschrijving: "",
              inhoud_liter: 0,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
