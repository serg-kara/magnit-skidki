'use client';

import type { ApiPromo } from '@/lib/api-types';
import { PromoCard } from './PromoCard';
import { useAgeGate, useFavorites } from '@/lib/client-hooks';

/** Список карточек с избранным и возрастным цензором — общий для страницы магазина и города. */
export function PromoList({ citySlug, promos }: { citySlug: string; promos: ApiPromo[] }) {
  const age = useAgeGate();
  const favorites = useFavorites();

  if (!promos.length) {
    return (
      <p className="rounded-[12px] border border-dashed border-line bg-surface p-6 text-center text-sm text-muted" data-qa="store-promotions-empty">
        Действующих акций здесь нет — запустите синхронизацию.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-qa="store-promotions">
      {promos.map((promo) => (
        <PromoCard
          key={promo.id}
          promo={promo}
          citySlug={citySlug}
          ageConfirmed={age.confirmed}
          favorite={favorites.has(promo.productId)}
          onToggleFavorite={() =>
            favorites.toggle({
              productId: promo.productId,
              productName: promo.productName,
              priceNew: promo.priceNew,
              priceOld: promo.priceOld,
              validTo: promo.validTo,
              citySlug,
              categorySlug: promo.category?.slug ?? null,
              isAdult: promo.category?.isAdult ?? false,
            })
          }
        />
      ))}
    </div>
  );
}
