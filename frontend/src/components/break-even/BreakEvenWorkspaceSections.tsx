"use client";

import type {
  BreakEvenConfig,
  BreakEvenScenarioAdjustment,
  BreakEvenScenarioType,
  BreakEvenPackSummary,
  BreakEvenProductLine,
  BreakEvenMixLine,
} from "@/components/break-even/breakEvenUtils";
import { deriveScenarioTypeFromAdjustments, formatMoney, formatNumber } from "@/components/break-even/breakEvenUtils";
import { formatScenarioTypeLabel } from "@/components/break-even/breakEvenFormatting";
import {
  formatMoneyOrMissing,
  formatStandaloneLiters,
} from "@/components/break-even/BreakEvenWorkspaceParts";

export function BreakEvenMixTableSection(props: {
  activeConfig: BreakEvenConfig;
  packTypes: BreakEvenPackSummary[];
  productLines: BreakEvenProductLine[];
  resultLineByKey: Map<string, BreakEvenMixLine>;
  standaloneResultByRef: Map<string, { breakEvenLiters: number; breakEvenRevenue: number }>;
  onMixChange: (key: string, value: string) => void;
  onPriceOverrideChange: (key: string, value: string) => void;
}) {
  return (
    <section className="module-card">
      <div className="module-card-title">
        {props.activeConfig.mix_mode === "packaging"
          ? "Verwachte mix per verpakkingstype"
          : "Verwachte mix per product"}
      </div>
      <div className="module-card-text" style={{ marginBottom: 12 }}>
        Deze mix vormt {props.activeConfig.kind === "basis" ? "de basisverwachting" : "de scenario-variant"} voor{" "}
        {props.activeConfig.jaar}.
      </div>
      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>{props.activeConfig.mix_mode === "packaging" ? "Verpakking" : "Product"}</th>
              <th>Mix %</th>
              {props.activeConfig.mix_mode === "product" ? <th>Prijs override</th> : null}
              <th>Sell-in / L</th>
              <th>Variabel / L</th>
              <th>Contributie / L</th>
              {props.activeConfig.mix_mode === "product" ? <th>Solo BE liters</th> : null}
              {props.activeConfig.mix_mode === "product" ? <th>Solo BE omzet</th> : null}
              <th>Gewogen bijdrage / L</th>
            </tr>
          </thead>
          <tbody>
            {(props.activeConfig.mix_mode === "packaging"
              ? props.packTypes.map((pack) => pack.key)
              : props.productLines.map((line) => line.ref)
            ).map((key) => {
              const line = props.productLines.find((candidate) => candidate.ref === key);
              const packSummary = props.packTypes.find((pack) => pack.key === key);
              const resultLine = props.resultLineByKey.get(key);
              const displayLabel =
                props.activeConfig.mix_mode === "packaging"
                  ? packSummary?.label ?? key
                  : line?.label ?? key;
              const mixValue =
                props.activeConfig.mix_mode === "packaging"
                  ? props.activeConfig.packaging_mix[key] ?? 0
                  : props.activeConfig.product_mix[key] ?? 0;
              const sellInPerLiter =
                resultLine?.sellInPerLiter ??
                line?.sellInPerLiter ??
                packSummary?.sellInPerLiter ??
                0;
              const variableCostPerLiter =
                resultLine?.variableCostPerLiter ??
                line?.variableCostPerLiter ??
                packSummary?.variableCostPerLiter ??
                0;
              const contributionPerLiter =
                resultLine?.contributionPerLiter ??
                line?.contributionPerLiter ??
                packSummary?.contributionPerLiter ??
                0;
              const standalone = line ? props.standaloneResultByRef.get(line.ref) : null;

              return (
                <tr key={key}>
                  <td>{displayLabel}</td>
                  <td>
                    {props.activeConfig.kind === "basis" ? (
                      <input
                        className="dataset-input"
                        type="number"
                        min={0}
                        max={100}
                        value={mixValue}
                        onChange={(event) => props.onMixChange(key, event.target.value)}
                      />
                    ) : (
                      <span>{formatNumber(resultLine?.mixPct ?? mixValue, 1)}%</span>
                    )}
                  </td>
                  {props.activeConfig.mix_mode === "product" ? (
                    <td>
                      {props.activeConfig.kind === "basis" ? (
                        <input
                          className="dataset-input"
                          type="number"
                          min={0}
                          placeholder={line ? formatNumber(line.sellInEx, 2) : ""}
                          value={props.activeConfig.price_overrides[key] ?? ""}
                          onChange={(event) => props.onPriceOverrideChange(key, event.target.value)}
                        />
                      ) : (
                        <span>
                          {props.activeConfig.price_overrides[key]
                            ? formatMoney(props.activeConfig.price_overrides[key])
                            : "Basisprijs"}
                        </span>
                      )}
                    </td>
                  ) : null}
                  <td>{formatMoneyOrMissing(sellInPerLiter)}</td>
                  <td>{formatMoneyOrMissing(variableCostPerLiter)}</td>
                  <td>{formatMoneyOrMissing(contributionPerLiter)}</td>
                  {props.activeConfig.mix_mode === "product" ? (
                    <td>{formatStandaloneLiters(standalone?.breakEvenLiters ?? 0)}</td>
                  ) : null}
                  {props.activeConfig.mix_mode === "product" ? (
                    <td>{formatMoneyOrMissing(standalone?.breakEvenRevenue ?? 0)}</td>
                  ) : null}
                  <td>{formatMoney(resultLine?.weightedContributionPerLiter ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function BreakEvenHeroSection(props: {
  hasConfigs: boolean;
  canAddScenario: boolean;
  isSaving: boolean;
  onAddBase: () => void;
  onAddScenario: () => void;
  onSave: () => void;
}) {
  return (
    <section className="module-card break-even-hero">
      <div>
        <div className="module-card-title">Break-even basis en scenario&apos;s</div>
        <div className="module-card-text">
          Leg eerst je verwachte basis voor het jaar vast. Maak daarna scenario&apos;s om koerswijzigingen
          te testen. De actieve versie van een jaar voedt conceptoffertes en nieuwe offertes.
        </div>
      </div>
      <div className="break-even-actions">
        {!props.hasConfigs ? (
          <button className="cpq-button cpq-button-secondary" type="button" onClick={props.onAddBase}>
            Nieuwe basis
          </button>
        ) : null}
        <button
          className="cpq-button cpq-button-secondary"
          type="button"
          onClick={props.onAddScenario}
          disabled={!props.canAddScenario}
        >
          Scenario maken
        </button>
        <button
          className="cpq-button cpq-button-primary"
          type="button"
          onClick={props.onSave}
          disabled={props.isSaving}
        >
          {props.isSaving ? "Opslaan..." : "Opslaan"}
        </button>
      </div>
    </section>
  );
}

export function BreakEvenStatusAlert(props: { status: string }) {
  return props.status ? <div className="cpq-alert">{props.status}</div> : null;
}

export function BreakEvenEmptyState(props: { onAddBase: () => void }) {
  return (
    <section className="module-card">
      <div className="placeholder-block">
        <strong>Nog geen break-even basis</strong>
        Maak eerst een basis om de verwachte mix, prijs en vaste kosten voor een jaar vast te leggen.
      </div>
    </section>
  );
}

export function BreakEvenConfigList(props: {
  groupedConfigs: Array<{ base: BreakEvenConfig; scenarios: BreakEvenConfig[] }>;
  activeConfigId: string;
  onSelectConfig: (id: string) => void;
  onAddScenarioForBase: (base: BreakEvenConfig) => void;
  onRemoveScenario: (id: string) => void;
}) {
  return (
    <aside className="module-card break-even-config-list">
      <div className="module-card-title">Jaarbasis en scenario&apos;s</div>
      {props.groupedConfigs.map(({ base, scenarios }) => (
        <div key={base.id} className="break-even-config-group">
          <div className="break-even-config-base-row">
            <button
              type="button"
              className={`break-even-config-button${base.id === props.activeConfigId ? " active" : ""}`}
              onClick={() => props.onSelectConfig(base.id)}
            >
              <span>{base.naam}</span>
              <small>
                {base.jaar}
                {base.is_active_for_quotes ? " - actief voor offertes" : " - basis"}
              </small>
            </button>
            <button
              type="button"
              className="cpq-icon-action break-even-config-add"
              aria-label={`Voeg scenario toe aan ${base.naam}`}
              title="Scenario toevoegen"
              onClick={() => props.onAddScenarioForBase(base)}
            >
              +
            </button>
          </div>
          <div className="break-even-scenario-list">
            {scenarios.map((scenario, index) => (
              <div key={scenario.id} className="break-even-config-base-row">
                <button
                  type="button"
                  className={`break-even-config-button break-even-config-button-child${scenario.id === props.activeConfigId ? " active" : ""}`}
                  onClick={() => props.onSelectConfig(scenario.id)}
                >
                  <span>{`Scenario ${String.fromCharCode(65 + index)}`}</span>
                  <small>
                    {formatScenarioTypeLabel(deriveScenarioTypeFromAdjustments(scenario.adjustments))}
                    {scenario.is_active_for_quotes ? " - actief voor offertes" : ""}
                  </small>
                </button>
                <button
                  type="button"
                  className="cpq-icon-action break-even-config-add"
                  aria-label={`Verwijder ${scenario.naam}`}
                  title="Scenario verwijderen"
                  onClick={() => props.onRemoveScenario(scenario.id)}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}

export function BreakEvenConfigEditorSection(props: {
  activeConfig: BreakEvenConfig;
  activeBaseConfig: BreakEvenConfig | null;
  years: number[];
  onUpdateConfig: (patch: Partial<BreakEvenConfig>) => void;
  onUseForQuotes: () => void;
  onPromoteScenarioToBase: () => void;
}) {
  return (
    <section className="module-card">
      <div className="module-card-header break-even-header">
        <div>
          <div className="module-card-title">
            {props.activeConfig.kind === "basis" ? "Basis-instellingen" : "Scenario-instellingen"}
          </div>
          <div className="module-card-text">
            {props.activeConfig.kind === "basis"
              ? "Dit is je verwachte break-even basis voor het gekozen jaar."
              : `Dit scenario vergelijkt een koersvariant met ${props.activeBaseConfig?.naam ?? "de basis"}.`}
          </div>
        </div>
        {props.activeConfig.kind === "basis" ? (
          <button className="cpq-button cpq-button-secondary" type="button" onClick={props.onUseForQuotes}>
            Gebruik voor offertes
          </button>
        ) : (
          <button className="cpq-button cpq-button-primary" type="button" onClick={props.onPromoteScenarioToBase}>
            Promoveer naar basis
          </button>
        )}
      </div>
      <div className="cpq-form-grid">
        <label className="cpq-field">
          <span className="cpq-label">Naam</span>
          <input
            className="cpq-input"
            value={props.activeConfig.naam}
            onChange={(event) => props.onUpdateConfig({ naam: event.target.value })}
          />
        </label>
        <label className="cpq-field">
          <span className="cpq-label">Jaar</span>
          <select
            className="cpq-select"
            value={props.activeConfig.jaar}
            onChange={(event) => props.onUpdateConfig({ jaar: Number(event.target.value) })}
          >
            {props.years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <label className="cpq-field">
          <span className="cpq-label">Mixmodus</span>
          <select
            className="cpq-select"
            value={props.activeConfig.mix_mode}
            onChange={(event) =>
              props.onUpdateConfig({
                mix_mode: event.target.value === "packaging" ? "packaging" : "product",
              })
            }
          >
            <option value="product">Productniveau</option>
            <option value="packaging">Verpakkingstype</option>
          </select>
        </label>
        {props.activeConfig.kind === "basis" ? (
          <label className="cpq-field">
            <span className="cpq-label">Vaste kosten correctie</span>
            <input
              className="cpq-input"
              type="number"
              value={props.activeConfig.fixed_cost_adjustment}
              onChange={(event) =>
                props.onUpdateConfig({ fixed_cost_adjustment: Number(event.target.value) || 0 })
              }
            />
          </label>
        ) : null}
      </div>
      {props.activeConfig.kind === "scenario" && props.activeBaseConfig ? (
        <div className="cpq-alert">
          Scenario gebaseerd op <strong>{props.activeBaseConfig.naam}</strong>. Als deze koers klopt,
          promoveer je hem naar een nieuwe basis voor offertes.
        </div>
      ) : null}
    </section>
  );
}
