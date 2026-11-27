# Что реально отдаёт magnit.ru (снято 26.11.2026)

Это заметки, по которым настроены `src/jobs/selectors.ts` и парсер. Всё проверено
на живых запросах; сырые снимки страниц лежат в `tests/fixtures/magnit/real--*.html`.

## robots.txt

Запрошен до первого похода в сайт, как требует §0.4. Оригинал — `https://magnit.ru/robots.txt`
(обратите внимание: `https://www.magnit.ru/robots.txt` отдаёт **404**, канонический хост без `www`).

```
User-agent: *
Allow: *.js
Allow: *.css
Allow: *.jpg
Allow: *.jpeg
Allow: *.gif
Allow: *.png
Allow: *.webp
Allow: *.ico
Allow: *.svg
Disallow: /config
Disallow: /secret-playground*
Disallow: /delete_account*
Disallow: /ecom/
Disallow: /l/
Disallow: /finance
Disallow: /*search
Disallow: /bitrix/
Disallow: /script/
Disallow: /scripts/
Disallow: /skazki/
Disallow: /test/
Disallow: /upload/
Disallow: *utm_
Disallow: /profile
Disallow: /registration
Disallow: /subscription?is_app=true&currentStatus=pending
Disallow: *FASET_
Disallow: *?SECTION
Disallow: *priceRange=
Disallow: *sortBy=
Disallow: *brands=
Disallow: *onlyDiscount=
Disallow: *productTypes=
Disallow: *clckid
Disallow: *RID=
Disallow: *from=
Disallow: */anons/testovaya
Disallow: *escaped_fragment=
Disallow: *ID=
Disallow: *a=
Disallow: *clid=
Disallow: *COUNTRIES=
Disallow: *category=
Disallow: *fid=
Disallow: *erid=
Disallow: *?=
Disallow: *mindbox-message-key=
Disallow: *q=
Disallow: *referrer=
Disallow: *tl=
Disallow: *m-message-key-id=
Disallow: *ved=
Disallow: *preserve=true
Disallow: *pageNumber=
Disallow: *categoryId=
Disallow: *term=
Disallow: /*?$
Disallow: *etext=
Disallow: *format[]=
Disallow: *type[]=
Disallow: *category[]=
Disallow: *fromCat=
Disallow: *in=
Disallow: *yandex-source=
Disallow: *back=
Disallow: *activeTab=
Disallow: *V_CITY=
Disallow: *amp&amp
Disallow: *daKillaOfZeeCache=
Disallow: *2F=
Disallow: *vendors=
Disallow: *pid=
Disallow: *target=
Disallow: *trk=
Disallow: *clear_cache=
Disallow: *ldg=
Disallow: *noalko=
Disallow: *theme=
Disallow: *forAdult=
Disallow: *np=
Disallow: *internalLink=
Disallow: *deep_link_value=
Disallow: *hl=
Disallow: *section=
Disallow: *spm=
Disallow: *sub_id=
Disallow: *regid=
Disallow: *SEARCH=
Disallow: *C404D9AC-
Disallow: *customer_id=
Disallow: *source=
Sitemap: https://magnit.ru/sitemap_index.xml
```

Что из этого следует для нас:

- Разделы акций (`/promo-catalog…`) и страницы товаров (`/promo-product…`) **не запрещены**.
- Запрещены фильтры и сортировка в query (`*sortBy=`, `*category=`, `*pageNumber=`,
  `*onlyDiscount=`, `*q=`) — то есть нельзя «протиснуть» каталог параметрами, только
  обычные пути. `?shopCode=` среди запретов нет, и именно его использует сам сайт в
  внутренних ссылках.
- Запрещён `/upload/` — туда парсер не ходит. Картинки акций лежат на отдельном хосте
  (`promo-images.prod.ya.magnit.ru`), мы их не скачиваем, в БД пишем только URL.
