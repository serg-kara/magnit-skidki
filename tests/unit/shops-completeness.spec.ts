import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { mergedCount, parseShopsHtml, type SiteShop } from '@/jobs/extract-shops';
import { addressKey, cityNamesMatch, settlementFromAddress } from '@/lib/parse/normalize';

/**
 * П.4 задачи: проверка полноты списка магазинов — только по закоммиченным фикстурам
 * (снимки /shops + OSM-сид), без выхода в сеть (как и §9.2 для остальных тестов).
 */
const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'magnit');

type OsmSample = { cities: { slug: string; stores: { osmId: string; address: string }[] }[] };
const osmSample = JSON.parse(
  readFileSync(path.join(process.cwd(), 'data', 'stores.sample.json'), 'utf8'),
) as OsmSample;

function osmStores(slug: string): { id: string; address: string }[] {
  return (osmSample.cities.find((city) => city.slug === slug)?.stores ?? []).map((store) => ({
    id: store.osmId,
    address: store.address,
  }));
}

function fixturesFor(citySlug: string): string[] {
  if (!existsSync(FIXTURES)) return [];
  const merged = `stores--${citySlug}.html`;
  return existsSync(path.join(FIXTURES, merged)) ? [merged] : [];
}

/** Фикстура города — реальные карточки выдачи /shops, объединённые из нескольких запросов. */
function shopsOf(citySlug: string): SiteShop[] {
  return fixturesFor(citySlug).flatMap((file) => parseShopsHtml(readFileSync(path.join(FIXTURES, file), 'utf8')));
}

function inCity(citySlug: string, cityName: string): SiteShop[] {
  return shopsOf(citySlug).filter((shop) => !shop.settlement || cityNamesMatch(shop.settlement, cityName));
}

test.describe('полнота списка магазинов (п.4 задачи)', () => {
  test('Ставрополь: после слияния OSM + сайт не меньше 100 магазинов', () => {
    expect(fixturesFor('stavropol').length, 'нет фикстуры stores--stavropol.html').toBeGreaterThan(0);
    const stats = mergedCount(osmStores('stavropol'), inCity('stavropol', 'Ставрополь'));
    expect(stats.total, `OSM ${stats.osm} + только с сайта ${stats.siteOnly} = ${stats.total}`).toBeGreaterThanOrEqual(100);
  });

  test('Курганинск: после слияния OSM + сайт не меньше 10 магазинов', () => {
    expect(fixturesFor('kurganinsk').length, 'нет фикстуры stores--kurganinsk.html').toBeGreaterThan(0);
    const stats = mergedCount(osmStores('kurganinsk'), inCity('kurganinsk', 'Курганинск'));
    expect(stats.total, `OSM ${stats.osm} + только с сайта ${stats.siteOnly} = ${stats.total}`).toBeGreaterThanOrEqual(10);
  });

  test('одного OSM мало: именно поэтому нужен источник с сайта сети', () => {
    expect(osmStores('kurganinsk').length).toBeLessThan(10);
    expect(osmStores('stavropol').length).toBeLessThan(100);
    expect(inCity('kurganinsk', 'Курганинск').length).toBeGreaterThan(3);
  });

  test('карточки сайта не удваивают то, что уже есть в OSM', () => {
    const stats = mergedCount(osmStores('stavropol'), inCity('stavropol', 'Ставрополь'));
    expect(stats.total).toBe(stats.osm + stats.siteOnly);
    expect(stats.siteOnly).toBeLessThanOrEqual(stats.site);
  });
});

test.describe('нормализация адреса для слияния (п.2 задачи)', () => {
  test('адрес сайта и адрес OSM дают один ключ', () => {
    expect(addressKey('Ставропольский край, г Ставрополь, ул Тухачевского, д 25/1')).toBe('тухачевского|25/1');
    expect(addressKey('Тухачевского ул, 25/1')).toBe('тухачевского|25/1');
    expect(addressKey('Краснодарский край, Курганинск г, улица Калинина, дом № 81')).toBe('калинина|81');
    expect(addressKey('улица Калинина, д. 81')).toBe('калинина|81');
  });

  test('буква при номере дома — это другой дом', () => {
    expect(addressKey('Ставрополь, Октябрьская ул, 233и')).toBe('октябрьская|233и');
    expect(addressKey('Ставрополь, Октябрьская ул, 233')).not.toBe(addressKey('Ставрополь, Октябрьская ул, 233и'));
  });

  test('без номера дома ключ не отдаём, чтобы не схлопнуть разные точки', () => {
    expect(addressKey('Ставропольский край, г Ставрополь, ул Тухачевского')).toBeNull();
    expect(addressKey('адрес не указан в OSM')).toBeNull();
    expect(addressKey('')).toBeNull();
  });

  test('населённый пункт достаётся и из «г X», и из «X г»', () => {
    expect(settlementFromAddress('Ставропольский край, г Ставрополь, ул Мира, д 10')).toBe('Ставрополь');
    expect(settlementFromAddress('Краснодарский край, Курганинск г, ул Калинина, д 81')).toBe('Курганинск');
    expect(settlementFromAddress('Ставропольский край, ст-ца Расшеватская, ул Почтовая, зд 2Б')).toBe('Расшеватская');
  });
});
