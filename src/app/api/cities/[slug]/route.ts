import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { countCityPromotions } from '@/lib/queries';
import { badRequest, fromZodError, json, notFound, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const Params = z.object({ slug: z.string().min(1) });

export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  let parsed;
  try {
    parsed = Params.parse({ slug });
  } catch (err) {
    if (err instanceof z.ZodError) return badRequest(fromZodError(err));
    throw err;
  }

  try {
    const city = await prisma.city.findUnique({
      where: { slug: parsed.slug },
      include: { region: true, _count: { select: { stores: true } }, sourceMap: true },
    });
    if (!city) return notFound(`Город «${slug}» отсутствует в базе — запустите синхронизацию`);
    return json({
      city: {
        id: city.id,
        slug: city.slug,
        name: city.name,
        lat: city.lat,
        lng: city.lng,
        region: { slug: city.region.slug, name: city.region.name },
        promotionsConnected: Boolean(city.sourceMap),
      },
      storesCount: city._count.stores,
      promosCount: await countCityPromotions(city.id),
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
