import fs from "node:fs";
import path from "node:path";

import {
  adaptQuoteDeleteResponse,
  adaptQuoteListResponse,
  type QuoteDeleteBoundary,
  type QuoteListBoundary,
} from "../src/components/offerte-samenstellen/quoteBoundary";


function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fixture(name: string): unknown {
  const fixturePath = path.resolve(process.cwd(), "..", "contracts", "fixtures", "quotes", name);
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

function assertRawPayloadUnchanged(before: unknown, after: unknown, label: string): void {
  assert(after === before, `${label}: adapter must retain the raw payload identity.`);
  assert(JSON.stringify(after) === JSON.stringify(before), `${label}: adapter changed serialized JSON.`);
}

const currentListPayload = fixture("list-response.current.json");
const currentList: QuoteListBoundary = adaptQuoteListResponse(currentListPayload);
assertRawPayloadUnchanged(currentListPayload, currentList.raw, "current list");
assert(currentList.deviations.length === 0, "Current list fixture should have no deviations.");
assert(currentList.response.items.length === 1, "Current list fixture should expose one quote.");
assert(currentList.response.items[0].quote_number_seq === 1, "Current numeric quote sequence changed.");

const futureLegacyListPayload = fixture("list-response.future-legacy.json");
const futureLegacyList = adaptQuoteListResponse(futureLegacyListPayload);
assertRawPayloadUnchanged(futureLegacyListPayload, futureLegacyList.raw, "future/legacy list");
assert(
  (futureLegacyList.response as Record<string, unknown>).future_envelope_field !== undefined,
  "Unknown envelope fields must remain available."
);
assert(
  (futureLegacyList.response.items[0] as unknown as Record<string, unknown>).future_record_field === "keep",
  "Unknown record fields must remain available."
);
assert(
  (futureLegacyList.response.items[0] as unknown as Record<string, unknown>).quote_number_seq === "99",
  "Malformed-but-tolerated fields must not be coerced."
);
assert(futureLegacyList.deviations.length === 2, "Expected two known-field deviations.");

const malformedEnvelope = { items: null, future: "keep" };
const malformedList = adaptQuoteListResponse(malformedEnvelope);
assertRawPayloadUnchanged(malformedEnvelope, malformedList.raw, "malformed list envelope");
assert(malformedList.response.items.length === 0, "Existing non-array list fallback must remain empty.");
assert(malformedList.deviations.length === 1, "Malformed items must be reported once.");

for (const fixtureName of ["delete-response.deleted.json", "delete-response.not-found.json"]) {
  const payload = fixture(fixtureName);
  const result: QuoteDeleteBoundary = adaptQuoteDeleteResponse(payload);
  assertRawPayloadUnchanged(payload, result.raw, fixtureName);
  assert(result.deviations.length === 0, `${fixtureName}: current response must have no deviations.`);
  assert(result.deleted === (fixtureName.includes("not-found") ? 0 : 1), `${fixtureName}: deleted count changed.`);
}

const legacyDeletePayload = fixture("delete-response.future-legacy.json");
const legacyDelete = adaptQuoteDeleteResponse(legacyDeletePayload);
assertRawPayloadUnchanged(legacyDeletePayload, legacyDelete.raw, "legacy delete");
assert(legacyDelete.deleted === undefined, "Legacy ok must not be coerced into deleted.");
assert(legacyDelete.legacyOk === true, "Legacy ok alias must remain readable.");
assert(legacyDelete.deviations.length === 1, "Legacy alias must be reported.");

const malformedDeletePayload = { deleted: "1", future: "keep" };
const malformedDelete = adaptQuoteDeleteResponse(malformedDeletePayload);
assertRawPayloadUnchanged(malformedDeletePayload, malformedDelete.raw, "malformed delete");
assert(malformedDelete.deleted === undefined, "String deleted value must not be coerced.");
assert(malformedDelete.deviations.length === 1, "Malformed deleted must be reported.");

console.log("quoteBoundary contracttest OK");
