import { API_BASE_URL } from "@/lib/apiShared";

export type ApiErrorCategory = "http" | "network" | "timeout" | "aborted" | "invalid_response";

type ApiErrorMetadata = {
  detail: string;
  requestId: string;
};

function parseErrorMetadata(bodyText: string): ApiErrorMetadata {
  if (!bodyText.trim()) {
    return { detail: "", requestId: "" };
  }

  try {
    const payload = JSON.parse(bodyText) as Record<string, unknown>;
    return {
      detail: typeof payload.detail === "string" ? payload.detail : "",
      requestId: typeof payload.request_id === "string" ? payload.request_id : ""
    };
  } catch {
    return { detail: "", requestId: "" };
  }
}

export class ApiRequestError extends Error {
  status: number;
  path: string;
  bodyText: string;
  category: ApiErrorCategory;
  detail: string;
  requestId: string;

  constructor(args: {
    status: number;
    path: string;
    bodyText: string;
    message?: string;
    category?: ApiErrorCategory;
    detail?: string;
    requestId?: string;
  }) {
    const parsedMetadata = parseErrorMetadata(args.bodyText);
    super(args.message ?? `API request failed: ${args.path}`);
    this.name = "ApiRequestError";
    this.status = args.status;
    this.path = args.path;
    this.bodyText = args.bodyText;
    this.category = args.category ?? "http";
    this.detail = args.detail ?? parsedMetadata.detail;
    this.requestId = args.requestId ?? parsedMetadata.requestId;
  }
}

type ApiRequestOptions = {
  timeoutMs?: number;
};

export type ApiTextResponse = {
  status: number;
  path: string;
  bodyText: string;
  requestId: string;
  headers: Headers;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function requestIdFromHeaders(headers: Headers): string {
  return headers.get("x-request-id") ?? headers.get("x-correlation-id") ?? "";
}

export async function apiRequestClient(
  path: string,
  init: RequestInit = {},
  options?: ApiRequestOptions
): Promise<ApiTextResponse> {
  const externalSignal = init.signal ?? null;
  const timeoutMs = options?.timeoutMs;
  const needsController = Boolean(externalSignal || (timeoutMs !== undefined && timeoutMs > 0));
  const controller = needsController ? new AbortController() : null;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | undefined;

  const abortFromExternalSignal = () => {
    controller?.abort(externalSignal?.reason);
  };

  if (externalSignal && controller) {
    if (externalSignal.aborted) {
      abortFromExternalSignal();
    } else {
      externalSignal.addEventListener("abort", abortFromExternalSignal, { once: true });
    }
  }

  if (controller && timeoutMs !== undefined && timeoutMs > 0) {
    timeoutHandle = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("API request timed out.", "TimeoutError"));
    }, timeoutMs);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      ...(controller ? { signal: controller.signal } : {})
    });
    const bodyText = await response.text();
    const headerRequestId = requestIdFromHeaders(response.headers);

    if (!response.ok) {
      const metadata = parseErrorMetadata(bodyText);
      throw new ApiRequestError({
        status: response.status,
        path,
        bodyText,
        category: "http",
        detail: metadata.detail,
        requestId: metadata.requestId || headerRequestId
      });
    }

    return {
      status: response.status,
      path,
      bodyText,
      requestId: headerRequestId,
      headers: response.headers
    };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      throw error;
    }

    const name = error instanceof Error ? error.name : "";
    const category: ApiErrorCategory =
      timedOut || name === "TimeoutError"
        ? "timeout"
        : externalSignal?.aborted || name === "AbortError"
          ? "aborted"
          : "network";
    const fallback =
      category === "timeout"
        ? "API request timed out."
        : category === "aborted"
          ? "API request was cancelled."
          : `API request failed: ${path}`;

    throw new ApiRequestError({
      status: 0,
      path,
      bodyText: "",
      category,
      message: errorMessage(error, fallback)
    });
  } finally {
    if (timeoutHandle !== undefined) {
      globalThis.clearTimeout(timeoutHandle);
    }
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

export async function apiRequestJsonClient<T>(
  path: string,
  init: RequestInit = {},
  options?: ApiRequestOptions
): Promise<T> {
  const response = await apiRequestClient(path, init, options);
  try {
    return JSON.parse(response.bodyText) as T;
  } catch {
    throw new ApiRequestError({
      status: response.status,
      path,
      bodyText: response.bodyText,
      category: "invalid_response",
      requestId: response.requestId,
      message: `API response was not valid JSON: ${path}`
    });
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    if (error.bodyText) {
      return error.bodyText;
    }
    if (error.category === "http") {
      return error.detail || fallback;
    }
    return error.message || error.detail || fallback;
  }
  return errorMessage(error, fallback);
}

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

// Compatibility path for existing callers with established 15-second timeout,
// credential, cache and error-shape contracts. Migrate those callers separately.
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
