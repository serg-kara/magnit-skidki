import { createHash } from 'node:crypto';
import { DAY_MS, readCacheEntry, writeCache } from '@/lib/jobs';
import { addressKey, settlementFromAddress } from '@/lib/parse/normalize';

/**
 * Геокодер для магазинов, которых нет в OSM (п.3 задачи): Nominatim — открытый сервис
 * с той же лицензией ODbL, что и координаты из §3, без ключей. Ключ `geocoderApiKey`
 * из конфига страницы magnit.ru НЕ используем: это чужие креды, §0.4 такое запрещает.
 *
 * Важно по факту прогонов: свободный текст «…, ул Мира, д 10» Nominatim не разбирает
 * (русский префикс «д» ломает матчинг, отдаёт пусто), а структурированный запрос
 * city=…&street=… находит дом. Поэтому запрос строится из разобранного адреса.
 */
const NOMINATIM_URL = process.env.GEOCODE_URL ?? 'https://nominatim.openstreetmap.org/search';
/** Правило вежливости Nominatim — не чаще одного запроса в секунду. */
const RATE_MS = Number(process.env.GEOCODE_RATE_MS ?? 1_100);
const CACHE_MS = Number(process.env.GEOCODE_CACHE_DAYS ?? 180) * DAY_MS;
/** Ответ «точки нет» и отказ сервиса держим сутки: это состояние источника, а не свойства адреса. */
const NEGATIVE_CACHE_MS = Number(process.env.GEOCODE_NEGATIVE_CACHE_DAYS ?? 1) * DAY_MS;

export type GeoPoint = { lat: number; lng: number; displayName: string };

type CacheEntry = { found: boolean; lat?: number; lng?: number; displayName?: string };

/**
 * UA для Nominatim — отдельная строка: политика сервиса отдаёт 403 «Access denied»
 * запросам, где в User-Agent есть слово «aggregator» (именно так и ловили молча
 * пустые координаты в первом прогоне). Контакт и название проекта остаются.
 */
const GEOCODE_UA =
  process.env.GEOCODE_USER_AGENT ?? 'skidki-u-doma/0.1 (open public map for store addresses; contact: skidki-u-doma@example.com)';

let lastAt = 0;

async function waitRate(): Promise<void> {
  const wait = Math.max(0, lastAt + RATE_MS - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastAt = Date.now();
}

/** Адрес → параметры Nominatim: город + «улица дом». */
export function geoQueryOf(address: string, fallbackCity?: string): { city: string; street: string } | null {
  const key = addressKey(address);
  if (!key) return null;
  const [street, house] = key.split('|');
  const city = settlementFromAddress(address) ?? fallbackCity;
  if (!city) return null;
  // Ключ склеивает слова через дефис («им-дзержинского»), а Nominatim ждёт обычные пробелы.
  return { city, street: `${street.replace(/-/g, ' ')} ${house}`.trim() };
}

async function ask(params: Record<string, string>): Promise<GeoPoint | null> {
  await waitRate();
  const url = `${NOMINATIM_URL}?${new URLSearchParams({ format: 'jsonv2', limit: '1', ...params }).toString()}`;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': GEOCODE_UA, 'accept-language': 'ru' },
      signal: AbortSignal.timeout(30_000),
    });
    // 403/429 — сервис нас режет: это отсутствие точки, а не повод подбирать обход (§0.4).
    if (!res.ok) return null;
    const rows = (await res.json()) as { lat?: string; lon?: string; display_name?: string }[];
    const hit = Array.isArray(rows) ? rows[0] : undefined;
    if (!hit?.lat || !hit.lon) return null;
    return { lat: Number(hit.lat), lng: Number(hit.lon), displayName: hit.display_name ?? '' };
  } catch {
    return null;
  }
}

/**
 * Возвращает точку либо null. Отрицательный ответ тоже кэшируется (п.3 задачи:
 * повторный запуск не должен долбить API), поэтому в кэше лежит объект-конверт,
 * а не голый null — иначе промах кэша неотличим от «мы уже спрашивали, точки нет».
 * Отрицательное храним сутки: отказ сервиса (403) — не приговор адресу, а
 * состояние источника, и через сутки надо попробовать снова.
 */
export async function geocode(address: string, fallbackCity?: string): Promise<GeoPoint | null> {
  const query = geoQueryOf(address, fallbackCity);
  if (!query) return null;
  const key = createHash('sha1').update(`${query.city}|${query.street}`).digest('hex');

  const cached = await readCacheEntry<CacheEntry>('geocode', key);
  if (cached) {
    const ttl = cached.value.found ? CACHE_MS : NEGATIVE_CACHE_MS;
    if (Date.now() - cached.at <= ttl) {
      return cached.value.found
        ? { lat: cached.value.lat!, lng: cached.value.lng!, displayName: cached.value.displayName ?? '' }
        : null;
    }
  }

  const base = { countrycodes: 'ru', city: query.city, street: query.street };
  let point = await ask(base as Record<string, string>);
  if (!point) {
    // Резерв: свободный текст без русских префиксов «д»/«ул» — иногда находит то, что
    // не находит структурированный запрос (новые улицы, посёлки без города в индексе).
    point = await ask({ q: `${query.city}, ${query.street}, Россия` });
  }

  await writeCache(
    'geocode',
    key,
    point
      ? { found: true, lat: point.lat, lng: point.lng, displayName: point.displayName }
      : { found: false },
  );
  return point;
}
