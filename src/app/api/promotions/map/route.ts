import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { mapMarkers } from '@/lib/queries';
import { badRequest, fromZodError, json, notFound, searchParamsOf, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** §5: city обязателен — без него карта рисовала бы акциях всего края сразу. */
const Query = z.object({
  city: z.string().min(1),
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
    const city = await prisma.city.findUnique({ where: { slug: params.city }, select: { id: true } });
    if (!city) return notFound(`Город «${params.city}» отсутствует в базе — запустите синхронизацию`);
    return json({ markers: await mapMarkers(city.id) });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
