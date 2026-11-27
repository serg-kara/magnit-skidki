import { metaSnapshot } from '@/lib/queries';
import { json, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { cities, stores, promos, lastStores, lastPromotions } = await metaSnapshot();
    const latest =
      lastStores && lastPromotions
        ? new Date(lastStores.startedAt) > new Date(lastPromotions.startedAt)
          ? lastStores
          : lastPromotions
        : (lastStores ?? lastPromotions);
    return json({
      cities,
      stores,
      promos,
      lastSync: latest
        ? { job: latest.job, status: latest.status, finishedAt: latest.finishedAt }
        : null,
      lastStoresSync: lastStores
        ? { job: lastStores.job, status: lastStores.status, finishedAt: lastStores.finishedAt }
        : null,
      lastPromotionsSync: lastPromotions
        ? {
            job: lastPromotions.job,
            status: lastPromotions.status,
            finishedAt: lastPromotions.finishedAt,
          }
        : null,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
