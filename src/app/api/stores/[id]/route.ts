import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { findPromotions } from '@/lib/queries';
import { badRequest, fromZodError, json, notFound, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const Params = z.object({ id: z.coerce.number().int().positive() });

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let parsed;
  try {
    parsed = Params.parse({ id });
  } catch (err) {
    if (err instanceof z.ZodError) return badRequest(fromZodError(err));
    throw err;
  }

  try {
    const store = await prisma.store.findUnique({
      where: { id: parsed.id },
      include: { city: { include: { region: true, sourceMap: true } } },
    });
    if (!store) return notFound(`Магазин ${id} не найден`);

    const { items } = await findPromotions({
      storeId: store.id,
      adult: 'all',
      page: 1,
      limit: 200,
    });

    return json({
      store: {
        id: store.id,
        name: store.name,
        format: store.format,
        address: store.address,
        lat: store.lat,
        lng: store.lng,
        osmId: store.osmId,
        city: {
          slug: store.city.slug,
          name: store.city.name,
          region: store.city.region.name,
          promotionsConnected: Boolean(store.city.sourceMap),
        },
      },
      promotions: items,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
