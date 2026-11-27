import { createHash } from 'node:crypto';
import { transliterate } from '@/lib/translit';

const SPACE_CHARS = /[\u00a0\u2000-\u200a\u202f\u205f\u3000\s]/g;

/** «1 299,90 ₽» → 1299.9 (§4.3). NBSP и узкие пробелы — обязательны к вырезанию. */
export function parsePrice(input: string | null | undefined): number | null {
  if (!input) return null;
  let cleaned = input.replace(SPACE_CHARS, '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(cleaned)) return null;
  // «99,90 руб.» — точка от слова «руб.» не десятичный разделитель: хвостовые отбрасываем.
  cleaned = cleaned.replace(/[.,]+$/, '');
  const decIdx = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  let intPart = decIdx >= 0 ? cleaned.slice(0, decIdx) : cleaned;
  let frac = decIdx >= 0 ? cleaned.slice(decIdx + 1) : '';
  // «1.299» — это тысячи, а не дробь: больше двух знаков после разделителя в ценах не бывает.
  if (frac && !/^\d{1,2}$/.test(frac)) {
    intPart += frac;
    frac = '';
  }
  intPart = intPart.replace(/[.,]/g, '');
  const value = Number(`${intPart || '0'}${frac ? `.${frac}` : ''}`);
  return Number.isFinite(value) ? value : null;
}

/** Процент скидки, если сайт отдал его текстом («-20%», «20 %»). */
export function parsePercent(input: string | null | undefined): number | null {
  if (!input) return null;
  const m = /(\d{1,3})\s*%/.exec(input.replace(SPACE_CHARS, ' '));
  if (!m) return null;
  const value = Number(m[1]);
  return value > 0 && value <= 100 ? value : null;
}

export function discountFromPrices(priceOld: number | null, priceNew: number | null): number | null {
  if (!priceOld || !priceNew || priceOld <= 0 || priceNew > priceOld) return null;
  return Math.round(((priceOld - priceNew) / priceOld) * 100);
}

const MONTHS: Record<string, number> = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
  январь: 1,
  февраль: 2,
  март: 3,
  апрель: 4,
  май: 5,
  июнь: 6,
  июль: 7,
  август: 8,
  сентябрь: 9,
  октябрь: 10,
  ноябрь: 11,
  декабрь: 12,
};

type ParsedDate = { day: number; month: number; year: number | null };

const DATE_TOKEN = String.raw`(\d{1,2})[.\s/-](\d{1,2}|${Object.keys(MONTHS).join('|')})(?:[.\s/-](\d{2,4}))?`;

function toDate(parsed: ParsedDate, endOfDay: boolean): Date {
  const date = new Date(parsed.year ?? 1970, parsed.month - 1, parsed.day);
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
}

function applyYearRule(parsed: ParsedDate, now: Date): ParsedDate {
  if (parsed.year !== null) return parsed;
  // §4.3: месяц больше текущего → прошлый год, иначе текущий.
  const year = parsed.month > now.getMonth() + 1 ? now.getFullYear() - 1 : now.getFullYear();
  return { ...parsed, year };
}

function extractTokens(text: string): ParsedDate[] {
  const out: ParsedDate[] = [];
  for (const m of text.matchAll(new RegExp(DATE_TOKEN, 'gi'))) {
    const monthName = m[2].toLowerCase();
    const month = MONTHS[monthName] ?? Number(monthName);
    const day = Number(m[1]);
    if (!Number.isFinite(day) || !Number.isFinite(month) || month < 1 || month > 12) continue;
    if (day < 1 || day > 31) continue;
    let year: number | null = m[3] ? Number(m[3]) : null;
    if (year !== null && year < 100) year += 2000;
    out.push({ day, month, year });
  }
  return out;
}

/**
 * Разбор срока акции (§4.3): «01.09 – 30.09», «20.11 – 03.12», «01.09.2026 по 30.09.2026»,
 * «до 30 ноября». Год подставляется по правилу из ТЗ, конец диапазона переносится на
 * следующий год, если диапазон пересекает Новый год.
 */
