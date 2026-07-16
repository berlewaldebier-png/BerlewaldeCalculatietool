import path from "node:path";

type Row = Record<string, unknown> & { id: string };
type DatasetModule = typeof import("../src/lib/datasetItems");
type WizardIoModule = typeof import("../src/components/berekeningen/berekeningenWizardIo");
type BeerStyleModule = typeof import("../src/components/berekeningen/beerStylePersistence");
type VariantProjectionModule = typeof import("../src/components/berekeningen/sellableVariantProjection");

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
  const calls: Array<{ method: string; id: string; bodyId: string; ifMatch: string }> = [];
  const requests: Array<{ method: string; id: string }> = [];
  let mutationCount = 0;
  let failMutation = 0;
  let failStatus = 500;

  const fetchMock: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input), "http://workflow.test");
    const method = String(init.method ?? "GET").toUpperCase();
    const itemMatch = url.pathname.match(/\/items\/([^/]+)$/);
    const id = itemMatch ? decodeURIComponent(itemMatch[1]) : "";
    requests.push({ method, id });

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

    const body = init.body ? JSON.parse(String(init.body)) as Partial<Row> : {};
    const headers = new Headers(init.headers);
    mutationCount += 1;
    calls.push({
      method,
      id,
      bodyId: String(body.id ?? ""),
      ifMatch: String(headers.get("If-Match") ?? ""),
    });
    if (failMutation > 0 && mutationCount === failMutation) {
      return jsonResponse({ detail: `injected-${method.toLowerCase()}-${id || mutationCount}` }, failStatus);
    }

    if (method === "POST") {
      const row = body as Row;
      if (rows.has(row.id)) return jsonResponse({ detail: "already exists" }, 409);
      rows.set(row.id, structuredClone(row));
      return jsonResponse({ item: row });
    }
    if (method === "PUT") {
      const row = body as Row;
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
    requests,
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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { saveBierRow, saveKostprijsversie } =
    require("../src/components/berekeningen/berekeningenWizardIo") as WizardIoModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { prepareBeerStylePersistence } =
    require("../src/components/berekeningen/beerStylePersistence") as BeerStyleModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { selectExplicitBeerVariantSkus } =
    require("../src/components/berekeningen/sellableVariantProjection") as VariantProjectionModule;
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
      api.injectFailure(1, 409);
      const error = await expectRejects(
        () => reconcileDatasetItems("channels", [{ id: "changed", label: "New" }]),
        "ETag conflict must reject"
      );
      assert(error.message.includes("injected-put-changed"), "API conflict detail is no longer surfaced");
      assert(api.rows.get("changed")?.label === "Old", "conflicted update must not change the item");
      assert(api.rows.has("stale"), "later deletion must not run after an ETag conflict");
    }

    {
      const api = createDatasetApi([]);
      globalThis.fetch = api.fetchMock;
      const requested = { id: "beer-create", biernaam: "Saison", stijl: "Saison", active: true };

      await saveBierRow(requested, { knownExisting: false });

      assert(
        JSON.stringify(api.requests) === JSON.stringify([{ method: "POST", id: "" }]),
        "A known-new beer must be created directly without a list read or expected item 404."
      );
      assert(api.rows.get("beer-create")?.stijl === "Saison", "The targeted beer create changed its payload.");
    }

    {
      const api = createDatasetApi([
        { id: "beer-update", biernaam: "Blond", stijl: "Old style" },
        { id: "beer-keep", biernaam: "Tripel", stijl: "Tripel" },
      ]);
      globalThis.fetch = api.fetchMock;
      await saveBierRow(
        { id: "beer-update", biernaam: "Blond", stijl: "Belgisch blond" },
        { knownExisting: true }
      );
      assert(
        JSON.stringify(api.requests) ===
          JSON.stringify([
            { method: "GET", id: "beer-update" },
            { method: "PUT", id: "beer-update" },
          ]),
        "An existing beer must use its item ETag and must not reconcile unrelated beer rows."
      );
      assert(api.calls[0].ifMatch === "etag-beer-update", "Beer update must carry its current ETag.");
      assert(api.rows.get("beer-keep")?.stijl === "Tripel", "Targeted beer save changed an unrelated beer.");
    }

    {
      globalThis.fetch = async () => new Response(null, { status: 500 });
      const error = await expectRejects(
        () => saveBierRow({ id: "beer", biernaam: "Blond", stijl: "Blond" }, { knownExisting: false }),
        "Empty API failure must reject."
      );
      assert(
        error.message === "Bierstamdata opslaan mislukt.",
        "The existing beer-save fallback message changed."
      );
    }

    {
      const api = createDatasetApi([]);
      globalThis.fetch = api.fetchMock;
      const version = { id: "cost-new", status: "concept" };
      await saveKostprijsversie(version, { knownExisting: false });
      await saveKostprijsversie({ ...version, status: "concept-retry" }, { knownExisting: false });

      assert(
        JSON.stringify(api.requests) ===
          JSON.stringify([
            { method: "POST", id: "" },
            { method: "POST", id: "" },
            { method: "GET", id: "cost-new" },
            { method: "PUT", id: "cost-new" },
          ]),
        "A partial-retry save must recover from create conflict through an ETag-protected update."
      );
      assert(api.rows.get("cost-new")?.status === "concept-retry", "Partial retry did not converge.");
    }

    {
      let idCount = 0;
      const prepared = prepareBeerStylePersistence({
        costRecord: {
          id: "cost-1",
          basisgegevens: {
            sku_type: "bier",
            biernaam: "Berlewalde Het Juweel",
            alcoholpercentage: 6.5,
            stijl: "Belgisch blond",
          },
        },
        beers: [],
        createId: () => `beer-${++idCount}`,
        nowIso: "2026-07-16T10:00:00.000Z",
      });
      assert(prepared !== null, "Beer style preparation unexpectedly skipped a beer calculation.");
      assert(prepared.beerRecord.id === "beer-1", "Beer style preparation changed generated identity.");
      assert(prepared.costRecord.bier_id === "beer-1", "Cost record did not receive the beer identity.");
      assert(
        (prepared.costRecord.basisgegevens as Record<string, unknown>).bier_id === "beer-1",
        "Cost basis data did not receive the same beer identity."
      );

      const repeated = prepareBeerStylePersistence({
        costRecord: prepared.costRecord,
        beers: [],
        createId: () => `beer-${++idCount}`,
        nowIso: "2026-07-16T10:01:00.000Z",
      });
      assert(
        repeated?.beerRecord.id === "beer-1",
        "A partial retry without refreshed beer state created a duplicate beer identity."
      );
      assert(idCount === 1, "Repeated preparation unexpectedly generated a second beer id.");
    }

    {
      const globalArticleSkus: Row[] = [
        { id: "merch", kind: "article", beer_id: "", article_id: "article-merch" },
        { id: "service", kind: "article", beer_id: "", article_id: "article-service" },
      ];
      assert(
        selectExplicitBeerVariantSkus({
          beerId: "",
          skus: globalArticleSkus,
          bomLines: [],
        }).length === 0,
        "An empty beer id must never project global article SKUs as saved beer variants."
      );

      const selected = selectExplicitBeerVariantSkus({
        beerId: "beer-1",
        skus: [
          ...globalArticleSkus,
          { id: "base", kind: "beer_format", beer_id: "beer-1", article_id: "format-1" },
          {
            id: "explicit-box",
            kind: "article",
            beer_id: "beer-1",
            article_id: "article-box",
            sellable_subtype: "beer_bundle",
          },
          { id: "other-beer-box", kind: "article", beer_id: "beer-2", article_id: "article-other" },
          { id: "uncomposed", kind: "article", beer_id: "beer-1", article_id: "article-uncomposed" },
        ],
        bomLines: [
          {
            id: "bom-box",
            parent_article_id: "article-box",
            component_sku_id: "base",
            quantity: 12,
          },
        ],
      });
      assert(
        JSON.stringify(selected.map((row) => row.id)) === JSON.stringify(["explicit-box"]),
        "Only explicitly composed variants for the selected beer may be projected."
      );
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
