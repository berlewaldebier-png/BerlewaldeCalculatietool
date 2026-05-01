"use client";

import { useMemo, useState } from "react";
import { formatMoneyEUR } from "@/lib/formatters";
import {
  calcAdviesprijsInclBtwRange,
  fromInclBtw,
  round2,
  toFiniteNumber,
  toInclBtw
} from "@/lib/pricingEngine";
import { VatDisplayToggle, type VatDisplayMode } from "@/components/ui/VatDisplayToggle";
import {
  buildSellInLookup,
  resolveSellInPriceEx,
} from "@/components/offerte-samenstellen/sellInResolver";

const API_BASE_URL = "/api";

type Channel = {
  code: string;
  naam: string;
  actief: boolean;
  volgorde: number;
  default_marge_pct: number;
};

type AdviesprijsRow = {
  id: string;
  jaar: number;
  channel_code: string;
  opslag_pct: number;
};

type ProductieMap = Record<string, any>;

type VerkoopprijzenRow = Record<string, unknown>;
type KostprijsversieRow = Record<string, unknown>;
type KostprijsActivationRow = Record<string, unknown>;
type BierRow = Record<string, unknown>;
type CatalogProductRow = Record<string, unknown>;
type PackagingComponentRow = Record<string, unknown>;
type PackagingComponentPriceVersionRow = Record<string, unknown>;

type ProductCostRow = {
  bierId: string;
  biernaam: string;
  btwPct: number;
  kostprijsversieId: string;
  productId: string;
  productType: "basis" | "samengesteld" | "catalog";
  verpakking: string;
  kostprijsEx: number;
};

function clampNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseBtwPct(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!match) return 0;
  const parsed = Number(String(match[1]).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return formatMoneyEUR(toFiniteNumber(value, 0));
}

