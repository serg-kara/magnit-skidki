'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listFavorites,
  subscribeToFavorites,
  toggleFavorite,
  type FavoriteItem,
} from './favorites';
import { readAgeAnswer, writeAgeAnswer, type AgeAnswer } from './age';

function favoriteIds(): Set<number> {
  return new Set(listFavorites().map((item) => item.productId));
}

/**
 * §6.3: первый рендер — пустое множество (на сервере localStorage нет), заполнение только
 * на клиенте. Это убирает hydration-мигание звезды на карточках.
 */
export function useFavorites() {
  const [ids, setIds] = useState<Set<number>>(() => new Set());
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [ready, setReady] = useState(false);

  const sync = useCallback(() => {
    setItems(listFavorites());
    setIds(favoriteIds());
    setReady(true);
  }, []);

  useEffect(() => {
    sync();
    return subscribeToFavorites(sync);
  }, [sync]);

  const toggle = useCallback((item: FavoriteItem) => {
    const added = toggleFavorite(item);
    setItems(listFavorites());
    setIds(favoriteIds());
    return added;
  }, []);

  return { ids, items, ready, toggle, has: (productId: number) => ids.has(productId) };
}

/** §6.4: ответ о возрасте тоже только клиентский. */
export function useAgeGate() {
  const [answer, setAnswer] = useState<AgeAnswer | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setAnswer(readAgeAnswer());
    setReady(true);
  }, []);

  const confirm = useCallback((value: AgeAnswer) => {
    writeAgeAnswer(value);
    setAnswer(value);
  }, []);

  return { answer, ready, confirmed: answer === 'yes', confirm };
}
