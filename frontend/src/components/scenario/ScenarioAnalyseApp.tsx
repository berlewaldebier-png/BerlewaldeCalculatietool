"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { WizardSteps } from "@/components/WizardSteps";
import type { GenericRecord } from "@/components/offerte-samenstellen/types";
import { buildProductFacts } from "@/lib/productFacts";
import {
  buildLitersPerUnitOverrideMap,
  deleteScenario,
  getScenario,
  listScenarios,
  upsertScenario,
  type ScenarioRecord,
} from "@/lib/scenarios";

function formatNumber(value: number, decimals = 0) {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(safe);
}

function formatEur(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(safe);
}

type Props = {
  year: number;
  channels: GenericRecord[];
  bieren: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  productie: Record<string, GenericRecord>;
};

type StepKey = "basis" | "overrides" | "compare" | "apply";

export function ScenarioAnalyseApp(props: Props) {
  const router = useRouter();
  const [step, setStep] = useState<StepKey>("basis");
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenarioName, setScenarioName] = useState("Scenario");
  const [selectedYear, setSelectedYear] = useState<number>(props.year);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [targetLitersPerUnit, setTargetLitersPerUnit] = useState<number>(0);
  const [volumeLiters, setVolumeLiters] = useState<number>(() => {
    const prod = (props.productie as any)?.[String(props.year)] ?? null;
    const defaultLiters = Number(prod?.hoeveelheid_productie_l ?? 0);
    return Number.isFinite(defaultLiters) && defaultLiters > 0 ? defaultLiters : 1000;
  });

  const [scenarioList, setScenarioList] = useState<ScenarioRecord[]>([]);
  const [compareId, setCompareId] = useState<string>("");

  useEffect(() => {
    const sync = () => setScenarioList(listScenarios());
    sync();
    window.addEventListener("calculatietool-scenarios-changed", sync);
    return () => window.removeEventListener("calculatietool-scenarios-changed", sync);
  }, []);

  useEffect(() => {
    if (!scenarioId) return;
    const found = getScenario(scenarioId);
    if (!found) return;
    setScenarioName(found.name);
    setSelectedYear(found.year);
    const first = (found.overrides ?? [])[0] ?? null;
    if (first?.productId) {
      setSelectedProductId(String(first.productId));
    }
  }, [scenarioId]);

  const factsIndex = useMemo(() => {
    return buildProductFacts({
      year: selectedYear,
      channelCode: "horeca",
      channels: props.channels,
      bieren: props.bieren,
      kostprijsversies: props.kostprijsversies,
      kostprijsproductactiveringen: props.kostprijsproductactiveringen,
      verkoopprijzen: props.verkoopprijzen,
      basisproducten: props.basisproducten,
      samengesteldeProducten: props.samengesteldeProducten,
    });
  }, [
    selectedYear,
    props.channels,
    props.bieren,
    props.kostprijsversies,
    props.kostprijsproductactiveringen,
    props.verkoopprijzen,
    props.basisproducten,
    props.samengesteldeProducten,
  ]);

  const productOptions = useMemo(() => {
    return factsIndex.facts.map((fact) => ({
      productId: fact.productId,
      label: fact.label,
      packLabel: fact.packLabel,
      litersPerUnit: fact.litersPerUnit,
      costPriceEx: fact.costPriceEx,
      sellInEx: fact.sellInEx,
    }));
  }, [factsIndex.facts]);

  const selectedFact = useMemo(() => {
    return factsIndex.facts.find((fact) => fact.productId === selectedProductId) ?? null;
  }, [factsIndex.facts, selectedProductId]);

  useEffect(() => {
    if (!selectedFact) return;
    if (targetLitersPerUnit > 0) return;
    setTargetLitersPerUnit(selectedFact.litersPerUnit);
  }, [selectedFact, targetLitersPerUnit]);

  const baseline = useMemo(() => {
    if (!selectedFact) return null;
    const litersPerUnit = selectedFact.litersPerUnit > 0 ? selectedFact.litersPerUnit : 0.001;
    const costPerLiter = selectedFact.costPriceEx / litersPerUnit;
    const sellInPerLiter = selectedFact.sellInEx / litersPerUnit;
    const unitsFromVolume = volumeLiters / litersPerUnit;
    return {
      litersPerUnit,
      costPerLiter,
      sellInPerLiter,
      unitsFromVolume,
      costPerUnit: selectedFact.costPriceEx,
      sellInPerUnit: selectedFact.sellInEx,
    };
  }, [selectedFact, volumeLiters]);

  const scenario = useMemo(() => {
    if (!selectedFact || !baseline) return null;
    const litersPerUnit = targetLitersPerUnit > 0 ? targetLitersPerUnit : baseline.litersPerUnit;
    const unitsFromVolume = volumeLiters / litersPerUnit;
    return {
      litersPerUnit,
      unitsFromVolume,
      costPerUnit: baseline.costPerLiter * litersPerUnit,
      sellInPerUnit: baseline.sellInPerLiter * litersPerUnit,
    };
  }, [baseline, selectedFact, targetLitersPerUnit, volumeLiters]);

  const delta = useMemo(() => {
    if (!baseline || !scenario) return null;
    return {
      units: scenario.unitsFromVolume - baseline.unitsFromVolume,
      unitsPct:
        baseline.unitsFromVolume > 0 ? (scenario.unitsFromVolume - baseline.unitsFromVolume) / baseline.unitsFromVolume : 0,
      costPerUnit: scenario.costPerUnit - baseline.costPerUnit,
      sellInPerUnit: scenario.sellInPerUnit - baseline.sellInPerUnit,
    };
  }, [baseline, scenario]);

  const wizardSteps = useMemo(
    () => [
      { id: "basis", title: "Basis", description: "Jaar, product en volume" },
      { id: "overrides", title: "Aanpassingen", description: "Wat-als: literinhoud" },
      { id: "compare", title: "Vergelijken", description: "Delta en impact" },
      { id: "apply", title: "Toepassen", description: "Gebruik in offerte" },
    ],
    []
  );

  const activeIndex = useMemo(() => wizardSteps.findIndex((s) => s.id === step), [step, wizardSteps]);

  const savedScenario = useMemo(() => (scenarioId ? getScenario(scenarioId) : null), [scenarioId, scenarioList]);
  const compareScenario = useMemo(() => (compareId ? getScenario(compareId) : null), [compareId, scenarioList]);

  const applyUrl = useMemo(() => {
    if (!scenarioId) return "/offerte-samenstellen";
    return `/offerte-samenstellen?scenario=${encodeURIComponent(String(scenarioId))}`;
  }, [scenarioId]);

  function saveScenario() {
    if (!selectedProductId) {
      alert("Kies eerst een product/verpakking om op te slaan.");
      return;
    }
    if (!Number.isFinite(targetLitersPerUnit) || targetLitersPerUnit <= 0) {
      alert("Vul een geldige literinhoud per eenheid in.");
      return;
    }

    const next = upsertScenario({
      id: scenarioId ?? undefined,
      name: scenarioName,
      year: selectedYear,
      overrides: [{ productId: selectedProductId, litersPerUnit: targetLitersPerUnit }],
    });
    if (next) setScenarioId(next.id);
  }

  return (
    <div className="cpq-root">
      <div className="cpq-frame">
        <div className="cpq-topbar">
          <div>
            <div className="cpq-kicker">Scenario analyse</div>
            <h1 className="cpq-title">Wat-als simulatie</h1>
          </div>
          <div className="cpq-topbar-actions">
            <button type="button" className="editor-button editor-button-secondary" onClick={() => router.push("/")}>
              Terug
            </button>
            <button type="button" className="editor-button editor-button-secondary" onClick={saveScenario}>
              Opslaan scenario
            </button>
            {scenarioId ? (
              <button
                type="button"
                className="editor-button editor-button-secondary editor-button-icon"
                title="Verwijder scenario"
                aria-label="Verwijder scenario"
                onClick={() => {
                  deleteScenario(scenarioId);
                  setScenarioId(null);
                  setCompareId("");
                }}
              >
                <TrashIcon />
              </button>
            ) : null}
            <span className="pill">{scenarioId ? "Scenario actief" : "Nieuw scenario"}</span>
          </div>
        </div>

        <div className="cpq-grid cpq-grid-wide">
          <aside className="cpq-left">
            <WizardSteps
              title="Stappen"
              steps={wizardSteps}
              activeIndex={Math.max(0, activeIndex)}
              onSelect={(index) => {
                const next = wizardSteps[index];
                if (!next) return;
                setStep(next.id as StepKey);
              }}
            />

            <div className="cpq-quick">
              <div className="cpq-quick-title">Scenario</div>
              <div className="cpq-quick-grid">
                <QuickCell label="Naam" value={scenarioName} />
                <QuickCell label="Jaar" value={String(selectedYear)} />
                <QuickCell label="Product" value={selectedFact?.packLabel || "—"} />
                <QuickCell label="Overrides" value={selectedProductId ? "1" : "0"} />
              </div>
            </div>
          </aside>

          <main className="cpq-main">
            {step === "basis" ? (
              <div className="module-card">
                <div className="module-card-header">
                  <div className="module-card-title">Basis</div>
                  <div className="module-card-text">Selecteer een jaar en een product/verpakking om te simuleren.</div>
                </div>

                <div className="wizard-form-grid" style={{ alignItems: "end" }}>
                  <label className="nested-field">
                    <span>Naam</span>
                    <input className="dataset-input" value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} />
                  </label>

                  <label className="nested-field">
                    <span>Jaar</span>
                    <input
                      className="dataset-input"
                      type="number"
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(Number(e.target.value))}
                    />
                  </label>

                  <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                    <span>Product/verpakking</span>
                    <select
                      className="dataset-input"
                      value={selectedProductId}
                      onChange={(e) => setSelectedProductId(e.target.value)}
                    >
                      <option value="">Kies een product…</option>
                      {productOptions.map((opt) => (
                        <option key={opt.productId} value={opt.productId}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="nested-field">
                    <span>Volume (L)</span>
                    <input
                      className="dataset-input"
                      type="number"
                      value={volumeLiters}
                      onChange={(e) => setVolumeLiters(Number(e.target.value))}
                    />
                  </label>

                  <div className="editor-actions-group" style={{ justifySelf: "end" }}>
                    <button type="button" className="editor-button" onClick={() => setStep("overrides")} disabled={!selectedProductId}>
                      Volgende
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {step === "overrides" ? (
              <div className="module-card">
                <div className="module-card-header">
                  <div className="module-card-title">Aanpassing: literinhoud</div>
                  <div className="module-card-text">Voorbeeld: 33cl → 30cl (0,33L → 0,30L).</div>
                </div>

                {!selectedFact ? (
                  <div className="placeholder-block">
                    <strong>Kies eerst een product</strong>
                    Ga terug naar Basis en selecteer een product/verpakking.
                  </div>
                ) : (
                  <div className="wizard-form-grid" style={{ alignItems: "end" }}>
                    <label className="nested-field">
                      <span>Huidig (L per eenheid)</span>
                      <input className="dataset-input dataset-input-readonly" value={formatNumber(selectedFact.litersPerUnit, 3)} readOnly />
                    </label>
                    <label className="nested-field">
                      <span>Scenario (L per eenheid)</span>
                      <input
                        className="dataset-input"
                        type="number"
                        step="0.01"
                        value={targetLitersPerUnit}
                        onChange={(e) => setTargetLitersPerUnit(Number(e.target.value))}
                      />
                    </label>

                    <div className="editor-actions-group" style={{ justifySelf: "end" }}>
                      <button type="button" className="editor-button editor-button-secondary" onClick={() => setStep("basis")}>
                        Vorige
                      </button>
                      <button type="button" className="editor-button" onClick={() => setStep("compare")} disabled={!selectedProductId}>
                        Volgende
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {step === "compare" ? (
              <div className="module-card">
                <div className="module-card-header">
                  <div className="module-card-title">Vergelijking</div>
                  <div className="module-card-text">Bekijk het effect op aantallen en kostprijs/prijs per eenheid.</div>
                </div>

                {!baseline || !scenario || !delta ? (
                  <div className="placeholder-block">
                    <strong>Geen data</strong>
                    Kies eerst een product en vul een scenario in.
                  </div>
                ) : (
                  <>
                    <div className="stats-grid wizard-stats-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                      <StatCard label="Eenheden uit volume (huidig)" value={formatNumber(baseline.unitsFromVolume, 0)} />
                      <StatCard label="Eenheden uit volume (scenario)" value={formatNumber(scenario.unitsFromVolume, 0)} />
                      <StatCard
                        label="Delta eenheden"
                        value={`${formatNumber(delta.units, 0)} (${formatNumber(delta.unitsPct * 100, 1)}%)`}
                      />
                    </div>

                    <div className="data-table" style={{ marginTop: 16 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Metric</th>
                            <th>Huidig</th>
                            <th>Scenario</th>
                            <th>Delta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ["L per eenheid", baseline.litersPerUnit, scenario.litersPerUnit, scenario.litersPerUnit - baseline.litersPerUnit, 3],
                            ["Kostprijs per eenheid (ex)", baseline.costPerUnit, scenario.costPerUnit, delta.costPerUnit, 2, "eur"],
                            ["Sell-in per eenheid (ex)", baseline.sellInPerUnit, scenario.sellInPerUnit, delta.sellInPerUnit, 2, "eur"],
                          ].map(([label, a, b, d, dec, fmt], idx) => (
                            <tr key={`${label}-${idx}`}>
                              <td style={{ fontWeight: 700 }}>{String(label)}</td>
                              <td>{fmt === "eur" ? formatEur(Number(a)) : formatNumber(Number(a), Number(dec))}</td>
                              <td>{fmt === "eur" ? formatEur(Number(b)) : formatNumber(Number(b), Number(dec))}</td>
                              <td>{fmt === "eur" ? formatEur(Number(d)) : formatNumber(Number(d), Number(dec))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="editor-actions" style={{ marginTop: 14 }}>
                      <div className="editor-actions-group">
                        <button type="button" className="editor-button editor-button-secondary" onClick={() => setStep("overrides")}>
                          Vorige
                        </button>
                      </div>
                      <div className="editor-actions-group">
                        <button type="button" className="editor-button" onClick={() => setStep("apply")}>
                          Naar toepassen
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {step === "apply" ? (
              <div className="module-card">
                <div className="module-card-header">
                  <div className="module-card-title">Toepassen op offerte</div>
                  <div className="module-card-text">
                    Sla het scenario op en open daarna Offerte samenstellen met het scenario-id. De kostprijs/sell-in per
                    eenheid worden dan gebaseerd op literinhoud per eenheid.
                  </div>
                </div>

                <div className="wizard-form-grid" style={{ alignItems: "end" }}>
                  <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                    <span>Bestaand scenario</span>
                    <select className="dataset-input" value={scenarioId ?? ""} onChange={(e) => setScenarioId(e.target.value || null)}>
                      <option value="">(nieuw / niet opgeslagen)</option>
                      {scenarioList.map((row) => (
                        <option key={`${row.id}-${row.updatedAt}`} value={row.id}>
                          {row.name} ({row.year})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
                    <span>Vergelijk met (optioneel)</span>
                    <select className="dataset-input" value={compareId} onChange={(e) => setCompareId(e.target.value)}>
                      <option value="">Geen</option>
                      {scenarioList
                        .filter((row) => row.id !== (scenarioId ?? ""))
                        .map((row) => (
                          <option key={`${row.id}-${row.updatedAt}`} value={row.id}>
                            {row.name} ({row.year})
                          </option>
                        ))}
                    </select>
                  </label>

                  <div className="editor-actions-group" style={{ justifySelf: "end" }}>
                    <button type="button" className="editor-button editor-button-secondary" onClick={() => setStep("compare")}>
                      Vorige
                    </button>
                    <a className="editor-button" href={applyUrl}>
                      Open Offerte samenstellen
                    </a>
                  </div>
                </div>
              </div>
            ) : null}
          </main>

          <aside className="cpq-right">
            <div className="cpq-right-kicker">Live inzicht</div>
            <div className="cpq-stack">
              <div className="cpq-block">
                <div className="cpq-right-kicker" style={{ marginBottom: 8 }}>
                  Actieve overrides
                </div>
                {savedScenario ? (
                  <div className="data-table" style={{ background: "transparent", border: 0, padding: 0 }}>
                    <table>
                      <tbody>
                        {savedScenario.overrides.map((ov) => (
                          <tr key={ov.productId}>
                            <td style={{ fontWeight: 700 }}>Product</td>
                            <td>{ov.productId}</td>
                          </tr>
                        ))}
                        <tr>
                          <td style={{ fontWeight: 700 }}>L/eenheid</td>
                          <td>{formatNumber(buildLitersPerUnitOverrideMap(savedScenario).get(savedScenario.overrides[0]?.productId ?? "") ?? 0, 3)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="placeholder-block" style={{ margin: 0 }}>
                    <strong>Geen opgeslagen scenario geselecteerd</strong>
                    Sla een scenario op om het later toe te passen in offertes.
                  </div>
                )}
              </div>

              {compareScenario ? (
                <div className="cpq-block">
                  <div className="cpq-right-kicker" style={{ marginBottom: 8 }}>
                    Vergelijking
                  </div>
                  <div className="placeholder-block" style={{ margin: 0 }}>
                    <strong>{compareScenario.name}</strong>
                    Vergelijken in offerte volgt; scenario is nu selecteerbaar.
                  </div>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value small">{value}</div>
    </div>
  );
}

function QuickCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="cpq-quick-label">{label}</div>
      <div className="cpq-quick-value">{value || "—"}</div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M9 4h6" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}
