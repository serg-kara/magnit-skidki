import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg rounded-[12px] border border-line bg-surface p-8 text-center shadow-[var(--shadow-card)]">
      <p className="text-5xl font-black text-brand">404</p>
      <h1 className="mt-2 text-lg font-bold" data-qa="not-found-title">
        Страница не найдена
      </h1>
      <p className="mt-2 text-sm text-muted">
        Такого города или магазина в базе нет. Возможно, синхронизация ещё не выполнялась.
      </p>
      <Link
        href="/"
        className="mt-4 inline-block rounded-[12px] bg-brand px-4 py-2 text-sm font-semibold text-white"
      >
        К списку городов
      </Link>
    </div>
  );
}
