"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCentralSkuIndex } from "@/features/sku/useCentralSkuIndex";
import { moneyEUR, type GenericRecord } from "@/features/sku/adapters/common";
import { SortButton } from "@/components/table/TableControls";
import { compareNullableNumber, compareText } from "@/lib/tableControls";
import {
  toSellableTableRows,
  type PricingMethod,
  type SellableSubtype,
} from "@/features/sku/adapters/toSellablesTableRows";

function subtypeLabel(value: SellableSubtype) {
  if (value === "bier") return "Bier";
  if (value === "dienst") return "Dienst";
  return "Product";
}

function methodLabel(value: PricingMethod) {
  return value === "manual_rate" ? "Tarief" : "Kostprijs";
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M9 4h6" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  );
}

function CalculatorIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="6" y="2.5" width="12" height="19" rx="2.2" />
      <path d="M8 6.5h8" />
      <path d="M9 11h.01" />
      <path d="M12 11h.01" />
      <path d="M15 11h.01" />
      <path d="M9 14h.01" />
      <path d="M12 14h.01" />
      <path d="M15 14h.01" />
      <path d="M9 17h6" />
    </svg>
  );
}

export function VerkoopbareArtikelenWorkspace({
  year,
  channels,
  verkoopprijzen,
  skus,
  articles,
  bomLines,
  bieren,
  skuStyleLinks,
  kostprijsversies,
  kostprijsproductactiveringen,
}: {
  year: number;
  channels: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  bomLines: GenericRecord[];
  bieren: GenericRecord[];
  skuStyleLinks: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
}) {
  const [query, setQuery] = useState("");
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);
  const [sortKey, setSortKey] = useState<"label" | "subtype" | "uom" | "content" | "price" | "status">("label");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [deletingSkuId, setDeletingSkuId] = useState("");
  const [openStyleIds, setOpenStyleIds] = useState<Record<string, boolean>>({});
  const [localSkuStyleLinks, setLocalSkuStyleLinks] = useState<GenericRecord[]>(
    Array.isArray(skuStyleLinks) ? skuStyleLinks : []
  );

  const central = useCentralSkuIndex({
    year,
    channels: Array.isArray(channels) ? channels : [],
    verkoopprijzen: Array.isArray(verkoopprijzen) ? verkoopprijzen : [],
    skus: Array.isArray(skus) ? skus : [],
    articles: Array.isArray(articles) ? articles : [],
    kostprijsversies: Array.isArray(kostprijsversies) ? kostprijsversies : [],
    kostprijsproductactiveringen: Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : [],
    includeDraftCostPlus: true,
  });

  const rows = useMemo(() => {
    return toSellableTableRows(central.rows);
  }, [central.rows]);

  useEffect(() => {
    setLocalSkuStyleLinks(Array.isArray(skuStyleLinks) ? skuStyleLinks : []);
  }, [skuStyleLinks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (showOnlyMissing) {
        if (row.pricingMethod === "manual_rate") return row.manualRateEx <= 0;
        return !row.hasActiveCost;
      }
      if (!q) return true;
      return (
        row.label.toLowerCase().includes(q) ||
        row.skuId.toLowerCase().includes(q) ||
        subtypeLabel(row.subtype).toLowerCase().includes(q)
      );
    });
  }, [rows, query, showOnlyMissing]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      if (sortKey === "label") return compareText(a.label, b.label, sortDir);
      if (sortKey === "subtype") return compareText(subtypeLabel(a.subtype), subtypeLabel(b.subtype), sortDir);
      if (sortKey === "uom") return compareText(a.uom, b.uom, sortDir);
      if (sortKey === "content") return compareNullableNumber(a.contentLiter ?? 0, b.contentLiter ?? 0, sortDir);
      if (sortKey === "price") return compareNullableNumber(a.kostprijsEx ?? 0, b.kostprijsEx ?? 0, sortDir);

      const score = (row: any) => {
        if (row.pricingMethod === "manual_rate") return row.manualRateEx > 0 ? 2 : 0;
        if (row.hasActiveCost) return 3;
        if (row.kostprijsEx > 0) return 1;
        return 0;
      };
      return compareNullableNumber(score(a), score(b), sortDir);
    });
    return copy;
  }, [filtered, sortDir, sortKey]);

  async function deleteSellableSku(skuId: string) {
    const id = String(skuId || "").trim();
    if (!id) return;
    if (deletingSkuId) return;

    const ok = window.confirm(
      `Verkoopbaar artikel verwijderen?\n\nSKU: ${id}\n\nAlleen mogelijk als dit SKU nergens aan gekoppeld is (productkoppeling/offertes/kostprijs/BOM).`
    );
    if (!ok) return;

    try {
      setDeletingSkuId(id);
      const res = await fetch(`/api/meta/delete-sellable?sku_id=${encodeURIComponent(id)}&dry_run=false`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (payload as any)?.detail ?? payload;
        const reasons = (detail as any)?.reasons;
        if (Array.isArray(reasons) && reasons.length > 0) {
          window.alert(`Verwijderen geblokkeerd:\n- ${reasons.join("\n- ")}`);
        } else if (typeof detail === "string" && detail) {
          window.alert(detail);
        } else {
          window.alert("Verwijderen mislukt.");
        }
        return;
      }

      window.location.reload();
    } finally {
      setDeletingSkuId("");
    }
  }

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "label" ? "asc" : "desc");
  }

  const kostprijsBySkuId = useMemo(() => {
    const index = new Map<string, string>();
    const lastTsBySkuId = new Map<string, string>();
    const candidates = Array.isArray(kostprijsversies) ? kostprijsversies : [];
    candidates.forEach((row) => {
      const rec = row as any;
      const jaar = Number(rec?.jaar ?? rec?.basisgegevens?.jaar ?? 0) || 0;
      if (jaar !== year) return;
      const skuId = String(rec?.basisgegevens?.sku_id ?? "").trim();
      const id = String(rec?.id ?? "").trim();
      if (!skuId || !id) return;
      // Prefer the most recently updated record per SKU (definitief usually wins by updated_at).
      const ts = String(rec?.aangepast_op ?? rec?.updated_at ?? rec?.aangemaakt_op ?? rec?.created_at ?? "");
      const prevTs = lastTsBySkuId.get(skuId) ?? "";
      if (!prevTs || (ts && ts > prevTs)) {
        index.set(skuId, id);
        lastTsBySkuId.set(skuId, ts);
      }
    });
    return index;
  }, [kostprijsversies, year]);

  const skuById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(skus) ? skus : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (id) map.set(id, row as any);
    });
    return map;
  }, [skus]);

  const activationVersionBySkuId = useMemo(() => {
    const map = new Map<string, { versionId: string; updatedAt: string }>();
    (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []).forEach((row) => {
      const rec = row as any;
      const jaar = Number(rec?.jaar ?? 0) || 0;
      if (jaar !== year) return;
      const skuId = String(rec?.sku_id ?? "").trim();
      const versionId = String(rec?.kostprijsversie_id ?? "").trim();
      if (!skuId || !versionId) return;
      const updatedAt = String(rec?.updated_at ?? rec?.updatedAt ?? rec?.effectief_vanaf ?? "").trim();
      const prev = map.get(skuId);
      if (!prev || (updatedAt && (!prev.updatedAt || updatedAt > prev.updatedAt))) {
        map.set(skuId, { versionId, updatedAt });
      }
    });
    return map;
  }, [kostprijsproductactiveringen, year]);

  const styleOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    (Array.isArray(bieren) ? bieren : []).forEach((row) => {
      const raw = String((row as any)?.stijl ?? (row as any)?.style ?? "").trim();
      if (!raw) return;
      const key = `style:${raw.toLowerCase()}`;
      if (!seen.has(key)) seen.set(key, { id: key, name: raw });
    });
    return Array.from(seen.values())
      .filter((row) => row.id)
      .sort((a, b) => a.name.localeCompare(b.name, "nl-NL"));
  }, [bieren]);

  const styleById = useMemo(() => {
    return new Map(styleOptions.map((style) => [style.id, style]));
  }, [styleOptions]);

  const skuRawById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(skus) ? skus : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (id) map.set(id, row);
    });
    return map;
  }, [skus]);

  const styleKeyByBeerId = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(bieren) ? bieren : []).forEach((row) => {
      const beerId = String((row as any)?.id ?? "").trim();
      const styleName = String((row as any)?.stijl ?? (row as any)?.style ?? "").trim();
      if (beerId && styleName) map.set(beerId, `style:${styleName.toLowerCase()}`);
    });
    return map;
  }, [bieren]);

  const componentStyleIdsByParentArticle = useMemo(() => {
    const out = new Map<string, Set<string>>();
    (Array.isArray(bomLines) ? bomLines : []).forEach((line) => {
      const parentArticleId = String((line as any)?.parent_article_id ?? "").trim();
      if (!parentArticleId) return;
      const componentSkuId = String((line as any)?.component_sku_id ?? "").trim();
      const componentSku = componentSkuId ? skuRawById.get(componentSkuId) : null;
      const beerId = String((componentSku as any)?.beer_id ?? "").trim();
      const styleKey = beerId ? styleKeyByBeerId.get(beerId) : "";
      if (!styleKey) return;
      if (!out.has(parentArticleId)) out.set(parentArticleId, new Set());
      out.get(parentArticleId)?.add(styleKey);
    });
    return out;
  }, [bomLines, skuRawById, styleKeyByBeerId]);

  const explicitStyleIdsBySku = useMemo(() => {
    const out = new Map<string, Set<string>>();
    (Array.isArray(localSkuStyleLinks) ? localSkuStyleLinks : []).forEach((row) => {
      const skuId = String((row as any)?.sku_id ?? "").trim();
      const rawStyleId = String((row as any)?.style_id ?? "").trim();
      const styleId = styleKeyByBeerId.get(rawStyleId) ?? rawStyleId;
      if (!skuId || !styleId) return;
      if (!out.has(skuId)) out.set(skuId, new Set());
      out.get(skuId)?.add(styleId);
    });
    return out;
  }, [localSkuStyleLinks, styleKeyByBeerId]);

  function inferStyleIdsForSku(skuId: string) {
    const explicit = explicitStyleIdsBySku.get(skuId);
    if (explicit && explicit.size > 0) return Array.from(explicit);
    const sku = skuRawById.get(skuId) as any;
    const beerId = String(sku?.beer_id ?? "").trim();
    const styleKey = beerId ? styleKeyByBeerId.get(beerId) : "";
    if (styleKey) return [styleKey];
    const articleId = String(sku?.article_id ?? "").trim();
    const componentStyles = articleId ? componentStyleIdsByParentArticle.get(articleId) : null;
    if (componentStyles && componentStyles.size > 0) return Array.from(componentStyles);
    return ["__zonder_stijl__"];
  }

  const treeGroups = useMemo(() => {
    const groups = new Map<string, { styleId: string; styleName: string; rows: typeof sorted; inferred: number; mixed: number }>();
    sorted.forEach((row) => {
      const ids = inferStyleIdsForSku(row.skuId);
      const isMixed = ids.filter((id) => id !== "__zonder_stijl__").length > 1;
      ids.forEach((styleId) => {
        const styleName = styleId === "__zonder_stijl__" ? "Zonder stijl" : styleById.get(styleId)?.name || styleId;
        const group = groups.get(styleId) ?? { styleId, styleName, rows: [], inferred: 0, mixed: 0 };
        group.rows.push(row);
        if (!explicitStyleIdsBySku.has(row.skuId)) group.inferred += 1;
        if (isMixed) group.mixed += 1;
        groups.set(styleId, group);
      });
    });
    const preferredOrder = new Map(styleOptions.map((style, index) => [style.id, index]));
    return Array.from(groups.values()).sort((a, b) => {
      const ai = preferredOrder.has(a.styleId) ? preferredOrder.get(a.styleId)! : 9999;
      const bi = preferredOrder.has(b.styleId) ? preferredOrder.get(b.styleId)! : 9999;
      if (ai !== bi) return ai - bi;
      return a.styleName.localeCompare(b.styleName, "nl-NL");
    });
  }, [sorted, styleById, styleOptions, explicitStyleIdsBySku, skuRawById, componentStyleIdsByParentArticle, styleKeyByBeerId]);

  useEffect(() => {
    setOpenStyleIds((current) => {
      if (Object.keys(current).length > 0) return current;
      const next: Record<string, boolean> = {};
      treeGroups.slice(0, 8).forEach((group) => {
        next[group.styleId] = true;
      });
      return next;
    });
  }, [treeGroups]);

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Verkoopbare artikelen</div>
        <div className="module-card-text">
          Centrale lijst van alles wat je kunt offreren (bier, producten, diensten). Producten verschijnen pas in de offerte als er een actieve kostprijs is (jaar {year}); diensten verschijnen zodra er een tarief is ingevuld.
        </div>
      </div>

      <div className="editor-toolbar">
        <div className="editor-toolbar-meta" style={{ gap: 10, display: "flex", alignItems: "center" }}>
          <span className="editor-pill">{filtered.length} artikelen</span>
          <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={showOnlyMissing}
              onChange={(e) => setShowOnlyMissing(e.target.checked)}
            />
            Toon alleen ontbrekende kostprijs/tarief
          </label>
        </div>
        <div className="editor-toolbar-actions" style={{ gap: 10, display: "flex", alignItems: "center" }}>
          <input
            className="cpq-input"
            style={{ width: 320 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zoek op naam (of ID)…"
          />
        </div>
      </div>

      <div className="editor-actions" style={{ marginBottom: 12 }}>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpenStyleIds(Object.fromEntries(treeGroups.map((group) => [group.styleId, true])))}>
            Alles openen
          </button>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpenStyleIds({})}>
            Alles sluiten
          </button>
        </div>
        <div className="editor-toolbar-actions" style={{ gap: 8, display: "flex", alignItems: "center" }}>
          <SortButton label="Naam" active={sortKey === "label"} dir={sortDir} onClick={() => toggleSort("label")} />
          <SortButton label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} />
          <SortButton label="Kostprijs" active={sortKey === "price"} dir={sortDir} onClick={() => toggleSort("price")} />
        </div>
      </div>

      {treeGroups.length === 0 ? (
        <div className="dataset-empty" style={{ padding: "1rem" }}>
          Geen resultaten.
        </div>
      ) : (
        <div className="wizard-stack">
          {treeGroups.map((group) => {
            const isOpen = openStyleIds[group.styleId] ?? false;
            return (
              <section key={group.styleId} className="module-card compact-card" style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  className="module-card-title"
                  style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: "transparent", border: 0, padding: 0, textAlign: "left" }}
                  onClick={() => setOpenStyleIds((current) => ({ ...current, [group.styleId]: !isOpen }))}
                >
                  <span>{isOpen ? "▾" : "▸"} {group.styleName}</span>
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    {group.mixed ? <span className="pill">mixartikelen {group.mixed}</span> : null}
                    <span className="editor-pill">{group.rows.length} SKU&apos;s</span>
                  </span>
                </button>

                {isOpen ? (
                  <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
                    <table className="dataset-editor-table">
                      <thead>
                        <tr>
                          <th style={{ width: 320 }}>Artikel</th>
                          <th style={{ width: 130 }}>Type</th>
                          <th style={{ width: 110 }}>UoM</th>
                          <th style={{ width: 120 }}>Inhoud</th>
                          <th style={{ width: 150 }}>Kostprijs</th>
                          <th style={{ width: 210 }}>Status</th>
                          <th style={{ width: 180 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => {
                          const status =
                            row.pricingMethod === "manual_rate"
                              ? row.manualRateEx > 0
                                ? `Tarief: ${moneyEUR(row.manualRateEx)}`
                                : "Tarief ontbreekt"
                              : row.hasActiveCost
                                ? `Actief (${moneyEUR(row.kostprijsEx)})`
                                : row.kostprijsEx > 0
                                  ? `Concept (${moneyEUR(row.kostprijsEx)})`
                                  : "Nog te activeren";
                          const canDelete = row.pricingMethod === "cost_plus" && !row.hasActiveCost && row.kostprijsEx <= 0;
                          const styleIds = inferStyleIdsForSku(row.skuId).filter((id) => id !== "__zonder_stijl__");
                          const isMixed = styleIds.length > 1;
                          const actionHref =
                            row.pricingMethod === "cost_plus"
                              ? (() => {
                                  const activationVersionId = activationVersionBySkuId.get(row.skuId)?.versionId ?? "";
                                  const existingId = activationVersionId || (kostprijsBySkuId.get(row.skuId) ?? "");
                                  if (existingId) {
                                    return {
                                      pathname: "/nieuwe-kostprijsberekening",
                                      query: { mode: "wizard-edit", selected_id: existingId },
                                    } as any;
                                  }
                                  const kind = row.subtype === "bier" ? "beer" : "article";
                                  return {
                                    pathname: "/nieuwe-kostprijsberekening",
                                    query: { mode: "wizard-new", kind, sku_id: row.skuId },
                                  } as any;
                                })()
                              : null;
                          const editBundleHref = (() => {
                            const skuRow = skuById.get(row.skuId) as any;
                            if (!skuRow) return null;
                            const kind = String(skuRow?.kind ?? "").trim().toLowerCase();
                            if (kind !== "article") return null;
                            const articleId = String(skuRow?.article_id ?? "").trim();
                            if (!articleId) return null;
                            return {
                              pathname: "/product-samenstellen",
                              query: { mode: "verkoopbaar", article_id: articleId },
                            } as any;
                          })();
                          return (
                            <tr key={`${group.styleId}-${row.skuId}`}>
                              <td style={{ fontWeight: 600 }}>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <span>{row.label}</span>
                                  {isMixed ? <span className="pill">mixartikel</span> : null}
                                </div>
                                <div className="muted" style={{ marginTop: 3 }}>{row.skuId}</div>
                              </td>
                              <td>{subtypeLabel(row.subtype)}</td>
                              <td>{row.uom}</td>
                              <td>{row.contentLiter ? row.contentLiter.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}</td>
                              <td>{row.pricingMethod === "cost_plus" ? moneyEUR(row.kostprijsEx) : "-"}</td>
                              <td>{status}</td>
                              <td style={{ textAlign: "right" }}>
                                <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                                  {editBundleHref ? (
                                    <Link className="icon-button-table icon-button-neutral" href={editBundleHref} title="Bewerken" aria-label="Bewerken">
                                      <PencilIcon />
                                    </Link>
                                  ) : null}
                                  {actionHref ? (
                                    <Link className="icon-button-table icon-button-primary" href={actionHref} title="Kostprijs beheren" aria-label="Kostprijs beheren">
                                      <CalculatorIcon />
                                    </Link>
                                  ) : (
                                    <span className="muted">-</span>
                                  )}
                                  {canDelete ? (
                                    <button type="button" className="icon-button-table" title="Verwijder verkoopbaar artikel" aria-label="Verwijder verkoopbaar artikel" onClick={() => deleteSellableSku(row.skuId)} disabled={Boolean(deletingSkuId)}>
                                      <TrashIcon />
                                    </button>
                                  ) : null}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 10, opacity: 0.75 }}>
        Totaal {sorted.length} unieke artikelen, zichtbaar in {treeGroups.length} stijlgroepen.
      </div>
    </section>
  );
}
