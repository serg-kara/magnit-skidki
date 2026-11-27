/**
 * Единая точка правки при смене вёрстки magnit.ru (§4.1.3): селекторы и адреса разделов
 * живут только здесь, парсер и тесты их не дублируют.
 *
 * Ограничение: селекторы должны быть в подмножестве CSS, которое разбирает
 * `src/lib/parse/html.ts` (тег, .class, #id, [attr], [attr="значение"], пробел и `>`,
 * список через запятую). Без `:has()`, `:contains()` и псевдоклассов — парсер работает
 * по HTML-строке в Node, поэтому тесты и реальный запуск используют один и тот же код.
 *
 * Всё ниже снято с живых страниц /promo-catalog/* (см. tests/fixtures/magnit/real--*):
 * карточка — `article.unit-catalog-product-preview`, название — `.unit-catalog-product-preview-title`,
 * ссылка на товар — `a.pl-hover-base` с `?shopCode=<магазин>`, бейдж — `.pl-label__content`.
 */

/**
 * Канонический хост. www.magnit.ru отдаёт 404 даже на robots.txt — проверено при первом
 * же походе, поэтому без www.
 */
export const MAGNIT_ORIGIN = 'https://magnit.ru';

export const SELECTORS = {
  /**
   * §4.1.4: город на magnit.ru выбирается не «городом в шапке», а конкретным магазином,
   * и его адрес попадает в <title> страницы («… | Краснодарский край, Краснодар г, …»).
   * Поэтому сверка города идётся по title, а не по классу в шапке.
   */
  pageTitle: 'title',
  card: 'article.unit-catalog-product-preview',
  name: '.unit-catalog-product-preview-title',
  /**
   * Блок цен. Значения появляются только когда выбран магазин (сайт прямо просит
   * «Выберите магазин или адрес, чтобы посмотреть актуальный каталог»). Точных классов
   * для «новой»/«старой» цены в снимке не видно, поэтому парсер НЕ выдумывает их,
   * а берёт все числовые значения внутри этого контейнера: минимум — новая цена,
   * максимум — старая.
   */
  prices: '.unit-catalog-product-preview-prices',
  /**
   * Бейдж на карточке: в реальном снимке это `.pl-label__content` со словами «Акция»,
   * иногда с процентом или текстом вида «2 по цене 1» — отсюда и discountPct, и bonus.
   */
  badges: '.unit-catalog-product-preview-labels__badges .pl-label__content',
  // Бренд и срок на карточке каталога не подписаны отдельными узлами (сроки живут на
  // странице товара /promo-product/…), поэтому отдельных селекторов нет: срок ищем
  // текстовым сканом карточки, бренд — внутри названия.
  image: 'img',
  link: 'a.pl-hover-base',
} as const;

/**
 * Кнопки шапки выбора: сначала магазин, потом (в алкогольном разделе) «18+».
 * Это штатные пользовательские действия (§4.2), а не обход защиты.
 */
export const PICKER_BUTTONS = {
  /** «Выбрать» в модалке выбора магазина; «Не сейчас» — отказ, он прячет цены. */
  shopOpen: { selector: 'button', nameRegex: /(выбрать|выберитe магазин)/i },
  shopSkip: { selector: 'button', nameRegex: /^не сейчас$/i },
  ageConfirm: { selector: 'button', nameRegex: /(да|мне есть|больше 18|подтверд)/i },
};

/**
 * Разделы акций — реальные URL из https://magnit.ru/sitemap_index.xml →
 * /__sitemap__/promo-catalog.xml (18 ссылок, перечислены все, включая алкоголь §4.2).
 * `id` — числовой идентификатор раздела на сайте, `slug` — наша категория из config/categories.
 */
