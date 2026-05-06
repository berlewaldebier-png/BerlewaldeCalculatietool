"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGetClient, apiRequestTextClient } from "@/lib/apiClient";

type Productgroep = { id: string; label: string; sort_order: number; active: boolean };
type AlcoholCategorie = { id: string; label: string; sort_order: number; active: boolean };
type Verpakkingstype = {
  id: string;
  label: string;
  sort_order: number;
  active: boolean;
  allowed_product_groups?: string[];
};

type TabKey = "productgroepen" | "alcoholcategorieen" | "verpakkingstypen";

const TAB_LABELS: Record<TabKey, string> = {
  productgroepen: "Productgroepen",
  alcoholcategorieen: "Alcoholcategorieën",
  verpakkingstypen: "Verpakkingstypen"
};

async function readDataset<T>(name: string): Promise<T[]> {
  const data = await apiGetClient<unknown>(`/data/${encodeURIComponent(name)}`);
  return Array.isArray(data) ? (data as T[]) : [];
}

async function writeDataset(name: string, data: unknown[]) {
  await apiRequestTextClient(`/data/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data)
  });
}

function normalizeId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");
}

function sortByOrder<T extends { sort_order?: number; label?: string; id?: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const ao = Number(a.sort_order ?? 0);
    const bo = Number(b.sort_order ?? 0);
    if (ao !== bo) return ao - bo;
    const al = String(a.label ?? "");
    const bl = String(b.label ?? "");
    if (al !== bl) return al.localeCompare(bl);
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
}

function PillTabs({ active, onChange }: { active: TabKey; onChange: (tab: TabKey) => void }) {
  return (
    <div className="editor-pill-tabs" role="tablist" aria-label="Tabs">
      {(Object.keys(TAB_LABELS) as TabKey[]).map((tab) => (
        <button
          key={tab}
          type="button"
          className={`editor-pill-tab ${tab === active ? "editor-pill-tab-active" : ""}`}
          onClick={() => onChange(tab)}
        >
          {TAB_LABELS[tab]}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="editor-empty">
      <div className="editor-empty-title">{title}</div>
      <div className="editor-empty-text">{text}</div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="editor-error">
      <div className="editor-error-title">Kon data niet laden</div>
      <div className="editor-error-text">{message}</div>
      <button type="button" className="editor-button" onClick={onRetry}>
        Opnieuw laden
      </button>
    </div>
  );
}

function SaveBar({
  dirty,
  busy,
  message,
  onSave,
  onReset
}: {
  dirty: boolean;
  busy: boolean;
  message: string;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="editor-savebar">
      <div className="editor-savebar-text">{message}</div>
      <div className="editor-savebar-actions">
        <button type="button" className="editor-button editor-button-secondary" onClick={onReset} disabled={busy}>
          Reset
        </button>
        <button type="button" className="editor-button" onClick={onSave} disabled={!dirty || busy}>
          Opslaan
        </button>
      </div>
    </div>
  );
}

function ProductgroepenTable({
  rows,
  onChange
}: {
  rows: Productgroep[];
  onChange: (next: Productgroep[]) => void;
}) {
  function patch(index: number, patchValue: Partial<Productgroep>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patchValue } : row)));
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  function add() {
    onChange([
      ...rows,
      { id: "nieuw", label: "Nieuw", sort_order: rows.length ? Math.max(...rows.map((r) => r.sort_order ?? 0)) + 10 : 10, active: true }
    ]);
  }

  return (
    <div className="editor-table-wrap">
      <table className="editor-table">
        <thead>
          <tr>
            <th style={{ width: 220 }}>ID</th>
            <th>Label</th>
            <th style={{ width: 120 }}>Volgorde</th>
            <th style={{ width: 110 }}>Actief</th>
            <th style={{ width: 80 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.id}-${index}`}>
              <td>
                <input
                  className="dataset-input"
                  value={row.id}
                  onChange={(e) => patch(index, { id: normalizeId(e.target.value) })}
                />
              </td>
              <td>
                <input className="dataset-input" value={row.label} onChange={(e) => patch(index, { label: e.target.value })} />
              </td>
              <td>
                <input
                  className="dataset-input"
                  type="number"
                  value={String(row.sort_order ?? 0)}
                  onChange={(e) => patch(index, { sort_order: Number(e.target.value) || 0 })}
                />
              </td>
              <td style={{ textAlign: "center" }}>
                <input type="checkbox" checked={!!row.active} onChange={(e) => patch(index, { active: e.target.checked })} />
              </td>
              <td style={{ textAlign: "right" }}>
                <button type="button" className="editor-icon-button" onClick={() => remove(index)} title="Verwijderen">
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <EmptyState title="Geen productgroepen" text="Voeg minimaal drank/giftset/merchandise/dienst toe." />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="editor-table-actions">
        <button type="button" className="editor-button editor-button-secondary" onClick={add}>
          + Productgroep toevoegen
        </button>
      </div>
    </div>
  );
}

