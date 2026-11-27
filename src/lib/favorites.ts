/**
 * §6.3: избранное живёт только в localStorage браузера, в БД не хранится.
 * Храним снимок товара, чтобы список жил и после того, как акция исчезнет из БД.
 */

export const FAVORITES_KEY = 'magnit.favorites.v1';

export type FavoriteItem = {
  productId: number;
  productName: string;
  priceNew: number | null;
  priceOld: number | null;
  validTo: string | null;
  citySlug: string;
  categorySlug: string | null;
  isAdult: boolean;
};

const bus = new EventTarget();

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function listFavorites(): FavoriteItem[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is FavoriteItem => item && typeof item.productId === 'number');
  } catch {
    return [];
  }
}

function write(items: FavoriteItem[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(items));
  // localStorage не редиспит событие в этой же вкладке — оповещаем сами.
  bus.dispatchEvent(new Event('change'));
}

export function isFavorite(productId: number): boolean {
  return listFavorites().some((item) => item.productId === productId);
}

export function addFavorite(item: FavoriteItem): void {
  const items = listFavorites().filter((i) => i.productId !== item.productId);
  write([...items, item]);
}

export function removeFavorite(productId: number): void {
  write(listFavorites().filter((i) => i.productId !== productId));
}

/** @returns true, если товар добавлен; false — если убран. */
export function toggleFavorite(item: FavoriteItem): boolean {
  if (isFavorite(item.productId)) {
    removeFavorite(item.productId);
    return false;
  }
  addFavorite(item);
  return true;
}

export function subscribeToFavorites(callback: () => void): () => void {
  if (!isBrowser()) return () => undefined;
  const onChange = () => callback();
  const onStorage = (event: StorageEvent) => {
    if (event.key === FAVORITES_KEY || event.key === null) callback();
  };
  bus.addEventListener('change', onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    bus.removeEventListener('change', onChange);
    window.removeEventListener('storage', onStorage);
  };
}
