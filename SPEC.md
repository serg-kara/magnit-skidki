# SPEC.md — «Скидки Магнита» на карте (Ставропольский + Краснодарский края)

Роль исполнителя: ты собираешь проект с нуля в текущей пустой папке. Реализуй разделы
по порядку, после каждого раздела запускай проверки и чини, не переходя дальше с падением.
Жёсткие правила в конце (§0.4, §9) — они выше всех остальных пожеланий.

---

## 0. Подготовка окружения (делать до написания кода)

### 0.1 Проверка базы
```bash
node -v    # нужен 20.x или 22.x LTS
npm -v
git --version
```
Если Node нет — поставь LTS с nodejs.org (Windows: MSI-пакет). Не используй Node 18.

### 0.2 Qwen Code: починка «токен не валидный»

Это 401/OAuth-проблема, код проекта тут ни при чём. Делай по порядку:

1. Внутри Qwen Code выполни `/auth` → перелогин (OAuth) или перестановка ключа.
   Часто помогает просто повторный `/auth`, потому что срок жизни OAuth-токена истёк.
2. Проверь конфиг `~/.qwen/settings.json` (Windows: `%USERPROFILE%\.qwen\settings.json`):
   - ключ не должен быть в кавычках-лапках, с пробелами или переносом строки;
   - `baseUrl`/`baseURL` должен совпадать с тем, где реально выдан ключ
     (ключ от Model Studio/DashScope не работает с endpoint'ом OpenAI и наоборот — это
     причина №1 «невалидного токена»);
   - имя модели в конфиге должно быть доступно именно для этого ключа.
3. Перезапусти терминал полностью — переменные окружения из сессии не подхватываются на лету.
4. Убедись, что системные часы идут верно (расхождение → отказ в TLS/авторизации).
5. Выключи VPN/прокси на время проверки: прокси с чужим IP часто режет авторизацию.
6. Если используется бесплатный OAuth-вход — проверь лимиты тарифа (лимит даёт ошибку,
   похожую на «невалидный токен»).

Точные имена полей/переменных сверь с README репозитория Qwen и с диалогом `/auth` —
они меняются между версиями, не копируй имена из интернета вслепую.

### 0.3 Браузеры для Playwright (один раз)
```bash
npx playwright install chromium
```

### 0.4 Правила для среды, в которой идёт сборка
- Не обходи капчу, не подбирай токены/подписи приватных API приложения «Магнит»,
  не ходи в авторизованные эндпоинты. Только публичные страницы magnit.ru и открытые
  OSM-данные.
- Перед парсингом читай `https://www.magnit.ru/robots.txt` (кэш на сутки) и не ходи
  туда, где `Disallow`. Запросы только к публичным страницам акций/каталога.
- Задержка между запросами 3–7 сек со случайным джиттером, максимум 1 запрос за раз.
  При 403/429/капче — остановка запуска с записью в лог, повтор не раньше чем через час.
  Никаких попыток «добыть» доступ.
- `User-Agent` с контактным e-mail/названием проекта.
- Если страница не отдаёт данные — это фиксируется как ошибка синхронизации, а не как
  повод менять способ доступа.

---

## 1. Каркас проекта

Next.js 15 (App Router) + TypeScript + Tailwind CSS + Prisma/SQLite.

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --use-npm
npm i prisma @prisma/client leaflet react-leaflet zod node-cron
npm i -D @types/leaflet @playwright/test tsx dotenv
```

`package.json` → scripts (обязательно с такими именами, на них ссылается §7):
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "db:push": "prisma db push",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio",
    "sync:stores": "tsx src/jobs/import-cities.ts",
    "sync:promotions": "tsx src/jobs/parse-magnit.ts",
    "sync:all": "npm run sync:stores && npm run sync:promotions",
    "worker": "tsx src/jobs/schedule.ts",
    "test": "playwright test",
    "test:headed": "playwright test --headed"
  }
}
```

Ловушки Next 15, которые сломают сборку, если их не учесть сразу:
- в динамических маршрутах `params` — промис: `const { city } = await params;`
- `react-leaflet` подключать только так:
  ```tsx
  const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });
  ```
  и сам компонент помечен `'use client'`;