function AlcoholTable({
  rows,
  onChange
}: {
  rows: AlcoholCategorie[];
  onChange: (next: AlcoholCategorie[]) => void;
}) {
  function patch(index: number, patchValue: Partial<AlcoholCategorie>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patchValue } : row)));
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  function add() {
    onChange([
      ...rows,
      { id: "nieuw", label: "Nieuw", sort_order: rows.length ? Math.max(...rows.map((r) => r.sort_order ?? 0)) + 10 : 10, active: true }
    ]);
  }

  return (
    <div className="editor-table-wrap">
      <table className="editor-table">
        <thead>
          <tr>
            <th style={{ width: 220 }}>ID</th>
            <th>Label</th>
            <th style={{ width: 120 }}>Volgorde</th>
            <th style={{ width: 110 }}>Actief</th>
            <th style={{ width: 80 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.id}-${index}`}>
              <td>
                <input className="dataset-input" value={row.id} onChange={(e) => patch(index, { id: normalizeId(e.target.value) })} />
              </td>
              <td>
                <input className="dataset-input" value={row.label} onChange={(e) => patch(index, { label: e.target.value })} />
              </td>
              <td>
                <input
                  className="dataset-input"
                  type="number"
                  value={String(row.sort_order ?? 0)}
                  onChange={(e) => patch(index, { sort_order: Number(e.target.value) || 0 })}
                />
              </td>
              <td style={{ textAlign: "center" }}>
                <input type="checkbox" checked={!!row.active} onChange={(e) => patch(index, { active: e.target.checked })} />
              </td>
              <td style={{ textAlign: "right" }}>
                <button type="button" className="editor-icon-button" onClick={() => remove(index)} title="Verwijderen">
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <EmptyState title="Geen alcoholcategorieën" text="Voeg minimaal normaal/alcoholarm/alcoholvrij toe." />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="editor-table-actions">
        <button type="button" className="editor-button editor-button-secondary" onClick={add}>
          + Alcoholcategorie toevoegen
        </button>
      </div>
    </div>
  );
}

function VerpakkingstypenTable({
  rows,
  onChange,
  productgroepen
}: {
  rows: Verpakkingstype[];
  onChange: (next: Verpakkingstype[]) => void;
  productgroepen: Productgroep[];
}) {
  const activeGroups = useMemo(
    () => sortByOrder(productgroepen.filter((g) => g.active)).map((g) => ({ id: g.id, label: g.label })),
    [productgroepen]
  );

  function patch(index: number, patchValue: Partial<Verpakkingstype>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patchValue } : row)));
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  function add() {
    onChange([
      ...rows,
      {
        id: "nieuw",
        label: "Nieuw",
        sort_order: rows.length ? Math.max(...rows.map((r) => r.sort_order ?? 0)) + 10 : 10,
        active: true,
        allowed_product_groups: activeGroups.map((g) => g.id)
      }
    ]);
  }

  function toggleGroup(index: number, groupId: string) {
    const current = rows[index]?.allowed_product_groups ?? [];
    const next = current.includes(groupId) ? current.filter((g) => g !== groupId) : [...current, groupId];
    patch(index, { allowed_product_groups: next });
  }

  return (
    <div className="editor-table-wrap">
      <table className="editor-table">
        <thead>
          <tr>
            <th style={{ width: 220 }}>ID</th>
            <th>Label</th>
            <th style={{ width: 120 }}>Volgorde</th>
            <th style={{ width: 110 }}>Actief</th>
            <th>Geldig voor</th>
            <th style={{ width: 80 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.id}-${index}`}>
              <td>
                <input className="dataset-input" value={row.id} onChange={(e) => patch(index, { id: normalizeId(e.target.value) })} />
              </td>
              <td>
                <input className="dataset-input" value={row.label} onChange={(e) => patch(index, { label: e.target.value })} />
              </td>
              <td>
                <input
                  className="dataset-input"
                  type="number"
                  value={String(row.sort_order ?? 0)}
                  onChange={(e) => patch(index, { sort_order: Number(e.target.value) || 0 })}
                />
              </td>
              <td style={{ textAlign: "center" }}>
                <input type="checkbox" checked={!!row.active} onChange={(e) => patch(index, { active: e.target.checked })} />
              </td>
              <td>
                <div className="editor-checkbox-row">
                  {activeGroups.map((group) => (
                    <label key={group.id} className="editor-checkbox">
                      <input
                        type="checkbox"
                        checked={(row.allowed_product_groups ?? []).includes(group.id)}
                        onChange={() => toggleGroup(index, group.id)}
                      />
                      <span>{group.label}</span>
                    </label>
                  ))}
                </div>
              </td>
              <td style={{ textAlign: "right" }}>
                <button type="button" className="editor-icon-button" onClick={() => remove(index)} title="Verwijderen">
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <EmptyState title="Geen verpakkingstypen" text="Voeg bijv. fles/doos/fust types toe." />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="editor-table-actions">
        <button type="button" className="editor-button editor-button-secondary" onClick={add}>
          + Verpakkingstype toevoegen
        </button>
      </div>
    </div>
  );
}

