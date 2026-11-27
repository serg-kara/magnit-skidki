export type RegionConfig = {
  slug: string;
  name: string;
  osmAreaName: string;
};

export const REGIONS: RegionConfig[] = [
  {
    slug: 'krasnodarskiy-kray',
    name: 'Краснодарский край',
    osmAreaName: 'Краснодарский край',
  },
  {
    slug: 'stavropolskiy-kray',
    name: 'Ставропольский край',
    osmAreaName: 'Ставропольский край',
  },
];

export const REGION_BY_SLUG: Record<string, RegionConfig> = Object.fromEntries(
  REGIONS.map((r) => [r.slug, r]),
);
