import { createHash } from 'node:crypto';
import { DAY_MS, readCacheEntry, writeCache } from '@/lib/jobs';
import { addressKey, cityNamesMatch, settlementFromAddress } from '@/lib/parse/normalize';

/**
 * Геокодер для магазинов, которых нет в OSM (п.3 задачи). Провайдеры — открытые сервисы
 * на данных ODbL, без ключей: Photon (photon.komoot.io) и Nominatim. Ключ `geocoderApiKey`
 * из конфига страницы magnit.ru НЕ используем: это чужие креды, §0.4 такое запрещает.
 *
 * Порядок по умолчанию «photon,nominatim»: Nominatim с этой машины отвечает 403 по своей
 * политике (как и Overpass — 406), Photon работает.
 *
 * Главное правило: координата принимается только когда ответ реально про этот дом
 * (город + улица + номер дома, тип house). Иначе точка — центр улицы, и рисовать по
 * ней магазин значит выдумывать адрес (§0.4 «ничего не выдумывать») — такой адрес
 * остаётся без координат и попадает в счётчик withoutCoords.
 */
const PROVIDERS = (process.env.GEOCODE_PROVIDERS ?? 'photon,nominatim').split(',').map((p) => p.trim()).filter(Boolean);
/** Правило вежливости обоих сервисов — не чаще одного запроса в секунду. */
const RATE_MS = Number(process.env.GEOCODE_RATE_MS ?? 1_100);
const CACHE_MS = Number(process.env.GEOCODE_CACHE_DAYS ?? 180) * DAY_MS;
/** Отказ/промах держим сутки: это состояние источника, а не свойство адреса. */
const NEGATIVE_CACHE_MS = Number(process.env.GEOCODE_NEGATIVE_CACHE_DAYS ?? 1) * DAY_MS;
const UA =
  process.env.GEOCODE_USER_AGENT ?? 'skidki-u-doma/0.1 (open public map for store addresses; contact: skidki-u-doma@example.com)';

export type GeoPoint = { lat: number; lng: number; displayName: string; provider: string };

type RawHit = { lat: number; lng: number; displayName: string; street?: string; housenumber?: string; city?: string; type?: string };
type CacheEntry = { found: boolean; lat?: number; lng?: number; displayName?: string; provider?: string };

let lastAt = 0;

