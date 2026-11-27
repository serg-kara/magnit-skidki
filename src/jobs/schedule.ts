import 'dotenv/config';
import { spawn } from 'child_process';
import { createTask } from 'node-cron';
import { info, parseArgs } from '@/lib/jobs';

const TZ = process.env.TZ_SCHEDULE ?? 'Europe/Moscow';

function runNpm(script: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env, FORCE_SYNC: '0' },
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      info(`Не удалось запустить «${script}»: ${err.message}`);
      resolve(1);
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.once !== undefined) {
    const code = await runNpm(args.once ? `sync:${args.once}` : 'sync:all');
    process.exit(code);
  }

  // Акции — каждый день; координаты магазинов из OSM меняются редко — раз в неделю.
  const promotions = createTask('30 4 * * *', () => runNpm('sync:promotions'), {
    name: 'promotions',
    timezone: TZ,
    noOverlap: true,
  });
  const stores = createTask('0 5 * * 1', () => runNpm('sync:stores'), {
    name: 'stores',
    timezone: TZ,
    noOverlap: true,
  });

  await promotions.start();
  await stores.start();

  info(`Worker запущен (tz=${TZ}). Акции: ${promotions.getNextRun()}, магазины: ${stores.getNextRun()}`);
  info('Остановка — Ctrl+C. Разовый прогон: npm run worker -- --once=promotions');

  const shutdown = async () => {
    info('Останавливаю worker…');
    await promotions.stop();
    await stores.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
