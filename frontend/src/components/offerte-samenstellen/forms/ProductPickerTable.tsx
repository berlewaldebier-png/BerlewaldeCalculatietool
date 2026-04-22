import { useMemo, useState } from "react";

import { EmptyHint } from "@/components/offerte-samenstellen/forms/FormControls";
import { euro } from "@/components/offerte-samenstellen/quoteUtils";
import type { ProductOption } from "@/components/offerte-samenstellen/types";

type Props = {
  products: ProductOption[];
  selectedRefs: string[];
  onChange: (nextRefs: string[]) => void;
  strictCompatibility?: boolean;
  emptyHint?: string;
};

function buildStyleOptions(products: ProductOption[], selectedRefs: string[]) {
  const selectedSet = new Set(selectedRefs);
  const byStyle = new Map<
    string,
    { bierId: string; bierName: string; available: number }
  >();

  products.forEach((product) => {
    const current = byStyle.get(product.bierId) ?? {
      bierId: product.bierId,
      bierName: product.bierName,
      available: 0,
    };
    if (!selectedSet.has(product.optionId)) {
      current.available += 1;
    }
    byStyle.set(product.bierId, current);
  });

  return Array.from(byStyle.values())
    .filter((entry) => entry.available > 0)
    .sort((left, right) => left.bierName.localeCompare(right.bierName));
}

function getProductsForStyle(products: ProductOption[], bierId: string) {
  return products
    .filter((product) => product.bierId === bierId)
    .sort((left, right) => left.packLabel.localeCompare(right.packLabel));
}

function getPackagingOptionsForStyle(params: {
  products: ProductOption[];
  bierId: string;
  selectedRefs: string[];
  currentRef?: string;
  compatibilityKey?: string | null;
}) {
  return getProductsForStyle(params.products, params.bierId).filter((product) => {
    if (params.currentRef && product.optionId === params.currentRef) {
      return true;
    }
    if (params.selectedRefs.includes(product.optionId)) {
      return false;
    }
    if (
      params.compatibilityKey &&
      product.staffelCompatibilityKey !== params.compatibilityKey
    ) {
      return false;
    }
    return true;
  });
}

function replaceFirstSelectedProduct(
  products: ProductOption[],
  selectedRefs: string[],
  nextOptionId: string
) {
  const nextProduct = products.find((product) => product.optionId === nextOptionId);
  if (!nextProduct) {
    return selectedRefs;
  }

  const nextRefs = [nextOptionId];

  selectedRefs.slice(1).forEach((ref) => {
    const currentProduct = products.find((product) => product.optionId === ref);
    if (!currentProduct) {
      return;
    }

    const replacement = products.find(
      (product) =>
        product.bierId === currentProduct.bierId &&
        product.staffelCompatibilityKey === nextProduct.staffelCompatibilityKey
    );

    if (replacement && !nextRefs.includes(replacement.optionId)) {
      nextRefs.push(replacement.optionId);
    }
  });

  return nextRefs;
}