- импорт `import 'leaflet/dist/leaflet.css'` и ручная починка иконок маркеров
  (в бандлере пути к `marker-icon.png` ломаются — задай `L.Icon.Default` явно через
  `iconUrl` из `/public/leaflet/`, скопируй туда PNG из `node_modules/leaflet/dist/images/`).

---

## 2. Схема данных (`prisma/schema.prisma`)

Провайдер `sqlite`. **Важно: SQLite в Prisma не поддерживает enum** — все перечисления
хранить как `String` и валидировать через `zod` в API-слое.

```prisma
generator client { provider = "prisma-client-js" }
datasource db    { provider = "sqlite"; url      = "file:./dev.db" }

model Region {
  id          Int      @id @default(autoincrement())
  slug        String   @unique          // krasnodarskiy-kray, Stavropolskiy-kray
  name        String
  osmAreaName String                      // запрос к Overpass/Nominatim
  cities      City[]
}

model City {
  id          Int      @id @default(autoincrement())
  slug        String   @unique          // krasnodar, armafir, kurganinsk, stavropol, nevinnomyssk
  name        String
  lat         Float
  lng         Float
  regionId    Int
  region      Region @relation(fields: [regionId], references: [id])
  stores      Store[]
  sourceMap   SourceCityMap?            // связь с id города в выборе города на magnit.ru
}

// Ключ к парсеру: какой город выбрать на сайте Магнита, чтобы акции соответствовали
// городу из нашей БД. Заполняется вручную/поиск-подсказкой при первом запуске.
model SourceCityMap {
  id           Int    @id @default(autoincrement())
  cityId       Int    @unique
  city         City   @relation(fields: [cityId], references: [id])
  magnitCityId String                    // то, что реально использует сайт (cid/cookie/localStorage)
  magnitCityName String
}

model Store {
  id        Int      @id @default(autoincrement())
  cityId    Int
  city      City     @relation(fields: [cityId], references: [id])
  name      String                       // «Магнит у дома»
  format    String   @default("unknown") // universal | home | supermarket | express | unknown
  address   String
  lat       Float
  lng       Float
  osmId     String   @unique              // узел/отношение OSM — защита от дублей при переимпорте
  promos    PromotionStore[]
  updatedAt DateTime @updatedAt
}

model Category {
  id        Int      @id @default(autoincrement())
  slug      String   @unique              // alcohol, dairy, snacks, ...
  name      String
  isAdult   Boolean  @default(false)      // true только для alcohol
  products  Product[]
}

model Product {
  id         Int      @id @default(autoincrement())
  slug       String   @unique             // из нормализованного названия
  name       String
  brand      String?
  categoryId Int?
  category   Category? @relation(fields: [categoryId], references: [id])
  promos     Promotion[]
}

model Promotion {
  id         Int      @id @default(autoincrement())
  productId  Int
  product    Product  @relation(fields: [productId], references: [id])
  scope      String                        // "federal" | "store"
  priceOld   Float?
  priceNew   Float?
  discountPct Int?
  bonus      String?                        // текст акции: «2 по цене 1», «-20% со скидочной картой»
  validFrom  DateTime?
  validTo    DateTime?
  sourceUrl  String?
  imageUrl   String?
  sig        String   @unique               // хэш содержания — см. §4.4 (дедуп)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  stores     PromotionStore[]
}

model PromotionStore {
  promotionId Int
  storeId     Int
  promotion   Promotion @relation(fields: [promotionId], references: [id], onDelete: Cascade)
  store       Store     @relation(fields: [storeId], references: [id], onDelete: Cascade)
  @@id([promotionId, storeId])
}

model SyncLog {
  id        Int      @id @default(autoincrement())
  job       String                         // stores | promotions
  status    String                         // ok | partial | blocked | error
  message   String?
  citiesOk  Int      @default(0)
  itemsNew  Int      @default(0)
  itemsSeen Int      @default(0)
  startedAt DateTime @default(now())
  finishedAt DateTime?
}
```

Избранное **не хранится в БД** — только в `localStorage` браузера пользователя (§6.3).

---

## 3. Города и магазины: импорт из OpenStreetMap