async function waitRate(): Promise<void> {
  const wait = Math.max(0, lastAt + RATE_MS - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastAt = Date.now();
}

export type GeoWanted = { city: string; street: string; house: string };

/** Адрес → ожидаемые части для запроса и проверки совпадения. */
export function geoQueryOf(address: string, fallbackCity?: string): GeoWanted | null {
  const key = addressKey(address);
  if (!key) return null;
  const [street, house] = key.split('|');
  const city = settlementFromAddress(address) ?? fallbackCity;
  if (!city || !street || !house) return null;
  // Ключ склеивает слова через дефис («им-дзержинского»), сервисы ждут обычные пробелы.
  return { city, street: street.replace(/-/g, ' '), house };
}

const norm = (value: string | undefined): string =>
  (value ?? '')
    .toLowerCase()
    .replace(/[\s.,\-\/#]+/g, '')
    .replace(/[ёe]/g, (ch) => (ch === 'ё' ? 'е' : 'ё'));

/**
 * Проверка, что нам вернули именно этот дом, а не улицу/город: тип house, номер дома
 * совпал, город совпал, и в названии улицы есть хотя бы одно значимое слово из запроса.
 */
export function isExactHit(hit: RawHit, want: GeoWanted): boolean {
  if (!Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) return false;
  if (hit.housenumber && norm(hit.housenumber) !== norm(want.house)) return false;
  if (!hit.housenumber) return false;
  if (hit.city && !cityNamesMatch(norm(hit.city), norm(want.city))) return false;
  if (hit.type && !/house|building|addr/i.test(hit.type)) return false;
  const streetWords = want.street.toLowerCase().split(/[\s-]+/).filter((w) => w.length >= 4);
  const hitStreet = norm(hit.street);
  if (streetWords.length && !streetWords.some((w) => hitStreet.includes(w))) return false;
  return true;
}

async function getJson(url: string): Promise<unknown | null> {
  await waitRate();
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'ru,en' }, signal: AbortSignal.timeout(25_000) });
    // 403/429 — сервис нас не обслуживает: это отсутствие точки, а не повод подбирать обход (§0.4).
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function photonHits(body: unknown): RawHit[] {
  const features = (body as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((raw) => {
    const f = raw as { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string> };
    const [lng, lat] = f.geometry?.coordinates ?? [];
    const p = f.properties ?? {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [{
      lat: lat as number,
      lng: lng as number,
      displayName: [p.name, p.street, p.housenumber, p.city].filter(Boolean).join(', '),
      street: p.street,
      housenumber: p.housenumber,
      city: p.city ?? p.locality ?? p.state,
      type: p.type,
    }];
  });
}

type NominatimRow = {
  lat?: string;
  lon?: string;
  display_name?: string;
  addresstype?: string;
  class?: string;
  type?: string;
  address?: { street?: string; housenumber?: string; city?: string; town?: string; village?: string; municipality?: string };
};

function nominatimHits(body: unknown): RawHit[] {
  if (!Array.isArray(body)) return [];
  return (body as NominatimRow[]).map((row) => ({
    lat: Number(row.lat),
    lng: Number(row.lon),
    displayName: row.display_name ?? '',
    street: row.address?.street ?? row.display_name ?? '',
    housenumber: row.address?.housenumber ?? '',
    city: row.address?.city ?? row.address?.town ?? row.address?.village ?? row.address?.municipality ?? '',
    type: row.addresstype ?? row.type ?? '',
  }));
}

function endpointFor(provider: string, want: GeoWanted): string | null {
  const q = `${want.street} ${want.house}, ${want.city}`;
  if (provider === 'photon') return `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(q)}`;
  if (provider === 'nominatim')
    return `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=ru&city=${encodeURIComponent(want.city)}&street=${encodeURIComponent(`${want.street} ${want.house}`)}`;
  return null;
}

/** Спрашиваем провайдеров по очереди, берём первый точный ответ. */
async function askProviders(want: GeoWanted): Promise<GeoPoint | null> {
  for (const provider of PROVIDERS) {
    const url = endpointFor(provider, want);
    if (!url) continue;
    const body = await getJson(url);
    if (!body) continue;
    const hits = provider === 'photon' ? photonHits(body) : nominatimHits(body);
    const exact = hits.find((hit) => isExactHit(hit, want));
    if (exact) return { ...exact, provider };
  }
  return null;
}

/**
 * П.3 задачи: повторный запуск не должен долбить API — поэтому ответ (и «найдено», и
 * «не найдено») кэшируется в data/cache/geocode/. Ключ включает набор провайдеров: при
 * смене провайдера старые отрицательные записи не должны вечно считать адрес мёртвым.
 */
export async function geocode(address: string, fallbackCity?: string): Promise<GeoPoint | null> {
  const want = geoQueryOf(address, fallbackCity);
  if (!want) return null;
  const key = createHash('sha1').update(`${PROVIDERS.join(',')}|${want.city}|${want.street}|${want.house}`).digest('hex');

  const cached = await readCacheEntry<CacheEntry>('geocode', key);
  if (cached) {
    const ttl = cached.value.found ? CACHE_MS : NEGATIVE_CACHE_MS;
    if (Date.now() - cached.at <= ttl) {
      const v = cached.value;
      return v.found ? { lat: v.lat!, lng: v.lng!, displayName: v.displayName ?? '', provider: v.provider ?? '' } : null;
    }
  }

  const point = await askProviders(want);
  await writeCache(
    'geocode',
    key,
    point
      ? { found: true, lat: point.lat, lng: point.lng, displayName: point.displayName, provider: point.provider }
      : { found: false },
  );
  return point;
}