- Есть `Sitemap:` — поиск разделов идёт через него, а не «методом тыка» по URL.

## Разделы акций (реальные URL)

Найдены через `https://magnit.ru/sitemap_index.xml` →
`https://magnit.ru/__sitemap__/promo-catalog.xml` (18 ссылок):

| Раздел | URL |
|---|---|
| Все акции | https://magnit.ru/promo-catalog |
| Напитки | https://magnit.ru/promo-catalog/21-napitki |
| Молоко, сыр, яйца | https://magnit.ru/promo-catalog/22-moloko-syir-yajtsa |
| Бакалея, соусы | https://magnit.ru/promo-catalog/23-bakaleya-sousyi |
| Мясо, птица, колбасы | https://magnit.ru/promo-catalog/25-myaso-ptitsa-kolbasyi |
| Полуфабрикаты | https://magnit.ru/promo-catalog/26-polufabrikatyi |
| Овощи и фрукты | https://magnit.ru/promo-catalog/27-ovoschi-i-fruktyi |
| Снеки, орехи | https://magnit.ru/promo-catalog/28-sneki-orehi |
| Кондитерские изделия | https://magnit.ru/promo-catalog/30-konditerskie-izdeliya |
| Косметика и парфюмерия | https://magnit.ru/promo-catalog/32-kosmetika-i-parfyumeriya |
| Детям | https://magnit.ru/promo-catalog/34-detyam |
| Зоотовары | https://magnit.ru/promo-catalog/35-zootovaryi |
| Разные категории | https://magnit.ru/promo-catalog/41-raznyie-kategorii |
| **Алкоголь** | https://magnit.ru/promo-catalog/81-alkogol |
| Чай, кофе, какао | https://magnit.ru/promo-catalog/101-chaj-kofe-kakao |
| Рыба и морепродукты | https://magnit.ru/promo-catalog/148-ryiba-i-moreproduktyi |
| Новинки | https://magnit.ru/promo-catalog/149-novinki |
| Скидки на категории | https://magnit.ru/promo-catalog/151-skidki-na-kategorii |

Отдельного табачного раздела в списке нет; правило «табак не парсим» (§4.2) всё равно
применяется к названиям внутри любого раздела, включая алкогольный.

## Разметка карточки

```
article.unit-catalog-product-preview[data-test-id="v-product-preview"]
└── a.pl-hover-base[href="/promo-product/<id>-<slug>?shopCode=<код магазина>"][title]
    ├── .unit-catalog-product-preview-gallery
    │   ├── .unit-catalog-product-preview-image > img[src*=promo-images.prod.ya.magnit.ru]
    │   └── .unit-catalog-product-preview-labels__badges > .pl-label__content   («Акция», иногда «-20%»)
    └── .unit-catalog-product-preview-description
        └── .unit-catalog-product-preview-text
            ├── .unit-catalog-product-preview-prices → …__top-row (значения с «₽»)
            └── .unit-catalog-product-preview-title  (название товара)
```

Сайт — Nuxt: часть содержимого дорисовывается клиентом, поэтому снимок берётся
после `page.content()` в Playwright, а разбором занимается один и тот же pure-модуль
`src/jobs/extract-cards.ts` (мини-DOM из `src/lib/parse/html.ts`), что позволяет
тестам §7.2 идти по HTML-фикстурам без браузера.

## Как на сайте выбирается «город» — и что из этого следует

Города как отдельного переключателя на сайте нет: актуальный каталог привязан к
**конкретному магазину**. Признаки, снятые со страницы 26.11.2026:

1. Все внутренние ссылки раздела несут `?shopCode=992301`.
2. Адрес выбранного магазина попадает в `<title>`:
   `Акции и скидки: алкоголь — в каталоге на сайте сети Магнит (81) | Краснодарский край,
   Краснодар г, им. Дзержинского ул, дом № 42`.