Источник координат — бесплатный Overpass API, без ключей и без Яндекс-лицензий.
Покрытие OSM по «Магниту» на Ставропольщине и Кубани хорошее, включая Курганинск и сёла.

`src/jobs/import-cities.ts`:
1. Список городов первого контура — `src/config/cities.ts`:
   ```ts
   export const CITIES = [
     { name: 'Краснодар',      region: 'krasnodarskiy-kray' },
     { name: 'Армавир',        region: 'krasnodarskiy-kray' },
     { name: 'Курганинск',     region: 'krasnodarskiy-kray' },
     { name: 'Ставрополь',     region: 'stavropolskiy-kray' },
     { name: 'Невинномысск',   region: 'stavropolskiy-kray' },
   ];
   ```
   Расширение на «весь край/деревни» (§8) не требует правок кода — только добавления
   строки сюда или запуска с аргументом.
2. Для каждого города — POST на `https://overpass-api.de/api/interpreter`, запрос:
   ```
   [out:json][timeout:60];
   area["name"="Курганинск"]["boundary"="administrative"]->.a;
   (node["shop"="supermarket"](area.a); way["shop"="supermarket"](area.a);
    relation["shop"="supermarket"](area.a);
    node["brand"]["name"~"Магнит"](area.a);
    way["brand"]["name"~"Магнит"](area.a););
   out center tags;
   ```
   Фильтр оставляем широкие (`name~"Магнит"`), потому что `brand` в российских данных
   проставляют непоследовательно: кто-то пишет `brand=Магнит`, кто-то только в `name`.
   В коде затем нормализовать: годится, если `name`/`brand`/`brand:ru` содержит «магнит»
   (без учёта регистра). Другие сети выбросить.
3. `lat/lng`: для `node` — `lat/lon`, для `way`/`relation` — `center`.
4. `address`: собрать из `addr:street` + `addr:housenumber` (+ `addr:city`); если тегов
   нет — писать `адрес не указан в OSM`, координаты при этом остаются валидными.
5. `format` из `name`/`brand`: «у дома» → `home`, «семейный»/`supermarket` крупный →
   `supermarket`, «экспресс» → `express`, иначе `unknown`.
6. Апсерты по `osmId`. Повторный импорт не должен плодить дубли и не должен трогать
   вручную заполненные поля.
7. Сырой ответ Overpass кешировать в `data/cache/overpass/<city>.json` на 30 дней;
   сетевой запрос только при промахе кэша. Between-городами пауза 10 сек (вежливость к API).
8. `City.lat/lng` — медиана координат магазинов (или центр города из OSM-отношения).

Запуск точечно: `npm run sync:stores -- --city=armafir`.

---

## 4. Парсер акций Магнита

`src/jobs/parse-magnit.ts`, Playwright (chromium), headless.

### 4.1 Что парсим
Публичные страницы акций magnit.ru. Порядок действий агента при реализации:
1. Открыть сайт, найти реальные URL разделов акций — **включая раздел алкоголя** (он нужен).
2. Сохранить HTML в `tests/fixtures/magnit/*.html` как фикстуры. Все дальнейшие тесты
   парсера идут по фикстурам, а не по сети (§9.3).
3. Селекторы вынести в `src/jobs/selectors.ts` единым объектом — чтобы при счёте вёрстки
   на сайте правился один файл, а не пять мест.
4. Реализовать выбор города через `SourceCityMap` (обычно это cookie/localStorage
   `city` + перезагрузка). Перед парсингом акции нужно убедить себя, что страница
   соответствует городу: искать на странице название города и сравнивать с
   `magnitCityName`. Если не совпало — писать `blocked`/`error` в SyncLog, а не тихо
   парсить чужие акции под нашим городом. Это защита от «на карте Курганинска показались
   краснодарские цены».

### 4.2 Алкоголь и табак — конкретные требования
- Алкоголь **обязателен**: парсится наравне с продуктами, получает `categoryId = alcohol`,
  `Category.isAdult = true`, и на фронте закрыт проверкой возраста (§6.4).
- Страницы алкоголя могут требовать модалку «подтвердите возраст» — её надо закрыть
  кликом по кнопке подтверждения (это не обход защиты, а штатное пользовательское
  действие). Если вместо неё появляется капча — см. §0.4: стоп, лог, через час.
