"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DouanoProductMappingCard } from "@/components/DouanoProductMappingCard";
import { DouanoSyncPanel } from "@/components/DouanoSyncPanel";
import { DouanoUnmappedRulesCard } from "@/components/DouanoUnmappedRulesCard";
import { LotKostenWorkspace } from "@/components/lot-kosten/LotKostenWorkspace";
import { WizardSteps } from "@/components/WizardSteps";
import { CostSourceRowAction } from "@/components/beheer/data-quality/CostSourceRowAction";
import {
  ApiRunStatusTable,
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
  const checksByWorkstream = useMemo(() => {
    return DATA_QUALITY_WORKSTREAMS.reduce((acc, step) => {
      acc[step.id] = checkById(initialStatus, DATA_QUALITY_CHECK_GROUPS[step.id] ?? []);
      return acc;
    }, {} as Record<(typeof DATA_QUALITY_WORKSTREAMS)[number]["id"], ReturnType<typeof checkById>>);
  }, [initialStatus]);
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

    if (activeStep.id === "api") {
      return (
        <div className="wizard-stack">
          <WorkstreamIntro step={activeStep} />
          <ApiRunStatusTable />
          <CheckGrid
            checks={checksByWorkstream.api}
            openId={openMissingId}
            setOpenId={setOpenMissingId}
            renderRowAction={renderCostSourceRowAction}
            title={DATA_QUALITY_SECTION_COPY.api.title}
            description={DATA_QUALITY_SECTION_COPY.api.description}
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
            <div className="wizard-step-description">{sectionCopy?.description ?? activeStep.description}</div>
          </div>
          <div className="wizard-step-body">{renderStepBody()}</div>
        </div>
      </div>
    </div>
  );
}
