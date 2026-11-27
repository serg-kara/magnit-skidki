import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    out[m[1]] = m[2] === undefined ? 'true' : m[2];
  }
  return out;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function cacheFile(kind: string, key: string): string {
  return path.join(process.cwd(), 'data', 'cache', kind, `${key}.json`);
}

export async function readCache<T>(kind: string, key: string, maxAgeMs: number): Promise<T | null> {
  const entry = await readCacheEntry<T>(kind, key);
  if (!entry) return null;
  return Date.now() - entry.at <= maxAgeMs ? entry.value : null;
}

/**
 * То же, что readCache, но отдаёт ещё и время снятия: потребителю нужно различать
 * «кэша нет» и «кэш есть, но просрочен», а TTL у ответов «найдено» и «не найдено»
 * разный (геокодер).
 */
export async function readCacheEntry<T>(kind: string, key: string): Promise<{ at: number; value: T } | null> {
  if (process.env.FORCE_SYNC === '1') return null;
  try {
    const raw = JSON.parse(await fs.readFile(cacheFile(kind, key), 'utf8')) as {
      fetchedAt: number;
      value: T;
    };
    return { at: raw.fetchedAt, value: raw.value };
  } catch {
    return null;
  }
}

export async function writeCache(kind: string, key: string, value: unknown): Promise<void> {
  const file = cacheFile(kind, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ fetchedAt: Date.now(), value }), 'utf8');
}

export type SyncStatus = 'ok' | 'partial' | 'blocked' | 'error';

export type SyncLogState = { status: SyncStatus; message: string[] };

/**
 * Одна строка SyncLog на весь прогон задачи: открыли в начале, закрыли в конце.
 * Исключение пробрасывается наружу, но в лог попадает как status=error (§0.4).
 */
export async function withSyncLog<T>(
  job: 'stores' | 'promotions',
  fn: (log: SyncLogState) => Promise<T>,
): Promise<T> {
  const started = await prisma.syncLog.create({ data: { job, status: 'ok' } });
  const state = { status: 'ok' as SyncStatus, message: [] as string[] };
  let result: T | undefined;
  let failure: unknown;
  try {
    result = await fn(state);
  } catch (err) {
    failure = err;
    state.status = err instanceof BlockedError ? 'blocked' : 'error';
    state.message.push(err instanceof Error ? err.message : String(err));
  }
  const counts =
    typeof result === 'object' && result !== null
      ? (result as { citiesOk?: number; itemsNew?: number; itemsSeen?: number })
      : {};
  await prisma.syncLog
    .update({
      where: { id: started.id },
      data: {
        status: state.status,
        message: [...state.message].join('; ') || null,
        citiesOk: counts.citiesOk ?? 0,
        itemsNew: counts.itemsNew ?? 0,
        itemsSeen: counts.itemsSeen ?? 0,
        finishedAt: new Date(),
      },
    })
    .catch(() => undefined);
  if (failure) throw failure;
  return result as T;
}

export class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedError';
  }
}

export function info(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}
