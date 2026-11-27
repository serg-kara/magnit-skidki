export type OverpassElementType = 'node' | 'way' | 'relation';

export type OverpassElement = {
  type: OverpassElementType;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type OverpassResponse = {
  elements?: OverpassElement[];
};

export type StoreFormat = 'universal' | 'home' | 'supermarket' | 'express' | 'unknown';

export type StoreDraft = {
  osmId: string;
  name: string;
  format: StoreFormat;
  address: string;
  lat: number;
  lng: number;
  cityHint: string | null;
};

export const NO_ADDRESS = 'адрес не указан в OSM';

/**
 * Бренды-конкуренты, которые попадают в широкий фильтр `shop=supermarket`, но не имеют
 * отношения к «Магниту» (§3.2 п.2 — «другие сети выбросить»).
 */
const FOREIGN_CHAINS = [
  'пятерочка',
  'пяточка',
  'перекрёсток',
  'перекресток',
  'лента',
  'метро',
  'заморозка',
  'авоська',
  'добрянка',
  'бегмама',
  'мираж',
  'спар',
  'асан',
  'бакалея',
  'фасоль',
  'победа',
  'кибр',
  'хохланд',
  'okei',
  'абсолют',
  'колсон',
  'goodix',
  'продукты 24',
  'дацзы',
];

const MAGNIT = /магнит/i;

/** Граница слова для кириллицы: `\b` в JS работает только по ASCII, поэтому своя. */
function mentionsWord(text: string, word: string): boolean {
  const boundary = '(^|[^0-9a-zа-яё-])';
  const escaped = word.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return new RegExp(`${boundary}${escaped}${boundary}`, 'i').test(text);
}

export function cityQuery(areaName: string): string {
  return `[out:json][timeout:60];
area["name"="${areaName}"]["boundary"="administrative"]->.a;
(node["shop"="supermarket"](area.a); way["shop"="supermarket"](area.a);
 relation["shop"="supermarket"](area.a);
 node["brand"]["name"~"Магнит"](area.a);
 way["brand"]["name"~"Магнит"](area.a););
out center tags;`;
}

/** §8: один запрос на весь край вместо перебора городов. */
export function regionQuery(areaName: string): string {
  return `[out:json][timeout:120];
area["name"="${areaName}"]["boundary"="administrative"]->.a;
(node["shop"="supermarket"](area.a); way["shop"="supermarket"](area.a);
 relation["shop"="supermarket"](area.a);
 node["brand"]["name"~"Магнит"](area.a);
 way["brand"]["name"~"Магнит"](area.a);
 relation["brand"]["name"~"Магнит"](area.a););
out center tags;`;
}

export function isMagnit(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  const haystack = [tags.name, tags['name:ru'], tags.brand, tags['brand:ru']]
    .filter(Boolean)
    .join(' ');
  if (!haystack || !MAGNIT.test(haystack)) return false;
  // «Магнит Косметик» / «Магнит Оптовый» — другие форматы сети с чужими акциями.
  if (/магнит[\s-]*(косметик|оптов|аптека)/i.test(haystack)) return false;
  // Если в названии замешана другая сеть — это не наш магазин.
  const withoutMagnit = haystack.replace(/магнит[\s-]*/gi, ' ');
  return !FOREIGN_CHAINS.some((chain) => mentionsWord(withoutMagnit, chain));
}

export function detectFormat(tags: Record<string, string>): StoreFormat {
  const hay = [tags.name, tags['name:ru'], tags.brand, tags['brand:ru']]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/у\s+дома/.test(hay)) return 'home';
  if (/семейн|экстра|max/.test(hay)) return 'supermarket';
  if (/экспресс|express|у дома\+|кофе/.test(hay)) return 'express';
  if (tags['shop'] === 'supermarket' && /магнит/i.test(hay)) return 'universal';
  return 'unknown';
}

const STREET_TYPE = /^(ул\.|улица|пр-?кт|проспект|б-?р|бульвар|пер\.|переулок|наб\.|набережная|ш\.|шоссе|пл\.|площадь)/i;

export function buildAddress(tags: Record<string, string>): string {
  const street = tags['addr:street']?.trim();
  const house = tags['addr:housenumber']?.trim();
  const city = tags['addr:city']?.trim();
  if (!street && !house) return NO_ADDRESS;
  let line = '';
  if (street) line += STREET_TYPE.test(street) ? street : `ул. ${street}`;
  if (house) line += line ? `, д. ${house}` : `д. ${house}`;
  return city ? `${line}, ${city}` : line;
}

export function elementCoords(el: OverpassElement): { lat: number; lng: number } | null {
  if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lng: el.lon };
  }
  return null;
}

const CITY_PREFIX = /^(?:г\.?|город|ст-?ца\.?|станица|п\.?|посёлок|пос\.?|р\.?п\.?|с\.?|село|x)\s*/i;

/** «г. Краснодар» / «Краснодар городской округ» → «Краснодар». */
export function normalizeCityName(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(CITY_PREFIX, '').trim();
  if (!cleaned) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** §8: город определяется по `addr:city`, при его отсутствии — по `addr:place`. */
export function cityHintFromElement(el: OverpassElement): string | null {
  const tags = el.tags ?? {};
  return normalizeCityName(tags['addr:city']) ?? normalizeCityName(tags['addr:place']);
}

/** §3.2 п.2 + п.3–5: нормализует сырой ответ Overpass в список магазинов «Магнита». */
export function extractStores(raw: OverpassResponse): StoreDraft[] {
  const out: StoreDraft[] = [];
  const seen = new Set<string>();
  for (const el of raw.elements ?? []) {
    const tags = el.tags ?? {};
    if (!isMagnit(tags)) continue;
    const coords = elementCoords(el);
    if (!coords) continue;
    const osmId = `${el.type}/${el.id}`;
    if (seen.has(osmId)) continue;
    seen.add(osmId);
    out.push({
      osmId,
      name: (tags['name:ru'] ?? tags.name ?? 'Магнит').trim(),
      format: detectFormat(tags),
      address: buildAddress(tags),
      lat: coords.lat,
      lng: coords.lng,
      cityHint: cityHintFromElement(el),
    });
  }
  return out;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function medianCoords(points: { lat: number; lng: number }[]): { lat: number; lng: number } | null {
  if (!points.length) return null;
  return {
    lat: median(points.map((p) => p.lat))!,
    lng: median(points.map((p) => p.lng))!,
  };
}