export function AdviesprijzenWorkspace(props: {
  initialChannels: any[];
  initialAdviesprijzen: any[];
  initialProductie: ProductieMap;
  initialVerkoopprijzen: VerkoopprijzenRow[];
  initialBieren: BierRow[];
  initialKostprijsversies: KostprijsversieRow[];
  initialKostprijsproductactiveringen: KostprijsActivationRow[];
  initialCatalogusproducten: CatalogProductRow[];
  initialPackagingComponents: PackagingComponentRow[];
  initialPackagingComponentPriceVersions: PackagingComponentPriceVersionRow[];
}) {
  const [vatDisplay, setVatDisplay] = useState<VatDisplayMode>("excl");
  const channels = useMemo<Channel[]>(() => {
    return (Array.isArray(props.initialChannels) ? props.initialChannels : [])
      .filter((row) => row && typeof row === "object")
      .map((row: any) => ({
        code: String(row.code ?? row.id ?? "").toLowerCase(),
        naam: String(row.naam ?? row.label ?? row.code ?? ""),
        actief: Boolean(row.actief ?? true),
        volgorde: Number(row.volgorde ?? 0),
        default_marge_pct: Number(row.default_marge_pct ?? row.default_marge ?? 0) || 0
      }))
      .filter((row) => row.code)
      .sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0));
  }, [props.initialChannels]);

  const [rows, setRows] = useState<AdviesprijsRow[]>(() => {
    return (Array.isArray(props.initialAdviesprijzen) ? props.initialAdviesprijzen : [])
      .filter((row) => row && typeof row === "object")
      .map((row: any) => ({
        id: String(row.id ?? ""),
        jaar: Number(row.jaar ?? 0),
        channel_code: String(row.channel_code ?? row.code ?? "").toLowerCase(),
        opslag_pct: Number(row.opslag_pct ?? row.opslag ?? 0)
      }))
      .filter((row) => row.jaar > 0 && row.channel_code);
  });

  const productionYears = useMemo(() => {
    const years = Object.keys(props.initialProductie ?? {})
      .filter((key) => /^\d+$/.test(key))
      .map((key) => Number(key))
      .filter((y) => y > 0)
      .sort((a, b) => a - b);
    return years;
  }, [props.initialProductie]);

  const years = useMemo(() => {
    const yearSet = new Set<number>(productionYears);
    rows.forEach((row) => yearSet.add(Number(row.jaar ?? 0)));
    return Array.from(yearSet).filter((y) => y > 0).sort((a, b) => a - b);
  }, [productionYears, rows]);

  const [selectedYear, setSelectedYear] = useState<number>(() => years[years.length - 1] ?? new Date().getFullYear());
  const [status, setStatus] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  const activeChannels = useMemo(() => channels.filter((c) => c.actief), [channels]);
  const channelCodes = useMemo(() => activeChannels.map((c) => c.code), [activeChannels]);
  const [openChannelCodes, setOpenChannelCodes] = useState<string[]>(() => activeChannels.map((c) => c.code));

  const adviesOpslagByChannel = useMemo(() => {
    const map = new Map<string, number>();
    rows
      .filter((row) => Number(row.jaar ?? 0) === selectedYear)
      .forEach((row) => map.set(row.channel_code, Number(row.opslag_pct ?? 0) || 0));
    return map;
  }, [rows, selectedYear]);

  const verkoopprijzenRows = useMemo(() => (Array.isArray(props.initialVerkoopprijzen) ? props.initialVerkoopprijzen : []), [props.initialVerkoopprijzen]);
  const kostprijsversies = useMemo(() => (Array.isArray(props.initialKostprijsversies) ? props.initialKostprijsversies : []), [props.initialKostprijsversies]);
  const activations = useMemo(() => (Array.isArray(props.initialKostprijsproductactiveringen) ? props.initialKostprijsproductactiveringen : []), [props.initialKostprijsproductactiveringen]);
  const bieren = useMemo(() => (Array.isArray(props.initialBieren) ? props.initialBieren : []), [props.initialBieren]);
  const catalogusproducten = useMemo(
    () => (Array.isArray(props.initialCatalogusproducten) ? props.initialCatalogusproducten : []),
    [props.initialCatalogusproducten]
  );
  const packagingComponents = useMemo(
    () => (Array.isArray(props.initialPackagingComponents) ? props.initialPackagingComponents : []),
    [props.initialPackagingComponents]
  );
  const packagingComponentPriceVersions = useMemo(
    () =>
      (Array.isArray(props.initialPackagingComponentPriceVersions)
        ? props.initialPackagingComponentPriceVersions
        : []),
    [props.initialPackagingComponentPriceVersions]
  );

  const beerById = useMemo(() => {
    const map = new Map<string, { biernaam: string; btwPct: number }>();
    bieren.forEach((row) => {
      if (!row || typeof row !== "object") return;
      const id = String((row as any).id ?? "");
      if (!id) return;
      const biernaam = String((row as any).biernaam ?? (row as any).naam ?? "");
      const btwPct = parseBtwPct((row as any).btw_tarief ?? (row as any).btw ?? "");
      map.set(id, { biernaam, btwPct });
    });
    return map;
  }, [bieren]);

  const packagingComponentNameById = useMemo(() => {
    const map = new Map<string, string>();
    packagingComponents.forEach((row) => {
      if (!row || typeof row !== "object") return;
      const id = String((row as any).id ?? "");
      if (!id) return;
      map.set(id, String((row as any).omschrijving ?? (row as any).name ?? id));
    });
    return map;
  }, [packagingComponents]);

  const activePackagingComponentPriceById = useMemo(() => {
    const map = new Map<string, number>();
    packagingComponentPriceVersions.forEach((row) => {
      if (!row || typeof row !== "object") return;
      const jaar = Number((row as any).jaar ?? 0);
      if (jaar !== selectedYear) return;
      const id = String((row as any).verpakkingsonderdeel_id ?? (row as any).packaging_component_id ?? "");
      if (!id) return;
      const isActief = Boolean((row as any).is_actief ?? (row as any).is_active ?? false);
      if (!isActief) return;
      map.set(id, Number((row as any).prijs_per_stuk ?? 0) || 0);
    });
    return map;
  }, [packagingComponentPriceVersions, selectedYear]);

  const kostprijsversieById = useMemo(() => {
    const map = new Map<string, KostprijsversieRow>();
    kostprijsversies.forEach((row) => {
      const id = String((row as any).id ?? "");
      if (!id) return;
      map.set(id, row);
    });
    return map;
  }, [kostprijsversies]);

  const activeActivationsForYear = useMemo(() => {
    return activations.filter((row) => {
      if (!row || typeof row !== "object") return false;
      const y = Number((row as any).jaar ?? 0);
      if (y !== selectedYear) return false;
      const tot = String((row as any).effectief_tot ?? "");
      return !tot;
    });
  }, [activations, selectedYear]);

  function scoreActivation(act: any) {
    const tsRaw = String(act?.effectief_vanaf ?? "") || String(act?.updated_at ?? "") || String(act?.created_at ?? "");
    if (!tsRaw) return 0;
    const dt = new Date(tsRaw);
    const t = dt.getTime();
    return Number.isNaN(t) ? 0 : t;
  }

  function findProductRowInSnapshot(version: KostprijsversieRow, productType: "basis" | "samengesteld", productId: string) {
    const products = ((version as any).resultaat_snapshot ?? (version as any).resultaatSnapshot ?? {}).producten ?? {};
    const list =
      productType === "basis"
        ? Array.isArray(products.basisproducten)
          ? products.basisproducten
          : []
        : Array.isArray(products.samengestelde_producten)
          ? products.samengestelde_producten
          : [];
    return (list as any[]).find((r) => String(r?.product_id ?? "") === productId) ?? null;
  }

  const productCostRows = useMemo<ProductCostRow[]>(() => {
    const bestActivationByScope = new Map<
      string,
      { bierId: string; productId: string; productType: "basis" | "samengesteld"; kostprijsversieId: string; score: number }
    >();

    for (const act of activeActivationsForYear) {
      if (!act || typeof act !== "object") continue;
      const bierId = String((act as any).bier_id ?? "");
      const productId = String((act as any).product_id ?? "");
      const rawType = String((act as any).product_type ?? "").toLowerCase();
      const productType = rawType === "basis" ? ("basis" as const) : rawType === "samengesteld" ? ("samengesteld" as const) : null;
      const kostprijsversieId = String((act as any).kostprijsversie_id ?? "");
      if (!bierId || !productId || !productType || !kostprijsversieId) continue;

      const score = scoreActivation(act as any);
      const key = `${bierId}:${productType}:${productId}`;
      const existing = bestActivationByScope.get(key);
      if (!existing || score >= existing.score) {
        bestActivationByScope.set(key, { bierId, productId, productType, kostprijsversieId, score });
      }
    }

    const out: ProductCostRow[] = [];
    for (const picked of bestActivationByScope.values()) {
      const version = kostprijsversieById.get(picked.kostprijsversieId);
      if (!version) continue;

      const bierSnapshot = beerById.get(picked.bierId);
      const biernaam = bierSnapshot?.biernaam || picked.bierId;
      const btwPct = parseBtwPct(((version as any).basisgegevens ?? {}).btw_tarief ?? bierSnapshot?.btwPct ?? "");

      const row = findProductRowInSnapshot(version, picked.productType, picked.productId);
      const verpakking = String((row as any)?.verpakking ?? (row as any)?.verpakkingseenheid ?? picked.productId);
      const kostprijsEx = Number((row as any)?.kostprijs ?? 0) || 0;

      out.push({
        bierId: picked.bierId,
        biernaam,
        btwPct,
        kostprijsversieId: picked.kostprijsversieId,
        productId: picked.productId,
        productType: picked.productType,
        verpakking,
        kostprijsEx
      });
    }

    const costByBeerProductKey = new Map<string, { cost: number; btwPct: number }>();
    out.forEach((row) => {
      if (!row.bierId) return;
      costByBeerProductKey.set(`${row.bierId}:${row.productType}:${row.productId}`, {
        cost: row.kostprijsEx,
        btwPct: row.btwPct,
      });
    });

    catalogusproducten.forEach((cp) => {
      if (!cp || typeof cp !== "object") return;
      const id = String((cp as any).id ?? "");
      const naam = String((cp as any).naam ?? (cp as any).name ?? "");
      if (!id || !naam) return;
      const bom = Array.isArray((cp as any).bom_lines) ? ((cp as any).bom_lines as any[]) : [];

      let costEx = 0;
      let btwPct = parseBtwPct((cp as any).btw_tarief ?? (cp as any).btw ?? "21%");
      for (const line of bom) {
        if (!line || typeof line !== "object") continue;
        const kind = String((line as any).line_kind ?? "").toLowerCase();
        const qty = Number((line as any).quantity ?? 0) || 0;
        if (qty <= 0) continue;
        if (kind === "beer" || kind === "beer_product") {
          const bierId = String((line as any).bier_id ?? "");
          const productId = String((line as any).product_id ?? "");
          const productType = String((line as any).product_type ?? "basis").toLowerCase();
          const key = `${bierId}:${productType}:${productId}`;
          const found = costByBeerProductKey.get(key);
          if (found) {
            costEx += qty * found.cost;
            if (!btwPct) btwPct = found.btwPct;
          }
          continue;
        }
        if (kind === "packaging_component") {
          const componentId = String((line as any).packaging_component_id ?? "");
          if (!componentId) continue;
          const price = activePackagingComponentPriceById.get(componentId) ?? 0;
          costEx += qty * price;
          continue;
        }
        if (kind === "labor" || kind === "other") {
          const unitCost = Number((line as any).unit_cost_ex ?? (line as any).kostprijs_ex ?? 0) || 0;
          costEx += qty * unitCost;
        }
      }

      out.push({
        bierId: "",
        biernaam: naam,
        btwPct,
        kostprijsversieId: "",
        productId: id,
        productType: "catalog",
        verpakking: naam,
        kostprijsEx: costEx,
      });
    });

    // Stable ordering: beer -> productType -> verpakking
    return out.sort((a, b) => {
      const bn = a.biernaam.localeCompare(b.biernaam);
      if (bn !== 0) return bn;
      const pt = a.productType.localeCompare(b.productType);
      if (pt !== 0) return pt;
      return a.verpakking.localeCompare(b.verpakking);
    });
  }, [activeActivationsForYear, beerById, kostprijsversieById, catalogusproducten, activePackagingComponentPriceById]);

  const sellInLookup = useMemo(
    () => buildSellInLookup(verkoopprijzenRows, selectedYear),
    [verkoopprijzenRows, selectedYear]
  );

  const channelDefaultOpslag = useMemo(() => {
    const map = new Map<string, number>();
    activeChannels.forEach((c) => map.set(c.code, Number((c as any).default_marge_pct ?? 0) || 0));
    return map;
  }, [activeChannels]);

  function getSellInPriceEx(row: ProductCostRow, channelCode: string) {
    return resolveSellInPriceEx({
      bierId: row.bierId,
      productId: row.productId,
      costPriceEx: row.kostprijsEx,
      channelCode,
      lookup: sellInLookup,
      channelDefaultOpslag,
    });
  }

  const yearRows = useMemo(() => {
    const byCode = new Map<string, AdviesprijsRow>();
    rows
      .filter((row) => Number(row.jaar ?? 0) === selectedYear)
      .forEach((row) => byCode.set(row.channel_code, row));
    return activeChannels.map((channel) => {
      const existing = byCode.get(channel.code);
      return {
        channel,
        row: existing ?? { id: "", jaar: selectedYear, channel_code: channel.code, opslag_pct: 0 }
      };
    });
  }, [rows, selectedYear, activeChannels]);

  async function save() {
    setIsSaving(true);
    setStatus("");
    try {
      const kept = rows.filter((row) => Number(row.jaar ?? 0) !== selectedYear);
      const next = [
        ...kept,
        ...yearRows.map(({ row }) => ({
          id: row.id,
          jaar: selectedYear,
          channel_code: row.channel_code,
          opslag_pct: clampNumber(row.opslag_pct, 0)
        }))
      ];

      const response = await fetch(`${API_BASE_URL}/data/adviesprijzen`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Opslaan mislukt.");
      }
      setRows(next);
      setStatus("Opgeslagen.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  if (years.length === 0) {
    return (
      <div className="module-card">
        <div className="module-card-title">Adviesprijzen</div>
        <div className="module-card-text">Nog geen productiejaar gevonden. Maak eerst een productiejaar aan.</div>
      </div>
    );
  }

  return (
    <section>
      {status ? (
        <div className="editor-status" style={{ marginBottom: 14 }}>
          {status}
        </div>
      ) : null}

      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="module-card-title">Adviesopslag per kanaal</div>
            <div className="module-card-text">Deze opslag gebruiken we om adviesprijzen (sell-out) af te leiden.</div>
          </div>
          <label className="nested-field" style={{ minWidth: 160 }}>
            <span>Jaar</span>
            <select
              className="dataset-input"
              value={String(selectedYear)}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              disabled={isSaving}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="editor-actions" style={{ marginBottom: 14 }}>
        <div className="editor-actions-group">
          <VatDisplayToggle value={vatDisplay} onChange={setVatDisplay} disabled={isSaving} />
        </div>
        <div className="editor-actions-group" />
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "260px" }}>Kanaal</th>
              <th style={{ width: "220px" }}>Opslag (%)</th>
            </tr>
          </thead>
          <tbody>
            {yearRows.map(({ channel, row }) => (
              <tr key={channel.code}>
                <td>
                  <strong>{channel.naam}</strong>
                  <div className="muted">{channel.code}</div>
                </td>
                <td>
                  <input
                    className="dataset-input"
                    type="number"
                    value={String(row.opslag_pct ?? 0)}
                    onChange={(event) => {
                      const nextValue = Number(event.target.value);
                      setRows((current) => {
                        const other = current.filter(
                          (item) => !(Number(item.jaar ?? 0) === selectedYear && item.channel_code === channel.code)
                        );
                        return [
                          ...other,
                          {
                            id: row.id,
                            jaar: selectedYear,
                            channel_code: channel.code,
                            opslag_pct: Number.isFinite(nextValue) ? nextValue : 0
                          }
                        ];
                      });
                    }}
                    disabled={isSaving}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="editor-actions" style={{ marginTop: "0.85rem" }}>
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => setOpenChannelCodes(channelCodes)}
            disabled={isSaving}
          >
            Alles uitklappen
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => setOpenChannelCodes([])}
            disabled={isSaving}
          >
            Alles inklappen
          </button>
        </div>
        <div className="editor-actions-group" />
      </div>

      <div style={{ marginTop: "1rem" }}>
        {activeChannels.map((channel) => {
          const code = channel.code;
          const open = openChannelCodes.includes(code);
          const adviesOpslag = adviesOpslagByChannel.get(code) ?? 0;
          return (
            <details
              key={code}
              open={open}
              className="module-card compact-card"
              style={{ marginBottom: "0.9rem" }}
              onToggle={(event) => {
                const nextOpen = (event.currentTarget as HTMLDetailsElement).open;
                setOpenChannelCodes((current) => {
                  const exists = current.includes(code);
                  if (nextOpen && !exists) return [...current, code];
                  if (!nextOpen && exists) return current.filter((c) => c !== code);
                  return current;
                });
              }}
            >
              <summary className="module-card-title" style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>{channel.naam}</span>
                <span className="muted">Opslag: {round2(adviesOpslag).toLocaleString("nl-NL")}%</span>
              </summary>
              <div className="module-card-text" style={{ marginTop: "0.4rem" }}>
                Read-only overzicht: berekeningen blijven op excl. BTW; de weergave kan wisselen.
              </div>

              <div className="data-table" style={{ marginTop: "0.8rem" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "220px" }}>Bier</th>
                      <th style={{ width: "200px" }}>Product</th>
                      <th style={{ width: "160px" }}>Kostprijs ({vatDisplay === "incl" ? "incl" : "ex"})</th>
                      <th style={{ width: "160px" }}>Verkoopprijs ({vatDisplay === "incl" ? "incl" : "ex"})</th>
                      <th style={{ width: "240px" }}>Adviesprijs ({vatDisplay === "incl" ? "incl" : "ex"})</th>
                      <th style={{ width: "140px" }}>Opslag</th>
                      <th style={{ width: "140px" }}>Marge klant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productCostRows.map((row) => {
                      const { sellInEx } = getSellInPriceEx(row, code);
                      const btwPct = Number.isFinite(row.btwPct) ? row.btwPct : 0;
                      const { min: adviesMinIncl, max: adviesMaxIncl, margeKlantPct } = calcAdviesprijsInclBtwRange({
                        kostprijsEx: row.kostprijsEx,
                        sellInEx,
                        adviesOpslagPct: adviesOpslag,
                        btwPct
                      });

                      const kostprijsShown =
                        vatDisplay === "incl" ? toInclBtw(row.kostprijsEx, btwPct) : row.kostprijsEx;
                      const sellInShown = vatDisplay === "incl" ? toInclBtw(sellInEx, btwPct) : sellInEx;
                      const adviesMinShown = vatDisplay === "incl" ? adviesMinIncl : fromInclBtw(adviesMinIncl, btwPct);
                      const adviesMaxShown = vatDisplay === "incl" ? adviesMaxIncl : fromInclBtw(adviesMaxIncl, btwPct);
                      return (
                        <tr key={`${code}:${row.bierId}:${row.productType}:${row.productId}:${row.verpakking}`}>
                          <td>
                            <strong>{row.biernaam}</strong>
                            <div className="muted">{row.productType}</div>
                          </td>
                          <td>{row.verpakking}</td>
                          <td>{money(kostprijsShown)}</td>
                          <td>{money(sellInShown)}</td>
                          <td>
                            {money(adviesMinShown)} - {money(adviesMaxShown)}
                            <div className="muted">BTW {round2(btwPct)}% (afronding 5 cent incl, naar beneden)</div>
                          </td>
                          <td>{round2(adviesOpslag).toLocaleString("nl-NL")}%</td>
                          <td>{round2(margeKlantPct).toLocaleString("nl-NL")}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group" />
        <div className="editor-actions-group">
          <button type="button" className="editor-button" onClick={() => void save()} disabled={isSaving}>
            Opslaan
          </button>
        </div>
      </div>
    </section>
  );
}

