import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { findPromotions, UnknownCityError } from '@/lib/queries';
import { badRequest, fromZodError, json, notFound, searchParamsOf, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Параметры — ровно §5. `limit` по умолчанию 50, максимум 200.
 * Истёкшие акции из выдачи не исключаются параметром: по §4.4 их там не бывает никогда.
 */
const Query = z.object({
  city: z.string().min(1).optional(),
  store: z.coerce.number().int().positive().optional(),
  category: z.string().min(1).optional(),
  q: z.string().max(120).optional(),
  adult: z.enum(['all', 'only', 'exclude']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
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
    let cityId: number | undefined;
    if (params.city) {
      const city = await prisma.city.findUnique({
        where: { slug: params.city },
        select: { id: true },
      });
      if (!city) throw new UnknownCityError(params.city);
      cityId = city.id;
    }

    const { total, items } = await findPromotions({
      cityId,
      storeId: params.store,
      categorySlug: params.category,
      q: params.q,
      adult: params.adult,
      page: params.page,
      limit: params.limit,
    });

    return json({ total, items });
  } catch (err) {
    if (err instanceof UnknownCityError) return notFound(err.message);
    return serverError((err as Error).message);
  }
}