export function ProductClassificatieWorkspace() {
  const [activeTab, setActiveTab] = useState<TabKey>("productgroepen");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const [productgroepen, setProductgroepen] = useState<Productgroep[]>([]);
  const [alcoholcategorieen, setAlcoholcategorieen] = useState<AlcoholCategorie[]>([]);
  const [verpakkingstypen, setVerpakkingstypen] = useState<Verpakkingstype[]>([]);

  const [baseline, setBaseline] = useState<string>("");

  const currentRows = useMemo(() => {
    if (activeTab === "productgroepen") return productgroepen;
    if (activeTab === "alcoholcategorieen") return alcoholcategorieen;
    return verpakkingstypen;
  }, [activeTab, productgroepen, alcoholcategorieen, verpakkingstypen]);

  const dirty = useMemo(() => JSON.stringify({ productgroepen, alcoholcategorieen, verpakkingstypen }) !== baseline, [
    productgroepen,
    alcoholcategorieen,
    verpakkingstypen,
    baseline
  ]);

  async function load() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const [pg, ac, vt] = await Promise.all([
        readDataset<Productgroep>("productgroepen"),
        readDataset<AlcoholCategorie>("alcoholcategorieen"),
        readDataset<Verpakkingstype>("verpakkingstypen")
      ]);
      const nextState = {
        productgroepen: sortByOrder(pg),
        alcoholcategorieen: sortByOrder(ac),
        verpakkingstypen: sortByOrder(vt)
      };
      setProductgroepen(nextState.productgroepen);
      setAlcoholcategorieen(nextState.alcoholcategorieen);
      setVerpakkingstypen(nextState.verpakkingstypen);
      setBaseline(JSON.stringify(nextState));
      setMessage("Gereed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onbekende fout.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const state = {
        productgroepen: sortByOrder(productgroepen),
        alcoholcategorieen: sortByOrder(alcoholcategorieen),
        verpakkingstypen: sortByOrder(verpakkingstypen)
      };
      await Promise.all([
        writeDataset("productgroepen", state.productgroepen),
        writeDataset("alcoholcategorieen", state.alcoholcategorieen),
        writeDataset("verpakkingstypen", state.verpakkingstypen)
      ]);
      setProductgroepen(state.productgroepen);
      setAlcoholcategorieen(state.alcoholcategorieen);
      setVerpakkingstypen(state.verpakkingstypen);
      setBaseline(JSON.stringify(state));
      setMessage("Opgeslagen.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opslaan mislukt.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    try {
      const parsed = JSON.parse(baseline || "{}");
      setProductgroepen(Array.isArray(parsed.productgroepen) ? parsed.productgroepen : []);
      setAlcoholcategorieen(Array.isArray(parsed.alcoholcategorieen) ? parsed.alcoholcategorieen : []);
      setVerpakkingstypen(Array.isArray(parsed.verpakkingstypen) ? parsed.verpakkingstypen : []);
      setMessage("Teruggezet.");
    } catch {
      setMessage("");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="editor-loading">Laden…</div>;
  }

  if (error) {
    return <ErrorState message={error} onRetry={load} />;
  }

  return (
    <div className="editor-card">
      <div className="editor-card-header">
        <div>
          <div className="editor-card-title">Dropdowns</div>
          <div className="editor-card-subtitle">Deze lijsten worden gebruikt voor productgroep, alcoholcategorie en verpakkingstype.</div>
        </div>
        <PillTabs active={activeTab} onChange={setActiveTab} />
      </div>

      {activeTab === "productgroepen" ? (
        <ProductgroepenTable rows={productgroepen} onChange={(next) => setProductgroepen(sortByOrder(next))} />
      ) : null}
      {activeTab === "alcoholcategorieen" ? (
        <AlcoholTable rows={alcoholcategorieen} onChange={(next) => setAlcoholcategorieen(sortByOrder(next))} />
      ) : null}
      {activeTab === "verpakkingstypen" ? (
        <VerpakkingstypenTable
          rows={verpakkingstypen}
          onChange={(next) => setVerpakkingstypen(sortByOrder(next))}
          productgroepen={productgroepen}
        />
      ) : null}

      <SaveBar
        dirty={dirty}
        busy={busy}
        message={dirty ? "Niet opgeslagen wijzigingen." : message || "Gereed."}
        onSave={save}
        onReset={reset}
      />

      {currentRows.length === 0 ? null : (
        <div className="editor-help">
          Tip: houd ID’s stabiel (geen hernoemen) als je dashboard-rapportages hierop wilt blijven groeperen.
        </div>
      )}
    </div>
  );
}
