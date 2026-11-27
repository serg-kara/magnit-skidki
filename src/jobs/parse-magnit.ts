import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { BOT_USER_AGENT } from '@/config/http';
import { BlockedError, info, parseArgs, withSyncLog, type SyncLogState } from '@/lib/jobs';
import { assertNotBlocked, markBlocked, waitTurn } from '@/lib/politeness';
import { loadRobots, isAllowed, type RobotsRule } from '@/lib/robots';
import { cityFromTitle, cityNamesMatch } from '@/lib/parse/normalize';
import { prisma } from '@/lib/prisma';
import { extractCards, readPageTitle } from './extract-cards';
import { saveCards, type SaveContext } from './save-promotions';
import { ALCOHOL_SECTION_ID, MAGNIT_ORIGIN, PICKER_BUTTONS, SECTIONS } from './selectors';

export const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'magnit');

type CityJob = { slug: string; name: string; magnitCityId: string; magnitCityName: string; storeIds: number[] };

async function prepareCities(cityArg: string | undefined, log: SyncLogState): Promise<CityJob[]> {
  const cities = await prisma.city.findMany({
    where: { sourceMap: cityArg ? { city: { slug: cityArg } } : undefined },
    include: { sourceMap: true, stores: { select: { id: true } } },
  });
  const jobs: CityJob[] = [];
  for (const city of cities) {
    if (!city.sourceMap) {
      // §8: город без связи с magnit.ru помечается skipped и не получает чужих акций.
      log.message.push(`${city.name}: skipped (нет SourceCityMap)`);
      info(`Город ${city.name}: нет связи с magnit.ru — skipped`);
      continue;
    }
    jobs.push({
      slug: city.slug,
      name: city.name,
      magnitCityId: city.sourceMap.magnitCityId,
      magnitCityName: city.sourceMap.magnitCityName,
      storeIds: city.stores.map((s) => s.id),
    });
  }
  return jobs;
}

/**
 * §4.1.4: magnit.ru привязывает каталог акций к конкретному магазину (не «городу»):
 * в ссылках сайта это `?shopCode=…`, а адрес выбранного магазина попадает в <title>.
 * В SourceCityMap magnitCityId хранит именно shopCode, magnitCityName — город, который
 * мы в этом магазине и ожидаем увидеть.
 *
 * Модалка «Выберите магазин или адрес» перекрывает карточки: вариант «Не сейчас» прячет
 * цены, поэтому магазин пробуем выбрать; если выбора нет — остаёмся на shopCode из URL
 * и читаем то, что отдал сервер.
 */
async function dismissShopPicker(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: PICKER_BUTTONS.shopSkip.nameRegex }).first();
  if (await skip.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await skip.click().catch(() => undefined);
    await page.waitForTimeout(1_000);
  }
}

async function dismissAgeModal(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: PICKER_BUTTONS.ageConfirm.nameRegex }).first();
  if (!(await button.isVisible({ timeout: 1_500 }).catch(() => false))) return;
  // Это штатное пользовательское действие («мне есть 18»), а не обход защиты (§4.2).
  await button.click().catch(() => undefined);
  await page.waitForTimeout(1_000);
}

function assertNoCaptcha(html: string, url: string): void {
  const captcha = /(g-recaptcha|h-captcha|cf_chl_|are you a robot|подтвердите,? что вы не робот)/i.test(
    html.slice(0, 200_000),
  );
  if (captcha) {
    void markBlocked(`captcha on ${url}`);
    throw new BlockedError(`Капча на ${url} — останавливаем прогон, повтор не раньше чем через час`);
  }
}

/** §4.1.1: реальные URL разделов акций находим по ссылкам на странице, а не берём из головы. */
export async function discoverSections(page: Page, robots: RobotsRule[]): Promise<{ title: string; url: string }[]> {
  await page.goto(`${MAGNIT_ORIGIN}/sales`, { waitUntil: 'domcontentloaded' });
  const links = await page.$$eval('a[href]', (nodes) =>
    nodes.map((a) => ({ text: (a.textContent ?? '').trim(), href: a.getAttribute('href') ?? '' })),
  );
  const found: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (!/(акци|скидк|sale|promo)/i.test(link.text) && !/sales?|promo/i.test(link.href)) continue;
    let absolute: string;
    try {
      absolute = new URL(link.href, MAGNIT_ORIGIN).toString();
    } catch {
      continue;
    }
    if (seen.has(absolute) || !isAllowed(robots, absolute)) continue;
    seen.add(absolute);
    found.push({ title: link.text || path.basename(new URL(absolute).pathname), url: absolute });
  }
  await fs.mkdir(path.dirname(FIXTURE_DIR), { recursive: true });
  await fs.writeFile(
    path.join(process.cwd(), 'data', 'discovered-sections.json'),
    JSON.stringify({ discoveredAt: new Date().toISOString(), origin: MAGNIT_ORIGIN, sections: found }, null, 2),
    'utf8',
  );
  info(`Найдено разделов акций: ${found.length} (список в data/discovered-sections.json)`);
  return found;
}