3. Пока магазин не выбран, поверх страницы висит модалка «Выберите магазин или адрес,
   чтобы посмотреть актуальный каталог», а **цены в карточках пустые** (блок
   `.unit-catalog-product-preview-prices` присутствует, значений в нём нет).

Поэтому:

- в `SourceCityMap.magnitCityId` хранится именно `shopCode`, а `magnitCityName` — город,
  который мы ожидаем увидеть в адресе магазина;
- сверка города (§4.1.4) идёт по `<title>` (`cityFromTitle`), при несовпадении —
  `BlockedError` и запись в `SyncLog`, акции в этот город не пишутся;
- если карточки есть, а цен нет ни у одной, прогон фиксируется как ошибка синхронизации
  (§0.4), а не как «пустой список» и не как повод добывать доступ иначе.

В двух снятых файлах `real--krasnodar--*.html` магазин был выбран через `shopCode` в URL,
но значения цен так и не появились — модалка выбора магазина перекрывала отдачу. Это
зафиксировано как известное ограничение реального прогона: для боевой синхронизации
нужно один раз выбрать магазин в UI (парсер пробует это сделать, см. `dismissShopPicker`),
иначе `SyncLog.status = blocked` с внятным сообщением.

## Страница адресов магазинов: `/shops` (снято 27.11.2026)

Раздел найден по ссылкам с главной (`/shops`), robots его **не запрещает**.
`<title>`: «Магазины и аптеки сети Магнит — адреса и время работы».

Разметка карточки (реальный рендер, не HTML ответа сервера — страница Nuxt, список
дорисовывается клиентом):

```
div.shops-page__list
└── div.shops-list-item
    ├── div.shops-list-item--icon            (svg логотипа формата)
    ├── div.shops-list-item--info[title="Краснодарский край, г Ставрополь, ул …, д 25/1"]
    │   ├── div.shops-list-item--label       «Магнит Экстра»        ← название формата
    │   ├── div.shops-list-item--label       адрес (тот же класс!)
    │   └── div.shops-list-item--schedule    «08:00 - 22:00»
    └── div.shops-list-item--arrow
```

Видимый текст карточки склеивает бейдж, название, адрес и часы («Моя ценаСтавропольский
край, …»), поэтому адрес берётся из атрибута `title`, а не из textContent.

Что измерено и учтено в `src/jobs/import-stores-source.ts`:

1. **Переключатель города — тот же, что и для акций:** выбранный магазин живёт в cookie
   `shopCode` (в `.pl-shop-select-bar__info--address` попадает его адрес). Отдельного
   «города» в интерфейсе нет.
2. **Потолок выдачи — 50 карточек на запрос.** Пагинации нет, прокрутка списка ничего
   не подгружает (проверено: 50 → 50 → 50), кнопки «показать ещё» в DOM нет.
3. **Сортировка — по близости к выбранному магазину.** При дефолтном магазине Краснодара
   запрос «Ставрополь» отдаёт 153 адреса по краю, но самого города там только 11.
4. Отсюда стратегия полноты: union нескольких запросов (`г {город}`, `{город}, ул`,
   `{город}, пр-кт`, `{город}, б-р`, `{город}, пер`, `{город}`) × чипы форматов
   (`Магнит`, `М.Косметик`, `Семейный`, `Экстра`, `Моя цена`), а если города всё ещё
   мало — запросы `{город}, ул {А…Я}`. Дедупликация по ключу адреса (ул+дом).
5. Координат страница не отдаёт (только адрес и часы) — поэтому и нужен геокодер. Ключ
   `geocoderApiKey` из конфига страницы не используется: это чужие креды (§0.4), берём
   Nominatim с ответами, кэшируемыми в `data/cache/geocode/`.
6. Слово `captcha` в HTML страницы встречается в легитимном конфиге (`yandexCaptcha:"…"`) —
   по нему детектор капчи пришлось сузить, иначе каждый прогон ложно уходил в `blocked`.
