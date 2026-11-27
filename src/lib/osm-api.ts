/**
 * Резервный читалка OpenStreetMap: официальный API (`api.openstreetmap.org/api/0.6/map`).
 * Используется только когда Overpass недоступен (§3.2 описывает Overpass как основной
 * источник): данные те же, та же лицензия ODbL, тот же публичный доступ без ключей —
 * ничего не обходится, просто другой эндпоинт тех же OSM-данных.
 *
 * У endpoint'а есть лимит на размер выборки, поэтому город режется на клетки;
 * между запросами пауза ≥1 сек (usage policy OSM API).
 */
import { BOT_USER_AGENT } from '@/config/http';
import type { OverpassElement, OverpassResponse } from './overpass';

export type BBox = { west: number; south: number; east: number; north: number };

const OSM_API = 'https://api.openstreetmap.org/api/0.6/map';
const PAUSE_MS = Number(process.env.OSM_API_PAUSE_MS ?? 1_200);
/** Размер клетки сетки: крупнее — меньше запросов, но выше шанс «too many elements». */
const CELL_DEG = Number(process.env.OSM_API_CELL_DEG ?? 0.05);
/** Пауза после 429: публичный инстанс просит не чаще запроса в секунду и следит за квотой. */
const RATE_LIMIT_WAIT_MS = Number(process.env.OSM_API_RETRY_MS ?? 60_000);
/** Потолок запросов на один город: защита от «дробим плотную клетку до бесконечности». */
const MAX_REQUESTS_PER_CITY = Number(process.env.OSM_API_MAX_REQUESTS ?? 10);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTagBlock(block: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of block.matchAll(/(\w+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function tagsOf(inner: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const m of inner.matchAll(/<tag\s+k="([^"]*)"\s+v="([^"]*)"\s*\/>/g)) {
    tags[decodeXml(m[1])] = decodeXml(m[2]);
  }
  return tags;
}

/** XML OSM → та же форма, что отдаёт Overpass (`out center tags`), чтобы остальной код не ветвился. */
export function parseOsmXml(xml: string): OverpassResponse {
  const nodes = new Map<string, { lat: number; lon: number; tags: Record<string, string> }>();
  for (const match of xml.matchAll(/<node\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g)) {
    const attrs = parseTagBlock(match[1]);
    if (!attrs.id || !attrs.lat || !attrs.lon) continue;
    nodes.set(attrs.id, {
      lat: Number(attrs.lat),
      lon: Number(attrs.lon),
      tags: match[2] ? tagsOf(match[2]) : {},
    });
  }

  const elements: OverpassElement[] = [];
  for (const [id, node] of nodes) {
    if (!Object.keys(node.tags).length) continue;
    elements.push({ type: 'node', id: Number(id), lat: node.lat, lon: node.lon, tags: node.tags });
  }

  for (const match of xml.matchAll(/<way\s+([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const attrs = parseTagBlock(match[1]);
    const tags = tagsOf(match[2]);
    if (!attrs.id || !Object.keys(tags).length) continue;
    const refs = [...match[2].matchAll(/<nd\s+ref="(\d+)"\s*\/>/g)].map((m) => m[1]);
    const points = refs.map((ref) => nodes.get(ref)).filter(Boolean) as {
      lat: number;
      lon: number;
    }[];
    if (!points.length) continue;
    elements.push({
      type: 'way',
      id: Number(attrs.id),
      center: {
        lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
        lon: points.reduce((sum, p) => sum + p.lon, 0) / points.length,
      },
      tags,
    });
  }

  for (const match of xml.matchAll(/<relation\s+([^>]*?)>([\s\S]*?)<\/relation>/g)) {
    const attrs = parseTagBlock(match[1]);
    const tags = tagsOf(match[2]);
    if (!attrs.id || !Object.keys(tags).length) continue;
    const members = [...match[2].matchAll(/<member\s+([^>]*?)\/>/g)].map((m) => parseTagBlock(m[1]));
    const points: { lat: number; lon: number }[] = [];
    for (const member of members) {
      if (member.type === 'node' && nodes.has(member.ref)) {
        const { lat, lon } = nodes.get(member.ref)!;
        points.push({ lat, lon });
      }
    }
    if (!points.length) continue;
    elements.push({
      type: 'relation',
      id: Number(attrs.id),
      center: {
        lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
        lon: points.reduce((sum, p) => sum + p.lon, 0) / points.length,
      },
      tags,
    });
  }

  return { elements };
}

export function splitBBox(box: BBox, maxDeg = 0.05): BBox[] {
  const lngSteps = Math.max(1, Math.ceil((box.east - box.west) / maxDeg));
  const latSteps = Math.max(1, Math.ceil((box.north - box.south) / maxDeg));
  const width = (box.east - box.west) / lngSteps;
  const height = (box.north - box.south) / latSteps;
  const cells: BBox[] = [];
  for (let i = 0; i < lngSteps; i++) {
    for (let j = 0; j < latSteps; j++) {
      cells.push({
        west: box.west + i * width,
        south: box.south + j * height,
        east: box.west + (i + 1) * width,
        north: box.south + (j + 1) * height,
      });
    }
  }
  return cells;
}

async function fetchCell(box: BBox): Promise<OverpassResponse> {
  const url = `${OSM_API}?bbox=${box.west.toFixed(6)},${box.south.toFixed(6)},${box.east.toFixed(6)},${box.north.toFixed(6)}`;
  const res = await fetch(url, {
    headers: { 'user-agent': BOT_USER_AGENT, accept: 'application/xml' },
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 429 || res.status === 403) {
    throw new RateLimitedError(`OSM API HTTP ${res.status} — слишком часто просим`);
  }
  if (res.status === 400) {
    // «Too many elements» — клетка слишком плотная, её надо дробить.
    const error = new TooDenseError(await res.text());
    error.box = box;
    throw error;
  }
  if (!res.ok) throw new Error(`OSM API HTTP ${res.status}`);
  return parseOsmXml(await res.text());
}

class TooDenseError extends Error {
  box?: BBox;
}

class RateLimitedError extends Error {}

/** Сигнал «дальше стучаться бессмысленно»: прогон останавливается, результат помечается partial. */
class GaveUpError extends Error {}

type Budget = { requests: number; max: number };

function halve(box: BBox): BBox[] {
  const midLng = (box.west + box.east) / 2;
  const midLat = (box.south + box.north) / 2;
  return [
    { west: box.west, south: box.south, east: midLng, north: midLat },
    { west: midLng, south: box.south, east: box.east, north: midLat },
    { west: box.west, south: midLat, east: midLng, north: box.north },
    { west: midLng, south: midLat, east: box.east, north: box.north },
  ];
}

async function collect(
  box: BBox,
  into: Map<string, OverpassElement>,
  budget: Budget,
  depth = 0,
): Promise<void> {
  if (budget.requests >= budget.max) throw new GaveUpError('исчерпан лимит запросов на город');
  budget.requests++;
  try {
    const response = await fetchCell(box);
    for (const element of response.elements ?? []) {
      const key = `${element.type}/${element.id}`;
      if (!into.has(key)) into.set(key, element);
    }
  } catch (err) {
    if (err instanceof RateLimitedError) {
      if (budget.requests >= budget.max) throw new GaveUpError(err.message);
      // Ждём и пробуем один раз: долбить инстанс после 429 — ровно то, чего просит
      // не делать правила использования OSM API.
      console.log(`[osm-api] ${err.message}, пауза ${Math.round(RATE_LIMIT_WAIT_MS / 1000)} сек`);
      await sleep(RATE_LIMIT_WAIT_MS);
      budget.requests++;
      let retry: OverpassResponse;
      try {
        retry = await fetchCell(box);
      } catch (retryErr) {
        if (retryErr instanceof RateLimitedError) throw new GaveUpError('OSM API продолжает отдавать 429');
        throw retryErr;
      }
      for (const element of retry.elements ?? []) {
        const key = `${element.type}/${element.id}`;
        if (!into.has(key)) into.set(key, element);
      }
      return;
    }
    const dense = err instanceof TooDenseError;
    if (!dense || depth >= 3) throw err;
    await sleep(PAUSE_MS);
    for (const child of halve(box)) {
      await collect(child, into, budget, depth + 1);
    }
  }
}

export type BBoxFetchResult = OverpassResponse & {
  /** true, если обошли не все клетки (упёрлись в лимит) — данные неполные, это надо в лог. */
  partial: boolean;
  cellsTotal: number;
  cellsDone: number;
};

/**
 * Собирает элементы по сетке клеток. Дубликаты по osmId удаляются здесь же:
 * один и тот же объект может попасть в две клетки.
 *
 * Ограничение по запросам (OSM_API_MAX_REQUESTS) — чтобы на плотном городе со
 * дроблением клеток прогон не превратился в стукотысячу запросов: недобранное
 * честно помечается как partial, а не «город пустой».
 */
export async function fetchBBoxElements(box: BBox): Promise<BBoxFetchResult> {
  const cells = splitBBox(box, CELL_DEG);
  const budget: Budget = { requests: 0, max: MAX_REQUESTS_PER_CITY };
  console.log(`[osm-api] клеток ${cells.length}, пауза ${PAUSE_MS} мс, лимит запросов ${budget.max}`);
  const byId = new Map<string, OverpassElement>();
  let cellsDone = 0;
  let partial = false;

  for (const cell of cells) {
    try {
      await collect(cell, byId, budget);
      cellsDone++;
    } catch (err) {
      if (err instanceof GaveUpError) {
        console.log(`[osm-api] останавливаюсь на городе: ${err.message} (сделано ${budget.requests} запросов)`);
        partial = true;
        break;
      }
      // Одна клетки не должна топить весь город: помечаем неполноту и идём дальше.
      console.log(`[osm-api] клетка не отдалась: ${(err as Error).message}`);
      partial = true;
    }
    await sleep(PAUSE_MS);
  }

  return {
    elements: [...byId.values()],
    partial: partial || cellsDone < cells.length,
    cellsTotal: cells.length,
    cellsDone,
  };
}
