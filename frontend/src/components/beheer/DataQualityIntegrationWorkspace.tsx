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
  DATA_QUALITY_WORKSTREAMS,
  ReliabilityBanner,
  WorkstreamIntro,
  YearSelector,
  checkById,
  hasMissing,
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
            checks={checksByWorkstream.products}
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
            checks={checksByWorkstream.cost_sources}
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
            checks={checksByWorkstream.lots}
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
          {hasMissing(checksByWorkstream.exceptions) ? (
            <CheckGrid
              checks={checksByWorkstream.exceptions}
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
            checks={checksByWorkstream.api}
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
