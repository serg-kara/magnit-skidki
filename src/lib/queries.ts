import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { ADULT_CATEGORY_SLUG } from '@/config/categories';

export type ApiCategory = { slug: string; name: string; isAdult: boolean } | null;

export type ApiPromoItem = {
  id: number;
  /** Product.id, а не id акции: по §6.3 избранное переживает замену акции (§4.4), поэтому ключ — товар. */
  productId: number;
  productName: string;
  brand: string | null;
  category: ApiCategory;
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

export type AdultFilter = 'all' | 'only' | 'exclude';

/** §4.4: в выдачу только действующие акции (validTo >= now либо срок не указан). */
export function activePromoWhere(now = new Date()): Prisma.PromotionWhereInput {
  return {
    OR: [{ validTo: null }, { validTo: { gte: now } }],
  };
}

/** «2026-11-20» по календарным дням локального времени (validTo хранится как 23:59:59). */
export function fmtDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const promoInclude = {
  product: { include: { category: true } },
  stores: { include: { store: true } },
} as const;

type PromoRow = {
  id: number;
  productId: number;
  scope: string;
  priceOld: number | null;
  priceNew: number | null;
  discountPct: number | null;
  bonus: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  product: {
    name: string;
    brand: string | null;
    category: { slug: string; name: string; isAdult: boolean } | null;
  };
  stores: { store: { id: number; name: string; address: string; cityId: number } }[];
};

/**
 * Ссылка «карточка → магазин» (§6.1) строится по stores[0], поэтому первым должен идти
 * магазин нужного города/магазина: у акции scope=store магазины могут лежать в разных
 * городах, и иначе `/stavropol` вёл бы на страницу краснодарского магазина (404).
 */
type StorePreference = { cityId?: number; storeId?: number };

function orderedStores(row: PromoRow, prefer: StorePreference) {
  const rank = (store: PromoRow['stores'][number]['store']) => {
    if (prefer.storeId && store.id === prefer.storeId) return 0;
    if (prefer.cityId && store.cityId === prefer.cityId) return 1;
    return 2;
  };
  return [...row.stores].sort((a, b) => rank(a.store) - rank(b.store));
}

export function toApiPromo(row: PromoRow, prefer: StorePreference = {}): ApiPromoItem {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.product.name,
    brand: row.product.brand,
    category: row.product.category
      ? {
          slug: row.product.category.slug,
          name: row.product.category.name,
          isAdult: row.product.category.isAdult,
        }
      : null,
    priceOld: row.priceOld,
    priceNew: row.priceNew,
    discountPct: row.discountPct,
    bonus: row.bonus,
    validFrom: fmtDate(row.validFrom),
    validTo: fmtDate(row.validTo),
    imageUrl: row.imageUrl,
    sourceUrl: row.sourceUrl,
    scope: row.scope === 'store' ? 'store' : 'federal',
    stores: orderedStores(row, prefer).map((link) => ({
      id: link.store.id,
      name: link.store.name,
      address: link.store.address,
    })),
  };
}

export function buildScopeWhere(filters: { cityId?: number; storeId?: number }): Prisma.PromotionWhereInput {
  const storeFilters: Record<string, unknown> = {};
  if (filters.storeId) storeFilters.storeId = filters.storeId;
  if (filters.cityId) storeFilters.store = { cityId: filters.cityId };

  if (filters.cityId || filters.storeId) {
    // Действуют и общесетевые акции, и привязанные к конкретным магазинам этого города.
    return {
      OR: [{ scope: 'federal' }, { AND: [{ scope: 'store' }, { stores: { some: storeFilters } }] }],
    };
  }
  return {};
}

async function adultWhere(adult: AdultFilter): Promise<Prisma.PromotionWhereInput> {
  if (adult === 'all') return {};
  const adultCategory = await prisma.category.findUnique({ where: { slug: ADULT_CATEGORY_SLUG } });
  if (!adultCategory) return {};
  if (adult === 'only') return { product: { categoryId: adultCategory.id } };
  // exclude: и Product.categoryId обязателен по построению (и seed, и парсер всегда
  // проставляют категорию), поэтому NOT по связи не теряет товары «без категории».
  // notIn по списку id не берём: на SQLite у него потолок по числу параметров.
  return { NOT: { product: { categoryId: adultCategory.id } } };
}

export type PromotionFilters = {
  cityId?: number;
  storeId?: number;
  categorySlug?: string;
  q?: string;
  adult: AdultFilter;
  page: number;
  limit: number;
  includeExpired?: boolean;
};

export async function resolveCityBySlug(slug: string): Promise<{ id: number; name: string } | null> {
  const city = await prisma.city.findUnique({ where: { slug }, select: { id: true, name: true } });
  return city;
}

/** §5: недоступный город → 404, а не пустой список (иначе карта молча врёт). */
export class UnknownCityError extends Error {
  constructor(public slug: string) {
    super(`Город ${slug} не найден`);
    this.name = 'UnknownCityError';
  }
}

