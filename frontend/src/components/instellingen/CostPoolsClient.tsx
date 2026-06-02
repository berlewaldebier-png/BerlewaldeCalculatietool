"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { reconcileDatasetItems } from "@/lib/datasetItems";

type PoolRow = {
  id: string;
  label: string;
  sort_order: number;
  active: boolean;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function slugify(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "new";
}

export function CostPoolsClient({ initial }: { initial: unknown[] }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [isSaving, setIsSaving] = useState(false);

  const seed = useMemo<PoolRow[]>(
    () =>
      (Array.isArray(initial) ? initial : [])
        .filter((row) => row && typeof row === "object")
        .map((row) => {
          const r = row as any;
          const label = String(r.label ?? "").trim();
          return {
            id: String(r.id ?? "").trim() || slugify(label),
            label,
            sort_order: Number(r.sort_order ?? 0) || 0,
            active: Boolean(r.active ?? true),
          } as PoolRow;
        })
        .filter((row) => row.id && row.label),
    [initial]
  );

  const [rows, setRows] = useState<PoolRow[]>(() => seed);

  function updateRow(index: number, patch: Partial<PoolRow>) {
    setRows((current) =>
      current.map((row, idx) => {
        if (idx !== index) return row;
        return { ...row, ...patch };
      })
    );
  }

  function addRow() {
    setRows((current) => [
      ...current,
      { id: "", label: "", sort_order: (current.length + 1) * 10, active: true },
    ]);
  }

  function deleteRow(index: number) {
    setRows((current) => current.filter((_, idx) => idx !== index));
  }

  async function handleSave() {
    setIsSaving(true);
    setStatus("");
    setTone("");
    try {
      const normalized: PoolRow[] = rows
        .map((row) => {
          const label = String(row.label ?? "").trim();
          const id = String(row.id ?? "").trim() || slugify(label);
          return {
            id,
            label,
            sort_order: Number(row.sort_order ?? 0) || 0,
            active: Boolean(row.active ?? true),
          };
        })
        .filter((row) => row.id && row.label);

      // Ensure unique ids.
      const seen = new Set<string>();
      for (const row of normalized) {
        if (seen.has(row.id)) {
          throw new Error(`Dubbele pool id: ${row.id}`);
        }
        seen.add(row.id);
      }

      await reconcileDatasetItems("cost-pools", normalized);
      setStatus("Opgeslagen.");
      setTone("success");
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Opslaan mislukt.");
      setTone("error");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="module-card" style={{ marginTop: 16 }}>
      <div className="module-card-header">
        <div className="module-card-title">Pools</div>
        <div className="module-card-text">
          Beheer de overhead-pools die je kunt selecteren in <strong>Vaste kosten (ABC)</strong>.
        </div>
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: 220 }}>Label</th>
              <th style={{ width: 160 }}>Id</th>
              <th style={{ width: 120 }}>Volgorde</th>
              <th style={{ width: 100 }}>Actief</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="dataset-empty" colSpan={5}>
                  Nog geen pools. Voeg een rij toe.
                </td>
              </tr>
            ) : null}
            {rows.map((row, idx) => (
              <tr key={`${row.id || "row"}-${idx}`}>
                <td>
                  <input
                    className="dataset-input"
                    type="text"
                    value={row.label}
                    onChange={(e) => updateRow(idx, { label: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="dataset-input"
                    type="text"
                    value={row.id}
                    placeholder={slugify(row.label)}
                    onChange={(e) => updateRow(idx, { id: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="dataset-input"
                    type="number"
                    step="1"
                    value={String(row.sort_order ?? 0)}
                    onChange={(e) => updateRow(idx, { sort_order: Number(e.target.value || 0) })}
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(row.active)}
                    onChange={(e) => updateRow(idx, { active: e.target.checked })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="icon-button-table"
                    aria-label="Verwijderen"
                    title="Verwijderen"
                    onClick={() => deleteRow(idx)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="editor-actions">
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={addRow}>
            Rij toevoegen
          </button>
        </div>
        <div className="editor-actions-group">
          {status ? <span className={`editor-status ${tone}`}>{status}</span> : null}
          <button type="button" className="editor-button" disabled={isSaving} onClick={handleSave}>
            {isSaving ? "Opslaan..." : "Opslaan"}
          </button>
        </div>
      </div>
    </section>
  );
}
