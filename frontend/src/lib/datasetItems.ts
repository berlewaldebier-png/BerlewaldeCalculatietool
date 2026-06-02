import { API_BASE_URL } from "@/lib/api";

type DatasetRow = Record<string, unknown> & { id?: unknown };

type ListResponse<T extends DatasetRow> = {
  items?: T[];
  item_etags?: Record<string, string>;
};

function rowId(row: DatasetRow): string {
  return String(row.id ?? "").trim();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    return typeof parsed.detail === "string" ? parsed.detail : text;
  } catch {
    return text;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await readError(response, "API request mislukt"));
  }
  return (await response.json()) as T;
}

export async function createDatasetItem<T extends DatasetRow>(datasetName: string, row: T): Promise<T> {
  const id = rowId(row);
  if (!id) throw new Error("Record mist id.");
  const result = await requestJson<{ item: T }>(`${API_BASE_URL}/data/${encodeURIComponent(datasetName)}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  return result.item;
}

export async function reconcileDatasetItems<T extends DatasetRow>(datasetName: string, nextRows: T[]): Promise<void> {
  const seen = new Set<string>();
  for (const row of nextRows) {
    const id = rowId(row);
    if (!id) throw new Error("Record mist id.");
    if (seen.has(id)) throw new Error(`Dubbele record id: ${id}`);
    seen.add(id);
  }

  const current = await requestJson<ListResponse<T>>(`${API_BASE_URL}/data/${encodeURIComponent(datasetName)}/items`, {
    cache: "no-store",
  });
  const currentRows = Array.isArray(current.items) ? current.items : [];
  const currentById = new Map(currentRows.map((row) => [rowId(row), row]));
  const etags = current.item_etags ?? {};

  for (const row of nextRows) {
    const id = rowId(row);
    const existing = currentById.get(id);
    if (!existing) {
      await createDatasetItem(datasetName, row);
      continue;
    }
    if (stableStringify(existing) === stableStringify(row)) continue;
    await requestJson(`${API_BASE_URL}/data/${encodeURIComponent(datasetName)}/items/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": etags[id] ?? "",
      },
      body: JSON.stringify(row),
    });
  }

  const nextIds = new Set(nextRows.map(rowId));
  for (const row of currentRows) {
    const id = rowId(row);
    if (!id || nextIds.has(id)) continue;
    await requestJson(`${API_BASE_URL}/data/${encodeURIComponent(datasetName)}/items/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "If-Match": etags[id] ?? "" },
    });
  }
}
