/**
 * §7.1: seed наполняет БД из закоммиченных JSON — сборка и e2e зелёные без сети.
 * Координаты магазинов в data/stores.sample.json взяты из OpenStreetMap
 * (см. src/jobs/import-cities.ts и src/jobs/export-sample.ts).
 *
 * Идемпотентность: города/магазины апсерятся по slug/osmId, а акции — через общий с
 * парсером дедуп по sig (§4.4). Окно действия привязано к началу текущих суток, поэтому
 * повторный запуск seed в тот же день не плодит дубли.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { REGIONS } from '../src/config/regions';
import { CATEGORIES } from '../src/config/categories';
import { saveCards } from '../src/jobs/save-promotions';
import type { RawCard } from '../src/jobs/extract-cards';
import type { StoreFormat } from '../src/lib/overpass';

type SampleStore = {
  osmId: string;
  name: string;
  format: StoreFormat;
  address: string;
  lat: number;
  lng: number;
};

type SampleCity = {
  slug: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  stores: SampleStore[];
};

type StoresSample = { generatedAt: string; source: string; cities: SampleCity[] };

type SamplePromo = {
  name: string;
  brand?: string | null;
  category: string;
  priceOld?: number | null;
  priceNew?: number | null;
  discountPct?: number | null;
  bonus?: string | null;
  scope?: 'federal' | 'store';
  /**
   * Для scope=store: города и сколько первых магазинов каждого города получить.
   * osmId тут не указываются намеренно — они меняются при расширении на весь край (§8),
   * а seed должен работать и на импортированных, и на будущих данных.
   */
  cities?: string[];
  storeCount?: number;
  /** Истёкшая акция (§7.1) — должна не попадать ни в какую выдачу. */
  expired?: boolean;
  fromOffsetDays?: number;
  toOffsetDays?: number;
};

type PromotionsSample = { promos: SamplePromo[] };

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relative), 'utf8')) as T;
}

function startOfToday(now = new Date()): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

function shift(base: Date, days: number, endOfDay = false): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
}

async function seedStores() {
  const sample = readJson<StoresSample>('data/stores.sample.json');

  for (const region of REGIONS) {
    await prisma.region.upsert({
      where: { slug: region.slug },
      update: { name: region.name, osmAreaName: region.osmAreaName },
      create: region,
    });
  }

  const cityBySlug = new Map<string, number>();
  for (const city of sample.cities) {
    const region = await prisma.region.findUniqueOrThrow({ where: { slug: city.region } });
    const row = await prisma.city.upsert({
      where: { slug: city.slug },
      update: { name: city.name, lat: city.lat, lng: city.lng, regionId: region.id },
      create: {
        slug: city.slug,
        name: city.name,
        lat: city.lat,
        lng: city.lng,
        regionId: region.id,
      },
    });
    cityBySlug.set(city.slug, row.id);

    for (const store of city.stores) {
      const existing = await prisma.store.findUnique({ where: { osmId: store.osmId } });
      if (existing) {
        await prisma.store.update({
          where: { id: existing.id },
          data: {
            cityId: row.id,
            name: store.name,
            format: store.format,
            address: store.address,
            lat: store.lat,
            lng: store.lng,
          },
        });
      } else {
        await prisma.store.create({
          data: { cityId: row.id, ...store },
        });
      }
    }
    console.log(`${city.name}: магазинов ${city.stores.length}`);
  }

  return cityBySlug;
}

async function seedCategories() {
  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, isAdult: category.isAdult },
      create: category,
    });
  }
}

async function seedPromotions() {
  const sample = readJson<PromotionsSample>('data/promotions.sample.json');
  const today = startOfToday();

  const taken = new Set(
    (await prisma.product.findMany({ select: { slug: true } })).map((p) => p.slug),
  );

  let created = 0;
  let seen = 0;
  let skipped = 0;

  for (const promo of sample.promos) {
    const scope = promo.scope ?? 'federal';
    let storeIds: number[] = [];
    if (scope === 'store') {
      const cities = promo.cities ?? [];
      if (!cities.length) {
        console.warn(`Акция «${promo.name}»: scope=store без cities — пропуск`);
        skipped++;
        continue;
      }
      const perCity = await Promise.all(
        cities.map((slug) =>
          prisma.store.findMany({
            where: { city: { slug } },
            orderBy: { id: 'asc' },
            take: promo.storeCount ?? 2,
            select: { id: true },
          }),
        ),
      );
      storeIds = perCity.flat().map((store) => store.id);
      if (!storeIds.length) {
        console.warn(`Акция «${promo.name}»: в городах ${cities.join(', ')} нет магазинов — пропуск`);
        skipped++;
        continue;
      }
    }

    const card: RawCard = {
      name: promo.name,
      brand: promo.brand ?? null,
      categorySlug: promo.category,
      priceOld: promo.priceOld ?? null,
      priceNew: promo.priceNew ?? null,
      discountPct: promo.discountPct ?? null,
      bonus: promo.bonus ?? null,
      validFrom: shift(today, promo.fromOffsetDays ?? -1),
      // Истёкшая акция (§7.1) обязана не попадать ни в список, ни на карту.
      validTo: promo.expired
        ? shift(today, -2, true)
        : shift(today, promo.toOffsetDays ?? 13, true),
      imageUrl: null,
      // Seed не притворятся снятыми с сайта сети: источник помечен схемой seed://.
      sourceUrl: `seed://magnit/${encodeURIComponent(promo.name)}`,
    };

    const result = await saveCards([card], { storeIds, scope, takenProductSlugs: taken });
    created += result.created;
    seen += result.seen;
  }

  console.log(`Акции: создано ${created}, уже было ${seen}, пропущено ${skipped}`);
}

async function seedSourceCityMap(cityBySlug: Map<string, number>) {
  // §4.1.4: связь «наш город → город на сайте сети». В seed она есть только для городов
  // первого контура — новые города из §8 остаются без неё и парсер помечает их skipped.
  const mapping: Record<string, string> = {
    krasnodar: 'Краснодар',
    armavir: 'Армавир',
    kurganinsk: 'Курганинск',
    stavropol: 'Ставрополь',
    nevinnomyssk: 'Невинномысск',
  };
  for (const [slug, name] of Object.entries(mapping)) {
    const cityId = cityBySlug.get(slug);
    if (!cityId) continue;
    await prisma.sourceCityMap.upsert({
      where: { cityId },
      update: { magnitCityName: name },
      create: { cityId, magnitCityId: `seed-${slug}`, magnitCityName: name },
    });
  }
}

async function seedSyncLog() {
  const existing = await prisma.syncLog.findFirst({ where: { job: 'promotions' } });
  if (existing) return;
  const [cities, stores, promos] = await Promise.all([
    prisma.city.count(),
    prisma.store.count(),
    prisma.promotion.count(),
  ]);
  await prisma.syncLog.create({
    data: {
      job: 'promotions',
      status: 'ok',
      message: 'seed: данные из data/promotions.sample.json, сеть не использовалась',
      citiesOk: cities,
      itemsNew: promos,
      itemsSeen: promos,
      finishedAt: new Date(),
    },
  });
  await prisma.syncLog.create({
    data: {
      job: 'stores',
      status: 'ok',
      message: 'seed: координаты OSM из data/stores.sample.json',
      citiesOk: cities,
      itemsNew: stores,
      itemsSeen: stores,
      finishedAt: new Date(),
    },
  });
}

async function main() {
  await seedCategories();
  const cityBySlug = await seedStores();
  await seedSourceCityMap(cityBySlug);
  await seedPromotions();
  await seedSyncLog();
  console.log('Seed завершён');
}

void main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
