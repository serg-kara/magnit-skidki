export type CategoryConfig = {
  slug: string;
  name: string;
  isAdult: boolean;
};

/**
 * Табак в списке принципиально отсутствует: §4.2 требует выбрасывать его ещё на
 * уровне парсера, поэтому категории, куда он мог бы попасть, тоже не заводим.
 */
export const CATEGORIES: CategoryConfig[] = [
  { slug: 'alcohol', name: 'Алкоголь', isAdult: true },
  { slug: 'dairy', name: 'Молочные продукты', isAdult: false },
  { slug: 'bakery', name: 'Хлеб и выпечка', isAdult: false },
  { slug: 'meat', name: 'Мясо и птица', isAdult: false },
  { slug: 'fish', name: 'Рыба и морепродукты', isAdult: false },
  { slug: 'fruits', name: 'Фрукты и овощи', isAdult: false },
  { slug: 'groceries', name: 'Бакалея', isAdult: false },
  { slug: 'beverages', name: 'Напитки', isAdult: false },
  { slug: 'snacks', name: 'Снеки и сладости', isAdult: false },
  { slug: 'household', name: 'Товары для дома', isAdult: false },
  { slug: 'other', name: 'Прочее', isAdult: false },
];

export const CATEGORY_BY_SLUG: Record<string, CategoryConfig> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c]),
);

export const ADULT_CATEGORY_SLUG = 'alcohol';
