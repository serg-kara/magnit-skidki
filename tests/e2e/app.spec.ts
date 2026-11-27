import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CITIES } from '@/config/cities';
import { transliterate } from '@/lib/translit';
import {
  apiTotal,
  cardCount,
  openStorePopup,
  resetBrowserState,
  stubOsmTiles,
  watchConsole,
} from './helpers';

const FIRST_CONTOUR = CITIES.map((city) => city.name);

/** Имя истёкшей акции берём из того же seed-файла, а не хардкодим (§7.1 + §7.3.9). */
const EXPIRED_PROMO_NAME: string = (() => {
  const sample = JSON.parse(
    readFileSync(path.join(process.cwd(), 'data', 'promotions.sample.json'), 'utf8'),
  ) as { promos: { name: string; expired?: boolean }[] };
  const expired = sample.promos.find((promo) => promo.expired);
  if (!expired) throw new Error('в data/promotions.sample.json нет истёкшей акции');
  return expired.name;
})();

test.beforeEach(async ({ page }) => {
  await stubOsmTiles(page);
});

test('1. / показывает 5 городов первого контура и ссылки на них', async ({ page }) => {
  await page.goto('/');
  const links = page.locator('[data-qa="city-link"]');
  await expect(links).toHaveCount(FIRST_CONTOUR.length);
  for (const name of FIRST_CONTOUR) {
    await expect(links.filter({ hasText: name })).toHaveCount(1);
  }
  for (const city of CITIES) {
    await expect(page.locator(`a[href="/${transliterate(city.name)}"]`)).toHaveCount(1);
  }
});

test('2. /stavropol — на карте есть минимум 1 маркер; консоль браузера без ошибок', async ({ page }) => {
  const errors = watchConsole(page);
  await resetBrowserState(page, '/stavropol');
  await expect(page.locator('[data-qa="map"]')).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon')).not.toHaveCount(0, {
    timeout: 20_000,
  });
  expect(errors()).toEqual([]);
});

test('3. клик по маркеру открывает попап с адресом и ссылкой на магазин', async ({ page }) => {
  await resetBrowserState(page, '/stavropol');
  await openStorePopup(page);

  const popup = page.locator('.leaflet-popup-content');
  await expect(popup.locator('[data-qa="popup-address"]')).toContainText(/\S/, { timeout: 5_000 });

  const link = popup.locator('[data-qa="popup-store-link"]');
  await expect(link).toHaveAttribute('href', /\/stavropol\/stores\/\d+/);
});

test('4. клик по акционной карточке ведёт в магазин; страница магазина содержит её название', async ({ page }) => {
  await resetBrowserState(page, '/stavropol');
  const card = page.locator('[data-qa="promo-store-link"]').first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  const title = (await card.textContent())?.trim() ?? '';
  expect(title.length).toBeGreaterThan(0);

  const href = await card.getAttribute('href');
  expect(href).toMatch(/^\/stavropol\/stores\/\d+$/);
  await card.click();
  await page.waitForURL('**/stavropol/stores/**');

  await expect(page.locator('[data-qa="store-title"]')).toBeVisible();
  await expect(page.locator('[data-qa="store-promotions"]')).toContainText(title);
});

test('5. фильтр категории меняет количество карточек', async ({ page }) => {
  await resetBrowserState(page, '/stavropol');
  await expect(page.locator('[data-qa="promo-title"]').first()).toBeVisible({ timeout: 20_000 });
  const before = await cardCount(page);
  expect(before).toBeGreaterThan(0);

  // Берём категорию, которая заведомо уже общей выдачи.
  const total = await apiTotal(page, 'city=stavropol&limit=200');
  const categories = await page.locator('[data-qa="filter-category"] option').allTextContents();
  let picked = '';
  for (const label of categories.slice(1)) {
    const slug = await page
      .locator('[data-qa="filter-category"] option', { hasText: label })
      .getAttribute('value');
    if (!slug) continue;
    const count = await apiTotal(page, `city=stavropol&category=${slug}&limit=200`);
    if (count > 0 && count < total) {
      picked = slug;
      break;
    }
  }
  expect(picked, 'в seed должна быть хотя бы одна категория уже общей выдачи').toBeTruthy();

  await page.selectOption('[data-qa="filter-category"]', picked);
  await expect
    .poll(async () => cardCount(page), { message: 'карточек должно стать меньше' })
    .toBeLessThan(before);
});

