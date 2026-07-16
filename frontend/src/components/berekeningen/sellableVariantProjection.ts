type GenericRecord = Record<string, unknown>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function selectExplicitBeerVariantSkus({
  beerId,
  skus,
  bomLines,
}: {
  beerId: string;
  skus: GenericRecord[];
  bomLines: GenericRecord[];
}): GenericRecord[] {
  const selectedBeerId = text(beerId);
  if (!selectedBeerId) return [];

  const sourceSkus = Array.isArray(skus) ? skus : [];
  const sourceBomLines = Array.isArray(bomLines) ? bomLines : [];
  const skuById = new Map(
    sourceSkus
      .map((row) => [text(row.id), row] as const)
      .filter(([id]) => Boolean(id))
  );

  return sourceSkus.filter((sku) => {
    if (text(sku.kind).toLowerCase() !== "article") return false;
    if (text(sku.beer_id) !== selectedBeerId) return false;

    const articleId = text(sku.article_id);
    if (!articleId) return false;
    return sourceBomLines.some((line) => {
      if (text(line.parent_article_id) !== articleId) return false;
      const componentSku = skuById.get(text(line.component_sku_id));
      return (
        text(componentSku?.kind).toLowerCase() === "beer_format" &&
        text(componentSku?.beer_id) === selectedBeerId
      );
    });
  });
}
