'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { EMPTY_FILTERS, FiltersBar, type Filters } from './FiltersBar';
import { PromoCard } from './PromoCard';
import { AgeGateModal } from './AgeGateModal';
import { useAgeGate, useFavorites } from '@/lib/client-hooks';
import type { ApiMapMarker, ApiPromo, ApiPromotionsResponse } from '@/lib/api-types';

/** §1: react-leaflet подключается только так — клиентский компонент без SSR. */
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

const PAGE_LIMIT = 200;

export function CityView({
  citySlug,
  cityName,
  center,
  promotionsConnected,
  categories,
}: {
  citySlug: string;
  cityName: string;
  center: [number, number];
  promotionsConnected: boolean;
  categories: { slug: string; name: string }[];
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [markers, setMarkers] = useState<ApiMapMarker[] | null>(null);
  const [promos, setPromos] = useState<ApiPromo[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ageModalOpen, setAgeModalOpen] = useState(false);

  const age = useAgeGate();
  const favorites = useFavorites();

  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams({ city: citySlug });
    fetch(`/api/promotions/map?${query}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`map ${res.status}`))))
      .then((data: { markers: ApiMapMarker[] }) => {
        if (alive) setMarkers(data.markers);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [citySlug]);

  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams({ city: citySlug, limit: String(PAGE_LIMIT) });
    if (filters.category) query.set('category', filters.category);
    if (filters.q) query.set('q', filters.q);
    // «только алкоголь» — это adult=only; иначе отдаём всё, а алкоголь скрывает фронт (§6.4).
    query.set('adult', filters.alcoholOnly ? 'only' : 'all');

    fetch(`/api/promotions?${query}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`promotions ${res.status}`))))
      .then((data: ApiPromotionsResponse) => {
        if (!alive) return;
        setPromos(data.items);
        setTotal(data.total);
        setError(null);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [citySlug, filters]);

  const onFiltersChange = useCallback(
    (next: Filters) => {
      // §6.4: модальное окно про возраст — при первом включении фильтра алкоголя.
      if (next.alcoholOnly && !filters.alcoholOnly && !age.confirmed) setAgeModalOpen(true);
      setFilters(next);
    },
    [age.confirmed, filters.alcoholOnly],
  );

  const visible = useMemo(() => promos ?? [], [promos]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight" data-qa="city-title">
          Акции Магнита — {cityName}
        </h1>
        <p className="text-sm text-muted" data-qa="promotions-total">
          Действующих акций: {total}
        </p>
      </div>

      {!promotionsConnected && (
        <p className="rounded-[12px] border border-warn/30 bg-warn/5 p-3 text-sm text-warn" data-qa="promotions-off">
          Акции для этого города ещё не подключены: нет соответствия городу на сайте сети.
          На карте показаны только магазины, список акций пуст — чужие цены мы не подставляем.
        </p>
      )}

      <FiltersBar categories={categories} value={filters} onChange={onFiltersChange} />

      {error && (
        <p className="rounded-[12px] border border-sale/30 bg-sale-soft p-3 text-sm text-sale">
          Данные не обновились: {error}. Запустите синхронизацию.
        </p>
      )}

      {markers === null ? (
        <div className="h-[380px] animate-pulse rounded-[12px] bg-line/40" />
      ) : (
        <MapView citySlug={citySlug} markers={markers} center={center} />
      )}

      {filters.expiredOnly ? (
        <p className="rounded-[12px] border border-dashed border-line bg-surface p-4 text-sm text-muted" data-qa="expired-note">
          Истёкшие акции не показываются нигде — ни в списке, ни на карте (§4.4). Отключите
          фильтр, чтобы увидеть действующие.
        </p>
      ) : visible.length === 0 && !error ? (
        <p className="rounded-[12px] border border-dashed border-line bg-surface p-6 text-center text-sm text-muted" data-qa="promotions-empty">
          Ничего не найдено. Попробуйте сбросить фильтры или запустить синхронизацию акций.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" data-qa="promotions-list">
          {visible.map((promo) => (
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
      )}

      <AgeGateModal
        open={ageModalOpen}
        onAnswer={(answer) => {
          age.confirm(answer);
          setAgeModalOpen(false);
          if (answer === 'no') setFilters((current) => ({ ...current, alcoholOnly: false }));
        }}
      />
    </div>
  );
}
