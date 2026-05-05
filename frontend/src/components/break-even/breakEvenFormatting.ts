import { formatMoney, formatNumber } from "@/components/break-even/breakEvenUtils";
import type { BreakEvenScenarioAdjustment, BreakEvenScenarioType } from "@/components/break-even/breakEvenUtils";

export function formatAdjustmentTitle(adjustment: BreakEvenScenarioAdjustment, mixMode: "product" | "packaging") {
  if (adjustment.type === "price_pct") return "Verkoopprijs";
  if (adjustment.type === "fixed_cost_eur") return "Vaste kosten (EUR)";
  if (adjustment.type === "fixed_cost_pct") return "Vaste kosten (%)";
  if (adjustment.type === "variable_cost_pct") return "Variabele kosten (%)";
  return `${mixMode === "packaging" ? "Mix / volume verpakking" : "Mix / volume product"}${
    adjustment.target_label ? `: ${adjustment.target_label}` : ""
  }`;
}

export function formatAdjustmentValue(adjustment: BreakEvenScenarioAdjustment) {
  if (adjustment.type === "fixed_cost_eur") {
    return `${adjustment.value >= 0 ? "+" : ""}${formatMoney(adjustment.value)}`;
  }
  return `${adjustment.value >= 0 ? "+" : ""}${formatNumber(adjustment.value, 1)}%`;
}

export function formatScenarioTypeLabel(type: BreakEvenScenarioType | null) {
  if (type === "pricing") return "Scenario prijs";
  if (type === "costs") return "Scenario kosten";
  if (type === "volume") return "Scenario volume";
  if (type === "combined") return "Scenario combinatie";
  return "Scenario vrij";
}

export function parseSignedNumberInput(value: string) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized || normalized === "-" || normalized === "+" || normalized === "." || normalized === "-.") {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
