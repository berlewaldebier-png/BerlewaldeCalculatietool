import type { QuoteDraftRecord } from "@/components/offerte-samenstellen/types";


type UnknownRecord = Record<string, unknown>;

export type QuoteListResponse = UnknownRecord & {
  items: QuoteDraftRecord[];
};

export type QuoteDeleteBoundary = {
  raw: unknown;
  deleted: number | undefined;
  legacyOk: boolean | undefined;
  deviations: readonly QuoteBoundaryDeviation[];
};

export type QuoteListBoundary = {
  raw: unknown;
  response: QuoteListResponse;
  deviations: readonly QuoteBoundaryDeviation[];
};

export type QuoteBoundaryDeviation = {
  path: string;
  expected: string;
  actual: string;
  kind: "missing" | "type" | "value" | "legacy_alias";
};

const QUOTE_LIST_FIELDS: ReadonlyArray<{
  name: keyof QuoteDraftRecord;
  expected: "number" | "object" | "string" | "nullable-string";
}> = [
  { name: "id", expected: "string" },
  { name: "quote_number", expected: "string" },
  { name: "quote_number_seq", expected: "number" },
  { name: "schema_version", expected: "number" },
  { name: "draft_version", expected: "number" },
  { name: "status", expected: "string" },
  { name: "year", expected: "number" },
  { name: "customer_name", expected: "string" },
  { name: "contact_name", expected: "string" },
  { name: "channel_code", expected: "string" },
  { name: "title", expected: "string" },
  { name: "valid_until", expected: "nullable-string" },
  { name: "active_scenario_id", expected: "string" },
  { name: "created_at", expected: "string" },
  { name: "updated_at", expected: "string" },
  { name: "finalized_at", expected: "nullable-string" },
  { name: "payload", expected: "object" },
];

export function adaptQuoteListResponse(payload: unknown): QuoteListBoundary {
  const deviations: QuoteBoundaryDeviation[] = [];
  const envelope = isRecord(payload) ? payload : {};
  if (!isRecord(payload)) {
    deviations.push(deviation("$", "object", payload, "type"));
  }

  const items = Array.isArray(envelope.items) ? envelope.items : [];
  if (!Array.isArray(envelope.items)) {
    deviations.push(
      "items" in envelope
        ? deviation("$.items", "array", envelope.items, "type")
        : deviation("$.items", "array", undefined, "missing")
    );
  }

  items.forEach((item, index) => inspectQuoteListItem(item, index, deviations));

  // This is a typed view of the existing values. It intentionally retains the
  // envelope's unknown fields and the original item values without coercion.
  const response = { ...envelope, items } as QuoteListResponse;
  return { raw: payload, response, deviations };
}

export function adaptQuoteDeleteResponse(payload: unknown): QuoteDeleteBoundary {
  const deviations: QuoteBoundaryDeviation[] = [];
  if (!isRecord(payload)) {
    deviations.push(deviation("$", "object", payload, "type"));
    return { raw: payload, deleted: undefined, legacyOk: undefined, deviations };
  }

  const deleted = typeof payload.deleted === "number" && Number.isInteger(payload.deleted)
    ? payload.deleted
    : undefined;
  const legacyOk = typeof payload.ok === "boolean" ? payload.ok : undefined;

  if ("deleted" in payload && deleted === undefined) {
    deviations.push(deviation("$.deleted", "integer", payload.deleted, "type"));
  } else if (!("deleted" in payload) && legacyOk !== undefined) {
    deviations.push({
      path: "$.ok",
      expected: "deleted integer",
      actual: "legacy ok boolean",
      kind: "legacy_alias",
    });
  } else if (!("deleted" in payload)) {
    deviations.push(deviation("$.deleted", "integer", undefined, "missing"));
  }

  return { raw: payload, deleted, legacyOk, deviations };
}

export function reportQuoteBoundaryDeviations(
  boundary: "quote-list" | "quote-delete",
  deviations: readonly QuoteBoundaryDeviation[]
): void {
  if (deviations.length === 0) return;
  console.warn("Quote boundary contract deviation", {
    boundary,
    count: deviations.length,
    deviations: deviations.map(({ path, expected, actual, kind }) => ({ path, expected, actual, kind })),
  });
}

function inspectQuoteListItem(
  item: unknown,
  index: number,
  deviations: QuoteBoundaryDeviation[]
): void {
  if (!isRecord(item)) {
    deviations.push(deviation(`$.items[${index}]`, "object", item, "type"));
    return;
  }

  for (const field of QUOTE_LIST_FIELDS) {
    const value = item[field.name];
    const path = `$.items[${index}].${field.name}`;
    if (!(field.name in item)) {
      deviations.push(deviation(path, field.expected, undefined, "missing"));
      continue;
    }
    if (!matchesExpected(value, field.expected)) {
      deviations.push(deviation(path, field.expected, value, "type"));
    }
  }

  if (typeof item.status === "string" && item.status !== "concept" && item.status !== "definitief") {
    deviations.push({
      path: `$.items[${index}].status`,
      expected: "concept | definitief",
      actual: item.status,
      kind: "value",
    });
  }
}

function matchesExpected(
  value: unknown,
  expected: "number" | "object" | "string" | "nullable-string"
): boolean {
  if (expected === "nullable-string") return value === null || typeof value === "string";
  if (expected === "object") return isRecord(value);
  return typeof value === expected;
}

function deviation(
  path: string,
  expected: string,
  value: unknown,
  kind: QuoteBoundaryDeviation["kind"]
): QuoteBoundaryDeviation {
  return { path, expected, actual: valueKind(value), kind };
}

function valueKind(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
