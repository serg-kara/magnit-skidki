'use client';

import { usePathname, useRouter } from 'next/navigation';

export function CitySwitcher({ cities }: { cities: { slug: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const current = cities.find((city) => pathname === `/${city.slug}`)?.slug ?? '';

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Город</span>
      <select
        className="max-w-[15rem] rounded-[12px] border border-line bg-canvas px-3 py-1.5 text-sm font-medium text-ink outline-none focus:border-brand"
        value={current}
        onChange={(event) => {
          const slug = event.target.value;
          router.push(slug ? `/${slug}` : '/');
        }}
        data-qa="city-switcher"
      >
        <option value="">— выбрать —</option>
        {cities.map((city) => (
          <option key={city.slug} value={city.slug}>
            {city.name}
          </option>
        ))}
      </select>
    </label>
  );
}
