import { promises as fs } from 'fs';
import path from 'path';
import { BlockedError } from './jobs';

const MIN_DELAY_MS = Number(process.env.SCRAPE_MIN_DELAY_MS ?? 3_000);
const MAX_DELAY_MS = Number(process.env.SCRAPE_MAX_DELAY_MS ?? 7_000);
const BLOCK_COOLDOWN_MS = Number(process.env.SCRAPE_COOLDOWN_MS ?? 60 * 60 * 1000);

const BLOCKED_FILE = path.join(process.cwd(), 'data', 'cache', 'magnit-blocked-until.json');

/** §0.4: максимум один запрос за раз + пауза 3–7 сек со случайным джиттером. */
let queue: Promise<void> = Promise.resolve();
let lastAt = 0;

function jitter(): number {
  const span = Math.max(0, MAX_DELAY_MS - MIN_DELAY_MS);
  return MIN_DELAY_MS + Math.round(Math.random() * span);
}

export function waitTurn(): Promise<void> {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastAt + jitter() - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastAt = Date.now();
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Признаки именно капчи/стены. Голый `/captcha/i` сюда не входит: на magnit.ru это слово
 * есть в обычном конфиге страницы (`yandexCaptcha:"<публичный ключ>"`), и по нему каждый
 * прогон ложно уходил в blocked с часовым кулдауном (§0.4).
 */
const CAPTCHA_MARKERS = [
  /g-recaptcha/i,
  /h-captcha/i,
  /captcha[-_]?form/i,
  /ycaptcha|smart-captcha|js-captcha/i,
  /cf_chl_/i,
  /are you a robot/i,
  /подтвердите,? что вы не робот/i,
  /введите? символы с картинки/i,
  /доступ ограничен/i,
];

export function looksLikeCaptcha(html: string): boolean {
  const head = html.slice(0, 200_000);
  return CAPTCHA_MARKERS.some((re) => re.test(head));
}

/** Кулдаун переживает перезапуск процесса: «повтор не раньше чем через час» — не только в памяти. */
export async function assertNotBlocked(force = false): Promise<void> {
  if (force) return;
  try {
    const raw = JSON.parse(await fs.readFile(BLOCKED_FILE, 'utf8')) as { until: number; reason: string };
    if (raw.until > Date.now()) {
      const mins = Math.ceil((raw.until - Date.now()) / 60_000);
      throw new BlockedError(
        `Прошлый запуск упёрся в защиту (${raw.reason}). Повтор не раньше чем через ${mins} мин; ручной обход кулдауна — --force`,
      );
    }
  } catch (err) {
    if (err instanceof BlockedError) throw err;
  }
}

export async function markBlocked(reason: string): Promise<void> {
  await fs.mkdir(path.dirname(BLOCKED_FILE), { recursive: true });
  await fs.writeFile(
    BLOCKED_FILE,
    JSON.stringify({ until: Date.now() + BLOCK_COOLDOWN_MS, reason, at: new Date().toISOString() }),
    'utf8',
  );
}