- Табак/сигареты **не парсим**: выбрасывать элемент на уровне парсера, если категория
 /tab-slug относится к табаку или название матчится на
  `/(сигарет|табак|папирос|пачк(а|и) +сигарет|iqos|glo|систем(а|ы) нагревания)/i`.
  Правило применять и внутри алкогольного раздела — туда табак иногда подмешивают.

### 4.3 Нормализация
- Цены: `1 299,90 ₽` → `1299.9` (`parseFloat` после удаления пробелов/неразрывных,
  NBSP обязательно). Если указана только новая цена — `priceOld = null`.
- `discountPct`: считать из цен, если сайт не дал процент явно.
- Сроки: формат даты на странице может быть `01.09 – 30.09` без года → год брать из
  контекста: если месяц месяца больше текущего, считаем прошлым годом, иначе текущим;
  если в диапазоне месяц «пересекает» новый год — год конца диапазона следующий.
  Это правило покрыть юнит-тестом парсера (§7.2).
- `Product.slug`: транслит+kebab от нормализованного названия (единицы измерения
  «0,5 л», «900 г» вырезать в отдельное поле или в конец slug, дубли slug — через счётчик).
- Один и тот же товар должен схлопываться в одну запись, иначе список завалится
  «Молоко 900г» × 40 раз.

### 4.4 Дедуп и протухание (`sig`)
```
sig = sha1( productId | scope | sortedStoreIds | priceNew | priceOld |
            validFromISO | validToISO | bonusNorm )
```
- такой `sig` уже есть → обновить `updatedAt`, ничего не вставлять;
- `sig` другой по тому же товару+магазину → новая акция, старую пометить
  «заменена» (флаг `superseded` можно вычислять по `validTo < now`, отдельного поля
  не вводить);
- в выдачу API возвращать только `validTo >= now` (или `validTo IS NULL`).
Акционные записи никогда не редактировать «на месте» — только создавать новые, иначе
история «цена была» теряется.

### 4.5 Резерв
Если страница не отдаёт данные стабильно — предусмотреть модуль
`src/jobs/parse-booklet.ts` (скелет с TODO, без реализации): вход — PDF-буклет, выход —
те же структуры. Не давать ему сломать сборку.

---

## 5. API-контракт (App Router route handlers)

Все ответы — JSON, все входные параметры через `zod`, ошибки `400` с внятным текстом.

| Метод | Путь | Параметры | Ответ |
|---|---|---|---|
| GET | `/api/health` | — | `{ ok: true, time }` |
| GET | `/api/meta` | — | `{ cities: n, stores: n, promos: n, lastSync: { job, status, finishedAt } }` |
| GET | `/api/regions` | — | `Region[]` с числом городов |
| GET | `/api/cities` | `?region=` | `City[]` с числом магазинов и акций |
| GET | `/api/cities/[slug]` | — | `{ city, storesCount, promosCount }` |
| GET | `/api/promotions` | `city`, `store`, `category`, `q`, `adult`, `page`, `limit` | `{ total, items[] }` |
| GET | `/api/promotions/map` | `city` (обязателен) | `{ markers[] }` — по магазину: `{ storeId, lat, lng, address, name, promos: n, preview: [{name, priceNew, discountPct}] }` |
| GET | `/api/stores/[id]` | — | `{ store, promotions[] }` |

`items[]` `/api/promotions` (минимальный контракт, фронт зависит именно от этих имён):
```json
{
  "id": 1,
  "productName": "Вино игристое ...",
  "brand": "Абрау-Дюрсо",
  "category": { "slug": "alcohol", "name": "Алкоголь", "isAdult": true },
  "priceOld": 899, "priceNew": 649, "discountPct": 28,
  "bonus": "-28% по карте Магнит",
  "validFrom": "2026-11-20", "validTo": "2026-12-03",
  "imageUrl": "...", "sourceUrl": "...",
  "scope": "federal",
  "stores": [{ "id": 12, "name": "Магнит у дома", "address": "..." }]
}
```
`scope: "store"` → `stores` конкретный список; `"federal"` → `stores` пустой, а в UI
подпись «во всех магазинах сети». Пагинация: `limit` по умолчанию 50, максимум 200.
Недоступный город → `404`, а не пустой список (иначе карта молча врёт).

