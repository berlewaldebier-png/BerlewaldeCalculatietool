import path from "node:path";

type Row = Record<string, unknown> & { id: string };
type DatasetModule = typeof import("../src/lib/datasetItems");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectRejects(action: () => Promise<unknown>, message: string): Promise<Error> {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error(message);
}

function installAtAliasResolverForCompiledTests() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require("module") as any;
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options: unknown) {
    if (typeof request === "string" && request.startsWith("@/")) {
      const compiledRoot = path.resolve(__dirname, "..");
      const mapped = path.join(compiledRoot, "src", request.slice(2));
      return originalResolveFilename.call(this, mapped, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createDatasetApi(initialRows: Row[]) {
  const rows = new Map(initialRows.map((row) => [row.id, structuredClone(row)]));
  const calls: Array<{ method: string; id: string }> = [];
  let mutationCount = 0;
  let failMutation = 0;
  let failStatus = 500;

  const fetchMock: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input), "http://workflow.test");
    const method = String(init.method ?? "GET").toUpperCase();
    const itemMatch = url.pathname.match(/\/items\/([^/]+)$/);
    const id = itemMatch ? decodeURIComponent(itemMatch[1]) : "";

    if (method === "GET" && !id) {
      return jsonResponse({
        items: [...rows.values()].map((row) => structuredClone(row)),
        item_etags: Object.fromEntries([...rows.keys()].map((key) => [key, `etag-${key}`])),
      });
    }

    if (method === "GET" && id) {
      const row = rows.get(id);
      if (!row) return jsonResponse({ detail: "not found" }, 404);
      return jsonResponse({ item: structuredClone(row), etag: `etag-${id}` });
    }

    mutationCount += 1;
    calls.push({ method, id });
    if (failMutation > 0 && mutationCount === failMutation) {
      return jsonResponse({ detail: `injected-${method.toLowerCase()}-${id || mutationCount}` }, failStatus);
    }

    if (method === "POST") {
      const row = JSON.parse(String(init.body ?? "{}")) as Row;
      rows.set(row.id, structuredClone(row));
      return jsonResponse({ item: row });
    }
    if (method === "PUT") {
      const row = JSON.parse(String(init.body ?? "{}")) as Row;
      rows.set(id, structuredClone(row));
      return jsonResponse({ item: row });
    }
    if (method === "DELETE") {
      rows.delete(id);
      return jsonResponse({ deleted: 1 });
    }
    return jsonResponse({ detail: "unsupported" }, 405);
  };

  return {
    rows,
    calls,
    fetchMock,
    injectFailure(atMutation: number, status = 500) {
      mutationCount = 0;
      failMutation = atMutation;
      failStatus = status;
    },
    clearFailure() {
      mutationCount = 0;
      failMutation = 0;
      failStatus = 500;
    },
  };
}

async function run() {
  installAtAliasResolverForCompiledTests();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { reconcileDatasetItems } = require("../src/lib/datasetItems") as DatasetModule;
  const originalFetch = globalThis.fetch;

  try {
    {
      const api = createDatasetApi([]);
      globalThis.fetch = api.fetchMock;
      const error = await expectRejects(
        () => reconcileDatasetItems("channels", [{ id: "duplicate" }, { id: "duplicate" }]),
        "duplicate ids must reject"
      );
      assert(error.message === "Dubbele record id: duplicate", "duplicate-id error text changed");
      assert(api.calls.length === 0, "duplicate validation must happen before any request");
    }

    {
      const api = createDatasetApi([]);
      globalThis.fetch = api.fetchMock;
      api.injectFailure(2);
      await expectRejects(
        () => reconcileDatasetItems("channels", [{ id: "first", label: "First" }, { id: "second", label: "Second" }]),
        "the injected second mutation must reject"
      );
      assert(api.rows.has("first"), "the first item currently remains committed after a later failure");
      assert(!api.rows.has("second"), "the failed second item must not appear committed");

      api.clearFailure();
      await reconcileDatasetItems("channels", [{ id: "first", label: "First" }, { id: "second", label: "Second" }]);
      assert(api.rows.size === 2, "manual retry must converge to the requested item set");
      assert(api.rows.has("first") && api.rows.has("second"), "manual retry lost an item");
    }

    {
      const api = createDatasetApi([{ id: "keep", label: "Keep" }, { id: "stale", label: "Stale" }]);
      globalThis.fetch = api.fetchMock;
      api.injectFailure(1);
      await expectRejects(
        () => reconcileDatasetItems("channels", [{ id: "keep", label: "Keep" }, { id: "new", label: "New" }]),
        "create failure must reject"
      );
      assert(api.rows.has("stale"), "deletions currently do not run after an earlier create/update failure");
      assert(!api.calls.some((call) => call.method === "DELETE"), "delete ran after an earlier mutation failure");

      api.clearFailure();
      await reconcileDatasetItems("channels", [{ id: "keep", label: "Keep" }, { id: "new", label: "New" }]);
      assert(!api.rows.has("stale"), "successful retry must perform the deferred deletion");
    }

    {
      const api = createDatasetApi([{ id: "changed", label: "Old" }, { id: "stale", label: "Stale" }]);
      globalThis.fetch = api.fetchMock;
      api.injectFailure(1, 412);
      const error = await expectRejects(
        () => reconcileDatasetItems("channels", [{ id: "changed", label: "New" }]),
        "ETag conflict must reject"
      );
      assert(error.message.includes("injected-put-changed"), "API conflict detail is no longer surfaced");
      assert(api.rows.get("changed")?.label === "Old", "conflicted update must not change the item");
      assert(api.rows.has("stale"), "later deletion must not run after an ETag conflict");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run()
  .then(() => console.log("workflowCharacterization contracttest OK"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
