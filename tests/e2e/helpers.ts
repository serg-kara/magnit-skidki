import { expect, type Page } from '@playwright/test';

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Тайлы OSM — единственный внешний ресурс интерфейса. В тесте он подменяется локальной
 * заглушкой: §9.2 требует прохождения e2e без выхода в интернет, а неудавшаяся загрузка
 * тайлов замусорила бы консоль и ломала бы проверку «консоль без ошибок».
 */
export async function stubOsmTiles(page: Page): Promise<void> {
  await page.route(/tile\.openstreetmap\.org/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG });
  });
}

/** Собирает console.error и pageerror; возвращает функцию для проверки «всё чисто». */
export function watchConsole(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  // 4xx/5xx на наших же маршрутах — тоже ошибка клиента; ожидаемые 404 из тестов 12–13 исключаем.
  page.on('response', (response) => {
    const url = response.url();
    const expected = url.includes('no-such') || url.includes('nonexistent-city');
    if (response.status() >= 400 && !expected) {
      errors.push(`http ${response.status()}: ${url}`);
    }
  });
  return () => errors;
}

/** Снимает localStorage, чтобы тесты возраста и избранного не наследовали состояние. */
export async function resetBrowserState(page: Page, url = '/'): Promise<void> {
  await page.goto('/api/health');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(url);
}

export async function cardCount(page: Page): Promise<number> {
  return page.locator('[data-qa="promo-title"]').count();
}

export async function apiTotal(page: Page, query: string): Promise<number> {
  const response = await page.request.get(`/api/promotions?${query}`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { total: number };
  return body.total;
}

/**
 * Клик по кластеру приближает область, клик по магазину открывает попап (§6.2).
 * На городском зуме магазины могут быть сгруппированы, поэтому кликаем маркеры
 * по очереди, пока не появится попап с адресом.
 */
export async function openStorePopup(page: Page): Promise<void> {
  const markers = page.locator('.leaflet-marker-icon');
  await expect(markers.first()).toBeVisible({ timeout: 20_000 });
  const total = await markers.count();
  for (let attempt = 0; attempt < Math.min(total + 3, 8); attempt++) {
    const popup = page.locator('.leaflet-popup-content');
    if (await popup.isVisible().catch(() => false)) return;
    await markers.nth(attempt % Math.max(1, total)).click({ force: true });
    await page.waitForTimeout(400);
  }
  await expect(page.locator('.leaflet-popup-content')).toBeVisible({ timeout: 10_000 });
}