test('6. поиск по фрагменту названия находит товар, «zzzzzz» даёт пустое состояние', async ({ page }) => {
  await resetBrowserState(page, '/stavropol');
  await expect(page.locator('[data-qa="promo-title"]').first()).toBeVisible({ timeout: 20_000 });

  const firstTitle = (await page.locator('[data-qa="promo-title"]').first().textContent()) ?? '';
  const needle = firstTitle.trim().split(/\s+/)[0];
  expect(needle.length).toBeGreaterThan(2);

  await page.fill('[data-qa="filter-q"]', needle);
  await expect
    .poll(async () => {
      const titles = await page.locator('[data-qa="promo-title"]').allTextContents();
      return titles.every((title) => title.toLowerCase().includes(needle.toLowerCase())) &&
        titles.length > 0;
    })
    .toBe(true);

  await page.fill('[data-qa="filter-q"]', 'zzzzzz');
  await expect(page.locator('[data-qa="promotions-empty"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-qa="promo-title"]')).toHaveCount(0);
});

/**
 * Карточка для тестов избранного берётся из API с adult=exclude: первая по скидке
 * может оказаться алкоголем, а он до подтверждения возраста рендерится заглушкой
 * и на /favorites тоже.
 */
async function firstNonAdultTitle(page: Page): Promise<string> {
  const response = await page.request.get('/api/promotions?city=stavropol&adult=exclude&limit=1');
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { items: { productName: string }[] };
  expect(body.items.length).toBeGreaterThan(0);
  return body.items[0].productName;
}

test('7. звезда добавляет товар в избранное; на /favorites он есть; повторный клик убирает', async ({ page }) => {
  await resetBrowserState(page, '/stavropol');
  const title = await firstNonAdultTitle(page);
  const card = page.locator('[data-qa="promotions-list"] > *', { hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });

  await card.locator('[data-qa="favorite-toggle"]').click();
  await expect(card.locator('[data-qa="favorite-toggle"]')).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/favorites');
  await expect(page.locator('[data-qa="favorite-name"]')).toContainText(title);

  await page.goto('/stavropol');
  await page
    .locator('[data-qa="promotions-list"] > *', { hasText: title })
    .first()
    .locator('[data-qa="favorite-toggle"]')
    .click();

  await page.goto('/favorites');
  await expect(page.locator('[data-qa="favorites-empty"]')).toBeVisible();
});