---

## 6. Интерфейс (свой дизайн, не копия alkogolikam.ru)

Структура страниц повторяем (города → карта → карточки → избранное), визуал — свой:
светлая тема, карточки с тенью, крупный красный бейдж `%`, скругления 12px.
Никаких чужих логотипов, иконок, текстов и фирменных цветов.

### 6.1 Маршруты
```
/                      — выбор региона и города, краткая статистика, ссылка на город
/[city]                — карта + фильтры + список акций города        (await params!)
/[city]/stores/[id]    — карточка магазина и его акции
/favorites             — избранное (из localStorage)
```
Фильтры на `/[city]`: категория (списом), поиск по названию, чекбокс «только алкоголь»,
чекбокс «только с истёкшим сроком» (по умолчанию выключен, акция после истечения не
показывается нигде).

### 6.2 Карта (`components/MapView.tsx`, client)
- тайлы OSM: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, attribution
  «© OpenStreetMap contributors» — обязательная строка, не убирать;
- кластеризация маркеров (`react-leaflet-cluster` или своя группировка по зуму);
- клик по маркеру/кластеру → попап: адрес магазина, число акций, 3 превью, ссылка
  на страницу магазина;
- `fitBounds` по городам; при смене города карта перестраивается без полной перезагрузки;
- пустой город → сообщение «нет данных, запусти синхронизацию», не пустая карта.

### 6.3 Избранное
- `lib/favorites.ts`: `add/remove/toggle/list`, ключ `magnit.favorites.v1`,
  храним `{ productId, productName, priceNew, priceOld, validTo, citySlug, categorySlug, isAdult }`
  (снимок, чтобы список жил и когда акция удалится из БД);
- кнопка-звезда на карточке, состояние синхронизируется через подписку на `storage`
  + свой `EventTarget` (два таба, `localStorage` сам не редиспит событие);
- `useEffect`-чтение только на клиенте (SSR-мидл и hydration-мигание — типичный баг,
  сразу рендерить «пустой» вариант и заполнять на клиенте);
- на `/favorites` бейдж «истекло» у записей с `validTo < now` и предупреждение, если до
  конца акции ≤ 2 дня.

### 6.4 Проверка возраста (алкоголь)
Модальное окно «Тебе есть 18?» при первом включении фильтра алкоголя. Ответ в
`localStorage` (`magnit.ageOk.v1` = `yes|no`), cookie/сервер не трогаем. Пока не
подтверждено — карточки алкоголя скрыты и заменяются заглушкой.

### 6.5 Шапка/подвал
Бренд «Скидки у дома» (рабочее название, меняемое), переключатель города, ссылка
«Избранное», строка `Данные обновлены: <относительное время>` из `/api/meta`,
дисклеймер «неофициальный сервис, цены и акции может менять сеть» и ссылка на OSM.

---

## 7. Тесты и проверки

### 7.1 Seed — критично для «зелёной» сборки без сети
`prisma/seed.ts` наполняет БД из закоммиченных `data/stores.sample.json` и
`data/promotions.sample.json`: 2 региона, 5 городов, ≥4 магазина на город с реальными
координатами (взять из OSM вручную и зафиксировать в JSON), ≥30 акций, включая минимум
6 алкогольных и ≥1 истёкшую. Seed идемпотентен (второй запуск не плодит дубли).

### 7.2 Юнит-тесты парсера (Playwright test runner, без браузера)
`tests/unit/*` — по фикстурам `tests/fixtures/magnit/`:
- нормализация цены (NBSP, запятая, «₽»), в т.ч. `1 299,90 ₽` → `1299.9`;
- разбор диапазона дат без года + переход через год;
- фильтр табака удаляет запись, алкоголь остаётся;
- `sig` стабилен и меняется при изменении цены;
- проверка города: фикстура «Краснодар» не отдаёт акции для Ставрополя.

