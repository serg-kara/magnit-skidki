import { prisma } from '@/lib/prisma';
import { json, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const regions = await prisma.region.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { cities: true } } },
    });
    return json(
      regions.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        osmAreaName: r.osmAreaName,
        citiesCount: r._count.cities,
      })),
    );
  } catch (err) {
    return serverError((err as Error).message);
  }
}