test('8. избранное переживает перезагрузку страницы', async ({ page }) => {
  await resetBrowserState(page, '/stavropol');
  const title = await firstNonAdultTitle(page);
  const card = page.locator('[data-qa="promotions-list"] > *', { hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.locator('[data-qa="favorite-toggle"]').click();

  await page.reload();
  await expect(page.locator('[data-qa="promo-title"]').first()).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => {
      const pressed = await page
        .locator('[data-qa="promotions-list"] > *', { hasText: title })
        .first()
        .locator('[data-qa="favorite-toggle"]')
        .getAttribute('aria-pressed');
      return pressed === 'true';
    })
    .toBe(true);

  await page.goto('/favorites');
  await expect(page.locator('[data-qa="favorite-name"]').first()).toContainText(title);
  await page.reload();
  await expect(page.locator('[data-qa="favorite-name"]').first()).toContainText(title);
});

test('9. истёкшая акция из seed не видна ни в списке, ни на карте', async ({ page }) => {
  await resetBrowserState(page, '/stavropol');
  await expect(page.locator('[data-qa="promo-title"]').first()).toBeVisible({ timeout: 20_000 });

  const expiredName = EXPIRED_PROMO_NAME;
  const titles = await page.locator('[data-qa="promo-title"]').allTextContents();
  expect(titles.filter((title) => title.includes(expiredName))).toEqual([]);

  const response = await page.request.get('/api/promotions?city=stavropol&limit=200');
  const body = (await response.json()) as { items: { productName: string }[] };
  expect(body.items.some((item) => item.productName.includes(expiredName))).toBe(false);

  // На карте в превью попапа истёкшей акции тоже быть не должно.
  await openStorePopup(page);
  const popup = page.locator('.leaflet-popup-content');
  await expect(popup).toBeVisible();
  await expect(popup).not.toContainText(expiredName);
});

test('10. алкоголь скрыт до подтверждения возраста; после — виден; табака в категориях нет', async ({ page }) => {
  await resetBrowserState(page, '/stavropol');
  await expect(page.locator('[data-qa="promotions-list"]')).toBeVisible({ timeout: 20_000 });

  // Без подтверждения алкоголя не видно: карточки заменены заглушкой.
  // not.toContainText по списку локаторов даёт strict-mode violation, поэтому считаем
  // заголовки с алкогольными названиями отдельно — их должно быть ровно ноль.
  await expect(page.locator('[data-qa="age-stub"]').first()).toBeVisible();
  await expect(
    page.locator('[data-qa="promo-title"]', { hasText: /вино|шампан|водк|коньяк|виски/i }),
  ).toHaveCount(0);

  // Включаем фильтр алкоголя — появляется модальное окно.
  await page.check('[data-qa="filter-alcohol"]');
  await expect(page.locator('[data-qa="age-modal"]')).toBeVisible();
  await page.click('[data-qa="age-yes"]');
  await expect(page.locator('[data-qa="age-modal"]')).toHaveCount(0);

  await expect
    .poll(async () => {
      const titles = await page.locator('[data-qa="promo-title"]').allTextContents();
      return titles.some((title) => /вино|шампан|водк|коньяк|пив|виски/i.test(title));
    })
    .toBe(true);
  await expect(page.locator('[data-qa="age-stub"]')).toHaveCount(0);

  // Табак не должен появляться ни в фильтре, ни в выдаче (§4.2).
  const options = await page.locator('[data-qa="filter-category"] option').allTextContents();
  expect(options.join(' ')).not.toMatch(/табак|сигарет|tabak|vape|iqos/gi);

  const response = await page.request.get('/api/promotions?city=stavropol&limit=200');
  const body = (await response.json()) as { items: { productName: string; category: { name: string } | null }[] };
  expect(
    body.items.some((item) =>
      /сигарет|табак|папирос|iqos|glo/i.test(`${item.productName} ${item.category?.name ?? ''}`),
    ),
  ).toBe(false);
});

test('11. /api/promotions?city=kurganinsk → 200, total > 0, у каждой записи есть productName и scope', async ({
  page,
}) => {
  const response = await page.request.get('/api/promotions?city=kurganinsk');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    total: number;
    items: { productName: string; scope: string }[];
  };
  expect(body.total).toBeGreaterThan(0);
  expect(body.items.length).toBeGreaterThan(0);
  for (const item of body.items) {
    expect(typeof item.productName).toBe('string');
    expect(item.productName.length).toBeGreaterThan(0);
    expect(['federal', 'store']).toContain(item.scope);
  }
});

test('12. /api/promotions?city=no-such → 404', async ({ page }) => {
  const response = await page.request.get('/api/promotions?city=no-such');
  expect(response.status()).toBe(404);
  const body = (await response.json()) as { error: string };
  expect(body.error).toContain('no-such');
});

test('13. /nonexistent-city → страница 404 приложения, не крэш', async ({ page }) => {
  await stubOsmTiles(page);
  const response = await page.goto('/nonexistent-city');
  expect(response?.status()).toBe(404);
  await expect(page.locator('[data-qa="not-found-title"]')).toBeVisible();
  await expect(page.locator('[data-qa="brand"]')).toBeVisible();
});
