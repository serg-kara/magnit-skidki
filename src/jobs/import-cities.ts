import 'dotenv/config';
import {
  BOT_USER_AGENT,
  CITY_PAUSE_MS,
  OVERPASS_CACHE_MS,
  OVERPASS_ENDPOINTS,
} from '@/config/http';
import { CITIES } from '@/config/cities';
import { REGIONS, REGION_BY_SLUG } from '@/config/regions';
import { BlockedError, info, parseArgs, readCache, sleep, withSyncLog, writeCache, type SyncLogState } from '@/lib/jobs';
import {
  extractStores,
  medianCoords,
  cityQuery,
  regionQuery,
  NO_ADDRESS,
  type OverpassResponse,
  type StoreDraft,
} from '@/lib/overpass';
import { transliterate } from '@/lib/translit';
import { fetchBBoxElements, type BBoxFetchResult } from '@/lib/osm-api';
import { CITY_BBOXES, CITY_SLUG_ALIASES } from '@/config/city-bboxes';
import { prisma } from '@/lib/prisma';
import type { City, Region } from '@prisma/client';

type Target = { osmName: string; slug: string; name: string; regionSlug: string };

async function postTo(url: string, query: string): Promise<OverpassResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': BOT_USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 403 || res.status === 406 || res.status === 429) {
    throw new BlockedError(`${new URL(url).host} HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as OverpassResponse;
}

/**
 * Один запрос за раз, по очереди по зеркалам Overpass. Если все зеркала отдали
 * 403/406/429 — это BlockedError: повтор не раньше чем через час (§0.4), а не «подбор доступа».
 */
async function overpass(query: string): Promise<OverpassResponse> {
  let blocked: BlockedError | null = null;
  const failures: string[] = [];

  for (const url of OVERPASS_ENDPOINTS) {
    try {
      return await postTo(url, query);
    } catch (err) {
      if (err instanceof BlockedError) {
        blocked = err;
        failures.push(err.message);
        info(`${err.message} — пробую следующее зеркало`);
        continue;
      }
      failures.push(`${new URL(url).host}: ${(err as Error).message}`);
      info(`${new URL(url).host}: ${(err as Error).message} — пробую следующее зеркало`);
    }
    await sleep(2_000);
  }

  // §0.4: 403/406/429 хоть на одном инстансе — это blocked (кулдаун на час), и таймаут
  // следующего зеркала не должен превращать стоп-сигнал в безликий error в SyncLog.
  if (blocked) throw new BlockedError(`${blocked.message}; зеркала — ${failures.join('; ')}`);
  throw new Error(failures[0] ?? 'Overpass недоступен: ни одно зеркало не ответило');
}

async function fetchElements(kind: 'city' | 'region', areaName: string, slug: string, log: SyncLogState): Promise<OverpassResponse> {
  const key = `${kind}-${slug}`;
  const cached = await readCache<OverpassResponse>('overpass', key, OVERPASS_CACHE_MS);
  if (cached && (cached.elements?.length ?? 0) > 0) {
    log.message.push(`${areaName}: кэш OSM`);
    return cached;
  }

  const query = kind === 'city' ? cityQuery(areaName) : regionQuery(areaName);
  const box = kind === 'city' ? CITY_BBOXES[slug] : undefined;

  // OSM_SOURCE=osmapi — принудительно резервный читалка (когда Overpass лежит и ждать
  // его таймауты бессмысленно). По умолчанию источник именно Overpass, как в §3.2.
  if (box && process.env.OSM_SOURCE === 'osmapi') {
    const raw = await fetchBBoxElements(box);
    log.message.push(
      `${areaName}: источник — OSM API, клеток ${raw.cellsDone}/${raw.cellsTotal}${raw.partial ? ' (данные неполные)' : ''}`,
    );
    await cacheElements(key, raw, areaName, log);
    return raw;
  }

  let overpassError = '';
  let failure: Error | null = null;
  try {
    const raw = await overpass(query);
    if ((raw.elements?.length ?? 0) > 0) {
      await writeCache('overpass', key, raw);
      return raw;
    }
    // §3.2: area ищется по точному имени. В OSM админ-граница города может называться
    // «городской округ город Краснодар» — тогда строгий запрос отдаёт пустоту, и это
    // не «в городе нет Магнитов», а несовпадение имени. Пробуем резервный bbox.
    overpassError = 'Overpass вернул 0 элементов (возможно, area-имя не совпало)';
    log.message.push(`${areaName}: ${overpassError}`);
  } catch (err) {
    failure = err as Error;
    overpassError = failure.message;
  }

  // Резерв: официальный OSM API по коробке города — те же данные, та же ODbL.
  // Без коробки (регион) пробрасываем исходную ошибку: BlockedError из §0.4 обязан
  // дойти до withSyncLog и лечь в SyncLog как blocked, а не как безликий error.
  if (!box) throw failure ?? new Error(overpassError || 'Overpass недоступен');
  info(`Overpass не дал данных для ${areaName} (${overpassError}), переключаюсь на OSM API (bbox)`);
  const raw = await fetchBBoxElements(box);
  log.message.push(
    `${areaName}: OSM API вместо Overpass, клеток ${raw.cellsDone}/${raw.cellsTotal}${raw.partial ? ' (неполно)' : ''}`,
  );
  await cacheElements(key, raw, areaName, log);
  return raw;
}

/**
 * Пустой или неполный ответ в кэш не кладём: он на 30 дней запретил бы повторные
 * попытки и выглядел бы как «в городе нет магазинов» (§3.2 п.7 предполагает кэш
 * именно успешных ответов).
 */
async function cacheElements(
  key: string,
  raw: BBoxFetchResult,
  areaName: string,
  log: SyncLogState,
): Promise<void> {
  const empty = (raw.elements?.length ?? 0) === 0;
  if (!empty && !raw.partial) {
    await writeCache('overpass', key, raw);
    return;
  }
  log.message.push(
    `${areaName}: ${empty ? 'данных нет' : 'данные неполные'} — в кэш не пишем, чтобы не отравлять повторные прогоны`,
  );
}

async function ensureRegions(): Promise<void> {
  for (const r of REGIONS) {
    await prisma.region.upsert({
      where: { slug: r.slug },
      update: { name: r.name, osmAreaName: r.osmAreaName },
      create: r,
    });
  }
}

async function upsertCity(target: Target, region: Region): Promise<City> {
  return prisma.city.upsert({
    where: { slug: target.slug },
    // Координаты города пересчитываем из магазинов, name/region не трогаем без нужды.
    update: { name: target.name, regionId: region.id },
    create: {
      slug: target.slug,
      name: target.name,
      lat: 0,
      lng: 0,
      regionId: region.id,
    },
  });
}

/** §3.2 п.6: апсерт по osmId; не перетираем вручную заполненные поля заглушками. */
async function upsertStore(cityId: number, draft: StoreDraft): Promise<boolean> {
  const existing = await prisma.store.findUnique({ where: { osmId: draft.osmId } });
  if (!existing) {
    await prisma.store.create({
      data: {
        cityId,
        name: draft.name,
        format: draft.format,
        address: draft.address,
        lat: draft.lat,
        lng: draft.lng,
        osmId: draft.osmId,
      },
    });
    return true;
  }
  await prisma.store.update({
    where: { id: existing.id },
    data: {
      cityId,
      name: draft.name,
      format: draft.format === 'unknown' ? existing.format : draft.format,
      address: draft.address === NO_ADDRESS ? existing.address : draft.address,
      lat: draft.lat,
      lng: draft.lng,
    },
  });
  return false;
}

async function finalizeCity(cityId: number): Promise<void> {
  const stores = await prisma.store.findMany({ where: { cityId }, select: { lat: true, lng: true } });
  const center = medianCoords(stores);
  if (!center) return;
  await prisma.city.update({ where: { id: cityId }, data: { lat: center.lat, lng: center.lng } });
}

function targetsFromConfig(): Target[] {
  return CITIES.map((c) => ({
    osmName: c.name,
    name: c.name,
    slug: transliterate(c.name),
    regionSlug: c.region,
  }));
}

/** `--city=armafir` (slug из ТЗ) или `--city=станица Казанская` (название OSM). */
async function resolveCityTargets(arg: string): Promise<Target[]> {
  const normalized = CITY_SLUG_ALIASES[arg.trim().toLowerCase()] ?? arg.trim().toLowerCase();
  const known = targetsFromConfig().find((t) => t.slug === normalized || t.name.toLowerCase() === normalized);
  if (known) return [known];
  const slug = transliterate(arg);
  const stored = await prisma.city.findUnique({ where: { slug }, include: { region: true } });
  if (stored) {
    return [
      {
        osmName: stored.name,
        name: stored.name,
        slug: stored.slug,
        regionSlug: stored.region.slug,
      },
    ];
  }
  const region = REGIONS[0];
  info(`Город «${arg}» не найден в конфиге и БД — импортирую в ${region.slug}`);
  return [{ osmName: arg.trim(), name: arg.trim(), slug, regionSlug: region.slug }];
}

async function importCity(target: Target, log: SyncLogState): Promise<{ new: number; seen: number }> {
  const region = REGION_BY_SLUG[target.regionSlug];
  if (!region) throw new Error(`Неизвестный регион ${target.regionSlug}`);
  const raw = await fetchElements('city', target.osmName, target.slug, log);
  const drafts = extractStores(raw);
  if (!drafts.length) {
    log.message.push(`${target.osmName}: в OSM нет магазинов «Магнит»`);
    return { new: 0, seen: 0 };
  }
  const city = await upsertCity(target, await prisma.region.findUniqueOrThrow({ where: { slug: region.slug } }));
  let created = 0;
  for (const draft of drafts) {
    if (await upsertStore(city.id, draft)) created++;
  }
  await finalizeCity(city.id);
  info(`${target.osmName}: магазинов ${drafts.length}, новых ${created}`);
  return { new: created, seen: drafts.length };
}

/** §8: один запрос на край, города определяются по addr:city / addr:place. */
async function importRegion(regionSlug: string, log: SyncLogState): Promise<{ new: number; seen: number; cities: number }> {
  const region = REGION_BY_SLUG[regionSlug];
  if (!region) throw new Error(`Неизвестный регион ${regionSlug}`);
  const rawRegion = await prisma.region.findUniqueOrThrow({ where: { slug: region.slug } });
  const raw = await fetchElements('region', region.osmAreaName, regionSlug, log);
  const drafts = extractStores(raw);
  if (!drafts.length) throw new Error(`Overpass не вернул магазинов для ${region.osmAreaName}`);

  const knownCities = await prisma.city.findMany({ where: { regionId: rawRegion.id } });
  const cityBySlug = new Map<string, City>(knownCities.map((c) => [c.slug, c]));

  const grouped = new Map<string, { name: string; stores: StoreDraft[] }>();
  let unmatched = 0;
  for (const draft of drafts) {
    const hint = draft.cityHint;
    if (!hint) {
      unmatched++;
      continue;
    }
    const slug = transliterate(hint);
    const bucket = grouped.get(slug) ?? { name: hint, stores: [] };
    bucket.stores.push(draft);
    grouped.set(slug, bucket);
  }
  if (unmatched) log.message.push(`${unmatched} магазинов без addr:city пропущены`);

  let created = 0;
  let seen = 0;
  for (const [slug, bucket] of grouped) {
    let city = cityBySlug.get(slug);
    if (!city) {
      city = await prisma.city.create({
        data: { slug, name: bucket.name, lat: 0, lng: 0, regionId: rawRegion.id },
      });
      cityBySlug.set(slug, city);
      log.message.push(`новый город: ${bucket.name}`);
    }
    for (const draft of bucket.stores) {
      if (await upsertStore(city.id, draft)) created++;
      seen++;
    }
    await finalizeCity(city.id);
    info(`${bucket.name}: ${bucket.stores.length} магазинов`);
  }
  return { new: created, seen, cities: grouped.size };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  info(
    `Источник OSM: ${process.env.OSM_SOURCE === 'osmapi' ? 'OSM API (OSM_SOURCE=osmapi)' : 'Overpass, при недоступности — OSM API'} · кэш: ${process.env.FORCE_SYNC === '1' ? 'игнорируется' : 'data/cache/overpass'}`,
  );
  await ensureRegions();

  const summary = await withSyncLog('stores', async (log) => {
    let citiesOk = 0;
    let itemsNew = 0;
    let itemsSeen = 0;
    let usedNetwork = false;

    if (args.region) {
      const res = await importRegion(args.region, log);
      citiesOk = res.cities;
      itemsNew = res.new;
      itemsSeen = res.seen;
      usedNetwork = true;
    } else {
      const targets = args.city ? await resolveCityTargets(args.city) : targetsFromConfig();
      for (let i = 0; i < targets.length; i++) {
        const before = log.message.length;
        try {
          const res = await importCity(targets[i], log);
          citiesOk++;
          itemsNew += res.new;
          itemsSeen += res.seen;
          const fromCache = log.message.slice(before).some((m) => m.includes('кэш OSM'));
          if (!fromCache && i < targets.length - 1) {
            await sleep(CITY_PAUSE_MS);
            usedNetwork = true;
          }
        } catch (err) {
          log.status = err instanceof BlockedError ? 'blocked' : 'partial';
          log.message.push(`${targets[i].osmName}: ${(err as Error).message}`);
          info(`Ошибка импорта ${targets[i].osmName}: ${(err as Error).message}`);
        }
      }
    }
    return { citiesOk, itemsNew, itemsSeen, usedNetwork };
  });

  info(
    `Импорт магазинов завершён: городов ${summary.citiesOk}, новых ${summary.itemsNew}, всего ${summary.itemsSeen}`,
  );
}

void main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
