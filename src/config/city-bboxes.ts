import type { BBox } from '@/lib/osm-api';

/**
 * Коробки городов для резервного читалки OSM API (src/lib/osm-api.ts). Нужны только тем
 * путём, которым Overpass недоступен: основной источник (§3.2) — area-запрос, он коробку
 * не требует. Поэтому CITIES в src/config/cities.ts остаётся ровно как в ТЗ, а эта таблица
 * живёт отдельно и заполняется для городов первого контура.
 *
 * Границы — по застройке города с запасом на промзоны при въездах, не по админгранице.
 */
export const CITY_BBOXES: Record<string, BBox> = {
  krasnodar: { west: 38.82, south: 44.94, east: 39.18, north: 45.13 },
  armavir: { west: 40.96, south: 44.84, east: 41.24, north: 45.01 },
  kurganinsk: { west: 41.3, south: 44.8, east: 41.48, north: 44.95 },
  stavropol: { west: 41.83, south: 44.95, east: 42.11, north: 45.14 },
  nevinnomyssk: { west: 41.82, south: 44.55, east: 42.0, north: 44.72 },
};

/**
 * Slug из ТЗ (§1/§2 пишет «armafir») расходится с правилом §8 «slug — транслитерация»:
 * «Армавир» → armavir. Источник истины — транслитерация, а написание из ТЗ принимаем
 * как алиас, чтобы запуск `npm run sync:stores -- --city=armafir` не ломался.
 */
export const CITY_SLUG_ALIASES: Record<string, string> = {
  armafir: 'armavir',
};
