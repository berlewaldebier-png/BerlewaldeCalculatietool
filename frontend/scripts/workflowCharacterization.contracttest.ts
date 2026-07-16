import path from "node:path";

type Row = Record<string, unknown> & { id: string };
type DatasetModule = typeof import("../src/lib/datasetItems");
type WizardIoModule = typeof import("../src/components/berekeningen/berekeningenWizardIo");
type BeerStyleModule = typeof import("../src/components/berekeningen/beerStylePersistence");
type VariantProjectionModule = typeof import("../src/components/berekeningen/sellableVariantProjection");
type PurchaseProjectionModule = typeof import("../src/components/berekeningen/purchaseProductProjection");
type WizardDerivationsModule = typeof import("../src/components/berekeningen/berekeningenWizardDerivations");
type ApiClientModule = typeof import("../src/lib/apiClient");
type ApplicationSettingsApiModule = typeof import("../src/components/instellingen/applicationSettingsApi");

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
  const { activateKostprijsversieProducts, saveBierRow, saveKostprijsversie } =
    require("../src/components/berekeningen/berekeningenWizardIo") as WizardIoModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { prepareBeerStylePersistence } =
    require("../src/components/berekeningen/beerStylePersistence") as BeerStyleModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { selectExplicitBeerVariantSkus } =
    require("../src/components/berekeningen/sellableVariantProjection") as VariantProjectionModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { expandSelectedInkoopProductsToBasisproducten } =
    require("../src/components/berekeningen/purchaseProductProjection") as PurchaseProjectionModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildResultaatSnapshotFromWizard } =
    require("../src/components/berekeningen/berekeningenWizardDerivations") as WizardDerivationsModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ApiRequestError, apiErrorMessage, apiRequestJsonClient } =
    require("../src/lib/apiClient") as ApiClientModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadApplicationSettings, saveApplicationSettings } =
    require("../src/components/instellingen/applicationSettingsApi") as ApplicationSettingsApiModule;
  const originalFetch = globalThis.fetch;

  try {
    {
      let requestCount = 0;
      let requestedUrl = "";
      let requestedInit: RequestInit | undefined;
      globalThis.fetch = async (input, init) => {
        requestCount += 1;
        requestedUrl = String(input);
        requestedInit = init;
        return jsonResponse({
          company_name: "Berlewalde Brouwerij",
          currency: "EUR",
          support_email: "info@berlewaldebier.nl",
        });
      };

      const result = await loadApplicationSettings();

      assert(requestCount === 1, "Application-settings read introduced an automatic retry.");
      assert(requestedUrl.endsWith("/data/application-settings"), "Application-settings read URL changed.");
      assert(requestedInit?.cache === "no-store", "Application-settings read cache contract changed.");
      assert(requestedInit?.method === undefined, "Application-settings read method changed.");
      assert(requestedInit?.credentials === undefined, "Application-settings read credential mode changed.");
      assert(result.company_name === "Berlewalde Brouwerij", "Application-settings response changed.");
    }

    {
      globalThis.fetch = async () =>
        jsonResponse({
          data: {
            company_name: "Berlewalde Brouwerij",
            currency: "EUR",
            support_email: "info@berlewaldebier.nl",
          },
        });
      const result = await loadApplicationSettings();
      assert(result.company_name === "Berlewalde Brouwerij", "Application-settings envelope handling changed.");
    }

    {
      let requestCount = 0;
      let requestedUrl = "";
      let requestedInit: RequestInit | undefined;
      globalThis.fetch = async (input, init) => {
        requestCount += 1;
        requestedUrl = String(input);
        requestedInit = init;
        return new Response(null, { status: 204 });
      };
      const payload = {
        company_name: "Berlewalde Brouwerij",
        currency: "EUR",
        support_email: "info@berlewaldebier.nl",
      };

      await saveApplicationSettings(payload);

      assert(requestCount === 1, "Application-settings save introduced an automatic retry.");
      assert(requestedUrl.endsWith("/data/application-settings"), "Application-settings save URL changed.");
      assert(requestedInit?.method === "PUT", "Application-settings save method changed.");
      assert(requestedInit?.credentials === undefined, "Application-settings save credential mode changed.");
      assert(
        new Headers(requestedInit?.headers).get("Content-Type") === "application/json",
        "Application-settings content type changed."
      );
      assert(requestedInit?.body === JSON.stringify(payload), "Application-settings request payload changed.");
    }

    {
      const statuses = [401, 403, 404, 409, 412, 422, 500];
      for (const status of statuses) {
        let requestCount = 0;
        const body = JSON.stringify({
          detail: `status-${status}`,
          request_id: `request-${status}`,
        });
        globalThis.fetch = async () => {
          requestCount += 1;
          return new Response(body, {
            status,
            headers: { "Content-Type": "application/json" },
          });
        };

        const error = await expectRejects(
          () => saveApplicationSettings({ company_name: "Test" }),
          `${status} must reject`
        );

        assert(error instanceof ApiRequestError, `${status} did not produce structured API metadata.`);
        assert(error.status === status, `${status} metadata changed.`);
        assert(error.category === "http", `${status} error category changed.`);
        assert(error.detail === `status-${status}`, `${status} detail parsing changed.`);
        assert(error.requestId === `request-${status}`, `${status} request id parsing changed.`);
        assert(error.bodyText === body, `${status} raw response preservation changed.`);
        assert(apiErrorMessage(error, "Opslaan mislukt.") === body, `${status} visible raw error text changed.`);
        assert(requestCount === 1, `${status} introduced an automatic retry.`);
      }
    }

    {
      globalThis.fetch = async () =>
        new Response("plain failure", {
          status: 400,
          headers: { "X-Request-ID": "plain-request" },
        });
      const error = await expectRejects(
        () => saveApplicationSettings({ company_name: "Test" }),
        "Plain-text error must reject"
      );
      assert(error instanceof ApiRequestError, "Plain-text error lost structured metadata.");
      assert(error.detail === "", "Plain-text response unexpectedly invented a detail.");
      assert(error.requestId === "plain-request", "Header request id metadata changed.");
      assert(apiErrorMessage(error, "Opslaan mislukt.") === "plain failure", "Plain-text error copy changed.");
    }

    {
      globalThis.fetch = async () => new Response(null, { status: 500 });
      const error = await expectRejects(
        () => saveApplicationSettings({ company_name: "Test" }),
        "Empty HTTP error must reject"
      );
      assert(error instanceof ApiRequestError, "Empty HTTP error lost structured metadata.");
      assert(
        apiErrorMessage(error, "Opslaan mislukt.") === "Opslaan mislukt.",
        "Empty HTTP error no longer uses the existing Dutch fallback."
      );
    }

    {
      globalThis.fetch = async () => new Response("not-json", { status: 200 });
      const error = await expectRejects(
        () => loadApplicationSettings(),
        "Invalid JSON read must reject"
      );
      assert(error instanceof ApiRequestError, "Invalid JSON did not produce structured metadata.");
      assert(error.category === "invalid_response", "Invalid JSON category changed.");
      assert(error.bodyText === "not-json", "Invalid JSON raw body changed.");
    }

    {
      let requestCount = 0;
      globalThis.fetch = async () => {
        requestCount += 1;
        throw new TypeError("Failed to fetch");
      };
      const error = await expectRejects(
        () => loadApplicationSettings(),
        "Network failure must reject"
      );
      assert(error instanceof ApiRequestError, "Network failure did not produce structured metadata.");
      assert(error.category === "network", "Network failure category changed.");
      assert(error.message === "Failed to fetch", "Network failure message changed.");
      assert(requestCount === 1, "Network failure introduced an automatic retry.");
    }

    {
      globalThis.fetch = async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("Missing timeout signal"));
            return;
          }
          const rejectWithReason = () => reject(signal.reason);
          if (signal.aborted) rejectWithReason();
          else signal.addEventListener("abort", rejectWithReason, { once: true });
        });
      const error = await expectRejects(
        () => apiRequestJsonClient("/slow-read", { cache: "no-store" }, { timeoutMs: 5 }),
        "Timeout must reject"
      );
      assert(error instanceof ApiRequestError, "Timeout did not produce structured metadata.");
      assert(error.category === "timeout", "Timeout category changed.");
    }

    {
      const controller = new AbortController();
      controller.abort();
      globalThis.fetch = async (_input, init) => {
        const signal = init?.signal;
        if (signal?.aborted) throw signal.reason;
        throw new Error("Expected an aborted signal");
      };
      const error = await expectRejects(
        () => apiRequestJsonClient("/cancelled-read", { signal: controller.signal }),
        "Explicit abort must reject"
      );
      assert(error instanceof ApiRequestError, "Explicit abort did not produce structured metadata.");
      assert(error.category === "aborted", "Explicit abort category changed.");
    }

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
      let requestedPath = "";
      let requestedBody = "";
      let configuredTimeoutMs = 0;
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {
        setTimeout(handler: TimerHandler, timeout?: number, ...args: unknown[]) {
          configuredTimeoutMs = Number(timeout ?? 0);
          return globalThis.setTimeout(handler, timeout, ...args) as unknown as number;
        },
        clearTimeout(timeoutId: number) {
          globalThis.clearTimeout(timeoutId);
        },
      };
      globalThis.fetch = async (input, init = {}) => {
        requestedPath = String(input);
        requestedBody = String(init.body ?? "");
        return jsonResponse({ activated: true });
      };
      try {
        await activateKostprijsversieProducts("cost-activation", ["fmt-fles-33cl"]);
      } finally {
        (globalThis as any).window = originalWindow;
      }

      assert(
        requestedPath.endsWith("/data/kostprijsversies/cost-activation/activate-products"),
        "Product activation request path changed."
      );
      assert(
        requestedBody === JSON.stringify({ product_ids: ["fmt-fles-33cl"] }),
        "Product activation request body changed."
      );
      assert(
        configuredTimeoutMs === 120_000,
        "Cost activation must allow the synchronous margin-snapshot refresh to complete."
      );
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

    {
      const bottle = {
        id: "fmt-fles-33cl",
        jaar: 2026,
        omschrijving: "Fles 33cl",
        inhoud_per_eenheid_liter: 0.33,
        totale_verpakkingskosten: 0,
      };
      const box = {
        id: "fmt-doos-24-33cl",
        jaar: 2026,
        omschrijving: "Doos 24 * 33cl",
        totale_inhoud_liter: 7.92,
        totale_verpakkingskosten: 0,
        basisproducten: [
          {
            basisproduct_id: "fmt-fles-33cl",
            omschrijving: "Fles 33cl",
            aantal: 24,
            inhoud_per_eenheid_liter: 0.33,
            totale_inhoud_liter: 7.92,
          },
          {
            basisproduct_id: "fmt-fles-33cl",
            omschrijving: "Fles 33cl (dubbele relatie)",
            aantal: 24,
            inhoud_per_eenheid_liter: 0.33,
            totale_inhoud_liter: 7.92,
          },
          {
            basisproduct_id: "verpakkingsonderdeel:doos-24",
            omschrijving: "Doos 24 * 33cl",
            aantal: 1,
            inhoud_per_eenheid_liter: 0,
            totale_inhoud_liter: 0,
          },
          {
            basisproduct_id: "missing-format",
            omschrijving: "Ontbrekende koppeling",
            aantal: 1,
          },
        ],
      };
      const selected = [{ product: box, prijsPerEenheid: 24 }];
      const expanded = expandSelectedInkoopProductsToBasisproducten(selected, [bottle]);

      assert(
        JSON.stringify(expanded.map((item) => String(item.product.id))) ===
          JSON.stringify(["fmt-doos-24-33cl", "fmt-fles-33cl"]),
        "A selected composite must remain visible and add each valid basis child exactly once."
      );
      assert(
        Number(expanded[1]?.prijsPerEenheid) === 1,
        "The historical composite-to-basis unit-cost derivation changed."
      );

      const snapshot = buildResultaatSnapshotFromWizard({
        row: {
          id: "cost-juweel",
          bier_id: "beer-juweel",
          basisgegevens: {
            bier_id: "beer-juweel",
            biernaam: "Berlewalde Het Juweel",
            jaar: 2026,
            belastingsoort: "Geen",
            alcoholpercentage: 6.5,
          },
          soort_berekening: { type: "Inkoop" },
          supplier_id: "beerselect",
          supplier_config: {
            packaging_costs_apply_by_sku: {},
            excise_included_in_purchase_price: false,
          },
        },
        productie: {},
        vasteKosten: {},
        tarievenHeffingen: [],
        packagingComponentPrices: [],
        basisproducten: [bottle],
        samengesteldeProducten: [box],
        getYearProduction: () => ({}),
        getProductDisplayName: (product) => String(product.omschrijving ?? product.id ?? ""),
        calculateVariabeleKostenPerLiter: () => 24 / 7.92,
        getSelectedInkoopProducts: () => selected,
      });
      const basisRows = snapshot.producten.basisproducten;
      const compositeRows = snapshot.producten.samengestelde_producten;

      assert(
        JSON.stringify(basisRows.map((row) => row.product_id)) === JSON.stringify(["fmt-fles-33cl"]),
        "The result snapshot did not expose the composite's basis-product child."
      );
      assert(
        JSON.stringify(compositeRows.map((row) => row.product_id)) === JSON.stringify(["fmt-doos-24-33cl"]),
        "The result snapshot lost or duplicated the selected composite product."
      );
      assert(Number(basisRows[0]?.primaire_kosten) === 1, "Basis-product cost snapshot changed.");
      assert(Number(basisRows[0]?.kostprijs) === 1, "Basis-product total cost snapshot changed.");
      assert(Number(compositeRows[0]?.primaire_kosten) === 24, "Composite primary cost snapshot changed.");
      assert(Number(compositeRows[0]?.kostprijs) === 24, "Composite total cost snapshot changed.");
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
