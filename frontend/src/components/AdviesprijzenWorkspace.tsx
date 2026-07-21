"use client";

import { useMemo, useState } from "react";

import type { VatDisplayMode } from "@/components/ui/VatDisplayToggle";
import {
  buildAdviesOpslagByChannel,
  buildAdviesprijzenSavePayload,
  buildChannelDefaultOpslag,
  buildProductCostRows,
  buildProductionYears,
  buildYears,
  buildYearRows,
  normalizeAdviesprijsRows,
  normalizeChannels,
  type AdviesprijsRow,
  type Channel,
  type ProductCostRow,
} from "@/components/adviesprijzen/adviesprijzenDerivations";
import { parseBtwPct } from "@/components/adviesprijzen/adviesprijzenUtils";
import {
  buildSellInLookup,
  resolveSellInPriceEx,
} from "@/components/offerte-samenstellen/sellInResolver";
import {
  buildRecommendedPriceDisplayRow,
  getDefaultRecommendedPriceYear,
  RECOMMENDED_PRICE_SAVE_ERROR,
  RECOMMENDED_PRICE_SAVE_SUCCESS,
} from "@/features/recommended-price/recommendedPriceFormModel";
import {
  RecommendedPriceWorkspaceView,
  type RecommendedPriceChannelGroup,
} from "@/features/recommended-price/RecommendedPriceWorkspaceView";
import { useCentralSkuIndex } from "@/features/sku/useCentralSkuIndex";
import { reconcileDatasetItems } from "@/lib/datasetItems";

type GenericRecord = Record<string, unknown>;
type ProductieMap = Record<string, unknown>;

export type AdviesprijzenWorkspaceProps = {
  initialChannels: GenericRecord[];
  initialAdviesprijzen: GenericRecord[];
  initialProductie: ProductieMap;
  initialVerkoopprijzen: GenericRecord[];
  initialBieren: GenericRecord[];
  initialSkus: GenericRecord[];
  initialArticles: GenericRecord[];
  initialKostprijsversies: GenericRecord[];
  initialKostprijsproductactiveringen: GenericRecord[];
  initialPackagingComponents: GenericRecord[];
  initialPackagingComponentPriceVersions: GenericRecord[];
};

