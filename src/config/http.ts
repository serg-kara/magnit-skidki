/**
 * Эндпоинты Overpass по приоритету. Первый — канонический из §3.2; зеркала пробуются,
 * только когда основной сервер недоступен или режет наш IP после серии ошибок
 * (429/406/таймаут). Это публичные инстансы того же открытого API, никакого обхода
 * защиты нет (§0.4).
 */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Совместимость с §3.2: основной эндпоинт всегда первый. */
export const OVERPASS_URL = OVERPASS_ENDPOINTS[0];

/**
 * §0.4: User-Agent с названием проекта и контактом — на видном месте, одним местом.
 * Только ASCII: значения HTTP-заголовков обязаны быть latin1, кириллица в них
 * роняет fetch с «Cannot convert argument to a ByteString».
 */
export const BOT_USER_AGENT =
  'skidki-u-doma/0.1 (unofficial promo aggregator, read-only public pages; contact: skidki-u-doma@example.com)';

/** Пауза между городами, сек (§3.2 п.7 — вежливость к Overpass). */
export const CITY_PAUSE_MS = 10_000;

/** Кэш сырых ответов Overpass, сутки × 30 (§3.2 п.7). */
export const OVERPASS_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
