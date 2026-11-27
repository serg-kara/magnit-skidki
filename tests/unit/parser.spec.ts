import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  cityFromTitle,
  cityNamesMatch,
  computeSig,
  discountFromPrices,
  isTobacco,
  parseDateRange,
  parsePercent,
  parsePrice,
  productSlug,
  splitUnits,
} from '@/lib/parse/normalize';
import { extractCards, readPageCity, readPageTitle } from '@/jobs/extract-cards';
import { draftSlug } from '@/jobs/save-promotions';

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'magnit');

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

/**
 * Фиксируем «сейчас», чтобы правило подстановки года из §4.3 не зависело от даты прогона.
 * 20 ноября 2026 — дата, на которую сняты и живые снимки magnit.ru.
 */
const NOW = new Date(2026, 10, 20, 12, 0, 0);

/** Синтетические фикстуры в реальной разметке: прогоняют то, чего в живом снимке нет (цены, сроки). */
const SYNTH_GROCERIES = 'synthetic--kurganinsk--23.html';
const SYNTH_KRASNODEAR = 'synthetic--krasnodar--23.html';
const SYNTH_ALCOHOL = 'synthetic--kurganinsk--81.html';
/** Живые снимки страниц magnit.ru от 26.11.2026 (§4.1.2). */
const REAL_GROCERIES = 'real--krasnodar--22.html';
const REAL_ALCOHOL = 'real--krasnodar--81.html';

test.describe('нормализация цены (§4.3)', () => {
  test('1 299,90 ₽ → 1299.9', () => {
    expect(parsePrice('1 299,90 ₽')).toBe(1299.9);
  });

  test('неразрывные и узкие пробелы вырезаются', () => {
    expect(parsePrice('1\u00a0299,90\u00a0₽')).toBe(1299.9);
    expect(parsePrice('1\u202f299,90\u202f₽')).toBe(1299.9);
    expect(parsePrice('69,99\u00a0руб.')).toBe(69.99);
    expect(parsePrice('12\u00a0₽')).toBe(12);
    // Узкий пробел между цифрами — разделитель тысяч, а не десятичный разделитель.
    expect(parsePrice('69\u200999\u00a0₽')).toBe(6999);
  });

  test('точка как разделитель тысяч и как десятичная', () => {
    expect(parsePrice('1.299,90 ₽')).toBe(1299.9);
    expect(parsePrice('1.299 ₽')).toBe(1299);
    expect(parsePrice('89.9 ₽')).toBe(89.9);
  });

  test('без цены и мусор → null', () => {
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice('нет цены')).toBeNull();
    expect(parsePrice('0')).toBe(0);
  });

  test('процент из текста и из цен', () => {
    expect(parsePercent('-28%')).toBe(28);
    expect(parsePercent('19\u00a0%')).toBe(19);
    expect(parsePercent('Акция')).toBeNull();
    expect(discountFromPrices(899, 649)).toBe(28);
    expect(discountFromPrices(84, 69.99)).toBe(17);
    expect(discountFromPrices(null, 100)).toBeNull();
    expect(discountFromPrices(100, 120)).toBeNull();
  });
});

test.describe('сроки акции без года (§4.3)', () => {
  test('диапазон в текущем году', () => {
    const { validFrom, validTo } = parseDateRange('20.11 – 03.12', NOW);
    expect(validFrom).toEqual(new Date(2026, 10, 20, 0, 0, 0, 0));
    expect(validTo).toEqual(new Date(2026, 11, 3, 23, 59, 59, 999));
  });

  test('месяц начала меньше текущего — берём текущий год', () => {
    const { validFrom, validTo } = parseDateRange('01.09 – 30.09', NOW);
    expect(validFrom?.getFullYear()).toBe(2026);
    expect(validFrom?.getMonth()).toBe(8);
    expect(validTo?.getFullYear()).toBe(2026);
  });

  test('месяц начала больше текущего — по правилу §4.3 это прошлый год', () => {
    const { validFrom } = parseDateRange('01.12 – 31.12', NOW);
    expect(validFrom?.getFullYear()).toBe(2025);
    expect(validFrom?.getMonth()).toBe(11);
  });

  test('диапазон пересекает Новый год — год конца следующий', () => {
    const { validFrom, validTo } = parseDateRange('15.12 – 10.01', NOW);
    expect(validFrom).toEqual(new Date(2025, 11, 15));
    expect(validTo).toEqual(new Date(2026, 0, 10, 23, 59, 59, 999));
  });

  test('явный год на странице важнее правила', () => {
    const { validFrom, validTo } = parseDateRange('01.09.2025 – 30.09.2025', NOW);
    expect(validFrom?.getFullYear()).toBe(2025);
    expect(validTo?.getFullYear()).toBe(2025);
  });

  test('месяц словами («с 27 ноября по 10 декабря»)', () => {
    const { validFrom, validTo } = parseDateRange('с 27 ноября по 10 декабря', NOW);
    expect(validFrom).toEqual(new Date(2026, 10, 27));
    expect(validTo).toEqual(new Date(2026, 11, 10, 23, 59, 59, 999));
  });

  test('пустой срок не изобретается', () => {
    expect(parseDateRange(null, NOW)).toEqual({ validFrom: null, validTo: null });
    expect(parseDateRange('акция выходного дня', NOW)).toEqual({ validFrom: null, validTo: null });
  });
});

