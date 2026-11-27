import { defineConfig, devices } from '@playwright/test';

/**
 * §9.2: тесты не должны выходить в интернет — данные берутся из seed и фикстур.
 * Тайлы OSM на карте грузятся с tile.openstreetmap.org; это единственная внешняя
 * запрос, и тесты не завязаны на их доступность (проверяются DOM-маркеры карты).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'unit',
      testDir: './tests/unit',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
