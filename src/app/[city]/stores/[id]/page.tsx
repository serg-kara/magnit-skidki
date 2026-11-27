import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { findPromotions } from '@/lib/queries';
import { PromoList } from '@/components/PromoList';
import { FORMAT_LABELS } from '@/config/store-formats';

export const dynamic = 'force-dynamic';

export default async function StorePage({
  params,
}: {
  params: Promise<{ city: string; id: string }>;
}) {
  const { city: slug, id } = await params;
  const storeId = Number(id);
  if (!Number.isInteger(storeId) || storeId <= 0) notFound();

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { city: { include: { sourceMap: true } } },
  });
  if (!store || store.city.slug !== slug) notFound();

  const { items, total } = await findPromotions({
    storeId: store.id,
    adult: 'all',
    page: 1,
    limit: 200,
  });

  return (
    <div className="space-y-5">
      <nav className="text-sm text-muted">
        <Link href={`/${slug}`} className="underline underline-offset-2">
          {store.city.name}
        </Link>
        <span className="px-1">/</span>
        <span>магазин</span>
      </nav>

      <header className="rounded-[12px] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <h1 className="text-xl font-extrabold" data-qa="store-title">
          {store.name}
        </h1>
        <p className="mt-1 text-sm text-muted" data-qa="store-address">
          {store.address}
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span>Формат: {FORMAT_LABELS[store.format] ?? store.format}</span>
          <span data-qa="store-promos-count">Акции: {total}</span>
          <span>
            OSM:{' '}
            <a
              className="text-brand underline underline-offset-2"
              href={`https://www.openstreetmap.org/${store.osmId}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {store.osmId}
            </a>
          </span>
        </p>
        {!store.city.sourceMap && (
          <p className="mt-3 rounded-[12px] border border-warn/30 bg-warn/5 p-3 text-sm text-warn">
            Акции для этого города ещё не подключены — показываем только то, что реально относится
            к нему.
          </p>
        )}
      </header>

      <PromoList citySlug={slug} promos={items} />
    </div>
  );
}