### 7.3 E2E (`tests/e2e/*.spec.ts`, chromium)
`playwright.config.ts` обязателен блок:
```ts
webServer: {
  command: 'npm run build && npm run start',
  url: 'http://localhost:3000',
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
}
```
Спэки (имена тестов — такие же в отчёте):
1. `/` показывает 5 городов первого контура и ссылки на них.
2. `/stavropol` — на карте есть минимум 1 маркер; консоль браузера без ошибок.
3. Клик по маркеру открывает попап с адресом и ссылкой на магазин.
4. Клик по акционной карточке ведёт в магазин; страница магазина содержит её название.
5. Фильтр категории меняет количество карточек (сравнение count до/после).
6. Поиск по фрагменту названия находит нужный товар, «zzzzzz» → пустое состояние.
7. Звезда добавляет товар в избранное; на `/favorites` он есть; повторный клик убирает.
8. Избранное переживает перезагрузку страницы (`page.reload()`).
9. Истёкшая акция из seed не видна ни в списке, ни на карте.
10. Алкоголь скрыт до подтверждения возраста; после подтверждения — виден, и табак
    отсутствует в категориях вообще.
11. `/api/promotions?city=kurganinsk` → 200, `total > 0`, у каждой записи есть
    `productName` и `scope`.
12. `/api/promotions?city=no-such` → 404.
13. `/nonexistent-city` → страница 404 приложения, не крэш.
14. `npm run build` проходит без ошибок типов (проверка запускается отдельно, до e2e).

---

## 8. Расширение на весь край и сёла

Обязательное поведение, а не «на потом»:
- `npm run sync:stores -- --region=krasnodarskiy-kray` — берёт границу региона из OSM
  (`area["name"="Краснодарский край"]`) и собирает все магазины края; новые города
  определяются по `addr:city`/`name` и добавляются в `City` автоматически (slug —
  транслитерация), координаты города — медиана его магазинов;
- `--city=название` — точечно, работает и для станиц/посёлков;
- в `City` нет флагов «поддерживается/нет»: город живёт, пока есть строка в БД;
- `SourceCityMap` для нового города оставляется пустым → парсер помечает город `skipped`
  в SyncLog и пишет в UI «акции для этого города ещё не подключены» (не показывает
  чужие акции как свои);
- лимит разового импорта края — 1 запрос к Overpass с `timeout: 120` и паузами, не
  перебирать города по одному, если можно одним запросом по area.

---

## 9. Приёмка (что должно быть зелёным, чтобы сказать «готово»)

1. `npx prisma db push && npm run db:seed && npm run build` — без ошибок.
2. `npm run test` — все e2e-спеки проходят **без выхода в интернет**: seed и фикстуры
   лежат в репозитории.
3. В браузере: 5 городов, карта с маркерами, фильтры, избранное после перезагрузки,
   алкоголь за модальным окном возраста, табака нет нигде.
4. Ошибок и ошибок типов в консоли нет; предупреждений hydration нет.
5. Парсер в реальном запуске либо даёт `status: ok` с непустыми данными, либо честно
   даёт `blocked`/`error` в SyncLog и UI показывает «данные не обновлены, включите
   синхронизацию» — но **не** пустые карточки вместо работы и не падение приложения.
6. Никаких чужих логотипов/иконок/текстов alkogolikam.ru в коде и ассетах.

### 9.1 Что сообщить мне в отчёте
Вывод `npm run build`, вывод `npx playwright test` целиком (все падения — со стеком и
сохранёнными скриншотами/traces из `test-results/`), `ls -R` дерева проекта, вывод
`/api/meta`, список реальных URL разделов акций, которые нашёл на сайте, и содержимое
`robots.txt`. Если тесты не прошли — не «переписывай в надежде», а покажи падение.

### 9.2 Запуск для пользователя (после绿色的 сборки)
```bash
npm i
npx prisma db push
npm run db:seed
npm run dev            # http://localhost:3000
npm run test           # проверки
npm run sync:all       # реальные данные (нужен домашний интернет, без VPN)
npm run worker         # автообновление по расписанию
```

### 9.3 Запреты при реализации
- не менять имена полей API из §5 — фронт по ним написан;
- не хранить избранное в БД;
- не поднимать Postgres/Docker на этом этапе;
- не копировать вперстку/ассеты/тексты alkogolikam.ru;
- не обходить капчу и не использовать закрытые API приложения «Магнит».
```
