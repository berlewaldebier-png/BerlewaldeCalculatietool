"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { formatMoneyEUR } from "@/lib/formatters";

type Basis = "invoice" | "order";
type Status = "open" | "resolved" | "all";

type Rule = {
  rule_id: number;
  action: "categorize" | "ignore";
  category: string;
  include_revenue: boolean;
  include_liters: boolean;
  include_break_even: boolean;
};

type GroupRow = {
  match_type: "douano_product_id" | "product0_description";
  douano_product_id: number;
  line_description: string;
  display_name: string;
  product_sku: string;
  lines: number;
  quantity: number;
  net_revenue_ex: number;
  rule: Rule | null;
  example_ref: string;
  example_date: string;
};

type LineRow = {
  line_id: number;
  ref: string;
  ref_date: string;
  douano_product_id: number;
  product_name: string;
  product_sku: string;
  line_description: string;
  quantity: number;
  unit_price_ex: number;
  discount_ex: number;
  charges_total_ex: number;
  net_revenue_ex: number;
};

type SkuRow = {
  id: string;
  name: string;
  active: boolean;
  kind: string;
  beer_id?: string;
};

function euro(value: number) {
  if (!Number.isFinite(value)) return "-";
  return formatMoneyEUR(value);
}

async function readJson(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return payload;
}

async function writeJson(path: string, method: string, payload: unknown) {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: payload != null ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof (data as any)?.detail === "string" ? (data as any).detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return data;
}

function defaultYear() {
  const y = new Date().getFullYear();
  return y - 1;
}

