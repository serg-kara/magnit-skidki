import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, type Browser, type Page } from '@playwright/test';
import { BOT_USER_AGENT } from '@/config/http';
import { BlockedError, info, parseArgs, withSyncLog, type SyncLogState } from '@/lib/jobs';
import { assertNotBlocked, looksLikeCaptcha, markBlocked, waitTurn } from '@/lib/politeness';
import { isAllowed, loadRobots, type RobotsRule } from '@/lib/robots';
import { prisma } from '@/lib/prisma';
import { addressKey, cityNamesMatch } from '@/lib/parse/normalize';
import { geocode } from '@/lib/geocode';
import { parseShopsHtml, type SiteShop } from './extract-shops';
import { MAGNIT_ORIGIN, SHOPS_PAGE, SHOP_CHIPS, SHOP_QUERY_FALLBACK, SHOP_QUERY_TEMPLATES } from './selectors';
import { FIXTURE_DIR } from './parse-magnit';

/**
 * П.1 задачи: полнота списка магазинов. OSM по этим краям даёт десятки точек (в
 * Курганинске вообще три), поэтому берём публичную страницу адресов magnit.ru /shops
 * и сливаем её с OSM: совпал по адресу — координаты остаются из OSM, есть только на
 * сайте — геокодер, есть только в OSM — не трогаем.
 *
 * Что измерено на живом рендере 27.11.2026 и учтено в конструкции:
 *  - одна выдача поиска упирается в 50 карточек, пагинации и подгрузки скроллом нет;
 *  - сортировка выдачи — по близости к магазину, выбранному в шапке (cookie `shopCode`),
 *    поэтому город в 400 км от выбранного магазина в первые 50 карточек не влезает;
 *  - выход — разбиение запроса: сначала шаблоны улиц × чипы формата, затем, если города
 *    всё ещё мало, запросы вида «<город>, <номер дома>». Всё дедуплицируется по
 *    ключу адреса, поэтому union не раздувается дублями.
 *
 * Режимы:
 *   npm run sync:shops -- --live --city=stavropol   — снять фикстуры и залить в БД
 *   npm run sync:shops                              — залить в БД из уже снятых фикстур
 *   --no-geocode — не создавать магазины без координат из OSM (только совпадения)
 */

const DISMISS_BUTTONS = [/^не сейчас$/i, /^хорошо, закрыть$/i, /^закрыть$/i];

/** П.4 задачи: нижние границы полноты по городам первого контура. */
export const COMPLETENESS_TARGETS: Record<string, number> = {
  stavropol: 100,
  nevinnomyssk: 40,
  kurganinsk: 10,
  armavir: 20,
  krasnodar: 150,
};
const DEFAULT_TARGET = 10;

function fixturePath(citySlug: string): string {
  return path.join(FIXTURE_DIR, `stores--${citySlug}.html`);
}

/** osmId — уникальный ключ; для магазина «только с сайта» строим его из адреса. */
function siteStoreId(shop: SiteShop): string {
  const basis = `${shop.settlement ?? ''}|${shop.key ?? shop.address}`.toLowerCase();
  return `magnit:${createHash('sha1').update(basis).digest('hex').slice(0, 24)}`;
}

async function closePrompts(page: Page): Promise<void> {
  for (const name of DISMISS_BUTTONS) {
    const button = page.getByRole('button', { name }).first();
    if (await button.isVisible({ timeout: 1_200 }).catch(() => false)) {
      await button.click().catch(() => undefined);
      await page.waitForTimeout(700);
    }
  }
}

async function openList(page: Page, robots: RobotsRule[]): Promise<void> {
  const url = `${MAGNIT_ORIGIN}${SHOPS_PAGE.path}`;
  if (!isAllowed(robots, url)) throw new BlockedError(`${url} запрещён robots.txt`);
  await waitTurn();
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  if (!response) throw new BlockedError(`Нет ответа от ${url}`);
  if (response.status() === 403 || response.status() === 429) {
    await markBlocked(`HTTP ${response.status()} on ${url}`);
    throw new BlockedError(`${url}: HTTP ${response.status()} — стоп, повтор через час`);
  }
  await page.waitForSelector(SHOPS_PAGE.item, { timeout: 25_000 }).catch(() => undefined);
  await closePrompts(page);
  const toggle = page.locator(`${SHOPS_PAGE.viewToggle} >> text=${SHOPS_PAGE.viewToggleText}`).first();
  if (await toggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await toggle.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(2_500);
  }
}

