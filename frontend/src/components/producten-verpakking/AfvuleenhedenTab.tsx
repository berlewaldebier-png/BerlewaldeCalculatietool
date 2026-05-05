"use client";

import { AfvuleenhedenTable } from "@/components/producten-verpakking/AfvuleenhedenTable";

type GenericRecord = Record<string, unknown>;

export function AfvuleenhedenTab({
  formatArticles,
  activeYearForFormats,
  availablePriceYears,
  setFormatsYear,
  packagingPrices,
  canonicalBomLines,
  canonicalArticles,
}: {
  formatArticles: GenericRecord[];
  activeYearForFormats: number;
  availablePriceYears: number[];
  setFormatsYear: (next: number) => void;
  packagingPrices: GenericRecord[];
  canonicalBomLines: GenericRecord[];
  canonicalArticles: GenericRecord[];
}) {
  return (
    <div className="content-card">
      <div className="module-card-header">
        <div className="module-card-title">Afvuleenheden</div>
        <div className="module-card-text">
          Interne eenheden (formats) die je gebruikt in kostprijsbeheer en bij samenstellingen, zoals â€œFles 33clâ€ of
          â€œDoos 24Ã—33clâ€. Jaar {activeYearForFormats} volgt productie.
        </div>
      </div>

      {formatArticles.length === 0 ? (
        <div className="editor-status" style={{ marginTop: 12 }}>
          Nog geen afvuleenheden gevonden. Maak er Ã©Ã©n aan via â€œNieuw samenstellenâ€.
        </div>
      ) : (
        <>
          <div className="wizard-form-grid" style={{ marginTop: 12 }}>
            <label className="nested-field" style={{ maxWidth: 220 }}>
              <span>Jaar</span>
              <select
                className="dataset-input"
                value={String(activeYearForFormats)}
                onChange={(e) => setFormatsYear(Number(e.target.value))}
              >
                {availablePriceYears.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <AfvuleenhedenTable
            year={activeYearForFormats}
            formats={formatArticles}
            packagingComponentPrices={packagingPrices}
            bomLines={canonicalBomLines}
            articles={canonicalArticles}
          />
        </>
      )}
    </div>
  );
}

