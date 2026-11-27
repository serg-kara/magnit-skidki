import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { countCityPromotions } from '@/lib/queries';
import { badRequest, fromZodError, json, searchParamsOf, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const Query = z.object({
  region: z.string().min(1).optional(),
});

export async function GET(request: Request) {
  let params;
  try {
    params = Query.parse(searchParamsOf(request));
  } catch (err) {
    if (err instanceof z.ZodError) return badRequest(fromZodError(err));
    throw err;
  }

  try {
    const cities = await prisma.city.findMany({
      where: params.region ? { region: { slug: params.region } } : undefined,
      include: { _count: { select: { stores: true } }, region: true, sourceMap: true },
      orderBy: { name: 'asc' },
    });
    const items = await Promise.all(
      cities.map(async (city) => ({
        id: city.id,
        slug: city.slug,
        name: city.name,
        lat: city.lat,
        lng: city.lng,
        region: { slug: city.region.slug, name: city.region.name },
        storesCount: city._count.stores,
        promosCount: await countCityPromotions(city.id),
        // §8: город без SourceCityMap — «акции для этого города ещё не подключены».
        promotionsConnected: Boolean(city.sourceMap),
      })),
    );
    return json(items);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