export const SECTIONS: {
  slug: string;
  title: string;
  path: string;
  id: number;
}[] = [
  { slug: 'beverages', title: 'Напитки', path: '/promo-catalog/21-napitki', id: 21 },
  { slug: 'dairy', title: 'Молоко, сыр, яйца', path: '/promo-catalog/22-moloko-syir-yajtsa', id: 22 },
  { slug: 'groceries', title: 'Бакалея, соусы', path: '/promo-catalog/23-bakaleya-sousyi', id: 23 },
  { slug: 'meat', title: 'Мясо, птица, колбасы', path: '/promo-catalog/25-myaso-ptitsa-kolbasyi', id: 25 },
  { slug: 'groceries', title: 'Полуфабрикаты', path: '/promo-catalog/26-polufabrikatyi', id: 26 },
  { slug: 'fruits', title: 'Овощи и фрукты', path: '/promo-catalog/27-ovoschi-i-fruktyi', id: 27 },
  { slug: 'snacks', title: 'Снеки, орехи', path: '/promo-catalog/28-sneki-orehi', id: 28 },
  { slug: 'snacks', title: 'Кондитерские изделия', path: '/promo-catalog/30-konditerskie-izdeliya', id: 30 },
  { slug: 'household', title: 'Косметика и парфюмерия', path: '/promo-catalog/32-kosmetika-i-parfyumeriya', id: 32 },
  { slug: 'household', title: 'Детям', path: '/promo-catalog/34-detyam', id: 34 },
  { slug: 'household', title: 'Зоотовары', path: '/promo-catalog/35-zootovaryi', id: 35 },
  { slug: 'other', title: 'Разные категории', path: '/promo-catalog/41-raznyie-kategorii', id: 41 },
  { slug: 'alcohol', title: 'Алкоголь', path: '/promo-catalog/81-alkogol', id: 81 },
  { slug: 'beverages', title: 'Чай, кофе, какао', path: '/promo-catalog/101-chaj-kofe-kakao', id: 101 },
  { slug: 'fish', title: 'Рыба и морепродукты', path: '/promo-catalog/148-ryiba-i-moreproduktyi', id: 148 },
  { slug: 'other', title: 'Новинки', path: '/promo-catalog/149-novinki', id: 149 },
  { slug: 'other', title: 'Скидки на категории', path: '/promo-catalog/151-skidki-na-kategorii', id: 151 },
];

/** Алкогольный раздел — единственный, где нужна модалка «18+» и где isAdult = true. */
export const ALCOHOL_SECTION_ID = 81;

/** §4.2: табак выбрасываем и по слагу раздела, и по названию товара. */
export const TOBACCO_SLUG_RE = /(tabak|tabacco|tobacco|sigaret|cigar|papir|vape|iqos|glo|nasv|kaljan)/i;

/**
 * Страница /shops (адреса магазинов). Снята с реального рендера 27.11.2026:
 * список живёт в `.shops-page__list`, каждая запись — `.shops-list-item`, адрес
 * лежит в `title` блока `--info` (в видимом тексте он склеен с названием и часами,
 * поэтому берём атрибут, а не textContent).
 *
 * Потолок выдачи — 50 карточек на один запрос и пагинации нет; полнота набирается
 * объединением нескольких запросов и чипов форматов (см. SHOP_QUERY_TEMPLATES).
 */
export const SHOPS_PAGE = {
  path: '/shops',
  item: '.shops-list-item',
  info: '.shops-list-item--info',
  name: '.shops-list-item--label',
  schedule: '.shops-list-item--schedule',
  viewToggle: '.shops-page__view-toggle',
  viewToggleText: 'Списком',
  searchInput: '.shops-page--search-form-input input',
  chipsGroup: '.pl-chips-group',
  selectedStoreBar: '.pl-shop-select-bar__info--address',
} as const;

/** Чипы фильтра на /shops — взяты с реальной страницы (часть даёт 0, это нормально). */
export const SHOP_CHIPS = ['Все', 'Магнит', 'М.Косметик', 'Семейный', 'Экстра', 'Моя цена'];

/**
 * Шаблоны поисковых запросов. Один запрос упирается в потолок 50 карточек, а сортировка
 * выдачи — по близости к магазину, выбранному в шапке (cookie `shopCode`), поэтому город
 * в 400 км от выбранного магазина в первые 50 не влезает: нужны разные формулировки.
 */
export const SHOP_QUERY_TEMPLATES = [
  'г {city}',
  '{city}, ул',
  '{city}, пр-кт',
  '{city}, б-р',
  '{city}, пер',
  '{city}, ш',
  '{city}, туп',
  '{city}, проезд',
  '{city}, пл',
  '{city}, наб',
  '{city}, мкр',
  '{city}',
];

/**
 * Запасной проход: поиск матчит целые токены, а не подстроки — запрос «Ставрополь, ул А»
 * на живом рендере не дал ни одной новой карточки, зато номера домов работают.
 */
export const SHOP_QUERY_FALLBACK = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => `{city}, ${digit}`);

/**
 * Переключатель магазина в шапке (снято с живого рендера 27.11.2026).
 *
 * Города как переключателя на сайте нет: выбирается конкретный магазин, и его код
 * уходит в cookie `shopCode` (значение — JSON-строка с кавычками: `%22992301%22`).
 * Кликабельна именно кнопка внутри карточки (`button.pl-button-inline`): клик по
 * контейнеру `--item-left` или по центру карточки куку не меняет — проверено вживую.
 */
export const SHOP_PICKER = {
  openButton: 'button.pl-shop-select-bar',
  panel: '.pl-shop-select',
  addressInput: '.pl-shop-select input[placeholder="Адрес магазина"]',
  item: '.pl-shop-select-shop-list-item',
  itemPick: '.pl-shop-select-shop-list-item button.pl-button-inline',
  tabPickup: 'Самовывоз',
  /** Адрес выбранного магазина после выбора виден в шапке. */
  selectedBar: '.app-location',
} as const;
