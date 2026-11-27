'use client';

import { useEffect, useState } from 'react';

export type Filters = {
  category: string;
  q: string;
  alcoholOnly: boolean;
  expiredOnly: boolean;
};

export const EMPTY_FILTERS: Filters = { category: '', q: '', alcoholOnly: false, expiredOnly: false };

export function FiltersBar({
  categories,
  value,
  onChange,
}: {
  categories: { slug: string; name: string }[];
  value: Filters;
  onChange: (next: Filters) => void;
}) {
  // Дебаунс поиска: без него каждый символ — это запрос к API и перерисовка карты.
  const [draft, setDraft] = useState(value.q);
  useEffect(() => setDraft(value.q), [value.q]);
  useEffect(() => {
    if (draft === value.q) return;
    const id = setTimeout(() => onChange({ ...value, q: draft }), 250);
    return () => clearTimeout(id);
  }, [draft, value, onChange]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-surface p-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">Категория</span>
        <select
          className="rounded-[12px] border border-line bg-canvas px-3 py-1.5"
          value={value.category}
          onChange={(event) => onChange({ ...value, category: event.target.value })}
          data-qa="filter-category"
        >
          <option value="">все</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-[13rem] flex-1 items-center gap-2 text-sm">
        <span className="text-muted">Поиск</span>
        <input
          type="search"
          value={draft}
          placeholder="название или бренд"
          onChange={(event) => setDraft(event.target.value)}
          className="w-full rounded-[12px] border border-line bg-canvas px-3 py-1.5"
          data-qa="filter-q"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.alcoholOnly}
          onChange={(event) => onChange({ ...value, alcoholOnly: event.target.checked })}
          className="size-4 accent-[var(--color-brand)]"
          data-qa="filter-alcohol"
        />
        только алкоголь
      </label>

      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={value.expiredOnly}
          onChange={(event) => onChange({ ...value, expiredOnly: event.target.checked })}
          className="size-4 accent-[var(--color-brand)]"
          data-qa="filter-expired"
        />
        только с истёкшим сроком
      </label>
    </div>
  );
}