const CATEGORY_PRESETS: Array<{ id: string; label: string; defaults: Partial<Rule> }> = [
  { id: "Afronding", label: "Afronding", defaults: { include_revenue: true, include_liters: false, include_break_even: true } },
  { id: "Emballage", label: "Emballage", defaults: { include_revenue: true, include_liters: false, include_break_even: false } },
  { id: "Proeverij", label: "Proeverij", defaults: { include_revenue: true, include_liters: false, include_break_even: true } },
  { id: "Eten", label: "Eten", defaults: { include_revenue: true, include_liters: false, include_break_even: true } },
  { id: "Service", label: "Service", defaults: { include_revenue: true, include_liters: false, include_break_even: true } },
  { id: "Correctie", label: "Correctie", defaults: { include_revenue: true, include_liters: false, include_break_even: true } },
  { id: "Overig", label: "Overig", defaults: { include_revenue: true, include_liters: false, include_break_even: true } },
];

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="cpq-modal-backdrop" role="dialog" aria-modal="true">
      <div className="cpq-modal">
        <div className="cpq-modal-header">
          <div style={{ fontWeight: 800 }}>{title}</div>
          <button type="button" className="editor-button editor-button-secondary" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="cpq-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function DouanoUnmappedRulesCard() {
  const [basis, setBasis] = useState<Basis>("invoice");
  const [year, setYear] = useState<number>(defaultYear());
  const [statusFilter, setStatusFilter] = useState<Status>("open");
  const [limit, setLimit] = useState<number>(200);
  const [items, setItems] = useState<GroupRow[]>([]);
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "success" | "error">("");

  const [solveRow, setSolveRow] = useState<GroupRow | null>(null);
  const [showLinesFor, setShowLinesFor] = useState<GroupRow | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);

  const [solveMode, setSolveMode] = useState<"map" | "categorize" | "ignore">("categorize");
  const [category, setCategory] = useState<string>("Afronding");
  const [includeRevenue, setIncludeRevenue] = useState<boolean>(true);
  const [includeLiters, setIncludeLiters] = useState<boolean>(false);
  const [includeBreakEven, setIncludeBreakEven] = useState<boolean>(true);
  const [selectedSkuId, setSelectedSkuId] = useState<string>("");

  const availableSkus = useMemo(() => {
    return skus
      .filter((s) => s && s.active && (s.kind === "article" || s.kind === "bundle"))
      .map((s) => ({ id: String(s.id || ""), name: String(s.name || "") }))
      .filter((s) => s.id)
      .sort((a, b) => a.name.localeCompare(b.name, "nl-NL"));
  }, [skus]);

  async function refresh() {
    setStatus("Laden…");
    setTone("");
    try {
      const [groupsPayload, skusPayload] = await Promise.all([
        readJson(
          `/api/integrations/douano/unmapped-groups?year=${encodeURIComponent(String(year))}&basis=${encodeURIComponent(
            basis
          )}&status=${encodeURIComponent(statusFilter)}&limit=${encodeURIComponent(String(limit))}`
        ),
        readJson(`/api/data/skus`),
      ]);
      const rows = (groupsPayload?.result?.items ?? []) as GroupRow[];
      setItems(Array.isArray(rows) ? rows : []);
      setSkus(Array.isArray(skusPayload?.data) ? skusPayload.data : []);
      setStatus("Gereed");
      setTone("success");
    } catch (error) {
      setItems([]);
      setSkus([]);
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSolve(row: GroupRow) {
    setSolveRow(row);
    const isProduct0 = row.match_type === "product0_description";
    setSolveMode(isProduct0 ? "categorize" : "map");
    setSelectedSkuId("");
    const initialCategory = row.rule?.category || "Afronding";
    setCategory(initialCategory);
    const preset = CATEGORY_PRESETS.find((p) => p.id === initialCategory);
    const defaults = preset?.defaults ?? {};
    setIncludeRevenue(row.rule?.include_revenue ?? (defaults.include_revenue ?? true));
    setIncludeLiters(row.rule?.include_liters ?? (defaults.include_liters ?? false));
    setIncludeBreakEven(row.rule?.include_break_even ?? (defaults.include_break_even ?? true));
  }

  async function openLines(row: GroupRow) {
    setShowLinesFor(row);
    setLines([]);
    try {
      const qs = new URLSearchParams();
      qs.set("year", String(year));
      qs.set("basis", basis);
      qs.set("match_type", row.match_type);
      qs.set("douano_product_id", String(row.douano_product_id || 0));
      if (row.match_type === "product0_description") qs.set("line_description", row.line_description || "");
      const payload = await readJson(`/api/integrations/douano/unmapped-group-lines?${qs.toString()}`);
      setLines(Array.isArray(payload?.result?.items) ? payload.result.items : []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  async function saveSolve() {
    if (!solveRow) return;
    try {
      if (solveMode === "map") {
        if (solveRow.match_type !== "douano_product_id") {
          throw new Error("Koppelen aan SKU kan alleen voor echte Douano producten.");
        }
        const skuId = selectedSkuId.trim();
        if (!skuId) throw new Error("Selecteer een SKU.");

        const sku = skus.find((s: any) => String(s?.id ?? "") === skuId);
        const beerId = String((sku as any)?.beer_id ?? "").trim();
        const productGroup = beerId ? "drank" : "";

        await writeJson(`/api/integrations/douano/product-mappings/${solveRow.douano_product_id}`, "PUT", {
          sku_id: skuId,
          product_group: productGroup,
          alcohol_category: "",
          packaging_type: "",
        });
      } else if (solveMode === "ignore") {
        await writeJson(`/api/integrations/douano/unmapped-rules`, "PUT", {
          match_type: solveRow.match_type,
          douano_product_id: solveRow.douano_product_id || 0,
          line_description: solveRow.line_description || "",
          action: "ignore",
        });
      } else {
        await writeJson(`/api/integrations/douano/unmapped-rules`, "PUT", {
          match_type: solveRow.match_type,
          douano_product_id: solveRow.douano_product_id || 0,
          line_description: solveRow.line_description || "",
          action: "categorize",
          category,
          include_revenue: includeRevenue,
          include_liters: includeLiters,
          include_break_even: includeBreakEven,
        });
      }
      setSolveRow(null);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  return (
    <section className="module-card">
      <div className="module-card-title">Ongekoppelde regels</div>
      <div className="editor-actions" style={{ marginTop: 8 }}>
        <div className="editor-actions-group">
          <select className="editor-input" style={{ width: 160 }} value={basis} onChange={(e) => setBasis(e.target.value === "order" ? "order" : "invoice")}>
            <option value="invoice">Facturen</option>
            <option value="order">Orders</option>
          </select>
          <input
            className="editor-input"
            style={{ width: 120 }}
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value || 0) || defaultYear())}
            inputMode="numeric"
          />
          <select className="editor-input" style={{ width: 160 }} value={statusFilter} onChange={(e) => setStatusFilter((e.target.value as Status) || "open")}>
            <option value="open">Open</option>
            <option value="resolved">Opgelost</option>
            <option value="all">Alles</option>
          </select>
          <select className="editor-input" style={{ width: 120 }} value={String(limit)} onChange={(e) => setLimit(Number(e.target.value || 200) || 200)}>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="500">500</option>
          </select>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => void refresh()}>
            Ververs
          </button>
        </div>
      </div>

      {status ? (
        <div className={`editor-status${tone ? ` ${tone}` : ""}`} style={{ marginTop: 12 }}>
          {status}
        </div>
      ) : null}

      <div style={{ marginTop: 12 }} className="data-table">
        <table>
          <thead>
            <tr>
              <th>Regel</th>
              <th>Key</th>
              <th style={{ textAlign: "right" }}>Omzet (ex)</th>
              <th style={{ textAlign: "right" }}>Regels</th>
              <th>Voorbeeld</th>
              <th>Status</th>
              <th style={{ width: 220 }}>Acties</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const key = row.match_type === "douano_product_id" ? String(row.douano_product_id || 0) : row.line_description || "-";
              const resolved = Boolean(row.rule);
              const statusLabel = resolved
                ? row.rule?.action === "ignore"
                  ? "genegeerd"
                  : `categorie: ${row.rule?.category || "?"}`
                : "open";
              return (
                <tr key={`${row.match_type}:${row.douano_product_id}:${row.line_description}`}>
                  <td style={{ fontWeight: 700 }}>{row.display_name || "-"}</td>
                  <td>
                    <code>{key}</code>
                  </td>
                  <td style={{ textAlign: "right" }}>{euro(Number(row.net_revenue_ex) || 0)}</td>
                  <td style={{ textAlign: "right" }}>{Number(row.lines ?? 0) || 0}</td>
                  <td>
                    {row.example_ref ? (
                      <span title={row.example_date ? `Datum: ${row.example_date}` : ""}>
                        <code>{row.example_ref}</code>
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>
                    <span className="pill" style={{ background: resolved ? "rgba(95,255,156,0.16)" : "rgba(255,206,77,0.16)" }}>
                      {statusLabel}
                    </span>
                  </td>
                  <td style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="editor-button editor-button-secondary" onClick={() => openSolve(row)}>
                      {resolved ? "Bewerken" : "Oplossen"}
                    </button>
                    <button type="button" className="editor-button editor-button-secondary" onClick={() => void openLines(row)}>
                      Bekijk regels
                    </button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ opacity: 0.8 }}>
                  Geen items.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {solveRow ? (
        <Modal title="Ongekoppelde regel oplossen" onClose={() => setSolveRow(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{solveRow.display_name || "-"}</div>
              <div style={{ opacity: 0.8, fontSize: 12 }}>
                Key:{" "}
                <code>
                  {solveRow.match_type === "douano_product_id" ? solveRow.douano_product_id : solveRow.line_description}
                </code>
              </div>
            </div>
            <div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                {solveRow.match_type === "douano_product_id" ? (
                  <button type="button" className={`editor-button ${solveMode === "map" ? "" : "editor-button-secondary"}`} onClick={() => setSolveMode("map")}>
                    Koppelen aan SKU
                  </button>
                ) : null}
                <button type="button" className={`editor-button ${solveMode === "categorize" ? "" : "editor-button-secondary"}`} onClick={() => setSolveMode("categorize")}>
                  Categoriseren
                </button>
                <button type="button" className={`editor-button ${solveMode === "ignore" ? "" : "editor-button-secondary"}`} onClick={() => setSolveMode("ignore")}>
                  Negeren
                </button>
              </div>
            </div>
          </div>

          {solveMode === "map" ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Koppelen aan SKU</div>
              <select className="editor-input" style={{ width: "100%" }} value={selectedSkuId} onChange={(e) => setSelectedSkuId(e.target.value)}>
                <option value="">Selecteer SKU…</option>
                {availableSkus.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))}
              </select>
              <div style={{ opacity: 0.75, fontSize: 12, marginTop: 6 }}>
                Deze actie maakt een productkoppeling aan voor het Douano product.
              </div>
            </div>
          ) : null}

          {solveMode === "categorize" ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Categorie</div>
              <select
                className="editor-input"
                style={{ width: "100%" }}
                value={category}
                onChange={(e) => {
                  const next = e.target.value;
                  setCategory(next);
                  const preset = CATEGORY_PRESETS.find((p) => p.id === next);
                  if (preset?.defaults) {
                    if (typeof preset.defaults.include_revenue === "boolean") setIncludeRevenue(preset.defaults.include_revenue);
                    if (typeof preset.defaults.include_liters === "boolean") setIncludeLiters(preset.defaults.include_liters);
                    if (typeof preset.defaults.include_break_even === "boolean") setIncludeBreakEven(preset.defaults.include_break_even);
                  }
                }}
              >
                {CATEGORY_PRESETS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={includeRevenue} onChange={(e) => setIncludeRevenue(e.target.checked)} />
                  Neem mee in omzet
                </label>
                <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={includeLiters} onChange={(e) => setIncludeLiters(e.target.checked)} />
                  Neem mee in liters
                </label>
                <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={includeBreakEven} onChange={(e) => setIncludeBreakEven(e.target.checked)} />
                  Neem mee in break-even
                </label>
              </div>
            </div>
          ) : null}

          {solveMode === "ignore" ? (
            <div style={{ marginTop: 16, opacity: 0.8 }}>
              Deze regels worden genegeerd in omzet/liters/break-even overzichten (maar blijven traceerbaar via “Bekijk regels”).
            </div>
          ) : null}

          <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="editor-button editor-button-secondary" onClick={() => setSolveRow(null)}>
              Annuleren
            </button>
            <button type="button" className="editor-button" onClick={() => void saveSolve()}>
              Opslaan
            </button>
          </div>
        </Modal>
      ) : null}

      {showLinesFor ? (
        <Modal title="Regels" onClose={() => setShowLinesFor(null)}>
          <div style={{ marginBottom: 8, opacity: 0.8 }}>
            {showLinesFor.display_name} —{" "}
            <code>
              {showLinesFor.match_type === "douano_product_id" ? showLinesFor.douano_product_id : showLinesFor.line_description}
            </code>
          </div>
          <div className="data-table" style={{ maxHeight: 420, overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Ref</th>
                  <th>Omschrijving</th>
                  <th style={{ textAlign: "right" }}>Aantal</th>
                  <th style={{ textAlign: "right" }}>Netto (ex)</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.line_id}>
                    <td>{l.ref_date || "-"}</td>
                    <td>
                      <code>{l.ref || "-"}</code>
                    </td>
                    <td>{l.line_description || l.product_name || String(l.douano_product_id || "")}</td>
                    <td style={{ textAlign: "right" }}>{l.quantity}</td>
                    <td style={{ textAlign: "right" }}>{euro(Number(l.net_revenue_ex) || 0)}</td>
                  </tr>
                ))}
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ opacity: 0.8 }}>
                      Geen regels gevonden.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
