"use client";

import { useMemo, useState } from "react";

import type { ActionStatusState } from "@/components/ActionStatus";
import type { VatDisplayMode } from "@/components/ui/VatDisplayToggle";
import {
  buildActiveRecommendedPriceDisplayRow,
  filterActiveRecommendedPriceGroups,
  type ActiveRecommendedPriceProjection,
} from "@/features/recommended-price/activeRecommendedPriceModel";
import {
  RecommendedPriceWorkspaceView,
  type RecommendedPriceChannelGroup,
} from "@/features/recommended-price/RecommendedPriceWorkspaceView";
import { ApiRequestError, apiRequestJsonClient } from "@/lib/apiClient";

type DraftMarkups = Record<string, number | "">;

export type AdviesprijzenWorkspaceProps = {
  initialProjection: ActiveRecommendedPriceProjection;
};

function initialDrafts(projection: ActiveRecommendedPriceProjection): DraftMarkups {
  return Object.fromEntries(
    projection.channels.map((channel) => [
      channel.channel_code,
      channel.advice_markup_pct ?? "",
    ])
  );
}

function errorStatus(error: unknown): ActionStatusState {
  if (error instanceof ApiRequestError && error.status === 409) {
    return {
      kind: "error",
      message: error.detail || "De actieve adviesinstellingen zijn intussen gewijzigd.",
      guidance: "Herlaad de pagina, controleer de nieuwe waarden en probeer opnieuw.",
    };
  }
  return {
    kind: "error",
    message: "Opslaan mislukt.",
    guidance: "Controleer de ingevoerde opslagen en je verbinding. Probeer daarna opnieuw.",
  };
}

export function AdviesprijzenWorkspace({ initialProjection }: AdviesprijzenWorkspaceProps) {
  const [projection, setProjection] = useState(initialProjection);
  const [vatDisplay, setVatDisplay] = useState<VatDisplayMode>("excl");
  const [drafts, setDrafts] = useState<DraftMarkups>(() => initialDrafts(initialProjection));
  const [dirtyChannelCodes, setDirtyChannelCodes] = useState<Set<string>>(() => new Set());
  const [openChannelCodes, setOpenChannelCodes] = useState<string[]>(() =>
    initialProjection.channels.map((channel) => channel.channel_code)
  );
  const [filter, setFilter] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<ActionStatusState | null>(null);

  const visibleGroups = useMemo(
    () => filterActiveRecommendedPriceGroups(projection.groups, filter),
    [projection.groups, filter]
  );
  const channelCodes = useMemo(
    () => projection.channels.map((channel) => channel.channel_code),
    [projection.channels]
  );
  const channelGroups = useMemo<RecommendedPriceChannelGroup[]>(() =>
    projection.channels.map((channel) => {
      const draft = drafts[channel.channel_code];
      const markup = draft === "" ? null : Number(draft);
      return {
        channel,
        adviceMarkupPct: markup,
        rows: visibleGroups.flatMap((group) =>
          group.items.map((item) =>
            buildActiveRecommendedPriceDisplayRow({
              item,
              ownerLabel: group.label,
              adviceMarkupPct: markup,
              vatDisplay,
            })
          )
        ),
      };
    }),
  [drafts, projection.channels, vatDisplay, visibleGroups]);

  function updateMarkup(channelCode: string, value: number | "") {
    setDrafts((current) => ({ ...current, [channelCode]: value }));
    setDirtyChannelCodes((current) => new Set(current).add(channelCode));
    setStatus(null);
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
    if (!projection.binding || dirtyChannelCodes.size === 0) return;
    setIsSaving(true);
    setStatus({ kind: "pending", message: "Adviesopslagen worden opgeslagen." });
    try {
      const byCode = new Map(
        projection.channels.map((channel) => [channel.channel_code, channel])
      );
      const changes = [...dirtyChannelCodes].map((channelCode) => {
        const channel = byCode.get(channelCode);
        const markup = drafts[channelCode];
        if (!channel || markup === "" || !Number.isFinite(markup) || markup < 0) {
          throw new Error("invalid-markup");
        }
        return {
          channel_code: channelCode,
          advice_markup_pct: markup,
          pricing_record_id: channel.pricing_record_id,
          expected_record_hash: channel.pricing_record_hash,
        };
      });
      const next = await apiRequestJsonClient<ActiveRecommendedPriceProjection>(
        "/meta/commercial-yearsets/active/recommended-prices",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generation_id: projection.binding.generation_id,
            run_id: projection.binding.run_id,
            manifest_hash: projection.binding.manifest_hash,
            changes,
          }),
        },
        { timeoutMs: 30_000 }
      );
      setProjection(next);
      setDrafts(initialDrafts(next));
      setDirtyChannelCodes(new Set());
      setStatus({ kind: "success", message: "Adviesopslagen opgeslagen." });
    } catch (error) {
      if (error instanceof Error && error.message === "invalid-markup") {
        setStatus({
          kind: "error",
          message: "Vul voor ieder gewijzigd kanaal een opslag van nul of hoger in.",
          guidance: "Ontbrekende SKU-bronnen worden niet automatisch ingevuld of aangepast.",
        });
      } else {
        setStatus(errorStatus(error));
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <RecommendedPriceWorkspaceView
      projection={projection}
      vatDisplay={vatDisplay}
      drafts={drafts}
      filter={filter}
      channelCodes={channelCodes}
      openChannelCodes={openChannelCodes}
      channelGroups={channelGroups}
      status={status}
      isSaving={isSaving}
      dirtyCount={dirtyChannelCodes.size}
      onVatDisplayChange={setVatDisplay}
      onMarkupChange={updateMarkup}
      onFilterChange={setFilter}
      onSetOpenChannelCodes={setOpenChannelCodes}
      onToggleChannel={toggleChannel}
      onSave={save}
    />
  );
}
