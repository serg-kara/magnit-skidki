import { parseHtml, querySelectorAll, querySelector, visibleText, type HtmlElement } from '@/lib/parse/html';
import {
  cityFromTitle,
  discountFromPrices,
  isTobacco,
  parseDateRange,
  parsePercent,
  parsePrice,
} from '@/lib/parse/normalize';
import { SELECTORS, TOBACCO_SLUG_RE } from './selectors';

export type RawCard = {
  name: string;
  brand: string | null;
  categorySlug: string;
  priceOld: number | null;
  priceNew: number | null;
  discountPct: number | null;
  bonus: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  imageUrl: string | null;
  sourceUrl: string | null;
};

export type ExtractResult = {
  cards: RawCard[];
  droppedTobacco: number;
  pageCity: string | null;
  totalCards: number;
};

function textOf(root: HtmlElement, selector: string): string | null {
  const el = querySelector([root], selector);
  if (!el) return null;
  const text = visibleText(el);
  return text || null;
}

/**
 * Цена на странице может быть нарезана узлами («69» + «,99 ₽»), поэтому собирать её
 * по leaf-элементам нельзя: берём текст всего поддерева и вытаскиваем все «число ₽».
 *
 * Фолбэка «любое число похоже на цену» сознательно нет: без символа валюты число
 * в карточке — это фасовка («100 г», «0,75 л»), а выдуманную цену парсер отдавать
 * не вправе (§0.4: нет данных — фиксируем отсутствие данных, а не подменяем их).
 */
const PRICE_TOKEN = /(\d[\d\u00a0\s]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?)/gi;

function priceCandidates(root: HtmlElement): number[] {
  return [...visibleText(root).matchAll(PRICE_TOKEN)]
    .map((m) => parsePrice(m[1]))
    .filter((value): value is number => value !== null);
}

function dateCandidate(card: HtmlElement): string | null {
  const own = visibleText(card);
  const m = /\d{1,2}[.]\d{1,2}(?:[.]\d{2,4})?\s*[-–—]\s*\d{1,2}[.]\d{1,2}(?:[.]\d{2,4})?/.exec(own);
  if (m) return m[0];
  const single = /\b(?:до|с)\s+\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i.exec(
    own,
  );
  return single ? single[0] : null;
}

function absoluteUrl(href: string | null | undefined, baseUrl: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * §4.1.4 по факту: город на magnit.ru — это выбранный магазин, его адрес лежит
 * в `<title>` страницы, оттуда и достаём название города.
 */
export function readPageCity(html: string): string | null {
  const roots = parseHtml(html);
  const el = querySelector(roots, SELECTORS.pageTitle);
  if (!el) return null;
  return cityFromTitle(visibleText(el));
}

/** Полный текст `<title>` — полезен для лога при несовпадении города. */
export function readPageTitle(html: string): string | null {
  const roots = parseHtml(html);
  const el = querySelector(roots, SELECTORS.pageTitle);
  return el ? visibleText(el) || null : null;
}

/**
 * §4.1–4.2: HTML страницы раздела акций → плоский список карточек.
 * Табак отсеивается здесь же, включая подмешивание в алкогольный раздел.
 */
export function extractCards(
  html: string,
  options: { categorySlug: string; baseUrl: string; now?: Date },
): ExtractResult {
  const now = options.now ?? new Date();
  const roots = parseHtml(html);
  const cards: RawCard[] = [];
  let droppedTobacco = 0;

  const elements = querySelectorAll(roots, SELECTORS.card);
  for (const card of elements) {
    const name = textOf(card, SELECTORS.name);
    if (!name) continue;
    if (isTobacco(name) || TOBACCO_SLUG_RE.test(options.categorySlug)) {
      droppedTobacco++;
      continue;
    }

    // Цены: сначала внутри блока `.unit-catalog-product-preview-prices`, затем по всей
    // карточке. Конкретных классов «новая/старая» на сайте не наблюдали, поэтому
    // минимальное значение — новая цена, максимальное — старая (§4.3: если цена только
    // одна, priceOld остаётся null).
    const block = querySelector([card], SELECTORS.prices);
    const inBlock = block ? priceCandidates(block) : [];
    const candidates = inBlock.length ? inBlock : priceCandidates(card);
    let priceNew: number | null = null;
    let priceOld: number | null = null;
    if (candidates.length === 1) {
      priceNew = candidates[0];
    } else if (candidates.length >= 2) {
      const sorted = [...candidates].sort((a, b) => a - b);
      priceNew = sorted[0];
      // Одинаковые значения — это не «цена была», а одна и та же цифра в двух узлах.
      priceOld = sorted[sorted.length - 1] > priceNew ? sorted[sorted.length - 1] : null;
    }

    // Бейджи: в реальном снимке это «Акция», иногда «-20%» или «2 по цене 1».
    const badgeTexts = querySelectorAll([card], SELECTORS.badges)
      .map((badge) => visibleText(badge))
      .filter(Boolean);
    const discountPct =
      badgeTexts.reduce<number | null>(
        (acc, text) => acc ?? parsePercent(text),
        null,
      ) ?? discountFromPrices(priceOld, priceNew);
    // «Акция» — служебное слово, а не текст акции; бонусом считаем остальное.
    const bonus = badgeTexts.find((text) => !/^акция$/i.test(text) && parsePercent(text) === null) ?? null;

    // Строков срока на карточке нет — если на странице они всё же появятся, их
    // подберёт текстовый скан (там же, где и даты вида «01.09 – 30.09»).
    const { validFrom, validTo } = parseDateRange(dateCandidate(card), now);

    const img = querySelector([card], SELECTORS.image);
    const link = querySelector([card], SELECTORS.link);

    cards.push({
      name,
      // Отдельного узла бренда на карточке каталога нет, а выводить его из названия
      // догадкой не будем: поле остаётся null, пока сайт не начнёт отдавать бренд явно.
      brand: null,
      categorySlug: options.categorySlug,
      priceOld,
      priceNew,
      discountPct,
      bonus,
      validFrom,
      validTo,
      imageUrl: img ? absoluteUrl(img.attrs['data-src'] ?? img.attrs.src, options.baseUrl) : null,
      sourceUrl: absoluteUrl(link?.attrs.href, options.baseUrl),
    });
  }

  return { cards, droppedTobacco, pageCity: readPageCity(html), totalCards: elements.length };
}
