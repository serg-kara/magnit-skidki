import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { CityView } from '@/components/CityView';

export const dynamic = 'force-dynamic';

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  // §1: в Next 15 params — промис.
  const { city: slug } = await params;

  const city = await prisma.city.findUnique({
    where: { slug },
    include: { sourceMap: true, _count: { select: { stores: true } } },
  });
  if (!city) notFound();

  const categories = await prisma.category.findMany({
    where: { products: { some: {} } },
    orderBy: { name: 'asc' },
    select: { slug: true, name: true },
  });

  return (
    <CityView
      citySlug={city.slug}
      cityName={city.name}
      center={[city.lat, city.lng]}
      promotionsConnected={Boolean(city.sourceMap)}
      categories={categories}
    />
  );
}