export function ProductPickerTable({
  products,
  selectedRefs,
  onChange,
  strictCompatibility = false,
  emptyHint = "Voeg eerst een bierstijl en verpakking toe.",
}: Props) {
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [pendingStyleId, setPendingStyleId] = useState("");
  const [pendingPackagingId, setPendingPackagingId] = useState("");

  const selectedProducts = useMemo(
    () => products.filter((product) => selectedRefs.includes(product.optionId)),
    [products, selectedRefs]
  );
  const firstSelectedProduct = selectedProducts[0] ?? null;

  const strictProducts = useMemo(() => {
    if (!strictCompatibility || !firstSelectedProduct) {
      return products;
    }
    return products.filter(
      (product) =>
        product.staffelCompatibilityKey === firstSelectedProduct.staffelCompatibilityKey ||
        selectedRefs.includes(product.optionId)
    );
  }, [firstSelectedProduct, products, selectedRefs, strictCompatibility]);

  const styleOptions = useMemo(
    () => buildStyleOptions(strictProducts, selectedRefs),
    [selectedRefs, strictProducts]
  );

  const pendingPackagingOptions = useMemo(() => {
    if (!pendingStyleId) return [];
    return getPackagingOptionsForStyle({
      products: strictCompatibility ? strictProducts : products,
      bierId: pendingStyleId,
      selectedRefs,
      compatibilityKey:
        strictCompatibility && firstSelectedProduct
          ? firstSelectedProduct.staffelCompatibilityKey
          : null,
    });
  }, [
    firstSelectedProduct,
    pendingStyleId,
    products,
    selectedRefs,
    strictCompatibility,
    strictProducts,
  ]);

  const resolvedPendingPackagingId =
    pendingPackagingOptions.length === 1
      ? pendingPackagingOptions[0]?.optionId ?? ""
      : pendingPackagingId;

  function closeAddRow() {
    setPendingStyleId("");
    setPendingPackagingId("");
    setIsAddingProduct(false);
  }

  function handleAddProduct() {
    if (!resolvedPendingPackagingId) return;
    onChange([...selectedRefs, resolvedPendingPackagingId]);
    closeAddRow();
  }

  return (
    <div className="cpq-product-picker">
      {selectedProducts.length > 0 ? (
        <div className="cpq-product-picker-header">
          <span>
            {selectedProducts.length} product
            {selectedProducts.length === 1 ? "" : "en"} geselecteerd
          </span>
        </div>
      ) : null}

      {selectedProducts.length > 0 ? (
        <div className="cpq-product-picker-list">
          {selectedProducts.map((product, index) => {
            const packagingOptions = getPackagingOptionsForStyle({
              products:
                strictCompatibility && index > 0 ? strictProducts : products,
              bierId: product.bierId,
              selectedRefs,
              currentRef: product.optionId,
              compatibilityKey:
                strictCompatibility && index > 0 && firstSelectedProduct
                  ? firstSelectedProduct.staffelCompatibilityKey
                  : null,
            });

            return (
              <div key={product.optionId} className="cpq-product-picker-row">
                <div className="cpq-product-picker-cell cpq-product-picker-cell-style">
                  <div className="cpq-product-picker-heading">Bierstijl</div>
                  <div className="cpq-product-picker-value">{product.bierName}</div>
                </div>
                <div className="cpq-product-picker-cell cpq-product-picker-cell-pack">
                  <div className="cpq-product-picker-heading">Verpakking</div>
                  <select
                    className="cpq-select"
                    value={product.optionId}
                    onChange={(event) => {
                      const nextOptionId = event.target.value;
                      const nextRefs =
                        strictCompatibility && index === 0
                          ? replaceFirstSelectedProduct(products, selectedRefs, nextOptionId)
                          : selectedRefs.map((ref) =>
                              ref === product.optionId ? nextOptionId : ref
                            );
                      onChange(nextRefs);
                    }}
                  >
                    {packagingOptions.map((option) => (
                      <option key={option.optionId} value={option.optionId}>
                        {option.packLabel}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="cpq-product-picker-cell">
                  <div className="cpq-product-picker-heading">Verkoopprijs</div>
                  <div className="cpq-product-picker-value">
                    {euro(product.standardPriceEx)}
                  </div>
                </div>
                <div className="cpq-product-picker-cell">
                  <div className="cpq-product-picker-heading">Kostprijs</div>
                  <div className="cpq-product-picker-value">{euro(product.costPriceEx)}</div>
                </div>
                <div className="cpq-product-picker-actions">
                  <button
                    type="button"
                    className="cpq-staffel-delete-button"
                    aria-label={`Verwijder ${product.label}`}
                    title="Product verwijderen"
                    onClick={() => onChange(selectedRefs.filter((ref) => ref !== product.optionId))}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyHint text={emptyHint} />
      )}

      {isAddingProduct ? (
        <div className="cpq-product-picker-add-row">
          <label className="cpq-field">
            <div className="cpq-label">Stap 1: bierstijl</div>
            <select
              className="cpq-select"
              value={pendingStyleId}
              onChange={(event) => {
                setPendingStyleId(event.target.value);
                setPendingPackagingId("");
              }}
            >
              <option value="">Kies stijl...</option>
              {styleOptions.map((option) => (
                <option key={option.bierId} value={option.bierId}>
                  {option.bierName}
                </option>
              ))}
            </select>
          </label>

          <label className="cpq-field">
            <div className="cpq-label">Stap 2: verpakking</div>
            <select
              className="cpq-select"
              value={resolvedPendingPackagingId}
              onChange={(event) => setPendingPackagingId(event.target.value)}
              disabled={!pendingStyleId || pendingPackagingOptions.length <= 1}
            >
              {!resolvedPendingPackagingId ? (
                <option value="">
                  {pendingStyleId ? "Kies verpakking..." : "Kies eerst een stijl"}
                </option>
              ) : null}
              {pendingPackagingOptions.map((option) => (
                <option key={option.optionId} value={option.optionId}>
                  {option.packLabel}
                </option>
              ))}
            </select>
          </label>

          <div className="cpq-product-picker-add-actions">
            <button
              type="button"
              className="cpq-button cpq-button-secondary"
              onClick={closeAddRow}
            >
              Annuleren
            </button>
            <button
              type="button"
              className="cpq-button"
              onClick={handleAddProduct}
              disabled={!resolvedPendingPackagingId}
            >
              Product toevoegen
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="cpq-button cpq-button-secondary cpq-product-picker-add-button"
          onClick={() => setIsAddingProduct(true)}
          disabled={styleOptions.length === 0}
        >
          + Product toevoegen
        </button>
      )}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="cpq-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M5 7h14" />
      <path d="M9 7V5.8c0-.4.4-.8.8-.8h4.4c.4 0 .8.4.8.8V7" />
      <path d="M8 7l.7 11.2c0 .5.4.8.9.8h4.8c.5 0 .9-.3.9-.8L16 7" />
      <path d="M10 10.2v5.6" />
      <path d="M14 10.2v5.6" />
    </svg>
  );
}
