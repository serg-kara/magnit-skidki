import 'dotenv/config';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { BOT_USER_AGENT } from '@/config/http';
import { BlockedError, info, parseArgs } from '@/lib/jobs';
import { assertNotBlocked, looksLikeCaptcha, markBlocked, waitTurn } from '@/lib/politeness';
import { isAllowed, loadRobots, type RobotsRule } from '@/lib/robots';
import { prisma } from '@/lib/prisma';
import { cityFromTitle, cityNamesMatch, settlementFromAddress } from '@/lib/parse/normalize';
import { MAGNIT_ORIGIN, SHOP_PICKER, SECTIONS } from './selectors';

/**
 * П.4 задачи: чем заполнить SourceCityMap, чтобы npm run sync:promotions вообще смог
 * работать.
 *
 * Что измерено на живом рендере 27.11.2026:
 *  - переключателя ГОРОДА на сайте нет — есть переключатель МАГАЗИНА в шапке
 *    (`button.pl-shop-select-bar`), его выбор кладёт код в cookie `shopCode`
 *    (браузер хранит значение URL-кодированным: `%22992336%22` → `"992336"`);
 *  - карточка кликабельна только своей кнопкой `button.pl-button-inline` («Выбрать»):
 *    клик по тексту адреса или по контейнеру куку не пишет;
 *  - промо-страница считает магазин выбранным, только когда код есть И в cookie, И в
 *    URL (`?shopCode=`): параметр без куки → город по IP, кука без параметра → в
 *    <title> нет адреса вовсе;
 *  - адрес магазина приезжает в <title> после гидрации Nuxt, поэтому читаем его не
 *    сразу после goto.
 *
 * В базу пишем только те коды, для которых город удалось подтвердить так же, как это
 * делает парсер (§4.1.4): иначе прогон всё равно уйдёт в blocked. Часть магазинов сайт
 * подписывает адресом без названия города — такие карточки просто пробуем следующими.
 *
 * Запуск:
 *   npm run sync:citymap                     — все города первого контура из БД
 *   npm run sync:citymap -- --city=stavropol
 *   npm run sync:citymap -- --tries=5        — сколько карточек города перебрать
 */

const PROMPT_DISMISS = [/^не сейчас$/i, /^хорошо, закрыть$/i, /^закрыть$/i];
const DEFAULT_TRIES = 3;
const RENDER_WAIT_MS = 12_000;

async function closePrompts(page: Page): Promise<void> {
  for (const name of PROMPT_DISMISS) {
    const button = page.getByRole('button', { name }).first();
    if (await button.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await button.click().catch(() => undefined);
      await page.waitForTimeout(1_500);
    }
  }
}

/** Cookie `shopCode` сайта — JSON-строка, в браузере ещё и URL-кодированная. */
async function shopCodeOf(context: BrowserContext): Promise<string | null> {
  const cookie = (await context.cookies(MAGNIT_ORIGIN)).find((c) => c.name === 'shopCode');
  if (!cookie) return null;
  const value = decodeURIComponent(cookie.value).replace(/^"|"$/g, '').trim();
  return value || null;
}

