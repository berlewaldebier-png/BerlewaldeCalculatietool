import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { API_BASE_URL } from "@/lib/apiShared";
import type { BootstrapResponse } from "@/lib/apiShared";

async function resolveServerApiBaseUrl() {
  if (API_BASE_URL.startsWith("http://") || API_BASE_URL.startsWith("https://")) {
    return API_BASE_URL;
  }

  // Server components can't use relative URLs with Node's fetch. Previously we derived the origin from
  // the incoming Host header, but in containerized setups that host (e.g. "hanshssnk") may not be
  // resolvable from within the container, causing slow failures/timeouts.
  //
  // Use loopback to call this Next.js instance's own API routes by default. This keeps the request
  // internal and stable regardless of external DNS/reverse proxy config.
  const explicitOrigin = (process.env.CALCULATIETOOL_SERVER_ORIGIN ?? "").trim();
  const port = (process.env.PORT ?? "").trim() || "3000";
  const origin = explicitOrigin || `http://127.0.0.1:${port}`;

  // Touch headers to preserve existing semantics and ensure this stays request-scoped.
  await headers();

  return `${origin}${API_BASE_URL}`;
}

export async function apiGetServer<T>(path: string, nextPath: string): Promise<T> {
  const cookieJar = await cookies();
  const cookieHeader = cookieJar.toString();
  const baseUrl = await resolveServerApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    headers: cookieHeader ? { cookie: cookieHeader } : undefined
  });

  if (response.status === 401) {
    redirect(`/login?next=${encodeURIComponent(nextPath || "/")}`);
  }

  if (!response.ok) {
    throw new Error(`API request failed (${response.status}): ${path}`);
  }

  return (await response.json()) as T;
}

export function getBootstrap(datasets: string[], includeNavigation = true, nextPath = "/") {
  const encoded = encodeURIComponent(datasets.join(","));
  const nav = includeNavigation ? "true" : "false";
  return apiGetServer<BootstrapResponse>(`/meta/bootstrap?datasets=${encoded}&navigation=${nav}`, nextPath);
}
