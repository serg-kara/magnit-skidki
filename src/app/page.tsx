import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { countCityPromotions } from '@/lib/queries';
import { formatRelative } from '@/lib/relative-time';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [regions, lastSync] = await Promise.all([
    prisma.region.findMany({
      orderBy: { id: 'asc' },
      include: {
        cities: {
          orderBy: { name: 'asc' },
          include: { _count: { select: { stores: true } } },
        },
      },
    }),
    prisma.syncLog.findFirst({ orderBy: { startedAt: 'desc' } }),
  ]);

  const grouped = await Promise.all(
    regions.map(async (region) => ({
      region,
      cities: await Promise.all(
        region.cities.map(async (city) => ({
          city,
          promosCount: await countCityPromotions(city.id),
        })),
      ),
    })),
  );

  const totalCities = regions.reduce((sum, region) => sum + region.cities.length, 0);

  return (
    <div className="space-y-6">
      <section className="rounded-[12px] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <h1 className="text-2xl font-extrabold tracking-tight">Скидки у дома</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Акции «Магнита» на карте по Ставропольскому и Краснодарскому краям. Выберите город —
          увидите карту магазинов и список действующих акций.
        </p>
        <p className="mt-3 text-xs text-muted" data-qa="home-sync">
          Города в базе: {totalCities} · Данные обновлены: {formatRelative(lastSync?.finishedAt)}
        </p>
      </section>

      {grouped.map(({ region, cities }) => (
        <section key={region.slug} className="space-y-3">
          <h2 className="text-lg font-bold">{region.name}</h2>
          {cities.length === 0 ? (
            <p className="rounded-[12px] border border-dashed border-line bg-surface p-4 text-sm text-muted">
              В этом крае ещё нет городов — выполните{' '}
              <code className="rounded bg-canvas px-1">npm run sync:stores</code>.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cities.map(({ city, promosCount }) => (
                <li key={city.slug}>
                  <Link
                    href={`/${city.slug}`}
                    data-qa="city-link"
                    className="block rounded-[12px] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition hover:border-brand"
                  >
                    <span className="block text-base font-semibold">{city.name}</span>
                    <span className="mt-1 block text-sm text-muted" data-qa={`city-stats-${city.slug}`}>
                      Магазинов: {city._count.stores} · Акции: {promosCount}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