/** Запрос в поле поиска страницы и возврат outerHTML карточек текущей выдачи. */
async function searchItems(page: Page, query: string, chip?: string): Promise<string[]> {
  const search = page.locator(SHOPS_PAGE.searchInput).first();
  await waitTurn();
  await search.fill(query);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(5_500);

  if (chip && chip !== 'Все') {
    const chipNode = page.locator(`${SHOPS_PAGE.chipsGroup} >> text=${chip}`).first();
    if (!(await chipNode.isVisible({ timeout: 1_500 }).catch(() => false))) return [];
    await waitTurn();
    await chipNode.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(4_500);
  }

  const items = await page
    .locator(SHOPS_PAGE.item)
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).outerHTML));
  if (items.some((html) => looksLikeCaptcha(html))) {
    await markBlocked(`captcha on ${SHOPS_PAGE.path}`);
    throw new BlockedError('В выдаче /shops признаки капчи — стоп, повтор не раньше чем через час');
  }
  return items;
}

/** Собираем карточки города: базовые шаблоны, затем номера домов, если полноты не хватает. */
async function captureCity(
  page: Page,
  city: { slug: string; name: string },
  robots: RobotsRule[],
  log: SyncLogState,
): Promise<number> {
  await openList(page, robots);
  const target = COMPLETENESS_TARGETS[city.slug] ?? DEFAULT_TARGET;
  const collected = new Map<string, { html: string; shop: SiteShop }>();

  const absorb = (items: string[]) => {
    for (const html of items) {
      const shop = parseShopsHtml(`<div class="shops-page__list">${html}</div>`)[0];
      if (!shop) continue;
      const key = shop.key ?? `${shop.name}|${shop.address.toLowerCase()}`;
      if (!collected.has(key)) collected.set(key, { html, shop });
    }
  };
  const cityCount = () =>
    [...collected.values()].filter(({ shop }) => !shop.settlement || cityNamesMatch(shop.settlement, city.name)).length;

  const queries: [string, string | undefined][] = [];
  for (const template of SHOP_QUERY_TEMPLATES) {
    for (const chip of SHOP_CHIPS) queries.push([template.replace('{city}', city.name), chip]);
  }
  for (const [query, chip] of queries) {
    const before = collected.size;
    absorb(await searchItems(page, query, chip));
    info(`${city.name}: «${query}» / ${chip ?? 'Все'} → новых ${collected.size - before}, в городе ${cityCount()}/${target}`);
    if (cityCount() >= target) break;
  }

  // Запасной проход по номерам домов: поиск матчит целые токены, поэтому «город, ул А»
  // на живом рендере не дало ни одной новой карточки, а цифры работают.
  if (cityCount() < target) {
    info(`${city.name}: после ${queries.length} запросов в городе ${cityCount()} из ${target} — иду по номерам`);
    for (const template of SHOP_QUERY_FALLBACK) {
      const query = template.replace('{city}', city.name);
      const before = collected.size;
      absorb(await searchItems(page, query));
      info(`${city.name}: «${query}» → новых ${collected.size - before}, в городе ${cityCount()}/${target}`);
      if (cityCount() >= target) break;
    }
  }

  const entries = [...collected.values()];
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
  await fs.writeFile(
    fixturePath(city.slug),
    `<!-- снято с ${MAGNIT_ORIGIN}${SHOPS_PAGE.path} ${new Date().toISOString()}; одна выдача поиска = не больше 50 карточек,` +
      ` поэтому карточки объединены из нескольких запросов и дедуплицированы по адресу -->\n` +
      `<div class="shops-page__list">\n${entries.map((entry) => entry.html).join('\n')}\n</div>\n`,
    'utf8',
  );
  log.message.push(`${city.name}: карточек ${entries.length}, в городе ${cityCount()}/${target}`);
  info(`${city.name}: собрано карточек ${entries.length}, из них город ${cityCount()} (цель ${target})`);
  return entries.length;
}

async function readFixture(citySlug: string): Promise<SiteShop[]> {
  try {
    const html = await fs.readFile(fixturePath(citySlug), 'utf8');
    return parseShopsHtml(html);
  } catch {
    return [];
  }
}

type MergeStats = {
  site: number;
  matched: number;
  created: number;
  geocoded: number;
  withoutCoords: number;
  foreignCity: number;
};

/**
 * П.2 задачи: слияние по нормализованному адресу. Индекс — по магазинам целевого города:
 * ключ «улица|дом» без населённого пункта, и «Ленина, 5» в двух районах — разные точки.
 */
