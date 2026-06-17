import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { API_BASE_URL } from "@/lib/apiShared";
import type { BootstrapResponse } from "@/lib/apiShared";

async function resolveServerApiBaseUrl() {
  if (API_BASE_URL.startsWith("http://") || API_BASE_URL.startsWith("https://")) {
    return API_BASE_URL;
  }

  // Server components cannot use relative URLs with Node's fetch. Call FastAPI directly instead
  // of looping through this Next.js instance's own /api proxy; in dev this avoids self-call
  // timeouts when a page is rendering and waiting for its own route handler.
  const backendBaseUrl =
    (process.env.CALCULATIETOOL_BACKEND_INTERNAL_URL ?? "").trim() || "http://127.0.0.1:8000/api";

  // Touch headers to preserve existing request-scoped semantics.
  await headers();

  return backendBaseUrl.replace(/\/$/, "");
}

export async function apiGetServer<T>(path: string, nextPath: string): Promise<T> {
  const cookieJar = await cookies();
  const cookieHeader = cookieJar.toString();
  const baseUrl = await resolveServerApiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      // Some bootstrap payloads can be heavy on cold starts / slow DB. Keep SSR routes patient,
      // while pages that can defer heavy data should fetch it client-side after first paint.
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`API request failed (network/timeout): ${path}\n${message}`);
  }

  if (response.status === 401) {
    redirect(`/login?next=${encodeURIComponent(nextPath || "/")}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = (await response.text()) || "";
    } catch {
      bodyText = "";
    }
    const snippet = bodyText.trim().slice(0, 500);
    const suffix = bodyText.trim().length > 500 ? "..." : "";
    throw new Error(`API request failed (${response.status}): ${path}${snippet ? `\n${snippet}${suffix}` : ""}`);
  }

  return (await response.json()) as T;
}

export function getBootstrap<T extends Record<string, unknown> = Record<string, unknown>>(
  datasets: string[],
  includeNavigation = true,
  nextPath = "/",
  extraParams: Record<string, string> | null = null
): Promise<BootstrapResponse<T>> {
  const nav = includeNavigation ? "true" : "false";
  const params = new URLSearchParams({ datasets: datasets.join(","), navigation: nav });
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      const cleanKey = String(key || "").trim();
      if (!cleanKey) continue;
      const cleanValue = String(value ?? "").trim();
      if (!cleanValue) continue;
      params.set(cleanKey, cleanValue);
    }
  }
  return apiGetServer<BootstrapResponse<T>>(`/meta/bootstrap?${params.toString()}`, nextPath);
}
