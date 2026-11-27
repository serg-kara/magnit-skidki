import type { Metadata } from 'next';
import Link from 'next/link';
import { FavoritesView } from '@/components/FavoritesView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Избранное',
  description: 'Отмеченные акции — сохраняются в этом браузере',
};

export default function FavoritesPage() {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Избранное</h1>
        <Link href="/" className="text-sm text-brand underline underline-offset-2">
          Выбрать город
        </Link>
      </header>
      <p className="text-sm text-muted">
        Список живёт в этом браузере и хранит снимок цены: акция может закончиться, а отметка
        останется — так видно, что цена действительно была другой.
      </p>
      <FavoritesView />
    </div>
  );
}
