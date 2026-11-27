# Скидки у дома

Неофициальный сервис: акции «Магнита» на карте по Ставропольскому и Краснодарскому краям.
Next.js 15 (App Router) + TypeScript + Tailwind v4 + Prisma/SQLite + Playwright.

Данные о магазинах — из OpenStreetMap (ODbL). Данные об акциях — с публичных страниц
magnit.ru. Сервис не связан с ПАО «Магнит», цены и акции меняет сеть.

## Запуск

```bash
npm i
npx prisma db push          # создаст prisma/dev.db
npm run db:seed             # seed из data/*.sample.json, сеть не нужна
npm run dev                 # http://localhost:3000
npm run test                # юнит-тесты парсера + e2e (без выхода в интернет)
npm run sync:all            # реальные данные (нужен интернет)
npm run worker              # автообновление по расписанию
```

`npm run test` поднимает сервер сам (`playwright.config.ts` → `webServer`:
`npm run build && npm run start`). Перед e2e полезно прогнать сборку отдельно:
`npm run build` — это проверка типов из §7.3.14.

## Синхронизация

| Команда | Что делает |
|---|---|
| `npm run sync:stores` | магазины из OSM: Overpass по админ-границе города (§3.2) |
| `npm run sync:stores -- --city=armafir` | один город (slug или название, работает и для станиц) |
| `npm run sync:stores -- --region=krasnodarskiy-kray` | весь край одним area-запросом, города определяются по `addr:city` (§8) |
| `npm run sync:promotions` | акции с magnit.ru через Playwright (§4) |
| `npm run sync:promotions -- --discover=true` | найти реальные URL разделов акций → `data/discovered-sections.json` |
| `npx tsx src/jobs/export-sample.ts` | дамп импортированных магазинов в `data/stores.sample.json` (для seed) |
| `npm run worker` | node-cron: акции каждый день, магазины раз в неделю |

Полезные переменные окружения: `OSM_SOURCE=osmapi` (резервный читалка OSM, см. ниже),
`FORCE_SYNC=1` (игнорировать кэш), `SCRAPE_MIN_DELAY_MS`/`SCRAPE_MAX_DELAY_MS`,
`TZ_SCHEDULE`.

### Правила доступа (§0.4)

- Только публичные страницы magnit.ru и открытые OSM-данные. Никаких закрытых API
  приложения «Магнит», подбора токенов и обхода капчи.
- `robots.txt` читается перед парсингом и кэшируется на сутки (`src/lib/robots.ts`);
  запрещённые пути не запрашиваются.
- Один запрос за раз, пауза 3–7 сек с джиттером (`src/lib/politeness.ts`).
- 403/429/капча → остановка прогона, запись `blocked` в `SyncLog`, повтор не раньше
  чем через час (кулдаун переживает перезапуск процесса: `data/cache/magnit-blocked-until.json`).
- Если страница не отдаёт данные — это `error`/`blocked` в `SyncLog` и сообщение в UI,
  а не повод менять способ доступа.
- `User-Agent` с названием проекта и контактом задаётся в одном месте: `src/config/http.ts`.

### Почему у импорта есть второй источник

Основной — Overpass (`overpass-api.de`, §3.2). Когда он недоступен (504/406/таймауты у
всего публичного флота), импорт переключается на официальный
`api.openstreetmap.org/api/0.6/map?bbox=…` — те же данные, та же лицензия ODbL, тот же
публичный доступ; город режется на клетки, между запросами пауза ≥1 сек. Коробки городов
для этого пути лежат отдельно (`src/config/city-bboxes.ts`), чтобы расширение на весь край
(§8) по-прежнему требовало только одну строку в `CITIES`.

## Структура

```
prisma/schema.prisma          схема §2 (SQLite, enum'ы невозможны → String + zod)
prisma/seed.ts                seed из data/*.sample.json, идемпотентен
data/stores.sample.json       магазины OSM для seed
data/promotions.sample.json   акции для seed (в т.ч. алкогольные и одна истёкшая)
src/config/                   cities, regions, categories, store-formats, http, city-bboxes
src/jobs/selectors.ts         селекторы и разделы magnit.ru — единая точка правки (§4.1.3)
src/lib/overpass.ts           разбор ответа OSM → магазины (нормализация §3)
src/lib/osm-api.ts            резервный читалка OSM через bbox
src/lib/parse/html.ts         мини-DOM + CSS-подмножество: тесты парсера без браузера
src/lib/parse/normalize.ts    цены, сроки, табак, slug, sig (§4.3–4.4)
src/lib/robots.ts             robots.txt с кэшем на сутки (§0.4)
src/lib/politeness.ts         джиттер, детект капчи, кулдаун на час
src/lib/favorites.ts          избранное в localStorage (§6.3)
src/lib/queries.ts            слой чтения для API (§5)
src/jobs/extract-cards.ts     HTML страницы раздела → карточки акций
src/jobs/save-promotions.ts   дедуп по sig и схлопывание товаров в БД
src/jobs/parse-magnit.ts      драйвер Playwright: город, модалка 18+, фикстуры
src/jobs/parse-booklet.ts     скелет резервного пути (§4.5), не реализован
src/jobs/schedule.ts          worker на node-cron
src/app/api/*                 контракт API §5
src/app/page.tsx              выбор региона и города
src/app/[city]                карта + фильтры + список (§6.1)
src/app/[city]/stores/[id]    карточка магазина
src/app/favorites             избранное
tests/unit/*                  §7.2, по фикстурам, без сети
tests/e2e/*                   §7.3, chromium
```

## Как проверить, что всё зелёное (§9)

```bash
npx prisma db push && npm run db:seed && npm run build
npm run test
```

Известные ограничения: парсер сверяет город по подписи в шапке страницы и отказывается
писать акции при несовпадении; города без `SourceCityMap` помечаются `skipped`, и в UI
показывают «акции для этого города ещё не подключены», а не чужие цены.
