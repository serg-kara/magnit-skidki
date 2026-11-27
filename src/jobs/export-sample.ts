/**
 * Дамп импортированных из OpenStreetMap магазинов в data/stores.sample.json — тот файл,
 * из которого живёт seed (§7.1). Запускать после успешного `npm run sync:stores`:
 *
 *   npx tsx src/jobs/export-sample.ts
 *
 * Файл коммитится намеренно: сборка и e2e должны проходить без сети.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { medianCoords, type StoreFormat } from '@/lib/overpass';

type SampleStore = {
  osmId: string;
  name: string;
  format: StoreFormat;
  address: string;
  lat: number;
  lng: number;
};

async function main() {
  const cities = await prisma.city.findMany({
    include: { region: true, stores: { orderBy: { osmId: 'asc' } } },
    orderBy: { id: 'asc' },
  });

  const withStores = cities.filter((city) => city.stores.length > 0);
  if (!withStores.length) {
    throw new Error('В базе нет магазинов — сначала выполните npm run sync:stores');
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source:
      'OpenStreetMap, получен через Overpass API (src/jobs/import-cities.ts). Координаты и адреса — из OSM, вручную не правились.',
    cities: withStores.map((city) => ({
      slug: city.slug,
      name: city.name,
      region: city.region.slug,
      ...(medianCoords(city.stores) ?? { lat: city.lat, lng: city.lng }),
      stores: city.stores.map<SampleStore>((store) => ({
        osmId: store.osmId,
        name: store.name,
        format: store.format as StoreFormat,
        address: store.address,
        lat: store.lat,
        lng: store.lng,
      })),
    })),
  };

  const file = path.join(process.cwd(), 'data', 'stores.sample.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const total = withStores.reduce((sum, city) => sum + city.stores.length, 0);
  console.log(`Записано ${file}: городов ${withStores.length}, магазинов ${total}`);
}

void main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