async function runCity(browser: Browser, job: CityJob, robots: RobotsRule[], onlySlug?: string) {
  const context = await browser.newContext({ userAgent: BOT_USER_AGENT, locale: 'ru-RU' });
  const page = await context.newPage();
  try {
    const taken = new Set(
      (await prisma.product.findMany({ select: { slug: true } })).map((p) => p.slug),
    );
    const ctx: SaveContext = { storeIds: job.storeIds, scope: 'federal', takenProductSlugs: taken };

    let created = 0;
    let seen = 0;
    let skippedSections = 0;
    let droppedTobacco = 0;
    let cardsTotal = 0;
    let cardsWithPrices = 0;

    for (const section of SECTIONS) {
      if (onlySlug && section.slug !== onlySlug) continue;
      const url = new URL(section.path, MAGNIT_ORIGIN);
      url.searchParams.set('shopCode', job.magnitCityId);
      const href = url.toString();
      if (!isAllowed(robots, href)) {
        info(`${href} запрещён robots.txt — пропускаем`);
        skippedSections++;
        continue;
      }

      await waitTurn();
      const response = await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      if (!response) throw new BlockedError(`Нет ответа от ${href}`);
      if (response.status() === 403 || response.status() === 429) {
        await markBlocked(`HTTP ${response.status()} on ${href}`);
        throw new BlockedError(`${href}: HTTP ${response.status()} — стоп, повтор через час`);
      }

      await page.waitForSelector('.unit-catalog-product-preview', { timeout: 30_000 }).catch(() => undefined);
      await dismissShopPicker(page);
      // Модалку «18+» закрываем до снимка: иначе фикстура и разбор будут про заглушку (§4.2).
      if (section.id === ALCOHOL_SECTION_ID) await dismissAgeModal(page);

      const pageHtml = await page.content();
      assertNoCaptcha(pageHtml, href);

      // §4.1.4: адрес выбранного магазина попадает в <title> — по нему и сверяем город.
      const title = readPageTitle(pageHtml);
      const pageCity = cityFromTitle(title);
      if (!pageCity || !cityNamesMatch(pageCity, job.magnitCityName)) {
        throw new BlockedError(
          `Страница «${title ?? 'без title'}» не про ${job.magnitCityName} — акции не пишутся в ${job.name}`,
        );
      }

      await fs.mkdir(FIXTURE_DIR, { recursive: true });
      await fs.writeFile(path.join(FIXTURE_DIR, `real--${job.slug}--${section.id}.html`), pageHtml, 'utf8');

      const result = extractCards(pageHtml, { categorySlug: section.slug, baseUrl: href });
      droppedTobacco += result.droppedTobacco;
      cardsTotal += result.cards.length;
      cardsWithPrices += result.cards.filter((c) => c.priceNew !== null || c.priceOld !== null).length;
      const saved = await saveCards(result.cards, ctx);
      created += saved.created;
      seen += saved.seen;
      info(
        `${job.name} / ${section.title}: карточек ${result.cards.length} из ${result.totalCards}, новых ${saved.created}, с ценами ${result.cards.filter((c) => c.priceNew !== null || c.priceOld !== null).length}`,
      );
    }

    // §0.4: страница не отдала данных — это ошибка синхронизации, а не пустые карточки
    // и не повод «добывать» доступ другим способом.
    if (cardsTotal > 0 && cardsWithPrices === 0) {
      throw new BlockedError(
        `${job.name}: карточек ${cardsTotal}, но цен нет ни у одной — сайт отдаёт цены только после выбора магазина в шапке`,
      );
    }

    return { created, seen, droppedTobacco, skippedSections };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await assertNotBlocked(args.force === 'true');
  const robots = await loadRobots(MAGNIT_ORIGIN);

  if (args.discover === 'true') {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: BOT_USER_AGENT });
    await discoverSections(page, robots);
    await browser.close();
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const summary = await withSyncLog('promotions', async (log) => {
      const jobs = await prepareCities(args.city, log);
      if (!jobs.length) {
        log.message.push('Ни у одного города нет SourceCityMap — парсить нечего');
        return { citiesOk: 0, itemsNew: 0, itemsSeen: 0 };
      }

      let citiesOk = 0;
      let itemsNew = 0;
      let itemsSeen = 0;
      for (const job of jobs) {
        try {
          const res = await runCity(browser, job, robots, args.only);
          citiesOk++;
          itemsNew += res.created;
          itemsSeen += res.seen + res.created;
          if (res.droppedTobacco) log.message.push(`${job.name}: отброшено табачных карточек ${res.droppedTobacco}`);
        } catch (err) {
          const blocked = err instanceof BlockedError;
          log.status = blocked ? 'blocked' : 'error';
          log.message.push(`${job.name}: ${(err as Error).message}`);
          info(`Пропуск города ${job.name}: ${(err as Error).message}`);
          if (blocked) break; // кулдаун на весь запуск (§0.4)
        }
      }
      return { citiesOk, itemsNew, itemsSeen };
    });
    info(`Промо-синк завершён: городов ${summary.citiesOk}, новых ${summary.itemsNew}, всего ${summary.itemsSeen}`);
  } finally {
    await browser.close();
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
