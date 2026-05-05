import { API_BASE_URL } from "@/lib/apiShared";

export class ApiRequestError extends Error {
  status: number;
  path: string;
  bodyText: string;

  constructor(args: { status: number; path: string; bodyText: string; message?: string }) {
    super(args.message ?? `API request failed: ${args.path}`);
    this.name = "ApiRequestError";
    this.status = args.status;
    this.path = args.path;
    this.bodyText = args.bodyText;
  }
}

type ApiRequestOptions = {
  timeoutMs?: number;
};

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

export async function apiRequestTextClient(path: string, init: RequestInit, options?: ApiRequestOptions) {
  const timeoutMs = options?.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      credentials: "include",
      ...init,
      signal: controller.signal
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new ApiRequestError({ status: response.status, path, bodyText });
    }
    return bodyText;
  } finally {
    window.clearTimeout(timeoutHandle);
  }
}
