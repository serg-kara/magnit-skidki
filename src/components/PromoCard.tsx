'use client';

import Link from 'next/link';
import { formatPrice } from '@/lib/relative-time';
import type { ApiPromo } from '@/lib/api-types';

export function AgeGateStub({ category }: { category: string }) {
  return (
    <div
      className="flex min-h-[132px] flex-col justify-center gap-2 rounded-[12px] border border-dashed border-line bg-canvas p-4 text-sm"
      data-qa="age-stub"
    >
      <p className="font-semibold">Алкоголь скрыт</p>
      <p className="text-muted">
        Товары категории «{category}» показываются только после подтверждения возраста.
      </p>
      <Link href="/#alcohol" className="text-brand underline underline-offset-2">
        Включить раздел алкоголя
      </Link>
    </div>
  );
}

export function PromoCard({
  promo,
  citySlug,
  ageConfirmed,
  favorite,
  onToggleFavorite,
}: {
  promo: ApiPromo;
  citySlug: string;
  ageConfirmed: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  if (promo.category?.isAdult && !ageConfirmed) {
    return <AgeGateStub category={promo.category.name} />;
  }

  const store = promo.scope === 'store' ? promo.stores[0] : undefined;
  const href = store ? `/${citySlug}/stores/${store.id}` : promo.sourceUrl ?? '#';
  const title = (
    <h3 className="text-[15px] font-semibold leading-snug" data-qa="promo-title">
      {promo.productName}
    </h3>
  );

  return (
    <article className="relative flex gap-3 rounded-[12px] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
      {promo.imageUrl && (
        // next/image потребовал бы списка разрешённых доменов, а картинки с сайта сети
        // в тестах недоступны вовсе — поэтому обычный img без оптимизации.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={promo.imageUrl}
          alt=""
          loading="lazy"
          className="size-20 shrink-0 rounded-[12px] object-cover"
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {store ? (
            <Link href={href} className="min-w-0" data-qa="promo-store-link">
              {title}
            </Link>
          ) : (
            title
          )}
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-pressed={favorite}
            aria-label={favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
            className={`ml-auto shrink-0 rounded-[12px] px-2 py-1 text-lg leading-none transition ${
              favorite ? 'text-warn' : 'text-line hover:text-muted'
            }`}
            data-qa="favorite-toggle"
          >
            {favorite ? '★' : '☆'}
          </button>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          {promo.brand && <span>{promo.brand}</span>}
          {promo.category && (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-brand">
              {promo.category.name}
            </span>
          )}
          <span>
            {promo.scope === 'federal' ? 'во всех магазинах сети' : `в ${promo.stores.length} маг.`}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="text-2xl font-extrabold tabular-nums" data-qa="price-new">
            {formatPrice(promo.priceNew)}
          </span>
          {promo.priceOld !== null && promo.priceOld !== promo.priceNew && (
            <span className="text-sm text-muted line-through tabular-nums">
              {formatPrice(promo.priceOld)}
            </span>
          )}
          {promo.discountPct !== null && promo.discountPct > 0 && (
            <span
              className="rounded-[12px] bg-sale px-2 py-1 text-sm font-black text-white"
              data-qa="discount-badge"
            >
              −{promo.discountPct}%
            </span>
          )}
        </div>

        {promo.bonus && <p className="mt-2 text-sm text-ink">{promo.bonus}</p>}

        <p className="mt-2 text-xs text-muted" data-qa="promo-period">
          {promo.validFrom ?? 'с сейчас'} — {promo.validTo ?? 'без срока'}
          {store ? ` · ${store.name}, ${store.address}` : ''}
        </p>
      </div>
    </article>
  );
}
