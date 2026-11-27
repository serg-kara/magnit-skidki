'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useAgeGate, useFavorites } from '@/lib/client-hooks';
import { AgeGateStub } from './PromoCard';
import { daysLeft } from '@/lib/age';
import { formatPrice } from '@/lib/relative-time';
import { CATEGORY_BY_SLUG } from '@/config/categories';

export function FavoritesView() {
  const { items, ready, has, toggle } = useFavorites();
  const age = useAgeGate();
  const now = useMemo(() => new Date(), []);

  if (!ready) return <div className="h-24 animate-pulse rounded-[12px] bg-line/40" />;

  if (!items.length) {
    return (
      <div
        className="rounded-[12px] border border-dashed border-line bg-surface p-8 text-center"
        data-qa="favorites-empty"
      >
        <p className="font-semibold">Избранное пусто</p>
        <p className="mt-1 text-sm text-muted">
          Отмечайте звёздочкой нужные акции в списке города — они останутся здесь даже после того,
          как акция закончится.
        </p>
        <Link href="/" className="mt-3 inline-block text-sm text-brand underline underline-offset-2">
          Выбрать город
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2" data-qa="favorites-list">
      {items.map((item) => {
        if (item.isAdult && !age.confirmed) {
          return (
            <li key={item.productId}>
              <AgeGateStub category={CATEGORY_BY_SLUG.alcohol.name} />
            </li>
          );
        }
        const left = daysLeft(item.validTo, now);
        const expired = left !== null && left < 0;
        const almostOver = left !== null && left >= 0 && left <= 2;
        return (
          <li
            key={item.productId}
            className="rounded-[12px] border border-line bg-surface p-4 shadow-[var(--shadow-card)]"
            data-qa="favorite-item"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold" data-qa="favorite-name">
                  {item.productName}
                </p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="text-xl font-extrabold tabular-nums">
                    {formatPrice(item.priceNew)}
                  </span>
                  {item.priceOld !== null && (
                    <span className="text-muted line-through tabular-nums">
                      {formatPrice(item.priceOld)}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {item.validTo ? `до ${item.validTo}` : 'срок не указан'} ·{' '}
                  <Link href={`/${item.citySlug}`} className="underline underline-offset-2">
                    {item.citySlug}
                  </Link>
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggle(item)}
                aria-label="Убрать из избранного"
                className="shrink-0 rounded-[12px] px-2 py-1 text-lg leading-none text-warn"
                data-qa="favorite-remove"
              >
                ★
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {expired && (
                <span className="rounded-[12px] bg-sale-soft px-2 py-1 font-semibold text-sale" data-qa="favorite-expired">
                  истекло
                </span>
              )}
              {almostOver && (
                <span className="rounded-[12px] bg-warn/10 px-2 py-1 font-semibold text-warn" data-qa="favorite-almost-over">
                  осталось {left} {left === 1 ? 'день' : 'дня'}
                </span>
              )}
              {!expired && !almostOver && (
                <span className="rounded-[12px] bg-brand-soft px-2 py-1 text-brand">актуально</span>
              )}
              {!has(item.productId) && <span className="text-muted">убрано</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