test.describe('табак и алкоголь (§4.2)', () => {
  test('правило матчит табак и системы нагревания', () => {
    expect(isTobacco('Сигареты классические 20 шт')).toBe(true);
    expect(isTobacco('Табак для кальяна 50 г')).toBe(true);
    expect(isTobacco('Система нагревания табака IQOS')).toBe(true);
    expect(isTobacco('Вино игристое 0,75 л')).toBe(false);
    expect(isTobacco('Коньяк 3 звёздочки 0,5 л')).toBe(false);
  });

  test('из алкогольной фикстуры табак удалён, алкоголь остался', () => {
    const result = extractCards(fixture(SYNTH_ALCOHOL), {
      categorySlug: 'alcohol',
      baseUrl: 'https://magnit.ru/promo-catalog/81-alkogol',
      now: NOW,
    });
    expect(result.droppedTobacco).toBe(2);
    expect(result.cards.length).toBe(3);
    expect(result.cards.some((card) => isTobacco(card.name))).toBe(false);
    expect(result.cards.map((card) => card.name).join(' ')).toMatch(/Вино/);
  });

  test('табачный раздел отсекается целиком, даже с названиями «не про табак»', () => {
    const result = extractCards(fixture(SYNTH_ALCOHOL), {
      categorySlug: 'tabak',
      baseUrl: 'https://magnit.ru/promo-catalog/99-tabak',
      now: NOW,
    });
    expect(result.cards.length).toBe(0);
    expect(result.droppedTobacco).toBe(result.totalCards);
  });

  test('в живом алкогольном снимке табака нет', () => {
    const result = extractCards(fixture(REAL_ALCOHOL), {
      categorySlug: 'alcohol',
      baseUrl: 'https://magnit.ru/promo-catalog/81-alkogol',
      now: NOW,
    });
    expect(result.cards.length).toBeGreaterThan(10);
    expect(result.cards.filter((card) => isTobacco(card.name))).toEqual([]);
  });

  test('живой снимок молочного раздела: карточки читаются, ссылки ведут на товар этого магазина', () => {
    const result = extractCards(fixture(REAL_GROCERIES), {
      categorySlug: 'dairy',
      baseUrl: 'https://magnit.ru/promo-catalog/22-moloko-syir-yajtsa',
      now: NOW,
    });
    expect(result.totalCards).toBeGreaterThan(0);
    expect(result.cards.length).toBe(result.totalCards);
    for (const card of result.cards) {
      expect(card.name.length).toBeGreaterThan(3);
      expect(card.sourceUrl).toMatch(/^https:\/\/magnit\.ru\/promo-product\//);
      expect(card.sourceUrl).toContain('shopCode=992301');
    }
    // Честно фиксируем состояние сайта на момент съёмка: цен в отдаче нет ни у одной
    // карточки. Именно этот случай parse-magnit.ts обязан превратить в blocked/error (§0.4),
    // а не молча записать акции с пустыми ценами.
    expect(result.cards.every((card) => card.priceNew === null && card.priceOld === null)).toBe(true);
    expect(readPageCity(fixture(REAL_GROCERIES))).toBe('Краснодар');
  });
});

test.describe('дедуп по sig (§4.4)', () => {
  const base = {
    productId: 42,
    scope: 'federal',
    storeIds: [3, 1, 2],
    priceNew: 649,
    priceOld: 899,
    validFrom: new Date('2026-11-20T00:00:00.000Z'),
    validTo: new Date('2026-12-03T21:59:59.999Z'),
    bonus: '-28% по карте Магнит',
  };

  test('sig стабилен при одинаковом содержании', () => {
    expect(computeSig(base)).toBe(computeSig({ ...base }));
  });

  test('порядок магазинов не влияет на sig', () => {
    expect(computeSig({ ...base, storeIds: [1, 2, 3] })).toBe(computeSig(base));
  });

  test('изменение цены меняет sig', () => {
    expect(computeSig({ ...base, priceNew: 599 })).not.toBe(computeSig(base));
  });

  test('регистр и лишние пробелы в бонусе не плодят новый sig', () => {
    expect(computeSig({ ...base, bonus: '  -28% ПО КАРТЕ  МАГНИТ ' })).toBe(computeSig(base));
  });
});

test.describe('название и slug товара (§4.3)', () => {
  test('единицы измерения уходят из названия в отдельное поле', () => {
    expect(splitUnits('Молоко ультрапастеризованное 3,2% 900 г')).toEqual({
      cleanName: 'Молоко ультрапастеризованное 3,2%',
      unit: '900 г',
    });
    expect(splitUnits('Вино игристое 0,5 л').unit).toBe('0,5 л');
    expect(splitUnits('Печенье 155 г').unit).toBe('155 г');
  });

  test('slug транслитом и kebab, один товар → один slug', () => {
    expect(productSlug('Молоко ультрапастеризованное 3,2% 900 г')).toBe(
      'moloko-ultrapasterizovannoe-3-2',
    );
    expect(productSlug('Молоко   ультрапастеризованное 3,2% 900г')).toBe(
      productSlug('Молоко ультрапастеризованное 3,2% 900 г'),
    );
  });

  test('разные объёмы одного товара — разные slug, иначе «Молоко» слипнется', () => {
    // Тот же draftSlug, что реально использует запись в БД, а не его копия в тесте.
    expect(draftSlug('Молоко 900 г')).not.toBe(draftSlug('Молоко 1 л'));
    expect(draftSlug('Молоко 900 г')).toBe(draftSlug('Молоко 900г'));
  });
});

test.describe('проверка города (§4.1.4)', () => {
  test('названия сравниваются с учётом «г.» и регистра', () => {
    expect(cityNamesMatch('Курганинск', 'Курганинск')).toBe(true);
    expect(cityNamesMatch('г. Краснодар', 'Краснодар')).toBe(true);
    expect(cityNamesMatch('Ставрополь', 'Тольятти')).toBe(false);
  });

  test('город достаётся из <title> с адресом магазина', () => {
    expect(
      cityFromTitle(
        'Акции и скидки: алкоголь — в каталоге на сайте сети Магнит (81) | Краснодарский край, Краснодар г, им. Дзержинского ул, дом № 42',
      ),
    ).toBe('Краснодар');
    expect(cityFromTitle('Акции и скидки — Магнит')).toBeNull();
  });

  test('живой снимок Краснодара не выдаёт себя за Ставрополь', () => {
    const html = fixture(REAL_ALCOHOL);
    const title = readPageTitle(html);
    const pageCity = readPageCity(html);
    expect(pageCity).toBe('Краснодар');
    expect(title).toContain('Краснодар');
    expect(cityNamesMatch(pageCity ?? '', 'Ставрополь')).toBe(false);
    expect(cityNamesMatch(pageCity ?? '', 'Курганинск')).toBe(false);
  });

  test('фикстура «Краснодар» не отдаёт свои акции за Ставрополь, а карточки разбираются', () => {
    const krasnodar = fixture(SYNTH_KRASNODEAR);
    expect(readPageCity(krasnodar)).toBe('Краснодар');
    expect(cityNamesMatch(readPageCity(krasnodar) ?? '', 'Ставрополь')).toBe(false);

    // Данные на странице есть — но под наш город их писать нельзя, и решение принимает
    // парсер по несовпадению города (parse-magnit → BlockedError).
    const cards = extractCards(krasnodar, {
      categorySlug: 'groceries',
      baseUrl: 'https://magnit.ru/promo-catalog/23-bakaleya-sousyi',
      now: NOW,
    });
    expect(cards.cards.length).toBe(2);
    expect(cards.cards[0].priceNew).toBeCloseTo(61.3, 2);
  });

  test('карточки из фикстуры разбираются в ожидаемые цены, бонусы и сроки', () => {
    const result = extractCards(fixture(SYNTH_GROCERIES), {
      categorySlug: 'groceries',
      baseUrl: 'https://magnit.ru/promo-catalog/23-bakaleya-sousyi',
      now: NOW,
    });
    expect(result.cards.length).toBe(4);

    const [milk, pasta, buckwheat, oil] = result.cards;

    expect(milk.priceNew).toBeCloseTo(69.99, 2);
    expect(milk.priceOld).toBe(84);
    expect(milk.discountPct).toBe(17);
    expect(milk.sourceUrl).toContain('/promo-product/1001-moloko');

    expect(pasta.priceNew).toBe(1299.9);
    // §4.3: если указана только новая цена — priceOld = null.
    expect(pasta.priceOld).toBeNull();

    expect(buckwheat.bonus).toBe('2 по цене 1');
    expect(buckwheat.validFrom).toEqual(new Date(2026, 10, 27));
    expect(buckwheat.validTo).toEqual(new Date(2026, 11, 10, 23, 59, 59, 999));

    // «01.09 – 30.09» при NOW = 20.11 уже закончилась — акция не должна уезжать в будущее.
    expect(oil.validTo!.getTime()).toBeLessThan(NOW.getTime());
    expect(oil.discountPct).toBe(19);
    expect(oil.priceNew).toBe(112);
  });
});
