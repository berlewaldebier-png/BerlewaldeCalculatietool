"use client";

import Link from "next/link";
import { useMemo } from "react";

import { toNumber, type GenericRecord } from "@/components/producten-verpakking/productenVerpakkingUtils";

export function AfvuleenhedenTable({
  year,
  formats,
  packagingComponentPrices,
  bomLines,
  articles,
}: {
  year: number;
  formats: GenericRecord[];
  packagingComponentPrices: GenericRecord[];
  bomLines: GenericRecord[];
  articles: GenericRecord[];
}) {
  const priceByComponentId = useMemo(() => {
    const map = new Map<string, number>();
    packagingComponentPrices.forEach((row) => {
      const rowYear = toNumber((row as any)?.jaar, 0);
      if (rowYear !== year) return;
      const componentId = String((row as any)?.verpakkingsonderdeel_id ?? "").trim();
      if (!componentId) return;
      map.set(componentId, toNumber((row as any)?.prijs_per_stuk, 0));
    });
    return map;
  }, [packagingComponentPrices, year]);

  const articleById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    articles.forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (id) map.set(id, row);
    });
    return map;
  }, [articles]);

  const bomByParent = useMemo(() => {
    const map = new Map<string, GenericRecord[]>();
    bomLines.forEach((row) => {
      const parent = String((row as any)?.parent_article_id ?? "").trim();
      if (!parent) return;
      const next = map.get(parent) ?? [];
      next.push(row);
      map.set(parent, next);
    });
    return map;
  }, [bomLines]);

  const totalsByFormatId = useMemo(() => {
    const memo = new Map<string, { packagingCost: number }>();
    const visiting = new Set<string>();

    const compute = (formatId: string): { packagingCost: number } => {
      if (memo.has(formatId)) return memo.get(formatId)!;
      if (visiting.has(formatId)) {
        // Cycle protection: treat as zero to avoid infinite recursion; cycles should be prevented on write.
        return { packagingCost: 0 };
      }
      visiting.add(formatId);

      const lines = bomByParent.get(formatId) ?? [];
      let packagingCost = 0;
      lines.forEach((line) => {
        const componentArticleId = String((line as any)?.component_article_id ?? "").trim();
        if (!componentArticleId) return;
        const qty = Math.max(0, toNumber((line as any)?.quantity, 0));
        if (qty === 0) return;

        const component = articleById.get(componentArticleId);
        const kind = String((component as any)?.kind ?? "").toLowerCase();
        if (kind === "packaging_component") {
          packagingCost += qty * (priceByComponentId.get(componentArticleId) ?? 0);
          return;
        }
        if (kind === "format") {
          const nested = compute(componentArticleId);
          packagingCost += qty * nested.packagingCost;
        }
      });

      const result = { packagingCost };
      memo.set(formatId, result);
      visiting.delete(formatId);
      return result;
    };

    formats.forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (!id) return;
      compute(id);
    });
    return memo;
  }, [articleById, bomByParent, formats, priceByComponentId]);

  return (
    <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
      <table className="dataset-editor-table wizard-table-compact wizard-table-fit">
        <thead>
          <tr>
            <th>Naam</th>
            <th style={{ width: 120 }}>UoM</th>
            <th style={{ width: 160 }}>Inhoud (L)</th>
            <th style={{ width: 180 }}>Kostprijs (ex)</th>
            <th style={{ width: 120 }}>Regels</th>
            <th style={{ width: 120 }} />
          </tr>
        </thead>
        <tbody>
          {formats.map((row) => {
            const id = String((row as any)?.id ?? "").trim();
            const name = String((row as any)?.name ?? "").trim() || id;
            const uom = String((row as any)?.uom ?? "").trim() || "stuk";
            const liters = toNumber((row as any)?.content_liter, 0);
            const linesCount = (bomByParent.get(id) ?? []).length;
            const cost = totalsByFormatId.get(id)?.packagingCost ?? 0;
            return (
              <tr key={id}>
                <td>{name}</td>
                <td>{uom}</td>
                <td>{liters.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td>{cost.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}</td>
                <td>{linesCount}</td>
                <td style={{ textAlign: "right" }}>
                  <Link
                    href={`/product-samenstellen?mode=afvuleenheid&format_id=${encodeURIComponent(id)}`}
                    className="secondary-button"
                  >
                    Bewerken
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