/** Индексы карточек, адрес которых реально про этот город (а не про его край). */
async function cityCardIndices(page: Page, cityName: string): Promise<number[]> {
  const items = page.locator(SHOP_PICKER.item);
  const count = await items.count();
  const hits: number[] = [];
  for (let i = 0; i < count; i++) {
    const text = (await items.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const settlement = settlementFromAddress(text);
    if (settlement && cityNamesMatch(settlement, cityName)) hits.push(i);
  }
  return hits;
}

/** Открывает переключатель и вводит название города; false, если поля нет. */
async function openPicker(page: Page, cityName: string): Promise<boolean> {
  await page.locator(SHOP_PICKER.openButton).first().click({ timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(6_000);
  const tab = page.locator(SHOP_PICKER.panel).getByText(SHOP_PICKER.tabPickup, { exact: true }).first();
  if (await tab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await tab.click().catch(() => undefined);
    await page.waitForTimeout(6_000);
  }
  const input = page.locator(SHOP_PICKER.addressInput).first();
  if (!(await input.isVisible({ timeout: 5_000 }).catch(() => false))) return false;
  await input.fill('');
  await input.fill(cityName);
  await page.waitForTimeout(RENDER_WAIT_MS);
  return true;
}

/** Штатный клик по кнопке «Выбрать» в карточке. */
async function clickPick(page: Page, index: number): Promise<void> {
  const item = page.locator(SHOP_PICKER.item).nth(index);
  await item.scrollIntoViewIfNeeded().catch(() => undefined);
  const button = item.locator(SHOP_PICKER.itemPick).first();
  const clicked = await button
    .click({ timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (clicked) return;
  // На узком экране кнопка может быть перекрыта — жмём её же узлом, но из DOM.
  await item.evaluate((node) => {
    const btn = node.querySelector<HTMLButtonElement>('button.pl-button-inline');
    if (!btn) return;
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    btn.click();
  });
}

/**
 * Город страницы акций для данного shopCode. Сверка идёт в ТОМ ЖЕ прогретом контексте,
 * в котором магазин уже выбран кликом: холодная сессия только с cookie `shopCode` сайт
 * отправляет на заглушку доставки, и в <title> не появляется адрес (27.11.2026).
 */
async function promoCity(page: Page, robots: RobotsRule[], shopCode: string): Promise<string | null> {
  const url = new URL(SECTIONS[0].path, MAGNIT_ORIGIN);
  url.searchParams.set('shopCode', shopCode);
  if (!isAllowed(robots, url.toString())) throw new BlockedError(`${url} запрещён robots.txt`);
  await waitTurn();
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('.unit-catalog-product-preview', { timeout: 30_000 }).catch(() => undefined);
  // Адрес магазина приезжает в <title> после гидрации Nuxt; без ожидания читается SSR-заголовок.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !(await page.title()).includes('|')) {
    await page.waitForTimeout(1_500);
  }
  const html = await page.content();
  if (looksLikeCaptcha(html)) {
    await markBlocked(`captcha on ${url.pathname}`);
    throw new BlockedError('На странице акций признаки капчи — стоп, повтор не раньше чем через час');
  }
  return cityFromTitle(await page.title());
}

async function resolveCity(
  page: Page,
  robots: RobotsRule[],
  cityName: string,
  tries: number,
): Promise<{ code: string; shop: string; seenCity: string; attempts: number } | null> {
  if (!(await openPicker(page, cityName))) return null;
  const indices = (await cityCardIndices(page, cityName)).slice(0, tries);
  for (const [attempt, index] of indices.entries()) {
    await clickPick(page, index);
    await page.waitForTimeout(RENDER_WAIT_MS);
    const code = await shopCodeOf(page.context());
    if (!code) continue;
    const shop = (await page.locator(SHOP_PICKER.selectedBar).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const seenCity = await promoCity(page, robots, code);
    if (seenCity && cityNamesMatch(seenCity, cityName)) {
      return { code, shop, seenCity, attempts: attempt + 1 };
    }
    info(`${cityName}: карточка #${index} → shopCode=${code}, страница акций про «${seenCity ?? 'город не подписан'}» — пробуем следующую`);
    if (!(await openPicker(page, cityName))) break;
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tries = Number(args.tries ?? DEFAULT_TRIES) || DEFAULT_TRIES;

  await assertNotBlocked(args.force === 'true');
  const robots = await loadRobots(MAGNIT_ORIGIN);

  const cities = await prisma.city.findMany({
    where: args.city ? { slug: args.city } : undefined,
    orderBy: { id: 'asc' },
    select: { id: true, slug: true, name: true },
  });
  if (!cities.length) throw new Error('Города не найдены в базе — сначала npm run sync:stores');

  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: BOT_USER_AGENT, locale: 'ru-RU', viewport: { width: 1_440, height: 2_400 } });
  const page = await context.newPage();
  const report: string[] = [];
  let filled = 0;
  try {
    await waitTurn();
    await page.goto(MAGNIT_ORIGIN, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForTimeout(15_000);
    await closePrompts(page);

    for (const city of cities) {
      const found = await resolveCity(page, robots, city.name, tries);
      if (!found) {
        info(`${city.name}: подтверждённого shopCode нет — в базе остаётся прежнее значение`);
        report.push(`${city.name}: подтверждённого shopCode нет (перебрали ${tries} карточек)`);
        continue;
      }
      await prisma.sourceCityMap.upsert({
        where: { cityId: city.id },
        create: { cityId: city.id, magnitCityId: found.code, magnitCityName: city.name },
        update: { magnitCityId: found.code, magnitCityName: city.name },
      });
      filled++;
      report.push(`${city.name}: shopCode=${found.code} (проверок ${found.attempts}) — страница акций про «${found.seenCity}» ✅`);
      info(`${city.name}: shopCode=${found.code}, магазин «${found.shop.slice(0, 80)}»`);
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  info(`SourceCityMap заполнен для ${filled} из ${cities.length} городов:`);
  for (const line of report) info(`  ${line}`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err instanceof BlockedError ? `БЛОКИРОВКА: ${err.message}` : err);
    await prisma.$disconnect();
    process.exit(1);
  });
}
