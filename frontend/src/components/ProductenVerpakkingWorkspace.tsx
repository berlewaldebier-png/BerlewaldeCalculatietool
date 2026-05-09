"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DatasetTableEditor } from "@/components/DatasetTableEditor";
import { VerkoopbareArtikelenWorkspace } from "@/components/VerkoopbareArtikelenWorkspace";
import { API_BASE_URL } from "@/lib/api";
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
            kostprijsversies={Array.isArray(kostprijsversies) ? kostprijsversies : []}
            kostprijsproductactiveringen={
              Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []
            }
          />
        </div>
      ) : null}

      {activeTab === "verpakking" ? (
        <div className="content-card">
          <DatasetTableEditor
            endpoint="/data/packaging-components"
            title="Verpakkingsonderdelen"
            description="Onderdelen die je gebruikt in afvuleenheden en samengestelde artikelen (bijv. dop, doos, giftbox)."
            columns={[
              { key: "omschrijving", label: "Omschrijving", type: "text" },
              { key: "beschikbaar_voor_samengesteld", label: "Beschikbaar", type: "checkbox", width: "140px" },
            ]}
            initialRows={Array.isArray(verpakkingsonderdelen) ? (verpakkingsonderdelen as any) : []}
            addRowTemplate={{
              id: "",
              omschrijving: "",
              beschikbaar_voor_samengesteld: true,
            }}
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
