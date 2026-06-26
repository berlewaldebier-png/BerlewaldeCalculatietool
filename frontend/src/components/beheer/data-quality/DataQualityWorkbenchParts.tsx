"use client";

import Link from "next/link";
import { type ReactNode } from "react";

import { STEP_HELP } from "@/components/beheer/data-quality/DataQualityConfig";
import { qualityChecks } from "@/components/beheer/data-quality/DataQualityHelpers";
import type {
  GenericRecord,
  RowActionRenderer,
  SetupCheck,
  SetupStatus,
  WorkstreamDefinition,
} from "@/components/beheer/data-quality/DataQualityTypes";

export { DATA_QUALITY_CHECK_GROUPS, DATA_QUALITY_SECTION_COPY, DATA_QUALITY_WORKSTREAMS } from "@/components/beheer/data-quality/DataQualityConfig";
export { CheckCard, CheckGrid, MissingPanel, StatusPill } from "@/components/beheer/data-quality/DataQualityCheckPanels";
export { ApiRunStatusTable } from "@/components/beheer/data-quality/ApiRunStatusTable";
export {
  checkById,
  defaultHistoricalDate,
  flowHref,
  formatDateTime,
  hasMissing,
  missingRowKey,
  pct,
  qualityChecks,
  readDataSet,
  rowMatchPayload,
  searchableMissingRowText,
  skuLabel,
  statusLabel,
  syncDelta,
  valuePreview,
} from "@/components/beheer/data-quality/DataQualityHelpers";
export type {
  GenericRecord,
  RowActionRenderer,
  SetupCheck,
  SetupStatus,
  WorkstreamDefinition,
  WorkstreamKey,
} from "@/components/beheer/data-quality/DataQualityTypes";
export function SummaryMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value small">{value}</div>
    </div>
  );
}

export function YearSelector({ status }: { status: SetupStatus }) {
  const currentYear = Number(status.year || new Date().getFullYear());
  const productionYears = Array.isArray(status.summary.production_years)
    ? status.summary.production_years.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
    : [];
  const years = Array.from(new Set([...productionYears, currentYear])).sort((a, b) => b - a);
  return (
    <section className="module-card compact-card">
      <div className="module-card-header" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
        <div>
          <div className="module-card-title">Productiejaar</div>
          <div className="module-card-text">Datakwaliteit controleert Omzet & Marge voor het geselecteerde jaar.</div>
        </div>
        <select
          className="editor-input"
          value={String(currentYear)}
          onChange={(event) => {
            const nextYear = event.target.value;
            const url = new URL(window.location.href);
            url.searchParams.set("year", nextYear);
            window.location.href = url.toString();
          }}
          style={{ maxWidth: 220 }}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
      <div className="editor-actions" style={{ marginTop: 10 }}>
        <div className="editor-actions-group">
          {years.map((year) => (
            <Link
              key={year}
              href={`/beheer/api?year=${year}` as any}
              className={`status-pill ${year === currentYear ? (status.can_complete ? "status-ok" : "status-warning") : "pill"}`}
            >
              {year}{year === currentYear ? ` - ${status.can_complete ? "ok" : "controle"}` : ""}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ReliabilityBanner({ status }: { status: SetupStatus }) {
  const checks = qualityChecks(status);
  const blockers = checks.filter((check) => !check.done);
  return (
    <section className="module-card">
      <div className="module-card-header" style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div className="module-card-title">Margeanalyse betrouwbaar: {status.can_complete ? "ja" : "nee"}</div>
          <div className="module-card-text">
            De flow controleert of Douano data, productkoppelingen, LOTs en kostprijsbronnen compleet genoeg zijn voor Omzet & Marge.
          </div>
        </div>
        <span className={`status-pill ${status.can_complete ? "status-ok" : "status-warning"}`}>
          {status.can_complete ? "klaar" : `${blockers.length} acties`}
        </span>
      </div>
      <div className="stats-grid wizard-stats-grid" style={{ marginBottom: 0 }}>
        <SummaryMetric label="Douano producten" value={status.summary.douano_products ?? 0} />
        <SummaryMetric label="Verkochte producten gekoppeld" value={`${status.summary.sold_products_mapped ?? 0}/${status.summary.sold_products ?? 0}`} />
        <SummaryMetric label="LOT regels zonder LOT" value={status.summary.sales_lot_without_lot ?? 0} />
        <SummaryMetric
          label="SKU-regels met kostprijsbron"
          value={`${status.summary.sales_rows_sku_with_cost_source ?? 0}/${status.summary.sales_rows_sku_total ?? 0}`}
        />
        <SummaryMetric
          label="Niet-SKU regels gecategoriseerd"
          value={`${status.summary.sales_rows_non_sku_categorized ?? 0}/${status.summary.sales_rows_non_sku_total ?? 0}`}
        />
        <SummaryMetric
          label="Verkoopregels verwerkt"
          value={`${status.summary.sales_rows_processed ?? status.summary.sales_rows_with_cost_source ?? 0}/${status.summary.sales_rows_total ?? status.summary.sales_rows_cost_source_total ?? 0}`}
        />
      </div>
    </section>
  );
}

export function WorkstreamIntro({ step }: { step: WorkstreamDefinition }) {
  const help = STEP_HELP[step.id];
  return (
    <section className="module-card compact-card">
      <div className="module-card-header" style={{ display: "grid", gap: 6 }}>
        <div className="module-card-title">{help.title}</div>
        <div className="module-card-text">{help.description}</div>
        <div className="module-card-text">
          <strong>Resultaat:</strong> {help.outcome}
        </div>
      </div>
    </section>
  );
}
