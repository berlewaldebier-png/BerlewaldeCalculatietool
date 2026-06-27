"use client";

import Link from "next/link";

import { useMemo, useState } from "react";
import { DouanoProductMappingCard } from "@/components/DouanoProductMappingCard";
import { DouanoUnmappedRulesCard } from "@/components/DouanoUnmappedRulesCard";
import { LotKostenWorkspace } from "@/components/lot-kosten/LotKostenWorkspace";
import { CostSourceRowAction } from "@/components/beheer/data-quality/CostSourceRowAction";
import { DataQualityTabs } from "@/components/beheer/data-quality/DataQualityTabs";
import {
  CheckGrid,
  DATA_QUALITY_CHECK_GROUPS,
  DATA_QUALITY_SECTION_COPY,
  DATA_QUALITY_WORKSTREAMS,
  ReliabilityBanner,
  WorkstreamIntro,
  YearSelector,
  checkById,
  type GenericRecord,
  type SetupStatus,
} from "@/components/beheer/data-quality/DataQualityWorkbenchParts";

export function DataQualityIntegrationWorkspace({
  initialStatus,
  skus,
  articles = [],
}: {
  initialStatus: SetupStatus;
  skus: GenericRecord[];
  articles?: GenericRecord[];
}) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [openMissingId, setOpenMissingId] = useState("");

  const activeStep = DATA_QUALITY_WORKSTREAMS[activeStepIndex] ?? DATA_QUALITY_WORKSTREAMS[0];
  const checksByWorkstream = useMemo(() => {
    return DATA_QUALITY_WORKSTREAMS.reduce((acc, step) => {
      acc[step.id] = checkById(initialStatus, DATA_QUALITY_CHECK_GROUPS[step.id] ?? []);
      return acc;
    }, {} as Record<(typeof DATA_QUALITY_WORKSTREAMS)[number]["id"], ReturnType<typeof checkById>>);
  }, [initialStatus]);
  const tabBadges = useMemo(() => {
    return DATA_QUALITY_WORKSTREAMS.reduce((acc, step) => {
      const checks = checksByWorkstream[step.id] ?? [];
      const open = checks.filter((check) => !check.done).length;
      acc[step.id] = open > 0
        ? { label: String(open), tone: "warning" as const }
        : { label: "ok", tone: checks.length > 0 ? ("ok" as const) : ("neutral" as const) };
      return acc;
    }, {} as Record<(typeof DATA_QUALITY_WORKSTREAMS)[number]["id"], { label: string; tone: "ok" | "warning" | "neutral" }>);
  }, [checksByWorkstream]);
  const sectionCopy = DATA_QUALITY_SECTION_COPY[activeStep.id];

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
            checks={checksByWorkstream.overview}
            openId={openMissingId}
            setOpenId={setOpenMissingId}
            renderRowAction={renderCostSourceRowAction}
            title={DATA_QUALITY_SECTION_COPY.overview.title}
            description={DATA_QUALITY_SECTION_COPY.overview.description}
          />
        </div>
      );
    }

    if (activeStep.id === "products") {
      return (
        <div className="wizard-stack">
          <WorkstreamIntro step={activeStep} />
          <CheckGrid
            checks={checksByWorkstream.products}
            openId={openMissingId}
            setOpenId={setOpenMissingId}
            renderRowAction={renderCostSourceRowAction}
            title={DATA_QUALITY_SECTION_COPY.products.title}
            description={DATA_QUALITY_SECTION_COPY.products.description}
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
            checks={checksByWorkstream.cost_sources}
            openId={openMissingId}
            setOpenId={setOpenMissingId}
            renderRowAction={renderCostSourceRowAction}
            title={DATA_QUALITY_SECTION_COPY.cost_sources.title}
            description={DATA_QUALITY_SECTION_COPY.cost_sources.description}
          />
        </div>
      );
    }

    if (activeStep.id === "lots") {
      return (
        <div className="wizard-stack">
          <WorkstreamIntro step={activeStep} />
          <CheckGrid
            checks={checksByWorkstream.lots}
            openId={openMissingId}
            setOpenId={setOpenMissingId}
            renderRowAction={renderCostSourceRowAction}
            title={DATA_QUALITY_SECTION_COPY.lots.title}
            description={DATA_QUALITY_SECTION_COPY.lots.description}
          />
          <LotKostenWorkspace skus={skus} articles={articles} year={initialStatus.year} />
        </div>
      );
    }

    if (activeStep.id === "exceptions") {
      return (
        <div className="wizard-stack">
          <WorkstreamIntro step={activeStep} />
          <div className="placeholder-block">{DATA_QUALITY_SECTION_COPY.exceptions.description}</div>
          <DouanoUnmappedRulesCard initialYear={initialStatus.year} />
        </div>
      );
    }

    return (
      <div className="wizard-stack">
        <WorkstreamIntro step={activeStep} />
        <section className="module-card">
          <div className="module-card-header">
            <div className="module-card-title">Technische integratie</div>
            <div className="module-card-text">
              Sync-runs, Douano verbinding en API-diagnose staan los van deze datakwaliteit-flow.
            </div>
          </div>
          <div className="editor-actions">
            <Link href="/beheer/api-integratie" className="editor-button">
              Open API-integratie
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="data-quality-shell">
      <DataQualityTabs
        steps={DATA_QUALITY_WORKSTREAMS}
        activeIndex={activeStepIndex}
        badges={tabBadges}
        onSelect={(index) => {
          setOpenMissingId("");
          setActiveStepIndex(index);
        }}
      />
      <div className="data-quality-panel">
        <div className="data-quality-panel-header">
          <div className="data-quality-panel-title">
            {activeStep.title}
          </div>
          <div className="data-quality-panel-description">{sectionCopy?.description ?? activeStep.description}</div>
        </div>
        <div className="data-quality-panel-body">{renderStepBody()}</div>
      </div>
    </div>
  );
}