export function parseDateRange(
  input: string | null | undefined,
  now: Date = new Date(),
): { validFrom: Date | null; validTo: Date | null } {
  if (!input) return { validFrom: null, validTo: null };
  const text = input.replace(SPACE_CHARS, ' ').trim();
  const tokens = extractTokens(text);
  if (!tokens.length) return { validFrom: null, validTo: null };

  if (tokens.length === 1) {
    // Одна дата на карточке — это конец срока («до 30.11»); началом считаем сегодня,
    // поэтому validFrom остаётся null и акция не выглядит будущей.
    const only = applyYearRule(tokens[0], now);
    return { validFrom: null, validTo: toDate(only, true) };
  }

  const start = applyYearRule(tokens[0], now);
  const endRaw = tokens[1];
  let end: ParsedDate;
  if (endRaw.year !== null) {
    end = endRaw;
  } else if (endRaw.month < start.month || (endRaw.month === start.month && endRaw.day < start.day)) {
    // §4.3: диапазон пересекает Новый год — год конца диапазона следующий.
    end = { ...endRaw, year: start.year! + 1 };
  } else {
    end = { ...endRaw, year: start.year };
  }
  return { validFrom: toDate(start, false), validTo: toDate(end, true) };
}

/** §4.2: табак и системы нагревания не парсим нигде, включая алкогольный раздел. */
export const TOBACCO_RE =
  /(сигарет|табак|папирос|пачк(а|и)\s+сигарет|iqos|glo|систем(а|ы)\s+нагревания)/i;

export function isTobacco(text: string | null | undefined): boolean {
  if (!text) return false;
  return TOBACCO_RE.test(text);
}

/**
 * Границы единиц измерения. `\b` не подходит: в JS он считается по ASCII-\w,
 * а «г», «л», «шт» — кириллица, для движка она не «слова», и `\b` рядом с ней ломается.
 */
const UNIT_BEFORE = '(?:^|[^0-9a-zа-яё.,])';
const UNIT_AFTER = '(?:$|[^0-9a-zа-яё])';
const UNIT_RE = new RegExp(
  `${UNIT_BEFORE}(\\d+(?:[.,]\\d+)?)\\s*(л|мл|литров?|г|кг|мг|шт\\.?|упак\\.?|уп|пачек|блок|бутылк\\w*|банок?|коробк\\w*|т)${UNIT_AFTER}`,
  'gi',
);

/** §4.3: единицы измерения выносим из названия, иначе slug'и плодят дубли одного товара. */
export function splitUnits(name: string): { cleanName: string; unit: string | null } {
  const found = [...name.matchAll(UNIT_RE)].map((m) => `${m[1]} ${m[2]}`);
  const cleanName = name
    .replace(UNIT_RE, ' ')
    .replace(SPACE_CHARS, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;.\s]+$/g, '')
    .trim();
  return {
    cleanName: cleanName || name.trim(),
    unit: found.length ? found.join(' ').toLowerCase() : null,
  };
}

