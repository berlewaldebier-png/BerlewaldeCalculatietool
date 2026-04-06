import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { API_BASE_URL } from "@/lib/apiShared";
import type { BootstrapResponse } from "@/lib/apiShared";

async function resolveServerApiBaseUrl() {
  if (API_BASE_URL.startsWith("http://") || API_BASE_URL.startsWith("https://")) {
    return API_BASE_URL;
  }

  const headerBag = await headers();
  const host = headerBag.get("x-forwarded-host") ?? headerBag.get("host");
  const proto = headerBag.get("x-forwarded-proto") ?? "http";
  if (!host) {
    return API_BASE_URL;
  }
  return `${proto}://${host}${API_BASE_URL}`;
}

async function apiGetServer<T>(path: string, nextPath: string): Promise<T> {
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