export function AdviesprijzenWorkspace(props: AdviesprijzenWorkspaceProps) {
  const [vatDisplay, setVatDisplay] = useState<VatDisplayMode>("excl");
  const channels = useMemo(() => normalizeChannels(props.initialChannels), [props.initialChannels]);
  const [rows, setRows] = useState<AdviesprijsRow[]>(() => normalizeAdviesprijsRows(props.initialAdviesprijzen));

  const productionYears = useMemo(
    () => buildProductionYears(props.initialProductie ?? {}),
    [props.initialProductie]
  );
  const years = useMemo(() => buildYears(productionYears, rows), [productionYears, rows]);
  const [selectedYear, setSelectedYear] = useState<number>(() =>
    getDefaultRecommendedPriceYear(years, new Date().getFullYear())
  );
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const activeChannels = useMemo(() => channels.filter((channel) => channel.actief), [channels]);
  const channelCodes = useMemo(() => activeChannels.map((channel) => channel.code), [activeChannels]);
  const [openChannelCodes, setOpenChannelCodes] = useState<string[]>(() => activeChannels.map((channel) => channel.code));

  const adviesOpslagByChannel = useMemo(
    () => buildAdviesOpslagByChannel(rows, selectedYear),
    [rows, selectedYear]
  );
  const verkoopprijzenRows = useMemo(
    () => Array.isArray(props.initialVerkoopprijzen) ? props.initialVerkoopprijzen : [],
    [props.initialVerkoopprijzen]
  );
  const kostprijsversies = useMemo(
    () => Array.isArray(props.initialKostprijsversies) ? props.initialKostprijsversies : [],
    [props.initialKostprijsversies]
  );
  const activations = useMemo(
    () => Array.isArray(props.initialKostprijsproductactiveringen) ? props.initialKostprijsproductactiveringen : [],
    [props.initialKostprijsproductactiveringen]
  );
  const bieren = useMemo(
    () => Array.isArray(props.initialBieren) ? props.initialBieren : [],
    [props.initialBieren]
  );
  const skus = useMemo(
    () => Array.isArray(props.initialSkus) ? props.initialSkus : [],
    [props.initialSkus]
  );
  const articles = useMemo(
    () => Array.isArray(props.initialArticles) ? props.initialArticles : [],
    [props.initialArticles]
  );

  const beerById = useMemo(() => {
    const map = new Map<string, { biernaam: string; btwPct: number }>();
    bieren.forEach((row) => {
      const id = String(row?.id ?? "");
      if (!id) return;
      map.set(id, {
        biernaam: String(row?.biernaam ?? row?.naam ?? ""),
        btwPct: parseBtwPct(row?.btw_tarief ?? row?.btw ?? ""),
      });
    });
    return map;
  }, [bieren]);

  const skuById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    skus.forEach((row) => {
      const id = String(row?.id ?? "").trim();
      if (id) map.set(id, row);
    });
    return map;
  }, [skus]);

  const articleNameById = useMemo(() => {
    const map = new Map<string, string>();
    articles.forEach((row) => {
      const id = String(row?.id ?? "").trim();
      if (!id) return;
      map.set(id, String(row?.name ?? row?.naam ?? id).trim() || id);
    });
    return map;
  }, [articles]);

  const centralSkuIndex = useCentralSkuIndex({
    year: selectedYear,
    channels: props.initialChannels,
    verkoopprijzen: verkoopprijzenRows,
    skus,
    articles,
    kostprijsversies,
    kostprijsproductactiveringen: activations,
  });

  const productCostRows = useMemo<ProductCostRow[]>(() => {
    // Keep the existing RF-010/RF-011 source path unchanged in RF-012B2.
    return buildProductCostRows({
      centralRows: centralSkuIndex.rows,
      skuById,
      beerById,
      articleNameById,
    });
  }, [centralSkuIndex.rows, skuById, beerById, articleNameById]);

  const sellInLookup = useMemo(
    () => buildSellInLookup(verkoopprijzenRows, selectedYear),
    [verkoopprijzenRows, selectedYear]
  );
  const channelDefaultOpslag = useMemo(
    () => buildChannelDefaultOpslag(activeChannels),
    [activeChannels]
  );
  const yearRows = useMemo(
    () => buildYearRows({ rows, selectedYear, activeChannels }),
    [rows, selectedYear, activeChannels]
  );

  const channelGroups = useMemo<RecommendedPriceChannelGroup[]>(() => {
    return activeChannels.map((channel) => {
      const adviesOpslag = adviesOpslagByChannel.get(channel.code) ?? 0;
      return {
        channel,
        adviesOpslag,
        rows: productCostRows.map((row) => {
          const { sellInEx } = resolveSellInPriceEx({
            bierId: row.bierId,
            productId: row.productId,
            costPriceEx: row.kostprijsEx,
            channelCode: channel.code,
            lookup: sellInLookup,
            channelDefaultOpslag,
          });
          return buildRecommendedPriceDisplayRow({ row, sellInEx, adviesOpslagPct: adviesOpslag, vatDisplay });
        }),
      };
    });
  }, [activeChannels, adviesOpslagByChannel, channelDefaultOpslag, productCostRows, sellInLookup, vatDisplay]);

  function updateMarkup(channel: Channel, row: AdviesprijsRow, nextValue: number) {
    setRows((current) => {
      const other = current.filter(
        (item) => !(Number(item.jaar ?? 0) === selectedYear && item.channel_code === channel.code)
      );
      return [
        ...other,
        {
          id: row.id,
          jaar: selectedYear,
          channel_code: channel.code,
          opslag_pct: nextValue,
        },
      ];
    });
  }

  function toggleChannel(code: string, nextOpen: boolean) {
    setOpenChannelCodes((current) => {
      const exists = current.includes(code);
      if (nextOpen && !exists) return [...current, code];
      if (!nextOpen && exists) return current.filter((currentCode) => currentCode !== code);
      return current;
    });
  }

  async function save() {
    setIsSaving(true);
    setStatus("");
    try {
      const next = buildAdviesprijzenSavePayload({ rows, selectedYear, yearRows });
      await reconcileDatasetItems("adviesprijzen", next);
      setRows(next);
      setStatus(RECOMMENDED_PRICE_SAVE_SUCCESS);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : RECOMMENDED_PRICE_SAVE_ERROR);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <RecommendedPriceWorkspaceView
      years={years}
      selectedYear={selectedYear}
      vatDisplay={vatDisplay}
      yearRows={yearRows}
      channelCodes={channelCodes}
      openChannelCodes={openChannelCodes}
      channelGroups={channelGroups}
      status={status}
      isSaving={isSaving}
      onYearChange={setSelectedYear}
      onVatDisplayChange={setVatDisplay}
      onMarkupChange={updateMarkup}
      onSetOpenChannelCodes={setOpenChannelCodes}
      onToggleChannel={toggleChannel}
      onSave={save}
    />
  );
}
