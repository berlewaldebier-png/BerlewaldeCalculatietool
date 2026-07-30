import type {
  QuoteDraftRecord,
  QuotePersistencePayload,
} from "@/components/offerte-samenstellen/types";
import {
  adaptQuoteDeleteResponse,
  reportQuoteBoundaryDeviations,
  type QuoteDeleteBoundary,
} from "@/components/offerte-samenstellen/quoteBoundary";
import { API_BASE_URL } from "@/lib/apiShared";
import type { QuoteCommercialContextResponse } from "@/features/commercial-context/quoteCommercialContext";


async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = String(payload?.detail ?? "");
    } catch {
      detail = "";
    }
    throw new Error(detail || `Quote API request failed: ${path}`);
  }

  return (await response.json()) as T;
}

export function loadQuoteDraft(draftId: string): Promise<{ record: QuoteDraftRecord }> {
  return request<{ record: QuoteDraftRecord }>(`/quotes/${encodeURIComponent(draftId)}`);
}

export function loadQuoteCommercialContext(
  generationId = ""
): Promise<QuoteCommercialContextResponse> {
  const suffix = generationId
    ? `?generation_id=${encodeURIComponent(generationId)}`
    : "";
  return request<QuoteCommercialContextResponse>(
    `/quotes/commercial-context${suffix}`
  );
}

export function createQuoteDraft(payload: QuotePersistencePayload): Promise<{ record: QuoteDraftRecord }> {
  return request<{ record: QuoteDraftRecord }>("/quotes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateQuoteDraft(
  draftId: string,
  payload: QuotePersistencePayload
): Promise<{ record: QuoteDraftRecord }> {
  return request<{ record: QuoteDraftRecord }>(`/quotes/${encodeURIComponent(draftId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteQuoteDraft(draftId: string): Promise<QuoteDeleteBoundary> {
  const payload = await request<unknown>(`/quotes/${encodeURIComponent(draftId)}`, {
    method: "DELETE",
  });
  const boundary = adaptQuoteDeleteResponse(payload);
  reportQuoteBoundaryDeviations("quote-delete", boundary.deviations);
  return boundary;
}
