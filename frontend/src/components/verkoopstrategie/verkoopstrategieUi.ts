export const money = (v: number) =>
  new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(v);

export const num = (v: number) =>
  new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v);

export const inputClass = (hasOverride: boolean) =>
  hasOverride ? "dataset-input dataset-input-override-active" : "dataset-input";

