export type ChannelLite = { code: string; naam: string };

export type ChannelYearDefaults = Record<string, { opslag?: number }>;

export type ProductViewRow = {
  productId: string;
  productType: "basis" | "samengesteld";
  product: string;
  opslagOverrides: Record<string, number | "">;
  sellInPriceOverrides: Record<string, number | "">;
  activeOpslags: Record<string, number>;
  isReadOnly: boolean;
  followsProductId: string;
  followsProductLabel: string;
};

export type BeerViewRow = {
  id: string;
  bierId: string;
  biernaam: string;
  productId: string;
  productType: "basis" | "samengesteld" | "";
  product: string;
  kostprijs: number;
  productOpslags: Record<string, number>;
  opslagOverrides: Record<string, number | "">;
  sellInPriceOverrides: Record<string, number | "">;
  activeOpslags: Record<string, number>;
  sellInPrices: Record<string, number>;
  isReadOnly: boolean;
  followsProductId: string;
  followsProductLabel: string;
};

export type ProductOverrideGroup = { key: string; rows: ProductViewRow[] };
export type BeerGroup = { biernaam: string; rows: BeerViewRow[] };
