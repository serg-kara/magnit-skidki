import { BOT_USER_AGENT } from '@/config/http';
import { DAY_MS, readCache, writeCache } from './jobs';

export type RobotsRule = { allow: boolean; prefix: string };

export function parseRobots(txt: string, userAgent = '*'): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let applies = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(':');
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      applies = value === '*' || value.toLowerCase() === userAgent.toLowerCase();
      continue;
    }
    if (!applies) continue;
    if (key === 'disallow' && value) rules.push({ allow: false, prefix: value });
    else if (key === 'allow' && value) rules.push({ allow: true, prefix: value });
  }
  return rules;
}

/** Наиболее длинный совпавший префикс выигрывает — как предписывают роботы-конвенции. */
export function isAllowed(rules: RobotsRule[], url: string): boolean {
  let path = url;
  try {
    path = new URL(url).pathname + new URL(url).search;
  } catch {
    /* отдаём как есть: сравнение по префиксу всё равно осмысленно */
  }
  const matched = rules
    .filter((rule) => path.startsWith(rule.prefix.replace(/\*$/, '')))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return matched ? matched.allow : true;
}

/** robots.txt кэшируется на сутки (§0.4) и по origin'у, чтобы не дублировать запросы. */
export async function loadRobots(origin: string): Promise<RobotsRule[]> {
  const key = origin.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]/gi, '_');
  const cached = await readCache<string>('robots', key, DAY_MS);
  if (cached) return parseRobots(cached);

  const res = await fetch(`${origin}/robots.txt`, {
    headers: { 'user-agent': BOT_USER_AGENT },
  });
  if (!res.ok) {
    // 404 — файла нет, запретов тоже нет; остальные ошибки не трактуем в пользу похода.
    if (res.status === 404) return [];
    throw new Error(`robots.txt ${origin}: HTTP ${res.status}`);
  }
  const txt = await res.text();
  await writeCache('robots', key, txt);
  return parseRobots(txt);
}