/** §4.3: транслит + kebab от нормализованного названия. */
export function productSlug(name: string): string {
  const { cleanName } = splitUnits(name);
  const normalized = cleanName
    .toLowerCase()
    .replace(/["«»'’`]/g, '')
    .replace(/[^0-9a-zа-яё]+/gi, ' ')
    .trim();
  const slug = transliterate(normalized);
  return slug || 'tovar';
}

export function normalizeBonus(bonus: string | null | undefined): string {
  if (!bonus) return '';
  // Схлопываем все виды пробелов (NBSP включительно) в один обычный и убираем регистр:
  // иначе «2  по цене 1» и «2 по цене 1» дадут два разных sig и дубль акции в базе.
  return bonus
    .replace(SPACE_CHARS, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .toLowerCase();
}

/** §4.4 — хэш содержания для дедупа. Порядок полей зафиксирован, цены — через toFixed(2). */
export function computeSig(input: {
  productId: number;
  scope: string;
  storeIds: number[];
  priceNew: number | null;
  priceOld: number | null;
  validFrom: Date | null;
  validTo: Date | null;
  bonus: string | null;
}): string {
  const parts = [
    String(input.productId),
    input.scope,
    [...input.storeIds].sort((a, b) => a - b).join(','),
    input.priceNew === null ? '' : input.priceNew.toFixed(2),
    input.priceOld === null ? '' : input.priceOld.toFixed(2),
    input.validFrom ? input.validFrom.toISOString() : '',
    input.validTo ? input.validTo.toISOString() : '',
    normalizeBonus(input.bonus),
  ];
  return createHash('sha1').update(parts.join('|')).digest('hex');
}

/** Сравнение названия города на странице с ожидаемым (§4.1.4). */
export function cityNamesMatch(pageCity: string, expectedCity: string): boolean {
  const norm = (value: string) =>
    value
      .replace(SPACE_CHARS, ' ')
      .toLowerCase()
      .replace(/^(город|г\.?|мо)\s+/i, '')
      .replace(/[^0-9a-zа-яё]+/gi, '')
      .trim();
  const a = norm(pageCity);
  const b = norm(expectedCity);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * §4.1.4 по реальной разметке: magnit.ru выбирает не «город», а конкретный магазин,
 * и его адрес попадает в <title>: «Акции и скидки: алкоголь — … (81) |
 * Краснодарский край, Краснодар г, им. Дзержинского ул, дом № 42».
 * Город — элемент после края/области с снятым суффиксом «г»/«ст-ца».
 */
export function cityFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  // Адрес магазина приклеивается к title после «|». Без него город неизвестен —
  // выдумывать его из слов «Акции и скидки» нельзя: это ровно тот ложный совпад,
  // ради которого и сделана проверка города (§4.1.4).
  if (!title.includes('|')) return null;
  const tail = title.split('|').slice(-1)[0];
  const parts = tail
    .split(',')
    .map((part) => part.replace(SPACE_CHARS, ' ').trim())
    .filter(Boolean);
  for (const part of parts) {
    // \b здесь нельзя: он считается по ASCII-\w, а «край» оканчивается кириллицей.
    if (/(край|область|республика|автономн)\s*$/i.test(part)) continue;
    const cleaned = part
      .replace(/\b(г\.?|город|ст-?ца\.?|станица|пос\.?|посёлок|с\.?|село|r\.p)\b\.?/gi, ' ')
      .replace(SPACE_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Оставляем первое слово: «Краснодар г» → «Краснодар», «им. Дзержинского ул» отсекается ниже.
    const first = cleaned.split(' ')[0] ?? '';
    if (first.length >= 3 && /^[а-яёa-z]/i.test(first) && !/^(им|ул|д|дом|пр|б-р|ш|корпус|кв)$/i.test(first)) {
      return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }
  }
  return null;
}

const WS_RE = /\s+/g;
const REGION_WORD_RE = /(край|область|республика|автономн)/i;
/**
 * Границу типа слова задаём явно: в JS `\b` считается по ASCII-\w, а «ул», «д», «г» —
 * кириллица, и с `\b` такие префиксы не матчились бы никогда (та же ловушка, о которой
 * сказано в комментарии к cityFromTitle).
 */
const TYPE_END = '(?=$|[\\s.,\\-])';
const STREET_TYPES = 'ул|улица|проспект|пр-?кт|пр|б-?р|бульвар|пер|переулок|шоссе|ш|туп|тупик|проезд|пл|площадь|наб|набережная|спуск|тракт|автодорога|влад';
const SETTLEMENT_TYPES = 'г|город|ст-?ца|станица|с|село|п|пос|посёлок|поселок|пгт|рп|х|хутор|нп|мкр|кв';
const SETTLEMENT_PREFIX_RE = new RegExp(`^(${SETTLEMENT_TYPES})${TYPE_END}`, 'i');
const SETTLEMENT_TAIL_RE = new RegExp(`[\\s.,](${SETTLEMENT_TYPES})$`, 'i');
const STREET_WORD_RE = new RegExp(`^(${STREET_TYPES})${TYPE_END}`, 'i');
const STREET_TAIL_RE = new RegExp(`[\\s.,](${STREET_TYPES})$`, 'i');
const HOUSE_WORD_RE = new RegExp(`^(д|дом|кор|корпус|стр|строение|з|зд|здание|влд)${TYPE_END}`, 'i');
const HOUSE_VALUE_RE = /([0-9]+[0-9a-zа-яё\/-]*)/i;

function isHouseToken(token: string): string | null {
  if (HOUSE_WORD_RE.test(token)) return token.replace(HOUSE_WORD_RE, ' ').match(HOUSE_VALUE_RE)?.[1] ?? null;
  // «25/1», «233и»: после номера могут быть и цифры, и буквы, и разделители — иначе
  // OSM-формат «Калинина ул, 25/1» не распознавался бы как дом и слияние теряло совпадения.
  return /^[0-9]+[0-9a-zа-яё\/-]*$/i.test(token) ? token.match(HOUSE_VALUE_RE)?.[1] ?? null : null;
}

function isStreetToken(token: string): boolean {
  return STREET_WORD_RE.test(token) || STREET_TAIL_RE.test(token);
}

/** «ул. Калинина» / «Калинина ул» → «калинина»; многословные названия — через дефис. */
function stripType(raw: string): string {
  return raw
    .replace(WS_RE, ' ')
    .replace(STREET_WORD_RE, ' ')
    .replace(STREET_TAIL_RE, ' ')
    .replace(/[^0-9a-zа-яё\/-]+/gi, ' ')
    .trim()
    .replace(WS_RE, '-');
}

/**
 * Ключ адреса для слияния OSM и magnit.ru (§2 задачи на полноту): регион и город
 * в двух источниках подписаны по-разному («Краснодар г» против «г Краснодар»), а
 * улица с номером дома — устойчивая часть. Без номера дома ключ не отдаём: два
 * магазина «на одной улице, дом неизвестен» схлопнуть нельзя, это разные точки.
 */
export function addressKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = decodeHtmlEntitiesSafe(raw)
    .replace(/№/g, ' ')
    .replace(/[^0-9a-zа-яё\/.,\- ]+/gi, ' ')
    .toLowerCase();
  if (/адрес не указан/.test(text)) return null;

  const tokens = text
    .split(',')
    .map((part) => part.replace(WS_RE, ' ').trim())
    .filter((part) => part && !REGION_WORD_RE.test(part));

  let house: string | null = null;
  let houseIndex = -1;
  for (let index = 0; index < tokens.length; index++) {
    const value = isHouseToken(tokens[index]);
    if (value) {
      house = value;
      houseIndex = index;
      break;
    }
  }
  if (!house) return null;

  // Улица — токен с явным типовым словом (в OSM «улица Калинина», на сайте «Калинина ул»);
  // если такого нет, берём любой осмысленный токен не-поселения.
  const rest = tokens.filter((_, index) => index !== houseIndex);
  const street =
    rest.find(isStreetToken) ??
    rest.find((token) => !SETTLEMENT_PREFIX_RE.test(token) && stripType(token).length >= 3);
  if (!street) return null;
  const core = stripType(street);
  if (!core) return null;
  return `${core}|${house}`;
}

/** Населённый пункт из адреса: «Ставропольский край, г Ставрополь, …» → «Ставрополь». */
export function settlementFromAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  for (const partRaw of raw.split(',')) {
    const part = partRaw.replace(WS_RE, ' ').trim();
    if (!part || REGION_WORD_RE.test(part)) continue;
    if (isStreetToken(part) || isHouseToken(part)) continue;
    // Город может быть подписан и до названия («г Ставрополь»), и после («Курганинск г»).
    const stripped = part
      .replace(SETTLEMENT_PREFIX_RE, ' ')
      .replace(SETTLEMENT_TAIL_RE, ' ')
      .replace(/[^0-9a-zа-яё\- ]+/gi, ' ')
      .replace(WS_RE, ' ')
      .trim();
    if (stripped.length >= 3) {
      return stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
    }
  }
  return null;
}

function decodeHtmlEntitiesSafe(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&thinsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/\u00a0|\u2009|\u202f/g, ' ');
}

