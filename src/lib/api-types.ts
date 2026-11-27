/**
 * Клиентские типы ответов API. Отдельный файл нужен, чтобы компоненты не импортировали
 * src/lib/queries.ts: тот тянет Prisma, а Prisma в клиентском бандле ломает сборку.
 */

export type ApiCategoryRef = { slug: string; name: string; isAdult: boolean };

export type ApiPromo = {
  id: number;
  productId: number;
  productName: string;
  brand: string | null;
  category: ApiCategoryRef | null;
  priceOld: number | null;
  priceNew: number | null;
  discountPct: number | null;
  bonus: string | null;
  validFrom: string | null;
  validTo: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  scope: 'federal' | 'store';
  stores: { id: number; name: string; address: string }[];
};

export type ApiPromotionsResponse = { total: number; items: ApiPromo[] };

export type ApiMapMarker = {
  storeId: number;
  lat: number;
  lng: number;
  address: string;
  name: string;
  promos: number;
  preview: { name: string; priceNew: number | null; discountPct: number | null }[];
};

export type ApiCitySummary = {
  id: number;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  region: { slug: string; name: string };
  storesCount: number;
  promosCount: number;
  promotionsConnected: boolean;
};

export type ApiMeta = {
  cities: number;
  stores: number;
  promos: number;
  lastSync: { job: string; status: string; finishedAt: string | null } | null;
  lastPromotionsSync: { job: string; status: string; finishedAt: string | null } | null;
};