/**
 * SQLite в Prisma не умеет регистронезависимый contains по кириллице, поэтому
 * поиск идёт по заранее загруженному списку товаров: он короткий и точный.
 */
async function productIdsMatchingQuery(q: string): Promise<number[] | null> {
  const needle = q.toLowerCase().trim();
  if (!needle) return null;
  const products = await prisma.product.findMany({
    select: { id: true, name: true, brand: true },
  });
  return products
    .filter((p) => `${p.name} ${p.brand ?? ''}`.toLowerCase().includes(needle))
    .map((p) => p.id);
}

export async function findPromotions(filters: PromotionFilters): Promise<{ total: number; items: ApiPromoItem[] }> {
  const now = new Date();
  const and: Prisma.PromotionWhereInput[] = [];

  if (!filters.includeExpired) and.push(activePromoWhere(now));
  const scope = buildScopeWhere({ cityId: filters.cityId, storeId: filters.storeId });
  if (Object.keys(scope).length) and.push(scope);
  and.push(await adultWhere(filters.adult));

  if (filters.categorySlug) {
    and.push({ product: { category: { slug: filters.categorySlug } } });
  }

  const productIds = filters.q ? await productIdsMatchingQuery(filters.q) : null;
  if (productIds) {
    if (!productIds.length) return { total: 0, items: [] };
    and.push({ productId: { in: productIds } });
  }

  const where: Prisma.PromotionWhereInput = { AND: and };
  const total = await prisma.promotion.count({ where });
  const rows = await prisma.promotion.findMany({
    where,
    include: promoInclude,
    orderBy: [{ discountPct: 'desc' }, { id: 'asc' }],
    skip: (filters.page - 1) * filters.limit,
    take: filters.limit,
  });
  return { total, items: rows.map((row) => toApiPromo(row, { cityId: filters.cityId, storeId: filters.storeId })) };
}

export async function countCityPromotions(cityId: number): Promise<number> {
  const now = new Date();
  return prisma.promotion.count({
    where: {
      AND: [
        activePromoWhere(now),
        {
          OR: [
            { scope: 'federal' },
            { scope: 'store', stores: { some: { store: { cityId } } } },
          ],
        },
      ],
    },
  });
}

export type MapMarker = {
  storeId: number;
  lat: number;
  lng: number;
  address: string;
  name: string;
  promos: number;
  preview: { name: string; priceNew: number | null; discountPct: number | null }[];
};

/** §5 /api/promotions/map: по каждому магазину города — число акций и 3 превью. */
export async function mapMarkers(cityId: number): Promise<MapMarker[]> {
  const now = new Date();
  // Store.promos по схеме §2 — связь через PromotionStore, поэтому сама акция
  // лежит вложенно в link.promotion.
  const stores = await prisma.store.findMany({
    where: { cityId },
    include: {
      promos: {
        where: { promotion: activePromoWhere(now) },
        include: { promotion: { include: { product: true } } },
      },
    },
    orderBy: { id: 'asc' },
  });

  // Общесетевые акции доступны в каждом магазине: считаем их отдельно от привязанных,
  // иначе «n акций у магазина» раздуется linking'ом на каждый магазин.
  const federalWhere: Prisma.PromotionWhereInput = {
    AND: [activePromoWhere(now), { scope: 'federal' }],
  };
  const [federalCount, federalPreviewRows] = await Promise.all([
    prisma.promotion.count({ where: federalWhere }),
    prisma.promotion.findMany({
      where: federalWhere,
      include: { product: true },
      orderBy: [{ discountPct: 'desc' }, { id: 'asc' }],
      take: 3,
    }),
  ]);

  const previewOf = (p: { product: { name: string }; priceNew: number | null; discountPct: number | null }) => ({
    name: p.product.name,
    priceNew: p.priceNew,
    discountPct: p.discountPct,
  });
  const federalPreview = federalPreviewRows.map(previewOf);

  return stores.map((store) => {
    const linkedPromos = store.promos
      .map((link) => link.promotion)
      .sort(
        (a, b) =>
          (b.discountPct ?? -1) - (a.discountPct ?? -1) || a.id - b.id,
      );
    const linked = linkedPromos.map(previewOf);
    return {
      storeId: store.id,
      lat: store.lat,
      lng: store.lng,
      address: store.address,
      name: store.name,
      promos: linkedPromos.length + federalCount,
      preview: [...linked, ...federalPreview].slice(0, 3),
    };
  });
}

export async function metaSnapshot() {
  const [cities, stores, promos, lastStores, lastPromotions] = await Promise.all([
    prisma.city.count(),
    prisma.store.count(),
    prisma.promotion.count(),
    prisma.syncLog.findFirst({ where: { job: 'stores' }, orderBy: { startedAt: 'desc' } }),
    prisma.syncLog.findFirst({ where: { job: 'promotions' }, orderBy: { startedAt: 'desc' } }),
  ]);
  return { cities, stores, promos, lastStores, lastPromotions };
}
