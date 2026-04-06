import { API_BASE_URL } from "@/lib/apiShared";

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${path}`);
  }

  return (await response.json()) as T;
}

export function apiGetClient<T>(path: string): Promise<T> {
  return apiGet<T>(path);
}

