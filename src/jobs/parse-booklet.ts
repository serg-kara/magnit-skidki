/**
 * §4.5 — резервный путь: распечатка буклета акций (PDF) в те же структуры, что и
 * parсер страниц. Реализация намеренно не дописана: основной источник — magnit.ru,
 * и этот модуль не должен ничего ломать, пока не востребован.
 *
 * Вход: PDF-буклет (`npx pdftotext` / готовый текстовый дамп).
 * Выход: RawCard[] — тот же тип, что у extract-cards, дальше общий saveCards().
 */

import type { RawCard } from './extract-cards';

export type BookletInput = {
  /** Текст буклета, уже извлечённый из PDF (pdf2txt/pdftotext -layout). */
  text: string;
  /** slug категории из буклетного раздела; сверяется с config/categories. */
  categorySlug: string;
  /** Дата выхода буклета — из неё считается срок «до» без года. */
  issuedAt: Date;
};

export type BookletResult = {
  cards: RawCard[];
  /** Сколько блоков не разобрано — по этому числу видно, что резерв деградирует. */
  unparsed: number;
};

export const BOOKLET_STATUS = 'not-implemented' as const;

export function parseBooklet(input: BookletInput): BookletResult {
  // TODO(§4.5): 1) разбить input.text на товарные блоки колонками;
  //   2) для каждого блока вытащить название/цены/процент/сроки тем же normalize-слоем;
  //   3) прогнать через isTobacco — правила из §4.2 обязаны действовать и здесь;
  //   4) вернуть RawCard[] c sourceUrl = null, imageUrl = null, сроками от input.issuedAt.
  if (!input.text.trim()) return { cards: [], unparsed: 0 };
  return { cards: [], unparsed: 1 };
}
