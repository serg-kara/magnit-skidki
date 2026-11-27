import { parseHtml, querySelectorAll, descendants, visibleText, type HtmlElement } from '@/lib/parse/html';
import { addressKey, settlementFromAddress } from '@/lib/parse/normalize';
import type { StoreFormat } from '@/lib/overpass';

/**
 * Разметка реальная (снята 27.11.2026 со страницы https://magnit.ru/shops):
 *   <div class="shops-list-item">
 *     <div class="shops-list-item--info" title="Ставропольский край, г Ставрополь, ул …, д 25/1">
 *       <div class="… shops-list-item--label">Магнит Экстра</div>   ← название формата
 *       <div class="… shops-list-item--label">Ставропольский край, …</div> ← адрес тем же классом
 *       <div class="… shops-list-item--schedule">08:00 - 22:00</div>
 *
 * Адрес берём из `title`, а не из текста: в innerText название, адрес и часы склеены
 * в одну строку («Моя ценаСтавропольский край, …»), и резать её по пробелу нельзя.
 */
export const SHOPS_DOM = {
  item: '.shops-list-item',
  info: '.shops-list-item--info',
  label: '.shops-list-item--label',
  schedule: '.shops-list-item--schedule',
} as const;

/** Бейдж «Моя цена» прилипает к названию в некоторых выдачах — это не формат магазина. */
const BADGE_PREFIX_RE = /^(моя цена|заряд|акция|new)\s*/i;

/** Аптеки — другой формат сети (свои товары, свои акции); в списке магазинов их не учитываем. */
const PHARMACY_RE = /аптек/i;

export function detectShopFormat(name: string): StoreFormat {
  const n = name.toLowerCase();
  if (/экстра|семейн/.test(n)) return 'supermarket';
  if (/мини|мигом|экспресс/.test(n)) return 'express';
  if (/у дома/.test(n)) return 'home';
  if (/магнит|м\.косметик/.test(n)) return 'universal';
  return 'unknown';
}

export type SiteShop = {
  name: string;
  address: string;
  schedule: string | null;
  /** Ключ слияния с OSM (§2 задачи): улица + номер дома. Null, если дома нет. */
  key: string | null;
  settlement: string | null;
  format: StoreFormat;
};

function attr(node: HtmlElement, name: string): string {
  return (node.attrs[name] ?? '').replace(/\s+/g, ' ').trim();
}

export function parseShopsHtml(html: string): SiteShop[] {
  const roots = parseHtml(html);
  const items = querySelectorAll(roots, SHOPS_DOM.item);
  const out: SiteShop[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const info = descendants(item, SHOPS_DOM.info)[0];
    if (!info) continue;
    const address = attr(info, 'title') || visibleText(info);
    if (!address) continue;

    const labels = descendants(item, SHOPS_DOM.label).map((node) => visibleText(node));
    // Название — первый label без запятой (адрес всегда с запятыми); если там только бейдж
    // вида «Моя цена», оставляем сетевое имя, а не пустую строку.
    const rawName = labels.find((label) => label && !label.includes(',')) ?? 'Магнит';
    const name = rawName.replace(BADGE_PREFIX_RE, '').trim() || 'Магнит';
    if (PHARMACY_RE.test(name)) continue;

    const scheduleNode = descendants(item, SHOPS_DOM.schedule)[0];
    const schedule = scheduleNode ? visibleText(scheduleNode).trim() : null;
    const key = addressKey(address);
    const dedupe = key ?? `${name}|${address.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ name, address, schedule, key, settlement: settlementFromAddress(address), format: detectShopFormat(name) });
  }
  return out;
}

/** Фикстуры лежат несколькими файлами (один запрос = ≤50 карточек), поэтому объединяем. */
export function parseShopsFixtures(files: { name: string; html: string }[]): { shops: SiteShop[]; byFile: Record<string, number> } {
  const all: SiteShop[] = [];
  const byFile: Record<string, number> = {};
  const keys = new Set<string>();
  for (const file of files) {
    const shops = parseShopsHtml(file.html);
    byFile[file.name] = shops.length;
    for (const shop of shops) {
      const dedupe = shop.key ?? `${shop.name}|${shop.address.toLowerCase()}`;
      if (keys.has(dedupe)) continue;
      keys.add(dedupe);
      all.push(shop);
    }
  }
  return { shops: all, byFile };
}

/**
 * Идентичность магазина для подсчёта полноты: ключ адреса, а если адреса нет (в OSM
 * это большинство точек) — собственный id, иначе все «адрес не указан» схлопнулись бы в один.
 */
export function storeIdentity(address: string, fallbackId: string): string {
  return addressKey(address) ?? `osm:${fallbackId}`;
}

export type MergeCount = { osm: number; site: number; matched: number; siteOnly: number; total: number };

/**
 * П.4 задачи: полнота после импорта = OSM-точки + магазины только с сайта. Считается по
 * тем же ключам адресов, что и боевое слияние, поэтому тест на фикстурах проверяет ровно
 * то же свойство, что выполняет job, но без сети и без базы.
 */
export function mergedCount(osm: { id: string; address: string }[], siteShops: SiteShop[]): MergeCount {
  const identities = new Set(osm.map((store) => storeIdentity(store.address, store.id)));
  const osmKeys = new Set(
    osm.map((store) => addressKey(store.address)).filter((key): key is string => key !== null),
  );
  let matched = 0;
  let siteOnly = 0;
  for (const shop of siteShops) {
    const id = shop.key ?? `site:${shop.address.toLowerCase()}`;
    if (shop.key && osmKeys.has(shop.key)) {
      matched++;
      continue;
    }
    if (identities.has(id)) continue;
    identities.add(id);
    siteOnly++;
  }
  return { osm: osm.length, site: siteShops.length, matched, siteOnly, total: identities.size };
}

export type { HtmlElement };
