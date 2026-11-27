import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { CitySwitcher } from './CitySwitcher';
import { SyncStatus } from './SyncStatus';

export const dynamic = 'force-dynamic';

export async function Header() {
  const cities = await prisma.city.findMany({
    orderBy: { name: 'asc' },
    select: { slug: true, name: true },
  });

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2" data-qa="brand">
          <span className="grid size-9 place-items-center rounded-[12px] bg-brand text-base font-black text-white">
            С
          </span>
          <span className="text-lg font-extrabold tracking-tight">Скидки у дома</span>
        </Link>

        <CitySwitcher
          cities={cities.map((city) => ({ slug: city.slug, name: city.name }))}
        />

        <nav className="ml-auto flex items-center gap-4 text-sm font-medium">
          <Link href="/favorites" className="text-muted hover:text-ink" data-qa="favorites-link">
            Избранное
          </Link>
          <SyncStatus />
        </nav>
      </div>
    </header>
  );
}
