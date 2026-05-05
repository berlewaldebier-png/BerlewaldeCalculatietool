"use client";

export async function putNewYearDraft(args: {
  apiBaseUrl: string;
  sourceYear: number;
  targetYear: number;
  payload: unknown;
}) {
  const response = await fetch(`${args.apiBaseUrl}/meta/new-year-draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_year: args.sourceYear,
      target_year: args.targetYear,
      payload: args.payload,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    return { ok: false as const, text };
  }
  return { ok: true as const, text: await response.text() };
}

export async function getNewYearDraft(args: { apiBaseUrl: string; targetYear: number }) {
  const response = await fetch(
    `${args.apiBaseUrl}/meta/new-year-draft?target_year=${encodeURIComponent(String(args.targetYear))}`,
    { cache: "no-store" }
  );
  if (!response.ok) return { ok: false as const, status: response.status, json: null as any };
  const json = (await response.json()) as any;
  return { ok: true as const, status: response.status, json };
}

export async function deleteNewYearDraft(args: { apiBaseUrl: string; targetYear: number }) {
  const response = await fetch(
    `${args.apiBaseUrl}/meta/new-year-draft?target_year=${encodeURIComponent(String(args.targetYear))}`,
    { method: "DELETE" }
  );
  if (!response.ok) {
    const text = await response.text();
    return { ok: false as const, text };
  }
  return { ok: true as const, text: await response.text() };
}

export async function commitNewYear(args: {
  apiBaseUrl: string;
  sourceYear: number;
  targetYear: number;
  copyProductie: boolean;
  copyVasteKosten: boolean;
  copyTarieven: boolean;
  copyVerpakkingsonderdelen: boolean;
  copyVerkoopstrategie: boolean;
  copyBerekeningen: boolean;
  force: boolean;
  payload: unknown;
}) {
  const response = await fetch(`${args.apiBaseUrl}/meta/commit-new-year`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_year: args.sourceYear,
      target_year: args.targetYear,
      copy_productie: args.copyProductie,
      copy_vaste_kosten: args.copyVasteKosten,
      copy_tarieven: args.copyTarieven,
      copy_verpakkingsonderdelen: args.copyVerpakkingsonderdelen,
      copy_verkoopstrategie: args.copyVerkoopstrategie,
      copy_berekeningen: args.copyBerekeningen,
      force: args.force,
      payload: args.payload,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    return { ok: false as const, status: response.status, text };
  }
  const json = (await response.json()) as any;
  return { ok: true as const, status: response.status, json };
}

export async function fetchBootstrap(args: { apiBaseUrl: string; datasets: string[]; navigation: boolean }) {
  const query = new URLSearchParams();
  query.set("datasets", args.datasets.join(","));
  if (args.navigation) query.set("navigation", "true");
  const response = await fetch(`${args.apiBaseUrl}/meta/bootstrap?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    const text = await response.text();
    return { ok: false as const, text };
  }
  const json = (await response.json()) as any;
  return { ok: true as const, json };
}