async function mergeShops(cityId: number, cityName: string, shops: SiteShop[], useGeocoder: boolean): Promise<MergeStats> {
  const stats: MergeStats = { site: shops.length, matched: 0, created: 0, geocoded: 0, withoutCoords: 0, foreignCity: 0 };
  const existing = await prisma.store.findMany({
    where: { cityId },
    select: { id: true, name: true, format: true, address: true },
  });
  const byKey = new Map<string, { id: number; name: string; format: string; address: string }>();
  for (const store of existing) {
    const key = addressKey(store.address);
    if (key && !byKey.has(key)) byKey.set(key, store);
  }

  for (const shop of shops) {
    if (shop.settlement && !cityNamesMatch(shop.settlement, cityName)) {
      stats.foreignCity++;
      continue;
    }
    const hit = shop.key ? byKey.get(shop.key) : undefined;
    if (hit) {
      stats.matched++;
      // Координаты остаются OSM-ные: сайт их не отдаёт. От сайта берём только то, чего
      // в OSM нет — точное имя формата и формат.
      if (hit.name === 'Магнит' && shop.name !== 'Магнит') {
        await prisma.store.update({ where: { id: hit.id }, data: { name: shop.name, format: shop.format } });
      } else if (hit.format === 'unknown' && shop.format !== 'unknown') {
        await prisma.store.update({ where: { id: hit.id }, data: { format: shop.format } });
      }
      continue;
    }
    if (!useGeocoder) {
      stats.withoutCoords++;
      continue;
    }
    const point = await geocode(shop.address, cityName);
    // Без координат магазин не создаём: карта рисует точки, а не обещания (§0.4 — не выдумывать).
    if (!point) {
      stats.withoutCoords++;
      continue;
    }
    stats.geocoded++;
    const created = await prisma.store.create({
      data: {
        cityId,
        name: shop.name,
        format: shop.format,
        address: shop.address,
        lat: point.lat,
        lng: point.lng,
        osmId: siteStoreId(shop),
      },
    });
    if (shop.key) byKey.set(shop.key, { id: created.id, name: created.name, format: created.format, address: created.address });
    stats.created++;
  }
  return stats;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const live = args.live === 'true';
  const useGeocoder = args['no-geocode'] !== 'true';

  const cities = await prisma.city.findMany({
    where: args.city ? { slug: args.city } : undefined,
    orderBy: { id: 'asc' },
  });
  if (!cities.length) throw new Error(`Город «${args.city ?? '?'}» не найден в базе — сначала npm run sync:stores`);

  let browser: Browser | null = null;
  let robots: RobotsRule[] = [];
  if (live) {
    await assertNotBlocked(args.force === 'true');
    robots = await loadRobots(MAGNIT_ORIGIN);
    browser = await chromium.launch({ headless: true });
  }
  try {
    const summary = await withSyncLog('stores', async (log) => {
      let created = 0;
      let matched = 0;
      let citiesOk = 0;
      if (browser) {
        const context = await browser.newContext({
          userAgent: BOT_USER_AGENT,
          locale: 'ru-RU',
          viewport: { width: 1_440, height: 2_400 },
        });
        const page = await context.newPage();
        for (const city of cities) await captureCity(page, { slug: city.slug, name: city.name }, robots, log);
        await context.close();
      }
      for (const city of cities) {
        const shops = await readFixture(city.slug);
        if (!shops.length) {
          log.message.push(`${city.name}: фикстуры нет — пропуск`);
          info(`${city.name}: нет фикстуры stores--${city.slug}.html, пропускаем`);
          continue;
        }
        const stats = await mergeShops(city.id, city.name, shops, useGeocoder);
        citiesOk++;
        created += stats.created;
        matched += stats.matched;
        log.message.push(
          `${city.name}: сайт ${stats.site}, совпало с OSM ${stats.matched}, новых ${stats.created} (геокодировано ${stats.geocoded}), вне города ${stats.foreignCity}, без координат ${stats.withoutCoords}`,
        );
        info(
          `${city.name}: сайт ${stats.site}, совпало ${stats.matched}, новых ${stats.created}, геокодировано ${stats.geocoded}, без координат ${stats.withoutCoords}, другой город ${stats.foreignCity}`,
        );
      }
      return { citiesOk, itemsNew: created, itemsSeen: created + matched };
    });
    info(`Импорт списка магазинов завершён: городов ${summary.citiesOk}, новых ${summary.itemsNew}, всего ${summary.itemsSeen}`);
  } finally {
    if (browser) await browser.close();
  }
}

if (require.main === module) {
  void main()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
